import path from 'node:path';
import { expect, test } from '@playwright/test';
import { installDesktopHostMock } from './fixtures/desktop-host';

test.beforeEach(async ({ page }) => {
  await installDesktopHostMock(page);
  await page.goto('/control-center.html');
});

test('工作台默认进入对话并只提供六个规范一级入口', async ({ page }) => {
  const rail = page.getByRole('navigation', { name: '主导航' });
  await expect(page.getByRole('heading', { name: '对话', exact: true })).toBeVisible();
  for (const label of ['对话', '记忆', '角色', '能力', '日志', '设置']) {
    await expect(rail.getByRole('button', { name: label })).toBeVisible();
  }
  for (const legacyLabel of ['主页', '形象', '诊断']) {
    await expect(rail.getByRole('button', { name: legacyLabel })).toHaveCount(0);
  }
  await expect(page.getByPlaceholder('和当前角色说点什么...')).toBeVisible();
  await expect(page.locator('.window-frame-bar')).not.toContainText('微光摇篮');
});

test('工作台使用连续底层、无边界侧栏和独立主 Bubble', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 900 });
  const hierarchy = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.control-center-root')!;
    const sidebar = document.querySelector<HTMLElement>('.section-navigation')!;
    const workspace = document.querySelector<HTMLElement>('.control-workspace')!;
    const inspector = document.querySelector<HTMLElement>('.workbench-inspector')!;
    const frame = document.querySelector<HTMLElement>('.window-frame-bar')!;
    const rootStyle = getComputedStyle(root);
    const sidebarStyle = getComputedStyle(sidebar);
    const workspaceStyle = getComputedStyle(workspace);
    const inspectorStyle = getComputedStyle(inspector);
    const frameStyle = getComputedStyle(frame);
    const workspaceBox = workspace.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    return {
      canvas: rootStyle.backgroundColor,
      frame: frameStyle.backgroundColor,
      sidebar: sidebarStyle.backgroundColor,
      sidebarRadius: sidebarStyle.borderRadius,
      workspace: workspaceStyle.backgroundColor,
      workspaceBorder: workspaceStyle.borderTopWidth,
      workspaceRadius: workspaceStyle.borderRadius,
      workspaceShadow: workspaceStyle.boxShadow,
      workspaceGap: workspaceBox.top - frameBox.bottom,
      inspectorRadius: inspectorStyle.borderRadius,
      inspectorBorder: inspectorStyle.borderTopWidth,
      inspectorShadow: inspectorStyle.boxShadow,
    };
  });
  expect(hierarchy.frame).toBe(hierarchy.canvas);
  expect(hierarchy.sidebar).toBe(hierarchy.canvas);
  expect(hierarchy.sidebarRadius).toBe('0px');
  expect(hierarchy.workspace).not.toBe(hierarchy.canvas);
  expect(hierarchy.workspaceBorder).toBe('0px');
  expect(hierarchy.workspaceRadius).toBe('12px');
  expect(hierarchy.workspaceShadow).toBe('none');
  expect(hierarchy.workspaceGap).toBeGreaterThanOrEqual(7);
  expect(hierarchy.inspectorRadius).toBe(hierarchy.workspaceRadius);
  expect(hierarchy.inspectorBorder).toBe('0px');
  expect(hierarchy.inspectorShadow).toBe('none');
});

test('顶层页面切换使用短促淡入并服从减少动态效果', async ({ page }) => {
  await expect(page.locator('.page-surface-transition')).toHaveCSS('animation-name', 'page-surface-enter');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '记忆' }).click();
  await expect(page.locator('.page-surface-transition')).toHaveCSS('animation-duration', '0.14s');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '设置' }).click();
  await page.getByRole('navigation', { name: '页面分区' }).getByRole('button', { name: '外观' }).click();
  await page.getByLabel('减少动态效果').check();
  const reducedDurationSeconds = await page.locator('.page-surface-transition').evaluate((element) => (
    Number.parseFloat(getComputedStyle(element).animationDuration)
  ));
  expect(reducedDurationSeconds).toBeLessThanOrEqual(0.000001);
});

test('分区导航可调整宽度并显式收展', async ({ page }) => {
  const sidebar = page.locator('.section-navigation');
  const separator = page.getByRole('separator', { name: '调整分区导航宽度' });
  const before = await sidebar.boundingBox();
  const handle = await separator.boundingBox();
  expect(before).not.toBeNull();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + 2, handle!.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 62, handle!.y + 100, { steps: 4 });
  await page.mouse.up();
  const after = await sidebar.boundingBox();
  expect(after!.width).toBeGreaterThan(before!.width + 30);

  await separator.focus();
  await page.keyboard.press('Home');
  await expect(separator).toHaveAttribute('aria-valuenow', '184');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '208');

  await page.getByRole('button', { name: '收起分区导航' }).click();
  await expect(sidebar).toHaveCSS('width', '0px');
  await page.getByRole('button', { name: '展开分区导航' }).click();
  await expect(sidebar).not.toHaveCSS('width', '0px');

  await page.setViewportSize({ width: 840, height: 640 });
  await expect(page.getByRole('button', { name: '展开分区导航' })).toBeVisible();
  await page.getByRole('button', { name: '展开分区导航' }).click();
  await expect(sidebar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
});

