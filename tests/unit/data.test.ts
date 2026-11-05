import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compose, compositionKey, quantity, parseGameColors, resolveGameColor } from '../../src/domain/data';
import type { DataPackage, DatasetManifest, JsonRecord } from '../../src/domain/data';
import { gettext, parsePo, translationText } from '../../src/i18n/gettext';
const pkg = (id: string, values: JsonRecord[], dependencies: string[] = []): DataPackage => ({ id, name: id, dependencies, definitions: values.map((data, i) => ({ data, source: `${id}/${i}.json` })) });

describe('ordered typed dataset composition', () => {
  it('preserves package isolation, enabled order, same-ID copy, arrays and abstracts', () => {
    const core = pkg('dda', [{ type: 'GENERIC', abstract: 'base', weight: '2 kg', flags: ['A'] }, { type: 'GENERIC', id: ['x', 'y'], 'copy-from': 'base' }]);
    const a = pkg('a', [{ type: 'GENERIC', id: 'x', 'copy-from': 'x', relative: { weight: '500 g' }, extend: { flags: ['B'] } }], ['dda']);
    const b = pkg('b', [{ type: 'GENERIC', id: 'x', 'copy-from': 'x', proportional: { weight: 2 }, delete: { flags: ['A'] } }], ['dda']);
    expect(compose([core, a, b], ['dda']).items.x.weight).toBe('2 kg');
    const ab = compose([core, a, b], ['a', 'b']);
    expect(ab.items.x.weight).toBe('5000 g'); expect(ab.items.x.flags).toEqual(['B']); expect(ab.items.base).toBeUndefined(); expect(ab.items.y.id).toBe('y');
    expect(compose([core, a, b], ['b', 'a']).items.x.weight).toBe('4500 g');
    expect(core.definitions[0].data.flags).toEqual(['A']);
  });
  it('retries forward references and reports cycles/missing packages/dependencies', () => {
    const a = pkg('a', [{ type: 'vehicle_part', id: 'child', 'copy-from': 'parent' }, { type: 'vehicle_part', abstract: 'parent', durability: 100 }, { type: 'GENERIC', id: 'lost', 'copy-from': 'missing' }], ['not-enabled']);
    const result = compose([a], ['a', 'absent']);
    expect(result.parts.child.durability).toBe(100);
    expect(result.diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(['missing-package', 'missing-dependency', 'unresolved-parent']));
  });
  it('never substitutes generic deep merge for unsupported nested operations', () => {
    const result = compose([pkg('dda', [{ type: 'GENERIC', id: 'a', custom: { left: 1, right: 2 } }, { type: 'GENERIC', id: 'b', 'copy-from': 'a', custom: { left: 3 }, relative: { custom: { right: 9 } } }])], ['dda']);
    expect(result.items.b.custom).toEqual({ left: 3 }); expect(result.items.b._incomplete).toBe(true);
    expect(result.diagnostics.filter(d => d.code === 'unsupported-rule')).toHaveLength(2);
  });
  it('generates eligible turrets, variants and layer order from versioned source rules', () => {
    const result = compose([pkg('dda', [
      { type: 'vehicle_part', id: 'turret_generic', item: 'gun', location: 'on_roof', flags: ['TURRET'], durability: 400, variants: [{ id: '', label: '', symbols: 't' }], variants_bases: [{ id: 'red', label: 'Red' }] },
      { type: 'GUN', id: 'gun', name: { str: 'a gun' }, weight: '20 kg', skill: 'rifle' },
      { type: 'GUN', id: 'bow', flags: ['STR_DRAW'] }, { type: 'GUNMOD', id: 'mod' }, { type: 'GUN', abstract: 'abstract-gun' }
    ])], ['dda']);
    expect(result.parts.turret_gun.item).toBe('gun'); expect(result.parts.turret_gun._generated).toBe(true); expect(result.parts.turret_gun.looks_like).toBe('m249');
    expect(result.parts.turret_bow).toBeUndefined(); expect(result.parts.turret_mod).toBeUndefined(); expect(result.parts['turret_abstract-gun']).toBeUndefined();
    expect(result.parts.turret_gun.z_order).toBe(9); expect(result.parts.turret_gun.variants).toEqual(expect.arrayContaining([{ id: 'red', label: 'Red', symbols: 't' }]));
    expect(result.parts.turret_generic.flags).toContain('NO_INSTALL_HIDDEN');
  });
  it('implements source-specific vpart requirement inheritance without generic deep merging', () => {
    const result = compose([pkg('dda', [
      { type: 'vehicle_part', abstract: 'base', requirements: { install: { skills: [['mechanics', 2]], time: '20 m', using: 'welding' }, repair: { time: '5 m', using: 'repair' } } },
      { type: 'vehicle_part', id: 'child', 'copy-from': 'base', requirements: { install: { skills: [], time: '60 m', components: [[['steel', 1]]] } } },
      { type: 'ITEM', id: 'item-base', weight: '5 kg', custom: { x: 1 } },
      { type: 'ITEM', id: 'item-child', 'copy-from': 'item-base', custom: { x: 2 } }
    ])], ['dda']);
    expect(result.parts.child.requirements).toEqual({ install: { skills: [['mechanics', 2]], time: '60 m', components: [[['steel', 1]]] }, repair: { time: '5 m', using: 'repair' } });
    expect(result.parts.child._incomplete).toBe(false);
    expect(result.items['item-child']._incomplete).toBe(true);
    expect(result.items['item-child']._incompleteFields).toEqual(['custom']);
    expect(result.items['item-child'].weight).toBe('5 kg');
  });
  it('appends only vehicle prototype vectors on explicit inheritance and replaces fresh same-ID definitions', () => {
    const parent = { type: 'vehicle', abstract: 'bike-base', name: 'Bike', parts: [{ x: 0, y: 0, parts: ['frame'] }], items: [{ x: 0, y: 0, chance: 100, items: 'rock' }], zones: [{ x: 0, y: 0, type: 'LOOT_UNSORTED' }] };
    const result = compose([pkg('dda', [parent,
      { type: 'vehicle', id: 'bike', 'copy-from': 'bike-base', parts: [{ x: 0, y: 0, parts: ['engine'] }], items: [{ x: 1, y: 0, chance: 50, items: 'stick' }], zones: [{ x: 1, y: 0, type: 'LOOT_UNSORTED' }] },
      { type: 'vehicle', id: 'bike', 'copy-from': 'bike', parts: [{ x: 0, y: 0, parts: ['seat'] }] },
      { type: 'vehicle', id: 'fresh', 'copy-from': 'bike-base' },
      { type: 'vehicle', id: 'fresh', parts: [{ x: 0, y: 0, parts: ['replacement'] }], custom_rule: 1 }
    ])], ['dda']);
    expect(result.vehicles.bike.parts).toEqual([...parent.parts, { x: 0, y: 0, parts: ['engine'] }, { x: 0, y: 0, parts: ['seat'] }]);
    expect(result.vehicles.bike.items).toHaveLength(2); expect(result.vehicles.bike.zones).toHaveLength(2); expect(result.vehicles.bike._incomplete).toBe(false);
    expect(result.vehicles.fresh.parts).toEqual([{ x: 0, y: 0, parts: ['replacement'] }]); expect(result.vehicles.fresh.items).toBeUndefined(); expect(result.vehicles.fresh.name).toBeUndefined();
    expect(result.vehicles.fresh._incompleteFields).toEqual(['custom_rule']);
    expect(parent.parts).toHaveLength(1);
  });
  it('parses explicit units and includes package order/content in cache keys', () => {
    expect(quantity('2 kg 500 g')).toEqual({ value: 2500, dimension: 'mass' }); expect(quantity('2 imaginary')).toBeUndefined();
    const packages = [{ ...pkg('a', []), hash: 'one' }, { ...pkg('b', []), hash: 'two' }];
    expect(compositionKey(packages, ['a', 'b'])).not.toBe(compositionKey(packages, ['b', 'a']));
  });
});

