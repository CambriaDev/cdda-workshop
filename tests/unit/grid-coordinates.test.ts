import { describe, expect, it } from 'vitest';
import { screenToSvg, svgToTile } from '../../src/features/vehicle-editor/gridCoordinates';

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const origin = { x: 400, y: 280 };

describe('SVG grid coordinate conversion', () => {
  it('converts tall letterboxed SVG screen points including page offset', () => {
    // 280×760 CSS viewport: scale .35, content 280×196, centered at y=282.
    // Element left=100, top=200. Target X=1,Y=-1 has SVG position (368,248).
    const inverse = { a: 1 / .35, b: 0, c: 0, d: 1 / .35, e: -100 / .35, f: -482 / .35 };
    const point = screenToSvg({ x: 228.8, y: 568.8 }, inverse)!;
    expect(point.x).toBeCloseTo(368); expect(point.y).toBeCloseTo(248);
    expect(svgToTile(point, origin, 32)).toEqual([1, -1]);
  });
  it('accounts for horizontal letterboxing without stretching', () => {
    // 1000×280, scale .5, horizontal margin 300; left=30, top=70.
    const point = screenToSvg({ x: 546, y: 226 }, { a: 2, b: 0, c: 0, d: 2, e: -660, f: -140 })!;
    expect(point).toEqual({ x: 432, y: 312 });
    expect(svgToTile(point, origin, 32)).toEqual([-1, 1]);
  });
  it('supports both off-diagonal affine coefficients', () => {
    expect(screenToSvg({ x: 10, y: 20 }, { a: 0, b: -2, c: 2, d: 0, e: 5, f: 7 })).toEqual({ x: 45, y: -13 });
  });
  it.each([.4, 1, 1.15, 2.5])('selects positive and negative tiles at zoom %s with pan', zoom => {
    const panned = { x: 452, y: 252 }; const cell = 32 * zoom;
    for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, -2], [-2, 2]]) {
      expect(svgToTile({ x: panned.x + y * cell, y: panned.y - x * cell }, panned, cell)).toEqual([x, y]);
    }
  });
  it('preserves nearest-center rounding and normalizes negative zero', () => {
    expect(svgToTile({ x: 415.99, y: 264.01 }, origin, 32)).toEqual([0, 0]);
    expect(svgToTile({ x: 416, y: 264 }, origin, 32)).toEqual([1, 1]);
    expect(svgToTile({ x: 384, y: 296 }, origin, 32)).toEqual([0, 0]);
    expect(svgToTile({ x: 383.99, y: 296.01 }, origin, 32)).toEqual([-1, -1]);
  });
  it('uses the same inverse scale for both pan endpoints', () => {
    const inverse = { a: 4, b: 0, c: 0, d: 4, e: -120, f: -500 };
    const start = screenToSvg({ x: 100, y: 200 }, inverse)!;
    const end = screenToSvg({ x: 125, y: 215 }, inverse)!;
    expect([end.x - start.x, end.y - start.y]).toEqual([100, 60]);
  });
  it.each([{ x: -1, y: 280 }, { x: 801, y: 280 }, { x: 400, y: -1 }, { x: 400, y: 561 }])('rejects SVG letterbox point %j', point => {
    expect(svgToTile(point, origin, 32)).toBeNull();
  });
  it('keeps viewBox edges selectable', () => {
    expect(svgToTile({ x: 0, y: 0 }, origin, 32)).not.toBeNull();
    expect(svgToTile({ x: 800, y: 560 }, origin, 32)).not.toBeNull();
  });
  it('ignores missing, singular and non-finite inverse matrices', () => {
    expect(screenToSvg(origin, null)).toBeNull();
    expect(screenToSvg(origin, { ...identity, a: NaN })).toBeNull();
    expect(screenToSvg(origin, { ...identity, e: Infinity })).toBeNull();
    expect(screenToSvg({ x: Infinity, y: 0 }, identity)).toBeNull();
    expect(screenToSvg({ x: Number.MAX_VALUE, y: 0 }, { ...identity, a: 2 })).toBeNull();
  });
  it('ignores invalid tile geometry instead of emitting corrupt coordinates', () => {
    for (const cell of [0, -1, NaN, Infinity, Number.MIN_VALUE]) expect(svgToTile({ x: 432, y: 280 }, origin, cell)).toBeNull();
    expect(svgToTile({ x: NaN, y: 0 }, origin, 32)).toBeNull();
    expect(svgToTile(origin, { x: Infinity, y: 0 }, 32)).toBeNull();
  });
});
