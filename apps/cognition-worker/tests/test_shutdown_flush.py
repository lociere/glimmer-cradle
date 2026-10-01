from glimmer_cradle.cognition_worker.shutdown import ShutdownCoordinator


async def test_shutdown_runs_every_step_once_and_reports_failures() -> None:
    calls: list[str] = []

    async def first() -> None:
        calls.append("first")
        raise RuntimeError("flush failed")

    async def second() -> None:
        calls.append("second")

    coordinator = ShutdownCoordinator(("flush", first), ("close", second))
    failures = await coordinator.run()
    repeated = await coordinator.run()

    assert calls == ["first", "second"]
    assert failures == repeated
    assert failures[0][0] == "flush"
