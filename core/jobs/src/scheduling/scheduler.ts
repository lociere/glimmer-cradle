import type { JobController } from '../execution/job-controller.js';
import type { JobAdmissionPort } from '../execution/job-handler-port.js';
import type { JobClockPort } from '../ports/clock-port.js';
import type { JobStorePort } from '../ports/job-store-port.js';

/** Host 显式驱动一次 tick；进程计时器与生命周期由 App 拥有，不在 Core 偷开常驻任务。 */
export class JobScheduler {
  private cursor = '';
  private waiting = 0;
  public constructor(private readonly store: JobStorePort, private readonly controller: JobController,
    private readonly clock: JobClockPort, private readonly epoch: number,
    private readonly ownerId: string, private readonly leaseMs: number, private readonly kind?: string,
    private readonly admission?: JobAdmissionPort) {
    if (admission && (!kind || admission.kind !== kind)) throw new Error('Job admission kind 不匹配');
  }

  public get waitingCount(): number { return this.waiting; }

  public async runDue(limit: number, signal?: AbortSignal): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Job tick limit 无效');
    this.waiting = 0;
    signal?.throwIfAborted();
    if (this.controller.isAccepting) this.store.materializeDue(this.epoch, this.clock.now(), limit);
    let count = 0;
    if (this.admission && this.controller.isAccepting) {
      const page = this.store.listDue(this.epoch, this.kind!, this.clock.now(), limit, this.cursor);
      for (const job of page) {
        this.cursor = job.job_id;
        signal?.throwIfAborted();
        if (!this.controller.isAccepting) break;
        const eligible = await this.admission.isEligible(job, signal);
        signal?.throwIfAborted();
        if (!this.controller.isAccepting) break;
        if (eligible !== true) { this.waiting += 1; continue; }
        // 不跨接纳 await 持有事务；只 CAS 原候选，不能跳到另一个未经接纳的 Job。
        const claim = this.store.claim(this.epoch, this.ownerId, this.clock.now(), this.leaseMs, this.kind,
          { job_id: job.job_id, revision: job.revision });
        if (claim) { await this.controller.execute(claim); count += 1; }
      }
      if (page.length < limit) this.cursor = '';
      return count;
    }
    while (count < limit && this.controller.isAccepting) {
      signal?.throwIfAborted();
      const claim = this.store.claim(this.epoch, this.ownerId, this.clock.now(), this.leaseMs, this.kind);
      if (!claim) break;
      await this.controller.execute(claim);
      count += 1;
    }
    return count;
  }
}
