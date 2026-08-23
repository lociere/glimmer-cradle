import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KernelCognitionTransport } from '../../adapters/cognition/kernel-cognition-transport';
import { ConfigManager } from '../../foundation/config/config-manager';
import { EndpointRegistry } from '../../foundation/endpoints/endpoint-registry';
import { CognitionManager } from '../../application/capabilities/inference/cognition-manager';
import { CognitionRuntime } from './cognition-runtime';
import { KernelTransportRuntime } from './kernel-transport-runtime';
import { createTraceContext } from '../../foundation/logger/trace-context';
import { RuntimeReadinessCatalogStore } from '../../foundation/runtime-readiness-catalog';

const runIntegration = process.env.GLIMMER_CRADLE_RUN_COGNITION_INTEGRATION === '1';

describe.skipIf(!runIntegration)('CognitionManager real process integration', () => {
  let transportRuntime: KernelTransportRuntime;
  beforeAll(async () => {
    await ConfigManager.instance.init();
    transportRuntime = new KernelTransportRuntime(ConfigManager.instance.getConfig());
    await transportRuntime.start(createTraceContext());
    new CognitionRuntime(transportRuntime);
  });

  afterAll(async () => {
    await CognitionManager.instance.stop();
    await transportRuntime.stop(createTraceContext());
    await EndpointRegistry.instance.close();
  });

  it('starts, reaches readiness, stops and recovers with a fresh supervised generation', async () => {
    await CognitionManager.instance.start();
    expect(CognitionManager.instance.isReady).toBe(true);
    expect(await CognitionManager.instance.sendLifeHeartbeat({})).toEqual({ status: 'alive' });
    const firstGeneration = KernelCognitionTransport.instance.generation;

    await CognitionManager.instance.stop();
    expect(CognitionManager.instance.isReady).toBe(false);
    expect(EndpointRegistry.instance.get('cognition-rpc')).toBeUndefined();

    await CognitionManager.instance.start();
    expect(CognitionManager.instance.isReady).toBe(true);
    expect(KernelCognitionTransport.instance.generation).not.toBe(firstGeneration);
    await CognitionManager.instance.stop();
  }, 60_000);

  it('revokes required ingress on crash and restores it only after a fresh generation is ready', async () => {
    await CognitionManager.instance.start();
    transportRuntime.openIngress();
    const firstGeneration = KernelCognitionTransport.instance.generation;
    const child = (CognitionManager.instance as unknown as { child: { kill(): boolean } | null }).child;
    expect(child).not.toBeNull();
    child!.kill();

    await waitUntil(() => !CognitionManager.instance.isReady);
    const failedIngress = RuntimeReadinessCatalogStore.instance.getCatalog().runtimes
      .find((runtime) => runtime.runtime_id === 'kernel.ingress');
    expect(failedIngress?.state).toBe('failed');

    await waitUntil(() => CognitionManager.instance.isReady, 30_000);
    expect(KernelCognitionTransport.instance.generation).not.toBe(firstGeneration);
    const recoveredIngress = RuntimeReadinessCatalogStore.instance.getCatalog().runtimes
      .find((runtime) => runtime.runtime_id === 'kernel.ingress');
    expect(recoveredIngress?.state).toBe('ready');
    await CognitionManager.instance.stop();
  }, 60_000);

  it('keeps ingress closed after restart failure and reopens only after explicit recovery', async () => {
    const previousRuntime = process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;
    await CognitionManager.instance.start();
    transportRuntime.openIngress();
    const attemptsBeforeCrash = (CognitionManager.instance as unknown as { recoveryAttempts: number })
      .recoveryAttempts;
    process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = 'Z:\\missing\\glimmer-cognition-python.exe';
    const child = (CognitionManager.instance as unknown as { child: { kill(): boolean } | null }).child;
    child!.kill();
    try {
      await waitUntil(() => !CognitionManager.instance.isReady);
      await waitUntil(() => {
        const manager = CognitionManager.instance as unknown as {
          child: unknown;
          starting: boolean;
          recoveryAttempts: number;
        };
        return manager.recoveryAttempts > attemptsBeforeCrash
          && manager.child === null
          && manager.starting === false;
      }, 10_000);
      const failed = RuntimeReadinessCatalogStore.instance.getCatalog().runtimes;
      expect(failed.find((runtime) => runtime.runtime_id === 'kernel.ingress')?.state).toBe('failed');
      expect(failed.find((runtime) => runtime.runtime_id === 'cognition')?.state).toBe('failed');
    } finally {
      if (previousRuntime === undefined) delete process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;
      else process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = previousRuntime;
    }
    await CognitionManager.instance.start();
    expect(CognitionManager.instance.isReady).toBe(true);
    expect(RuntimeReadinessCatalogStore.instance.getCatalog().runtimes
      .find((runtime) => runtime.runtime_id === 'kernel.ingress')?.state).toBe('ready');
    await CognitionManager.instance.stop();
  }, 60_000);
});

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  expect(predicate()).toBe(true);
}
