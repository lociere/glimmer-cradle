import fs from 'node:fs';
import path from 'node:path';
import { manifestPath } from '../architecture/target-layout.mjs';

export const initiativePath = 'docs/roadmap/initiatives/architecture-v2';
export const executionPath = `${initiativePath}/execution.json`;
export const statusPath = `${initiativePath}/status.md`;
export const instructionFile = 'execution-order.md';

const statuses = new Set(['planned', 'ready', 'in-progress', 'verified', 'accepted', 'blocked']);
const safeFile = value => typeof value === 'string' && value.length > 0
  && !/[\\:*?<>|\u0000-\u001f]/.test(value) && !value.startsWith('/')
  && value.split('/').every(part => part && part !== '.' && part !== '..');
const present = value => typeof value === 'string' && value.trim().length > 0;

export function validateExecutionPlan(plan, repositoryRoot) {
  const errors = [];
  if (plan?.schemaVersion !== 1 || plan?.initiative !== 'architecture-v2') errors.push('execution: unsupported schema/initiative');
  if (!/^[a-f0-9]{7,40}$/.test(plan?.baselineCommit ?? '')) errors.push('execution: missing baseline commit');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan?.reviewedAt ?? '')) errors.push('execution: missing review date');
  if (!Array.isArray(plan?.stages) || !Array.isArray(plan?.tasks) || !plan.tasks.length) return [...errors, 'execution: stages/tasks required'];
  if (plan.instructionFile !== instructionFile) errors.push('execution: missing canonical instruction file');
  if (repositoryRoot) {
    const instructionPath = path.join(repositoryRoot, initiativePath, instructionFile);
    if (!fs.existsSync(instructionPath)) errors.push('execution: missing instruction document');
    else {
      const instructions = fs.readFileSync(instructionPath, 'utf8');
      const orderedIds = [...instructions.matchAll(/^## step-([a-z0-9]+)\s*$/gm)].map(match => match[1].toUpperCase());
      if (JSON.stringify(orderedIds) !== JSON.stringify(plan.tasks.map(task => task.id))) {
        errors.push('execution: task order/IDs differ from the instruction document');
      }
    }
  }
  const stages = new Map();
  const tasks = new Map();
  const targetFiles = repositoryRoot && fs.existsSync(path.join(repositoryRoot, manifestPath))
    ? new Set(JSON.parse(fs.readFileSync(path.join(repositoryRoot, manifestPath), 'utf8')).repositoryFiles.map(entry => entry.path)) : null;
  const localFile = (ref, base = initiativePath) => {
    const file = ref?.split('#')[0];
    return safeFile(file) && (!repositoryRoot || fs.existsSync(path.join(repositoryRoot, base, file))
      && fs.statSync(path.join(repositoryRoot, base, file)).isFile());
  };
  for (const stage of plan.stages) {
    if (!/^P\d{2}$/.test(stage.id) || stages.has(stage.id)) errors.push(`execution: invalid/duplicate stage ${stage.id}`);
    stages.set(stage.id, stage);
    if (!['planned', 'partial', 'accepted'].includes(stage.status) || !present(stage.title) || !present(stage.summary)) errors.push(`execution: invalid stage ${stage.id}`);
    if (stage.status === 'accepted' && (!stage.evidence?.length || stage.evidence.some(ref => !localFile(ref)))) errors.push(`execution: stage ${stage.id} needs acceptance evidence`);
  }
  for (const task of plan.tasks) {
    if (!/^[A-Z][A-Z0-9]+$/.test(task.id) || tasks.has(task.id)) errors.push(`execution: invalid/duplicate task ${task.id}`);
    tasks.set(task.id, task);
    if (!statuses.has(task.status) || !['discovery', 'implementation', 'review'].includes(task.mode)
      || !present(task.title) || !present(task.scope) || !present(task.nextAction)) errors.push(`execution: incomplete task ${task.id}`);
    if (!localFile(task.card)) errors.push(`execution: invalid/missing card for ${task.id}`);
    if (task.card !== `${instructionFile}#step-${task.id.toLowerCase()}`) errors.push(`execution: ${task.id} must link to its canonical instruction section`);
    if (['ready', 'in-progress'].includes(task.status) && task.card?.split('#')[0].endsWith('/TEMPLATE.md')) errors.push(`execution: ${task.id} cannot execute an unfilled template`);
    if (!Array.isArray(task.stageIds) || !task.stageIds.length || task.stageIds.some(id => !stages.has(id))) errors.push(`execution: invalid stages for ${task.id}`);
    if (!Array.isArray(task.dependsOn) || new Set(task.dependsOn).size !== task.dependsOn.length) errors.push(`execution: invalid dependencies for ${task.id}`);
    if (!Array.isArray(task.acceptance) || !task.acceptance.length) errors.push(`execution: missing acceptance for ${task.id}`);
    if (!Array.isArray(task.evidence) || task.evidence.some(ref => !localFile(ref))) errors.push(`execution: invalid evidence for ${task.id}`);
    if (['verified', 'accepted'].includes(task.status) && !task.evidence?.length) errors.push(`execution: ${task.id} needs verification evidence`);
    if (task.status === 'in-progress' && !present(task.owner)) errors.push(`execution: ${task.id} needs a write owner`);
    if (task.status === 'blocked' && !present(task.blockedReason)) errors.push(`execution: ${task.id} needs a blocking reason and release condition`);
    if (['ready', 'in-progress', 'verified', 'accepted'].includes(task.status)) {
      if (task.mode === 'implementation') {
        if (!Array.isArray(task.mapping) || !task.mapping.length || !Array.isArray(task.commands) || !task.commands.length
          || task.commands.some(command => !present(command))) errors.push(`execution: implementation ${task.id} needs exact mapping and commands`);
        for (const entry of task.mapping ?? []) {
          if (!['retain', 'create', 'move', 'split', 'delete'].includes(entry.action) || !present(entry.owner)
            || (entry.action !== 'create' && !safeFile(entry.source))
            || (entry.action !== 'delete' && !safeFile(entry.target)) || !present(entry.exitCondition)) errors.push(`execution: invalid file mapping for ${task.id}`);
          if (entry.action !== 'delete' && targetFiles && !targetFiles.has(entry.target)) errors.push(`execution: ${task.id} target is not in the physical contract: ${entry.target}`);
          if (task.status === 'ready' && entry.action !== 'create' && !localFile(entry.source, '')) errors.push(`execution: ${task.id} missing current source: ${entry.source}`);
        }
      }
      if (task.mode === 'discovery' && ['ready', 'in-progress'].includes(task.status)
        && (!task.inputPaths?.length || task.inputPaths.some(ref => !localFile(ref, '')))) errors.push(`execution: discovery ${task.id} needs existing input paths`);
    }
  }
  if (plan.tasks.filter(task => task.status === 'in-progress').length > 1) errors.push('execution: multiple write tasks are in progress');
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push(`execution: dependency cycle at ${id}`); return; }
    if (visited.has(id) || !tasks.has(id)) return;
    visiting.add(id);
    const task = tasks.get(id);
    for (const dependency of task.dependsOn ?? []) {
      if (!tasks.has(dependency)) errors.push(`execution: ${id} has missing dependency ${dependency}`);
      else if (['ready', 'in-progress', 'verified', 'accepted'].includes(task.status) && tasks.get(dependency).status !== 'accepted') errors.push(`execution: ${id} dependency ${dependency} is not accepted`);
      visit(dependency);
    }
    visiting.delete(id); visited.add(id);
  }
  for (const id of tasks.keys()) visit(id);
  for (const stage of plan.stages) {
    const assigned = plan.tasks.filter(task => task.stageIds?.includes(stage.id));
    if (!assigned.length) errors.push(`execution: stage ${stage.id} has no task`);
    if (stage.status === 'accepted' && assigned.some(task => task.status !== 'accepted')) errors.push(`execution: stage ${stage.id} contains unfinished tasks`);
  }
  if (plan.nextTask === null) {
    if (plan.tasks.some(task => ['ready', 'in-progress'].includes(task.status))) errors.push('execution: runnable plan needs nextTask');
  } else if (!['ready', 'in-progress'].includes(tasks.get(plan.nextTask)?.status)) errors.push('execution: nextTask must be ready or in-progress');
  return errors;
}

