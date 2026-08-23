export interface StableIdentityPort {
  newId(): string;
  digest(parts: readonly string[]): string;
}
