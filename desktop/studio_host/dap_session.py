"""Minimal DAP session: request matching, events, and reverse-request denial."""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Awaitable, Callable
from typing import Any

from .dap_framing import DapFrameDecoder, encode_dap_frame
from .ports import AdapterTransport

EventCallback = Callable[[str, dict[str, Any]], Awaitable[None] | None]


class DapSessionError(RuntimeError):
    """DAP request failed, timed out, or the session closed."""


class DapSession:
    def __init__(
        self,
        transport: AdapterTransport,
        *,
        on_event: EventCallback | None = None,
        request_timeout: float = 8.0,
    ) -> None:
        if request_timeout <= 0:
            raise ValueError("request_timeout must be positive")
        self._transport = transport
        self._on_event = on_event
        self._request_timeout = request_timeout
        self._decoder = DapFrameDecoder()
        self._sequence = 0
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._reader: asyncio.Task[None] | None = None
        self._closed = False
        self._event_tasks: set[asyncio.Task[None]] = set()
        self.capabilities: dict[str, Any] = {}

    async def initialize(self, *, client_id: str = "thinking-canvas-studio", adapter_id: str = "scripted") -> dict[str, Any]:
        if self._reader is None:
            self._reader = asyncio.create_task(self._read_loop())
        body = await self.request("initialize", {
            "clientID": client_id,
            "adapterID": adapter_id,
            "linesStartAt1": True,
            "columnsStartAt1": True,
            "pathFormat": "path",
            "supportsVariablePaging": True,
            "supportsRunInTerminalRequest": False,
            "supportsStartDebuggingRequest": False,
            "supportsMemoryReferences": False,
            "supportsInvalidatedEvent": False,
        })
        self.capabilities = dict(body)
        return self.capabilities

    async def launch(self, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        return await self.request("launch", arguments or {})

    async def request(self, command: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        if self._closed:
            raise DapSessionError("session is closed")
        self._sequence += 1
        sequence = self._sequence
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[sequence] = future
        try:
            await self._send({
                "seq": sequence,
                "type": "request",
                "command": command,
                "arguments": arguments or {},
            })
            return await asyncio.wait_for(future, timeout=self._request_timeout)
        except asyncio.TimeoutError as exc:
            raise DapSessionError(f"DAP request timed out: {command}") from exc
        finally:
            self._pending.pop(sequence, None)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._reader is not None:
            self._reader.cancel()
            try:
                await self._reader
            except (asyncio.CancelledError, Exception):
                pass
            self._reader = None
        for task in list(self._event_tasks):
            task.cancel()
        self._event_tasks.clear()
        for future in self._pending.values():
            if not future.done():
                future.set_exception(DapSessionError("session closed"))
        self._pending.clear()
        await self._transport.close()

    async def _send(self, message: dict[str, Any]) -> None:
        await self._transport.send(encode_dap_frame(message))

    async def _read_loop(self) -> None:
        try:
            while not self._closed:
                chunk = await self._transport.receive(self._decoder.max_chunk_bytes)
                if not chunk:
                    break
                for message in self._decoder.feed(chunk):
                    await self._dispatch(message)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._fail_pending(exc)
        finally:
            if not self._closed:
                self._fail_pending(DapSessionError("adapter stream ended"))

    async def _dispatch(self, message: dict[str, Any]) -> None:
        message_type = message.get("type")
        if message_type == "response":
            request_seq = message.get("request_seq")
            if not isinstance(request_seq, int):
                return
            future = self._pending.get(request_seq)
            if future is None or future.done():
                return
            if message.get("success") is True:
                body = message.get("body")
                future.set_result(body if isinstance(body, dict) else {})
            else:
                future.set_exception(DapSessionError(str(message.get("message") or "DAP request failed")))
            return
        if message_type == "event":
            event = message.get("event")
            body = message.get("body")
            if not isinstance(event, str):
                return
            payload = body if isinstance(body, dict) else {}
            if self._on_event is not None:
                task = asyncio.create_task(self._deliver_event(event, payload))
                self._event_tasks.add(task)
                task.add_done_callback(self._event_tasks.discard)
            return
        if message_type == "request":
            # Reverse requests can start processes or sessions. The base refuses them.
            await self._send({
                "seq": self._next_response_seq(),
                "type": "response",
                "request_seq": message.get("seq", 0),
                "success": False,
                "message": "reverse requests are disabled by the host policy",
            })

    async def _deliver_event(self, event: str, body: dict[str, Any]) -> None:
        assert self._on_event is not None
        try:
            result = self._on_event(event, body)
            if inspect.isawaitable(result):
                await result
        except asyncio.CancelledError:
            raise
        except Exception:
            # Event delivery must not poison the protocol reader.
            pass

    def _next_response_seq(self) -> int:
        self._sequence += 1
        return self._sequence

    def _fail_pending(self, error: Exception) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(DapSessionError(str(error)))
        self._pending.clear()