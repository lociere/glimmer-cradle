/** Kernel composition 的基础设施绑定。 */
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import * as readline from 'node:readline';
import fs from 'fs-extra';
import { ConfigManager } from '../adapters/config/config-manager';
import { EndpointRegistry } from '../adapters/endpoints/endpoint-registry';
import { DeadLetterQueue } from '../adapters/events/dead-letter-queue';
import { EventBus } from '../adapters/events/event-bus';
import {
  closeLogger, getLogger, initLogger,
} from '../adapters/observability/logger';
import { counter, histogram, startMetrics, stopMetrics } from '../adapters/observability/metrics';
import { span } from '../adapters/observability/telemetry';
import { createTraceContext, getCurrentTraceId, newTraceId, withTrace } from '../adapters/observability/trace-context';
import { startTracer, stopTracer } from '../adapters/observability/tracer';
import {
  resolveCachePath, resolveConfigDir, resolveConfigPath, resolveConfiguredProjectPath,
  resolveDataDir, resolveLogDir, resolveObservabilityDir, resolveRepoRoot, resolveStateDir, resolveStatePath, resolveWorkDir,
} from '../adapters/filesystem/path-utils';
import {
  appendAuditRecord, OBSERVABILITY_EVENT_TYPES, recordObservabilityEvent,
} from '../adapters/observability/plane/plane';
import {
  countFilesByExtension, inspectRuntimeDirectoryResource, inspectRuntimeFileResource,
  inspectRuntimeResource, mapRuntimeResourceStateToReadinessState,
} from '../adapters/filesystem/resource-resolver';
import {
  forceTerminateManagedProcessTree, stopManagedProcess, waitForManagedProcessExit,
} from '../adapters/process/process-supervisor';
import { DBManager } from '../adapters/storage/db-manager';
import { ExtensionStorageRepository } from '../adapters/storage/repositories/extension-storage-repository';
import { ExtensionDependencyInstaller } from '../adapters/extension-host/extension-dependency-installer';
import { ManagedResourceSupervisor } from '../adapters/extension-host/managed-resource-supervisor';
import { ExtensionProcessHost } from '../adapters/extension-host/extension-process-host';
import { ExtensionPackageManager } from '../adapters/extension-installation/extension-package-manager';
import { CognitionClient } from '../adapters/cognition/cognition-client';
import { KernelCognitionTransport } from '../adapters/cognition/kernel-cognition-transport';
import { DlqReplayIngress } from '../adapters/events/dlq-replay-ingress';
import { createLifeClockReplayAdapter } from '../adapters/organism/life-clock-replay-adapter';
import { installKernelSideEffectPorts } from '../ports/kernel-side-effects.port';

let installed = false;

export function installKernelCompositionPorts(): void {
  if (installed) return;
  installKernelSideEffectPorts({
    ConfigManager, EndpointRegistry, DeadLetterQueue, EventBus, DBManager,
    ExtensionStorageRepository, ExtensionDependencyInstaller, ExtensionPackageManager,
    ManagedResourceSupervisor, ExtensionProcessHost,
    CognitionClient, KernelCognitionTransport, DlqReplayIngress, createLifeClockReplayAdapter,
    closeLogger, getLogger, initLogger, counter, histogram, span, startMetrics, stopMetrics,
    createTraceContext, getCurrentTraceId, newTraceId, withTrace, startTracer, stopTracer,
    resolveCachePath, resolveConfigDir, resolveConfigPath, resolveConfiguredProjectPath, resolveDataDir,
    resolveLogDir, resolveObservabilityDir, resolveRepoRoot, resolveStateDir, resolveStatePath, resolveWorkDir,
    appendAuditRecord, OBSERVABILITY_EVENT_TYPES, recordObservabilityEvent,
    countFilesByExtension, inspectRuntimeDirectoryResource,
    inspectRuntimeFileResource, inspectRuntimeResource, mapRuntimeResourceStateToReadinessState,
    forceTerminateManagedProcessTree, stopManagedProcess, waitForManagedProcessExit,
    path, fs, nodeFs, spawn, execFile, promisify, readline, randomUUID, createHash,
    mkdir: nodeFs.mkdir, readFile: nodeFs.readFile, writeFile: nodeFs.writeFile, pathToFileURL,
  });
  installed = true;
}
