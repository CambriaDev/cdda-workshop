import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Artificial editor project, not a game save. All defined IDs resolve through the
// shipped production dda dataset; no route interception or fabricated definitions.
function projectFixture(ids: string[]) {
  const bases: Record<string, string> = {
    frame: 'frame', engine_electric_small: 'motor_small', storage_battery: 'storage_battery',
    tank: 'metal_tank', alternator_car: 'alternator_car',
  };
  const vehicle = {
    name: 'Systems acceptance fixture',
    parts: ids.map(id => ({ id, mount_dx: 0, mount_dy: 0,
      ...(bases[id] ? { base: { typeid: bases[id] } } : {}),
    })),
    acceptanceMarker: { preserve: 'raw vehicle extension' },
  };
  return {
    format: 'cdda-vehicle-project', formatVersion: 1,
    metadata: { datasetId: '7b2efa5cea38e4d4d97dd0e63b28b9148623da59', gameVersion: '0.I-1', modOrder: ['dda'], source: 'anonymous systems fixture' },
    original: structuredClone(vehicle), vehicle, history: [{ action: 'fixture-import-marker' }], warnings: [],
    acceptanceMarker: { preserve: 'raw project extension' },
  };
}
const overview = (page: Page) => page.getByRole('region', { name: /^(动力、能源与完整性|Power, energy & completeness)$/ });
const purpose = (page: Page) => overview(page).getByRole('combobox', { name: /^(校验用途|Validation purpose)$/ });
const check = (page: Page, code: string) => overview(page).locator(`[data-system-check="${code}"]`);

async function ready(page: Page, fixture: ReturnType<typeof projectFixture>) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '安装到当前格', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'systems.cdda-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.getByRole('textbox', { name: '载具名称', exact: true })).toHaveValue(fixture.vehicle.name);
  await expect(overview(page)).toBeVisible();
}
async function exportProject(page: Page) {
  await page.getByRole('button', { name: /^(导出|Export)$/, exact: true }).click();
  const dialog = page.getByRole('dialog');
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /^(下载文件|Download file)$/, exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.cdda-project\.json$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(readFileSync(path!, 'utf8')) as ReturnType<typeof projectFixture>;
  await dialog.getByRole('button', { name: /^(关闭|Close)$/, exact: true }).click();
  return exported;
}

test('real installed systems retain distinct ratings and capacities without changing project export', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = projectFixture(['frame', 'engine_electric_small', 'storage_battery', 'tank', 'alternator_car']);
  await ready(page, fixture);
  const report = overview(page);
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'present');
  await expect(check(page, 'fuel-supply')).toHaveAttribute('data-status', 'conditional');
  await expect(check(page, 'fuel-supply')).toContainText('vehicle_use.cpp:626–668');
  await expect(check(page, 'driving-controls')).toHaveAttribute('data-status', 'missing');
  await expect(check(page, 'runtime')).toHaveAttribute('data-status', 'unknown');
  // The report must follow, not replace or obscure, the existing metric overview.
  expect(await report.evaluate(element => !!element.previousElementSibling?.classList.contains('stats-bar'))).toBe(true);
  for (const label of ['发动机完整列表', '储罐、电池与燃料储存完整列表', '电气与机械负载完整列表']) {
    await report.locator('summary').filter({ hasText: label }).click();
  }
  const engine = report.locator('[data-system-kind="engine"][data-system-part-index="1"]');
  await expect(engine).toBeVisible();
  await expect(engine).toContainText('engine_electric_small');
  await expect(engine).toContainText('motor_small');
  await expect(engine).toContainText(/7[,.\s]?040 W/);
  await expect(engine).toContainText(/8[,.\s]?000 W/);
  const battery = report.locator('[data-system-kind="battery"][data-system-part-index="2"]');
  await expect(battery).toContainText('storage_battery');
  await expect(battery).toContainText(/50[,.\s]?000/);
  await expect(battery).toContainText('13.888889 kWh');
  await expect(battery).toContainText('资源记录不完整');
  const tank = report.locator('[data-system-kind="tank"][data-system-part-index="3"]');
  await expect(tank).toContainText('metal_tank');
  await expect(tank).toContainText('60 L');
  await expect(tank).not.toContainText('60.05 L');
  const alternator = report.locator('[data-system-part-index="4"]');
  await expect(alternator).toContainText('alternator_car');
  await expect(alternator).toContainText('780 W');
  await expect(alternator).toContainText(/1[,.\s]?492 W/);
  const baseline = await exportProject(page);
  expect(baseline.original).toEqual(fixture.original);
  expect(baseline.vehicle).toEqual(fixture.vehicle);
  expect(baseline.history.slice(0, -1)).toEqual(fixture.history);
  expect(baseline.history.at(-1)).toMatchObject({ action: 'export-migration' });
  await purpose(page).selectOption('passive');
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'not-applicable');
  await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Power, energy & completeness', exact: true })).toBeVisible();
  await purpose(page).selectOption('self-propelled');
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'present');
  // Existing export migration may append its own event/warnings; report viewing,
  // purpose and locale changes must add nothing beyond that unchanged contract.
  expect(await exportProject(page)).toEqual(baseline);
  await page.setViewportSize({ width: 390, height: 844 });
  // Keep the full real-data lists open while checking the narrow English layout.
  for (const row of [engine, battery, tank]) {
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await report.screenshot({ path: testInfo.outputPath('vehicle-systems-mobile.png') });
  expect(errors).toEqual([]);
});

