import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));
const rootVersion = readJson('package.json').version;
const violations = [];

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rootVersion)) {
  violations.push(`package.json: 非法语义化版本 ${rootVersion}`);
}

for (const relativePath of [
  'protocol/package.json',
  'core/kernel/package.json',
  'products/desktop/package.json',
  'products/personal-server/package.json',
  'packages/extension-sdk/package.json',
  'native/package.manifest.json',
]) {
  const version = readJson(relativePath).version;
  if (version !== rootVersion) {
    violations.push(`${relativePath}: ${version} != ${rootVersion}`);
  }
}

for (const relativePath of [
  'core/cognition/pyproject.toml',
  'engines/audio/pyproject.toml',
]) {
  const version = read(relativePath).match(/^version = "([^"]+)"$/m)?.[1];
  if (version !== rootVersion) {
    violations.push(`${relativePath}: ${version ?? 'missing'} != ${rootVersion}`);
  }
}

const expectedFacts = [
  ['configs/system/identity.yaml', `app_version: "${rootVersion}"`],
  ['protocol/src/schemas/config/AppConfig.schema.json', `"default": "${rootVersion}"`],
  ['engines/audio/src/glimmer_cradle/audio/__init__.py', `__version__ = "${rootVersion}"`],
  ['core/kernel/src/application/skill-plane/providers/mcp-server/mcp-server-connection.ts', `version: '${rootVersion}'`],
  ['core/avatar/unity-host/Assets/StreamingAssets/avatar-host.json', `"hostVersion": "${rootVersion}"`],
  ['core/avatar/unity-host/Assets/Scripts/Avatar/Host/UnityAvatarHostConfig.cs', `hostVersion = "${rootVersion}"`],
  ['core/avatar/unity-host/Assets/Scripts/Avatar/Host/AvatarProtocolClient.cs', `hostVersion = "${rootVersion}"`],
  ['core/avatar/unity-host/Assets/Scenes/UnityAvatarHost.unity', `hostVersion: ${rootVersion}`],
  ['deploy/personal-server/.env.example', `GLIMMER_CRADLE_IMAGE=glimmer-cradle/personal-server:${rootVersion}`],
  ['deploy/personal-server/compose.yaml', `glimmer-cradle/personal-server:${rootVersion}`],
  ['deploy/personal-server/package-release.sh', `printf '%s\\n' "$RELEASE_VERSION" > "$PAYLOAD_ROOT/VERSION"`],
];

for (const [relativePath, expected] of expectedFacts) {
  if (!read(relativePath).includes(expected)) {
    violations.push(`${relativePath}: 缺少发行版本事实 ${expected}`);
  }
}

const deployScript = read('deploy/personal-server/deploy.sh');
const deployVersionFacts = [
  'resolve_release_version()',
  'local packaged_version_file="${SCRIPT_DIR}/VERSION"',
  'local source_package_file="${REPO_ROOT}/package.json"',
  'RELEASE_VERSION="$(resolve_release_version)"',
  'GLIMMER_CRADLE_IMAGE "${IMAGE_REPOSITORY}:${RELEASE_VERSION}"',
  'read_env GLIMMER_CRADLE_IMAGE "${IMAGE_REPOSITORY}:${RELEASE_VERSION}"',
  `printf '%s:%s-%s%s-%s' "$IMAGE_REPOSITORY" "$RELEASE_VERSION"`,
];
for (const expected of deployVersionFacts) {
  if (!deployScript.includes(expected)) {
    violations.push(`deploy/personal-server/deploy.sh: 缺少版本解析不变量 ${expected}`);
  }
}
const hardcodedDeployVersions = deployScript.match(
  /(?<![\d.])\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?(?![\d.])/g,
) ?? [];
if (hardcodedDeployVersions.length > 0) {
  violations.push(
    `deploy/personal-server/deploy.sh: 禁止活跃硬编码发行版本 ${[...new Set(hardcodedDeployVersions)].join(', ')}`,
  );
}

if (violations.length > 0) {
  console.error('固定版本一致性检查失败：');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`固定版本一致性检查通过：${rootVersion}`);
