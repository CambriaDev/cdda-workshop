import { asSafeInteger, generateTransferTemplate, isJsonObject, parseLosslessJSON, parseSave, readPlayerCoordinates, scanNearbyVehicles, validateCharacterSave } from '../domain/save';
import type { CompatibilityWarning, JsonObject, JsonValue, NearbyVehicle, ParsedSave, TransferOptions, TransferTemplateResult } from '../domain/save';

/** Deliberately no write/create/remove methods or readwrite permission in this interface. */
export interface ReadFileHandle { kind: 'file'; name: string; getFile(): Promise<File> }
export interface ReadDirectoryHandle { kind: 'directory'; name: string; values(): AsyncIterableIterator<ReadDirectoryHandle | ReadFileHandle> }
export interface CharacterSummary {
  id: string; name: string; version: number | null; valid: boolean; issues: string[];
  stats: string[]; skills: { id: string; level: string }[]; traits: string[]; bionics: string[];
  recipes: number; equipment: { id: string; slot: string }[]; inventoryEntries: number;
  coordinates: readonly [number, number, number] | null; mods: string[]; warnings: CompatibilityWarning[];
}
export type SaveRequest =
  | { type: 'open'; directory?: ReadDirectoryHandle; files?: File[] }
  | { type: 'scan'; characterId: string; radius: number; sameZ: boolean }
  | { type: 'template'; characterId: string; options: TransferOptions };
export type SaveReply =
  | { type: 'progress'; phase: string; completed: number; total: number | null }
  | { type: 'opened'; characters: CharacterSummary[]; warnings: CompatibilityWarning[]; mapCount: number; directory: boolean }
  | { type: 'scanned'; characterId: string; vehicles: NearbyVehicle[]; warnings: CompatibilityWarning[]; scannedFiles: number; scannedSubmaps: number }
  | { type: 'template'; characterId: string; result: Pick<TransferTemplateResult, 'text' | 'warnings' | 'changes' | 'verification'> }
  | { type: 'error'; message: string };