test('missing motor is advisory for self propulsion and not applicable for passive designs; edits undo and redo', async ({ page }) => {
  await ready(page, projectFixture(['frame', 'storage_battery']));
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'missing');
  // A systems warning cannot disable the existing lossless project download.
  expect((await exportProject(page)).vehicle.parts).toHaveLength(2);
  await purpose(page).selectOption('passive');
  for (const code of ['required-engine', 'driving-controls', 'wheel-count', 'steering']) {
    await expect(check(page, code)).toHaveAttribute('data-status', 'not-applicable');
  }
  await purpose(page).selectOption('self-propelled');
  await page.getByRole('textbox', { name: '搜索部件', exact: true }).fill('engine_electric_small');
  await page.locator('.part-row').filter({ has: page.locator('small', { hasText: /^engine_electric_small$/ }) }).click();
  await page.getByRole('button', { name: '安装到当前格', exact: true }).click();
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'present');
  await expect(page.locator('.installed-row')).toHaveCount(3);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'missing');
  await expect(page.locator('.installed-row')).toHaveCount(2);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'present');
  await page.getByRole('button', { name: '拆除 engine_electric_small', exact: true }).click();
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'missing');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'present');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'missing');
  const exported = await exportProject(page);
  expect(exported.history.map(event => event.action)).toEqual([
    'fixture-import-marker', 'install:engine_electric_small', 'remove:engine_electric_small', 'export-migration',
  ]);
});

