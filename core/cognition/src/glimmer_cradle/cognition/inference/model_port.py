"""Inference external capability ports."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Literal, Protocol

import numpy as np

from glimmer_cradle.cognition.inference.event import InferenceResponse, ModelEvent
from glimmer_cradle.cognition.inference.request import InferenceRequest, ModelRequest


class ModelPort(Protocol):
    def generate(self, request: ModelRequest, provider_key: str | None = None) -> str: ...


class InferenceBackendPort(Protocol):
    async def generate(self, request: InferenceRequest) -> InferenceResponse: ...


class RealtimeModelPort(Protocol):
    def events(self, request: InferenceRequest) -> AsyncIterator[ModelEvent]: ...

    async def cancel(self, session_id: str) -> None: ...


EmbeddingTextType = Literal["query", "document"]


class EmbeddingPort(Protocol):
    @property
    def model_id(self) -> str: ...
    def is_available(self) -> bool: ...
    async def encode(self, texts: list[str], *, text_type: EmbeddingTextType) -> np.ndarray: ...
    async def encode_single(self, text: str, *, text_type: EmbeddingTextType) -> np.ndarray: ...
    def cosine_similarities(self, query: np.ndarray, matrix: np.ndarray) -> np.ndarray: ...
