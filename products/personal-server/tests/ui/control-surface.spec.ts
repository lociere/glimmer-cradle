import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { startPersonalServerUiFixture } from './fixtures/personal-server-host';

test('supports zero-provider login, history restore and degraded conversation notice', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);

    await expect(page.locator('.rail [data-route]')).toHaveCount(5);
    await expect(page.locator('[data-role="message-list"]')).toContainText('这是从服务端恢复的历史。');

    await page.locator('[data-role="message-input"]').fill('现在能聊天吗？');
    await page.locator('[data-role="send-button"]').click();
    await expect(page.locator('[data-role="conversation-banner"]')).toContainText('当前历史已完整恢复');
    await expect(page.locator('[data-role="message-list"]')).toContainText('尚未配置可用模型');

    await page.locator('[data-route="status"]').first().click();
    await expect(page.locator('.status-card').filter({ hasText: '服务状态' })).toContainText('ready');
    await page.locator('[data-route="logs"]').first().click();
    await expect(page.locator('.observability-toolbar')).toBeVisible();
  } finally {
    await fixture.stop();
  }
});

test('saves provider configuration without echoing api key and enables real reply', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    await page.locator('[data-route="settings"]').first().click();
    const settingsView = page.locator('[data-role="view-settings"]');
    await page.locator('[data-action="add-provider"]').click();
    await page.locator('[data-field="provider-key"]').fill('primary');
    await page.locator('[data-field="provider-base-url"]').fill('https://api.example.com');
    await page.locator('[data-field="provider-api-key"]').fill('secret-key');
    await page.locator('[data-field="provider-temperature"]').fill('0.7');
    await page.locator('[data-action="test-provider"]').click();
    await expect(settingsView.locator('.save-status')).toContainText('发现模型 gpt-4.1');
    await page.locator('[data-field="default-route-provider"]').selectOption('primary');
    await page.locator('[data-field="default-route-model"]').selectOption('chat');
    await page.locator('[data-action="save"]').click();

    await expect(settingsView.locator('.route-summary')).toContainText('默认对话路由可用');
    await expect(page.locator('[data-field="provider-api-key"]')).toHaveValue('');
    await expect(page.locator('[data-field="provider-api-key"]')).toHaveAttribute('placeholder', /已写入/);

    await page.locator('[data-route="conversation"]').first().click();
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
    await page.locator('[data-route="logs"]').first().click();
    await page.locator('[data-field="module"]').fill('config-owner');
    await page.locator('[data-action="apply"]').click();
    await expect(page.locator('.observability-log-list')).toContainText('config-owner');
    await expect(page.locator('.observability-log-list')).not.toContainText('kernel-runtime');
  } finally {
    await fixture.stop();
  }
});

test('installs a new extension version, upgrades activation, then rolls back', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    await page.locator('[data-route="extensions"]').first().click();
    const extensionView = page.locator('[data-role="view-extensions"]');
    const card = extensionView.locator('[data-role="extension-card"][data-extension-id="community.echo"]');

    await expect(card).toContainText('激活版本：1.0.0');
    await expect(card.locator('[data-role="extension-version-row"][data-version="1.0.0"] [data-action="extension-uninstall"]')).toBeDisabled();

    await extensionView.locator('[data-field="repository"]').fill('community/echo');
    await extensionView.locator('[data-field="tag"]').fill('v1.1.0');
    await extensionView.locator('[data-action="extensions-prepare"]').click();

    await expect(extensionView.locator('[data-role="extension-preview"]')).toContainText('echo');
    await extensionView.locator('[data-action="extensions-commit"]').click();
    await expect(card).toContainText('已安装：1.1.0, 1.0.0');

    await card.locator('[data-role="extension-version-row"][data-version="1.1.0"] [data-action="extension-activate-version"]').click();
    await expect(card).toContainText('激活版本：1.1.0');
    await expect(card).toContainText('running');

    await card.locator('[data-role="extension-version-row"][data-version="1.0.0"] [data-action="extension-activate-version"]').click();
    await expect(card).toContainText('激活版本：1.0.0');
    await expect(card).toContainText('running');
    await expect(card.locator('[data-role="extension-version-row"][data-version="1.1.0"] [data-action="extension-uninstall"]')).toBeEnabled();
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
    await page.locator('[data-route="extensions"]').first().click();
    const extensionView = page.locator('[data-role="view-extensions"]');
    await extensionView.locator('[data-field="source-kind"]').selectOption('file');
    await extensionView.locator('[data-field="local-package"]').setInputFiles(packagePath);

    await expect(extensionView.locator('[data-role="local-package-upload"]')).toContainText('community.local-test-1.0.0-any.gcex');
    await extensionView.locator('[data-action="extensions-prepare"]').click();
    await expect(extensionView.locator('[data-role="extension-preview"]')).toContainText('community.local-test-1.0.0-any');

    await extensionView.locator('[data-action="extensions-commit"]').click();
    await expect(extensionView.locator('[data-role="extension-card-list"]')).toContainText('community.community-local-test-1-0-0-any');
  } finally {
    await fixture.stop();
  }
});

