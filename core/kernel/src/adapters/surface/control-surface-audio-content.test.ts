import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { FileAssetStore } from '../content/file-asset-store';
import { ControlSurfaceGateway } from './control-surface-gateway';

const roots: string[] = [];
const originalDataRoot = process.env.GLIMMER_CRADLE_DATA_ROOT;
afterEach(async () => {
  if (originalDataRoot === undefined) delete process.env.GLIMMER_CRADLE_DATA_ROOT;
  else process.env.GLIMMER_CRADLE_DATA_ROOT = originalDataRoot;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(result: { status: 'success' | 'error'; text?: string; message?: string }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'glimmer-desktop-audio-'));
  roots.push(root);
  process.env.GLIMMER_CRADLE_DATA_ROOT = root;
  const received: any[] = [];
  const audio = { isLaneEnabled: () => true, recognizeSpeech: vi.fn(async () => result) };
  const store = new FileAssetStore(path.join(root, 'state', 'content', 'assets'), path.join(root, 'work', 'content', 'uploads'));
  const gateway = new ControlSurfaceGateway({} as never, {} as never, audio as never, store);
  (gateway as any)._perceptionAppService = {
    getConversationDirectory: () => ({ resolve: () => ({ source_key: 'desktop', actor_id: 'user', actor_name: '用户',
      context: { interaction_id: 'trace' } }) }),
    processIngress: async (event: unknown) => { received.push(event); },
  };
  return { gateway, audio, received, root, store };
}

it('injects verified audio reference with trusted ASR text and cleans input work file', async () => {
  const { gateway, received, root, store } = await fixture({ status: 'success', text: '你好' });
  await (gateway as any)._handleAudioInput({ audio_id: 'recording', audio_data: Buffer.from('wave').toString('base64'), mime_type: 'audio/wav' }, 'trace');
  await vi.waitFor(() => expect(received).toHaveLength(1));
  const event = received[0];
  expect(event.content.parts[1]).toMatchObject({ content: { kind: 'audio', asset: { mediaType: 'audio/wav' } },
    semantic: { text: '你好', resolved: true, source: 'asr' } });
  const ref = event.content.parts[1].content.asset;
  expect(await store.inspect(ref.assetId)).toEqual(ref);
  expect(await readdir(path.join(root, 'work', 'audio', 'asr'))).toEqual([]);
});

it('does not retain audio or inject perception after ASR failure', async () => {
  const { gateway, received, root } = await fixture({ status: 'error', message: 'ASR unavailable' });
  await (gateway as any)._handleAudioInput({ audio_id: 'recording', audio_data: Buffer.from('wave').toString('base64'), mime_type: 'audio/wav' }, 'trace');
  expect(received).toEqual([]);
  expect(await readdir(path.join(root, 'work', 'audio', 'asr'))).toEqual([]);
});

it('reports an error after ingress rejection and leaves the committed asset for orphan review', async () => {
  const { gateway, root } = await fixture({ status: 'success', text: '你好' });
  (gateway as any)._perceptionAppService.processIngress = async () => { throw new Error('ingress rejected'); };
  const transcripts: any[] = [];
  (gateway as any)._broadcastAudioTranscript = (...args: unknown[]) => transcripts.push(args);
  await (gateway as any)._handleAudioInput({ audio_id: 'recording',
    audio_data: Buffer.from('wave').toString('base64'), mime_type: 'audio/wav' }, 'trace');
  expect(transcripts).toEqual([['trace', 'recording', 'error', undefined, 'ingress rejected']]);
  const assetIds = await readdir(path.join(root, 'state', 'content', 'assets'));
  expect(assetIds).toHaveLength(1);
  expect(await readdir(path.join(root, 'work', 'audio', 'asr'))).toEqual([]);
});
