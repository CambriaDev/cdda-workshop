import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compose, type DataPackage } from '../../src/domain/data';
import { describePart, type Definition, type PartDetails, type VehicleIndexes } from '../../src/domain/vehicle';
const definition = (id: string, values: Record<string, unknown> = {}): Definition => ({ id, type: 'vehicle_part', ...values });
function setup(values: Record<string, unknown> = {}, base: Record<string, unknown> = {}): VehicleIndexes {
  return { parts: new Map([['p', definition('p', { item: 'base', ...values })]]), items: new Map([['base', definition('base', { type: 'ITEM', weight: '2 kg', volume: '1 L', ...base })]]) };
}
const rows = (d: PartDetails) => d.sections.flatMap(s => s.fields);
const row = (d: PartDetails, id: string) => { const field = rows(d).find(f => f.id === id); expect(field, `Missing field ${id}`).toBeDefined(); return field!; };
const detail = (values: Record<string, unknown> = {}, base: Record<string, unknown> = {}) => describePart('p', setup(values, base));

describe('part identity, basic quantities and conservative reliability', () => {
  it('retains a missing ID without invented zero capabilities', () => {
    const d = describePart('missing', { parts: new Map(), items: new Map() });
    expect(d.partId).toBe('missing'); expect(d.baseItemId).toBeNull(); expect(d.notes).toContain('definition_missing');
    expect(row(d, 'weight')).toMatchObject({ value: null, status: 'unknown' });
    expect(row(d, 'durability').value).toBeNull(); expect(d.advanced.part).toBeNull();
  });
  it('exposes base ID, source references, descriptions and location distinctly', () => {
    const d = detail({ _source: 'vehicleparts/test.json#0', description: { str: 'installed' }, location: 'structure' }, { _source: 'items/test.json#0', description: 'loose item' });
    expect(d.baseItemId).toBe('base'); expect(row(d, 'description').value).toBe('installed'); expect(row(d, 'base_description').value).toBe('loose item');
    expect(row(d, 'source').value).toBe('vehicleparts/test.json#0'); expect(row(d, 'base_item_source').value).toBe('items/test.json#0'); expect(row(d, 'location').value).toBe('structure');
  });
  it('normalizes legacy and explicit mass/volume and folded volume', () => {
    const d = detail({ durability: 400, folded_volume: 2 }, { weight: '1 kg 250 g', volume: 4 });
    expect(row(d, 'weight')).toMatchObject({ value: 1250, unit: 'g', status: 'known' });
    expect(row(d, 'volume')).toMatchObject({ value: 1000, unit: 'ml' }); expect(row(d, 'folded_volume').value).toBe(500); expect(row(d, 'durability').value).toBe(400);
  });
  it('marks source-backed defaults, distinguishes missing quantities from zero', () => {
    const d = detail({}, { weight: undefined });
    expect(row(d, 'durability')).toMatchObject({ value: 0, status: 'default' });
    expect(row(d, 'collision_damage_modifier')).toMatchObject({ value: 100, status: 'default' });
    expect(row(d, 'weight')).toMatchObject({ value: null, status: 'unknown' });
    expect(row(d, 'folded_volume')).toMatchObject({ value: null, status: 'unknown' });
  });
  it('does not flood a plain frame with inapplicable zero power rows', () => {
    expect(detail({ flags: ['STRUCTURE'] }).sections.some(s => s.id === 'power')).toBe(false);
  });
  it('does not confuse charge-counted stack definitions with one empty installed base', () => {
    for (const base of [{ type: 'AMMO' }, { subtypes: ['AMMO'] }, { stackable: true }, { type: 'COMESTIBLE', phase: 'liquid' }]) {
      const d = detail({}, base); expect(row(d, 'weight')).toMatchObject({ value: null, status: 'unknown' }); expect(row(d, 'weight').notes).toContain('per_charge_base_item');
    }
  });
  it('applies verified intrinsic base weight flags only when reliable', () => {
    expect(row(detail({}, { flags: ['REDUCED_WEIGHT'] }), 'weight').value).toBe(1500);
    expect(row(detail({}, { flags: ['NO_DROP'] }), 'weight').value).toBe(0);
    expect(row(detail({}, { flags: ['NO_DROP'], _incomplete: true, _incompleteFields: ['flags'] }), 'weight').value).toBeNull();
  });
  it('preserves trusted fields when unrelated semantics are incomplete', () => {
    const d = detail({ power: '3 kW', _incomplete: true, _incompleteFields: ['requirements.install'] }, { _incomplete: true, _incompleteFields: ['use_action'] });
    expect(row(d, 'weight').value).toBe(2000); expect(row(d, 'mechanical_output').value).toBe(3000);
  });
  it('suppresses precisely untrusted fields and old globally-incomplete definitions', () => {
    const d = detail({ power: '3 kW', _incomplete: true, _incompleteFields: ['power'] }, { weight: '2 kg', _incomplete: true });
    expect(row(d, 'mechanical_output')).toMatchObject({ value: null, status: 'unknown' }); expect(row(d, 'weight').value).toBeNull();
    expect(row(detail({ _incomplete: true, _incompleteFields: ['item'] }), 'weight').value).toBeNull();
  });
  it.each([NaN, Infinity, -5, 'bogus', '2 kg garbage'])('rejects invalid mass %s rather than reporting zero', weight => {
    expect(row(detail({}, { weight }), 'weight')).toMatchObject({ value: null, status: 'unknown' });
  });
});

