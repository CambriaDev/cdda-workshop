/** gettext data only: never evaluates Plural-Forms JavaScript or HTML from a catalog. */
export interface Message { msgid: string; context?: string; plural?: string; translations: string[]; fuzzy: boolean }
export interface Catalog { domain: string; language: string; pluralForms: string; messages: Message[] }
export const messageKey = (id: string, context = '') => `${context}\u0004${id}`;
export function parsePo(text: string, domain = 'dda'): Catalog {
  const messages: Message[] = []; let current: Message = { msgid: '', translations: [], fuzzy: false }; let active = ''; let index = 0; let touched = false;
  const flush = () => { if (touched) messages.push(current); current = { msgid: '', translations: [], fuzzy: false }; active = ''; index = 0; touched = false; };
  const append = (s: string) => { if (active === 'msgid') current.msgid += s; else if (active === 'msgctxt') current.context = (current.context ?? '') + s; else if (active === 'msgid_plural') current.plural = (current.plural ?? '') + s; else if (active === 'msgstr') current.translations[index] = (current.translations[index] ?? '') + s; };
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) { flush(); continue; }
    if (line.startsWith('#~')) continue;
    if (line.startsWith('#,')) { if (/\bfuzzy\b/.test(line)) current.fuzzy = true; continue; }
    if (line.startsWith('#')) continue;
    const m = /^(msgctxt|msgid_plural|msgid|msgstr)(?:\[(\d+)\])?\s+(".*")\s*$/.exec(line);
    if (m) { if (m[1] === 'msgid' && touched && active === 'msgstr') flush(); active = m[1]; index = Number(m[2] ?? 0); touched = true; append(JSON.parse(m[3]) as string); }
    else if (/^"/.test(line.trim())) append(JSON.parse(line.trim()) as string);
  }
  flush(); const header = messages.find(m => !m.msgid)?.translations[0] ?? '';
  return { domain, language: /Language:\s*([^\n]*)/i.exec(header)?.[1]?.trim() ?? 'zh_CN', pluralForms: /Plural-Forms:\s*([^\n]*)/i.exec(header)?.[1]?.trim() ?? '', messages: messages.filter(m => !!m.msgid) };
}
const catalogIndexes = new WeakMap<Catalog, Map<string, Message>>();
export function gettext(catalog: Catalog | undefined, msgid: string, options: { context?: string; n?: number; plural?: string; locale?: string } = {}): string {
  const { context = '', n = 1, plural, locale = 'zh-CN' } = options;
  const fallback = n === 1 ? msgid : (plural ?? msgid);
  if (!catalog || locale.startsWith('en')) return fallback;
  let indexMap = catalogIndexes.get(catalog);
  if (!indexMap) { indexMap = new Map(catalog.messages.map(m => [messageKey(m.msgid, m.context), m])); catalogIndexes.set(catalog, indexMap); }
  const entry = indexMap.get(messageKey(msgid, context));
  if (!entry || entry.fuzzy) return fallback;
  // Only distributed zh_CN (nplurals=1, plural=0) and English rule are supported.
  const index = /nplurals\s*=\s*1\b/.test(catalog.pluralForms) || /^zh/i.test(catalog.language) ? 0 : n === 1 ? 0 : 1;
  return entry.translations[index] || fallback;
}
export function translationText(value: unknown, catalog?: Catalog, locale = 'zh-CN', n = 1): string {
  if (typeof value === 'string') return gettext(catalog, value, { locale, n });
  if (!value || typeof value !== 'object') return '';
  const v = value as Record<string, unknown>; const id = String(v.str ?? v.str_sp ?? '');
  return gettext(catalog, id, { locale, n, context: typeof v.ctxt === 'string' ? v.ctxt : undefined, plural: typeof v.str_pl === 'string' ? v.str_pl : undefined });
}
export const translate = translationText;
