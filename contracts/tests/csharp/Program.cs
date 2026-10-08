using System;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using Google.Protobuf;
using GlimmerCradle.Contracts.Glimmer.Common.V1;
using GlimmerCradle.Contracts.Glimmer.Cognition.V1;
using GlimmerCradle.Contracts.Glimmer.Kernel.V1;
using AvatarV1 = GlimmerCradle.Contracts.Glimmer.Avatar.V1;
using ContentV1 = GlimmerCradle.Contracts.Glimmer.Content.V1;
using SurfaceV1 = GlimmerCradle.Contracts.Glimmer.Surface.V1;
using JobsV1 = GlimmerCradle.Contracts.Glimmer.Jobs.V1;
using CapabilitiesV1 = GlimmerCradle.Contracts.Glimmer.Capabilities.V1;
using ConversationV1 = GlimmerCradle.Contracts.Glimmer.Conversation.V1;

var root = Environment.GetEnvironmentVariable("CONTRACTS_ROOT")
    ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
var fixturePath = Path.Combine(root, "fixtures", "skill-tool-parameters.valid.json");
var fixtureBytes = File.ReadAllBytes(fixturePath);
using var documentJson = JsonDocument.Parse(fixtureBytes);
var document = documentJson.RootElement;
var digest = SHA256.HashData(fixtureBytes);

var methodReference = new CapabilitiesV1.SkillReference { SkillId = "method:总结", DefinitionRevision = "revision:一" };
var nativeScope = new CapabilitiesV1.CapabilityScopeContext { SourceProviderId = "provider:一", SceneId = "scene:一", ConversationId = "conversation:一", UserId = "user:一" };
var nativeReference = new CapabilitiesV1.CapabilityReference { Id = "[\"weather\",\"lookup\"]", Revision = "revision:一" };
var knowledgeRegister = new RegisterKnowledgeResourceSourceRequest { Source = new KnowledgeResourceSource { SourceId = "source:资料", Reference = nativeReference, Priority = 9007199254740991UL, Enabled = false }, ExpectedSourceRevision = 9007199254740990UL };
var knowledgeState = new KnowledgeResourceSourceState { Source = new KnowledgeResourceSource { SourceId = "source:资料", Reference = nativeReference, Scope = nativeScope, Priority = 1, Enabled = true }, SourceRevision = 1, DeclarationDigest = new string('a', 64) };
var knowledgeRegistered = new RegisterKnowledgeResourceSourceResponse { State = knowledgeState };
var knowledgeGet = new GetKnowledgeResourceSourceRequest { SourceId = "source:资料" };
var knowledgeGot = new GetKnowledgeResourceSourceResponse { State = knowledgeState };
var knowledgeCollect = new CollectKnowledgeSourceRequest { SourceId = "source:资料", ExpectedSourceRevision = 9007199254740991UL };
var knowledgeCollected = new CollectKnowledgeSourceResponse { SourceId = "source:资料", SourceRevision = 1, EntryId = "resource:source:资料", EntryRevision = 9007199254740991UL, ContentDigest = new string('b', 64) };
if (!RegisterKnowledgeResourceSourceRequest.Parser.ParseFrom(knowledgeRegister.ToByteArray()).Equals(knowledgeRegister)
    || !RegisterKnowledgeResourceSourceResponse.Parser.ParseFrom(knowledgeRegistered.ToByteArray()).Equals(knowledgeRegistered)
    || !GetKnowledgeResourceSourceRequest.Parser.ParseFrom(knowledgeGet.ToByteArray()).Equals(knowledgeGet)
    || !GetKnowledgeResourceSourceResponse.Parser.ParseFrom(knowledgeGot.ToByteArray()).Equals(knowledgeGot)
    || !CollectKnowledgeSourceRequest.Parser.ParseFrom(knowledgeCollect.ToByteArray()).Equals(knowledgeCollect)
    || !CollectKnowledgeSourceResponse.Parser.ParseFrom(knowledgeCollected.ToByteArray()).Equals(knowledgeCollected)
    || KnowledgeResourceSource.Parser.ParseFrom(Array.Empty<byte>()).HasEnabled
    || GetKnowledgeResourceSourceResponse.Parser.ParseFrom(Array.Empty<byte>()).State != null)
    throw new InvalidOperationException("Knowledge source declaration/CAS/disable/presence roundtrip failed");
var resourceAccess = new CapabilitiesV1.KnowledgeResourceAccess { AccessId = "proof:一", SourceId = "source:一", PrincipalId = "principal:一",
    PermissionRevision = "permission:一", CollectedAtMs = 1, ExpiresAtMs = 9007199254740991UL };
