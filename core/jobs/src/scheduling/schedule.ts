/** 持久时间采用 UTC epoch milliseconds；calendar/timezone 转换由请求方明确完成。 */
export type JobSchedule =
  | { readonly kind: 'once'; readonly due_at: number }
  | { readonly kind: 'interval'; readonly start_at: number; readonly every_ms: number; readonly catch_up: 'all' | 'latest' };

export function initialScheduleDue(schedule: JobSchedule): number {
  const start = schedule.kind === 'once' ? schedule.due_at : schedule.start_at;
  if (!Number.isSafeInteger(start) || start < 0 || !['once', 'interval'].includes(schedule.kind)) {
    throw new Error('Job schedule 起点无效');
  }
  if (schedule.kind === 'interval' && (!Number.isSafeInteger(schedule.every_ms) || schedule.every_ms < 1
    || !['all', 'latest'].includes(schedule.catch_up))) throw new Error('Job interval policy 无效');
  return start;
}

export function scheduledOccurrence(schedule: JobSchedule, nextDue: number, now: number): { due_at: number; next_due_at: number | null } {
  const start = initialScheduleDue(schedule);
  if (!Number.isSafeInteger(now) || now < nextDue || !Number.isSafeInteger(nextDue) || nextDue < start) {
    throw new Error('Job schedule checkpoint 无效');
  }
  if (schedule.kind === 'once') {
    if (nextDue !== start) throw new Error('Job once checkpoint 无效');
    return { due_at: start, next_due_at: null };
  }
  if ((nextDue - start) % schedule.every_ms !== 0) throw new Error('Job interval checkpoint 未对齐');
  const due = schedule.catch_up === 'latest'
    ? start + Math.floor((now - start) / schedule.every_ms) * schedule.every_ms : nextDue;
  const next = due + schedule.every_ms;
  if (!Number.isSafeInteger(due) || !Number.isSafeInteger(next)) throw new Error('Job interval 时间溢出');
  return { due_at: due, next_due_at: next };
}
