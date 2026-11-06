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

// Independent rendering oracle: no production coordinate helpers, bounding-box ratios,
// hard-coded CSS sizes, or coordinates obtained from the selection being tested.
async function geometry(page: Page, tile: Tile = [0, 0]) {
  return grid(page).evaluate((element, [x, y]) => {
    const svg = element as SVGSVGElement;
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error('The rendered grid has no screen CTM');
    const rects = svg.querySelectorAll<SVGRectElement>(':scope > rect');
    const selection = rects[rects.length - 1];
    const pattern = svg.querySelector<SVGPatternElement>('defs > pattern');
    if (!selection || !pattern) throw new Error('Missing selection rectangle or grid pattern');
    const cell = selection.width.baseVal.value;
    const path = svg.querySelector(':scope > path')?.getAttribute('d') ?? '';
    const axes = /^M\s*([-+\d.eE]+)\s+0\s+V\s*560\s+M\s*0\s+([-+\d.eE]+)\s+H\s*800$/.exec(path);
    const cx = axes ? Number(axes[1]) : pattern.x.baseVal.value + cell / 2;
    const cy = axes ? Number(axes[2]) : pattern.y.baseVal.value + cell / 2;
    const screen = (sx: number, sy: number) => {
      const point = new DOMPoint(sx, sy).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    };
    const bounds = svg.getBoundingClientRect();
    return {
      cell,
      pattern: { width: pattern.width.baseVal.value, height: pattern.height.baseVal.value,
        x: pattern.x.baseVal.value, y: pattern.y.baseVal.value },
      svgOrigin: { x: cx, y: cy },
      selectionHeight: selection.height.baseVal.value,
      origin: screen(cx, cy),
      // CDDA mount axes: +X is up, +Y is right.
      target: screen(cx + y * cell, cy - x * cell),
      selection: screen(selection.x.baseVal.value + cell / 2, selection.y.baseVal.value + cell / 2),
      renderedStart: screen(0, 0), renderedEnd: screen(800, 560),
      viewportCenter: screen(400, 280),
      bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
    };
  }, tile);
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
  expect(g.cell).toBeGreaterThan(0);
  expect(g.selectionHeight).toBeCloseTo(g.cell, 6);
  expect(g.pattern.width).toBeCloseTo(g.cell, 6);
  expect(g.pattern.height).toBeCloseTo(g.cell, 6);
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
  test(`real mouse selects nonorigin and adjacent signed tiles at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await ready(page);
    // Vertical then horizontal adjacency on both sides catches axis swaps and rounding errors.
    for (const tile of [[1, 2], [2, 2], [2, 3], [-1, -2], [-2, -2], [-2, -3]] as Tile[]) {
      await clickTile(page, tile);
    }
  });
}

test('zoom buttons and real wheel preserve selection and allow accurate new clicks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await ready(page);
  const selected: Tile = [2, -2];
  await clickTile(page, selected);
  const initial = (await geometry(page)).cell;
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

test('clicks in SVG letterboxing do not select tiles, including horizontal letterboxing', async ({ page }) => {
  // The wide workbench's narrow/tall canvas has real vertical bars; the 1280px canvas fits its viewBox.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  const selected: Tile = [1, -2];
  await clickTile(page, selected);
  for (const forceWideShort of [false, true]) {
    if (forceWideShort) {
      // A browser-only layout variation exercises left/right bars; the natural canvas is tall.
      await grid(page).evaluate(element => {
        const svg = element as SVGSVGElement;
        svg.style.width = '100%';
        svg.style.height = '180px';
        svg.style.flex = 'none';
        svg.style.minHeight = '0';
        svg.style.maxHeight = 'none';
        svg.style.aspectRatio = 'auto';
      });
    }
    await grid(page).scrollIntoViewIfNeeded();
    const g = await geometry(page, selected);
    const { left, top, right, bottom } = g.bounds;
    const a = g.renderedStart; const b = g.renderedEnd;
    const bars = [
      { gap: a.x - left, point: { x: (left + a.x) / 2, y: (a.y + b.y) / 2 } },
      { gap: right - b.x, point: { x: (right + b.x) / 2, y: (a.y + b.y) / 2 } },
      { gap: a.y - top, point: { x: (a.x + b.x) / 2, y: (top + a.y) / 2 } },
      { gap: bottom - b.y, point: { x: (a.x + b.x) / 2, y: (bottom + b.y) / 2 } },
    ].sort((first, second) => second.gap - first.gap);
    const { gap, point } = bars[0];
    expect(gap, 'The SVG element must actually contain a letterbox bar').toBeGreaterThan(8);
    if (forceWideShort) expect(a.x - left).toBeGreaterThan(8);
    expect(point.x).toBeGreaterThan(left);
    expect(point.x).toBeLessThan(right);
    expect(point.y).toBeGreaterThan(top);
    expect(point.y).toBeLessThan(bottom);
    expect(point.x < a.x || point.x > b.x || point.y < a.y || point.y > b.y).toBe(true);
    await page.mouse.click(point.x, point.y);
    await expectSelection(page, selected, g.selection);
    // A valid click still works after rejection, with the current rendered geometry.
    await clickTile(page, [-1, 2]);
    await clickTile(page, selected);
  }
});

test('a frame installed by a nonzero screen click exports the exact CDDA mount coordinates', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await ready(page);
  // frame is the production default; select its exact ID explicitly so catalog ordering is irrelevant.
  await page.getByRole('textbox', { name: '搜索部件', exact: true }).fill('frame');
  await page.locator('.part-row').filter({ has: page.locator('small', { hasText: /^frame$/ }) }).click();
  const selected: Tile = [-2, 3];
  await clickTile(page, selected);
  await page.getByRole('button', { name: '安装到当前格', exact: true }).click();
  await expect(page.locator('.installed-row')).toHaveCount(1);
  await expectSelection(page, selected);
  await expect(grid(page).locator(':scope > g > title')).toHaveText('frame (-2, 3)');
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
  expect(project.vehicle.parts[0]).toMatchObject({ id: 'frame', mount_dx: -2, mount_dy: 3 });
});
