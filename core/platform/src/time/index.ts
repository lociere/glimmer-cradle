/** A cancellable one-shot timer owned by the caller's lifecycle. */
export interface ScheduledTask {
  cancel(): void;
}

/** Wall, monotonic, and one-shot timing primitives shared by Core modules. */
export interface Clock {
  nowMs(): number;
  monotonicNowMs(): number;
  schedule(delayMs: number, task: () => void): ScheduledTask;
}
