import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function digestRuntimeOutputs(repoRoot, outputs) {
  const entries = [];
  const hash = createHash('sha256');
  for (const output of outputs) {
    const stat = await fs.stat(output).catch(() => null);
    if (!stat?.isFile()) return null;
    const bytes = await fs.readFile(output);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const relative = path.relative(repoRoot, output).replaceAll('\\', '/');
    entries.push({ path: relative, sha256: digest, size: bytes.length });
    hash.update(`${relative}\0${digest}\0${bytes.length}\n`);
  }
  return { entries, digest: hash.digest('hex') };
}

export async function digestRuntimeInputs(repoRoot, inputs, dependencyOutputDigests = [], inputFilter) {
  const files = [];
  for (const input of inputs) {
    const stat = await fs.stat(input).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      files.push(...await findFiles(input, inputFilter));
    } else if (!inputFilter || inputFilter(input)) {
      files.push(input);
    }
  }
  files.sort((left, right) => left.localeCompare(right));
  const hash = createHash('sha256');
  for (const dependencyDigest of dependencyOutputDigests) {
    hash.update(`dependency-output:${dependencyDigest}\n`);
  }
  for (const filePath of files) {
    hash.update(`${path.relative(repoRoot, filePath).replaceAll('\\', '/')}\0`);
    hash.update(await fs.readFile(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function findFiles(root, predicate = () => true) {
  const result = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      result.push(...await findFiles(filePath, predicate));
    } else if (entry.isFile() && predicate(filePath)) {
      result.push(filePath);
    }
  }
  return result;
}
