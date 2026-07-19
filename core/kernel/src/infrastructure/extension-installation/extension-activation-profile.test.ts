import { describe, expect, it } from 'vitest';
import {
  BuiltInContributionPoint,
  materializeManifestForActivationProfile,
  resolveExtensionActivationProfile,
  validateExtensionManifest,
  type ActivationProfileRequirements,
  type ContributionRequirements,
  type ExtensionManifest,
} from '@glimmer-cradle/protocol';

function createDefaultProfileRequirements(): ActivationProfileRequirements {
  return {
    products: ['any'],
    platforms: ['any'],
    features: [],
  };
}

function createDefaultContributionRequirements(): ContributionRequirements {
  return {
    products: ['any'],
    platforms: ['any'],
    features: [],
    profiles: [],
  };
}

describe('extension activation profile contracts', () => {
  it('rejects duplicate activation profile ids and unknown profile references', () => {
    const manifest = createManifest({
      activationProfiles: [
        { id: 'external_onebot', title: 'External', default: true, requirements: createDefaultProfileRequirements(), permissions: [] },
        { id: 'external_onebot', title: 'Duplicate', default: false, requirements: createDefaultProfileRequirements(), permissions: [] },
      ],
      contributes: {
        [BuiltInContributionPoint.managedResource]: [{
          id: 'napcat-managed-process',
          kind: 'managedProcess',
          scope: { kind: 'global' },
          requirements: {
            ...createDefaultContributionRequirements(),
            profiles: ['managed_napcat_windows'],
          },
          permissions: [],
          dependsOn: [],
          metadata: {},
        }],
      },
    });

    const result = validateExtensionManifest(manifest);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/重复的 activation profile id/);
    expect(result.errors.join('\n')).toMatch(/未声明的 activation profile managed_napcat_windows/);
  });

  it('rejects multiple default activation profiles', () => {
    const result = validateExtensionManifest(createManifest({
      activationProfiles: [
        { id: 'external_onebot', title: 'External', default: true, requirements: createDefaultProfileRequirements(), permissions: [] },
        { id: 'managed_napcat_windows', title: 'Managed', default: true, requirements: createDefaultProfileRequirements(), permissions: ['EXTERNAL_PROCESS'] },
      ],
    }));

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/最多只能声明一个 default/);
  });

  it('requires explicit selection when multiple compatible profiles exist without default', () => {
    const manifest = createManifest({
      activationProfiles: [
        { id: 'external_onebot', title: 'External', default: false, requirements: createDefaultProfileRequirements(), permissions: [] },
        { id: 'managed_napcat_windows', title: 'Managed', default: false, requirements: createDefaultProfileRequirements(), permissions: ['EXTERNAL_PROCESS'] },
      ],
    });

    expect(() => resolveExtensionActivationProfile(manifest, {
      productId: 'desktop',
      platform: 'windows-x64',
      features: new Set(['extensions']),
    })).toThrow(/必须显式选择/);
  });

  it('materializes effective permissions and contribution plan from the selected profile', () => {
    const manifest = createManifest({
      permissions: ['PERCEPTION_WRITE'],
      activationProfiles: [
        { id: 'external_onebot', title: 'External', default: true, requirements: createDefaultProfileRequirements(), permissions: [] },
        { id: 'managed_napcat_windows', title: 'Managed', default: false, requirements: createDefaultProfileRequirements(), permissions: ['EXTERNAL_PROCESS'] },
      ],
      contributes: {
        [BuiltInContributionPoint.managedResource]: [
          {
            id: 'external-onebot-source',
            kind: 'protocolBridge',
            scope: { kind: 'global' },
            requirements: { ...createDefaultContributionRequirements(), profiles: ['external_onebot'] },
            permissions: [],
            dependsOn: [],
            metadata: {},
          },
          {
            id: 'napcat-managed-process',
            kind: 'managedProcess',
            scope: { kind: 'global' },
            requirements: { ...createDefaultContributionRequirements(), profiles: ['managed_napcat_windows'] },
            permissions: [],
            dependsOn: [],
            metadata: {},
          },
        ],
      },
    });

    const { manifest: effectiveManifest, profile } = materializeManifestForActivationProfile(
      manifest,
      {
        productId: 'desktop',
        platform: 'windows-x64',
        features: new Set(['extensions']),
      },
      'managed_napcat_windows',
    );

    expect(profile.id).toBe('managed_napcat_windows');
    expect(effectiveManifest.permissions).toEqual(['PERCEPTION_WRITE', 'EXTERNAL_PROCESS']);
    expect(effectiveManifest.contributes[BuiltInContributionPoint.managedResource]).toHaveLength(1);
    expect((effectiveManifest.contributes[BuiltInContributionPoint.managedResource] as Array<{ id: string }>)[0]?.id)
      .toBe('napcat-managed-process');
  });
});

function createManifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'lociere.test-adapter',
    name: 'Test Adapter',
    version: '1.0.0',
    publisher: 'lociere',
    license: 'MIT',
    repository: 'https://github.com/lociere/test-adapter',
    products: ['desktop', 'personal-server'],
    platforms: ['windows-x64', 'linux-x64'],
    tags: [],
    main: 'dist/index.js',
    minAppVersion: '0.1.0',
    permissions: [],
    activationEvents: ['onStartup'],
    requires: ['runtime'],
    engines: {},
    contributionPoints: [],
    activationProfiles: [],
    contributes: {},
    ...overrides,
  };
}
