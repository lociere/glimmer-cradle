from pathlib import Path
import re


def test_removed_audio_providers_do_not_return_to_engine_source() -> None:
    source_root = Path(__file__).parents[1] / "src" / "glimmer_cradle" / "audio"
    forbidden = re.compile(
        r"gpt-sovits|windows-sapi|edge-tts|whisper-cpp|experimental_tts",
        re.IGNORECASE,
    )
    offenders = [
        str(path.relative_to(source_root))
        for path in source_root.rglob("*")
        if path.suffix in {".py", ".json"}
        and forbidden.search(path.read_text(encoding="utf-8"))
    ]
    assert offenders == []
