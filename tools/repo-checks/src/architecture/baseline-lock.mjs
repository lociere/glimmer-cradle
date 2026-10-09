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
      "sha256": "02f3038ea3ec6a6c661aad67478d7bb496c527601f347857fe5e160cbd6666f2"
    },
    {
      "path": "docs/architecture/target/physical-layout.md",
      "sha256": "36d0755c4b3e4ea682257809470aca29bb2928f8db00212975824bb36c049f5c"
    },
    {
      "path": "docs/architecture/target/files.json",
      "sha256": "e9f85e10f00d035351c0ed05f3b3d6f7ce0b69d0dd3bcfba6f613908386f43e8"
    },
    {
      "path": "docs/architecture/decisions/ADR-0023-最终目标蓝图与物理目录契约.md",
      "sha256": "ae08675d93387e45a276201c30334730b50b97a9978a3ba6148d2114dabe629c"
    },
    {
      "path": "docs/architecture/decisions/ADR-0024-文档职责与重构执行体系整合.md",
      "sha256": "5e24e623d610958c705b81c7794f729674307755e42492df4e0471c082280a3d"
    },
    {
      "path": "docs/governance/documentation.md",
      "sha256": "003e5937804653e3a4a8ac976fa63386f6783768f976b924ba53d79b4b05167c"
    },
    {
      "path": "docs/governance/documentation-architecture.md",
      "sha256": "c0cce905d09b89d56122264d44be788eb340ca2c0ae17e9b0737be4284fd6024"
    },
    {
      "path": "docs/guides/development/architecture-refactoring.md",
      "sha256": "3a7d4879e75bd2d58beb7edcda017341500bce56d388f37894ea695897b22ba5"
    },
    {
      "path": "docs/roadmap/initiatives/architecture-v2/plan.md",
      "sha256": "e765058aacaabc5912d1d929466ecd66e4faaa75320b569735dbf041a39ad259"
    },
    {
      "path": "docs/roadmap/initiatives/architecture-v2/acceptance.md",
      "sha256": "95a64bf9abc000c5d738f9ef5bddc8486bc6482dcb5f8561a39784551067d6af"
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
