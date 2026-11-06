import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function ready(page: Page, english = true) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '安装到当前格', exact: true })).toBeEnabled();
  if (english) await page.getByRole('button', { name: '简体中文', exact: true }).click();
}
async function choose(page: Page, id: string) {
  await page.getByRole('textbox', { name: /搜索部件|Search parts/ }).fill(id);
  await page.locator('.part-row').filter({ has: page.locator('small', { hasText: new RegExp(`^${id}$`) }) }).click();
}

test('purpose-first cards expose appliance capabilities and engine energy before secondary dimensions', async ({ page }) => {
  await ready(page);
  const details = page.getByTestId('library-part-details');
  await choose(page, 'veh_forge');
  const core = details.locator('.part-featured-block');
  await expect(core.filter({ hasText: 'Provided pseudo-tools' })).toContainText('forge');
  await expect(details.locator('.part-secondary').filter({ has: page.locator('[data-detail="weight"]') })).not.toHaveAttribute('open');
  await expect(details.locator('[data-detail="weight"]')).not.toBeVisible();
  await choose(page, 'engine_electric_small');
  await expect(details.locator('.part-featured-block [data-detail="mechanical_output"]')).toContainText('7.04 kW');
  await expect(details.locator('.part-featured-block [data-detail="full_load_consumption"]')).toContainText('8 kW');
  await expect(details.locator('.part-featured-block [data-detail="weight"]')).toBeVisible();
  await expect(details.locator('[data-detail="mechanical_output"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(details.locator('.part-featured-block [data-detail="mechanical_output"]')).toContainText('额定机械输出');
  await page.screenshot({ path: 'tests/artifacts/part-priority-zh.png', fullPage: true });
});

test('pinned comparison is independent of library selection and installed parts, with no extra undo actions', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Install on selected tile', exact: true }).click();
  await expect(page.getByTestId('installed-part-details').locator('code').first()).toHaveText('frame');
  await choose(page, 'alternator_car');
  await page.getByRole('button', { name: 'Use current part as B', exact: true }).click();
  await choose(page, 'engine_electric_small');
  const a = page.getByTestId('library-part-details'); const b = page.getByTestId('comparison-part-details');
  await expect(a.locator('code').first()).toHaveText('engine_electric_small');
  await expect(b.locator('code').first()).toHaveText('alternator_car');
  await expect(page.getByRole('region', { name: 'Reference B', exact: true }).getByRole('button', { name: 'Install on selected tile' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search parts' }).fill('tank');
  await expect(b.locator('code').first()).toHaveText('alternator_car');
  await page.getByRole('button', { name: 'Library + installed', exact: true }).click();
  await expect(page.getByTestId('installed-part-details').locator('code').first()).toHaveText('frame');
  await page.getByRole('button', { name: 'Library A / B', exact: true }).click();
  await expect(b.locator('code').first()).toHaveText('alternator_car');
  await page.getByRole('button', { name: 'Replace B with current part', exact: true }).click();
  await expect(b.locator('code').first()).toHaveText('engine_electric_small');
  await expect(page.getByRole('status')).toContainText('A and B are the same part.');
  await page.getByRole('button', { name: 'Clear B', exact: true }).click();
  await expect(b).toHaveCount(0);
  await page.getByRole('button', { name: 'Library + installed', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.installed-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.installed-row')).toHaveCount(1);
  await expect(page.getByTestId('installed-part-details')).toHaveCount(0);
  await page.locator('.installed-row button').first().click();
  await expect(page.getByTestId('installed-part-details')).toBeVisible();
  await page.getByRole('button', { name: 'Remove frame', exact: true }).click();
  await expect(page.getByTestId('installed-part-details')).toHaveCount(0);
});

test('wide and medium layouts keep two readable columns while mobile uses accessible column switches', async ({ page }) => {
  await ready(page);
  await choose(page, 'alternator_car');
  await page.getByRole('button', { name: 'Use current part as B', exact: true }).click();
  await choose(page, 'engine_electric_small');
  for (const width of [1920, 1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    const columns = page.locator('.inspector-column');
    const a = await columns.nth(0).boundingBox(); const b = await columns.nth(1).boundingBox();
    expect(a).not.toBeNull(); expect(b).not.toBeNull();
    expect(a!.width).toBeGreaterThanOrEqual(270); expect(b!.width).toBeGreaterThanOrEqual(270);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2); expect(b!.x).toBeGreaterThan(a!.x);
    const inspector = await page.locator('.dual-inspector').boundingBox(); const canvas = await page.locator('.canvas-panel').boundingBox();
    if (width >= 1440) expect(inspector!.x).toBeGreaterThan(canvas!.x);
    else expect(inspector!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: `tests/artifacts/comparison-${width}.png`, fullPage: true });
  }
  // Long advanced definitions guarantee real independent overflow in both panes.
  for (const id of ['library-part-details', 'comparison-part-details']) {
    await page.getByTestId(id).getByText('Advanced data & sources', { exact: true }).click();
  }
  const bodies = page.locator('.inspector-column-body');
  await bodies.evaluateAll(elements => elements.forEach(element => { element.scrollTop = 200; }));
  const rightScroll = await bodies.nth(1).evaluate(element => element.scrollTop);
  expect(rightScroll).toBeGreaterThan(0);
  expect(await bodies.nth(0).evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await choose(page, 'frame');
  await expect.poll(() => bodies.nth(0).evaluate(element => element.scrollTop)).toBe(0);
  expect(await bodies.nth(1).evaluate(element => element.scrollTop)).toBe(rightScroll);
  await page.getByTestId('comparison-part-details').getByText('Advanced data & sources', { exact: true }).click();
  await bodies.nth(1).evaluate(element => { element.scrollTop = 0; });
  await page.setViewportSize({ width: 390, height: 844 });
  const switches = page.getByRole('group', { name: 'Visible column' });
  await expect(page.getByTestId('library-part-details')).toBeVisible();
  await expect(page.getByTestId('comparison-part-details')).not.toBeVisible();
  const showB = switches.getByRole('button', { name: 'Reference B', exact: true });
  await showB.focus(); await showB.press('Space');
  await expect(showB).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('comparison-part-details')).toBeVisible();
  await expect(page.getByTestId('comparison-part-details').locator('code').first()).toHaveText('alternator_car');
  await expect(page.getByTestId('library-part-details')).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.screenshot({ path: 'tests/artifacts/comparison-mobile.png', fullPage: true });
});

test('pinned mod definitions become unavailable and recover after composition changes', async ({ page }) => {
  await ready(page, false);
  const pack = JSON.parse(readFileSync('public/datasets/0.I-1/blazemod.json', 'utf8')) as { definitions: { data: { type?: string; epower?: number; id?: string } }[] };
  const id = pack.definitions.find(d => d.data.type === 'vehicle_part' && d.data.epower === -1)!.data.id!;
  async function mod(enabled: boolean) {
    await page.getByRole('button', { name: /数据与模组/ }).click();
    const card = page.locator('.dataset-card').filter({ has: page.locator('code', { hasText: /^blazemod$/ }) });
    await card.getByRole('checkbox').setChecked(enabled);
    await page.getByRole('button', { name: /应用组合/ }).click();
    await expect(card.locator('.dataset-badge').first()).toHaveText(enabled ? '已交付 · 已启用' : '已交付 · 未启用');
    await page.getByRole('button', { name: /载具工坊/ }).click();
  }
  await mod(true); await choose(page, id);
  await page.getByRole('button', { name: '将当前部件设为对照 B', exact: true }).click();
  await expect(page.getByTestId('comparison-part-details').locator('code').first()).toHaveText(id);
  await mod(false);
  await expect(page.getByText('对照部件在当前数据中不可用', { exact: false })).toBeVisible();
  await expect(page.getByTestId('comparison-part-details').locator('code').first()).toHaveText(id);
  await choose(page, 'frame');
  await expect(page.getByTestId('comparison-part-details').locator('code').first()).toHaveText(id);
  await mod(true);
  await expect(page.getByText('对照部件在当前数据中不可用', { exact: false })).toHaveCount(0);
  await expect(page.getByTestId('comparison-part-details').locator('[data-detail="fixed_consumption"]')).toContainText('1 kW');
});
