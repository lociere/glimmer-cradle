const nativeAssert = require('node:assert/strict');
const nativeTest = require('node:test');
const nativePath = require('node:path');
const nativeFs = require('node:fs');
const { spawn: nativeSpawn, fork: nativeFork } = require('node:child_process') as typeof import('node:child_process');
const nativeBridge = nativePath.resolve(__dirname, '../../../build/components/native/composition-host/windows-x64/PlatformProcessTreeBridge.exe');
const nativeFaultBridge = nativePath.resolve(__dirname, '../../../build/native/platform-process-tree-bridge/windows-x64/bin/Release/PlatformProcessTreeBridgeTest.exe');
const windowsOnly = { skip: process.platform !== 'win32', timeout: 15000 };
type NativeReceipt = { event: string; code: number; pid: number; active: number };
function observeNative(child: import('node:child_process').ChildProcess, legacy = false) {
  const control = (legacy ? child.stdout : child.stdio[4]) as import('node:stream').Duplex;
  let buffer = Buffer.alloc(0);
  const frames: NativeReceipt[] = [];
  let wake: (() => void) | undefined;
  let stdout = '';
  if (!legacy) child.stdout!.on('data', bytes => { stdout += bytes.toString(); });
  child.stderr!.resume();
  control.on('data', bytes => {
    buffer = Buffer.concat([buffer, bytes]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      const size = buffer.readUInt32LE(0);
      nativeAssert.ok(size <= 1024 * 1024);
      const body = buffer.subarray(4, 4 + size);
      const length = body.readUInt32LE(4);
      frames.push({ event: body.subarray(8, 8 + length).toString(), code: body.readUInt32LE(0), pid: body.readUInt32LE(8 + length), active: body.readUInt32LE(12 + length) });
      buffer = buffer.subarray(4 + size);
    }
    wake?.();
  });
  const closed = new Promise<void>((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  async function receipt(event: string): Promise<NativeReceipt> {
    const deadline = Date.now() + 8000;
    for (;;) {
      const found = frames.find(frame => frame.event === event);
      if (found) return found;
      if (Date.now() >= deadline) throw new Error('native receipt missing: ' + event);
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { wake = undefined; resolve(); }, 25);
        wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
      });
    }
  }
  function terminate(budget = 5000) { const frame = Buffer.alloc(8); frame.writeUInt32LE(2, 0); frame.writeUInt32LE(budget, 4); control.write(frame); }
  async function cleanup() {
    if (child.exitCode == null && child.signalCode == null) {
      if (legacy) child.stdin!.end();
      else if (!control.destroyed) terminate();
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]);
      clearTimeout(timer);
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
    }
    await closed;
  }
  return { frames, receipt, terminate, cleanup, closed, control, stdout: () => stdout };
}
function launchNative(code: string, fault?: string, bridge = nativeBridge) {
  nativeAssert.equal(nativeFs.existsSync(bridge), true, 'build:native must produce the selected Platform bridge');
  return nativeSpawn(bridge, ['--managed-launch', process.execPath, '-e', code], { env: { ...process.env, GLIMMER_TEST_PROCESS_TREE_FAULT: fault }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
}
nativeTest('Windows suspended launch preserves FD3 and excludes the private control descriptor', windowsOnly, async () => {
  const child = launchNative("const fs=require('fs');const b=Buffer.alloc(64);const n=fs.readSync(3,b,0,64,null);let privateOpen=false;try{fs.fstatSync(4);privateOpen=true;}catch{}console.log(JSON.stringify({pid:process.pid,input:b.subarray(0,n).toString(),privateOpen}));");
  const observed = observeNative(child);
  (child.stdio[3] as import('node:stream').Writable).end('bootstrap-fixture');
  try {
    const ready = await observed.receipt('managed.ready');
    const released = await observed.receipt('managed.released');
    await observed.closed;
    const output = JSON.parse(observed.stdout());
    nativeAssert.equal(output.pid, ready.pid);
    nativeAssert.notEqual(output.pid, child.pid);
    nativeAssert.equal(output.input, 'bootstrap-fixture');
    nativeAssert.equal(output.privateOpen, false);
    nativeAssert.equal(released.active, 0);
  } finally { await observed.cleanup(); }
});
nativeTest('Windows fork IPC reaches the real root and disconnects without a wrapper FD3 duplicate', windowsOnly, async () => {
  const folder = nativeFs.mkdtempSync(nativePath.join(require('node:os').tmpdir(), 'glimmer-native-ipc-'));
  const entry = nativePath.join(folder, 'root.cjs');
  nativeFs.writeFileSync(entry, "process.on('message',value=>{process.send({value,pid:process.pid},()=>process.disconnect());});", 'utf8');
  const child = nativeFork(entry, [], { execPath: nativeBridge, execArgv: ['--managed-launch', process.execPath], stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'] });
  const observed = observeNative(child);
  const reply = new Promise<{ value: string; pid: number }>(resolve => child.once('message', resolve as never));
  try {
    const ready = await observed.receipt('managed.ready');
    child.send('existing-ipc');
    nativeAssert.deepEqual(await reply, { value: 'existing-ipc', pid: ready.pid });
    nativeAssert.equal((await observed.receipt('managed.released')).active, 0);
    await observed.closed;
    nativeAssert.equal(child.connected, false);
  } finally {
    await observed.cleanup();
    nativeFs.rmSync(folder, { recursive: true, force: true });
  }
});
nativeTest('Windows leader exit retains its live descendant until an explicit zero-process Job receipt', windowsOnly, async () => {
  const child = launchNative("const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});c.once('spawn',()=>{console.log(JSON.stringify({descendant:c.pid}));setTimeout(()=>process.exit(0),50);});");
  const observed = observeNative(child);
  try {
    const rootExit = await observed.receipt('managed.root-exited');
    nativeAssert.ok(rootExit.active >= 1, 'root exit must not count as an empty Job');
    nativeAssert.equal(child.exitCode, null);
    nativeAssert.equal(observed.frames.some(frame => frame.event === 'managed.released'), false);
    const descendant = JSON.parse(observed.stdout()).descendant;
    nativeAssert.doesNotThrow(() => process.kill(descendant, 0));
    observed.terminate();
    const released = await observed.receipt('managed.released');
    nativeAssert.equal(released.active, 0);
    await observed.closed;
    nativeAssert.throws(() => process.kill(descendant, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH');
  } finally { await observed.cleanup(); }
});

nativeTest('Windows native launch preserves the actual Python worker FD3 bootstrap', windowsOnly, async () => {
  const python = nativePath.resolve(__dirname, '../../../.venv/Scripts/python.exe');
  nativeAssert.equal(nativeFs.existsSync(python), true, 'the configured development Python is required for its bootstrap proof');
  const interpreter = JSON.parse(require('node:child_process').execFileSync(python, ['-c', 'import sys,json;print(json.dumps(dict(base=sys._base_executable,prefix=sys.prefix)))'], { encoding: 'utf8', windowsHide: true }));
  const child = nativeSpawn(nativeBridge, ['--managed-launch', interpreter.base, '-c', 'import os,sys,json; print(json.dumps(dict(pid=os.getpid(),prefix=sys.prefix,bootstrap=os.read(3,64).decode())))'], { env: { ...process.env, __PYVENV_LAUNCHER__: python }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
  const observed = observeNative(child);
  (child.stdio[3] as import('node:stream').Writable).end('existing-fd3-bootstrap');
  try {
    const ready = await observed.receipt('managed.ready');
    nativeAssert.equal((await observed.receipt('managed.released')).active, 0);
    await observed.closed;
    nativeAssert.deepEqual(JSON.parse(observed.stdout()), { pid: ready.pid, prefix: interpreter.prefix, bootstrap: 'existing-fd3-bootstrap' });
  } finally { await observed.cleanup(); }
});
nativeTest('Windows nested managed Jobs contain the inner root and confirm zero after outer stop', windowsOnly, async () => {
  const innerCode = 'setInterval(()=>{},1000)';
  const outerCode = "const c=require('child_process').spawn(" + JSON.stringify(nativeBridge) + ",['--managed-launch',process.execPath,'-e'," + JSON.stringify(innerCode) + "],{stdio:['ignore','pipe','pipe','ignore','pipe'],detached:true});let b=Buffer.alloc(0);c.stdio[4].on('data',d=>{b=Buffer.concat([b,d]);if(b.length>=4+b.readUInt32LE(0)){const n=b.readUInt32LE(8);console.log(JSON.stringify({innerRoot:b.readUInt32LE(12+n)}));setInterval(()=>{},1000);}});";
  const child = launchNative(outerCode);
  const observed = observeNative(child);
  try {
    await observed.receipt('managed.ready');
    const deadline = Date.now() + 5000;
    while (!observed.stdout().includes('innerRoot')) {
      if (Date.now() >= deadline) throw new Error('inner Job launch receipt missing');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const inner = JSON.parse(observed.stdout()).innerRoot;
    nativeAssert.doesNotThrow(() => process.kill(inner, 0));
    observed.terminate();
    nativeAssert.equal((await observed.receipt('managed.released')).active, 0);
    await observed.closed;
    nativeAssert.throws(() => process.kill(inner, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH');
  } finally { await observed.cleanup(); }
});

for (const fault of ['assign', 'resume', 'query']) {
  nativeTest('Windows ' + fault + ' failure retains native ownership until actual cleanup and a successful zero query', windowsOnly, async () => {
    const child = launchNative("console.log('business-started');setInterval(()=>{},1000)", fault, nativeFaultBridge);
    const observed = observeNative(child);
    try {
      const failure = await observed.receipt('managed.error');
      nativeAssert.equal(failure.code, 5);
      nativeAssert.equal(child.exitCode, null, 'failure reporting must precede owner release');
      nativeAssert.equal(observed.frames.some(frame => frame.event === 'managed.released'), false);
      nativeAssert.equal(observed.frames.some(frame => frame.event === 'managed.ready'), false);
      const released = await observed.receipt('managed.released');
      nativeAssert.equal(released.pid, failure.pid);
      nativeAssert.equal(released.active, 0);
      await observed.closed;
      nativeAssert.throws(() => process.kill(failure.pid, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH');
      if (fault !== 'query') nativeAssert.equal(observed.stdout(), '', 'an unassigned or unresumed root cannot run business code');
    } finally { await observed.cleanup(); }
  });
}

nativeTest('Windows a timed out stop keeps the same live Job owner and supports actual release on retry', windowsOnly, async () => {
  const child = launchNative('setInterval(()=>{},1000)', 'stop-timeout', nativeFaultBridge);
  const observed = observeNative(child);
  try {
    const ready = await observed.receipt('managed.ready');
    observed.terminate(1);
    const failure = await observed.receipt('managed.error');
    nativeAssert.equal(failure.code, 258);
    nativeAssert.equal(failure.pid, ready.pid);
    nativeAssert.equal(child.exitCode, null);
    nativeAssert.doesNotThrow(() => process.kill(ready.pid, 0));
    nativeAssert.equal(observed.frames.some(frame => frame.event === 'managed.released'), false);
    observed.terminate();
    nativeAssert.equal((await observed.receipt('managed.released')).active, 0);
    await observed.closed;
    nativeAssert.throws(() => process.kill(ready.pid, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH');
  } finally { await observed.cleanup(); }
});

nativeTest('Windows production launch ignores the test-only fault environment', windowsOnly, async () => {
  const child = launchNative('setInterval(()=>{},1000)', 'stop-timeout');
  const observed = observeNative(child);
  try {
    await observed.receipt('managed.ready');
    observed.terminate(1000);
    nativeAssert.equal((await observed.receipt('managed.released')).active, 0);
    await observed.closed;
    nativeAssert.equal(observed.frames.some(frame => frame.event === 'managed.error'), false);
  } finally { await observed.cleanup(); }
});

nativeTest('Windows control loss reclaims the actual root but cannot deliver a release receipt', windowsOnly, async () => {
  const child = launchNative('setInterval(()=>{},1000)');
  const observed = observeNative(child);
  try {
    const ready = await observed.receipt('managed.ready');
    observed.control.destroy();
    await observed.closed;
    nativeAssert.notEqual(child.exitCode, 0);
    nativeAssert.equal(observed.frames.some(frame => frame.event === 'managed.released'), false);
    nativeAssert.throws(() => process.kill(ready.pid, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH');
  } finally { await observed.cleanup(); }
});

const { ManagedProcessSupervisor: WindowsSupervisor } = require('../dist/index.js') as typeof import('../src/index');
const windowsLogger = { info() {}, warn() {}, error() {} };
nativeTest('Platform Windows API owns the Job after leader exit and releases only on zero plus wrapper exit', windowsOnly, async () => {
  const supervisor = new WindowsSupervisor(windowsLogger);
  const child = supervisor.spawnManagedProcess(process.execPath, ['-e', "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});c.once('spawn',()=>{console.log(JSON.stringify({descendant:c.pid}));setTimeout(()=>process.exit(0),50)});"], { stdio: ['ignore', 'pipe', 'pipe'] }, nativeBridge);
  let output = '';
  child.stdout!.on('data', bytes => { output += bytes; });
  child.stderr!.resume();
  const rootExited = new Promise<void>(resolve => supervisor.onManagedProcessRootExit(child, () => resolve()));
  try {
    const pid = await supervisor.waitForManagedProcessReady(child, 5000);
    nativeAssert.notEqual(pid, child.pid);
    nativeAssert.equal(pid, supervisor.managedProcessPid(child));
    await rootExited;
    nativeAssert.equal(supervisor.isProcessReleased(child), false);
    nativeAssert.equal(child.exitCode, null);
    const descendant = JSON.parse(output).descendant;
    nativeAssert.doesNotThrow(() => process.kill(descendant, 0));
    await supervisor.stopManagedProcess(child, { label: 'actual-leader-first', forceTimeoutMs: 5000 });
    nativeAssert.equal(supervisor.isProcessReleased(child), true);
    nativeAssert.throws(() => process.kill(descendant, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH');
  } finally {
    if (!supervisor.isProcessReleased(child)) await supervisor.stopManagedProcess(child, { label: 'fixture-cleanup', forceTimeoutMs: 5000 });
  }
});

nativeTest('Platform Windows API retains a timed out Job and retries its live native handle', windowsOnly, async () => {
  const supervisor = new WindowsSupervisor(windowsLogger);
  const child = supervisor.spawnManagedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { env: { ...process.env, GLIMMER_TEST_PROCESS_TREE_FAULT: 'stop-timeout' }, stdio: ['ignore', 'pipe', 'pipe'] }, nativeFaultBridge);
  child.stdout!.resume(); child.stderr!.resume();
  try {
    const pid = await supervisor.waitForManagedProcessReady(child, 5000);
    await nativeAssert.rejects(supervisor.stopManagedProcess(child, { label: 'timeout', forceTimeoutMs: 40 }), /258|期限内/);
    nativeAssert.equal(supervisor.isProcessReleased(child), false);
    nativeAssert.doesNotThrow(() => process.kill(pid, 0));
    await supervisor.stopManagedProcess(child, { label: 'retry', forceTimeoutMs: 5000 });
    nativeAssert.equal(supervisor.isProcessReleased(child), true);
    nativeAssert.throws(() => process.kill(pid, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH');
  } finally {
    if (!supervisor.isProcessReleased(child)) await supervisor.stopManagedProcess(child, { label: 'fixture-cleanup', forceTimeoutMs: 5000 });
  }
});

nativeTest('Platform Windows API preserves an unknown owner after control loss despite actual root cleanup', windowsOnly, async () => {
  const supervisor = new WindowsSupervisor(windowsLogger);
  const child = supervisor.spawnManagedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] }, nativeBridge);
  child.stdout!.resume(); child.stderr!.resume();
  const closed = new Promise<void>(resolve => child.once('close', resolve));
  const pid = await supervisor.waitForManagedProcessReady(child, 5000);
  child.stdio[4]!.destroy();
  await closed;
  nativeAssert.throws(() => process.kill(pid, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH');
  nativeAssert.equal(supervisor.isProcessReleased(child), false);
  await nativeAssert.rejects(supervisor.stopManagedProcess(child, { label: 'missing-receipt' }), /释放回执缺失/);
});

nativeTest('Platform Windows API still reclaims the tree when the root observer throws', windowsOnly, async () => {
  const supervisor = new WindowsSupervisor(windowsLogger);
  const child = supervisor.spawnManagedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] }, nativeBridge);
  child.stdout!.resume(); child.stderr!.resume();
  await supervisor.waitForManagedProcessReady(child, 5000);
  supervisor.onManagedProcessRootExit(child, () => { throw new Error('root observer failed'); });
  await nativeAssert.rejects(supervisor.stopManagedProcess(child, { label: 'observer', forceTimeoutMs: 5000 }), /observer 失败/);
  nativeAssert.equal(supervisor.isProcessReleased(child), true);
});

nativeTest('Platform Windows missing target fails explicitly and releases its empty launch owner', windowsOnly, async () => {
  const supervisor = new WindowsSupervisor(windowsLogger);
  const child = supervisor.spawnManagedProcess(nativePath.join(require('node:os').tmpdir(), 'glimmer-no-such-root.exe'), [], { stdio: ['ignore', 'pipe', 'pipe'] }, nativeBridge);
  child.stdout!.resume(); child.stderr!.resume();
  const closed = new Promise<void>(resolve => child.once('close', resolve));
  await nativeAssert.rejects(supervisor.waitForManagedProcessReady(child, 5000), /目标未创建/);
  await supervisor.stopManagedProcess(child, { label: 'missing-target', forceTimeoutMs: 5000 });
  await closed;
  nativeAssert.equal(supervisor.managedProcessPid(child), undefined);
  nativeAssert.equal(supervisor.isProcessReleased(child), true);
});

function legacyRequest(child: import('node:child_process').ChildProcess, op: number, session: string, program = '', args: string[] = []) {
  const fields = [session, program, process.cwd(), ...args].map(value => Buffer.from(value));
  const body = Buffer.alloc(8 + fields.reduce((size, value) => size + 4 + value.length, 0));
  let offset = 0;
  body.writeUInt32LE(op, offset); offset += 4;
  for (const value of fields.slice(0, 3)) { body.writeUInt32LE(value.length, offset); offset += 4; value.copy(body, offset); offset += value.length; }
  body.writeUInt32LE(args.length, offset); offset += 4;
  for (const value of fields.slice(3)) { body.writeUInt32LE(value.length, offset); offset += 4; value.copy(body, offset); offset += value.length; }
  const frame = Buffer.alloc(4 + body.length); frame.writeUInt32LE(body.length); body.copy(frame, 4);
  child.stdin!.write(frame);
}
function launchLegacy(fault?: string) {
  return nativeSpawn(fault ? nativeFaultBridge : nativeBridge, [], { env: { ...process.env, GLIMMER_TEST_PROCESS_TREE_FAULT: fault }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
}
for (const fault of ['assign', 'resume', 'query']) {
  nativeTest('Desktop legacy ' + fault + ' failure confirms actual root cleanup before replying', windowsOnly, async () => {
    const child = launchLegacy(fault);
    const observed = observeNative(child, true);
    try {
      legacyRequest(child, 1, 'start-failure', process.execPath, ['-e', 'setInterval(()=>{},1000)']);
      const failure = await observed.receipt('start-failure');
      nativeAssert.equal(failure.code, 5);
      nativeAssert.ok(failure.pid > 0, 'retain the actually created root identity in the failure receipt');
      nativeAssert.equal(failure.active, 0);
      nativeAssert.throws(() => process.kill(failure.pid, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH');
      nativeAssert.equal(child.exitCode, null);
      legacyRequest(child, 2, 'empty-job-stop');
      nativeAssert.equal((await observed.receipt('empty-job-stop')).active, 0);
      await observed.closed;
    } finally { await observed.cleanup(); }
  });
}
nativeTest('Desktop legacy stop timeout retains the actual root and retries the same Job', windowsOnly, async () => {
  const child = launchLegacy('stop-timeout');
  const observed = observeNative(child, true);
  try {
    legacyRequest(child, 1, 'started', process.execPath, ['-e', 'setInterval(()=>{},1000)']);
    const ready = await observed.receipt('started');
    nativeAssert.equal(ready.code, 0); nativeAssert.ok(ready.active >= 1);
    legacyRequest(child, 2, 'timed-out');
    const failure = await observed.receipt('timed-out');
    nativeAssert.equal(failure.code, 258); nativeAssert.ok(failure.active >= 1);
    nativeAssert.equal(child.exitCode, null);
    nativeAssert.doesNotThrow(() => process.kill(ready.pid, 0));
    legacyRequest(child, 2, 'retried');
    const released = await observed.receipt('retried');
    nativeAssert.equal(released.code, 0); nativeAssert.equal(released.active, 0);
    await observed.closed;
    nativeAssert.throws(() => process.kill(ready.pid, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH');
  } finally { await observed.cleanup(); }
});
nativeTest('Desktop legacy EOF waits for actual root and Job cleanup before helper exit', windowsOnly, async () => {
  const child = launchLegacy();
  const observed = observeNative(child, true);
  try {
    legacyRequest(child, 1, 'started', process.execPath, ['-e', 'setInterval(()=>{},1000)']);
    const ready = await observed.receipt('started');
    nativeAssert.equal(ready.code, 0);
    child.stdin!.end();
    await observed.closed;
    nativeAssert.throws(() => process.kill(ready.pid, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH');
    nativeAssert.equal(observed.frames.length, 1, 'EOF does not invent an externally delivered stop receipt');
  } finally { await observed.cleanup(); }
});

function nativeOrderingFixture() {
  const { EventEmitter } = require('node:events');
  const { Duplex, PassThrough } = require('node:stream');
  let commands = 0;
  const control = new Duplex({ read() {}, write(_bytes: Buffer, _encoding: string, done: () => void) { commands += 1; done(); } });
  const child = Object.assign(new EventEmitter(), { pid: 4433, exitCode: null as number | null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough(), stdio: [null, null, null, null, control] }) as import('node:child_process').ChildProcess;
  const supervisor = new WindowsSupervisor(windowsLogger, undefined, { platform: 'win32', signalProcessGroup() {} });
  const port = (() => child) as typeof nativeSpawn;
  supervisor.spawnManagedProcess('fixture-root', [], { stdio: ['ignore', 'pipe', 'pipe'] }, nativePath.resolve('fixture-bridge.exe'), port);
  function frame(event: string, code = 0, active = 1) {
    const name = Buffer.from(event);
    const bytes = Buffer.alloc(20 + name.length);
    bytes.writeUInt32LE(16 + name.length, 0); bytes.writeUInt32LE(code, 4); bytes.writeUInt32LE(name.length, 8); name.copy(bytes, 12);
    bytes.writeUInt32LE(5544, 12 + name.length); bytes.writeUInt32LE(active, 16 + name.length);
    control.emit('data', bytes);
  }
  function exit() { Object.assign(child, { exitCode: 0 }); child.emit('exit', 0, null); }
  function drain() { control.emit('end'); }
  function close() { drain(); child.emit('close', 0, null); }
  return { child, supervisor, frame, exit, close, drain, control, commands: () => commands };
}
nativeTest('Native helper exit before final frames waits for FD4 drainage without aggregate close or a dead-owner stop', { timeout: 5000 }, async () => {
  const fixture = nativeOrderingFixture();
  fixture.frame('managed.ready');
  await fixture.supervisor.waitForManagedProcessReady(fixture.child, 1000);
  let delivered = 0;
  fixture.supervisor.onManagedProcessExit(fixture.child, () => { delivered += 1; nativeAssert.equal(fixture.supervisor.isProcessReleased(fixture.child), true); });
  const wait = fixture.supervisor.waitForManagedProcessExit(fixture.child, 1000);
  fixture.exit();
  let settled = false;
  void wait.then(() => { settled = true; });
  await Promise.resolve();
  nativeAssert.equal(settled, false);
  nativeAssert.equal(delivered, 0);
  const force = fixture.supervisor.forceTerminateManagedProcessTree(fixture.child, 'late-frame', 1000);
  fixture.frame('managed.root-exited', 0, 0);
  fixture.frame('managed.released', 0, 0);
  nativeAssert.equal(fixture.supervisor.isProcessReleased(fixture.child), false);
  fixture.drain();
  nativeAssert.equal(await wait, true);
  await force;
  nativeAssert.equal(delivered, 1);
  nativeAssert.equal(fixture.commands(), 0);
  nativeAssert.equal(fixture.supervisor.isProcessReleased(fixture.child), true);
  fixture.control.destroy();
});
nativeTest('A root exit before admission rejects OS readiness and cannot accept a later ready frame', { timeout: 5000 }, async () => {
  const fixture = nativeOrderingFixture();
  const ready = fixture.supervisor.waitForManagedProcessReady(fixture.child, 1000);
  const rejected = nativeAssert.rejects(ready, /接纳前已退出/);
  fixture.frame('managed.root-exited', 0, 0);
  await rejected;
  fixture.frame('managed.ready', 0, 0);
  nativeAssert.equal(fixture.control.destroyed, true);
  fixture.exit(); fixture.close();
  nativeAssert.equal(fixture.supervisor.isProcessReleased(fixture.child), false);
});
