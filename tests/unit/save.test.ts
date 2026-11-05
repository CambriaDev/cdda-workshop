import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  asSafeInteger, cloneLosslessJSON, generateTransferTemplate, isJsonObject, LosslessNumber,
  mayContainNearbyVehicle, parseLosslessJSON, parseMapFileCoordinates, parseSave,
  readPlayerCoordinates, SaveFormatError, scanNearbyVehicles, stringifyLosslessJSON,
  stringifySave, validateCharacterSave,
} from '../../src/domain/save';
import type { JsonObject } from '../../src/domain/save';

const avatar = (): JsonObject => ({
  name: 'Synthetic survivor', str_max: 8, dex_max: 8, int_max: 8, per_max: 8,
  skills: { survival: { level: 3 } }, vitamin_levels: {}, daily_vitamins: {},
  assigned_invlet: [], known_traps: [], camps: [], overmap_time: [],
  body: { torso: { id: 'torso', hp_cur: 12, hp_max: 90, damage_bandaged: 3, damage_disinfected: 2, healed_total: 5, wetness: 0, temp_cur: 5000, temp_conv: 5000, frostbite_timer: 10, future_part_data: 'keep' } },
  location: [-25, 34, 0], id: 42, damage_over_time_map: [], learned_recipes: ['synthetic_recipe'],
  my_bionics: [{ id: 'synthetic_cbm' }], mutations: { synthetic_trait: {} },
  inv: [{ typeid: 'synthetic_item', charges: new LosslessNumber('9007199254740993') }],
});
const save = (): JsonObject => ({ savegame_loading_version: 36, player: avatar() });
const effect = (type: string, bp = '', permanent = false): JsonObject => ({
  eff_type: type, duration: 600, bp, permanent, intensity: 1, start_turn: 5000,
  source: { character_id: null, faction_id: null },
});
const mapText = (vehicles: unknown[], coordinates = [0, 0, 0]) => JSON.stringify([{ version: 36, coordinates, vehicles }]);

describe('lossless JSON', () => {
  it('round-trips unsafe signed integers, huge tokens, -0, exponents and decimals exactly', () => {
    const text = '[9007199254740993,-9223372036854775808,18446744073709551615,1e400,-0,1.2300,0.10000000000000001,2]';
    const result = parseLosslessJSON(text) as unknown[];
    expect(result[0]).toBeInstanceOf(LosslessNumber);
    expect(result[7]).toBe(2);
    expect(stringifyLosslessJSON(result as never, 0)).toBe(text);
  });
  it('keeps strings untouched and handles escaped quotes and backslashes', () => {
    const text = '{"number":"9007199254740993","escaped":"quote \\\" slash \\\\ unicode \\u4f60"}';
    const parsed = parseLosslessJSON(text);
    expect(JSON.parse(stringifyLosslessJSON(parsed))).toEqual(JSON.parse(text));
  });
  it('handles prototype-like keys as own data without pollution', () => {
    const parsed = parseLosslessJSON('{"__proto__":{"polluted":true},"constructor":1,"toString":2}') as JsonObject;
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(parseLosslessJSON(stringifyLosslessJSON(parsed))).toEqual(parsed);
  });
  it.each(['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '[01]', '[+1]', '[1.]', '[NaN]', '[Infinity]', '[1,]', '{"x":1,}', 'true false', '"bad\nstring"', '{"x":}', '\uFEFF{}'])('rejects malformed or ambiguous JSON %s', (text) => {
    expect(() => parseLosslessJSON(text)).toThrow(SaveFormatError);
  });
  it('enforces parser limits', () => {
    expect(() => parseLosslessJSON('[[[0]]]', { maxDepth: 2 })).toThrow(/nesting/);
    expect(() => parseLosslessJSON('{}', { maxLength: 1 })).toThrow(/too large/);
    expect(() => parseLosslessJSON('{}', { maxDepth: 0 })).toThrow();
  });
  it('rejects unsafe writers, cycles, sparse arrays, accessors and unsupported classes', () => {
    expect(() => stringifyLosslessJSON(9007199254740992)).toThrow(/Unsafe/);
    expect(() => stringifyLosslessJSON(NaN)).toThrow();
    const circular: JsonObject = {}; circular.self = circular;
    expect(() => stringifyLosslessJSON(circular)).toThrow(/Cyclic/);
    expect(() => stringifyLosslessJSON(new Array(1))).toThrow(/Sparse/);
    expect(() => stringifyLosslessJSON({ get a() { return 1; } })).toThrow(/accessors/);
    expect(() => stringifyLosslessJSON(new Date() as never)).toThrow(/Unsupported/);
    expect(() => stringifyLosslessJSON({ x: undefined } as never)).toThrow();
    expect(() => JSON.stringify(new LosslessNumber('12345678901234567890'))).toThrow(/stringifyLosslessJSON/);
  });
  it('does not let raw token constructors inject JSON', () => {
    expect(() => new LosslessNumber('1],"inject":true')).toThrow();
    expect(() => new LosslessNumber('01')).toThrow();
    expect(asSafeInteger(new LosslessNumber('9007199254740993'))).toBeUndefined();
    expect(asSafeInteger(new LosslessNumber('12'))).toBe(12);
    expect(asSafeInteger(new LosslessNumber('1e2'))).toBeUndefined();
  });
});

