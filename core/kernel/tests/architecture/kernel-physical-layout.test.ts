import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const kernelRoot = path.resolve(__dirname, '../..');
const sourceRoot = path.join(kernelRoot, 'src');

function walkTypeScript(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return walkTypeScript(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

function policyAllows(from: string, to: string): boolean {
  if (from === 'domain') return to === 'domain';
  if (from === 'application') return to === 'domain' || to === 'ports' || to === 'application';
  if (from === 'ports') return to === 'domain' || to === 'ports';
  if (from === 'adapters') return to !== 'runtime' && to !== 'composition';
  return true;
}

describe('Kernel physical layout', () => {
  it('keeps the six owned layers and deletes legacy aggregate roots', () => {
    for (const required of ['domain', 'application', 'ports', 'adapters', 'runtime', 'composition']) {
      expect(fs.statSync(path.join(sourceRoot, required)).isDirectory()).toBe(true);
    }
    for (const legacy of ['foundation', 'host', 'infrastructure', 'lifecycle']) {
      expect(fs.existsSync(path.join(sourceRoot, legacy))).toBe(false);
    }
  });

  it('rejects legacy imports and keeps Domain free from OS/process dependencies', () => {
    const files = walkTypeScript(sourceRoot);
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text).not.toMatch(/(?:from\s+|import\s*\()\s*['"][^'"]*(?:foundation\/|infrastructure\/|application\/services\/|\/host\/)/);
      if (file.startsWith(path.join(sourceRoot, 'domain'))) {
        expect(text).not.toMatch(/node:(?:fs|child_process|net)|from ['"](?:fs|child_process|net)['"]|\bprocess\./);
        expect(text).not.toMatch(/(?:\.\.\/)+(?:adapters|runtime|composition)\//);
      }
    }
  });

  it('has an Application-owned single readiness projection writer', () => {
    const writers = walkTypeScript(sourceRoot).filter((file) => (
      fs.readFileSync(file, 'utf8').includes('public replaceModuleSnapshots(')
    ));
    expect(writers).toEqual([
      path.join(sourceRoot, 'application', 'projection', 'runtime-readiness-projection.ts'),
    ]);
  });

  it('accepts intended directions and rejects inverted samples', () => {
    expect(policyAllows('application', 'ports')).toBe(true);
    expect(policyAllows('adapters', 'ports')).toBe(true);
    expect(policyAllows('domain', 'adapters')).toBe(false);
    expect(policyAllows('ports', 'adapters')).toBe(false);
    expect(policyAllows('application', 'runtime')).toBe(false);
  });
});