describe('signed power, engine full-load demand and conditions', () => {
  it('separates alternator mechanical load, electric generation, and hp', () => {
    const d = detail({ flags: ['ALTERNATOR'], power: '-1492 W', epower: '780 W' });
    expect(row(d, 'mechanical_output').value).toBe(0); expect(row(d, 'mechanical_load').value).toBe(1492);
    expect(row(d, 'mechanical_load_hp').value).toBeCloseTo(1492 / 745.6998715822702, 8);
    expect(row(d, 'generation').value).toBe(780); expect(row(d, 'fixed_consumption').value).toBe(0);
    expect(row(d, 'generation').notes).toContain('operating_conditions');
  });
  it('does not mistake electric full-load consumption for fixed epower drain', () => {
    const d = detail({ flags: ['ENGINE'], power: '7040 W', energy_consumption: '8 kW', fuel_type: 'battery' });
    expect(row(d, 'full_load_consumption')).toMatchObject({ value: 8000, unit: 'W' });
    expect(row(d, 'full_load_consumption').notes).toContain('full_load_electric');
    expect(row(d, 'fixed_consumption')).toMatchObject({ value: 0, status: 'default' });
    expect(row(d, 'mechanical_output').notes).toContain('rated_not_actual');
  });
  it('keeps fuel energy, mechanical output and fixed electrical demand separate', () => {
    const d = detail({ flags: ['ENGINE'], power: '50 kW', energy_consumption: '150 kW', epower: '-60 W', fuel_type: 'gasoline', fuel_options: ['gasoline', 'ethanol'] });
    expect(row(d, 'mechanical_output').value).toBe(50000); expect(row(d, 'full_load_consumption').value).toBe(150000); expect(row(d, 'fixed_consumption').value).toBe(60);
    expect(row(d, 'full_load_consumption').notes).toContain('full_load_fuel'); expect(row(d, 'fuel_options').value).toBe('gasoline, ethanol');
  });
  it('does not classify consumption as electrical if fuel type is uncertain', () => {
    const d = detail({ flags: ['ENGINE'], energy_consumption: '8 kW', fuel_type: 'battery', _incompleteFields: ['fuel_type'] });
    expect(row(d, 'full_load_consumption').value).toBe(8000); expect(row(d, 'full_load_consumption').notes).toContain('fuel_unknown');
  });
  it('interprets bare integer power in legacy kW, not watts', () => {
    const d = detail({ power: -1, epower: -1, energy_consumption: 8, fuel_type: 'battery' });
    expect(row(d, 'mechanical_load').value).toBe(1000); expect(row(d, 'fixed_consumption').value).toBe(1000); expect(row(d, 'full_load_consumption').value).toBe(8000);
  });
  it('rejects fractional bare numeric power instead of silently treating it as W', () => {
    const d = detail({ power: 1.5, epower: -.5 }); expect(row(d, 'mechanical_output').value).toBeNull(); expect(row(d, 'fixed_consumption').value).toBeNull();
  });
  it('normalizes source milliwatts without mistaking them for mechanical horsepower', () => {
    expect(row(detail({ epower: '250 mW' }), 'generation').value).toBe(.25);
  });
  it('keeps exact explicit zero known and rejects nonfinite signed power', () => {
    expect(row(detail({ epower: 0 }), 'generation').status).toBe('known');
    expect(row(detail({ power: Infinity }), 'mechanical_load')).toMatchObject({ value: null, status: 'unknown' });
  });
  it('marks muscle/wind/animal power as conditional rather than actual operating output', () => {
    for (const fuel_type of ['muscle', 'wind', 'animal']) expect(row(detail({ flags: ['ENGINE'], power: '1 kW', fuel_type }), 'mechanical_output').notes).toContain('conditional_power');
  });
});

