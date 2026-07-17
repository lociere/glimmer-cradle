import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  countFilesByExtension,
  inspectRuntimeDirectoryResource,
  inspectRuntimeFileResource,
  mapRuntimeResourceStateToReadinessState,
} from './resource-resolver';

let tmpDir = '';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glimmer-resource-resolver-'));
});

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('resource-resolver', () => {
  it('projects file and directory readiness without exposing caller-specific logic', () => {
    const filePath = path.join(tmpDir, 'model.bin');
    fs.writeFileSync(filePath, 'model');

    expect(inspectRuntimeFileResource({
      resourceId: 'test.file',
      resourceKind: 'model_file',
      path: filePath,
      label: '测试模型',
    })).toMatchObject({
      resource_id: 'test.file',
      actual_state: 'ready',
      readiness: 'ready',
      recovery_actions: [],
    });

    expect(inspectRuntimeDirectoryResource({
      resourceId: 'test.dir',
      resourceKind: 'model_directory',
      path: tmpDir,
      label: '测试目录',
    })).toMatchObject({
      resource_id: 'test.dir',
      actual_state: 'ready',
      readiness: 'ready',
      recovery_actions: [],
    });
  });

  it('returns stable missing snapshots and caller recovery actions', () => {
    const missingPath = path.join(tmpDir, 'missing');

    expect(inspectRuntimeFileResource({
      resourceId: 'test.missing',
      resourceKind: 'model_file',
      path: missingPath,
      label: '缺失模型',
      recoveryActions: ['安装测试模型。'],
    })).toMatchObject({
      resource_id: 'test.missing',
      actual_state: 'missing',
      readiness: 'missing',
      summary: `缺失模型 缺失: ${missingPath}`,
      recovery_actions: ['安装测试模型。'],
    });
  });

  it('counts package artifacts recursively by extension', () => {
    fs.mkdirSync(path.join(tmpDir, 'nested'));
    fs.writeFileSync(path.join(tmpDir, 'a.unitypackage'), '');
    fs.writeFileSync(path.join(tmpDir, 'nested', 'b.tgz'), '');
    fs.writeFileSync(path.join(tmpDir, 'nested', 'c.txt'), '');

    expect(countFilesByExtension(tmpDir, new Set(['.unitypackage', '.tgz']))).toBe(2);
  });

  it('maps missing and degraded resource states to degraded runtime readiness', () => {
    expect(mapRuntimeResourceStateToReadinessState('ready')).toBe('ready');
    expect(mapRuntimeResourceStateToReadinessState('missing')).toBe('degraded');
    expect(mapRuntimeResourceStateToReadinessState('failed')).toBe('failed');
  });
});
