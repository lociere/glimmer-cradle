import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from '@storybook/test';
import { MemoryRouter } from 'react-router-dom';
import { Overview, type OverviewProps } from './Overview';

const snapshot: OverviewProps['snapshot'] = {
  status: { ready: true, status: 'ready', summary: '服务入口已就绪。', connection_state: 'observing', blocking_runtimes: [], observed_at: 1788768000000 },
  statusError: null, connection: 'online', runtimeCatalogUpdatedAt: 1788768000000, runtimeCatalogCurrent: true, configuration: null,
  runtimes: [{ runtime_id: 'kernel.ingress', owner: 'kernel', phase: 'ingress', state: 'ready', blocking: true, summary: '服务入口已就绪。' }],
};
const meta = {
  title: 'Features/Overview', component: Overview,
  decorators: [(Story) => <MemoryRouter><Story /></MemoryRouter>],
  args: { snapshot, configurationRead: { state: 'loading' }, onRetryConfiguration: () => undefined },
} satisfies Meta<typeof Overview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const Loading: Story = { args: { snapshot: { ...snapshot, status: null, runtimeCatalogUpdatedAt: null, runtimeCatalogCurrent: false, runtimes: [], connection: 'connecting' } } };
export const Empty: Story = { args: { snapshot: { ...snapshot, runtimes: [] } } };
export const Degraded: Story = { args: { snapshot: { ...snapshot, runtimes: [{ ...snapshot.runtimes[0], runtime_id: 'audio.tts', owner: 'engine', state: 'degraded', blocking: false, summary: '语音资源不可用，文字交流仍可使用。' }] } } };
export const ReadFailure: Story = { args: { snapshot: { ...snapshot, statusError: '无法读取服务状态，正在自动重试。' }, configurationRead: { state: 'error', message: '模型配置暂时不可读。' } } };
export const Disconnected: Story = { args: { snapshot: { ...snapshot, connection: 'waiting' } } };
export const AwaitingCatalog: Story = { args: { snapshot: { ...snapshot, runtimeCatalogCurrent: false } } };
export const LongCatalog: Story = { args: { snapshot: { ...snapshot, runtimes: Array.from({ length: 30 }, (_, i) => ({ ...snapshot.runtimes[0], runtime_id: `extension.${'long-resource-name-'.repeat(8)}${i}`, summary: '长内容状态说明，用于验证换行和键盘选择。'.repeat(5) })) } } };
export const Details: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: '查看 kernel.ingress 详情' });
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByRole('dialog', { name: 'kernel.ingress' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect(trigger).toHaveFocus();
  },
};
