import { WebSocket, type RawData } from 'ws';
import {
  SurfaceGatewayClient,
  type SurfaceGatewayClientFactory,
  type SurfaceGatewayClientLike,
  SURFACE_GATEWAY_OPEN,
  SURFACE_GATEWAY_CONNECTING,
} from './surface-gateway-client';
import type {
  ProductSurfaceProjection,
  ProductSurfaceRequest,
} from './surface-grpc-mapper';
import {
  LocalExtensionUploadStore,
  type LocalExtensionUploadAuthorization,
} from '../adapters/local-extension-upload-store';

const EXTENSION_TRANSACTION_TTL_MS = 30 * 60 * 1000;
const EXTENSION_CANCEL_TIMEOUT_MS = 1500;

interface ProxyOptions {
  readonly extensionUploadAuthorization?: LocalExtensionUploadAuthorization;
  readonly localExtensionUploads?: LocalExtensionUploadStore;
  readonly surfaceGatewayClientFactory?: SurfaceGatewayClientFactory;
}

interface PendingPrepareRequest {
  readonly authorization: LocalExtensionUploadAuthorization;
  readonly uploadedPackage: boolean;
}

interface BoundTransaction {
  readonly authorization: LocalExtensionUploadAuthorization;
  readonly timer: NodeJS.Timeout;
}

interface PendingCancellation {
  readonly transactionId: string;
  readonly resolve: () => void;
  readonly timer: NodeJS.Timeout;
}

