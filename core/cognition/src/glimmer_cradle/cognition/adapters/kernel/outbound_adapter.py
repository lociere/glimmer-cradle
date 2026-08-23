"""把 Cognition 出站事件映射为 KernelControlService 调用。"""

from __future__ import annotations

from glimmer_cradle.cognition.adapters.kernel.grpc_transport import KernelGrpcClient
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.ports.kernel.outbound.kernel_event_port import KernelEventPort

logger = get_logger("kernel_service_outbound_adapter")


class KernelEventOutboundAdapter(KernelEventPort):
    def __init__(self, client: KernelGrpcClient) -> None:
        self._client = client

    async def send_state_sync(self, state: dict) -> None:
        await self._client.publish_state(state)

    async def send_log(self, level: str, message: str, extra: dict | None = None) -> None:
        await self._client.publish_log(level, message, extra or {})

    async def send_action_command(self, command: dict) -> None:
        logger.debug("发送 ActionCommand 给 Kernel", action_type=command.get("action_type"))
        await self._client.publish_action(command)
