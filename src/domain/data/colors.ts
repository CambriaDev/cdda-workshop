export type GameColorPalette = Record<string, string>;
const NAMES: Record<string, string> = { BLACK: 'black', RED: 'red', GREEN: 'green', BROWN: 'brown', BLUE: 'blue', MAGENTA: 'magenta', CYAN: 'cyan', GRAY: 'light_gray', DGRAY: 'dark_gray', LRED: 'light_red', LGREEN: 'light_green', YELLOW: 'yellow', LBLUE: 'light_blue', LMAGENTA: 'pink', LCYAN: 'light_cyan', WHITE: 'white' };
/** Read actual colordef records, never invent missing RGB channels. */
export function parseGameColors(raw: unknown): GameColorPalette {
  const result: GameColorPalette = Object.create(null);
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    if (record.type === 'colordef') {
      for (const [key, name] of Object.entries(NAMES)) {
        const rgb = record[key];
        if (Array.isArray(rgb) && rgb.length === 3 && rgb.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255)) result[name] = `rgb(${rgb.join(', ')})`;
      }
    } else Object.values(record).forEach(visit);
  }
  visit(raw); return result;
}
/** color.cpp basic/prefixed/highlight/inverse and foreground-background names.
 * Background "white" / "yellow" refer to non-bold curses base colors (GRAY/BROWN).
 * Terminal-specific blink animation and user custom-color remapping are not emulated.
 */
export function resolveGameColor(value: unknown, palette: GameColorPalette): { foreground?: string; background?: string } {
  if (typeof value !== 'string') return {};
  let name = value.replace(/^lt_/, 'light_').replace(/^dk_/, 'dark_');
  let mode = 'c';
  const prefix = /^([chi])_(.*)$/.exec(name); if (prefix) { mode = prefix[1]; name = prefix[2].replace(/^lt_/, 'light_').replace(/^dk_/, 'dark_'); }
  if (mode === 'h') return { foreground: palette[name], background: palette.blue };
  if (mode === 'i') return { foreground: palette.black, background: palette[name === 'black' ? 'light_gray' : name] };
  if (palette[name]) return { foreground: palette[name] };
  const match = /^(.*)_(red|white|green|yellow|magenta|cyan)$/.exec(name);
  if (!match) return {};
  const background = match[2] === 'white' ? 'light_gray' : match[2] === 'yellow' ? 'brown' : match[2];
  const foreground = match[1] === 'black' && match[2] !== 'white' ? 'dark_gray' : match[1];
  return { foreground: palette[foreground], background: palette[background] };
}
