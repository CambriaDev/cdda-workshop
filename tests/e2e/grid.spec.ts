import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Tile = [number, number];
type Point = { x: number; y: number };
const grid = (page: Page) => page.locator('svg.vehicle-grid');

async function ready(page: Page) {
  await page.goto('/');
  // Keep the production Chinese locale and wait for the real dataset, not just the shell.
  await expect(page.getByRole('button', { name: '安装到当前格', exact: true })).toBeEnabled();
  await expect(grid(page)).toBeVisible();
}

// Independent rendering oracle: read the actual viewBox, pattern and browser CTM.
// No production coordinate helper, axis-path regex, fixed selectable limits, CSS-size
// assumptions, or coordinates obtained from the selection being tested are used.
async function geometry(page: Page, tile: Tile = [0, 0]) {
  return grid(page).evaluate((element, [x, y]) => {
    const svg = element as SVGSVGElement;
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error('The rendered grid has no screen CTM');
    const inverse = matrix.inverse();
    const rects = svg.querySelectorAll<SVGRectElement>(':scope > rect');
    const background = rects[0]; const selection = rects[rects.length - 1];
    const pattern = svg.querySelector<SVGPatternElement>('defs > pattern');
    const axes = svg.querySelector<SVGPathElement>(':scope > path');
    if (!background || !selection || !pattern || !axes) throw new Error('Missing rendered grid geometry');
    const cell = pattern.width.baseVal.value;
    const cx = pattern.x.baseVal.value + cell / 2;
    const cy = pattern.y.baseVal.value + pattern.height.baseVal.value / 2;
    const screen = (sx: number, sy: number) => {
      const point = new DOMPoint(sx, sy).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    };
    const box = svg.viewBox.baseVal;
    const bounds = svg.getBoundingClientRect();
    const wrapper = svg.closest('.grid-wrap')!;
    const pane = wrapper.getBoundingClientRect(); const style = getComputedStyle(wrapper);
    const axisBox = axes.getBBox();
    const origin = screen(cx, cy); const right = screen(cx + cell, cy); const down = screen(cx, cy + cell);
    return {
      cell,
      inverse: { a: inverse.a, b: inverse.b, c: inverse.c, d: inverse.d, e: inverse.e, f: inverse.f },
      matrix: { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f },
      viewBox: { x: box.x, y: box.y, width: box.width, height: box.height },
      background: { x: background.x.baseVal.value, y: background.y.baseVal.value,
        width: background.width.baseVal.value, height: background.height.baseVal.value },
      axes: { x: axisBox.x, y: axisBox.y, width: axisBox.width, height: axisBox.height },
      pattern: { width: pattern.width.baseVal.value, height: pattern.height.baseVal.value,
        x: pattern.x.baseVal.value, y: pattern.y.baseVal.value },
      svgOrigin: { x: cx, y: cy },
      selectionWidth: selection.width.baseVal.value, selectionHeight: selection.height.baseVal.value,
      screenCellWidth: Math.hypot(right.x - origin.x, right.y - origin.y),
      screenCellHeight: Math.hypot(down.x - origin.x, down.y - origin.y),
      origin,
      // CDDA mount axes: +X is up, +Y is right.
      target: screen(cx + y * cell, cy - x * cell),
      selection: screen(selection.x.baseVal.value + selection.width.baseVal.value / 2,
        selection.y.baseVal.value + selection.height.baseVal.value / 2),
      renderedStart: screen(box.x, box.y), renderedEnd: screen(box.x + box.width, box.y + box.height),
      viewportCenter: screen(box.x + box.width / 2, box.y + box.height / 2),
      // Historical 800x560 footprint ONLY identifies former dead bars in regression
      // cases below. It is never used as the current viewport or selection oracle.
      legacyStart: screen(0, 0), legacyEnd: screen(800, 560),
      bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
      pane: { left: pane.left + parseFloat(style.borderLeftWidth), top: pane.top + parseFloat(style.borderTopWidth),
        right: pane.right - parseFloat(style.borderRightWidth), bottom: pane.bottom - parseFloat(style.borderBottomWidth) },
    };
  }, tile);
}

