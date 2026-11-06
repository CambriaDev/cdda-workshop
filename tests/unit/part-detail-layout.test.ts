import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compose, type DataPackage } from '../../src/domain/data';
import { describePart, type Definition, type PartDetails, type VehicleIndexes } from '../../src/domain/vehicle';
import { getPartDetailLayout, PART_ROLE_PRIORITY, type PartRole } from '../../src/features/vehicle-editor/partDetailLayout';

function setup(part: Record<string, unknown> = {}, base: Record<string, unknown> = {}): VehicleIndexes {
  return {
    parts: new Map([['p', { id: 'p', type: 'vehicle_part', item: 'base', location: 'center', durability: 100, ...part } as Definition]]),
    items: new Map([['base', { id: 'base', type: 'GENERIC', weight: '2 kg', volume: '1 L', ...base } as Definition], ['welder', { id: 'welder', type: 'TOOL', qualities: [['WELD', 2]], charged_qualities: [['CUT', 1]] } as Definition]]),
  };
}
const model = (part: Record<string, unknown> = {}, base: Record<string, unknown> = {}) => describePart('p', setup(part, base));
const layout = (part: Record<string, unknown> = {}, base: Record<string, unknown> = {}) => getPartDetailLayout(model(part, base));
const featured = (value: ReturnType<typeof getPartDetailLayout>) => value.featuredBlocks.flatMap(b => b.fields);
const featuredIds = (value: ReturnType<typeof getPartDetailLayout>) => featured(value).map(f => f.id);
const secondaryIds = (value: ReturnType<typeof getPartDetailLayout>) => value.remainingSections.flatMap(s => s.fields.map(f => f.id));

// Purpose is a reliable source trait, not an interpretation of the translated name.
describe('source-backed deterministic part purposes', () => {
  it.each<[string, PartRole]>([
    ['ENGINE', 'engine'], ['ALTERNATOR', 'alternator'], ['SOLAR_PANEL', 'generator'], ['WIND_TURBINE', 'generator'], ['WATER_WHEEL', 'generator'], ['REACTOR', 'reactor'], ['BATTERY', 'battery'], ['FLUIDTANK', 'tank'], ['TURRET', 'turret'], ['WHEEL', 'wheel'], ['ROTOR', 'rotor'], ['HALF_CIRCLE_LIGHT', 'lighting'], ['HORN', 'lighting'], ['APPLIANCE', 'utility'], ['WORKBENCH', 'utility'], ['BED', 'passenger'], ['SEATBELT', 'passenger'], ['ARMOR', 'protection'], ['DOOR', 'structure'], ['ROOF', 'structure'], ['CARGO', 'cargo'],
  ])('classifies the explicit %s trait as %s', (flag, role) => {
    expect(layout({ flags: [flag] }).primaryRole).toBe(role);
  });
  it('uses canonical supplemental categories without guessing from broad movement/energy groups', () => {
    expect(layout({ categories: ['utility', 'cargo'], flags: ['CARGO'] }).primaryRole).toBe('utility');
    expect(layout({ categories: ['passengers'] }).primaryRole).toBe('passenger');
    expect(layout({ categories: ['lighting'] }).primaryRole).toBe('lighting');
    expect(layout({ categories: ['hull'] }).primaryRole).toBe('structure');
    expect(layout({ categories: ['movement', 'energy'], name: 'powerful engine', power: '100 kW', epower: '5 kW' }).roles).toEqual(['fallback']);
  });
  it('does not call a BOARDABLE cargo area a passenger fixture or a MOUNTABLE bed an appliance', () => {
    expect(layout({ flags: ['BOARDABLE', 'CARGO'] }).roles).toEqual(['cargo']);
    expect(layout({ flags: ['BED', 'BOARDABLE', 'CARGO', 'MOUNTABLE'] }).roles).toEqual(['passenger', 'cargo']);
  });
  it('uses reliable base subtypes without conflating generic TOOL/MAGAZINE with installed tools/batteries', () => {
    expect(layout({}, { type: 'ITEM', subtypes: ['ENGINE'] }).primaryRole).toBe('engine');
    expect(layout({}, { type: 'ITEM', subtypes: ['WHEEL'] }).primaryRole).toBe('wheel');
    expect(layout({}, { type: 'TOOL', qualities: [['CUT', 1]] }).primaryRole).toBe('fallback');
    expect(layout({}, { type: 'MAGAZINE' }).primaryRole).toBe('fallback');
    expect(layout({}, { type: 'ITEM', subtypes: ['ENGINE'], _incompleteFields: ['subtypes'] }).primaryRole).toBe('fallback');
  });
  it('does not classify from globally or specifically unreliable flags/categories', () => {
    expect(layout({ flags: ['ENGINE'], categories: ['utility'], _incomplete: true }).roles).toEqual(['fallback']);
    expect(layout({ flags: ['ENGINE'], categories: ['utility'], _incompleteFields: ['flags', 'categories'] }).roles).toEqual(['fallback']);
    expect(layout({ flags: ['ENGINE'], _incompleteFields: ['requirements.install'] }).primaryRole).toBe('engine');
    expect(layout({ flags: ['ENGINE', 1], categories: ['movement'] }).primaryRole).toBe('fallback');
    expect(layout({ flags: 'ENGINE', categories: 'utility' }).primaryRole).toBe('fallback');
  });
  it('keeps approved multi-role priority independent of source flag/category order', () => {
    const flags = ['CARGO', 'ARMOR', 'SEAT', 'VEH_TOOLS', 'CONE_LIGHT', 'ROTOR', 'WHEEL', 'TURRET', 'FLUIDTANK', 'BATTERY', 'REACTOR', 'SOLAR_PANEL', 'ALTERNATOR', 'ENGINE', 'DOOR'];
    const first = layout({ flags });
    const reversed = layout({ flags: [...flags].reverse() });
    expect(first.roles).toEqual(PART_ROLE_PRIORITY.filter(r => r !== 'fallback'));
    expect(reversed.roles).toEqual(first.roles);
    expect(first.primaryRole).toBe('engine');
  });
});

