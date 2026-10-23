"""Normalized debug events over the DAP session for the local demo."""

from __future__ import annotations

import asyncio
import inspect
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from .dap_session import DapSession, DapSessionError
from .scripted_adapter import ScriptedDapAdapter

EventSink = Callable[[dict[str, Any]], Awaitable[None] | None]
ConsoleSink = Callable[[dict[str, Any]], Awaitable[None] | None]

MAX_VALUES = 500
MAX_DEPTH = 3
MAX_FRAMES = 8

CAPABILITIES = {
    "stackTrace": True,
    "scopes": True,
    "variables": True,
    "evaluate": False,
    "setVariable": False,
    "readMemory": False,
}


class DemoDebugService:
    """Runs a scripted DAP adapter; it never starts a process or evaluates user code."""

    def __init__(self, on_event: EventSink, on_console: ConsoleSink) -> None:
        self._on_event = on_event
        self._on_console = on_console
        self._session: DapSession | None = None
        self._session_id = ""
        self._run_id = ""
        self._thread_id = "1"
        self._epoch = 0
        self._paused = False
        self._running = False
        self._stop_count = 0
        self._last_frames: list[dict[str, Any]] = []
        self._visited_values = 0
        self._missing: set[str] = set()
        self._lock: asyncio.Lock | None = None

    async def start(self) -> dict[str, Any]:
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            if self._running:
                return self._result()
            self._session_id = f"demo-session-{uuid.uuid4().hex[:8]}"
            self._run_id = f"demo-run-{uuid.uuid4().hex[:8]}"
            self._epoch = 0
            self._paused = False
            self._running = True
            self._stop_count = 0
            self._last_frames = []
            self._visited_values = 0
            self._missing.clear()
            adapter = ScriptedDapAdapter()
            self._session = DapSession(adapter, on_event=self._on_dap_event)
            await self._session.initialize(client_id="thinking-canvas-studio", adapter_id="scripted")
            await self._emit({
                "type": "runStarted",
                "runId": self._run_id,
                "sessionId": self._session_id,
                "capabilities": CAPABILITIES,
            })
            await self._emit({
                "type": "threadAdded",
                "runId": self._run_id,
                "sessionId": self._session_id,
                "threadId": self._thread_id,
                "name": "MainThread",
            })
            await self._console("已载入脚本化 DAP 演示会话；没有执行用户代码。")
            await self._session.launch({})
            return self._result()

    async def stop(self) -> None:
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            session = self._session
            self._session = None
            self._running = False
            self._paused = False
            if session is not None:
                try:
                    await session.request("disconnect", {"terminateDebuggee": True})
                except DapSessionError:
                    pass
                await session.close()
            if self._run_id:
                await self._emit({"type": "runEnded", "runId": self._run_id, "sessionId": self._session_id})
            await self._console("演示会话已结束。")

    async def continue_(self) -> None:
        await self._advance("continue")

    async def step(self, kind: str) -> None:
        command = {"over": "next", "into": "stepIn", "out": "stepOut"}.get(kind)
        if command is None:
            raise DapSessionError(f"unknown step kind: {kind}")
        await self._advance(command)

    async def pause(self) -> None:
        if self._session is None or not self._running:
            return
        await self._session.request("pause", {"threadId": 1})

    async def get_stack_frames(self) -> list[dict[str, Any]]:
        return self._last_frames

    async def get_scopes(self, frame: dict[str, Any]) -> list[dict[str, Any]]:
        reference = frame.get("reference") if isinstance(frame, dict) else None
        for item in self._last_frames:
            if item.get("handle", {}).get("reference") == reference:
                return item.get("scopes", [])
        return []

    async def get_variables(self, container: dict[str, Any]) -> list[dict[str, Any]]:
        reference = container.get("reference") if isinstance(container, dict) else None
        for value in _walk_values(self._last_frames):
            if value.get("handle", {}).get("reference") == reference:
                return value.get("children", [])
        return []

    async def _advance(self, command: str) -> None:
        session = self._session
        if session is None or not self._running or not self._paused:
            return
        self._paused = False
        self._epoch += 1
        await self._emit({
            "type": "threadResumed",
            "runId": self._run_id,
            "sessionId": self._session_id,
            "threadId": self._thread_id,
            "allThreadsContinued": True,
        })
        await session.request(command, {"threadId": 1})

    async def _on_dap_event(self, event: str, body: dict[str, Any]) -> None:
        if event == "initialized":
            if self._session is not None:
                try:
                    await self._session.request("configurationDone", {})
                except DapSessionError:
                    pass
            return
        if event == "stopped":
            if not self._running:
                return
            self._paused = True
            self._epoch += 1
            self._stop_count += 1
            label = str(body.get("description") or f"停点 {self._stop_count}")
            await self._emit({
                "type": "threadStopped",
                "runId": self._run_id,
                "sessionId": self._session_id,
                "threadId": self._thread_id,
                "allThreadsStopped": True,
            })
            await self._capture(label)
            return
        if event == "terminated":
            if self._running:
                self._running = False
                self._paused = False
                await self._emit({"type": "runEnded", "runId": self._run_id, "sessionId": self._session_id})
            return
        if event == "output":
            text = body.get("output")
            if isinstance(text, str):
                await self._console(text.rstrip(), "stdout")
            return

    async def _capture(self, label: str) -> None:
        session = self._session
        if session is None:
            return
        self._visited_values = 0
        self._missing.clear()
        try:
            threads = await session.request("threads")
            thread_items = threads.get("threads", [])
            thread_id = thread_items[0]["id"] if thread_items else 1
            stack = await session.request("stackTrace", {"threadId": thread_id, "startFrame": 0, "levels": 20})
            frames: list[dict[str, Any]] = []
            for index, frame in enumerate(stack.get("stackFrames", [])[:MAX_FRAMES]):
                frame_id = int(frame.get("id", 0))
                scopes_body = await session.request("scopes", {"frameId": frame_id})
                scopes: list[dict[str, Any]] = []
                for scope in scopes_body.get("scopes", []):
                    scope_ref = int(scope.get("variablesReference", 0))
                    values = await self._read_variables(scope_ref, depth=0, path=f"frame{index}.scope{scope_ref}")
                    scopes.append({
                        "id": f"scope-{scope_ref}",
                        "name": str(scope.get("name", "Scope")),
                        "expensive": bool(scope.get("expensive", False)),
                        "handle": _handle(self._session_id, self._run_id, self._epoch, self._thread_id, "scope", scope_ref),
                        "values": values,
                    })
                source = frame.get("source") if isinstance(frame.get("source"), dict) else {}
                frames.append({
                    "id": str(frame_id),
                    "name": str(frame.get("name", "frame")),
                    "source": str(source.get("path") or source.get("name") or ""),
                    "line": frame.get("line") if isinstance(frame.get("line"), int) else None,
                    "column": frame.get("column") if isinstance(frame.get("column"), int) else None,
                    "handle": _handle(self._session_id, self._run_id, self._epoch, self._thread_id, "frame", frame_id),
                    "scopes": scopes,
                })
            self._last_frames = frames
            await self._emit({
                "type": "framesLoaded",
                "runId": self._run_id,
                "sessionId": self._session_id,
                "threadId": self._thread_id,
                "stopEpoch": self._epoch,
                "frames": frames,
                "label": label,
            })
            line = frames[0].get("line") if frames else "—"
            await self._console(f"停点 {self._stop_count}: {label} · main.py:{line}", "stdout")
        except DapSessionError as exc:
            await self._console(f"采集失败：{exc}", "error")
            self._last_frames = []
            await self._emit({
                "type": "framesLoaded",
                "runId": self._run_id,
                "sessionId": self._session_id,
                "threadId": self._thread_id,
                "stopEpoch": self._epoch,
                "frames": [],
                "label": label,
            })

    async def _read_variables(self, reference: int, *, depth: int, path: str) -> list[dict[str, Any]]:
        session = self._session
        if session is None or reference <= 0 or depth > MAX_DEPTH or self._visited_values >= MAX_VALUES:
            if reference > 0:
                self._missing.add("Variable budget or depth limit reached.")
            return []
        body = await session.request("variables", {
            "variablesReference": reference,
            "start": 0,
            "count": 100,
        })
        values: list[dict[str, Any]] = []
        for index, variable in enumerate(body.get("variables", [])):
            if not isinstance(variable, dict) or self._visited_values >= MAX_VALUES:
                self._missing.add("Variable budget reached.")
                break
            self._visited_values += 1
            name = str(variable.get("name", f"value{index}"))
            type_name = variable.get("type") if isinstance(variable.get("type"), str) else None
            child_reference = variable.get("variablesReference")
            child_reference = child_reference if isinstance(child_reference, int) and not isinstance(child_reference, bool) else 0
            structure, container_kind = _classify(type_name, child_reference)
            children = await self._read_variables(
                child_reference,
                depth=depth + 1,
                path=f"{path}.{index}",
            ) if child_reference > 0 else []
            values.append({
                "id": f"value-{path}-{index}",
                "name": name,
                "value": str(variable.get("value", "")),
                "type": type_name,
                "handle": _handle(self._session_id, self._run_id, self._epoch, self._thread_id, "variable", child_reference) if child_reference > 0 else None,
                "structure": structure,
                "containerKind": container_kind,
                "children": children,
            })
        return values

    async def _emit(self, event: dict[str, Any]) -> None:
        result = self._on_event(event)
        if inspect.isawaitable(result):
            await result

    async def _console(self, text: str, kind: str = "info") -> None:
        result = self._on_console({
            "id": f"console-{uuid.uuid4().hex[:8]}",
            "kind": kind,
            "text": text,
        })
        if inspect.isawaitable(result):
            await result

    def _result(self) -> dict[str, Any]:
        return {
            "sessionId": self._session_id,
            "runId": self._run_id,
            "threadId": self._thread_id,
            "capabilities": CAPABILITIES,
            "scripted": True,
        }


