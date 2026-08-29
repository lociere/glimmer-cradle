import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

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
