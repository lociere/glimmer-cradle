import type {
  ContributionRequirements,
  ExtensionPlatform,
  ProductFeatureId,
} from '@glimmer-cradle/protocol';
import type { SkillAvailabilityContext } from './types';

export const DEFAULT_DESKTOP_SKILL_AVAILABILITY: SkillAvailabilityContext = {
  productId: 'desktop',
  platform: currentExtensionPlatform(),
  features: new Set<ProductFeatureId>([
    'control_surface_gateway',
    'local_device_actions',
    'avatar',
    'audio.tts',
    'audio.asr',
    'extensions',
  ]),
};

export function isContributionAvailable(
  requirements: Partial<ContributionRequirements> | undefined,
  context: SkillAvailabilityContext,
): boolean {
  const products = requirements?.products ?? ['any'];
  if (!products.includes('any') && !products.includes(context.productId)) return false;
  const platforms = requirements?.platforms ?? ['any'];
  if (!platforms.includes('any') && !platforms.includes(context.platform)) return false;
  return (requirements?.features ?? []).every((feature) => context.features.has(feature));
}

export function currentExtensionPlatform(): Exclude<ExtensionPlatform, 'any'> {
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
  const operatingSystem = process.platform === 'win32'
    ? 'windows'
    : process.platform === 'darwin'
      ? 'darwin'
      : 'linux';
  return `${operatingSystem}-${architecture}`;
}
