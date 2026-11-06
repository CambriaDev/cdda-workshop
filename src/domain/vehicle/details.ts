import { definitionFieldsReliable, flags, record, type Definition, type VehicleIndexes } from './types';
import { parseQuantity } from './stats';

export type DetailPrimitive = string | number | boolean | null;
export type PartDetailStatus = 'known' | 'unknown' | 'default';
export interface PartDetailField {
  id: string; value: DetailPrimitive; unit?: string; status: PartDetailStatus;
  source: 'part' | 'base_item' | 'derived'; notes: string[]; reference?: string;
}
export interface PartDetailSection { id: 'basic' | 'power' | 'capacity' | 'qualities' | 'wheel' | 'protection'; fields: PartDetailField[] }
export interface PartQualityDetail {
  id: string; level: number | null; source: 'part' | 'base_item'; status: PartDetailStatus;
  name?: unknown; liftingKg?: number;
}
export interface PartDetails {
  partId: string; baseItemId: string | null; sections: PartDetailSection[]; flags: string[];
  notes: string[]; qualities: PartQualityDetail[]; pseudoTools: string[];
  pseudoToolDetails?: { id: string; qualities: { id: string; level: number | null; status: PartDetailStatus; charged?: boolean }[]; notes: string[] }[];
  connectableTools?: string[];
  advanced: { part: Readonly<Definition> | null; baseItem: Readonly<Definition> | null };
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown): string | undefined => typeof v === 'string' ? v : record(v) && typeof v.str === 'string' ? v.str : undefined;
const primitive = (v: unknown): DetailPrimitive | undefined => typeof v === 'string' || typeof v === 'boolean' || finite(v) ? v : undefined;
const get = (d: Definition | undefined, path: string): unknown => path.split('.').reduce<unknown>((v, k) => Array.isArray(v) ? k === 'length' ? v.length : /^\d+$/.test(k) ? v[Number(k)] : undefined : record(v) ? v[k] : undefined, d);
const HP_W = 745.6998715822702;

/** Definition-only nominal capabilities, never live/summed vehicle performance.
 * Source: veh_type.h:413-455; veh_type.cpp:272-405,1079; item.h:3446;
 * item_pocket.cpp:139-200,1379; itype.h:691; veh_interact.cpp:780.
 * No resolved definition, index, or input array is modified.
 */
