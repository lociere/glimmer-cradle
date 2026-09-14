import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import Ajv2020 from 'ajv/dist/2020';
import UserSkillMetadataSchema from '@glimmer-cradle/contracts/json-schema/skill/v1/user-skill-metadata.schema.json';
import type { UserSkillDocument, UserSkillSourcePort } from '../../../ports/user-skill-source.port';
import { resolvePackagesDir } from '../../filesystem/path-utils';

const MAX_SKILL_BYTES = 32 * 1024;
const MAX_SKILLS = 100;
const metadataValidator = new Ajv2020({ allErrors: true });
for (const keyword of ['x-glimmer-owner', 'x-glimmer-contract-kind', 'x-glimmer-compatibility']) {
  metadataValidator.addKeyword(keyword);
}
const validateMetadata = metadataValidator.compile(UserSkillMetadataSchema);

/** 只读取安装域中的指令文档，脚本与进程能力继续归 Extension/MCP。 */
export class UserSkillSource implements UserSkillSourcePort {
  public constructor(
    private readonly config: () => { enabled: boolean; root_dir: string },
    private readonly packagesRoot: () => string = resolvePackagesDir,
  ) {}

  public async load(): ReturnType<UserSkillSourcePort['load']> {
    const config = this.config();
    if (!config.enabled) return { enabled: false, skills: [], errors: [] };
    const skills: UserSkillDocument[] = [];
    const errors: string[] = [];
    try {
      const configuredBase = path.resolve(this.packagesRoot());
      const baseInfo = await lstat(configuredBase).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!baseInfo) return { enabled: true, skills, errors };
      if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) throw new Error('packages 安装域不是可信目录');
      const base = await realpath(configuredBase);
      const requested = path.resolve(base, config.root_dir);
      assertInside(base, requested);
      const rootInfo = await lstat(requested).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!rootInfo) return { enabled: true, skills, errors };
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('用户技能根不是可信目录');
      const root = await realpath(requested);
      assertInside(base, root);
      const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      const directories = entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
      if (directories.length > MAX_SKILLS) throw new Error('用户技能超过 100 项上限');
      for (const entry of directories) {
        try {
          if (entry.isSymbolicLink()) throw new Error('技能目录不能是符号链接');
          const directory = await realpath(path.join(root, entry.name));
          assertInside(root, directory);
          const filename = path.join(directory, 'SKILL.md');
          const info = await lstat(filename);
          if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SKILL_BYTES) throw new Error('SKILL.md 必须是最多 32 KiB 的普通文件');
          const resolved = await realpath(filename);
          assertInside(directory, resolved);
          const handle = await open(resolved, 'r');
          let text: string;
          try {
            const buffer = Buffer.alloc(MAX_SKILL_BYTES + 1);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            if (bytesRead > MAX_SKILL_BYTES) throw new Error('SKILL.md 超过 32 KiB');
            text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
          } finally { await handle.close(); }
          skills.push(parseSkill(text, entry.name));
        } catch { errors.push(`用户技能 ${entry.name} 无法加载：请检查 SKILL.md 格式、大小和目录边界。`); }
      }
    } catch { errors.push('用户技能根目录不可读或越出 packages 安装域。'); }
    return { enabled: true, skills, errors };
  }
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('技能路径越界');
}

function parseSkill(text: string, directoryName: string): UserSkillDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/u.exec(text);
  if (!match) throw new Error('缺少 YAML frontmatter 或正文');
  const metadata = YAML.parse(match[1], { maxAliasCount: 0 }) as Record<string, unknown>;
  const name = metadata?.name;
  const description = metadata?.description;
  if (!validateMetadata(metadata) || typeof name !== 'string' || name !== directoryName
    || typeof description !== 'string'
    || !match[2].trim()) throw new Error('无效的技能名称、描述或正文');
  return { name, description: description.trim(), instructions: match[2].trim() };
}
