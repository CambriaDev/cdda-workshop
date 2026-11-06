import { describe, expect, it } from 'vitest';
import { gridViewport, screenToSvg, svgToTile } from '../../src/features/vehicle-editor/gridCoordinates';

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const origin = { x: 400, y: 280 };
const bounds = { x: 0, y: 0, width: 800, height: 560 };

describe('full-pane grid viewport', () => {
  it.each([[280, 760], [1000, 280], [800, 560], [280.25, 760.75], [110, 440]])('fills %s×%s without stretching or changing the old scale', (width, height) => {
    const viewport = gridViewport(width, height)!;
    const scale = Math.min(width / 800, height / 560);
    expect(viewport.x + viewport.width / 2).toBeCloseTo(400, 8);
    expect(viewport.y + viewport.height / 2).toBeCloseTo(280, 8);
    expect(viewport.width * scale).toBeCloseTo(width, 8);
    expect(viewport.height * scale).toBeCloseTo(height, 8);
    expect(viewport.x).toBeLessThanOrEqual(0);
    expect(viewport.y).toBeLessThanOrEqual(0);
    expect(viewport.x + viewport.width).toBeGreaterThanOrEqual(800);
    expect(viewport.y + viewport.height).toBeGreaterThanOrEqual(560);
    // Every pane region maps through the same inverse matrix, not just the old center strip.
    const left = 35; const top = 123;
    const inverse = { a: 1 / scale, b: 0, c: 0, d: 1 / scale, e: viewport.x - left / scale, f: viewport.y - top / scale };
    for (const fx of [.1, .5, .9]) for (const fy of [.1, .2, .5, .8, .9]) {
      const point = screenToSvg({ x: left + fx * width, y: top + fy * height }, inverse)!;
      expect(svgToTile(point, origin, 32, viewport)).toEqual([
        Math.round((origin.y - point.y) / 32) || 0, Math.round((point.x - origin.x) / 32) || 0,
      ]);
    }
  });
  it('selects above and below the old viewBox and rejects only outside the actual tall pane', () => {
    const viewport = gridViewport(280, 760)!;
    expect(svgToTile({ x: 400, y: -500 }, origin, 32, viewport)).toEqual([24, 0]);
    expect(svgToTile({ x: 400, y: 1060 }, origin, 32, viewport)).toEqual([-24, 0]);
    for (const y of [viewport.y, viewport.y + viewport.height]) expect(svgToTile({ x: 400, y }, origin, 32, viewport)).not.toBeNull();
    for (const y of [viewport.y - 1, viewport.y + viewport.height + 1]) expect(svgToTile({ x: 400, y }, origin, 32, viewport)).toBeNull();
  });
  it('selects both sides of the old viewBox in a wide pane', () => {
    const viewport = gridViewport(1000, 280)!;
    expect(svgToTile({ x: -400, y: 280 }, origin, 32, viewport)).toEqual([0, -25]);
    expect(svgToTile({ x: 1200, y: 280 }, origin, 32, viewport)).toEqual([0, 25]);
    for (const x of [viewport.x, viewport.x + viewport.width]) expect(svgToTile({ x, y: 280 }, origin, 32, viewport)).not.toBeNull();
    for (const x of [viewport.x - 1, viewport.x + viewport.width + 1]) expect(svgToTile({ x, y: 280 }, origin, 32, viewport)).toBeNull();
  });
  it('rejects unmeasured, non-finite, degenerate and overflowing viewports', () => {
    for (const [width, height] of [[0, 760], [280, 0], [-1, 560], [NaN, 560], [800, Infinity], [Number.MIN_VALUE, 560], [Number.MAX_VALUE, Number.MIN_VALUE]]) expect(gridViewport(width, height)).toBeNull();
    for (const invalid of [{ ...bounds, width: 0 }, { ...bounds, height: -1 }, { ...bounds, x: NaN }, { ...bounds, width: Infinity }, { ...bounds, x: Number.MAX_VALUE, width: Number.MAX_VALUE }]) expect(svgToTile(origin, origin, 32, invalid)).toBeNull();
  });
});