test('creates a managed access token without re-echoing stored secrets', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    await page.locator('[data-route="settings"]').first().click();
    const settingsView = page.locator('[data-role="view-settings"]');
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
    await page.locator('[data-route="settings"]').first().click();
    const settingsView = page.locator('[data-role="view-settings"]');
    await expect(settingsView).toContainText('当前 Product Host 未配置部署级 glimmer-cradle 运维桥');
    await expect(settingsView.locator('[data-action="create-backup"]')).toBeDisabled();
    await expect(settingsView.locator('[data-action="apply-updates"]')).toBeDisabled();
  } finally {
    await fixture.stop();
  }
});

test('projects skill catalog runtime and refreshes it after skill config save', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    await page.locator('[data-route="settings"]').first().click();
    const settingsView = page.locator('[data-role="view-settings"]');
    const skillsSection = page.locator('[data-role="skills-section"]');

    await expect(skillsSection).toContainText('Skill Catalog / Provider Runtime');
    await expect(skillsSection).toContainText('contract_only');
    await expect(skillsSection).toContainText('扩展私有回复 Skill');
    await expect(skillsSection).toContainText('user_skills_disabled');

    await skillsSection.locator('[data-path="skills.user_skills.enabled"]').check();
    await page.locator('[data-action="save"]').click();

    await expect(settingsView.locator('.save-bar .save-status')).toContainText('配置已保存');
    await expect(skillsSection).toContainText('用户技能目录已启用');
    await expect(skillsSection).toContainText('Local Maintenance');
    await expect(skillsSection).toContainText('ready');
  } finally {
    await fixture.stop();
  }
});

test('saves audio, embedding and memory settings without falling back to yaml editing', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    await page.locator('[data-route="settings"]').first().click();
    const settingsView = page.locator('[data-role="view-settings"]');
    await expect(settingsView).toBeVisible();
    await expect(settingsView.locator('[data-action="save"]')).toBeVisible({ timeout: 15000 });
    const audioSection = settingsView.locator('[data-role="audio-section"]');
    const embeddingSection = settingsView.locator('[data-role="embedding-section"]');
    const memorySection = settingsView.locator('[data-role="memory-section"]');

    await expect(audioSection).toBeVisible();
    await audioSection.locator('[data-path="audio.tts.enabled"]').check();
    await audioSection.locator('[data-path="audio.asr.enabled"]').check();
    await audioSection.locator('[data-path="audio.tts.cache.max_age_days"]').fill('14');

    await expect(embeddingSection).toBeVisible();
    await embeddingSection.locator('[data-path="embedding.enabled"]').check();
    await embeddingSection.locator('[data-path="embedding.route.provider"]').selectOption('local-sentence-transformers');
    await embeddingSection.locator('[data-path="embedding.providers.local-sentence-transformers.auto_download"]').check();

    await expect(memorySection).toBeVisible();
    await memorySection.locator('[data-path="memory.working.context_message_limit"]').fill('12');
    await memorySection.locator('[data-path="memory.experience.enabled"]').uncheck();

    await expect(settingsView.locator('[data-action="save"]')).toBeEnabled();
    await settingsView.locator('[data-action="save"]').click();

    await expect(settingsView.locator('.save-bar .save-status')).toContainText('配置已保存');
    await expect(audioSection.locator('[data-path="audio.tts.enabled"]')).toBeChecked();
    await expect(audioSection.locator('[data-path="audio.asr.enabled"]')).toBeChecked();
    await expect(audioSection.locator('[data-path="audio.tts.cache.max_age_days"]')).toHaveValue('14');
    await expect(embeddingSection.locator('[data-path="embedding.enabled"]')).toBeChecked();
    await expect(embeddingSection.locator('[data-path="embedding.route.provider"]')).toHaveValue('local-sentence-transformers');
    await expect(embeddingSection.locator('[data-path="embedding.providers.local-sentence-transformers.auto_download"]')).toBeChecked();
    await expect(memorySection.locator('[data-path="memory.working.context_message_limit"]')).toHaveValue('12');
    await expect(memorySection.locator('[data-path="memory.experience.enabled"]')).not.toBeChecked();
  } finally {
    await fixture.stop();
  }
});

test('keeps both shell connection indicators in sync and restores them after reconnect', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl);
    const connectionLabels = page.locator('[data-role="connection-label"]');

    await expect(connectionLabels).toHaveCount(2);
    await expect(connectionLabels.nth(0)).toHaveText('在线');
    await expect(connectionLabels.nth(1)).toHaveText('在线');

    await page.locator('[data-route="logs"]').first().click();
    await expect(page.locator('.rail [data-route="logs"]').first()).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.section-pane [data-route="logs"]').first()).toHaveAttribute('aria-current', 'page');

    await fixture.disconnectSurfaceClients();
    await expect(connectionLabels.nth(0)).toHaveText('等待服务');
    await expect(connectionLabels.nth(1)).toHaveText('等待服务');

    await expect(connectionLabels.nth(0)).toHaveText('在线', { timeout: 8000 });
    await expect(connectionLabels.nth(1)).toHaveText('在线', { timeout: 8000 });
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