describe('cargo, nominal container capacities and ammo charge storage', () => {
  it('keeps installed cargo separate from the base item container and outside volume', () => {
    const d = detail({ flags: ['CARGO'], size: '60 L' }, { volume: '1 L', pocket_data: [{ pocket_type: 'CONTAINER', max_contains_volume: '5 L', max_contains_weight: '20 kg', watertight: true }] });
    expect(row(d, 'cargo_capacity').value).toBe(60000); expect(row(d, 'container_capacity').value).toBe(5000); expect(row(d, 'volume').value).toBe(1000);
    expect(row(d, 'container_weight_capacity').value).toBe(20000); expect(row(d, 'container_watertight').value).toBe(true);
    expect(row(d, 'container_rigid')).toMatchObject({ value: false, status: 'default' });
  });
  it('does not infer cargo from base item volume, pockets or an unreliable CARGO flag', () => {
    expect(rows(detail({}, { pocket_data: [{ pocket_type: 'CONTAINER', max_contains_volume: '5 L' }] })).some(f => f.id === 'cargo_capacity')).toBe(false);
    expect(row(detail({ flags: ['CARGO'], size: '60 L', _incompleteFields: ['flags'] }), 'cargo_capacity').value).toBeNull();
  });
  it('reports restricted pocket volume only as nominal, not freely usable cargo', () => {
    const d = detail({}, { pocket_data: [{ pocket_type: 'CONTAINER', max_contains_volume: '2 L', item_restriction: ['water'], holster: true }] });
    expect(row(d, 'container_capacity').value).toBe(2000); expect(row(d, 'container_capacity').notes).toEqual(expect.arrayContaining(['nominal_capacity', 'restricted_pocket']));
  });
  it('describes multiple pockets individually without summing incompatible storage', () => {
    const d = detail({}, { pocket_data: [{ pocket_type: 'CONTAINER', max_contains_volume: '2 L' }, { pocket_type: 'MAGAZINE', ammo_restriction: { battery: 100 } }] });
    expect(row(d, 'pocket_count').value).toBe(2); expect(row(d, 'container_capacity_0').value).toBe(2000); expect(row(d, 'battery_capacity_1').value).toBe(100);
    expect(rows(d).some(f => f.id === 'container_capacity')).toBe(false); expect(row(d, 'container_capacity_0').reference).toBe('pocket_data[0]');
  });
  it('does not convert battery charges into unverified Wh or liters', () => {
    const d = detail({ flags: ['BATTERY'] }, { pocket_data: [{ pocket_type: 'MAGAZINE', ammo_restriction: { battery: 12000 } }] });
    expect(row(d, 'battery_capacity')).toMatchObject({ value: 12000, unit: 'charges', reference: 'battery' });
  });
  it('retains ammo-type reference and does not sum alternative ammo restrictions', () => {
    const single = detail({}, { pocket_data: [{ pocket_type: 'MAGAZINE', ammo_restriction: { '9mm': 30 } }] });
    expect(row(single, 'ammo_capacity')).toMatchObject({ value: 30, reference: '9mm' });
    const alternative = detail({}, { pocket_data: [{ pocket_type: 'MAGAZINE', ammo_restriction: { '9mm': 30, '45': 20 } }] });
    expect(row(alternative, 'ammo_capacity')).toMatchObject({ value: null, status: 'unknown' }); expect(row(alternative, 'ammo_capacity').notes).toContain('alternative_ammo');
  });
  it('uses the loader default CONTAINER when pocket_type is omitted', () => {
    expect(row(detail({}, { pocket_data: [{ max_contains_volume: '2 L' }] }), 'container_capacity')).toMatchObject({ value: 2000, status: 'known' });
  });
  it('does not invent magazine-well or absent tank capacities', () => {
    expect(row(detail({}, { pocket_data: [{ pocket_type: 'MAGAZINE_WELL', item_restriction: ['mag'] }] }), 'container_capacity').value).toBeNull();
    expect(row(detail({ flags: ['FLUIDTANK'] }), 'container_capacity').value).toBeNull();
  });
  it('handles malformed and incomplete pockets conservatively while preserving trusted siblings', () => {
    expect(row(detail({}, { pocket_data: [false] }), 'container_capacity').value).toBeNull();
    expect(row(detail({}, { pocket_data: [{ pocket_type: 'CONTAINER', max_contains_volume: '2 L' }], _incompleteFields: ['pocket_data'] }), 'container_capacity').value).toBeNull();
    const d = detail({}, { pocket_data: [{ pocket_type: 'CONTAINER', max_contains_volume: '2 L' }, { pocket_type: 'CONTAINER', max_contains_volume: '3 L' }], _incompleteFields: ['pocket_data.1.max_contains_volume'] });
    expect(row(d, 'container_capacity_0').value).toBe(2000); expect(row(d, 'container_capacity_1').value).toBeNull();
  });
});

