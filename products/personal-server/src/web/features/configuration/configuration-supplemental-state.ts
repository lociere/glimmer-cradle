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
      options?: { readonly backupId?: string; readonly confirm?: boolean },
    ) => Promise<DeploymentOperationResult>;
    readonly loadSkillCatalog: () => Promise<SkillCatalogLoadResult>;
  };
  readonly render: () => void;
  readonly asErrorMessage: (error: unknown) => string;
  readonly accessTokens: {
    getSnapshot: () => AccessTokenSnapshot | null;
    setSnapshot: (value: AccessTokenSnapshot | null) => void;
    setResult: (value: AccessTokenMutationResult | null) => void;
    setPending: (value: boolean) => void;
  };
  readonly operations: {
    getSnapshot: () => DeploymentOperationsSnapshot | null;
    setSnapshot: (value: DeploymentOperationsSnapshot | null) => void;
    setResult: (value: DeploymentOperationResult | null) => void;
    setPending: (value: boolean) => void;
  };
  readonly skills: {
    getCatalog: () => SkillCatalogLoadResult | null;
    setCatalog: (value: SkillCatalogLoadResult | null) => void;
    setPending: (value: boolean) => void;
  };
}

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
  const snapshot = await context.options.loadAccessTokens();
  context.accessTokens.setSnapshot(snapshot);
  context.render();
}

async function refreshOperations(context: SupplementalControllerContext): Promise<void> {
  const snapshot = await context.options.loadOperations();
  context.operations.setSnapshot(snapshot);
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
    context.accessTokens.setResult(result);
    context.accessTokens.setSnapshot(result.snapshot);
  } catch (error) {
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
  try {
    const result = await context.options.runOperation(operation, options);
    context.operations.setResult(result);
    context.operations.setSnapshot(result.snapshot);
  } catch (error) {
    context.operations.setResult({
      status: 'error',
      message: context.asErrorMessage(error),
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
    context.operations.setPending(false);
    context.render();
  }
}
