import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppContext, stripColors, type AppContextValue } from '../../src/app/context';
import { compose } from '../../src/domain/data';
import type { VehicleIndexes, VehiclePart } from '../../src/domain/vehicle';
import { LosslessNumber } from '../../src/domain/save/losslessJson';
import { PartDetails } from '../../src/features/vehicle-editor/PartDetails';
import { PartInstanceState } from '../../src/features/vehicle-editor/PartInstanceState';
import { translationText } from '../../src/i18n/gettext';

function renderDetails(options: { part?: Record<string, unknown>; base?: Record<string, unknown>; unreliablePart?: string[]; unreliableBase?: string[]; english?: boolean; installed?: boolean; testId?: string; afterFeatured?: ReactNode; withoutComposition?: boolean } = {}) {
  const composition = compose([{ id: 'dda', name: 'dda', definitions: [
    { source: 'test/base.json', data: { id: 'base', type: 'GENERIC', name: 'Loose base', description: '<color_red>Base fallback</color> <img src=x onerror=bad()>', weight: '20 kg', volume: '1 L', qualities: [['CUT', 1]], ...options.base } },
    { source: 'test/part.json', data: { id: 'p', type: 'vehicle_part', item: 'base', name: 'Appliance', description: 'Part description', flags: ['VEH_TOOLS', 'CARGO', 'ENABLED_DRAINS_EPOWER'], epower: '-500 W', durability: 400, size: '20 L', damage_reduction: { all: 30 }, qualities: [['JACK', 1]], allowed_tools: ['drill'], pseudo_tools: [{ id: 'welder' }], ...options.part } },
    { source: 'test/welder.json', data: { id: 'welder', type: 'TOOL', name: 'Welder', qualities: [['WELD', 2]], charged_qualities: [['CUT', 3]] } },
    { source: 'test/drill.json', data: { id: 'drill', type: 'TOOL', name: 'Drill' } },
  ] }], ['dda']);
  if (options.unreliablePart) composition.parts.p._incompleteFields = options.unreliablePart;
  if (options.unreliableBase) composition.items.base._incompleteFields = options.unreliableBase;
  const english = options.english !== false;
  const value: AppContextValue = { locale: english ? 'en-US' : 'zh-CN', t: (zh, en) => english ? en : zh, composition: options.withoutComposition ? null : composition, manifest: null, catalogs: {}, name: (d, fallback) => stripColors(translationText(d?.name) || d?.id || fallback || '?') };
  const indexes: VehicleIndexes = { parts: new Map(Object.entries(composition.parts)), items: new Map(Object.entries(composition.items)) };
  return renderToStaticMarkup(createElement(AppContext.Provider, { value }, createElement(PartDetails, { partId: 'p', indexes, installed: options.installed, testId: options.testId, afterFeatured: options.afterFeatured })));
}
const featuredMarkup = (html: string) => html.slice(html.indexOf('class="spec-section part-featured-block"'), html.indexOf('class="spec-section part-secondary"'));