describe('installed qualities, loose item qualities and pseudo tools', () => {
  it('rates installed JACK/LIFT at 500kg per level without merging base qualities', () => {
    const indexes = setup({ qualities: [['JACK', 1], ['LIFT', 3]] }, { qualities: [['JACK', 8]] });
    indexes.toolQualities = new Map([['JACK', definition('JACK', { name: { str: 'jacking' }, type: 'tool_quality' })]]);
    const d = describePart('p', indexes);
    expect(row(d, 'jack_capacity').value).toBe(500); expect(row(d, 'lift_capacity').value).toBe(1500);
    expect(d.qualities).toContainEqual(expect.objectContaining({ id: 'JACK', level: 8, source: 'base_item' }));
    expect(d.qualities.find(q => q.source === 'part' && q.id === 'JACK')?.name).toEqual({ str: 'jacking' });
  });
  it('never reuses JACK/LIFT capacity formula for SELF_JACK', () => {
    const d = detail({ flags: ['SELF_JACK'], qualities: [['SELF_JACK', 4]] });
    expect(d.qualities[0]).not.toHaveProperty('liftingKg'); expect(d.notes).toContain('self_jack_separate'); expect(rows(d).some(f => f.id === 'self_jack_capacity')).toBe(false);
  });
  it('keeps pseudo-tool qualities and charged qualities separate from installed abilities', () => {
    const indexes = setup({ pseudo_tools: [{ id: 'welder' }] }); indexes.items.set('welder', definition('welder', { type: 'TOOL', qualities: [['HAMMER', 1]], charged_qualities: [['WELD', 2]] }));
    const d = describePart('p', indexes);
    expect(d.pseudoTools).toEqual(['welder']); expect(d.qualities).toHaveLength(0);
    expect(d.pseudoToolDetails?.[0]?.qualities).toEqual([{ id: 'HAMMER', level: 1, status: 'known' }, { id: 'WELD', level: 2, status: 'known', charged: true }]);
  });
  it('marks missing pseudo tools and untrusted quality data without inventing abilities', () => {
    const indexes = setup({ qualities: [['JACK', 1]], _incompleteFields: ['qualities'], pseudo_tools: [{ id: 'missing' }] });
    const d = describePart('p', indexes); expect(d.qualities).toEqual([]); expect(row(d, 'part_qualities').value).toBeNull(); expect(d.pseudoToolDetails?.[0]?.notes).toContain('definition_missing');
  });
  it('exposes allowed tool IDs only for source-activated VEH_TOOLS', () => {
    expect(detail({ flags: ['VEH_TOOLS'], allowed_tools: ['welder', 'soldering_iron'] }).connectableTools).toEqual(['welder', 'soldering_iron']);
    expect(detail({ allowed_tools: ['welder'] }).connectableTools).toBeUndefined();
    expect(row(detail({ flags: ['VEH_TOOLS'], allowed_tools: ['welder'], _incompleteFields: ['allowed_tools'] }), 'connectable_tools').value).toBeNull();
  });
});

