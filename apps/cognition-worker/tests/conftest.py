import json
from pathlib import Path

import pytest


@pytest.fixture
def worker_config() -> dict[str, int]:
    path = Path(__file__).parent / "fixtures" / "worker-config.json"
    return json.loads(path.read_text(encoding="utf-8"))
