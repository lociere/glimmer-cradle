import type {
  ExtensionPlatform,
  ProductFeatureId,
  SkillAvailabilityContext,
} from '../../ports/skill-plane.port';

export function currentExtensionPlatform(): Exclude<ExtensionPlatform, 'any'> {
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
  const operatingSystem = process.platform === 'win32'
    ? 'windows'
    : process.platform === 'darwin'
      ? 'darwin'
      : 'linux';
  return `${operatingSystem}-${architecture}`;
}

export function defaultDesktopSkillAvailability(): SkillAvailabilityContext {
  return {
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
}
