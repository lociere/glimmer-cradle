import fs from 'node:fs';
import path from 'node:path';
import { readJson, toRepoPath, walkFiles } from '../file-system.mjs';

const requiredWorkspacePatterns = ['products/**', 'tools/*'];
const legacyRootEntrypoints = [
  'scripts/check-architecture.mjs',
  'scripts/check-no-bom.mjs',
  'scripts/launch-product.mjs',
];
const repositoryToolReferences = [
  '@glimmer-cradle/repo-checks',
  '@glimmer-cradle/workspace-supervisor',
  'tools/repo-checks',
  'tools/workspace-supervisor',
];
const repositoryReferences = [...legacyRootEntrypoints, ...repositoryToolReferences];

// Source-only smoke composition exercises the development supervisor and is not shipped in product files.
const allowedDevelopmentToolReferences = new Map([
  ['products/personal-server/scripts/smoke.mjs', new Set(['tools/workspace-supervisor'])],
]);
const allowedRootFacadeReferences = new Map([
  ['check:architecture', new Set(['@glimmer-cradle/repo-checks'])],
  ['check:encoding', new Set(['@glimmer-cradle/repo-checks'])],
  ['dev', new Set(['@glimmer-cradle/workspace-supervisor'])],
  ['dev:all', new Set(['@glimmer-cradle/workspace-supervisor'])],
  ['dev:desktop', new Set(['@glimmer-cradle/workspace-supervisor'])],
  ['dev:personal-server', new Set(['@glimmer-cradle/workspace-supervisor'])],
  ['start:desktop', new Set(['@glimmer-cradle/workspace-supervisor'])],
  ['start:personal-server', new Set(['@glimmer-cradle/workspace-supervisor'])],
  ['chat', new Set(['@glimmer-cradle/workspace-supervisor'])],
  ['test:tooling', new Set([
    '@glimmer-cradle/repo-checks', '@glimmer-cradle/workspace-supervisor',
  ])],
]);

// Accepted ADR bodies preserve the decision context that ADR-0016 superseded.
const acceptedAdrLegacyReferences = new Map([
  ['docs/architecture/decisions/ADR-0009-本地监督树与动态端点治理.md', new Set([
    'scripts/launch-product.mjs',
  ])],
  ['docs/architecture/decisions/ADR-0010-产品组合与扩展仓库边界.md', new Set([
    'scripts/launch-product.mjs',
  ])],
]);

const skippedDirectories = new Set([
  '.git', '.venv', 'Library', 'Temp', 'build', 'dist', 'node_modules',
]);
const artifactRoots = [
  '.github', 'configs', 'contracts', 'core', 'deploy', 'engines', 'hosts',
  'native', 'packages', 'products', 'templates',
];
const artifactTextExtensions = new Set([
  '.cjs', '.cs', '.iss', '.js', '.json', '.mjs', '.nsi', '.ps1', '.py', '.sh', '.toml',
  '.ts', '.tsx', '.wxs', '.yaml', '.yml',
]);

