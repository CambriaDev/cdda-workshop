import type { Metric } from './types';
import type { ElectricalSystem, EngineSystem, StorageSystem, SystemPart, VehicleSystemsReport } from './systems';

const units = { enginePower: 'W', fullLoadInput: 'W', tankVolume: 'ml', batteryCapacity: 'charges', recordedBattery: 'charges', electricalDemand: 'W', generation: 'W', mechanicalLoad: 'W', accessoryLoad: 'W', engineAuxiliaryLoad: 'W', electricDriveLoad: 'W', rechargeLoad: 'W' } as const;
export type SystemTotals = { [K in keyof typeof units]: Metric };
export interface SystemLoadComponents { accessoryLoad: Metric; engineAuxiliaryLoad: Metric; electricDriveLoad: Metric; rechargeLoad: Metric; batteryModeInput: Metric }
export interface FuelCapacity { ammoType: string; capacity: Metric }
export interface SystemGroup<T extends SystemPart> { key: string; members: T[]; totals: SystemTotals; loadComponents: SystemLoadComponents; fuelCapacities: FuelCapacity[] }
export interface VehicleSystemsSummary {
  totals: SystemTotals; loadComponents: SystemLoadComponents; fuelCapacities: FuelCapacity[];
  groups: { engines: SystemGroup<EngineSystem>[]; stores: SystemGroup<StorageSystem>[]; electrical: SystemGroup<ElectricalSystem>[] };
}
const metric = (unit: string): Metric => ({ known: 0, missing: 0, complete: true, unit });
/** A metric's missing count is physical parts, not failed component fields. */
function accumulator(unit: string) {
  const value = metric(unit), unknown = new Set<number>();
  return { value, add(partIndex: number, n: number | null) {
    if (n === null || !Number.isFinite(n) || n < 0 || !Number.isFinite(value.known + n) || value.known + n > Number.MAX_SAFE_INTEGER) {
      unknown.add(partIndex); value.missing = unknown.size; value.complete = false;
    } else value.known += n;
  } };
}
export function summarizeSystemCapacities(report: Pick<VehicleSystemsReport, 'stores' | 'unknownPartIndices' | 'unknownStoragePartIndices'>) {
  const tank = accumulator('ml'), battery = accumulator('charges'), recorded = accumulator('charges');
  const fuel = new Map<string, ReturnType<typeof accumulator>>();
  for (const s of report.stores) {
    if (s.kind === 'tank') tank.add(s.partIndex, s.capacity);
    if (s.kind === 'battery') {
      battery.add(s.partIndex, s.capacity);
      if (s.contentsUnknown) recorded.add(s.partIndex, null);
      for (const r of s.recordedResources) {
        if (!r.ammoTypeKnown || r.ammoType !== 'battery') recorded.add(s.partIndex, null);
        else recorded.add(s.partIndex, r.charges);
      }
    }
    if (s.kind !== 'fuel') continue;
    for (const type of new Set(s.ammoTypes.filter(t => t !== 'battery'))) {
      let total = fuel.get(type); if (!total) { total = accumulator('charges'); fuel.set(type, total); }
      // Alternatives name possible types, not simultaneous additive capacities.
      total.add(s.partIndex, s.ammoTypes.length === 1 && !s.restricted ? s.capacity : null);
    }
  }
  for (const i of new Set([...report.unknownPartIndices, ...report.unknownStoragePartIndices])) {
    tank.add(i, null); battery.add(i, null); recorded.add(i, null);
  }
  return { tankVolume: tank.value, batteryCapacity: battery.value, recordedBattery: recorded.value, fuelCapacities: [...fuel].map(([ammoType, v]) => ({ ammoType, capacity: v.value })) };
}
function calculate(report: VehicleSystemsReport) {
  const a = Object.fromEntries(Object.entries(units).map(([key, unit]) => [key, accumulator(unit)])) as { [K in keyof SystemTotals]: ReturnType<typeof accumulator> };
  const batteryMode = accumulator('W');
  for (const e of report.engines) {
    a.enginePower.add(e.partIndex, e.conditional || !e.fuelOptions?.length ? null : e.ratedPowerW);
    a.fullLoadInput.add(e.partIndex, e.fullLoadConsumptionW);
  }
  for (const e of report.electrical) {
    a.generation.add(e.partIndex, e.generationW);
    a.mechanicalLoad.add(e.partIndex, e.mechanicalLoadW);
    for (const [name, n] of [['accessoryLoad', e.accessoryLoadW], ['engineAuxiliaryLoad', e.engineAuxiliaryLoadW], ['electricDriveLoad', e.electricDriveLoadW], ['rechargeLoad', e.rechargeLoadW]] as const) {
      a[name].add(e.partIndex, n); a.electricalDemand.add(e.partIndex, n);
    }
    batteryMode.add(e.partIndex, e.batteryModeInputW);
  }
  for (const i of report.unknownPartIndices) {
    for (const v of Object.values(a)) v.add(i, null);
    batteryMode.add(i, null);
  }
  const capacities = summarizeSystemCapacities(report);
  const totals = { ...Object.fromEntries(Object.entries(a).map(([key, v]) => [key, v.value])), tankVolume: capacities.tankVolume, batteryCapacity: capacities.batteryCapacity, recordedBattery: capacities.recordedBattery } as SystemTotals;
  const loadComponents: SystemLoadComponents = { accessoryLoad: totals.accessoryLoad, engineAuxiliaryLoad: totals.engineAuxiliaryLoad, electricDriveLoad: totals.electricDriveLoad, rechargeLoad: totals.rechargeLoad, batteryModeInput: batteryMode.value };
  return { totals, loadComponents, fuelCapacities: capacities.fuelCapacities };
}
/** Pure nominal subtotal/group view: never reclassifies by names, simulates runtime,
 * merges unlike charge units, mutates a report, or invents zero for unknown parts.
 * Group keys are stable [kind, partId, baseItemId], preserving first-seen order.
 */
export function summarizeVehicleSystems(report: VehicleSystemsReport): VehicleSystemsSummary {
  function groups<T extends SystemPart>(rows: T[], kind: (row: T) => string): SystemGroup<T>[] {
    const grouped = new Map<string, T[]>();
    for (const row of rows) { const key = JSON.stringify([kind(row), row.partId, row.baseItemId]); const list = grouped.get(key); if (list) list.push(row); else grouped.set(key, [row]); }
    return [...grouped].map(([key, members]) => {
      const ids = new Set(members.map(m => m.partIndex));
      return { key, members, ...calculate({ ...report,
        engines: report.engines.filter(e => ids.has(e.partIndex)), stores: report.stores.filter(s => ids.has(s.partIndex)), electrical: report.electrical.filter(e => ids.has(e.partIndex)),
        unknownPartIndices: report.unknownPartIndices.filter(i => ids.has(i)), unknownStoragePartIndices: report.unknownStoragePartIndices.filter(i => ids.has(i)),
      }) };
    });
  }
  return { ...calculate(report), groups: { engines: groups(report.engines, () => 'engine'), stores: groups(report.stores, s => s.kind), electrical: groups(report.electrical, () => 'electrical') } };
}
