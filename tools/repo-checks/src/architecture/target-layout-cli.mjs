import path from 'node:path';
import { checkTargetLayout, writeTargetLayout } from './target-layout.mjs';

const args = process.argv.slice(2);
if (args.some(arg => !['--write', '--final'].includes(arg)) || (args.includes('--write') && args.includes('--final'))) {
  console.error('Usage: target-layout-cli.mjs [--write | --final]');
  process.exitCode = 2;
} else {
  const root = path.resolve(import.meta.dirname, '../../../..');
  try {
    if (args.includes('--write')) writeTargetLayout(root);
    const errors = checkTargetLayout(root, { final: args.includes('--final') });
    for (const error of errors.slice(0, 50)) console.error(error);
    if (errors.length > 50) console.error(`... ${errors.length - 50} further mismatches omitted from console output`);
    console.log(errors.length ? `Target layout: FAIL (${errors.length} violations)` : 'Target layout: PASS (specification only unless --final)');
    process.exitCode = errors.length ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
