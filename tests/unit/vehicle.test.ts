import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compose } from '../../src/domain/data/compose';
import type { DataPackage } from '../../src/domain/data/types';
import { strToU8, zipSync } from 'fflate';
import { calculateStats, createProject, createVehicle, exportBlueprint, exportBlueprintZip, getFuelChoices, importVehicleFile, installPart, parseJsonSafely, parseProject, previewMigration, removePart, renameVehicle, serializeProject, updateProject, validateVehicle, type Definition, type VehicleIndexes, type VehicleModel } from '../../src/domain/vehicle';
import { LosslessNumber, stringifyLosslessJSON, type JsonValue } from '../../src/domain/save/losslessJson';
const defs = (...values: Definition[]) => new Map(values.map(d => [d.id, d]));
const indexes = (): VehicleIndexes => ({
  parts: defs(
    { id: 'frame', type: 'vehicle_part', item: 'frame_item', location: 'structure', durability: 200 },
    { id: 'cargo', type: 'vehicle_part', item: 'box', location: 'center', flags: ['CARGO'], size: '100 L', durability: 100 },
    { id: 'engine', type: 'vehicle_part', item: 'engine_item', location: 'engine_block', flags: ['ENGINE'], power: '100 kW', durability: 100, engine: { exclusions: ['big'] } },
    { id: 'motor', type: 'vehicle_part', item: 'engine_item', location: 'engine_block', flags: ['ENGINE'], power: '10 kW', durability: 100 },
    { id: 'battery', type: 'vehicle_part', item: 'car_battery', flags: ['BATTERY'], durability: 100 },
    { id: 'gun', type: 'vehicle_part', item: 'gun_item', flags: ['TURRET', 'NEED_MOUNT'], durability: 80 },
    { id: 'mount', type: 'vehicle_part', item: 'frame_item', flags: ['TURRET_MOUNT'] },
    { id: 'tank', type: 'vehicle_part', item: 'tank_item', flags: ['FLUIDTANK'] },
    { id: 'mirror', type: 'vehicle_part', item: 'frame_item', flags: ['VISION'] },
    { id: 'wall', type: 'vehicle_part', item: 'frame_item', flags: ['OPAQUE'] },
    { id: 'cable', type: 'vehicle_part', item: 'frame_item', flags: ['POWER_TRANSFER'] },
  ),
  items: defs(
    { id: 'frame_item', type: 'ITEM', weight: '10 kg', volume: '1 L' },
    { id: 'box', type: 'ITEM', weight: '2 kg', volume: '10 L' },
    { id: 'engine_item', type: 'ITEM', weight: '20 kg' },
    { id: 'car_battery', type: 'ITEM', weight: '20 kg', pocket_data: [{ pocket_type: 'MAGAZINE', ammo_restriction: { battery: 3000 } }] },
    { id: 'gun_item', type: 'ITEM', weight: '1 kg', pocket_data: [{ pocket_type: 'MAGAZINE', ammo_restriction: { bullet: 30 } }] },
    { id: 'battery_charge', type: 'AMMO', ammo_type: 'battery', weight: '1 g', stack_size: 1000 },
    { id: 'bullet_a', type: 'AMMO', ammo_type: 'bullet', weight: '10 g', stack_size: 1 },
    { id: 'bullet_b', type: 'AMMO', ammo_type: 'bullet', weight: '10 g', stack_size: 1 },
    { id: 'tool', type: 'ITEM', weight: '500 g', volume: '500 ml' },
    { id: 'rock', type: 'ITEM', weight: '1 kg', volume: '1 L' },
  ), flagRequirements: new Map([['NEED_MOUNT', 'TURRET_MOUNT']]),
});
const frame = (x = 0, y = 0) => ({ id: 'frame', mount_dx: x, mount_dy: y, base: { typeid: 'frame_item', damaged: 0 } });
const fixture = (): VehicleModel => ({ name: 'Test 🚗', unknown_vehicle: { keep: ['yes'] }, parts: [frame(), { id: 'cargo', mount_dx: 0, mount_dy: 0, base: { typeid: 'box', damaged: 2000, degradation: 1000, faults: ['broken'] }, items: [{ typeid: 'rock', damaged: 2000, contents: { contents: [{ pocket_type: 0, contents: [{ typeid: 'tool', damaged: 1000 }] }] } }], tools: [{ typeid: 'tool', damaged: 1000 }], unknown_part: 'retain' }] });
const withResources = (): VehicleModel => ({ name: 'Resources', parts: [frame(), { id: 'battery', mount_dx: 0, mount_dy: 0, base: { typeid: 'car_battery', damaged: 2000, degradation: 1000, faults: ['bad'], contents: { contents: [{ pocket_type: 1, _sealed: true, contents: [{ typeid: 'battery_charge', charges: 10, unknown: 'keep' }] }], additional_pockets: [] } } }, { id: 'mount', mount_dx: 0, mount_dy: 0, base: { typeid: 'frame_item' } }, { id: 'gun', mount_dx: 0, mount_dy: 0, base: { typeid: 'gun_item', contents: { contents: [{ pocket_type: 1, contents: [{ typeid: 'bullet_a', charges: 2 }] }], additional_pockets: [] } } }] });
const contentsOf = (vehicle: VehicleModel, i: number) => (vehicle.parts[i]!.base!.contents as { contents: { contents: { typeid: string; charges: number; unknown?: string }[] }[] }).contents[0]!.contents[0]!;

