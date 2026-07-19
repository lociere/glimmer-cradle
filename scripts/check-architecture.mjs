import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const violations = [];

const removedWorkspaceFiles = [
  'protocol/project.json',
  'core/kernel/project.json',
  'products/desktop/project.json',
  'core/desktop',
  'extensions',
  'products/server',
  'protocol/build',
  'out',
  'core/kernel/src/core',
  'core/kernel/src/sdk',
  'packages/extension-contracts',
  'products/product.schema.json',
  'core/cognition/src/cognition_core',
  'engines/audio/src/audio_engine',
  'data/artifacts',
  'data/backup',
  'data/blobs',
  'data/tmp',
  'data/legacy',
  'output',
  '.tmp',
  '.agents',
  'scripts/launch-local.mjs',
  'core/cognition/project.json',
  'core/kernel/src/foundation/config/config-defaults.ts',
  'core/kernel/src/foundation/native/native-loader.ts',
  'core/kernel/src/application/capabilities/audio/asr-engines/native-asr-engine.ts',
  'core/kernel/src/application/capabilities/audio/tts-engines/native-tts-engine.ts',
  'core/kernel/src/application/capabilities/audio/tts-engines/edge-tts-engine.ts',
  'core/kernel/src/application/capabilities/audio/tts-engines/sapi-engine.ts',
  'core/kernel/src/application/capabilities/audio/asr-engines/whisper-engine.ts',
  'engines/audio/src/glimmer_cradle/audio/tts/cosyvoice_engine.py',
  'engines/audio/src/glimmer_cradle/audio/tts/gpt_sovits_engine.py',
  'engines/audio/src/glimmer_cradle/audio/tts/gpt_sovits_sidecar.py',
  'native/src/platform_native.c',
];

const requiredWorkspaceDirectories = [
  'products/desktop',
  'products/personal-server',
  'products/personal-server/src/server',
  'products/personal-server/src/web',
  'products/personal-server/src/web/features/conversation',
  'products/personal-server/src/web/features/configuration/audio',
  'products/personal-server/src/web/features/configuration/memory',
  'products/personal-server/src/web/features/configuration/model-routing',
  'products/personal-server/src/web/features/configuration/providers',
  'products/personal-server/src/web/features/configuration/storage',
  'products/personal-server/src/web/features/configuration/updates',
  'core/kernel/src/application',
  'core/kernel/src/composition',
  'core/kernel/src/domain',
  'core/kernel/src/foundation',
  'core/kernel/src/host',
  'core/kernel/src/infrastructure',
  'core/kernel/src/lifecycle',
  'core/cognition/src/glimmer_cradle/cognition',
  'engines/audio/src/glimmer_cradle/audio',
  'protocol/codegen',
  'packages/extension-sdk',
  'templates/extension-basic',
];

for (const relativePath of requiredWorkspaceDirectories) {
  if (!fs.existsSync(path.join(repoRoot, relativePath))) {
    violations.push(`${relativePath}: 最终架构目录缺失`);
  }
}

for (const relativePath of removedWorkspaceFiles) {
  if (fs.existsSync(path.join(repoRoot, relativePath))) {
    violations.push(`${relativePath}: 已删除的架构入口被重新引入`);
  }
}

for (const productId of ['desktop', 'personal-server']) {
  const manifestPath = path.join(repoRoot, 'products', productId, 'product.json');
  if (!fs.existsSync(manifestPath)) {
    violations.push(`products/${productId}/product.json: 产品组合清单缺失`);
    continue;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.id !== productId || manifest.schema_version !== 1) {
    violations.push(`products/${productId}/product.json: 产品 ID 或 schema_version 无效`);
  }
}

