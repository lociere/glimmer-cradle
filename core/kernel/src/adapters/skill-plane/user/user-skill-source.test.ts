import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { UserSkillSource } from './user-skill-source';
import { UserSkillProvider } from '../../../application/skill-plane/providers/user/user-skill-provider';
import { CapabilityCatalogAdapter } from '../capability-catalog-adapter';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'user-skill-')); roots.push(root);
  const skillDir = path.join(root, 'skills', 'summarize');
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: summarize\ndescription: 总结给定文字\nallowed-tools: arbitrary.execute\n---\n请用三句话总结。\n', 'utf8');
  return { root, skillDir, source: new UserSkillSource(() => ({ enabled: true, root_dir: 'skills' }), () => root) };
}

it('首次安装尚无 packages 目录时保持空 provider ready', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'user-skill-empty-')); roots.push(root);
  const source = new UserSkillSource(
    () => ({ enabled: true, root_dir: 'skills' }),
    () => path.join(root, 'data', 'packages'),
  );
  const registry = new CapabilityCatalogAdapter();
  await new UserSkillProvider(source).start(registry);
  expect(registry.getCatalogSnapshot().providerRuntimes.find((item) => item.provider.kind === 'user')).toMatchObject({
    state: 'ready',
    skill_count: 0,
    tool_count: 0,
  });
});

it('加载真实 SKILL.md 为方法知识而非 Tool，作者 allowed-tools 不授予权限，停止撤销正文读取', async () => {
  const { source } = await fixture();
  const registry = new CapabilityCatalogAdapter();
  const provider = new UserSkillProvider(source);
  await provider.start(registry);
  const skill = provider.listSkills()[0];
  expect(skill.id).toBe('user.summarize');
  expect(skill.tools).toHaveLength(0);
  expect(registry.tools.list()).toEqual([]);
  const reference = registry.listReadyMethods()[0].reference;
  expect(registry.readMethod(reference)?.instructions).toBe('请用三句话总结。');
  expect(registry.getCatalogSnapshot()).toMatchObject({ totalTools: 0, totalPrompts: 1 });
  expect(registry.getCatalogSnapshot().providerRuntimes.find((item) => item.provider.kind === 'user')?.state).toBe('ready');
  provider.stop(registry);
  expect(registry.getAll()).toHaveLength(0);
  expect(registry.methods.list()).toEqual([]);
  expect(registry.readMethod(reference)).toBeUndefined();
});

it('坏 frontmatter、大文件与目录链接独立失败，保留有效技能并投影 degraded', async () => {
  const { root, source } = await fixture();
  for (const [name, content] of [['bad', '---\nname: wrong\ndescription: test\n---\nbody'], ['large', 'x'.repeat(33000)]]) {
    await mkdir(path.join(root, 'skills', name));
    await writeFile(path.join(root, 'skills', name, 'SKILL.md'), content);
  }
  const outside = path.join(root, 'outside'); await mkdir(outside);
  await symlink(outside, path.join(root, 'skills', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await source.load();
  expect(result.skills.map((item) => item.name)).toEqual(['summarize']);
  expect(result.errors).toHaveLength(3);
  const registry = new CapabilityCatalogAdapter(); const provider = new UserSkillProvider(source);
  await provider.start(registry);
  expect(registry.getCatalogSnapshot().providerRuntimes.find((item) => item.provider.kind === 'user')?.state).toBe('degraded');
  const reference = registry.listReadyMethods()[0].reference;
  expect(registry.listReadyMethods()).toHaveLength(1);
  expect(registry.readMethod(reference)?.instructions).toBe('请用三句话总结。');
  provider.stop(registry);
  expect(registry.readMethod(reference)).toBeUndefined();
});

it('配置越界不可读，关闭后不访问文件系统', async () => {
  const { root } = await fixture();
  expect((await new UserSkillSource(() => ({ enabled: true, root_dir: '..' }), () => root).load()).errors).toHaveLength(1);
  expect(await new UserSkillSource(() => ({ enabled: false, root_dir: '..' }), () => { throw new Error('must not read'); }).load()).toEqual({ enabled: false, skills: [], errors: [] });
});

it('停止后到达的加载结果不能重新注册技能', async () => {
  let resolve!: (value: any) => void;
  const provider = new UserSkillProvider({ load: () => new Promise((done) => { resolve = done; }) });
  const registry = new CapabilityCatalogAdapter();
  const pending = provider.start(registry); provider.stop(registry);
  resolve({ enabled: true, skills: [{ name: 'late', description: 'late', instructions: 'late' }], errors: [] });
  await pending;
  expect(registry.getAll()).toHaveLength(0);
});
