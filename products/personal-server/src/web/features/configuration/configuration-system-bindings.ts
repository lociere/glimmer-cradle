import type { McpServerConfig } from '@glimmer-cradle/protocol';
import type { ConfigurationDraftState } from './configuration-state';

export function bindSystemSectionInputs(
  root: HTMLElement,
  options: {
    readonly getDraft: () => ConfigurationDraftState | null;
    readonly render: () => void;
  },
): void {
  for (const element of Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-path]'))) {
    const eventName = element instanceof HTMLSelectElement || element instanceof HTMLInputElement && element.type === 'checkbox'
      ? 'change'
      : 'input';
    element.addEventListener(eventName, () => {
      const draft = options.getDraft();
      const targetPath = element.dataset.path;
      if (!draft || !targetPath) return;
      const nextValue = readElementValue(element);
      if (nextValue === INVALID_VALUE) {
        return;
      }
      setByPath(draft as unknown as Record<string, unknown>, targetPath, nextValue);
      if (eventName === 'change') {
        options.render();
      }
    });
  }

  root.querySelector('[data-action="add-mcp-server"]')?.addEventListener('click', () => {
    const draft = options.getDraft();
    if (!draft) return;
    const nextIndex = (draft.skills.mcp_servers ?? []).length + 1;
    const servers = draft.skills.mcp_servers ?? (draft.skills.mcp_servers = []);
    servers.push(createMcpServerDraft(nextIndex));
    options.render();
  });

  for (const button of Array.from(root.querySelectorAll<HTMLElement>('[data-action="remove-mcp-server"]'))) {
    button.addEventListener('click', () => {
      const draft = options.getDraft();
      const index = Number(button.dataset.serverIndex);
      if (!draft || !Number.isInteger(index)) return;
      draft.skills.mcp_servers = (draft.skills.mcp_servers ?? []).filter((_, currentIndex) => currentIndex !== index);
      options.render();
    });
  }
}

const INVALID_VALUE = Symbol('invalid-value');

function readElementValue(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): unknown {
  if (element instanceof HTMLInputElement && element.type === 'checkbox') {
    return element.checked;
  }
  const raw = element.value;
  switch (element.dataset.kind) {
    case 'number': {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : INVALID_VALUE;
    }
    case 'csv':
      return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    case 'lines':
      return raw
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
    case 'env-lines': {
      const entries = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf('=');
          if (separator === -1) return null;
          const key = line.slice(0, separator).trim();
          const value = line.slice(separator + 1).trim();
          return key ? [key, value] as const : null;
        })
        .filter((entry): entry is readonly [string, string] => entry !== null);
      return Object.fromEntries(entries);
    }
    default:
      return raw;
  }
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let cursor: unknown = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    if (Array.isArray(cursor)) {
      cursor = cursor[Number(segment)];
      continue;
    }
    const record = cursor as Record<string, unknown>;
    if (!(segment in record) || record[segment] == null) {
      record[segment] = /^\d+$/.test(nextSegment) ? [] : {};
    }
    cursor = record[segment];
  }

  const finalSegment = segments.at(-1);
  if (!finalSegment) return;
  if (Array.isArray(cursor)) {
    cursor[Number(finalSegment)] = value;
    return;
  }
  (cursor as Record<string, unknown>)[finalSegment] = value;
}

function createMcpServerDraft(index: number): McpServerConfig {
  return {
    id: `server-${index}`,
    enabled: true,
    products: ['personal-server'],
    transport: 'stdio',
    command: '',
    args: [],
    env: {},
    timeout_ms: 30000,
  };
}
