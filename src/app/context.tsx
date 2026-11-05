import { createContext, useContext } from 'react';
import type { Composition, DatasetManifest, ResolvedDefinition, GameColorPalette } from '../domain/data';
import { translationText, type Catalog } from '../i18n/gettext';
export type Locale = 'zh-CN' | 'en-US';
export interface AppContextValue { locale: Locale; t: (zh: string, en: string) => string; composition: Composition | null; manifest: DatasetManifest | null; catalogs: Record<string, Catalog>; colors?: GameColorPalette; name: (d: ResolvedDefinition | undefined, fallback?: string) => string }
export const AppContext = createContext<AppContextValue>({ locale: 'zh-CN', t: zh => zh, composition: null, manifest: null, catalogs: {}, name: (d, fallback) => translationText(d?.name) || d?.id || fallback || '?' });
export const useApp = () => useContext(AppContext);
export function stripColors(text: string): string { return text.replace(/<\/?(?:color_[a-z_]+|color|good|bad|info|stat|neutral|bold)>/g, ''); }