type Geometry = Awaited<ReturnType<typeof geometry>>;

// Invert a RAW screen point using only the independently read browser matrix and
// rendered pattern. The click is not aimed at a preselected tile center.
function selectionAt(g: Geometry, point: Point) {
  const m = g.inverse;
  const sx = m.a * point.x + m.c * point.y + m.e;
  const sy = m.b * point.x + m.d * point.y + m.f;
  const tile: Tile = [Math.round((g.svgOrigin.y - sy) / g.cell) || 0, Math.round((sx - g.svgOrigin.x) / g.cell) || 0];
  const x = g.svgOrigin.x + tile[1] * g.cell; const y = g.svgOrigin.y - tile[0] * g.cell;
  const forward = g.matrix;
  return { tile, center: { x: forward.a * x + forward.c * y + forward.e, y: forward.b * x + forward.d * y + forward.f } };
}

function expectSquareCells(g: Geometry) {
  expect(g.cell).toBeGreaterThan(0);
  expect(g.selectionWidth).toBeCloseTo(g.cell, 6);
  expect(g.selectionHeight).toBeCloseTo(g.cell, 6);
  expect(g.pattern.height).toBeCloseTo(g.cell, 6);
  expect(g.screenCellWidth).toBeGreaterThan(0);
  expect(g.screenCellWidth).toBeCloseTo(g.screenCellHeight, 4);
}

async function fullPaneGeometry(page: Page) {
  await grid(page).scrollIntoViewIfNeeded();
  // ResizeObserver delivery/React layout must have caught up, rather than sleeping.
  await expect.poll(async () => {
    const g = await geometry(page);
    return Math.max(Math.abs(g.renderedStart.x - g.bounds.left), Math.abs(g.renderedStart.y - g.bounds.top),
      Math.abs(g.renderedEnd.x - g.bounds.right), Math.abs(g.renderedEnd.y - g.bounds.bottom));
  }, { message: 'The actual viewBox must cover every screen pixel of the SVG pane, without letterboxing' }).toBeLessThan(.5);
  const g = await geometry(page);
  for (const edge of ['left', 'top', 'right', 'bottom'] as const) expect(g.bounds[edge]).toBeCloseTo(g.pane[edge], 0);
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(g.background[key], `Background ${key} spans the actual viewBox`).toBeCloseTo(g.viewBox[key], 3);
    expect(g.axes[key], `Axes ${key} span the actual viewBox`).toBeCloseTo(g.viewBox[key], 3);
  }
  expectSquareCells(g);
  return g;
}

async function clickScreenPoint(page: Page, point: Point, g?: Geometry) {
  const before = g ?? await geometry(page);
  expect(point.x).toBeGreaterThan(before.bounds.left); expect(point.x).toBeLessThan(before.bounds.right);
  expect(point.y).toBeGreaterThan(before.bounds.top); expect(point.y).toBeLessThan(before.bounds.bottom);
  const viewport = page.viewportSize()!;
  expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(viewport.width);
  expect(point.y).toBeGreaterThan(0); expect(point.y).toBeLessThan(viewport.height);
  // Interactive overlay controls are deliberately excluded from canvas clicks.
  expect(await grid(page).evaluate((svg, p) => svg.contains(document.elementFromPoint(p.x, p.y)), point)).toBe(true);
  const expected = selectionAt(before, point);
  await page.mouse.click(point.x, point.y);
  await expectSelection(page, expected.tile, expected.center);
  expectSquareCells(await geometry(page));
  return expected.tile;
}

async function clickScreenFraction(page: Page, x: number, y: number) {
  const g = await fullPaneGeometry(page);
  return clickScreenPoint(page, { x: g.bounds.left + (g.bounds.right - g.bounds.left) * x,
    y: g.bounds.top + (g.bounds.bottom - g.bounds.top) * y }, g);
}

