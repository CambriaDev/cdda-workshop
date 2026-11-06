import { test, expect } from '@playwright/test';

test('about page shows project, repository, author and bilingual content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /关于|About/ }).click();

  await expect(page.getByRole('heading', { name: '关于 CDDA Workshop', exact: true })).toBeVisible();
  await expect(page.getByText(/基于本地 CDDA 0\.I-1 数据/)).toBeVisible();
  await expect(page.getByText(/实际游戏导入验收/)).toBeVisible();
  await expect(page.getByRole('link', { name: /CambriaDev \/ cdda-workshop/ })).toHaveAttribute('href', 'https://github.com/CambriaDev/cdda-workshop');
  await expect(page.getByRole('link', { name: /CambriaDev GitHub 用户/ })).toHaveAttribute('href', 'https://github.com/CambriaDev');
  await expect(page.getByRole('link', { name: 'i@cambria.cam' })).toHaveAttribute('href', 'mailto:i@cambria.cam');
  await expect(page.getByRole('link', { name: /MIT License/ })).toHaveAttribute('href', 'https://github.com/CambriaDev/cdda-workshop/blob/main/LICENSE');
  await expect(page.getByText(/CDDA 游戏数据遵循 CC BY-SA 3.0/)).toBeVisible();
  await expect(page.getByRole('link', { name: /CleverRaven \/ Cataclysm-DDA/ })).toHaveAttribute('href', 'https://github.com/CleverRaven/Cataclysm-DDA');
  const modList = page.locator('.about-mod-list');
  await expect(modList).not.toHaveAttribute('open', '');
  await modList.locator('summary').click();
  await expect(modList.getByRole('link', { name: 'Cataclysm-DDA-Touhou-Expansion' })).toHaveAttribute('href', 'https://github.com/RedMisao/Cataclysm-DDA-Touhou-Expansion');
  await expect(modList.getByRole('link', { name: 'Cataclysm-DDA-Touhou-Mod' })).toHaveAttribute('href', 'https://github.com/RedMisao/Cataclysm-DDA-Touhou-Mod');
  await expect(modList.getByRole('link', { name: 'nocts_cata_mod_DDA' })).toHaveAttribute('href', 'https://github.com/Noctifer-de-Mortem/nocts_cata_mod');
  await expect(modList.locator('li')).toHaveCount(28);
  await expect(modList.getByText('Arcana', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);

  await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'About CDDA Workshop', exact: true })).toBeVisible();
  await expect(page.getByText(/actual game has not yet been validated/i)).toBeVisible();

  await page.getByRole('button', { name: /Vehicle workshop/ }).click();
  await expect(page.getByRole('heading', { name: 'Build for the road ahead.' })).toBeVisible();
});