describe('vehicle installation and removal (0.I source rules)', () => {
  it('requires structure first, allows adjacent structure and rejects diagonal/disconnected parts', () => {
    const ix = indexes(); expect(installPart(createVehicle(), { id: 'cargo', x: 0, y: 0 }, ix).ok).toBe(false);
    const one = installPart(createVehicle(), { id: 'frame', x: 0, y: 0 }, ix).vehicle;
    expect(installPart(one, { id: 'frame', x: 1, y: 0 }, ix).ok).toBe(true);
    expect(installPart(one, { id: 'frame', x: 1, y: 1 }, ix).issues.some(i => i.code === 'disconnected')).toBe(true);
    expect(one.parts).toHaveLength(1);
  });
  it('checks duplicate, location, cargo, mirror and required mount conflicts', () => {
    const ix = indexes(), v = fixture();
    expect(installPart(v, { id: 'cargo', x: 0, y: 0 }, ix).issues.map(i => i.code)).toEqual(expect.arrayContaining(['duplicate-part', 'location-conflict', 'cargo-conflict']));
    expect(installPart(v, { id: 'gun', x: 0, y: 0 }, ix).ok).toBe(false);
    const wall = installPart(v, { id: 'wall', x: 0, y: 0 }, ix).vehicle;
    expect(installPart(wall, { id: 'mirror', x: 0, y: 0 }, ix).issues.some(i => i.code === 'mirror-opaque')).toBe(true);
    const mounted = installPart(v, { id: 'mount', x: 0, y: 0 }, ix).vehicle;
    expect(installPart(mounted, { id: 'gun', x: 0, y: 0 }, ix).ok).toBe(true);
  });
  it('permits stackable power cables but enforces engine exclusions globally', () => {
    const ix = indexes(); let v: VehicleModel = { name: 'v', parts: [frame(), frame(1)] };
    v = installPart(v, { id: 'cable', x: 0, y: 0 }, ix).vehicle;
    expect(installPart(v, { id: 'cable', x: 0, y: 0 }, ix).ok).toBe(true);
    v = installPart(v, { id: 'engine', x: 0, y: 0 }, ix).vehicle;
    expect(installPart(v, { id: 'engine', x: 1, y: 0 }, ix).issues.some(i => i.code === 'engine-exclusion')).toBe(true);
  });
  it('blocks removal of structure with attachments and articulation splits', () => {
    const ix = indexes(); expect(removePart(fixture(), 0, ix).ok).toBe(false);
    const line: VehicleModel = { name: 'line', parts: [frame(-1), frame(), frame(1)] };
    expect(removePart(line, 1, ix).issues.some(i => i.code === 'would-split')).toBe(true);
    expect(removePart(line, 0, ix).ok).toBe(true);
    expect(removePart(withResources(), 2, ix).issues.some(i => i.code === 'required-by-part')).toBe(true);
  });
  it('never treats protrusions as structural support and blocks removing the last supporting frame', () => {
    const ix = indexes(); ix.parts.set('wing', { id: 'wing', type: 'vehicle_part', item: 'frame_item', location: 'structure', flags: ['PROTRUSION'] });
    const v: VehicleModel = { name: 'wing', parts: [frame(), { id: 'wing', mount_dx: 1, mount_dy: 0 }] };
    expect(installPart(v, { id: 'frame', x: 2, y: 0 }, ix).issues.some(i => i.code === 'disconnected')).toBe(true);
    expect(removePart(v, 0, ix).issues.some(i => i.code === 'unsupported-protrusion')).toBe(true);
  });
  it('preserves unknown parts with warnings and reports unavailable flag rules', () => {
    const ix = indexes(), v = fixture();
    const result = installPart(v, { id: 'missing_mod_part', x: 0, y: 0 }, ix);
    expect(result.ok).toBe(true); expect(result.issues[0]?.code).toBe('unknown-part');
    delete ix.flagRequirements;
    expect(validateVehicle(v, ix).some(i => i.code === 'flag-rules-unavailable')).toBe(true);
  });
});

