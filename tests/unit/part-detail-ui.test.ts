import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppContext, stripColors, type AppContextValue } from '../../src/app/context';
import { compose } from '../../src/domain/data';
import type { VehiclePart } from '../../src/domain/vehicle';
import { LosslessNumber } from '../../src/domain/save/losslessJson';
import { PartDetails } from '../../src/features/vehicle-editor/PartDetails';
import { PartInstanceState } from '../../src/features/vehicle-editor/PartInstanceState';
import { translationText } from '../../src/i18n/gettext';

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
