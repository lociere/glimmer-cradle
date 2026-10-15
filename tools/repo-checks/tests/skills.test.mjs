import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkSkills } from '../src/skills/check-skills.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glimmer-skills-'));
  t.after(() => {
    // The target is the exact directory returned by mkdtemp, never a caller-supplied path.
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (file, content) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  };
  write('AGENTS.md', '[skill](.agents/skills/sample/SKILL.md)');
  write('.agents/skills/sample/SKILL.md', '---\nname: sample\ndescription: "Validate sample input: only when asked."\n---\n[detail](references/detail.md)');
  write('.agents/skills/sample/references/detail.md', '# Detail\n[project](../../../../docs/source%20page.md)');
  write('docs/source page.md', '# Project');
  return { root, write };
}

test('valid YAML, encoded project references and optional UI metadata work', t => {
  const { root, write } = fixture(t);
  assert.deepEqual(checkSkills(root), { skills: 1, errors: [] });
  write('.agents/skills/sample/agents/openai.yaml', 'interface:\n  display_name: "Sample"\n  default_prompt: "Use $sample to validate input."\npolicy:\n  allow_implicit_invocation: true\n');
  assert.deepEqual(checkSkills(root), { skills: 1, errors: [] });
});

test('retired duplicate location and same-name manifests cannot pass', t => {
  const { root, write } = fixture(t);
  write('.codex/skills/sample/SKILL.md', '---\nname: sample\ndescription: Old\n---');
  write('.agents/skills/another/SKILL.md', '---\nname: sample\ndescription: Duplicate\n---');
  const result = checkSkills(root);
  assert.ok(result.errors.some(error => error.includes('retired discovery')));
  assert.ok(result.errors.some(error => error.includes('duplicate skill name')));
  assert.ok(result.errors.some(error => error.includes('match skill directory')));
});

test('a linked nested manifest cannot masquerade as another project skill', t => {
  const { root, write } = fixture(t);
  write('.agents/skills/sample/references/detail.md', '[nested](../nested/SKILL.md)');
  write('.agents/skills/sample/nested/SKILL.md', '---\nname: nested\ndescription: Nested\n---');
  assert.ok(checkSkills(root).errors.some(error => error.includes('must be directly under')));
});

test('invalid YAML, metadata types and empty descriptions fail', t => {
  const { root, write } = fixture(t);
  write('.agents/skills/sample/SKILL.md', '---\nname: sample\nname: duplicate\ndescription: [\n---');
  assert.ok(checkSkills(root).errors.some(error => error.includes('invalid YAML')));
  write('.agents/skills/sample/SKILL.md', '---\nname: sample\ndescription: ""\nmetadata:\n  version: 1\n---\n[detail](references/detail.md)');
  const result = checkSkills(root);
  assert.ok(result.errors.some(error => error.includes('invalid skill description')));
  assert.ok(result.errors.some(error => error.includes('values must be strings')));
});

test('broken, escaped and orphan references fail; code examples are not links', t => {
  const { root, write } = fixture(t);
  write('.agents/skills/sample/references/detail.md', '[missing](gone.md)\n[escape](../../../../../outside.md)\n`[example](absent.md)`');
  write('.agents/skills/sample/references/orphan.md', '# Orphan');
  const errors = checkSkills(root).errors;
  assert.equal(errors.length, 3, errors.join('\n'));
  assert.ok(errors.some(error => error.includes('not reachable')));
});

test('UI invocation policy and prompt must have valid types and identity', t => {
  const { root, write } = fixture(t);
  write('.agents/skills/sample/agents/openai.yaml', 'interface:\n  default_prompt: "Use $other."\npolicy:\n  allow_implicit_invocation: "false"');
  const result = checkSkills(root);
  assert.ok(result.errors.some(error => error.includes('must mention $sample')));
  assert.ok(result.errors.some(error => error.includes('must be boolean')));
});

test('a linked skill resource cannot make the scanner traverse outside the repository', t => {
  const { root, write } = fixture(t);
  write('unrelated/source.md', '# Must not be scanned');
  const link = path.join(root, '.agents/skills/sample/references/linked');
  fs.symlinkSync(path.join(root, 'unrelated'), link, process.platform === 'win32' ? 'junction' : 'dir');
  const result = checkSkills(root);
  assert.ok(result.errors.some(error => error.includes('must be regular')));
  assert.equal(result.skills, 1);
});

test('a linked .agents parent is rejected before scanning its skills', t => {
  const { root } = fixture(t);
  const agents = path.join(root, '.agents');
  const moved = path.join(root, 'unrelated');
  fs.renameSync(agents, moved);
  fs.symlinkSync(moved, agents, process.platform === 'win32' ? 'junction' : 'dir');
  const result = checkSkills(root);
  assert.equal(result.skills, 0);
  assert.ok(result.errors.some(error => error.includes('must be regular')));
});

test('Git ignore rules cannot silently hide a skill or supporting resource', t => {
  const { root, write } = fixture(t);
  const initialized = spawnSync('git', ['init', '-q', root], { encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  write('.gitignore', '/.agents/skills/sample/references/\n');
  assert.ok(checkSkills(root).errors.some(error => error.includes('skill source is ignored by Git')));
  write('.gitignore', '/.agents/*\n!/.agents/skills/\n!/.agents/skills/**\n');
  assert.deepEqual(checkSkills(root), { skills: 1, errors: [] });
});

test('CLI works from another cwd and distinguishes violations from usage errors', t => {
  const { root, write } = fixture(t);
  const cli = path.resolve(import.meta.dirname, '../src/skills/cli.mjs');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(run(['--repository-root', root]).status, 0);
  write('.agents/skills/sample/SKILL.md', '# No metadata');
  assert.equal(run(['--repository-root', root]).status, 1);
  assert.equal(run(['--unknown']).status, 2);
});