export function renderExecutionStatus(plan) {
  const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const next = plan.tasks.find(task => task.id === plan.nextTask);
  return ['# 架构重构状态', '', '> 本页由 execution.json 生成；使用 pnpm check:docs --write，禁止手工维护第二份状态。', '',
    `核对日期：${plan.reviewedAt}；产品事实输入：\`${plan.baselineCommit}\`。日期不替代 Git/代码核对。`, '',
    next ? `下一任务：**[${next.id} ${next.title}](${next.card})**（${next.status} / ${next.mode}）。${next.nextAction}`
      : plan.tasks.every(task => task.status === 'accepted') ? '全部任务已接受；按计划完成归档。' : '暂无可直接执行的任务；先处理阻断或完成计划任务的准备门。', '',
    '阶段 partial 表示已有历史成果且仍有最终门；不撤销历史局部完成，也不冒充最终验收。', '',
    '## 阶段', '', '| 阶段 | 状态 | 当前依据与差距 |', '|---|---|---|',
    ...plan.stages.map(stage => `| [${stage.id} ${cell(stage.title)}](plan.md#${stage.id.toLowerCase()}) | ${stage.status} | ${cell(stage.summary)} |`), '',
    '## 任务依赖与入口', '', '| 任务 | 状态/类型 | 依赖 | Owner |', '|---|---|---|---|',
    ...plan.tasks.map(task => `| [${task.id} ${cell(task.title)}](${task.card}) | ${task.status} / ${task.mode} | ${task.dependsOn.join(', ') || '无'} | ${cell(task.owner ?? '开始时指定')} |`), '',
    `按[主执行任务书](${instructionFile})的固定顺序展开本步文件映射；依赖 accepted 且准备门通过后置 ready。实现需精确映射/命令，`,
    'verified/accepted 需可定位证据，高风险另需独立接受。状态检查不证明 evidence 内的业务结论。', '',
    '验证与未验范围查[证据索引](evidence/README.md)，风险查[风险台账](risks.md)。', ''].join('\n');
}