var resourceCollection = new CapabilitiesV1.CollectKnowledgeResourceRequest { SourceId = "source:一", Reference = nativeReference, Scope = nativeScope };
var resourceCollectionResult = new CapabilitiesV1.CollectKnowledgeResourceResponse { Access = resourceAccess,
    Content = new CapabilitiesV1.ResourceContent { Reference = nativeReference, ContentRevision = new string('a', 64), MediaType = "text/plain", ContentUtf8 = "资料" } };
var resourceValidation = new CapabilitiesV1.ValidateKnowledgeResourceRequest { Access = resourceAccess, Reference = nativeReference, ContentRevision = new string('a', 64), MediaType = "text/plain", Scope = nativeScope };
var resourceValidationResult = new CapabilitiesV1.ValidateKnowledgeResourceResponse { Current = true };
if (!CapabilitiesV1.CollectKnowledgeResourceRequest.Parser.ParseFrom(resourceCollection.ToByteArray()).Equals(resourceCollection)
    || !CapabilitiesV1.CollectKnowledgeResourceResponse.Parser.ParseFrom(resourceCollectionResult.ToByteArray()).Equals(resourceCollectionResult)
    || !CapabilitiesV1.ValidateKnowledgeResourceRequest.Parser.ParseFrom(resourceValidation.ToByteArray()).Equals(resourceValidation)
    || !CapabilitiesV1.ValidateKnowledgeResourceResponse.Parser.ParseFrom(resourceValidationResult.ToByteArray()).Equals(resourceValidationResult)
    || CapabilitiesV1.CollectKnowledgeResourceResponse.Parser.ParseFrom(Array.Empty<byte>()).Access != null)
    throw new InvalidOperationException("Knowledge resource evidence/safe integer/presence roundtrip failed");
var nativeExpose = new CapabilitiesV1.ExposeStepRequest { RunId = "run:一", Step = 2, Scope = nativeScope, MaxDefinitions = 128, MaxDefinitionBytes = 65536, RemainingToolCalls = 7 };
nativeExpose.ProtocolFeatures.Add("tool-call.v1");
var nativeSurface = new CapabilitiesV1.ExposeStepResponse { RunId = "run:一", Step = 2, UsedDefinitionBytes = 123, Truncated = true };
nativeSurface.Tools.Add(new CapabilitiesV1.ToolDescriptor { Reference = nativeReference, Name = "tool_weather", InputSchema = Google.Protobuf.WellKnownTypes.Value.ForBool(true) });
nativeSurface.Skills.Add(new CapabilitiesV1.SkillDescriptor { Reference = methodReference, Name = "总结", InputSchema = Google.Protobuf.WellKnownTypes.Value.Parser.ParseJson("{\"type\":\"object\",\"required\":[\"topic\"]}") });
nativeSurface.Resources.Add(new CapabilitiesV1.ResourceDescriptor { Reference = nativeReference, Name = "resource", InputSchema = Google.Protobuf.WellKnownTypes.Value.Parser.ParseJson("{\"type\":\"object\"}") });
var nativeInvoke = new CapabilitiesV1.InvokeToolRequest { Call = new CallMetadata { IdempotencyKey = "run:一:call:一" }, RunId = "run:一", Step = 2, CallId = "call:一", Name = "tool_weather", Reference = nativeReference, Scope = nativeScope, SourceFactId = "action:一", Arguments = Google.Protobuf.WellKnownTypes.Struct.Parser.ParseJson("{\"city\":\"上海\"}") };
var nativeResult = new CapabilitiesV1.InvokeToolResponse { CallId = "call:一", Name = "tool_weather", State = CapabilitiesV1.ExecutionResultState.Succeeded, Result = Google.Protobuf.WellKnownTypes.Value.ForNull(), ResultEventId = new string('a', 64) };
if (!CapabilitiesV1.ExposeStepRequest.Parser.ParseFrom(nativeExpose.ToByteArray()).Equals(nativeExpose)
    || !CapabilitiesV1.ExposeStepResponse.Parser.ParseFrom(nativeSurface.ToByteArray()).Equals(nativeSurface)
    || !CapabilitiesV1.InvokeToolRequest.Parser.ParseFrom(nativeInvoke.ToByteArray()).Equals(nativeInvoke)
    || !CapabilitiesV1.InvokeToolResponse.Parser.ParseFrom(nativeResult.ToByteArray()).Equals(nativeResult)
    || CapabilitiesV1.ExposeStepRequest.Parser.ParseFrom(Array.Empty<byte>()).Scope != null)
    throw new InvalidOperationException("Native Step/reference/privacy/null roundtrip failed");
