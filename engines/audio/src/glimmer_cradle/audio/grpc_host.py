from __future__ import annotations

import hashlib
import os
import sys
import threading
import time
from concurrent import futures
from pathlib import Path
from urllib.parse import unquote, urlparse

import grpc
from google.protobuf import struct_pb2
from glimmer.engine.audio.v1 import audio_engine_pb2 as audio_pb

from .main import AudioEngineApp

SERVICE = "glimmer.engine.audio.v1.AudioEngineService"
AUTH_HEADER = "x-glimmer-audio-token"


class AudioGrpcHost:
    def __init__(self, app: AudioEngineApp, media_root: Path, token: str) -> None:
        self.app = app
        self.media_root = media_root.resolve()
        self.token = token
        self.shutdown_requested = threading.Event()

    def health(self, request: audio_pb.HealthRequest, context: grpc.ServicerContext):
        if not self._authorize(context):
            return audio_pb.HealthResponse()
        try:
            return audio_pb.HealthResponse(snapshot=_struct(self.app.health_snapshot()))
        except Exception as exc:
            return audio_pb.HealthResponse(failure=_failure("health_failed", exc))

    def warmup(self, request: audio_pb.WarmupRequest, context: grpc.ServicerContext):
        if not self._authorize(context):
            return audio_pb.WarmupResponse()
        lane = {audio_pb.AUDIO_LANE_TTS: "tts", audio_pb.AUDIO_LANE_ASR: "asr"}.get(request.lane)
        if lane is None:
            return audio_pb.WarmupResponse(failure=_failure("invalid_request", "lane is required"))
        try:
            return audio_pb.WarmupResponse(snapshot=_struct(self.app.warmup(lane)))
        except Exception as exc:
            return audio_pb.WarmupResponse(failure=_failure(f"{lane}_warmup_failed", exc))

    def synthesize(self, request: audio_pb.SynthesizeRequest, context: grpc.ServicerContext):
        if not self._authorize(context):
            return audio_pb.SynthesizeResponse()
        try:
            output_path = self._resolve_media(request.output, audio_pb.MEDIA_ACCESS_WRITE_ONCE)
            result = self.app.synthesize(request.text, str(output_path))
            completed = self._complete_reference(request.output, output_path)
            return audio_pb.SynthesizeResponse(
                output=completed,
                provider_id=str(result["provider_id"]),
                fallback_used=bool(result.get("fallback_used", False)),
                duration_ms=float(result.get("duration_ms", 0)),
            )
        except Exception as exc:
            return audio_pb.SynthesizeResponse(failure=_failure("tts_route_failed", exc))

    def recognize(self, request: audio_pb.RecognizeRequest, context: grpc.ServicerContext):
        if not self._authorize(context):
            return audio_pb.RecognizeResponse()
        try:
            input_path = self._resolve_media(request.input, audio_pb.MEDIA_ACCESS_READ_ONLY)
            self._verify_content(request.input, input_path)
            result = self.app.recognize(str(input_path))
            return audio_pb.RecognizeResponse(
                text=str(result["text"]),
                provider_id=str(result["provider_id"]),
                duration_ms=float(result.get("duration_ms", 0)),
            )
        except Exception as exc:
            return audio_pb.RecognizeResponse(failure=_failure("asr_failed", exc))

    def shutdown(self, request: audio_pb.ShutdownRequest, context: grpc.ServicerContext):
        if not self._authorize(context):
            return audio_pb.ShutdownResponse()
        self.shutdown_requested.set()
        return audio_pb.ShutdownResponse(accepted=True)

    def _authorize(self, context: grpc.ServicerContext) -> bool:
        metadata = dict(context.invocation_metadata())
        if metadata.get(AUTH_HEADER) == self.token:
            return True
        context.abort(grpc.StatusCode.UNAUTHENTICATED, "audio host authentication failed")
        return False

    def _resolve_media(self, reference: audio_pb.AudioMediaReference, expected_access: int) -> Path:
        if not reference.lease_id or reference.access != expected_access:
            raise ValueError("media lease id/access is invalid")
        if reference.expires_at_ms <= int(time.time() * 1000):
            raise ValueError("media lease has expired")
        parsed = urlparse(reference.uri)
        if parsed.scheme != "file" or parsed.netloc not in ("", "localhost"):
            raise ValueError("media reference must use a local file URI")
        raw_path = unquote(parsed.path)
        if os.name == "nt" and raw_path.startswith("/"):
            raw_path = raw_path[1:]
        candidate = Path(raw_path).resolve()
        relative = candidate.relative_to(self.media_root)
        if not relative.parts or relative.parts[0] != reference.lease_id:
            raise ValueError("media reference escapes its lease")
        if expected_access == audio_pb.MEDIA_ACCESS_WRITE_ONCE and candidate.exists():
            raise ValueError("write-once media target already exists")
        if expected_access == audio_pb.MEDIA_ACCESS_READ_ONLY and not candidate.is_file():
            raise ValueError("read-only media target does not exist")
        return candidate

    def _verify_content(self, reference: audio_pb.AudioMediaReference, path: Path) -> None:
        size = path.stat().st_size
        digest = _sha256(path)
        if size != reference.size_bytes or digest != reference.sha256:
            raise ValueError("media reference digest or size mismatch")

    def _complete_reference(self, source: audio_pb.AudioMediaReference, path: Path):
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError("audio provider did not produce media")
        return audio_pb.AudioMediaReference(
            lease_id=source.lease_id,
            uri=source.uri,
            mime_type=source.mime_type,
            size_bytes=path.stat().st_size,
            sha256=_sha256(path),
            expires_at_ms=source.expires_at_ms,
            access=source.access,
        )


