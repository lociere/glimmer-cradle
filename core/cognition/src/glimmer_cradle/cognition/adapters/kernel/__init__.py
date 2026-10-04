"""Kernel–Cognition v1 Service Adapter。"""

from .grpc_transport import CognitionGrpcHost, KernelGrpcClient

__all__ = [
    "CognitionGrpcHost",
    "KernelGrpcClient",
]
