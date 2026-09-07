import { selectSettingsSection } from './scenarios/settings-navigation';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { startPersonalServerUiFixture } from './fixtures/personal-server-host';
async function login(page: Page, baseUrl: string, section = 'models') {
  await page.goto(`${baseUrl}/settings?section=${section}`); await page.getByLabel('访问令牌').fill('server-secret'); await page.getByRole('button', { name: '连接 Personal Server' }).click();
}
test('settings failure retries, drafts survive subdomain history and discard restores fields', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true, configurationReadFailures: 1 });
  try {
    await login(page, fixture.baseUrl, 'memory'); await expect(page.getByRole('alert')).toContainText('模型配置暂时不可读');
    await page.getByRole('button', { name: '重试读取' }).click();
    const field = page.getByLabel('上下文注入上限', { exact: true }); await field.fill('12');
    await selectSettingsSection(page, '音频'); await expect(page).toHaveURL(/section=audio/); await expect(field).toHaveCount(0);
    await page.goBack(); await expect(field).toHaveValue('12');
    await page.getByRole('button', { name: '刷新', exact: true }).click(); await expect(field).toHaveValue('12');
    await expect(page.locator('[data-role="save-status"]')).toContainText('保留本地修改');
    await page.getByRole('button', { name: '预览变更' }).click(); await expect(page.locator('[data-role="save-status"]')).toContainText('已生成预览'); await expect(field).toHaveValue('12');
    const discard = page.getByRole('button', { name: '丢弃修改', exact: true }); await discard.click(); await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(discard).toBeFocused(); await expect(field).toHaveValue('12');
    await discard.click(); await page.getByRole('button', { name: '确认丢弃修改' }).click(); await expect(field).toHaveValue('8');
  } finally { await fixture.stop(); }
});
test('late token reads cannot erase user input and leaving clears the one-time token', async ({ page }) => {
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); let reads = 0;
  await page.route('**/api/v1/security/access-tokens', async route => { if (route.request().method() === 'GET' && ++reads === 1) await wait; await route.continue(); });
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await login(page, fixture.baseUrl, 'security'); await page.getByLabel('新令牌标签').fill('保留输入'); release(); await expect(page.getByLabel('新令牌标签')).toHaveValue('保留输入');
    await page.getByRole('button', { name: '创建访问令牌' }).click(); await expect(page.locator('[data-role="issued-access-token"]')).toContainText('gcps_');
    await selectSettingsSection(page, '模型与路由'); await selectSettingsSection(page, '安全与访问');
    await expect(page.locator('[data-role="issued-access-token"]')).toHaveCount(0);
  } finally { release(); await fixture.stop(); }
});
test('settings controls and confirmations reflow accessibly in both themes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'personal-server-desktop', '单项目执行七子区和容量矩阵');
  const fixture = await startPersonalServerUiFixture();
  try {
    await login(page, fixture.baseUrl); await page.getByLabel('Provider key', { exact: true }).fill('long-provider-name-'.repeat(8));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [1440, 1024, 901, 899, 761, 759, 601, 599, 480, 360, 320]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0); }
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      const navigation = page.getByRole('button', { name: '选择设置分类', exact: true });
      await navigation.click();
      await expect(page.getByRole('dialog', { name: '设置分类' })).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      await page.keyboard.press('Escape'); await expect(navigation).toBeFocused();
      for (const name of ['模型与路由', '音频', '语义向量', '记忆与经验', 'Skill / MCP', '安全与访问', '存储与服务']) {
        await selectSettingsSection(page, name);
        expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      }
      await page.getByRole('button', { name: '丢弃修改', exact: true }).click();
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      await page.keyboard.press('Escape');
    }
  } finally { await fixture.stop(); }
});
