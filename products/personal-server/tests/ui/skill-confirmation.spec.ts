import { expect, test } from '@playwright/test';
import { startPersonalServerUiFixture } from './fixtures/personal-server-host';

test('技能确认经真实 Host 回传允许、Escape 拒绝并在断线时撤销', async ({ page }, testInfo) => {
  const fixture = await startPersonalServerUiFixture();
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(fixture.baseUrl);
    await page.locator('#access-token').fill('server-secret');
    await page.locator('[data-role="login-form"] button[type="submit"]').click();
    await expect(page.locator('[data-role="app-shell"]')).toBeVisible();
    await page.goto(`${fixture.baseUrl}/system`);
    await expect(page.getByText('服务已就绪', { exact: true })).toBeVisible();
    fixture.requestSkillConfirmation('approve');
    const dialog = page.getByRole('dialog', { name: '允许执行此动作？' });
    await expect(dialog).toContainText('desktop.open_file');
    await expect(dialog).toContainText('C:\\Tools\\example.exe');
    await expect(dialog).toContainText('可执行文件可能启动程序');
    await expect(dialog.getByRole('button', { name: '拒绝', exact: true })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('skill-confirmation.png'), animations: 'disabled' });
    await dialog.getByRole('button', { name: '允许本次' }).click();
    await expect.poll(() => fixture.skillConfirmationReplies).toEqual([{ requestId: 'approve', approved: true }]);
    fixture.requestSkillConfirmation('reject');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(() => fixture.skillConfirmationReplies.at(-1)).toEqual({ requestId: 'reject', approved: false });
    fixture.requestSkillConfirmation('disconnect');
    await expect(dialog).toBeVisible();
    await fixture.disconnectSurfaceClients();
    await expect(dialog).toHaveCount(0);
    expect(fixture.skillConfirmationReplies).toHaveLength(2);
  } finally { await fixture.stop(); }
});
