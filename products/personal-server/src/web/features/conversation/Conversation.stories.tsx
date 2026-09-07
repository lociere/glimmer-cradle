import type { Meta, StoryObj } from '@storybook/react';
import { MemoryRouter } from 'react-router-dom';
import { Conversation } from './Conversation';
import type { ConversationSnapshot } from './ConversationController';

const snapshot: ConversationSnapshot = { entries: [{ id: 'welcome', role: 'assistant', text: '这是恢复的对话。可以继续刚才的话题。', time: '2026-09-07T08:00:00Z', status: 'committed' }], connected: true, loading: false, loadingOlder: false, initialized: true, nextCursor: null, error: '', sendError: '' };
const meta = {
  title: 'Features/Conversation', component: Conversation,
  decorators: [(Story) => <MemoryRouter><Story /></MemoryRouter>],
  args: { snapshot, onSend: () => true, onRetry: () => undefined, onRefresh: () => undefined, onLoadOlder: () => undefined },
} satisfies Meta<typeof Conversation>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Restored: Story = {};
export const Empty: Story = { args: { snapshot: { ...snapshot, entries: [] } } };
export const Loading: Story = { args: { snapshot: { ...snapshot, entries: [], loading: true, initialized: false } } };
export const Error: Story = { args: { snapshot: { ...snapshot, error: '对话历史暂时不可读。' } } };
export const Disconnected: Story = { args: { snapshot: { ...snapshot, connected: false } } };
export const Pending: Story = { args: { snapshot: { ...snapshot, entries: [...snapshot.entries, { id: 'pending', role: 'user', text: '继续刚才的话题。', time: '2026-09-07T08:01:00Z', status: 'thinking' }] } } };
export const Failed: Story = { args: { snapshot: { ...snapshot, entries: [{ id: 'failed', role: 'user', text: '这条消息未完成。', time: '2026-09-07T08:01:00Z', status: 'failed' }] } } };
export const LongText: Story = { args: { snapshot: { ...snapshot, entries: [{ ...snapshot.entries[0], text: '长中文消息与 very-long-technical-identifier-'.repeat(100) }] } } };