async function clickVerticalBand(page: Page, fraction: number) {
  const g = await fullPaneGeometry(page);
  const point = { x: g.bounds.left + (g.bounds.right - g.bounds.left) * .5,
    y: g.bounds.top + (g.bounds.bottom - g.bounds.top) * fraction };
  // At narrow widths the bottom toolbar can occupy the center-column .9 probe.
  // Keep the EXACT raw Y fraction, but move to the left edge only when a real
  // interactive control obstructs it; never silently skip a band or other overlay.
  const hit = await grid(page).evaluate((svg, p) => {
    const target = document.elementFromPoint(p.x, p.y);
    return { canvas: svg.contains(target), control: !!target?.closest('.grid-controls') };
  }, point);
  if (!hit.canvas) {
    expect(hit.control, 'Only the interactive toolbar may obstruct a raw canvas probe').toBe(true);
    point.x = g.bounds.left + (g.bounds.right - g.bounds.left) * .02;
  }
  return clickScreenPoint(page, point, g);
}

function legacyDeadPoint(g: Geometry, side: 'top' | 'bottom' | 'left' | 'right'): Point {
  const { left, top, right, bottom } = g.bounds;
  const gaps = { top: g.legacyStart.y - top, bottom: bottom - g.legacyEnd.y,
    left: g.legacyStart.x - left, right: right - g.legacyEnd.x };
  expect(gaps[side], `The ${side} probe must actually lie in a former letterbox area`).toBeGreaterThan(8);
  if (side === 'top') return { x: left + (right - left) * .5, y: top + gaps.top / 2 };
  if (side === 'bottom') return { x: left + (right - left) * .5, y: bottom - gaps.bottom / 2 };
  return { x: side === 'left' ? left + gaps.left / 2 : right - gaps.right / 2, y: top + (bottom - top) * .5 };
}

function coords(tile: Tile) {
  // React inserts separate text nodes/spans; whitespace is not part of the contract.
  return new RegExp(`^\\s*X\\s*${tile[0]}\\s*\\/\\s*Y\\s*${tile[1]}(?=\\s|[·/]|$)`);
}

async function expectSelection(page: Page, tile: Tile, target?: Point) {
  await expect(page.locator('.grid-coords')).toHaveText(coords(tile));
  await expect.poll(async () => {
    const g = await geometry(page, tile);
    const expected = target ?? g.target;
    return Math.max(Math.abs(g.selection.x - expected.x), Math.abs(g.selection.y - expected.y));
  }, { message: `Selection rectangle must be centered on tile (${tile.join(', ')}) in screen pixels` }).toBeLessThan(1);
}

async function clickTile(page: Page, tile: Tile) {
  // The canvas can be below the fold, especially after mobile resize or inspector updates.
  await grid(page).scrollIntoViewIfNeeded();
  const g = await geometry(page, tile);
  expectSquareCells(g);
  // SVG animated lengths expose float32 values; allow sub-millipixel rounding at fractional zoom/pan.
  expect(g.pattern.x).toBeCloseTo(g.svgOrigin.x - g.cell / 2, 3);
  expect(g.pattern.y).toBeCloseTo(g.svgOrigin.y - g.cell / 2, 3);
  expect(g.target.x).toBeGreaterThan(g.renderedStart.x);
  expect(g.target.x).toBeLessThan(g.renderedEnd.x);
  expect(g.target.y).toBeGreaterThan(g.renderedStart.y);
  expect(g.target.y).toBeLessThan(g.renderedEnd.y);
  const viewport = page.viewportSize()!;
  expect(g.target.x).toBeGreaterThan(0);
  expect(g.target.x).toBeLessThan(viewport.width);
  expect(g.target.y).toBeGreaterThan(0);
  expect(g.target.y).toBeLessThan(viewport.height);
  await page.mouse.click(g.target.x, g.target.y);
  await expectSelection(page, tile, g.target);
}

async function expectOriginShift(page: Page, before: Point, dx: number, dy: number) {
  await expect.poll(async () => {
    const { origin } = await geometry(page);
    return Math.max(Math.abs(origin.x - before.x - dx), Math.abs(origin.y - before.y - dy));
  }, { message: `Rendered origin should follow screen drag (${dx}, ${dy}) exactly` }).toBeLessThan(1);
}