describe('wheel, protection and contextual bonus semantics', () => {
  it('combines wheel item dimensions with part rolling/offroad coefficients', () => {
    const d = detail({ flags: ['WHEEL'], rolling_resistance: 1.2, wheel_offroad_rating: .8 }, { diameter: 20, width: 4 });
    expect(row(d, 'wheel_diameter')).toMatchObject({ value: 20, unit: 'in' }); expect(row(d, 'wheel_width').value).toBe(4); expect(row(d, 'wheel_rolling_resistance').value).toBe(1.2);
    expect(row(d, 'wheel_contact_area')).toMatchObject({ value: 1, status: 'default' });
  });
  it('labels collision as outgoing percent, armor as flat reduction, comfort as sleeping', () => {
    const d = detail({ damage_modifier: 150, damage_reduction: { bash: 8, cut: 12 }, comfort: -3, bonus: 20 });
    expect(row(d, 'collision_damage_modifier')).toMatchObject({ value: 150, unit: '%' }); expect(row(d, 'collision_damage_modifier').notes).toContain('collision_outgoing_percent');
    expect(row(d, 'damage_reduction_bash').notes).toContain('flat_damage_reduction'); expect(row(d, 'comfort').value).toBe(-3); expect(row(d, 'comfort').notes).toContain('comfort_sleeping'); expect(row(d, 'bonus').notes).toContain('bonus_contextual');
  });
  it('rejects fractions in source integer fields without rejecting wheel floating coefficients', () => {
    const d = detail({ flags: ['WHEEL'], durability: 2.5, contact_area: 1.5, rolling_resistance: 1.2, comfort: .5, bonus: 1.5 }, { diameter: 20.5, width: 4.5 });
    for (const id of ['durability', 'wheel_contact_area', 'wheel_diameter', 'wheel_width', 'comfort', 'bonus']) expect(row(d, id)).toMatchObject({ value: null, status: 'unknown' });
    expect(row(d, 'wheel_rolling_resistance').value).toBe(1.2);
  });
  it('uses verified rotor defaults and computes diameter from trusted base plus bonus only', () => {
    const defaults = detail({ flags: ['ROTOR'] }); expect(row(defaults, 'rotor_diameter')).toMatchObject({ value: 1, status: 'default' }); expect(row(defaults, 'rotor_effective_diameter')).toMatchObject({ value: 1, status: 'default' });
    expect(row(detail({ flags: ['ROTOR'], rotor_diameter: 8, bonus: 2 }), 'rotor_effective_diameter').value).toBe(10);
    expect(row(detail({ flags: ['ROTOR'], rotor_diameter: 8, bonus: 2, _incompleteFields: ['bonus'] }), 'rotor_effective_diameter').value).toBeNull();
  });
  it('uses field-level trust inside armor maps', () => {
    const d = detail({ damage_reduction: { bash: 8, heat: 10 }, _incompleteFields: ['damage_reduction.heat'] });
    expect(row(d, 'damage_reduction_bash').value).toBe(8); expect(row(d, 'damage_reduction_heat').value).toBeNull();
  });
  it('describes verified contextual bonus aliases, rotor diameter and temperature deltas', () => {
    const d = detail({ flags: ['MUFFLER', 'ROTOR', 'FUNNEL'], bonus: 5, rotor_diameter: 8, floor_bedding_warmth: 300, bonus_fire_warmth_feet: 600 });
    expect(row(d, 'muffler_noise_reduction')).toMatchObject({ value: 5, unit: '%' }); expect(row(d, 'funnel_radius')).toMatchObject({ value: 5, unit: 'mm' }); expect(row(d, 'rotor_diameter')).toMatchObject({ value: 8, unit: 'm' });
    expect(row(d, 'floor_bedding_warmth')).toMatchObject({ value: .6, unit: '°C Δ' }); expect(row(d, 'bonus_fire_warmth_feet').value).toBe(1.2);
  });
  it('does not mutate frozen inputs and retains full resolved advanced definitions', () => {
    const indexes = setup({ flags: Object.freeze(['CARGO']), size: '5 L', custom_future_field: { value: 123 } }, { pocket_data: Object.freeze([Object.freeze({ pocket_type: 'CONTAINER', max_contains_volume: '3 L' })]) });
    for (const d of [...indexes.parts.values(), ...indexes.items.values()]) Object.freeze(d);
    const before = JSON.stringify([...indexes.parts.values(), ...indexes.items.values()]); const d = describePart('p', indexes);
    expect(d.advanced.part?.custom_future_field).toEqual({ value: 123 }); expect(JSON.stringify([...indexes.parts.values(), ...indexes.items.values()])).toBe(before);
    expect(new Set(rows(d).map(f => f.id)).size).toBe(rows(d).length);
    expect(rows(d).every(f => f.value === null || ['number', 'string', 'boolean'].includes(typeof f.value))).toBe(true);
  });
});

