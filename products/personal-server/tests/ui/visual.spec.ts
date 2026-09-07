import { selectSettingsSection } from './scenarios/settings-navigation';
import { expect, test } from '@playwright/test';
import { startPersonalServerUiFixture } from './fixtures/personal-server-host';
import { overviewCatalog } from './scenarios/overview';

test('captures settings provider, enhancement and confirmation layouts', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('personal-server-theme', 'dark'));
  const fixture = await startPersonalServerUiFixture();
  try {
    await page.goto(`${fixture.baseUrl}/settings`); await page.getByLabel('访问令牌').fill('server-secret'); await page.getByRole('button', { name: '连接 Personal Server' }).click();
    await expect(page.getByLabel('Provider key', { exact: true })).toHaveValue('primary');
    await page.mouse.move(0, 0); await expect(page).toHaveScreenshot('settings-models-dark.png', { fullPage: true, animations: 'disabled' });
    if (testInfo.project.name === 'personal-server-narrow') {
      await page.getByRole('button', { name: '选择设置分类', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '设置分类' })).toBeVisible();
      await page.mouse.move(0, 0); await expect(page).toHaveScreenshot('settings-navigation-dark.png', { animations: 'disabled' });
      await page.keyboard.press('Escape');
    }
    await selectSettingsSection(page, '记忆与经验');
    await page.mouse.move(0, 0); await expect(page).toHaveScreenshot('settings-memory-dark.png', { fullPage: true, animations: 'disabled' });
    await page.getByLabel('上下文注入上限', { exact: true }).fill('12'); await page.getByRole('button', { name: '丢弃修改', exact: true }).click();
    await page.mouse.move(0, 0); await expect(page).toHaveScreenshot('settings-discard-dark.png', { animations: 'disabled' });
    await page.keyboard.press('Escape');
    if (testInfo.project.name === 'personal-server-desktop') { await page.getByRole('button', { name: '切换到浅色主题' }).click(); await selectSettingsSection(page, '模型与路由'); await page.mouse.move(0, 0); await expect(page).toHaveScreenshot('settings-models-light.png', { fullPage: true, animations: 'disabled' }); }
  } finally { await fixture.stop(); }
});

test('captures activity list and details in dark, light and narrow layouts', async ({ page }, testInfo) => {
  await page.addInitScript(() => window.localStorage.setItem('personal-server-theme', 'dark'));
  const fixture = await startPersonalServerUiFixture();
  try {
    await page.goto(`${fixture.baseUrl}/activity`); await page.getByLabel('访问令牌').fill('server-secret'); await page.getByRole('button', { name: '连接 Personal Server' }).click();
    await expect(page.locator('[data-role="status-line"]')).toContainText('正在观察日志流');
    await page.mouse.move(0, 0); await expect(page).toHaveScreenshot('activity-dark.png', { animations: 'disabled', fullPage: true });
    await page.getByRole('button', { name: /^查看事件/ }).first().click(); await expect(page.getByRole('dialog')).toBeVisible();
    await page.mouse.move(0, 0); await expect(page).toHaveScreenshot('activity-details.png', { animations: 'disabled', fullPage: true });
    await page.keyboard.press('Escape');
    if (testInfo.project.name === 'personal-server-desktop') {
      await page.getByRole('button', { name: '切换到浅色主题' }).click(); await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot('activity-light.png', { animations: 'disabled', fullPage: true });
    }
  } finally { await fixture.stop(); }
});

test('captures extensions directory, installation and details in dark, light and narrow layouts', async ({ page }, testInfo) => {
  await page.addInitScript(() => window.localStorage.setItem('personal-server-theme', 'dark'));
  const fixture = await startPersonalServerUiFixture();
  try {
    await page.goto(`${fixture.baseUrl}/capabilities`); await page.getByLabel('访问令牌').fill('server-secret'); await page.getByRole('button', { name: '连接 Personal Server' }).click();
    const trigger = page.getByRole('button', { name: '查看 community.echo 详情' }); await expect(trigger).toBeVisible();
    await page.mouse.move(0, 0); await expect(page).toHaveScreenshot('extensions-dark.png', { animations: 'disabled', fullPage: true });
    await trigger.click(); await expect(page.getByRole('dialog')).toBeVisible();
    await page.mouse.move(0, 0); await expect(page).toHaveScreenshot('extensions-details.png', { animations: 'disabled', fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '安装扩展', exact: true }).click();
    await page.mouse.move(0, 0); await expect(page).toHaveScreenshot('extensions-install.png', { animations: 'disabled', fullPage: true });
    if (testInfo.project.name === 'personal-server-desktop') {
      await page.getByRole('button', { name: '切换到浅色主题' }).click();
      await page.mouse.move(0, 0); await expect(page).toHaveScreenshot('extensions-light.png', { animations: 'disabled', fullPage: true });
    }
  } finally { await fixture.stop(); }
});

