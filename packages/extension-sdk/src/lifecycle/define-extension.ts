import type { ExtensionContributions, ExtensionManifestInput } from '../manifest/index';
import type { ExtensionModule } from '../host/index';

/**
 * 扩展源码只声明与自身有关的 manifest 片段。
 * 完整身份与默认贡献项由宿主在加载 extension-manifest.yaml 后统一校验、补齐。
 */
export type ExtensionManifestDraft = Partial<Omit<ExtensionManifestInput, 'contributes'>> & {
  contributes?: ExtensionContributions;
};

export interface ExtensionDefinition<TConfig = unknown> {
  extension: ExtensionModule<TConfig>;
  manifest?: ExtensionManifestDraft;
}

export function defineExtension<TConfig = unknown>(
  definition: ExtensionDefinition<TConfig>,
): ExtensionDefinition<TConfig> {
  return definition;
}
