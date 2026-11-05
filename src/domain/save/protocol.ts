import { asSafeInteger, isJsonObject, parseLosslessJSON, SaveFormatError, stringifyLosslessJSON } from './losslessJson';
import type { JsonObject, JsonValue, ParseOptions } from './losslessJson';

export const SOURCE_SAVE_VERSION = 36;
export interface CompatibilityWarning { code: string; message: string; path?: string }
export interface SaveHeader { version: number; raw: string }
export interface ParsedSave {
  root: JsonObject;
  header: SaveHeader | null;
  bom: boolean;
  warnings: CompatibilityWarning[];
}

/** Only the optional first-line version directive is stripped; comments elsewhere remain errors. */
export function parseSave(text: string, options: ParseOptions = {}): ParsedSave {
  if (typeof text !== 'string') throw new SaveFormatError('Save input must be text');
  const bom = text.startsWith('\uFEFF');
  const clean = bom ? text.slice(1) : text;
  let body = clean;
  let header: SaveHeader | null = null;
  const warnings: CompatibilityWarning[] = [];
  if (clean.startsWith('#')) {
    const firstLine = /^(#[^\r\n]*)(\r?\n|$)/.exec(clean);
    if (!firstLine) throw new SaveFormatError('Invalid version header');
    const match = /^#\s*version[ \t]+(0|[1-9]\d*)[ \t]*$/.exec(firstLine[1]);
    if (!match) throw new SaveFormatError('Invalid version header');
    const version = Number(match[1]);
    if (!Number.isSafeInteger(version)) throw new SaveFormatError('Invalid version number');
    header = { version, raw: firstLine[0] };
    body = clean.slice(firstLine[0].length);
    if (!/^# version \d+\r?\n$/.test(header.raw)) {
      warnings.push({ code: 'NONCANONICAL_HEADER', message: 'Accepted a noncanonical #version header; the source writes # version N followed by newline.' });
    }
    if (version !== SOURCE_SAVE_VERSION) warnings.push({ code: 'UNVERIFIED_VERSION', message: 'This save version differs from the inspected source version 36.' });
  }
  const root = parseLosslessJSON(body, options);
  if (!isJsonObject(root)) throw new SaveFormatError('Character save root must be an object');
  if (root.savegame_loading_version !== undefined) {
    const bodyVersion = asSafeInteger(root.savegame_loading_version);
    if (bodyVersion === undefined || bodyVersion < 0) throw new SaveFormatError('Invalid savegame_loading_version');
    if (header && bodyVersion !== header.version) throw new SaveFormatError('Header and body save versions disagree');
    if (bodyVersion !== SOURCE_SAVE_VERSION && !warnings.some(w => w.code === 'UNVERIFIED_VERSION')) {
      warnings.push({ code: 'UNVERIFIED_VERSION', message: 'This body version differs from the inspected source version 36.' });
    }
  }
  if (!header && root.savegame_loading_version === undefined) warnings.push({ code: 'VERSION_MISSING', message: 'No save version was supplied; compatibility is unverified.' });
  return { root, header, bom, warnings };
}

/** Keeps original BOM and header bytes, not JSON whitespace/object order. No file I/O. */
export function stringifySave(save: ParsedSave, space = 2): string {
  if (!isJsonObject(save.root)) throw new SaveFormatError('Character save root must be an object');
  if (save.header) {
    const parsedHeader = /^#\s*version[ \t]+(0|[1-9]\d*)[ \t]*(?:\r?\n)?$/.exec(save.header.raw);
    if (!parsedHeader || Number(parsedHeader[1]) !== save.header.version ||
        (save.root.savegame_loading_version !== undefined && asSafeInteger(save.root.savegame_loading_version) !== save.header.version)) {
      throw new SaveFormatError('Inconsistent save version header');
    }
  }
  return (save.bom ? '\uFEFF' : '') + (save.header ? save.header.raw.replace(/([^\n])$/, '$1\n') : '') + stringifyLosslessJSON(save.root, space);
}

export type Tripoint = readonly [number, number, number];
export function requireInteger(value: unknown, label: string): number {
  const result = asSafeInteger(value);
  if (result === undefined || result < -2147483648 || result > 2147483647) {
    throw new SaveFormatError(`${label} must be a signed 32-bit integer`);
  }
  return result;
}
export function requireTripoint(value: unknown, label: string): Tripoint {
  if (!Array.isArray(value) || value.length !== 3) throw new SaveFormatError(`${label} must contain exactly three integers`);
  return [requireInteger(value[0], label), requireInteger(value[1], label), requireInteger(value[2], label)];
}
export interface PlayerCoordinates {
  absolute: Tripoint;
  source: 'location' | 'legacy-bubble';
  warnings: CompatibilityWarning[];
}

export function readPlayerCoordinates(root: JsonObject): PlayerCoordinates {
  if (!isJsonObject(root.player)) throw new SaveFormatError('Missing player object');
  const player = root.player;
  if (player.location !== undefined) return { absolute: requireTripoint(player.location, 'player.location'), source: 'location', warnings: [] };
  // Legacy posx/y/z are reality-bubble coordinates, NOT absolute coordinates.
  const x = requireInteger(player.posx, 'player.posx');
  const y = requireInteger(player.posy, 'player.posy');
  const z = requireInteger(player.posz, 'player.posz');
  const levx = requireInteger(root.levx, 'levx');
  const levy = requireInteger(root.levy, 'levy');
  const omx = requireInteger(root.om_x, 'om_x');
  const omy = requireInteger(root.om_y, 'om_y');
  const absolute = requireTripoint([(omx * 360 + levx) * 12 + x, (omy * 360 + levy) * 12 + y, z], 'legacy absolute position');
  return { absolute, source: 'legacy-bubble', warnings: [{ code: 'LEGACY_COORDINATES', message: 'Legacy bubble coordinates converted using source constants: 12 tiles/submap, 360 submaps/overmap. Other branches are unverified.' }] };
}

/** Source mapbuffer filenames are absolute overmap-terrain coordinates (24 tiles/quad). */
export function parseMapFileCoordinates(path: string): Tripoint | null {
  const match = /(?:^|[\\/])(-?(?:0|[1-9]\d*))\.(-?(?:0|[1-9]\d*))\.(-?(?:0|[1-9]\d*))\.map$/.exec(path);
  if (!match) return null;
  try { return requireTripoint(match.slice(1).map(Number), 'map filename'); }
  catch { return null; }
}

/**
 * No XY filename rejection: a saved vehicle anchor is not assumed to be in 0..11.
 * Defaults to full scan. Optional trusted filename Z filtering is source-layout-specific.
 */
export function mayContainNearbyVehicle(path: string, origin: Tripoint, options: { radius?: number; sameZ?: boolean; trustFilenameZ?: boolean } = {}): boolean {
  requireTripoint(origin, 'origin');
  if (options.radius !== undefined && (!Number.isSafeInteger(options.radius) || options.radius < 0 || options.radius > 1000000)) throw new SaveFormatError('Invalid radius');
  const coordinates = parseMapFileCoordinates(path);
  return !(options.trustFilenameZ && (options.sameZ ?? true) && coordinates && coordinates[2] !== origin[2]);
}

export interface MapScanInput { id?: string; path?: string; text: string }
export interface NearbyVehicle {
  inputId: string;
  submapIndex: number;
  vehicleIndex: number;
  name: string | null;
  type: string | null;
  absolute: Tripoint;
  distance: number;
  partCount: number | null;
  /** Lossless vehicle JSON text, safe to transfer between workers (unlike class instances). */
  snapshot: string;
}
export interface VehicleScanResult { vehicles: NearbyVehicle[]; warnings: CompatibilityWarning[]; scannedSubmaps: number }

/** Reads supplied .map JSON only. No file discovery, writes, vehicle extraction, or tile edits. */
export function scanNearbyVehicles(inputs: readonly MapScanInput[], origin: Tripoint, options: { radius?: number; sameZ?: boolean } = {}): VehicleScanResult {
  requireTripoint(origin, 'origin');
  const radius = options.radius ?? 60;
  if (!Number.isSafeInteger(radius) || radius < 0 || radius > 1000000) throw new SaveFormatError('Radius must be an integer in 0..1000000');
  if (options.sameZ !== undefined && typeof options.sameZ !== 'boolean') throw new SaveFormatError('sameZ must be boolean');
  const result: VehicleScanResult = { vehicles: [], warnings: [], scannedSubmaps: 0 };
  inputs.forEach((input, inputIndex) => {
    try {
      const maps = parseLosslessJSON(input.text.replace(/^\uFEFF/, ''));
      if (!Array.isArray(maps)) throw new SaveFormatError('Map root must be a submap array');
      maps.forEach((entry: JsonValue, submapIndex) => {
        if (!isJsonObject(entry)) throw new SaveFormatError('Submap must be an object');
        const coordinates = requireTripoint(entry.coordinates, 'submap.coordinates');
        const version = requireInteger(entry.version, 'submap.version');
        if (version !== SOURCE_SAVE_VERSION) result.warnings.push({ code: 'UNVERIFIED_MAP_VERSION', path: `inputs[${inputIndex}][${submapIndex}]`, message: 'Map submap version differs from inspected source version 36.' });
        result.scannedSubmaps++;
        // Uniform submaps can omit vehicles altogether.
        if (entry.vehicles === undefined) return;
        if (!Array.isArray(entry.vehicles)) throw new SaveFormatError('Submap vehicles must be an array');
        entry.vehicles.forEach((vehicle, vehicleIndex) => {
          try {
            if (!isJsonObject(vehicle)) throw new SaveFormatError('Vehicle must be an object');
            const x = requireInteger(vehicle.posx, 'vehicle.posx');
            const y = requireInteger(vehicle.posy, 'vehicle.posy');
            const absolute = requireTripoint([coordinates[0] * 12 + x, coordinates[1] * 12 + y, coordinates[2]], 'vehicle absolute position');
            const distance = Math.hypot(absolute[0] - origin[0], absolute[1] - origin[1]);
            if ((options.sameZ ?? true) && absolute[2] !== origin[2]) return;
            if (distance > radius) return;
            if (vehicle.name !== undefined && typeof vehicle.name !== 'string') throw new SaveFormatError('Vehicle name must be a string');
            if (vehicle.type !== undefined && typeof vehicle.type !== 'string') throw new SaveFormatError('Vehicle type must be a string');
            if (vehicle.parts !== undefined && !Array.isArray(vehicle.parts)) throw new SaveFormatError('Vehicle parts must be an array');
            result.vehicles.push({ inputId: input.id ?? input.path ?? String(inputIndex), submapIndex, vehicleIndex, name: typeof vehicle.name === 'string' ? vehicle.name : null, type: typeof vehicle.type === 'string' ? vehicle.type : null, absolute, distance, partCount: Array.isArray(vehicle.parts) ? vehicle.parts.length : null, snapshot: stringifyLosslessJSON(vehicle, 0) });
          } catch (error) {
            result.warnings.push({ code: 'INVALID_VEHICLE', path: `inputs[${inputIndex}][${submapIndex}].vehicles[${vehicleIndex}]`, message: error instanceof SaveFormatError ? error.message : 'Invalid vehicle' });
          }
        });
      });
    } catch (error) {
      result.warnings.push({ code: 'INVALID_MAP', path: `inputs[${inputIndex}]`, message: error instanceof SaveFormatError ? error.message : 'Invalid map input' });
    }
  });
  result.vehicles.sort((a, b) => a.distance - b.distance || a.inputId.localeCompare(b.inputId) || a.submapIndex - b.submapIndex || a.vehicleIndex - b.vehicleIndex);
  return result;
}
