export function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", '&#39;');
}

export function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
