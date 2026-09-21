import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const lockPath = 'docs/architecture/blueprint/architecture-baseline-v2.lock.json';

const expectedLock = {
  "schemaVersion": 1,
  "baselineId": "glimmer-cradle-architecture-v2.1",
  "status": "frozen",
  "immutableSources": [
    {
      "path": "docs/architecture/blueprint/Glimmer_Cradle_Architecture_Baseline_v2.1_Frozen.md",
      "sha256": "f7dac802ed791ad51db79e6f40fcd7b2056bde1117c9286b91ff3976d6fcf0dc"
    },
    {
      "path": "docs/architecture/blueprint/Glimmer_Cradle_Codex_Refactor_Prompt_v2.1.md",
      "sha256": "88526a6e79f4e195324d6d0c74b4f8325d66445444645b732823be634ec8f0fb"
    },
    {
      "path": "docs/architecture/blueprint/Architecture_Baseline_v2.1_执行宪章.md",
      "sha256": "87a73b0656526afbd063689ad1e6c72b2cc39ad4ef2f1b58bd800a906bc0e8f5"
    },
    {
      "path": "docs/architecture/blueprint/Glimmer_Cradle_Target_Physical_Layout_v2.1.md",
      "sha256": "851a9b03b0ebc2104b0fb905e37888245d7ac53815ccd510837e2485459cf126"
    },
    {
      "path": "docs/architecture/blueprint/architecture-target-v2.1.json",
      "sha256": "374a5306b19951cbeace767887c9adcfa9de236df03b51905b199cd608d80118"
    },
    {
      "path": "docs/architecture/decisions/ADR-0023-最终目标蓝图与物理目录契约.md",
      "sha256": "ad9bba8edd68e8978fad227efde9123cbdef98ca7ecb95eb23233d6d18867b70"
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
  ]
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
