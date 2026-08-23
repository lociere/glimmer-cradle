import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildNativeRuntimeReadinessSnapshot,
  resolvePlatformNativeLibraryPath,
} from './native-package';

describe('native-package', () => {
  const previousOverride = process.env.GLIMMER_CRADLE_NATIVE_LIB;

  afterEach(() => {
    if (previousOverride === undefined) {
      delete process.env.GLIMMER_CRADLE_NATIVE_LIB;
    } else {
      process.env.GLIMMER_CRADLE_NATIVE_LIB = previousOverride;
    }
  });

  it('resolves override library path when environment variable is set', () => {
    const tempFile = path.join(os.tmpdir(), `platform-native-${Date.now()}.dll`);
    fs.writeFileSync(tempFile, '');
    process.env.GLIMMER_CRADLE_NATIVE_LIB = tempFile;

    expect(resolvePlatformNativeLibraryPath()).toBe(tempFile);

    const snapshot = buildNativeRuntimeReadinessSnapshot();
    expect(snapshot.reconciler?.actual).toBe('override-library');
    expect(snapshot.reconciler?.resources.find((resource) => resource.resource_id === 'native.library')?.readiness).toBe('ready');
    expect(snapshot.reconciler?.resources.some((resource) => resource.resource_id === 'native.ffi-runtime')).toBe(false);

    fs.unlinkSync(tempFile);
  });
});