describe('SVG grid coordinate conversion', () => {
  it('converts tall letterboxed SVG screen points including page offset', () => {
    // 280×760 CSS viewport: scale .35, content 280×196, centered at y=282.
    // Element left=100, top=200. Target X=1,Y=-1 has SVG position (368,248).
    const inverse = { a: 1 / .35, b: 0, c: 0, d: 1 / .35, e: -100 / .35, f: -482 / .35 };
    const point = screenToSvg({ x: 228.8, y: 568.8 }, inverse)!;
    expect(point.x).toBeCloseTo(368); expect(point.y).toBeCloseTo(248);
    expect(svgToTile(point, origin, 32, bounds)).toEqual([1, -1]);
  });
  it('accounts for horizontal letterboxing without stretching', () => {
    // 1000×280, scale .5, horizontal margin 300; left=30, top=70.
    const point = screenToSvg({ x: 546, y: 226 }, { a: 2, b: 0, c: 0, d: 2, e: -660, f: -140 })!;
    expect(point).toEqual({ x: 432, y: 312 });
    expect(svgToTile(point, origin, 32, bounds)).toEqual([-1, 1]);
  });
  it('supports both off-diagonal affine coefficients', () => {
    expect(screenToSvg({ x: 10, y: 20 }, { a: 0, b: -2, c: 2, d: 0, e: 5, f: 7 })).toEqual({ x: 45, y: -13 });
  });
  it.each([.4, 1, 1.15, 2.5])('selects positive and negative tiles at zoom %s with pan', zoom => {
    const panned = { x: 452, y: 252 }; const cell = 32 * zoom;
    for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, -2], [-2, 2]]) {
      expect(svgToTile({ x: panned.x + y * cell, y: panned.y - x * cell }, panned, cell, bounds)).toEqual([x, y]);
    }
  });
  it('preserves nearest-center rounding and normalizes negative zero', () => {
    expect(svgToTile({ x: 415.99, y: 264.01 }, origin, 32, bounds)).toEqual([0, 0]);
    expect(svgToTile({ x: 416, y: 264 }, origin, 32, bounds)).toEqual([1, 1]);
    expect(svgToTile({ x: 384, y: 296 }, origin, 32, bounds)).toEqual([0, 0]);
    expect(svgToTile({ x: 383.99, y: 296.01 }, origin, 32, bounds)).toEqual([-1, -1]);
  });
  it('uses the same inverse scale for both pan endpoints', () => {
    const inverse = { a: 4, b: 0, c: 0, d: 4, e: -120, f: -500 };
    const start = screenToSvg({ x: 100, y: 200 }, inverse)!;
    const end = screenToSvg({ x: 125, y: 215 }, inverse)!;
    expect([end.x - start.x, end.y - start.y]).toEqual([100, 60]);
  });
  it.each([{ x: -1, y: 280 }, { x: 801, y: 280 }, { x: 400, y: -1 }, { x: 400, y: 561 }])('rejects a point outside the supplied viewport %j', point => {
    expect(svgToTile(point, origin, 32, bounds)).toBeNull();
  });
  it('keeps viewBox edges selectable', () => {
    expect(svgToTile({ x: 0, y: 0 }, origin, 32, bounds)).not.toBeNull();
    expect(svgToTile({ x: 800, y: 560 }, origin, 32, bounds)).not.toBeNull();
  });
  it('ignores missing, singular and non-finite inverse matrices', () => {
    expect(screenToSvg(origin, null)).toBeNull();
    expect(screenToSvg(origin, { ...identity, a: NaN })).toBeNull();
    expect(screenToSvg(origin, { ...identity, e: Infinity })).toBeNull();
    expect(screenToSvg({ x: Infinity, y: 0 }, identity)).toBeNull();
    expect(screenToSvg({ x: Number.MAX_VALUE, y: 0 }, { ...identity, a: 2 })).toBeNull();
  });
  it('ignores invalid tile geometry instead of emitting corrupt coordinates', () => {
    for (const cell of [0, -1, NaN, Infinity, Number.MIN_VALUE]) expect(svgToTile({ x: 432, y: 280 }, origin, cell, bounds)).toBeNull();
    expect(svgToTile({ x: NaN, y: 0 }, origin, 32, bounds)).toBeNull();
    expect(svgToTile(origin, { x: Infinity, y: 0 }, 32, bounds)).toBeNull();
  });
});
