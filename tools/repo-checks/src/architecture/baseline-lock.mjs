import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const lockPath = 'docs/architecture/target/baseline.lock.json';

const expectedLock = {
  "schemaVersion": 1,
  "baselineId": "glimmer-cradle-architecture-v2.1",
  "status": "frozen",
  "immutableSources": [
    {
      "path": "docs/architecture/target/baseline.md",
      "sha256": "4f5f92aad5d182319cf1e15bcc58449384368f965cb1810b6c1bf5e395233266"
    },
    {
      "path": "docs/roadmap/initiatives/architecture-v2/requirements.md",
      "sha256": "995c6f73e8bdd4f393e49470b0c141b3d1b6fca803134f78de43c1ae3e985973"
    },
    {
      "path": "docs/governance/architecture-change-policy.md",
      "sha256": "472ded447bae843d84e6de9f7c30e3db74c1a8d36ac5ad524b31412f515bb125"
    },
    {
      "path": "docs/architecture/target/physical-layout.md",
      "sha256": "d2272efb8da0c1bcd1ab4f6cca61493c8ee60d9c1d871887f128a2972243e0d6"
    },
    {
      "path": "docs/architecture/target/files.json",
      "sha256": "d2fb14ee85a8c7f5610ad382916967b695fec75eae97b183b75f109d76b8bce2"
    },
    {
      "path": "docs/architecture/decisions/ADR-0023-最终目标蓝图与物理目录契约.md",
      "sha256": "ae08675d93387e45a276201c30334730b50b97a9978a3ba6148d2114dabe629c"
    },
    {
      "path": "docs/architecture/decisions/ADR-0024-文档职责与重构执行体系整合.md",
      "sha256": "06c8d1f60561b740f9dda56e3e64bb4075d8ffdb58b9f82de22701343f7c75c9"
    },
    {
      "path": "docs/governance/documentation.md",
      "sha256": "003e5937804653e3a4a8ac976fa63386f6783768f976b924ba53d79b4b05167c"
    },
    {
      "path": "docs/governance/documentation-architecture.md",
      "sha256": "03477e1fb3624fe61bbcfb373c174c7a6408703311cef20a7ed50771c341a566"
    },
    {
      "path": "docs/guides/development/architecture-refactoring.md",
      "sha256": "f8824731829cf93a3c3de54da4eedd8cdf7beef37e2c5e2d74a215dd0fd9a746"
    },
    {
      "path": "docs/roadmap/initiatives/architecture-v2/plan.md",
      "sha256": "1a064722d8b213013ba9e2353bb3e766101d979bf8a74c5a0db70e393e063443"
    },
    {
      "path": "docs/roadmap/initiatives/architecture-v2/acceptance.md",
      "sha256": "1ced0634d148030bb6552f0fd204ad16ba1c315a53c9a28a06af81293d3407ab"
    },
    {
      "path": "docs/roadmap/initiatives/architecture-v2/execution-order.md",
      "sha256": "4a872ce3b275a0ca8c33145527bc6aa48a0aba97423cf39ed30bc222fc8a429b"
    }
  ],
  "targetRoots": [
    "core",
    "extension-sdk",
    "apps",
    "protocol",
    "docs"
  ],
  "coreModules": [
    "platform",
    "content",
    "conversation",
    "cognition",
    "capabilities",
    "jobs",
    "embodiment"
  ],
  "migrationPolicy": {
    "singleCanonicalWriter": true,
    "consumerZeroBeforeDelete": true,
    "noEmptyNamespaces": true,
    "noWholeKernelMove": true,
    "atomicProtocolCutover": true
  },
  "changeRequirements": [
    "explicit-user-decision",
    "accepted-adr",
    "versioned-baseline",
    "lock-and-gate-update"
  ],
  "governanceRevision": "docs-r1"
};

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function checkArchitectureBaselineLock(repositoryRoot) {
  const violations = [];
  const absoluteLockPath = path.join(repositoryRoot, lockPath);
  if (!fs.existsSync(absoluteLockPath)) return [`${lockPath}: frozen architecture lock is missing`];

  let actualLock;
  try {
    actualLock = JSON.parse(fs.readFileSync(absoluteLockPath, 'utf8'));
  } catch (error) {
    return [`${lockPath}: cannot parse frozen architecture lock: ${error.message}`];
  }

  if (stableJson(actualLock) !== stableJson(expectedLock)) {
    violations.push(`${lockPath}: frozen architecture decisions changed; synchronize the governed baseline, manifest and gate; semantic boundary changes require a user decision and ADR`);
    return violations;
  }

  for (const source of actualLock.immutableSources) {
    const absoluteSourcePath = path.join(repositoryRoot, source.path);
    if (!fs.existsSync(absoluteSourcePath)) {
      violations.push(`${source.path}: frozen architecture source is missing`);
      continue;
    }
    const digest = createHash('sha256').update(fs.readFileSync(absoluteSourcePath)).digest('hex');
    if (digest !== source.sha256) violations.push(`${source.path}: frozen architecture source hash changed`);
  }
  return violations;
}
