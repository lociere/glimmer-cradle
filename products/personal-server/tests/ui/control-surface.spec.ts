import { selectSettingsSection } from './scenarios/settings-navigation';
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { startPersonalServerUiFixture } from './fixtures/personal-server-host';

test('supports zero-provider login, history restore and degraded conversation notice', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    await navigate(page, 'data');

    await expect(page.locator('[aria-label="全局导航"] [data-route]')).toHaveCount(5);
    await expect(page.locator('[data-role="message-list"]')).toContainText('这是从服务端恢复的历史。');

    await page.locator('[data-role="message-input"]').fill('现在能聊天吗？');
    await page.locator('[data-role="send-button"]').click();
    await expect(page.locator('[data-role="conversation-banner"]')).toContainText('当前历史已完整恢复');
    await expect(page.locator('[data-role="message-list"]')).toContainText('没有可用模型');

    await navigate(page, 'system');
    await expect(page.getByText('服务已就绪', { exact: true })).toBeVisible();
    await page.goto(`${fixture.baseUrl}/system/logs`);
    await expect(page.locator('[aria-label="日志筛选"]')).toBeVisible();
  } finally {
    await fixture.stop();
  }
});

test('saves provider configuration without echoing api key and enables real reply', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    await navigate(page, 'config');
    const settingsView = page.locator('[data-role="view-config"]');
    await page.locator('[data-action="add-provider"]').click();
    await page.locator('[data-field="provider-key"]').fill('primary');
    await page.locator('[data-field="provider-base-url"]').fill('https://api.example.com');
    await page.locator('[data-field="provider-api-key"]').fill('secret-key');
    await page.locator('[data-field="provider-temperature"]').fill('0.7');
    await page.locator('[data-action="test-provider"]').click();
    await expect(settingsView.locator('[data-role="save-status"]')).toContainText('发现模型 gpt-4.1');
    await selectCustom(page, '[data-field="default-route-provider"]', 'primary');
    await selectCustom(page, '[data-field="default-route-model"]', 'chat · gpt-4.1');
    await page.locator('[data-action="save"]').click();

    await expect(page.locator('[data-field="default-route-model"]')).toContainText('chat');
    await expect(page.locator('[data-field="provider-api-key"]')).toHaveValue('');
    await expect(page.locator('[data-field="provider-api-key"]')).toHaveAttribute('placeholder', /已写入/);

    await navigate(page, 'data');
    await page.locator('[data-role="message-input"]').fill('请回复一条测试消息');
    await page.locator('[data-role="send-button"]').click();
    await expect(page.locator('[data-role="message-list"]')).toContainText('这是测试回复。');
  } finally {
    await fixture.stop();
  }
});

test('filters structured logs by module', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    await page.goto(`${fixture.baseUrl}/system/logs`);
    await page.locator('[data-field="module"]').fill('config-owner');
    await expect(page.locator('[data-role="log-list"]')).toContainText('config-owner');
    await expect(page.locator('[data-role="log-list"]')).not.toContainText('kernel-runtime');
  } finally {
    await fixture.stop();
  }
});

test('installs a new extension version, upgrades activation, then rolls back', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    await navigate(page, 'extensions');
    const extensionView = page.locator('[data-role="view-extensions"]');
    const card = extensionView.locator('[data-role="extension-card"][data-extension-id="community.echo"]');

    const details = extensionView.locator('[data-role="extension-detail"]');
    await expect(details).toContainText('激活版本');
    await expect(details).toContainText('1.0.0');
    await card.click();
    await expect(details.locator('[data-role="extension-version-row"][data-version="1.0.0"] [data-action="extension-uninstall"]')).toBeDisabled();
    await extensionView.getByRole('button', { name: '安装扩展', exact: true }).click();

    await extensionView.locator('[data-field="repository"]').fill('community/echo');
    await extensionView.locator('[data-field="tag"]').fill('v1.1.0');
    await extensionView.locator('[data-action="extensions-prepare"]').click();

    await expect(extensionView.locator('[data-role="extension-preview"]')).toContainText('echo');
    await extensionView.locator('[data-action="extensions-commit"]').click();
    await expect(details.locator('[data-role="extension-version-row"][data-version="1.1.0"]')).toBeVisible();

    await card.click();
    await details.locator('[data-role="extension-version-row"][data-version="1.1.0"] [data-action="extension-activate-version"]').click();
    await expect(details).toContainText('1.1.0');
    await expect(details).toContainText('running');

    await details.locator('[data-role="extension-version-row"][data-version="1.0.0"] [data-action="extension-activate-version"]').click();
    await expect(details).toContainText('1.0.0');
    await expect(details).toContainText('running');
    await expect(details.locator('[data-role="extension-version-row"][data-version="1.1.0"] [data-action="extension-uninstall"]')).toBeEnabled();
    await details.locator('[data-role="extension-version-row"][data-version="1.1.0"] [data-action="extension-uninstall"]').click();
    await page.getByRole('button', { name: '确认卸载', exact: true }).click();
    await expect(details.locator('[data-role="extension-version-row"][data-version="1.1.0"]')).toHaveCount(0);
    await expect(details.locator('[data-role="extension-version-row"][data-version="1.0.0"]')).toBeVisible();
  } finally {
    await fixture.stop();
  }
});