const personalServerProduct = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'products/personal-server/product.json'), 'utf8'),
);
if (personalServerProduct.features?.avatar !== false) {
  violations.push('products/personal-server/product.json: Personal Server 不得启动本机 Avatar');
}
if (personalServerProduct.features?.local_device_actions !== false) {
  violations.push('products/personal-server/product.json: Personal Server 不得投影 Desktop 本机设备 Skill');
}
if (personalServerProduct.features?.audio?.asr !== false) {
  violations.push('products/personal-server/product.json: 标准 Personal Server 不得组装本地 ASR lane');
}
if (personalServerProduct.features?.audio?.tts !== true) {
  violations.push('products/personal-server/product.json: 标准 Personal Server 必须组装云端 TTS lane');
}

for (const forbiddenLegacyUiFile of [
  'products/personal-server/public/app.js',
  'products/personal-server/public/app.css',
]) {
  if (fs.existsSync(path.join(repoRoot, forbiddenLegacyUiFile))) {
    violations.push(`${forbiddenLegacyUiFile}: M11 后不得继续保留 public 单体业务入口`);
  }
}
for (const filePath of walkFiles(path.join(repoRoot, 'products/personal-server/public'))) {
  const relativePath = toRepoPath(filePath);
  if (relativePath === 'products/personal-server/public/index.html') continue;
  if (/\.(?:js|jsx|ts|tsx|css|scss|sass|less)$/i.test(relativePath)) {
    violations.push(`${relativePath}: Personal Server 浏览器业务不得重新写回 public 目录`);
  }
}

const audioConfig = fs.readFileSync(path.join(repoRoot, 'configs/system/audio.yaml'), 'utf8');
if (!/^tts:\s*\r?\n\s+enabled:\s+false\s*$/m.test(audioConfig)
  || !/^asr:\s*\r?\n\s+enabled:\s+false\s*$/m.test(audioConfig)) {
  violations.push('configs/system/audio.yaml: TTS/ASR 必须默认关闭并作为可选增强');
}
const embeddingConfig = fs.readFileSync(path.join(repoRoot, 'configs/system/embedding.yaml'), 'utf8');
if (!/^enabled:\s+false\s*$/m.test(embeddingConfig)) {
  violations.push('configs/system/embedding.yaml: Embedding 必须默认关闭');
}
const defaultInference = fs.readFileSync(
  path.join(repoRoot, 'configs/characters/selrena/inference.yaml'),
  'utf8',
);
if (/^embedding\s*:/m.test(defaultInference)) {
  violations.push('configs/characters/selrena/inference.yaml: 系统 Embedding 配置不得回流到角色推理配置');
}

