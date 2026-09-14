import { expect, it, vi } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import { create } from '@bufbuild/protobuf';
import * as contract from '@glimmer-cradle/contracts/glimmer/surface/v1/surface_gateway_pb';
import { unaryMethod, serverStreamingMethod } from '../cognition/grpc-contract';
import { EndpointRegistry } from '../endpoints/endpoint-registry';
import { ControlSurfaceGateway } from './control-surface-gateway';
import { RuntimeReadinessProjectionMapper } from '../../application/projection/runtime-readiness-projection';
import { AvatarController } from '../avatar/avatar-controller';
import { AudioService } from '../audio/audio-service';

it('真实 gRPC 会话排除只读观察者，绑定确认回执，并在取消流时释放请求', async () => {
  const projection = new RuntimeReadinessProjectionMapper();
  const gateway = new ControlSurfaceGateway(projection, new AvatarController(projection), new AudioService());
  const subject = gateway as any;
  // 初始 Avatar/Audio 投影不是本测试目标；Connect/Stream/Command 与 cleanup 使用真实 owner。
  const initial = vi.spyOn(subject, '_sendInitialSurfaceFrames').mockImplementation(() => {});
  const registry = vi.spyOn(EndpointRegistry.instance, 'get').mockReturnValue({ generation: 'test-generation' } as never);
  const definition = {
    Connect: unaryMethod('/glimmer.surface.v1.SurfaceGatewayService/Connect', contract.SurfaceGatewayServiceConnectRequestSchema, contract.SurfaceGatewayServiceConnectResponseSchema),
    Command: unaryMethod('/glimmer.surface.v1.SurfaceGatewayService/Command', contract.SurfaceGatewayServiceCommandRequestSchema, contract.SurfaceGatewayServiceCommandResponseSchema),
    Stream: serverStreamingMethod('/glimmer.surface.v1.SurfaceGatewayService/Stream', contract.SurfaceGatewayServiceStreamRequestSchema, contract.SurfaceGatewayServiceStreamResponseSchema),
  };
  const server = new grpc.Server();
  server.addService(definition, {
    Connect: subject._connectSurface.bind(gateway), Command: subject._commandSurface.bind(gateway), Stream: subject._streamSurface.bind(gateway),
  });
  const port = await new Promise<number>((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, value) => error ? reject(error) : resolve(value)));
  const Client = grpc.makeGenericClientConstructor(definition, 'SurfaceGatewayService');
  const client = new Client(`127.0.0.1:${port}`, grpc.credentials.createInsecure()) as any;
  const streams: grpc.ClientReadableStream<any>[] = [];
  const rpc = (method: string, request: unknown): Promise<any> => new Promise((resolve, reject) => client[method](request, (error: Error | null, result: unknown) => error ? reject(error) : resolve(result)));
  const connect = async (scopes: string[]) => {
    const response = await rpc('Connect', create(contract.SurfaceGatewayServiceConnectRequestSchema, { productId: 'personal-server', generation: 'test-generation', scopes }));
    expect(response.accepted).toBe(true);
    const stream = client.Stream(create(contract.SurfaceGatewayServiceStreamRequestSchema, { sessionId: response.sessionId }));
    stream.on('error', () => {});
    streams.push(stream);
    return { sessionId: response.sessionId, stream };
  };
  const request = { traceId: 'trace', skillId: 'core.desktop', targetKind: 'tool' as const, targetName: 'desktop.open_file', args: { path: 'C:\\Tools\\example.exe' }, riskLevel: 'high' as const, sideEffects: ['launch_external_app'] };
  try {
    const monitor = await connect(['surface:read']);
    const observed: unknown[] = [];
    monitor.stream.on('data', (event: unknown) => observed.push(event));
    const user = await connect(['surface:read', 'surface:write']);
    await vi.waitFor(() => expect(subject._clients.size).toBe(2));
    const next = () => new Promise<contract.SurfaceGatewayServiceStreamResponse>((resolve) => user.stream.once('data', resolve));
    const delivered = next();
    const decision = gateway.requestSkillConfirmation(request);
    const event = (await delivered).event!;
    expect(event.event.case).toBe('coreSkillConfirmationRequest');
    if (event.event.case !== 'coreSkillConfirmationRequest') throw new Error('wrong event');
    const requestId = event.event.value.requestId;
    expect(event.event.value.detail).toContain(JSON.stringify(request.args.path));
    expect(event.event.value.detail).toContain('可执行文件可能启动程序');
    const reply = (sessionId: string) => rpc('Command', create(contract.SurfaceGatewayServiceCommandRequestSchema, {
      sessionId, command: { case: 'coreSkillConfirmationResponse', value: create(contract.CoreSkillConfirmationResponseCommandSchema, { requestId, status: 'success', approved: true }) },
    }));
    expect((await reply(monitor.sessionId)).status).toBe('error');
    expect(subject._pendingSurfaceRequests.size).toBe(1);
    await reply(user.sessionId);
    await expect(decision).resolves.toBe(true);
    expect(observed).toHaveLength(0);
    const nextEvent = next();
    const disconnected = gateway.requestSkillConfirmation(request);
    const rejection = expect(disconnected).rejects.toThrow('已断开');
    await nextEvent;
    user.stream.cancel();
    await rejection;
    expect(subject._pendingSurfaceRequests.size).toBe(0);
  } finally {
    for (const stream of streams) stream.cancel();
    client.close();
    server.forceShutdown();
    initial.mockRestore(); registry.mockRestore();
  }
}, 10_000);