for (const width of [1920, 1440, 1280, 1024, 390]) {
  test(`real mouse selects signed tiles and raw full-pane top middle bottom and edge points at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await ready(page);
    // Vertical then horizontal adjacency on both sides catches axis swaps and rounding errors.
    for (const tile of [[1, 2], [2, 2], [2, 3], [-1, -2], [-2, -2], [-2, -3]] as Tile[]) {
      await clickTile(page, tile);
    }
    const g = await fullPaneGeometry(page);
    expect(g.origin.x).toBeCloseTo(g.viewportCenter.x, 3);
    expect(g.origin.y).toBeCloseTo(g.viewportCenter.y, 3);
    // Raw screen fractions, not tile-center clicks: every vertical band and both
    // horizontal edges must resolve to the visibly highlighted, square rendered cell.
    for (const y of [.1, .2, .5, .8, .9]) await clickVerticalBand(page, y);
    for (const x of [.02, .1, .5, .9, .98]) await clickScreenFraction(page, x, .5);
    if (width === 1920 || width === 390) {
      await page.locator('.grid-wrap').screenshot({ path: testInfo.outputPath(`full-pane-${width === 390 ? 'mobile' : 'desktop'}.png`) });
    }
  });
}

test('zoom buttons and real wheel preserve selection and allow accurate new clicks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await ready(page);
  const selected: Tile = [2, -2];
  await clickTile(page, selected);
  const initial = (await geometry(page)).cell;
  // The toolbar's non-button zoom readout must not click through to the SVG.
  await page.locator('.grid-controls > span').click();
  await expectSelection(page, selected);
  expect((await geometry(page)).cell).toBeCloseTo(initial, 6);
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect.poll(async () => (await geometry(page)).cell).toBeGreaterThan(initial);
  await expectSelection(page, selected);
  await clickTile(page, [-2, 3]);
  await page.getByRole('button', { name: '缩小', exact: true }).click();
  await expect.poll(async () => (await geometry(page)).cell).toBeCloseTo(initial, 6);
  await expectSelection(page, [-2, 3]);

  await grid(page).scrollIntoViewIfNeeded();
  let g = await geometry(page);
  await page.mouse.move(g.viewportCenter.x, g.viewportCenter.y);
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await geometry(page)).cell).toBeGreaterThan(initial);
  await expectSelection(page, [-2, 3]);
  await clickTile(page, [3, 1]);
  await grid(page).scrollIntoViewIfNeeded();
  g = await geometry(page);
  await page.mouse.move(g.viewportCenter.x, g.viewportCenter.y);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await geometry(page)).cell).toBeCloseTo(initial, 6);
  await expectSelection(page, [3, 1]);
  await clickTile(page, [-1, -3]);
});

for (const width of [1280, 390]) {
  test(`real right and middle drags follow each screen axis without selecting at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await ready(page);
    const selected: Tile = [1, -1];
    await clickTile(page, selected);
    for (const button of ['right', 'middle'] as const) {
      await grid(page).scrollIntoViewIfNeeded();
      const g = await geometry(page);
      const start = g.viewportCenter;
      await page.mouse.move(start.x, start.y);
      await page.mouse.down({ button });
      try {
        await page.mouse.move(start.x + 24, start.y, { steps: 4 });
        await expectOriginShift(page, g.origin, 24, 0);
        await expectSelection(page, selected);
        await page.mouse.move(start.x + 24, start.y + 18, { steps: 4 });
        await expectOriginShift(page, g.origin, 24, 18);
        await expectSelection(page, selected);
      } finally {
        await page.mouse.up({ button });
      }
      const released = (await geometry(page)).origin;
      await page.mouse.move(start.x - 12, start.y - 12, { steps: 4 });
      await expectOriginShift(page, released, 0, 0);
      await expectSelection(page, selected);
      await clickTile(page, [-1, 2]);
      // Center resets pan only, not tile selection or zoom.
      await page.getByTitle('回到原点', { exact: true }).click();
      await grid(page).scrollIntoViewIfNeeded();
      const centered = await geometry(page);
      await expectOriginShift(page, centered.viewportCenter, 0, 0);
      await expectSelection(page, [-1, 2]);
      await clickTile(page, selected);
    }
  });
}

