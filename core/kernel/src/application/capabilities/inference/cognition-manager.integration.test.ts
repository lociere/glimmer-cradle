import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KernelCognitionTransport } from '../../../adapters/cognition/kernel-cognition-transport';
import { ConfigManager } from '../../../foundation/config/config-manager';
import { EndpointRegistry } from '../../../foundation/endpoints/endpoint-registry';
import { CognitionManager } from './cognition-manager';

const runIntegration = process.env.GLIMMER_CRADLE_RUN_COGNITION_INTEGRATION === '1';

describe.skipIf(!runIntegration)('CognitionManager real process integration', () => {
  beforeAll(async () => {
    await ConfigManager.instance.init();
    await KernelCognitionTransport.instance.start();
  });

  afterAll(async () => {
    await CognitionManager.instance.stop();
    await KernelCognitionTransport.instance.stop();
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
});