test('右侧上下文栏在宽屏可持久收展，在普通窗口按需成为抽屉', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 900 });
  const inspector = page.getByRole('complementary', { name: '上下文栏' });
  const workspace = page.locator('.control-workspace');
  await expect(inspector).toBeVisible();
  const workspaceBefore = await workspace.boundingBox();

  await page.getByRole('button', { name: '收起右侧上下文栏' }).first().click();
  await expect(inspector).toBeHidden();
  const workspaceAfter = await workspace.boundingBox();
  expect(workspaceAfter!.width).toBeGreaterThan(workspaceBefore!.width + 200);
  await expect.poll(async () => page.evaluate(() => (
    JSON.parse(window.localStorage.getItem('glimmer-cradle.workbench.preferences.v1') ?? '{}').inspectorCollapsed
  ))).toBe(true);

  await page.reload();
  await expect(inspector).toBeHidden();
  await page.getByRole('button', { name: '展开右侧上下文栏' }).click();
  await expect(inspector).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(inspector).toBeVisible();
  const inspectorSeparator = page.getByRole('separator', { name: '调整右侧上下文栏宽度' });
  const inspectorBefore = await inspector.boundingBox();
  await inspectorSeparator.focus();
  await page.keyboard.press('ArrowLeft');
  const inspectorAfter = await inspector.boundingBox();
  expect(inspectorAfter!.width).toBeGreaterThan(inspectorBefore!.width);
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('glimmer-cradle.workbench.inspector-width'))).not.toBeNull();
  await inspectorSeparator.dblclick();
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('glimmer-cradle.workbench.inspector-width'))).toBeNull();

  await page.setViewportSize({ width: 1148, height: 680 });
  await expect(inspector).toBeVisible();
  const constrainedInspectorMax = Number(await inspectorSeparator.getAttribute('aria-valuemax'));
  expect(constrainedInspectorMax).toBeGreaterThanOrEqual(236);
  expect(constrainedInspectorMax).toBeLessThan(340);
  await inspectorSeparator.focus();
  await page.keyboard.press('End');
  await expect(inspector).toBeVisible();
  expect((await workspace.boundingBox())!.width).toBeGreaterThanOrEqual(540);

  await page.setViewportSize({ width: 1024, height: 720 });
  await expect(inspector).toBeHidden();
  const openInspector = page.getByRole('button', { name: '打开右侧上下文栏' });
  await openInspector.click();
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole('button', { name: '关闭右侧上下文栏' })).toBeFocused();
  const overlayBox = await inspector.boundingBox();
  expect(overlayBox).not.toBeNull();
  expect(overlayBox!.x).toBeGreaterThan(700);
  expect(overlayBox!.x + overlayBox!.width).toBeLessThanOrEqual(1024);
  await page.screenshot({ path: path.resolve(__dirname, '../../../../build/reports/playwright', 'workbench-context-inspector-overlay.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(inspector).toBeHidden();
  await expect(openInspector).toBeFocused();
});

test('设置提供深浅主题和动效偏好，并固定舒适布局', async ({ page }) => {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '设置' }).click();
  await page.getByRole('navigation', { name: '页面分区' }).getByRole('button', { name: '外观' }).click();
  await expect(page.getByRole('heading', { name: '外观', exact: true })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: /浅色/ }).click();
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByLabel('界面密度')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-density', /.+/);
  await page.getByLabel('减少动态效果').check();
  await expect(page.locator('body')).toHaveAttribute('data-reduced-motion', 'true');
});

test('日志提供结构化浏览与终端式原始输出，并可进入交互链路', async ({ page }) => {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '日志' }).click();
  await expect(page.getByRole('region', { name: '日志流' })).toBeVisible();
  await expect(page.getByRole('table', { name: '结构化日志' })).toBeVisible();
  await page.getByLabel('日志级别').click();
  await page.getByRole('option', { name: 'Error' }).click();
  await expect(page.getByLabel('日志级别')).toContainText('Error');
  await page.getByLabel('日志级别').click();
  await page.getByRole('option', { name: '全部级别' }).click();
  await page.getByRole('group', { name: '日志视图' }).getByRole('button', { name: '原始输出' }).click();
  await expect(page.getByRole('log', { name: '原始日志输出' })).toBeVisible();
  await page.getByRole('log', { name: '原始日志输出' }).getByRole('button').first().click();
  await expect(page.getByRole('navigation', { name: '页面分区' }).getByRole('button', { name: '交互链路' })).toHaveClass(/section-navigation-item-active/);
  await expect(page.getByText('链路 trace-ui-001')).toBeVisible();
});

