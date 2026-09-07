import type { Page } from '@playwright/test';
export async function selectSettingsSection(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: '选择设置分类', exact: true });
  if (await trigger.isVisible()) await trigger.click();
  await page.getByRole('button', { name, exact: true }).click();
}