describe('reliable stats distinguish partial data', () => {
  it('uses base item damage rather than hp field and recursively counts contents/tools exactly once', () => {
    const v = fixture(), stats = calculateStats(v, indexes());
    expect(stats.emptyWeight.known).toBe(12000);
    expect(stats.payloadWeight.known).toBe(2000); // rock + nested tool + installed tool
    expect(stats.totalWeight.known).toBe(14000);
    expect(stats.durability.known).toBe(250); expect(stats.maxDurability.known).toBe(300);
    expect(stats.cargoCapacity.known).toBe(100000);
    expect(stats.cargoUsed.complete).toBe(false); // complex cargo volume deliberately not guessed
    expect(stats.bounds.width).toBe(1);
  });
  it('propagates unresolved part/item definitions instead of treating partial composed values as reliable', () => {
    const ix = indexes(); ix.parts.get('cargo')!._incomplete = true;
    const stats = calculateStats(fixture(), ix);
    expect(stats.cargoCapacity.complete).toBe(false); expect(stats.maxDurability.complete).toBe(false); expect(stats.ratedPower.complete).toBe(false);
    expect(stats.issues.some(i => i.code === 'incomplete-part-stats')).toBe(true);
    const install = installPart({ name: 'v', parts: [frame()] }, { id: 'cargo', x: 0, y: 0 }, ix);
    expect(install.ok).toBe(true); expect(install.issues.some(i => i.code === 'incomplete-part-rules')).toBe(true);
    expect(install.vehicle.parts[1]!.base).toBeUndefined(); // unresolved item association is not fabricated
    const itemIx = indexes(); itemIx.items.get('box')!._incomplete = true;
    const items = calculateStats(fixture(), itemIx);
    expect(items.emptyWeight.complete).toBe(false); expect(items.totalWeight.complete).toBe(false); expect(items.durability.complete).toBe(false);
    expect(items.maxDurability.complete).toBe(true); expect(items.issues.some(i => i.code === 'incomplete-item-stats')).toBe(true);
    itemIx.items.get('car_battery')!._incomplete = true;
    const migration = previewMigration(withResources(), { includeCargo: true, condition: 'new', fuelSelections: { 3: 'bullet_b' } }, itemIx);
    expect(contentsOf(migration.vehicle, 1).charges).toBe(10); expect(migration.fullyRenewed).toBe(false);
  });
  it('isolates incomplete fields: melee uncertainty does not invalidate weight, but weight/flags uncertainty does', () => {
    const ix = indexes(), part = ix.parts.get('frame')!, item = ix.items.get('frame_item')!;
    part._incomplete = true; part._incompleteFields = ['requirements.install'];
    item._incomplete = true; item._incompleteFields = ['to_hit', 'melee_damage']; item.weight = '20000 g';
    const added = installPart(createVehicle('realistic frame'), { id: 'frame', x: 0, y: 0 }, ix);
    expect(added.ok).toBe(true); expect(added.vehicle.parts[0]!.base?.typeid).toBe('frame_item');
    expect(added.issues.some(i => i.code === 'incomplete-part-rules')).toBe(false);
    const stats = calculateStats(added.vehicle, ix);
    expect(stats.totalWeight).toMatchObject({ known: 20000, complete: true, missing: 0 }); expect(stats.durability.complete).toBe(true);
    item._incompleteFields = ['weight'];
    expect(calculateStats(added.vehicle, ix).totalWeight.complete).toBe(false); expect(calculateStats(added.vehicle, ix).durability.complete).toBe(true);
    item._incompleteFields = ['to_hit']; part._incompleteFields = ['flags'];
    const flagStats = calculateStats(added.vehicle, ix);
    expect(flagStats.totalWeight.complete).toBe(true); expect(flagStats.cargoCapacity.complete).toBe(false); expect(flagStats.ratedPower.complete).toBe(false);
    expect(installPart(createVehicle(), { id: 'frame', x: 0, y: 0 }, ix).issues.some(i => i.code === 'incomplete-part-rules')).toBe(true);
    item._incompleteFields = ['*']; expect(calculateStats(added.vehicle, ix).totalWeight.complete).toBe(false);
  });
  it('computes the actual bundled 0.I-1 frame mass despite unrelated inherited melee fields', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../public/datasets/manifest.json', import.meta.url), 'utf8'));
    const entry = manifest.packages.find((p: { id: string }) => p.id === 'dda');
    const dda = JSON.parse(readFileSync(new URL(`../../public/datasets/${entry.file}`, import.meta.url), 'utf8')) as DataPackage;
    const data = compose([dda], ['dda']);
    const ix: VehicleIndexes = { parts: new Map(Object.entries(data.parts)), items: new Map(Object.entries(data.items)), flagRequirements: new Map() };
    const installed = installPart(createVehicle('bundled frame'), { id: 'frame', x: 0, y: 0 }, ix);
    expect(installed.ok).toBe(true); expect(installed.vehicle.parts[0]!.base?.typeid).toBe('frame');
    expect(calculateStats(installed.vehicle, ix).emptyWeight).toEqual({ known: 20000, missing: 0, complete: true, unit: 'g' });
    expect(calculateStats(installed.vehicle, ix).totalWeight.complete).toBe(true);
  });
  it('reports rated kW/hp but never labels simple sum actual power', () => {
    const v: VehicleModel = { name: 'v', parts: [frame(), { id: 'engine', mount_dx: 0, mount_dy: 0 }] };
    const stats = calculateStats(v, indexes()); expect(stats.ratedPower.known).toBe(100000);
    expect(stats.ratedHorsepower.known).toBeCloseTo(134.1022, 3); expect(stats.currentPower.value).toBeNull();
  });
  it('uses ITEM subtypes and per-charge weight, not stack_size; marks unknown IDs incomplete', () => {
    const ix = indexes(); ix.items.get('bullet_a')!.stack_size = 50;
    ix.items.get('bullet_a')!.type = 'ITEM'; ix.items.get('bullet_a')!.subtypes = ['AMMO'];
    const v = withResources();
    expect(calculateStats(v, ix).payloadWeight.known).toBe(30); // battery 10*1g + bullet 2*10g, never divide by stack_size
    v.parts.push({ id: 'unknown', mount_dx: 0, mount_dy: 0, base: { typeid: 'unknown_item' } });
    const stats = calculateStats(v, ix); expect(stats.totalWeight.complete).toBe(false); expect(stats.totalWeight.missing).toBeGreaterThan(0); expect(stats.ratedPower.complete).toBe(false);
  });
});