var methodPlan = new PlanRequest { UserGoal = "原始目标" };
var nativeRead = new CapabilitiesV1.ReadCapabilityRequest { Call = new CallMetadata { IdempotencyKey = "run:一:read:一" }, RunId = "run:一", Step = 2, CallId = "read:一", Name = "glimmer_load_skill",
    Reference = nativeReference, Scope = nativeScope, SourceFactId = "action:加载", Arguments = Google.Protobuf.WellKnownTypes.Struct.Parser.ParseJson("{\"topic\":\"资料\"}") };
var nativeMethod = new CapabilitiesV1.ReadCapabilityResponse { CallId = "read:一", Name = "glimmer_load_skill", State = CapabilitiesV1.ExecutionResultState.Succeeded, ResultEventId = new string('b', 64),
    Skill = new CapabilitiesV1.SkillMaterial { Reference = methodReference, Instructions = "真实正文\n不是权限。" } };
var nativeResource = new CapabilitiesV1.ReadCapabilityResponse { CallId = "read:二", Name = "glimmer_read_resource", State = CapabilitiesV1.ExecutionResultState.Succeeded, ResultEventId = new string('c', 64),
    Resource = new CapabilitiesV1.ResourceContent { Reference = nativeReference, ContentRevision = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("资源"))).ToLowerInvariant(), MediaType = "text/plain", ContentUtf8 = "资源" } };
var nativeDenied = new CapabilitiesV1.ReadCapabilityResponse { CallId = "read:三", State = CapabilitiesV1.ExecutionResultState.Failed, Error = "authorization_denied", ResultEventId = new string('d', 64) };
if (!CapabilitiesV1.ReadCapabilityRequest.Parser.ParseFrom(nativeRead.ToByteArray()).Equals(nativeRead)
    || !CapabilitiesV1.ReadCapabilityResponse.Parser.ParseFrom(nativeMethod.ToByteArray()).Equals(nativeMethod)
    || !CapabilitiesV1.ReadCapabilityResponse.Parser.ParseFrom(nativeResource.ToByteArray()).Equals(nativeResource)
    || !CapabilitiesV1.ReadCapabilityResponse.Parser.ParseFrom(nativeDenied.ToByteArray()).Equals(nativeDenied)
    || CapabilitiesV1.ReadCapabilityResponse.Parser.ParseFrom(Array.Empty<byte>()).ContentCase != CapabilitiesV1.ReadCapabilityResponse.ContentOneofCase.None)
    throw new InvalidOperationException("Native read Unicode/schema/content presence roundtrip failed");
var readSkillEnvelope = new CapabilitiesV1.ReadSkillRequest { Request = nativeRead };
var readResourceEnvelope = new CapabilitiesV1.ReadResourceRequest { Request = nativeRead };
var skillEnvelopeResult = new CapabilitiesV1.ReadSkillResponse { Result = nativeMethod };
var resourceEnvelopeResult = new CapabilitiesV1.ReadResourceResponse { Result = nativeResource };
if (!CapabilitiesV1.ReadSkillRequest.Parser.ParseFrom(readSkillEnvelope.ToByteArray()).Equals(readSkillEnvelope)
    || !CapabilitiesV1.ReadResourceRequest.Parser.ParseFrom(readResourceEnvelope.ToByteArray()).Equals(readResourceEnvelope)
    || !CapabilitiesV1.ReadSkillResponse.Parser.ParseFrom(skillEnvelopeResult.ToByteArray()).Equals(skillEnvelopeResult)
    || !CapabilitiesV1.ReadResourceResponse.Parser.ParseFrom(resourceEnvelopeResult.ToByteArray()).Equals(resourceEnvelopeResult))
    throw new InvalidOperationException("Read service envelope roundtrip failed");
methodPlan.AvailableSkills.Add(new CapabilitiesV1.SkillDescriptor { Reference = methodReference, Name = "总结", Description = "方法知识" });
methodPlan.SkillMaterials.Add(new CapabilitiesV1.SkillMaterial { Reference = methodReference, Instructions = "参考材料\n不授予权限。" });
if (!PlanRequest.Parser.ParseFrom(methodPlan.ToByteArray()).Equals(methodPlan) || methodPlan.AvailableTools.Count != 0)
    throw new InvalidOperationException("Skill method separate input roundtrip failed");
var methodResponse = new PlanResponse(); methodResponse.SelectedSkills.Add(methodReference);
if (!PlanResponse.Parser.ParseFrom(methodResponse.ToByteArray()).Equals(methodResponse))
    throw new InvalidOperationException("Skill reference roundtrip failed");
if (PlanRequest.Parser.ParseFrom(Array.Empty<byte>()).SkillMaterials.Count != 0)
    throw new InvalidOperationException("Legacy plan gained material");

