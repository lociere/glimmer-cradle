import { parseRepositoryRootOption } from '../repository-root.mjs';
import { checkSkills } from './check-skills.mjs';

try {
  const result = checkSkills(parseRepositoryRootOption(process.argv.slice(2)));
  if (result.errors.length) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else console.log(`Skill 检查通过：${result.skills} 个项目 Skill；元数据、唯一位置与本地引用一致（不验证行为效果）`);
} catch (error) {
  console.error(`Skill 检查无法运行：${error.message}`);
  process.exitCode = 2;
}
