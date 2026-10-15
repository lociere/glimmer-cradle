import fs from 'node:fs';
import path from 'node:path';
import { checkDocumentationStructure } from './documentation-structure.mjs';
import { markdownInfo } from './markdown.mjs';

function markdownFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? markdownFiles(target) : entry.name.endsWith('.md') ? [target] : [];
  });
}

// Public file-link helper is also consumed by Skill validation.
export function localMarkdownTargets(text) {
  return markdownInfo(text).links.filter(target => !target.startsWith('#'));
}

export function checkDocs(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const docs = path.join(root, 'docs');
  const active = markdownFiles(docs).filter(file => !path.relative(docs, file).split(path.sep).includes('history'));
  const errors = checkDocumentationStructure(root);
  const edges = new Map(active.map(file => [file, new Set()]));
  const info = new Map();
  const readInfo = file => {
    if (!info.has(file)) info.set(file, markdownInfo(fs.readFileSync(file, 'utf8')));
    return info.get(file);
  };
  const label = file => path.relative(root, file).replaceAll('\\', '/');
  for (const file of active) {
    for (const target of readInfo(file).links) {
      let decoded, fragment;
      try {
        const [address, ...parts] = target.split('#');
        decoded = decodeURIComponent(address.split('?')[0]);
        fragment = decodeURIComponent(parts.join('#'));
      }
      catch { errors.push(`${label(file)}: invalid link encoding: ${target}`); continue; }
      const resolved = decoded ? path.resolve(path.dirname(file), decoded) : file;
      if (!fs.existsSync(resolved)) {
        errors.push(`${label(file)}: missing local target: ${target}`);
        continue;
      }
      const destination = fs.statSync(resolved).isDirectory() ? path.join(resolved, 'README.md') : resolved;
      if (fragment && destination.endsWith('.md') && fs.existsSync(destination) && !readInfo(destination).headings.has(fragment)) {
        errors.push(`${label(file)}: missing Markdown heading: ${target}`);
      }
      if (edges.has(destination)) edges.get(file).add(destination);
    }
  }
  const entry = path.join(docs, 'README.md');
  if (!edges.has(entry)) errors.push('docs/README.md: documentation entry is missing');
  const reached = new Set();
  function visit(file) {
    if (reached.has(file)) return;
    reached.add(file);
    for (const target of edges.get(file) ?? []) visit(target);
  }
  visit(entry);
  for (const file of active) if (!reached.has(file)) errors.push(`${label(file)}: not reachable from docs/README.md through active documentation`);
  return { activeFiles: active.length, errors };
}
