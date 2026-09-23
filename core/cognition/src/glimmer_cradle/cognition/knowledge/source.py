"""Knowledge source and entry models."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np


@dataclass(slots=True)
class KnowledgeEntry:
    entry_id: str
    content: str
    priority: int = 1
    enabled: bool = True
    revision: int = 1
    source: str = "config"
    attributes: dict[str, Any] = field(default_factory=dict)
    _embedding: np.ndarray | None = field(default=None, repr=False, compare=False)
