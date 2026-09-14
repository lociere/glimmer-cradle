import { expect, test } from '@playwright/test';
import { startPersonalServerUiFixture } from './fixtures/personal-server-host';

test('isolates authentication and owns URL, refresh, deep-link, history and unknown routes', async ({ page }) => {
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await page.goto(`${fixture.baseUrl}/system`);
    await expect(page).toHaveURL(/\/system$/);
    await expect(page.locator('[data-role="login-layer"]')).toBeVisible();
    await expect(page.locator('[data-role="app-shell"]')).toHaveCount(0);

    await login(page);
    await expect(page.locator('[data-role="view-overview"]')).toBeVisible();
    await expect(page.locator('main .route-view')).toHaveCount(1);
    await expect(page.locator('[aria-label="全局导航"] [data-route]')).toHaveCount(5);

    await navigate(page, 'capabilities');
    await expect(page).toHaveURL(/\/capabilities$/);
    await expect(page.locator('[data-role="view-capability-catalog"]')).toBeVisible();
    await expect(page.locator('[data-role="view-overview"]')).toHaveCount(0);

    await navigate(page, 'config');
    await expect(page).toHaveURL(/\/config$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/capabilities$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/config$/);
    await page.reload();
    await expect(page.locator('[data-role="view-config"]')).toBeVisible();

    await page.goto(`${fixture.baseUrl}/missing-route`);
    await expect(page).toHaveURL(/\/missing-route$/);
    await expect(page.locator('[data-role="view-unknown"]')).toContainText('这里没有可打开的页面');

    await page.goto(fixture.baseUrl);
    await expect(page).toHaveURL(/\/config$/);
    await expect(page.locator('[data-role="view-config"]')).toBeVisible();
  } finally {
    await fixture.stop();
  }
});

test('unmounts route-local streams and keeps exactly one active page under Strict Mode', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    const lifecycle = { opened: 0, closed: 0 };
    Object.defineProperty(window, '__eventSourceLifecycle', { value: lifecycle });
    class TrackingEventSource extends NativeEventSource {
      private trackedClosed = false;

      public constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        super(url, eventSourceInitDict);
        lifecycle.opened += 1;
      }

      public override close(): void {
        if (!this.trackedClosed) {
          lifecycle.closed += 1;
          this.trackedClosed = true;
        }
        super.close();
      }
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: TrackingEventSource });
  });

  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await page.goto(fixture.baseUrl);
    await login(page);
    await page.goto(`${fixture.baseUrl}/system/logs`);
    await expect(page.locator('main .route-view')).toHaveCount(1);
    await expect.poll(() => eventSourceCount(page)).toBe(1);

    await navigate(page, 'system');
    await expect(page.locator('[data-role="view-activity"]')).toHaveCount(0);
    await expect.poll(() => eventSourceCount(page)).toBe(0);
  } finally {
    await fixture.stop();
  }
});

test('keeps shell geometry and document scroll stable across route transitions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'personal-server-desktop', '宽屏固定导航几何检查');
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await page.goto(fixture.baseUrl);
    await login(page);
    const navigation = page.locator('[aria-label="全局导航"]').first();
    const workspace = page.locator('#main-content');
    const initialNavigation = await navigation.boundingBox();
    const initialWorkspace = await workspace.boundingBox();
    for (const route of ['extensions', 'capabilities', 'data', 'system', 'config']) {
      await navigate(page, route);
      await expect(page.locator('main > section')).toBeVisible();
      expect(await navigation.boundingBox()).toEqual(initialNavigation);
      expect(await workspace.boundingBox()).toEqual(initialWorkspace);
      expect(await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight)).toBeLessThanOrEqual(1);
    }
  } finally { await fixture.stop(); }
});

test('keeps the narrow shell single-column and restores focus after the navigation dialog closes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'personal-server-narrow', '窄屏项目专属检查');
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await page.goto(fixture.baseUrl);
    await login(page);
    const menuButton = page.getByRole('button', { name: '打开全局导航' });
    await menuButton.click();
    await expect(page.getByRole('dialog', { name: '全局导航' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '全局导航' })).toHaveCount(0);
    await expect(menuButton).toBeFocused();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await menuButton.click();
    await page.getByRole('dialog', { name: '全局导航' }).getByRole('button', { name: '退出登录' }).click();
    await expect(page.locator('[data-role="login-layer"]')).toBeVisible();
    await expect(page.locator('[data-role="app-shell"]')).toHaveCount(0);
  } finally {
    await fixture.stop();
  }
});

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#access-token').fill('server-secret');
  await page.getByRole('button', { name: '连接 Personal Server' }).click();
  await expect(page.locator('[data-role="app-shell"]')).toBeVisible();
}

async function eventSourceCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const lifecycle = (window as typeof window & { __eventSourceLifecycle: { opened: number; closed: number } }).__eventSourceLifecycle;
    return lifecycle.opened - lifecycle.closed;
  });
}

async function navigate(page: import('@playwright/test').Page, route: string): Promise<void> {
  const desktopLink = page.locator(`[aria-label="全局导航"] [data-route="${route}"]`).first();
  if (await desktopLink.isVisible()) {
    await desktopLink.click();
  } else {
    await page.getByRole('button', { name: '打开全局导航' }).click();
    await page.getByRole('dialog', { name: '全局导航' }).locator(`[data-route="${route}"]`).click();
  }
  await expect(page).toHaveURL(new RegExp(`/${route}$`));
}
