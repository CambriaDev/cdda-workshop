import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compose, type DataPackage } from '../../src/domain/data';
import { analyzeVehicleSystems, calculateStats, describePart, exportBlueprint, type Definition, type VehicleIndexes, type VehicleModel, type VehiclePurpose } from '../../src/domain/vehicle';

const def = (id: string, values: Record<string, unknown> = {}): Definition => ({ id, type: 'vehicle_part', ...values });
function setup() {
  const parts = [def('frame', { flags: ['STRUCTURE'], location: 'structure', item: 'steel' }),
    def('motor', { flags: ['ENGINE'], item: 'motor_item', power: '7.04 kW', energy_consumption: '8 kW', fuel_type: 'battery' }),
    def('gas_engine', { flags: ['ENGINE'], item: 'gas_item', power: 100, fuel_type: 'gasoline' }),
    def('battery', { flags: ['BATTERY'], item: 'battery_item' }), def('tank', { flags: ['FLUIDTANK'], item: 'tank_item' }),
    def('controls', { flags: ['CONTROLS'] }), def('dashboard', { flags: ['CTRL_ELECTRONIC'] }),
    def('wheel', { flags: ['WHEEL', 'STEERABLE'] }), def('unicycle', { flags: ['WHEEL', 'STABLE', 'STEERABLE'] }),
    def('float', { flags: ['FLOATS'] }), def('alternator', { flags: ['ALTERNATOR'], item: 'steel', epower: '780 W', power: '-1492 W' })];
  const items = [def('steel', { type: 'ITEM' }), def('motor_item', { type: 'ITEM' }), def('gas_item', { type: 'ITEM' }),
    def('battery_item', { type: 'MAGAZINE', pocket_data: [{ pocket_type: 'MAGAZINE', ammo_restriction: { battery: 50000 } }] }),
    def('tank_item', { type: 'ITEM', pocket_data: [{ pocket_type: 'CONTAINER', watertight: true, max_contains_volume: '60 L' }] }),
    def('gasoline', { type: 'AMMO', phase: 'liquid', ammo_type: 'gasoline' }), def('diesel', { type: 'AMMO', phase: 'liquid', ammo_type: 'diesel' })];
  return { parts: new Map(parts.map(d => [d.id, d])), items: new Map(items.map(d => [d.id, d])), flagRequirements: new Map() } satisfies VehicleIndexes;
}
const vehicle = (...ids: string[]): VehicleModel => ({ name: 'systems fixture', parts: ids.map((id, i) => ({ id, mount_dx: i, mount_dy: 0 })) });
function status(ids: string[], code: string, indexes = setup(), purpose?: VehiclePurpose) { return analyzeVehicleSystems(vehicle(...ids), indexes, purpose).checks.find(c => c.code === code)?.status; }

