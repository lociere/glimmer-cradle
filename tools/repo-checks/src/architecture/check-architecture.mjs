import { checkDerivedBoundaries } from './rules/derived-boundaries.mjs';
import { checkLegacyPaths } from './rules/legacy-paths.mjs';
import { checkPlatformBoundaries } from './rules/platform-boundaries.mjs';
import { checkRepositoryTopology } from './rules/repository-topology.mjs';
import { checkWorkspaceArtifactBoundaries } from './rules/workspace-artifact-boundaries.mjs';
import { checkWorkspaceBoundaries } from './rules/workspace-boundaries.mjs';
import { checkV2Boundaries } from './v2-boundaries.mjs';
import { checkArchitectureBaselineLock } from './baseline-lock.mjs';
import { checkTargetLayout } from './target-layout.mjs';

const rules = [
  checkArchitectureBaselineLock,
  checkTargetLayout,
  checkRepositoryTopology,
  checkWorkspaceArtifactBoundaries,
  checkLegacyPaths,
  checkWorkspaceBoundaries,
  checkDerivedBoundaries,
  checkPlatformBoundaries,
  checkV2Boundaries,
];

export function checkArchitecture(repositoryRoot) {
  return rules.flatMap((rule) => rule(repositoryRoot));
}
