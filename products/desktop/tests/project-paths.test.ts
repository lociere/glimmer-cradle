import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveDesktopProjectRoots } from '../src/main/project-paths.ts';

test('安装态显式根将只读资源与用户可写 data/run/configs 分离', () => {
  const resources = path.resolve('C:/Program Files/Glimmer Cradle/resources');
  const userRoot = path.resolve('C:/Users/test/AppData/Roaming/Glimmer Cradle');
  const roots = resolveDesktopProjectRoots({
    cwd: resources,
    dirName: resources,
    configuredAppRoot: resources,
    configuredDataRoot: path.join(userRoot, 'data'),
    configuredRunRoot: path.join(userRoot, 'run'),
    configuredConfigRoot: path.join(userRoot, 'configs'),
  });

  assert.equal(roots.repoRoot, resources);
  assert.equal(roots.dataRoot, path.join(userRoot, 'data'));
  assert.equal(roots.runRoot, path.join(userRoot, 'run'));
  assert.equal(roots.configRoot, path.join(userRoot, 'configs'));
  assert.equal(roots.extensionsRoot, path.join(userRoot, 'data', 'packages', 'extensions'));
});
