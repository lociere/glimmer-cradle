"""Knowledge invalidation authorization rules."""

AUTHORIZED_MUTATION_SOURCES = frozenset({"config", "system", "editor"})


def require_authorized_source(source: str) -> None:
    if source not in AUTHORIZED_MUTATION_SOURCES:
        raise PermissionError(f"Knowledge source is not authorized to mutate entries: {source}")
