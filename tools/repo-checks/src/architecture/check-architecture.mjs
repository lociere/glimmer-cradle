import { checkDerivedBoundaries } from './rules/derived-boundaries.mjs';
import { checkLegacyPaths } from './rules/legacy-paths.mjs';
import { checkPlatformBoundaries } from './rules/platform-boundaries.mjs';
import { checkRepositoryTopology } from './rules/repository-topology.mjs';
import { checkWorkspaceArtifactBoundaries } from './rules/workspace-artifact-boundaries.mjs';
import { checkWorkspaceBoundaries } from './rules/workspace-boundaries.mjs';

const rules = [
  checkRepositoryTopology,
  checkWorkspaceArtifactBoundaries,
  checkLegacyPaths,
  checkWorkspaceBoundaries,
  checkDerivedBoundaries,
  checkPlatformBoundaries,
];

export function checkArchitecture(repositoryRoot) {
  return rules.flatMap((rule) => rule(repositoryRoot));
}
