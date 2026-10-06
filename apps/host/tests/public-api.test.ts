import { it, expect } from 'vitest';
import * as api from '../src/index.js';

it('Host 暴露实际 App adapter/client，而不把 Kernel 内部或 DB 变为公共入口', () => {
  expect(Object.keys(api).sort()).toEqual(['CognitionClient', 'CognitionJobAdapter', 'HostCognitionError',
    'MEMORY_JOB_KIND', 'memoryJobEvidence', 'memoryJobIdentity', 'memoryJobRequest'].sort());
});
