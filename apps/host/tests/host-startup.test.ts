import { describe, it, expect, vi } from 'vitest';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { createServer } from 'node:http';
import * as grpc from '@grpc/grpc-js';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { HostConversationRoutes } from '../src/gateway/conversation-routes.js';
import { DeliveryReceiptCommandSchema, type SurfaceGatewayServiceStreamRequest,
  type SurfaceGatewayServiceStreamResponse } from '@glimmer-cradle/contracts/glimmer/surface/v1/surface_gateway_pb';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { DeliveryController, SqliteDeliveryStore } from '@glimmer-cradle/conversation';
import { create, fromBinary, toBinary, type DescMessage, type Message } from '@bufbuild/protobuf';
import { PublishStateResponseSchema, PublishStateRequestSchema, PublishActionRequestSchema, PublishActionResponseSchema,
  RegisterCognitionRequestSchema, RegisterCognitionResponseSchema } from '@glimmer-cradle/contracts/glimmer/kernel/v1/kernel_control_service_pb';
import type { RegisterCognitionRequest, RegisterCognitionResponse, PublishActionRequest } from '@glimmer-cradle/contracts/glimmer/kernel/v1/kernel_control_service_pb';
import { ReadMemoryJobRequestsRequestSchema, ExecuteMemoryJobRequestSchema,
  MemoryJobResultSchema, MemoryJobResolution } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { ReadMemoryJobRequestsResponseSchema } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { ReadPlanningJobRequestsRequestSchema, AcknowledgePlanningJobRequestRequestSchema,
  PlanningJobSourceRequestSchema, ReadPlanningJobRequestsResponseSchema,
  AcknowledgePlanningJobRequestResponseSchema, ReconcilePlanningJobRequestSchema,
  AcceptPlanningCommitmentRequestSchema } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { ReadPlanningNotificationsRequestSchema, ResolvePlanningNotificationRequestSchema,
  PreparePlanningNotificationRequestSchema, GetPreparedPlanningNotificationRequestSchema,
  type PreparePlanningNotificationResponse } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { SubmitPerceptionRequestSchema, GetPerceptionOperationRequestSchema, AddressMode, ResponsePolicy,
  RetentionCeiling, PerceptionOperationState } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { PlanningJobSourceAdapter, PlanningJobAdapter } from '../src/composition/cognition-job-adapter.js';
import { planningJobRequest, planningJobIdentity, PLANNING_JOB_KIND } from '../src/adapters/protocol/job-mapper.js';
import type { AuthorityLease } from '@glimmer-cradle/platform';
import { ExecutionController, ExecutionResultOutbox, SqliteExecutionJournal, ResourceRegistry } from '@glimmer-cradle/capabilities';
import { JobController, JobRecoveryController, JobRetentionController, SqliteJobStore, type Job, type JobStateEvent } from '@glimmer-cradle/jobs';
import { memoryJobState } from '../src/adapters/protocol/job-mapper.js';
import { PublishMemoryJobStateRequestSchema, PublishPlanningJobStateRequestSchema } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { planningJobState } from '../src/adapters/protocol/job-mapper.js';
import { JobStatus as WireJobStatus } from '@glimmer-cradle/contracts/glimmer/jobs/v1/jobs_pb';
import { CallMetadataSchema, ServiceErrorCode, ServiceErrorDetailSchema } from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';
import { CognitionClient, CognitionJobAdapter, HostCognitionError, HostJobsController, HostJobsOwner, SqliteAuthorityStore,
  WorkerSupervisor, HostCognitionJobsOwner, ConfiguredHostCognitionJobsOwner, HostDataPaths, type WorkerSupervisorOptions,
  memoryJobIdentity, memoryJobEvidence, memoryJobRequest } from '../src/index.js';
import { HostResourceContributions, PermissionBroker } from '../src/index.js';

const repository = path.resolve(__dirname, '../../..');
const policy = { base_delay_ms: 1, max_delay_ms: 10 };
const submissionPolicy = { debounce_ms: 0, max_attempts: 3 };
const clock = { now: () => Date.now() };
async function productionWorker(root: string, overrides: Partial<WorkerSupervisorOptions> = {}, seedPlanning = false) {
  const seeded = await promisify(execFile)('uv', ['run', '--project', 'apps/cognition-worker', '--extra', 'dev', 'python',
    'apps/cognition-worker/tests/test_rpc_roundtrip.py', seedPlanning ? '--host-production-planning-seed' : '--host-production-seed', root], { cwd: repository, windowsHide: true });
  const input = JSON.parse(seeded.stdout);
  const projections: Message[] = [];
  const supervisor = new WorkerSupervisor({ ...input, app_root: repository, data_root: root,
    console_path: path.join(root, 'logs', 'worker-console.log'), startup_timeout_ms: 15_000,
    shutdown_timeout_ms: 3000, request_timeout_ms: 2000,
    accept_state: async request => {
      projections.push(request);
      return create(PublishStateResponseSchema, { operationId: request.call!.traceId, status: 'state_published' });
    }, ...overrides });
  return { supervisor, projections, input };
}

function writeConfiguration(paths: HostDataPaths, memory: unknown, maxAttempts = 5) {
  mkdirSync(path.dirname(paths.host_config), { recursive: true });
  writeFileSync(paths.host_config, JSON.stringify({ authority: { lease_ms: 2000, renewal_interval_ms: 25 },
    cognition: { startup_timeout_ms: 15000, shutdown_timeout_ms: 3000, request_timeout_ms: 2000 } }), 'utf8');
  writeFileSync(paths.jobs_config, JSON.stringify({ scheduler: { poll_interval_ms: 10, batch_size: 8, lease_ms: 60000 },
    retry: { base_delay_ms: 1, max_delay_ms: 10, max_attempts: maxAttempts } }), 'utf8');
  writeFileSync(paths.memory_config, JSON.stringify(memory), 'utf8');
}

