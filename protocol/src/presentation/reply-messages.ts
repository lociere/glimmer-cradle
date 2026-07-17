import type {
  ActionReplyMessage,
  PresentationReplyMessage,
  ChannelReplyMessage,
} from '../generated/models';

export type ReplyMessageContentType = 'text' | 'code';

export interface NormalizedReplyMessage {
  sequence: number;
  content_type: ReplyMessageContentType;
  text: string;
  language?: string | null;
}

type WireReplyMessage =
  | ActionReplyMessage
  | PresentationReplyMessage
  | ChannelReplyMessage
  | NormalizedReplyMessage;

const MAX_AUTO_MESSAGES = 4;
const CODE_FENCE_RE = /```[\s\S]*?```/;
const CLOSING_PUNCTUATION = new Set(['”', '’', '"', "'", ')', '）', ']', '】', '》', '」', '』']);
const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '~', '～']);

export function normalizeReplyMessages(
  text: string,
  messages?: readonly WireReplyMessage[] | null,
): NormalizedReplyMessage[] {
  const explicit = normalizeExplicitMessages(messages);
  if (explicit.length > 0) {
    return explicit;
  }

  return splitReplyText(text).map((part, index) => ({
    sequence: index,
    content_type: 'text',
    text: part,
  }));
}

function normalizeExplicitMessages(
  messages?: readonly WireReplyMessage[] | null,
): NormalizedReplyMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((message, fallbackIndex) => {
      const contentType: ReplyMessageContentType = message.content_type === 'code' ? 'code' : 'text';
      return {
        sequence: Number.isInteger(message.sequence) ? message.sequence : fallbackIndex,
        content_type: contentType,
        text: typeof message.text === 'string' ? message.text.trim() : '',
        language: typeof message.language === 'string' ? message.language : null,
      };
    })
    .filter((message) => message.text.length > 0)
    .sort((left, right) => left.sequence - right.sequence)
    .map((message, index) => ({
      ...message,
      sequence: index,
    }));
}

function splitReplyText(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  if (CODE_FENCE_RE.test(normalized)) {
    return [normalized];
  }

  const paragraphParts = normalized
    .split(/\r?\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphParts.length > 1) {
    return limitMessageCount(paragraphParts);
  }

  return limitMessageCount(splitBySentence(normalized));
}

function splitBySentence(text: string): string[] {
  const parts: string[] = [];
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!SENTENCE_END.has(char)) {
      continue;
    }

    let end = index + 1;
    while (end < text.length && CLOSING_PUNCTUATION.has(text[end])) {
      end += 1;
    }

    const part = text.slice(start, end).trim();
    if (part) {
      parts.push(part);
    }
    start = end;
  }

  const tail = text.slice(start).trim();
  if (tail) {
    parts.push(tail);
  }

  return parts.length > 0 ? parts : [text];
}

function limitMessageCount(parts: string[]): string[] {
  if (parts.length <= MAX_AUTO_MESSAGES) {
    return parts;
  }

  return [
    ...parts.slice(0, MAX_AUTO_MESSAGES - 1),
    parts.slice(MAX_AUTO_MESSAGES - 1).join('\n'),
  ];
}