def _handle(session_id: str, run_id: str, epoch: int, thread_id: str, kind: str, reference: int) -> dict[str, Any]:
    return {
        "sessionId": session_id,
        "runId": run_id,
        "stopEpoch": epoch,
        "threadId": thread_id,
        "kind": kind,
        "reference": reference,
    }


def _classify(type_name: str | None, variables_reference: int) -> tuple[str | None, str | None]:
    if variables_reference <= 0:
        return None, None
    lowered = (type_name or "").lower()
    if "dict" in lowered or "map" in lowered or "hashmap" in lowered:
        return "container", "dict"
    if "set" in lowered:
        return "container", "set"
    if "tuple" in lowered:
        return "container", "tuple"
    if "array" in lowered or "ndarray" in lowered:
        return "container", "array"
    if "list" in lowered or "vector" in lowered or "deque" in lowered:
        return "container", "list"
    if "tensor" in lowered:
        return "tensor", "tensor"
    return "struct", None


def _walk_values(frames: list[dict[str, Any]]):
    def visit(value: dict[str, Any]):
        yield value
        for child in value.get("children", []):
            if isinstance(child, dict):
                yield from visit(child)
    for frame in frames:
        for scope in frame.get("scopes", []):
            for value in scope.get("values", []):
                yield from visit(value)