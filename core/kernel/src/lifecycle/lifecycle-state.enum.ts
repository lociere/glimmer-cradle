/**
 * 应用生命周期状态枚举
 */
export enum AppLifecycleState {
  UNINITIALIZED = "uninitialized",
  INITIALIZING = "initializing",
  INITIALIZED = "initialized",
  STARTING = "starting",
  RUNNING = "running",
  SLEEPING = "sleeping",
  STOPPING = "stopping",
  STOPPED = "stopped",
  ERROR = "error",
}