describe('配置启动拥有真实 Worker/Jobs/authority 资源', () => {
  it.each([true, false])('生产 CLI 自动评估实际目标 completed=%s，重启不重复调用同一模型或消耗 attempt', async completed => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-configured-planning-model-'));
    const paths = new HostDataPaths({ app_root: repository, config_root: path.join(root, 'config'), data_root: path.join(root, 'data') });
    const seeded = await productionWorker(paths.data_root);
    const assessments: Array<{ goal: { source_moment_id: string; model_tier: string }; evidence: Array<{ reference: { evidence_id: string }; text: string }> }> = [];
    const provider = createServer((request, response) => {
      let body = ''; request.setEncoding('utf8'); request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        const payload = JSON.parse(body);
        if (payload.stream) {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '已记录实际来源。' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
        } else {
          const document = JSON.parse(payload.messages.find((message: { role: string }) => message.role === 'user').content);
          assessments.push(document);
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ completed,
            evidence_ids: document.evidence.map((item: { reference: { evidence_id: string } }) => item.reference.evidence_id),
            reason: completed ? '实际记录满足完成条件' : '实际记录不足以证明完成' }) } }] }));
        }
      });
    });
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
    seeded.input.runtime_document.llm = { api_type: 'deepseek', api_key: 'fixture-only',
      base_url: `http://127.0.0.1:${(provider.address() as { port: number }).port}`, models: { chat: 'fixture' } };
    const memory = { ...seeded.input.runtime_document.memory,
      consolidation: { ...seeded.input.runtime_document.memory.consolidation, enabled: false, debounce_seconds: 60 } };
    writeConfiguration(paths, memory);
    const journal = new SqliteExecutionJournal(path.join(paths.data_root, 'state/capabilities/execution.sqlite'));
    let client: CognitionClient | undefined;
    const resources = new HostResourceContributions({ host_id: 'host', target_location: 'host:local',
      permissions: new PermissionBroker(Date.now, () => {}), resources: new ResourceRegistry(),
      execution: new ExecutionController(journal), outbox: new ExecutionResultOutbox(journal, {
        accept: (event, signal) => {
          if (!client) throw new Error('测试接收 client 未 ready');
          return client.acceptExecutionResult(event, signal);
        },
      }) });
    const options = { paths, clock, owner_id: 'planning-actual-model', worker: { python_executable: seeded.input.python_executable,
      runtime_document: seeded.input.runtime_document, capability_service: resources,
      accept_state: async (request: Parameters<WorkerSupervisorOptions['accept_state']>[0]) =>
        create(PublishStateResponseSchema, { operationId: request.call!.traceId, status: 'state_published' }),
      accept_action: async (request: PublishActionRequest) =>
        create(PublishActionResponseSchema, { operationId: request.call!.idempotencyKey, status: 'action_published' }) } };
    let owner = new ConfiguredHostCognitionJobsOwner(options);
    try {
      await owner.start();
      const session = owner.snapshot.session!.worker;
      client = new CognitionClient(session.endpoint!, session.generation!, 5000);
      const accepted = await client.submitPerception(create(SubmitPerceptionRequestSchema, {
        call: { traceId: 'planning-native', idempotencyKey: 'planning-native', causationId: 'planning-native' },
        perceptionId: 'planning-native', sensoryType: 'chat', source: 'fixture', timestampMs: Date.now(), familiarity: 1,
        addressMode: AddressMode.DIRECT, responsePolicy: ResponsePolicy.REPLY_ALLOWED, retentionCeiling: RetentionCeiling.EXPERIENCE,
        conversation: { sourceProviderId: 'provider', sceneId: 'scene', conversationId: 'conversation:actual-planning',
          continuityId: 'continuity', threadId: 'main', interactionId: 'planning-native-turn',
          recallScope: 'conversation_private', disclosureScope: 'conversation_private' },
        origin: { providerKind: 'core', providerId: 'provider', sourceEventId: 'planning-native', schemaRef: 'fixture',
          trustTier: 'host_verified', privacyClass: 'private', cognitiveEffect: 'observation' },
        content: { text: '核对这条实际来源记录', actorId: 'planning-user' },
      }));
      await vi.waitFor(async () => expect(await client!.perceptionOperation(create(GetPerceptionOperationRequestSchema,
        { operationId: accepted.operationId }))).toMatchObject({ state: PerceptionOperationState.SUCCEEDED, terminal: true }),
      { timeout: 10000, interval: 25 });
      let sourceMomentId = '';
      // 只读实际 Log pack；既不补写来源，也不猜测未返回的 Moment ID。
      const packs = path.join(paths.data_root, 'state/cognition/experience/packs');
      await vi.waitFor(() => {
        for (const relative of readdirSync(packs, { recursive: true }).filter(file => String(file).endsWith('.experience.db'))) {
          const db = new Database(path.join(packs, String(relative)), { readonly: true });
          try { sourceMomentId ||= (db.prepare('SELECT moment_id FROM moments WHERE interaction_id=? AND kind=?')
            .get('planning-native-turn', 'perception') as { moment_id: string } | undefined)?.moment_id ?? ''; }
          finally { db.close(); }
        }
        expect(sourceMomentId).not.toBe('');
      }, { timeout: 5000, interval: 25 });
      expect(await client.acceptPlanningCommitment(create(AcceptPlanningCommitmentRequestSchema, {
        commitmentId: 'commitment:actual-planning', planId: 'plan:actual-planning', planVersion: 1n,
        goalId: 'goal:actual-planning', goalVersion: 1n, text: '核对实际来源', completionCondition: '实际来源记录已经存在',
        steps: ['核对事实'], sourceMomentId, dueAtMs: 0n,
      }))).toMatchObject({ status: 'accepted', scopeId: 'conversation:actual-planning' });
      const db = new Database(paths.jobs_database, { readonly: true });
      try {
        await vi.waitFor(() => expect(db.prepare('SELECT status,attempt FROM jobs WHERE kind=?').get(PLANNING_JOB_KIND))
          .toEqual({ status: 'succeeded', attempt: 1 }), { timeout: 10000, interval: 25 });
      } finally { db.close(); }
      expect(assessments).toHaveLength(1);
      expect(assessments[0].goal).toMatchObject({ source_moment_id: sourceMomentId, model_tier: 'cloud_allowed' });
      expect(assessments[0].evidence.length).toBeGreaterThan(0);
      expect(JSON.stringify(assessments)).toContain('核对这条实际来源记录');
      const notificationRequest = create(ReadPlanningNotificationsRequestSchema, { limit: 1 });
      const notifications = await client.readPlanningNotifications(notificationRequest);
      let preparedNotification: PreparePlanningNotificationResponse | undefined;
      expect(notifications.requests).toHaveLength(completed ? 1 : 0);
      if (completed) {
        expect(await client.resolvePlanningNotification(create(ResolvePlanningNotificationRequestSchema, { request: notifications.requests[0] })))
          .toMatchObject({ available: true, reasonCode: 'planning_notification_source_ready', goalText: '核对实际来源',
            privacyClass: 'private', recallOwnerId: 'conversation:actual-planning', disclosureOwnerId: 'conversation:actual-planning',
            context: { sourceProviderId: 'provider', sceneId: 'scene', conversationId: 'conversation:actual-planning',
              continuityId: 'continuity', threadId: 'main', interactionId: 'planning-native-turn',
              recallScope: 'conversation_private', disclosureScope: 'conversation_private' },
            receipt: { completed: true, receiptId: notifications.requests[0].receiptId } });
        preparedNotification = await client.preparePlanningNotification(create(PreparePlanningNotificationRequestSchema,
          { request: notifications.requests[0] }));
        expect(preparedNotification).toMatchObject({ accepted: true, turnRevision: 2n,
          text: '根据已接纳的证据，长期目标的完成条件已满足：核对实际来源',
          privacyClass: 'private', recallOwnerId: 'conversation:actual-planning', disclosureOwnerId: 'conversation:actual-planning',
          context: { sourceProviderId: 'provider', conversationId: 'conversation:actual-planning', interactionId: preparedNotification.turnId } });
        expect(preparedNotification.replyMomentId).not.toBe('');
        expect(preparedNotification.logPosition).toBeGreaterThan(0n);
        expect(preparedNotification.contentDigest).toMatch(/^[a-f0-9]{64}$/u);
        expect(await client.readPlanningNotifications(notificationRequest)).toEqual(notifications);
      }
      await vi.waitFor(() => expect(owner.snapshot.session!.jobs!.jobs).toMatchObject({
        status: completed ? 'degraded' : 'ready', error_code: completed ? 'planning_notifications_pending' : null }),
        { timeout: 5000, interval: 25 });
      client.close(); client = undefined; await owner.stop();
      owner = new ConfiguredHostCognitionJobsOwner(options); await owner.start();
      expect(owner.snapshot.session!.jobs!.lease!.epoch).toBe(2);
      client = new CognitionClient(owner.snapshot.session!.worker.endpoint!, owner.snapshot.session!.worker.generation!, 5000);
      expect(await client.readPlanningNotifications(notificationRequest)).toEqual(notifications);
      if (preparedNotification) {
        expect(await client.preparePlanningNotification(create(PreparePlanningNotificationRequestSchema,
          { request: notifications.requests[0] }))).toEqual(preparedNotification);
        const turns = new Database(path.join(paths.data_root, 'state/cognition/conversations/conversations.db'), { readonly: true });
        try { expect(turns.prepare('SELECT status,revision FROM conversation_turns WHERE turn_id=?').get(preparedNotification.turnId))
          .toEqual({ status: 'completed', revision: 2 }); }
        finally { turns.close(); }
      }
      await vi.waitFor(() => expect(owner.snapshot.session!.jobs!.jobs).toMatchObject({
        status: completed ? 'degraded' : 'ready', error_code: completed ? 'planning_notifications_pending' : null }),
      { timeout: 5000, interval: 25 });
      if (preparedNotification) {
        // 生产 Worker + 默认 Host Jobs 接真实路由，实际 UI/认证入口另属产品切换门。
        const deliveryStore = new SqliteDeliveryStore(path.join(root, 'delivery-fixture.db'));
        const delivery = new DeliveryController(deliveryStore, 'epoch:receipt-fixture');
        const outputId = 'reply:' + preparedNotification.turnId;
        const permissions = new PermissionBroker(Date.now, () => undefined);
        const principal = permissions.registerPrincipal({ principal_id: 'authenticated:planning-user', host_id: 'host', generation: 'receiver:one', kind: 'user' });
        const routes = new HostConversationRoutes(permissions, delivery, Date.now);
        permissions.grant(routes.permissionRequest(principal, preparedNotification, 'conversation.receive'), Date.now() + 60000);
        permissions.grant(routes.permissionRequest(principal, preparedNotification, 'conversation.notify'), Date.now() + 60000);
        const frames: SurfaceGatewayServiceStreamResponse[] = [];
        const stream = new Writable({ objectMode: true, write(frame: SurfaceGatewayServiceStreamResponse, _encoding, callback) { frames.push(frame); callback(); } });
        const receiverId = routes.attach(principal, preparedNotification,
          stream as grpc.ServerWritableStream<SurfaceGatewayServiceStreamRequest, SurfaceGatewayServiceStreamResponse>);
        try {
          client.close(); client = undefined; await owner.stop();
          owner = new ConfiguredHostCognitionJobsOwner({ ...options, conversation_routes: routes }); await owner.start();
          client = new CognitionClient(owner.snapshot.session!.worker.endpoint!, owner.snapshot.session!.worker.generation!, 5000);
          await vi.waitFor(() => expect(frames).toHaveLength(1), { timeout: 5000, interval: 25 });
          expect(frames[0].event?.event).toMatchObject({ case: 'reply', value: { text: preparedNotification.text, outputId } });
          await expect(client.acknowledgeDeliveredPlanningNotification(preparedNotification, outputId, delivery)).rejects.toThrow('已持久送达');
          expect(await client.readPlanningNotifications(notificationRequest)).toEqual(notifications);
          // 先 drain 调度，再接纳真实回执；确认提交前断点不能被运行中的下一轮抢先完成。
          client.close(); client = undefined; await owner.stop();
          expect(routes.receiveReceipt(receiverId, create(DeliveryReceiptCommandSchema, { outputId, destinationId: preparedNotification.context!.sceneId,
            authorityEpoch: 'epoch:receipt-fixture', generation: 1n, receivedAt: new Date().toISOString(),
            receiptId: 'receipt:planning-fixture', kind: 'delivered' }))).toEqual({ accepted: true });
          // 仅损坏临时 fixture 的原来源；原 Reply/Turn 与实际回执保留，不操作用户库。
          for (const relative of readdirSync(packs, { recursive: true }).filter(file => String(file).endsWith('.experience.db'))) {
            const pack = new Database(path.join(packs, String(relative)));
            try { pack.prepare('DELETE FROM moments WHERE moment_id=?').run(sourceMomentId); } finally { pack.close(); }
          }
          permissions.revokePrincipal(principal.principal_id);
          expect(stream.destroyed).toBe(true);
          owner = new ConfiguredHostCognitionJobsOwner({ ...options, conversation_routes: routes }); await owner.start();
          client = new CognitionClient(owner.snapshot.session!.worker.endpoint!, owner.snapshot.session!.worker.generation!, 5000);
          await vi.waitFor(async () => expect((await client!.readPlanningNotifications(notificationRequest)).requests).toEqual([]),
            { timeout: 5000, interval: 25 });
          expect(await client.resolvePlanningNotification(create(ResolvePlanningNotificationRequestSchema, { request: notifications.requests[0] })))
            .toMatchObject({ available: false, reasonCode: 'planning_notification_source_unavailable' });
          await expect(client.preparePlanningNotification(create(PreparePlanningNotificationRequestSchema,
            { request: notifications.requests[0] }))).rejects.toMatchObject({ code: ServiceErrorCode.PERMISSION_DENIED });
          const original = (await client.getPreparedPlanningNotification(create(GetPreparedPlanningNotificationRequestSchema,
            { request: notifications.requests[0] }))).original;
          expect(original).toEqual({ ...preparedNotification, text: '' });
          expect(() => routes.send(original!)).toThrow('Reply/Turn');
          const ack = await client.acknowledgeDeliveredPlanningNotification(preparedNotification, outputId, delivery);
          expect(ack).toMatchObject({ accepted: true, notificationId: notifications.requests[0].notificationId });
          expect(await client.acknowledgeDeliveredPlanningNotification(preparedNotification, outputId, delivery)).toEqual(ack);
          expect((await client.readPlanningNotifications(notificationRequest)).requests).toEqual([]);
          await vi.waitFor(() => expect(owner.snapshot.session!.jobs!.jobs).toMatchObject({ status: 'ready', error_code: null }),
            { timeout: 5000, interval: 25 });
          client.close(); client = undefined; await owner.stop();
          owner = new ConfiguredHostCognitionJobsOwner(options); await owner.start();
          client = new CognitionClient(owner.snapshot.session!.worker.endpoint!, owner.snapshot.session!.worker.generation!, 5000);
          expect(await client.acknowledgeDeliveredPlanningNotification(preparedNotification, outputId, delivery)).toEqual(ack);
          expect((await client.readPlanningNotifications(notificationRequest)).requests).toEqual([]);
          expect(frames).toHaveLength(1);
        } finally { await owner.stop(); routes.stop(); stream.destroy(); deliveryStore.close(); }
      }
      const planning = new Database(path.join(paths.data_root, 'state/cognition/planning.sqlite'), { readonly: true });
      try {
        expect(planning.prepare('SELECT status,revision FROM planning_commitment').get())
          .toEqual({ status: completed ? 'completed' : 'accepted', revision: 2 });
        expect(planning.prepare('SELECT COUNT(*) AS count FROM planning_evaluation_receipt').get()).toEqual({ count: 1 });
        expect(planning.prepare('SELECT status,business_outcome FROM planning_job_projection').get()).toEqual({ status: 'succeeded', business_outcome: 'committed' });
      } finally { planning.close(); }
      expect(assessments).toHaveLength(1);
    } finally {
      client?.close(); await owner.stop(); await resources.stop(); journal.close(); provider.closeAllConnections();
      await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
    }
  }, 40_000);
  it('生产 CLI 接纳实际 Planning 源，未到期目标不执行且状态真实 ACK，不阻塞 Memory 投递', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-configured-planning-'));
    const paths = new HostDataPaths({ app_root: repository, config_root: path.join(root, 'config'), data_root: path.join(root, 'data') });
    const seeded = await productionWorker(paths.data_root, {}, true);
    const memory = { ...seeded.input.runtime_document.memory, consolidation: { ...seeded.input.runtime_document.memory.consolidation, debounce_seconds: 60 } };
    writeConfiguration(paths, memory, 5);
    const options = { paths, clock, owner_id: 'planning-production', worker: { python_executable: seeded.input.python_executable,
      runtime_document: seeded.input.runtime_document, accept_state: async (request: Parameters<WorkerSupervisorOptions['accept_state']>[0]) =>
        create(PublishStateResponseSchema, { operationId: request.call!.traceId, status: 'state_published' }) } };
    let owner = new ConfiguredHostCognitionJobsOwner(options);
    let firstDue: number | undefined;
    try {
      for (const epoch of [1, 2]) {
        if (epoch === 2) { writeConfiguration(paths, memory, 9); owner = new ConfiguredHostCognitionJobsOwner(options); }
        expect(await owner.start()).toMatchObject({ phase: 'active', session: { worker: { state: 'ready' },
          jobs: { lease: { epoch }, jobs: { status: 'ready', error_code: null } } } });
        const db = new Database(paths.jobs_database, { readonly: true });
        try {
          const job = db.prepare('SELECT * FROM jobs WHERE kind=?').get(PLANNING_JOB_KIND) as Job;
          expect(job).toMatchObject({ status: 'queued', attempt: 0, max_attempts: 5, authority_epoch: epoch, goal_id: 'goal:长期承诺', scope_id: 'conversation:planning' });
          if (epoch === 1) firstDue = job.due_at;
          expect(job.due_at).toBe(firstDue);
          expect(db.prepare('SELECT COUNT(*) AS count FROM jobs WHERE kind=?').get(PLANNING_JOB_KIND)).toEqual({ count: 1 });
          const events = db.prepare('SELECT event_json,acknowledged_at FROM job_outbox').all() as { event_json: string; acknowledged_at: number | null }[];
          const planningEvents = events.filter(event => JSON.parse(event.event_json).kind === PLANNING_JOB_KIND);
          const memoryEvents = events.filter(event => JSON.parse(event.event_json).kind === 'memory.consolidate');
          expect(planningEvents.length).toBeGreaterThan(0);
          expect(memoryEvents.length).toBeGreaterThan(0);
          expect(planningEvents.every(event => event.acknowledged_at !== null)).toBe(true);
          expect(memoryEvents.every(event => event.acknowledged_at !== null)).toBe(true);
        } finally { db.close(); }
        const source = new Database(path.join(paths.data_root, 'state/cognition/planning.sqlite'), { readonly: true });
        try {
          expect(source.prepare('SELECT status,revision FROM planning_commitment').get()).toEqual({ status: 'accepted', revision: 1 });
          expect(source.prepare('SELECT COUNT(*) AS count FROM planning_job_outbox WHERE accepted_job_id IS NULL').get()).toEqual({ count: 0 });
          expect(source.prepare('SELECT status,business_outcome FROM planning_job_projection').get()).toEqual({ status: 'queued', business_outcome: 'unknown' });
          expect(source.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='planning_evaluation_attempt'").get()).toEqual({ count: 0 });
        } finally { source.close(); }
        await owner.stop(); expect(owner.snapshot.phase).toBe('stopped');
      }
    } finally { await owner.stop(); }
  }, 40_000);
  it('安装根/配置根/数据根分离，唯一 Memory 设置接进 Worker；持久重启保持首次政策和更高 epoch', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-configured-production-'));
    const paths = new HostDataPaths({ app_root: path.join(root, 'installation'), config_root: path.join(root, 'config'), data_root: path.join(root, 'data') });
    mkdirSync(paths.app_root);
    // 现行 Worker 从安装根读取真实 migration；这不是空目录或完整安装包证明。
    const migrations = path.join(paths.app_root, 'core/cognition/migrations');
    mkdirSync(migrations, { recursive: true });
    const migrationFiles = readdirSync(path.join(repository, 'core/cognition/migrations'));
    for (const file of migrationFiles) copyFileSync(path.join(repository, 'core/cognition/migrations', file), path.join(migrations, file));
    const installation = () => migrationFiles.map(file => [file, createHash('sha256').update(readFileSync(path.join(migrations, file))).digest('hex')]);
    const originalInstallation = installation();
    const seeded = await productionWorker(paths.data_root);
    const memory = { ...seeded.input.runtime_document.memory,
      consolidation: { ...seeded.input.runtime_document.memory.consolidation, debounce_seconds: 60 } };
    writeConfiguration(paths, memory);
    let projections = 0;
    const options = { paths, clock, owner_id: 'configured-production', worker: { python_executable: seeded.input.python_executable,
      // 此注入副本不能覆盖磁盘 Memory 事实源；其余角色/provider Document 仍按现行入口注入。
      runtime_document: { ...seeded.input.runtime_document, memory: { broken: true } }, accept_state: async (request: Parameters<WorkerSupervisorOptions['accept_state']>[0]) => {
        projections++; return create(PublishStateResponseSchema, { operationId: request.call!.traceId, status: 'state_published' });
      } } };
    const owner = new ConfiguredHostCognitionJobsOwner(options);
    let next: ConfiguredHostCognitionJobsOwner | undefined;
    try {
      const start = owner.start(); expect(owner.start()).toBe(start);
      expect(await start).toMatchObject({ phase: 'active', configuration: { jobs: { submission_policy: { debounce_ms: 60000, max_attempts: 5 } } },
        session: { worker: { state: 'ready' }, jobs: { lease: { epoch: 1 } } } });
      expect(projections).toBeGreaterThan(0); expect(readdirSync(paths.app_root)).toEqual(['core']);
      expect(installation()).toEqual(originalInstallation);
      expect(existsSync(paths.jobs_database)).toBe(true); expect(existsSync(paths.authority_database)).toBe(true);
      const jobs = new Database(paths.jobs_database, { readonly: true });
      let before: unknown;
      try {
        before = jobs.prepare('SELECT job_id,initial_due_at,max_attempts FROM job_source_receipts').get();
        expect(before).toMatchObject({ max_attempts: 5 });
        expect(jobs.prepare('SELECT attempt,status FROM jobs').get()).toEqual({ attempt: 0, status: 'queued' });
        expect(jobs.prepare('SELECT COUNT(*) AS count FROM job_outbox WHERE acknowledged_at IS NULL').get()).toEqual({ count: 0 });
      } finally { jobs.close(); }
      const feedback = new Database(path.join(paths.data_root, 'state/cognition/projections/episodes.db'), { readonly: true });
      try { expect(feedback.prepare('SELECT status,business_outcome FROM memory_job_projection').get()).toEqual({ status: 'queued', business_outcome: 'unknown' }); }
      finally { feedback.close(); }
      const endpoints = [owner.snapshot.session!.worker.endpoint!, owner.snapshot.session!.worker.control_endpoint!];
      expect(owner.stop()).toBe(owner.stop()); await owner.stop();
      expect(owner.snapshot.phase).toBe('stopped');
      for (const endpoint of endpoints) expect(await portClosed(endpoint)).toBe(true);
      expect(existsSync(paths.worker_console)).toBe(true);
      writeConfiguration(paths, memory, 9);
      next = new ConfiguredHostCognitionJobsOwner(options);
      expect(await next.start()).toMatchObject({ phase: 'active', configuration: { jobs: { submission_policy: { max_attempts: 9 } } },
        session: { jobs: { lease: { epoch: 2 } } } });
      const restored = new Database(paths.jobs_database, { readonly: true });
      try {
        expect(restored.prepare('SELECT job_id,initial_due_at,max_attempts FROM job_source_receipts').get()).toEqual(before);
        expect(restored.prepare('SELECT max_attempts,authority_epoch FROM jobs').get()).toEqual({ max_attempts: 5, authority_epoch: 2 });
        expect(restored.prepare('SELECT COUNT(*) AS count FROM jobs').get()).toEqual({ count: 1 });
      } finally { restored.close(); }
      expect(readdirSync(paths.app_root)).toEqual(['core']); expect(installation()).toEqual(originalInstallation);
    } finally { await next?.stop(); await owner.stop(); }
  }, 40_000);

  it.each(['configuration', 'jobs-restore', 'authority-corrupt', 'worker'])('配置启动失败 %s 保留原数据并关闭已持有库，不提前绑定/启动 Worker', async mode => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-configured-failure-'));
    const paths = new HostDataPaths({ app_root: root, config_root: path.join(root, 'config'), data_root: path.join(root, 'data') });
    writeConfiguration(paths, {});
    if (mode === 'configuration') writeFileSync(paths.jobs_config, 'retry: fixture-private-key', 'utf8');
    if (mode === 'jobs-restore') {
      const jobs = new SqliteJobStore(paths.jobs_database); jobs.activateAuthority(7, Date.now()); jobs.close();
    }
    if (mode === 'authority-corrupt') {
      mkdirSync(path.dirname(paths.authority_database), { recursive: true });
      const wrong = new Database(paths.authority_database); wrong.exec("CREATE TABLE keep(value TEXT); INSERT INTO keep VALUES('不可删除')"); wrong.close();
    }
    const owner = new ConfiguredHostCognitionJobsOwner({ paths, clock, owner_id: 'failure', worker: {
      python_executable: path.join(root, 'missing-python.exe'), runtime_document: {},
      accept_state: async () => create(PublishStateResponseSchema) } });
    const start = vi.spyOn(WorkerSupervisor.prototype, 'start');
    try {
      await expect(owner.start()).rejects.toThrow();
      expect(owner.snapshot.phase).toBe('failed');
      // spawn ENOENT 没有 console 输出；验证监督确已开始，而非要求制造空日志。
      expect(existsSync(path.dirname(paths.worker_console))).toBe(mode === 'worker');
      if (mode !== 'worker') expect(start).not.toHaveBeenCalled();
      expect(JSON.stringify(owner.snapshot)).not.toContain('fixture-private-key');
      if (mode === 'configuration') expect(existsSync(paths.data_root)).toBe(false);
      if (mode !== 'configuration') {
        const reopened = new SqliteJobStore(paths.jobs_database);
        try { expect(reopened.loadAuthorityEpoch()).toBe(mode === 'jobs-restore' ? 7 : null); } finally { reopened.close(); }
      }
      if (mode === 'authority-corrupt') {
        const wrong = new Database(paths.authority_database, { readonly: true });
        try { expect(wrong.prepare('SELECT value FROM keep').get()).toEqual({ value: '不可删除' }); } finally { wrong.close(); }
      }
      await owner.stop(); expect(owner.snapshot.phase).toBe('stopped');
    } finally { start.mockRestore(); await owner.stop(); }
  }, 30_000);
});
async function portClosed(endpoint: string) {
  const port = Number(endpoint.split(':').at(-1));
  return new Promise<boolean>(resolve => {
    const connection = createConnection({ host: '127.0.0.1', port });
    connection.once('connect', () => { connection.destroy(); resolve(false); });
    connection.once('error', () => { connection.destroy(); resolve(true); });
  });
}
async function controlCall(endpoint: string, method: string, request: Message, input: DescMessage, output: DescMessage) {
  const client = new grpc.Client(endpoint.replace('grpc://', ''), grpc.credentials.createInsecure());
  try {
    return await new Promise<Message>((resolve, reject) => client.makeUnaryRequest(`/glimmer.kernel.v1.KernelControlService/${method}`,
      value => Buffer.from(toBinary(input, value)), bytes => fromBinary(output, bytes), request,
      { deadline: Date.now() + 2000 }, (error, value) => error ? reject(error) : resolve(value!)));
  } finally { client.close(); }
}
function productionJobs(supervisor: WorkerSupervisor, store: SqliteJobStore, authority: SqliteAuthorityStore) {
  return new HostCognitionJobsOwner({ worker: supervisor, jobs: { store, authority, clock, owner_id: 'production-host',
    authority_lease_ms: 2000, renewal_interval_ms: 25, poll_interval_ms: 10, batch_size: 8, lease_ms: 60_000,
    submission_policy: { debounce_ms: 60_000, max_attempts: 3 }, retry_policy: policy } });
}

