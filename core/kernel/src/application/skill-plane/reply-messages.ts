export interface NormalizedReplyMessage {
  readonly sequence: number;
  readonly content_type: 'text' | 'code';
  readonly text: string;
  readonly language?: string | null;
}

export function normalizeReplyMessages(
  text: string,
  messages?: readonly NormalizedReplyMessage[] | null,
): NormalizedReplyMessage[] {
  const explicit = (messages ?? [])
    .map((message, index) => ({
      sequence: index,
      content_type: message.content_type === 'code' ? 'code' as const : 'text' as const,
      text: message.text.trim(),
      language: message.language ?? null,
    }))
    .filter((message) => message.text.length > 0);
  if (explicit.length > 0) return explicit;
  const normalized = text.trim();
  return normalized ? [{ sequence: 0, content_type: 'text', text: normalized }] : [];
}