const workspaceManifest = fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
if (!workspaceManifest.includes("'products/**'")) {
  violations.push('pnpm-workspace.yaml: 必须包含 products/** 产品组合');
}
if (/['"]extensions\//.test(workspaceManifest)) {
  violations.push('pnpm-workspace.yaml: 主仓库不得包含扩展源码 workspace');
}
if (!/^injectWorkspacePackages:\s*true\s*$/m.test(workspaceManifest)) {
  violations.push('pnpm-workspace.yaml: 发行投影必须注入 workspace 私有包');
}

const personalServerDockerfile = fs.readFileSync(
  path.join(repoRoot, 'deploy/personal-server/Dockerfile'),
  'utf8',
);

const personalServerInstaller = fs.readFileSync(
  path.join(repoRoot, 'deploy/personal-server/install.sh'),
  'utf8',
);
const personalServerBootstrap = fs.readFileSync(
  path.join(repoRoot, 'deploy/personal-server/bootstrap-host.sh'),
  'utf8',
);
if (/hello-world|registry-1\.docker\.io/.test(personalServerBootstrap)
  || !personalServerBootstrap.includes('docker info >/dev/null')) {
  violations.push('deploy/personal-server/bootstrap-host.sh: 主机就绪检查不得依赖外部测试镜像');
}
if (!personalServerInstaller.includes('bootstrap-host.sh')
  || !personalServerInstaller.includes('deploy.sh" install')) {
  violations.push('deploy/personal-server/install.sh: 必须统一编排宿主初始化与首次安装事务');
}
for (const requiredReleaseFile of [
  'deploy/personal-server/install-release.sh',
  'deploy/personal-server/package-release.sh',
  'deploy/personal-server/compose.source.yaml',
  '.github/workflows/release-personal-server.yml',
]) {
  if (!fs.existsSync(path.join(repoRoot, requiredReleaseFile))) {
    violations.push(`${requiredReleaseFile}: Personal Server 版本化发布链路缺失`);
  }
}
const personalServerReleaseInstaller = fs.readFileSync(
  path.join(repoRoot, 'deploy/personal-server/install-release.sh'),
  'utf8',
);
if (!personalServerReleaseInstaller.includes('GLIMMER_CRADLE_RELEASE_SOURCE')
  || !personalServerReleaseInstaller.includes('GLIMMER_CRADLE_PACKAGE_VARIANT')
  || !personalServerReleaseInstaller.includes('GLIMMER_CRADLE_CANDIDATE_IMAGE')
  || !personalServerReleaseInstaller.includes('GLIMMER_CRADLE_GITHUB_TOKEN')
  || !personalServerReleaseInstaller.includes('SHA256SUMS')
  || !personalServerReleaseInstaller.includes('sha256sum --check')
  || !personalServerReleaseInstaller.includes('docker load --input')
  || !personalServerReleaseInstaller.includes('trap cleanup EXIT')
  || !personalServerReleaseInstaller.includes('handle_signal TERM 143')
  || personalServerReleaseInstaller.includes('trap cleanup EXIT INT TERM')
  || !personalServerReleaseInstaller.includes('GLIMMER_CRADLE_DEPLOY_RESULT_FILE')
  || !personalServerReleaseInstaller.includes('.release-sha256')) {
  violations.push('deploy/personal-server/install-release.sh: 远程安装必须支持可信下载源、镜像覆盖和摘要校验');
}
const personalServerReleasePackager = fs.readFileSync(
  path.join(repoRoot, 'deploy/personal-server/package-release.sh'),
  'utf8',
);
if (!personalServerReleasePackager.includes('glimmer-cradle-personal-server-v${RELEASE_VERSION}-${RELEASE_TARGET}.tar.gz')
  || !personalServerReleasePackager.includes('glimmer-cradle-personal-server-v${RELEASE_VERSION}-${RELEASE_TARGET}-full.tar.gz')
  || !personalServerReleasePackager.includes('personal-server-linux-amd64.tar')
  || !personalServerReleasePackager.includes('ARCHIVE_IMAGE')
  || !personalServerReleasePackager.includes('IMAGE_ID')
  || !personalServerReleasePackager.includes('glimmer-cradle-installer.sh')
  || !personalServerReleasePackager.includes('SHA256SUMS')
  || !personalServerReleasePackager.includes('GLIMMER_CRADLE_CADDY_IMAGE=${IMAGE}')
  || !personalServerReleasePackager.includes('@sha256:')) {
  violations.push('deploy/personal-server/package-release.sh: 发布物必须版本化命名、统一校验并固定 OCI digest');
}
const personalServerCompose = fs.readFileSync(
  path.join(repoRoot, 'deploy/personal-server/compose.yaml'),
  'utf8',
);
const personalServerImageDefault = personalServerCompose.match(
  /GLIMMER_CRADLE_IMAGE:-([^}]+)}/,
)?.[1];
const personalServerCaddyImageDefault = personalServerCompose.match(
  /GLIMMER_CRADLE_CADDY_IMAGE:-([^}]+)}/,
)?.[1];
if (!personalServerDockerfile.includes('CADDY_AMD64_SHA512=')
  || !personalServerDockerfile.includes('CADDY_LICENSE_SHA256=')
  || !personalServerDockerfile.includes('COPY --from=caddy-runtime /usr/local/bin/caddy')
  || !personalServerCompose.includes('/usr/local/bin/caddy')
  || !personalServerImageDefault
  || personalServerCaddyImageDefault !== personalServerImageDefault
  || /image:\s*\$\{GLIMMER_CRADLE_CADDY_IMAGE:-caddy:/.test(personalServerCompose)) {
  violations.push('deploy/personal-server: 正式 OCI 必须内含校验后的 Caddy，并保持独立入口进程');
}
if (/pnpm\s+deploy[^\n]*--legacy/.test(personalServerDockerfile)) {
  violations.push('deploy/personal-server/Dockerfile: 不得使用回查 registry 的 legacy deploy');
}
if ((personalServerDockerfile.match(/WORKDIR \/opt\/glimmer-cradle\/app/g) ?? []).length < 2
  || !personalServerDockerfile.includes(
    'COPY --from=python-builder --chown=glimmer:glimmer /opt/glimmer-cradle/app/core/cognition core/cognition',
  )
  || !personalServerDockerfile.includes(
    'COPY --from=python-builder --chown=glimmer:glimmer /opt/glimmer-cradle/app/engines/audio engines/audio',
  )) {
  violations.push('deploy/personal-server/Dockerfile: Python 环境必须在构建和运行阶段保持固定内部路径');
}

const dockerIgnore = fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8');
for (const requiredPattern of [
  'configs/secrets/secrets.yaml',
  'assets/avatar',
  'assets/models',
  'data',
]) {
  if (!dockerIgnore.split(/\r?\n/).includes(requiredPattern)) {
    violations.push(`.dockerignore: 缺少发行敏感边界 ${requiredPattern}`);
  }
}

const activeExtensions = fs.readFileSync(
  path.join(repoRoot, 'configs/extensions/active.yaml'),
  'utf8',
);
if (/^enabled\s*:/m.test(activeExtensions)) {
  violations.push('configs/extensions/active.yaml: 扩展激活项必须使用 active + id/version 精确选择');
}

const genericSourceRoots = [
  'protocol/src',
  'core/kernel/src',
  'products/desktop/src',
  'packages/extension-sdk/src',
];

for (const relativeRoot of genericSourceRoots) {
  for (const filePath of walkFiles(path.join(repoRoot, relativeRoot))) {
    const relativePath = toRepoPath(filePath);
    if (!/\.(?:ts|tsx|js|jsx|json|py)$/.test(filePath)) continue;
    if (/\.test\.[^.]+$/.test(filePath)) continue;
    if (relativePath.startsWith('products/desktop/src/renderer/public/assets/')) continue;
    reportMatches(relativePath, fs.readFileSync(filePath, 'utf8'), /\bselrena\b|月见/gi,
      '平台通用源码不得硬编码具体角色');
  }
}

const desktopMainRoot = path.join(repoRoot, 'products/desktop/src/main');
for (const filePath of walkFiles(desktopMainRoot)) {
  if (!filePath.endsWith('.ts')) continue;
  const relativePath = toRepoPath(filePath);
  if (relativePath === 'products/desktop/src/main/ipc/desktop-ipc-router.ts') continue;
  reportMatches(relativePath, fs.readFileSync(filePath, 'utf8'), /ipcMain\.(?:handle|on)\s*\(/g,
    'Desktop IPC 必须通过 DesktopIpcRouter 注册');
}

const protocolPackage = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'protocol/package.json'), 'utf8'),
);
if (!String(protocolPackage.scripts?.['gen:py'] ?? '').startsWith('uv run --project ')) {
  violations.push('protocol/package.json: gen:py 必须由 Cognition uv project 提供解释器和依赖');
}

