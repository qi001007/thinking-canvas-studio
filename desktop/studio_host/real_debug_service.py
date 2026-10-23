"""Real debugpy service: DAP attach, breakpoints, normalized snapshots."""

from __future__ import annotations

import asyncio
import inspect
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from .dap_session import DapSession, DapSessionError
from .ports import AdapterTransport
from .windows_supervisor import WindowsJobObjectSupervisor

EventSink = Callable[[dict[str, Any]], Awaitable[None] | None]
ConsoleSink = Callable[[dict[str, Any]], Awaitable[None] | None]

MAX_VALUES = 500
MAX_DEPTH = 3
MAX_FRAMES = 6
VARIABLE_PAGE_SIZE = 100
SPECIAL_VARIABLES = frozenset({"special variables", "function variables", "len()", "MoreItemsRange"})


class RealDebugError(RuntimeError):
    """The real adapter could not complete startup or capture."""


class RealDebugService:
    def __init__(self, supervisor: WindowsJobObjectSupervisor, on_event: EventSink, on_console: ConsoleSink) -> None:
        self._supervisor = supervisor
        self._on_event = on_event
        self._on_console = on_console
        self._session: DapSession | None = None
        self._transport: AdapterTransport | None = None
        self._session_id = ""
        self._run_id = ""
        self._thread_id = "1"
        self._thread_added = False
        self._epoch = 0
        self._running = False
        self._paused = False
        self._stop_count = 0
        self._last_frames: list[dict[str, Any]] = []
        self._value_frames: dict[int, int] = {}
        self._visited_values = 0
        self._missing: set[str] = set()
        self._initialized = asyncio.Event()
        self._lock: asyncio.Lock | None = None
        self._capabilities: dict[str, Any] = {}
        self._record_mode = False
        self._max_frames = 500
        self._allow_evaluate = False

    @property
    def running(self) -> bool:
        return self._running

    async def start(
        self,
        transport: AdapterTransport,
        *,
        program: str,
        breakpoints: list[int],
        auto_record: bool = False,
        trace_lines: list[int] | None = None,
        max_frames: int = 500,
        allow_evaluate: bool = False,
    ) -> dict[str, Any]:
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            if self._running:
                raise RealDebugError("a real debug session is already running")
            self._session_id = f"py-session-{uuid.uuid4().hex[:8]}"
            self._run_id = f"py-run-{uuid.uuid4().hex[:8]}"
            self._transport = transport
            self._thread_id = "1"
            self._thread_added = False
            self._epoch = 0
            self._running = True
            self._paused = False
            self._stop_count = 0
            self._last_frames = []
            self._value_frames = {}
            self._visited_values = 0
            self._missing.clear()
            self._initialized = asyncio.Event()
            self._capabilities = {}
            self._record_mode = auto_record
            self._max_frames = max(1, min(max_frames, 500))
            self._allow_evaluate = allow_evaluate
            trace_breakpoints = list(trace_lines or []) if auto_record else list(breakpoints)
            if auto_record and not trace_breakpoints:
                raise RealDebugError("完整运行没有可记录的可执行行")
            self._session = DapSession(transport, on_event=self._on_dap_event, request_timeout=15.0)
            try:
                capabilities = await self._session.initialize(client_id="thinking-canvas-studio", adapter_id="debugpy")
                self._capabilities = capabilities
                await self._emit({
                    "type": "runStarted",
                    "runId": self._run_id,
                    "sessionId": self._session_id,
                    "capabilities": _normalized_capabilities(capabilities, self._allow_evaluate),
                })
                attach_task = asyncio.create_task(self._session.request("attach", {"justMyCode": True}))
                await asyncio.wait_for(self._initialized.wait(), timeout=10.0)
                await self._session.request(
                    "setBreakpoints",
                    {
                        "source": {"path": str(Path(program).resolve())},
                        "breakpoints": [{"line": line} for line in sorted(set(trace_breakpoints)) if line > 0],
                        "sourceModified": False,
                    },
                )
                await self._session.request("configurationDone", {})
                await asyncio.wait_for(attach_task, timeout=15.0)
                await self._console("真实调试会话已启动（debugpy）。")
                return {
                    "sessionId": self._session_id,
                    "runId": self._run_id,
                    "threadId": self._thread_id,
                    "capabilities": _normalized_capabilities(capabilities, self._allow_evaluate),
                    "scripted": False,
                    "mode": "record" if auto_record else "debug",
                }
            except Exception as exc:
                await self._abort()
                raise RealDebugError(f"debugpy startup failed: {exc}") from exc

    async def stop(self) -> None:
        if self._lock is None:
            return
        async with self._lock:
            session = self._session
            transport = self._transport
            self._session = None
            self._transport = None
            self._running = False
            self._paused = False
            if session is not None:
                try:
                    await session.request("disconnect", {"terminateDebuggee": True})
                except DapSessionError:
                    pass
                await session.close()
            if transport is not None:
                await self._supervisor.terminate(transport)
            if self._run_id:
                await self._emit({"type": "runEnded", "runId": self._run_id, "sessionId": self._session_id})
            await self._console("真实调试会话已结束。")

    async def continue_(self) -> None:
        await self._advance("continue")

    async def step(self, kind: str) -> None:
        command = {"over": "next", "into": "stepIn", "out": "stepOut"}.get(kind)
        if command is None:
            raise RealDebugError(f"unknown step kind: {kind}")
        await self._advance(command)

    async def pause(self) -> None:
        if self._session is None or not self._running:
            return
        await self._session.request("pause", {"threadId": _int_thread(self._thread_id)})

    async def get_stack_frames(self) -> list[dict[str, Any]]:
        return self._last_frames

    async def get_scopes(self, frame: dict[str, Any]) -> list[dict[str, Any]]:
        reference = frame.get("reference") if isinstance(frame, dict) else None
        for item in self._last_frames:
            if (item.get("handle") or {}).get("reference") == reference:
                return item.get("scopes", [])
        return []

    async def get_variables(self, container: dict[str, Any]) -> list[dict[str, Any]]:
        reference = container.get("reference") if isinstance(container, dict) else None
        for value in _walk_values(self._last_frames):
            if (value.get("handle") or {}).get("reference") == reference:
                return value.get("children", [])
        return []

    async def get_variable_page(self, container: dict[str, Any], page: dict[str, Any]) -> dict[str, Any]:
        session = self._session
        if session is None or not self._paused:
            raise RealDebugError("variables can only be paged at a stop")
        reference = self._handle_reference(container, {"variable", "scope"})
        start = _bounded_int(page.get("start"), 0, 0, 1_000_000)
        count = _bounded_int(page.get("count"), VARIABLE_PAGE_SIZE, 1, 200)
        filter_mode = page.get("filter")
        if filter_mode not in {"named", "indexed"}:
            filter_mode = None
        parent = next((value for value in _walk_values(self._last_frames) if (value.get("handle") or {}).get("reference") == reference), None)
        total = parent.get("childCount") if parent is not None else None
        container_kind = parent.get("containerKind") if parent is not None else None
        evaluate_name = parent.get("evaluateName") if parent is not None else None
        frame_reference = self._value_frames.get(reference)
        raw: list[dict[str, Any]] = []
        if start > 0 and evaluate_name and frame_reference is not None and container_kind in {"list", "array", "tuple"}:
            if not self._allow_evaluate:
                raise RealDebugError("分页读取该容器需要求值授权")
            slice_body = await session.request("evaluate", {
                "expression": f"{evaluate_name}[{start}:{start + count}]",
                "frameId": frame_reference,
                "context": "watch",
            })
            slice_reference = slice_body.get("variablesReference")
            if isinstance(slice_reference, int) and not isinstance(slice_reference, bool) and slice_reference > 0:
                slice_values = await session.request("variables", {
                    "variablesReference": slice_reference,
                    "start": 0,
                    "count": count,
                })
                raw = [item for item in slice_values.get("variables", []) if isinstance(item, dict) and not _is_special_variable(item)]
        elif start == 0:
            arguments: dict[str, Any] = {
                "variablesReference": reference,
                "start": 0,
                "count": count,
            }
            if filter_mode is not None:
                arguments["filter"] = filter_mode
            body = await session.request("variables", arguments)
            raw = [item for item in body.get("variables", []) if isinstance(item, dict) and not _is_special_variable(item)]
        else:
            raise RealDebugError("当前适配器不支持该容器的后续分页")
        values: list[dict[str, Any]] = []
        for index, variable in enumerate(raw[:count]):
            record = self._variable_record(variable, index, f"page{start}", [], frame_reference)
            if start > 0 and container_kind in {"list", "array", "tuple"}:
                record["name"] = str(start + index)
                record["id"] = f"value-page{start}-{index}"
            values.append(record)
        loaded_end = start + len(values)
        has_more = loaded_end < total if isinstance(total, int) else len(values) >= count
        return {
            "values": values,
            "start": start,
            "count": len(values),
            "childCount": total,
            "hasMore": has_more,
        }

    async def evaluate(self, frame: dict[str, Any], expression: str, context: str = "watch") -> dict[str, Any]:
        if not self._allow_evaluate:
            raise RealDebugError("evaluate was not authorized for this run")
        session = self._session
        if session is None or not self._paused:
            raise RealDebugError("evaluate is only available at a stop")
        reference = self._handle_reference(frame, {"frame"})
        text = expression.strip()
        if not text:
            raise RealDebugError("expression is empty")
        if len(text) > 4000:
            raise RealDebugError("expression is too long")
        chosen_context = context if context in {"watch", "repl", "hover"} else "watch"
        body = await session.request("evaluate", {
            "expression": text,
            "frameId": reference,
            "context": chosen_context,
        })
        type_name = body.get("type") if isinstance(body.get("type"), str) else None
        child_reference = body.get("variablesReference")
        child_reference = child_reference if isinstance(child_reference, int) and not isinstance(child_reference, bool) else 0
        structure, container_kind = _classify(type_name, child_reference)
        handle = _handle(self._session_id, self._run_id, self._epoch, self._thread_id, "variable", child_reference) if child_reference > 0 else None
        return {
            "id": f"eval-{uuid.uuid4().hex[:8]}",
            "name": text,
            "value": str(body.get("result", ""))[:4000],
            "type": type_name,
            "handle": handle,
            "structure": structure,
            "containerKind": container_kind,
            "children": [],
            "childCount": None if child_reference > 0 else 0,
            "hasMore": child_reference > 0,
        }

    def _handle_reference(self, handle: dict[str, Any], kinds: set[str]) -> int:
        if not isinstance(handle, dict):
            raise RealDebugError("handle must be an object")
        if handle.get("sessionId") != self._session_id or handle.get("runId") != self._run_id:
            raise RealDebugError("handle belongs to another session")
        if handle.get("stopEpoch") != self._epoch:
            raise RealDebugError("handle belongs to another stop")
        if handle.get("kind") not in kinds:
            raise RealDebugError("handle kind is not valid for this request")
        reference = handle.get("reference")
        if not isinstance(reference, int) or isinstance(reference, bool) or reference <= 0:
            raise RealDebugError("handle reference is invalid")
        return reference

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
        await session.request(command, {"threadId": _int_thread(self._thread_id)})

    async def _on_dap_event(self, event: str, body: dict[str, Any]) -> None:
        if event == "initialized":
            self._initialized.set()
            return
        if event == "stopped":
            if not self._running:
                return
            self._paused = True
            self._thread_id = str(body.get("threadId", 1))
            if not self._thread_added:
                self._thread_added = True
                await self._emit({
                    "type": "threadAdded",
                    "runId": self._run_id,
                    "sessionId": self._session_id,
                    "threadId": self._thread_id,
                    "name": "MainThread",
                })
            self._epoch += 1
            self._stop_count += 1
            label = str(body.get("description") or f"停点 {self._stop_count}")
            await self._emit({
                "type": "threadStopped",
                "runId": self._run_id,
                "sessionId": self._session_id,
                "threadId": self._thread_id,
                "allThreadsStopped": bool(body.get("allThreadsStopped", True)),
            })
            await self._capture(label)
            if self._record_mode and self._running:
                if self._stop_count >= self._max_frames:
                    await self._console(f"记录达到 {self._max_frames} 帧上限，停止。")
                    await self.stop()
                else:
                    await self._advance("continue")
            return
        if event in {"terminated", "exited"}:
            if self._running:
                self._running = False
                self._paused = False
                await self._emit({"type": "runEnded", "runId": self._run_id, "sessionId": self._session_id})
                asyncio.create_task(self._cleanup_after_terminate())
            return
        if event == "output":
            if body.get("category") == "telemetry":
                return
            text = body.get("output")
            if isinstance(text, str):
                cleaned = [
                    line.strip()
                    for line in text.splitlines()
                    if line.strip()
                    and line.strip() not in {"ptvsd", "debugpy"}
                    and not line.strip().startswith("Debugger warning")
                ]
                if cleaned:
                    await self._console("\n".join(cleaned), "stdout")
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
            thread_id = int(thread_items[0]["id"]) if thread_items else _int_thread(self._thread_id)
            stack = await session.request("stackTrace", {"threadId": thread_id, "startFrame": 0, "levels": 20})
            frames: list[dict[str, Any]] = []
            for index, frame in enumerate(stack.get("stackFrames", [])[:MAX_FRAMES]):
                frame_id = int(frame.get("id", 0))
                name = str(frame.get("name", "frame"))
                scopes: list[dict[str, Any]] = []
                if name != "<module>":
                    scopes_body = await session.request("scopes", {"frameId": frame_id})
                    for scope in scopes_body.get("scopes", []):
                        if scope.get("presentationHint") != "locals" and scope.get("name") != "Locals":
                            continue
                        scope_ref = int(scope.get("variablesReference", 0))
                        values = await self._read_variables(scope_ref, depth=0, path=f"frame{index}.scope{scope_ref}", frame_reference=frame_id)
                        scopes.append({
                            "id": f"scope-{scope_ref}",
                            "name": str(scope.get("name", "Locals")),
                            "expensive": bool(scope.get("expensive", False)),
                            "handle": _handle(self._session_id, self._run_id, self._epoch, self._thread_id, "scope", scope_ref),
                            "values": values,
                        })
                source = frame.get("source") if isinstance(frame.get("source"), dict) else {}
                frames.append({
                    "id": str(frame_id),
                    "name": name,
                    "source": str(source.get("path") or source.get("name") or ""),
                    "line": frame.get("line") if isinstance(frame.get("line"), int) else None,
                    "column": frame.get("column") if isinstance(frame.get("column"), int) else None,
                    "handle": _handle(self._session_id, self._run_id, self._epoch, self._thread_id, "frame", frame_id),
                    "scopes": scopes,
                })
            self._last_frames = frames
            coverage = "partial" if self._missing else "complete"
            line = frames[0].get("line") if frames else "—"
            display_label = f"第 {self._stop_count} 帧 · 行 {line}" if self._record_mode else label
            await self._emit({
                "type": "framesLoaded",
                "runId": self._run_id,
                "sessionId": self._session_id,
                "threadId": self._thread_id,
                "stopEpoch": self._epoch,
                "frames": frames,
                "label": display_label,
                "coverage": {
                    "state": coverage,
                    "reason": "Variable budget reached." if self._missing else None,
                    "knownMissing": sorted(self._missing),
                },
            })
            prefix = display_label if self._record_mode else (label if label.startswith("停点 ") else f"停点 {self._stop_count}: {label}")
            await self._console(f"{prefix} · main.py:{line}", "stdout")
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

    async def _read_variables(
        self,
        reference: int,
        *,
        depth: int,
        path: str,
        filter_mode: str | None = None,
        filter_specials: bool = False,
        frame_reference: int | None = None,
    ) -> list[dict[str, Any]]:
        session = self._session
        if session is None or reference <= 0 or depth > MAX_DEPTH or self._visited_values >= MAX_VALUES:
            if reference > 0:
                self._missing.add("Variable budget or depth limit reached.")
            return []
        arguments: dict[str, Any] = {
            "variablesReference": reference,
            "start": 0,
            "count": 100,
        }
        if filter_mode is not None:
            arguments["filter"] = filter_mode
        body = await session.request("variables", arguments)
        values: list[dict[str, Any]] = []
        for index, variable in enumerate(body.get("variables", [])):
            if not isinstance(variable, dict) or self._visited_values >= MAX_VALUES:
                self._missing.add("Variable budget reached.")
                break
            name = str(variable.get("name", f"value{index}"))
            if filter_specials and _is_special_variable(variable):
                continue
            self._visited_values += 1
            type_name = variable.get("type") if isinstance(variable.get("type"), str) else None
            child_reference = variable.get("variablesReference")
            child_reference = child_reference if isinstance(child_reference, int) and not isinstance(child_reference, bool) else 0
            structure, container_kind = _classify(type_name, child_reference)
            child_filter = "indexed" if container_kind in {"list", "array", "tuple"} else "named" if container_kind in {"dict", "set"} else None
            children = await self._read_variables(
                child_reference,
                depth=depth + 1,
                path=f"{path}.{index}",
                filter_mode=child_filter,
                filter_specials=container_kind is not None,
                frame_reference=frame_reference,
            ) if child_reference > 0 else []
            values.append(self._variable_record(variable, index, path, children, frame_reference))
        return values

    def _variable_record(
        self,
        variable: dict[str, Any],
        index: int,
        path: str,
        children: list[dict[str, Any]],
        frame_reference: int | None = None,
    ) -> dict[str, Any]:
        name = str(variable.get("name", f"value{index}"))
        type_name = variable.get("type") if isinstance(variable.get("type"), str) else None
        evaluate_name = variable.get("evaluateName") if isinstance(variable.get("evaluateName"), str) else None
        child_reference = variable.get("variablesReference")
        child_reference = child_reference if isinstance(child_reference, int) and not isinstance(child_reference, bool) else 0
        structure, container_kind = _classify(type_name, child_reference)
        total = _child_total(variable)
        loaded = len(children)
        has_more = total > loaded if total is not None else (child_reference > 0 and loaded >= VARIABLE_PAGE_SIZE)
        if child_reference > 0 and frame_reference is not None:
            self._value_frames[child_reference] = frame_reference
        return {
            "id": f"value-{path}-{index}",
            "name": name,
            "value": str(variable.get("value", "")),
            "type": type_name,
            "evaluateName": evaluate_name,
            "handle": _handle(self._session_id, self._run_id, self._epoch, self._thread_id, "variable", child_reference) if child_reference > 0 else None,
            "structure": structure,
            "containerKind": container_kind,
            "children": children,
            "childCount": total if total is not None else (loaded if child_reference <= 0 else None),
            "hasMore": has_more,
        }

    async def _cleanup_after_terminate(self) -> None:
        session = self._session
        transport = self._transport
        self._session = None
        self._transport = None
        self._running = False
        self._paused = False
        self._record_mode = False
        if session is not None:
            await session.close()
        if transport is not None:
            await self._supervisor.terminate(transport)

    async def _abort(self) -> None:
        session = self._session
        transport = self._transport
        self._session = None
        self._transport = None
        self._running = False
        if session is not None:
            await session.close()
        if transport is not None:
            await self._supervisor.terminate(transport)
        if self._run_id:
            await self._emit({"type": "runEnded", "runId": self._run_id, "sessionId": self._session_id})

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


def _normalized_capabilities(capabilities: dict[str, Any], allow_evaluate: bool = False) -> dict[str, bool]:
    return {
        "stackTrace": True,
        "scopes": True,
        "variables": True,
        "evaluate": allow_evaluate,
        "setVariable": bool(capabilities.get("supportsSetVariable", False)),
        "readMemory": False,
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


def _is_special_variable(variable: dict[str, Any]) -> bool:
    name = str(variable.get("name", ""))
    type_name = str(variable.get("type", ""))
    return name in SPECIAL_VARIABLES or type_name in SPECIAL_VARIABLES or (name == "more" and type_name == "MoreItemsRange")


def _child_total(variable: dict[str, Any]) -> int | None:
    values: list[int] = []
    for key in ("indexedVariables", "namedVariables"):
        item = variable.get(key)
        if isinstance(item, int) and not isinstance(item, bool) and item >= 0:
            values.append(item)
    return sum(values) if values else None


def _bounded_int(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        return fallback
    return max(minimum, min(value, maximum))


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


def _int_thread(value: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 1