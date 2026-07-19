import type { ServerResponse } from 'node:http';
import { applySecurityHeaders } from './security-headers';

export function openEventStream(response: ServerResponse): void {
  applySecurityHeaders(response);
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  response.write(': connected\n\n');
}

export function sendEventStreamPayload(
  response: ServerResponse,
  event: string,
  payload: unknown,
): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}
