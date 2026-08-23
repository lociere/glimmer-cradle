"""Kernel–Cognition v1 Service Adapter。"""

from .grpc_transport import CognitionGrpcHost, KernelGrpcClient
from .inbound_adapter import KernelEventInboundAdapter
from .outbound_adapter import KernelEventOutboundAdapter

__all__ = [
    "CognitionGrpcHost",
    "KernelEventInboundAdapter",
    "KernelEventOutboundAdapter",
    "KernelGrpcClient",
]
