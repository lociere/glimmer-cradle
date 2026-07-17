import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { create } from 'tar';
import { projectUnityPackage } from './unitypackage-projector.mjs';

test('projects Unity package assets and preserves metadata', async (context) => {
  const fixture = await createFixture(context, [
    { id: 'folder', pathname: 'Assets/Live2D/Cubism', metadata: 'folder-guid' },
    {
      id: 'source',
      pathname: 'Assets/Live2D/Cubism/Core.cs',
      asset: 'public class Core {}',
      metadata: 'source-guid',
    },
  ]);

  const result = await projectUnityPackage({
    packagePath: fixture.packagePath,
    projectPath: fixture.projectPath,
    projectionScopes: [
      { kind: 'tree', path: 'Assets/Live2D' },
      { kind: 'file', path: 'Assets/csc.rsp' },
    ],
  });

  assert.equal(result.count, 2);
  assert.equal(
    await fs.readFile(path.join(fixture.projectPath, 'Assets/Live2D/Cubism/Core.cs'), 'utf8'),
    'public class Core {}',
  );
  assert.equal(
    await fs.readFile(path.join(fixture.projectPath, 'Assets/Live2D/Cubism/Core.cs.meta'), 'utf8'),
    'source-guid',
  );
});

test('rejects package assets outside the declared projection scopes', async (context) => {
  const fixture = await createFixture(context, [
    { id: 'outside', pathname: 'Assets/Editor/Unexpected.cs', asset: 'content' },
  ]);

  await assert.rejects(
    projectUnityPackage({
      packagePath: fixture.packagePath,
      projectPath: fixture.projectPath,
      projectionScopes: [{ kind: 'tree', path: 'Assets/Live2D' }],
    }),
    /越过允许投影范围/,
  );
});

test('allows an explicitly declared single file without opening its parent tree', async (context) => {
  const fixture = await createFixture(context, [
    { id: 'compiler', pathname: 'Assets/csc.rsp', asset: '-unsafe' },
  ]);

  await projectUnityPackage({
    packagePath: fixture.packagePath,
    projectPath: fixture.projectPath,
    projectionScopes: [{ kind: 'file', path: 'Assets/csc.rsp' }],
  });

  assert.equal(await fs.readFile(path.join(fixture.projectPath, 'Assets/csc.rsp'), 'utf8'), '-unsafe');
});

async function createFixture(context, entries) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unitypackage-projector-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source');
  const projectPath = path.join(root, 'project');
  const packagePath = path.join(root, 'fixture.unitypackage');
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.mkdir(projectPath, { recursive: true });

  for (const entry of entries) {
    const entryPath = path.join(sourcePath, entry.id);
    await fs.mkdir(entryPath, { recursive: true });
    await fs.writeFile(path.join(entryPath, 'pathname'), entry.pathname, 'utf8');
    if (entry.asset !== undefined) {
      await fs.writeFile(path.join(entryPath, 'asset'), entry.asset, 'utf8');
    }
    if (entry.metadata !== undefined) {
      await fs.writeFile(path.join(entryPath, 'asset.meta'), entry.metadata, 'utf8');
    }
  }

  await create({ cwd: sourcePath, file: packagePath, gzip: true }, entries.map((entry) => entry.id));
  return { packagePath, projectPath };
}
