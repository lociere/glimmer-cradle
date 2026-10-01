import glimmer_cradle.cognition_worker as worker


def test_worker_public_api_is_explicit(worker_config: dict[str, int]) -> None:
    assert worker.__all__ == [
        "CognitionComponents",
        "CognitionHost",
        "ReadinessTracker",
        "ShutdownCoordinator",
        "compose_cognition",
        "main",
    ]
    assert worker_config["readiness_timeout_ms"] >= 1000