describe('versioned save document', () => {
  it('parses and preserves BOM, header CRLF and big integers', () => {
    const input = '\uFEFF# version 36\r\n{"savegame_loading_version":36,"id":9007199254740993}';
    const parsed = parseSave(input);
    expect(parsed.header?.version).toBe(36);
    expect(parsed.bom).toBe(true);
    expect(parsed.warnings).toEqual([]);
    expect(stringifySave(parsed, 0)).toBe(input);
  });
  it('accepts #version with explicit noncanonical warning', () => {
    expect(parseSave('#version 36\n{}').warnings[0].code).toBe('NONCANONICAL_HEADER');
  });
  it('reports missing and other-version compatibility without pretending to migrate', () => {
    expect(parseSave('{}').warnings[0].code).toBe('VERSION_MISSING');
    expect(parseSave('# version 37\n{}').warnings[0].code).toBe('UNVERIFIED_VERSION');
    expect(parseSave('{"savegame_loading_version":35}').warnings[0].code).toBe('UNVERIFIED_VERSION');
  });
  it.each(['# version nope\n{}', '# version -1\n{}', '# version 36 extra\n{}', '# version 36\n[]', '# version 35\n{"savegame_loading_version":36}', '{}\n# version 36'])('rejects invalid save document %s', (input) => {
    expect(() => parseSave(input)).toThrow();
  });
  it('refuses header/body version drift on write', () => {
    const parsed = parseSave('# version 36\n{"savegame_loading_version":36}');
    parsed.root.savegame_loading_version = 35;
    expect(() => stringifySave(parsed)).toThrow(/Inconsistent/);
  });
});

