import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolvePackagedDesktopPaths } from '../src/main/packaged-paths.ts';
import { PackagedSupervisor } from '../src/main/packaged-supervisor.ts';

test('package→安装投影→正式 resolver/supervisor 首启 ready 并清理', async () => {
  const fixture = await createInstallProjection();
  try {
    const paths = await resolvePackagedDesktopPaths({
      resourcesPath: fixture.resources,
      userDataPath: fixture.userData,
    });
    assert.equal(await readFile(path.join(paths.configRoot, 'runtime.yaml'), 'utf8'), 'mode: packaged\n');
    const child = new FakeChild(4188);
    let launch: {
      command?: string;
      args?: string[];
      env?: NodeJS.ProcessEnv;
    } = {};
    const supervisor = new PackagedSupervisor(paths, {
      spawnChild: (command, args, options) => {
        launch = { command, args, env: options.env };
        return child;
      },
      probe: async () => 'ready',
      pollIntervalMs: 1,
      terminateTree: async (target) => {
        target.kill('SIGTERM');
      },
    });
    assert.equal((await supervisor.start()).state, 'ready');
    assert.equal(launch.command, paths.nodeExecutable);
    assert.deepEqual(launch.args, [paths.kernelEntry]);
    assert.equal(launch.env?.GLIMMER_CRADLE_PYTHON_RUNTIME, paths.pythonExecutable);
    assert.equal(launch.env?.GLIMMER_CRADLE_AVATAR_HOST_COMMAND, paths.avatarHostExecutable);
    assert.equal(launch.env?.GLIMMER_CRADLE_EXTENSION_MODULE_ROOT, paths.extensionModuleRoot);
    assert.equal(launch.env?.GLIMMER_CRADLE_PRODUCT_MANIFEST, paths.productManifest);
    assert.equal(launch.env?.GLIMMER_CRADLE_NATIVE_LIB, paths.nativeLibrary);
    assert.equal(
      JSON.parse(await readFile(
        path.join(paths.runRoot, 'desktop-supervisor.json'),
        'utf8',
      )).state,
      'ready',
    );
    await supervisor.stop();
    assert.equal(supervisor.getSnapshot().state, 'stopped');
    assert.equal(await lstat(
      path.join(paths.runRoot, 'desktop-supervisor.json'),
    ).catch(() => null), null);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('正式 supervisor 投影 degraded，并在缺运行组件时首启失败闭合', async () => {
  const fixture = await createInstallProjection();
  try {
    const paths = await resolvePackagedDesktopPaths({
      resourcesPath: fixture.resources,
      userDataPath: fixture.userData,
    });
    const child = new FakeChild(4199);
    const supervisor = new PackagedSupervisor(paths, {
      spawnChild: () => child,
      probe: async () => 'degraded',
      pollIntervalMs: 1,
      terminateTree: async (target) => {
        target.kill('SIGTERM');
      },
    });
    assert.equal((await supervisor.start()).state, 'degraded');
    await supervisor.stop();

    await rm(path.join(fixture.resources, 'runtime', 'python'), {
      recursive: true,
      force: true,
    });
    await assert.rejects(
      () => resolvePackagedDesktopPaths({
        resourcesPath: fixture.resources,
        userDataPath: path.join(fixture.root, 'second-user'),
      }),
      /runtime/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

class FakeChild extends EventEmitter {
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;

  public constructor(public readonly pid: number) {
    super();
  }

  public kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signalCode = signal;
    this.emit('exit', null, signal);
    return true;
  }
}

async function createInstallProjection(): Promise<{
  root: string;
  resources: string;
  userData: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-install-projection-'));
  const resources = path.join(root, 'resources');
  const userData = path.join(root, 'user-data');
  const files = new Map([
    ['runtime/node/node.exe', 'node'],
    ['runtime/python/Scripts/python.exe', 'python'],
    ['runtime/kernel/dist/index.js', 'kernel'],
    ['products/desktop/product.json', '{}'],
    ['components/avatar/unity-host/UnityAvatarHostLauncher.exe', 'avatar'],
    ['components/native/composition-host/platform_native.dll', 'native'],
    ['configs/defaults/runtime.yaml', 'mode: packaged\n'],
  ]);
  for (const [relative, content] of files) {
    const target = path.join(resources, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  await mkdir(path.join(resources, 'extension-host', 'modules'), { recursive: true });
  return { root, resources, userData };
}
