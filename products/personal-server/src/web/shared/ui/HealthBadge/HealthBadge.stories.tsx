import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from '@storybook/test';
import { HealthBadge } from './HealthBadge';

const meta = {
  title: 'Shared UI/HealthBadge',
  component: HealthBadge,
  parameters: { layout: 'centered' },
  args: { label: '系统可用', tone: 'ready' },
} satisfies Meta<typeof HealthBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent('系统可用');
  },
};

export const Connecting: Story = { args: { label: '正在连接', tone: 'connecting' } };
export const Degraded: Story = { args: { label: '等待服务', tone: 'degraded' } };
