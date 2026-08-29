import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { serveBuiltWebAsset } from './static-assets';

test('为 BrowserRouter 导航路径提供 no-store index fallback', async () => {
  const publicRoot = await mkdtemp(path.join(tmpdir(), 'personal-server-static-'));
  await mkdir(path.join(publicRoot, 'assets'));
  await writeFile(path.join(publicRoot, 'index.html'), '<!doctype html><title>shell</title>', 'utf8');
  await writeFile(path.join(publicRoot, 'assets', 'app.js'), 'export {};', 'utf8');
  const server = createServer(async (request, response) => {
    const handled = await serveBuiltWebAsset(request.url ?? '/', publicRoot, response);
    if (!handled) {
      response.writeHead(404).end('not found');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    for (const route of ['/conversation', '/overview', '/capabilities', '/activity', '/settings', '/unknown']) {
      const response = await fetch(`${origin}${route}`);
      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('cache-control'), 'no-store', route);
      assert.match(await response.text(), /<title>shell<\/title>/, route);
    }
    assert.equal((await fetch(`${origin}/assets/app.js`)).status, 200);
    assert.equal((await fetch(`${origin}/assets/missing.js`)).status, 404);
    assert.equal((await fetch(`${origin}/api/v1/missing`)).status, 404);
    assert.equal((await fetch(`${origin}/readyz`)).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(publicRoot, { recursive: true, force: true });
  }
});
