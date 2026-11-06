import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppContext, type AppContextValue } from '../../src/app/context';
import { compose } from '../../src/domain/data';
import type { VehicleModel } from '../../src/domain/vehicle';
import { VehicleSystemsOverview } from '../../src/features/vehicle-editor/VehicleSystemsOverview';

function render(parts: VehicleModel['parts'], english = true) {
  const composition = compose([{ id: 'dda', name: 'dda', definitions: [
    { source: 'test/items.json', data: { id: 'base', type: 'GENERIC', weight: '2 kg', volume: '1 L' } },
    { source: 'test/items.json', data: { id: 'other_base', type: 'GENERIC', weight: '3 kg', volume: '1 L' } },
    ...['motor', 'different_motor'].map(id => ({ source: 'test/parts.json', data: { id, type: 'vehicle_part', item: 'base', name: 'Same translated name', flags: ['ENGINE'], fuel_type: 'battery', power: '7.04 kW', energy_consumption: '8 kW' } })),
  ] }], ['dda']);
  const context: AppContextValue = { locale: english ? 'en-US' : 'zh-CN', t: (zh, en) => english ? en : zh, composition, manifest: null, catalogs: {}, name: (_d, fallback) => fallback ?? '?' };
  const indexes = { parts: new Map(Object.entries(composition.parts)), items: new Map(Object.entries(composition.items)) };
  return renderToStaticMarkup(createElement(AppContext.Provider, { value: context }, createElement(VehicleSystemsOverview, { vehicle: { name: 'Test', parts }, indexes })));
}
const motor = (overrides: Partial<VehicleModel['parts'][number]> = {}) => ({ id: 'motor', mount_dx: 0, mount_dy: 0, base: { typeid: 'base' }, ...overrides });
const metric = (html: string, key: string) => html.match(new RegExp(`data-system-total="${key}"[\\s\\S]*?</div>`))?.[0] ?? '';

describe('read-only grouped vehicle overview presentation', () => {
  it('renders repeated models initially collapsed with group totals and instance state notices', () => {
    const html = render([motor(), motor({ mount_dx: 1, enabled: false, base: { typeid: 'base', damaged: 50, faults: ['test_fault'] } })]);
    expect(html).toContain('2 parts · 1 model');
    const group = html.match(/<details class="systems-group"[^>]*data-system-group-kind="engine"[^>]*>/)?.[0];
    expect(group).toBeDefined();
    expect(group).not.toContain('open=');
    expect(html).toContain('× 2');
    expect(html).toContain('14.08 kW');
    expect(html).toContain('16 kW');
    expect(html).toContain('1 disabled');
    expect(html).toContain('1 damaged');
    expect(html).toContain('1 with faults');
    expect(html).toContain('data-system-kind="engine" data-system-part-index="1"');
    expect(html).toContain('(1, 0)');
  });
  it('does not group singletons with different part or actual base IDs despite matching names', () => {
    const html = render([motor(), motor({ id: 'different_motor' }), motor({ base: { typeid: 'other_base' } })]);
    expect(html).toContain('3 parts · 3 models');
    expect(html).not.toContain('data-system-group-kind=');
    expect(html).toContain('data-system-kind="engine" data-system-part-index="0"');
    expect(html).toContain('other_base');
  });
  it('renders entirely unknown totals as unknown, never a certain zero, in both languages', () => {
    const parts = [{ id: 'unresolved', mount_dx: 0, mount_dy: 0 }];
    const html = render(parts);
    expect(metric(html, 'enginePower')).toContain('Unknown');
    expect(metric(html, 'enginePower')).not.toMatch(/>0 (?:W|kW|hp)</);
    expect(metric(html, 'tankVolume')).toContain('Unknown');
    expect(metric(html, 'batteryCapacity')).toContain('Unknown');
    const zh = render(parts, false);
    expect(metric(zh, 'enginePower')).toContain('未知');
    expect(zh).not.toContain('known subtotal');
  });
});
