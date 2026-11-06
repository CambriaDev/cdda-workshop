import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Crosshair, Minus, Plus } from 'lucide-react';
import type { VehicleModel, VehicleIndexes } from '../../domain/vehicle';
import { useApp } from '../../app/context';
import { resolveGameColor } from '../../domain/data';
import { gridViewport, screenToSvg, svgToTile, type GridViewport } from './gridCoordinates';

function inverseScreenMatrix(svg: SVGSVGElement) {
  try { return svg.getScreenCTM()?.inverse() ?? null; } catch { return null; }
}
export function Grid({ vehicle, indexes, selected, onSelect }: { vehicle: VehicleModel; indexes: VehicleIndexes; selected: [number, number]; onSelect: (x: number, y: number) => void }) {
  const { t, colors = {} } = useApp();
  const [zoom, setZoom] = useState(1); const [pan, setPan] = useState<[number, number]>([0, 0]); const drag = useRef<{ pointerId: number; x: number; y: number; pan: [number, number] } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null); const svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState<GridViewport | null>(null);
  const bounds = viewport ?? { x: 0, y: 0, width: 800, height: 560 };
  const cell = 32 * zoom; const cx = 400 + pan[0]; const cy = 280 + pan[1];
  function cancelDrag() {
    const active = drag.current; drag.current = null;
    const svg = svgRef.current;
    if (active && svg?.hasPointerCapture(active.pointerId)) svg.releasePointerCapture(active.pointerId);
  }
  useLayoutEffect(() => {
    const pane = wrapRef.current;
    if (!pane) return;
    let previous: GridViewport | null = null;
    let previousWidth = -1; let previousHeight = -1;
    function measure(width: number, height: number) {
      if (width === previousWidth && height === previousHeight) return;
      previousWidth = width; previousHeight = height;
      // Even an equal-aspect resize changes the screen scale of a captured drag.
      cancelDrag();
      const next = gridViewport(width, height);
      if (next === previous || (next && previous && next.x === previous.x && next.y === previous.y && next.width === previous.width && next.height === previous.height)) return;
      previous = next; setViewport(next);
    }
    const rect = pane.getBoundingClientRect(); measure(rect.width, rect.height);
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) if (entry.target === pane) measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(pane);
    return () => { observer.disconnect(); cancelDrag(); };
  }, []);
  function endDrag(e: ReactPointerEvent<SVGSVGElement>) {
    if (drag.current?.pointerId === e.pointerId) cancelDrag();
  }
  const cells = new Map<string, { x: number; y: number; id: string; glyph: string; color: string; background?: string; order: number }>();
  vehicle.parts.forEach((p, i) => {
    const d = indexes.parts.get(p.id); const variants = Array.isArray(d?.variants) ? d.variants : [];
    const variant = variants.find(v => v && typeof v === 'object' && (v as Record<string, unknown>).id === (p.variant ?? '')) as Record<string, unknown> | undefined ?? variants[0] as Record<string, unknown> | undefined;
    const symbol = typeof variant?.symbols === 'string' ? [...variant.symbols][0] : typeof d?.symbol === 'string' ? [...d.symbol][0] : '?';
    const z = typeof d?.z_order === 'number' ? d.z_order : 0; // Shared source-version finalize owns layer semantics; never re-approximate here.
    const key = `${p.mount_dx},${p.mount_dy}`; const previous = cells.get(key);
    const color = resolveGameColor(d?.color, colors);
    // Negative source z-orders (roof/armor) do not draw their own glyph.
    if (z < 0) return;
    if (!previous || z >= previous.order) cells.set(key, { x: p.mount_dx, y: p.mount_dy, id: p.id, glyph: symbol ?? '?', color: color.foreground ?? 'currentColor', background: color.background, order: z });
  });
  return <div className="grid-wrap" ref={wrapRef}>
    <div className="grid-caption"><span><i className="status-dot" />{t('俯视 · 车头 +X ↑', 'TOP VIEW · FRONT +X ↑')}</span><span>{t('右键拖动平移 · 滚轮缩放', 'RIGHT-DRAG TO PAN · SCROLL TO ZOOM')}</span></div>
    <svg className="vehicle-grid" ref={svgRef} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} role="grid" aria-label={t('载具字符网格', 'Vehicle character grid')} tabIndex={0}
      onWheel={e => setZoom(z => Math.max(.4, Math.min(2.5, z + (e.deltaY < 0 ? .1 : -.1))))}
      onContextMenu={e => e.preventDefault()}
      onPointerDown={e => {
        if (drag.current || !viewport) return;
        const point = screenToSvg({ x: e.clientX, y: e.clientY }, inverseScreenMatrix(e.currentTarget));
        if (!point) return;
        if (e.button === 2 || e.button === 1) {
          e.preventDefault();
          drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, pan };
          e.currentTarget.setPointerCapture(e.pointerId);
        } else if (e.button === 0) {
          const tile = svgToTile(point, { x: cx, y: cy }, cell, viewport);
          if (tile) onSelect(...tile);
        }
      }}
      onPointerMove={e => {
        const active = drag.current;
        if (!active || active.pointerId !== e.pointerId) return;
        const inverse = inverseScreenMatrix(e.currentTarget);
        const start = screenToSvg({ x: active.x, y: active.y }, inverse);
        const current = screenToSvg({ x: e.clientX, y: e.clientY }, inverse);
        if (start && current) {
          const next: [number, number] = [active.pan[0] + current.x - start.x, active.pan[1] + current.y - start.y];
          if (next.every(Number.isFinite)) setPan(next);
        }
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={e => { const dirs: Record<string, [number, number]> = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }; if (dirs[e.key]) { e.preventDefault(); onSelect(selected[0] + dirs[e.key][0], selected[1] + dirs[e.key][1]); } }}>
      <defs><pattern id="minor-grid" width={cell} height={cell} x={cx - cell / 2} y={cy - cell / 2} patternUnits="userSpaceOnUse"><path d={`M ${cell} 0 L 0 0 0 ${cell}`} fill="none" stroke="#283330" strokeWidth=".8" /></pattern></defs>
      <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="url(#minor-grid)" />
      <path d={`M ${cx} ${bounds.y} V${bounds.y + bounds.height} M${bounds.x} ${cy} H${bounds.x + bounds.width}`} stroke="#465344" strokeDasharray="3 7" strokeWidth=".7" />
      {!vehicle.parts.length && <g className="grid-empty"><text x="400" y="208" textAnchor="middle" fill="#66716b" fontSize="13">{t('从一个车架开始', 'EVERY VEHICLE STARTS WITH A FRAME')}</text><text x="400" y="232" textAnchor="middle" fill="#4f5c56" fontSize="10">{t('选择格子 → 选择部件 → 安装', 'SELECT A TILE → CHOOSE A PART → INSTALL')}</text></g>}
      {[...cells.values()].map(c => <g key={`${c.x},${c.y}`}><rect x={cx + c.y * cell - cell / 2 + 2} y={cy - c.x * cell - cell / 2 + 2} width={cell - 4} height={cell - 4} rx="3" fill={c.background ?? '#26312b'} /><text x={cx + c.y * cell} y={cy - c.x * cell + cell * .27} textAnchor="middle" fill={c.color} fontFamily="Consolas, monospace" fontSize={cell * .78}>{c.glyph}</text><title>{c.id} ({c.x}, {c.y})</title></g>)}
      <rect x={cx + selected[1] * cell - cell / 2} y={cy - selected[0] * cell - cell / 2} width={cell} height={cell} fill="#b8d88b10" stroke="#b8d88b" strokeWidth="1.6" />
      <path d={`M${cx - 4},${cy}h8 M${cx},${cy - 4}v8`} stroke="#bfd990" />
    </svg>
    <div className="grid-controls"><button onClick={() => setPan([0, 0])} title={t('回到原点', 'Center origin')}><Crosshair size={15} /></button><button onClick={() => setZoom(z => Math.max(.4, z - .15))} aria-label={t('缩小', 'Zoom out')}><Minus size={15} /></button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(z => Math.min(2.5, z + .15))} aria-label={t('放大', 'Zoom in')}><Plus size={15} /></button></div>
    <div className="grid-coords">X {selected[0]} <span>/</span> Y {selected[1]} <span>·</span> {vehicle.parts.filter(p => p.mount_dx === selected[0] && p.mount_dy === selected[1]).length} {t('层', 'LAYERS')}</div>
  </div>;
}
