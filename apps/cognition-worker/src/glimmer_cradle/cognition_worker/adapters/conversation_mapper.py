"""Conversation Moment wire mapper; no persistence ownership lives here."""

from __future__ import annotations

from dataclasses import asdict

from glimmer_cradle.conversation import Moment


def moment_to_wire(moment: Moment) -> dict[str, object]:
    value = asdict(moment)
    value["seq"] = int(moment.seq)
    value["causation_ids"] = list(moment.causation_ids)
    return value
