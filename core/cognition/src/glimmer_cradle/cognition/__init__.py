"""Glimmer Cradle Cognition public API."""

from glimmer_cradle.cognition.loop import LoopController, LoopRun, StopPolicy
from glimmer_cradle.cognition.ports import (
    CapabilityDescriptor,
    CapabilityInvocation,
    CapabilityPort,
    CapabilityResult,
)

__version__ = "1.0.0"
__author__ = "Glimmer Cradle Team"

__all__ = [
    "CapabilityDescriptor",
    "CapabilityInvocation",
    "CapabilityPort",
    "CapabilityResult",
    "LoopController",
    "LoopRun",
    "StopPolicy",
]
