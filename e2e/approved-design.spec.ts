import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`${width}px approved white student design keeps study workspaces usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.locator('.student-shell')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('.site-header')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.getByTestId('demo-login').click();
    await expect(page.locator('#result-name')).toHaveText('데모 학생');
    for (const name of ['점수 확인', '단어 공부', '지문 공부']) {
      await page.getByRole('button', { name, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.goto('/admin/');
    await expect(page.getByTestId('admin-workspace')).toBeVisible();
    await expect(page.locator('.student-shell')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
