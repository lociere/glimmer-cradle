#!/usr/bin/env node
import process from 'node:process';
import { parseRepositoryRootOption } from '../repository-root.mjs';
import { checkArchitecture } from './check-architecture.mjs';

try {
  const repositoryRoot = parseRepositoryRootOption(process.argv.slice(2));
  const violations = checkArchitecture(repositoryRoot);
  if (violations.length > 0) {
    console.error('架构适配度检查失败：');
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  } else {
    console.log('架构适配度检查通过');
  }
} catch (error) {
  console.error(`架构检查无法运行：${error.message}`);
  process.exitCode = 2;
}