test('installed report ignores library browsing, follows prototypes and re-resolves real mod parts after composition changes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page, projectFixture(['frame']));
  const report = overview(page);
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'missing');
  const beforeBrowsing = await report.textContent();
  await page.getByRole('textbox', { name: '搜索部件', exact: true }).fill('engine_electric_small');
  await page.locator('.part-row').filter({ has: page.locator('small', { hasText: /^engine_electric_small$/ }) }).click();
  await expect(page.getByTestId('library-part-details').locator('code').first()).toHaveText('engine_electric_small');
  expect(await report.textContent()).toBe(beforeBrowsing);
  await expect(report.locator('[data-system-kind="engine"]')).toHaveCount(0);
  await expect(page.locator('.installed-row')).toHaveCount(1);

  // This existing prototype includes inherited engine, tank, battery and controls.
  await page.getByRole('combobox', { name: '载具原型', exact: true }).selectOption('motorcycle');
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'present');
  await expect(check(page, 'driving-controls')).toHaveAttribute('data-status', 'present');
  await expect(report.locator('[data-system-kind="engine"]')).toContainText('engine_vtwin');
  await expect(report.locator('[data-system-kind="tank"]')).toContainText('tank_small');
  await expect(report.locator('[data-system-kind="engine"]')).not.toContainText('engine_electric_small');

  async function mod(enabled: boolean) {
    await page.getByRole('button', { name: /数据与模组/ }).click();
    const card = page.locator('.dataset-card').filter({ has: page.locator('code', { hasText: /^blazemod$/ }) });
    await card.getByRole('checkbox').setChecked(enabled);
    await page.getByRole('button', { name: /应用组合/ }).click();
    await expect(card.locator('.dataset-badge').first()).toHaveText(enabled ? '已交付 · 已启用' : '已交付 · 未启用');
    await page.getByRole('button', { name: /载具工坊/ }).click();
  }
  await mod(true);
  // Resolve the exact real epower=-1 definition, as in the existing inspector
  // regression. It is queen: an ENGINE + CONTROLS with a 1 kW electrical load.
  const pack = JSON.parse(readFileSync('public/datasets/0.I-1/blazemod.json', 'utf8')) as {
    definitions: { data: { type?: string; id?: string; epower?: number; flags?: string[] } }[];
  };
  const definition = pack.definitions.find(({ data }) => data.type === 'vehicle_part' && data.epower === -1)!.data;
  expect(definition.flags).toEqual(expect.arrayContaining(['ENGINE', 'CONTROLS']));
  const fixture = projectFixture(['frame', definition.id!]);
  fixture.metadata.modOrder = ['dda', 'blazemod'];
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'systems-mod.cdda-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.getByRole('textbox', { name: '载具名称', exact: true })).toHaveValue(fixture.vehicle.name);
  const engine = report.locator('[data-system-kind="engine"][data-system-part-index="1"]');
  const electrical = report.locator('[data-system-kind="electrical"][data-system-part-index="1"]');
  await expect(engine).toContainText(definition.id!);
  await expect(engine).toContainText(/223[,.\s]?800 W/);
  await expect(electrical).toContainText(/1[,.\s]?000 W/);
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'present');
  await expect(check(page, 'driving-controls')).toHaveAttribute('data-status', 'present');
  await expect(check(page, 'unknown-definitions')).toHaveCount(0);

  await mod(false);
  await expect(check(page, 'unknown-definitions')).toHaveAttribute('data-status', 'unknown');
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'unknown');
  await expect(check(page, 'driving-controls')).toHaveAttribute('data-status', 'unknown');
  await expect(engine).toHaveCount(0);
  await expect(electrical).toHaveCount(0);
  const unresolved = await exportProject(page);
  expect(unresolved.vehicle).toEqual(fixture.vehicle);
  expect(unresolved.original).toEqual(fixture.original);
  expect(unresolved.history.slice(0, -1)).toEqual(fixture.history);

  await mod(true);
  await expect(check(page, 'unknown-definitions')).toHaveCount(0);
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'present');
  await expect(check(page, 'driving-controls')).toHaveAttribute('data-status', 'present');
  await expect(engine).toContainText(definition.id!);
  await expect(engine).toContainText(/223[,.\s]?800 W/);
  await expect(electrical).toContainText(/1[,.\s]?000 W/);
  const resolved = await exportProject(page);
  expect(resolved.vehicle).toEqual(fixture.vehicle);
  expect(resolved.original).toEqual(fixture.original);
  expect(resolved.history.slice(0, -1)).toEqual(fixture.history);
  expect(errors).toEqual([]);
});

test('390px English report keeps missing definitions unknown, raw project fields and export available', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = projectFixture(['frame', 'acceptance_missing_engine_definition']);
  await ready(page, fixture);
  await page.getByRole('button', { name: '简体中文', exact: true }).click();
  const report = page.getByRole('region', { name: 'Power, energy & completeness', exact: true });
  await report.scrollIntoViewIfNeeded();
  await expect(report).toBeVisible();
  await expect(check(page, 'unknown-definitions')).toHaveAttribute('data-status', 'unknown');
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'unknown');
  await expect(check(page, 'runtime')).toHaveAttribute('data-status', 'unknown');
  await expect(purpose(page)).toHaveValue('self-propelled');
  await purpose(page).selectOption('passive');
  await expect(check(page, 'required-engine')).toHaveAttribute('data-status', 'not-applicable');
  await expect(check(page, 'unknown-definitions')).toHaveAttribute('data-status', 'unknown');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  const exported = await exportProject(page);
  expect(exported.original).toEqual(fixture.original);
  expect(exported.vehicle).toEqual(fixture.vehicle);
  expect(exported.acceptanceMarker).toEqual(fixture.acceptanceMarker);
  expect(exported.history.slice(0, -1)).toEqual(fixture.history);
  expect(errors).toEqual([]);
});