interface Fingerprint { size: number; lastModified: number }
interface Input { path: string; handle?: ReadFileHandle; file?: File; fingerprint?: Fingerprint }
interface Character { input: Input; parsed: ParsedSave; summary: CharacterSummary }
const MAX_FILE_SIZE = 128 * 1024 * 1024;
class SourceChangedError extends Error {}
export async function boundedMap<T, R>(items: readonly T[], run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const reader = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await run(items[index], index); }
      catch (error) { failed = true; throw error; }
    }
  };
  // Drain the other in-flight reader before reporting failure; no late progress after errors.
  const settled = await Promise.allSettled([reader(), reader()]);
  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected) throw rejected.reason;
  return results;
}
function fingerprint(file: File): Fingerprint { return { size: file.size, lastModified: file.lastModified }; }
function same(a: Fingerprint, b: Fingerprint): boolean { return a.size === b.size && a.lastModified === b.lastModified; }
export async function readStableFile(input: Input): Promise<string> {
  const before = input.handle ? await input.handle.getFile() : input.file;
  if (!before) throw new Error('File unavailable. Select the source again.');
  if (before.size > MAX_FILE_SIZE) throw new Error('File exceeds the 128 MiB safety limit.');
  const stamp = fingerprint(before);
  if (input.fingerprint && !same(input.fingerprint, stamp)) throw new SourceChangedError('Source changed since selection. Close the game and select the source again.');
  const text = await before.text();
  if (input.handle && !same(stamp, fingerprint(await input.handle.getFile()))) throw new SourceChangedError('Source changed while reading. Close the game and select the source again.');
  input.fingerprint = stamp;
  return text;
}
async function checkUnchanged(input: Input): Promise<void> {
  if (input.handle && input.fingerprint && !same(input.fingerprint, fingerprint(await input.handle.getFile()))) throw new SourceChangedError('Source changed during this operation. Results discarded; select the source again.');
}
function listIds(value: JsonValue | undefined): string[] {
  if (Array.isArray(value)) return value.flatMap(entry => typeof entry === 'string' ? [entry] : isJsonObject(entry) && typeof entry.id === 'string' ? [entry.id] : []);
  return isJsonObject(value) ? Object.keys(value) : [];
}
function scalar(value: JsonValue | undefined): string { return asSafeInteger(value)?.toString() ?? '—'; }
export function summarizeCharacter(id: string, parsed: ParsedSave, mods: string[]): CharacterSummary {
  const validation = validateCharacterSave(parsed.root);
  const player = isJsonObject(parsed.root.player) ? parsed.root.player : {};
  let coordinates: CharacterSummary['coordinates'] = null;
  const warnings = [...parsed.warnings, ...validation.warnings];
  try { const result = readPlayerCoordinates(parsed.root); coordinates = result.absolute; warnings.push(...result.warnings); }
  catch { warnings.push({ code: 'COORDINATES_UNAVAILABLE', message: 'Player coordinates unavailable; character export is still possible, nearby scan is disabled.' }); }
  const equipment: CharacterSummary['equipment'] = [];
  const add = (value: JsonValue | undefined, slot: string) => { if (isJsonObject(value) && typeof value.typeid === 'string') equipment.push({ id: value.typeid, slot }); };
  if (Array.isArray(player.worn)) player.worn.forEach(value => add(value, 'worn'));
  add(player.weapon, 'weapon');
  return {
    id, name: typeof player.name === 'string' ? player.name : '(invalid character)', version: parsed.header?.version ?? asSafeInteger(parsed.root.savegame_loading_version) ?? null,
    valid: validation.valid, issues: validation.issues.map(issue => `${issue.path}: ${issue.message}`),
    stats: ['str_max', 'dex_max', 'int_max', 'per_max'].map(key => scalar(player[key])),
    skills: isJsonObject(player.skills) ? Object.entries(player.skills).map(([id, value]) => ({ id, level: scalar(isJsonObject(value) ? value.level : value) })) : [],
    traits: listIds(player.mutations ?? player.my_mutations), bionics: listIds(player.my_bionics), recipes: listIds(player.learned_recipes).length,
    equipment, inventoryEntries: Array.isArray(player.inv) ? player.inv.length : isJsonObject(player.inv) ? Object.keys(player.inv).length : 0,
    coordinates, mods, warnings,
  };
}
const parentPath = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
export function createSaveSession(post: (message: SaveReply) => void) {
  let inputs: Input[] = [];
  let characters = new Map<string, Character>();
  let directoryMode = false;
  const progress = (phase: string, completed: number, total: number | null) => post({ type: 'progress', phase, completed, total });
  return async (request: SaveRequest): Promise<void> => {
    try {
      if (request.type === 'open') {
        inputs = []; characters = new Map(); directoryMode = !!request.directory;
        let visited = 0;
        const walk = async (directory: ReadDirectoryHandle, prefix = '', depth = 0): Promise<void> => {
          if (depth > 32) throw new Error('Directory depth safety limit exceeded; choose a single world directory.');
          for await (const entry of directory.values()) {
            if (++visited > 250000) throw new Error('Directory entry safety limit exceeded; choose a single world directory.');
            const path = prefix + entry.name;
            if (entry.kind === 'directory') await walk(entry, `${path}/`, depth + 1);
            else if (/\.(sav|map)$/i.test(entry.name) || entry.name === 'mods.json') inputs.push({ path, handle: entry });
            if (visited % 100 === 0) progress('enumerating', visited, null);
          }
        };
        if (request.directory) await walk(request.directory);
        else inputs = (request.files ?? []).filter(file => /\.sav$/i.test(file.name)).map(file => ({ path: file.name, file }));
        const warnings: CompatibilityWarning[] = [];
        const mods = new Map<string, string[]>();
        await boundedMap(inputs.filter(input => input.path.endsWith('/mods.json') || input.path === 'mods.json'), async input => {
          try {
            const value = parseLosslessJSON((await readStableFile(input)).replace(/^\uFEFF/, ''));
            if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) throw new Error('Invalid mods');
            mods.set(parentPath(input.path), value as string[]);
          } catch (error) { if (error instanceof SourceChangedError) throw error; warnings.push({ code: 'MODS_UNREADABLE', message: 'A mods.json could not be read; dependency matching is incomplete.' }); }
        });
        const saves = inputs.filter(input => /\.sav$/i.test(input.path));
        let completed = 0;
        await boundedMap(saves, async (input, index) => {
          try {
            const parsed = parseSave(await readStableFile(input));
            const summary = summarizeCharacter(String(index), parsed, mods.get(parentPath(input.path)) ?? []);
            characters.set(String(index), { input, parsed, summary });
          } catch (error) { if (error instanceof SourceChangedError) throw error; warnings.push({ code: 'SAVE_UNREADABLE', message: 'A character save could not be read or parsed. No data from that file was imported.' }); }
          progress('characters', ++completed, saves.length);
        });
        await boundedMap(inputs.filter(input => input.fingerprint), checkUnchanged);
        post({ type: 'opened', characters: [...characters.values()].map(c => c.summary).sort((a, b) => Number(a.id) - Number(b.id)), warnings, mapCount: inputs.filter(input => /\.map$/i.test(input.path)).length, directory: directoryMode });
        return;
      }
      const character = characters.get(request.characterId);
      if (!character) throw new Error('Select the source and character again.');
      const world = parentPath(character.input.path);
      const dependencies = [character.input, ...inputs.filter(input => input.path === (world ? `${world}/mods.json` : 'mods.json'))];
      await boundedMap(dependencies, checkUnchanged);
      if (request.type === 'template') {
        const result = generateTransferTemplate(character.parsed.root, request.options);
        await boundedMap(dependencies, checkUnchanged);
        post({ type: 'template', characterId: request.characterId, result: { text: result.text, warnings: result.warnings, changes: result.changes, verification: result.verification } });
      } else {
        if (!directoryMode) throw new Error('Nearby scanning requires a read-only directory selection.');
        const origin = readPlayerCoordinates(character.parsed.root).absolute;
        // Scope to the selected character's world, never to another sibling world.
        const maps = inputs.filter(input => /\.map$/i.test(input.path) && (!world || input.path.startsWith(`${world}/`)));
        const vehicles: NearbyVehicle[] = [];
        const warnings: CompatibilityWarning[] = [];
        let completed = 0, scannedSubmaps = 0;
        // No filename XY/Z prefilter: outlying vehicle anchors are legal in source saves.
        await boundedMap(maps, async input => {
          const result = scanNearbyVehicles([{ id: input.path, text: await readStableFile(input) }], origin, { radius: request.radius, sameZ: request.sameZ });
          vehicles.push(...result.vehicles); warnings.push(...result.warnings); scannedSubmaps += result.scannedSubmaps;
          progress('maps', ++completed, maps.length);
        });
        await boundedMap([...dependencies, ...maps], checkUnchanged);
        vehicles.sort((a, b) => a.distance - b.distance || a.inputId.localeCompare(b.inputId) || a.submapIndex - b.submapIndex || a.vehicleIndex - b.vehicleIndex);
        post({ type: 'scanned', characterId: request.characterId, vehicles, warnings, scannedFiles: maps.length, scannedSubmaps });
      }
    } catch (error) { post({ type: 'error', message: error instanceof Error ? error.message : 'Read-only save operation failed.' }); }
  };
}
// This guard also allows unit tests to import the pure/session helpers without a Worker global.
if (typeof self !== 'undefined' && typeof document === 'undefined' && 'postMessage' in self) {
  const handle = createSaveSession(message => self.postMessage(message));
  self.onmessage = (event: MessageEvent<SaveRequest>) => { void handle(event.data); };
}
