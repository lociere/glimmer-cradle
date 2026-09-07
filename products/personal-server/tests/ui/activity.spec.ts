import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { startPersonalServerUiFixture } from './fixtures/personal-server-host';

test('live events pause, resume, open details and export the displayed results', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture();
  try {
    await page.goto(`${fixture.baseUrl}/activity`); await page.getByLabel('访问令牌').fill('server-secret'); await page.getByRole('button', { name: '连接 Personal Server' }).click();
    await expect(page.locator('[data-role="status-line"]')).toContainText('正在观察日志流');
    await page.getByLabel('暂停', { exact: true }).check(); fixture.appendLog('paused-live-message');
    await expect(page.locator('[data-role="status-line"]')).toContainText('缓冲 1 条', { timeout: 8000 });
    await expect(page.locator('[data-role="log-list"]')).not.toContainText('paused-live-message');
    await page.getByLabel('暂停', { exact: true }).uncheck();
    await expect(page.locator('[data-role="log-list"]')).toContainText('paused-live-message');
    const trigger = page.getByRole('button', { name: /^查看事件/ }).first(); await trigger.click();
    await expect(page.getByRole('dialog')).toContainText('paused-live-message'); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    await page.getByLabel('原始', { exact: true }).check(); await expect(page.locator('[data-role="log-list"] pre').first()).toContainText('fixture.append');
    const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '导出当前结果' }).click();
    const file = await downloaded; expect(await readFile((await file.path())!, 'utf8')).toContain('paused-live-message');
  } finally { await fixture.stop(); }
});
test('failed reads retry, empty filters and long content reflow accessibly', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'personal-server-desktop', '单项目覆盖容量与主题矩阵');
  let fail = true;
  await page.route('**/api/v1/logs/recent**', async (route) => { if (fail) await route.fulfill({ status: 503, body: '{}' }); else await route.continue(); });
  const fixture = await startPersonalServerUiFixture();
  try {
    await page.goto(`${fixture.baseUrl}/activity`); await page.getByLabel('访问令牌').fill('server-secret'); await page.getByRole('button', { name: '连接 Personal Server' }).click();
    await expect(page.getByRole('alert')).toContainText('logs_503'); fail = false; await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.locator('[data-role="status-line"]')).toContainText('正在观察日志流');
    await page.getByLabel('模块', { exact: true }).fill('nonexistent'); await page.getByRole('button', { name: '应用筛选' }).click();
    await expect(page.getByText('暂无日志结果，请调整筛选条件。')).toBeVisible();
    await page.getByLabel('模块', { exact: true }).fill(''); await page.getByRole('button', { name: '应用筛选' }).click();
    await expect(page.locator('[data-role="status-line"]')).toContainText('正在观察日志流'); fixture.appendLog('long-identifier-中文'.repeat(200));
    await expect(page.locator('[data-role="log-list"]')).toContainText('long-identifier-', { timeout: 8000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [1440, 1024, 900, 761, 759, 480, 360, 320]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0); }
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      await page.getByRole('button', { name: /^查看事件/ }).first().click();
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]); await page.keyboard.press('Escape');
    }
  } finally { await fixture.stop(); }
});
