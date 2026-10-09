import { parseRepositoryRootOption } from '../repository-root.mjs';
import { checkDocs } from './check-docs.mjs';
import { checkDocumentationStructure } from './documentation-structure.mjs';

try {
  const args = process.argv.slice(2);
  const root = parseRepositoryRootOption(args.filter(arg => arg !== '--write'));
  if (args.includes('--write')) {
    const errors = checkDocumentationStructure(root, { write: true });
    if (errors.length) throw new Error(errors.join('\n'));
  }
  const result = checkDocs(root);
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else console.log(`文档检查通过：${result.activeFiles} 份活跃 Markdown；本地链接、入口、docs 清单、执行状态与生成视图一致`);
} catch (error) {
  console.error(`文档检查无法运行：${error.message}`);
  process.exitCode = 2;
}
