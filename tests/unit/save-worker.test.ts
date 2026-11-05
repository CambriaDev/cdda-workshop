import { describe, expect, it } from 'vitest';
import { boundedMap, createSaveSession, readStableFile, summarizeCharacter } from '../../src/workers/save.worker';
import type { ReadDirectoryHandle, ReadFileHandle, SaveReply } from '../../src/workers/save.worker';
import { parseSave } from '../../src/domain/save';

const saveText = (name = 'Synthetic survivor') => `# version 36\n${JSON.stringify({ savegame_loading_version: 36, player: { name, location: [0, 0, 0], str_max: 8, skills: { survival: { level: 4 } }, mutations: { synthetic_trait: {} }, my_bionics: [{ id: 'synthetic_cbm' }], worn: [{ typeid: 'synthetic_coat' }], weapon: { typeid: 'synthetic_tool' }, inv: [{ typeid: 'synthetic_item' }], body: {}, vitamin_levels: {}, daily_vitamins: {}, assigned_invlet: [] } })}`;
function file(text: string, name: string, stamp = 1): File { return { name, size: text.length, lastModified: stamp, text: async () => text } as File; }
function handle(name: string, text: string): ReadFileHandle { return { kind: 'file', name, getFile: async () => file(text, name) }; }
function dir(name: string, children: (ReadDirectoryHandle | ReadFileHandle)[]): ReadDirectoryHandle { return { kind: 'directory', name, async *values() { yield* children; } }; }
const map = (name: string, huge = false) => `[{"version":36,"coordinates":[100,100,0],"vehicles":[{"name":"${name}","posx":-1200,"posy":-1200,"parts":[],"future_id":${huge ? '9007199254740993' : '1'}}]}]`;

describe('read-only save worker', () => {
  it('bounds file read concurrency to two and keeps result order', async () => {
    let active = 0, maximum = 0;
    const result = await boundedMap([0, 1, 2, 3, 4], async value => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--; return value * 2;
    });
    expect(maximum).toBe(2); expect(result).toEqual([0, 2, 4, 6, 8]);
  });
  it('detects changes both during reading and since initial selection', async () => {
    let reads = 0;
    const changing: ReadFileHandle = { kind: 'file', name: 'synthetic.sav', getFile: async () => file('{}', 'synthetic.sav', ++reads) };
    await expect(readStableFile({ path: 'synthetic.sav', handle: changing })).rejects.toThrow(/changed while reading/);
    const stable = { path: 'synthetic.sav', handle: handle('synthetic.sav', '{}'), fingerprint: { size: 3, lastModified: 1 } };
    await expect(readStableFile(stable)).rejects.toThrow(/changed since selection/);
  });
  it('returns progression/equipment summaries without returning the full save', () => {
    const summary = summarizeCharacter('0', parseSave(saveText()), ['synthetic_mod']);
    expect(summary.skills).toEqual([{ id: 'survival', level: '4' }]);
    expect(summary.equipment).toEqual([{ id: 'synthetic_coat', slot: 'worn' }, { id: 'synthetic_tool', slot: 'weapon' }]);
    expect(summary.mods).toEqual(['synthetic_mod']); expect('root' in summary).toBe(false);
  });
  it('supports multi-character file-only imports and native lossless template export without maps', async () => {
    const messages: SaveReply[] = [];
    const session = createSaveSession(message => messages.push(message));
    await session({ type: 'open', files: [file(saveText('Synthetic A'), 'a.sav'), file(saveText('Synthetic B'), 'b.sav'), file('{}', 'ignored.map')] });
    const opened = messages.find(message => message.type === 'opened');
    expect(opened?.type).toBe('opened');
    if (opened?.type !== 'opened') throw new Error('Missing opened reply');
    expect(opened.characters).toHaveLength(2); expect(opened.mapCount).toBe(0); expect(opened.directory).toBe(false);
    await session({ type: 'template', characterId: '1', options: {} });
    const template = messages.find(message => message.type === 'template');
    if (template?.type !== 'template') throw new Error('Missing template reply');
    expect(JSON.parse(template.result.text)[0].limit).toBe(3);
    expect(JSON.parse(template.result.text)[1].name).toBe('Synthetic B');
    expect('template' in template.result).toBe(false);
    await session({ type: 'scan', characterId: '0', radius: 60, sameZ: true });
    expect(messages.at(-1)).toMatchObject({ type: 'error' });
  });
  it('enumerates maps in the worker, reads mods, scopes worlds and never filename-prefilters anchors', async () => {
    const messages: SaveReply[] = [];
    const session = createSaveSession(message => messages.push(message));
    const source = dir('save', [dir('world-a', [handle('a.sav', saveText()), handle('mods.json', '["synthetic_mod"]'), dir('maps', [handle('9999.9999.1.map', map('Synthetic vehicle', true))])]), dir('world-b', [handle('b.sav', saveText('Synthetic B')), dir('maps', [handle('0.0.0.map', map('Other world vehicle'))])])]);
    await session({ type: 'open', directory: source });
    const opened = messages.find(message => message.type === 'opened');
    if (opened?.type !== 'opened') throw new Error('Missing opened reply');
    const character = opened.characters.find(character => character.name === 'Synthetic survivor');
    expect(character?.mods).toEqual(['synthetic_mod']);
    await session({ type: 'scan', characterId: character!.id, radius: 0, sameZ: true });
    const scanned = messages.at(-1);
    if (scanned?.type !== 'scanned') throw new Error('Missing scanned reply');
    expect(scanned.scannedFiles).toBe(1); expect(scanned.vehicles).toHaveLength(1);
    expect(scanned.vehicles[0].snapshot).toContain('9007199254740993');
    expect(scanned.vehicles[0].name).toBe('Synthetic vehicle');
  });
  it('discards scan results if a previously read source changes', async () => {
    const messages: SaveReply[] = [];
    const session = createSaveSession(message => messages.push(message));
    let stamp = 1;
    const character: ReadFileHandle = { kind: 'file', name: 'a.sav', getFile: async () => file(saveText(), 'a.sav', stamp) };
    await session({ type: 'open', directory: dir('world', [character, dir('maps', [handle('0.0.0.map', map('Synthetic vehicle'))])]) });
    stamp++;
    await session({ type: 'scan', characterId: '0', radius: 60, sameZ: true });
    expect(messages.at(-1)).toMatchObject({ type: 'error' });
    expect(messages.some(message => message.type === 'scanned')).toBe(false);
  });
});