describe('project and migration snapshots', () => {
  it('round-trips unknown fields and separates edited/original snapshots', () => {
    const raw = fixture(), p = createProject(raw, { datasetId: '0.I-1', saveVersion: 33, modOrder: ['dda', 'missing'] });
    const updated = updateProject(p, renameVehicle(p.vehicle, 'renamed'), { action: 'rename' });
    const read = parseProject(serializeProject(updated)); expect(read.original).toEqual(raw); expect(read.vehicle.name).toBe('renamed'); expect(raw.name).toBe('Test 🚗');
    expect(parseProject(serializeProject(read))).toEqual(read);
  });
  it('preserves large integer/exponent tokens through edits and all project clones', () => {
    const raw = parseJsonSafely('{"name":"big","parts":[{"id":"frame","mount_dx":0,"mount_dy":0,"base":{"typeid":"frame_item","owner":9223372036854775807}}],"mod_number":1e99}') as VehicleModel;
    const p = updateProject(createProject(raw), renameVehicle(raw, 'new'));
    const preview = previewMigration(p.vehicle, { condition: 'new', includeCargo: true }, indexes());
    const saved = serializeProject(updateProject(p, preview.vehicle));
    expect(saved).toContain('9223372036854775807'); expect(saved).toContain('1e99');
    expect(parseProject(saved).vehicle.mod_number).toBeInstanceOf(LosslessNumber);
    expect(() => serializeProject(createProject({ ...fixture(), bad: Number.MAX_SAFE_INTEGER + 10 }))).toThrow();
  });
  it('exclude-cargo only removes part.items, not base fuel or installed tools', () => {
    const raw = withResources(); raw.parts[1]!.items = [{ typeid: 'rock', contents: { contents: [{ pocket_type: 0, contents: [{ typeid: 'tool' }] }] } }]; raw.parts[1]!.tools = [{ typeid: 'tool' }];
    const before = stringifyLosslessJSON(raw as unknown as JsonValue);
    const out = previewMigration(raw, { includeCargo: false, condition: 'preserve' }, indexes());
    expect(out.vehicle.parts[1]!.items).toEqual([]); expect(out.vehicle.parts[1]!.tools).toEqual(raw.parts[1]!.tools); expect(contentsOf(out.vehicle, 1).charges).toBe(10);
    expect(stringifyLosslessJSON(raw as unknown as JsonValue)).toBe(before);
  });
  it('new condition repairs installed bases, preserves damaged cargo and requires explicit ammunition choice', () => {
    const raw = withResources(); raw.parts[0]!.items = [{ typeid: 'rock', damaged: 2000 }];
    const out = previewMigration(raw, { includeCargo: true, condition: 'new' }, indexes());
    expect(out.vehicle.parts[1]!.base!.damaged).toBe(0); expect(out.vehicle.parts[1]!.base!.faults).toEqual([]);
    expect(contentsOf(out.vehicle, 1).charges).toBe(3000); expect(contentsOf(out.vehicle, 1).unknown).toBe('keep');
    expect(contentsOf(out.vehicle, 3).charges).toBe(2); expect(out.fullyRenewed).toBe(false);
    expect(out.vehicle.parts[0]!.items![0]!.damaged).toBe(2000);
    const chosen = previewMigration(raw, { includeCargo: true, condition: 'new', fuelSelections: { 3: 'bullet_b' } }, indexes());
    expect(contentsOf(chosen.vehicle, 3)).toEqual({ typeid: 'bullet_b', charges: 30 }); expect(chosen.fullyRenewed).toBe(true);
    expect(contentsOf(raw, 1).charges).toBe(10);
  });
  it('rejects disallowed ammo choices and never guesses tank/multipocket capacity', () => {
    const ix = indexes(), v = withResources();
    const invalid = previewMigration(v, { includeCargo: true, condition: 'new', fuelSelections: { 3: 'battery_charge' } }, ix);
    expect(contentsOf(invalid.vehicle, 3).charges).toBe(2);
    v.parts.push({ id: 'tank', mount_dx: 0, mount_dy: 0, base: { typeid: 'tank_item', charges: 19 } });
    expect(getFuelChoices(v, ix).find(c => c.partIndex === 4)?.supported).toBe(false);
    const out = previewMigration(v, { includeCargo: true, condition: 'new', fuelSelections: { 3: 'bullet_b', 4: 'gasoline' } }, ix);
    expect(out.vehicle.parts[4]!.base!.charges).toBe(19); expect(out.fullyRenewed).toBe(false);
    (ix.items.get('gun_item')!.pocket_data as unknown[]).push({ pocket_type: 'MAGAZINE_WELL' });
    expect(getFuelChoices(v, ix).find(c => c.partIndex === 3)?.supported).toBe(false);
  });
  it('rejects malformed projects and part coordinates', () => {
    expect(() => parseProject('{"format":"cdda-vehicle-project","formatVersion":2}')).toThrow();
    expect(() => createProject({ name: 'bad', parts: [{ id: 'frame', mount_dx: .5, mount_dy: 0 }] })).toThrow();
  });
});

