"""Kernel–Cognition v1 Service Adapter。"""

from .grpc_transport import CognitionGrpcHost, KernelGrpcClient
from .inbound_adapter import KernelEventInboundAdapter

__all__ = [
    "CognitionGrpcHost",
    "KernelEventInboundAdapter",
    "KernelGrpcClient",
]
