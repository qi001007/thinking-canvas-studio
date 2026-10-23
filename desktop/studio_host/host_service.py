"""JSON-RPC method surface and trusted real-run approval flow."""

from __future__ import annotations

import hashlib
import importlib.metadata
import sys
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from .debug_service import DemoDebugService
from .demo_data import DEMO_BOARD
from .execution_policy import (
    ExecutionPolicy,
    GrantAuthority,
    GrantScope,
    HostApprovalReceipt,
    Operation,
    config_digest,
)
from .host_approval import ApprovalRegistry
from .language_packages import LanguagePackageError, load_language_packages
from .ports import ExecutionSpec, ResourceLimits
from .real_debug_service import RealDebugError, RealDebugService
from .windows_supervisor import SupervisorError, WindowsJobObjectSupervisor
from .workspace import WorkspaceError, WorkspaceStore

EventSink = Callable[[dict[str, Any]], Awaitable[None] | None]
DEFAULT_LIMITS = ResourceLimits(
    timeout_seconds=600.0,
    memory_bytes=512 * 1024 * 1024,
    cpu_seconds=120.0,
    process_count=8,
)
REAL_OPERATIONS = frozenset({
    Operation.LAUNCH,
    Operation.CONTINUE,
    Operation.PAUSE,
    Operation.STEP,
    Operation.DISCONNECT,
})


