import { describe, expect, it } from 'vitest';
import { BuiltInContributionPoint } from '@glimmer-cradle/protocol';
import { ExtensionHostAppService } from './extension-host-app.service';
import { SkillCatalogAppService } from './skill-catalog-app.service';

describe('ExtensionHostAppService', () => {
  it('由 Host 分别标记普通观察和证据候选', async () => {
    const received: any[] = [];
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
    const hostService = new ExtensionHostAppService(perceptionService as never);
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

    expect(received[0].origin.cognitive_effect).toBe('observation');
    expect(received[1].origin.cognitive_effect).toBe('evidence_proposal');
    expect(received[1].response_policy).toBe('observe_only');
    expect(received[1].retention_ceiling).toBe('memory_candidate');
  });

  it('projects extension runtime into skill provider runtimes and removes it on unregister', () => {
    const extensionId = `runtime-provider-${Date.now()}`;
    const skillCatalog = new SkillCatalogAppService();
    const hostService = new ExtensionHostAppService({} as never, skillCatalog);

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
          requirements: { products: ['any'], platforms: ['any'], features: [] },
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
