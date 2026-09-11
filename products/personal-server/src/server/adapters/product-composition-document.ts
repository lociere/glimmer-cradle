export interface ProductComposition {
  $schema?: string;
  schema_version: 1;
  id: 'desktop' | 'personal-server';
  display_name: string;
  version: string;
  features: {
    control_surface_gateway: boolean;
    local_device_actions: boolean;
    avatar: boolean;
    audio: { tts: boolean; asr: boolean };
    extensions: boolean;
  };
}