export function describePart(partId: string, indexes: VehicleIndexes): PartDetails {
  const part = indexes.parts.get(partId);
  const itemId = definitionFieldsReliable(part, ['item']) && typeof part?.item === 'string' ? part.item : null;
  const item = itemId ? indexes.items.get(itemId) : undefined;
  const reliableFlags = definitionFieldsReliable(part, ['flags']) && (part?.flags === undefined || (Array.isArray(part.flags) && part.flags.every(f => typeof f === 'string')));
  const result: PartDetails = { partId, baseItemId: itemId, sections: [], flags: reliableFlags ? [...flags(part)] : [], notes: [], qualities: [], pseudoTools: [], advanced: { part: part ?? null, baseItem: item ?? null } };
  if (!part) result.notes.push('definition_missing');
  if (!reliableFlags) result.notes.push('field_unreliable');
  const section = (id: PartDetailSection['id']) => { const s: PartDetailSection = { id, fields: [] }; result.sections.push(s); return s.fields; };
  function field(rows: PartDetailField[], id: string, d: Definition | undefined, path: string, source: PartDetailField['source'], options: { unit?: string; parse?: (v: unknown) => DetailPrimitive | undefined; fallback?: DetailPrimitive; notes?: string[]; reference?: string } = {}): PartDetailField {
    const row: PartDetailField = { id, value: null, status: 'unknown', source, notes: [...options.notes ?? []], ...(options.unit ? { unit: options.unit } : {}), reference: options.reference ?? path };
    if (!definitionFieldsReliable(d, [path])) row.notes.push(d ? 'field_unreliable' : 'definition_missing');
    else {
      const raw = get(d, path);
      if (raw === undefined) {
        if (options.fallback !== undefined) { row.value = options.fallback; row.status = 'default'; row.notes.push('source_default'); }
        else row.notes.push('field_absent');
      } else {
        const value = (options.parse ?? primitive)(raw);
        if (value === undefined) row.notes.push('invalid_value');
        else { row.value = value; row.status = 'known'; }
      }
    }
    rows.push(row); return row;
  }
  const basic = section('basic');
  basic.push({ id: 'part_id', value: partId, status: 'known', source: 'part', notes: [] });
  field(basic, 'base_item_id', part, 'item', 'part', { parse: v => typeof v === 'string' ? v : undefined });
  field(basic, 'source', part, '_source', 'part', { parse: text });
  field(basic, 'base_item_source', item, '_source', 'base_item', { parse: text });
  field(basic, 'description', part, 'description', 'part', { parse: text });
  field(basic, 'base_description', item, 'description', 'base_item', { parse: text });
  field(basic, 'location', part, 'location', 'part', { parse: text });
  const quantity = (unit: 'g' | 'ml' | 'W', nonnegative = true) => (v: unknown) => { const n = parseQuantity(v, unit); return n !== undefined && Number.isFinite(n) && (!nonnegative || n >= 0) ? n : undefined; };
  const nonnegative = (v: unknown) => finite(v) && v >= 0 ? v : undefined;
  const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : undefined;
  const signedInteger = (v: unknown) => Number.isSafeInteger(v) ? v as number : undefined;
  for (const [id, unit] of [['weight', 'g'], ['volume', 'ml']] as const) {
    const row = field(basic, id, item, id, 'base_item', { unit, parse: quantity(unit), notes: ['empty_base_item'] });
    if (item && (item.stackable === true || item.count_by_charges === true || item.type === 'AMMO' || (Array.isArray(item.subtypes) && item.subtypes.includes('AMMO')) || ((item.type === 'COMESTIBLE' || (Array.isArray(item.subtypes) && item.subtypes.includes('COMESTIBLE'))) && typeof item.phase === 'string' && item.phase.toLowerCase() !== 'solid'))) { row.notes.push('per_charge_base_item'); row.value = null; row.status = 'unknown'; }
    // Flags such as REDUCED_WEIGHT and variable/charge quantities require item runtime rules.
    if (!definitionFieldsReliable(item, ['flags', 'type', 'subtypes', 'stackable', 'count_by_charges', 'phase'])) { row.value = null; row.status = 'unknown'; row.notes.push('field_unreliable'); }
    if (id === 'weight' && flags(item).includes('REDUCED_WEIGHT') && typeof row.value === 'number') row.value *= .75;
    if (id === 'weight' && flags(item).includes('NO_DROP') && row.status !== 'unknown') row.value = 0;
  }
  field(basic, 'durability', part, 'durability', 'part', { parse: integer, fallback: 0 });
  field(basic, 'folded_volume', part, 'folded_volume', 'part', { unit: 'ml', parse: quantity('ml') });
  const relevantPower = !part || !reliableFlags || result.flags.some(f => ['ENGINE', 'ALTERNATOR', 'SOLAR_PANEL', 'WIND_TURBINE', 'WATER_WHEEL', 'REACTOR', 'ENABLED_DRAINS_EPOWER'].includes(f)) || ['power', 'epower', 'energy_consumption'].some(k => part[k] !== undefined);
  const power = relevantPower ? section('power') : [];
  const split = (path: string, positiveId: string, negativeId: string, notes: string[]) => {
    const source = field([], path, part, path, 'part', { unit: 'W', parse: quantity('W', false), fallback: 0, notes });
    for (const [id, sign] of [[positiveId, 1], [negativeId, -1]] as const) {
      const row: PartDetailField = { ...source, id, notes: [...source.notes], value: typeof source.value === 'number' ? Math.max(0, source.value * sign) : null };
      power.push(row);
      if (path === 'power') power.push({ ...row, id: `${id}_hp`, value: typeof row.value === 'number' ? row.value / HP_W : null, unit: 'hp', source: 'derived', notes: [...row.notes] });
    }
  };
  split('power', 'mechanical_output', 'mechanical_load', ['rated_not_actual']);
  split('epower', 'generation', 'fixed_consumption', ['operating_conditions']);
  const conditional = definitionFieldsReliable(part, ['fuel_type']) && ['muscle', 'animal', 'wind'].includes(String(part?.fuel_type));
  if (conditional) power.filter(f => f.id.startsWith('mechanical_')).forEach(f => f.notes.push('conditional_power'));
  if (result.flags.includes('ENGINE') || part?.energy_consumption !== undefined) {
    const fuel = definitionFieldsReliable(part, ['fuel_type']) && typeof part?.fuel_type === 'string' ? part.fuel_type : undefined;
    field(power, 'full_load_consumption', part, 'energy_consumption', 'part', { unit: 'W', parse: quantity('W'), fallback: 0, notes: ['rated_not_actual', fuel === 'battery' ? 'full_load_electric' : conditional ? 'conditional_power' : fuel ? 'full_load_fuel' : 'fuel_unknown'] });
  }
  field(power, 'fuel_type', part, 'fuel_type', 'part', { parse: text });
  if (part?.fuel_options !== undefined) field(power, 'fuel_options', part, 'fuel_options', 'part', { parse: v => Array.isArray(v) && v.every(f => typeof f === 'string') ? v.join(', ') : undefined });
  const capacity = section('capacity');
  if (result.flags.includes('CARGO') || !reliableFlags) {
    const row = field(capacity, 'cargo_capacity', part, 'size', 'part', { unit: 'ml', parse: quantity('ml'), notes: ['nominal_capacity'] });
    if (!reliableFlags) { row.value = null; row.status = 'unknown'; row.notes.push('field_unreliable'); }
  }
  const pockets = item?.pocket_data;
  if (pockets !== undefined || result.flags.some(f => ['FLUIDTANK', 'BATTERY', 'TURRET'].includes(f))) {
    const pocketField = field(capacity, 'pocket_count', item, 'pocket_data.length', 'base_item', { parse: nonnegative, reference: 'pocket_data' });
    if (pocketField.status === 'unknown' || !Array.isArray(pockets)) {
      capacity.push({ id: result.flags.includes('BATTERY') ? 'battery_capacity' : 'container_capacity', value: null, unit: result.flags.includes('BATTERY') ? 'charges' : 'ml', status: 'unknown', source: 'base_item', notes: ['field_unreliable'], reference: 'pocket_data' });
    } else for (let i = 0; i < pockets.length; i++) {
      const pocket: unknown = pockets[i]; const reference = `pocket_data[${i}]`;
      const suffix = pockets.length > 1 ? `_${i}` : '';
      const rowId = (id: string) => `${id}${suffix}`;
      if (!record(pocket)) { capacity.push({ id: rowId('container_capacity'), value: null, unit: 'ml', status: 'unknown', source: 'base_item', notes: ['unsupported_pocket'], reference }); continue; }
      const restrictions = ['item_restriction', 'flag_restriction', 'material_restriction', 'holster', 'max_item_length', 'min_item_volume', 'max_item_volume'].some(k => pocket[k] !== undefined && pocket[k] !== false);
      const notes = ['nominal_capacity', ...(restrictions ? ['restricted_pocket'] : []), ...(pockets.length > 1 ? ['multiple_pockets'] : [])];
      const pocketNumber = (id: string, key: string, unit: string, parse: (v: unknown) => DetailPrimitive | undefined) => field(capacity, rowId(id), item, `pocket_data.${i}.${key}`, 'base_item', { unit, parse, notes, reference });
      if (!definitionFieldsReliable(item, [`pocket_data.${i}.pocket_type`, `pocket_data.${i}.ammo_restriction`])) {
        capacity.push({ id: rowId('container_capacity'), value: null, status: 'unknown', source: 'base_item', notes: ['field_unreliable'], reference });
      } else if (record(pocket.ammo_restriction) && ['MAGAZINE', 'CONTAINER'].includes(String(pocket.pocket_type ?? 'CONTAINER'))) {
        const ammo = Object.entries(pocket.ammo_restriction);
        const single = ammo.length === 1 && Number.isSafeInteger(ammo[0]![1]) && (ammo[0]![1] as number) >= 0;
        const battery = single && ammo[0]![0] === 'battery';
        const row = pocketNumber(battery ? 'battery_capacity' : 'ammo_capacity', 'ammo_restriction', 'charges', () => single ? ammo[0]![1] as number : undefined);
        row.reference = single ? ammo[0]![0] : reference;
        if (!single) row.notes.push('alternative_ammo');
      } else if (pocket.pocket_type === 'CONTAINER' || pocket.pocket_type === undefined) {
        pocketNumber('container_capacity', 'max_contains_volume', 'ml', quantity('ml'));
        if (pocket.max_contains_weight !== undefined) pocketNumber('container_weight_capacity', 'max_contains_weight', 'g', quantity('g'));
        for (const key of ['watertight', 'airtight', 'rigid'] as const) field(capacity, rowId(`container_${key}`), item, `pocket_data.${i}.${key}`, 'base_item', { parse: v => typeof v === 'boolean' ? v : undefined, fallback: false, reference });
      } else capacity.push({ id: rowId('container_capacity'), value: null, unit: 'ml', status: 'unknown', source: 'base_item', notes: ['unsupported_pocket'], reference });
    }
  }
  const qualities = section('qualities');
  for (const [d, source, id] of [[part, 'part', 'part_qualities'], [item, 'base_item', 'base_item_qualities']] as const) {
    const row = field(qualities, id, d, 'qualities', source, { parse: v => Array.isArray(v) && v.every(q => Array.isArray(q) && typeof q[0] === 'string' && Number.isSafeInteger(q[1]) && q[1] >= 0) ? v.length : undefined, fallback: 0, notes: [source === 'part' ? 'installed_quality' : 'base_item_quality'] });
    if (row.status !== 'unknown' && Array.isArray(d?.qualities)) {
      for (const q of d.qualities as [string, number][]) {
        const quality: PartQualityDetail = { id: q[0], level: q[1], source, status: 'known' };
        const name = indexes.toolQualities?.get(q[0])?.name; if (name !== undefined) quality.name = name;
        if (q[0] === 'JACK' || q[0] === 'LIFT') {
          quality.liftingKg = q[1] * 500;
          if (source === 'part') qualities.push({ id: q[0] === 'JACK' ? 'jack_capacity' : 'lift_capacity', value: quality.liftingKg, unit: 'kg', status: 'known', source: 'derived', notes: ['installed_quality'], reference: q[0] });
        }
        if (q[0] === 'SELF_JACK') result.notes.push('self_jack_separate');
        result.qualities.push(quality);
      }
    }
  }
  const tools = field(qualities, 'pseudo_tools', part, 'pseudo_tools', 'part', { parse: v => Array.isArray(v) && v.every(t => record(t) && typeof t.id === 'string') ? v.length : undefined, fallback: 0, notes: ['pseudo_tools_not_included'] });
  if (tools.status !== 'unknown' && Array.isArray(part?.pseudo_tools)) result.pseudoTools = part.pseudo_tools.map(t => (t as { id: string }).id);
  result.pseudoToolDetails = result.pseudoTools.map(id => {
    const tool = indexes.items.get(id);
    const details: NonNullable<PartDetails['pseudoToolDetails']>[number] = { id, qualities: [], notes: [] };
    if (!tool) details.notes.push('definition_missing');
    for (const key of ['qualities', 'charged_qualities'] as const) {
      if (!definitionFieldsReliable(tool, [key])) { details.notes.push('field_unreliable'); continue; }
      const list = tool?.[key];
      if (list === undefined) continue;
      if (!Array.isArray(list)) { details.notes.push('invalid_value'); continue; }
      for (const q of list) {
        if (!Array.isArray(q) || typeof q[0] !== 'string') { details.notes.push('invalid_value'); continue; }
        const valid = Number.isSafeInteger(q[1]) && q[1] >= 0;
        details.qualities.push({ id: q[0], level: valid ? q[1] : null, status: valid ? 'known' : 'unknown', ...(key === 'charged_qualities' ? { charged: true } : {}) });
      }
    }
    return details;
  });
  if (result.flags.includes('VEH_TOOLS')) {
    const row = field(qualities, 'connectable_tools', part, 'allowed_tools', 'part', { parse: v => Array.isArray(v) && v.every(t => typeof t === 'string') ? v.length : undefined, fallback: 0, notes: ['operating_conditions'] });
    result.connectableTools = row.status !== 'unknown' && Array.isArray(part?.allowed_tools) ? [...part.allowed_tools] as string[] : [];
  }
  if (result.flags.includes('SELF_JACK')) result.notes.push('self_jack_separate');
  if (result.flags.includes('WHEEL')) {
    const wheel = section('wheel');
    for (const key of ['diameter', 'width']) field(wheel, `wheel_${key}`, item, key, 'base_item', { unit: 'in', parse: integer });
    for (const [id, key, fallback] of [['wheel_rolling_resistance', 'rolling_resistance', 1], ['wheel_contact_area', 'contact_area', 1], ['wheel_offroad_rating', 'wheel_offroad_rating', .5]] as const) field(wheel, id, part, key, 'part', { parse: key === 'contact_area' ? integer : nonnegative, fallback });
  }
  const protection = section('protection');
  field(protection, 'collision_damage_modifier', part, 'damage_modifier', 'part', { unit: '%', parse: integer, fallback: 100, notes: ['collision_outgoing_percent'] });
  if (record(part?.damage_reduction)) for (const key of Object.keys(part.damage_reduction)) field(protection, `damage_reduction_${key}`, part, `damage_reduction.${key}`, 'part', { parse: nonnegative, notes: ['flat_damage_reduction'], reference: key });
  if (!definitionFieldsReliable(part, ['damage_reduction']) && !record(part?.damage_reduction)) field(protection, 'damage_reduction', part, 'damage_reduction', 'part');
  field(protection, 'comfort', part, 'comfort', 'part', { parse: signedInteger, fallback: 0, notes: ['comfort_sleeping'] });
  field(protection, 'bonus', part, 'bonus', 'part', { parse: signedInteger, fallback: 0, notes: ['bonus_contextual'], reference: result.flags.join(',') });
  // These are context-specific readings of bonus, never a generic efficiency/armor score.
  for (const [flag, id, unit] of [['MUFFLER', 'muffler_noise_reduction', '%'], ['HORN', 'horn_volume', ''], ['RECHARGE', 'recharge_power', 'W'], ['FUNNEL', 'funnel_radius', 'mm'], ['SHOCK_ABSORBER', 'shock_absorption', '']] as const) if (result.flags.includes(flag)) field(protection, id, part, 'bonus', 'part', { parse: signedInteger, fallback: 0, unit: unit || undefined, notes: ['bonus_contextual', 'operating_conditions'], reference: flag });
  if (result.flags.some(f => ['CONE_LIGHT', 'WIDE_CONE_LIGHT', 'HALF_CIRCLE_LIGHT', 'CIRCLE_LIGHT'].includes(f))) field(protection, 'light_intensity', part, 'bonus', 'part', { parse: signedInteger, fallback: 0, notes: ['bonus_contextual'], reference: 'LIGHT' });
  if (result.flags.includes('ROTOR')) {
    const diameter = field(protection, 'rotor_diameter', part, 'rotor_diameter', 'part', { parse: integer, fallback: 1, unit: 'm', notes: ['operating_conditions'] });
    const bonus = field(protection, 'rotor_diameter_bonus', part, 'bonus', 'part', { parse: signedInteger, fallback: 0, unit: 'm', notes: ['bonus_contextual'] });
    const sum = typeof diameter.value === 'number' && typeof bonus.value === 'number' ? diameter.value + bonus.value : null;
    const value = sum !== null && Number.isFinite(sum) && sum > 0 ? sum : null;
    protection.push({ id: 'rotor_effective_diameter', value, status: value === null ? 'unknown' : diameter.status === 'default' || bonus.status === 'default' ? 'default' : 'known', source: 'derived', unit: 'm', notes: ['operating_conditions', ...diameter.notes, ...bonus.notes, ...(sum !== null && value === null ? ['invalid_value'] : [])], reference: 'rotor_diameter+bonus' });
  }
  for (const [key, fallback] of [['floor_bedding_warmth', 0], ['bonus_fire_warmth_feet', .6]] as const) if (part?.[key] !== undefined) field(protection, key, part, key, 'part', { parse: v => finite(v) ? v * .002 : undefined, fallback, unit: '°C Δ', notes: ['comfort_sleeping'] });
  result.notes = [...new Set(result.notes)];
  for (const s of result.sections) for (const f of s.fields) f.notes = [...new Set(f.notes)];
  for (const tool of result.pseudoToolDetails ?? []) tool.notes = [...new Set(tool.notes)];
  return result;
}
