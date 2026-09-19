/** Opaque identity primitive. Domain modules decide what the resulting id identifies. */
export interface StableIdentity {
  newId(): string;
  digest(parts: readonly string[]): string;
}
