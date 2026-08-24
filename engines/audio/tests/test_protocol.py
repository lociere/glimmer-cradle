from pathlib import Path
import hashlib
import struct
import time

import grpc
import pytest
from glimmer.engine.audio.v1 import audio_engine_pb2 as audio_pb

from glimmer_cradle.audio.asr.funasr_engine import normalize_funasr_result
from glimmer_cradle.audio.grpc_host import AudioGrpcHost
from glimmer_cradle.audio.main import AudioEngineApp
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


class FakeContext:
    def __init__(self, token: str = "test-token") -> None:
        self.token = token

    def invocation_metadata(self):
        return (("x-glimmer-audio-token", self.token),)

    def abort(self, code: grpc.StatusCode, details: str):
        raise RuntimeError(f"{code.name}: {details}")


class FakeAudioApp:
    def health_snapshot(self):
        return {"engine": "audio", "lane": "all", "providers": {}}

    def warmup(self, lane: str):
        return {"provider_id": f"fake-{lane}"}

    def synthesize(self, text: str, output_path: str):
        Path(output_path).write_bytes(b"RIFF....WAVE")
        return {"provider_id": "fake", "fallback_used": False, "duration_ms": 1.5}

    def recognize(self, audio_path: str):
        assert Path(audio_path).read_bytes() == b"audio-input"
        return {"text": "月见", "provider_id": "fake", "duration_ms": 2.5}


def _reference(path: Path, lease_id: str, access: int, *, digest: str = "", size: int = 0):
    return audio_pb.AudioMediaReference(
        lease_id=lease_id,
        uri=path.as_uri(),
        mime_type="audio/wav",
        size_bytes=size,
        sha256=digest,
        expires_at_ms=int(time.time() * 1000) + 30_000,
        access=access,
    )


def test_grpc_host_requires_process_token(tmp_path: Path) -> None:
    host = AudioGrpcHost(FakeAudioApp(), tmp_path, "test-token")
    with pytest.raises(RuntimeError, match="UNAUTHENTICATED"):
        host.health(audio_pb.HealthRequest(), FakeContext("wrong-token"))


def test_grpc_host_exposes_health_and_warmup_control_plane(tmp_path: Path) -> None:
    host = AudioGrpcHost(FakeAudioApp(), tmp_path, "test-token")
    health = host.health(audio_pb.HealthRequest(), FakeContext())
    warmup = host.warmup(
        audio_pb.WarmupRequest(lane=audio_pb.AUDIO_LANE_TTS),
        FakeContext(),
    )
    assert health.snapshot["engine"] == "audio"
    assert warmup.snapshot["provider_id"] == "fake-tts"


def test_grpc_host_completes_write_once_media_reference(tmp_path: Path) -> None:
    lease_id = "lease-output"
    output = tmp_path / lease_id / "output.wav"
    output.parent.mkdir()
    host = AudioGrpcHost(FakeAudioApp(), tmp_path, "test-token")
    response = host.synthesize(
        audio_pb.SynthesizeRequest(
            text="你好",
            output=_reference(output, lease_id, audio_pb.MEDIA_ACCESS_WRITE_ONCE),
        ),
        FakeContext(),
    )
    assert not response.HasField("failure")
    assert response.output.size_bytes == len(b"RIFF....WAVE")
    assert response.output.sha256 == hashlib.sha256(b"RIFF....WAVE").hexdigest()


def test_grpc_host_validates_read_only_digest_and_lease_boundary(tmp_path: Path) -> None:
    lease_id = "lease-input"
    input_path = tmp_path / lease_id / "input.wav"
    input_path.parent.mkdir()
    input_path.write_bytes(b"audio-input")
    host = AudioGrpcHost(FakeAudioApp(), tmp_path, "test-token")
    digest = hashlib.sha256(b"audio-input").hexdigest()
    response = host.recognize(
        audio_pb.RecognizeRequest(
            input=_reference(input_path, lease_id, audio_pb.MEDIA_ACCESS_READ_ONLY, digest=digest, size=len(b"audio-input")),
        ),
        FakeContext(),
    )
    assert response.text == "月见"
    tampered = host.recognize(
        audio_pb.RecognizeRequest(
            input=_reference(input_path, lease_id, audio_pb.MEDIA_ACCESS_READ_ONLY, digest="0" * 64, size=len(b"audio-input")),
        ),
        FakeContext(),
    )
    assert tampered.failure.code == "asr_failed"


def test_grpc_host_rejects_expired_media_reference(tmp_path: Path) -> None:
    lease_id = "expired"
    output = tmp_path / lease_id / "output.wav"
    output.parent.mkdir()
    reference = _reference(output, lease_id, audio_pb.MEDIA_ACCESS_WRITE_ONCE)
    reference.expires_at_ms = int(time.time() * 1000) - 1
    host = AudioGrpcHost(FakeAudioApp(), tmp_path, "test-token")
    response = host.synthesize(audio_pb.SynthesizeRequest(text="你好", output=reference), FakeContext())
    assert response.failure.code == "tts_route_failed"


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
    response = app.health_snapshot()
    tts = response["providers"]["tts"]
    assert tts["route_state"] == "unavailable"
    assert [provider["provider_id"] for provider in tts["providers"]] == [
        "dashscope-cosyvoice"
    ]


def test_funasr_result_normalization() -> None:
    result = [{"text": "你好"}, {"sentence_info": [{"text": "，月见"}]}, {"text": "。"}]
    assert normalize_funasr_result(result) == "你好，月见。"
