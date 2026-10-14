import type { Clock, ScheduledTask } from '../time/clock.js';

export type DeadlineResult<T> = { readonly status: 'completed'; readonly value: T } | { readonly status: 'expired' };

/** One monotonic budget may cover several waits; expiry never proves the underlying work drained. */
export class Deadline {
  private readonly expiresAtMs: number;

  public constructor(private readonly clock: Pick<Clock, 'monotonicNowMs' | 'schedule'>, timeoutMs: number) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) throw new Error('Deadline 等待预算无效');
    this.expiresAtMs = clock.monotonicNowMs() + timeoutMs;
  }

  public get remainingMs(): number { return Math.max(0, this.expiresAtMs - this.clock.monotonicNowMs()); }

  public waitFor<T>(operation: Promise<T>): Promise<DeadlineResult<T>> {
    return new Promise((resolve, reject) => {
      let done = false, timer: ScheduledTask | undefined;
      const finish = (accept: () => void): void => {
        if (done) return;
        done = true;
        try { timer?.cancel(); } catch (error) { reject(error); return; }
        accept();
      };
      const expire = (): void => finish(() => resolve({ status: 'expired' }));
      // Keep observing the actual operation after expiry; its owner must retain its own outcome.
      void operation.then(value => {
        if (done) return;
        try {
          if (this.remainingMs <= 0) expire();
          else finish(() => resolve({ status: 'completed', value }));
        } catch (error) { finish(() => reject(error)); }
      }, error => {
        if (done) return;
        try {
          if (this.remainingMs <= 0) expire();
          else finish(() => reject(error));
        } catch (clockError) { finish(() => reject(clockError)); }
      });
      try {
        const remaining = this.remainingMs;
        if (remaining <= 0) expire();
        else { timer = this.clock.schedule(remaining, expire); if (done) timer.cancel(); }
      } catch (error) { finish(() => reject(error)); }
    });
  }
}