for (const event of ['pointercancel', 'lostpointercapture'] as const) {
  test(`${event} ends an active browser drag and the next drag still works`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 1000 });
    await ready(page);
    const selected: Tile = [-1, 2];
    await clickTile(page, selected);
    await grid(page).scrollIntoViewIfNeeded();
    // Capture the real browser pointer ID; only abnormal lifecycle events are deliberate dispatches.
    await grid(page).evaluate(element => {
      element.addEventListener('pointerdown', e => {
        element.setAttribute('data-e2e-pointer-id', String((e as PointerEvent).pointerId));
      }, { once: true });
    });
    let g = await geometry(page);
    const start = g.viewportCenter;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: 'right' });
    try {
      await page.mouse.move(start.x + 20, start.y + 12, { steps: 4 });
      await expectOriginShift(page, g.origin, 20, 12);
      const pointerId = Number(await grid(page).getAttribute('data-e2e-pointer-id'));
      expect(pointerId).toBeGreaterThan(0);
      // Another pointer's cancellation/capture loss must not end this active mouse drag.
      await grid(page).dispatchEvent(event, { pointerId: pointerId + 1, pointerType: 'touch' });
      await page.mouse.move(start.x + 26, start.y + 16, { steps: 3 });
      await expectOriginShift(page, g.origin, 26, 16);
      await grid(page).dispatchEvent(event, { pointerId, pointerType: 'mouse', button: 2, buttons: 2 });
      const ended = (await geometry(page)).origin;
      await page.mouse.move(start.x - 15, start.y - 10, { steps: 4 });
      await expectOriginShift(page, ended, 0, 0);
      await expectSelection(page, selected);
    } finally {
      await page.mouse.up({ button: 'right' });
    }
    // Cleanup must not leave a stale drag that blocks future pointerdown.
    g = await geometry(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: 'middle' });
    try {
      await page.mouse.move(start.x - 16, start.y + 14, { steps: 4 });
      await expectOriginShift(page, g.origin, -16, 14);
    } finally {
      await page.mouse.up({ button: 'middle' });
    }
    const released = (await geometry(page)).origin;
    await page.mouse.move(start.x + 10, start.y - 10);
    await expectOriginShift(page, released, 0, 0);
    await expectSelection(page, selected);
    await clickTile(page, [2, -1]);
  });
}

test('fresh screen CTMs are used after document scrolling and responsive resizing', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await ready(page);
  await clickTile(page, [1, 2]);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await clickTile(page, [-2, 1]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 1440, height: 900 });
  await clickTile(page, [2, -3]);
});

test('natural tall and forced wide-short wrappers select throughout former letterbox areas', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await clickTile(page, [1, -2]);
  // Natural layout: both old upper and lower dead bands now contain real cells.
  for (const side of ['top', 'bottom'] as const) {
    const g = await fullPaneGeometry(page);
    const selected = await clickScreenPoint(page, legacyDeadPoint(g, side), g);
    expect(side === 'top' ? selected[0] : -selected[0]).toBeGreaterThan(0);
  }
  await page.locator('.grid-wrap').screenshot({ path: testInfo.outputPath('full-pane-natural-tall.png') });

  // Change the observed WRAPPER, not the SVG itself: its absolute fill and
  // ResizeObserver must follow a genuinely wide, short browser layout. At 1280px
  // the two-column workbench gives this pane enough width for unambiguous bars.
  await page.setViewportSize({ width: 1280, height: 1000 });
  const before = await fullPaneGeometry(page);
  await page.locator('.grid-wrap').evaluate(element => {
    const wrapper = element as HTMLElement;
    wrapper.style.width = '100%';
    wrapper.style.height = '180px';
    wrapper.style.minHeight = '0';
    wrapper.style.maxHeight = '180px';
    wrapper.style.alignSelf = 'start';
  });
  await expect.poll(async () => (await geometry(page)).bounds.bottom - (await geometry(page)).bounds.top).toBeLessThan(181);
  let g = await fullPaneGeometry(page);
  expect(g.viewBox.width).toBeGreaterThan(g.viewBox.height);
  expect(g.bounds.right - g.bounds.left).toBeGreaterThan((g.bounds.bottom - g.bounds.top) * 2);
  expect(g.cell).toBeCloseTo(before.cell, 6);
  expect(g.svgOrigin.x).toBeCloseTo(before.svgOrigin.x, 3);
  expect(g.svgOrigin.y).toBeCloseTo(before.svgOrigin.y, 3);
  for (const side of ['left', 'right'] as const) {
    g = await fullPaneGeometry(page);
    const selected = await clickScreenPoint(page, legacyDeadPoint(g, side), g);
    expect(side === 'right' ? selected[1] : -selected[1]).toBeGreaterThan(0);
  }
  for (const y of [.1, .2, .5, .8, .9]) await clickVerticalBand(page, y);
  for (const x of [.02, .1, .5, .9, .98]) await clickScreenFraction(page, x, .5);
  await page.locator('.grid-wrap').screenshot({ path: testInfo.outputPath('full-pane-forced-wide-short.png') });
});