describe('source RGB and ncurses color names', () => {
  it('uses extracted channel values and handles basic, highlight, inverse and paired names', () => {
    const colors = parseGameColors(JSON.parse(readFileSync('public/datasets/0.I-1/colors.json', 'utf8')));
    expect(colors.cyan).toBe('rgb(0, 150, 180)'); expect(colors.light_gray).toBe('rgb(150, 150, 150)');
    expect(resolveGameColor('c_cyan', colors)).toEqual({ foreground: colors.cyan });
    expect(resolveGameColor('h_light_red', colors)).toEqual({ foreground: colors.light_red, background: colors.blue });
    expect(resolveGameColor('i_green', colors)).toEqual({ foreground: colors.black, background: colors.green });
    expect(resolveGameColor('light_blue_white', colors)).toEqual({ foreground: colors.light_blue, background: colors.light_gray });
    expect(resolveGameColor('imaginary_color', colors)).toEqual({});
  });
});

describe('actual gettext semantics', () => {
  const catalog = parsePo(`msgid ""\nmsgstr ""\n"Language: zh_CN\\n"\n"Plural-Forms: nplurals=1; plural=0;\\n"\n\nmsgctxt "vehicle"\nmsgid "frame"\nmsgstr "车架"\n\nmsgid "frame"\nmsgstr "框架"\n\n#, fuzzy\nmsgid "wheel"\nmsgstr "猜测"\n\nmsgid "item"\nmsgid_plural "items"\nmsgstr[0] "物品"\n\nmsgid "empty"\nmsgstr ""\n`);
  it('keeps contexts and plural forms, falls back for fuzzy/empty entries', () => {
    expect(gettext(catalog, 'frame', { context: 'vehicle' })).toBe('车架'); expect(gettext(catalog, 'frame')).toBe('框架');
    expect(gettext(catalog, 'wheel')).toBe('wheel'); expect(gettext(catalog, 'empty')).toBe('empty'); expect(gettext(catalog, 'item', { n: 9, plural: 'items' })).toBe('物品');
    expect(gettext(catalog, 'item', { n: 9, plural: 'items', locale: 'en-US' })).toBe('items');
    expect(translationText({ str: 'frame', ctxt: 'vehicle' }, catalog)).toBe('车架'); expect(translationText('中文原文', undefined, 'en-US')).toBe('中文原文');
  });
  it('does not execute hostile Plural-Forms text', () => {
    expect(gettext({ ...catalog, pluralForms: 'nplurals=2; plural=globalThis.hacked=1;' }, 'frame')).toBe('框架');
    expect((globalThis as Record<string, unknown>).hacked).toBeUndefined();
  });
});

