/* 自动生成 — 从 ProductComposition.schema.json 生成，勿手动修改 */

/**
 * 产品发行物包含的能力组合；启用状态与用户偏好不属于该契约。
 */
export interface ProductComposition {
  $schema?: string;
  schema_version: 1;
  id: 'desktop' | 'personal-server';
  display_name: string;
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
