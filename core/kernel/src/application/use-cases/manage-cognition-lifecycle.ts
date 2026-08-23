import type { CognitionLifecycleUseCasePort } from '../../ports/kernel-lifecycle.port';

export interface ManagedCognitionPort extends CognitionLifecycleUseCasePort {}

/** Application owns the lifecycle command; the adapter owns process and transport details. */
export class ManageCognitionLifecycle implements CognitionLifecycleUseCasePort {
  public constructor(private readonly cognition: ManagedCognitionPort) {}

  public get isReady(): boolean {
    return this.cognition.isReady;
  }

  public start(): Promise<void> {
    return this.cognition.start();
  }

  public stop(): Promise<void> {
    return this.cognition.stop();
  }
}
