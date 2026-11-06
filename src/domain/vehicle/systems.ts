import { describePart } from './details';
import { nestedItems } from './stats';
import { definitionFieldsReliable, flags, record, type Definition, type Metric, type VehicleIndexes, type VehicleModel } from './types';

export type VehiclePurpose = 'self-propelled' | 'passive';
export type SystemCheckStatus = 'present' | 'missing' | 'conditional' | 'unknown' | 'not-applicable';
export interface SystemPart {
  partIndex: number; partId: string; baseItemId: string | null; x: number; y: number;
  notes: string[]; enabled: boolean | null; damage: number | null;
}
export interface EngineSystem extends SystemPart {
  ratedPowerW: number | null; fullLoadConsumptionW: number | null;
  fuelOptions: string[] | null; conditional: boolean;
}
export interface StorageSystem extends SystemPart {
  kind: 'tank' | 'battery' | 'fuel'; capacity: number | null; unit: 'ml' | 'charges';
  ammoTypes: string[]; restricted: boolean; allowedFuel: string | null; fuelRestrictionKnown: boolean;
  recordedResources: { itemId: string; charges: number | null }[]; contentsUnknown: boolean;
}
export interface ElectricalSystem extends SystemPart {
  generationW: number | null; consumptionW: number | null; mechanicalLoadW: number | null;
}
export interface SystemCheck {
  code: string; status: SystemCheckStatus; severity: 'info' | 'warning';
  partIndices: number[]; notes: string[]; reference: string;
}
export interface VehicleSystemsReport {
  engines: EngineSystem[]; stores: StorageSystem[]; electrical: ElectricalSystem[];
  tankVolume: Metric; batteryCapacity: Metric; unknownParts: number;
  checks: SystemCheck[];
}

const newMetric = (unit: string): Metric => ({ known: 0, missing: 0, complete: true, unit });
const add = (metric: Metric, n: number | null) => {
  if (n === null || !Number.isFinite(metric.known + n) || metric.known + n > Number.MAX_SAFE_INTEGER) {
    metric.missing++; metric.complete = false;
  } else metric.known += n;
};
const subtype = (d: Definition | undefined, type: string) => d?.type === type || (Array.isArray(d?.subtypes) && d.subtypes.includes(type));
const validStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');
const specialFuels = new Set(['muscle', 'animal', 'wind', 'null']);
const reference = {
  engine: 'vehicle_use.cpp:795–831', fuel: 'vehicle_use.cpp:626–668; vehicle.cpp:3861–3927',
  starter: 'vehicle_use.cpp:706–724', controls: 'game.cpp:5927–5996; vehicle_use.cpp:1990–1994',
  wheels: 'vehicle.cpp:4984–4997; veh_interact.cpp:2372–2417',
  steering: 'vehicle.cpp:5128–5165', boat: 'vehicle.cpp:4705–4712; 4856–4912',
};

/** Installed nominal design, not a simulation of available game caches or operating state.
 * Audited against 0.I-1 / 7b2efa5. Inputs, project history and export validation are untouched.
 */
