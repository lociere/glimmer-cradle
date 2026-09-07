import type { Meta, StoryObj } from '@storybook/react';
import { Extensions } from './Extensions';
import { ExtensionsController, type ExtensionsSnapshot } from './ExtensionsController';

const snapshot: ExtensionsSnapshot = { connected: true, loading: false, initialized: true, busy: false, error: '', readError: '', message: '', preview: null, upload: null,
  catalog: { request_id: 'story', status: 'success', projections: [], installations: [{ extension_id: 'community.echo', installed_versions: ['2.0.0', '1.0.0'], active_version: '1.0.0', updated_at: '2026-09-07T08:00:00Z' }] } };
const meta = { title: 'Features/Extensions', component: Extensions, args: { snapshot, controller: new ExtensionsController() } } satisfies Meta<typeof Extensions>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Installed: Story = {};
export const Empty: Story = { args: { snapshot: { ...snapshot, catalog: { ...snapshot.catalog!, installations: [] } } } };
export const Loading: Story = { args: { snapshot: { ...snapshot, initialized: false, loading: true, catalog: null } } };
export const Error: Story = { args: { snapshot: { ...snapshot, readError: '扩展目录暂时不可读。' } } };
export const Disconnected: Story = { args: { snapshot: { ...snapshot, connected: false } } };
export const Pending: Story = { args: { snapshot: { ...snapshot, busy: true, message: '正在处理扩展操作…' } } };
export const Success: Story = { args: { snapshot: { ...snapshot, message: '扩展安装完成。' } } };
export const LongList: Story = { args: { snapshot: { ...snapshot, catalog: { ...snapshot.catalog!, installations: Array.from({ length: 40 }, (_, index) => ({ ...snapshot.catalog!.installations[0], extension_id: `community.${'long-extension-name-'.repeat(8)}${index}` })) } } } };
