"""Typed ports. These describe boundaries; they do not start processes or sockets."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable


@dataclass(frozen=True, slots=True)
class ResourceLimits:
    """Requested ceilings; enforcement must be supplied by a real supervisor."""

    timeout_seconds: float
    memory_bytes: int
    cpu_seconds: float
    process_count: int


@dataclass(frozen=True, slots=True)
class ExecutionSpec:
    """Immutable identity and limits for one adapter operation."""

    workspace: Path
    adapter_identity: str
    adapter_version: str
    operation: str
    config_digest: str
    limits: ResourceLimits
    session_id: str | None = None


@runtime_checkable
class AdapterTransport(Protocol):
    """Framed byte transport for an adapter; stdout must carry protocol only."""

    async def send(self, data: bytes) -> None: ...

    async def receive(self, max_bytes: int) -> bytes: ...

    async def close(self) -> None: ...


@runtime_checkable
class ExecutionSupervisor(Protocol):
    """Process boundary. Implementations must enforce limits before returning True."""

    def enforces(self, limits: ResourceLimits) -> bool:
        """Return True only when OS-backed timeout and resource caps are active."""
        ...

    async def launch(self, spec: ExecutionSpec) -> AdapterTransport: ...

    async def attach(self, spec: ExecutionSpec) -> AdapterTransport: ...

    async def terminate(self, transport: AdapterTransport) -> None: ...


@runtime_checkable
class WorkspaceStore(Protocol):
    """Scoped file access. Implementations must reject paths outside the workspace."""

    def read_text(self, workspace: Path, relative_path: str) -> str: ...

    def write_text(self, workspace: Path, relative_path: str, content: str) -> None: ...
