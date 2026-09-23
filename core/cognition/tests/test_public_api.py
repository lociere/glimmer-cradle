import glimmer_cradle.cognition as cognition


def test_public_api_is_explicit_and_exposes_native_loop_contracts() -> None:
    assert cognition.__all__ == [
        "CapabilityDescriptor",
        "CapabilityInvocation",
        "CapabilityPort",
        "CapabilityResult",
        "LoopController",
        "LoopRun",
        "StopPolicy",
    ]
    assert cognition.LoopController.__module__.endswith("loop.loop_controller")
