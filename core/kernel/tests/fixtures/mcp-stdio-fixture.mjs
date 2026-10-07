import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'selrena-test-mcp', version: '1.0.0' });
const cancellation = { entered: false, cancelled: false };
server.registerResource('cancellation', 'selrena-test://cancellation', { description: '测试取消状态。' },
  async uri => ({ contents: [{ uri: uri.href, text: JSON.stringify(cancellation) }] }));
server.registerPrompt('slow', { description: '测试真实取消。', argsSchema: {} }, async (_args, extra) => {
  cancellation.entered = true;
  await new Promise((_resolve, reject) => {
    const abort = () => { cancellation.cancelled = true; reject(new Error('cancelled')); };
    if (extra.signal.aborted) abort();
    else extra.signal.addEventListener('abort', abort, { once: true });
  });
  return { messages: [] };
});

server.registerTool(
  'echo',
  {
    description: '回显传入文本。',
    inputSchema: { text: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ text }) => ({ content: [{ type: 'text', text }] }),
);

server.registerTool('disconnect_fixture', { description: '关闭测试服务以验证真实断线恢复。', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => {
  setTimeout(() => process.exit(0), 30);
  return { content: [{ type: 'text', text: 'disconnecting' }] };
});

server.registerResource(
  'profile',
  'selrena-test://profile',
  { description: '测试用只读资料。' },
  async (uri) => ({ contents: [{ uri: uri.href, text: 'Selrena MCP fixture' }] }),
);

server.registerPrompt(
  'greet',
  {
    description: '生成问候提示。',
    argsSchema: { name: z.string() },
  },
  ({ name }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `你好，${name}` } }] }),
);

await server.connect(new StdioServerTransport());
