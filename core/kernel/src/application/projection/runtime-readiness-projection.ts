import type {
  RuntimeReadinessCatalog,
  RuntimeReadinessSnapshot,
} from '../../ports/runtime-readiness.port';
import type { RuntimeProjectionPort } from '../../ports/kernel-lifecycle.port';

type RuntimeReadinessListener = (catalog: RuntimeReadinessCatalog) => void;

/** Application-owned input boundary and unique store for Runtime facts. */
export class RuntimeReadinessProjectionMapper implements RuntimeProjectionPort {
  private readonly snapshotsByModule = new Map<string, RuntimeReadinessSnapshot[]>();
  private readonly listeners = new Set<RuntimeReadinessListener>();

  public getCatalog(): RuntimeReadinessCatalog {
    return {
      updated_at: Date.now(),
      runtimes: [...this.snapshotsByModule.values()]
        .flatMap((snapshots) => snapshots.map(cloneSnapshot))
        .sort((left, right) => left.runtime_id.localeCompare(right.runtime_id)),
    };
  }

  public replaceModuleSnapshots(moduleName: string, snapshots: readonly RuntimeReadinessSnapshot[]): void {
    this.snapshotsByModule.set(moduleName, snapshots.map(cloneSnapshot));
    this.emit();
  }

  public clear(): void {
    this.snapshotsByModule.clear();
    this.emit();
  }

  public subscribe(listener: RuntimeReadinessListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const catalog = this.getCatalog();
    for (const listener of this.listeners) listener(catalog);
  }
}

function cloneSnapshot(snapshot: RuntimeReadinessSnapshot): RuntimeReadinessSnapshot {
  return {
    ...snapshot,
    ...(snapshot.reconciler ? {
      reconciler: {
        ...snapshot.reconciler,
        resources: snapshot.reconciler.resources.map((resource) => ({
          ...resource,
          recovery_actions: [...(resource.recovery_actions ?? [])],
        })),
      },
    } : {}),
  };
}
