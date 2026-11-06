import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compose, ITEM_TYPES, isRecord } from '../../src/domain/data/index';
import type { DataPackage, DatasetManifest, Definition, Diagnostic, JsonRecord, PackageEntry } from '../../src/domain/data/types';
import { parsePo } from '../../src/i18n/gettext';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.resolve(project, '..');
const source = path.resolve(process.env.CDDA_SOURCE ?? path.join(root, '0.I-branch'));
const external = path.resolve(process.env.CDDA_MOD_REPO ?? path.join(root, 'mod_repo'));
const output = path.join(project, 'public/datasets');
const sha = (content: string | Uint8Array) => createHash('sha256').update(content).digest('hex');
const relative = (file: string) => path.relative(root, file).replaceAll('\\', '/');
const readJson = async (file: string): Promise<unknown> => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
async function walk(dir: string, extension: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file, extension)); else if (entry.name.endsWith(extension)) files.push(file);
  }
  return files;
}
async function commitHash(): Promise<string> {
  const git = path.join(source, '.git'); const head = (await fs.readFile(path.join(git, 'HEAD'), 'utf8')).trim();
  if (!head.startsWith('ref: ')) return head;
  const ref = head.slice(5);
  try { return (await fs.readFile(path.join(git, ref), 'utf8')).trim(); }
  catch { const packed = await fs.readFile(path.join(git, 'packed-refs'), 'utf8'); const line = packed.split(/\r?\n/).find(l => l.endsWith(` ${ref}`)); if (!line) throw new Error(`Cannot resolve ${ref}`); return line.split(' ')[0]; }
}
const commit = await commitHash();
if (commit !== '7b2efa5cea38e4d4d97dd0e63b28b9148623da59') throw new Error(`Source is ${commit}; this adapter requires tested 0.I-1 commit 7b2efa5.`);
const gameVersion = '0.I-1';
const selected = new Set([...ITEM_TYPES, 'vehicle_part', 'vehicle', 'vehicle_part_migration', 'MIGRATION', 'item_category', 'ITEM_CATEGORY', 'item_group', 'AMMO_TYPE', 'ammunition_type', 'json_flag', 'material', 'skill', 'proficiency', 'mutation', 'mutation_category', 'mutation_type', 'effect_type', 'body_part', 'sub_body_part', 'bionic', 'SPELL', 'martial_art', 'profession', 'scenario', 'EXTERNAL_OPTION', 'MOD_INFO', 'requirement', 'tool_quality', 'fault', 'enchantment']);
const diagnostics: Diagnostic[] = [];
type Mod = { directory: string; info: JsonRecord; origin: 'builtin' | 'external' };
async function modsAt(directory: string, origin: Mod['origin']): Promise<Mod[]> {
  const result: Mod[] = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const dir = path.join(directory, entry.name); const file = path.join(dir, 'modinfo.json');
    try { const json = await readJson(file); for (const info of Array.isArray(json) ? json : [json]) if (isRecord(info) && info.type === 'MOD_INFO') result.push({ directory: dir, info, origin }); }
    catch (error) { diagnostics.push({ severity: 'error', code: 'modinfo-read', message: String(error), source: relative(file) }); }
  }
  return result;
}
const builtins = await modsAt(path.join(source, 'data/mods'), 'builtin'); const thirdParty = await modsAt(external, 'external');
const builtinById = new Map(builtins.map(m => [String(m.info.id), m]));
const requested = ['dda', 'magiclysm', 'aftershock', 'mindovermatter', 'xedra_evolved', 'bombastic_perks', 'DinoMod', 'no_hope', 'no_npc_food', 'personal_portal_storms', 'extra_mut_scens'];
const ordered: Mod[] = []; const visited = new Set<string>();
function visit(id: string) {
  if (visited.has(id)) return; visited.add(id); const mod = builtinById.get(id);
  if (!mod) { diagnostics.push({ severity: 'error', code: 'missing-builtin', message: `Requested builtin/dependency ${id} not found` }); return; }
  for (const dep of Array.isArray(mod.info.dependencies) ? mod.info.dependencies : []) visit(String(dep)); ordered.push(mod);
}
for (const id of requested) visit(id);
const entries: PackageEntry[] = []; const packages: DataPackage[] = [];
await fs.mkdir(path.join(output, '0.I-1'), { recursive: true });
const assets: string[] = [];
async function save(relativeFile: string, content: string): Promise<string> { await fs.writeFile(path.join(output, relativeFile), content, 'utf8'); assets.push(relativeFile); return sha(content); }
const sourceFiles: Record<string, string> = Object.create(null);
const globalCatalog = parsePo(await fs.readFile(path.join(source, 'lang/po/zh_CN.po'), 'utf8'));
for (const mod of [...ordered, ...thirdParty]) {
  const id = String(mod.info.id); const builtin = mod.origin === 'builtin'; const reasons: string[] = [];
  let license: string | null = builtin ? 'CC-BY-SA-3.0' : null; let licenseFile: string | undefined;
  if (!builtin) {
    const licenses = (await walk(mod.directory, '.txt')).filter(f => /licen[sc]e/i.test(path.basename(f)));
    for (const file of licenses) { const text = await fs.readFile(file, 'utf8'); if (/Creative Commons Attribution-ShareAlike 3\.0 Unported/.test(text)) { license = 'CC-BY-SA-3.0'; licenseFile = file; break; } }
    if (!license) reasons.push('No explicit redistributable license found; original content and translations are not distributed.');
  }
  const dependencies = Array.isArray(mod.info.dependencies) ? mod.info.dependencies.map(String) : [];
  if (mod.info.obsolete) reasons.push('Source declares this mod obsolete; not certified compatible.');
  const entry: PackageEntry = { id, name: typeof mod.info.name === 'string' ? mod.info.name : id, source: relative(mod.directory), dependencies, distributable: !!license, license, reasons, file: null, hash: null, definitionCount: 0, obsolete: !!mod.info.obsolete, authors: mod.info.authors, conflicts: Array.isArray(mod.info.conflicts) ? mod.info.conflicts.map(String) : [] };
  // Audit every JSON even when content cannot legally be published. Only aggregate metadata escapes.
  const definitionRoots = id === 'dda' ? [path.join(source, 'data/json'), mod.directory] : [mod.directory];
  const definitions: Definition[] = []; let fileCount = 0; let jsonErrors = 0; const counts: Record<string, number> = Object.create(null);
  for (const dir of definitionRoots) for (const file of await walk(dir, '.json')) {
    fileCount++; let json: unknown;
    try { json = await readJson(file); } catch (error) { jsonErrors++; diagnostics.push({ severity: 'error', code: 'json-parse', message: String(error), package: id, source: relative(file) }); continue; }
    const fileText = await fs.readFile(file, 'utf8'); if (license) sourceFiles[relative(file)] = sha(fileText);
    for (const [i, data] of (Array.isArray(json) ? json : [json]).entries()) {
      if (!isRecord(data)) continue; const type = String(data.type ?? ''); counts[type] = (counts[type] ?? 0) + 1;
      if (license && selected.has(type)) definitions.push({ data, source: `${relative(file)}#${i}`, hash: sha(JSON.stringify(data)) });
    }
  }
  Object.assign(entry, { scannedFiles: fileCount, jsonErrors, typeCounts: counts });
  if (license) {
    const strings = new Set<string>();
    const collect = (v: unknown) => { if (typeof v === 'string') strings.add(v); else if (Array.isArray(v)) v.forEach(collect); else if (isRecord(v)) Object.values(v).forEach(collect); };
    definitions.forEach(d => collect(d.data));
    const catalog = { ...globalCatalog, domain: id, messages: globalCatalog.messages.filter(m => strings.has(m.msgid)) };
    // Builtin translations are extracted from the source's actual global domain. Third-party cannot borrow that domain.
    if (!builtin) { catalog.messages = []; const poFiles = (await walk(mod.directory, '.po')).filter(f => path.basename(f) === 'zh_CN.po'); for (const po of poFiles) { const local = parsePo(await fs.readFile(po, 'utf8'), id); catalog.messages.push(...local.messages.filter(m => strings.has(m.msgid))); } }
    const pkg: DataPackage = { formatVersion: 1, id, name: entry.name, dependencies, conflicts: entry.conflicts, obsolete: entry.obsolete, gameVersion, commit, definitions };
    const safeId = id.replace(/[^a-zA-Z0-9_.-]/g, '_');
    entry.file = `0.I-1/${safeId}.json`; entry.hash = await save(entry.file, JSON.stringify(pkg)); entry.definitionCount = definitions.length;
    entry.translationFile = `0.I-1/${safeId}.zh_CN.json`; entry.translationHash = await save(entry.translationFile, JSON.stringify(catalog));
    packages.push({ ...pkg, hash: entry.hash });
    if (licenseFile) await save(`0.I-1/${safeId}.LICENSE.txt`, await fs.readFile(licenseFile, 'utf8'));
  }
  entries.push(entry);
  console.log(`${id}: ${entry.distributable ? `${definitions.length} definitions` : 'audit only'} (${fileCount} JSON files)`);
}
const knownIds = new Set([...entries.map(e => e.id), ...builtins.map(m => String(m.info.id))]);
const releasedIds = new Set(entries.filter(e => e.distributable).map(e => e.id));
for (const entry of entries) for (const dependency of entry.dependencies) {
  if (!knownIds.has(dependency)) entry.reasons.push(`Missing dependency: ${dependency}`);
  else if (!releasedIds.has(dependency)) entry.reasons.push(`Dependency not distributed in this release: ${dependency}`);
}
for (const entry of entries.filter(e => e.distributable && e.reasons.length)) diagnostics.push({ severity: 'warning', code: 'package-availability', package: entry.id, message: entry.reasons.join(' ') });
const core = packages.find(p => p.id === 'dda');
const report: Record<string, unknown> = {};
for (const pkg of packages) {
  const enabled = pkg.id === 'dda' ? ['dda'] : [...(pkg.dependencies ?? []), pkg.id];
  const result = compose(packages.filter(p => enabled.includes(p.id)), enabled);
  report[pkg.id] = { parts: Object.keys(result.parts).length, items: Object.keys(result.items).length, vehicles: Object.keys(result.vehicles).length, diagnostics: result.diagnostics };
}
await save('0.I-1/diagnostics.json', JSON.stringify(report));
const colorFiles = ['data/raw/colors.json', 'data/raw/color_themes/base_colors-default.json'];
const colors: Record<string, unknown> = {};
for (const colorFile of colorFiles) { const file = path.join(source, colorFile); const text = await fs.readFile(file, 'utf8'); colors[colorFile] = JSON.parse(text); sourceFiles[relative(file)] = sha(text); }
await save('0.I-1/colors.json', JSON.stringify(colors));
await save('0.I-1/sources.json', JSON.stringify(sourceFiles));
await save('0.I-1/LICENSE.txt', await fs.readFile(path.join(source, 'LICENSE.txt'), 'utf8'));
const attribution = `# Dataset attribution\n\nCataclysm: Dark Days Ahead contributors, 0.I-1 (${commit}).\nSource: https://github.com/CleverRaven/Cataclysm-DDA/tree/${commit}\nCore, selected builtin content, and the derived translation catalog: CC BY-SA 3.0, https://creativecommons.org/licenses/by-sa/3.0/ .\nThe source zh_CN.po translators retain their original attribution (see translation-credits.txt).\nBlazemod: Blaze-whatdoyoumeanitsalreadytaken; maintainer SouP; CC BY-SA 3.0 (included license).\nThese files are extracted/restructured subsets, not original unmodified files. See sources.json for original file hashes and each definition for source/index and content hash.\nNo personal save data is included.\n`;
await save('0.I-1/ATTRIBUTION.md', attribution);
const poText = await fs.readFile(path.join(source, 'lang/po/zh_CN.po'), 'utf8');
await save('0.I-1/translation-credits.txt', poText.split(/\r?\n/).filter(l => l.startsWith('#')).slice(0, poText.split(/\r?\n/).findIndex(l => l.startsWith('msgid'))).join('\n'));
const manifest: DatasetManifest = { formatVersion: 1, gameVersion, commit, source: relative(source), sourceLicense: 'CC-BY-SA-3.0', packages: entries, assets, diagnostics, definitionOrder: 'Source directory recursive lexical order; array order preserved. Compose in user enabled order; unresolved parents retried after all definitions.', scope: 'Static editor/display subset; not engine validation. No maps, tiles, private saves, or unlicensed external originals.', externalDirectoriesScanned: (await fs.readdir(external, { withFileTypes: true })).filter(e => e.isDirectory()).length, coreDefinitionCount: core?.definitions.length ?? 0 };
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Extracted ${packages.length} distributable packages. Audited ${thirdParty.length} third-party mods. Manifest: ${path.join(output, 'manifest.json')}`);
