import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(process.cwd());
const repoRoot = path.resolve(packageRoot, '../..');
const publicEntries = [
  'src/index.ts',
  'src/contracts/index.ts',
  'src/host/index.ts',
].map((entry) => path.join(packageRoot, entry));

const forbiddenOwnerPattern = /^(?:AudioConfig|EmbeddingConfig|MemoryConfig|SkillPlaneConfig|McpServerConfig|Configuration|ConversationHistory|Presentation|Extension(?:Command(?:Request|Result)|Install|Installation|Lifecycle(?:Request|Result)|RuntimeProjection|StatusChanged|Uninstall))/;

function resolveModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const candidate = path.resolve(path.dirname(fromFile), specifier);
  for (const target of [`${candidate}.ts`, path.join(candidate, 'index.ts')]) {
    try { if (statSync(target).isFile()) return target; } catch { /* absent edge */ }
  }
  return null;
}

function reachablePublicSources(): Set<string> {
  const visited = new Set<string>();
  const pending = [...publicEntries];
  const reexport = /export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(reexport)) {
      const target = resolveModule(file, match[1]);
      if (target) pending.push(target);
    }
  }
  return visited;
}

function exportedSymbols(source: string): string[] {
  const symbols = new Set<string>();
  for (const match of source.matchAll(/export\s+(?:declare\s+)?(?:interface|type|class|function|const|enum)\s+([A-Za-z_$][\w$]*)/g)) symbols.add(match[1]);
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const item of match[1].split(',')) {
      const name = item.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) symbols.add(name);
    }
  }
  return [...symbols];
}

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'generated', '.git'].includes(entry.name)) files.push(...sourceFiles(target));
    } else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) files.push(target);
  }
  return files;
}

describe('Extension SDK public owner boundary', () => {
  it('barrel 与 re-export 图不暴露非 Extension owner 类型', () => {
    const violations = [...reachablePublicSources()].flatMap((file) =>
      exportedSymbols(readFileSync(file, 'utf8'))
        .filter((symbol) => forbiddenOwnerPattern.test(symbol))
        .map((symbol) => `${path.relative(packageRoot, file)}:${symbol}`));
    expect(violations).toEqual([]);
  });

  it('production import 不从 SDK 重新取得非 owner 类型', () => {
    const roots = ['core', 'packages', 'products', 'templates']
      .map((root) => path.join(repoRoot, root))
      .filter((root) => { try { return statSync(root).isDirectory(); } catch { return false; } });
    const violations: string[] = [];
    const importPattern = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@glimmer-cradle\/extension-sdk(?:\/[^'"]*)?['"]/g;
    for (const file of roots.flatMap(sourceFiles)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(importPattern)) {
        for (const item of match[1].split(',')) {
          const imported = item.trim().split(/\s+as\s+/)[0]?.replace(/^type\s+/, '').trim();
          if (imported && forbiddenOwnerPattern.test(imported)) violations.push(`${path.relative(repoRoot, file)}:${imported}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
