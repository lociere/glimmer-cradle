import type { IncomingMessage, ServerResponse } from 'node:http';
import { applySecurityHeaders } from './security-headers';

export async function readJsonBody(
  incoming: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const buffer = await readBinaryBody(incoming, maxBytes);
  const parsed = JSON.parse(buffer.toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request_body_must_be_object');
  }
  return parsed as Record<string, unknown>;
}

export async function readBinaryBody(
  incoming: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error('request_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  applySecurityHeaders(response);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(body)}\n`);
}