test('passive caption and coordinates expose canvas clicks while interactive controls preserve selection', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await ready(page);
  let selected: Tile = [1, -2];
  await clickTile(page, selected);
  for (const selector of ['.grid-caption', '.grid-coords']) {
    const g = await fullPaneGeometry(page);
    const overlay = await page.locator(selector).boundingBox();
    expect(overlay).not.toBeNull();
    selected = await clickScreenPoint(page, { x: overlay!.x + overlay!.width / 2, y: overlay!.y + overlay!.height / 2 }, g);
  }
  await page.locator('.grid-controls > span').click();
  await expectSelection(page, selected);
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expectSelection(page, selected);
  await page.getByRole('button', { name: '缩小', exact: true }).click();
  await expectSelection(page, selected);
  await page.getByTitle('回到原点', { exact: true }).click();
  await expectSelection(page, selected);
});

for (const resize of ['viewport', 'equal-aspect wrapper'] as const) {
  test(`${resize} resizing during a captured drag cancels it without ghost movement and permits a fresh drag`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await ready(page);
  const sizeWrapper = (width: number, height: number) => page.locator('.grid-wrap').evaluate((element, size) => {
    Object.assign((element as HTMLElement).style, { width: `${size.width}px`, height: `${size.height}px`,
      minHeight: '0', maxHeight: `${size.height}px`, flex: 'none', alignSelf: 'start',
      boxSizing: 'content-box', border: '0', padding: '0' });
  }, { width, height });
  if (resize === 'equal-aspect wrapper') {
    await sizeWrapper(400, 280);
    const initialPane = await fullPaneGeometry(page);
    expect(initialPane.viewBox.x).toBeCloseTo(0, 3);
    expect(initialPane.viewBox.y).toBeCloseTo(0, 3);
    expect(initialPane.viewBox.width).toBeCloseTo(800, 3);
    expect(initialPane.viewBox.height).toBeCloseTo(560, 3);
  }
  const selected: Tile = [1, -1];
  await clickTile(page, selected);
  await grid(page).scrollIntoViewIfNeeded();
  await grid(page).evaluate(element => {
    element.addEventListener('pointerdown', e => element.setAttribute('data-e2e-pointer-id', String((e as PointerEvent).pointerId)), { once: true });
  });
  const initial = await geometry(page); const start = initial.viewportCenter;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: 'right' });
  let stopped: Geometry;
  try {
    await page.mouse.move(start.x + 20, start.y + 12, { steps: 4 });
    await expectOriginShift(page, initial.origin, 20, 12);
    const pointerId = Number(await grid(page).getAttribute('data-e2e-pointer-id'));
    expect(pointerId).toBeGreaterThan(0);
    expect(await grid(page).evaluate((svg, id) => svg.hasPointerCapture(id), pointerId)).toBe(true);
    const beforeResize = await geometry(page);
    if (resize === 'equal-aspect wrapper') await sizeWrapper(200, 140);
    else await page.setViewportSize({ width: 1440, height: 1000 });
    await expect.poll(async () => (await geometry(page)).bounds.right - (await geometry(page)).bounds.left).not.toBeCloseTo(initial.bounds.right - initial.bounds.left, 0);
    await expect.poll(() => grid(page).evaluate((svg, id) => svg.hasPointerCapture(id), pointerId)).toBe(false);
    stopped = await fullPaneGeometry(page);
    if (resize === 'equal-aspect wrapper') {
      // A viewBox-only resize detector misses this: the logical viewport remains
      // identical while the screen scale halves, invalidating drag start pixels.
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(stopped.viewBox[key]).toBeCloseTo(beforeResize.viewBox[key], 3);
      expect(stopped.bounds.right - stopped.bounds.left).toBeCloseTo(200, 3);
      expect(stopped.bounds.bottom - stopped.bounds.top).toBeCloseTo(140, 3);
      expect(stopped.screenCellWidth).toBeCloseTo(beforeResize.screenCellWidth / 2, 4);
      expect(stopped.screenCellHeight).toBeCloseTo(beforeResize.screenCellHeight / 2, 4);
    }
    expect(stopped.svgOrigin.x).toBeCloseTo(beforeResize.svgOrigin.x, 3);
    expect(stopped.svgOrigin.y).toBeCloseTo(beforeResize.svgOrigin.y, 3);
    expect(stopped.cell).toBeCloseTo(beforeResize.cell, 6);
    await expectSelection(page, selected);
    // The button is still physically held: changing layouts must cancel, not rebase,
    // the old captured gesture, and movement must not resurrect that stale drag.
    await page.mouse.move(stopped.viewportCenter.x + 28, stopped.viewportCenter.y + 18, { steps: 4 });
    await expectOriginShift(page, stopped.origin, 0, 0);
    await expectSelection(page, selected);
  } finally {
    await page.mouse.up({ button: 'right' });
  }
  stopped = await geometry(page);
  await page.mouse.move(stopped.viewportCenter.x - 20, stopped.viewportCenter.y - 12, { steps: 4 });
  await expectOriginShift(page, stopped.origin, 0, 0);
  const next = (await geometry(page)).viewportCenter;
  await page.mouse.move(next.x, next.y);
  await page.mouse.down({ button: 'middle' });
  try {
    await page.mouse.move(next.x - 16, next.y + 14, { steps: 4 });
    await expectOriginShift(page, stopped.origin, -16, 14);
  } finally {
    await page.mouse.up({ button: 'middle' });
  }
  await expectSelection(page, selected);
  await clickScreenFraction(page, .5, .2);
  });
}

