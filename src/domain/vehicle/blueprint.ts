import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { stringifyLosslessJSON, type JsonValue } from '../save/losslessJson';
import { assertVehicle, clone, definitionFieldsReliable, flags, GAME_VALIDATION_WARNING, issue, record, type Issue, type ItemInstance, type VehicleIndexes, type VehicleModel, type VehicleProject } from './types';
import { validateVehicle } from './model';
import { nestedItems } from './stats';
import { parseJsonSafely, parseProject } from './project';
export interface BlueprintOptions { id?: string; modId?: string; dependencies?: string[] }
export interface BlueprintExport { prototype: Record<string, unknown>; modInfo: Record<string, unknown>; losses: Issue[]; files: Record<string, string>; gameValidated: false }
export function safeFilename(value: string): string { const clean = value.normalize('NFKC').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 72); return clean && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(clean) ? clean : 'vehicle'; }
function stableId(vehicle: VehicleModel): string { let hash = 2166136261; for (const ch of stringifyLosslessJSON(vehicle as unknown as JsonValue, 0)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619); return `workshop_${safeFilename(vehicle.name).toLowerCase()}_${(hash >>> 0).toString(16)}`; }
export function exportBlueprint(vehicle: VehicleModel, options: BlueprintOptions, indexes: VehicleIndexes): BlueprintExport {
  assertVehicle(vehicle);
  const checks = validateVehicle(vehicle, indexes);
  if (checks.some(c => c.severity === 'error')) throw new Error(`Invalid vehicle structure: ${checks.filter(c => c.severity === 'error').map(c => c.code).join(', ')}`);
  if (!vehicle.parts.length) throw new Error('Cannot export an empty blueprint');
  const id = options.id ? safeFilename(options.id) : stableId(vehicle), modId = options.modId ? safeFilename(options.modId) : `${id}_mod`;
  const losses: Issue[] = [...checks, issue('game-unverified', GAME_VALIDATION_WARNING), issue('vehicle-instance-state', 'World position, ownership, motion, zones, autopilot, passengers and other vehicle-instance fields are not represented in this prototype.')];
  const parts: Record<string, unknown>[] = [], items: Record<string, unknown>[] = [];
  vehicle.parts.forEach((p, i) => {
    const def = indexes.parts.get(p.id), fs = definitionFieldsReliable(def, ['flags']) ? flags(def) : [], partId = p.variant ? `${p.id}#${p.variant}` : p.id;
    const inspectItem = (item: ItemInstance, depth = 0) => {
      if (depth > 64) return;
      const itemDef = indexes.items.get(item.typeid ?? '');
      if (!definitionFieldsReliable(itemDef, ['type', 'subtypes', 'pocket_data', 'ammo_type', 'ammo'])) losses.push(issue('unknown-export-item', `Unknown/incomplete item ${item.typeid ?? '(missing id)'}; required mod and game behavior cannot be verified.`, i));
      nestedItems(item).items.forEach(child => inspectItem(child, depth + 1));
    };
    if (p.base) inspectItem(p.base);
    [...p.items ?? [], ...p.tools ?? []].forEach(item => inspectItem(item));
    let value: string | Record<string, unknown> = partId;
    // Imported prototypes carry spawn descriptions, not manufactured save instances.
    if (record(p.blueprintSpawn)) {
      const spawn: Record<string, unknown> = { part: partId };
      for (const key of ['ammo', 'ammo_types', 'ammo_qty', 'fuel', 'tools']) if (p.blueprintSpawn[key] !== undefined) spawn[key] = clone(p.blueprintSpawn[key]);
      if (Object.keys(spawn).length > 1) value = spawn;
    }
    const resource = p.base ? nestedItems(p.base) : { items: [], unsupported: false };
    if (resource.items.length === 1 && !resource.unsupported && typeof resource.items[0]?.typeid === 'string') {
      const ammo = resource.items[0]!;
      if (fs.includes('FLUIDTANK') && typeof ammo.charges === 'number' && ammo.charges > 0) value = { part: partId, fuel: ammo.typeid };
      else if (fs.includes('TURRET') && typeof ammo.charges === 'number' && ammo.charges > 0) value = { part: partId, ammo: 100, ammo_types: [ammo.typeid], ammo_qty: [ammo.charges, ammo.charges] };
    }
    if (p.tools?.length) {
      const tools = p.tools.map(t => t.typeid).filter((s): s is string => typeof s === 'string');
      value = { ...(typeof value === 'string' ? { part: value } : value), tools };
      losses.push(issue('tool-instance-state', 'Only installed tool IDs are represented; tool damage, charges and contents are lost.', i));
    }
    // One coordinate entry per installed part preserves global installation order, including interleaved cells.
    parts.push({ x: p.mount_dx, y: p.mount_dy, parts: [value] });
    losses.push(issue('part-instance-state', 'Part/base damage, degradation, faults, enabled/open/locked state and unknown instance fields cannot be preserved in a prototype.', i));
    if (resource.items.length || resource.unsupported || typeof p.base?.charges === 'number') losses.push(issue('resource-instance-state', 'Fuel/battery quantities and nested base-item state are not lossless. Tanks use game spawn filling; turret top-level ammo may retain a supported quantity.', i));
    if (p.items?.length) {
      const simple: string[] = [];
      for (const cargo of p.items) if (typeof cargo.typeid === 'string') simple.push(cargo.typeid);
      if (simple.length) items.push({ x: p.mount_dx, y: p.mount_dy, chance: 100, items: simple });
      losses.push(issue('cargo-instance-state', 'Only top-level cargo item IDs are exported: nested contents, charges, damage, rot and all other item state are lost.', i));
    }
  });
  if (record(vehicle.importedPrototype) && Array.isArray(vehicle.importedPrototype.items)) {
    for (const raw of vehicle.importedPrototype.items) if (record(raw) && vehicle.parts.some(p => p.mount_dx === raw.x && p.mount_dy === raw.y)) {
      const spawn: Record<string, unknown> = {};
      for (const key of ['x', 'y', 'chance', 'magazine', 'ammo', 'items', 'variant', 'item_groups']) if (raw[key] !== undefined) spawn[key] = clone(raw[key]);
      items.push(spawn);
    }
  }
  const prototype = { id, type: 'vehicle', name: vehicle.name, parts, items, zones: [] };
  const modInfo = { type: 'MOD_INFO', id: modId, name: `${vehicle.name} (Workshop blueprint)`, authors: ['CDDA Workshop user'], description: 'Editor-generated 0.I-1 vehicle blueprint. Read loss-report.json; game validation has not been performed.', category: 'vehicles', dependencies: [...new Set(['dda', ...options.dependencies ?? []])] };
  const readme = `# Vehicle blueprint: ${vehicle.name}\n\nTarget source: CDDA 0.I-1 (7b2efa5). GAME VALIDATION NOT PERFORMED.\n\nExtract this folder into a game-recognized mods directory. Enable mod ${modId} in the target world, reload the world, then spawn vehicle ${id} using the debug menu. Do not copy this JSON into save map files. Required mods: ${(modInfo.dependencies as string[]).join(', ')}. Missing versions/dependencies can prevent loading.\n\nBlueprints are lossy: review loss-report.json before importing. Export an editor project alongside it for complete instance preservation. Editor project files are NOT game-native vehicle blueprints.\n`;
  const files = { 'modinfo.json': JSON.stringify([modInfo], null, 2), 'vehicle.json': JSON.stringify([prototype], null, 2), 'loss-report.json': JSON.stringify({ gameValidated: false, losses }, null, 2), 'README.md': readme };
  return { prototype, modInfo, losses, files, gameValidated: false };
}
export function exportBlueprintZip(vehicle: VehicleModel, options: BlueprintOptions, indexes: VehicleIndexes): Uint8Array {
  const out = exportBlueprint(vehicle, options, indexes); const folder = safeFilename(String(out.modInfo.id));
  return zipSync(Object.fromEntries(Object.entries(out.files).map(([name, text]) => [`${folder}/${name}`, strToU8(text)])));
}
export function importBlueprint(input: unknown): { vehicle: VehicleModel; issues: Issue[] } {
  const arr = Array.isArray(input) ? input : [input]; const bp = arr.find(v => record(v) && v.type === 'vehicle');
  if (!record(bp) || !Array.isArray(bp.parts) || !(typeof bp.name === 'string' || (record(bp.name) && typeof bp.name.str === 'string'))) throw new Error('Invalid vehicle prototype');
  const name = typeof bp.name === 'string' ? bp.name : String((bp.name as Record<string, unknown>).str);
  const vehicle: VehicleModel = { name, parts: [], importedPrototype: clone(bp) };
  const issues = [issue('prototype-not-instance', 'Blueprint spawn instructions are preserved in importedPrototype; fuel/ammo/cargo spawn probabilities are not simulated.'), issue('game-unverified', GAME_VALIDATION_WARNING)];
  for (const cell of bp.parts) {
    if (!record(cell) || !Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y)) throw new Error('Invalid blueprint coordinates');
    const entries = Array.isArray(cell.parts) ? cell.parts : typeof cell.part === 'string' ? [cell] : undefined;
    if (!entries) throw new Error('Invalid blueprint part list');
    for (const entry of entries) {
      const id = typeof entry === 'string' ? entry : record(entry) && typeof entry.part === 'string' ? entry.part : undefined;
      if (!id) throw new Error('Invalid blueprint part ID');
      if (record(entry)) {
        for (const key of ['fuel']) if (entry[key] !== undefined && typeof entry[key] !== 'string') throw new Error(`Invalid blueprint ${key}`);
        if (entry.ammo !== undefined && (!Number.isInteger(entry.ammo) || Number(entry.ammo) < 0 || Number(entry.ammo) > 100)) throw new Error('Invalid blueprint ammo chance');
        if (entry.ammo_qty !== undefined && (!Array.isArray(entry.ammo_qty) || entry.ammo_qty.length !== 2 || !entry.ammo_qty.every(v => Number.isSafeInteger(v) && v >= 0) || entry.ammo_qty[0] > entry.ammo_qty[1])) throw new Error('Invalid blueprint ammo quantity');
        for (const key of ['ammo_types', 'tools']) if (entry[key] !== undefined && !(typeof entry[key] === 'string' || (Array.isArray(entry[key]) && (entry[key] as unknown[]).every(v => typeof v === 'string')))) throw new Error(`Invalid blueprint ${key}`);
      }
      const [partId, ...variant] = id.split('#');
      vehicle.parts.push({ id: partId!, mount_dx: cell.x as number, mount_dy: cell.y as number, ...(variant.length ? { variant: variant.join('#') } : {}), ...(record(entry) ? { blueprintSpawn: clone(entry) } : {}) });
    }
  }
  if (bp.items !== undefined) {
    if (!Array.isArray(bp.items)) throw new Error('Invalid blueprint cargo spawns');
    for (const spawn of bp.items) {
      if (!record(spawn) || !Number.isSafeInteger(spawn.x) || !Number.isSafeInteger(spawn.y) || !Number.isSafeInteger(spawn.chance) || Number(spawn.chance) < 1 || Number(spawn.chance) > 100) throw new Error('Invalid blueprint cargo spawn');
      for (const key of ['items', 'item_groups']) if (spawn[key] !== undefined && !(typeof spawn[key] === 'string' || (Array.isArray(spawn[key]) && (spawn[key] as unknown[]).every(v => typeof v === 'string')))) throw new Error(`Invalid blueprint cargo ${key}`);
      for (const key of ['ammo', 'magazine']) if (spawn[key] !== undefined && (!Number.isSafeInteger(spawn[key]) || Number(spawn[key]) < 0 || Number(spawn[key]) > 100)) throw new Error(`Invalid blueprint cargo ${key} chance`);
    }
  }
  assertVehicle(vehicle); return { vehicle, issues };
}
export function importVehicleFile(input: string | Uint8Array): { vehicle: VehicleModel; project?: VehicleProject; issues: Issue[] } {
  if (typeof input === 'string') {
    const raw = parseJsonSafely(input);
    if (record(raw) && raw.format === 'cdda-vehicle-project') { const project = parseProject(raw); return { vehicle: project.vehicle, project, issues: project.warnings }; }
    return importBlueprint(raw);
  }
  if (input.length > 16 * 1024 * 1024) throw new Error('ZIP exceeds 16 MiB compressed limit');
  let total = 0, entries = 0;
  const files = unzipSync(input, { filter: file => {
    if (++entries > 32) throw new Error('ZIP entry count exceeds 32');
    if (file.name.includes('\\') || file.name.startsWith('/') || file.name.includes(':') || file.name.split('/').includes('..')) throw new Error('Unsafe ZIP path');
    total += file.originalSize;
    if (file.originalSize > 8 * 1024 * 1024 || total > 32 * 1024 * 1024) throw new Error('ZIP expanded size limit exceeded');
    return true;
  } });
  const candidates = Object.entries(files).filter(([path]) => /(^|\/)vehicle\.json$/.test(path));
  if (candidates.length !== 1) throw new Error('Expected exactly one vehicle.json in blueprint ZIP');
  return importBlueprint(parseJsonSafely(strFromU8(candidates[0]![1])));
}
