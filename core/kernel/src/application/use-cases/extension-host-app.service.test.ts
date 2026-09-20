import { describe, expect, it, vi } from 'vitest';
import { BuiltInContributionPoint, type ContributionRequirements } from '@glimmer-cradle/extension-sdk';
import { ExtensionHostAppService } from '../../adapters/extension-host/extension-host-application-adapter';
import { ExtensionRuntimeRegistry } from '../../adapters/extension-host/extension-runtime-registry';
import { SkillCatalogAppService } from './skill-catalog-app.service';
import { SkillRegistry } from '../skill-plane/skill-registry';
import type { SkillAvailabilityContext } from '../../ports/skill-plane.port';
import { SkillPlanePolicy } from '../skill-plane/availability';
import { SystemClockAdapter } from '../../adapters/time/system-clock-adapter';
import { AttentionLeaseStore } from '../attention/attention-lease-store';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileAssetStore } from '../../adapters/content/file-asset-store';
import { StagedAssetUploads } from '../../adapters/content/staged-asset-uploads';
import { CognitionClient } from '../../adapters/cognition/cognition-client';

const availability: SkillAvailabilityContext = {
  productId: 'desktop',
  platform: 'windows-x64',
  features: new Set(['extensions']),
};
const skillPlanePolicy = new SkillPlanePolicy();

function createHostService(perception: unknown, catalog = new SkillCatalogAppService(new SkillRegistry()), uploads?: StagedAssetUploads) {
  return {
    catalog,
    service: new ExtensionHostAppService(
      perception as never,
      catalog,
      availability,
      skillPlanePolicy,
      new AttentionLeaseStore(new SystemClockAdapter()),
      {} as never,
      new ExtensionRuntimeRegistry(availability, skillPlanePolicy),
      '0.2.2',
      uploads,
    ),
  };
}

function createDefaultRequirements(): ContributionRequirements {
  return {
    products: ['any'],
    platforms: ['any'],
    features: [],
    profiles: [],
  };
}

