import { assertVehicle, clone, definitionFieldsReliable, flags, issue, record, type Definition, type EditResult, type Issue, type VehicleIndexes, type VehicleModel, type VehiclePart } from './types';
export interface InstallRequest { id: string; x: number; y: number; variant?: string }
const ruleFields = ['flags', 'location', 'engine', 'engine_info'] as const;
const supportFields = ['flags', 'location'] as const;
const at = (a: VehiclePart, b: VehiclePart) => a.mount_dx === b.mount_dx && a.mount_dy === b.mount_dy;
const supportsStructure = (p: VehiclePart, indexes: VehicleIndexes) => { const d = indexes.parts.get(p.id); return definitionFieldsReliable(d, supportFields) && d?.location === 'structure' && !flags(d).includes('PROTRUSION'); };
const engine = (d?: Definition): Record<string, unknown> => record(d?.engine) ? d.engine : record(d?.engine_info) ? d.engine_info : {};
function mountIssues(vehicle: VehicleModel, candidate: VehiclePart, indexes: VehicleIndexes, partIndex: number): Issue[] {
  const out: Issue[] = [], def = indexes.parts.get(candidate.id);
  const error = (code: string, text: string) => out.push(issue(code, text, partIndex, 'error'));
  if (!def) return [issue('unknown-part', `Unknown part ${candidate.id}; retained without assuming installation rules.`, partIndex)];
  if (!definitionFieldsReliable(def, ruleFields)) return [issue('incomplete-part-rules', `Part ${candidate.id} has unresolved inheritance/finalize semantics; installation rules are not trusted.`, partIndex)];
  const here = vehicle.parts.filter(p => at(p, candidate));
  const known = here.map(p => indexes.parts.get(p.id)).filter((d): d is Definition => !!d && definitionFieldsReliable(d, supportFields));
  const fs = flags(def), has = (f: string) => fs.includes(f);
  if (here.length !== known.length) out.push(issue('incomplete-existing-rules', 'Unknown/incomplete installed parts prevent complete conflict validation.', partIndex));
  if (!here.length && def.location !== 'structure') error('no-structure', 'The first part on a tile must occupy structure.');
  const first = indexes.parts.get(here[0]?.id ?? '');
  if (definitionFieldsReliable(first, ['flags']) && (flags(first).includes('ANIMAL_CTRL') || flags(first).includes('PROTRUSION')) && !has('TOW_CABLE')) error('blocked-tile', 'Only tow cables may share this protrusion/animal-control tile.');
  for (const other of known) {
    const ofs = flags(other);
    if (other.id === def.id && !has('POWER_TRANSFER')) error('duplicate-part', 'This part is already installed on this tile.');
    if (typeof def.location === 'string' && def.location && other.location === def.location) error('location-conflict', `Location ${def.location} is occupied.`);
    if (has('CARGO') && ofs.includes('CARGO')) error('cargo-conflict', 'Only one cargo part is allowed per tile.');
    if ((has('VISION') && !has('CAMERA') && ofs.includes('OPAQUE')) || (has('OPAQUE') && ofs.includes('VISION') && !ofs.includes('CAMERA'))) error('mirror-opaque', 'Mirrors conflict with opaque parts.');
    if (has('TURRET_MOUNT') && ofs.includes('TURRET_MOUNT')) error('turret-conflict', 'Only one turret mount per tile.');
  }
  if (vehicle.parts.length && !vehicle.parts.some(p => supportsStructure(p, indexes) && Math.abs(p.mount_dx - candidate.mount_dx) + Math.abs(p.mount_dy - candidate.mount_dy) <= 1)) {
    if (vehicle.parts.some(p => !definitionFieldsReliable(indexes.parts.get(p.id), supportFields))) out.push(issue('unknown-support', 'Unknown parts prevent a complete structural connectivity check.', partIndex));
    else error('disconnected', 'Part must be on or orthogonally adjacent to existing structure.');
  }
  const exclusions = engine(def).exclusions;
  if (Array.isArray(exclusions)) for (const p of vehicle.parts) {
    const otherDef = indexes.parts.get(p.id);
    if (!definitionFieldsReliable(otherDef, ['engine', 'engine_info'])) { out.push(issue('incomplete-engine-rules', 'An incomplete installed part prevents full engine-exclusion validation.', partIndex)); continue; }
    const other = engine(otherDef).exclusions;
    if (Array.isArray(other) && exclusions.some(e => other.includes(e))) { error('engine-exclusion', 'Engine exclusion groups conflict.'); break; }
  }
  if (indexes.flagRequirements) for (const f of fs) {
    const required = indexes.flagRequirements.get(f);
    if (required && !known.some(d => flags(d).includes(required))) {
      if (known.length !== here.length) out.push(issue('unknown-required-flag', `Cannot establish required flag ${required} with unknown parts.`, partIndex));
      else error('required-flag', `${f} requires ${required} on the same tile.`);
    }
  }
  else if (fs.length) out.push(issue('flag-rules-unavailable', 'Flag requirement definitions were not supplied; dependency validation is incomplete.', partIndex));
  if (candidate.variant && record(def.variants) && !(candidate.variant in def.variants)) out.push(issue('unknown-variant', `Unknown variant ${candidate.variant}; preserved.`, partIndex));
  return out;
}
export function validateVehicle(vehicle: VehicleModel, indexes: VehicleIndexes): Issue[] {
  assertVehicle(vehicle);
  const prefix: VehicleModel = { name: vehicle.name, parts: [] }, issues: Issue[] = [];
  vehicle.parts.forEach((p, i) => { issues.push(...mountIssues(prefix, p, indexes, i)); prefix.parts.push(p); });
  return issues;
}
export function installPart(vehicle: VehicleModel, request: InstallRequest, indexes: VehicleIndexes): EditResult {
  assertVehicle(vehicle);
  const part: VehiclePart = { id: request.id, mount_dx: request.x, mount_dy: request.y, ...(request.variant ? { variant: request.variant } : {}) };
  assertVehicle({ name: '', parts: [part] });
  const def = indexes.parts.get(request.id);
  if (definitionFieldsReliable(def, ['item']) && typeof def?.item === 'string') part.base = { typeid: def.item };
  const issues = mountIssues(vehicle, part, indexes, vehicle.parts.length);
  if (def && !definitionFieldsReliable(def, ['item'])) issues.push(issue('incomplete-base-association', 'Part-to-item association is unresolved; no base instance was fabricated.', vehicle.parts.length));
  const ok = !issues.some(i => i.severity === 'error');
  const result = clone(vehicle); if (ok) result.parts.push(part);
  return { vehicle: result, issues, ok };
}
export function removePart(vehicle: VehicleModel, partIndex: number, indexes: VehicleIndexes): EditResult {
  assertVehicle(vehicle);
  const target = vehicle.parts[partIndex];
  if (!target) throw new Error('Part index out of range');
  const result = clone(vehicle), issues: Issue[] = [], rawDef = indexes.parts.get(target.id), def = definitionFieldsReliable(rawDef, ruleFields) ? rawDef : undefined;
  const error = (code: string, message: string) => issues.push(issue(code, message, partIndex, 'error'));
  const here = vehicle.parts.filter((p, i) => i !== partIndex && at(p, target));
  if (!def) issues.push(issue(rawDef ? 'incomplete-part-rules' : 'unknown-part', 'Unknown/incomplete part removal rules are not verified.', partIndex));
  for (const p of here) {
    const attached = indexes.parts.get(p.id);
    if (!definitionFieldsReliable(attached, ['flags'])) continue;
    for (const f of flags(attached)) {
      const required = indexes.flagRequirements?.get(f);
      if (required && flags(def).includes(required)) error('required-by-part', `Remove attached ${p.id} first.`);
    }
  }
  if (def?.location === 'structure' && here.some(p => { const d = indexes.parts.get(p.id); return d && definitionFieldsReliable(d, supportFields) && d.location !== 'structure' && !flags(d).some(f => f === 'POWER_TRANSFER' || f === 'TOW_CABLE'); })) error('attached-parts', 'Remove attached non-structure parts first.');
  result.parts.splice(partIndex, 1);
  const cells = new Set(result.parts.filter(p => supportsStructure(p, indexes)).map(p => `${p.mount_dx},${p.mount_dy}`));
  if (def?.location === 'structure' && !cells.size && result.parts.some(p => definitionFieldsReliable(indexes.parts.get(p.id), ['flags']) && flags(indexes.parts.get(p.id)).includes('PROTRUSION'))) error('unsupported-protrusion', 'Remove protrusions before the last supporting structure.');
  if (!indexes.flagRequirements && here.some(p => flags(indexes.parts.get(p.id)).length > 0)) issues.push(issue('flag-rules-unavailable', 'Flag dependencies were not supplied; removal checks are incomplete.', partIndex));
  if (here.some(p => !definitionFieldsReliable(indexes.parts.get(p.id), supportFields))) issues.push(issue('unknown-attachment', 'Unknown attached parts prevent complete removal validation.', partIndex));
  if (def?.location === 'structure' && cells.size) {
    const seen = new Set<string>(), queue = [cells.values().next().value!];
    while (queue.length) { const key = queue.pop()!; if (seen.has(key)) continue; seen.add(key); const [x, y] = key.split(',').map(Number); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const next = `${x! + dx!},${y! + dy!}`; if (cells.has(next) && !seen.has(next)) queue.push(next); } }
    if (seen.size !== cells.size) {
      if (result.parts.some(p => !definitionFieldsReliable(indexes.parts.get(p.id), supportFields))) issues.push(issue('unknown-connectivity', 'Unknown/incomplete remaining parts prevent proving whether removal splits the vehicle.', partIndex));
      else error('would-split', 'Removing structure would split the vehicle.');
    }
  }
  if (Array.isArray(target.carried_stack) && target.carried_stack.length) error('carried-part', 'Unrack carried vehicle before removal.');
  const ok = !issues.some(i => i.severity === 'error');
  return { vehicle: ok ? result : clone(vehicle), issues, ok };
}
export function renameVehicle(vehicle: VehicleModel, name: string): VehicleModel { return { ...clone(vehicle), name }; }
export function setPartVariant(vehicle: VehicleModel, partIndex: number, variant: string): VehicleModel { const v = clone(vehicle); if (!v.parts[partIndex]) throw new Error('Part index out of range'); v.parts[partIndex]!.variant = variant; return v; }
export function partsAt(vehicle: VehicleModel, x: number, y: number): VehiclePart[] { return vehicle.parts.filter(p => p.mount_dx === x && p.mount_dy === y); }
