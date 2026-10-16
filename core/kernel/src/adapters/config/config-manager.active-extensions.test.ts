import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { ConfigManager } from './config-manager';

const originalConfigRoot = process.env.GLIMMER_CRADLE_CONFIG_ROOT;
const originalDashScopeKey = process.env.DASHSCOPE_API_KEY;
const ownedRoots = new Set<string>();
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('../observability/logger', () => ({ getLogger: () => logger }));

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'gc-config-snapshot-'));
  ownedRoots.add(root);
  return root;
}

function configurationFixture(): string {
  const root = temporaryRoot(), templates = path.resolve(__dirname, '../../../../../configs');
  for (const [directory, files] of [
    ['system', ['identity.yaml', 'kernel.yaml', 'avatar.yaml', 'surfaces.yaml', 'skills.yaml', 'memory.yaml', 'observability.yaml', 'audio.yaml', 'embedding.yaml']],
    ['characters/selrena', ['character.manifest.yaml', 'profile.yaml', 'dialogue.yaml', 'safety.yaml', 'inference.yaml', 'voice.yaml', 'providers.yaml', 'knowledge/index.yaml']],
  ] as const) {
    for (const file of files) {
      const target = path.join(root, directory, file);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(templates, directory, file), target);
    }
  }
  process.env.GLIMMER_CRADLE_CONFIG_ROOT = root;
  return root;
}

function holdSystemRead(manager: ConfigManager) {
  const reader = manager as unknown as { loadSystemConfigData(): Promise<Record<string, unknown>> };
  const actualRead = reader.loadSystemConfigData.bind(manager);
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { arrived = resolve; });
  const read = vi.spyOn(reader, 'loadSystemConfigData').mockImplementation(async () => { arrived(); await gate; return actualRead(); });
  return { release, read, entered };
}

function setStartupBudget(root: string, milliseconds: number): void {
  const file = path.join(root, 'system/kernel.yaml');
  const document = yaml.parse(readFileSync(file, 'utf8'));
  document.lifecycle.start_timeout_ms = milliseconds;
  writeFileSync(file, yaml.stringify(document), 'utf8');
}

afterEach(() => {
  if (originalConfigRoot === undefined) delete process.env.GLIMMER_CRADLE_CONFIG_ROOT;
  else process.env.GLIMMER_CRADLE_CONFIG_ROOT = originalConfigRoot;
  if (originalDashScopeKey === undefined) delete process.env.DASHSCOPE_API_KEY;
  else process.env.DASHSCOPE_API_KEY = originalDashScopeKey;
  (ConfigManager as unknown as { _instance: ConfigManager | null })._instance = null;
  vi.restoreAllMocks();
  Object.values(logger).forEach(method => method.mockReset());
  for (const root of ownedRoots) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('gc-config-snapshot-')) throw new Error('拒绝清理非测试目录');
    rmSync(root, { recursive: true, force: true });
  }
  ownedRoots.clear();
});