describe('prioritized fields and one-time capability representation', () => {
  it('shows engine output/hp, fuel, full-load draw in purpose order and preserves critical unknowns', () => {
    const result = layout({ flags: ['ENGINE'], power: '8 kW', energy_consumption: '10 kW', fuel_type: 'battery', _incompleteFields: ['power'] });
    const engine = result.featuredBlocks.find(b => b.role === 'engine')!;
    expect(engine.fields.map(f => f.id)).toEqual(['mechanical_output', 'mechanical_output_hp', 'fuel_type', 'full_load_consumption']);
    expect(engine.fields[0]).toMatchObject({ status: 'unknown', value: null });
    expect(featuredIds(result)).toContain('weight');
    expect(secondaryIds(result)).toContain('durability');
    expect(secondaryIds(result)).toContain('mechanical_load');
  });
  it('prioritizes alternator generation before mechanical load/hp, never opposite output-zero noise', () => {
    const result = layout({ flags: ['ALTERNATOR'], power: '-1.5 kW', epower: '800 W' });
    expect(result.featuredBlocks[0].fields.map(f => f.id)).toEqual(['generation', 'mechanical_load', 'mechanical_load_hp']);
    expect(featuredIds(result)).not.toContain('mechanical_output');
    expect(secondaryIds(result)).toContain('mechanical_output');
  });
  it('demotes default-zero fields but does not hide a role-critical unknown or explicit zero', () => {
    const zero = layout({ flags: ['ENGINE'], power: '0 W', fuel_type: 'battery' });
    expect(featuredIds(zero)).toContain('mechanical_output');
    expect(featuredIds(zero)).not.toContain('full_load_consumption');
    expect(secondaryIds(zero)).toContain('full_load_consumption');
    const unknown = layout({ flags: ['ENGINE'], _incompleteFields: ['energy_consumption'] });
    expect(featured(unknown).find(f => f.id === 'full_load_consumption')).toMatchObject({ status: 'unknown', value: null });
  });
  it('puts utility above cargo and keeps its physical/protection details secondary', () => {
    const result = layout({ flags: ['CARGO', 'VEH_TOOLS', 'ENABLED_DRAINS_EPOWER'], epower: '-500 W', allowed_tools: ['drill'], pseudo_tools: [{ id: 'welder' }], qualities: [['JACK', 1]], size: '20 L', damage_reduction: { all: 40 }, damage_modifier: 10 });
    expect(result.roles).toEqual(['utility', 'cargo']);
    expect(featuredIds(result)).toContain('fixed_consumption');
    expect(featuredIds(result)).toContain('cargo_capacity');
    expect(result.featuredBlocks.find(b => b.role === 'utility')!.capabilities).toEqual(['pseudoTools', 'partQualities', 'connectableTools']);
    for (const id of ['weight', 'volume', 'durability', 'damage_reduction_all', 'collision_damage_modifier', 'location']) expect(secondaryIds(result)).toContain(id);
    expect(result.representedFields.map(f => f.id)).toEqual(expect.arrayContaining(['part_qualities', 'jack_capacity', 'pseudo_tools', 'connectable_tools']));
    expect(featuredIds(result)).not.toContain('jack_capacity');
  });
  it('also demotes weight for lighting+cargo while keeping intensity/draw/cargo accessible', () => {
    const result = layout({ flags: ['CONE_LIGHT', 'CARGO', 'ENABLED_DRAINS_EPOWER'], epower: '-100 W', bonus: 80, size: '2 L' });
    expect(result.primaryRole).toBe('lighting');
    expect(featuredIds(result)).toEqual(expect.arrayContaining(['fixed_consumption', 'light_intensity', 'cargo_capacity']));
    expect(secondaryIds(result)).toContain('weight');
    expect(featuredIds(result)).not.toContain('generation');
  });
  it('keeps base-item qualities separate and unknown installed-tool counts visible', () => {
    const result = layout({ flags: ['VEH_TOOLS'], qualities: [['JACK', 1]], _incompleteFields: ['qualities', 'allowed_tools'] }, { qualities: [['CUT', 1]] });
    expect(featured(result).find(f => f.id === 'part_qualities')?.status).toBe('unknown');
    expect(featured(result).find(f => f.id === 'connectable_tools')?.status).toBe('unknown');
    expect(result.secondaryCapabilities).toEqual(['baseItemQualities']);
    expect(result.featuredBlocks.flatMap(b => b.capabilities)).not.toContain('baseItemQualities');
  });
  it('features wind coefficients, cable loss and active charger demand without relabeling them as generation', () => {
    const wind = layout({ flags: ['WIND_TURBINE'], epower: '1 W' });
    expect(wind.primaryRole).toBe('generator');
    expect(featuredIds(wind)).toContain('wind_generation_coefficient');
    expect(featuredIds(wind)).not.toContain('generation');
    const cable = layout({ flags: ['POWER_TRANSFER'], epower: '1 kW' });
    expect(featuredIds(cable)).toContain('cable_loss_percent');
    expect(featuredIds(cable)).not.toContain('generation');
    const charger = layout({ flags: ['RECHARGE'], bonus: 600 });
    expect(featuredIds(charger)).toContain('recharge_demand');
    expect(featured(charger).find(field => field.id === 'recharge_demand')?.value).toBe(600);
  });
  it('retains per-pocket capacities separately with no invented total', () => {
    const result = layout({ flags: ['FLUIDTANK'] }, { pocket_data: [{ pocket_type: 'CONTAINER', max_contains_volume: '5 L', watertight: true }, { pocket_type: 'CONTAINER', max_contains_volume: '10 L', watertight: true }] });
    expect(featuredIds(result)).toEqual(expect.arrayContaining(['container_capacity_0', 'container_capacity_1', 'container_watertight_0', 'container_watertight_1']));
    expect(featuredIds(result)).not.toContain('cargo_capacity');
    expect(featuredIds(result)).not.toContain('container_capacity');
    const nonWatertight = layout({ flags: ['FLUIDTANK'] }, { pocket_data: [{ pocket_type: 'CONTAINER', max_contains_volume: '5 L' }] });
    expect(featured(nonWatertight).find(f => f.id === 'container_watertight')).toMatchObject({ status: 'default', value: false });
  });
  it('keeps every model field exactly once across featured, secondary, represented and metadata without mutating source', () => {
    const value = model({ flags: ['CARGO', 'VEH_TOOLS', 'ROTOR', 'ARMOR'], epower: '-100 W', size: '10 L', rotor_diameter: 4, bonus: 1, allowed_tools: ['drill'], qualities: [['JACK', 1], ['LIFT', 2]], pseudo_tools: [{ id: 'welder' }] }, { qualities: [['CUT', 1]] });
    function freeze(input: unknown) { if (input && typeof input === 'object') { Object.values(input).forEach(freeze); Object.freeze(input); } }
    const before = JSON.stringify(value); freeze(value);
    const result = getPartDetailLayout(value);
    const allocated = [...featured(result), ...result.remainingSections.flatMap(s => s.fields), ...result.representedFields, ...result.metadataFields];
    const original = value.sections.flatMap(s => s.fields);
    expect(allocated.length).toBe(original.length);
    expect(new Set(allocated).size).toBe(original.length);
    expect(new Set(allocated)).toEqual(new Set(original));
    expect(JSON.stringify(value)).toBe(before);
    expect(getPartDetailLayout(value)).toEqual(result);
  });
});

