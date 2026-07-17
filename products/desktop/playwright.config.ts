import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const reportRoot = path.resolve(__dirname, '..', '..', 'build', 'reports', 'playwright');

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: path.join(reportRoot, 'results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(reportRoot, 'report'), open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: 'pnpm run dev',
    url: 'http://127.0.0.1:5173/control-center.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
