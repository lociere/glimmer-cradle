/**
 * Kernel 对宿主副作用的唯一输入面。
 *
 * Application 和 Runtime 只依赖这些端口名；具体 Node、文件、进程、传输和
 * 可观测性实现由 composition 在启动前绑定。这里故意不 import adapter，避免
 * 端口层反向看见实现层。
 */
export interface KernelSideEffectPorts {
  readonly [name: string]: any;
}

let installed: KernelSideEffectPorts | undefined;

export function installKernelSideEffectPorts(ports: KernelSideEffectPorts): void {
  installed = Object.freeze({ ...ports });
}

export function kernelSideEffectPorts(): KernelSideEffectPorts {
  if (!installed) throw new Error('Kernel composition 尚未绑定副作用 Ports');
  return installed;
}

function deferredPort(name: string): any {
  const target = function deferredKernelPort(...args: any[]): any {
    const implementation = kernelSideEffectPorts()[name];
    if (typeof implementation !== 'function') {
      throw new Error(`Kernel Port ${name} 不是可调用实现`);
    }
    return implementation(...args);
  };
  return new Proxy(target, {
    get(_target, property) {
      return Reflect.get(kernelSideEffectPorts()[name], property);
    },
    construct(_target, args) {
      return Reflect.construct(kernelSideEffectPorts()[name], args);
    },
    apply(_target, _thisArg, args) {
      const implementation = kernelSideEffectPorts()[name];
      return Reflect.apply(implementation, undefined, args);
    },
  });
}

// 这些导出是端口引用，不是 adapter re-export。保留现有调用形状，避免业务层为
// 一次物理收口承担无关行为改写；composition 是其唯一实现绑定点。
export const ConfigManager = deferredPort('ConfigManager');
export const EventBus = deferredPort('EventBus');
export const EndpointRegistry = deferredPort('EndpointRegistry');
export const DBManager = deferredPort('DBManager');
export const DeadLetterQueue = deferredPort('DeadLetterQueue');
export const ExtensionStorageRepository = deferredPort('ExtensionStorageRepository');
export const ExtensionDependencyInstaller = deferredPort('ExtensionDependencyInstaller');
export const ExtensionPackageManager = deferredPort('ExtensionPackageManager');
export const ManagedResourceSupervisor = deferredPort('ManagedResourceSupervisor');
export const ExtensionProcessHost = deferredPort('ExtensionProcessHost');
export const CognitionClient = deferredPort('CognitionClient');
export const KernelCognitionTransport = deferredPort('KernelCognitionTransport');
export const DlqReplayIngress = deferredPort('DlqReplayIngress');
export const createLifeClockReplayAdapter = deferredPort('createLifeClockReplayAdapter');
export const getLogger = deferredPort('getLogger');
export const initLogger = deferredPort('initLogger');
export const closeLogger = deferredPort('closeLogger');
export const createTraceContext = deferredPort('createTraceContext');
export const withTrace = deferredPort('withTrace');
export const getCurrentTraceId = deferredPort('getCurrentTraceId');
export const newTraceId = deferredPort('newTraceId');
export const histogram = deferredPort('histogram');
export const counter = deferredPort('counter');
export const span = deferredPort('span');
export const startMetrics = deferredPort('startMetrics');
export const stopMetrics = deferredPort('stopMetrics');
export const startTracer = deferredPort('startTracer');
export const stopTracer = deferredPort('stopTracer');
export const resolveConfigPath = deferredPort('resolveConfigPath');
export const resolveConfiguredProjectPath = deferredPort('resolveConfiguredProjectPath');
export const resolveRepoRoot = deferredPort('resolveRepoRoot');
export const resolveLogDir = deferredPort('resolveLogDir');
export const resolveObservabilityDir = deferredPort('resolveObservabilityDir');
export const resolveWorkDir = deferredPort('resolveWorkDir');
export const resolveCachePath = deferredPort('resolveCachePath');
export const resolveConfigDir = deferredPort('resolveConfigDir');
export const resolveDataDir = deferredPort('resolveDataDir');
export const resolveStateDir = deferredPort('resolveStateDir');
export const resolveStatePath = deferredPort('resolveStatePath');
export const appendAuditRecord = deferredPort('appendAuditRecord');
export const recordObservabilityEvent = deferredPort('recordObservabilityEvent');
export const OBSERVABILITY_EVENT_TYPES = deferredPort('OBSERVABILITY_EVENT_TYPES');
export const inspectRuntimeResource = deferredPort('inspectRuntimeResource');
export const inspectRuntimeFileResource = deferredPort('inspectRuntimeFileResource');
export const inspectRuntimeDirectoryResource = deferredPort('inspectRuntimeDirectoryResource');
export const mapRuntimeResourceStateToReadinessState = deferredPort('mapRuntimeResourceStateToReadinessState');
export const countFilesByExtension = deferredPort('countFilesByExtension');
export const forceTerminateManagedProcessTree = deferredPort('forceTerminateManagedProcessTree');
export const stopManagedProcess = deferredPort('stopManagedProcess');
export const waitForManagedProcessExit = deferredPort('waitForManagedProcessExit');
export const path = deferredPort('path');
export const fs = deferredPort('fs');
export const nodeFs = deferredPort('nodeFs');
export const spawn = deferredPort('spawn');
export const execFile = deferredPort('execFile');
export const promisify = deferredPort('promisify');
export const readline = deferredPort('readline');
export const randomUUID = deferredPort('randomUUID');
export const createHash = deferredPort('createHash');
export const mkdir = deferredPort('mkdir');
export const readFile = deferredPort('readFile');
export const writeFile = deferredPort('writeFile');
export const pathToFileURL = deferredPort('pathToFileURL');

export type GlobalConfig = any;
export type ChildProcess = any;
export type ChildProcessWithoutNullStreams = any;
export type AddressInfo = any;
export type RawData = any;
export type ExtensionInstallPreview = any;
export type ExtensionInstallResult = any;
export type ExtensionInstallSource = any;
export type ExtensionProcessHost = any;
export type ExtensionPackageManager = any;
