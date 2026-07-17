import type {
  RuntimeReadinessCatalog,
  RuntimeReadinessSnapshot as ProtocolRuntimeReadinessSnapshot,
  RuntimeReconcilerSnapshot as ProtocolRuntimeReconcilerSnapshot,
  RuntimeResourceSnapshot as ProtocolRuntimeResourceSnapshot,
} from '@glimmer-cradle/protocol';
import type { RuntimeReadinessSnapshot } from './runtime-readiness';

type RuntimeReadinessListener = (catalog: RuntimeReadinessCatalog) => void;

export class RuntimeReadinessCatalogStore {
  private static _instance: RuntimeReadinessCatalogStore | null = null;
  private readonly _snapshotsByModule = new Map<string, ProtocolRuntimeReadinessSnapshot[]>();
  private readonly _listeners = new Set<RuntimeReadinessListener>();

  public static get instance(): RuntimeReadinessCatalogStore {
    if (!RuntimeReadinessCatalogStore._instance) {
      RuntimeReadinessCatalogStore._instance = new RuntimeReadinessCatalogStore();
    }
    return RuntimeReadinessCatalogStore._instance;
  }

  private constructor() {}

  public getCatalog(): RuntimeReadinessCatalog {
    return {
      updated_at: Date.now(),
      runtimes: [...this._snapshotsByModule.values()]
        .flatMap((snapshots) => snapshots.map((snapshot) => cloneProtocolSnapshot(snapshot)))
        .sort((left, right) => left.runtime_id.localeCompare(right.runtime_id)),
    };
  }

  public replaceModuleSnapshots(moduleName: string, snapshots: readonly RuntimeReadinessSnapshot[]): void {
    this._snapshotsByModule.set(moduleName, snapshots.map((snapshot) => toProtocolSnapshot(snapshot)));
    this._emit();
  }

  public clear(): void {
    this._snapshotsByModule.clear();
    this._emit();
  }

  public subscribe(listener: RuntimeReadinessListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private _emit(): void {
    const catalog = this.getCatalog();
    for (const listener of this._listeners) {
      listener(catalog);
    }
  }
}

function toProtocolSnapshot(snapshot: RuntimeReadinessSnapshot): ProtocolRuntimeReadinessSnapshot {
  return {
    runtime_id: snapshot.runtime_id,
    owner: snapshot.owner,
    phase: snapshot.phase,
    state: snapshot.state,
    blocking: snapshot.blocking,
    summary: snapshot.summary,
    ...(snapshot.details_ref ? { details_ref: snapshot.details_ref } : {}),
    ...(typeof snapshot.duration_ms === 'number' ? { duration_ms: snapshot.duration_ms } : {}),
    ...(snapshot.reconciler ? { reconciler: cloneReconciler(snapshot.reconciler) } : {}),
  };
}

function cloneProtocolSnapshot(snapshot: ProtocolRuntimeReadinessSnapshot): ProtocolRuntimeReadinessSnapshot {
  return {
    runtime_id: snapshot.runtime_id,
    owner: snapshot.owner,
    phase: snapshot.phase,
    state: snapshot.state,
    blocking: snapshot.blocking,
    summary: snapshot.summary,
    ...(snapshot.details_ref ? { details_ref: snapshot.details_ref } : {}),
    ...(typeof snapshot.duration_ms === 'number' ? { duration_ms: snapshot.duration_ms } : {}),
    ...(snapshot.reconciler ? { reconciler: cloneProtocolReconciler(snapshot.reconciler) } : {}),
  };
}

function cloneReconciler(
  reconciler: NonNullable<RuntimeReadinessSnapshot['reconciler']>,
): ProtocolRuntimeReconcilerSnapshot {
  return {
    desired: reconciler.desired,
    actual: reconciler.actual,
    readiness: reconciler.readiness,
    resources: reconciler.resources.map((resource) => cloneResource(resource)),
  };
}

function cloneProtocolReconciler(reconciler: ProtocolRuntimeReconcilerSnapshot): ProtocolRuntimeReconcilerSnapshot {
  return {
    desired: reconciler.desired,
    actual: reconciler.actual,
    readiness: reconciler.readiness,
    resources: reconciler.resources.map((resource) => ({
      ...resource,
      recovery_actions: [...resource.recovery_actions],
    })),
  };
}

function cloneResource(
  resource: NonNullable<RuntimeReadinessSnapshot['reconciler']>['resources'][number],
): ProtocolRuntimeResourceSnapshot {
  return {
    ...resource,
    recovery_actions: resource.recovery_actions ? [...resource.recovery_actions] : [],
  };
}