describe('official-format lossy blueprint and bounded ZIP', () => {
  it('exports official x/y/parts structure in installation order with comprehensive loss report', () => {
    const v = fixture(), out = exportBlueprint(v, { dependencies: ['test_mod'] }, indexes());
    expect(out.prototype.type).toBe('vehicle'); expect(out.prototype.parts).toEqual([{ x: 0, y: 0, parts: ['frame'] }, { x: 0, y: 0, parts: [{ part: 'cargo', tools: ['tool'] }] }]);
    expect(out.losses.map(i => i.code)).toEqual(expect.arrayContaining(['cargo-instance-state', 'part-instance-state', 'game-unverified']));
    expect(out.gameValidated).toBe(false); expect(out.modInfo.dependencies).toEqual(['dda', 'test_mod']);
    expect(JSON.stringify(out.prototype)).not.toContain('damaged'); expect(exportBlueprint(v, {}, indexes()).prototype.id).toBe(exportBlueprint(v, {}, indexes()).prototype.id);
  });
  it('includes variants, turret ammo and tools using only supported prototype fields', () => {
    const v = withResources(); v.parts[3]!.variant = 'red';
    const out = exportBlueprint(v, {}, indexes()); const cells = out.prototype.parts as { parts: unknown[] }[];
    expect(cells[3]!.parts[0]).toEqual({ part: 'gun#red', ammo: 100, ammo_types: ['bullet_a'], ammo_qty: [2, 2] });
  });
  it('round-trips its ZIP and project file; imported prototypes preserve raw spawn descriptions without pretending to be full instances', () => {
    const raw = fixture(), zip = exportBlueprintZip(raw, {}, indexes()), read = importVehicleFile(zip);
    expect(read.vehicle.parts.map(p => p.id)).toEqual(raw.parts.map(p => p.id)); expect(read.vehicle.importedPrototype).toBeDefined(); expect(read.issues.some(i => i.code === 'prototype-not-instance')).toBe(true);
    const first = exportBlueprint(raw, {}, indexes()).prototype, again = exportBlueprint(read.vehicle, {}, indexes()).prototype;
    expect(again.parts).toEqual(first.parts); expect(again.items).toEqual(first.items);
    const resource = withResources(), bp = exportBlueprint(resource, {}, indexes()).prototype;
    const resourceRead = importVehicleFile(JSON.stringify([bp]));
    expect(exportBlueprint(resourceRead.vehicle, {}, indexes()).prototype.parts).toEqual(bp.parts);
    expect(importVehicleFile(serializeProject(createProject(raw))).vehicle).toEqual(raw);
  });
  it('rejects traversal, ambiguous blueprints, excessive entries and expanded ZIP bombs', () => {
    const data = strToU8('[{"type":"vehicle","name":"v","parts":[]}]');
    expect(() => importVehicleFile(zipSync({ '../vehicle.json': data }))).toThrow('Unsafe ZIP path');
    expect(() => importVehicleFile(zipSync({ 'a/vehicle.json': data, 'b/vehicle.json': data }))).toThrow('exactly one');
    const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`${i}.txt`, new Uint8Array()]));
    expect(() => importVehicleFile(zipSync(many))).toThrow('entry count');
    expect(() => importVehicleFile(zipSync({ 'vehicle.json': new Uint8Array(9 * 1024 * 1024) }))).toThrow('expanded size');
  });
  it('rejects malformed native spawn fields rather than generating fake success', () => {
    expect(() => importVehicleFile(JSON.stringify([{ type: 'vehicle', name: 'bad', parts: [{ x: 0, y: 0, parts: [{ part: 'frame', ammo_qty: [-1, 5] }] }] }]))).toThrow('ammo quantity');
    expect(() => importVehicleFile(JSON.stringify([{ type: 'vehicle', name: 'bad', parts: [{ x: 0, y: 0, parts: ['frame'] }], items: [{ x: 0, y: 0, chance: 300, items: ['rock'] }] }]))).toThrow('cargo spawn');
  });
  it('rejects truly invalid structure but permits unknown mod IDs with warnings', () => {
    const ix = indexes(); expect(() => exportBlueprint({ name: 'bad', parts: [{ id: 'cargo', mount_dx: 0, mount_dy: 0 }] }, {}, ix)).toThrow('structure');
    const v = fixture(); v.parts.push({ id: 'unknown_mod', mount_dx: 0, mount_dy: 0, custom: { keep: 1 } });
    expect(exportBlueprint(v, {}, ix).losses.some(i => i.code === 'unknown-part')).toBe(true);
    expect(parseProject(serializeProject(createProject(v))).vehicle.parts[2]!.custom).toEqual({ keep: 1 });
  });
});
