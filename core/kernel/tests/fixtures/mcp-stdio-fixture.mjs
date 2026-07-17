import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'selrena-test-mcp', version: '1.0.0' });

server.registerTool(
  'echo',
  {
    description: '回显传入文本。',
    inputSchema: { text: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ text }) => ({ content: [{ type: 'text', text }] }),
);

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