def run_grpc_host() -> int:
    token = os.environ.get("GLIMMER_CRADLE_AUDIO_TOKEN", "")
    media_root = os.environ.get("GLIMMER_CRADLE_AUDIO_MEDIA_ROOT", "")
    if not token or not media_root:
        raise RuntimeError("audio gRPC host requires token and media root")
    app = AudioEngineApp()
    host = AudioGrpcHost(app, Path(media_root), token)
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    handlers = {
        "Health": grpc.unary_unary_rpc_method_handler(host.health, request_deserializer=audio_pb.HealthRequest.FromString, response_serializer=audio_pb.HealthResponse.SerializeToString),
        "Warmup": grpc.unary_unary_rpc_method_handler(host.warmup, request_deserializer=audio_pb.WarmupRequest.FromString, response_serializer=audio_pb.WarmupResponse.SerializeToString),
        "Synthesize": grpc.unary_unary_rpc_method_handler(host.synthesize, request_deserializer=audio_pb.SynthesizeRequest.FromString, response_serializer=audio_pb.SynthesizeResponse.SerializeToString),
        "Recognize": grpc.unary_unary_rpc_method_handler(host.recognize, request_deserializer=audio_pb.RecognizeRequest.FromString, response_serializer=audio_pb.RecognizeResponse.SerializeToString),
        "Shutdown": grpc.unary_unary_rpc_method_handler(host.shutdown, request_deserializer=audio_pb.ShutdownRequest.FromString, response_serializer=audio_pb.ShutdownResponse.SerializeToString),
    }
    server.add_generic_rpc_handlers((grpc.method_handlers_generic_handler(SERVICE, handlers),))
    port = server.add_insecure_port("127.0.0.1:0")
    if port == 0:
        raise RuntimeError("audio gRPC host failed to bind loopback endpoint")
    server.start()
    sys.stdout.write(f"GLIMMER_AUDIO_ENDPOINT=127.0.0.1:{port}\n")
    sys.stdout.flush()
    host.shutdown_requested.wait()
    server.stop(grace=1).wait()
    app.close()
    return 0


def _struct(value: dict[str, object]) -> struct_pb2.Struct:
    message = struct_pb2.Struct()
    message.update(value)
    return message


def _failure(code: str, error: object) -> audio_pb.AudioEngineFailure:
    return audio_pb.AudioEngineFailure(code=code, safe_message=str(error), retryable=False)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
