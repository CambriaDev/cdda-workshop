/** SVG screen matrices use CSS pixels, just like PointerEvent.clientX/clientY. */
export interface Point { x: number; y: number }
export interface AffineMatrix { a: number; b: number; c: number; d: number; e: number; f: number }

export function screenToSvg(point: Point, inverse: AffineMatrix | null): Point | null {
  if (!inverse || ![point.x, point.y, inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f].every(Number.isFinite)) return null;
  const x = inverse.a * point.x + inverse.c * point.y + inverse.e;
  const y = inverse.b * point.x + inverse.d * point.y + inverse.f;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** The viewBox, not the SVG element's letterboxed rectangle, is selectable. */
export function svgToTile(point: Point, origin: Point, cell: number): [number, number] | null {
  if (![point.x, point.y, origin.x, origin.y, cell].every(Number.isFinite) || cell <= 0) return null;
  if (point.x < 0 || point.x > 800 || point.y < 0 || point.y > 560) return null;
  const x = Math.round((origin.y - point.y) / cell);
  const y = Math.round((point.x - origin.x) / cell);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  return [x === 0 ? 0 : x, y === 0 ? 0 : y];
}
