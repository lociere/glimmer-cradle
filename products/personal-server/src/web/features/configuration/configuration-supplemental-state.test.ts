import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshSupplementalSnapshots } from './configuration-supplemental-state';

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