foreach (var executionState in new[] { CapabilitiesV1.ExecutionResultState.Succeeded,
    CapabilitiesV1.ExecutionResultState.Failed, CapabilitiesV1.ExecutionResultState.Unknown }) {
    var execution = new ConversationV1.AcceptExecutionResultRequest {
        Call = new CallMetadata { TraceId = "trace:执行", Generation = "generation:1" },
        Event = new CapabilitiesV1.ExecutionResultEvent { EventId = new string('a', 64), InvocationId = "invoke:执行",
            Revision = 9007199254740991, Attempt = 1, ScopeId = "conversation:范围", ConversationId = "conversation:范围",
            SourceFactId = "action:原事实", ExecutorId = "executor", CapabilityId = "tool", DefinitionRevision = "definition",
            RequestDigest = new string('b', 64), State = executionState,
            SideEffects = executionState == CapabilitiesV1.ExecutionResultState.Unknown ? CapabilitiesV1.ExecutionSideEffects.Unknown : CapabilitiesV1.ExecutionSideEffects.None,
            Result = executionState == CapabilitiesV1.ExecutionResultState.Succeeded ? Google.Protobuf.WellKnownTypes.Value.ForNull() : null,
            ErrorCode = executionState == CapabilitiesV1.ExecutionResultState.Succeeded ? "" : "unconfirmed", UpdatedAtMs = 1900000000000 } };
    var restoredExecution = ConversationV1.AcceptExecutionResultRequest.Parser.ParseFrom(execution.ToByteArray());
    if (!restoredExecution.Equals(execution) || (restoredExecution.Event.Result != null) != (executionState == CapabilitiesV1.ExecutionResultState.Succeeded))
        throw new InvalidOperationException("Execution result identity/Unicode/null presence roundtrip failed");
}
var executionReceipt = new ConversationV1.AcceptExecutionResultResponse { EventId = new string('a', 64), InvocationId = "invoke:执行",
    Revision = 9007199254740991, MomentId = "moment:事实", LogPosition = 9007199254740991, Accepted = true };
if (!ConversationV1.AcceptExecutionResultResponse.Parser.ParseFrom(executionReceipt.ToByteArray()).Equals(executionReceipt))
    throw new InvalidOperationException("Execution durable receipt precision roundtrip failed");
if (ConversationV1.AcceptExecutionResultRequest.Parser.ParseFrom(Array.Empty<byte>()).Event != null)
    throw new InvalidOperationException("Execution absent event gained presence");

var planningSource = new PlanningJobSourceRequest {
    RequestId = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(
        "[\"planning.evaluate\",\"commitment:长期承诺\",\"plan:评估\",9007199254740991]"))).ToLowerInvariant(),
    CommitmentId = "commitment:长期承诺", PlanId = "plan:评估", PlanVersion = 9007199254740991,
    GoalId = "goal:目标", GoalVersion = 9007199254740991, ScopeId = "conversation:范围",
    DueAtMs = 9007199254740991,
};
var planningRead = new ReadPlanningJobRequestsRequest {
    Call = new CallMetadata { TraceId = "trace:planning", Generation = "planning-1" }, Limit = 1000,
};
if (!ReadPlanningJobRequestsRequest.Parser.ParseFrom(planningRead.ToByteArray()).Equals(planningRead))
    throw new InvalidOperationException("Planning source read metadata roundtrip failed");
var planningResponse = new ReadPlanningJobRequestsResponse { Requests = { planningSource } };
if (!ReadPlanningJobRequestsResponse.Parser.ParseFrom(planningResponse.ToByteArray()).Equals(planningResponse))
    throw new InvalidOperationException("Planning source identity/precision roundtrip failed");
var planningAck = new AcknowledgePlanningJobRequestRequest {
    Call = planningRead.Call, Request = planningSource, JobId = "planning:" + planningSource.RequestId,
    JobRevision = 9007199254740991, Duplicate = true,
};
if (!AcknowledgePlanningJobRequestRequest.Parser.ParseFrom(planningAck.ToByteArray()).Equals(planningAck))
    throw new InvalidOperationException("Planning source ACK precision/metadata roundtrip failed");
var planningReceipt = new AcknowledgePlanningJobRequestResponse {
    RequestId = planningSource.RequestId, JobId = planningAck.JobId, Accepted = true,
};
if (!AcknowledgePlanningJobRequestResponse.Parser.ParseFrom(planningReceipt.ToByteArray()).Equals(planningReceipt))
    throw new InvalidOperationException("Planning source receipt roundtrip failed");
if (AcknowledgePlanningJobRequestRequest.Parser.ParseFrom(Array.Empty<byte>()).Request != null)
    throw new InvalidOperationException("Planning source ACK absent request gained presence");

