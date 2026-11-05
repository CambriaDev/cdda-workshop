import { stringifyLosslessJSON, type JsonValue } from '../save/losslessJson';
import { assertVehicle, clone, definitionFieldsReliable, flags, issue, record, type Definition, type ItemInstance, type Issue, type VehicleIndexes, type VehicleModel, type VehiclePart } from './types';
export interface MigrationOptions { includeCargo: boolean; condition: 'preserve' | 'new'; fuelSelections?: Record<number, string> }
export interface Change { partIndex: number; path: string; before: unknown; after: unknown }
export interface FuelOption { itemId: string; capacity: number | null }
export interface FuelChoice { partIndex: number; fixedBattery: boolean; options: FuelOption[]; supported: boolean; reason?: string }
function ammoCategory(d: Definition): string | undefined { return typeof d.ammo_type === 'string' ? d.ammo_type : record(d.ammo) && typeof d.ammo.ammo_type === 'string' ? d.ammo.ammo_type : undefined; }
function magazineInfo(part: VehiclePart, indexes: VehicleIndexes): { restriction: Record<string, unknown>; supported: boolean } | undefined {
  const def = indexes.items.get(part.base?.typeid ?? String(indexes.parts.get(part.id)?.item ?? ''));
  if (!def || !definitionFieldsReliable(def, ['pocket_data']) || !definitionFieldsReliable(indexes.parts.get(part.id), ['item', 'flags']) || !Array.isArray(def.pocket_data)) return undefined;
  const pockets = def.pocket_data.filter(record);
  const magazines = pockets.filter(p => p.pocket_type === 'MAGAZINE');
  if (magazines.length !== 1 || pockets.some(p => p.pocket_type === 'MAGAZINE_WELL') || !record(magazines[0]?.ammo_restriction)) return undefined;
  return { restriction: magazines[0].ammo_restriction, supported: pockets.length === 1 };
}
export function getFuelChoices(vehicle: VehicleModel, indexes: VehicleIndexes): FuelChoice[] {
  const out: FuelChoice[] = [];
  vehicle.parts.forEach((p, partIndex) => {
    const pd = indexes.parts.get(p.id), fs = flags(pd), mag = magazineInfo(p, indexes);
    const baseDef = indexes.items.get(p.base?.typeid ?? String(pd?.item ?? ''));
    const battery = !!mag && Object.keys(mag.restriction).length === 1 && 'battery' in mag.restriction;
    if (mag) {
      const options: FuelOption[] = [];
      for (const it of indexes.items.values()) {
        if (!definitionFieldsReliable(it, ['ammo_type', 'ammo', 'subtypes', 'type'])) continue;
        const cat = ammoCategory(it); const capacity = cat ? mag.restriction[cat] : undefined;
        if (typeof capacity === 'number' && Number.isSafeInteger(capacity) && capacity >= 0) options.push({ itemId: it.id, capacity });
      }
      out.push({ partIndex, fixedBattery: battery, options, supported: mag.supported, ...(mag.supported ? {} : { reason: 'Multiple pockets require unimplemented capacity rules.' }) });
    } else if (!definitionFieldsReliable(pd, ['item', 'flags']) || !definitionFieldsReliable(baseDef, ['pocket_data']) || fs.some(f => ['FLUIDTANK', 'TURRET', 'BATTERY', 'REACTOR'].includes(f)) || (Array.isArray(baseDef?.pocket_data) && baseDef.pocket_data.some(p => record(p) && ['MAGAZINE', 'MAGAZINE_WELL'].includes(String(p.pocket_type))))) {
      out.push({ partIndex, fixedBattery: false, options: [], supported: false, reason: 'Tank volume, detachable magazine or nested fuel capacity is not implemented; original quantity is retained.' });
    }
  });
  return out;
}
export function previewMigration(vehicle: VehicleModel, options: MigrationOptions, indexes: VehicleIndexes): { vehicle: VehicleModel; changes: Change[]; issues: Issue[]; fullyRenewed: boolean } {
  assertVehicle(vehicle);
  const result = clone(vehicle), changes: Change[] = [], issues: Issue[] = [];
  const change = (i: number, obj: Record<string, unknown>, field: string, value: unknown, path = field) => {
    if ((obj[field] === undefined ? undefined : stringifyLosslessJSON(obj[field] as JsonValue, 0)) !== stringifyLosslessJSON(value as JsonValue, 0)) { changes.push({ partIndex: i, path, before: obj[field] === undefined ? null : clone(obj[field]), after: clone(value) }); obj[field] = clone(value); }
  };
  result.parts.forEach((p, i) => {
    // Only serialized part.items is cargo. base.contents fuel and installed tools remain intact.
    if (!options.includeCargo && p.items?.length) change(i, p, 'items', []);
    if (!definitionFieldsReliable(indexes.parts.get(p.id), ['item', 'flags'])) issues.push(issue('unknown-part', `Unknown/incomplete ${p.id}; retained and not assumed fully renewable.`, i));
    if (p.base && !definitionFieldsReliable(indexes.items.get(p.base.typeid ?? ''), ['pocket_data', 'flags', 'faults', 'damage_max'])) issues.push(issue('incomplete-base', 'Unknown/incomplete base definition: repair/refill completion cannot be verified.', i));
    if (options.condition === 'new') {
      if (p.base) { change(i, p.base, 'damaged', 0, 'base.damaged'); change(i, p.base, 'degradation', 0, 'base.degradation'); change(i, p.base, 'faults', [], 'base.faults'); }
      else issues.push(issue('missing-base', 'No base item instance: repair cannot be verified.', i));
      if (p.tools?.length) issues.push(issue('tools-preserved', 'Installed tools are preserved; their individual repairs/refills are not implemented.', i));
    }
  });
  if (options.condition === 'new') for (const choice of getFuelChoices(result, indexes)) {
    const p = result.parts[choice.partIndex]!;
    if (!choice.supported || !p.base) { issues.push(issue('refill-unsupported', choice.reason ?? 'No base item instance.', choice.partIndex)); continue; }
    // A fixed battery is not a free fuel choice. Its one battery ammunition ID must still be proven by data.
    const selected = choice.fixedBattery ? (choice.options.length === 1 ? choice.options[0]!.itemId : undefined) : options.fuelSelections?.[choice.partIndex];
    const option = choice.options.find(o => o.itemId === selected);
    if (!selected || !option || option.capacity === null) { issues.push(issue('fuel-choice-required', 'Explicit allowed fuel/ammunition choice is required; original quantity retained (fixed battery also requires unambiguous battery data).', choice.partIndex)); continue; }
    const contents = p.base.contents;
    if (contents !== undefined && (!record(contents) || !Array.isArray(contents.contents) || contents.contents.length !== 1 || !record(contents.contents[0]) || contents.contents[0].pocket_type !== 1 || !Array.isArray(contents.contents[0].contents) || contents.contents[0].contents.length > 1 || (Array.isArray(contents.additional_pockets) && contents.additional_pockets.length > 0))) {
      issues.push(issue('refill-instance-unsupported', 'Unrecognized or multi-pocket instance: original fuel retained.', choice.partIndex)); continue;
    }
    const existing = record(contents) && Array.isArray(contents.contents) && record(contents.contents[0]) ? contents.contents[0] : { pocket_type: 1, contents: [] };
    const oldAmmo = Array.isArray(existing.contents) && record(existing.contents[0]) ? existing.contents[0] as ItemInstance : undefined;
    const ammo: ItemInstance = oldAmmo?.typeid === selected ? { ...clone(oldAmmo), charges: option.capacity } : { typeid: selected, charges: option.capacity };
    const next = record(contents) ? { ...clone(contents), contents: [{ ...clone(existing), contents: [ammo] }] } : { contents: [{ ...existing, contents: [ammo] }], additional_pockets: [] };
    change(choice.partIndex, p.base, 'contents', next, 'base.contents');
  }
  return { vehicle: result, changes, issues, fullyRenewed: options.condition === 'new' && !issues.length };
}
