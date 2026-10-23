"""In-memory DAP adapter used to exercise the UI without executing user code."""

from __future__ import annotations

import asyncio
from typing import Any

from .dap_framing import DapFrameDecoder, encode_dap_frame
from .demo_data import DEMO_STEPS


class ScriptedDapAdapter:
    """A deterministic DAP adapter. It never starts a process."""

    def __init__(self) -> None:
        self._outgoing: asyncio.Queue[bytes] = asyncio.Queue()
        self._decoder = DapFrameDecoder()
        self._sequence = 0
        self._step = 0
        self._closed = False
        self._thread_id = 1
        self._frame_id = 100
        self._module_frame_id = 101
        self._locals_ref = 2
        self._nums_ref = 3
        self._seen_ref = 4

    async def send(self, data: bytes) -> None:
        if self._closed:
            return
        for message in self._decoder.feed(data):
            self._handle(message)

    async def receive(self, max_bytes: int) -> bytes:
        if self._closed:
            return b""
        chunk = await self._outgoing.get()
        if len(chunk) > max_bytes:
            raise RuntimeError("scripted frame exceeds receive limit")
        return chunk

    async def close(self) -> None:
        self._closed = True
        await self._outgoing.put(b"")

    def _handle(self, message: dict[str, Any]) -> None:
        if message.get("type") != "request":
            return
        command = message.get("command")
        if not isinstance(command, str):
            return
        if command == "initialize":
            self._respond(message, {
                "supportsConfigurationDoneRequest": True,
                "supportsTerminateRequest": True,
                "supportsSetVariable": False,
                "supportsEvaluateForHovers": False,
                "supportsVariablePaging": True,
            })
            self._event("initialized", {})
            return
        if command == "launch":
            self._respond(message, {})
            self._emit_stopped()
            return
        if command == "configurationDone":
            self._respond(message, {})
            return
        if command == "threads":
            self._respond(message, {"threads": [{"id": self._thread_id, "name": "MainThread"}]})
            return
        if command == "stackTrace":
            step = DEMO_STEPS[self._step]
            self._respond(message, {
                "stackFrames": [
                    {
                        "id": self._frame_id,
                        "name": "bubble_sort",
                        "source": {"name": "main.py", "path": "main.py"},
                        "line": step["line"],
                        "column": 1,
                    },
                    {
                        "id": self._module_frame_id,
                        "name": "<module>",
                        "source": {"name": "main.py", "path": "main.py"},
                        "line": 17,
                        "column": 1,
                    },
                ],
                "totalFrames": 2,
            })
            return
        if command == "scopes":
            frame_id = _int_argument(message, "frameId")
            if frame_id == self._frame_id:
                self._respond(message, {
                    "scopes": [{"name": "Locals", "variablesReference": self._locals_ref, "expensive": False}]
                })
            else:
                self._respond(message, {"scopes": []})
            return
        if command == "variables":
            reference = _int_argument(message, "variablesReference")
            self._respond(message, {"variables": self._variables(reference)})
            return
        if command == "setBreakpoints":
            args = message.get("arguments") if isinstance(message.get("arguments"), dict) else {}
            requested = args.get("breakpoints") if isinstance(args.get("breakpoints"), list) else []
            verified = []
            for item in requested:
                if isinstance(item, dict) and isinstance(item.get("line"), int):
                    verified.append({"verified": True, "line": item["line"]})
            self._respond(message, {"breakpoints": verified})
            return
        if command in {"continue", "next", "stepIn", "stepOut"}:
            self._respond(message, {"allThreadsContinued": True})
            self._event("continued", {"threadId": self._thread_id, "allThreadsContinued": True})
            self._step = min(self._step + 1, len(DEMO_STEPS) - 1)
            self._emit_stopped()
            return
        if command == "pause":
            self._respond(message, {})
            self._emit_stopped()
            return
        if command in {"disconnect", "terminate"}:
            self._respond(message, {})
            self._event("terminated", {})
            return
        self._respond(message, success=False, message=f"unsupported command: {command}")

    def _variables(self, reference: int) -> list[dict[str, Any]]:
        step = DEMO_STEPS[self._step]
        if reference == self._locals_ref:
            return [
                {
                    "name": "nums",
                    "value": "[" + ", ".join(str(item) for item in step["nums"]) + "]",
                    "type": "list[int]",
                    "variablesReference": self._nums_ref,
                    "indexedVariables": len(step["nums"]),
                },
                {
                    "name": "seen",
                    "value": "{" + ", ".join(f"{key}: {value}" for key, value in step["seen"].items()) + "}",
                    "type": "dict[int, int]",
                    "variablesReference": self._seen_ref,
                    "namedVariables": len(step["seen"]),
                },
                {"name": "i", "value": str(step["i"]), "type": "int", "variablesReference": 0},
                {"name": "j", "value": str(step["j"]), "type": "int", "variablesReference": 0},
                {"name": "swapped", "value": str(step["swapped"]).lower(), "type": "bool", "variablesReference": 0},
            ]
        if reference == self._nums_ref:
            return [
                {"name": f"[{index}]", "value": str(value), "type": "int", "variablesReference": 0}
                for index, value in enumerate(step["nums"])
            ]
        if reference == self._seen_ref:
            return [
                {"name": str(key), "value": str(value), "type": "int", "variablesReference": 0}
                for key, value in step["seen"].items()
            ]
        return []

    def _emit_stopped(self) -> None:
        step = DEMO_STEPS[self._step]
        self._event("stopped", {
            "reason": "breakpoint",
            "threadId": self._thread_id,
            "allThreadsStopped": True,
            "description": step["label"],
        })

    def _respond(self, request: dict[str, Any], body: dict[str, Any] | None = None, *, success: bool = True, message: str = "") -> None:
        response: dict[str, Any] = {
            "seq": self._next_seq(),
            "type": "response",
            "request_seq": request.get("seq", 0),
            "success": success,
        }
        if success:
            response["body"] = body or {}
        else:
            response["message"] = message
        self._outgoing.put_nowait(encode_dap_frame(response))

    def _event(self, event: str, body: dict[str, Any]) -> None:
        self._outgoing.put_nowait(encode_dap_frame({
            "seq": self._next_seq(),
            "type": "event",
            "event": event,
            "body": body,
        }))

    def _next_seq(self) -> int:
        self._sequence += 1
        return self._sequence


def _int_argument(message: dict[str, Any], name: str) -> int:
    arguments = message.get("arguments")
    if not isinstance(arguments, dict):
        return 0
    value = arguments.get(name)
    return value if isinstance(value, int) and not isinstance(value, bool) else 0