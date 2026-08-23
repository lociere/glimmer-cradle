import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KernelCognitionTransport } from '../../adapters/cognition/kernel-cognition-transport';
import { CognitionClient } from '../../adapters/cognition/cognition-client';
import { ConfigManager } from '../../adapters/config/config-manager';
import { EndpointRegistry } from '../../adapters/endpoints/endpoint-registry';
import { CognitionManager } from '../../adapters/cognition/cognition-process-adapter';
import { ManageCognitionLifecycle } from '../../application/use-cases/manage-cognition-lifecycle';
import { IngressGateManager } from '../../application/ingress/ingress-gate-manager';
import { CognitionRuntime } from './cognition-runtime';
import { KernelTransportRuntime } from './kernel-transport-runtime';
import { createTraceContext } from '../../adapters/observability/trace-context';
import { RuntimeReadinessProjectionMapper } from '../../application/projection/runtime-readiness-projection';
import type { KernelConfiguration } from '../../ports/configuration.port';

const runIntegration = process.env.GLIMMER_CRADLE_RUN_COGNITION_INTEGRATION === '1';

describe.skipIf(!runIntegration)('CognitionManager real process integration', () => {
  let transportRuntime: KernelTransportRuntime;
  const transport = new KernelCognitionTransport();
  const projection = new RuntimeReadinessProjectionMapper();
  const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, critical: () => undefined };
  let manager: CognitionManager;
  beforeAll(async () => {
    await ConfigManager.instance.init();
    transportRuntime = new KernelTransportRuntime(
      ConfigManager.instance.getConfig() as unknown as KernelConfiguration,
      transport,
      new IngressGateManager(logger),
      projection,
    );
    let cognitionRuntime!: CognitionRuntime;
    manager = new CognitionManager(
      transport,
      new CognitionClient(transport),
      (state, summary) => cognitionRuntime.acceptLifecycleFact(state, summary),
    );
    cognitionRuntime = new CognitionRuntime(
      transportRuntime,
      new ManageCognitionLifecycle(manager),
      projection,
    );
    await transportRuntime.start(createTraceContext());
  });

  afterAll(async () => {
    await manager.stop();
    await transportRuntime.stop(createTraceContext());
    await EndpointRegistry.instance.close();
  });

  it('starts, reaches readiness, stops and recovers with a fresh supervised generation', async () => {
    await manager.start();
    expect(manager.isReady).toBe(true);
    expect(await manager.sendLifeHeartbeat({})).toEqual({ status: 'alive' });
    const firstGeneration = transport.generation;

    await manager.stop();
    expect(manager.isReady).toBe(false);
    expect(EndpointRegistry.instance.get('cognition-rpc')).toBeUndefined();

    await manager.start();
    expect(manager.isReady).toBe(true);
    expect(transport.generation).not.toBe(firstGeneration);
    await manager.stop();
  }, 60_000);

  it('revokes required ingress on crash and restores it only after a fresh generation is ready', async () => {
    await manager.start();
    transportRuntime.openIngress();
    const firstGeneration = transport.generation;
    const child = (manager as unknown as { child: { kill(): boolean } | null }).child;
    expect(child).not.toBeNull();
    child!.kill();

    await waitUntil(() => !manager.isReady);
    const failedIngress = projection.getCatalog().runtimes
      .find((runtime) => runtime.runtime_id === 'kernel.ingress');
    expect(failedIngress?.state).toBe('failed');

    await waitUntil(() => manager.isReady, 30_000);
    expect(transport.generation).not.toBe(firstGeneration);
    const recoveredIngress = projection.getCatalog().runtimes
      .find((runtime) => runtime.runtime_id === 'kernel.ingress');
    expect(recoveredIngress?.state).toBe('ready');
    await manager.stop();
  }, 60_000);

  it('keeps ingress closed after restart failure and reopens only after explicit recovery', async () => {
    const previousRuntime = process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;
    await manager.start();
    transportRuntime.openIngress();
    const attemptsBeforeCrash = (manager as unknown as { recoveryAttempts: number })
      .recoveryAttempts;
    process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = 'Z:\\missing\\glimmer-cognition-python.exe';
    const child = (manager as unknown as { child: { kill(): boolean } | null }).child;
    child!.kill();
    try {
      await waitUntil(() => !manager.isReady);
      await waitUntil(() => {
        const state = manager as unknown as {
          child: unknown;
          starting: boolean;
          recoveryAttempts: number;
        };
        return state.recoveryAttempts > attemptsBeforeCrash
          && state.child === null
          && state.starting === false;
      }, 10_000);
      const failed = projection.getCatalog().runtimes;
      expect(failed.find((runtime) => runtime.runtime_id === 'kernel.ingress')?.state).toBe('failed');
      expect(failed.find((runtime) => runtime.runtime_id === 'cognition')?.state).toBe('failed');
    } finally {
      if (previousRuntime === undefined) delete process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;
      else process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = previousRuntime;
    }
    await manager.start();
    expect(manager.isReady).toBe(true);
    expect(projection.getCatalog().runtimes
      .find((runtime) => runtime.runtime_id === 'kernel.ingress')?.state).toBe('ready');
    await manager.stop();
  }, 60_000);
});

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  expect(predicate()).toBe(true);
}
