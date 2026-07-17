/* 自动生成 — 从 ExtensionReleaseManifest.schema.json 生成，勿手动修改 */

export interface ExtensionReleaseManifest {
  schema: 'glimmer-cradle.extension-release';
  schema_version: 1;
  extension: {
    id: string;
    version: string;
    publisher: string;
  };
  channel: 'stable' | 'beta' | 'nightly';
  source: {
    repository: string;
    revision: string;
    tag?: string;
  };
  /**
   * @minItems 1
   */
  artifacts: [ExtensionReleaseArtifact, ...ExtensionReleaseArtifact[]];
}
export interface ExtensionReleaseArtifact {
  platform: 'any' | 'windows-x64' | 'windows-arm64' | 'linux-x64' | 'linux-arm64' | 'darwin-x64' | 'darwin-arm64';
  file: string;
  media_type: 'application/vnd.glimmer-cradle.extension+zip';
  size: number;
  sha256: string;
  signature?: string;
  provenance?: string;
}
