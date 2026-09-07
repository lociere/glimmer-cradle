import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('Extension diagnostics stories distinguish missing, empty, degraded and unknown states', async ({ page }, testInfo) => {
  const url = process.env.GLIMMER_CRADLE_STORYBOOK_URL;
  test.skip(!url || testInfo.project.name !== 'personal-server-desktop', '组件工作台单项目检查');
  for (const story of ['degraded', 'missing', 'empty', 'unknown']) {
    await page.goto(`${url}/iframe.html?id=features-extensiondiagnostics--${story}&viewMode=story`);
    await expect(page.getByRole('region', { name: '能力与诊断' })).toBeVisible();
    if (story === 'unknown') await expect(page.getByRole('region', { name: '能力与诊断' })).toContainText('未知状态（__proto__）');
    if (await page.locator('summary').count()) await page.locator('summary').first().click();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  }
});

test('Configuration stories expose configuration states accessibly', async ({ page }, testInfo) => {
  const url = process.env.GLIMMER_CRADLE_STORYBOOK_URL;
  test.skip(!url || testInfo.project.name !== 'personal-server-desktop', '组件工作台单项目检查');
  for (const story of ['empty', 'loading', 'error', 'pending', 'conflict', 'disconnected', 'audio', 'long-provider']) {
    await page.goto(`${url}/iframe.html?id=features-configuration--${story}&viewMode=story`);
    await expect(page.locator('[data-role="view-settings"]')).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  }
});

test('Activity stories expose streaming states accessibly', async ({ page }, testInfo) => {
  const url = process.env.GLIMMER_CRADLE_STORYBOOK_URL;
  test.skip(!url || testInfo.project.name !== 'personal-server-desktop', '组件工作台批次的单项目检查');
  for (const story of ['live', 'empty', 'loading', 'error', 'paused', 'long-text']) {
    await page.goto(`${url}/iframe.html?id=features-activity--${story}&viewMode=story`);
    await expect(page.locator('[data-role="view-activity"]')).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  }
});

test('Extensions stories expose directory and operation states accessibly', async ({ page }, testInfo) => {
  const storybookUrl = process.env.GLIMMER_CRADLE_STORYBOOK_URL;
  test.skip(!storybookUrl || testInfo.project.name !== 'personal-server-desktop', '组件工作台批次的单项目检查');
  for (const story of ['installed', 'empty', 'loading', 'error', 'disconnected', 'pending', 'success', 'long-list']) {
    await page.goto(`${storybookUrl}/iframe.html?id=features-extensions--${story}&viewMode=story`);
    await expect(page.locator('[data-role="view-capabilities"]')).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  }
});

test('Conversation stories expose history, transport and send states accessibly', async ({ page }, testInfo) => {
  const storybookUrl = process.env.GLIMMER_CRADLE_STORYBOOK_URL;
  test.skip(!storybookUrl || testInfo.project.name !== 'personal-server-desktop', '组件工作台批次的单项目检查');
  for (const story of ['restored', 'empty', 'loading', 'error', 'disconnected', 'pending', 'failed', 'long-text']) {
    await page.goto(`${storybookUrl}/iframe.html?id=features-conversation--${story}&viewMode=story`);
    await expect(page.locator('[data-role="view-conversation"]')).toBeVisible();
    if (story === 'pending') await expect(page.getByRole('button', { name: '等待回复', exact: true })).toBeDisabled();
    if (story === 'failed') await expect(page.getByRole('button', { name: '重试', exact: true })).toBeEnabled();
    if (story === 'disconnected') await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeEditable();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  }
});

test('Overview stories expose real states and an accessible runtime dialog', async ({ page }, testInfo) => {
  const storybookUrl = process.env.GLIMMER_CRADLE_STORYBOOK_URL;
  test.skip(!storybookUrl || testInfo.project.name !== 'personal-server-desktop', '组件工作台批次的单项目检查');
  for (const [story, text] of [
    ['ready', '服务已就绪'], ['loading', '正在读取服务状态'], ['empty', '运行体目录为空'],
    ['degraded', '1 项降级或失败'], ['read-failure', '暂时无法确认服务状态'],
    ['disconnected', '实时控制面未连接'], ['long-catalog', 'long-resource-name-'],
    ['awaiting-catalog', '实时连接已恢复，正在等待新目录'],
  ]) {
    await page.goto(`${storybookUrl}/iframe.html?id=features-overview--${story}&viewMode=story`);
    await expect(page.locator('[data-role="view-overview"]')).toContainText(text);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  }
  await page.goto(`${storybookUrl}/iframe.html?id=features-overview--ready&viewMode=story`);
  const trigger = page.getByRole('button', { name: '查看 kernel.ingress 详情' });
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'kernel.ingress' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('HealthBadge story exposes its status and has no detectable accessibility violations', async ({ page }) => {
  const storybookUrl = process.env.GLIMMER_CRADLE_STORYBOOK_URL;
  test.skip(!storybookUrl, '仅在 Storybook 验证批次中运行。');

  await page.goto(`${storybookUrl}/iframe.html?id=shared-ui-healthbadge--ready&viewMode=story`);
  await expect(page.getByRole('status')).toHaveText('系统可用');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
