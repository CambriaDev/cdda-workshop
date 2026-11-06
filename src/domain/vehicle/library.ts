import type { Composition, ResolvedDefinition } from '../data';
import { flags, type Definition } from './types';

export type LibraryExclusion = 'not-vehicle-part' | 'abstract' | 'appliance' | 'hidden';
export interface VehicleLibraryEntry {
  id: string;
  definition: ResolvedDefinition;
  baseItemId?: string;
  playerInstallationForbidden: boolean;
}
export interface VehicleLibrary {
  entries: VehicleLibraryEntry[];
  byId: ReadonlyMap<string, VehicleLibraryEntry>;
  excluded: { id: string; reason: LibraryExclusion }[];
}

/** Ordinary construction catalog rules from veh_interact.cpp:2224–2230.
 * NO_INSTALL_PLAYER remains visible for prototype design, with a UI warning.
 * A bare NO_INSTALL has no rule in 0.I. Never infer identity from an ap_ prefix.
 */
export function vehicleLibraryExclusion(definition: Definition): LibraryExclusion | undefined {
  if (definition.type !== 'vehicle_part') return 'not-vehicle-part';
  if (definition._abstract === true) return 'abstract';
  const effectiveFlags = flags(definition);
  if (effectiveFlags.includes('APPLIANCE')) return 'appliance';
  if (effectiveFlags.includes('NO_INSTALL_HIDDEN')) return 'hidden';
  return undefined;
}
export function isVehicleLibraryPart(definition: Definition | undefined): boolean {
  return definition !== undefined && vehicleLibraryExclusion(definition) === undefined;
}

/** Rebuild from the current, fully composed part namespace, never from items.
 * The catalog is a disposable projection: imports/validation retain the complete
 * indexes. Re-run after every mod composition; no persisted catalog or ID rewrite.
 */
export function buildVehicleLibrary(composition: Pick<Composition, 'parts'> | null): VehicleLibrary {
  const entries: VehicleLibraryEntry[] = [];
  const excluded: VehicleLibrary['excluded'] = [];
  const definitions = Object.values(composition?.parts ?? {}).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const definition of definitions) {
    const reason = vehicleLibraryExclusion(definition);
    if (reason) { excluded.push({ id: definition.id, reason }); continue; }
    entries.push({
      id: definition.id,
      definition,
      ...(typeof definition.item === 'string' ? { baseItemId: definition.item } : {}),
      playerInstallationForbidden: flags(definition).includes('NO_INSTALL_PLAYER'),
    });
  }
  return { entries, byId: new Map(entries.map(entry => [entry.id, entry])), excluded };
}
