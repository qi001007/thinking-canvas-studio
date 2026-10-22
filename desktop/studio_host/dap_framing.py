"""Incremental DAP Content-Length framing; no transport or process is started."""

from __future__ import annotations

import json
import math


class DapFrameError(ValueError):
    """Malformed or oversized DAP frame. A decoder stays failed after this error."""


class DapFrameDecoder:
    """Each feed chunk is capped; callers should request at most this from receive()."""

    def __init__(
        self,
        *,
        max_header_bytes: int = 8192,
        max_body_bytes: int = 8 * 1024 * 1024,
        max_chunk_bytes: int = 64 * 1024,
    ):
        limits = (max_header_bytes, max_body_bytes, max_chunk_bytes)
        if any(not isinstance(limit, int) or isinstance(limit, bool) or limit <= 0 for limit in limits):
            raise ValueError("frame limits must be positive")
        self._max_header_bytes = max_header_bytes
        self._max_body_bytes = max_body_bytes
        self.max_chunk_bytes = max_chunk_bytes
        self._buffer = bytearray()
        self._failed = False

    def feed(self, data: bytes) -> list[dict[str, object]]:
        if self._failed:
            raise DapFrameError("decoder is failed; create a new decoder")
        if not isinstance(data, bytes):
            raise TypeError("DAP input must be bytes")
        if len(data) > self.max_chunk_bytes:
            self._failed = True
            self._buffer.clear()
            raise DapFrameError("input chunk exceeds configured receive-chunk limit")
        self._buffer.extend(data)
        frames: list[dict[str, object]] = []
        try:
            while True:
                boundary = self._buffer.find(b"\r\n\r\n")
                if boundary < 0:
                    if len(self._buffer) > self._max_header_bytes:
                        raise DapFrameError("header exceeds configured limit")
                    break
                if boundary > self._max_header_bytes:
                    raise DapFrameError("header exceeds configured limit")
                header = bytes(self._buffer[:boundary])
                length = _parse_content_length(header, self._max_body_bytes)
                if length > self._max_body_bytes:
                    raise DapFrameError("body exceeds configured limit")
                body_start = boundary + 4
                frame_end = body_start + length
                if len(self._buffer) < frame_end:
                    break
                raw_body = bytes(self._buffer[body_start:frame_end])
                del self._buffer[:frame_end]
                try:
                    message = json.loads(
                        raw_body.decode("utf-8", errors="strict"),
                        parse_constant=_reject_constant,
                        parse_float=_finite_float,
                        object_pairs_hook=_unique_object,
                    )
                except DapFrameError:
                    raise
                except (UnicodeDecodeError, ValueError, RecursionError) as exc:
                    raise DapFrameError(f"invalid UTF-8 JSON body: {exc}") from exc
                if not isinstance(message, dict):
                    raise DapFrameError("DAP JSON body must be an object")
                frames.append(message)
        except DapFrameError:
            self._failed = True
            self._buffer.clear()
            raise
        return frames


def encode_dap_frame(message: dict[str, object], *, max_body_bytes: int = 8 * 1024 * 1024) -> bytes:
    if not isinstance(message, dict):
        raise TypeError("DAP message must be an object")
    if not isinstance(max_body_bytes, int) or isinstance(max_body_bytes, bool) or max_body_bytes <= 0:
        raise ValueError("max_body_bytes must be a positive integer")
    try:
        body = json.dumps(
            message, ensure_ascii=False, separators=(",", ":"), allow_nan=False
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise DapFrameError(f"DAP message is not valid JSON: {exc}") from exc
    if len(body) > max_body_bytes:
        raise DapFrameError("body exceeds configured limit")
    return b"Content-Length: " + str(len(body)).encode("ascii") + b"\r\n\r\n" + body


def _parse_content_length(header: bytes, max_body_bytes: int) -> int:
    try:
        lines = header.decode("ascii", errors="strict").split("\r\n")
    except UnicodeDecodeError as exc:
        raise DapFrameError("header must be ASCII") from exc
    lengths: list[str] = []
    for line in lines:
        if not line or ":" not in line:
            raise DapFrameError("malformed DAP header line")
        name, value = line.split(":", 1)
        if not name or any(ch.isspace() for ch in name):
            raise DapFrameError("malformed DAP header name")
        if name.lower() == "content-length":
            lengths.append(value.strip())
    if len(lengths) != 1 or not lengths[0] or any(ch not in "0123456789" for ch in lengths[0]):
        raise DapFrameError("exactly one non-negative Content-Length is required")
    digits = lengths[0].lstrip("0") or "0"
    limit = str(max_body_bytes)
    if len(digits) > len(limit) or (len(digits) == len(limit) and digits > limit):
        raise DapFrameError("body exceeds configured limit")
    return int(digits, 10)


def _reject_constant(value: str) -> object:
    raise DapFrameError(f"non-standard JSON constant: {value}")


def _finite_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise DapFrameError("JSON numbers must be finite")
    return parsed


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise DapFrameError(f"duplicate JSON key: {key}")
        result[key] = value
    return result
