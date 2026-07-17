import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  resolveConfigDir,
  resolveConfiguredProjectPath,
  resolveDataDir,
  resolveRepoRoot,
  resolveRunDir,
} from './path-utils';

const originalAppRoot = process.env.GLIMMER_CRADLE_APP_ROOT;
const originalConfigRoot = process.env.GLIMMER_CRADLE_CONFIG_ROOT;
const originalDataRoot = process.env.GLIMMER_CRADLE_DATA_ROOT;
const originalRunRoot = process.env.GLIMMER_CRADLE_RUN_ROOT;

afterEach(() => {
  restoreEnvironment('GLIMMER_CRADLE_APP_ROOT', originalAppRoot);
  restoreEnvironment('GLIMMER_CRADLE_CONFIG_ROOT', originalConfigRoot);
  restoreEnvironment('GLIMMER_CRADLE_DATA_ROOT', originalDataRoot);
  restoreEnvironment('GLIMMER_CRADLE_RUN_ROOT', originalRunRoot);
});

describe('Local Data Domain path precedence', () => {
  it('uses explicit immutable app and writable config roots in packaged products', () => {
    const appRoot = path.resolve('build/test-app');
    const configRoot = path.resolve('build/test-config');
    process.env.GLIMMER_CRADLE_APP_ROOT = appRoot;
    process.env.GLIMMER_CRADLE_CONFIG_ROOT = configRoot;

    expect(resolveRepoRoot()).toBe(appRoot);
    expect(resolveConfigDir()).toBe(configRoot);
    expect(resolveConfigDir(path.resolve('build/another-app-root'))).toBe(configRoot);
  });

  it('uses the deployment-owned data root for every data-relative path', () => {
    const deploymentRoot = path.resolve('build/test-data/deployment');
    process.env.GLIMMER_CRADLE_DATA_ROOT = deploymentRoot;

    expect(resolveDataDir()).toBe(deploymentRoot);
    expect(resolveConfiguredProjectPath('data/state'))
      .toBe(path.join(deploymentRoot, 'state'));
  });

  it('uses the product-owned coordination root when explicitly provided', () => {
    const runRoot = path.resolve('build/test-data/run');
    process.env.GLIMMER_CRADLE_RUN_ROOT = runRoot;

    expect(resolveRunDir()).toBe(runRoot);
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
