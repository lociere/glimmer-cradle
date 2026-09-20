import { parseRepositoryRootOption } from '../repository-root.mjs';
import { checkDocs } from './check-docs.mjs';

try {
  const result = checkDocs(parseRepositoryRootOption(process.argv.slice(2)));
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else console.log(`文档检查通过：${result.activeFiles} 份活跃 Markdown 的本地文件链接与入口可达性`);
} catch (error) {
  console.error(`文档检查无法运行：${error.message}`);
  process.exitCode = 2;
}
