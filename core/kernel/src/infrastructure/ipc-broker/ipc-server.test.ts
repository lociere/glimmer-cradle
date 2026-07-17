import {
  IPCMessageType,
  createSuccessResponse,
  type IPCRequest,
} from '@glimmer-cradle/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { IPCServer } from './ipc-server';

class FakeRouter {
  private readonly queued: Buffer[][] = [];
  private receiver: ((frames: Buffer[]) => void) | null = null;

  receive(): Promise<Buffer[]> {
    const frames = this.queued.shift();
    if (frames) return Promise.resolve(frames);
    return new Promise((resolve) => {
      this.receiver = resolve;
    });
  }

  async send(frames: Buffer[]): Promise<void> {
    const request = JSON.parse(frames[1].toString('utf-8')) as IPCRequest;
    if (request.type === IPCMessageType.AGENT_PLAN) {
      this.push([
        frames[0],
        Buffer.from(JSON.stringify(createSuccessResponse(
          IPCMessageType.SUCCESS_RESPONSE,
          request.trace_id,
          { selected_tool: 'notification.show' },
        ))),
      ]);
    }
  }

  close(): void {}

  push(frames: Buffer[]): void {
    const receiver = this.receiver;
    this.receiver = null;
    if (receiver) {
      receiver(frames);
    } else {
      this.queued.push(frames);
    }
  }
}

async function waitFor(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assertion();
}

describe('IPCServer', () => {
  const server = IPCServer.instance as any;

  afterEach(async () => {
    await server.stop();
  });

  it('入站 handler 发起嵌套 RPC 时仍能接收 Cognition 响应', async () => {
    const socket = new FakeRouter();
    const clientId = Buffer.from('cognition');
    let nestedResult: unknown;

    server._routerSocket = socket;
    server._lastClientId = null;
    server._isRunning = true;
    server._requestHandlers.clear();

    server.registerHandler(IPCMessageType.ACTION_COMMAND, async (request: IPCRequest) => {
      nestedResult = await server.sendRequest(
        IPCMessageType.AGENT_PLAN,
        { goal: 'show notification' },
        500,
        { trace_id: request.trace_id },
      );
      return createSuccessResponse(IPCMessageType.SUCCESS_RESPONSE, request.trace_id);
    });

    server.startMessageLoop();
    socket.push([
      clientId,
      Buffer.from(JSON.stringify({
        type: IPCMessageType.ACTION_COMMAND,
        trace_id: 'nested-rpc-trace',
        payload: { action_type: 'skill_request' },
      })),
    ]);

    await waitFor(() => {
      expect(nestedResult).toEqual({ selected_tool: 'notification.show' });
    });
  });
});