var planningQuery = new ReconcilePlanningJobRequest { Call = planningRead.Call, RequestId = planningSource.RequestId,
    Identity = new JobsV1.JobExecutionIdentity { JobId = planningAck.JobId, ScopeId = planningSource.ScopeId,
        Attempt = 2, AuthorityEpoch = 7, FencingToken = 9007199254740991, OwnerId = "host:接任者", LeaseUntilMs = 1900000000000 } };
if (!ReconcilePlanningJobRequest.Parser.ParseFrom(planningQuery.ToByteArray()).Equals(planningQuery))
    throw new InvalidOperationException("Planning original attempt/request precision roundtrip failed");
var committer = planningQuery.Identity.Clone();
committer.Attempt = 1; committer.OwnerId = "原提交者";
var planningApplied = new ReconcilePlanningJobResponse { Result = new PlanningJobResult {
    Identity = planningQuery.Identity, RequestId = planningSource.RequestId, Resolution = PlanningJobResolution.Applied,
    SourceId = "cognition.planning", ReceiverFenced = true, EvidenceId = new string('c', 64), ObservedAtMs = 100,
    Receipt = new PlanningEvaluationReceipt { Identity = committer, ReceiptId = new string('r', 64),
        RequestId = planningSource.RequestId, CommitmentId = planningSource.CommitmentId, CommitmentRevision = 9007199254740991,
        Completed = false, Reason = "条件尚未满足", CommittedAtMs = 90, EvidenceIds = { "事实:一" },
        Evidence = { new PlanningEvidenceReference { EvidenceId = "事实:一", SourceOwner = "conversation",
            ScopeId = planningSource.ScopeId, Revision = 9007199254740991, ContentDigest = new string('a', 64) } } } } };
if (!ReconcilePlanningJobResponse.Parser.ParseFrom(planningApplied.ToByteArray()).Equals(planningApplied))
    throw new InvalidOperationException("Planning business receipt/committer precision roundtrip failed");
var planningAccept = new AcceptPlanningCommitmentRequest { Call = planningRead.Call, CommitmentId = "承诺:一",
    PlanId = "计划:一", PlanVersion = 9007199254740991, GoalId = "目标:一", GoalVersion = 9007199254740991,
    Text = "核对事实", CompletionCondition = "真实证据已接纳", Steps = { "检查实际资料" },
    SourceMomentId = "moment:原来源", DueAtMs = 9007199254740991 };
var planningAccepted = new AcceptPlanningCommitmentResponse { CommitmentId = planningAccept.CommitmentId,
    PlanId = planningAccept.PlanId, PlanVersion = planningAccept.PlanVersion, Revision = 9007199254740991,
    Status = "accepted", ScopeId = "conversation:一" };
var planningExecute = new ExecutePlanningJobRequest { Call = planningRead.Call,
    Identity = planningQuery.Identity, RequestId = planningSource.RequestId };
var admissionRequest = new GetPlanningJobAdmissionRequest { Call = planningRead.Call,
    JobId = planningQuery.Identity.JobId, ScopeId = "conversation:一", RequestId = planningSource.RequestId };
var admissionResponse = new GetPlanningJobAdmissionResponse { JobId = admissionRequest.JobId,
    ScopeId = admissionRequest.ScopeId, RequestId = admissionRequest.RequestId, Eligible = false, ReasonCode = "planning_model_policy" };
if (!GetPlanningJobAdmissionRequest.Parser.ParseFrom(admissionRequest.ToByteArray()).Equals(admissionRequest)
    || !GetPlanningJobAdmissionResponse.Parser.ParseFrom(admissionResponse.ToByteArray()).Equals(admissionResponse))
    throw new InvalidOperationException("Planning read-only admission identity/policy roundtrip failed");
var planningExecuted = new ExecutePlanningJobResponse { Result = planningApplied.Result };
if (!AcceptPlanningCommitmentRequest.Parser.ParseFrom(planningAccept.ToByteArray()).Equals(planningAccept)
    || !AcceptPlanningCommitmentResponse.Parser.ParseFrom(planningAccepted.ToByteArray()).Equals(planningAccepted)
    || !ExecutePlanningJobRequest.Parser.ParseFrom(planningExecute.ToByteArray()).Equals(planningExecute)
    || !ExecutePlanningJobResponse.Parser.ParseFrom(planningExecuted.ToByteArray()).Equals(planningExecuted)
    || ExecutePlanningJobResponse.Parser.ParseFrom(Array.Empty<byte>()).Result != null)
    throw new InvalidOperationException("Planning accept/execute source/precision/presence roundtrip failed");