describe('pure coordinates and nearby vehicle scan', () => {
  it('reads current absolute location without mixing map/bubble coordinates', () => {
    expect(readPlayerCoordinates(save()).absolute).toEqual([-25, 34, 0]);
    expect(readPlayerCoordinates(save()).source).toBe('location');
  });
  it('converts legacy bubble position with negative overmap coordinates', () => {
    const root = { player: { posx: 5, posy: 7, posz: -1 }, om_x: -1, om_y: 1, levx: 359, levy: 2, levz: -1 };
    expect(readPlayerCoordinates(root).absolute).toEqual([-7, 4351, -1]);
    expect(readPlayerCoordinates(root).warnings[0].code).toBe('LEGACY_COORDINATES');
  });
  it('rejects malformed coordinates instead of falling back or rounding', () => {
    expect(() => readPlayerCoordinates({ player: { location: ['1', 2, 3], posx: 0 } })).toThrow();
    expect(() => readPlayerCoordinates({ player: { location: [new LosslessNumber('9007199254740993'), 2, 3] } })).toThrow();
    expect(() => readPlayerCoordinates({ player: { location: [1, 2] } })).toThrow();
  });
  it('uses inclusive planar Euclidean distance and keeps big integer snapshots', () => {
    const text = '[{"version":36,"coordinates":[0,0,0],"vehicles":[{"name":"edge","posx":3,"posy":4,"parts":[],"future_id":9007199254740993},{"name":"diagonal outside","posx":4,"posy":4}]}]';
    const result = scanNearbyVehicles([{ path: 'synthetic.map', text }], [0, 0, 0], { radius: 5 });
    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0].distance).toBe(5);
    expect(result.vehicles[0].inputId).toBe('synthetic.map');
    expect(result.vehicles[0].snapshot).toContain('9007199254740993');
    expect(result.warnings).toEqual([]);
    expect(result.scannedSubmaps).toBe(1);
  });
  it('calculates absolute anchors on negative submaps and defaults to same z', () => {
    const inputs = [{ text: mapText([{ posx: 11, posy: 0 }], [-1, -1, 0]) }, { text: mapText([{ posx: 0, posy: 0 }], [0, 0, 1]) }];
    expect(scanNearbyVehicles(inputs, [0, 0, 0], { radius: 13 }).vehicles[0].absolute).toEqual([-1, -12, 0]);
    expect(scanNearbyVehicles(inputs, [0, 0, 0], { radius: 13 }).vehicles).toHaveLength(1);
    expect(scanNearbyVehicles(inputs, [0, 0, 0], { radius: 13, sameZ: false }).vehicles).toHaveLength(2);
  });
  it('returns diagnostics for corrupt inputs and continues other files', () => {
    const result = scanNearbyVehicles([{ text: '{bad' }, { text: mapText([{ posx: '1', posy: 0 }, { posx: 0, posy: 0 }]) }], [0, 0, 0]);
    expect(result.vehicles).toHaveLength(1);
    expect(result.warnings.map(w => w.code)).toEqual(['INVALID_MAP', 'INVALID_VEHICLE']);
    expect(() => scanNearbyVehicles([], [0, 0, 0], { radius: -1 })).toThrow();
  });
  it('does not use unsafe XY filename prefilters, even with outlying vehicle anchors', () => {
    expect(parseMapFileCoordinates('maps/-2.3.0.map')).toEqual([-2, 3, 0]);
    expect(parseMapFileCoordinates('maps/invalid.map')).toBeNull();
    expect(mayContainNearbyVehicle('maps/999999.999999.1.map', [0, 0, 0], { radius: 5 })).toBe(true);
    expect(mayContainNearbyVehicle('maps/0.0.1.map', [0, 0, 0], { trustFilenameZ: true })).toBe(false);
    const text = mapText([{ posx: -1200, posy: -1200 }], [100, 100, 0]);
    expect(scanNearbyVehicles([{ text }], [0, 0, 0], { radius: 0 }).vehicles).toHaveLength(1);
  });
});

