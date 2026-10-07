import { ExecutionConflictError, executionDigest, executionJson } from './invocation.js';
import type { ExecutionJournal, ExecutionResultEvent, ExecutionResultReceipt } from './execution-journal.js';

export interface ExecutionResultReceiverPort {
  accept(event: ExecutionResultEvent, signal?: AbortSignal): Promise<ExecutionResultReceipt>;
}

/** 只发布已提交结果，实际接纳后才 ACK；取消/断线不能令执行器重新派发。 */
export class ExecutionResultOutbox {
  private readonly active = new Set<Promise<boolean>>();
  private stopped = false;
  public constructor(private readonly journal: ExecutionJournal, private readonly receiver: ExecutionResultReceiverPort,
    private readonly now: () => number = Date.now) {}
  public publish(event: ExecutionResultEvent, signal?: AbortSignal): Promise<boolean> {
    if (this.stopped) return Promise.reject(new Error('Execution outbox 已停止接纳'));
    const promise = this.publishOne(event, signal).finally(() => this.active.delete(promise));
    this.active.add(promise);
    return promise;
  }
  public async stop(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled([...this.active]);
  }
  private async publishOne(event: ExecutionResultEvent, signal?: AbortSignal): Promise<boolean> {
    if (!event.invocation.interaction) return false;
    signal?.throwIfAborted();
    const actual = this.journal.load(event.invocation.invocation_id);
    if (!actual || !['succeeded', 'failed', 'unknown'].includes(actual.state)
      || executionDigest([actual.invocation_id, actual.revision]) !== event.event_id
      || executionJson(actual) !== executionJson(event.invocation)) throw new ExecutionConflictError('Execution 投递不是已提交结果');
    const receipt = await this.receiver.accept(event, signal);
    if (receipt.accepted !== true || receipt.event_id !== event.event_id || receipt.invocation_id !== event.invocation.invocation_id
      || receipt.revision !== event.invocation.revision) throw new ExecutionConflictError('Execution 接纳 receipt identity 冲突');
    signal?.throwIfAborted();
    return this.journal.acknowledgeOutbox(receipt, this.now());
  }
  public async deliverPending(limit: number, signal?: AbortSignal): Promise<{ delivered: number; failed: number }> {
    if (this.stopped) throw new Error('Execution outbox 已停止接纳');
    let delivered = 0; let failed = 0;
    for (const event of this.journal.readOutbox(limit, true)) {
      signal?.throwIfAborted();
      try { if (await this.publish(event, signal)) delivered++; }
      catch { signal?.throwIfAborted(); failed++; }
    }
    return { delivered, failed };
  }
}