describe('目标 Host 监督真实生产 Worker 与 Jobs', () => {
  it('实际注册/首条投影/业务 ready 后接纳持久源，先 drain Jobs 再优雅退出并释放端口', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-production-'));
    const { supervisor, projections } = await productionWorker(root);
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite')), authority = new SqliteAuthorityStore(path.join(root, 'authority.sqlite'));
    const owner = productionJobs(supervisor, store, authority);
    const registration = supervisor as unknown as { register(request: RegisterCognitionRequest): RegisterCognitionResponse };
    const register = registration.register.bind(supervisor);
    let probes = 0;
    const verified = vi.spyOn(registration, 'register').mockImplementation(request => {
      for (const drift of [{ registrationNonce: 'forged' }, { call: { ...request.call!, generation: 'old' } },
        { processId: 9007199254740992n }, { supervisorProcessId: 0n }, { endpoint: 'grpc://127.0.0.1:65536' },
        { authProof: new Uint8Array(32) }]) {
        expect(() => register(create(RegisterCognitionRequestSchema, { ...request, ...drift }))).toThrow(); probes++;
      }
      const result = register(request);
      expect(() => register(request)).toThrow('能力已失效');
      return result;
    });
    let endpoints: string[] = [];
    try {
      expect(() => supervisor.createCognitionClient()).toThrow('尚未业务 ready');
      const start = owner.start(); expect(owner.start()).toBe(start);
      expect(await start).toMatchObject({ phase: 'active', worker: { state: 'ready' }, jobs: { phase: 'active' } });
      expect(projections.length).toBeGreaterThan(0);
      expect(probes).toBe(6);
      expect(store.readOutbox(1, 100)).toHaveLength(1);
      const client = supervisor.createCognitionClient();
      expect((await client.readRequests(create(ReadMemoryJobRequestsRequestSchema, { limit: 8 }))).requests).toEqual([]);
      client.close();
      const memory = new Database(path.join(root, 'state/cognition/memory.sqlite'), { readonly: true });
      try { expect(memory.prepare('SELECT owner FROM memory_consolidation_dispatch').get()).toEqual({ owner: 'external' }); }
      finally { memory.close(); }
      endpoints = [supervisor.snapshot.endpoint!, supervisor.snapshot.control_endpoint!];
      expect(owner.stop()).toBe(owner.stop()); await owner.stop();
      expect(owner.snapshot).toMatchObject({ phase: 'stopped', worker: { state: 'stopped', forced: false, exit_code: 0 } });
      expect(authority.load('jobs')?.status).toBe('released');
      for (const endpoint of endpoints) expect(await portClosed(endpoint)).toBe(true);
      const consoleLines = readFileSync(path.join(root, 'logs/worker-console.log'), 'utf8').trim().split('\n');
      expect(JSON.parse(consoleLines[0]).module).toBe('cognition_host');
      await expect(supervisor.start()).rejects.toThrow('已撤销');
    } finally { verified.mockRestore(); await owner.stop(); authority.close(); store.close(); }
  }, 30_000);

  it('首条投影屏障不伪 ready；取消启动 drain 接收方且不获取 Jobs authority', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-production-cancel-'));
    let received = false, cancelled = false;
    const { supervisor } = await productionWorker(root, { accept_state: async (_request, signal) => {
      received = true;
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve(); }, { once: true }));
      signal.throwIfAborted();
      return create(PublishStateResponseSchema);
    } });
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite')), authority = new SqliteAuthorityStore(path.join(root, 'authority.sqlite'));
    const owner = productionJobs(supervisor, store, authority);
    try {
      const start = owner.start(); void start.catch(() => undefined);
      await eventually(() => received);
      const endpoints = [supervisor.snapshot.endpoint!, supervisor.snapshot.control_endpoint!];
      expect(supervisor.snapshot.state).toBe('starting'); expect(owner.snapshot.jobs).toBeNull();
      expect(() => supervisor.createCognitionClient()).toThrow('尚未业务 ready');
      await owner.stop(); await expect(start).rejects.toThrow();
      expect(cancelled).toBe(true); expect(authority.load('jobs')).toBeNull();
      expect(store.loadAuthorityEpoch()).toBeNull();
      for (const endpoint of endpoints) expect(await portClosed(endpoint)).toBe(true);
    } finally { await owner.stop(); authority.close(); store.close(); }
  }, 30_000);

  it('崩溃撤销旧 client/续期，重新装配新世代与更高 epoch；旧世代投影和缺失 Action 接收拒绝', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-production-restart-'));
    const { supervisor, projections } = await productionWorker(root);
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite')), authority = new SqliteAuthorityStore(path.join(root, 'authority.sqlite'));
    const owner = productionJobs(supervisor, store, authority);
    let next: HostCognitionJobsOwner | undefined;
    try {
      await owner.start(); const prior = supervisor.snapshot;
      const client = supervisor.createCognitionClient();
      const trace = create(CallMetadataSchema, { generation: prior.generation!, traceId: 'negative' });
      const before = projections.length;
      await expect(controlCall(prior.control_endpoint!, 'PublishState', create(PublishStateRequestSchema,
        { call: { ...trace, generation: 'old-generation' } }), PublishStateRequestSchema, PublishStateResponseSchema)).rejects.toThrow();
      expect(projections).toHaveLength(before);
      const missing = await controlCall(prior.control_endpoint!, 'PublishAction', create(PublishActionRequestSchema,
        { call: trace, actionType: 'test' }), PublishActionRequestSchema, PublishActionResponseSchema).catch(error => error as grpc.ServiceError);
      expect(missing).toBeInstanceOf(Error);
      expect(fromBinary(ServiceErrorDetailSchema, (missing as grpc.ServiceError).metadata.get('glimmer-error-bin')[0] as Buffer).code).toBe(ServiceErrorCode.NOT_READY);
      await expect(controlCall(prior.control_endpoint!, 'RegisterCognition', create(RegisterCognitionRequestSchema, { call: trace,
        endpoint: prior.endpoint!, processId: BigInt(prior.process_id!), supervisorProcessId: BigInt(process.pid),
        registrationNonce: 'replay', authProof: new Uint8Array(32) }), RegisterCognitionRequestSchema, RegisterCognitionResponseSchema)).rejects.toThrow();
      process.kill(prior.process_id!, 'SIGKILL');
      await eventually(() => owner.snapshot.phase === 'failed' && authority.load('jobs')?.status === 'released');
      await expect(client.readiness()).rejects.toThrow();
      await owner.stop();
      // 重用同一持久事实，但新实例必须重新认证，不能拿旧 handler/世代当重启。
      const seeded = await productionWorker(root);
      next = productionJobs(seeded.supervisor, store, authority);
      expect(await next.start()).toMatchObject({ phase: 'active', jobs: { lease: { epoch: 2 } } });
      expect(seeded.supervisor.snapshot.generation).not.toBe(prior.generation);
      const events = store.readOutbox(2, 100);
      // 接管会发布新 revision；不能把事件条数当业务 Job 条数。
      expect(events).toHaveLength(2);
      expect(new Set(events.map(event => event.job_id)).size).toBe(1);
      expect(events.map(event => event.authority_epoch)).toEqual([1, 2]);
    } finally { await next?.stop(); await owner.stop(); authority.close(); store.close(); }
  }, 40_000);

  it.each(['config', 'executable'])('生产启动失败（%s）撤销注册能力并回收，错误快照不包含配置密钥', async mode => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-production-failure-'));
    const { supervisor } = await productionWorker(root, mode === 'config'
      ? { runtime_document: { api_key: 'fixture-private-key' } }
      : { python_executable: path.join(root, 'missing-python.exe') });
    try {
      await expect(supervisor.start()).rejects.toThrow();
      expect(supervisor.snapshot).toMatchObject({ state: 'failed', endpoint: null, control_endpoint: null });
      expect(JSON.stringify(supervisor.snapshot)).not.toContain('fixture-private-key');
      expect(() => supervisor.createCognitionClient()).toThrow('尚未业务 ready');
    } finally { await supervisor.stop(); }
  }, 30_000);

  it('启动 deadline 取消状态接收并回收实际进程，不把已注册端点当 ready', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-production-deadline-'));
    let cancelled = false;
    const { supervisor } = await productionWorker(root, { startup_timeout_ms: 2500, request_timeout_ms: 2500,
      accept_state: async (_request, signal) => {
        await new Promise<void>(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve(); }, { once: true }));
        signal.throwIfAborted(); return create(PublishStateResponseSchema);
      } });
    try {
      const began = Date.now();
      await expect(supervisor.start()).rejects.toThrow();
      expect(Date.now() - began).toBeGreaterThanOrEqual(2500);
      expect(cancelled).toBe(true);
      expect(supervisor.snapshot).toMatchObject({ state: 'failed', endpoint: null, control_endpoint: null });
    } finally { await supervisor.stop(); }
  }, 30_000);

  it('协议 shutdown 不可用时只强制回收本实例进程，真实端口关闭后报告 forced', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-production-forced-'));
    const { supervisor } = await productionWorker(root, { shutdown_timeout_ms: 100 });
    let shutdown: { mockRestore(): void } | undefined;
    try {
      await supervisor.start();
      const endpoints = [supervisor.snapshot.endpoint!, supervisor.snapshot.control_endpoint!];
      shutdown = vi.spyOn(CognitionClient.prototype, 'shutdown').mockRejectedValue(new Error('fixture unavailable'));
      await supervisor.stop();
      expect(supervisor.snapshot).toMatchObject({ state: 'stopped', forced: true });
      for (const endpoint of endpoints) expect(await portClosed(endpoint)).toBe(true);
    } finally { shutdown?.mockRestore(); await supervisor.stop(); }
  }, 30_000);

  it('状态接收方返回拒绝不建立首条投影 ready', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-production-rejected-state-'));
    const { supervisor } = await productionWorker(root, { accept_state: async () =>
      create(PublishStateResponseSchema, { operationId: 'rejected', status: 'rejected' }) });
    try {
      await expect(supervisor.start()).rejects.toThrow();
      expect(supervisor.snapshot).toMatchObject({ state: 'failed', endpoint: null, control_endpoint: null });
    } finally { await supervisor.stop(); }
  }, 30_000);

  it('不响应取消的接收方不能伪称 drain/stopped，端口仍必须回收', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-production-undrained-'));
    let received = false, release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const { supervisor } = await productionWorker(root, { shutdown_timeout_ms: 100, accept_state: async request => {
      received = true; await pending;
      return create(PublishStateResponseSchema, { operationId: request.call!.traceId, status: 'state_published' });
    } });
    const start = supervisor.start(); void start.catch(() => undefined);
    try {
      await eventually(() => received);
      const endpoint = supervisor.snapshot.control_endpoint!;
      await expect(supervisor.stop()).rejects.toThrow('接收方未响应取消');
      expect(supervisor.snapshot).toMatchObject({ state: 'failed', error_code: 'worker_control_failed', control_endpoint: null });
      expect(await portClosed(endpoint)).toBe(true);
      await expect(start).rejects.toThrow();
    } finally { release(); await supervisor.stop().catch(() => undefined); }
  }, 30_000);
});
describe('Planning 源真实 wire/Jobs 接纳', () => {
  it('本地取消晚于 Planning 实际评估提交，状态投影保留真实 receipt 而非伪报回滚', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-planning-feedback-cancel-'));
    const service = await worker(root, 'planning-execute-complete'), store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const controller = new JobController(store, clock, policy), execute = service.client.executePlanning.bind(service.client);
    const cancel = vi.spyOn(service.client, 'executePlanning').mockImplementation(async (...args: Parameters<CognitionClient['executePlanning']>) => {
      const result = await execute(...args), job = store.load(args[0].identity!.jobId)!;
      expect(controller.cancel(job.job_id, 1, job.revision)?.status).toBe('cancelled');
      return result;
    });
    try {
      store.activateAuthority(1, clock.now());
      await new PlanningJobSourceAdapter(service.client).deliverRequests(store, clock, 1, 3, 8);
      const adapter = new PlanningJobAdapter(service.client); controller.register(adapter);
      expect(await controller.execute(store.claim(1, 'cancel-owner', clock.now(), 60000, PLANNING_JOB_KIND)!))
        .toMatchObject({ status: 'cancelled', result: null });
      await new JobRecoveryController(store, clock, 1, policy).deliverOutbox(adapter.stateReceiver(1), 100, undefined, PLANNING_JOB_KIND);
      const db = new Database(path.join(root, 'planning.sqlite'), { readonly: true });
      try {
        expect(db.prepare('SELECT status,receipt_id,business_outcome FROM planning_job_projection').get())
          .toMatchObject({ status: 'cancelled', receipt_id: expect.any(String), business_outcome: 'committed' });
        expect(db.prepare('SELECT status,revision FROM planning_commitment').get()).toEqual({ status: 'completed', revision: 2 });
        expect(db.prepare('SELECT COUNT(*) AS count FROM planning_evaluation_receipt').get()).toEqual({ count: 1 });
      } finally { db.close(); }
    } finally { cancel.mockRestore(); await controller.stop(); store.close(); await service.stop(); }
  }, 30_000);

  it.each(['before-commit', 'after-commit'] as const)('Planning 状态 ACK %s 丢失后真实双库重开，提交 inbox 后 ACK 并允许 retention', async mode => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-planning-feedback-'));
    let service = await worker(root, 'planning-execute-complete'), store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    let controller = new JobController(store, clock, policy), loss: { mockRestore(): void } | undefined;
    try {
      store.activateAuthority(1, clock.now());
      await new PlanningJobSourceAdapter(service.client).deliverRequests(store, clock, 1, 3, 8);
      const adapter = new PlanningJobAdapter(service.client); controller.register(adapter);
      await controller.execute(store.claim(1, 'feedback-owner', clock.now(), 60000, PLANNING_JOB_KIND)!);
      const events = store.readOutbox(1, 100, PLANNING_JOB_KIND), succeeded = events.find(event => event.status === 'succeeded')!;
      const publish = service.client.publishPlanningState.bind(service.client);
      loss = vi.spyOn(service.client, 'publishPlanningState').mockImplementation(async (...args: Parameters<CognitionClient['publishPlanningState']>) => {
        if (args[0].event!.eventId !== succeeded.event_id) return publish(...args);
        if (mode === 'after-commit') await publish(...args);
        throw new Error('Planning state ACK lost');
      });
      await expect(new JobRecoveryController(store, clock, 1, policy).deliverOutbox(adapter.stateReceiver(1), 100, undefined, PLANNING_JOB_KIND))
        .rejects.toThrow('ACK lost');
      expect(store.readOutbox(1, 100, PLANNING_JOB_KIND)).toEqual([succeeded]);
      expect(new JobRetentionController(store, clock, 1).prune(0)).toBe(0);
      loss.mockRestore(); loss = undefined; await controller.stop(); store.close(); await service.stop();
      service = await worker(root, 'planning-execute-restarted-complete'); store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
      store.activateAuthority(2, clock.now()); controller = new JobController(store, clock, policy);
      const receiver = new PlanningJobAdapter(service.client).stateReceiver(2);
      expect(await new JobRecoveryController(store, clock, 2, policy).deliverOutbox(receiver, 100, undefined, PLANNING_JOB_KIND)).toBe(1);
      expect(store.readOutbox(2, 100, PLANNING_JOB_KIND)).toEqual([]);
      const request = (event: JobStateEvent, epoch = 2) => create(PublishPlanningJobStateRequestSchema,
        { event: planningJobState(event), deliveryAuthorityEpoch: BigInt(epoch) });
      expect(await service.client.publishPlanningState(request(succeeded))).toMatchObject({ accepted: true, duplicate: true });
      expect(await service.client.publishPlanningState(request(events[0]))).toMatchObject({ duplicate: true });
      await expect(service.client.publishPlanningState(request({ ...succeeded, result: { ...succeeded.result!, commitment_revision: 999 } })))
        .rejects.toMatchObject({ code: ServiceErrorCode.RECOVERY_REQUIRED });
      await expect(service.client.publishPlanningState(request(succeeded, 1))).rejects.toMatchObject({ code: ServiceErrorCode.RECOVERY_REQUIRED });
      expect(new JobRetentionController(store, clock, 2).prune(0)).toBe(1);
      const db = new Database(path.join(root, 'planning.sqlite'), { readonly: true });
      try {
        expect(db.prepare('SELECT status,business_outcome FROM planning_job_projection').get()).toEqual({ status: 'succeeded', business_outcome: 'committed' });
        expect(db.prepare('SELECT COUNT(*) AS count FROM planning_job_feedback_inbox').get()).toEqual({ count: events.length });
        expect(db.prepare('SELECT COUNT(*) AS count FROM planning_evaluation_receipt').get()).toEqual({ count: 1 });
        expect(db.prepare('SELECT status,revision FROM planning_commitment').get()).toEqual({ status: 'completed', revision: 2 });
      } finally { db.close(); }
    } finally { loss?.mockRestore(); await controller.stop(); store.close(); await service.stop(); }
  }, 30_000);

  it.each(['complete', 'incomplete', 'lost-response'] as const)('真实 Planning 执行 %s，双库重开不重复推理或伪造目标完成', async mode => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-planning-execute-'));
    let service = await worker(root, `planning-execute-${mode}`);
    let store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    let controller = new JobController(store, clock, policy);
    let lost: { mockRestore(): void } | undefined;
    try {
      store.activateAuthority(1, clock.now());
      const database = new Database(path.join(root, 'planning.sqlite'), { readonly: true });
      let sourceMomentId: string;
      try { sourceMomentId = JSON.parse((database.prepare('SELECT payload_json FROM planning_goal_version').get() as { payload_json: string }).payload_json).source_moment_id; }
      finally { database.close(); }
      expect(await service.client.acceptPlanningCommitment(create(AcceptPlanningCommitmentRequestSchema, {
        commitmentId: 'commitment:跨语言', planId: 'plan:跨语言', planVersion: 1n, goalId: 'goal:跨语言', goalVersion: 1n,
        text: '核对实际来源', completionCondition: '跨语言评估实际事实', steps: ['检查真实来源'], sourceMomentId, dueAtMs: 0n,
      }))).toMatchObject({ status: 'accepted', revision: 1n, scopeId: 'conversation:planning' });
      await new PlanningJobSourceAdapter(service.client).deliverRequests(store, clock, 1, 3, 8);
      if (mode === 'lost-response') {
        const execute = service.client.executePlanning.bind(service.client);
        lost = vi.spyOn(service.client, 'executePlanning').mockImplementationOnce(async (...args: Parameters<CognitionClient['executePlanning']>) => {
          await execute(...args); throw new Error('fixture completion response loss');
        });
      }
      controller.register(new PlanningJobAdapter(service.client));
      const claim = store.claim(1, 'host:原执行者', clock.now(), 60_000, PLANNING_JOB_KIND)!;
      expect(await controller.execute(claim)).toMatchObject({ status: mode === 'lost-response' ? 'unknown' : 'succeeded' });
      lost?.mockRestore(); lost = undefined;
      await controller.stop(); store.close(); await service.stop();
      service = await worker(root, `planning-execute-restarted-${mode}`);
      store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
      store.activateAuthority(2, clock.now());
      controller = new JobController(store, clock, policy);
      const adapter = new PlanningJobAdapter(service.client);
      if (mode === 'lost-response') expect(await new JobRecoveryController(store, clock, 2, policy)
        .reconcile(claim.job.job_id, adapter)).toMatchObject({ status: 'accepted', job: { status: 'succeeded', attempt: 1 } });
      const proof = await adapter.query(store.load(claim.job.job_id)!, store.listAttempts(claim.job.job_id)[0]);
      expect(proof).toMatchObject({ resolution: 'applied', result: { assessment: { completed: mode !== 'incomplete' },
        identity: { owner_id: 'host:原执行者', authority_epoch: 1 } } });
      expect(store.claim(2, 'host:接任者', clock.now(), 60_000, PLANNING_JOB_KIND)).toBeNull();
      const persisted = new Database(path.join(root, 'planning.sqlite'), { readonly: true });
      try {
        expect(persisted.prepare('SELECT status,revision FROM planning_commitment').get()).toEqual({ status: mode === 'incomplete' ? 'accepted' : 'completed', revision: 2 });
        expect(persisted.prepare('SELECT COUNT(*) AS count FROM planning_evaluation_receipt').get()).toEqual({ count: 1 });
      } finally { persisted.close(); }
    } finally { lost?.mockRestore(); await controller.stop(); store.close(); await service.stop(); }
  }, 30_000);

  it('真实原 attempt 在双库/Worker 重开后封口，Host 自动对账而未绑定目标不消耗新 attempt', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-planning-reconciliation-'));
    let service = await worker(root, 'planning-reconciliation-first'), store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    let host: HostJobsController | undefined;
    try {
      store.activateAuthority(1, clock.now());
      const adapter = new PlanningJobSourceAdapter(service.client);
      await adapter.deliverRequests(store, clock, 1, 3, 8);
      const claim = store.claim(1, 'host:原提交者', clock.now(), 60_000, PLANNING_JOB_KIND)!;
      expect(claim).not.toBeNull();
      store.close(); await service.stop();
      service = await worker(root, 'planning-reconciliation-restarted'); store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
      host = new HostJobsController({ store, clock, epoch: 2, owner_id: 'host:接任者', cognition: service.client,
        // 本场景只对账 Planning；Memory 原源按其独立 debounce 保留，避免引入另一评估任务。
        poll_interval_ms: 10, batch_size: 8, lease_ms: 60_000, submission_policy: { ...submissionPolicy, debounce_ms: 3_600_000 },
        retry_policy: policy, planning_sources: true });
      await host.start();
      await vi.waitFor(() => expect(host!.snapshot).toMatchObject({ status: 'degraded', error_code: 'jobs_admission_pending' }),
        { timeout: 5000, interval: 25 });
      expect(store.load(claim.job.job_id)).toMatchObject({ status: 'retry_wait', attempt: 1, authority_epoch: 2 });
      const attempt = store.listAttempts(claim.job.job_id)[0];
      const proof = await new PlanningJobSourceAdapter(service.client).query(store.load(claim.job.job_id)!, attempt);
      expect(proof).toMatchObject({ resolution: 'not_applied', receiver_fenced: true, authority_epoch: 1, owner_id: 'host:原提交者' });
      const database = new Database(path.join(root, 'planning.sqlite'), { readonly: true });
      try {
        expect(database.prepare('SELECT status,revision FROM planning_commitment').get()).toEqual({ status: 'accepted', revision: 1 });
        expect(database.prepare('SELECT state,owner_id,authority_epoch FROM planning_evaluation_attempt').get())
          .toEqual({ state: 'sealed', owner_id: 'host:原提交者', authority_epoch: 1 });
        expect(database.prepare('SELECT COUNT(*) AS count FROM planning_evaluation_receipt').get()).toEqual({ count: 0 });
      } finally { database.close(); }
      expect(store.readOutbox(2, 100, PLANNING_JOB_KIND)).toHaveLength(0);
      const cancelled = new AbortController(); cancelled.abort();
      await expect(new PlanningJobSourceAdapter(service.client).query(store.load(claim.job.job_id)!, attempt, cancelled.signal)).rejects.toThrow();
      const stale = new CognitionClient(service.endpoint, 'planning-reconciliation-first', 2000);
      try {
        await expect(stale.reconcilePlanning(create(ReconcilePlanningJobRequestSchema, {
          identity: planningJobIdentity(store.load(claim.job.job_id)!, attempt), requestId: String(claim.job.payload.source_request_id) })))
          .rejects.toMatchObject({ code: ServiceErrorCode.GENERATION_MISMATCH });
      } finally { stale.close(); }
    } finally { await host?.stop(); await service.stop(); store.close(); }
  }, 30_000);

  it.each(['before-commit', 'after-commit'] as const)('源 ACK %s 丢失后重开原源/Job，不重算 due/预算或标为 completed', async mode => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-planning-wire-'));
    let service = await worker(root, 'planning-first'), store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    let lost: { mockRestore(): void } | undefined;
    try {
      store.activateAuthority(1, clock.now());
      const source = (await service.client.readPlanningRequests(create(ReadPlanningJobRequestsRequestSchema, { limit: 1 }))).requests[0];
      const initialDue = Number(source.dueAtMs), original = service.client.acknowledgePlanning.bind(service.client);
      lost = vi.spyOn(service.client, 'acknowledgePlanning').mockImplementationOnce(async (request, signal) => {
        if (mode === 'after-commit') await original(request, signal);
        throw new HostCognitionError(ServiceErrorCode.UNAVAILABLE);
      });
      await expect(new PlanningJobSourceAdapter(service.client).deliverRequests(store, clock, 1, 3, 8)).rejects.toMatchObject({ code: ServiceErrorCode.UNAVAILABLE });
      expect(store.load(`planning:${source.requestId}`)).toMatchObject({ due_at: initialDue, max_attempts: 3, status: 'queued', attempt: 0 });
      lost.mockRestore(); lost = undefined;
      store.close(); await service.stop();
      service = await worker(root, 'planning-restarted'); store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
      store.activateAuthority(2, clock.now());
      expect(await new PlanningJobSourceAdapter(service.client).deliverRequests(store, clock, 2, 9, 8)).toBe(mode === 'before-commit' ? 1 : 0);
      expect(store.load(`planning:${source.requestId}`)).toMatchObject({ due_at: initialDue, max_attempts: 3, status: 'queued', authority_epoch: 2, attempt: 0 });
      expect((await service.client.readPlanningRequests(create(ReadPlanningJobRequestsRequestSchema, { limit: 8 }))).requests).toEqual([]);
      expect(store.readOutbox(2, 100, PLANNING_JOB_KIND).length).toBeGreaterThan(0);
      const planning = new Database(path.join(root, 'planning.sqlite'), { readonly: true });
      try {
        expect(planning.prepare('SELECT status,revision FROM planning_commitment').get()).toEqual({ status: 'accepted', revision: 1 });
        expect(planning.prepare('SELECT COUNT(*) AS count FROM planning_job_outbox').get()).toEqual({ count: 1 });
        expect(planning.prepare('SELECT payload_json FROM planning_job_outbox').get()).toEqual({ payload_json: expect.stringContaining(`"due_at":${initialDue}`) });
      } finally { planning.close(); }
    } finally { lost?.mockRestore(); await service.stop(); store.close(); }
  }, 30_000);

  it('拒绝非法范围/版本/源、旧代与错 ACK；内容冲突仍保留源', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-planning-invalid-'));
    const service = await worker(root, 'planning-valid'), stale = new CognitionClient(service.endpoint, 'stale', 2000);
    try {
      await expect(stale.readPlanningRequests(create(ReadPlanningJobRequestsRequestSchema, { limit: 1 }))).rejects.toMatchObject({ code: ServiceErrorCode.GENERATION_MISMATCH });
      for (const limit of [0, 1001]) await expect(service.client.readPlanningRequests(create(ReadPlanningJobRequestsRequestSchema, { limit }))).rejects.toMatchObject({ code: ServiceErrorCode.INVALID_REQUEST });
      const source = (await service.client.readPlanningRequests(create(ReadPlanningJobRequestsRequestSchema, { limit: 8 }))).requests[0];
      const request = (value = source, jobId = `planning:${source.requestId}`, revision = 1n) =>
        create(AcknowledgePlanningJobRequestRequestSchema, { request: value, jobId, jobRevision: revision });
      for (const invalid of [request(source, 'wrong'), request(source, undefined, 0n), request(source, undefined, 9007199254740992n),
        request(create(PlanningJobSourceRequestSchema, { ...source, goalId: 'x'.repeat(65537) })),
        request(create(PlanningJobSourceRequestSchema, { ...source, planVersion: 9007199254740992n })),
        request(create(PlanningJobSourceRequestSchema, { ...source, requestId: 'forged' }))]) {
        await expect(service.client.acknowledgePlanning(invalid)).rejects.toMatchObject({ code: ServiceErrorCode.INVALID_REQUEST });
      }
      for (const changed of [create(PlanningJobSourceRequestSchema, { ...source, scopeId: 'foreign-scope' }),
        create(PlanningJobSourceRequestSchema, { ...source, dueAtMs: source.dueAtMs + 1n }),
        create(PlanningJobSourceRequestSchema, { ...source, goalId: 'foreign-goal' })]) {
        await expect(service.client.acknowledgePlanning(request(changed))).rejects.toMatchObject({ code: ServiceErrorCode.RECOVERY_REQUIRED });
      }
      expect((await service.client.readPlanningRequests(create(ReadPlanningJobRequestsRequestSchema, { limit: 8 }))).requests).toHaveLength(1);
      for (const changed of [create(PlanningJobSourceRequestSchema, { ...source, planVersion: 9007199254740992n }),
        create(PlanningJobSourceRequestSchema, { ...source, goalId: 'x'.repeat(65537) }),
        create(PlanningJobSourceRequestSchema, { ...source, dueAtMs: 9007199254740992n }),
        create(PlanningJobSourceRequestSchema, { ...source, scopeId: '' }),
        create(PlanningJobSourceRequestSchema, { ...source, requestId: 'forged' })]) expect(() => planningJobRequest(changed, 3)).toThrow();
      const cancelled = new AbortController(); cancelled.abort();
      await expect(new PlanningJobSourceAdapter(service.client).deliverRequests({} as SqliteJobStore, clock, 1, 3, 8, cancelled.signal)).rejects.toThrow();
      const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
      try {
        store.activateAuthority(1, clock.now());
        const adapter = new PlanningJobSourceAdapter(service.client);
        const excess = vi.spyOn(service.client, 'readPlanningRequests').mockResolvedValueOnce(
          create(ReadPlanningJobRequestsResponseSchema, { requests: [source, source] }));
        try {
          await expect(adapter.deliverRequests(store, clock, 1, 3, 1)).rejects.toThrow('扫描范围');
          expect(store.load(`planning:${source.requestId}`)).toBeNull();
        } finally { excess.mockRestore(); }
        const afterCommit = new AbortController(), originalEnqueue = store.enqueueSource.bind(store);
        const enqueue = vi.spyOn(store, 'enqueueSource').mockImplementationOnce((...args: Parameters<SqliteJobStore['enqueueSource']>) => {
          const submission = originalEnqueue(...args); afterCommit.abort(); return submission;
        });
        const ack = vi.spyOn(service.client, 'acknowledgePlanning');
        try {
          await expect(adapter.deliverRequests(store, clock, 1, 3, 8, afterCommit.signal)).rejects.toThrow();
          expect(ack).not.toHaveBeenCalled();
          expect(store.load(`planning:${source.requestId}`)).toMatchObject({ status: 'queued', attempt: 0, max_attempts: 3 });
          expect((await service.client.readPlanningRequests(create(ReadPlanningJobRequestsRequestSchema, { limit: 8 }))).requests).toHaveLength(1);
          ack.mockResolvedValueOnce(create(AcknowledgePlanningJobRequestResponseSchema, {
            accepted: true, requestId: source.requestId, jobId: 'foreign-job',
          }));
          await expect(adapter.deliverRequests(store, clock, 1, 9, 8)).rejects.toThrow('identity');
          expect((await service.client.readPlanningRequests(create(ReadPlanningJobRequestsRequestSchema, { limit: 8 }))).requests).toHaveLength(1);
          expect(await adapter.deliverRequests(store, clock, 1, 9, 8)).toBe(1);
          expect(store.load(`planning:${source.requestId}`)).toMatchObject({ max_attempts: 3, due_at: Number(source.dueAtMs) });
        } finally { enqueue.mockRestore(); ack.mockRestore(); }
      } finally { store.close(); }
    } finally { stale.close(); await service.stop(); }
  }, 30_000);
});

