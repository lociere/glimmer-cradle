import { expect, test } from '@playwright/test';
import { installDesktopHostMock } from './fixtures/desktop-host';

test.beforeEach(async ({ page }) => {
  await installDesktopHostMock(page);
  await page.goto('/control-center.html');
});

test('日志页消费受控 observability projection', async ({ page }) => {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '日志' }).click();
  await expect(page.getByRole('heading', { name: '日志', exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: '结构化日志' })).toBeVisible();
  await page.getByRole('navigation', { name: '页面分区' }).getByRole('button', { name: '交互链路' }).click();
  await expect(page.getByText('最近错误')).toBeVisible();
  await page.getByRole('navigation', { name: '页面分区' }).getByRole('button', { name: '服务状态' }).click();
  await expect(page.getByText('运行状态')).toBeVisible();
  await page.getByRole('navigation', { name: '页面分区' }).getByRole('button', { name: '文件与维护' }).click();
  await expect(page.getByRole('button', { name: '启动摘要' })).toBeVisible();
});
