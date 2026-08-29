import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { startPersonalServerUiFixture } from './fixtures/personal-server-host';

test('login and authenticated overview have no detectable critical accessibility violations', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await page.goto(`${fixture.baseUrl}/overview`);
    await expect(page.locator('[data-role="login-layer"]')).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);

    await page.locator('#access-token').fill('server-secret');
    await page.getByRole('button', { name: '连接 Personal Server' }).click();
    await expect(page.locator('[data-role="view-overview"]')).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  } finally {
    await fixture.stop();
  }
});
