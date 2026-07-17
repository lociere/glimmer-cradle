import type { SkillAvailabilityContext, SkillProvider } from '../types';
import { CoreSkillProvider } from './core';
import { McpServerSkillProvider } from './mcp-server';
import { UserSkillProvider } from './user';

export { CoreSkillProvider } from './core';
export { McpServerSkillProvider } from './mcp-server';
export { UserSkillProvider } from './user';

export const DEFAULT_SKILL_PROVIDERS: SkillProvider[] = [
  CoreSkillProvider.instance,
  McpServerSkillProvider.instance,
  UserSkillProvider.instance,
];

export function createSkillProviders(options: {
  readonly localDeviceActions: boolean;
  readonly skillAvailability: SkillAvailabilityContext;
}): SkillProvider[] {
  return [
    new CoreSkillProvider(undefined, { localDeviceActions: options.localDeviceActions }),
    new McpServerSkillProvider(undefined, options.skillAvailability.productId),
    UserSkillProvider.instance,
  ];
}