describe('native TRANSFER envelope and auditable editor policy', () => {
  it('creates native two-object array with numeric TRANSFER pool 3', () => {
    const result = generateTransferTemplate(save());
    expect(result.template).toHaveLength(2);
    expect(result.template[0]).toEqual({ limit: 3, random_start_location: true, outfit_gender: true });
    expect(result.text.startsWith('[')).toBe(true);
    expect(result.text).not.toContain('# version');
    expect(result.verification).toBe('source-reviewed-not-runtime-verified');
  });
  it('preserves character progression, all inventory and unknown nested values losslessly', () => {
    const root = save();
    (root.player as JsonObject).future_mod_data = { large: new LosslessNumber('18446744073709551615'), complex: ['keep', { exact: true }] };
    const before = stringifyLosslessJSON(root, 0);
    const result = generateTransferTemplate(root);
    expect(stringifyLosslessJSON(root, 0)).toBe(before);
    const player = result.template[1];
    expect(player.learned_recipes).toEqual(['synthetic_recipe']);
    expect(player.my_bionics).toEqual((root.player as JsonObject).my_bionics);
    expect(result.text).toContain('18446744073709551615');
    expect(result.text).toContain('9007199254740993');
    expect(result.warnings.some(w => w.code === 'UNREVIEWED_FIELDS_PRESERVED')).toBe(true);
    expect(player.future_mod_data).toEqual((root.player as JsonObject).future_mod_data);
  });
  it('cleans reviewed old-world references while leaving health alone unless opted in', () => {
    const root = save();
    Object.assign(root.player as JsonObject, { active_mission: 6, active_missions: [6], followers: [99], activity: { type: 'ACT_MOVE_ITEMS', targets: [42] }, mounted_creature: 8, effects: { riding: { '': effect('riding') }, synthetic_benefit: {} }, translocators: { old: [1, 2, 3] }, controlling_vehicle: true, in_vehicle: true });
    const result = generateTransferTemplate(root);
    const player = result.template[1];
    expect(player.id).toBe(-1);
    expect(player.active_mission).toBe(-1);
    expect(player.active_missions).toEqual([]);
    expect(player.followers).toEqual([]);
    expect(player.controlling_vehicle).toBe(false);
    expect(player.in_vehicle).toBe(false);
    expect(player.location).toBeUndefined();
    expect(player.activity).toBeUndefined();
    expect(player.translocators).toBeUndefined();
    expect(player.mounted_creature).toBeUndefined();
    expect(player.effects).toEqual({ synthetic_benefit: {} });
    expect(((player.body as JsonObject).torso as JsonObject).hp_cur).toBe(12);
    expect(result.changes.some(change => change.path === 'player.id')).toBe(true);
  });
  it('allows exact native serialization field retention with explicit risk warning', () => {
    const root = save();
    const result = generateTransferTemplate(root, { cleanWorldReferences: false });
    expect(result.template[1]).toEqual(root.player);
    expect(result.changes).toEqual([]);
    expect(result.warnings.some(w => w.code === 'WORLD_REFERENCES_RETAINED')).toBe(true);
  });
  it('supports explicit start IDs, but never claims data-loader verification', () => {
    const result = generateTransferTemplate(save(), { randomStartLocation: false, startLocation: 'synthetic_start', outfitGender: false });
    expect(result.template[0]).toEqual({ limit: 3, random_start_location: false, start_location: 'synthetic_start', outfit_gender: false });
    expect(result.warnings.some(w => w.code === 'NOT_RUNTIME_VERIFIED')).toBe(true);
    expect(() => generateTransferTemplate(save(), { randomStartLocation: false })).toThrow();
    expect(() => generateTransferTemplate(save(), { startLocation: '../private' })).toThrow();
    expect(() => generateTransferTemplate(save(), { restoreHealth: 'yes' as never })).toThrow();
  });
  it('offers limited explicit health reset without dropping unknown body data', () => {
    const root = save();
    Object.assign(root.player as JsonObject, { effects: { synthetic_effect: { '': effect('synthetic_effect') } }, pain: 22, stored_calories: 55000000, vitamin_levels: { iron: -8 } });
    const result = generateTransferTemplate(root, { restoreHealth: true });
    const player = result.template[1];
    const torso = (player.body as JsonObject).torso as JsonObject;
    expect(torso.hp_cur).toBe(90);
    expect(torso.damage_bandaged).toBe(0);
    expect(torso.future_part_data).toBe('keep');
    expect(player.effects).toEqual({});
    expect(player.pain).toBe(0);
    expect(player.damage_over_time_map).toEqual([]);
    expect(player.vitamin_levels).toEqual({ iron: -8 });
    expect(player.stored_calories).toBe(55000000);
    expect(result.warnings.some(w => w.code === 'LIMITED_HEALTH_RESET')).toBe(true);
  });
  it('preserves permanent mutation/CBM effects and every unknown instance or source field', () => {
    const root = save();
    const permanent = effect('synthetic_cbm_effect', 'torso', true);
    const unknown = { ...effect('synthetic_unknown'), future_state: { exact: new LosslessNumber('9007199254740993') } };
    const unknownSource = effect('synthetic_source');
    (unknownSource.source as JsonObject).future_source = 'keep';
    const missingFlag = effect('synthetic_missing'); delete missingFlag.permanent;
    const effects: JsonObject = {
      synthetic_cbm_effect: { torso: permanent },
      synthetic_unknown: { '': unknown }, synthetic_source: { '': unknownSource },
      synthetic_missing: { '': missingFlag }, synthetic_bad_group: ['unrecognized'],
      synthetic_beneficial_temporary: { '': effect('synthetic_beneficial_temporary') },
    };
    (root.player as JsonObject).effects = effects;
    const result = generateTransferTemplate(root, { restoreHealth: true });
    const output = result.template[1];
    const expected = cloneLosslessJSON(effects); delete expected.synthetic_beneficial_temporary;
    expect(output.effects).toEqual(expected);
    expect(output.my_bionics).toEqual((root.player as JsonObject).my_bionics);
    expect(output.mutations).toEqual((root.player as JsonObject).mutations);
    expect(result.warnings.map(w => w.code)).toContain('PERMANENT_EFFECTS_PRESERVED');
    expect(result.warnings.map(w => w.code)).toContain('UNKNOWN_EFFECTS_PRESERVED');
    expect(result.warnings.map(w => w.code)).toContain('TEMPORARY_EFFECTS_REMOVED');
    expect((root.player as JsonObject).effects).toEqual(effects);
  });
  it('preserves unknown top-level effects shape and permanent riding even during world cleanup', () => {
    const root = save();
    (root.player as JsonObject).effects = [{ future: true }];
    const result = generateTransferTemplate(root, { restoreHealth: true });
    expect(result.template[1].effects).toEqual([{ future: true }]);
    expect(result.warnings.map(w => w.code)).toContain('UNKNOWN_EFFECTS_PRESERVED');
    (root.player as JsonObject).effects = { riding: { '': effect('riding', '', true) } };
    expect(generateTransferTemplate(root).template[1].effects).toEqual((root.player as JsonObject).effects);
  });
  it('omits only audited absolute clocks for fresh-loader defaults and preserves unknown nested time', () => {
    const root = save();
    Object.assign(root.player as JsonObject, {
      last_updated: 1234567, last_sleep_check: 1234000, lifespan_end: 9999999,
      faction_warnings: [{ fac_warning_id: 'synthetic_faction', fac_warning_num: 3, fac_warning_time: 5000 }],
      unknown_clock: { time: new LosslessNumber('9007199254740993') },
    });
    const before = stringifyLosslessJSON(root, 0);
    const result = generateTransferTemplate(root);
    expect(result.template[1].last_updated).toBeUndefined();
    expect(result.template[1].last_sleep_check).toBeUndefined();
    expect(result.template[1].lifespan_end).toBeUndefined();
    expect(result.template[1].faction_warnings).toEqual([]);
    expect(result.template[1].unknown_clock).toEqual((root.player as JsonObject).unknown_clock);
    expect(result.warnings.map(w => w.code)).toContain('NESTED_TIME_REFERENCES_PRESERVED');
    expect(stringifyLosslessJSON(root, 0)).toBe(before);
  });
  it('refuses to invent HP maxima or silently coerce a malformed avatar', () => {
    const root = save();
    ((root.player as JsonObject).body as JsonObject).torso = { hp_max: -2 };
    expect(() => generateTransferTemplate(root, { restoreHealth: true })).toThrow(/hp_max/);
    expect(validateCharacterSave({ player: { name: '' } }).valid).toBe(false);
    expect(validateCharacterSave({ player: { name: 'valid', skills: [] } }).valid).toBe(false);
    expect(() => generateTransferTemplate({ player: { name: 1 } })).toThrow(/validation/);
    expect(isJsonObject(new LosslessNumber('1'))).toBe(false);
    expect(cloneLosslessJSON(save())).toEqual(save());
  });
});

