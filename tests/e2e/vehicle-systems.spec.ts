import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Artificial editor project, not a game save. All defined IDs resolve through the
// shipped production dda dataset; no route interception or fabricated definitions.
function projectFixture(ids: string[], recordedBatteryCharges: Record<number, number> = {}) {
  const bases: Record<string, string> = {
    frame: 'frame', engine_electric_small: 'motor_small', storage_battery: 'storage_battery',
    tank: 'metal_tank', alternator_car: 'alternator_car',
  };
  const vehicle = {
    name: 'Systems acceptance fixture',
    parts: ids.map((id, index) => ({ id, mount_dx: 0, mount_dy: 0,
      ...(bases[id] ? { base: { typeid: bases[id], ...(recordedBatteryCharges[index] !== undefined ? {
        contents: { contents: [{ pocket_type: 1, contents: [{ typeid: 'battery', charges: recordedBatteryCharges[index] }] }] },
      } : {}) } } : {}),
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
const category = (page: Page, kind: string) => overview(page).locator(`[data-system-category="${kind}"]`);
const group = (scope: Locator, kind: string, id: string) => scope.locator(`[data-system-group][data-system-group-kind="${kind}"][data-system-group-part-id="${id}"]`);
const total = (scope: Locator, key: string) => scope.locator(`[data-system-total="${key}"]`);

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
  for (const category of ['engine', 'storage', 'electrical']) {
    await report.locator(`[data-system-category="${category}"] > summary`).click();
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
  const alternator = report.locator('[data-system-kind="electrical"][data-system-part-index="4"]');
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

test('repeated real systems group by model with summed capacities, recorded charge and once-counted electrical demand', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = projectFixture([
    'frame', 'engine_electric_small', 'engine_electric_small', 'tank', 'tank',
    'storage_battery', 'storage_battery', 'alternator_car', 'alternator_car',
    'solar_panel', 'solar_panel', 'aisle_lights', 'aisle_lights',
  ], { 5: 9000, 6: 18000 });
  await ready(page, fixture);
  const report = overview(page), top = report.locator('.systems-summary');
  const engines = category(page, 'engine'), stores = category(page, 'storage'), electrical = category(page, 'electrical');
  await expect(total(top, 'enginePower')).toContainText('14.08 kW');
  await expect(total(top, 'tankVolume')).toContainText('120 L');
  await expect(total(top, 'batteryCapacity')).toContainText(/100[,\s]?000/);
  await expect(total(top, 'batteryCapacity')).toContainText('27.777778 kWh');
  await expect(total(top, 'electricalDemand')).toContainText('16.02 kW');
  await expect(total(top, 'generation')).toContainText('1.66 kW');
  await expect(engines.locator(':scope > summary')).toContainText('2 件 · 1 种型号');
  await expect(engines.locator(':scope > summary')).toContainText('14.08 kW');
  await expect(stores.locator(':scope > summary')).toContainText('4 件 · 2 种型号');
  await expect(stores.locator(':scope > summary')).toContainText('120 L');
  await expect(stores.locator(':scope > summary')).toContainText('27.777778 kWh');
  await expect(electrical.locator(':scope > summary')).toContainText('8 件 · 4 种型号');
  await expect(electrical.locator(':scope > summary')).toContainText('16.02 kW');
  const engineGroup = group(engines, 'engine', 'engine_electric_small');
  const tankGroup = group(stores, 'tank', 'tank'), batteryGroup = group(stores, 'battery', 'storage_battery');
  await expect(report.locator('[data-system-group]')).toHaveCount(7);
  for (const disclosure of await report.locator('[data-system-category], [data-system-group]').all()) {
    await expect(disclosure).not.toHaveAttribute('open', '');
  }
  await expect(engines.locator('li[data-system-kind="engine"]')).toHaveCount(2);
  await expect(stores.locator('li[data-system-kind="tank"]')).toHaveCount(2);
  await expect(stores.locator('li[data-system-kind="battery"]')).toHaveCount(2);
  await expect(electrical.locator('li[data-system-kind="electrical"]')).toHaveCount(8);
  const firstEngine = engines.locator('li[data-system-kind="engine"][data-system-part-index="1"]');
  await expect(firstEngine).toBeHidden();
  // Both nesting levels are native disclosures: keyboard access must not depend
  // on clicking a non-semantic wrapper, and children must remain in the DOM.
  await engines.locator(':scope > summary').press('Enter');
  await expect(engines).toHaveAttribute('open', '');
  await expect(engineGroup).not.toHaveAttribute('open', '');
  await expect(firstEngine).toBeHidden();
  await expect(engineGroup.locator(':scope > summary .systems-group-count')).toHaveText('× 2');
  await expect(engineGroup.locator(':scope > summary')).toContainText('14.08 kW');
  await expect(engineGroup.locator(':scope > summary')).toContainText('16 kW');
  await engineGroup.locator(':scope > summary').press('Space');
  await expect(firstEngine).toBeVisible();
  await expect(firstEngine).toContainText(/7[,\s]?040 W/);
  await expect(firstEngine).toContainText(/8[,\s]?000 W/);
  await engineGroup.locator(':scope > summary').press('Enter');
  await expect(firstEngine).toBeHidden();
  await expect(engines.locator('li[data-system-kind="engine"]')).toHaveCount(2);
  await engineGroup.locator(':scope > summary').click();
  await expect(firstEngine).toBeVisible();
  const engineTotals = engines.locator('.systems-category-totals');
  await expect(total(engineTotals, 'enginePower')).toContainText(/14[,\s]?080 W/);
  await expect(total(engineTotals, 'fullLoadInput')).toContainText(/16[,\s]?000 W/);
  await expect(total(engineTotals, 'fullLoadInput')).toContainText('16 kW');
  await stores.locator(':scope > summary').click();
  for (const disclosure of [tankGroup, batteryGroup]) {
    await expect(disclosure.locator(':scope > summary .systems-group-count')).toHaveText('× 2');
    await disclosure.locator(':scope > summary').click();
  }
  await expect(tankGroup.locator(':scope > summary')).toContainText('120 L');
  await expect(batteryGroup.locator(':scope > summary')).toContainText('27.777778 kWh');
  await expect(batteryGroup.locator(':scope > summary')).toContainText('7.5 kWh');
  await expect(batteryGroup.locator('li[data-system-part-index="5"]')).toContainText(/9[,\s]?000/);
  await expect(batteryGroup.locator('li[data-system-part-index="6"]')).toContainText(/18[,\s]?000/);
  await expect(total(stores.locator('.systems-category-totals'), 'recordedBattery')).toContainText('7.5 kWh');
  await electrical.locator(':scope > summary').click();
  const electricalTotals = electrical.locator('.systems-category-totals');
  for (const [key, watts, kw] of [
    ['electricalDemand', /16[,\s]?020 W/, '16.02 kW'], ['generation', /1[,\s]?660 W/, '1.66 kW'],
    ['mechanicalLoad', /2[,\s]?984 W/, '2.984 kW'], ['electricDriveLoad', /16[,\s]?000 W/, '16 kW'],
    ['accessoryLoad', /\b20 W/, '0.02 kW'], ['engineAuxiliaryLoad', /\b0 W/, '0 kW'], ['rechargeLoad', /\b0 W/, '0 kW'],
  ] as const) {
    await expect(total(electricalTotals, key)).toContainText(watts);
    await expect(total(electricalTotals, key)).toContainText(kw);
  }
  for (const id of ['engine_electric_small', 'alternator_car', 'solar_panel', 'aisle_lights']) {
    const disclosure = group(electrical, 'electrical', id);
    await expect(disclosure.locator(':scope > summary .systems-group-count')).toHaveText('× 2');
    await expect(disclosure).not.toHaveAttribute('open', '');
    await disclosure.locator(':scope > summary').click();
    await expect(disclosure.locator('li[data-system-kind="electrical"]')).toHaveCount(2);
  }
  await report.screenshot({ path: testInfo.outputPath('vehicle-systems-groups-desktop.png') });
  // Expanding, changing locale and resizing are view-only, including each
  // group's stable open state. Neither duplicate imports nor raw charges change.
  const baseline = await exportProject(page);
  expect(baseline.vehicle).toEqual(fixture.vehicle);
  expect(baseline.original).toEqual(fixture.original);
  expect(baseline.history.slice(0, -1)).toEqual(fixture.history);
  await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(engines.locator(':scope > summary')).toContainText('2 parts · 1 model');
  await expect(engineGroup).toHaveAttribute('open', '');
  await expect(tankGroup).toHaveAttribute('open', '');
  await expect(batteryGroup).toHaveAttribute('open', '');
  await expect(total(top, 'batteryCapacity')).toContainText('27.777778 kWh');
  await expect(total(electricalTotals, 'electricalDemand')).toContainText('16.02 kW');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const row of [firstEngine, tankGroup.locator('li[data-system-kind="tank"]').first(), batteryGroup.locator('li[data-system-kind="battery"]').first()]) {
    await row.scrollIntoViewIfNeeded(); await expect(row).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await engines.screenshot({ path: testInfo.outputPath('vehicle-systems-groups-engines-mobile.png') });
  await stores.screenshot({ path: testInfo.outputPath('vehicle-systems-groups-storage-mobile.png') });
  expect(await exportProject(page)).toEqual(baseline);
  expect(errors).toEqual([]);
});

test('identical part IDs with different actual base batteries keep separate capacity groups and unknown contributions', async ({ page }) => {
  const fixture = projectFixture(['frame', 'storage_battery', 'storage_battery', 'storage_battery', 'storage_battery']);
  // These are raw imported instance variations, not fabricated definitions.
  // A real smaller magazine must override the vpart default; a missing mod base
  // must never borrow that default's50000-charge capacity or merge into it.
  for (const snapshot of [fixture.vehicle, fixture.original]) {
    snapshot.parts[2]!.base = { typeid: 'small_storage_battery' };
    snapshot.parts[4]!.base = { typeid: 'acceptance_missing_battery_base' };
  }
  await ready(page, fixture);
  const stores = category(page, 'storage');
  const capacity = total(overview(page).locator('.systems-summary'), 'batteryCapacity');
  await expect(capacity).toContainText(/101[,\s]?000/);
  await expect(capacity).toContainText('28.055556 kWh');
  await expect(capacity).toContainText('已知小计');
  await stores.locator(':scope > summary').click();
  await expect(stores.locator(':scope > summary')).toContainText('4 件 · 3 种型号');
  const knownGroup = group(stores, 'battery', 'storage_battery');
  await expect(knownGroup).toHaveCount(1);
  await expect(knownGroup.locator(':scope > summary .systems-group-count')).toHaveText('× 2');
  await expect(knownGroup.locator(':scope > summary')).toContainText(/100[,\s]?000/);
  await expect(knownGroup.locator(':scope > summary')).toContainText('27.777778 kWh');
  await expect(knownGroup.locator('li[data-system-kind="battery"]')).toHaveCount(2);
  const smaller = stores.locator('li[data-system-kind="battery"][data-system-part-index="2"]');
  await expect(smaller).toBeVisible();
  await expect(smaller).toContainText('small_storage_battery');
  await expect(smaller).toContainText(/1[,\s]?000/);
  await expect(smaller).toContainText('0.277778 kWh');
  const missing = stores.locator('li[data-system-kind="battery"][data-system-part-index="4"]');
  await expect(missing).toBeVisible();
  await expect(missing).toContainText('acceptance_missing_battery_base');
  await expect(missing).toContainText('未知');
  await expect(missing).not.toContainText(/50[,\s]?000/);
  expect((await exportProject(page)).vehicle).toEqual(fixture.vehicle);
});

test('real cable, wind, solar and recharge roles keep coefficients out of generation and distinguish charger demand', async ({ page }) => {
  const fixture = projectFixture(['frame', 'solar_panel', 'wind_turbine', 'jumper_cable', 'recharge_station', 'aisle_lights']);
  await ready(page, fixture);
  const electrical = category(page, 'electrical');
  await electrical.locator(':scope > summary').click();
  const totals = electrical.locator('.systems-category-totals');
  // Solar provides50W; the wind coefficient1W cannot add1W and cable epower
  // 1000 encodes1% transmission loss, not an extra1000W generator.
  await expect(total(totals, 'generation')).toContainText(/\b50 W/);
  await expect(total(totals, 'generation')).toContainText('已知小计');
  await expect(total(totals, 'generation')).not.toContainText(/\b(?:51|1[,\s]?050|1[,\s]?051) W/);
  await expect(total(totals, 'rechargeLoad')).toContainText(/\b600 W/);
  await expect(total(totals, 'accessoryLoad')).toContainText(/\b10 W/);
  await expect(total(totals, 'electricalDemand')).toContainText(/\b610 W/);
  await expect(total(totals, 'electricalDemand')).toContainText('0.61 kW');
  const wind = electrical.locator('li[data-system-kind="electrical"][data-system-part-index="2"]');
  await expect(wind).toContainText('风力发电系数');
  await expect(wind).toContainText(/\b1 W/);
  await expect(wind).toContainText('未知');
  const cable = electrical.locator('li[data-system-kind="electrical"][data-system-part-index="3"]');
  await expect(cable).toContainText('线缆传输损耗');
  await expect(cable).toContainText('1 %');
  await expect(cable).not.toContainText('标称发电');
  const charger = electrical.locator('li[data-system-kind="electrical"][data-system-part-index="4"]');
  await expect(charger).toContainText('充电设备条件负载');
  await expect(charger).toContainText('600 W');
  expect((await exportProject(page)).vehicle).toEqual(fixture.vehicle);
});

test('removing a duplicate updates model count, totals and singleton disclosure through undo and redo', async ({ page }) => {
  // Same-cell duplicate installs would be rejected by normal placement, but
  // imported projects retain them and must still permit removing one instance.
  const fixture = projectFixture(['frame', 'engine_electric_small', 'engine_electric_small', 'storage_battery']);
  await ready(page, fixture);
  const engines = category(page, 'engine'), top = overview(page).locator('.systems-summary');
  const engineGroup = group(engines, 'engine', 'engine_electric_small');
  await expect(engineGroup.locator(':scope > summary .systems-group-count')).toHaveText('× 2');
  await expect(total(top, 'enginePower')).toContainText('14.08 kW');
  await expect(total(top, 'electricalDemand')).toContainText('16 kW');
  await engines.locator(':scope > summary').click();
  await engineGroup.locator(':scope > summary').click();
  await page.getByRole('button', { name: '拆除 engine_electric_small', exact: true }).first().click();
  await expect(engines.locator(':scope > summary')).toContainText('1 件 · 1 种型号');
  await expect(engineGroup).toHaveCount(0);
  await expect(engines.locator('li[data-system-kind="engine"]')).toHaveCount(1);
  await expect(engines.locator('li[data-system-kind="engine"]')).toBeVisible();
  await expect(total(top, 'enginePower')).toContainText('7.04 kW');
  await expect(total(top, 'electricalDemand')).toContainText('8 kW');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(engines.locator(':scope > summary')).toContainText('2 件 · 1 种型号');
  await expect(engineGroup.locator(':scope > summary .systems-group-count')).toHaveText('× 2');
  await expect(engineGroup).not.toHaveAttribute('open', '');
  await expect(total(top, 'enginePower')).toContainText('14.08 kW');
  await expect(total(top, 'electricalDemand')).toContainText('16 kW');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(engineGroup).toHaveCount(0);
  await expect(total(top, 'enginePower')).toContainText('7.04 kW');
  await expect(total(top, 'electricalDemand')).toContainText('8 kW');
  const exported = await exportProject(page);
  expect(exported.original).toEqual(fixture.original);
  expect(exported.vehicle.parts.filter(part => part.id === 'engine_electric_small')).toHaveLength(1);
  expect(exported.history.map(event => event.action)).toEqual(['fixture-import-marker', 'remove:engine_electric_small', 'export-migration']);
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