describe('nominal system inventory and units', () => {
  it('separates engine output, full-load input, alternator load and electrical generation', () => {
    const report = analyzeVehicleSystems(vehicle('motor', 'alternator'), setup());
    expect(report.engines[0]).toMatchObject({ partId: 'motor', partIndex: 0, x: 0, y: 0, ratedPowerW: 7040, fullLoadConsumptionW: 8000, fuelOptions: ['battery'] });
    expect(report.electrical.find(p => p.partId === 'alternator')).toMatchObject({ generationW: 780, mechanicalLoadW: 1492, consumptionW: 0 });
    expect(status(['motor', 'alternator'], 'fuel-supply')).toBe('missing');
  });
  it('lists each installed battery and tank and sums only the same nominal units', () => {
    const report = analyzeVehicleSystems(vehicle('tank', 'battery', 'battery'), setup());
    expect(report.stores.map(s => [s.kind, s.capacity, s.unit])).toEqual([['tank', 60000, 'ml'], ['battery', 50000, 'charges'], ['battery', 50000, 'charges']]);
    expect(report.tankVolume).toMatchObject({ known: 60000, missing: 0, complete: true });
    expect(report.batteryCapacity).toMatchObject({ known: 100000, complete: true });
    expect(report.stores.every(s => s.contentsUnknown && s.recordedResources.length === 0)).toBe(true);
  });
  it('does not treat null contents as a recorded empty store or zero-capacity hardware as a fuel route', () => {
    const indexes = setup(), v = vehicle('battery'); v.parts[0]!.base = { typeid: 'battery_item', contents: null };
    expect(analyzeVehicleSystems(v, indexes).stores[0]!.contentsUnknown).toBe(true);
    indexes.items.get('battery_item')!.pocket_data = [{ pocket_type: 'MAGAZINE', ammo_restriction: { battery: 0 } }];
    expect(status(['motor', 'battery'], 'fuel-supply', indexes)).toBe('missing');
    indexes.items.get('tank_item')!.pocket_data = [{ pocket_type: 'CONTAINER', watertight: true, max_contains_volume: '0 L' }];
    expect(status(['gas_engine', 'tank'], 'fuel-supply', indexes)).toBe('missing');
  });
  it('recognizes watertight base containers and battery magazines without special part flags', () => {
    const indexes = setup(); indexes.parts.set('plain_tank', def('plain_tank', { item: 'tank_item' })); indexes.parts.set('plain_battery', def('plain_battery', { item: 'battery_item' }));
    const report = analyzeVehicleSystems(vehicle('plain_tank', 'plain_battery'), indexes);
    expect(report.stores.map(s => s.kind)).toEqual(['tank', 'battery']);
  });
  it('does not treat a non-watertight FLUIDTANK definition as proven liquid storage', () => {
    const indexes = setup(); indexes.items.get('tank_item')!.pocket_data = [{ pocket_type: 'CONTAINER', max_contains_volume: '60 L' }];
    const report = analyzeVehicleSystems(vehicle('gas_engine', 'tank'), indexes);
    expect(report.stores[0]!.capacity).toBeNull(); expect(report.checks.find(c => c.code === 'fuel-supply')!.status).toBe('unknown');
  });
  it('uses the actual base item identity, without mutating definition or inspector defaults', () => {
    const indexes = setup(); indexes.items.set('small_battery', def('small_battery', { type: 'MAGAZINE', pocket_data: [{ pocket_type: 'MAGAZINE', ammo_restriction: { battery: 1000 } }] }));
    const v = vehicle('battery'); v.parts[0]!.base = { typeid: 'small_battery' };
    expect(analyzeVehicleSystems(v, indexes).stores[0]).toMatchObject({ baseItemId: 'small_battery', capacity: 1000 });
    expect(describePart('battery', indexes).baseItemId).toBe('battery_item');
    expect(describePart('battery', indexes).sections.flatMap(s => s.fields).find(f => f.id === 'battery_capacity')!.value).toBe(50000);
  });
  it('keeps unsupported multiple pockets and alternative capacities unknown, not summed', () => {
    const indexes = setup(); indexes.items.get('battery_item')!.pocket_data = [{ pocket_type: 'MAGAZINE', ammo_restriction: { battery: 50000, plutonium: 100 } }];
    let report = analyzeVehicleSystems(vehicle('motor', 'battery'), indexes);
    expect(report.batteryCapacity).toMatchObject({ known: 0, complete: false }); expect(report.checks.find(c => c.code === 'fuel-supply')!.status).toBe('unknown');
    indexes.items.get('battery_item')!.pocket_data = [{ pocket_type: 'MAGAZINE', ammo_restriction: { battery: 50000 } }, { pocket_type: 'MAGAZINE', ammo_restriction: { battery: 50000 } }];
    report = analyzeVehicleSystems(vehicle('battery'), indexes); expect(report.stores[0]!.capacity).toBeNull();
  });
  it.each([-1, Infinity, NaN, 'bad'])('rejects invalid battery capacity %s', value => {
    const indexes = setup(); indexes.items.get('battery_item')!.pocket_data = [{ pocket_type: 'MAGAZINE', ammo_restriction: { battery: value } }];
    expect(analyzeVehicleSystems(vehicle('battery'), indexes).stores[0]!.capacity).toBeNull();
  });
  it('retains recorded resource charges and explicit disabled/damage state, never assuming full or enabled', () => {
    const v = vehicle('battery'); v.parts[0]!.enabled = false;
    v.parts[0]!.base = { typeid: 'battery_item', damaged: 250, faults: ['fault_x'], contents: { contents: [{ pocket_type: 1, contents: [{ typeid: 'battery', charges: 0 }] }] } };
    const store = analyzeVehicleSystems(v, setup()).stores[0]!;
    expect(store).toMatchObject({ enabled: false, damage: 250, contentsUnknown: false, recordedResources: [{ itemId: 'battery', charges: 0 }], capacity: 50000 });
    expect(store.notes).toEqual(expect.arrayContaining(['recorded_damage', 'recorded_faults', 'recorded_disabled']));
  });
});

