import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { startPersonalServerUiFixture } from './fixtures/personal-server-host';
import { longOverviewCatalog, overviewCatalog } from './scenarios/overview';

test('reads the model on direct entry and preserves keyboard focus across live runtime updates', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ runtimeCatalog: overviewCatalog });
  try {
    await login(page, fixture.baseUrl);
    await expect(page.getByText('对话模型可用', { exact: true })).toBeVisible();
    await expect(page.getByText('1 项降级或失败')).toBeVisible();
    const trigger = page.getByRole('button', { name: '查看 audio.tts 详情' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'audio.tts' });
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole('button', { name: '关闭运行体详情' });
    await expect(close).toBeFocused();
    await expect(dialog).toContainText('audio/resources');
    fixture.publishRuntimeCatalog({ ...overviewCatalog, runtimes: overviewCatalog.runtimes.map((runtime) => ({ ...runtime, state: 'ready', summary: '资源已经恢复。' })) });
    await expect(dialog).toContainText('资源已经恢复。');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await close.click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    if ((page.viewportSize()?.width ?? 0) > 480) {
      await page.mouse.click(10, 150);
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
    }
    await dialog.getByRole('link', { name: '查看诊断活动' }).click();
    await expect(page).toHaveURL(/\/activity$/);
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-role="view-overview"]')).toHaveCount(0);
    await page.goBack();
    await expect(page.locator('[data-role="view-overview"]')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { await fixture.stop(); }
});

test('distinguishes a missing catalog from an empty catalog and removes departed runtime details', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ runtimeCatalog: null });
  try {
    await login(page, fixture.baseUrl);
    await expect(page.getByText('正在等待运行体目录，收到投影后自动显示。')).toBeVisible();
    await expect(page.getByText('运行体目录为空', { exact: true })).toHaveCount(0);
    fixture.publishRuntimeCatalog({ ...overviewCatalog, runtimes: [] });
    await expect(page.getByText('运行体目录为空', { exact: true })).toBeVisible();
    fixture.publishRuntimeCatalog(overviewCatalog);
    await page.getByRole('button', { name: '查看 audio.tts 详情' }).click();
    fixture.publishRuntimeCatalog({ ...overviewCatalog, runtimes: [] });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('运行体目录为空', { exact: true })).toBeVisible();
  } finally { await fixture.stop(); }
});

test('configuration loading, failure and retry never masquerade as an unconfigured model', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true, configurationReadFailures: 1, configurationReadDelayMs: 500 });
  try {
    await login(page, fixture.baseUrl);
    await expect(page.getByText('正在读取模型配置…')).toBeVisible();
    await expect(page.getByText('对话模型不可用', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('模型配置暂时不可读。');
    await page.getByRole('button', { name: '重新读取配置' }).click();
    await expect(page.getByText('正在读取模型配置…')).toBeVisible();
    await expect(page.getByRole('button', { name: '重新读取配置' })).toHaveCount(0);
    await expect(page.getByText('对话模型不可用', { exact: true })).toBeVisible();
    await expect(page.getByText('仍可查看运行状态、诊断活动并调整配置。')).toBeVisible();
    await page.getByRole('link', { name: '配置模型', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
  } finally { await fixture.stop(); }
});

test('status read failure is explicit and automatically recovers', async ({ page }) => {
  let failStatus = true;
  await page.route('**/api/v1/status', async (route) => {
    if (failStatus) await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    else await route.continue();
  });
  const fixture = await startPersonalServerUiFixture();
  try {
    await login(page, fixture.baseUrl);
    await expect(page.getByRole('heading', { name: '暂时无法确认服务状态' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText('无法读取服务状态，正在自动重试。');
    failStatus = false;
    await expect(page.getByRole('heading', { name: '服务已就绪' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { await fixture.stop(); }
});

test('late model replies cannot remount a departed route and reconnect refreshes the overview', async ({ page, context }) => {
  let suppressCatalog = false;
  await page.routeWebSocket('**/api/v1/surface', (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      // 只延迟浏览器目录；Host 的 readiness 观测仍须正常恢复，才能允许重新连接。
      if (!suppressCatalog || JSON.parse(String(message)).kind !== 'runtime_readiness') socket.send(message);
    });
  });
  const fixture = await startPersonalServerUiFixture({ configurationReadDelayMs: 700 });
  try {
    await login(page, fixture.baseUrl);
    await expect(page.getByText('正在读取模型配置…')).toBeVisible();
    await page.getByRole('link', { name: '查看诊断活动', exact: true }).click();
    await expect(page).toHaveURL(/\/activity$/);
    await page.waitForTimeout(900);
    await expect(page.locator('[data-role="view-overview"]')).toHaveCount(0);
    await expect(page.locator('main .route-view')).toHaveCount(1);
    await page.goBack();
    await expect(page.getByText('对话模型可用', { exact: true })).toBeVisible();
    await context.setOffline(true);
    suppressCatalog = true;
    await fixture.disconnectSurfaceClients();
    await expect(page.getByText(/下方保留上次收到的投影/)).toBeVisible({ timeout: 8_000 });
    await context.setOffline(false);
    await expect(page.getByText('对话模型可用', { exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/下方保留上次收到的投影/)).toHaveCount(0);
    await expect(page.getByText('实时连接已恢复，正在等待新目录；运行体仍显示上次投影。')).toBeVisible();
    await page.getByRole('button', { name: '查看 kernel.ingress 详情' }).click();
    await expect(page.getByRole('dialog')).toContainText('尚未收到当前连接的目录');
    suppressCatalog = false;
    fixture.publishRuntimeCatalog(overviewCatalog);
    await expect(page.getByText('实时连接已恢复，正在等待新目录；运行体仍显示上次投影。')).toHaveCount(0);
    await expect(page.getByRole('dialog')).not.toContainText('尚未收到当前连接的目录');
  } finally { await context.setOffline(false); await fixture.stop(); }
});

test('long catalogs and details reflow across capacity boundaries with accessible themes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'personal-server-desktop', '使用单一项目覆盖完整容量矩阵');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = await startPersonalServerUiFixture({ runtimeCatalog: longOverviewCatalog });
  try {
    await login(page, fixture.baseUrl);
    const trigger = page.getByRole('button', { name: `查看 ${longOverviewCatalog.runtimes[0].runtime_id} 详情`, exact: true });
    await expect(trigger).toBeVisible();
    // 720/360 CSS px reproduce the available width at 200%/400% of a 1440px surface.
    for (const width of [1440, 1024, 901, 899, 761, 759, 720, 480, 360, 320]) {
      await page.setViewportSize({ width, height: 920 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `page at ${width}px`).toBeLessThanOrEqual(0);
      await trigger.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth), `dialog at ${width}px`).toBeLessThanOrEqual(0);
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    }
    await page.setViewportSize({ width: 1440, height: 920 });
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      await trigger.click();
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      await page.keyboard.press('Escape');
    }
  } finally { await fixture.stop(); }
});

async function login(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/overview`);
  await page.locator('#access-token').fill('server-secret');
  await page.getByRole('button', { name: '连接 Personal Server' }).click();
  await expect(page.locator('[data-role="view-overview"]')).toBeVisible();
}