test('uploads a local .gcex package and runs it through the same install transaction', async ({ page }, testInfo) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    const packagePath = testInfo.outputPath('community.local-test-1.0.0-any.gcex');
    writeFileSync(packagePath, new Uint8Array([0x50, 0x4b, 0x03, 0x04]));

    await login(page, fixture.baseUrl);
    await navigate(page, 'extensions');
    const extensionView = page.locator('[data-role="view-extensions"]');
    await extensionView.getByRole('button', { name: '安装扩展', exact: true }).click();
    await selectCustom(page, '[data-field="source-kind"]', '本地 .gcex');
    await extensionView.locator('[data-field="local-package"]').setInputFiles(packagePath);

    await expect(extensionView.locator('[data-role="local-package-upload"]')).toContainText('community.local-test-1.0.0-any.gcex');
    await extensionView.locator('[data-action="extensions-prepare"]').click();
    await expect(extensionView.locator('[data-role="extension-preview"]')).toContainText('community.local-test-1.0.0-any');

    await extensionView.locator('[data-action="extensions-commit"]').click();
    await expect(extensionView.locator('[data-role="extension-card-list"]')).toContainText('community.local-test-1.0.0-any');
  } finally {
    await fixture.stop();
  }
});

test('creates a managed access token without re-echoing stored secrets', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    await page.goto(`${fixture.baseUrl}/system/security`);
    const settingsView = page.locator('[data-role="view-system-settings"]');
    await settingsView.locator('[data-field="access-token-label"]').fill('Ops laptop');
    await settingsView.locator('[data-action="create-token"]').click();

    await expect(settingsView.locator('[data-role="issued-access-token"]')).toContainText('gcps_');
    await expect(settingsView.locator('[data-role="security-access-section"]')).toContainText('Ops laptop');
    await expect(settingsView.locator('[data-role="security-access-section"]')).toContainText('legacy_env');
  } finally {
    await fixture.stop();
  }
});

test('shows real disabled reason for deployment operations when no host bridge is present', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    await page.goto(`${fixture.baseUrl}/system/operations`);
    const settingsView = page.locator('[data-role="view-system-settings"]');
    await expect(settingsView).toContainText('当前 Product Host 未连接部署级外部事务 owner');
    await expect(settingsView.locator('[data-action="create-backup"]')).toBeDisabled();
    await expect(settingsView.getByRole('button', { name: '应用更新', exact: true })).toBeDisabled();
  } finally {
    await fixture.stop();
  }
});

test('projects skill catalog runtime and refreshes it after skill config save', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    await navigate(page, 'capabilities');
    const settingsView = page.locator('[data-role="view-capability-catalog"]');
    const skillsSection = page.locator('[data-role="skills-section"]');

    await expect(skillsSection.getByRole('navigation', { name: '能力目录' })).toBeVisible();
    await skillsSection.getByRole('button', { name: /Echo Reply/ }).click();
    await expect(skillsSection.locator('[data-role="capability-detail"]')).toContainText('contract_only');
    await expect(skillsSection.locator('[data-role="capability-detail"]')).toContainText('扩展私有回复 Skill');
    await skillsSection.getByRole('button', { name: /Local Maintenance/ }).click();
    await expect(skillsSection.locator('[data-role="capability-detail"]')).toContainText('user_skills_disabled');

    await skillsSection.getByRole('button', { name: 'MCP 与本地技能', exact: true }).click();
    await skillsSection.locator('[data-path="skills.user_skills.enabled"]').check();
    await page.locator('[data-action="save"]').click();

    await expect(settingsView.locator('[data-role="save-status"]')).toContainText('配置已保存');
    await skillsSection.getByRole('button', { name: 'Local Maintenance', exact: true }).click();
    await expect(skillsSection.locator('[data-role="capability-detail"]')).toContainText('ready');
  } finally {
    await fixture.stop();
  }
});

