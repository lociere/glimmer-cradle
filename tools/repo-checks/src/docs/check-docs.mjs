import fs from 'node:fs';
import path from 'node:path';

function markdownFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? markdownFiles(target) : entry.name.endsWith('.md') ? [target] : [];
  });
}

// Check local file targets, not remote availability or renderer-specific heading slugs.
export function localMarkdownTargets(text) {
  let fence;
  const prose = text.split(/\r?\n/).map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return '';
    }
    return fence ? '' : line;
  }).join('\n').replace(/`+[^`\n]*`+/g, '');
  const targets = [
    ...prose.matchAll(/\]\((<[^>]+>|[^)]+)\)/g),
    ...prose.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm),
  ].map(match => match[1].replace(/^<|>$/g, '').replace(/\s+["'][\s\S]*$/, ''));
  return targets.filter(target => target && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target));
}

export function checkDocs(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const docs = path.join(root, 'docs');
  const active = markdownFiles(docs).filter(file => !path.relative(docs, file).split(path.sep).includes('history'));
  const errors = [];
  const edges = new Map(active.map(file => [file, new Set()]));
  const label = file => path.relative(root, file).replaceAll('\\', '/');
  for (const file of active) {
    for (const target of localMarkdownTargets(fs.readFileSync(file, 'utf8'))) {
      let decoded;
      try { decoded = decodeURIComponent(target.split('#')[0].split('?')[0]); }
      catch { errors.push(`${label(file)}: invalid link encoding: ${target}`); continue; }
      const resolved = path.resolve(path.dirname(file), decoded);
      if (!fs.existsSync(resolved)) {
        errors.push(`${label(file)}: missing local target: ${target}`);
        continue;
      }
      const destination = fs.statSync(resolved).isDirectory() ? path.join(resolved, 'README.md') : resolved;
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
