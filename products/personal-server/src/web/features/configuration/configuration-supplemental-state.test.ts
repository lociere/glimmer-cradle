import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pollDeploymentOperation,
  refreshSupplementalSnapshots,
  resumeDeploymentOperation,
  type SupplementalControllerContext,
} from './configuration-supplemental-state';

test('refreshSupplementalSnapshots projects access-token and deployment-operation load failures into explicit error state', async () => {
  let accessTokenError: string | null = null;
  let operationsError: string | null = null;
  let skillCatalog: { request_id: string; status: 'success' } | null = null;

  await refreshSupplementalSnapshots({
    root: {} as HTMLElement,
    options: {
      loadAccessTokens: async () => {
        throw new Error('forbidden');
      },
      createAccessToken: async () => {
        throw new Error('not-used');
      },
      rotateAccessToken: async () => {
        throw new Error('not-used');
      },
      revokeAccessToken: async () => {
        throw new Error('not-used');
      },
      loadOperations: async () => {
        throw new Error('host bridge unavailable');
      },
      runOperation: async () => {
        throw new Error('not-used');
      },
      loadOperationResult: async () => null,
      loadSkillCatalog: async () => ({
        request_id: 'skill-catalog-1',
        status: 'success' as const,
      }),
    },
    render: () => undefined,
    asErrorMessage: (error) => error instanceof Error ? error.message : String(error),
    accessTokens: {
      getSnapshot: () => null,
      setSnapshot: () => undefined,
      setResult: () => undefined,
      setPending: () => undefined,
      getError: () => accessTokenError,
      setError: (value) => { accessTokenError = value; },
    },
    operations: {
      getSnapshot: () => null,
      setSnapshot: () => undefined,
      setResult: () => undefined,
      setPending: () => undefined,
      getError: () => operationsError,
      setError: (value) => { operationsError = value; },
    },
    skills: {
      getCatalog: () => skillCatalog,
      setCatalog: (value) => { skillCatalog = value as typeof skillCatalog; },
      setPending: () => undefined,
    },
  });

  assert.equal(accessTokenError, 'forbidden');
  assert.equal(operationsError, 'host bridge unavailable');
  assert.deepEqual(skillCatalog, {
    request_id: 'skill-catalog-1',
    status: 'success',
  });
});

test('Web client 以持久 operation_id 轮询终态并在重连后恢复', async () => {
  const operationId = 'deployment_op_web_resume';
  const storage = new Map<string, string>([
    ['glimmer-cradle.personal-server.active-operation', operationId],
  ]);
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  const statuses = [null, 'started', 'committed'] as const;
  let loads = 0;
  let projectedStatus = '';
  const context = {
    options: {
      loadOperationResult: async (requestedId: string) => {
        assert.equal(requestedId, operationId);
        const status = statuses[Math.min(loads, statuses.length - 1)];
        loads += 1;
        if (!status) return null;
        return {
          status,
          message: status,
          operation_id: operationId,
          operation: 'service.restart',
          snapshot: {
            backup: { supported: true, entries: [] },
            service: { restart_supported: true, stop_supported: true },
            update: {
              check_supported: false,
              apply_supported: false,
              current_version: '0.1.8',
              source: 'fixture',
            },
          },
        };
      },
    },
    operations: {
      setError: () => undefined,
      setResult: (value: { status: string }) => { projectedStatus = value.status; },
      setSnapshot: () => undefined,
      setPending: () => undefined,
    },
    render: () => undefined,
  } as unknown as SupplementalControllerContext;
  try {
    const terminal = await pollDeploymentOperation(context, operationId, {
      maxAttempts: 3,
      delay: async () => undefined,
    });
    assert.equal(terminal?.status, 'committed');
    assert.equal(projectedStatus, 'committed');
    assert.equal(storage.size, 0);

    storage.set('glimmer-cradle.personal-server.active-operation', operationId);
    await resumeDeploymentOperation(context);
    assert.equal(projectedStatus, 'committed');
    assert.equal(storage.size, 0);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousStorage,
    });
  }
});
