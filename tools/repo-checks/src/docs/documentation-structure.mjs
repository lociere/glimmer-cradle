import fs from 'node:fs';
import path from 'node:path';
import { manifestPath } from '../architecture/target-layout.mjs';
import { executionPath, statusPath, validateExecutionPlan, renderExecutionStatus } from './execution-plan.mjs';

export const structurePath = 'docs/governance/documentation-architecture.md';
const start = '<!-- docs-layout:start -->';
const end = '<!-- docs-layout:end -->';

export function renderDocumentationTree(files) {
  const tree = new Map();
  for (const file of files.filter(file => file.startsWith('docs/')).sort()) {
    let branch = tree;
    for (const part of file.slice(5).split('/')) {
      if (!branch.has(part)) branch.set(part, new Map());
      branch = branch.get(part);
    }
  }
  const lines = [start, '', '```text', 'docs/'];
  function visit(branch, prefix) {
    [...branch].forEach(([name, children], index) => {
      const last = index === branch.size - 1;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${name}${children.size ? '/' : ''}`);
      visit(children, prefix + (last ? '    ' : '│   '));
    });
  }
  visit(tree, '');
  return [...lines, '```', '', end].join('\n');
}

function inventory(root, prefix = 'docs') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const file = `${prefix}/${entry.name}`;
    return entry.isDirectory() ? inventory(root, file) : [file];
  });
}

export function checkDocumentationStructure(root, { write = false } = {}) {
  // Standalone link fixtures do not contain the product target contract.
  if (!fs.existsSync(path.join(root, manifestPath))) return fs.existsSync(path.join(root, structurePath)) ? ['documentation governance: target manifest missing'] : [];
  const errors = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath), 'utf8'));
    const expected = new Set(manifest.repositoryFiles.map(entry => entry.path).filter(file => file.startsWith('docs/')));
    const actual = new Set(inventory(root));
    for (const file of expected) if (!actual.has(file)) errors.push(`${file}: missing documented file`);
    for (const file of actual) if (!expected.has(file)) errors.push(`${file}: unlisted documentation file`);
    const plan = JSON.parse(fs.readFileSync(path.join(root, executionPath), 'utf8'));
    const planErrors = validateExecutionPlan(plan, root);
    errors.push(...planErrors);
    const status = renderExecutionStatus(plan);
    const statusFile = path.join(root, statusPath);
    if (write && planErrors.length === 0) fs.writeFileSync(statusFile, status);
    else if (!fs.existsSync(statusFile) || fs.readFileSync(statusFile, 'utf8').replaceAll('\r\n', '\n') !== status) errors.push(`${statusPath}: generated status drift; run pnpm check:docs --write`);
    const file = path.join(root, structurePath);
    const document = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
    const first = document.indexOf(start);
    const last = document.indexOf(end);
    if (first < 0 || last < first || document.indexOf(start, first + 1) >= 0 || document.indexOf(end, last + 1) >= 0) {
      errors.push(`${structurePath}: invalid docs layout markers`);
    } else {
      const rendered = renderDocumentationTree([...expected]);
      if (write) fs.writeFileSync(file, document.slice(0, first) + rendered + document.slice(last + end.length));
      else if (document.slice(first, last + end.length) !== rendered) errors.push(`${structurePath}: generated docs tree drift; run pnpm check:docs --write`);
    }
  } catch (error) { errors.push(`documentation governance: ${error.message}`); }
  return errors;
}