export function analyzeVehicleSystems(vehicle: VehicleModel, indexes: VehicleIndexes, purpose: VehiclePurpose = 'self-propelled'): VehicleSystemsReport {
  const report: VehicleSystemsReport = { engines: [], stores: [], electrical: [], tankVolume: newMetric('ml'), batteryCapacity: newMetric('charges'), unknownParts: 0, checks: [] };
  const partFlags: (string[] | null)[] = [];
  let storageUnknown = false;
  const check = (code: string, status: SystemCheckStatus, notes: string[], ref: string, partIndices: number[] = []) => {
    report.checks.push({ code, status, notes, reference: ref, partIndices, severity: status === 'missing' ? 'warning' : 'info' });
  };
  // Cache repeated installed definitions, but never cache instance contents/state.
  const detailsCache = new Map<string, ReturnType<typeof describePart>>();
  vehicle.parts.forEach((p, partIndex) => {
    const d = indexes.parts.get(p.id);
    const reliableFlags = definitionFieldsReliable(d, ['flags']) && (d?.flags === undefined || validStrings(d.flags));
    const fs = reliableFlags ? flags(d) : null; partFlags.push(fs);
    if (!fs) { report.unknownParts++; storageUnknown = true; }
    const baseItemId = typeof p.base?.typeid === 'string' ? p.base.typeid : definitionFieldsReliable(d, ['item']) && typeof d?.item === 'string' ? d.item : null;
    const item = baseItemId ? indexes.items.get(baseItemId) : undefined;
    const key = JSON.stringify([p.id, baseItemId]);
    let detail = detailsCache.get(key);
    if (!detail) { detail = describePart(p.id, indexes, baseItemId ?? undefined); detailsCache.set(key, detail); }
    const number = (id: string): number | null => {
      const f = detail.sections.flatMap(s => s.fields).find(f => f.id === id);
      return f?.status !== 'unknown' && typeof f?.value === 'number' && Number.isFinite(f.value) && f.value >= 0 ? f.value : null;
    };
    const common: SystemPart = {
      partIndex, partId: p.id, baseItemId, x: p.mount_dx, y: p.mount_dy,
      notes: [], enabled: typeof p.enabled === 'boolean' ? p.enabled : null,
      damage: typeof p.base?.damaged === 'number' && Number.isFinite(p.base.damaged) ? p.base.damaged : null,
    };
    if (common.damage !== null && common.damage > 0) common.notes.push('recorded_damage');
    if (p.base?.faults?.length) common.notes.push('recorded_faults');
    if (p.enabled === false) common.notes.push('recorded_disabled');
    if (fs?.includes('ENGINE')) {
      let fuelOptions: string[] | null = null;
      if (definitionFieldsReliable(d, ['fuel_type', 'fuel_options'])) {
        const options = d?.fuel_options;
        if ((options === undefined || validStrings(options)) && typeof d?.fuel_type === 'string') fuelOptions = [...new Set([d.fuel_type, ...((options as string[] | undefined) ?? [])])];
      }
      report.engines.push({ ...common, ratedPowerW: number('mechanical_output'), fullLoadConsumptionW: number('full_load_consumption'), fuelOptions, conditional: !!fuelOptions?.some(f => ['muscle', 'animal', 'wind'].includes(f)) });
    }
    if (fs && (['epower', 'power'].some(k => d?.[k] !== undefined || !definitionFieldsReliable(d, [k])) || fs.some(f => ['ALTERNATOR', 'SOLAR_PANEL', 'WIND_TURBINE', 'WATER_WHEEL', 'REACTOR', 'ENABLED_DRAINS_EPOWER'].includes(f)))) {
      const generationW = number('generation'), consumptionW = number('fixed_consumption'), mechanicalLoadW = number('mechanical_load');
      if (generationW !== 0 || consumptionW !== 0 || mechanicalLoadW !== 0) report.electrical.push({ ...common, generationW, consumptionW, mechanicalLoadW });
    }
    const pocketsReliable = definitionFieldsReliable(item, ['pocket_data', 'type', 'subtypes']);
    const pockets = pocketsReliable && Array.isArray(item?.pocket_data) && item.pocket_data.every(record) ? item.pocket_data : null;
    const containers = pockets?.filter(p => p.pocket_type === 'CONTAINER' || p.pocket_type === undefined) ?? [];
    const magazines = pockets?.filter(p => p.pocket_type === 'MAGAZINE') ?? [];
    const isMagazine = subtype(item, 'MAGAZINE');
    const tank = containers.some(p => p.watertight === true);
    const batteryMagazine = isMagazine && magazines.some(p => record(p.ammo_restriction) && 'battery' in p.ammo_restriction);
    const isBattery = fs?.includes('BATTERY') || batteryMagazine;
    const isTank = tank || fs?.includes('FLUIDTANK');
    const isFuel = isMagazine || fs?.includes('REACTOR');
    const uncertainStorage = !fs || !pocketsReliable || (item?.pocket_data !== undefined && !pockets);
    if (uncertainStorage) storageUnknown = true;
    if (!isBattery && !isTank && !isFuel) return;
    const kind = isBattery ? 'battery' : isTank ? 'tank' : 'fuel';
    const restricted = !!pockets?.some(p => ['item_restriction', 'flag_restriction', 'material_restriction', 'holster', 'ablative', 'min_item_length', 'max_item_length', 'min_item_volume', 'max_item_volume'].some(k => p[k] !== undefined && p[k] !== false));
    const ammoTypes = [...new Set(magazines.flatMap(p => record(p.ammo_restriction) ? Object.keys(p.ammo_restriction) : []))];
    const supported = !uncertainStorage && pockets?.length === 1 && !restricted;
    let capacity = supported ? number(kind === 'battery' ? 'battery_capacity' : kind === 'tank' ? 'container_capacity' : 'ammo_capacity') : null;
    // A BATTERY flag without a proven battery magazine does not invent capacity.
    if (kind === 'battery' && (!batteryMagazine || !ammoTypes.includes('battery'))) capacity = null;
    if (kind === 'tank' && !tank) capacity = null;
    const nested = p.base ? nestedItems(p.base) : null;
    const recordedResources = nested?.items.map(i => ({ itemId: i.typeid!, charges: typeof i.charges === 'number' && Number.isSafeInteger(i.charges) && i.charges >= 0 ? i.charges : null })) ?? [];
    const fuelRestrictionKnown = definitionFieldsReliable(d, ['fuel_type']) && (d?.fuel_type === undefined || typeof d.fuel_type === 'string');
    const allowedFuel = fuelRestrictionKnown && typeof d?.fuel_type === 'string' && d.fuel_type !== 'null' && !fs?.includes('REACTOR') ? d.fuel_type : null;
    const store: StorageSystem = { ...common, kind, capacity, unit: kind === 'tank' ? 'ml' : 'charges', ammoTypes, restricted, allowedFuel, fuelRestrictionKnown,
      recordedResources, contentsUnknown: !p.base || p.base.contents == null || !!nested?.unsupported };
    if (!supported) store.notes.push('unsupported_capacity');
    if (restricted) store.notes.push('restricted_storage');
    if (kind === 'tank') store.notes.push('nominal_volume_not_fuel_capacity');
    report.stores.push(store);
    if (kind === 'tank') add(report.tankVolume, capacity);
    if (kind === 'battery') add(report.batteryCapacity, capacity);
  });
  if (storageUnknown) { add(report.tankVolume, null); add(report.batteryCapacity, null); }
  if (!vehicle.parts.length) { check('empty-vehicle', 'not-applicable', ['empty_design'], reference.engine); return report; }
  if (report.unknownParts) check('unknown-definitions', 'unknown', ['unclassified_parts'], 'definitionFieldsReliable');
  const present = (flag: string) => partFlags.flatMap((fs, i) => fs?.includes(flag) ? [i] : []);
  const existence = (indices: number[]): SystemCheckStatus => indices.length ? 'present' : report.unknownParts ? 'unknown' : 'missing';
  check('required-engine', purpose === 'passive' ? 'not-applicable' : existence(report.engines.map(e => e.partIndex)), [purpose === 'passive' ? 'passive_design' : 'self_propulsion_only'], reference.engine, report.engines.map(e => e.partIndex));

  const batteryStores = report.stores.filter(s => s.kind === 'battery');
  const batteryStatus = (): SystemCheckStatus => batteryStores.some(s => s.capacity !== null && s.capacity > 0) ? 'conditional' : storageUnknown || batteryStores.some(s => s.capacity === null) ? 'unknown' : 'missing';
  for (const engine of report.engines) {
    const engineDef = indexes.parts.get(engine.partId);
    const options = engine.fuelOptions;
    let status: SystemCheckStatus = 'unknown';
    const notes: string[] = [];
    if (!options?.length) notes.push('unknown_fuel');
    else if (options.some(f => specialFuels.has(f))) { status = 'conditional'; notes.push('external_or_no_fuel'); }
    else {
      const paths = options.map(fuelId => {
        if (fuelId === 'battery') return batteryStatus();
        const fuel = indexes.items.get(fuelId);
        if (!definitionFieldsReliable(fuel, ['flags', 'phase', 'ammo_type', 'ammo', 'type', 'subtypes'])) return 'unknown';
        if (flags(fuel).includes('PERPETUAL')) return 'conditional';
        const ammoType = typeof fuel?.ammo_type === 'string' ? fuel.ammo_type : record(fuel?.ammo) && typeof fuel.ammo.ammo_type === 'string' ? fuel.ammo.ammo_type : undefined;
        // An unrestricted simple watertight tank is a design storage route for liquids;
        // this says nothing about quantity, freezing or maximum fuel-specific weight.
        const phase = typeof fuel?.phase === 'string' ? fuel.phase.toLowerCase() : 'solid';
        const acceptsType = (s: StorageSystem) => s.fuelRestrictionKnown && (s.allowedFuel === null || s.allowedFuel === fuelId);
        const positiveCapacity = (s: StorageSystem) => s.capacity !== null && s.capacity > 0 && !s.restricted;
        const matching = report.stores.some(s => acceptsType(s) && positiveCapacity(s) && (
          (phase === 'liquid' && s.kind === 'tank') ||
          (!!ammoType && s.kind !== 'tank' && s.ammoTypes.includes(ammoType) && (phase === 'solid' || partFlags[s.partIndex]?.includes('REACTOR')))
        ));
        if (matching) return 'conditional';
        // Gas/plasma containment and fuel-specific capacity are not implemented;
        // do not mistake an unmodeled permitted tank route for definite absence.
        const unsupportedFluid = ['gas', 'plasma'].includes(phase) && report.stores.some(s => s.kind === 'tank' && acceptsType(s) && positiveCapacity(s));
        return storageUnknown || unsupportedFluid || report.stores.some(s => s.capacity === null || s.restricted || !s.fuelRestrictionKnown) ? 'unknown' : 'missing';
      });
      status = paths.includes('conditional') ? 'conditional' : paths.includes('unknown') ? 'unknown' : 'missing';
      notes.push(status === 'missing' ? 'no_compatible_storage' : 'fuel_amount_not_verified');
      if (options.includes('battery')) notes.push('external_power_not_verified');
    }
    check('fuel-supply', status, notes, reference.fuel, [engine.partIndex]);
    const item = engine.baseItemId ? indexes.items.get(engine.baseItemId) : undefined;
    const faultsReliable = definitionFieldsReliable(item, ['faults', 'faults_potential']);
    // item_factory.cpp:4168–4180 uses objects, not strings. Fault groups require
    // game finalization; never guess that an unresolved group has no starter.
    const potential = item?.faults;
    const faultEntries = Array.isArray(potential) && potential.every(record) ? potential : null;
    const starter = faultsReliable && !!faultEntries?.some(f => f.fault === 'fault_engine_starter');
    const uncertainStarter = !faultsReliable || item?.faults_potential !== undefined || (potential !== undefined && (!faultEntries || faultEntries.some(f => typeof f.fault !== 'string' || f.fault_group !== undefined)));
    if (starter || uncertainStarter) check('starter-battery', starter ? batteryStatus() : 'unknown', [starter ? 'starter_requires_battery' : 'starter_requirement_unknown', 'external_power_not_verified'], reference.starter, [engine.partIndex]);
    // Fuel defaulting/finalization not proven by raw missing fields must stay unknown.
    if (!definitionFieldsReliable(engineDef, ['fuel_type'])) engine.notes.push('unknown_fuel');
  }
  const localControls = present('CONTROLS'), remoteControls = present('REMOTE_CONTROLS'), animalControls = present('CONTROL_ANIMAL');
  const controlIndices = [...localControls, ...remoteControls, ...animalControls];
  let controlsStatus = existence(controlIndices);
  if (!localControls.length && (remoteControls.length || animalControls.length)) controlsStatus = 'conditional';
  check('driving-controls', purpose === 'passive' ? 'not-applicable' : controlsStatus,
    [purpose === 'passive' ? 'passive_design' : localControls.length ? 'local_controls' : remoteControls.length ? 'remote_control_conditions' : animalControls.length ? 'animal_control_conditions' : 'electronic_is_not_driving'], reference.controls, controlIndices);
  const wheels = present('WHEEL'), floats = present('FLOATS'), steering = [...new Set([...present('STEERABLE'), ...present('TRACKED')])];
  const landDesign = wheels.length > 0 || floats.length === 0;
  if (purpose === 'passive') {
    check('wheel-count', 'not-applicable', ['passive_design'], reference.wheels, wheels);
    check('steering', 'not-applicable', ['passive_design'], reference.steering, steering);
  } else if (!landDesign) {
    check('wheel-count', 'not-applicable', ['boat_not_road_vehicle'], reference.wheels);
    check('steering', 'conditional', ['water_steering_requires_flotation'], reference.steering);
  } else if (present('ROTOR').length && !wheels.length) {
    check('wheel-count', 'not-applicable', ['aircraft_not_road_vehicle'], reference.wheels);
    check('steering', 'conditional', ['flight_requires_runtime'], reference.steering);
  } else {
    const structures = vehicle.parts.filter(p => {
      const d = indexes.parts.get(p.id);
      return definitionFieldsReliable(d, ['location']) && d?.location === 'structure';
    }).length;
    const stableSingle = wheels.length === 1 && partFlags[wheels[0]!]!.includes('STABLE') && structures <= 3;
    let wheelStatus: SystemCheckStatus = wheels.length >= 2 || stableSingle ? 'present' : 'missing';
    if (report.unknownParts || (wheels.length === 1 && vehicle.parts.some(p => !definitionFieldsReliable(indexes.parts.get(p.id), ['location'])))) wheelStatus = 'unknown';
    check('wheel-count', wheelStatus, ['intact_design_only'], reference.wheels, wheels);
    check('steering', existence(steering), ['intact_design_only', 'animal_steering_conditional'], reference.steering, steering);
  }
  if (floats.length) check('boat-flotation', 'unknown', ['flotation_requires_mass_and_state'], reference.boat, floats);
  check('runtime', 'unknown', ['runtime_not_simulated'], 'vehicle.cpp:1125–1200; 4052–4080');
  return report;
}
