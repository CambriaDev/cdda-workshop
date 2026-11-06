/** SVG screen matrices use CSS pixels, just like PointerEvent.clientX/clientY. */
export interface Point { x: number; y: number }
export interface AffineMatrix { a: number; b: number; c: number; d: number; e: number; f: number }
export interface GridViewport { x: number; y: number; width: number; height: number }

/** Expand the old 800×560 viewBox to fill the pane without changing its uniform scale or center. */
export function gridViewport(width: number, height: number): GridViewport | null {
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const scale = Math.min(width / 800, height / 560);
  const logicalWidth = Math.max(800, width / scale); const logicalHeight = Math.max(560, height / scale);
  const viewport = { x: (800 - logicalWidth) / 2, y: (560 - logicalHeight) / 2, width: logicalWidth, height: logicalHeight };
  return validViewport(viewport) ? viewport : null;
}

function validViewport(viewport: GridViewport): boolean {
  return [viewport.x, viewport.y, viewport.width, viewport.height, viewport.x + viewport.width, viewport.y + viewport.height].every(Number.isFinite)
    && viewport.width > 0 && viewport.height > 0;
}

export function screenToSvg(point: Point, inverse: AffineMatrix | null): Point | null {
  if (!inverse || ![point.x, point.y, inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f].every(Number.isFinite)) return null;
  const x = inverse.a * point.x + inverse.c * point.y + inverse.e;
  const y = inverse.b * point.x + inverse.d * point.y + inverse.f;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** All of the current visible viewport is selectable, including the former letterbox regions. */
export function svgToTile(point: Point, origin: Point, cell: number, viewport: GridViewport): [number, number] | null {
  if (![point.x, point.y, origin.x, origin.y, cell].every(Number.isFinite) || cell <= 0 || !validViewport(viewport)) return null;
  if (point.x < viewport.x || point.x > viewport.x + viewport.width || point.y < viewport.y || point.y > viewport.y + viewport.height) return null;
  const x = Math.round((origin.y - point.y) / cell);
  const y = Math.round((point.x - origin.x) / cell);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  return [x === 0 ? 0 : x, y === 0 ? 0 : y];
}