function parseWorkspacePatterns(workspaceText) {
  const patterns = [];
  let inPackages = false;
  for (const line of workspaceText.split(/\r?\n/)) {
    if (!inPackages) {
      if (/^packages:\s*(?:#.*)?$/.test(line)) inPackages = true;
      continue;
    }
    if (/^\S/.test(line)) break;
    const match = line.match(/^\s*-\s*(?:'([^']+)'|"([^"]+)"|([^\s#]+))\s*(?:#.*)?$/);
    if (match) patterns.push(match[1] ?? match[2] ?? match[3]);
  }
  return patterns;
}

function isLegacyExtensionsPattern(workspacePattern) {
  const normalized = workspacePattern.replaceAll('\\', '/').replace(/^!/, '').replace(/^\.\//, '').toLowerCase();
  return normalized === 'extensions' || normalized.startsWith('extensions/');
}

function isTestOrFixture(relativePath) {
  return relativePath.includes('/tests/')
    || relativePath.includes('/test/')
    || relativePath.includes('/fixtures/')
    || /(?:^|\/)[^/]+\.(?:spec|test)\.[^/]+$/.test(relativePath);
}

function isArtifactConsumer(relativePath) {
  if (isTestOrFixture(relativePath)) return false;
  const normalized = relativePath.replaceAll('\\', '/');
  const basename = path.posix.basename(normalized);
  const extension = path.posix.extname(normalized).toLowerCase();
  if (!artifactTextExtensions.has(extension) && basename !== 'Dockerfile') return false;
  if (normalized.startsWith('.github/workflows/') || normalized.startsWith('deploy/')) return true;
  if (normalized.startsWith('configs/')) return true;
  if (basename === 'package.json' || basename === 'Dockerfile') return true;
  if (/(?:^|\/)(?:src|scripts|container|installer|installers|packaging)(?:\/|$)/.test(normalized)) return true;
  if (/electron-builder|(?:^|[-_.])(?:artifact|image|install|package|release)(?:[-_.]|$)/i.test(basename)) return true;
  return false;
}

function normalizeReferenceText(value) {
  return value.replace(/\\\\/g, '\\').replaceAll('\\', '/').replace(/\/{2,}/g, '/');
}

function parseQuotedLiteral(value) {
  const text = value.trim();
  const quote = text[0];
  if (!['\'', '"', '`'].includes(quote)) return null;
  let result = '';
  for (let index = 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === quote) {
      if (text.slice(index + 1).trim().length > 0) return null;
      if (quote === '`' && result.includes('${')) return null;
      return result;
    }
    if (character === '\\' && index + 1 < text.length) {
      const next = text[index + 1];
      if (next === '\\' || next === '/' || next === quote) {
        result += next;
        index += 1;
        continue;
      }
    }
    result += character;
  }
  return null;
}

function readCallArguments(source, openParenthesis) {
  let depth = 1;
  let quote = null;
  let escaped = false;
  for (let index = openParenthesis + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (['\'', '"', '`'].includes(character)) {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParenthesis + 1, index);
    }
  }
  return null;
}

function splitTopLevelArguments(argumentsText) {
  const argumentsList = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < argumentsText.length; index += 1) {
    const character = argumentsText[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (['\'', '"', '`'].includes(character)) {
      quote = character;
      continue;
    }
    if (['(', '[', '{'].includes(character)) depth += 1;
    else if ([')', ']', '}'].includes(character)) depth -= 1;
    else if (character === ',' && depth === 0) {
      argumentsList.push(argumentsText.slice(start, index));
      start = index + 1;
    }
  }
  argumentsList.push(argumentsText.slice(start));
  return argumentsList;
}

// Only complete literal arguments in path.join/resolve may form a path; dynamic arguments break the group.
function joinedLiteralPathCandidates(source) {
  const candidates = [];
  const callPattern = /\bpath\s*\.\s*(?:join|resolve)\s*\(/g;
  for (const match of source.matchAll(callPattern)) {
    const openParenthesis = match.index + match[0].lastIndexOf('(');
    const argumentsText = readCallArguments(source, openParenthesis);
    if (argumentsText === null) continue;
    let adjacentSegments = [];
    const flushSegments = () => {
      if (adjacentSegments.length > 0) {
        candidates.push(normalizeReferenceText(adjacentSegments.join('/')));
        adjacentSegments = [];
      }
    };
    for (const argument of splitTopLevelArguments(argumentsText)) {
      const literal = parseQuotedLiteral(argument);
      if (literal === null) flushSegments();
      else adjacentSegments.push(literal.replace(/^[/\\]+|[/\\]+$/g, ''));
    }
    flushSegments();
  }
  return candidates;
}

function containsCanonicalReference(candidate, reference) {
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9_.@-])${escaped}(?=$|[/\\s'"\`),:;\\]}])`, 'm')
    .test(normalizeReferenceText(candidate));
}

export function findCanonicalRepositoryReferences(source) {
  const candidates = [source, ...joinedLiteralPathCandidates(source)];
  return repositoryReferences.filter((reference) => (
    candidates.some((candidate) => containsCanonicalReference(candidate, reference))
  ));
}

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function activeArtifactConsumers(repositoryRoot) {
  const files = [];
  const rootManifest = path.join(repositoryRoot, 'package.json');
  if (fs.existsSync(rootManifest)) files.push(rootManifest);
  for (const relativeRoot of artifactRoots) {
    for (const filePath of walkFiles(path.join(repositoryRoot, relativeRoot), { skip: skippedDirectories })) {
      const relativePath = toRepoPath(repositoryRoot, filePath);
      if (isArtifactConsumer(relativePath)) files.push(filePath);
    }
  }
  return files;
}

function activeDocumentation(repositoryRoot) {
  const files = [];
  const readmePath = path.join(repositoryRoot, 'README.md');
  if (fs.existsSync(readmePath)) files.push(readmePath);
  const docsRoot = path.join(repositoryRoot, 'docs');
  for (const filePath of walkFiles(docsRoot, { skip: new Set([...skippedDirectories, 'history']) })) {
    if (path.extname(filePath).toLowerCase() === '.md') files.push(filePath);
  }
  return files;
}

function checkLegacyConsumers(repositoryRoot, consumerFiles) {
  const violations = [];
  const rootManifest = path.join(repositoryRoot, 'package.json');
  const files = new Set([...consumerFiles, ...activeDocumentation(repositoryRoot)]);
  if (fs.existsSync(rootManifest)) files.add(rootManifest);
  for (const filePath of files) {
    const relativePath = toRepoPath(repositoryRoot, filePath);
    const references = findCanonicalRepositoryReferences(readSource(filePath));
    for (const legacyEntrypoint of references.filter((item) => legacyRootEntrypoints.includes(item))) {
      if (acceptedAdrLegacyReferences.get(relativePath)?.has(legacyEntrypoint)) continue;
      violations.push(`${relativePath}: active consumer/fact source 不得引用已删除入口 ${legacyEntrypoint}`);
    }
  }
  return violations;
}

function checkRepositoryToolConsumers(repositoryRoot, consumerFiles) {
  const violations = [];
  for (const filePath of consumerFiles) {
    const relativePath = toRepoPath(repositoryRoot, filePath);
    if (relativePath === 'package.json') {
      const manifest = readJson(filePath);
      const nonFacadeFields = { ...manifest };
      delete nonFacadeFields.scripts;
      const nonFacadeReferences = findCanonicalRepositoryReferences(JSON.stringify(nonFacadeFields));
      for (const reference of nonFacadeReferences.filter((item) => repositoryToolReferences.includes(item))) {
        violations.push(`package.json: root 非 façade 字段不得消费私有仓库工具 ${reference}`);
      }
      for (const [scriptName, command] of Object.entries(manifest.scripts ?? {})) {
        const commandReferences = findCanonicalRepositoryReferences(String(command));
        for (const reference of commandReferences.filter((item) => repositoryToolReferences.includes(item))) {
          if (!allowedRootFacadeReferences.get(scriptName)?.has(reference)) {
            violations.push(`package.json#scripts.${scriptName}: root 仅允许既定 façade 消费私有仓库工具 ${reference}`);
          }
        }
      }
      continue;
    }
    const references = findCanonicalRepositoryReferences(readSource(filePath));
    for (const reference of references.filter((item) => repositoryToolReferences.includes(item))) {
      if (allowedDevelopmentToolReferences.get(relativePath)?.has(reference)) continue;
      violations.push(`${relativePath}: runtime/package/deploy/workflow/installer/OCI 不得消费私有仓库工具 ${reference}`);
    }
  }
  return violations;
}

export function checkWorkspaceArtifactBoundaries(repositoryRoot) {
  const violations = [];
  const workspacePath = path.join(repositoryRoot, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspacePath)) {
    return ['pnpm-workspace.yaml: workspace 事实源缺失'];
  }

  const workspaceText = fs.readFileSync(workspacePath, 'utf8');
  const workspacePatterns = parseWorkspacePatterns(workspaceText);
  for (const requiredPattern of requiredWorkspacePatterns) {
    if (!workspacePatterns.includes(requiredPattern)) {
      violations.push(`pnpm-workspace.yaml: 必须包含 ${requiredPattern}`);
    }
  }
  for (const workspacePattern of workspacePatterns) {
    if (isLegacyExtensionsPattern(workspacePattern)) {
      violations.push(`pnpm-workspace.yaml: 不得恢复 legacy Extension workspace pattern ${workspacePattern}`);
    }
  }
  if (!/^injectWorkspacePackages:\s*true\s*(?:#.*)?$/m.test(workspaceText)) {
    violations.push('pnpm-workspace.yaml: injectWorkspacePackages 必须为 true，以固定发行 workspace 注入语义');
  }

  const consumerFiles = activeArtifactConsumers(repositoryRoot);
  violations.push(...checkLegacyConsumers(repositoryRoot, consumerFiles));
  violations.push(...checkRepositoryToolConsumers(repositoryRoot, consumerFiles));
  return violations;
}
