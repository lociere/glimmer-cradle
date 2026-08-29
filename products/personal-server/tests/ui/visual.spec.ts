import { expect, test } from '@playwright/test';
import { startPersonalServerUiFixture } from './fixtures/personal-server-host';

test('captures the accepted dark, light and narrow overview shell', async ({ page }, testInfo) => {
  await page.addInitScript(() => window.localStorage.setItem('personal-server-theme', 'dark'));
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await page.goto(`${fixture.baseUrl}/overview`);
    await page.locator('#access-token').fill('server-secret');
    await page.getByRole('button', { name: '连接 Personal Server' }).click();
    await expect(page.locator('[data-role="view-overview"]')).toBeVisible();
    await page.getByText(/^最近观测 /).evaluate((element, projectName) => {
      const time = projectName === 'personal-server-narrow' ? '4:00:40 PM' : '4:00:37 PM';
      element.textContent = `最近观测 ${time}`;
    }, testInfo.project.name);
    await expect(page).toHaveScreenshot('overview-dark.png', { animations: 'disabled', fullPage: true });

    if (testInfo.project.name === 'personal-server-desktop') {
      await page.getByRole('button', { name: '切换到浅色主题' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(page).toHaveScreenshot('overview-light.png', { animations: 'disabled', fullPage: true });
    }
  } finally {
    await fixture.stop();
  }
});
