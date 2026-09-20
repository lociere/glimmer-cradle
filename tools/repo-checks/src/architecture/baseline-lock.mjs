import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const lockPath = 'docs/architecture/blueprint/architecture-baseline-v2.lock.json';

const expectedLock = {
  schemaVersion: 1,
  baselineId: 'glimmer-cradle-architecture-v2.0-r1',
  status: 'frozen',
  immutableSources: [
    {
      path: 'docs/architecture/blueprint/Glimmer_Cradle_Architecture_Baseline_v2.0_Frozen.md',
      sha256: 'ae6177596288211cb845569d164699a64865430638b2466b67a0d23c30b09626',
    },
    {
      path: 'docs/architecture/blueprint/Glimmer_Cradle_Codex_Refactor_Prompt_v2.0.md',
      sha256: '8b1791fb17c8dcb3a8936082e6168526c7cf437cfd30d12878d7ef90b51c01a8',
    },
  ],
  targetRoots: ['core', 'extension-sdk', 'apps', 'protocol', 'docs'],
  coreModules: ['platform', 'content', 'conversation', 'cognition', 'capabilities', 'jobs', 'embodiment'],
  migrationPolicy: {
    singleCanonicalWriter: true,
    consumerZeroBeforeDelete: true,
    noEmptyNamespaces: true,
    noWholeKernelMove: true,
    atomicProtocolCutover: true,
  },
  changeRequirements: [
    'explicit-user-decision',
    'accepted-adr',
    'versioned-baseline',
    'lock-and-gate-update',
  ],
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
    violations.push(`${lockPath}: frozen architecture decisions changed; a new user decision, ADR and versioned baseline are required`);
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