var notification = new PlanningNotificationRequest { NotificationId = new string('d', 64), ReceiptId = new string('e', 64),
    RequestId = planningSource.RequestId, JobId = planningAck.JobId, CommitmentId = planningSource.CommitmentId,
    CommitmentRevision = 9007199254740991, GoalId = planningSource.GoalId, GoalVersion = 9007199254740991,
    ScopeId = planningSource.ScopeId, SourceMomentId = "moment:原来源", SourceDigest = new string('a', 64), CreatedAtMs = 0 };
var notificationRead = new ReadPlanningNotificationsRequest { Limit = 1, AfterNotificationId = new string('b', 64) };
var notificationPage = new ReadPlanningNotificationsResponse { Requests = { notification } };
var notificationResolve = new ResolvePlanningNotificationRequest { Request = notification };
var notificationResolved = new ResolvePlanningNotificationResponse { Request = notification, Available = true,
    ReasonCode = "planning_notification_source_ready", GoalText = "目标:一", ActorId = "actor:一", PrivacyClass = "private",
    RecallOwnerId = "actor:一", DisclosureOwnerId = "conversation:一", Receipt = planningApplied.Result.Receipt.Clone(),
    Context = new ConversationContext { SourceProviderId = "provider:一", SceneId = "scene:一", ConversationId = "conversation:一",
        ContinuityId = "continuity:一", ThreadId = "main", InteractionId = "interaction:一", RecallScope = "actor_private",
        DisclosureScope = "conversation_private" } };
notificationResolved.Receipt.Completed = true;
if (!PlanningNotificationRequest.Parser.ParseFrom(notification.ToByteArray()).Equals(notification)
    || !ReadPlanningNotificationsRequest.Parser.ParseFrom(notificationRead.ToByteArray()).Equals(notificationRead)
    || !ReadPlanningNotificationsResponse.Parser.ParseFrom(notificationPage.ToByteArray()).Equals(notificationPage)
    || !ResolvePlanningNotificationRequest.Parser.ParseFrom(notificationResolve.ToByteArray()).Equals(notificationResolve)
    || !ResolvePlanningNotificationResponse.Parser.ParseFrom(notificationResolved.ToByteArray()).Equals(notificationResolved)
    || PlanningNotificationRequest.Parser.ParseFrom(Array.Empty<byte>()).HasSourceMomentId
    || ResolvePlanningNotificationResponse.Parser.ParseFrom(Array.Empty<byte>()).Context != null
    || ResolvePlanningNotificationResponse.Parser.ParseFrom(Array.Empty<byte>()).Receipt != null)
    throw new InvalidOperationException("Planning notification context/receipt/precision/presence roundtrip failed");
planningApplied.Result.Resolution = PlanningJobResolution.NotApplied;
planningApplied.Result.Receipt = null;
if (ReconcilePlanningJobResponse.Parser.ParseFrom(planningApplied.ToByteArray()).Result.Receipt != null)
    throw new InvalidOperationException("Planning negative result gained receipt presence");

var stateRequest = new PublishMemoryJobStateRequest { DeliveryAuthorityEpoch = 9007199254740991,
    Event = new JobsV1.JobStateEvent { EventId = "event:one", JobId = "job:one", ScopeId = "scope:one",
        GoalId = "source:one", Kind = "memory.consolidate", Revision = 9007199254740991,
        Status = JobsV1.JobStatus.Cancelled, Attempt = 2, AuthorityEpoch = 7, FencingToken = 8,
        UpdatedAtMs = 1900000000000, ErrorCode = "cancelled" } };
var restoredState = PublishMemoryJobStateRequest.Parser.ParseFrom(stateRequest.ToByteArray());
var planningState = new PublishPlanningJobStateRequest { DeliveryAuthorityEpoch = 9007199254740991, Event = stateRequest.Event.Clone() };
planningState.Event.Kind = "planning.evaluate";
planningState.Event.Result = Google.Protobuf.WellKnownTypes.Struct.Parser.ParseJson("{\"assessment\":{\"completed\":false}}");
var planningStateAck = new PublishPlanningJobStateResponse { EventId = "event:one", Accepted = true, Duplicate = true };
if (!PublishPlanningJobStateRequest.Parser.ParseFrom(planningState.ToByteArray()).Equals(planningState)
    || !PublishPlanningJobStateResponse.Parser.ParseFrom(planningStateAck.ToByteArray()).Equals(planningStateAck)
    || PublishPlanningJobStateRequest.Parser.ParseFrom(Array.Empty<byte>()).Event != null)
    throw new InvalidOperationException("Planning state precision/completed=false/ACK/presence roundtrip failed");
if (restoredState.DeliveryAuthorityEpoch != 9007199254740991 || restoredState.Event.Revision != 9007199254740991
    || restoredState.Event.Status != JobsV1.JobStatus.Cancelled || restoredState.Event.Result != null
    || !restoredState.Event.HasErrorCode || restoredState.Event.ErrorCode != "cancelled")
    throw new InvalidOperationException("Job state precision/presence roundtrip failed");
