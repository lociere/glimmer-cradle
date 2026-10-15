import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import { localMarkdownTargets } from '../docs/check-docs.mjs';

const fields = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function checkSkills(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const directory = path.join(root, '.agents/skills');
  const errors = [];
  const label = file => path.relative(root, file).replaceAll('\\', '/');
  const inside = file => {
    const relative = path.relative(root, file);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  function filesAt(folder) {
    if (!fs.existsSync(folder)) return [];
    const parent = path.dirname(folder);
    if (fs.lstatSync(folder).isSymbolicLink() || (parent !== root && fs.lstatSync(parent).isSymbolicLink())) {
      errors.push(`${label(folder)}: project skill resources must be regular files/directories`);
      return [];
    }
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) {
        errors.push(`${label(file)}: project skill resources must be regular files/directories`);
        return [];
      }
      return entry.isDirectory() ? filesAt(file) : [file];
    });
  }
  function yaml(text, file) {
    const document = parseDocument(text, { uniqueKeys: true });
    if (document.errors.length) {
      errors.push(`${label(file)}: invalid YAML: ${document.errors[0].message}`);
      return undefined;
    }
    try { return document.toJS({ maxAliasCount: 0 }); }
    catch (error) { errors.push(`${label(file)}: invalid YAML: ${error.message}`); return undefined; }
  }

  const files = filesAt(directory);
  if (fs.existsSync(path.join(root, '.git')) && files.length) {
    // --no-index also catches an ignore that would hide a future untracked replacement.
    const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
      cwd: root, input: files.map(label).join('\n') + '\n', encoding: 'utf8',
    });
    if (result.status === 0) {
      for (const file of result.stdout.trim().split(/\r?\n/)) errors.push(`${file}: skill source is ignored by Git`);
    } else if (result.status !== 1) errors.push('project skills: Git visibility check could not run');
  }
  const manifests = files.filter(file => path.basename(file) === 'SKILL.md');
  if (!manifests.length) errors.push('.agents/skills: no project skills found');
  if (filesAt(path.join(root, '.codex/skills')).some(file => path.basename(file) === 'SKILL.md')) {
    errors.push('.codex/skills: retired discovery location still contains skills');
  }
  const names = new Set();
  for (const file of manifests) {
    if (path.relative(directory, file).split(path.sep).length !== 2) {
      errors.push(`${label(file)}: skill manifest must be directly under .agents/skills/<name>`);
    }
    const text = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
    if (!match) { errors.push(`${label(file)}: missing YAML frontmatter`); continue; }
    const metadata = yaml(match[1], file);
    if (!isMap(metadata)) { errors.push(`${label(file)}: frontmatter must be a mapping`); continue; }
    for (const key of Object.keys(metadata)) if (!fields.has(key)) errors.push(`${label(file)}: unsupported frontmatter field ${key}`);
    const { name, description } = metadata;
    if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
      errors.push(`${label(file)}: invalid skill name`);
    }
    if (name !== path.basename(path.dirname(file))) errors.push(`${label(file)}: name must match skill directory`);
    if (names.has(name)) errors.push(`${label(file)}: duplicate skill name ${name}`);
    names.add(name);
    if (typeof description !== 'string' || !description.trim() || description.length > 1024 || /[<>]/.test(description)) {
      errors.push(`${label(file)}: invalid skill description`);
    }
    if (metadata.compatibility !== undefined && (typeof metadata.compatibility !== 'string' || !metadata.compatibility.trim() || metadata.compatibility.length > 500)) {
      errors.push(`${label(file)}: invalid compatibility`);
    }
    for (const key of ['license', 'allowed-tools']) {
      if (metadata[key] !== undefined && (typeof metadata[key] !== 'string' || !metadata[key].trim())) errors.push(`${label(file)}: ${key} must be a nonempty string`);
    }
    if (metadata.metadata !== undefined && (!isMap(metadata.metadata) || Object.values(metadata.metadata).some(value => typeof value !== 'string'))) {
      errors.push(`${label(file)}: metadata values must be strings`);
    }
    const uiFile = path.join(path.dirname(file), 'agents/openai.yaml');
    if (!fs.existsSync(uiFile)) continue; // UI metadata is optional in Codex.
    if (fs.lstatSync(uiFile).isSymbolicLink()) continue;
    const ui = yaml(fs.readFileSync(uiFile, 'utf8'), uiFile);
    if (!isMap(ui)) { errors.push(`${label(uiFile)}: UI metadata must be a mapping`); continue; }
    if (ui.interface !== undefined) {
      if (!isMap(ui.interface)) errors.push(`${label(uiFile)}: interface must be a mapping`);
      else {
        for (const [key, value] of Object.entries(ui.interface)) {
          if (typeof value !== 'string' || !value.trim()) errors.push(`${label(uiFile)}: interface.${key} must be a nonempty string`);
        }
        const prompt = ui.interface.default_prompt;
        if (typeof prompt === 'string' && !prompt.includes(`$${name}`)) errors.push(`${label(uiFile)}: default_prompt must mention $${name}`);
        const short = ui.interface.short_description;
        if (typeof short === 'string' && (short.length < 25 || short.length > 64)) errors.push(`${label(uiFile)}: short_description must contain 25–64 characters`);
      }
    }
    if (ui.policy !== undefined && (!isMap(ui.policy) || (ui.policy.allow_implicit_invocation !== undefined && typeof ui.policy.allow_implicit_invocation !== 'boolean'))) {
      errors.push(`${label(uiFile)}: allow_implicit_invocation must be boolean`);
    }
  }

  const markdown = [...files.filter(file => file.endsWith('.md'))];
  const agentsFile = path.join(root, 'AGENTS.md');
  if (fs.existsSync(agentsFile)) markdown.push(agentsFile);
  const edges = new Map(markdown.map(file => [file, []]));
  for (const file of markdown) {
    for (const target of localMarkdownTargets(fs.readFileSync(file, 'utf8'))) {
      let resolved;
      try { resolved = path.resolve(path.dirname(file), decodeURIComponent(target.split('#')[0].split('?')[0])); }
      catch { errors.push(`${label(file)}: invalid link encoding: ${target}`); continue; }
      if (!inside(resolved) || !fs.existsSync(resolved) || !inside(fs.realpathSync(resolved))) {
        errors.push(`${label(file)}: missing or out-of-repository local target: ${target}`);
        continue;
      }
      edges.get(file).push(resolved);
    }
  }
  for (const manifest of manifests) {
    const reached = new Set();
    function visit(file) {
      if (reached.has(file)) return;
      reached.add(file);
      for (const next of edges.get(file) ?? []) visit(next);
    }
    visit(manifest);
    for (const file of markdown.filter(file => file.startsWith(`${path.dirname(manifest)}${path.sep}`))) {
      if (!reached.has(file)) errors.push(`${label(file)}: resource not reachable from SKILL.md`);
    }
  }
  return { skills: manifests.length, errors };
}
