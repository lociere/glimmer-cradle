import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigManager } from './config-manager';

const originalConfigRoot = process.env.GLIMMER_CRADLE_CONFIG_ROOT;

afterEach(() => {
  if (originalConfigRoot === undefined) delete process.env.GLIMMER_CRADLE_CONFIG_ROOT;
  else process.env.GLIMMER_CRADLE_CONFIG_ROOT = originalConfigRoot;
  (ConfigManager as unknown as { _instance: ConfigManager | null })._instance = null;
});

describe('ConfigManager active extension selections', () => {
  it('rejects active selections without an explicit activation profile', async () => {
    const configRoot = mkdtempSync(path.join(tmpdir(), 'gc-active-extensions-'));
    process.env.GLIMMER_CRADLE_CONFIG_ROOT = configRoot;
    mkdirSync(path.join(configRoot, 'extensions'), { recursive: true });
    writeFileSync(path.join(configRoot, 'extensions', 'active.yaml'), `
active:
  - id: lociere.test-adapter
    version: 1.0.0
`, 'utf8');

    await expect(ConfigManager.instance.loadActiveExtensions()).rejects.toThrow(/id\/version\/profile 非法/);
  });
});