export function proxySurfaceConnection(
  client: WebSocket,
  endpoint: string,
  generationOrOptions: string | ProxyOptions,
  maybeOptions: ProxyOptions = {},
): void {
  const generation = typeof generationOrOptions === 'string' ? generationOrOptions : '';
  const options = typeof generationOrOptions === 'string' ? maybeOptions : generationOrOptions;
  const upstream: SurfaceGatewayClientLike = options.surfaceGatewayClientFactory?.() ?? new SurfaceGatewayClient();
  const pending: ProductSurfaceRequest[] = [];
  const pendingPrepareRequests = new Map<string, PendingPrepareRequest>();
  const transactionBindings = new Map<string, BoundTransaction>();
  const commitRequests = new Map<string, string>();
  const cancelRequests = new Map<string, string>();
  const pendingCancellationWaiters = new Map<string, PendingCancellation>();
  let acceptingMessages = true;
  let clientTerminationPromise: Promise<void> | null = null;
  let localCleanupPromise: Promise<void> | null = null;

  client.on('message', (data, binary) => {
    void handleClientMessage(data, binary);
  });

  upstream.on('open', () => {
    for (const item of pending.splice(0)) {
      upstream.submit(item);
    }
  });

  upstream.on('message', (frame: ProductSurfaceProjection) => {
    void handleUpstreamMessage(frame);
  });

  client.on('close', () => {
    acceptingMessages = false;
    clientTerminationPromise ??= terminateClientSession();
  });
  upstream.on('close', () => {
    acceptingMessages = false;
    localCleanupPromise ??= cleanupLocalState();
    closePeer(client);
  });
  client.on('error', () => {
    acceptingMessages = false;
    clientTerminationPromise ??= terminateClientSession();
  });
  upstream.on('error', () => {
    acceptingMessages = false;
    localCleanupPromise ??= cleanupLocalState();
    closePeer(client);
  });

  async function handleClientMessage(
    data: RawData,
    binary: boolean,
  ): Promise<void> {
    const frame = await rewriteClientFrame(data, binary);
    if (!frame) return;
    if (upstream.readyState === SURFACE_GATEWAY_OPEN) {
      upstream.submit(frame);
      return;
    }
    if (upstream.readyState === SURFACE_GATEWAY_CONNECTING) {
      pending.push(frame);
    }
  }

  async function handleUpstreamMessage(
    frame: ProductSurfaceProjection,
  ): Promise<void> {
      if (frame.kind === 'extension_install_preview' && frame.extension_install_preview?.request_id) {
        await handlePrepareResponse(frame.extension_install_preview.request_id, frame.extension_install_preview.transaction_id);
      } else if (frame.kind === 'extension_install_result' && frame.extension_install_result?.request_id) {
        const requestId = frame.extension_install_result.request_id;
        cleanupRequestTransaction(commitRequests, requestId);
        cleanupRequestTransaction(cancelRequests, requestId);
      }
    if (acceptingMessages && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(frame));
    }
  }

  async function rewriteClientFrame(
    data: RawData,
    binary: boolean,
  ): Promise<ProductSurfaceRequest | null> {
    if (binary) {
      client.close(1003, 'Surface Gateway 仅接受 JSON 文本请求');
      return null;
    }
    const frame = parseFrame<ProductSurfaceRequest>(data);
    if (!frame || typeof frame.kind !== 'string') {
      client.close(1007, 'Surface Gateway 请求不是有效 JSON DTO');
      return null;
    }

    if (frame.kind === 'extension_install_prepare' && frame.extension_install_prepare) {
      return rewritePrepareRequest(frame);
    }
    if (frame.kind === 'extension_install_commit' && frame.extension_install_commit) {
      return authorizeTransactionRequest(frame, 'commit');
    }
    if (frame.kind === 'extension_install_cancel' && frame.extension_install_cancel) {
      return authorizeTransactionRequest(frame, 'cancel');
    }
    return frame;
  }

  async function rewritePrepareRequest(
    frame: ProductSurfaceRequest,
  ): Promise<ProductSurfaceRequest | null> {
    const request = frame.extension_install_prepare;
    if (!request) return null;
    const authorization = options.extensionUploadAuthorization;
    if (!authorization) {
      client.send(JSON.stringify(buildPreviewError(request.request_id, '当前连接未建立扩展安装授权上下文。')));
      return null;
    }
    if (request.source.kind === 'file') {
      client.send(JSON.stringify(buildPreviewError(
        request.request_id,
        'Personal Server 不接受客户端提交服务器文件路径；请先上传本地 .gcex，再使用受控 upload_id 发起安装预览。',
      )));
      return null;
    }

    pendingPrepareRequests.set(request.request_id, {
      authorization,
      uploadedPackage: request.source.kind === 'uploaded_package',
    });

    if (request.source.kind !== 'uploaded_package') {
      return frame;
    }
    if (!options.localExtensionUploads) {
      pendingPrepareRequests.delete(request.request_id);
      client.send(JSON.stringify(buildPreviewError(request.request_id, '本地扩展上传桥尚未就绪。')));
      return null;
    }
    try {
      const materialized = await options.localExtensionUploads.materializeUploadForPrepare(
        request.source.upload_id,
        request.request_id,
        authorization,
      );
      return {
          ...frame,
          extension_install_prepare: {
            ...request,
            source: {
              kind: 'file',
              path: materialized.path,
            },
          },
        } satisfies ProductSurfaceRequest;
    } catch (error) {
      pendingPrepareRequests.delete(request.request_id);
      client.send(JSON.stringify(buildPreviewError(
        request.request_id,
        error instanceof Error ? error.message : String(error),
      )));
      return null;
    }
  }

  async function authorizeTransactionRequest(
    frame: ProductSurfaceRequest,
    kind: 'commit' | 'cancel',
  ): Promise<ProductSurfaceRequest | null> {
    const authorization = options.extensionUploadAuthorization;
    const request = kind === 'commit' ? frame.extension_install_commit : frame.extension_install_cancel;
    if (!request) return null;
    const binding = transactionBindings.get(request.transaction_id);
    if (!authorization || !binding) {
      client.send(JSON.stringify(buildInstallResultError(
        request.request_id,
        '扩展安装事务不存在、已过期，或不属于当前登录会话。',
      )));
      return null;
    }
    if (binding.authorization.principalId !== authorization.principalId
      || binding.authorization.sessionBinding !== authorization.sessionBinding) {
      client.send(JSON.stringify(buildInstallResultError(
        request.request_id,
        '扩展安装事务不存在、已过期，或不属于当前登录会话。',
      )));
      return null;
    }
    if (kind === 'commit') commitRequests.set(request.request_id, request.transaction_id);
    else cancelRequests.set(request.request_id, request.transaction_id);
    return frame;
  }

  async function handlePrepareResponse(requestId: string, transactionId?: string): Promise<void> {
    const pendingPrepare = pendingPrepareRequests.get(requestId);
    if (!pendingPrepare) return;
    pendingPrepareRequests.delete(requestId);
    if (pendingPrepare.uploadedPackage) {
      await options.localExtensionUploads?.finalizePrepare(requestId, transactionId);
    }
    if (!transactionId) return;
    bindTransaction(transactionId, pendingPrepare.authorization);
  }

  function bindTransaction(transactionId: string, authorization: LocalExtensionUploadAuthorization): void {
    clearTransactionBinding(transactionId);
    const timer = setTimeout(() => {
      void cancelBoundTransaction(transactionId);
    }, EXTENSION_TRANSACTION_TTL_MS);
    timer.unref?.();
    transactionBindings.set(transactionId, { authorization, timer });
  }

  async function cleanupForDisconnect(): Promise<void> {
    await cleanupPendingPrepareRequests('discard');
    if (options.extensionUploadAuthorization && options.localExtensionUploads) {
      await options.localExtensionUploads.disposeSessionUploads(options.extensionUploadAuthorization);
    }
    await Promise.allSettled([...transactionBindings.keys()].map((transactionId) => cancelBoundTransaction(transactionId)));
    commitRequests.clear();
    cancelRequests.clear();
  }

  async function cleanupLocalState(): Promise<void> {
    await cleanupPendingPrepareRequests('discard');
    if (options.extensionUploadAuthorization && options.localExtensionUploads) {
      await options.localExtensionUploads.disposeSessionUploads(options.extensionUploadAuthorization);
    }
    for (const transactionId of [...transactionBindings.keys()]) {
      clearTransactionBinding(transactionId);
    }
    for (const [requestId, pendingCancellation] of pendingCancellationWaiters) {
      clearTimeout(pendingCancellation.timer);
      pendingCancellation.resolve();
      pendingCancellationWaiters.delete(requestId);
    }
    commitRequests.clear();
    cancelRequests.clear();
  }

  async function cleanupPendingPrepareRequests(mode: 'abort' | 'discard'): Promise<void> {
    for (const [requestId, pendingPrepare] of pendingPrepareRequests) {
      pendingPrepareRequests.delete(requestId);
      if (!pendingPrepare.uploadedPackage) continue;
      if (mode === 'discard') await options.localExtensionUploads?.discardPrepare(requestId);
      else await options.localExtensionUploads?.abortPrepare(requestId);
    }
  }

  async function cancelBoundTransaction(transactionId: string): Promise<void> {
    if (upstream.readyState !== WebSocket.OPEN) {
      clearTransactionBinding(transactionId);
      return;
    }
    const requestId = `extension-install-cancel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const waitForResult = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        clearTransactionBinding(transactionId);
        pendingCancellationWaiters.delete(requestId);
        cancelRequests.delete(requestId);
        resolve();
      }, EXTENSION_CANCEL_TIMEOUT_MS);
      timer.unref?.();
      pendingCancellationWaiters.set(requestId, {
        transactionId,
        resolve: () => {
          clearTimeout(timer);
          pendingCancellationWaiters.delete(requestId);
          resolve();
        },
        timer,
      });
    });
    cancelRequests.set(requestId, transactionId);
    upstream.submit({
      kind: 'extension_install_cancel',
      timestamp: Date.now(),
      extension_install_cancel: {
        request_id: requestId,
        transaction_id: transactionId,
      },
    });
    await waitForResult;
  }

  function clearTransactionBinding(transactionId: string): void {
    const binding = transactionBindings.get(transactionId);
    if (!binding) return;
    clearTimeout(binding.timer);
    transactionBindings.delete(transactionId);
  }

  function cleanupRequestTransaction(store: Map<string, string>, requestId: string): void {
    const transactionId = store.get(requestId);
    if (!transactionId) return;
    store.delete(requestId);
    const pendingCancellation = pendingCancellationWaiters.get(requestId);
    if (pendingCancellation) {
      pendingCancellation.resolve();
      pendingCancellationWaiters.delete(requestId);
    }
    clearTransactionBinding(transactionId);
  }

  async function terminateClientSession(): Promise<void> {
    await cleanupForDisconnect();
    closePeer(upstream);
  }

  void upstream.connect(endpoint, generation, 'personal-server').catch(() => {
    acceptingMessages = false;
    localCleanupPromise ??= cleanupLocalState();
    closePeer(client);
  });
}

function buildPreviewError(requestId: string, message: string): ProductSurfaceProjection {
  return {
    kind: 'extension_install_preview',
    timestamp: Date.now(),
    extension_install_preview: {
      request_id: requestId || `extension-install-rejected-${Date.now()}`,
      status: 'error',
      message,
    },
  };
}

function buildInstallResultError(requestId: string, message: string): ProductSurfaceProjection {
  return {
    kind: 'extension_install_result',
    timestamp: Date.now(),
    extension_install_result: {
      request_id: requestId || `extension-install-rejected-${Date.now()}`,
      status: 'error',
      message,
    },
  };
}

function closePeer(peer: WebSocket | SurfaceGatewayClientLike): void {
  if (peer.readyState === WebSocket.OPEN || peer.readyState === WebSocket.CONNECTING
    || peer.readyState === SURFACE_GATEWAY_OPEN || peer.readyState === SURFACE_GATEWAY_CONNECTING) {
    peer.close();
  }
}

function parseFrame<T>(data: RawData): T | null {
  try {
    return JSON.parse(data.toString()) as T;
  } catch {
    return null;
  }
}