test('模型服务支持新增、编辑、删除和默认 Provider', async ({ page }) => {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '设置' }).click();
  await page.getByRole('navigation', { name: '页面分区' }).getByRole('button', { name: '模型服务' }).click();
  await expect(page.getByRole('heading', { name: '模型 Provider' })).toBeVisible();
  await page.getByRole('button', { name: '新建' }).click();
  await expect(page.getByRole('dialog', { name: '新建 Provider' })).toBeVisible();
  await page.getByRole('button', { name: '创建 Provider' }).click();
  await page.getByLabel('Provider ID').fill('qwen-cloud');
  await page.getByLabel('对话模型').fill('qwen3.5-plus');
  await page.getByLabel('Base URL').fill('https://dashscope.aliyuncs.com/compatible-mode');
  await expect(page.getByText('有未保存改动', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('测试配置已保存。')).toBeVisible();
  await expect(page.getByText(/工作台不会读取或回显/)).toBeVisible();
});

test('能力页保留扩展、技能、语音服务和自动化管理', async ({ page }) => {
  const rail = page.getByRole('navigation', { name: '主导航' });
  const sections = page.getByRole('navigation', { name: '页面分区' });
  await rail.getByRole('button', { name: '能力' }).click();
  for (const label of ['技能', '扩展', '语音服务', '自动化']) await expect(sections.getByRole('button', { name: label })).toBeVisible();
  await sections.getByRole('button', { name: '扩展' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace Bridge' })).toBeVisible();
  await sections.getByRole('button', { name: '技能' }).click();
  await expect(page.getByText('工作台同步')).toBeVisible();
  await expect(page.getByRole('heading', { name: '能力来源' })).toBeVisible();
  await expect(page.getByText('摇篮内置能力')).toBeVisible();
  await expect(page.getByText('Provider 状态')).toHaveCount(0);
  await expect(page.getByText('glimmer-cradle-core')).toHaveCount(0);
  await page.screenshot({ path: path.resolve(__dirname, '../../../../build/reports/playwright', 'workbench-capability-sources.png'), fullPage: true });
});

test('Avatar 作为角色域的一部分管理模型、动作和位置', async ({ page }) => {
  const rail = page.getByRole('navigation', { name: '主导航' });
  const sections = page.getByRole('navigation', { name: '页面分区' });
  await rail.getByRole('button', { name: '角色' }).click();
  await expect(sections.getByRole('button', { name: '形象状态' })).toBeVisible();
  await expect(sections.getByRole('button', { name: '模型与动作' })).toBeVisible();
  await sections.getByRole('button', { name: '模型与动作' }).click();
  await expect(page.locator('.avatar-preview-stage')).toBeVisible();
  await sections.getByRole('button', { name: '桌面位置' }).click();
  await expect(page.getByRole('heading', { name: /桌面/ }).first()).toBeVisible();
});

test('记忆页消费受控经历与记忆投影', async ({ page }) => {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '记忆' }).click();
  await expect(page.getByText('群聊中的可重建会话消息。').first()).toBeVisible();
  await page.getByRole('navigation', { name: '页面分区' }).getByRole('button', { name: '经历与记忆' }).click();
  await expect(page.getByText(/Moment/).first()).toBeVisible();
});

for (const viewport of [
  { name: 'compact', width: 1024, height: 640 },
  { name: 'normal', width: 1148, height: 680 },
  { name: 'comfortable', width: 1280, height: 720 },
  { name: 'wide', width: 1536, height: 900 },
]) {
  test(`工作台在 ${viewport.name} 窗口无横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.getByRole('heading', { name: '对话', exact: true })).toBeVisible();
    if (viewport.name === 'compact') {
      await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '对话' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: '页面分区' })).toBeVisible();
      await expect(page.getByRole('complementary', { name: '上下文栏' })).toBeHidden();
    }
    const workspace = await page.locator('.control-workspace').boundingBox();
    expect(workspace).not.toBeNull();
    expect(workspace!.width).toBeGreaterThan(viewport.width * 0.44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: path.resolve(__dirname, '../../../../build/reports/playwright', `workbench-${viewport.name}.png`),
      fullPage: true,
    });
  });
}

for (const visual of [
  { page: '记忆', section: '经历与记忆', file: 'memory' },
  { page: '角色', section: '模型与动作', file: 'character-avatar' },
  { page: '能力', section: '扩展', file: 'capabilities' },
  { page: '日志', section: '日志流', file: 'logs' },
  { page: '设置', section: '外观', file: 'settings-appearance' },
]) {
  test(`${visual.page}页面保持 Bubble 工作台布局`, async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 900 });
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: visual.page }).click();
    await page.getByRole('navigation', { name: '页面分区' }).getByRole('button', { name: visual.section }).click();
    await expect(page.locator('.control-workspace')).toBeVisible();
    await page.screenshot({ path: path.resolve(__dirname, '../../../../build/reports/playwright', `workbench-${visual.file}.png`), fullPage: true });
  });
}
