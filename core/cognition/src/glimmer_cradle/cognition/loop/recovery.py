"""Pure recovery policy for interrupted cognition loop runs."""

from glimmer_cradle.cognition.loop.checkpoint import LoopCheckpoint


def recover_checkpoint(checkpoint: LoopCheckpoint) -> LoopCheckpoint:
    if checkpoint.status != "running":
        return checkpoint
    return LoopCheckpoint(
        checkpoint_key=checkpoint.checkpoint_key,
        cycle_count=checkpoint.cycle_count,
        status="interrupted",
        revision=checkpoint.revision,
        updated_at=checkpoint.updated_at,
    )
