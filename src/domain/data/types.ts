export type JsonRecord = Record<string, unknown>;
export interface Definition { data: JsonRecord; source: string; hash?: string }
export interface Diagnostic { severity: 'info' | 'warning' | 'error'; code: string; message: string; package?: string; source?: string; id?: string }
export interface DataPackage { formatVersion?: number; id: string; name: string; definitions: Definition[]; dependencies?: string[]; conflicts?: string[]; obsolete?: boolean; hash?: string; gameVersion?: string; commit?: string; translations?: import('../../i18n/gettext').Catalog }
export interface PackageEntry { id: string; name: string; file: string | null; hash: string | null; dependencies: string[]; distributable: boolean; reasons: string[]; license: string | null; source: string; definitionCount: number; obsolete?: boolean; conflicts?: string[]; authors?: unknown; translationFile?: string; translationHash?: string }
export interface DatasetManifest { formatVersion: number; gameVersion: string; commit: string; packages: PackageEntry[]; assets: string[]; diagnostics: Diagnostic[]; [key: string]: unknown }
export type ResolvedDefinition = JsonRecord & { id: string; type: string; _source: string; _package: string; _abstract?: boolean; _incomplete?: boolean; _incompleteFields?: string[]; _generated?: boolean };
export interface Composition { parts: Record<string, ResolvedDefinition>; items: Record<string, ResolvedDefinition>; vehicles: Record<string, ResolvedDefinition>; byType: Record<string, Record<string, ResolvedDefinition>>; diagnostics: Diagnostic[]; enabledIds: string[] }
