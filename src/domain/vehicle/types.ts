import { cloneLosslessJSON, type JsonValue } from '../save/losslessJson';

export interface Definition { id: string; type: string; [key: string]: unknown }
export interface ItemInstance { typeid?: string; charges?: number; damaged?: number; degradation?: number; faults?: unknown[]; [key: string]: unknown }
export interface VehiclePart { id: string; mount_dx: number; mount_dy: number; variant?: string; base?: ItemInstance; items?: ItemInstance[]; tools?: ItemInstance[]; [key: string]: unknown }
export interface VehicleModel { name: string; parts: VehiclePart[]; [key: string]: unknown }
export interface VehicleIndexes { parts: Map<string, Definition>; items: Map<string, Definition>; flagRequirements?: Map<string, string> }
export interface Issue { code: string; severity: 'warning' | 'error'; message: string; partIndex?: number; path?: string }
export interface EditResult { vehicle: VehicleModel; issues: Issue[]; ok: boolean }
export interface ProjectMetadata { datasetId?: string; gameVersion?: string; saveVersion?: number; modOrder?: string[]; source?: unknown; [key: string]: unknown }
export interface VehicleProject { format: 'cdda-vehicle-project'; formatVersion: 1; metadata: ProjectMetadata; original: VehicleModel; vehicle: VehicleModel; history: unknown[]; warnings: Issue[]; [key: string]: unknown }
export interface Metric { known: number; missing: number; complete: boolean; unit: string }
export const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const clone = <T>(v: T): T => v === undefined ? v : cloneLosslessJSON(v as JsonValue) as T;
export const flags = (d?: Definition): string[] => Array.isArray(d?.flags) ? d.flags.filter((v): v is string => typeof v === 'string') : [];
/** Only affected fields are untrusted; old datasets without field detail remain conservative. */
export function definitionFieldsReliable(d: Definition | undefined, fields: readonly string[]): boolean {
  if (!d) return false;
  const affected = d._incompleteFields;
  if (!Array.isArray(affected)) return d._incomplete !== true;
  if (!affected.every(v => typeof v === 'string')) return false;
  if (affected.includes('*')) return false;
  return !affected.some(raw => {
    const path = raw.replaceAll('/', '.').replace(/\[.*?\]/g, '');
    return fields.some(field => path === field || path.startsWith(`${field}.`) || field.startsWith(`${path}.`));
  });
}
export const issue = (code: string, message: string, partIndex?: number, severity: Issue['severity'] = 'warning'): Issue => ({ code, message, severity, ...(partIndex === undefined ? {} : { partIndex }) });
export const GAME_VALIDATION_WARNING = 'Not validated in the 0.I-1 game. Static editor checks are not game import validation.';
export function assertVehicle(v: unknown): asserts v is VehicleModel {
  if (!record(v) || typeof v.name !== 'string' || !Array.isArray(v.parts)) throw new Error('Invalid vehicle: expected name and parts array');
  v.parts.forEach((p, i) => {
    if (!record(p) || typeof p.id !== 'string' || !p.id || !Number.isSafeInteger(p.mount_dx) || !Number.isSafeInteger(p.mount_dy)) throw new Error(`Invalid vehicle part ${i}: id or mount coordinates`);
    if (p.base !== undefined && !record(p.base)) throw new Error(`Invalid base item at part ${i}`);
    for (const field of ['items', 'tools']) if (p[field] !== undefined && (!Array.isArray(p[field]) || !(p[field] as unknown[]).every(record))) throw new Error(`Invalid ${field} at part ${i}`);
  });
}
export const createVehicle = (name = 'New vehicle'): VehicleModel => ({ name, parts: [] });