describe('real packaged purpose regressions', () => {
  let indexes: VehicleIndexes;
  beforeAll(() => {
    const pack = JSON.parse(readFileSync('public/datasets/0.I-1/dda.json', 'utf8')) as DataPackage;
    const c = compose([pack], ['dda']);
    indexes = { parts: new Map(Object.entries(c.parts)), items: new Map(Object.entries(c.items)) };
  });
  it.each<[string, PartRole]>([['bed', 'passenger'], ['cargo_space', 'cargo'], ['door', 'structure'], ['veh_forge', 'utility'], ['alternator_car', 'alternator'], ['engine_electric_small', 'engine'], ['tank', 'tank'], ['crane_tiny', 'utility']])('classifies real %s as %s', (id, role) => {
    expect(indexes.parts.has(id)).toBe(true);
    expect(getPartDetailLayout(describePart(id, indexes)).primaryRole).toBe(role);
  });
  it('features real forge functions/capacity, not armor-like numeric distractions', () => {
    const result = getPartDetailLayout(describePart('veh_forge', indexes));
    expect(result.roles).toEqual(['utility', 'cargo']);
    expect(result.featuredBlocks.flatMap(b => b.capabilities)).toContain('pseudoTools');
    expect(featuredIds(result)).toContain('cargo_capacity');
    for (const id of ['weight', 'durability', 'damage_reduction_all', 'collision_damage_modifier']) expect(secondaryIds(result)).toContain(id);
  });
});
