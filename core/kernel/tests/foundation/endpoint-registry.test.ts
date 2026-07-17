import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EndpointRegistry, type LocalEndpointCatalog } from '../../src/foundation/endpoints/endpoint-registry';

let tempRoot = '';
const originalDataRoot = process.env.GLIMMER_CRADLE_DATA_ROOT;
const originalRunRoot = process.env.GLIMMER_CRADLE_RUN_ROOT;

afterEach(async () => {
  await EndpointRegistry.instance.close();
  if (originalDataRoot === undefined) delete process.env.GLIMMER_CRADLE_DATA_ROOT;
  else process.env.GLIMMER_CRADLE_DATA_ROOT = originalDataRoot;
  if (originalRunRoot === undefined) delete process.env.GLIMMER_CRADLE_RUN_ROOT;
  else process.env.GLIMMER_CRADLE_RUN_ROOT = originalRunRoot;
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

describe('EndpointRegistry', () => {
  it('原子发布 Kernel 所有者的动态回环端点并支持撤销', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'glimmer-endpoints-'));
    process.env.GLIMMER_CRADLE_DATA_ROOT = tempRoot;
    delete process.env.GLIMMER_CRADLE_RUN_ROOT;

    await EndpointRegistry.instance.publish('control-surface', 'ws://127.0.0.1:49152');
    await EndpointRegistry.instance.publish('cognition-rpc', 'tcp://127.0.0.1:49153');

    const catalogPath = path.join(tempRoot, 'run', 'host', 'endpoints.json');
    const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8')) as LocalEndpointCatalog;
    expect(catalog.owner_pid).toBe(process.pid);
    expect(catalog.endpoints.map((item) => item.purpose)).toEqual(['cognition-rpc', 'control-surface']);
    expect(catalog.endpoints.every((item) => item.generation === catalog.generation)).toBe(true);

    await EndpointRegistry.instance.revoke('control-surface');
    const next = JSON.parse(await fs.readFile(catalogPath, 'utf8')) as LocalEndpointCatalog;
    expect(next.endpoints.map((item) => item.purpose)).toEqual(['cognition-rpc']);

    await EndpointRegistry.instance.revoke('cognition-rpc');
    await expect(fs.access(catalogPath)).rejects.toThrow();
  });

  it('拒绝发布可被局域网访问的内部端点', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'glimmer-endpoints-'));
    process.env.GLIMMER_CRADLE_DATA_ROOT = tempRoot;
    delete process.env.GLIMMER_CRADLE_RUN_ROOT;
    await expect(
      EndpointRegistry.instance.publish('avatar-host', 'ws://0.0.0.0:49154'),
    ).rejects.toThrow('内部端点必须绑定回环地址');
  });
});