stateRequest.Event.Result = Google.Protobuf.WellKnownTypes.Struct.Parser.ParseJson("{\"receipt_id\":\"receipt:one\",\"memory_ids\":[\"memory:one\"]}");
if (PublishMemoryJobStateRequest.Parser.ParseFrom(stateRequest.ToByteArray()).Event.Result.Fields["receipt_id"].StringValue != "receipt:one")
    throw new InvalidOperationException("Job state result roundtrip failed");

var sourceAck = new AcknowledgeMemoryJobRequestRequest { JobId = "job:one", Request = new MemoryJobSourceRequest {
    RequestId = "source:one", EpisodeId = "episode:one", EpisodeVersion = 9007199254740991,
    ScopeId = "scope:one", InputDigest = new string('a', 64), CreatedAt = "2026-10-06T00:00:00Z" } };
if (AcknowledgeMemoryJobRequestRequest.Parser.ParseFrom(sourceAck.ToByteArray()).Request.EpisodeVersion != 9007199254740991)
    throw new InvalidOperationException("Memory source request roundtrip failed");
var jobIdentity = new JobsV1.JobExecutionIdentity { JobId = "job:one", ScopeId = "scope:one", Attempt = 2,
    AuthorityEpoch = 7, FencingToken = 9007199254740991, OwnerId = "host:one", LeaseUntilMs = 1900000000000 };
var memoryRequest = new ExecuteMemoryJobRequest { Identity = jobIdentity, EpisodeId = "episode:one",
    EpisodeVersion = 3, InputDigest = new string('a', 64) };
var restoredMemory = ExecuteMemoryJobRequest.Parser.ParseFrom(memoryRequest.ToByteArray());
if (restoredMemory.Identity.FencingToken != jobIdentity.FencingToken || restoredMemory.EpisodeVersion != 3)
    throw new InvalidOperationException("Memory Job original identity round-trip lost precision");
var sealedJob = new ReconcileMemoryJobResponse { Result = new MemoryJobResult { Identity = jobIdentity,
    Resolution = MemoryJobResolution.NotApplied, ReceiverFenced = true, EvidenceId = "sealed", SourceId = "cognition.memory" } };
if (!ReconcileMemoryJobResponse.Parser.ParseFrom(sealedJob.ToByteArray()).Result.ReceiverFenced)
    throw new InvalidOperationException("Memory Job sealed proof round-trip lost fencing");

var contentAsset = new ContentV1.AssetRef
{
    AssetId = "00000000-0000-4000-8000-000000000001", MediaType = "image/png",
    SizeBytes = 3, Sha256 = new string('a', 64),
};
var contentParts = new[]
{
    new ContentV1.ContentPart { Text = "hello" },
    new ContentV1.ContentPart { Image = contentAsset },
    new ContentV1.ContentPart { Audio = contentAsset },
    new ContentV1.ContentPart { Video = contentAsset },
    new ContentV1.ContentPart { File = new ContentV1.FileContent { Asset = contentAsset, Name = "a.png" } },
};
var contentCases = new[] { ContentV1.ContentPart.ValueOneofCase.Text, ContentV1.ContentPart.ValueOneofCase.Image,
    ContentV1.ContentPart.ValueOneofCase.Audio, ContentV1.ContentPart.ValueOneofCase.Video,
    ContentV1.ContentPart.ValueOneofCase.File };
for (var index = 0; index < contentParts.Length; index++)
{
    var restored = ContentV1.ContentPart.Parser.ParseFrom(contentParts[index].ToByteArray());
    if (restored.ValueCase != contentCases[index])
        throw new InvalidOperationException("C# ContentPart round-trip lost a variant");
}

var request = new EchoProbeRequest
{
    ProbeId = "slice1-contract-probe",
    Document = new DocumentReference
    {
        DocumentId = document.GetProperty("tool_id").GetString(),
        SchemaId = "https://glimmer-cradle.local/contracts/skill/v1/tool-parameters.schema.json",
        SchemaVersion = document.GetProperty("schema_version").GetString(),
        DigestSha256 = Google.Protobuf.ByteString.CopyFrom(digest),
    },
    Trace = new TraceMetadata
    {
        TraceId = "trace-contracts-slice-1",
        CausationId = "m12-slice-1",
        CorrelationId = "parent-019f9407-0503-7613-a386-024a5ad5d619",
    },
};

var requestRoundTrip = EchoProbeRequest.Parser.ParseFrom(request.ToByteArray());
if (requestRoundTrip.Document.DocumentId != document.GetProperty("tool_id").GetString())
{
    throw new InvalidOperationException("C# request protobuf round-trip lost the document reference");
}

