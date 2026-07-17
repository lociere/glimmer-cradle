import fs from 'node:fs';
import path from 'node:path';
import type { RuntimeReadinessSnapshot } from './runtime-readiness';
import type { RuntimeResourceSnapshot, RuntimeResourceState } from './runtime-reconciler';

export type RuntimeResourceKind = 'file' | 'directory';

export interface RuntimeResourceProbeOptions {
  readonly resourceId: string;
  readonly resourceKind: string;
  readonly path: string;
  readonly label: string;
  readonly kind: RuntimeResourceKind;
  readonly desiredState?: RuntimeResourceState;
  readonly missingState?: RuntimeResourceState;
  readonly recoveryActions?: readonly string[];
}

export function inspectRuntimeResource(options: RuntimeResourceProbeOptions): RuntimeResourceSnapshot {
  const exists = isExpectedPath(options.path, options.kind);
  const desiredState = options.desiredState ?? 'ready';
  const missingState = options.missingState ?? 'missing';
  return {
    resource_id: options.resourceId,
    resource_kind: options.resourceKind,
    desired_state: desiredState,
    actual_state: exists ? desiredState : missingState,
    readiness: exists ? desiredState : missingState,
    summary: exists
      ? `${options.label} 已就绪`
      : `${options.label} 缺失: ${options.path || '<unset>'}`,
    recovery_actions: exists ? [] : [...(options.recoveryActions ?? [`检查 ${options.path || '<unset>'} 是否已安装或生成。`])],
  };
}

export function inspectRuntimeFileResource(
  options: Omit<RuntimeResourceProbeOptions, 'kind'>,
): RuntimeResourceSnapshot {
  return inspectRuntimeResource({ ...options, kind: 'file' });
}

export function inspectRuntimeDirectoryResource(
  options: Omit<RuntimeResourceProbeOptions, 'kind'>,
): RuntimeResourceSnapshot {
  return inspectRuntimeResource({ ...options, kind: 'directory' });
}

export function mapRuntimeResourceStateToReadinessState(
  state: RuntimeResourceSnapshot['readiness'],
): RuntimeReadinessSnapshot['state'] {
  switch (state) {
    case 'ready':
      return 'ready';
    case 'failed':
      return 'failed';
    case 'missing':
    case 'degraded':
      return 'degraded';
    case 'pending':
    case 'unknown':
    default:
      return 'starting';
  }
}

export function countFilesByExtension(
  directory: string,
  extensions: ReadonlySet<string>,
): number {
  if (!directory || !fs.existsSync(directory)) {
    return 0;
  }
  const stat = fs.statSync(directory);
  if (!stat.isDirectory()) {
    return 0;
  }

  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      count += countFilesByExtension(entryPath, extensions);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.size === 0 || extensions.has(ext)) {
        count += 1;
      }
    }
  }
  return count;
}

function isExpectedPath(resolvedPath: string, kind: RuntimeResourceKind): boolean {
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return false;
  }
  const stat = fs.statSync(resolvedPath);
  return kind === 'file' ? stat.isFile() : stat.isDirectory();
}
