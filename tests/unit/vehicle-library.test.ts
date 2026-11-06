import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppContext, type AppContextValue } from '../../src/app/context';
import { compose } from '../../src/domain/data';
import { buildVehicleLibrary, createVehicle, isVehicleLibraryPart, type Definition } from '../../src/domain/vehicle';
import { PartInspector } from '../../src/features/vehicle-editor/PartInspector';
import { VehiclePartLibrary } from '../../src/features/vehicle-editor/VehiclePartLibrary';

const part = (id: string, overrides: Partial<Definition> = {}): Definition => ({ id, type: 'vehicle_part', ...overrides });

describe('vehicle construction library boundary', () => {
  it('accepts concrete vehicle parts, not loose items even with the same ID', () => {
    expect(isVehicleLibraryPart(part('chest_minifreezer', { item: 'chest_minifreezer' }))).toBe(true);
    for (const type of ['ITEM', 'GENERIC', 'TOOL', 'vehicle']) expect(isVehicleLibraryPart(part('chest_minifreezer', { type }))).toBe(false);
    expect(isVehicleLibraryPart(undefined)).toBe(false);
    expect(isVehicleLibraryPart(part('abstract', { _abstract: true }))).toBe(false);
  });
  it('follows final flags rather than ID prefixes or the base item name', () => {
    for (const flag of ['APPLIANCE', 'NO_INSTALL_HIDDEN']) expect(isVehicleLibraryPart(part('anything', { flags: [flag] }))).toBe(false);
    expect(isVehicleLibraryPart(part('ap_custom_vehicle_part'))).toBe(true);
    expect(isVehicleLibraryPart(part('custom', { flags: ['NO_INSTALL'] }))).toBe(true);
    // The editor is not a survival inventory/skill simulator: keep prototype rotor parts.
    expect(isVehicleLibraryPart(part('rotor', { flags: ['NO_INSTALL_PLAYER'] }))).toBe(true);
  });
  it('retains appliances in resolved data for imports, but exposes only the vehicle counterpart for addition', () => {
    const composition = compose([{ id: 'dda', name: 'dda', definitions: [
      { source: 'items.json', data: { id: 'freezer', type: 'ITEM', name: 'Freezer' } },
      { source: 'appliances.json', data: { id: 'ap_freezer', type: 'vehicle_part', item: 'freezer', location: 'center', flags: ['APPLIANCE', 'CTRL_ELECTRONIC'] } },
      { source: 'parts.json', data: { id: 'freezer', type: 'vehicle_part', 'copy-from': 'ap_freezer', delete: { flags: ['APPLIANCE', 'CTRL_ELECTRONIC'] } } },
    ] }], ['dda']);
    expect(Object.values(composition.parts).filter(isVehicleLibraryPart).map(d => d.id)).toEqual(['freezer']);
    expect(composition.parts.ap_freezer.location).toBe('structure');
    expect(composition.parts.freezer.location).toBe('center');
    expect(composition.items.freezer.type).toBe('ITEM');
  });
  it('rebuilds deterministically from each mod composition without mutating data or merging shared items', () => {
    const packages = [
      { id: 'dda', name: 'dda', definitions: [
        { source: 'items.json', data: { id: 'shared', type: 'ITEM', name: 'Loose object' } },
        { source: 'parts.json', data: { id: 'z_part', type: 'vehicle_part', item: 'shared', flags: [] } },
        { source: 'parts.json', data: { id: 'a_part', type: 'vehicle_part', item: 'shared', flags: ['NO_INSTALL_PLAYER'] } },
        { source: 'parts.json', data: { id: 'hidden', type: 'vehicle_part', item: 'shared', flags: ['NO_INSTALL_HIDDEN'] } },
      ] },
      { id: 'mod', name: 'mod', dependencies: ['dda'], definitions: [
        { source: 'mod.json', data: { id: 'z_part', type: 'vehicle_part', 'copy-from': 'z_part', extend: { flags: ['APPLIANCE'] } } },
        { source: 'mod.json', data: { id: 'new_part', type: 'vehicle_part', 'copy-from': 'hidden', delete: { flags: ['NO_INSTALL_HIDDEN'] } } },
      ] },
    ];
    const core = compose(packages, ['dda']);
    const snapshot = structuredClone(core);
    const first = buildVehicleLibrary(core);
    expect(first.entries.map(entry => entry.id)).toEqual(['a_part', 'z_part']);
    expect(first.entries.map(entry => entry.baseItemId)).toEqual(['shared', 'shared']);
    expect(first.byId.get('a_part')?.playerInstallationForbidden).toBe(true);
    expect(first.excluded).toEqual([{ id: 'hidden', reason: 'hidden' }]);
    expect(core).toEqual(snapshot);
    const modified = compose(packages, ['dda', 'mod']);
    const second = buildVehicleLibrary(modified);
    expect(second.entries.map(entry => entry.id)).toEqual(['a_part', 'new_part']);
    expect(second.byId.has('z_part')).toBe(false);
    expect(modified.parts.z_part.flags).toContain('APPLIANCE');
    expect(first.byId.has('z_part')).toBe(true);
    expect(buildVehicleLibrary(core)).toEqual(first);
    expect(buildVehicleLibrary(null).entries).toEqual([]);
  });
  it('regenerates membership when mods overriding the same vpart change load order', () => {
    const packages = [
      { id: 'dda', name: 'dda', definitions: [{ source: 'core.json', data: { id: 'switchable', type: 'vehicle_part', flags: [] } }] },
      { id: 'appliance_mod', name: 'appliance_mod', definitions: [{ source: 'appliance.json', data: { id: 'switchable', type: 'vehicle_part', 'copy-from': 'switchable', extend: { flags: ['APPLIANCE'] } } }] },
      { id: 'vehicle_mod', name: 'vehicle_mod', definitions: [{ source: 'vehicle.json', data: { id: 'switchable', type: 'vehicle_part', 'copy-from': 'switchable', delete: { flags: ['APPLIANCE'] } } }] },
    ];
    expect(buildVehicleLibrary(compose(packages, ['dda', 'appliance_mod', 'vehicle_mod'])).byId.has('switchable')).toBe(true);
    const reverse = buildVehicleLibrary(compose(packages, ['dda', 'vehicle_mod', 'appliance_mod']));
    expect(reverse.byId.has('switchable')).toBe(false);
    expect(reverse.excluded).toEqual([{ id: 'switchable', reason: 'appliance' }]);
  });
  it('reports invalid namespace and abstract definitions without adding them to the rebuilt library', () => {
    const composition = compose([{ id: 'dda', name: 'dda', definitions: [
      { source: 'parts.json', data: { abstract: 'template', type: 'vehicle_part' } },
      { source: 'items.json', data: { id: 'loose', type: 'ITEM' } },
    ] }], ['dda']);
    // Defensive boundary: even a malformed caller cannot promote an item into a vpart.
    const library = buildVehicleLibrary({ parts: { ...composition.items, ...composition.byType.vehicle_part } });
    expect(library.entries).toEqual([]);
    expect(library.excluded).toEqual([{ id: 'loose', reason: 'not-vehicle-part' }, { id: 'template', reason: 'abstract' }]);
  });
  it('renders only the rebuilt catalog and reports the full result count beyond the display cap', () => {
    const composition = compose([{ id: 'dda', name: 'dda', definitions: [
      ...Array.from({ length: 161 }, (_, index) => ({ source: 'parts.json', data: { id: `part_${String(index).padStart(3, '0')}`, name: `Part ${String(index).padStart(3, '0')}`, type: 'vehicle_part', ...(index === 0 ? { flags: ['NO_INSTALL_PLAYER'] } : {}) } })),
      { source: 'appliances.json', data: { id: 'loose_appliance', name: 'Not in library', type: 'vehicle_part', flags: ['APPLIANCE'] } },
    ] }], ['dda']);
    const context: AppContextValue = { locale: 'en-US', t: (_zh, en) => en, composition, manifest: null, catalogs: {}, name: d => String(d?.name ?? d?.id ?? '?') };
    const markup = renderToStaticMarkup(createElement(AppContext.Provider, { value: context }, createElement(VehiclePartLibrary, { library: buildVehicleLibrary(composition), chosen: 'part_000', onChoose: () => {} })));
    expect(markup.match(/class="part-row /g)).toHaveLength(160);
    expect(markup).toContain('FIRST 160 OF 161');
    expect(markup).toContain('Prototype design only');
    expect(markup).not.toContain('Not in library');
    expect(markup).toContain('aria-label="Vehicle part library"');
  });
  it('disables a stale non-library selection without hiding imported appliance instances', () => {
    const definitions = [part('frame', { location: 'structure' }), part('rotor', { flags: ['NO_INSTALL_PLAYER'] }), part('ap_freezer', { item: 'freezer', name: 'Imported appliance', flags: ['APPLIANCE'] })];
    const indexes = { parts: new Map(definitions.map(d => [d.id, d])), items: new Map() };
    const context: AppContextValue = { locale: 'en-US', t: (_zh, en) => en, composition: null, manifest: null, catalogs: {}, name: (d, fallback) => String(d?.name ?? d?.id ?? fallback ?? '?') };
    const noop = () => {};
    const render = (chosen: string) => renderToStaticMarkup(createElement(AppContext.Provider, { value: context }, createElement(PartInspector, {
      chosen, indexes, vehicle: { ...createVehicle(), parts: [{ id: 'ap_freezer', mount_dx: 0, mount_dy: 0 }] }, selected: [0, 0], partIndex: 0,
      onSelectPart: noop, onInstall: noop, onRemove: noop, onVariant: noop, issues: [], validation: [],
    })));
    const invalid = render('ap_freezer');
    expect(invalid).toMatch(/class="install-button" disabled=""/);
    expect(invalid).toContain('imported instances are preserved');
    expect(invalid).toContain('data-testid="installed-part-details"');
    expect(invalid).toContain('Imported appliance');
    expect(render('frame')).not.toMatch(/class="install-button" disabled=""/);
    expect(render('unavailable')).toMatch(/class="install-button" disabled=""/);
    expect(render('rotor')).toContain('The game forbids manual player installation');
    expect(render('rotor')).not.toMatch(/class="install-button" disabled=""/);
  });
});
