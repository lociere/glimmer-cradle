/* Kernel composition 的 schema-derived Document projection；serialized shape 由 contracts/json-schema/product/v1 拥有。 */

/**
 * 产品发行物包含的能力组合；启用状态与用户偏好不属于该契约。
 */
export interface ProductComposition {
  $schema?: string;
  schema_version: 1;
  id: 'desktop' | 'personal-server';
  display_name: string;
  /** 当前产品制品的语义版本；由发布链写入，不属于用户配置。 */
  version: string;
  /**
   * Capabilities included in this product artifact. Enablement is owned by system configuration.
   */
  features: {
    control_surface_gateway: boolean;
    local_device_actions: boolean;
    avatar: boolean;
    audio: {
      tts: boolean;
      asr: boolean;
    };
    extensions: boolean;
  };
}
