import { assertVehicle, clone, GAME_VALIDATION_WARNING, issue, record, type ProjectMetadata, type VehicleModel, type VehicleProject } from './types';
import { parseLosslessJSON, stringifyLosslessJSON, type JsonValue } from '../save/losslessJson';
/** Preserve large IDs and noncanonical numeric tokens with the shared save adapter. */
export function parseJsonSafely(text: string): unknown {
  return parseLosslessJSON(text.replace(/^\uFEFF/, ''), { maxLength: 64 * 1024 * 1024 });
}
export function createProject(vehicle: VehicleModel, metadata: ProjectMetadata = {}): VehicleProject {
  assertVehicle(vehicle);
  return { format: 'cdda-vehicle-project', formatVersion: 1, metadata: clone(metadata), original: clone(vehicle), vehicle: clone(vehicle), history: [], warnings: [issue('game-unverified', GAME_VALIDATION_WARNING), issue('unknown-fields-preserved', 'Raw snapshot fields, including unrecognized/mod state, are retained but not fully interpreted. This project is editor-only, not a game-loadable save.')] };
}
export function parseProject(input: string | unknown): VehicleProject {
  const value = typeof input === 'string' ? parseJsonSafely(input) : clone(input);
  if (!record(value) || value.format !== 'cdda-vehicle-project' || value.formatVersion !== 1 || !record(value.metadata) || !Array.isArray(value.history) || !Array.isArray(value.warnings)) throw new Error('Unsupported or malformed vehicle project');
  assertVehicle(value.original); assertVehicle(value.vehicle);
  if (!value.warnings.every(w => record(w) && typeof w.code === 'string' && typeof w.message === 'string' && (w.severity === 'error' || w.severity === 'warning'))) throw new Error('Malformed project warning records');
  return value as unknown as VehicleProject;
}
export function serializeProject(project: VehicleProject): string { parseProject(project); return stringifyLosslessJSON(project as unknown as JsonValue, 2); }
export function updateProject(project: VehicleProject, vehicle: VehicleModel, event?: unknown): VehicleProject {
  assertVehicle(vehicle); const next = clone(project); next.vehicle = clone(vehicle); if (event !== undefined) next.history.push(clone(event)); return next;
}
