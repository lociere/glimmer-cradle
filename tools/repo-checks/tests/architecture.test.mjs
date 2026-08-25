import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkArchitecture } from '../src/architecture/check-architecture.mjs';
import { checkRepositoryTopology } from '../src/architecture/rules/repository-topology.mjs';
import {
  checkWorkspaceArtifactBoundaries,
  findCanonicalRepositoryReferences,
} from '../src/architecture/rules/workspace-artifact-boundaries.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('当前 repository 满足模块化 architecture rules', () => {
  assert.deepEqual(checkArchitecture(repositoryRoot), []);
});

function writeFixture(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

const validWorkspace = `packages:
  - 'products/**'
  - 'tools/*'

injectWorkspacePackages: true
`;

test('工具拓扑允许未来叶子，并以负向 fixture 固定 workspace/artifact consumer 删除门', () => {
  const leaf = path.join(repositoryRoot, 'tools', 'future-fixture-tool');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'glimmer-workspace-artifact-'));
  const smokePath = 'products/personal-server/scripts/smoke.mjs';
  const smokeReference = `path.join(repoRoot,
    'tools',
    'workspace-supervisor',
    'src', 'cli.mjs')`;
  try {
    fs.mkdirSync(path.join(leaf, 'src'), { recursive: true });
    fs.mkdirSync(path.join(leaf, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(leaf, 'package.json'), JSON.stringify({
      name: '@glimmer-cradle/future-fixture-tool',
      private: true,
      scripts: { test: 'node --test' },
    }));
    assert.deepEqual(checkRepositoryTopology(repositoryRoot), []);
    const realSmoke = fs.readFileSync(path.join(repositoryRoot, smokePath), 'utf8');
    assert.ok(findCanonicalRepositoryReferences(realSmoke).includes('tools/workspace-supervisor'));
    assert.deepEqual(findCanonicalRepositoryReferences("const parts = ['tools', 'repo-checks'];"), []);
    assert.deepEqual(findCanonicalRepositoryReferences(
      "path.join(repoRoot, 'tools', selectedTool, 'repo-checks')",
    ), []);
    assert.deepEqual(findCanonicalRepositoryReferences(
      '// tools/repo-checks\n/* scripts/launch-product.mjs */',
    ), []);
    assert.deepEqual(new Set(findCanonicalRepositoryReferences(
      'const a = "https://host/tools/repo-checks"; const b = "/* tools/workspace-supervisor */";',
    )), new Set(['tools/repo-checks', 'tools/workspace-supervisor']));

    writeFixture(fixture, 'pnpm-workspace.yaml', validWorkspace);
    writeFixture(fixture, 'package.json', JSON.stringify({
      scripts: {
        'check:architecture': 'pnpm --filter @glimmer-cradle/repo-checks --fail-if-no-match run check:architecture',
      },
    }));
    writeFixture(fixture, 'docs/architecture/decisions/ADR-0009-本地监督树与动态端点治理.md',
      '`scripts/launch-product.mjs` 是被 ADR-0016 修订的历史落点。');
    writeFixture(fixture, smokePath, smokeReference);
    assert.ok(findCanonicalRepositoryReferences(smokeReference).includes('tools/workspace-supervisor'));
    assert.deepEqual(checkWorkspaceArtifactBoundaries(fixture), []);

    writeFixture(fixture, smokePath, `${smokeReference}\npath.join(repoRoot, 'tools', 'repo-checks')`);
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('tools/repo-checks')));
    writeFixture(fixture, smokePath, `${smokeReference}\npath.join(repoRoot, 'scripts', 'launch-product.mjs')`);
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('scripts/launch-product.mjs')));
    writeFixture(fixture, smokePath, smokeReference);

    writeFixture(fixture, 'pnpm-workspace.yaml', validWorkspace.replace("  - 'products/**'\n", ''));
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('products/**')));

    writeFixture(fixture, 'pnpm-workspace.yaml', validWorkspace.replace("  - 'tools/*'\n", ''));
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('tools/*')));

    writeFixture(fixture, 'pnpm-workspace.yaml', validWorkspace.replace('true', 'false'));
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('injectWorkspacePackages')));

    writeFixture(fixture, 'pnpm-workspace.yaml', validWorkspace.replace("  - 'tools/*'", "  - 'extensions/**'\n  - 'tools/*'"));
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('legacy Extension workspace')));

    writeFixture(fixture, 'pnpm-workspace.yaml', validWorkspace);
    writeFixture(fixture, '.github/workflows/pr.yml', 'run: node scripts/check-architecture.mjs');
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('scripts/check-architecture.mjs')));
    fs.rmSync(path.join(fixture, '.github'), { recursive: true, force: true });

    writeFixture(fixture, '.github/workflows/pr.yml', `run: |
  node -e "path.resolve(repoRoot,
    'tools',
    'repo-checks',
    'src', 'architecture', 'cli.mjs')"`);
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('tools/repo-checks')));
    fs.rmSync(path.join(fixture, '.github'), { recursive: true, force: true });

    writeFixture(fixture, 'docs/current-runtime.md', '`scripts/check-no-bom.mjs` 仍是当前入口。');
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('docs/current-runtime.md')));
    fs.rmSync(path.join(fixture, 'docs', 'current-runtime.md'));

    writeFixture(fixture, 'deploy/consumer.mjs', `path.join(repoRoot,
      'tools',
      'workspace-supervisor',
      'src', 'cli.mjs')`);
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('tools/workspace-supervisor')));
    writeFixture(fixture, 'deploy/legacy.mjs', `path.join(repoRoot,
      'scripts',
      'launch-product.mjs')`);
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('scripts/launch-product.mjs')));
    writeFixture(fixture, 'deploy/Dockerfile', `RUN node -e "path.resolve(root,
      '@glimmer-cradle',
      'workspace-supervisor')"`);
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('@glimmer-cradle/workspace-supervisor')));
    fs.rmSync(path.join(fixture, 'deploy'), { recursive: true, force: true });

    writeFixture(fixture, 'deploy/commented-paths.mjs', `path.join(repoRoot, 'tools', // grouping, ) "ignored"
      'repo-checks', 'src');
path.join(repoRoot, 'tools',
  // development grouping, ) "ignored"
  'workspace-supervisor', 'src');
path.resolve(repoRoot, 'scripts', /* removed owner, ) "ignored" */ 'launch-product.mjs');`);
    const commentedViolations = checkWorkspaceArtifactBoundaries(fixture);
    assert.ok(commentedViolations.some((item) => item.includes('tools/repo-checks')));
    assert.ok(commentedViolations.some((item) => item.includes('tools/workspace-supervisor')));
    assert.ok(commentedViolations.some((item) => item.includes('scripts/launch-product.mjs')));
    fs.rmSync(path.join(fixture, 'deploy'), { recursive: true, force: true });

    writeFixture(fixture, 'deploy/comment-only.mjs', `// tools/repo-checks
/* path.join(repoRoot, 'scripts', 'launch-product.mjs') */`);
    assert.deepEqual(checkWorkspaceArtifactBoundaries(fixture), []);
    writeFixture(fixture, 'deploy/string-markers.mjs',
      'const a = "https://host/tools/repo-checks"; const b = "/* tools/workspace-supervisor */";');
    const stringMarkerViolations = checkWorkspaceArtifactBoundaries(fixture);
    assert.ok(stringMarkerViolations.some((item) => item.includes('tools/repo-checks')));
    assert.ok(stringMarkerViolations.some((item) => item.includes('tools/workspace-supervisor')));
    fs.rmSync(path.join(fixture, 'deploy'), { recursive: true, force: true });

    writeFixture(fixture, 'products/desktop/installer/setup.iss',
      `Source: "path.join(root, 'tools', 'repo-checks', 'src', 'architecture')"`);
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('tools/repo-checks')));
    writeFixture(fixture, 'products/desktop/installer/setup.iss',
      String.raw`Source: "tools\workspace-supervisor\src\cli.mjs"`);
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('tools/workspace-supervisor')));

    writeFixture(fixture, 'package.json', JSON.stringify({
      scripts: { 'package:desktop': 'node tools/workspace-supervisor/src/cli.mjs desktop' },
    }));
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('package.json#scripts.package:desktop')));

    writeFixture(fixture, 'package.json', JSON.stringify({
      dependencies: { '@glimmer-cradle/repo-checks': 'workspace:*' },
    }));
    assert.ok(checkWorkspaceArtifactBoundaries(fixture).some((item) => item.includes('root 非 façade 字段')));
  } finally {
    fs.rmSync(leaf, { recursive: true, force: true });
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
