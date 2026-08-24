import { afterEach, describe, expect, it } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import { create } from '@bufbuild/protobuf';
import type { AvatarConfig } from '../../../adapters/config/documents/AvatarConfig';
import {
  AvatarDownstreamFrameSchema,
  AvatarUpstreamFrameSchema,
} from '@glimmer-cradle/contracts/glimmer/avatar/v1/avatar_host_pb';
import { RuntimeReadinessProjectionMapper } from '../../../application/projection/runtime-readiness-projection';
import { AvatarController } from '../../../adapters/avatar/avatar-controller';
import { duplexStreamingMethod } from '../../../adapters/cognition/grpc-contract';

const avatarConnectMethod = duplexStreamingMethod(
  '/glimmer.avatar.v1.AvatarHostService/Connect',
  AvatarUpstreamFrameSchema,
  AvatarDownstreamFrameSchema,
);

const readinessProjection = new RuntimeReadinessProjectionMapper();
const avatarController = new AvatarController(readinessProjection);

function createUnityAvatarHostConfig(
  overrides: Partial<AvatarConfig> = {},
): AvatarConfig {
  return {
    enabled: true,
    heartbeat_interval_ms: 50,
    heartbeat_timeout_ms: 150,
    host: {
      launch_mode: 'manual',
      command: '',
      args: [],
      cwd: '',
      env: {},
      startup_timeout_ms: 300,
      restart_on_exit: false,
    },
    emotion_mapping: {},
    ...overrides,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition not met before timeout');
}

function getAvatarRuntime() {
  return readinessProjection.getCatalog().runtimes.find(
    (runtime) => runtime.runtime_id === 'avatar.host',
  );
}

describe('AvatarController runtime readiness sync', () => {
  afterEach(async () => {
    await avatarController.stop();
    readinessProjection.clear();
  });

  it('keeps avatar runtime readiness aligned with shell lifecycle', async () => {
    await avatarController.init(createUnityAvatarHostConfig());

    await waitFor(() => Boolean(getAvatarRuntime()));
    expect(getAvatarRuntime()?.state).toBe('degraded');
    expect(getAvatarRuntime()?.reconciler?.actual).toBe('waiting-manual-launch');
    expect(getAvatarRuntime()?.reconciler?.resources.some((resource) => resource.resource_id === 'avatar.package-registry')).toBe(true);
    expect(getAvatarRuntime()?.reconciler?.resources.some((resource) => (
      resource.resource_id === 'avatar.sdk.catalog'
      || resource.resource_kind === 'unity_sdk'
    ))).toBe(true);

    const transport = avatarController as unknown as {
      _serverAddress: string;
      _authToken: string;
    };
    expect(transport._serverAddress).toMatch(/^127\.0\.0\.1:\d+$/);
    const client = new grpc.Client(transport._serverAddress, grpc.credentials.createInsecure());
    const metadata = new grpc.Metadata();
    metadata.set('x-glimmer-avatar-token', transport._authToken);
    const stream = client.makeBidiStreamRequest(
      avatarConnectMethod.path,
      avatarConnectMethod.requestSerialize,
      avatarConnectMethod.responseDeserialize,
      metadata,
    );
    const downstreamFrames: Array<{
      kind?: string;
      traceId?: string;
      thought?: { active?: boolean; hint?: string };
    }> = [];
    stream.on('data', (frame) => downstreamFrames.push(frame));

    await waitFor(() => getAvatarRuntime()?.reconciler?.actual === 'connected-waiting-ready-gates');

    stream.write(create(AvatarUpstreamFrameSchema, {
      kind: 'host_hello',
      timestamp: Date.now(),
      hostHello: {
        hostKind: 'unity',
        hostId: 'test-shell',
        hostVersion: '0.0.1',
        modelId: 'selrena-youling',
        avatarPackageId: 'selrena-youling',
      },
    }));
    stream.write(create(AvatarUpstreamFrameSchema, {
      kind: 'host_ready',
      timestamp: Date.now(),
      hostReady: {
        hostId: 'test-shell',
        modelId: 'selrena-youling',
        avatarPackageId: 'selrena-youling',
        workerWindowState: 'isolated',
        compositionSurfaceState: 'attached',
        firstFramePresented: true,
        interactionReady: true,
        summary: '首帧 ready',
      },
    }));

    await waitFor(() => getAvatarRuntime()?.state === 'ready');
    expect(getAvatarRuntime()?.reconciler?.actual).toBe('connected-first-frame-presented');

    avatarController.broadcastFrame({
      kind: 'thought',
      trace_id: 'trace-binary-dto',
      timestamp: Date.now(),
      thought: { active: true, hint: 'direct-generated-dto' },
    });
    await waitFor(() => downstreamFrames.some((frame) => frame.kind === 'thought'));
    expect(downstreamFrames.find((frame) => frame.kind === 'thought')).toMatchObject({
      kind: 'thought',
      traceId: 'trace-binary-dto',
      thought: { active: true, hint: 'direct-generated-dto' },
    });

    stream.end();
    await waitFor(() => getAvatarRuntime()?.reconciler?.actual === 'waiting-manual-launch');
    expect(getAvatarRuntime()?.state).toBe('degraded');
    client.close();
  });

  it('maps audio visual commands to media references instead of inline data', () => {
    const subject = avatarController as unknown as {
      _visualCommandToFrames(command: unknown): Array<{
        kind?: string;
        audio_play?: {
          audio_id?: string;
          audio_uri?: string;
          audio_data?: string;
          mime_type?: string;
        };
      }>;
    };

    const frames = subject._visualCommandToFrames({
      trace_id: 'trace-avatar-audio-ref',
      timestamp: 1787580000000,
      command_type: 'play_audio',
      audio: {
        audio_id: 'audio-ref-1',
        audio_uri: 'file:///D:/tmp/glimmer-cradle/audio/tts/reply.wav',
        audio_data: 'base64-must-not-cross-control-plane',
        mime_type: 'audio/wav',
      },
    });

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      kind: 'audio_play',
      audio_play: {
        audio_id: 'audio-ref-1',
        audio_uri: 'file:///D:/tmp/glimmer-cradle/audio/tts/reply.wav',
        mime_type: 'audio/wav',
      },
    });
    expect(frames[0].audio_play).not.toHaveProperty('audio_data');
  });

  it('rejects AvatarHostService.Connect without the process-scoped token', async () => {
    await avatarController.init(createUnityAvatarHostConfig());
    const transport = avatarController as unknown as { _serverAddress: string };
    const client = new grpc.Client(transport._serverAddress, grpc.credentials.createInsecure());
    const metadata = new grpc.Metadata();
    metadata.set('x-glimmer-avatar-token', 'wrong-token');
    const stream = client.makeBidiStreamRequest(
      avatarConnectMethod.path,
      avatarConnectMethod.requestSerialize,
      avatarConnectMethod.responseDeserialize,
      metadata,
    );
    stream.on('data', () => undefined);
    const failure = new Promise<grpc.ServiceError>((resolve) => stream.once('error', resolve));
    stream.write(create(AvatarUpstreamFrameSchema, { kind: 'host_hello', timestamp: Date.now() }));

    await expect(failure).resolves.toMatchObject({ code: grpc.status.PERMISSION_DENIED });
    client.close();
  });
});
