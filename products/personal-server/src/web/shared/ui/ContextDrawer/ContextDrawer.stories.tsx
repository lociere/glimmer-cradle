import type { Meta, StoryObj } from '@storybook/react';
import { Button } from 'react-aria-components';
import { ContextDrawer } from './ContextDrawer';

const meta = {
  title: 'Shared UI/ContextDrawer',
  component: ContextDrawer,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ContextDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RuntimeDetails: Story = {
  args: {
    title: 'audio.tts',
    eyebrow: '运行体详情',
    trigger: <Button className="quiet-button">打开详情</Button>,
    children: <><p>当前能力已降级，基础对话仍然可用。</p><dl><dt>Owner</dt><dd>audio</dd><dt>状态</dt><dd>degraded</dd></dl></>,
  },
};
