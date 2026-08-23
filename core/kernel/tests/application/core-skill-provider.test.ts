import { describe, expect, it } from 'vitest';
import { CoreSkillProvider } from '../../src/application/skill-plane/providers/core';

describe('CoreSkillProvider', () => {
  it('Desktop 产品组合发布本机设备能力', () => {
    const provider = new CoreSkillProvider(undefined, { localDeviceActions: true });

    expect(provider.listSkills().map((skill) => skill.id)).toEqual([
      'core.desktop',
      'core.clipboard',
      'core.notification',
      'core.screen_context',
      'core.confirmation',
    ]);
  });

  it('Personal Server 产品组合只保留跨控制面的确认能力', () => {
    const provider = new CoreSkillProvider(undefined, { localDeviceActions: false });

    expect(provider.listSkills().map((skill) => skill.id)).toEqual([
      'core.confirmation',
    ]);
  });
});
