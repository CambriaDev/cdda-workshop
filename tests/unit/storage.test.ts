import { describe, expect, it } from 'vitest';
import { safeFilename } from '../../src/storage/local';
describe('download filenames', () => {
  it('removes path separators/control characters and Windows reserved names', () => {
    expect(safeFilename('../world/CON.sav')).not.toMatch(/[/\\\x00-\x1f]/);
    expect(safeFilename('CON.template')).toBe('export_CON.template');
    expect(safeFilename('NUL')).toBe('export_NUL');
    expect(safeFilename('..')).toBe('export_');
    expect(safeFilename('valid.  ')).toBe('valid');
  });
  it('keeps the output extension when shortening user-entered names', () => {
    const value = safeFilename('车'.repeat(200) + '.template');
    expect(value.length).toBeLessThanOrEqual(96);
    expect(value.endsWith('.template')).toBe(true);
  });
});
