from glimmer_cradle.cognition.host.process import main


def test_main_returns_failure_for_missing_kernel_injection(monkeypatch) -> None:
    monkeypatch.delenv("GLIMMER_CRADLE_CONFIG", raising=False)
    monkeypatch.delenv("GLIMMER_CRADLE_KERNEL_GRPC_ENDPOINT", raising=False)
    monkeypatch.delenv("GLIMMER_CRADLE_COGNITION_GENERATION", raising=False)

    assert main([]) == 1


def test_main_returns_failure_for_invalid_config(monkeypatch) -> None:
    monkeypatch.delenv("GLIMMER_CRADLE_CONFIG", raising=False)
    monkeypatch.delenv("GLIMMER_CRADLE_KERNEL_GRPC_ENDPOINT", raising=False)
    monkeypatch.delenv("GLIMMER_CRADLE_COGNITION_GENERATION", raising=False)

    assert main(
        [
            "--config-json",
            "not-json",
            "--kernel-endpoint",
            "grpc://127.0.0.1:1",
            "--generation",
            "test-generation",
        ]
    ) == 1
