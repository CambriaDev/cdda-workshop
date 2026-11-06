import { definitionFieldsReliable, flags, issue, record, type Definition, type ItemInstance, type Issue, type Metric, type VehicleIndexes, type VehicleModel } from './types';
const unitTables: Record<string, Record<string, number>> = { g: { mg: .001, g: 1, kg: 1000 }, ml: { ml: 1, L: 1000, l: 1000 }, W: { mW: .001, W: 1, kW: 1000 } };
/** Legacy assign units: weight g, volume 250 ml, integer power kW (assign.cpp:371–386). */
export function parseQuantity(value: unknown, unit: 'g' | 'ml' | 'W'): number | undefined {
  if (typeof value === 'number') {
    const converted = value * (unit === 'W' ? 1000 : unit === 'ml' ? 250 : 1);
    return Number.isSafeInteger(value) && Number.isSafeInteger(converted) ? converted : undefined;
  }
  if (typeof value !== 'string') return undefined;
  let sum = 0, end = 0; const re = /([+-]?\d+(?:\.\d+)?)\s*(mg|kg|g|ml|mL|L|l|mW|kW|W)/g; let m: RegExpExecArray | null;
  while ((m = re.exec(value))) { if (value.slice(end, m.index).trim()) return undefined; const factor = unitTables[unit]?.[m[2] === 'mL' ? 'ml' : m[2]!]; if (factor === undefined) return undefined; sum += Number(m[1]) * factor; end = re.lastIndex; }
  return end && !value.slice(end).trim() && Number.isFinite(sum) ? sum : undefined;
}
const metric = (unit: string): Metric => ({ known: 0, missing: 0, complete: true, unit });
const add = (m: Metric, n: number | undefined) => { if (n === undefined) { m.missing++; m.complete = false; } else m.known += n; };
export function nestedItems(item: ItemInstance): { items: ItemInstance[]; unsupported: boolean } {
  if (item.contents === undefined || item.contents === null) return { items: [], unsupported: false };
  if (!record(item.contents) || !Array.isArray(item.contents.contents)) return { items: [], unsupported: true };
  const items: ItemInstance[] = []; let unsupported = Array.isArray(item.contents.additional_pockets) && item.contents.additional_pockets.length > 0;
  for (const pocket of item.contents.contents) {
    if (!record(pocket) || !Array.isArray(pocket.contents)) { unsupported = true; continue; }
    for (const child of pocket.contents) { if (record(child) && typeof child.typeid === 'string') items.push(child); else unsupported = true; }
  }
  return { items, unsupported };
}
const hasSubtype = (d: Definition, type: string) => d.type === type || (Array.isArray(d.subtypes) && d.subtypes.includes(type));
// itype.h:1602: stackable || ammo || non-solid comestible. stack_size affects volume, NOT weight.
const chargeFields = ['stackable', 'count_by_charges', 'subtypes', 'type', 'phase'] as const;
const weightFields = ['weight', 'flags', ...chargeFields, 'linkage'] as const;
const volumeFields = ['volume', 'flags', 'pocket_data', ...chargeFields] as const;
const chargeCounted = (d: Definition) => d.stackable === true || d.count_by_charges === true || hasSubtype(d, 'AMMO') || (hasSubtype(d, 'COMESTIBLE') && typeof d.phase === 'string' && d.phase !== 'solid' && d.phase !== 'SOLID');
function ownWeight(item: ItemInstance, indexes: VehicleIndexes): number | undefined {
  const d = indexes.items.get(item.typeid ?? ''); if (!d || !definitionFieldsReliable(d, weightFields)) return undefined;
  let weight = parseQuantity(d.weight, 'g'); if (weight === undefined) return undefined;
  const allFlags = [...flags(d), ...(Array.isArray(item.item_tags) ? item.item_tags.filter((f): f is string => typeof f === 'string') : [])];
  if (allFlags.includes('NO_DROP')) return 0;
  if (chargeCounted(d)) {
    if (typeof item.charges !== 'number' || !Number.isSafeInteger(item.charges) || item.charges < 0) return undefined;
    weight *= item.charges;
  }
  if (allFlags.includes('REDUCED_WEIGHT')) weight *= .75;
  const hasWeightOverride = record(item.item_vars) && ('weight' in item.item_vars || 'integral_weight' in item.item_vars);
  const gunMods = hasSubtype(d, 'GUN') && record(item.contents) && Array.isArray(item.contents.contents) && item.contents.contents.some(p => record(p) && p.pocket_type === 3 && Array.isArray(p.contents) && p.contents.length > 0);
  if (item.corpse || item.craft_data || hasWeightOverride || gunMods || d.linkage) return undefined;
  return weight;
}
function nestedWeightReliable(item: ItemInstance, indexes: VehicleIndexes): boolean {
  const d = indexes.items.get(item.typeid ?? '');
  if (!definitionFieldsReliable(d, ['pocket_data'])) return false;
  if (Array.isArray(d?.pocket_data) && d.pocket_data.some(p => record(p) && p.weight_multiplier !== undefined && p.weight_multiplier !== 1)) return false;
  // MOD pockets use integral weights and gun-specific modifiers, not ordinary item weight.
  return !(record(item.contents) && Array.isArray(item.contents.contents) && item.contents.contents.some(p => record(p) && p.pocket_type === 3 && Array.isArray(p.contents) && p.contents.length));
}
function itemWeight(item: ItemInstance, indexes: VehicleIndexes, m: Metric, depth = 0): void {
  if (depth > 64) { add(m, undefined); return; }
  add(m, ownWeight(item, indexes)); const nested = nestedItems(item); if (nested.unsupported) add(m, undefined);
  if (nested.items.length && !nestedWeightReliable(item, indexes)) { add(m, undefined); return; }
  for (const child of nested.items) itemWeight(child, indexes, m, depth + 1);
}
export interface VehicleStats {
  partCount: number; bounds: { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number };
  emptyWeight: Metric; payloadWeight: Metric; totalWeight: Metric; cargoCapacity: Metric; cargoUsed: Metric;
  durability: Metric; maxDurability: Metric; ratedPower: Metric; ratedHorsepower: Metric;
  currentPower: { value: null; reason: string }; issues: Issue[];
  resources: { partIndex: number; itemId: string; charges: number | null }[];
}
export function calculateStats(vehicle: VehicleModel, indexes: VehicleIndexes): VehicleStats {
  const emptyWeight = metric('g'), payloadWeight = metric('g'), cargoCapacity = metric('ml'), cargoUsed = metric('ml'), durability = metric('hp'), maxDurability = metric('hp'), ratedPower = metric('W'), issues: Issue[] = [], resources: VehicleStats['resources'] = [];
  const xs = vehicle.parts.map(p => p.mount_dx), ys = vehicle.parts.map(p => p.mount_dy);
  vehicle.parts.forEach((p, i) => {
    const d = indexes.parts.get(p.id);
    if (!definitionFieldsReliable(d, ['item', 'durability', 'flags', 'size', 'power', 'fuel_type'])) issues.push(issue(d ? 'incomplete-part-stats' : 'unknown-part-stats', `Unknown/incomplete ${p.id}: affected statistics are incomplete.`, i));
    const base = p.base ?? (definitionFieldsReliable(d, ['item']) && typeof d?.item === 'string' ? { typeid: d.item } : undefined);
    const inspectItem = (it: ItemInstance, depth = 0) => {
      if (depth > 64) return;
      const itemDef = indexes.items.get(it.typeid ?? '');
      if (!definitionFieldsReliable(itemDef, [...weightFields, ...volumeFields])) issues.push(issue(itemDef ? 'incomplete-item-stats' : 'unknown-item-stats', `Item ${it.typeid ?? '(missing id)'} is unknown/incomplete; its weight, volume and damage semantics are not trusted.`, i));
      nestedItems(it).items.forEach(child => inspectItem(child, depth + 1));
    };
    if (base) inspectItem(base);
    [...p.items ?? [], ...p.tools ?? []].forEach(it => inspectItem(it));
    if (base) { add(emptyWeight, ownWeight(base, indexes)); const n = nestedItems(base); if (n.unsupported) add(payloadWeight, undefined); if (n.items.length && !nestedWeightReliable(base, indexes)) { add(payloadWeight, undefined); issues.push(issue('unverified-pocket-weight', 'Unknown pocket definitions, pocket weight multipliers or MOD integral weights prevent computing contents mass.', i)); } else n.items.forEach(it => itemWeight(it, indexes, payloadWeight)); }
    else add(emptyWeight, undefined);
    for (const it of [...p.items ?? [], ...p.tools ?? []]) itemWeight(it, indexes, payloadWeight);
    const max = definitionFieldsReliable(d, ['durability']) && typeof d?.durability === 'number' ? d.durability : undefined;
    add(maxDurability, max);
    const itemDef = indexes.items.get(base?.typeid ?? '');
    const maxDamage = itemDef && definitionFieldsReliable(itemDef, chargeFields) ? (chargeCounted(itemDef) ? 0 : 4000) : undefined;
    const damage = base?.damaged ?? 0;
    add(durability, max === undefined || maxDamage === undefined || typeof damage !== 'number' ? undefined : maxDamage === 0 ? max : Math.trunc(max - max * damage / maxDamage));
    const reliableFlags = definitionFieldsReliable(d, ['flags']);
    if (!reliableFlags) { add(cargoCapacity, undefined); add(ratedPower, undefined); }
    else {
      if (flags(d).includes('CARGO')) add(cargoCapacity, definitionFieldsReliable(d, ['size']) ? parseQuantity(d?.size, 'ml') : undefined);
      if (flags(d).includes('ENGINE')) {
        const conditional = ['muscle', 'animal', 'wind'].includes(String(d?.fuel_type));
        add(ratedPower, conditional || !definitionFieldsReliable(d, ['power', 'fuel_type']) ? undefined : parseQuantity(d?.power, 'W'));
        if (conditional) issues.push(issue('conditional-power', 'Muscle, animal or wind power depends on external state.', i));
      }
    }
    for (const item of p.items ?? []) {
      const it = indexes.items.get(item.typeid ?? ''); const nested = nestedItems(item);
      // Contents, charge stacks and soft/variable containers need item::volume rules.
      add(cargoUsed, it && definitionFieldsReliable(it, volumeFields) && !chargeCounted(it) && !nested.unsupported && !nested.items.length ? parseQuantity(it.volume, 'ml') : undefined);
    }
    if (base) { const walk = (it: ItemInstance, depth = 0) => { if (depth > 64) return; if (typeof it.charges === 'number') resources.push({ partIndex: i, itemId: it.typeid ?? 'unknown', charges: it.charges }); nestedItems(it).items.forEach(c => walk(c, depth + 1)); }; walk(base); }
  });
  const totalWeight = { known: emptyWeight.known + payloadWeight.known, missing: emptyWeight.missing + payloadWeight.missing, complete: emptyWeight.complete && payloadWeight.complete, unit: 'g' };
  const bounds = xs.length ? { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 } : { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  return { partCount: vehicle.parts.length, bounds, emptyWeight, payloadWeight, totalWeight, cargoCapacity, cargoUsed, durability, maxDurability, ratedPower, ratedHorsepower: { ...ratedPower, known: ratedPower.known / 745.6998715822702, unit: 'hp' }, currentPower: { value: null, reason: 'Not implemented: enabled/fueled engines, damage factors, faults, alternator load and multi-engine reduction require additional verified state; rated sum is not actual power.' }, issues, resources };
}