// Opt-in private local regression: no sample paths, role names, vehicle snapshots or IDs
// are committed/logged. Only source files are read, all hashes are kept in memory.
const privateSampleDirectory = process.env.CDDA_PRIVATE_SAVE_DIR;
describe.skipIf(!privateSampleDirectory)('private sample read-only regression (opt-in)', () => {
  it('scans with bounded two-reader concurrency and leaves every input hash unchanged', async () => {
    const directory = privateSampleDirectory as string;
    const files: string[] = [];
    const walk = async (path: string, depth = 0): Promise<void> => {
      if (depth > 16 || files.length > 100000) throw new Error('Private regression traversal bound exceeded');
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const child = join(path, entry.name);
        if (entry.isDirectory()) await walk(child, depth + 1);
        else if (entry.isFile() && (/\.(?:sav|map)$/.test(entry.name) || entry.name === 'mods.json')) files.push(child);
      }
    };
    // Replace OS errors so test reporters cannot expose the private path.
    try { await walk(directory); } catch { throw new Error('Private sample traversal failed (details withheld)'); }
    files.sort();
    const selected = files.find(path => /\.sav$/.test(path));
    if (!selected) throw new Error('No private sample character save found');
    const maps = files.filter(path => /\.map$/.test(path));
    expect(maps.length > 0).toBe(true);
    const hashes = new Map<string, string>();
    const readPrivate = async (path: string): Promise<Buffer> => {
      try {
        const info = await stat(path);
        if (info.size > 128 * 1024 * 1024) throw new Error('size');
        return await readFile(path);
      } catch { throw new Error('Private sample read failed (details withheld)'); }
    };
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    for (const path of files) hashes.set(path, hash(await readPrivate(path)));
    const parsed = parseSave((await readPrivate(selected)).toString('utf8'));
    const origin = readPlayerCoordinates(parsed.root).absolute;
    let next = 0;
    let found = 0;
    let scanErrors = 0;
    const safeTypeCounts = { rolling_trash_can: 0, motorcycle: 0 };
    const reader = async (): Promise<void> => {
      while (next < maps.length) {
        const index = next++;
        const text = (await readPrivate(maps[index])).toString('utf8');
        const result = scanNearbyVehicles([{ id: String(index), text }], origin, { radius: 60 });
        found += result.vehicles.length;
        for (const vehicle of result.vehicles) {
          if (vehicle.type === 'rolling_trash_can') safeTypeCounts.rolling_trash_can++;
          if (vehicle.type === 'motorcycle') safeTypeCounts.motorcycle++;
        }
        scanErrors += result.warnings.filter(w => w.code === 'INVALID_MAP' || w.code === 'INVALID_VEHICLE').length;
      }
    };
    await Promise.all([reader(), reader()]);
    // Never put private objects into expect: failure diagnostics must stay numeric/boolean.
    expect(scanErrors).toBe(0);
    const expectedCount = Number(process.env.CDDA_PRIVATE_EXPECTED_VEHICLES ?? '2');
    expect(Number.isSafeInteger(expectedCount) && expectedCount >= 0).toBe(true);
    expect(found).toBe(expectedCount);
    // Public game prototype IDs only; never assert/log a player's vehicle name.
    expect(safeTypeCounts.rolling_trash_can).toBe(1);
    expect(safeTypeCounts.motorcycle).toBe(1);
    let changed = 0;
    for (const path of files) if (hash(await readPrivate(path)) !== hashes.get(path)) changed++;
    expect(changed).toBe(0);
    // Template preparation is likewise pure and must not change the source save tree.
    const treeBefore = stringifyLosslessJSON(parsed.root, 0);
    const transfer = generateTransferTemplate(parsed.root);
    expect(transfer.template[0].limit).toBe(3);
    expect(stringifyLosslessJSON(parsed.root, 0) === treeBefore).toBe(true);
  }, 120000);
});