test('captures restored and empty conversation in both themes and narrow layout', async ({ page }, testInfo) => {
  await page.addInitScript(() => window.localStorage.setItem('personal-server-theme', 'dark'));
  const fixture = await startPersonalServerUiFixture();
  try {
    await page.goto(`${fixture.baseUrl}/conversation`);
    await page.locator('#access-token').fill('server-secret');
    await page.getByRole('button', { name: '连接 Personal Server' }).click();
    await expect(page.locator('[data-role="conversation-banner"]')).toContainText('完整恢复');
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot('conversation-dark.png', { animations: 'disabled', fullPage: true });
    if (testInfo.project.name === 'personal-server-desktop') {
      await page.getByRole('button', { name: '切换到浅色主题' }).click();
      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot('conversation-light.png', { animations: 'disabled', fullPage: true });
    }
  } finally { await fixture.stop(); }
  const empty = await startPersonalServerUiFixture({ conversationHistory: [] });
  try {
    await page.goto(`${empty.baseUrl}/conversation`);
    await page.locator('#access-token').fill('server-secret');
    await page.getByRole('button', { name: '连接 Personal Server' }).click();
    await expect(page.getByRole('heading', { name: '开始一段对话' })).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot('conversation-empty.png', { animations: 'disabled', fullPage: true });
  } finally { await empty.stop(); }
});

test('captures the accepted dark, light and narrow overview shell', async ({ page }, testInfo) => {
  await page.addInitScript(() => window.localStorage.setItem('personal-server-theme', 'dark'));
  await page.route('**/api/v1/status', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), observed_at: Date.UTC(2026, 8, 7, 8) } });
  });
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await page.goto(`${fixture.baseUrl}/overview`);
    await page.locator('#access-token').fill('server-secret');
    await page.getByRole('button', { name: '连接 Personal Server' }).click();
    await expect(page.locator('[data-role="view-overview"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: '服务已就绪' })).toBeVisible();
    await expect(page.getByRole('button', { name: '查看 kernel.ingress 详情' })).toBeVisible();
    await expect(page.getByText('对话模型不可用', { exact: true })).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot('overview-dark.png', { animations: 'disabled', fullPage: true });

    if (testInfo.project.name === 'personal-server-desktop') {
      await page.getByRole('button', { name: '切换到浅色主题' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot('overview-light.png', { animations: 'disabled', fullPage: true });
    }
  } finally {
    await fixture.stop();
  }
});

for (const state of ['empty', 'degraded', 'read-failure'] as const) {
  test(`captures overview ${state} and selected runtime details`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('personal-server-theme', 'dark'));
    await page.route('**/api/v1/status', async (route) => {
      if (state === 'read-failure') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      } else {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...await response.json(), observed_at: overviewCatalog.updated_at } });
      }
    });
    const fixture = await startPersonalServerUiFixture({
      zeroProvider: true,
      runtimeCatalog: state === 'empty' ? { ...overviewCatalog, runtimes: [] } : overviewCatalog,
      configurationReadFailures: state === 'read-failure' ? 100 : 0,
    });
    try {
      await page.goto(`${fixture.baseUrl}/overview`);
      await page.locator('#access-token').fill('server-secret');
      await page.getByRole('button', { name: '连接 Personal Server' }).click();
      if (state === 'read-failure') await expect(page.getByRole('button', { name: '重新读取配置' })).toBeVisible();
      else await expect(page.getByText('对话模型不可用', { exact: true })).toBeVisible();
      if (state === 'empty') await expect(page.getByText('运行体目录为空', { exact: true })).toBeVisible();
      else await expect(page.getByText('1 项降级或失败')).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot(`overview-${state}.png`, { animations: 'disabled', fullPage: true });
      if (state === 'degraded') {
        await page.getByRole('button', { name: '查看 audio.tts 详情' }).click();
        await expect(page.getByRole('dialog', { name: 'audio.tts' })).toBeVisible();
        await page.mouse.move(0, 0);
        await expect(page).toHaveScreenshot('overview-runtime-details.png', { animations: 'disabled', fullPage: true });
      }
    } finally { await fixture.stop(); }
  });
}
