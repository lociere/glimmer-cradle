import type {
  AccessTokenMutationResult,
  AccessTokenSnapshot,
  DeploymentOperationResult,
  DeploymentOperationsSnapshot,
  SkillCatalogLoadResult,
} from '../../shared/api/personal-server-client';

export interface SupplementalControllerContext {
  readonly root: HTMLElement;
  readonly options: {
    readonly loadAccessTokens: () => Promise<AccessTokenSnapshot>;
    readonly createAccessToken: (label: string) => Promise<AccessTokenMutationResult>;
    readonly rotateAccessToken: (tokenId: string) => Promise<AccessTokenMutationResult>;
    readonly revokeAccessToken: (tokenId: string) => Promise<AccessTokenMutationResult>;
    readonly loadOperations: () => Promise<DeploymentOperationsSnapshot>;
    readonly runOperation: (
      operation: string,
      options?: {
        readonly backupId?: string;
        readonly confirm?: boolean;
        readonly operationId?: string;
      },
    ) => Promise<DeploymentOperationResult>;
    readonly loadOperationResult: (operationId: string) => Promise<DeploymentOperationResult | null>;
    readonly loadSkillCatalog: () => Promise<SkillCatalogLoadResult>;
  };
  readonly render: () => void;
  readonly asErrorMessage: (error: unknown) => string;
  readonly accessTokens: {
    getSnapshot: () => AccessTokenSnapshot | null;
    setSnapshot: (value: AccessTokenSnapshot | null) => void;
    setResult: (value: AccessTokenMutationResult | null) => void;
    setPending: (value: boolean) => void;
    getError: () => string | null;
    setError: (value: string | null) => void;
  };
  readonly operations: {
    getSnapshot: () => DeploymentOperationsSnapshot | null;
    setSnapshot: (value: DeploymentOperationsSnapshot | null) => void;
    setResult: (value: DeploymentOperationResult | null) => void;
    setPending: (value: boolean) => void;
    getError: () => string | null;
    setError: (value: string | null) => void;
  };
  readonly skills: {
    getCatalog: () => SkillCatalogLoadResult | null;
    setCatalog: (value: SkillCatalogLoadResult | null) => void;
    setPending: (value: boolean) => void;
  };
}

const ACTIVE_OPERATION_STORAGE_KEY = 'glimmer-cradle.personal-server.active-operation';
const PENDING_OPERATION_STATES = new Set(['accepted', 'started']);

export function bindSupplementalActions(context: SupplementalControllerContext): void {
  context.root.querySelector('[data-action="create-token"]')?.addEventListener('click', async () => {
    const label = context.root.querySelector<HTMLInputElement>('[data-field="access-token-label"]')?.value || '';
    await runAccessTokenMutation(context, () => context.options.createAccessToken(label));
  });

  for (const button of Array.from(context.root.querySelectorAll<HTMLElement>('[data-action="rotate-token"]'))) {
    button.addEventListener('click', async () => {
      await runAccessTokenMutation(context, () => context.options.rotateAccessToken(button.dataset.tokenId || ''));
    });
  }

  for (const button of Array.from(context.root.querySelectorAll<HTMLElement>('[data-action="revoke-token"]'))) {
    button.addEventListener('click', async () => {
      await runAccessTokenMutation(context, () => context.options.revokeAccessToken(button.dataset.tokenId || ''));
    });
  }

  context.root.querySelector('[data-action="create-backup"]')?.addEventListener('click', async () => {
    await runOperation(context, 'backup.create');
  });
  context.root.querySelector('[data-action="check-updates"]')?.addEventListener('click', async () => {
    await runOperation(context, 'update.check');
  });
  context.root.querySelector('[data-action="apply-updates"]')?.addEventListener('click', async () => {
    await runOperation(context, 'update.apply', { confirm: true });
  });
  context.root.querySelector('[data-action="restart-service"]')?.addEventListener('click', async () => {
    await runOperation(context, 'service.restart', { confirm: true });
  });
  context.root.querySelector('[data-action="stop-service"]')?.addEventListener('click', async () => {
    await runOperation(context, 'service.stop', { confirm: true });
  });

  for (const button of Array.from(context.root.querySelectorAll<HTMLElement>('[data-action="restore-backup"]'))) {
    button.addEventListener('click', async () => {
      await runOperation(context, 'backup.restore', {
        backupId: button.dataset.backupId || '',
        confirm: true,
      });
    });
  }
}

export async function refreshSupplementalSnapshots(context: SupplementalControllerContext): Promise<void> {
  await Promise.allSettled([
    refreshAccessTokens(context),
    refreshOperations(context),
    refreshSkillCatalog(context),
  ]);
}

async function refreshAccessTokens(context: SupplementalControllerContext): Promise<void> {
  try {
    const snapshot = await context.options.loadAccessTokens();
    context.accessTokens.setSnapshot(snapshot);
    context.accessTokens.setError(null);
  } catch (error) {
    context.accessTokens.setError(context.asErrorMessage(error));
  }
  context.render();
}

async function refreshOperations(context: SupplementalControllerContext): Promise<void> {
  try {
    const snapshot = await context.options.loadOperations();
    context.operations.setSnapshot(snapshot);
    context.operations.setError(null);
    await resumeDeploymentOperation(context);
  } catch (error) {
    context.operations.setError(context.asErrorMessage(error));
  }
  context.render();
}

