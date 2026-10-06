/** 持久 due/lease 时间采用 UTC epoch milliseconds，不持久化进程单调时钟值。 */
export interface JobClockPort { now(): number; }