var response = new EchoProbeResponse
{
    ProbeId = requestRoundTrip.ProbeId,
    Document = requestRoundTrip.Document,
};
var responseRoundTrip = EchoProbeResponse.Parser.ParseFrom(response.ToByteArray());
if (responseRoundTrip.ProbeId != request.ProbeId
    || responseRoundTrip.Document.SchemaVersion != document.GetProperty("schema_version").GetString())
{
    throw new InvalidOperationException("C# response protobuf round-trip lost the successful echo result");
}

var registration = new RegisterCognitionRequest
{
    Call = new CallMetadata { TraceId = "trace-register", Generation = "generation-1" },
    Endpoint = "grpc://127.0.0.1:43123",
    ProcessId = 42,
    RegistrationNonce = "nonce-1",
    AuthProof = ByteString.CopyFrom(new byte[32]),
};
var registrationRoundTrip = RegisterCognitionRequest.Parser.ParseFrom(registration.ToByteArray());
if (registrationRoundTrip.RegistrationNonce != "nonce-1" || registrationRoundTrip.AuthProof.Length != 32)
{
    throw new InvalidOperationException("C# KernelControlService registration contract round-trip failed");
}

var perception = new SubmitPerceptionResponse
{
    OperationId = "perception-1",
    State = PerceptionOperationState.Accepted,
};
var perceptionRoundTrip = SubmitPerceptionResponse.Parser.ParseFrom(perception.ToByteArray());
if (perceptionRoundTrip.State != PerceptionOperationState.Accepted)
{
    throw new InvalidOperationException("C# CognitionService operation contract round-trip failed");
}

var avatarFrame = new AvatarV1.AvatarDownstreamFrame
{
    Kind = "avatar_intent",
    TraceId = "trace-avatar-contract",
    Timestamp = 42,
    AvatarIntent = new AvatarV1.AvatarIntentPayload
    {
        ActionId = "wave-hand",
        Operation = "trigger",
        Source = "user",
        Priority = 7,
    },
};
var avatarJsonFormatter = new JsonFormatter(
    JsonFormatter.Settings.Default.WithPreserveProtoFieldNames(true));
var avatarJson = avatarJsonFormatter.Format(avatarFrame);
if (!avatarJson.Contains("\"trace_id\"", StringComparison.Ordinal)
    || !avatarJson.Contains("\"avatar_intent\"", StringComparison.Ordinal)
    || !avatarJson.Contains("\"action_id\"", StringComparison.Ordinal)
    || avatarJson.Contains("traceId", StringComparison.Ordinal)
    || avatarJson.Contains("avatarIntent", StringComparison.Ordinal))
{
    throw new InvalidOperationException("C# Avatar JSON projection did not preserve published snake_case wire names");
}
var avatarJsonRoundTrip = AvatarV1.AvatarDownstreamFrame.Parser.ParseJson(avatarJson);
if (avatarJsonRoundTrip.AvatarIntent.ActionId != "wave-hand"
    || avatarJsonRoundTrip.AvatarIntent.Priority != 7)
{
    throw new InvalidOperationException("C# Avatar JSON round-trip lost the control payload");
}

var receipt = new SurfaceV1.DeliveryReceiptCommand
{
    OutputId = "reply:trace", DestinationId = "surface:desktop", AuthorityEpoch = "epoch:test",
    Generation = 3, ReceiptId = "receipt:test", Kind = "playback_progress",
    HeardThroughMs = 125, DurationMs = 500, ReceivedAt = "2026-09-22T00:00:00Z",
};
var receiptRoundTrip = SurfaceV1.DeliveryReceiptCommand.Parser.ParseFrom(receipt.ToByteArray());
if (receiptRoundTrip.Generation != 3 || receiptRoundTrip.HeardThroughMs != 125)
{
    throw new InvalidOperationException("C# Surface delivery receipt round-trip lost fencing or progress");
}
var audioPlay = new SurfaceV1.AudioPlayEvent
{
    AudioId = "audio:1", OutputId = "reply:trace", DestinationId = "surface:desktop",
    AuthorityEpoch = "epoch:test", Generation = 3, SegmentIndex = 1, SegmentCount = 2,
};
var audioPlayRoundTrip = SurfaceV1.AudioPlayEvent.Parser.ParseFrom(audioPlay.ToByteArray());
if (audioPlayRoundTrip.SegmentIndex != 1 || audioPlayRoundTrip.SegmentCount != 2)
{
    throw new InvalidOperationException("C# Surface audio segment round-trip lost ordering metadata");
}

Console.WriteLine("contracts roundtrip cs: ok");