describe('source-backed conditional completeness, separate from mount/export validity', () => {
  it('shows one empty-project hint and gives passive designs no engine/control deficits', () => {
    expect(analyzeVehicleSystems(vehicle(), setup()).checks.map(c => c.code)).toEqual(['empty-vehicle']);
    expect(status(['frame'], 'required-engine')).toBe('missing');
    expect(status(['frame'], 'required-engine', setup(), 'passive')).toBe('not-applicable');
    expect(status(['frame'], 'driving-controls', setup(), 'passive')).toBe('not-applicable');
  });
  it('does not change blueprint export gates when powered driving components are absent', () => {
    const indexes = setup(), v = vehicle('frame');
    analyzeVehicleSystems(v, indexes); expect(exportBlueprint(v, {}, indexes).prototype).toBeDefined();
  });
  it('requires electric storage rather than an unrelated tank, without claiming it is charged', () => {
    expect(status(['motor', 'tank'], 'fuel-supply')).toBe('missing');
    expect(status(['motor', 'battery'], 'fuel-supply')).toBe('conditional');
    expect(analyzeVehicleSystems(vehicle('motor'), setup()).checks.find(c => c.code === 'fuel-supply')!.notes).toContain('external_power_not_verified');
  });
  it('recognizes a liquid fuel design route without declaring an empty or unrecorded tank fueled', () => {
    expect(status(['gas_engine'], 'fuel-supply')).toBe('missing');
    expect(status(['gas_engine', 'tank'], 'fuel-supply')).toBe('conditional');
  });
  it('respects exact fuel restrictions on tanks and magazines independently of capacity', () => {
    const indexes = setup(); indexes.parts.get('tank')!.fuel_type = 'diesel';
    const r = analyzeVehicleSystems(vehicle('gas_engine', 'tank'), indexes);
    expect(r.stores[0]).toMatchObject({ capacity: 60_000, allowedFuel: 'diesel', fuelRestrictionKnown: true });
    expect(r.checks.find(c => c.code === 'fuel-supply')!.status).toBe('missing');
    indexes.parts.get('tank')!.fuel_type = 'gasoline';
    expect(status(['gas_engine', 'tank'], 'fuel-supply', indexes)).toBe('conditional');
    indexes.parts.get('tank')!._incompleteFields = ['fuel_type'];
    expect(status(['gas_engine', 'tank'], 'fuel-supply', indexes)).toBe('unknown');
    indexes.parts.set('solid_store', def('solid_store', { item: 'magazine', fuel_type: 'other_pellet' }));
    indexes.items.set('magazine', def('magazine', { type: 'MAGAZINE', pocket_data: [{ pocket_type: 'MAGAZINE', ammo_restriction: { pellet: 50 } }] }));
    indexes.items.set('pellet', def('pellet', { type: 'AMMO', ammo_type: 'pellet' }));
    indexes.parts.get('gas_engine')!.fuel_type = 'pellet';
    expect(status(['gas_engine', 'solid_store'], 'fuel-supply', indexes)).toBe('missing');
    indexes.parts.get('solid_store')!.fuel_type = 'null';
    expect(status(['gas_engine', 'solid_store'], 'fuel-supply', indexes)).toBe('conditional');
  });
  it.each(['gas', 'plasma'])('keeps unsupported %s containment unknown instead of declaring a missing tank', phase => {
    const indexes = setup(); indexes.items.get('gasoline')!.phase = phase;
    expect(status(['gas_engine', 'tank'], 'fuel-supply', indexes)).toBe('unknown');
    expect(status(['gas_engine'], 'fuel-supply', indexes)).toBe('missing');
  });
  it.each([{ min_item_length: '5 cm' }, { ablative: true }])('does not interpret special pocket constraints %j as simple nominal storage', restriction => {
    const indexes = setup(); indexes.items.get('tank_item')!.pocket_data = [{ pocket_type: 'CONTAINER', watertight: true, max_contains_volume: '60 L', ...restriction }];
    const r = analyzeVehicleSystems(vehicle('gas_engine', 'tank'), indexes);
    expect(r.stores[0]).toMatchObject({ capacity: null, restricted: true });
    expect(r.checks.find(c => c.code === 'fuel-supply')!.status).toBe('unknown');
  });
  it('accepts any one supported multi-fuel route, rather than demanding all fuels', () => {
    const indexes = setup(); indexes.parts.get('motor')!.fuel_options = ['gasoline'];
    expect(status(['motor', 'tank'], 'fuel-supply', indexes)).toBe('conditional');
  });
  it.each(['muscle', 'animal', 'wind', 'null'])('never demands tanks for %s engines', fuel => {
    const indexes = setup(); indexes.parts.get('motor')!.fuel_type = fuel;
    const report = analyzeVehicleSystems(vehicle('motor'), indexes);
    expect(report.checks.find(c => c.code === 'fuel-supply')!.status).toBe('conditional');
    expect(report.engines[0]!.conditional).toBe(fuel !== 'null');
    if (fuel !== 'null') expect(calculateStats(vehicle('motor'), indexes).ratedPower.complete).toBe(false);
  });
  it('recognizes perpetual fuel independently of the engine name', () => {
    const indexes = setup(); indexes.parts.get('gas_engine')!.fuel_type = 'magic'; indexes.items.set('magic', def('magic', { type: 'AMMO', flags: ['PERPETUAL'] }));
    expect(status(['gas_engine'], 'fuel-supply', indexes)).toBe('conditional');
  });
  it('does not equate an electronic dashboard with local driving controls', () => {
    expect(status(['motor', 'dashboard'], 'driving-controls')).toBe('missing');
    expect(status(['motor', 'controls'], 'driving-controls')).toBe('present');
    const indexes = setup(); indexes.parts.set('remote', def('remote', { flags: ['REMOTE_CONTROLS'] }));
    expect(status(['motor', 'remote'], 'driving-controls', indexes)).toBe('conditional');
    indexes.parts.set('animal_control', def('animal_control', { flags: ['CONTROL_ANIMAL'] }));
    expect(status(['animal_control'], 'driving-controls', indexes)).toBe('conditional');
  });
  it('only infers starter requirement from explicit source-format potential faults', () => {
    const indexes = setup();
    expect(status(['gas_engine'], 'starter-battery', indexes)).toBeUndefined();
    indexes.items.get('gas_item')!.faults = [{ fault: 'fault_engine_starter' }];
    expect(status(['gas_engine'], 'starter-battery', indexes)).toBe('missing');
    expect(status(['gas_engine', 'battery'], 'starter-battery', indexes)).toBe('conditional');
    indexes.items.get('gas_item')!.faults = [{ fault_group: 'engine_gasoline' }];
    expect(status(['gas_engine'], 'starter-battery', indexes)).toBe('unknown');
  });
  it('mirrors the stable single-wheel design rule, without certifying balance or current health', () => {
    expect(status(['frame', 'wheel'], 'wheel-count')).toBe('missing');
    expect(status(['frame', 'unicycle'], 'wheel-count')).toBe('present');
    expect(status(['frame', 'frame', 'frame', 'frame', 'unicycle'], 'wheel-count')).toBe('missing');
    expect(status(['frame', 'wheel', 'wheel'], 'wheel-count')).toBe('present');
    expect(analyzeVehicleSystems(vehicle('frame', 'wheel', 'wheel'), setup()).checks.find(c => c.code === 'wheel-count')!.notes).toContain('intact_design_only');
  });
  it('uses source location rather than a look-alike structural flag for the one-wheel size limit', () => {
    const indexes = setup(); indexes.parts.set('not_structure', def('not_structure', { flags: ['STRUCTURE'], location: 'roof' }));
    expect(status(['frame', 'not_structure', 'not_structure', 'not_structure', 'unicycle'], 'wheel-count', indexes)).toBe('present');
    indexes.parts.get('not_structure')!._incompleteFields = ['location'];
    expect(status(['frame', 'not_structure', 'unicycle'], 'wheel-count', indexes)).toBe('unknown');
  });
  it('does not demand road wheels from a wheelless rotorcraft or certify flight', () => {
    const indexes = setup(); indexes.parts.set('rotor', def('rotor', { flags: ['ROTOR'] }));
    expect(status(['rotor'], 'wheel-count', indexes)).toBe('not-applicable');
    expect(status(['rotor'], 'steering', indexes)).toBe('conditional');
    expect(status(['rotor', 'wheel'], 'wheel-count', indexes)).toBe('missing');
  });
  it('does not apply road wheels/steering to a pure boat or infer flotation from floats alone', () => {
    expect(status(['float'], 'wheel-count')).toBe('not-applicable');
    expect(status(['float'], 'steering')).toBe('conditional');
    expect(status(['float'], 'boat-flotation')).toBe('unknown');
    expect(status(['float', 'wheel'], 'wheel-count')).toBe('missing');
  });
});

