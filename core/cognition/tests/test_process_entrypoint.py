from glimmer_cradle.cognition.host import process


def test_main_returns_failure_for_missing_kernel_injection(monkeypatch) -> None:
    monkeypatch.delenv("GLIMMER_CRADLE_CONFIG", raising=False)
    monkeypatch.setattr(process, "_read_supervisor_bootstrap", lambda: (_ for _ in ()).throw(ValueError("missing")))

    assert process.main([]) == 1


def test_main_returns_failure_for_invalid_config(monkeypatch) -> None:
    monkeypatch.delenv("GLIMMER_CRADLE_CONFIG", raising=False)
    monkeypatch.setattr(process, "_read_supervisor_bootstrap", lambda: {
        "kernelEndpoint": "grpc://127.0.0.1:1",
        "generation": "test-generation",
        "registrationNonce": "nonce",
        "registrationSecret": "AA",
    })

    assert process.main(
        [
            "--config-json",
            "not-json",
        ]
    ) == 1
