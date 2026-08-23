import { describe, expect, it } from 'vitest';
import { BuiltInContributionPoint, ExtensionPermission, type ContributionRequirements } from '@glimmer-cradle/protocol';
import { ExtensionRuntimeRegistry } from './extension-runtime-registry';

function createDefaultRequirements(): ContributionRequirements {
  return {
    products: ['any'],
    platforms: ['any'],
    features: [],
    profiles: [],
  };
}

describe('ExtensionRuntimeRegistry', () => {
  it('uses capability graph dependencies to enable action intents', () => {
    const registry = new ExtensionRuntimeRegistry();
    registry.registerManifest({
      id: 'demo-extension',
      name: 'Demo Extension',
      version: '1.0.0',
      permissions: [],
      tags: [],
      contributionPoints: [],
      contributes: {
        [BuiltInContributionPoint.managedResource]: [{
          id: 'demo-resource',
          title: 'Demo Resource',
        kind: 'localService',
        audience: 'host',
        required: true,
          scope: { kind: 'global' },
          requirements: createDefaultRequirements(),
          permissions: [],
          dependsOn: [],
          metadata: {},
        }],
        [BuiltInContributionPoint.capability]: [{
          id: 'demo-capability',
          title: 'Demo Capability',
          resourceIds: ['demo-resource'],
          scope: { kind: 'global' },
          requirements: createDefaultRequirements(),
          permissions: [],
          dependsOn: [],
          metadata: {},
          required: true,
        }],
        [BuiltInContributionPoint.command]: [{
          id: 'demo-extension.run',
          command: 'demo-extension.run',
          title: 'Run',
          scope: { kind: 'global' },
          requirements: createDefaultRequirements(),
          permissions: [],
          dependsOn: [],
          metadata: {},
          actionKind: 'command',
          preconditions: [{ nodeId: 'demo-resource', requiredState: 'ready', relation: 'depends_on' }],
        }],
      },
    });

    registry.updateLifecycle('demo-extension', 'running');
    expect(registry.get('demo-extension')?.actions[0].state).toBe('disabled');
    expect(registry.get('demo-extension')?.actions[0].disabled_reason)
      .toContain('目标节点 demo-extension.run 当前状态为 unavailable');

    registry.mergeCapabilityGraph('demo-extension', {
      nodes: [{
        id: 'demo-resource',
        contribution_point: BuiltInContributionPoint.managedResource,
        kind: 'localService',
        title: 'Demo Resource',
        state: 'ready',
        owner: 'extension',
        owner_id: 'demo-extension',
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

    const projection = registry.get('demo-extension');
    expect(projection?.capability_graph.nodes.find((node) => node.id === 'demo-capability')?.state)
      .toBe('available');
    expect(projection?.actions.find((action) => action.id === 'demo-extension.run')?.state)
      .toBe('enabled');
    expect(projection?.actions.find((action) => action.id === 'demo-extension.run')?.audience)
      .toBe('user');
  });

  it('keeps unknown contribution points indexed but unsupported', () => {
    const registry = new ExtensionRuntimeRegistry();
    registry.registerManifest({
      id: 'demo-extension',
      name: 'Demo Extension',
      version: '1.0.0',
      description: '用于验证未知 contribution point。',
      permissions: [],
      tags: ['demo'],
      contributionPoints: [],
      contributes: {
        'vendor.futureCapability': [{
          id: 'future-node',
          title: 'Future Node',
          permissions: [],
          dependsOn: [],
          metadata: {},
        }],
      },
    });

    const projection = registry.get('demo-extension');
    expect(projection?.contribution_points.find((point) => point.id === 'vendor.futureCapability')?.state)
      .toBe('unsupported');
    expect(projection?.capability_graph.nodes.find((node) => node.id === 'future-node')?.state)
      .toBe('unsupported');
    expect(projection?.capability_graph.nodes.find((node) => node.id === 'future-node')?.audience)
      .toBe('extension');
    expect(projection?.actions.length).toBe(0);
  });

  it('projects manifest identity metadata for desktop consumers', () => {
    const registry = new ExtensionRuntimeRegistry();
    registry.registerManifest({
      id: 'identity-extension',
      name: 'Identity Extension',
      version: '2.0.0',
      description: '用于验证扩展身份字段投影。',
      permissions: [ExtensionPermission.EVENT_SUBSCRIBE],
      tags: ['desktop', 'projection'],
      contributionPoints: [],
      contributes: {},
    });

    const projection = registry.get('identity-extension');
    expect(projection?.display_name).toBe('Identity Extension');
    expect(projection?.version).toBe('2.0.0');
    expect(projection?.description).toBe('用于验证扩展身份字段投影。');
    expect(projection?.permissions).toEqual([ExtensionPermission.EVENT_SUBSCRIBE]);
    expect(projection?.tags).toEqual(['desktop', 'projection']);
  });

  it('defaults non-skill built-in contribution audiences away from character', () => {
    const registry = new ExtensionRuntimeRegistry();
    registry.registerManifest({
      id: 'audience-defaults',
      name: 'Audience Defaults',
      version: '1.0.0',
      permissions: [],
      tags: [],
      contributionPoints: [],
      contributes: {
        [BuiltInContributionPoint.command]: [{
          id: 'audience-defaults.openPanel',
          command: 'audience-defaults.openPanel',
          title: 'Open Panel',
          scope: { kind: 'global' },
          requirements: createDefaultRequirements(),
          permissions: [],
          dependsOn: [],
          metadata: {},
          actionKind: 'command',
          preconditions: [],
        }],
        [BuiltInContributionPoint.managementSurface]: [{
          id: 'panel',
          title: 'Panel',
          kind: 'management',
          scope: { kind: 'global' },
          requirements: createDefaultRequirements(),
          permissions: [],
          dependsOn: [],
          metadata: {},
        }],
        [BuiltInContributionPoint.managedResource]: [{
          id: 'process',
          title: 'Process',
          kind: 'localService',
          required: true,
          scope: { kind: 'global' },
          requirements: createDefaultRequirements(),
          permissions: [],
          dependsOn: [],
          metadata: {},
        }],
        [BuiltInContributionPoint.protocolBridge]: [{
          id: 'bridge',
          title: 'Bridge',
          kind: 'protocolBridge',
          required: true,
          scope: { kind: 'global' },
          requirements: createDefaultRequirements(),
          permissions: [],
          dependsOn: [],
          metadata: {},
        }],
      },
    });

    const projection = registry.get('audience-defaults');
    const nodeAudiences = Object.fromEntries(
      (projection?.capability_graph.nodes ?? []).map((node) => [node.id, node.audience]),
    );
    expect(nodeAudiences).toMatchObject({
      'audience-defaults.openPanel': 'user',
      panel: 'user',
      process: 'host',
      bridge: 'adapter',
    });
    expect(projection?.actions[0].audience).toBe('user');
  });
});
