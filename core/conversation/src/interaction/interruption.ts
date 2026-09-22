export interface InteractionGeneration {
  readonly generation: number;
  readonly signal: AbortSignal;
}

type ActiveInteraction = {
  readonly generation: number;
  readonly controller: AbortController;
};

/** 中断先推进 generation 并撤销旧 signal，晚到结果只能被识别为 stale。 */
export class InterruptionCoordinator {
  private readonly active = new Map<string, ActiveInteraction>();
  private readonly generations = new Map<string, number>();

  public begin(routeKey: string): InteractionGeneration {
    this.active.get(routeKey)?.controller.abort('superseded');
    const generation = (this.generations.get(routeKey) ?? 0) + 1;
    const controller = new AbortController();
    this.generations.set(routeKey, generation);
    this.active.set(routeKey, { generation, controller });
    return { generation, signal: controller.signal };
  }

  public interrupt(routeKey: string, reason = 'interrupted'): number {
    this.active.get(routeKey)?.controller.abort(reason);
    const generation = (this.generations.get(routeKey) ?? 0) + 1;
    this.generations.set(routeKey, generation);
    this.active.delete(routeKey);
    return generation;
  }

  public isCurrent(routeKey: string, generation: number): boolean {
    return this.generations.get(routeKey) === generation
      && this.active.get(routeKey)?.generation === generation;
  }

  public finish(routeKey: string, generation: number): void {
    if (this.active.get(routeKey)?.generation === generation) this.active.delete(routeKey);
  }
}

