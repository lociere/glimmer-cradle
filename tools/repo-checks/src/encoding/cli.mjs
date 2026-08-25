#!/usr/bin/env node
import process from 'node:process';
import { parseRepositoryRootOption } from '../repository-root.mjs';
import { checkEncoding } from './check-encoding.mjs';

try {
  const repositoryRoot = parseRepositoryRootOption(process.argv.slice(2));
  const violations = checkEncoding(repositoryRoot);
  if (violations.length > 0) {
    console.error('编码检查失败：');
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  } else {
    console.log('全部 inventoried text 均为合法 UTF-8 且不含 BOM');
  }
} catch (error) {
  console.error(`编码检查无法运行：${error.message}`);
  process.exitCode = 2;
}