describe('ExtensionHostAppService', () => {
  it('routes five Content kinds through real Extension ingress and preserves legacy URI as a temporary read input', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'glimmer-ingress-'));
    try {
      const received: any[] = [];
      const wireRequests: any[] = [];
      const cognition = new CognitionClient({
        methods: { SubmitPerception: 'submit' },
        makeCallMetadata: () => ({}),
        call: async (_method: unknown, request: unknown) => {
          wireRequests.push(request);
          return { operationId: 'operation', state: 1 };
        },
      } as never);
      const perceptionService = {
        getConversationDirectory: () => ({ resolve: () => ({
          source_key: 'extension:demo', actor_id: 'actor', actor_name: 'Alice',
          context: { interaction_id: 'interaction' },
        }) }),
        processIngress: async (event: any) => {
          received.push(event);
          await cognition.submitPerception(event, event.trace_id, 1000);
        },
      };
      const uploads = new StagedAssetUploads(
        new FileAssetStore(path.join(root, 'state'), path.join(root, 'work')),
        new FileAssetStore(path.join(root, 'transient'), path.join(root, 'work'), true),
        path.join(root, 'stage'),
      );
      const { service } = createHostService(perceptionService, undefined, uploads);
      const media = ['image', 'audio', 'video', 'file'] as const;
      const parts: Array<{ kind: typeof media[number]; uploadToken: string }> = [];
      for (const kind of media) {
        const bytes = Buffer.from(kind);
        const token = await service.beginAssetUpload('demo', { mediaType: `${kind}/test`, sizeBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex') });
        await service.writeAssetUpload('demo', token, bytes);
        parts.push({ kind, uploadToken: token });
      }
      await service.injectPerception('demo', {
        sensoryType: 'VISUAL',
        address: { provider_id: 'demo', provider_account_id: 'local', space_kind: 'personal',
          external_space_key: 'one', visibility: 'private' },
        content: { text: 'hello', modality: ['text', ...media],
          parts: [{ kind: 'text', text: 'hello' }, ...parts],
          items: [{ modality: 'video', mime_type: 'audio/wav', uri: 'https://expired.example/audio' }],
        },
      });
      expect(received).toHaveLength(1);
      expect(received[0].content.parts.map((part: any) => part.content.kind)).toEqual(['text', ...media]);
      expect(received[0].content.parts[1].content.asset).toMatchObject({ mediaType: 'image/test', sizeBytes: 5 });
      expect(received[0].content.items[0].uri).toContain('expired.example');
      expect(JSON.stringify(received[0].content.parts)).not.toContain(root);
      expect(wireRequests[0].content.parts.map((part: any) => part.content.value.case))
        .toEqual(['text', 'image', 'audio', 'video', 'file']);
      expect(wireRequests[0].content.parts[1].content.value.value).toMatchObject({
        mediaType: 'image/test', sizeBytes: 5n,
      });
      await expect(service.injectPerception('demo', {
        sensoryType: 'VISUAL',
        address: { provider_id: 'demo', provider_account_id: 'local', space_kind: 'personal',
          external_space_key: 'one', visibility: 'private' },
        content: { modality: ['image'], parts: [parts[0]] },
      })).rejects.toThrow('无效');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('由 Host 分别标记普通观察和证据候选', async () => {
    const received: unknown[] = [];
    const perceptionService = {
      getConversationDirectory: () => ({
        resolve: (_address: unknown, interactionId: string) => ({
          context: {
            source_provider_id: 'test-extension',
            scene_id: 'scene:test',
            conversation_id: 'conversation:test',
            continuity_id: 'continuity:test',
            thread_id: 'main',
            interaction_id: interactionId,
            recall_scope: 'space_local',
            disclosure_scope: 'space_local',
          },
          actor_id: 'actor:test',
          actor_name: 'Alice',
          source_key: 'scene:test',
        }),
      }),
      processIngress: async (event: unknown) => received.push(event),
    };
    const { service: hostService } = createHostService(perceptionService);
    const address = {
      provider_id: 'test-extension',
      provider_account_id: 'account',
      space_kind: 'group' as const,
      external_space_key: 'group',
      visibility: 'shared' as const,
    };

    await hostService.injectPerception('test-extension', {
      sensoryType: 'TEXT',
      address,
      content: { text: '普通消息', modality: ['text'] },
    });
    await hostService.submitEvidenceProposal('test-extension', {
      address,
      content: '群聊摘要',
      sourceEventId: 'message-1',
      schemaRef: 'test://summary/v1',
    });

    const projections = received as Array<{ origin: { cognitive_effect: string }; response_policy: string; retention_ceiling: string }>;
    expect(projections[0].origin.cognitive_effect).toBe('observation');
    expect(projections[1].origin.cognitive_effect).toBe('evidence_proposal');
    expect(projections[1].response_policy).toBe('observe_only');
    expect(projections[1].retention_ceiling).toBe('memory_candidate');
  });

  it('invalidates every media token when a multi-part injection fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'glimmer-token-failure-'));
    try {
      const uploads = new StagedAssetUploads(
        new FileAssetStore(path.join(root, 'state'), path.join(root, 'work')),
        new FileAssetStore(path.join(root, 'transient'), path.join(root, 'work'), true),
        path.join(root, 'stage'),
      );
      const perception = { getConversationDirectory: () => ({ resolve: () => ({
        source_key: 'demo', actor_id: 'actor', actor_name: 'Alice', context: { interaction_id: 'one' },
      }) }), processIngress: vi.fn() };
      const { service } = createHostService(perception, undefined, uploads);
      const bytes = Buffer.from('image');
      const tokens: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        const token = await service.beginAssetUpload('demo', { mediaType: 'image/png', sizeBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex') });
        await service.writeAssetUpload('demo', token, bytes);
        tokens.push(token);
      }
      const proposal = { sensoryType: 'VISUAL', address: { provider_id: 'demo', provider_account_id: 'local',
        space_kind: 'personal' as const, external_space_key: 'one', visibility: 'private' as const },
        content: { modality: ['image', 'audio'], parts: [
          { kind: 'image' as const, uploadToken: tokens[0] },
          { kind: 'audio' as const, uploadToken: tokens[1] },
        ] } };
      await expect(service.injectPerception('demo', proposal)).rejects.toThrow('媒体类型');
      await expect(service.injectPerception('demo', proposal)).rejects.toThrow('无效');
      expect(await readdir(path.join(root, 'stage'))).toEqual([]);
      expect(perception.processIngress).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('cleans every valid token when an untrusted proposal contains a malformed part', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'glimmer-malformed-proposal-'));
    try {
      const uploads = new StagedAssetUploads(
        new FileAssetStore(path.join(root, 'state'), path.join(root, 'work')),
        new FileAssetStore(path.join(root, 'transient'), path.join(root, 'work'), true),
        path.join(root, 'stage'),
      );
      const perception = { getConversationDirectory: vi.fn(), processIngress: vi.fn() };
      const { service } = createHostService(perception, undefined, uploads);
      const bytes = Buffer.from('image');
      const tokens: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        const token = await service.beginAssetUpload('demo', { mediaType: 'image/png', sizeBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex') });
        await service.writeAssetUpload('demo', token, bytes);
        tokens.push(token);
      }
      const proposal = { sensoryType: 'VISUAL', address: { provider_id: 'demo', provider_account_id: 'local',
        space_kind: 'personal', external_space_key: 'one', visibility: 'private' }, content: {
        modality: ['image'], parts: [
          { kind: 'image', uploadToken: tokens[0] },
          null,
          { kind: 'image', uploadToken: tokens[1] },
        ],
      } };

      await expect(service.injectPerception('demo', proposal as never)).rejects.toThrow('ContentPart 结构无效');
      expect(await readdir(path.join(root, 'stage'))).toEqual([]);
      expect(perception.getConversationDirectory).not.toHaveBeenCalled();
      for (const token of tokens) {
        await expect(uploads.consume('demo', token, 'experience', 'image')).rejects.toThrow('无效');
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('projects extension runtime into skill provider runtimes and removes it on unregister', () => {
    const extensionId = `runtime-provider-${Date.now()}`;
    const skillCatalog = new SkillCatalogAppService(new SkillRegistry());
    const { service: hostService } = createHostService({}, skillCatalog);

    hostService.registerExtensionRuntimeManifest({
      id: extensionId,
      name: 'Runtime Provider Demo',
      version: '1.0.0',
      description: '用于验证 provider runtime 与 manifest 投影同步。',
      permissions: [],
      tags: ['provider-runtime'],
      contributionPoints: [],
      contributes: {
        [BuiltInContributionPoint.managedResource]: [{
          id: `${extensionId}.resource`,
          title: 'Runtime Resource',
          kind: 'localService',
          audience: 'host',
          scope: { kind: 'global' },
          requirements: createDefaultRequirements(),
          required: true,
          permissions: [],
          dependsOn: [],
          metadata: {},
        }],
      },
    });

    let providerRuntime = skillCatalog.getCatalogSnapshot().providerRuntimes.find((runtime) => (
      runtime.provider.kind === 'extension' && runtime.provider.id === extensionId
    ));
    expect(providerRuntime?.state).toBe('contract_only');
    expect(providerRuntime?.skill_count).toBe(0);
    expect(hostService.getExtensionRuntimeProjection(extensionId)?.description)
      .toBe('用于验证 provider runtime 与 manifest 投影同步。');

    hostService.updateExtensionRuntimeLifecycle(extensionId, 'running');
    hostService.mergeExtensionCapabilityGraph(extensionId, {
      nodes: [{
        id: `${extensionId}.resource`,
        contribution_point: BuiltInContributionPoint.managedResource,
        kind: 'localService',
        title: 'Runtime Resource',
        state: 'ready',
        owner: 'extension',
        owner_id: extensionId,
        audience: 'host',
        required: true,
        summary: 'ready',
        permissions: [],
        readiness_gates: [],
        diagnostic_refs: [],
        metadata: {},
        updated_at: new Date().toISOString(),
      }],
    });

    providerRuntime = skillCatalog.getCatalogSnapshot().providerRuntimes.find((runtime) => (
      runtime.provider.kind === 'extension' && runtime.provider.id === extensionId
    ));
    expect(providerRuntime?.state).toBe('ready');
    expect(providerRuntime?.summary).toContain('已就绪');

    hostService.unregisterExtensionRuntime(extensionId);
    providerRuntime = skillCatalog.getCatalogSnapshot().providerRuntimes.find((runtime) => (
      runtime.provider.kind === 'extension' && runtime.provider.id === extensionId
    ));
    expect(providerRuntime).toBeUndefined();
  });
});
