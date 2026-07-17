from io import StringIO
from pathlib import Path
import json
import struct

from glimmer_cradle.audio.asr.funasr_engine import normalize_funasr_result
from glimmer_cradle.audio.main import AudioEngineApp, run_stdio
from glimmer_cradle.audio.protocol import parse_command
from glimmer_cradle.audio.tts import DashScopeCosyVoiceEngine, TTSRoute


class FakeProvider:
    execution = "cloud"

    def __init__(
        self, provider_id: str, *, available: bool = True, failure: str | None = None
    ) -> None:
        self.provider_id = provider_id
        self._available = available
        self.failure = failure
        self.closed = False

    def available(self) -> tuple[bool, str | None]:
        return self._available, None if self._available else "not configured"

    def warmup(self) -> None:
        if self.failure:
            raise RuntimeError(self.failure)

    def config_snapshot(self) -> dict[str, object]:
        return {}

    def synthesize_to_file(self, text: str, output_path: str) -> str:
        if self.failure:
            raise RuntimeError(self.failure)
        Path(output_path).write_bytes(b"RIFF....WAVE")
        return output_path

    def close(self) -> None:
        self.closed = True


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict[str, object]] = []
        self.messages: list[str | bytes] = []

    def send(self, payload: str) -> None:
        import json

        message = json.loads(payload)
        self.sent.append(message)
        action = message["header"]["action"]
        task_id = message["header"]["task_id"]
        if action == "run-task":
            self.messages.append(
                json.dumps({"header": {"event": "task-started", "task_id": task_id}})
            )
        elif action == "finish-task":
            pcm = b"\x00\x00\x10\x00"
            wav = (
                b"RIFF"
                + struct.pack("<I", 0x7FFFFFBF)
                + b"WAVEfmt "
                + struct.pack("<IHHIIHH", 16, 1, 1, 24000, 48000, 2, 16)
                + b"data"
                + struct.pack("<I", 0x7FFFFF9B)
                + pcm
            )
            self.messages.extend(
                [
                    wav[:38],
                    wav[38:],
                    json.dumps(
                        {"header": {"event": "task-finished", "task_id": task_id}}
                    ),
                ]
            )

    def recv(self, timeout: float) -> str | bytes:
        assert timeout > 0
        return self.messages.pop(0)

    def close(self) -> None:
        return None


def test_parse_health_command_from_generated_contract() -> None:
    command = parse_command({"id": "1", "command": "health", "payload": {}})
    assert command.id == "1"
    assert command.command == "health"


def test_stdio_shutdown_acknowledges_then_closes_host() -> None:
    stdin = StringIO(
        "\n".join(
            [
                json.dumps({"id": "health-1", "command": "health", "payload": {}}),
                json.dumps({"id": "stop-1", "command": "host.shutdown", "payload": {}}),
                json.dumps({"id": "ignored", "command": "health", "payload": {}}),
            ]
        )
    )
    stdout = StringIO()

    assert run_stdio(stdin, stdout) == 0

    responses = [json.loads(line) for line in stdout.getvalue().splitlines()]
    assert [response["id"] for response in responses] == ["health-1", "stop-1"]
    assert responses[-1] == {
        "id": "stop-1",
        "status": "success",
        "payload": {"accepted": True, "lane": "all"},
    }


def test_tts_route_falls_back_and_reports_actual_provider(tmp_path: Path) -> None:
    route = TTSRoute(
        primary="cloud",
        fallbacks=["local"],
        provider_factories={
            "cloud": lambda: FakeProvider("cloud", failure="temporary failure"),
            "local": lambda: FakeProvider("local"),
        },
        failure_threshold=1,
        recovery_timeout_ms=30000,
    )
    result = route.synthesize_to_file("你好", str(tmp_path / "out.wav"))
    assert result["provider_id"] == "local"
    assert result["fallback_used"] is True
    snapshot = route.snapshot()
    assert snapshot["route_state"] == "degraded"
    assert snapshot["providers"][0]["status"] == "circuit_open"


def test_dashscope_provider_uses_one_task_id_and_binary_audio(tmp_path: Path) -> None:
    engine = DashScopeCosyVoiceEngine(
        api_key="test-key",
        endpoint="wss://example.test/audio",
        model="cosyvoice-v3.5-flash",
        voice_id="selrena-voice",
        max_retries=0,
        instruction="自然地说话",
    )
    socket = FakeSocket()
    engine._socket = socket
    output = tmp_path / "cloud.wav"
    engine.synthesize_to_file("晚上好", str(output))
    task_ids = {message["header"]["task_id"] for message in socket.sent}
    assert len(task_ids) == 1
    assert [message["header"]["action"] for message in socket.sent] == [
        "run-task",
        "continue-task",
        "finish-task",
    ]
    audio = output.read_bytes()
    assert audio.startswith(b"RIFF")
    assert struct.unpack_from("<I", audio, 4)[0] == len(audio) - 8
    assert struct.unpack_from("<I", audio, 40)[0] == len(audio) - 44


def test_audio_engine_health_exposes_route_without_experimental_providers() -> None:
    app = AudioEngineApp(lane="tts")
    response = app.handle(
        parse_command({"id": "health-1", "command": "health", "payload": {}})
    )
    assert response["status"] == "success"
    tts = response["payload"]["providers"]["tts"]
    assert tts["route_state"] == "unavailable"
    assert [provider["provider_id"] for provider in tts["providers"]] == [
        "dashscope-cosyvoice"
    ]


def test_funasr_result_normalization() -> None:
    result = [{"text": "你好"}, {"sentence_info": [{"text": "，月见"}]}, {"text": "。"}]
    assert normalize_funasr_result(result) == "你好，月见。"
