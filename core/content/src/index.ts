/** A stable identity is not an authorization to read an asset. */
export interface AssetRef {
  readonly assetId: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface TextContent {
  readonly kind: 'text';
  readonly text: string;
}

export interface ImageContent {
  readonly kind: 'image';
  readonly asset: AssetRef;
}

export interface AudioContent {
  readonly kind: 'audio';
  readonly asset: AssetRef;
}

export interface VideoContent {
  readonly kind: 'video';
  readonly asset: AssetRef;
}

export interface FileContent {
  readonly kind: 'file';
  readonly asset: AssetRef;
  readonly name?: string;
}

export type ContentPart = TextContent | ImageContent | AudioContent | VideoContent | FileContent;

export interface AssetStorePort {
  put(source: AsyncIterable<Uint8Array>, mediaType: string): Promise<AssetRef>;
  open(ref: AssetRef): AsyncIterable<Uint8Array>;
  inspect(assetId: string): Promise<AssetRef | null>;
}
