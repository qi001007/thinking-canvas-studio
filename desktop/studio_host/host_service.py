"""JSON-RPC method surface exposed to the local renderer."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from .debug_service import DemoDebugService
from .demo_data import DEMO_BOARD
from .language_packages import load_language_packages
from .workspace import WorkspaceError, WorkspaceStore

EventSink = Callable[[dict[str, Any]], Awaitable[None] | None]


class RpcError(RuntimeError):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class HostService:
    def __init__(self, workspace_root: Path, languages_root: Path, on_event: EventSink, on_console: EventSink) -> None:
        self._workspace = WorkspaceStore(workspace_root)
        self._workspace.ensure_demo_files()
        self._languages = load_language_packages(languages_root)
        self._debug = DemoDebugService(on_event=on_event, on_console=on_console)

    async def handle(self, method: str, params: dict[str, Any]) -> Any:
        if method == "app.info":
            return {
                "name": "Thinking Canvas Studio",
                "version": "0.1.0",
                "mode": "desktop",
                "bridgeVersion": 1,
            }
        if method == "languages.list":
            return [package.to_dict() for package in self._languages]
        if method == "workspace.list":
            return self._workspace.list_files()
        if method == "workspace.readText":
            path = _text_param(params, "path")
            return {"content": self._workspace.read_text(path)}
        if method == "workspace.writeText":
            path = _text_param(params, "path")
            content = _text_param(params, "content")
            self._workspace.write_text(path, content)
            return {}
        if method == "boards.load":
            board = self._workspace.load_board("demo.json")
            return board or DEMO_BOARD
        if method == "boards.save":
            board = params.get("board")
            if not isinstance(board, dict):
                raise RpcError(-32602, "board must be an object")
            self._workspace.save_board(board, "demo.json")
            return {}
        if method == "debug.start":
            return await self._debug.start()
        if method == "debug.stop":
            await self._debug.stop()
            return {}
        if method == "debug.continue":
            await self._debug.continue_()
            return {}
        if method == "debug.step":
            await self._debug.step(_text_param(params, "kind"))
            return {}
        if method == "debug.pause":
            await self._debug.pause()
            return {}
        if method == "debug.stackFrames":
            return await self._debug.get_stack_frames()
        if method == "debug.scopes":
            frame = params.get("frame")
            if not isinstance(frame, dict):
                raise RpcError(-32602, "frame handle must be an object")
            return await self._debug.get_scopes(frame)
        if method == "debug.variables":
            container = params.get("container")
            if not isinstance(container, dict):
                raise RpcError(-32602, "container handle must be an object")
            return await self._debug.get_variables(container)
        raise RpcError(-32601, f"method not found: {method}")

    async def close(self) -> None:
        await self._debug.stop()


def _text_param(params: dict[str, Any], name: str) -> str:
    value = params.get(name)
    if not isinstance(value, str):
        raise RpcError(-32602, f"{name} must be text")
    return value