describe('real packaged core parts', () => {
  let indexes: VehicleIndexes;
  beforeAll(() => {
    const pack = JSON.parse(readFileSync('public/datasets/0.I-1/dda.json', 'utf8')) as DataPackage;
    const c = compose([pack], ['dda']); indexes = { parts: new Map(Object.entries(c.parts)), items: new Map(Object.entries(c.items)) };
  });
  it('reports real automotive alternator load and generation', () => {
    const d = describePart('alternator_car', indexes); expect(row(d, 'mechanical_load').value).toBe(1492); expect(row(d, 'generation').value).toBe(780);
  });
  it('reports real small electric motor output and full-load input distinctly', () => {
    const d = describePart('engine_electric_small', indexes); expect(row(d, 'mechanical_output').value).toBe(7040); expect(row(d, 'full_load_consumption').value).toBe(8000); expect(row(d, 'fuel_type').value).toBe('battery');
  });
  it('reports real crane JACK and LIFT one-level 500kg ratings', () => {
    const d = describePart('crane_tiny', indexes); expect(row(d, 'jack_capacity').value).toBe(500); expect(row(d, 'lift_capacity').value).toBe(500);
  });
  it('interprets real blazemod bare epower -1 as 1kW fixed consumption', () => {
    const pack = JSON.parse(readFileSync('public/datasets/0.I-1/dda.json', 'utf8')) as DataPackage;
    const mod = JSON.parse(readFileSync('public/datasets/0.I-1/blazemod.json', 'utf8')) as DataPackage;
    const raw = mod.definitions.find(d => d.data.type === 'vehicle_part' && d.data.epower === -1);
    expect(raw).toBeDefined(); const c = compose([pack, mod], ['dda', 'blazemod']);
    const d = describePart(String(raw!.data.id), { parts: new Map(Object.entries(c.parts)), items: new Map(Object.entries(c.items)) });
    expect(row(d, 'fixed_consumption')).toMatchObject({ value: 1000, status: 'known' });
  });
  it('reports real frame empty mass without requiring engine simulation', () => {
    expect(row(describePart('frame', indexes), 'weight').value).toBe(20000);
  });
});
