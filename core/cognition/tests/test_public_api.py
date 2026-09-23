import glimmer_cradle.cognition as cognition
from glimmer_cradle.cognition import ports


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


def test_consumer_owned_ports_are_explicit() -> None:
    assert ports.__all__ == [
        "CapabilityDescriptor",
        "CapabilityInvocation",
        "CapabilityPort",
        "CapabilityResult",
        "CapabilityResultStatus",
        "ClockPort",
        "ContentPort",
        "ContentReference",
        "ConversationPort",
        "JobPort",
        "JobReceipt",
        "JobRequest",
        "JobRequestStatus",
        "ResourcePort",
        "ResourceSnapshot",
    ]