for (const side of ['top', 'bottom'] as const) {
  test(`a frame installed by a raw click in the former ${side} dead area exports exact CDDA mount coordinates`, async ({ page }) => {
    // Each side gets a fresh vehicle: two distant frames in one vehicle would
    // correctly violate structural adjacency, unrelated to canvas coordinates.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await ready(page);
    // Select the exact production frame ID so catalog ordering is irrelevant.
    await page.getByRole('textbox', { name: '搜索部件', exact: true }).fill('frame');
    await page.locator('.part-row').filter({ has: page.locator('small', { hasText: /^frame$/ }) }).click();
    const g = await fullPaneGeometry(page);
    // Expected mounts come from the actual screen point and DOM matrix/pattern,
    // never from the selected-coordinate readout or a hard-coded requested tile.
    const selected = await clickScreenPoint(page, legacyDeadPoint(g, side), g);
    expect(side === 'top' ? selected[0] : -selected[0]).toBeGreaterThan(0);
    await page.getByRole('button', { name: '安装到当前格', exact: true }).click();
    // This list describes the current tile, not all parts in the whole vehicle.
    await expect(page.locator('.installed-row')).toHaveCount(1);
    await expectSelection(page, selected);
    await expect(grid(page).locator(':scope > g > title')).toHaveText(`frame (${selected[0]}, ${selected[1]})`);
    await page.getByRole('button', { name: '导出', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('button', { name: '下载文件', exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(/\.cdda-project\.json$/);
    const path = await download.path();
    expect(path).not.toBeNull();
    const project = JSON.parse(readFileSync(path!, 'utf8')) as {
      vehicle: { parts: { id: string; mount_dx: number; mount_dy: number }[] };
    };
    expect(project.vehicle.parts).toHaveLength(1);
    expect(project.vehicle.parts[0]).toMatchObject({ id: 'frame', mount_dx: selected[0], mount_dy: selected[1] });
  });
}
