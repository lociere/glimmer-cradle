import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executionPath, statusPath, validateExecutionPlan, renderExecutionStatus } from '../src/docs/execution-plan.mjs';
import { structurePath, checkDocumentationStructure } from '../src/docs/documentation-structure.mjs';
import { manifestPath } from '../src/architecture/target-layout.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const plan = JSON.parse(fs.readFileSync(path.join(root, executionPath), 'utf8'));

test('current plan has resolvable cards, input files and a runnable next task', () => {
  assert.deepEqual(validateExecutionPlan(plan, root), []);
  assert.deepEqual(checkDocumentationStructure(root), []);
});

test('workflow rejects cycles, missing dependencies, duplicate IDs and premature acceptance', () => {
  for (const mutate of [
    p => { p.tasks[0].dependsOn = [p.tasks[1].id]; },
    p => { p.tasks[1].dependsOn = ['ABSENT']; },
    p => { p.tasks[1].id = p.tasks[0].id; },
    p => { p.tasks[1].status = 'accepted'; },
    p => { p.stages[0].status = 'accepted'; },
    p => { p.nextTask = p.tasks[1].id; },
    p => { p.tasks[0].mode = 'implementation'; },
    p => { p.tasks[0].inputPaths = ['../escape']; },
    p => { p.tasks[0].card = 'missing.md'; },
  ]) {
    const candidate = structuredClone(plan);
    mutate(candidate);
    assert.notDeepEqual(validateExecutionPlan(candidate, root), []);
  }
});

test('blocked workflow has no runnable next task and never renders itself complete', () => {
  const candidate = structuredClone(plan);
  candidate.tasks[0].status = 'blocked';
  candidate.tasks[0].blockedReason = '需要目标环境；环境恢复并验证后解除';
  candidate.nextTask = null;
  assert.deepEqual(validateExecutionPlan(candidate, root), []);
  assert.match(renderExecutionStatus(candidate), /暂无可直接执行/);
  assert.doesNotMatch(renderExecutionStatus(candidate), /全部任务已接受/);
});

test('workflow rejects instruction routing and task order drift', () => {
  for (const mutate of [
    p => { delete p.instructionFile; },
    p => { p.tasks[0].card = 'execution-order.md#step-absent'; },
    p => { [p.tasks[1], p.tasks[2]] = [p.tasks[2], p.tasks[1]]; },
    p => { p.tasks.pop(); },
  ]) {
    const candidate = structuredClone(plan);
    mutate(candidate);
    assert.ok(validateExecutionPlan(candidate, root).some(error => /instruction/.test(error)));
  }
});

test('implementation readiness requires explicit file actions, commands and deletion conditions', () => {
  const candidate = structuredClone(plan);
  const task = candidate.tasks[0];
  task.mode = 'implementation';
  const source = 'core/cognition/src/glimmer_cradle/cognition/planning/planning_controller.py';
  task.mapping = [{ action: 'retain', source, target: source, owner: 'cognition', exitCondition: '真实 consumer 测试通过' }];
  task.commands = ['pnpm typecheck'];
  assert.deepEqual(validateExecutionPlan(candidate, root), []);
  task.mapping[0].target = 'core/cognition/src/unlisted.py';
  assert.ok(validateExecutionPlan(candidate, root).some(error => error.includes('not in the physical contract')));
  task.mapping[0].target = '../escape';
  assert.ok(validateExecutionPlan(candidate, root).some(error => error.includes('file mapping')));
});

test('documentation governance detects missing/unlisted files and repairs only generated views', t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'glimmer-doc-structure-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
    fs.writeFileSync(path.join(fixture, file), value);
  };
  const candidate = structuredClone(plan);
  for (const task of candidate.tasks) { task.inputPaths = ['docs/README.md']; }
  const instructions = 'docs/roadmap/initiatives/architecture-v2/execution-order.md';
  const files = [manifestPath, executionPath, statusPath, structurePath, 'docs/README.md', instructions];
  write(manifestPath, JSON.stringify({ repositoryFiles: files.map(file => ({ path: file, owner: 'docs' })) }));
  write(executionPath, JSON.stringify(candidate));
  write(statusPath, 'stale');
  write(structurePath, 'before\n<!-- docs-layout:start -->\nwrong\n<!-- docs-layout:end -->\nafter\n');
  write('docs/README.md', '# Entry');
  write(instructions, candidate.tasks.map(task => `## step-${task.id.toLowerCase()}`).join('\n\n'));
  assert.equal(checkDocumentationStructure(fixture).length, 2);
  assert.deepEqual(checkDocumentationStructure(fixture, { write: true }), []);
  assert.deepEqual(checkDocumentationStructure(fixture), []);
  assert.ok(fs.readFileSync(path.join(fixture, structurePath), 'utf8').endsWith('after\n'));
  write(instructions, '# Missing steps');
  assert.ok(checkDocumentationStructure(fixture).some(error => error.includes('instruction document')));
  write(instructions, candidate.tasks.map(task => `## step-${task.id.toLowerCase()}`).join('\n\n'));
  write('docs/unlisted.md', '# Unlisted');
  fs.unlinkSync(path.join(fixture, 'docs/README.md'));
  const errors = checkDocumentationStructure(fixture);
  assert.ok(errors.some(error => error.includes('missing documented file')));
  assert.ok(errors.some(error => error.includes('unlisted documentation file')));
});