describe('ConfigManager active extension selections', () => {
  it('normalizes the complete canonical Cognition document defaults', async () => {
    configurationFixture();

    await ConfigManager.instance.init();

    expect(ConfigManager.instance.getConfig().system.cognition).toEqual({
      workspace_capacity: 7,
      default_tick_interval_ms: 5000,
    });
  });

  it('rejects active selections without an explicit activation profile', async () => {
    const configRoot = temporaryRoot();
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

describe('ConfigManager atomic configuration snapshots', () => {
  it('concurrent initial callers join one actual load and publish one deeply immutable snapshot', async () => {
    configurationFixture();
    const manager = ConfigManager.instance, held = holdSystemRead(manager);
    const first = manager.init(), second = manager.init();
    try {
      expect(second).toBe(first);
      await held.entered;
      expect(held.read).toHaveBeenCalledOnce();
      expect(() => manager.getConfig()).toThrow('未初始化');
      held.release(); await Promise.all([first, second]);
      const snapshot = manager.getConfig();
      expect(Object.isFrozen(snapshot.system.lifecycle)).toBe(true);
      expect(Object.isFrozen(snapshot.character.llm)).toBe(true);
      expect(Reflect.set(snapshot.system.lifecycle, 'start_timeout_ms', 1)).toBe(false);
    } finally { held.release(); await Promise.allSettled([first, second]); }
  });

  it('reload keeps the accepted snapshot readable until one complete candidate replaces it', async () => {
    const root = configurationFixture(), manager = ConfigManager.instance;
    await manager.init(); manager.freezeCoreConfig();
    const previous = manager.getConfig(), held = holdSystemRead(manager);
    setStartupBudget(root, 45000);
    const reloading = manager.reloadConfig(), second = manager.reloadConfig(), initialization = manager.init();
    try {
      await held.entered;
      expect(manager.getConfig()).toBe(previous);
      expect(second).toBe(reloading); expect(initialization).toBe(reloading);
      expect(held.read).toHaveBeenCalledOnce();
      held.release(); await Promise.all([reloading, second, initialization]);
      const next = manager.getConfig();
      expect(next).not.toBe(previous); expect(next.system.lifecycle.start_timeout_ms).toBe(45000);
      expect(previous.system.lifecycle.start_timeout_ms).toBe(30000);
      expect(Object.isFrozen(next.system.lifecycle)).toBe(true); expect(Object.isFrozen(next.character.llm)).toBe(true);
    } finally { held.release(); await Promise.allSettled([reloading, second, initialization]); }
  });

  it('an invalid candidate leaves the exact accepted snapshot in place, and a later corrected load can succeed', async () => {
    const root = configurationFixture(), manager = ConfigManager.instance;
    await manager.init();
    const previous = manager.getConfig(); setStartupBudget(root, 0);
    await expect(manager.reloadConfig()).rejects.toThrow('配置校验失败');
    expect(manager.getConfig()).toBe(previous);
    expect(previous.system.lifecycle.start_timeout_ms).toBe(30000);
    setStartupBudget(root, 45000); await manager.reloadConfig();
    expect(manager.getConfig()).not.toBe(previous); expect(manager.getConfig().system.lifecycle.start_timeout_ms).toBe(45000);
    expect(Object.isFrozen(manager.getConfig().system.lifecycle)).toBe(true);
  });

  it('candidate and diagnostic failures are both retained without clearing the accepted snapshot', async () => {
    const root = configurationFixture(), manager = ConfigManager.instance;
    await manager.init();
    const previous = manager.getConfig(); setStartupBudget(root, 0);
    const diagnostic = new Error('diagnostic unavailable');
    logger.error.mockImplementation(() => { throw diagnostic; });
    await expect(manager.reloadConfig()).rejects.toMatchObject({ errors: [
      expect.objectContaining({ message: expect.stringContaining('配置校验失败') }), diagnostic,
    ] });
    expect(manager.getConfig()).toBe(previous);
    logger.error.mockReset(); setStartupBudget(root, 45000); await manager.reloadConfig();
    expect(manager.getConfig().system.lifecycle.start_timeout_ms).toBe(45000);
  });
});

describe('ConfigManager YAML diagnostic boundaries', () => {
  const marker = 'fixture-private-yaml-marker';
  const diagnostics = () => JSON.stringify(Object.values(logger).flatMap(method => method.mock.calls));

  it.each(['required', 'active', 'llm-secret', 'environment-secret'])('%s malformed YAML never reaches diagnostics as source text', async mode => {
    const root = configurationFixture(), manager = ConfigManager.instance;
    delete process.env.DASHSCOPE_API_KEY;
    if (mode === 'required') {
      await manager.init(); const previous = manager.getConfig();
      writeFileSync(path.join(root, 'system/kernel.yaml'), `lifecycle: [${marker}\n`, 'utf8');
      const failure = await manager.reloadConfig().then(() => undefined, error => error as Error);
      expect(failure).toBeInstanceOf(Error); expect(String(failure)).not.toContain(marker);
      expect(manager.getConfig()).toBe(previous);
    } else if (mode === 'active') {
      mkdirSync(path.join(root, 'extensions'), { recursive: true });
      writeFileSync(path.join(root, 'extensions/active.yaml'), `active: [${marker}\n`, 'utf8');
      const failure = await manager.loadActiveExtensions().then(() => undefined, error => error as Error);
      expect(failure).toMatchObject({ code: 'CONFIG_ERROR' }); expect(String(failure)).not.toContain(marker);
    } else {
      mkdirSync(path.join(root, 'secrets'), { recursive: true });
      writeFileSync(path.join(root, 'secrets/secrets.yaml'), `providers: [${marker}\n`, 'utf8');
      if (mode === 'llm-secret') { await manager.init(); expect(manager.getConfig()).toBeDefined(); }
      else expect(await manager.loadDashScopeSecretEnvironment()).toEqual({});
      expect(logger.warn).toHaveBeenCalled();
    }
    expect(diagnostics()).not.toContain(marker);
  });

  it('valid optional secrets retain explicit injection behavior without logging their values', async () => {
    const root = configurationFixture(), manager = ConfigManager.instance;
    delete process.env.DASHSCOPE_API_KEY;
    const key = 'fixture-only-secret-value';
    mkdirSync(path.join(root, 'secrets'), { recursive: true });
    writeFileSync(path.join(root, 'characters/selrena/providers.yaml'), 'api_type: openai\n', 'utf8');
    writeFileSync(path.join(root, 'secrets/secrets.yaml'), yaml.stringify({ providers: { openai: { api_key: key }, qwen: { api_key: key } } }), 'utf8');
    await manager.init();
    expect(manager.getConfig().character.llm?.api_key).toBe(key);
    expect(await manager.loadDashScopeSecretEnvironment()).toEqual({ DASHSCOPE_API_KEY: key });
    expect(diagnostics()).not.toContain(key);
  });

  it('accepted YAML warnings cannot bypass diagnostic redaction through process.emitWarning', async () => {
    const root = configurationFixture(), manager = ConfigManager.instance;
    delete process.env.DASHSCOPE_API_KEY;
    const emitted = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    mkdirSync(path.join(root, 'secrets'), { recursive: true });
    writeFileSync(path.join(root, 'secrets/secrets.yaml'), `providers: !${marker} { qwen: { api_key: fixture-key } }\n`, 'utf8');
    expect(await manager.loadDashScopeSecretEnvironment()).toEqual({ DASHSCOPE_API_KEY: 'fixture-key' });
    expect(logger.warn).toHaveBeenCalledWith('配置 YAML 解析存在警告', { warning_count: 1 });
    expect(emitted.mock.calls.map(([warning]) => String(warning)).join('\n')).not.toContain(marker);
    expect(diagnostics()).not.toContain(marker);
  });
});