describe('read-only detail presentation', () => {
  const composition = compose([{ id: 'dda', name: 'dda', definitions: [
    { source: 'test/item.json', data: { id: 'base', type: 'GENERIC', name: 'Base item', description: '<color_red>Base text</color> <img src=x onerror=alert(1)>', weight: '20 kg', volume: '1 L' } },
    { source: 'test/part.json', data: { id: 'test', type: 'vehicle_part', item: 'base', name: 'Test part', description: '<color_green>Plain text</color> <script>alert(1)</script>', flags: [], qualities: [['JACK', 1]], durability: 100 } },
  ] }], ['dda']);
  const indexes = { parts: new Map(Object.entries(composition.parts)), items: new Map(Object.entries(composition.items)) };
  function context(english: boolean): AppContextValue {
    return { locale: english ? 'en-US' : 'zh-CN', t: (zh, en) => english ? en : zh, composition, manifest: null, catalogs: {}, name: (d, fallback) => stripColors(translationText(d?.name) || d?.id || fallback || '?') };
  }
  it('escapes source descriptions and advanced definitions instead of rendering game text as HTML', () => {
    const html = renderToStaticMarkup(createElement(AppContext.Provider, { value: context(true) }, createElement(PartDetails, { partId: 'test', indexes })));
    expect(html).toContain('Plain text');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img ');
    expect(html).toContain('20 kg');
    expect(html).toContain('Advanced data &amp; sources');
    expect(html).toContain('data-status="default"');
    expect(html).toContain('Level 1');
    expect(html).toContain('500 kg');
    const zh = renderToStaticMarkup(createElement(AppContext.Provider, { value: context(false) }, createElement(PartDetails, { partId: 'test', indexes })));
    expect(zh).toContain('1级');
    expect(zh).toContain('500 kg');
  });
  it('expands appliance functions in energy → tool/quality/compatibility → capacity order, leaving physical/protection rows collapsed', () => {
    const html = renderDetails();
    const core = featuredMarkup(html);
    const order = ['data-detail="fixed_consumption"', 'detail-core-note', 'data-capability-group="pseudoTools"', 'data-capability-group="partQualities"', 'data-capability-group="connectableTools"', 'data-detail="cargo_capacity"'].map(marker => core.indexOf(marker));
    expect(order.every(position => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('data-role="utility" data-primary="true"');
    expect(html).toContain('data-role="cargo" data-primary="false"');
    expect(html).toMatch(/class="spec-section part-featured-block"[^>]* open=""/);
    expect(html).toContain('<details class="spec-section part-secondary">');
    expect(html).toContain('<details class="spec-section advanced-data">');
    for (const id of ['weight', 'volume', 'durability', 'collision_damage_modifier', 'damage_reduction_all']) {
      expect(core).not.toContain(`data-detail="${id}"`);
      expect(html.indexOf(`data-detail="${id}"`)).toBeGreaterThan(html.indexOf('class="spec-section part-secondary"'));
    }
    for (const group of ['pseudoTools', 'partQualities', 'connectableTools', 'baseItemQualities']) expect(html.split(`data-capability-group="${group}"`).length - 1).toBe(1);
    for (const id of ['part_qualities', 'base_item_qualities', 'pseudo_tools', 'connectable_tools', 'jack_capacity']) expect(html).not.toContain(`data-detail="${id}"`);
    expect(core).toContain('Level 2');
    expect(core).toContain('Level 3');
    expect(core).toContain('Requires charge');
    expect(core).toContain('500 kg');
    expect(core).not.toContain('data-source="base_item"');
    expect(html).toContain('Base item qualities (not necessarily usable when installed)');
    expect(html).toContain('Compatibility does not mean a tool is installed or usable');
    expect(html).toContain('Fixed draw is not total operating energy');
    expect(html).toContain('Definition ratings below are not current operating values.');
  });
  it('keeps description then featured blocks then the instance slot before collapsed data, supporting custom comparison IDs', () => {
    const html = renderDetails({ testId: 'comparison-part-details', afterFeatured: createElement('aside', { 'data-testid': 'instance-slot' }, 'Instance summary') });
    expect(html).toContain('data-testid="comparison-part-details"');
    expect(html.indexOf('class="description"')).toBeLessThan(html.indexOf('class="spec-section part-featured-block"'));
    expect(html.indexOf('data-testid="instance-slot"')).toBeGreaterThan(html.lastIndexOf('class="spec-section part-featured-block"'));
    expect(html.indexOf('data-testid="instance-slot"')).toBeLessThan(html.indexOf('class="spec-section part-secondary"'));
    expect(renderDetails({ installed: true })).toContain('data-testid="installed-part-details"');
    expect(renderDetails()).toContain('data-testid="library-part-details"');
  });
  it.each([undefined, '', '   '])('falls back from empty part description %s to reliable base text with a source label, even without app composition', description => {
    const html = renderDetails({ part: { description }, withoutComposition: true });
    expect(html).toContain('data-description-source="base_item">Base fallback &lt;img');
    expect(html).toContain('Description source: base item');
    expect(html).not.toContain('<img ');
    expect(html.slice(0, html.indexOf('class="spec-section advanced-data"'))).not.toContain('&lt;color_red&gt;');
    expect(html.slice(html.indexOf('class="spec-section advanced-data"'))).toContain('&lt;color_red&gt;');
    expect(html).toContain('<h3>Appliance</h3>');
  });
  it('does not treat unresolved description text as a reliable fallback', () => {
    const html = renderDetails({ unreliablePart: ['description'] });
    expect(html).toContain('data-description-source="base_item"');
    expect(html).toContain('Part description inheritance is unresolved');
    const unavailable = renderDetails({ unreliablePart: ['description'], unreliableBase: ['description'] });
    expect(unavailable).toContain('data-description-source="unavailable">No reliable description');
    expect(unavailable).not.toContain('Description source: base item');
  });
  it('keeps utility-critical unknown draw visible without promoting default zero noise and renders bilingual conditions', () => {
    const html = renderDetails({ unreliablePart: ['epower'], part: { qualities: [] } });
    expect(featuredMarkup(html)).toMatch(/data-detail="fixed_consumption" data-status="unknown"/);
    expect(featuredMarkup(html)).not.toContain('data-detail="mechanical_output"');
    const zh = renderDetails({ english: false });
    expect(zh).toContain('设备与工具');
    expect(zh).toContain('固定耗电不等于全部操作能耗');
    expect(zh).toContain('需充能');
    expect(zh).toContain('其它参数与底层物品能力');
  });
  it('retains the global rating disclaimer while suppressing its redundant per-field copies', () => {
    const html = renderDetails({ part: { flags: ['ENGINE'], power: '8 kW', energy_consumption: '10 kW', fuel_type: 'battery' } });
    expect(html.split('Definition ratings below are not current operating values.').length - 1).toBe(1);
    expect(html).not.toContain('A rating, not a current operating value.');
    expect(html).toContain('Full-load electrical draw varies with demand; distinct from fixed draw.');
  });
  it('labels source-backed wind, cable and charger parameters without inventing generation or electrical draw', () => {
    const wind = renderDetails({ part: { flags: ['WIND_TURBINE'], epower: '1 W' } });
    expect(featuredMarkup(wind)).toContain('data-detail="wind_generation_coefficient"');
    expect(wind).toContain('not fixed output');
    expect(wind).toContain('multiplied by local wind power');
    expect(wind).not.toContain('data-detail="generation"');
    const cable = renderDetails({ part: { flags: ['POWER_TRANSFER'], epower: '1 kW' } });
    expect(cable).toContain('Cable transmission loss');
    expect(cable).toContain('1 %');
    expect(cable).not.toContain('data-detail="generation"');
    expect(cable).not.toContain('data-detail="fixed_consumption"');
    const charger = renderDetails({ part: { flags: ['RECHARGE'], bonus: 600, epower: undefined } });
    expect(featuredMarkup(charger)).toContain('data-detail="recharge_demand"');
    expect(charger).toContain('600 W');
    expect(charger).toContain('while actively charging');
    const zh = renderDetails({ english: false, part: { flags: ['POWER_TRANSFER'], epower: '1 kW' } });
    expect(zh).toContain('线缆传输损耗');
    expect(zh).not.toContain('transmission_loss_not_generation');
  });
  it('labels missing instance fields explicitly, preserves lossless charge tokens, and does not mutate the instance', () => {
    const part = { id: 'test', mount_dx: 0, mount_dy: 0, base: { typeid: 'base', charges: new LosslessNumber('9007199254740993') } };
    const html = renderToStaticMarkup(createElement(AppContext.Provider, { value: context(true) }, createElement(PartInstanceState, { part: part as unknown as VehiclePart })));
    expect(html).toContain('Not recorded');
    expect(html).toContain('9007199254740993');
    expect(part.base.charges.raw).toBe('9007199254740993');
    expect('enabled' in part).toBe(false);
    expect('damaged' in part.base).toBe(false);
    const zh = renderToStaticMarkup(createElement(AppContext.Provider, { value: context(false) }, createElement(PartInstanceState, { part: part as unknown as VehiclePart })));
    expect(zh).toContain('已记录实例状态');
    expect(zh).toContain('未记录');
  });
});