test('saves audio, embedding and memory settings without falling back to yaml editing', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    await navigate(page, 'config');
    const settingsView = page.locator('[data-role="view-config"]');
    await expect(settingsView).toBeVisible();
    await expect(settingsView.locator('[data-action="save"]')).toBeVisible({ timeout: 15000 });
    const audioSection = settingsView.locator('[data-role="audio-section"]');
    const embeddingSection = settingsView.locator('[data-role="embedding-section"]');
    const memorySection = settingsView.locator('[data-role="memory-section"]');

    await selectSettingsSection(page, '语音与音频');
    await expect(audioSection).toBeVisible();
    await audioSection.locator('[data-path="audio.tts.enabled"]').check();
    await audioSection.locator('[data-path="audio.asr.enabled"]').check();
    await audioSection.locator('[data-path="audio.tts.cache.max_age_days"]').fill('14');

    await selectSettingsSection(page, '检索增强');
    await expect(embeddingSection).toBeVisible();
    await embeddingSection.locator('[data-path="embedding.enabled"]').check();
    await selectCustom(page, '[data-path="embedding.route.provider"]', 'local-sentence-transformers');
    await embeddingSection.locator('[data-path="embedding.providers.local-sentence-transformers.auto_download"]').check();

    await selectSettingsSection(page, '记忆与检索');
    await expect(memorySection).toBeVisible();
    await memorySection.locator('[data-path="memory.working.context_message_limit"]').fill('12');
    await memorySection.locator('[data-path="memory.experience.enabled"]').uncheck();

    await expect(settingsView.locator('[data-action="save"]')).toBeEnabled();
    await settingsView.locator('[data-action="save"]').click();

    await expect(settingsView.locator('[data-role="save-status"]')).toContainText('配置已保存');
    await selectSettingsSection(page, '语音与音频');
    await expect(audioSection.locator('[data-path="audio.tts.enabled"]')).toBeChecked();
    await expect(audioSection.locator('[data-path="audio.asr.enabled"]')).toBeChecked();
    await expect(audioSection.locator('[data-path="audio.tts.cache.max_age_days"]')).toHaveValue('14');
    await selectSettingsSection(page, '检索增强');
    await expect(embeddingSection.locator('[data-path="embedding.enabled"]')).toBeChecked();
    await expect(embeddingSection.locator('[data-path="embedding.route.provider"]')).toContainText('local-sentence-transformers');
    await expect(embeddingSection.locator('[data-path="embedding.providers.local-sentence-transformers.auto_download"]')).toBeChecked();
    await selectSettingsSection(page, '记忆与检索');
    await expect(memorySection.locator('[data-path="memory.working.context_message_limit"]')).toHaveValue('12');
    await expect(memorySection.locator('[data-path="memory.experience.enabled"]')).not.toBeChecked();
  } finally {
    await fixture.stop();
  }
});

test('keeps shell routes usable after a surface reconnect without persistent status chrome', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    await expect(page.locator('[data-role="connection-label"]')).toHaveCount(0);

    await page.goto(`${fixture.baseUrl}/system/logs`);
    await expect(page.locator('[aria-label="全局导航"] [data-route="system"]').first()).toHaveClass(/activeNavLink/);

    await fixture.disconnectSurfaceClients();
    // Surface Gateway may complete a gRPC reconnect before a browser paint; assert the stable route contract.
    await navigate(page, 'config');
    await expect(page.locator('[aria-label="全局导航"] [data-route="config"]').first()).toHaveClass(/activeNavLink/);
    await expect(page.getByRole('navigation', { name: 'Provider 目录' })).toBeVisible();
  } finally {
    await fixture.stop();
  }
});

async function login(page: import('@playwright/test').Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl);
  await page.locator('#access-token').fill('server-secret');
  await page.locator('[data-role="login-form"] button[type="submit"]').click();
  await expect(page.locator('[data-role="app-shell"]')).toBeVisible();
}

async function selectCustom(page: import('@playwright/test').Page, selector: string, option: string): Promise<void> {
  await page.locator(selector).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function navigate(page: import('@playwright/test').Page, route: string): Promise<void> {
  const desktopLink = page.locator(`[aria-label="全局导航"] [data-route="${route}"]`).first();
  if (await desktopLink.isVisible()) {
    await desktopLink.click();
  } else {
    await page.getByRole('button', { name: '打开全局导航' }).click();
    await page.getByRole('dialog', { name: '全局导航' }).locator(`[data-route="${route}"]`).click();
  }
  await expect(page).toHaveURL(new RegExp(`/${route}$`));
}
