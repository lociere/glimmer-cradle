import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestId } from './request-id';

test('createRequestId works when public HTTP does not expose crypto.randomUUID', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  try {
    assert.match(createRequestId('history'), /^history-[a-z0-9]+-[a-f0-9]+$/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
  }
});
