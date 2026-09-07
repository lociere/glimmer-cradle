import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { startPersonalServerUiFixture } from './fixtures/personal-server-host';
import type { ConversationHistoryEntry } from '../../src/shared/control-center-models';

function history(count: number): ConversationHistoryEntry[] {
  return Array.from({ length: count }, (_, index) => ({ entry_id: `history-${index}`, source_kind: 'conversation', role: 'assistant', status: 'committed', text: `历史消息 ${index + 1}。`, occurred_at: new Date(Date.UTC(2026, 8, 7, 8, index)).toISOString(), position: index + 1, conversation_id: 'conversation:desktop', scene_id: 'scene:desktop', thread_id: 'main', recall_scope: 'conversation_private', disclosure_scope: 'conversation_private' }));
}
async function login(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/conversation`);
  await page.locator('#access-token').fill('server-secret');
  await page.getByRole('button', { name: '连接 Personal Server' }).click();
}

test('history failures retry, pages merge and live replies preserve the loaded past', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ conversationHistory: history(6), historyPageSize: 2, historyReadFailures: 1, historyReadDelayMs: 250 });
  try {
    await login(page, fixture.baseUrl);
    await expect(page.getByRole('alert')).toContainText('对话历史暂时不可读');
    await page.getByRole('button', { name: '重新读取历史' }).click();
    await expect(page.locator('[data-role="message-list"]')).toContainText('历史消息 6。');
    await page.getByRole('button', { name: '加载更早消息' }).click();
    await expect(page.locator('[data-role="message-list"]')).toContainText('历史消息 3。');
    await page.getByRole('button', { name: '加载更早消息' }).click();
    await expect(page.locator('[data-role="message-list"]')).toContainText('历史消息 1。');
    await expect(page.getByRole('button', { name: '加载更早消息' })).toHaveCount(0);
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('新的消息');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('[data-role="message-list"]')).toContainText('这是测试回复。');
    await expect(page.locator('[data-role="message-list"]')).toContainText('历史消息 1。');
    await expect(page.locator('[data-message-id]')).toHaveCount(8);
  } finally { await fixture.stop(); }
});

test('pending sends survive stale history and disconnection retains editable draft with retry', async ({ page, context }) => {
  let holdChat = true;
  let sends = 0;
  await page.routeWebSocket('**/api/v1/surface', (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (JSON.parse(String(message)).kind === 'chat_input') {
        sends++;
        if (holdChat) return;
      }
      server.send(message);
    });
  });
  const fixture = await startPersonalServerUiFixture();
  try {
    await login(page, fixture.baseUrl);
    await expect(page.locator('[data-role="conversation-banner"]')).toContainText('完整恢复');
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await input.fill('等待处理的消息');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: '等待回复', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '刷新历史' }).click();
    await expect(page.locator('[data-role="conversation-banner"]')).toContainText('完整恢复');
    await expect(page.getByText('等待处理的消息', { exact: true })).toBeVisible();
    expect(sends).toBe(1);
    await input.fill('断线仍保留的草稿');
    await context.setOffline(true); await fixture.disconnectSurfaceClients();
    await expect(page.locator('[data-role="conversation-banner"]')).toContainText('断开连接');
    await expect(input).toBeEditable(); await expect(input).toHaveValue('断线仍保留的草稿');
    await context.setOffline(false); holdChat = false;
    await expect(page.getByRole('button', { name: '重试', exact: true })).toBeEnabled({ timeout: 8000 });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.locator('[data-role="message-list"]')).toContainText('这是测试回复。');
    await expect(page.getByText('等待处理的消息', { exact: true })).toHaveCount(1);
    await expect(input).toHaveValue('断线仍保留的草稿'); expect(sends).toBe(2);
  } finally { await context.setOffline(false); await fixture.stop(); }
});

test('late history after route leave cannot restore conversation and history reloads on return', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ historyReadDelayMs: 700 });
  try {
    await login(page, fixture.baseUrl);
    await page.getByRole('link', { name: '查看连接与能力' }).click();
    await page.waitForTimeout(900);
    await expect(page.locator('[data-role="view-conversation"]')).toHaveCount(0);
    await page.goBack();
    await expect(page.locator('[data-role="message-list"]')).toContainText('这是从服务端恢复的历史。');
    await page.reload();
    await expect(page.locator('[data-role="message-list"]')).toContainText('这是从服务端恢复的历史。');
  } finally { await fixture.stop(); }
});

test('empty and long conversations support keyboard, reflow and both themes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'personal-server-desktop', '单项目覆盖容量与主题矩阵');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = await startPersonalServerUiFixture({ conversationHistory: [] });
  try {
    await login(page, fixture.baseUrl);
    await expect(page.getByRole('heading', { name: '开始一段对话' })).toBeVisible();
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await input.fill('长中文消息与long-identifier-'.repeat(100));
    await input.press('Enter'); await expect(input).toHaveValue(/\n$/);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('[data-role="message-list"]')).toContainText('这是测试回复。');
    await expect(input).toBeFocused();
    for (const width of [1440, 1024, 900, 761, 759, 480, 360, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await expect(input).toBeVisible();
    }
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    }
  } finally { await fixture.stop(); }
});
