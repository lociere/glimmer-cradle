import { create, toBinary } from '@bufbuild/protobuf';
import { snapshotPrincipal, type Principal, type PermissionRequest } from '@glimmer-cradle/platform';
import { ReadJobsProjectionRequestSchema, ReadJobsProjectionResponseSchema,
  type ReadJobsProjectionRequest } from '@glimmer-cradle/contracts/glimmer/jobs/v1/jobs_pb';
import type { HostJobsProjectionPort } from '../composition/host.js';
import { jobProjectionToWire } from '../adapters/protocol/job-mapper.js';
import { PermissionBroker } from '../broker/permission-broker.js';

/** 认证由 Host ingress 注入；请求中的 scope/metadata 不授予读取权限。 */
export class HostJobControlRoutes {
  public constructor(private readonly jobs: HostJobsProjectionPort, private readonly permissions: PermissionBroker) {}

  public permissionRequest(principal: Principal, scopeId: string): PermissionRequest {
    const identity = snapshotPrincipal(principal);
    return { principal_id: identity.principal_id, host_id: identity.host_id, generation: identity.generation,
      permission: 'jobs.read', resource_id: scopeId, resource_revision: `jobs:${this.jobs.authorityEpoch}`,
      target_location: identity.host_id };
  }

  public async read(principal: Principal, request: ReadJobsProjectionRequest, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const identity = snapshotPrincipal(principal);
    if (!request.call?.traceId.trim() || request.call.generation !== identity.generation
      || toBinary(ReadJobsProjectionRequestSchema, request).byteLength > 16384) throw new Error('Jobs 控制面请求身份/预算无效');
    const permission = this.permissionRequest(identity, request.scopeId), epoch = this.jobs.authorityEpoch;
    const decision = this.permissions.authorize(permission);
    if (!decision.allowed || permission.resource_revision !== `jobs:${epoch}` || !this.permissions.isCurrent(decision.grant)) throw new Error('Jobs 读取权限不足');
    const states = this.jobs.readJobStates(request.scopeId, request.limit, request.afterJobId);
    signal?.throwIfAborted();
    if (this.jobs.authorityEpoch !== epoch || !this.permissions.isCurrent(decision.grant)) throw new Error('Jobs 读取期间权限或authority已撤销');
    const notifications = await this.jobs.readNotificationStates(request.scopeId, states, signal);
    const response = create(ReadJobsProjectionResponseSchema, { authorityEpoch: BigInt(epoch),
      notifications,
      jobs: states.map(jobProjectionToWire), handlers: this.jobs.handlerCatalog.map(handler => ({ kind: handler.kind,
        retryMode: handler.retry_mode, available: handler.available })), nextAfterJobId: states.at(-1)?.job_id });
    signal?.throwIfAborted();
    if (this.jobs.authorityEpoch !== epoch || permission.resource_revision !== `jobs:${epoch}`
      || !this.permissions.isCurrent(decision.grant)) throw new Error('Jobs 读取期间权限或authority已撤销');
    if (toBinary(ReadJobsProjectionResponseSchema, response).byteLength > 262144) throw new Error('Jobs 投影响应超过预算');
    return response;
  }
}