describe('real extracted release', () => {
  const base = path.resolve('public/datasets');
  it('records real commit, all 28 external directories, distribution boundaries and SHA-256', () => {
    const manifest = JSON.parse(readFileSync(path.join(base, 'manifest.json'), 'utf8')) as DatasetManifest;
    expect(manifest.gameVersion).toBe('0.I-1'); expect(manifest.commit).toBe('7b2efa5cea38e4d4d97dd0e63b28b9148623da59'); expect(manifest.externalDirectoriesScanned).toBe(28);
    expect(manifest.packages.find(p => p.id === 'dda')?.definitionCount).toBeGreaterThan(10000);
    const third = manifest.packages.filter(p => p.source.startsWith('mod_repo/')); expect(third).toHaveLength(28);
    for (const entry of manifest.packages) {
      if (!entry.distributable) { expect(entry.file).toBeNull(); expect(entry.hash).toBeNull(); expect(entry.reasons.length).toBeGreaterThan(0); continue; }
      const content = readFileSync(path.join(base, entry.file!)); expect(createHash('sha256').update(content).digest('hex')).toBe(entry.hash);
      const data = JSON.parse(content.toString()) as DataPackage;
      expect(data.definitions.every(d => /^(?:0\.I-branch|mod_repo)\//.test(d.source) && typeof d.hash === 'string')).toBe(true);
    }
    expect(manifest.packages.find(p => p.id === 'blazemod')?.distributable).toBe(true);
    expect(manifest.packages.find(p => p.id === 'aftershock')?.obsolete).toBe(true);
  });
  it('resolves actual core frame/turrets and Chinese catalog without fake fixtures', () => {
    const manifest = JSON.parse(readFileSync(path.join(base, 'manifest.json'), 'utf8')) as DatasetManifest;
    const core = manifest.packages.find(p => p.id === 'dda')!;
    const data = JSON.parse(readFileSync(path.join(base, core.file!), 'utf8')) as DataPackage;
    const result = compose([data], ['dda']);
    expect(result.parts.frame).toBeDefined(); expect(Object.keys(result.parts).some(id => id.startsWith('turret_'))).toBe(true); expect(Object.keys(result.items).length).toBeGreaterThan(7000);
    expect(result.parts.frame._incomplete).toBe(false);
    expect(result.parts.frame.z_order).toBe(5); expect(result.items.frame.weight).toBe('20000 g');
    expect(result.items.frame._incompleteFields).toEqual(expect.arrayContaining(['to_hit', 'melee_damage']));
    expect(result.items.frame._incompleteFields).not.toContain('weight');
    expect(result.diagnostics.filter(d => d.id === 'frame' && d.message.includes('vehicle_part.requirements'))).toHaveLength(0);
    const motorcycle = result.vehicles.motorcycle;
    expect(motorcycle.parts).toHaveLength(9);
    const motorcycleParts = (motorcycle.parts as JsonRecord[]).flatMap(group => group.parts as Array<string | JsonRecord>);
    const motorcycleIds = motorcycleParts.map(part => typeof part === 'string' ? part.split('#')[0] : part.part);
    expect(motorcycleIds).toHaveLength(21);
    expect(motorcycleIds).toEqual(expect.arrayContaining(['frame', 'engine_vtwin', 'wheel_motorbike', 'motorcycle_kickstand']));
    expect(motorcycle._incomplete).toBe(false);
    const catalog = JSON.parse(readFileSync(path.join(base, core.translationFile!), 'utf8'));
    expect(catalog.messages.length).toBeGreaterThan(10000); expect(catalog.messages.some((m: { context?: string }) => m.context)).toBe(true);
  });
});
