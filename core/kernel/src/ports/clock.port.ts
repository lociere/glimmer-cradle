export interface ScheduledTaskPort {
  cancel(): void;
}

/** Platform-neutral clock and one-shot scheduling boundary. */
export interface KernelClockPort {
  nowMs(): number;
  monotonicNowMs(): number;
  schedule(delayMs: number, task: () => void): ScheduledTaskPort;
}