async function refreshSkillCatalog(context: SupplementalControllerContext): Promise<void> {
  context.skills.setPending(true);
  context.render();
  try {
    context.skills.setCatalog(await context.options.loadSkillCatalog());
  } catch (error) {
    context.skills.setCatalog({
      request_id: 'skill-catalog-error',
      status: 'error',
      message: context.asErrorMessage(error),
    });
  } finally {
    context.skills.setPending(false);
    context.render();
  }
}

async function runAccessTokenMutation(
  context: SupplementalControllerContext,
  action: () => Promise<AccessTokenMutationResult>,
): Promise<void> {
  context.accessTokens.setPending(true);
  context.render();
  try {
    const result = await action();
    context.accessTokens.setError(null);
    context.accessTokens.setResult(result);
    context.accessTokens.setSnapshot(result.snapshot);
  } catch (error) {
    context.accessTokens.setError(context.asErrorMessage(error));
    context.accessTokens.setResult({
      status: 'error',
      message: context.asErrorMessage(error),
      snapshot: context.accessTokens.getSnapshot() ?? {
        mode: 'open_local',
        degraded: true,
        message: context.asErrorMessage(error),
        tokens: [],
      },
    });
  } finally {
    context.accessTokens.setPending(false);
    context.render();
  }
}

async function runOperation(
  context: SupplementalControllerContext,
  operation: string,
  options: { readonly backupId?: string; readonly confirm?: boolean } = {},
): Promise<void> {
  context.operations.setPending(true);
  context.render();
  const operationId = createOperationId();
  let operationActive = false;
  writeActiveOperation(operationId);
  try {
    const result = await context.options.runOperation(operation, { ...options, operationId });
    context.operations.setError(null);
    context.operations.setResult(result);
    context.operations.setSnapshot(result.snapshot);
    if (PENDING_OPERATION_STATES.has(result.status)) {
      operationActive = true;
      void pollDeploymentOperation(context, result.operation_id);
    } else {
      clearActiveOperation(result.operation_id);
    }
  } catch (error) {
    context.operations.setError(context.asErrorMessage(error));
    context.operations.setResult({
      status: 'error',
      message: context.asErrorMessage(error),
      operation_id: operationId,
      operation,
      snapshot: context.operations.getSnapshot() ?? {
        backup: { supported: false, entries: [] },
        service: { restart_supported: false, stop_supported: false },
        update: {
          check_supported: false,
          apply_supported: false,
          current_version: 'unknown',
          source: 'unknown',
        },
      },
    });
  } finally {
    if (!operationActive) context.operations.setPending(false);
    context.render();
  }
}

export async function resumeDeploymentOperation(context: SupplementalControllerContext): Promise<void> {
  const operationId = readActiveOperation();
  if (!operationId) return;
  const result = await context.options.loadOperationResult(operationId);
  if (!result) {
    context.operations.setPending(true);
    context.render();
    void pollDeploymentOperation(context, operationId);
    return;
  }
  projectOperationResult(context, result);
  if (PENDING_OPERATION_STATES.has(result.status)) {
    void pollDeploymentOperation(context, operationId);
  } else {
    clearActiveOperation(operationId);
  }
}

export async function pollDeploymentOperation(
  context: SupplementalControllerContext,
  operationId: string,
  options: {
    readonly maxAttempts?: number;
    readonly delay?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<DeploymentOperationResult | null> {
  const delay = options.delay || ((milliseconds: number) => (
    new Promise((resolve) => setTimeout(resolve, milliseconds))
  ));
  const maxAttempts = options.maxAttempts ?? 600;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (readActiveOperation() !== operationId) return null;
    const result = await context.options.loadOperationResult(operationId).catch(() => null);
    if (result) {
      projectOperationResult(context, result);
      if (!PENDING_OPERATION_STATES.has(result.status)) {
        clearActiveOperation(operationId);
        return result;
      }
    }
    await delay(1000);
  }
  context.operations.setError('operation 查询超时；保留 operation_id，可在重连后继续查询。');
  context.render();
  return null;
}

function projectOperationResult(
  context: SupplementalControllerContext,
  result: DeploymentOperationResult,
): void {
  context.operations.setError(null);
  context.operations.setResult(result);
  context.operations.setSnapshot(result.snapshot);
  context.operations.setPending(PENDING_OPERATION_STATES.has(result.status));
  context.render();
}

function createOperationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `deployment_op_${uuid}`;
}

function readActiveOperation(): string {
  try {
    return globalThis.localStorage?.getItem(ACTIVE_OPERATION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function writeActiveOperation(operationId: string): void {
  try {
    globalThis.localStorage?.setItem(ACTIVE_OPERATION_STORAGE_KEY, operationId);
  } catch {
    // localStorage 不可用时仍由当前响应投影，但不能声称可跨重连恢复。
  }
}

function clearActiveOperation(operationId: string): void {
  try {
    if (readActiveOperation() === operationId) {
      globalThis.localStorage?.removeItem(ACTIVE_OPERATION_STORAGE_KEY);
    }
  } catch {
    // 清理失败不会改变宿主 operation 终态。
  }
}