describe('unknown definitions, reliability and immutable data flow', () => {
  it('unknown parts prevent confident absence conclusions and mark capacities incomplete', () => {
    const report = analyzeVehicleSystems(vehicle('lost_mod'), setup());
    expect(report.unknownParts).toBe(1); expect(report.checks.find(c => c.code === 'required-engine')!.status).toBe('unknown');
    expect(report.checks.find(c => c.code === 'driving-controls')!.status).toBe('unknown'); expect(report.tankVolume.complete).toBe(false);
  });
  it('keeps omitted unresolved electrical fields in the inventory instead of a fully-known zero total', () => {
    const indexes = setup(); indexes.parts.set('lamp', def('lamp', { flags: ['LIGHT'], item: 'steel', _incompleteFields: ['epower'] }));
    const row = analyzeVehicleSystems(vehicle('lamp'), indexes).electrical[0]!;
    expect(row).toMatchObject({ partId: 'lamp', generationW: null, consumptionW: null, mechanicalLoadW: 0 });
    indexes.parts.get('lamp')!._incompleteFields = ['power'];
    expect(analyzeVehicleSystems(vehicle('lamp'), indexes).electrical[0]).toMatchObject({ generationW: 0, consumptionW: 0, mechanicalLoadW: null });
  });
  it('unreliable power remains null and unrelated incomplete fields retain trusted results', () => {
    const indexes = setup(); indexes.parts.get('motor')!._incompleteFields = ['power'];
    expect(analyzeVehicleSystems(vehicle('motor'), indexes).engines[0]!.ratedPowerW).toBeNull();
    indexes.parts.get('motor')!._incompleteFields = ['requirements'];
    expect(analyzeVehicleSystems(vehicle('motor'), indexes).engines[0]!.ratedPowerW).toBe(7040);
  });
  it('missing or untrusted actual base items never borrow a different default capacity', () => {
    const indexes = setup(), v = vehicle('battery'); v.parts[0]!.base = { typeid: 'missing_battery' };
    expect(analyzeVehicleSystems(v, indexes).stores[0]!.capacity).toBeNull();
    expect(status(['motor', 'lost_mod'], 'fuel-supply', indexes)).toBe('unknown');
  });
  it('does not mutate deeply frozen vehicle/definition inputs or shared metadata', () => {
    const indexes = setup(), v = vehicle('motor', 'battery', 'tank');
    const freeze = (value: unknown) => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
    freeze(v); for (const d of [...indexes.parts.values(), ...indexes.items.values()]) freeze(d);
    const before = JSON.stringify([v, [...indexes.parts], [...indexes.items]]);
    const a = analyzeVehicleSystems(v, indexes), b = analyzeVehicleSystems(v, indexes, 'passive');
    expect(a.engines).toEqual(b.engines); expect(JSON.stringify([v, [...indexes.parts], [...indexes.items]])).toBe(before);
  });
});

describe('real packaged 0.I-1 systems', () => {
  let indexes: VehicleIndexes;
  beforeAll(() => {
    const pack = JSON.parse(readFileSync('public/datasets/0.I-1/dda.json', 'utf8')) as DataPackage;
    const composition = compose([pack], ['dda']); indexes = { parts: new Map(Object.entries(composition.parts)), items: new Map(Object.entries(composition.items)) };
  });
  it('reports real motor, storage battery, 60L tank and alternator ratings', () => {
    const report = analyzeVehicleSystems(vehicle('frame', 'engine_electric_small', 'storage_battery', 'tank', 'alternator_car'), indexes);
    expect(report.engines[0]).toMatchObject({ ratedPowerW: 7040, fullLoadConsumptionW: 8000, fuelOptions: ['battery'] });
    expect(report.batteryCapacity).toMatchObject({ known: 50000, complete: true });
    expect(report.tankVolume).toMatchObject({ known: 60000, complete: true });
    expect(report.electrical.find(e => e.partId === 'alternator_car')).toMatchObject({ generationW: 780, mechanicalLoadW: 1492 });
    expect(report.checks.find(c => c.code === 'fuel-supply')!.status).toBe('conditional');
  });
});