async function worker(root: string, generation: string) {
  const child = spawn('uv', ['run', '--project', 'apps/cognition-worker', '--extra', 'dev', 'python',
    'apps/cognition-worker/tests/test_rpc_roundtrip.py', '--host-job-fixture', root, generation],
  { cwd: repository, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr!.on('data', data => { stderr = (stderr + String(data)).slice(-4096); });
  const stopped = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker fixture exit ${code}: ${stderr}`)));
  });
  void stopped.catch(() => undefined);
  let client: CognitionClient | undefined;
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker fixture readiness timeout')), 15_000);
      const lines = createInterface({ input: child.stdout! });
      child.once('error', reject);
      void stopped.then(() => reject(new Error('Worker fixture exited before ready')), reject);
      lines.on('line', line => {
        if (!line.startsWith('{"endpoint":')) return;
        const ready = JSON.parse(line);
        clearTimeout(timer); lines.close(); resolve(ready.endpoint);
      });
    });
    client = new CognitionClient(endpoint, generation, 5_000);
    // 源与 Host 都使用真实墙钟；系统校时时源可能稍领先，不能把“已发布”误作“已到期”。
    const sources = await client.readRequests(create(ReadMemoryJobRequestsRequestSchema, { limit: 1000 }));
    const due = Math.max(0, ...sources.requests.map(source => Date.parse(source.createdAt)));
    await eventually(() => Date.now() >= due);
    return { client, endpoint, child, async stop() { client!.close(); child.stdin!.end('stop\n'); await stopped; } };
  } catch (error) {
    client?.close();
    if (child.exitCode === null) {
      // Windows uv/venv redirector 是父进程；只终止本测试创建的树，不能留下持库子进程。
      if (process.platform === 'win32' && child.pid) await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => undefined);
      else child.kill();
    }
    await stopped.catch(() => undefined); throw error;
  }
}
function memoryCounts(root: string) {
  const db = new Database(path.join(root, 'memory.sqlite'), { readonly: true });
  try { return ['memory_items', 'memory_revisions', 'memory_consolidation_receipts'].map(table =>
    (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count); }
  finally { db.close(); }
}

function hostJobs(store: SqliteJobStore, client: CognitionClient, epoch = 1, batch = 8) {
  return new HostJobsController({ store, clock, epoch, owner_id: `host-${epoch}`, cognition: client,
    poll_interval_ms: 10, batch_size: batch, lease_ms: 60_000,
    submission_policy: submissionPolicy, retry_policy: policy });
}
async function eventually(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  expect(predicate()).toBe(true);
}

it('Host 循环实际执行终态保留政策：缺接收方不删，真实 inbox 提交并 ACK 后清理，Memory 不重复写入', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-retention-'));
  const service = await worker(root, 'one');
  const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
  const receiver = new Database(path.join(root, 'projection.sqlite'));
  receiver.exec(`CREATE TABLE inbox(event_id TEXT PRIMARY KEY,document TEXT NOT NULL);
    CREATE TABLE completions(job_id TEXT PRIMARY KEY,count INTEGER NOT NULL);`);
  const accept = (event: JobStateEvent) => receiver.transaction(() => {
    const document = JSON.stringify(event);
    const prior = receiver.prepare('SELECT document FROM inbox WHERE event_id=?').get(event.event_id) as { document: string } | undefined;
    if (prior) { if (prior.document !== document) throw new Error('inbox identity conflict'); return; }
    receiver.prepare('INSERT INTO inbox VALUES(?,?)').run(event.event_id, document);
    if (event.status === 'succeeded') receiver.prepare('INSERT INTO completions VALUES(?,1)').run(event.job_id);
  }).immediate();
  const options = { store, clock, owner_id: 'retention', poll_interval_ms: 10, batch_size: 8, lease_ms: 60000,
    submission_policy: submissionPolicy, retry_policy: policy, terminal_retention_ms: 0 };
  const first = new HostJobsController({ ...options, epoch: 1, cognition: service.client });
  let next: HostJobsController | undefined;
  try {
    await first.start();
    const completed = store.readOutbox(1, 100).find(event => event.status === 'succeeded')!;
    expect(store.load(completed.job_id)?.status).toBe('succeeded');
    await eventually(() => first.snapshot.completed_cycles > 2);
    expect(store.load(completed.job_id)?.status).toBe('succeeded');
    expect(memoryCounts(root)).toEqual([1, 1, 1]);
    await first.stop();
    next = new HostJobsController({ ...options, epoch: 2, cognition: new CognitionClient(service.endpoint, 'one', 5000),
      state_receiver: { async accept(event) { accept(event); return { event_id: event.event_id, accepted: true }; } } });
    await next.start();
    await eventually(() => store.load(completed.job_id) === null);
    expect(store.readOutbox(2, 100)).toEqual([]);
    expect(receiver.prepare('SELECT count FROM completions').get()).toEqual({ count: 1 });
    await eventually(() => next!.snapshot.completed_cycles > 2);
    expect(memoryCounts(root)).toEqual([1, 1, 1]);
    const jobs = new Database(path.join(root, 'jobs.sqlite'), { readonly: true });
    try { expect(jobs.prepare('SELECT COUNT(*) AS count FROM job_source_receipts').get()).toEqual({ count: 1 }); }
    finally { jobs.close(); }
  } finally { await next?.stop(); await first.stop(); receiver.close(); store.close(); await service.stop(); }
}, 30_000);

describe('Memory 状态事实真实 wire/inbox', () => {
  it('投影写入失败回滚 inbox，未知/取消未执行事实不冒充无副作用，未知 schema 保留数据并拒绝', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-state-rollback-'));
    const service = await worker(root, 'one'), store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const controller = new JobController(store, clock, policy);
    let projection: Database.Database | undefined;
    try {
      store.activateAuthority(1, clock.now()); const adapter = new CognitionJobAdapter(service.client);
      await adapter.deliverRequests(store, clock, 1, submissionPolicy, 8);
      const recovery = new JobRecoveryController(store, clock, 1, policy), receiver = adapter.stateReceiver(1);
      expect(await recovery.deliverOutbox(receiver, 100)).toBe(1);
      projection = new Database(path.join(root, 'episodes.db'));
      const claim = store.claim(1, 'fault', clock.now(), 60000)!;
      projection.exec("CREATE TRIGGER reject_projection BEFORE UPDATE ON memory_job_projection BEGIN SELECT RAISE(ABORT,'injected projection failure'); END");
      await expect(recovery.deliverOutbox(receiver, 100)).rejects.toMatchObject({ code: ServiceErrorCode.INTERNAL });
      expect(projection.prepare('SELECT COUNT(*) AS count FROM memory_job_feedback_inbox').get()).toEqual({ count: 1 });
      expect(projection.prepare('SELECT status FROM memory_job_projection').get()).toEqual({ status: 'queued' });
      expect(store.readOutbox(1, 100)[0].status).toBe('running');
      projection.exec('DROP TRIGGER reject_projection');
      expect(await recovery.deliverOutbox(receiver, 100)).toBe(1);
      store.finish(claim.lease, clock.now(), { status: 'unknown', error_code: 'unresolved' });
      await recovery.deliverOutbox(receiver, 100);
      expect(projection.prepare('SELECT status,receipt_id,business_outcome FROM memory_job_projection').get())
        .toEqual({ status: 'unknown', receipt_id: null, business_outcome: 'unknown' });
      const job = store.load(claim.job.job_id)!;
      expect(controller.cancel(job.job_id, 1, job.revision)).toBeNull(); await recovery.deliverOutbox(receiver, 100);
      expect(projection.prepare('SELECT status,receipt_id,business_outcome FROM memory_job_projection').get())
        .toEqual({ status: 'unknown', receipt_id: null, business_outcome: 'unknown' });
      projection.prepare("UPDATE projection_meta SET value='99' WHERE key='memory_job_feedback_schema'").run();
      const event = store.readOutbox(1, 100); expect(event).toEqual([]);
      const queued = { ...job, event_id: createHash('sha256').update(JSON.stringify([job.job_id, job.revision])).digest('hex') };
      await expect(receiver.accept(queued)).rejects.toMatchObject({ code: ServiceErrorCode.RECOVERY_REQUIRED });
      expect(projection.prepare("SELECT value FROM projection_meta WHERE key='memory_job_feedback_schema'").get()).toEqual({ value: '99' });
      expect(memoryCounts(root)).toEqual([0, 0, 0]);
    } finally { projection?.close(); await controller.stop(); store.close(); await service.stop(); }
  }, 30000);

  it('实际接收后 Host retention 清理 body，但源投影/receipt/inbox 保留且业务只提交一次', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-state-loop-'));
    const service = await worker(root, 'one'), store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = new HostJobsController({ store, clock, epoch: 1, owner_id: 'state', cognition: service.client,
      poll_interval_ms: 10, batch_size: 8, lease_ms: 60000, submission_policy: submissionPolicy, retry_policy: policy,
      terminal_retention_ms: 0, state_receiver: new CognitionJobAdapter(service.client).stateReceiver(1) });
    try {
      await host.start();
      const projection = new Database(path.join(root, 'episodes.db'), { readonly: true });
      try {
        const state = projection.prepare('SELECT job_id,status,receipt_id FROM memory_job_projection').get() as { job_id: string; status: string; receipt_id: string };
        expect(state.status).toBe('succeeded'); expect(state.receipt_id).toBeTruthy();
        await eventually(() => store.load(state.job_id) === null);
        expect(projection.prepare('SELECT COUNT(*) AS count FROM memory_job_feedback_inbox').get()).toEqual({ count: 3 });
        expect(projection.prepare('SELECT COUNT(*) AS count FROM memory_request_outbox').get()).toEqual({ count: 1 });
      } finally { projection.close(); }
      expect(memoryCounts(root)).toEqual([1, 1, 1]); expect(store.readOutbox(1, 100)).toEqual([]);
    } finally { await host.stop(); store.close(); await service.stop(); }
  }, 30000);

  it('状态业务已提交而 ACK 丢失：跨 Worker/Jobs 重启重复接纳；旧 revision/投递主/非法事实不能回退投影', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-state-loss-'));
    let service = await worker(root, 'one'), store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    let controller = new JobController(store, clock, policy);
    try {
      store.activateAuthority(1, clock.now()); const adapter = new CognitionJobAdapter(service.client);
      await adapter.deliverRequests(store, clock, 1, submissionPolicy, 8); controller.register(adapter);
      await controller.execute(store.claim(1, 'state', clock.now(), 60000)!);
      const originals = store.readOutbox(1, 100), completed = originals.find(event => event.status === 'succeeded')!;
      const publish = service.client.publishJobState.bind(service.client);
      const loss = vi.spyOn(service.client, 'publishJobState').mockImplementation(async (...args: Parameters<CognitionClient['publishJobState']>) => {
        const result = await publish(...args);
        if (args[0].event!.eventId === completed.event_id) throw new Error('state ACK lost after commit');
        return result;
      });
      await expect(new JobRecoveryController(store, clock, 1, policy).deliverOutbox(adapter.stateReceiver(1), 100)).rejects.toThrow('ACK lost');
      expect(store.readOutbox(1, 100)).toEqual([completed]); expect(new JobRetentionController(store, clock, 1).prune(0)).toBe(0);
      loss.mockRestore(); await controller.stop(); store.close(); await service.stop();
      service = await worker(root, 'two'); store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
      store.activateAuthority(2, clock.now()); controller = new JobController(store, clock, policy);
      const recovery = new JobRecoveryController(store, clock, 2, policy), receiving = new CognitionJobAdapter(service.client);
      expect(await recovery.deliverOutbox(receiving.stateReceiver(2), 100)).toBe(1);
      const request = (event: JobStateEvent, epoch = 2) => create(PublishMemoryJobStateRequestSchema,
        { event: memoryJobState(event), deliveryAuthorityEpoch: BigInt(epoch) });
      expect(await service.client.publishJobState(request(completed))).toMatchObject({ accepted: true, duplicate: true });
      expect(await service.client.publishJobState(request(originals[0]))).toMatchObject({ accepted: true, duplicate: true });
      for (const malformed of [
        { ...completed, scope_id: 'wrong' }, { ...completed, error_code: 'conflict' },
        { ...completed, result: { ...completed.result!, receipt_id: 'forged' } },
      ]) await expect(service.client.publishJobState(request(malformed))).rejects.toMatchObject({ code: ServiceErrorCode.RECOVERY_REQUIRED });
      const badEnum = request(completed); badEnum.event!.status = 99 as WireJobStatus;
      await expect(service.client.publishJobState(badEnum)).rejects.toMatchObject({ code: ServiceErrorCode.INVALID_REQUEST });
      const overflow = request(completed); overflow.event!.revision = 9007199254740992n;
      await expect(service.client.publishJobState(overflow)).rejects.toMatchObject({ code: ServiceErrorCode.INVALID_REQUEST });
      const stale = new CognitionClient(service.endpoint, 'one', 2000);
      try { await expect(stale.publishJobState(request(completed))).rejects.toMatchObject({ code: ServiceErrorCode.GENERATION_MISMATCH }); }
      finally { stale.close(); }
      store.activateAuthority(3, clock.now());
      expect(await service.client.publishJobState(request(completed, 3))).toMatchObject({ duplicate: true });
      await expect(service.client.publishJobState(request(completed, 2))).rejects.toMatchObject({ code: ServiceErrorCode.RECOVERY_REQUIRED });
      const projection = new Database(path.join(root, 'episodes.db'), { readonly: true });
      try {
        expect(projection.prepare('SELECT status,revision FROM memory_job_projection').get()).toEqual({ status: 'succeeded', revision: completed.revision });
        expect(projection.prepare('SELECT COUNT(*) AS count FROM memory_job_feedback_inbox').get()).toEqual({ count: 3 });
      } finally { projection.close(); }
      expect(new JobRetentionController(store, clock, 3).prune(0)).toBe(1); expect(memoryCounts(root)).toEqual([1, 1, 1]);
    } finally { await controller.stop(); store.close(); await service.stop(); }
  }, 30000);

  it('本地取消晚于 Memory 提交：真实 cancelled 投影保留业务 receipt，不虚报回滚', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-state-cancel-'));
    const service = await worker(root, 'one'), store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const controller = new JobController(store, clock, policy);
    const execute = service.client.execute.bind(service.client);
    const cancellation = vi.spyOn(service.client, 'execute').mockImplementation(async (...args: Parameters<CognitionClient['execute']>) => {
      const result = await execute(...args), job = store.load(args[0].identity!.jobId)!;
      expect(controller.cancel(job.job_id, 1, job.revision)?.status).toBe('cancelled'); return result;
    });
    try {
      store.activateAuthority(1, clock.now()); const adapter = new CognitionJobAdapter(service.client);
      await adapter.deliverRequests(store, clock, 1, submissionPolicy, 8); controller.register(adapter);
      expect(await controller.execute(store.claim(1, 'cancellation', clock.now(), 60000)!)).toMatchObject({ status: 'cancelled', result: null });
      await new JobRecoveryController(store, clock, 1, policy).deliverOutbox(adapter.stateReceiver(1), 100);
      const projection = new Database(path.join(root, 'episodes.db'), { readonly: true });
      try {
        expect(projection.prepare('SELECT status,receipt_id,business_outcome FROM memory_job_projection').get())
          .toMatchObject({ status: 'cancelled', receipt_id: expect.any(String), business_outcome: 'committed' });
      } finally { projection.close(); }
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
    } finally { cancellation.mockRestore(); await controller.stop(); store.close(); await service.stop(); }
  }, 30000);
});

function ownedJobs(store: SqliteJobStore, client: CognitionClient, authority: SqliteAuthorityStore, owner: string, initial?: AuthorityLease) {
  return new HostJobsOwner({ store, clock, owner_id: owner, cognition: client, authority,
    authority_lease_ms: 2000, renewal_interval_ms: 25, poll_interval_ms: 10, batch_size: 8,
    lease_ms: 60_000, submission_policy: submissionPolicy, retry_policy: { base_delay_ms: 500, max_delay_ms: 500 },
    initial_lease: initial });
}
describe('Host authority 装配真实 Jobs/Worker', () => {
  it('正常停机的封口 RPC 超过原 authority 窗口时仍续期，直到真实资源 drain 完成才释放', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-owned-drain-'));
    const service = await worker(root, 'waiting-model');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const authority = new SqliteAuthorityStore(path.join(root, 'authority.sqlite'));
    const owner = new HostJobsOwner({ store, clock, owner_id: 'old', cognition: service.client, authority,
      authority_lease_ms: 500, renewal_interval_ms: 25, poll_interval_ms: 10, batch_size: 8,
      lease_ms: 60_000, submission_policy: submissionPolicy, retry_policy: policy });
    const memory = new Database(path.join(root, 'memory.sqlite'), { readonly: true });
    const query = service.client.reconcile.bind(service.client);
    const seal = vi.spyOn(service.client, 'reconcile').mockImplementation(async (...args: Parameters<CognitionClient['reconcile']>) => {
      await new Promise(resolve => setTimeout(resolve, 700)); return query(...args);
    });
    try {
      const observed = owner.start().catch(error => error);
      await eventually(() => !!memory.prepare("SELECT job_id FROM memory_job_attempts WHERE state='active'").get());
      const stopping = owner.stop();
      await new Promise(resolve => setTimeout(resolve, 550));
      expect(authority.load('jobs')).toMatchObject({ owner_id: 'old', status: 'active' });
      expect(() => authority.acquire('jobs', 'premature', clock.now(), 500)).toThrow('仍被承载');
      await stopping;
      expect(await observed).toBeInstanceOf(Error);
      expect(memory.prepare('SELECT state FROM memory_job_attempts').get()).toEqual({ state: 'sealed' });
      expect(authority.load('jobs')?.status).toBe('released');
      expect(authority.acquire('jobs', 'next', clock.now(), 500).epoch).toBe(2);
    } finally { await owner.stop(); seal.mockRestore(); memory.close(); authority.close(); store.close(); await service.stop(); }
  }, 30_000);

  it('持久 authority 注入执行并持续续期；第二 owner 拒绝，drain 后释放，重开单调接管', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-owned-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    let authority = new SqliteAuthorityStore(path.join(root, 'authority.sqlite'));
    const owner = ownedJobs(store, service.client, authority, 'one');
    const secondClient = new CognitionClient(service.endpoint, 'one', 5000);
    const second = ownedJobs(store, secondClient, authority, 'two');
    try {
      const start = owner.start(); expect(owner.start()).toBe(start);
      expect(await start).toMatchObject({ phase: 'active', lease: { owner_id: 'one', epoch: 1 }, jobs: { status: 'ready' } });
      await eventually(() => (authority.load('jobs')?.revision ?? 0) >= 3);
      await expect(second.start()).rejects.toThrow('仍被承载');
      expect(authority.load('jobs')?.owner_id).toBe('one');
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
      const result = store.readOutbox(1, 100).find(event => event.status === 'succeeded')!;
      expect(store.load(result.job_id)?.authority_epoch).toBe(1);
      expect(owner.stop()).toBe(owner.stop()); await owner.stop();
      expect(authority.load('jobs')?.status).toBe('released');
      authority.close(); authority = new SqliteAuthorityStore(path.join(root, 'authority.sqlite'));
      expect(authority.acquire('jobs', 'new-process', clock.now(), 1000).epoch).toBe(2);
    } finally { await owner.stop(); await second.stop(); authority.close(); store.close(); await service.stop(); }
  }, 30_000);

  it('handover 先取消并持久封口真实模型，再确认新 epoch；接纳者从原 unknown 对账', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-owned-transfer-'));
    const service = await worker(root, 'waiting-model');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const authority = new SqliteAuthorityStore(path.join(root, 'authority.sqlite'));
    const old = ownedJobs(store, service.client, authority, 'old');
    const read = vi.spyOn(service.client, 'readRequests').mockResolvedValueOnce(create(ReadMemoryJobRequestsResponseSchema));
    const memory = new Database(path.join(root, 'memory.sqlite'), { readonly: true });
    let next: HostJobsOwner | undefined;
    try {
      await old.start();
      await eventually(() => !!memory.prepare("SELECT job_id FROM memory_job_attempts WHERE state='active'").get());
      const pending = old.handover('next', 'transfer');
      expect(authority.load('jobs')?.status).toBe('revoking');
      expect(old.handover('next', 'transfer')).toBe(pending);
      await expect(old.handover('different', 'transfer')).rejects.toThrow('内容冲突');
      const accepted = await pending;
      expect(accepted).toMatchObject({ owner_id: 'next', epoch: 2 });
      expect(memory.prepare('SELECT state FROM memory_job_attempts').get()).toEqual({ state: 'sealed' });
      expect(memoryCounts(root)).toEqual([0, 0, 0]);
      expect(old.snapshot.phase).toBe('transferred');
      const job = store.listUnknown(1, 'memory.consolidate', 8)[0];
      expect(job.attempt).toBe(1);
      const client = new CognitionClient(service.endpoint, 'waiting-model', 5000);
      next = ownedJobs(store, client, authority, 'next', accepted);
      expect(await next.start()).toMatchObject({ phase: 'active', lease: { epoch: 2 } });
      expect(store.load(job.job_id)).toMatchObject({ status: 'retry_wait', attempt: 1, authority_epoch: 2 });
      expect(store.listAttempts(job.job_id)[0]).toMatchObject({ authority_epoch: 1, owner_id: 'old' });
      expect(memoryCounts(root)).toEqual([0, 0, 0]);
      await old.stop(); // 不能撤销已经接纳的新主。
      expect(authority.load('jobs')?.owner_id).toBe('next');
    } finally { await old.stop(); await next?.stop(); read.mockRestore(); memory.close(); authority.close(); store.close(); await service.stop(); }
  }, 30_000);

  it('外部更高 authority 撤销旧循环，丢失租约时回收资源，不释放新主', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-owned-fenced-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const authority = new SqliteAuthorityStore(path.join(root, 'authority.sqlite'));
    const other = new SqliteAuthorityStore(path.join(root, 'authority.sqlite'));
    const old = ownedJobs(store, service.client, authority, 'old');
    try {
      await old.start();
      other.release(old.snapshot.lease!, clock.now());
      const next = other.acquire('jobs', 'new', clock.now(), 2000);
      await eventually(() => ['lease_lost', 'failed'].includes(old.snapshot.phase));
      await old.stop();
      expect(other.load('jobs')).toMatchObject({ owner_id: 'new', epoch: next.epoch, status: 'active' });
      await expect(service.client.readRequests(create(ReadMemoryJobRequestsRequestSchema, { limit: 1 }))).rejects.toBeInstanceOf(HostCognitionError);
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
    } finally { await old.stop(); other.close(); authority.close(); store.close(); await service.stop(); }
  }, 30_000);

  it('更高 authority 接管真实在途模型：旧回调不能写新主，原 unknown 经接收端封口恢复', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-owned-inflight-fenced-'));
    const service = await worker(root, 'waiting-model');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const authority = new SqliteAuthorityStore(path.join(root, 'authority.sqlite'));
    const other = new SqliteAuthorityStore(path.join(root, 'authority.sqlite'));
    const old = ownedJobs(store, service.client, authority, 'old');
    const read = vi.spyOn(service.client, 'readRequests').mockResolvedValueOnce(create(ReadMemoryJobRequestsResponseSchema));
    const memory = new Database(path.join(root, 'memory.sqlite'), { readonly: true });
    let next: HostJobsOwner | undefined;
    try {
      await old.start();
      await eventually(() => !!memory.prepare("SELECT job_id FROM memory_job_attempts WHERE state='active'").get());
      expect(other.release(old.snapshot.lease!, clock.now())).toBe(true);
      const acquired = other.acquire('jobs', 'new', clock.now(), 2000);
      next = ownedJobs(store, new CognitionClient(service.endpoint, 'waiting-model', 5000), authority, 'new', acquired);
      await next.start();
      await eventually(() => ['lease_lost', 'failed'].includes(old.snapshot.phase));
      // 陈旧完成 CAS 可能报告失败；必须观察并 drain，不能据此释放新 owner。
      await old.stop().catch(error => { expect(error).toBeInstanceOf(Error); });
      expect(authority.load('jobs')).toMatchObject({ owner_id: 'new', epoch: 2, status: 'active' });
      const jobId = (memory.prepare('SELECT job_id FROM memory_job_attempts').get() as { job_id: string }).job_id;
      expect(store.load(jobId)).toMatchObject({ status: 'retry_wait', attempt: 1, authority_epoch: 2 });
      expect(memory.prepare('SELECT state FROM memory_job_attempts').get()).toEqual({ state: 'sealed' });
      expect(memoryCounts(root)).toEqual([0, 0, 0]);
    } finally {
      await old.stop().catch(() => undefined); await next?.stop(); read.mockRestore(); memory.close();
      other.close(); authority.close(); store.close(); await service.stop();
    }
  }, 30_000);
});

describe('Host Memory Jobs 持续驱动与资源归属', () => {
  it('真实 Worker 自动投递、执行一次；重复 start 共用循环，停机关闭 client 而不关闭注入 Store', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-loop-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = hostJobs(store, service.client);
    let activeReads = 0, maxActiveReads = 0;
    const actualRead = service.client.readRequests.bind(service.client);
    const reads = vi.spyOn(service.client, 'readRequests').mockImplementation(async (...args: Parameters<CognitionClient['readRequests']>) => {
      activeReads += 1; maxActiveReads = Math.max(maxActiveReads, activeReads);
      try { await new Promise(resolve => setTimeout(resolve, 25)); return await actualRead(...args); }
      finally { activeReads -= 1; }
    });
    try {
      store.activateAuthority(1, clock.now());
      store.enqueue({ job_id: 'other', scope_id: 'scope', goal_id: 'goal', kind: 'other.owner',
        idempotency_key: 'other', payload: {}, due_at: 0, retry_mode: 'idempotent', max_attempts: 1 }, 1, clock.now());
      const first = host.start();
      expect(host.start()).toBe(first);
      expect(await first).toMatchObject({ status: 'ready', completed_cycles: 1, error_code: null });
      await eventually(() => host.snapshot.completed_cycles >= 3);
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
      expect(store.load('other')).toMatchObject({ status: 'queued', attempt: 0 });
      expect(host.stop()).toBe(host.stop());
      await host.stop();
      expect(host.snapshot.status).toBe('stopped');
      const completedReads = reads.mock.calls.length;
      await new Promise(resolve => setTimeout(resolve, 40));
      expect(reads.mock.calls.length).toBe(completedReads);
      expect(maxActiveReads).toBe(1);
      expect(activeReads).toBe(0);
      expect(store.readOutbox(1, 100).length).toBeGreaterThan(0); // 无持久 receiver 不伪造 ACK。
      await expect(service.client.readRequests(create(ReadMemoryJobRequestsRequestSchema, { limit: 1 }))).rejects.toBeInstanceOf(HostCognitionError);
      await expect(host.start()).rejects.toThrow('撤销');
    } finally { await host.stop(); reads.mockRestore(); store.close(); await service.stop(); }
  }, 30_000);

  it('真实 Memory 已提交但响应丢失，后续循环从持久 unknown 自动对账，不重复执行', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-loop-recovery-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = hostJobs(store, service.client);
    const execute = service.client.execute.bind(service.client);
    const calls = vi.spyOn(service.client, 'execute').mockImplementationOnce(async (...args: Parameters<CognitionClient['execute']>) => {
      await execute(...args); throw new HostCognitionError(ServiceErrorCode.UNAVAILABLE);
    });
    try {
      expect(await host.start()).toMatchObject({ status: 'degraded', error_code: 'jobs_recovery_pending' });
      const original = store.listUnknown(1, 'memory.consolidate', 8)[0];
      expect(original).toBeTruthy();
      await eventually(() => store.load(original.job_id)?.status === 'succeeded');
      expect(calls).toHaveBeenCalledTimes(1);
      expect(store.load(original.job_id)?.attempt).toBe(1);
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
      expect(host.snapshot.status).toBe('ready');
    } finally { await host.stop(); calls.mockRestore(); store.close(); await service.stop(); }
  }, 30_000);

  it('真实模型执行中 stop：先取消并封口，再撤销 client，回收完毕才允许关闭 Store', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-loop-stop-'));
    const service = await worker(root, 'waiting-model');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = hostJobs(store, service.client);
    const memory = new Database(path.join(root, 'memory.sqlite'), { readonly: true });
    try {
      const starting = host.start();
      const observed = starting.catch(error => error);
      await eventually(() => !!memory.prepare("SELECT job_id FROM memory_job_attempts WHERE state='active'").get());
      await host.stop();
      expect(await observed).toBeInstanceOf(Error);
      expect(memory.prepare('SELECT state FROM memory_job_attempts').get()).toEqual({ state: 'sealed' });
      expect(memoryCounts(root)).toEqual([0, 0, 0]);
      expect(store.listUnknown(1, 'memory.consolidate', 8)).toHaveLength(1);
      expect(host.snapshot.status).toBe('stopped');
    } finally { await host.stop(); memory.close(); store.close(); await service.stop(); }
  }, 30_000);

  it('源 RPC 等待期间 stop 取消当前 signal，停机后没有 enqueue 或延迟回调', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-loop-read-stop-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = hostJobs(store, service.client);
    let entered = false, aborted = false;
    const read = vi.spyOn(service.client, 'readRequests').mockImplementation((_request, signal) => new Promise((_resolve, reject) => {
      entered = true;
      signal!.addEventListener('abort', () => { aborted = true; reject(signal!.reason); }, { once: true });
    }));
    try {
      const observed = host.start().catch(error => error);
      await eventually(() => entered);
      await host.stop();
      expect(await observed).toBeInstanceOf(Error);
      expect(aborted).toBe(true);
      expect(store.claim(1, 'check', clock.now(), 100)).toBeNull();
      expect(host.snapshot.completed_cycles).toBe(0);
    } finally { await host.stop(); read.mockRestore(); store.close(); await service.stop(); }
  }, 30_000);

  it('暂未 ready 不冒充 ready；随后恢复，而持久分页不被首个 unavailable unknown 阻塞', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-loop-pagination-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = hostJobs(store, service.client, 2, 1);
    const read = vi.spyOn(service.client, 'readRequests').mockRejectedValueOnce(new HostCognitionError(ServiceErrorCode.NOT_READY));
    const query = service.client.reconcile.bind(service.client);
    const queries = vi.spyOn(service.client, 'reconcile').mockImplementation((request, signal) => {
      if (request.identity?.jobId === 'a') return Promise.reject(new HostCognitionError(ServiceErrorCode.UNAVAILABLE));
      return query(request, signal);
    });
    try {
      // 用真正源输入创建两个在途原身份，转移后分别成为未知；所有查询仍走真实接收 owner。
      const actualRead = CognitionClient.prototype.readRequests.bind(service.client);
      const request = memoryJobRequest((await actualRead(create(ReadMemoryJobRequestsRequestSchema, { limit: 1 }))).requests[0], submissionPolicy);
      store.activateAuthority(1, clock.now());
      for (const id of ['a', 'b']) {
        store.enqueue({ ...request, job_id: id, idempotency_key: id, max_attempts: 1 }, 1, clock.now());
        expect(store.claim(1, 'old', clock.now(), 60_000, 'memory.consolidate')?.job.job_id).toBe(id);
      }
      expect(await host.start()).toMatchObject({ status: 'degraded', error_code: 'cognition_unavailable' });
      await eventually(() => store.load('b')?.status === 'dead_letter');
      expect(store.load('a')?.status).toBe('unknown');
      expect(queries.mock.calls.map(([request]) => request.identity?.jobId)).toContain('b');
      expect(host.snapshot.status).toBe('degraded');
    } finally { await host.stop(); read.mockRestore(); queries.mockRestore(); store.close(); await service.stop(); }
  }, 30_000);

  it('authority 切换后旧循环失败关闭，不重新激活旧主或继续投递', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-loop-fenced-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const other = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = hostJobs(store, service.client);
    try {
      await host.start();
      other.activateAuthority(2, clock.now());
      await eventually(() => host.snapshot.status === 'failed');
      expect(host.snapshot.error_code).toBe('jobs_cycle_failed');
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
      await expect(service.client.readRequests(create(ReadMemoryJobRequestsRequestSchema, { limit: 1 }))).rejects.toBeInstanceOf(HostCognitionError);
      expect(other.claim(2, 'new', clock.now(), 100)).toBeNull();
      await expect(host.start()).rejects.toThrow('撤销');
    } finally { await host.stop(); other.close(); store.close(); await service.stop(); }
  }, 30_000);

  it('非法源摘要导致失败关闭，而不是后台重复吞错或将源 ACK', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-loop-bad-source-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = hostJobs(store, service.client);
    const actualRead = service.client.readRequests.bind(service.client);
    const reads = vi.spyOn(service.client, 'readRequests').mockImplementation(async (...args: Parameters<CognitionClient['readRequests']>) => {
      const response = await actualRead(...args); response.requests[0].inputDigest = 'invalid'; return response;
    });
    const acks = vi.spyOn(service.client, 'acknowledge');
    try {
      await expect(host.start()).rejects.toThrow('摘要');
      expect(host.snapshot).toMatchObject({ status: 'failed', error_code: 'jobs_cycle_failed', completed_cycles: 0 });
      expect(acks).not.toHaveBeenCalled();
      expect(store.claim(1, 'check', clock.now(), 100)).toBeNull();
      expect(memoryCounts(root)).toEqual([0, 0, 0]);
      await new Promise(resolve => setTimeout(resolve, 40));
      expect(reads).toHaveBeenCalledTimes(1);
    } finally { await host.stop(); reads.mockRestore(); acks.mockRestore(); store.close(); await service.stop(); }
  }, 30_000);
});

describe('Host Jobs 消费真实 Worker Memory owner', () => {
  it('源 enqueue 已提交而 ACK 未到达：重开 Jobs 政策变化仍沿用首次预算并完成一次 Memory', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-source-'));
    const service = await worker(root, 'one');
    let store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    let first = true;
    const port = { execute: service.client.execute.bind(service.client), reconcile: service.client.reconcile.bind(service.client),
      publishJobState: service.client.publishJobState.bind(service.client),
      readRequests: service.client.readRequests.bind(service.client), acknowledge: async (...args: Parameters<CognitionClient['acknowledge']>) => {
        if (first) { first = false; throw new Error('injected ACK loss'); }
        return service.client.acknowledge(...args);
      } };
    const adapter = new CognitionJobAdapter(port);
    let controller = new JobController(store, clock, policy);
    try {
      store.activateAuthority(1, clock.now());
      await expect(adapter.deliverRequests(store, clock, 1, submissionPolicy, 8)).rejects.toThrow('ACK loss');
      const sources = (await service.client.readRequests(create(ReadMemoryJobRequestsRequestSchema, { limit: 8 }))).requests;
      expect(sources).toHaveLength(1);
      const jobId = `memory:${sources[0].requestId}`;
      const original = store.load(jobId)!;
      expect(original.status).toBe('queued');
      await controller.stop();
      store.close(); store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
      store.activateAuthority(2, clock.now());
      expect(await adapter.deliverRequests(store, clock, 2, { debounce_ms: 60_000, max_attempts: 1 }, 8)).toBe(1);
      expect(await adapter.deliverRequests(store, clock, 2, submissionPolicy, 8)).toBe(0);
      expect(store.load(jobId)).toMatchObject({ due_at: original.due_at, max_attempts: original.max_attempts });
      controller = new JobController(store, clock, policy);
      controller.register(adapter);
      const result = await controller.execute(store.claim(2, 'host-two', clock.now(), 60_000)!);
      expect(result).toMatchObject({ job_id: jobId, status: 'succeeded', attempt: 1 });
      expect(result?.result?.memory_ids).toHaveLength(1);
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
    } finally { await controller.stop(); store.close(); await service.stop(); }
  }, 30_000);

  it('源 ACK 在 Memory 已提交后响应丢失：源不再重投，Jobs 原接纳不回滚且只完成一次业务', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-source-committed-'));
    const service = await worker(root, 'one');
    let store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    let controller = new JobController(store, clock, policy);
    const adapter = new CognitionJobAdapter({ execute: service.client.execute.bind(service.client),
      publishJobState: service.client.publishJobState.bind(service.client),
      reconcile: service.client.reconcile.bind(service.client), readRequests: service.client.readRequests.bind(service.client),
      acknowledge: async (...args: Parameters<CognitionClient['acknowledge']>) => {
        await service.client.acknowledge(...args); throw new Error('injected committed ACK response loss');
      } });
    try {
      store.activateAuthority(1, clock.now());
      const original = (await service.client.readRequests(create(ReadMemoryJobRequestsRequestSchema, { limit: 8 }))).requests[0];
      const jobId = `memory:${original.requestId}`;
      await expect(adapter.deliverRequests(store, clock, 1, submissionPolicy, 8)).rejects.toThrow('ACK response loss');
      expect((await service.client.readRequests(create(ReadMemoryJobRequestsRequestSchema, { limit: 8 }))).requests).toEqual([]);
      expect(store.load(jobId)?.status).toBe('queued');
      await controller.stop(); store.close(); store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
      store.activateAuthority(2, clock.now()); controller = new JobController(store, clock, policy);
      const restarted = new CognitionJobAdapter(service.client);
      expect(await restarted.deliverRequests(store, clock, 2, { debounce_ms: 60_000, max_attempts: 1 }, 8)).toBe(0);
      controller.register(restarted);
      expect(await controller.execute(store.claim(2, 'host-two', clock.now(), 60_000)!))
        .toMatchObject({ job_id: jobId, status: 'succeeded', attempt: 1, max_attempts: 3 });
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
      expect(store.claim(2, 'host-two', clock.now(), 60_000)).toBeNull();
    } finally { await controller.stop(); store.close(); await service.stop(); }
  }, 30_000);

  it('同源 request ID 的首次时间漂移不是配置变化：信封冲突拒绝 ACK', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-source-envelope-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const actualRead = service.client.readRequests.bind(service.client);
    let drift = false;
    const acknowledge = vi.fn(async () => { throw new Error('injected ACK loss'); });
    const adapter = new CognitionJobAdapter({ execute: service.client.execute.bind(service.client),
      publishJobState: service.client.publishJobState.bind(service.client),
      reconcile: service.client.reconcile.bind(service.client), acknowledge,
      readRequests: async (...args: Parameters<CognitionClient['readRequests']>) => {
        const response = await actualRead(...args);
        if (drift) response.requests[0].createdAt = new Date(Date.parse(response.requests[0].createdAt) + 1000).toISOString();
        return response;
      } });
    try {
      store.activateAuthority(1, clock.now());
      await expect(adapter.deliverRequests(store, clock, 1, submissionPolicy, 8)).rejects.toThrow('ACK loss');
      drift = true;
      await expect(adapter.deliverRequests(store, clock, 1, { debounce_ms: 1000, max_attempts: 1 }, 8)).rejects.toThrow('原事实内容冲突');
      expect(acknowledge).toHaveBeenCalledTimes(1);
      expect((await actualRead(create(ReadMemoryJobRequestsRequestSchema, { limit: 8 }))).requests).toHaveLength(1);
      expect(store.readOutbox(1, 100)).toHaveLength(1);
    } finally { store.close(); await service.stop(); }
  }, 30_000);

  it('Memory 已提交而完成响应丢失：跨 Worker/Jobs 重启对账原 attempt，不再执行', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-reconcile-'));
    let service = await worker(root, 'one');
    let store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    let controller = new JobController(store, clock, policy);
    try {
      store.activateAuthority(1, clock.now());
      const adapter = new CognitionJobAdapter({ execute: async (...args) => {
        await service.client.execute(...args); throw new Error('injected completion response loss');
      }, reconcile: service.client.reconcile.bind(service.client), readRequests: service.client.readRequests.bind(service.client),
      acknowledge: service.client.acknowledge.bind(service.client), publishJobState: service.client.publishJobState.bind(service.client) });
      await adapter.deliverRequests(store, clock, 1, submissionPolicy, 8);
      controller.register(adapter);
      const claim = store.claim(1, 'original-host', clock.now(), 60_000)!;
      expect((await controller.execute(claim))?.status).toBe('unknown');
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
      await controller.stop(); store.close(); await service.stop();
      service = await worker(root, 'two');
      store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
      store.activateAuthority(2, clock.now());
      controller = new JobController(store, clock, policy);
      const recovery = new JobRecoveryController(store, clock, 2, policy);
      const query = new CognitionJobAdapter(service.client);
      const result = await recovery.reconcile(claim.job.job_id, query);
      expect(result).toMatchObject({ status: 'accepted', job: { status: 'succeeded', attempt: 1 } });
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
      expect(store.claim(2, 'new-host', clock.now(), 60_000)).toBeNull();
      const attempt = store.listAttempts(claim.job.job_id)[0];
      expect(attempt).toMatchObject({ authority_epoch: 1, owner_id: 'original-host', fencing_token: claim.lease.fencing_token });
    } finally { await controller.stop(); store.close(); await service.stop(); }
  }, 30_000);

  it('源 ACK 与原执行均未到达：封口后重投不以新政策覆盖 retry due 或预算', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-not-applied-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const controller = new JobController(store, clock, policy);
    try {
      store.activateAuthority(1, clock.now());
      const adapter = new CognitionJobAdapter(service.client);
      const lostAck = new CognitionJobAdapter({ execute: service.client.execute.bind(service.client),
        publishJobState: service.client.publishJobState.bind(service.client),
        reconcile: service.client.reconcile.bind(service.client), readRequests: service.client.readRequests.bind(service.client),
        acknowledge: async () => { throw new Error('injected ACK loss'); } });
      await expect(lostAck.deliverRequests(store, clock, 1, submissionPolicy, 8)).rejects.toThrow('ACK loss');
      const claim = store.claim(1, 'old-host', clock.now(), 60_000)!;
      store.activateAuthority(2, clock.now());
      const recovery = new JobRecoveryController(store, clock, 2, policy);
      expect(await recovery.reconcile(claim.job.job_id, adapter)).toMatchObject({ status: 'accepted', job: { status: 'retry_wait' } });
      expect(memoryCounts(root)).toEqual([0, 0, 0]);
      const retry = store.load(claim.job.job_id)!;
      expect(await adapter.deliverRequests(store, clock, 2, { debounce_ms: 60_000, max_attempts: 1 }, 8)).toBe(1);
      expect(store.load(claim.job.job_id)).toEqual(retry);
      await new Promise(resolve => setTimeout(resolve, 5));
      controller.register(adapter);
      const next = store.claim(2, 'new-host', clock.now(), 60_000)!;
      expect(next.job.attempt).toBe(2);
      expect((await controller.execute(next))?.status).toBe('succeeded');
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
    } finally { await controller.stop(); store.close(); await service.stop(); }
  }, 30_000);

  it('非法 generation 不提交 Jobs；client 关闭拒绝后续请求', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-generation-'));
    const service = await worker(root, 'one');
    const wrong = new CognitionClient(service.endpoint, 'old', 2000);
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    try {
      store.activateAuthority(1, clock.now());
      await expect(new CognitionJobAdapter(wrong).deliverRequests(store, clock, 1, submissionPolicy, 8)).rejects.toBeInstanceOf(HostCognitionError);
      expect(store.claim(1, 'host', clock.now(), 60_000)).toBeNull();
      wrong.close();
      await expect(wrong.readRequests(create(ReadMemoryJobRequestsRequestSchema, { limit: 8 }))).rejects.toBeInstanceOf(HostCognitionError);
    } finally { wrong.close(); store.close(); await service.stop(); }
  }, 30_000);

  it('取消真实在途模型并封口原 attempt，晚到重放不能提交 Memory', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-cancel-'));
    const service = await worker(root, 'waiting-model');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const controller = new JobController(store, clock, policy);
    try {
      store.activateAuthority(1, clock.now());
      const adapter = new CognitionJobAdapter(service.client);
      await adapter.deliverRequests(store, clock, 1, submissionPolicy, 8);
      controller.register(adapter);
      const claim = store.claim(1, 'host', clock.now(), 60_000)!;
      const pending = controller.execute(claim);
      const memory = new Database(path.join(root, 'memory.sqlite'), { readonly: true });
      try {
        const deadline = Date.now() + 2000;
        while (!memory.prepare("SELECT job_id FROM memory_job_attempts WHERE state='active'").get() && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(memory.prepare("SELECT job_id FROM memory_job_attempts WHERE state='active'").get()).toBeTruthy();
        expect(controller.cancel(claim.job.job_id, 1, store.load(claim.job.job_id)!.revision)?.status).toBe('cancelled');
        expect((await pending)?.status).toBe('cancelled');
        expect(memory.prepare('SELECT state FROM memory_job_attempts').get()).toEqual({ state: 'sealed' });
        expect(memoryCounts(root)).toEqual([0, 0, 0]);
        await expect(service.client.execute(create(ExecuteMemoryJobRequestSchema, {
          identity: memoryJobIdentity(claim.job), episodeId: String(claim.job.payload.episode_id),
          episodeVersion: BigInt(Number(claim.job.payload.episode_version)), inputDigest: String(claim.job.payload.input_digest),
        }))).rejects.toBeInstanceOf(HostCognitionError);
        expect(memoryCounts(root)).toEqual([0, 0, 0]);
      } finally { memory.close(); }
    } finally { await controller.stop(); store.close(); await service.stop(); }
  }, 30_000);
});

it.each(['scope', 'epoch', 'token', 'owner', 'seal', 'source', 'resolution', 'evidence'] as const)('Host 拒绝 %s 漂移证据', mode => {
  const job = { job_id: 'job', scope_id: 'scope', attempt: 1, authority_epoch: 1, fencing_token: 1,
    lease_owner: 'owner', lease_until: 60_000 } as Job;
  const identity = memoryJobIdentity(job);
  const result = create(MemoryJobResultSchema, { identity, sourceId: 'cognition.memory', receiverFenced: true,
    resolution: MemoryJobResolution.NOT_APPLIED, observedAtMs: 1000n });
  if (mode === 'scope') result.identity!.scopeId = 'wrong';
  if (mode === 'epoch') result.identity!.authorityEpoch = 2n;
  if (mode === 'token') result.identity!.fencingToken = 2n;
  if (mode === 'owner') result.identity!.ownerId = 'wrong';
  if (mode === 'seal') result.receiverFenced = false;
  if (mode === 'source') result.sourceId = 'untrusted';
  if (mode === 'resolution') result.resolution = MemoryJobResolution.UNSPECIFIED;
  const actual = result.identity!;
  result.evidenceId = createHash('sha256').update(JSON.stringify([actual.jobId, actual.scopeId, Number(actual.attempt),
    Number(actual.authorityEpoch), Number(actual.fencingToken), actual.ownerId, 'not_applied', 'sealed'])).digest('hex');
  if (mode === 'evidence') result.evidenceId = 'invalid';
  expect(() => memoryJobEvidence(result, memoryJobIdentity(job))).toThrow();
});