const extensionSdkPackage = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'packages/extension-sdk/package.json'), 'utf8'),
);
if (extensionSdkPackage.dependencies?.['@glimmer-cradle/protocol'] !== 'workspace:*') {
  violations.push('packages/extension-sdk/package.json: Extension SDK 必须单向依赖 Protocol');
}

for (const packagePath of [
  'protocol/package.json',
  'core/kernel/package.json',
  'products/desktop/package.json',
  'products/personal-server/package.json',
]) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, packagePath), 'utf8'));
  for (const dependencyField of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    if (manifest[dependencyField]?.['@glimmer-cradle/extension-sdk']) {
      violations.push(`${packagePath}: ${dependencyField} 不得反向依赖 Extension SDK`);
    }
    if (manifest[dependencyField]?.['@glimmer-cradle/extension-contracts']) {
      violations.push(`${packagePath}: 不得重新引入已删除的 extension-contracts`);
    }
  }
}

for (const relativeRoot of [
  'protocol/src',
  'core/kernel/src',
  'products/desktop/src',
  'products/personal-server/src',
]) {
  for (const filePath of walkFiles(path.join(repoRoot, relativeRoot))) {
    if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(filePath)) continue;
    reportMatches(
      toRepoPath(filePath),
      fs.readFileSync(filePath, 'utf8'),
      /(?:from\s+|import\s*\(|require\s*\()\s*['"]@glimmer-cradle\/extension-sdk(?:\/[^'"]*)?['"]/g,
      'Kernel、Protocol 与产品源码不得 import Extension SDK',
    );
  }
}

for (const filePath of walkFiles(path.join(repoRoot, 'products/personal-server/src/server'))) {
  if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(filePath)) continue;
  reportMatches(
    toRepoPath(filePath),
    fs.readFileSync(filePath, 'utf8'),
    /(?:from\s+|import\s*\(|require\s*\()\s*['"][^'"]*\/src\/web\/|(?:from\s+|import\s*\(|require\s*\()\s*['"]\.\.\/(?:\.\.\/)*web\//g,
    'Personal Server server 边界不得 import web 目录',
  );
}

for (const filePath of walkFiles(path.join(repoRoot, 'products/personal-server/src/web'))) {
  if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(filePath)) continue;
  reportMatches(
    toRepoPath(filePath),
    fs.readFileSync(filePath, 'utf8'),
    /(?:from\s+|import\s*\(|require\s*\()\s*['"][^'"]*\/src\/server\/|(?:from\s+|import\s*\(|require\s*\()\s*['"]\.\.\/(?:\.\.\/)*server\//g,
    'Personal Server web 边界不得 import server 目录',
  );
}

enforceMaxFileSize('products/personal-server/src/web/app/bootstrap.ts', 12000,
  'Personal Server bootstrap 只负责组装，不得重新膨胀为巨型业务入口');
enforceMaxFileSize('products/personal-server/src/web/features/configuration/configuration-view.ts', 20000,
  '设置中心总装入口不得重新退化为超大单体；section owner 应继续下沉到 feature 目录');

const nativeHeader = fs.readFileSync(
  path.join(repoRoot, 'native/include/platform_native.h'),
  'utf8',
);
reportMatches('native/include/platform_native.h', nativeHeader, /platform_native_(?:asr|tts)_/g,
  'Native ABI 当前只承载 Avatar Composition，音频能力归 engines/audio');

for (const relativeRoot of [
  'core/kernel/src/application/capabilities/audio',
  'engines/audio/src/glimmer_cradle/audio',
]) {
  for (const filePath of walkFiles(path.join(repoRoot, relativeRoot))) {
    if (!/\.(?:ts|py|json)$/.test(filePath)) continue;
    reportMatches(toRepoPath(filePath), fs.readFileSync(filePath, 'utf8'),
      /gpt-sovits|windows-sapi|edge-tts|whisper-cpp|experimental_tts/gi,
      '旧 Audio provider 不得重新进入正式运行主线');
  }
}

if (violations.length > 0) {
  console.error('架构适配度检查失败：');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('架构适配度检查通过');

function* walkFiles(root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath);
    } else if (entry.isFile()) {
      yield entryPath;
    }
  }
}

function reportMatches(relativePath, content, pattern, message) {
  for (const match of content.matchAll(pattern)) {
    const line = content.slice(0, match.index).split(/\r?\n/).length;
    violations.push(`${relativePath}:${line}: ${message}`);
  }
}

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function enforceMaxFileSize(relativePath, maxBytes, message) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    violations.push(`${relativePath}: 受约束入口缺失`);
    return;
  }
  const size = fs.statSync(absolutePath).size;
  if (size > maxBytes) {
    violations.push(`${relativePath}: ${message}（当前 ${size} bytes，限制 ${maxBytes} bytes）`);
  }
}
