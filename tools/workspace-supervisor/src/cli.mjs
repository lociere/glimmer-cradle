#!/usr/bin/env node
import process from 'node:process';
import { parseCliOptions } from './cli-options.mjs';
import { resolveRepositoryRoot } from './repository-root.mjs';
import { superviseWorkspace } from './supervisor.mjs';
import { createWorkspacePlan } from './workspace-plan.mjs';

try {
  const options = parseCliOptions(process.argv.slice(2));
  const repositoryRoot = resolveRepositoryRoot(options.repositoryRoot);
  const plan = createWorkspacePlan({ ...options, repositoryRoot });
  if (options.planOnly) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    process.exitCode = await superviseWorkspace(plan);
  }
} catch (error) {
  console.error(`[workspace-supervisor] ${error.message}`);
  process.exitCode = error.exitCode ?? 1;
}
