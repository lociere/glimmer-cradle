import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { startPersonalServerUiFixture } from './fixtures/personal-server-host';

async function login(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}/capabilities`);
  await page.getByRole('textbox', { name: '访问令牌' }).fill('server-secret');
  await page.getByRole('button', { name: '连接 Personal Server' }).click();
  await expect(page.getByRole('button', { name: '查看 community.echo 详情' })).toBeVisible();
}

test('capability diagnostics preserve projected readiness, dependencies and recovery in both themes', async ({ page }, testInfo) => {
  await page.routeWebSocket('**/api/v1/surface', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => {
      const frame = JSON.parse(String(message));
      for (const projection of frame.extension_runtime_projection_result?.projections ?? []) {
        projection.capability_graph = { nodes: [{ id: 'reply', title: '消息回复', contribution_point: 'glimmer.protocolBridge', kind: 'protocol_bridge', state: 'degraded', owner: 'extension', audience: 'adapter', required: true, summary: '服务运行中，但回复连接不可用。', permissions: ['NETWORK'], readiness_gates: [{ id: 'connection', kind: 'connection', state: 'failed', summary: '外部服务未连接。', error_message: '连接超时，请检查外部服务。', error_code: 'CONNECT_TIMEOUT', checked_at: '2026-09-07T08:00:00Z', latency_ms: 0 }], diagnostic_refs: [], metadata: { private_field: 'not-for-display' }, updated_at: '2026-09-07T08:00:00Z' }, { id: 'future', title: '未来能力', contribution_point: 'community.future', kind: 'custom', state: 'future_state', owner: 'extension', audience: 'user', required: false, summary: '尚不支持的状态', permissions: [], readiness_gates: [], diagnostic_refs: [], metadata: {}, updated_at: '2026-09-07T08:00:00Z' }], edges: [{ from: 'reply', to: 'future', relation: 'depends_on', required_state: 'ready' }] };
        projection.contribution_points = [{ id: 'community.future', title: '未来贡献点', state: 'unsupported', owner: 'third_party', required_permissions: [], metadata: {} }];
        projection.diagnostics.recovery_actions = ['确认外部服务已启动，然后刷新状态。'];
        projection.diagnostics.trace_id = 'trace-diagnostics';
      }
      socket.send(JSON.stringify(frame));
    });
  });
  const fixture = await startPersonalServerUiFixture();
  try {
    await login(page, fixture.baseUrl);
    const trigger = page.getByRole('button', { name: '查看 community.echo 详情' });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('已降级');
    await expect(dialog).toContainText('未知状态（future_state）');
    await dialog.locator('summary').filter({ hasText: '消息回复' }).click();
    await expect(dialog).toContainText('CONNECT_TIMEOUT');
    await expect(dialog).toContainText('耗时 0 ms');
    await expect(dialog).toContainText('未来能力 · depends_on · 要求：已就绪');
    await expect(dialog).toContainText('确认外部服务已启动');
    await expect(dialog).toContainText('未来贡献点');
    await expect(dialog).not.toContainText('not-for-display');
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await dialog.getByRole('region', { name: '能力与诊断' }).evaluate(element => element.scrollIntoView({ block: 'start' }));
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      await expect(page).toHaveScreenshot(`extension-diagnostics-${theme}.png`, { animations: 'disabled' });
    }
    for (const width of [1440, 1024, 760, 480, 360, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
    }
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  } finally { await fixture.stop(); }
});
for (const operation of ['commit', 'cancel'] as const) {
  test(`terminal ${operation} failure unlocks the form and a fresh Host transaction succeeds`, async ({ page }) => {
    const fixture = await startPersonalServerUiFixture({ failFirstExtensionTransaction: operation });
    try {
      await login(page, fixture.baseUrl);
      await page.getByRole('button', { name: '安装扩展', exact: true }).click();
      await page.getByLabel('仓库', { exact: true }).fill('community/echo');
      await page.getByLabel('Tag', { exact: true }).fill('v1.1.0');
      await page.getByRole('button', { name: '生成安装预览' }).click();
      await page.getByRole('button', { name: operation === 'commit' ? '确认安装' : '取消预览' }).click();
      await expect(page.getByRole('alert')).toContainText('安装事务已终结');
      await expect(page.locator('[data-role="extension-preview"]')).toHaveCount(0);
      await expect(page.getByLabel('Tag', { exact: true })).toBeEditable();
      await page.getByRole('button', { name: '刷新', exact: true }).click();
      await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeEnabled();
      await expect(page.getByRole('alert')).toContainText('安装事务已终结');
      await page.getByRole('button', { name: '生成安装预览' }).click();
      await page.getByRole('button', { name: '确认安装' }).click();
      await expect(page.locator('[data-role="extension-card-list"]')).toContainText('已安装：1.1.0, 1.0.0');
    } finally { await fixture.stop(); }
  });
}
test('registry and manifest previews lock their source, cancel, and release on route leave', async ({ page }) => {
  let cancellations = 0;
  await page.routeWebSocket('**/api/v1/surface', (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => { if (JSON.parse(String(message)).kind === 'extension_install_cancel') cancellations++; server.send(message); });
  });
  const fixture = await startPersonalServerUiFixture();
  try {
    await login(page, fixture.baseUrl);
    await page.getByRole('button', { name: '安装扩展', exact: true }).click();
    await page.getByRole('button', { name: '生成安装预览' }).click();
    await expect(page.getByRole('alert')).toContainText('补全安装来源');
    await page.getByLabel('来源类型').selectOption('registry');
    await page.getByLabel('Catalog URL').fill('https://registry.example/catalog.json');
    await page.getByLabel('Extension ID', { exact: true }).fill('community.example');
    await page.getByRole('button', { name: '生成安装预览' }).click();
    await expect(page.locator('[data-role="extension-preview"]')).toContainText('目录审核：已审阅');
    await expect(page.getByLabel('来源类型')).toBeDisabled();
    await page.getByRole('button', { name: '取消预览' }).click();
    await expect(page.locator('[data-role="extension-preview"]')).toHaveCount(0);
    await page.getByLabel('来源类型').selectOption('release_manifest');
    await page.getByLabel('Manifest URL').fill('https://example/releases/manifest.json');
    await page.getByRole('button', { name: '生成安装预览' }).click();
    await expect(page.locator('[data-role="extension-preview"]')).toContainText('构建证明：未附带');
    const link = page.locator('[aria-label="全局导航"] [data-route="overview"]').first();
    if (await link.isVisible()) await link.click();
    else { await page.getByRole('button', { name: '打开全局导航' }).click(); await page.getByRole('dialog', { name: '全局导航' }).locator('[data-route="overview"]').click(); }
    await expect(page.locator('[data-role="view-capabilities"]')).toHaveCount(0);
    await expect.poll(() => cancellations).toBeGreaterThanOrEqual(2);
  } finally { await fixture.stop(); }
});

test('directory failure retries and disconnected details disable actions without losing focus', async ({ page, context }) => {
  let failRead = true;
  await page.routeWebSocket('**/api/v1/surface', (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.kind === 'extension_runtime_projection_result' && failRead) { frame.extension_runtime_projection_result.status = 'error'; frame.extension_runtime_projection_result.message = '目录读取失败'; }
      socket.send(JSON.stringify(frame));
    });
  });
  const fixture = await startPersonalServerUiFixture();
  try {
    await page.goto(`${fixture.baseUrl}/capabilities`); await page.getByLabel('访问令牌').fill('server-secret'); await page.getByRole('button', { name: '连接 Personal Server' }).click();
    await expect(page.getByRole('alert')).toContainText('目录读取失败');
    await expect(page.getByText('尚未安装扩展')).toHaveCount(0);
    failRead = false; await page.getByRole('button', { name: '刷新', exact: true }).click();
    const trigger = page.getByRole('button', { name: '查看 community.echo 详情' }); await trigger.click();
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
    await context.setOffline(true); await fixture.disconnectSurfaceClients();
    await expect(dialog.getByRole('status')).toContainText('连接已断开'); await expect(dialog.getByRole('button', { name: '启用', exact: true })).toBeDisabled();
    await context.setOffline(false); await expect(dialog.getByRole('button', { name: '启用', exact: true })).toBeEnabled({ timeout: 8000 });
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  } finally { await context.setOffline(false); await fixture.stop(); }
});

test('extension list, installer and details reflow with accessible themes and keyboard', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'personal-server-desktop', '单项目覆盖容量矩阵');
  const fixture = await startPersonalServerUiFixture();
  try {
    await login(page, fixture.baseUrl); await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '安装扩展', exact: true }).click();
    await page.getByLabel('仓库', { exact: true }).fill('very-long-identifier-'.repeat(40));
    for (const width of [1440, 1024, 900, 761, 759, 480, 360, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    }
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      const trigger = page.getByRole('button', { name: '查看 community.echo 详情' }); await trigger.focus(); await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    }
  } finally { await fixture.stop(); }
});
