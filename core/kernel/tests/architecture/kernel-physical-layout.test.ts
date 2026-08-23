import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const kernelRoot = path.resolve(__dirname, '../..');
const sourceRoot = path.join(kernelRoot, 'src');
const layers = ['domain', 'application', 'ports', 'adapters', 'runtime', 'composition'] as const;
type Layer = (typeof layers)[number] | 'external' | 'root';
type ImportEdge = { readonly source: string };

function walkTypeScript(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return walkTypeScript(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [entryPath] : [];
  });
}

/** Parses static imports, re-exports and literal dynamic imports from production source. */
export function parseImportEdges(text: string): ImportEdge[] {
  const sources: string[] = [];
  for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/g)) sources.push(match[1]);
  for (const match of text.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]\s*;?/g)) sources.push(match[1]);
  for (const match of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) sources.push(match[1]);
  return sources.map((source) => ({ source }));
}

function resolveImport(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) if (fs.existsSync(candidate)) return candidate;
  return base;
}

function layerFor(file: string | undefined): Layer {
  if (!file) return 'external';
  const top = path.relative(sourceRoot, file).split(path.sep)[0];
  return (layers as readonly string[]).includes(top) ? top as Layer : 'root';
}

function allows(from: Layer, to: Layer): boolean {
  if (to === 'external' || to === 'root') return true;
  if (from === 'domain') return to === 'domain';
  if (from === 'application') return to === 'domain' || to === 'application' || to === 'ports';
  if (from === 'ports') return to === 'domain' || to === 'ports';
  if (from === 'adapters') return to === 'domain' || to === 'ports' || to === 'adapters';
  if (from === 'runtime') return to === 'domain' || to === 'application' || to === 'ports' || to === 'runtime';
  return true;
}

function isGeneratedOrPlatformImport(specifier: string): boolean {
  return specifier.includes('/generated/') || specifier.startsWith('@glimmer-cradle/contracts')
    || specifier.startsWith('node:') || /^(?:fs|path|child_process|net|process|os|crypto|util|url)$/.test(specifier);
}

function assertSourcePolicy(file: string, text: string): void {
  const from = layerFor(file);
  for (const edge of parseImportEdges(text)) {
    const to = layerFor(resolveImport(file, edge.source));
    expect(allows(from, to), `${path.relative(sourceRoot, file)} -> ${edge.source}`).toBe(true);
    if (from === 'domain') expect(edge.source).not.toMatch(/@glimmer-cradle\/protocol|@glimmer-cradle\/contracts|\/generated\//);
    if (from === 'domain' || from === 'application' || from === 'ports' || from === 'runtime') {
      expect(isGeneratedOrPlatformImport(edge.source), `${path.relative(sourceRoot, file)} -> ${edge.source}`).toBe(false);
    }
  }
}

function assertApplicationTimingPolicy(file: string, text: string): void {
  const from = layerFor(file);
  if (from !== 'domain' && from !== 'application') return;
  expect(text, path.relative(sourceRoot, file)).not.toMatch(/\bNodeJS\./);
  expect(text, path.relative(sourceRoot, file)).not.toMatch(/\b(?:setTimeout|clearTimeout|setInterval|clearInterval|performance\.now)\s*\(/);
}

describe('Kernel physical layout', () => {
  it('keeps the six owned layers and deletes legacy aggregate roots', () => {
    for (const required of layers) expect(fs.statSync(path.join(sourceRoot, required)).isDirectory()).toBe(true);
    for (const legacy of ['foundation', 'host', 'infrastructure', 'lifecycle']) expect(fs.existsSync(path.join(sourceRoot, legacy))).toBe(false);
  });

  it('resolves every production import/export/dynamic-import through the layer matrix', () => {
    for (const file of walkTypeScript(sourceRoot)) {
      const text = fs.readFileSync(file, 'utf8');
      assertSourcePolicy(file, text);
      assertApplicationTimingPolicy(file, text);
    }
  });

  it('proves the parser and matrix reject inverted, generated and Node-OS samples', () => {
    const applicationFile = path.join(sourceRoot, 'application', 'fixture.ts');
    const runtimeFile = path.join(sourceRoot, 'runtime', 'fixture.ts');
    expect(parseImportEdges("export { x } from '../adapters/x'; import('node:fs');").map((edge) => edge.source)).toEqual(['../adapters/x', 'node:fs']);
    expect(() => assertSourcePolicy(applicationFile, "import x from '../adapters/x';")).toThrow();
    expect(() => assertSourcePolicy(runtimeFile, "export * from '../composition/root';")).toThrow();
    expect(() => assertSourcePolicy(applicationFile, "const x = import('node:child_process');")).toThrow();
    expect(() => assertSourcePolicy(path.join(sourceRoot, 'domain', 'fixture.ts'), "import type { T } from '@glimmer-cradle/protocol';")).toThrow();
    expect(() => assertApplicationTimingPolicy(applicationFile, 'const timer: NodeJS.Timeout = setTimeout(task, 1);')).toThrow();
    expect(() => assertApplicationTimingPolicy(path.join(sourceRoot, 'domain', 'fixture.ts'), 'const startedAt = performance.now();')).toThrow();
  });

  it('keeps concrete adapter imports and readiness-store mutation at their single owners', () => {
    const files = walkTypeScript(sourceRoot);
    const concreteImportsOutsideComposition = files.filter((file) => ['domain', 'application', 'ports', 'runtime'].includes(layerFor(file)) && parseImportEdges(fs.readFileSync(file, 'utf8'))
      .some((edge) => layerFor(resolveImport(file, edge.source)) === 'adapters'));
    expect(concreteImportsOutsideComposition).toEqual([]);
    const readinessStores = files.filter((file) => fs.readFileSync(file, 'utf8').includes('snapshotsByModule.set('));
    expect(readinessStores).toEqual([path.join(sourceRoot, 'application', 'projection', 'runtime-readiness-projection.ts')]);
  });

  it('keeps runtime modules coupled through Ports and the shared RuntimeModule contract only', () => {
    const illegalRuntimeConcreteImports = walkTypeScript(path.join(sourceRoot, 'runtime'))
      .flatMap((file) => parseImportEdges(fs.readFileSync(file, 'utf8')).map((edge) => ({ file, edge })))
      .filter(({ file, edge }) => {
        const target = resolveImport(file, edge.source);
        return layerFor(target) === 'runtime' && path.basename(target ?? '') !== 'runtime-module.ts';
      })
      .map(({ file, edge }) => `${path.relative(sourceRoot, file)} -> ${edge.source}`);
    expect(illegalRuntimeConcreteImports).toEqual([]);
  });

  it('rejects service locators, Proxy façades and untyped or raw Node capability aliases in Ports', () => {
    const portSources = walkTypeScript(path.join(sourceRoot, 'ports'))
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');
    expect(portSources).not.toMatch(/\bProxy\b|\bdeferredPort\b|\bserviceLocator\b|\bkernelSideEffectPorts\b/);
    expect(portSources).not.toMatch(/\b(?:nodeFs|ChildProcessWithoutNullStreams|RawData)\b/);
    expect(portSources).not.toMatch(/:\s*any\b|\bas\s+any\b|<\s*any\s*>|\bany\s*\[\s*\]/);
  });
});