class RpcError(RuntimeError):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class HostService:
    def __init__(self, workspace_root: Path, languages_root: Path, on_event: EventSink, on_console: EventSink) -> None:
        self._workspace = WorkspaceStore(workspace_root)
        self._workspace.ensure_demo_files()
        try:
            self._languages = load_language_packages(languages_root)
        except LanguagePackageError as exc:
            raise RuntimeError(f"language packages failed to load: {exc}") from exc
        self._on_event = on_event
        self._on_console = on_console
        self._demo = DemoDebugService(on_event=on_event, on_console=on_console)
        self._approvals = ApprovalRegistry(ttl_seconds=120.0)
        self._authority = GrantAuthority(approval_verifier=self._approvals, max_ttl_seconds=1800.0)
        self._supervisor = WindowsJobObjectSupervisor()
        self._policy = ExecutionPolicy(self._authority, self._supervisor)
        self._real: RealDebugService | None = None
        self._active: str | None = None

    @property
    def workspace_root(self) -> Path:
        return self._workspace.root_path

    def prepare_run(self, program: str, breakpoints: list[int]) -> dict[str, Any]:
        scope, config, limits, absolute = self._build_scope(program, breakpoints)
        return {
            "program": str(absolute),
            "interpreter": config["interpreter"],
            "breakpoints": config["breakpoints"],
            "limits": {
                "timeoutSeconds": limits.timeout_seconds,
                "memoryBytes": limits.memory_bytes,
                "cpuSeconds": limits.cpu_seconds,
                "processCount": limits.process_count,
            },
            "adapterVersion": scope.adapter_version,
            "configDigest": scope.config_digest,
        }

    def issue_run_approval(self, program: str, breakpoints: list[int]) -> dict[str, Any]:
        scope, config, limits, absolute = self._build_scope(program, breakpoints)
        receipt = self._approvals.issue(scope)
        return {
            "approved": True,
            "receiptId": receipt.receipt_id,
            "program": str(absolute),
            "interpreter": config["interpreter"],
            "breakpoints": config["breakpoints"],
            "limits": {
                "timeoutSeconds": limits.timeout_seconds,
                "memoryBytes": limits.memory_bytes,
                "cpuSeconds": limits.cpu_seconds,
                "processCount": limits.process_count,
            },
        }

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
            return await self._start_demo()
        if method == "debug.startReal":
            return await self._start_real(params)
        if method == "debug.stop":
            await self._stop_active()
            return {}
        if method == "debug.continue":
            await self._active_service().continue_()
            return {}
        if method == "debug.step":
            await self._active_service().step(_text_param(params, "kind"))
            return {}
        if method == "debug.pause":
            await self._active_service().pause()
            return {}
        if method == "debug.stackFrames":
            return await self._active_service().get_stack_frames()
        if method == "debug.scopes":
            frame = params.get("frame")
            if not isinstance(frame, dict):
                raise RpcError(-32602, "frame handle must be an object")
            return await self._active_service().get_scopes(frame)
        if method == "debug.variables":
            container = params.get("container")
            if not isinstance(container, dict):
                raise RpcError(-32602, "container handle must be an object")
            return await self._active_service().get_variables(container)
        raise RpcError(-32601, f"method not found: {method}")

    async def close(self) -> None:
        await self._stop_active()

    async def _start_demo(self) -> dict[str, Any]:
        await self._stop_active()
        result = await self._demo.start()
        self._active = "demo"
        return result

    async def _start_real(self, params: dict[str, Any]) -> dict[str, Any]:
        receipt_id = _text_param(params, "receiptId")
        program = _text_param(params, "program")
        breakpoints = _int_list(params, "breakpoints")
        scope, config, limits, absolute = self._build_scope(program, breakpoints)
        session_id = f"py-{uuid.uuid4().hex[:10]}"
        try:
            grant = self._authority.issue_approved(
                approval=HostApprovalReceipt(receipt_id),
                workspace=scope.workspace,
                adapter_identity=scope.adapter_identity,
                adapter_version=scope.adapter_version,
                operations=scope.operations,
                digest=scope.config_digest,
                limits=limits,
                ttl_seconds=1800.0,
            )
        except ValueError as exc:
            raise RpcError(-32003, f"run approval rejected: {exc}") from exc
        spec = ExecutionSpec(
            workspace=scope.workspace,
            adapter_identity=scope.adapter_identity,
            adapter_version=scope.adapter_version,
            operation=Operation.LAUNCH.value,
            config_digest=scope.config_digest,
            limits=limits,
            session_id=session_id,
            launch_config=config,
        )
        authorization = self._policy.authorize(spec, grant)
        if not authorization.allowed:
            raise RpcError(-32003, f"run denied: {authorization.reason}")
        await self._stop_active()
        try:
            transport = await self._supervisor.launch(spec)
        except SupervisorError as exc:
            self._authority.revoke(grant)
            raise RpcError(-32004, f"debugpy launch failed: {exc}") from exc
        real = RealDebugService(self._supervisor, self._on_event, self._on_console)
        self._real = real
        self._active = "real"
        try:
            return await real.start(transport, program=str(absolute), breakpoints=breakpoints)
        except RealDebugError:
            self._active = None
            self._real = None
            self._authority.revoke(grant)
            raise

    async def _stop_active(self) -> None:
        active = self._active
        self._active = None
        if active == "real" and self._real is not None:
            real = self._real
            self._real = None
            await real.stop()
            return
        if active == "demo":
            await self._demo.stop()

    def _active_service(self) -> DemoDebugService | RealDebugService:
        if self._active == "real" and self._real is not None:
            return self._real
        if self._active == "demo":
            return self._demo
        raise RpcError(-32005, "no debug session is active")

    def _build_scope(self, program: str, breakpoints: list[int]) -> tuple[GrantScope, dict[str, Any], ResourceLimits, Path]:
        if not isinstance(program, str) or not program.strip():
            raise RpcError(-32602, "program must be a workspace file")
        try:
            absolute = self._workspace.resolve_file(program)
        except WorkspaceError as exc:
            raise RpcError(-32602, str(exc)) from exc
        version = _debugpy_version()
        if version is None:
            raise RpcError(-32006, "debugpy is not installed in the host interpreter")
        if not self._supervisor.enforces(DEFAULT_LIMITS):
            raise RpcError(-32007, "OS-enforced resource limits are unavailable")
        lines = sorted({line for line in breakpoints if isinstance(line, int) and not isinstance(line, bool) and line > 0})
        if len(lines) > 200:
            raise RpcError(-32602, "too many breakpoints")
        source_bytes = absolute.read_bytes()
        if len(source_bytes) > self._workspace.max_text_bytes:
            raise RpcError(-32602, "program exceeds the text size limit")
        config: dict[str, Any] = {
            "program": str(absolute),
            "sourceHash": hashlib.sha256(source_bytes).hexdigest(),
            "args": [],
            "cwd": str(self._workspace.root_path),
            "interpreter": sys.executable,
            "breakpoints": lines,
            "limits": {
                "timeoutSeconds": DEFAULT_LIMITS.timeout_seconds,
                "memoryBytes": DEFAULT_LIMITS.memory_bytes,
                "cpuSeconds": DEFAULT_LIMITS.cpu_seconds,
                "processCount": DEFAULT_LIMITS.process_count,
            },
        }
        scope = GrantScope(
            workspace=self._workspace.root_path,
            adapter_identity="python.debugpy",
            adapter_version=version,
            operations=REAL_OPERATIONS,
            config_digest=config_digest(config),
            limits=DEFAULT_LIMITS,
        )
        return scope, config, DEFAULT_LIMITS, absolute


def _text_param(params: dict[str, Any], name: str) -> str:
    value = params.get(name)
    if not isinstance(value, str):
        raise RpcError(-32602, f"{name} must be text")
    return value


def _int_list(params: dict[str, Any], name: str) -> list[int]:
    value = params.get(name, [])
    if not isinstance(value, list) or not all(isinstance(item, int) and not isinstance(item, bool) for item in value):
        raise RpcError(-32602, f"{name} must be a list of integers")
    return value


def _debugpy_version() -> str | None:
    try:
        return importlib.metadata.version("debugpy")
    except importlib.metadata.PackageNotFoundError:
        return None