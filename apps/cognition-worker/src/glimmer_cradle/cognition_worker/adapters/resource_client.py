"""Knowledge 采集/权限复验 Adapter 与原生 Step 材料解码器；二者不互相提升权限。"""

import hashlib
from typing import Protocol

from glimmer.capabilities.v1 import capabilities_pb2 as resource_pb
from glimmer_cradle.cognition.ports import (
    ResourceAccess,
    ResourceScope,
    ResourceSnapshot,
)


class KnowledgeResourceRpcPort(Protocol):
    async def collect_knowledge_resource(self, request: resource_pb.CollectKnowledgeResourceRequest, trace_id: str) -> resource_pb.CollectKnowledgeResourceResponse: ...
    async def validate_knowledge_resource(self, request: resource_pb.ValidateKnowledgeResourceRequest, trace_id: str) -> resource_pb.ValidateKnowledgeResourceResponse: ...


class ResourceClient:
    """独立 Knowledge 采集 Adapter；不将 Step 读取或模型结果提升为可保存来源。"""

    def __init__(self, transport: KnowledgeResourceRpcPort, *, trace_id: str) -> None:
        if not trace_id.strip():
            raise ValueError("resource trace is required")
        self._transport, self._trace = transport, trace_id

    async def read(self, resource_id: str, *, source_id: str, definition_revision: str,
                   principal_id: str, scope: ResourceScope) -> ResourceSnapshot:
        if any(not value.strip() for value in (resource_id, source_id, definition_revision, principal_id)):
            raise ValueError("knowledge resource identity invalid")
        result = await self._transport.collect_knowledge_resource(resource_pb.CollectKnowledgeResourceRequest(
            source_id=source_id, reference=resource_pb.CapabilityReference(id=resource_id, revision=definition_revision),
            scope=self._scope(scope)), self._trace)
        if not result.HasField("content") or not result.HasField("access"):
            raise ValueError("knowledge resource evidence missing")
        content, access = result.content, result.access
        snapshot = resource_snapshot_from_result({
            "reference": {"id": content.reference.id, "revision": content.reference.revision},
            "content_revision": content.content_revision, "media_type": content.media_type, "content_utf8": content.content_utf8,
        }, resource_id, definition_revision)
        if access.source_id != source_id or access.principal_id != principal_id or not access.access_id.strip() or not access.permission_revision.strip() \
                or not 0 <= access.collected_at_ms < access.expires_at_ms <= 2**53 - 1:
            raise ValueError("knowledge resource access identity/time invalid")
        return ResourceSnapshot(snapshot.resource_id, snapshot.revision, snapshot.media_type, snapshot.content,
            snapshot.attributes, ResourceAccess(access.access_id, source_id, principal_id, access.permission_revision,
                access.collected_at_ms, access.expires_at_ms))

    async def is_current(self, snapshot: ResourceSnapshot, *, principal_id: str, scope: ResourceScope) -> bool:
        access = snapshot.access
        if access is None or access.principal_id != principal_id or not isinstance(snapshot.content, bytes) \
                or snapshot.media_type not in {"text/plain", "application/json"} or hashlib.sha256(snapshot.content).hexdigest() != snapshot.revision:
            return False
        revision = snapshot.attributes.get("definition_revision")
        if not isinstance(revision, str) or not revision:
            return False
        result = await self._transport.validate_knowledge_resource(resource_pb.ValidateKnowledgeResourceRequest(
            access=resource_pb.KnowledgeResourceAccess(access_id=access.access_id, source_id=access.source_id,
                principal_id=access.principal_id, permission_revision=access.permission_revision,
                collected_at_ms=access.collected_at_ms, expires_at_ms=access.expires_at_ms),
            reference=resource_pb.CapabilityReference(id=snapshot.resource_id, revision=revision),
            content_revision=snapshot.revision, media_type=snapshot.media_type, scope=self._scope(scope)), self._trace)
        return result.current

    @staticmethod
    def _scope(scope: ResourceScope) -> resource_pb.CapabilityScopeContext | None:
        values = (scope.source_provider_id, scope.scene_id, scope.conversation_id)
        if all(value is None for value in values):
            return None
        if any(not isinstance(value, str) or not value.strip() for value in values):
            raise ValueError("resource scope invalid")
        return resource_pb.CapabilityScopeContext(source_provider_id=scope.source_provider_id,
            scene_id=scope.scene_id, conversation_id=scope.conversation_id)


def resource_snapshot_from_result(output: dict, definition_id: str, definition_revision: str) -> ResourceSnapshot:
    """Validate actual Log material, not a supplier response or an invented resource.read RPC."""
    text = output.get("content_utf8")
    if output.get("reference") != {"id": definition_id, "revision": definition_revision}:
        raise ValueError("native resource definition mismatch")
    if not isinstance(text, str) or len(text.encode("utf-8")) > 32 * 1024:
        raise ValueError("native resource content invalid")
    content = text.encode("utf-8")
    revision = hashlib.sha256(content).hexdigest()
    media_type = output.get("media_type")
    if output.get("content_revision") != revision or media_type not in {"text/plain", "application/json"}:
        raise ValueError("native resource content revision/media invalid")
    return ResourceSnapshot(definition_id, revision, media_type, content,
        {"definition_revision": definition_revision})
