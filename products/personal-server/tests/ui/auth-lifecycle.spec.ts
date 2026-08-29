import { expect, test, type Page } from '@playwright/test';
import { startPersonalServerUiFixture } from './fixtures/personal-server-host';

interface AuthLifecycleSnapshot {
  readonly webSocketsActive: number;
  readonly webSocketsClosed: number;
  readonly webSocketsCreated: number;
  readonly webSocketCloseCalls: number;
  readonly eventSourcesActive: number;
  readonly statusRequests: number;
}

test('logout invalidates the session before network completion and cleans active resources', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'personal-server-desktop', '认证生命周期只需一个真实浏览器项目');
  await installLifecycleTracking(page);
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await page.goto(`${fixture.baseUrl}/activity`);
    await login(page);
    await expect.poll(async () => (await lifecycle(page)).webSocketsActive).toBe(1);
    await expect.poll(async () => (await lifecycle(page)).eventSourcesActive).toBe(1);

    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.locator('[data-role="login-layer"]')).toBeVisible();
    await expect.poll(async () => (await lifecycle(page)).webSocketsActive).toBe(0);
    await expect.poll(async () => (await lifecycle(page)).eventSourcesActive).toBe(0);
    await expect.poll(async () => (await lifecycle(page)).webSocketCloseCalls).toBeGreaterThanOrEqual(1);

    const statusRequests = (await lifecycle(page)).statusRequests;
    await page.waitForTimeout(1_700);
    expect((await lifecycle(page)).statusRequests).toBe(statusRequests);
  } finally {
    await fixture.stop();
  }
});

test('session expiry tears down the surface, timer and route-local stream without anonymous polling', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'personal-server-desktop', '认证生命周期只需一个真实浏览器项目');
  await installLifecycleTracking(page);
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  try {
    await page.goto(`${fixture.baseUrl}/activity`);
    await login(page);
    await expect.poll(async () => (await lifecycle(page)).webSocketsActive).toBe(1);
    await expect.poll(async () => (await lifecycle(page)).eventSourcesActive).toBe(1);

    await context.clearCookies();
    await expect(page.locator('[data-role="login-layer"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-role="login-message"]')).toContainText('会话已失效');
    await expect.poll(async () => (await lifecycle(page)).webSocketsActive).toBe(0);
    await expect.poll(async () => (await lifecycle(page)).eventSourcesActive).toBe(0);

    const statusRequests = (await lifecycle(page)).statusRequests;
    await page.waitForTimeout(1_700);
    expect((await lifecycle(page)).statusRequests).toBe(statusRequests);
  } finally {
    await fixture.stop();
  }
});

test('quick relogin waits for logout and ignores the delayed close from the old surface', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'personal-server-desktop', '认证生命周期只需一个真实浏览器项目');
  await installLifecycleTracking(page);
  const fixture = await startPersonalServerUiFixture({ zeroProvider: true });
  let releaseLogout = (): void => undefined;
  try {
    await page.goto(`${fixture.baseUrl}/overview`);
    await login(page);
    await expect.poll(async () => (await lifecycle(page)).webSocketsActive).toBe(1);

    let logoutWaiting = false;
    let loginPosts = 0;
    const logoutGate = new Promise<void>((resolve) => {
      releaseLogout = resolve;
    });
    await page.route('**/api/v1/session', async (route) => {
      const method = route.request().method();
      if (method === 'DELETE') {
        logoutWaiting = true;
        await logoutGate;
        logoutWaiting = false;
      } else if (method === 'POST') {
        loginPosts += 1;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.locator('[data-role="login-layer"]')).toBeVisible();
    await expect.poll(() => logoutWaiting).toBe(true);
    await page.locator('#access-token').fill('server-secret');
    await page.getByRole('button', { name: '连接 Personal Server' }).click();
    await page.waitForTimeout(250);
    expect(loginPosts).toBe(0);

    releaseLogout();
    await expect(page.locator('[data-role="app-shell"]')).toBeVisible();
    await expect.poll(() => loginPosts).toBe(1);
    await expect.poll(async () => (await lifecycle(page)).webSocketsActive).toBe(1);
    await expect.poll(async () => (await lifecycle(page)).webSocketsCreated).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await lifecycle(page)).webSocketsClosed).toBeGreaterThanOrEqual(1);

    await page.waitForTimeout(600);
    await expect(page.locator('[data-role="connection-label"]').first()).toContainText('在线');
    const statusRequests = (await lifecycle(page)).statusRequests;
    await page.waitForTimeout(1_400);
    await expect(page.locator('[data-role="connection-label"]').first()).toContainText('在线');
    expect((await lifecycle(page)).statusRequests).toBe(statusRequests);
  } finally {
    releaseLogout();
    await fixture.stop();
  }
});

async function login(page: Page): Promise<void> {
  await page.locator('#access-token').fill('server-secret');
  await page.getByRole('button', { name: '连接 Personal Server' }).click();
  await expect(page.locator('[data-role="app-shell"]')).toBeVisible();
}

async function lifecycle(page: Page): Promise<AuthLifecycleSnapshot> {
  return page.evaluate(() => (
    window as typeof window & { __authLifecycle: AuthLifecycleSnapshot }
  ).__authLifecycle);
}

async function installLifecycleTracking(page: Page): Promise<void> {
  await page.addInitScript({ content: `(() => {
    const lifecycle = {
      webSocketsActive: 0,
      webSocketsClosed: 0,
      webSocketsCreated: 0,
      webSocketCloseCalls: 0,
      eventSourcesActive: 0,
      statusRequests: 0,
    };
    Object.defineProperty(window, '__authLifecycle', { value: lifecycle });

    const NativeWebSocket = window.WebSocket;
    class TrackingWebSocket extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        lifecycle.webSocketsCreated += 1;
        NativeWebSocket.prototype.addEventListener.call(this, 'open', () => {
          lifecycle.webSocketsActive += 1;
        });
        NativeWebSocket.prototype.addEventListener.call(this, 'close', () => {
          lifecycle.webSocketsActive -= 1;
          lifecycle.webSocketsClosed += 1;
        });
      }

      addEventListener(type, listener, options) {
        if (type !== 'close' || !listener) return super.addEventListener(type, listener, options);
        const delayed = (event) => window.setTimeout(() => {
          if (typeof listener === 'function') listener.call(this, event);
          else listener.handleEvent(event);
        }, 350);
        return super.addEventListener(type, delayed, options);
      }

      close(...args) {
        lifecycle.webSocketCloseCalls += 1;
        return super.close(...args);
      }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: TrackingWebSocket });

    const NativeEventSource = window.EventSource;
    class TrackingEventSource extends NativeEventSource {
      constructor(...args) {
        super(...args);
        lifecycle.eventSourcesActive += 1;
        this.trackedClosed = false;
      }

      close() {
        if (!this.trackedClosed) {
          this.trackedClosed = true;
          lifecycle.eventSourcesActive -= 1;
        }
        return super.close();
      }
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: TrackingEventSource });

    const nativeFetch = window.fetch.bind(window);
    window.fetch = (...args) => {
      const input = args[0];
      const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(value, window.location.href).pathname === '/api/v1/status') lifecycle.statusRequests += 1;
      return nativeFetch(...args);
    };
  })();` });
}
