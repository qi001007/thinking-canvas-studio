"""Default-deny policy for short-lived, precisely scoped execution grants."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import secrets
import threading
import time
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from collections.abc import Iterable
from typing import Protocol

from .ports import ExecutionSpec, ExecutionSupervisor, ResourceLimits


class Operation(StrEnum):
    LAUNCH = "launch"
    ATTACH = "attach"
    EVALUATE = "evaluate"
    SET_VARIABLE = "setVariable"
    READ_MEMORY = "readMemory"
    CONTINUE = "continue"
    PAUSE = "pause"
    STEP = "step"
    DISCONNECT = "disconnect"


def canonical_workspace(path: str | Path) -> Path:
    """Resolve an existing directory so grants bind to one absolute workspace."""
    resolved = Path(path).expanduser().resolve(strict=True)
    if not resolved.is_dir():
        raise ValueError("workspace must be an existing directory")
    return resolved


def config_digest(config: bytes | str | dict[str, object]) -> str:
    """SHA-256 of exact bytes/text, or stable compact JSON for a mapping."""
    if isinstance(config, bytes):
        payload = config
    elif isinstance(config, str):
        payload = config.encode("utf-8")
    else:
        payload = json.dumps(
            config, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


@dataclass(frozen=True, slots=True)
class GrantScope:
    workspace: Path
    adapter_identity: str
    adapter_version: str
    operations: frozenset[Operation]
    config_digest: str
    limits: ResourceLimits


@dataclass(frozen=True, slots=True)
class Grant:
    """Opaque short-lived session-grant token issued by the trusted host."""

    token: str


@dataclass(frozen=True, slots=True)
class Authorization:
    allowed: bool
    reason: str
    limits: ResourceLimits | None = None


@dataclass(frozen=True, slots=True)
class HostApprovalReceipt:
    """Opaque reference created by a trusted desktop approval flow."""

    receipt_id: str


class ApprovalVerifier(Protocol):
    """Consumes a host-side approval receipt for exactly the requested grant scope."""

    def consume(self, receipt: HostApprovalReceipt, scope: GrantScope) -> bool: ...


@dataclass(slots=True)
class _GrantRecord:
    scope: GrantScope
    expires_at: float
    session_id: str | None = None
    closed: bool = False


def _valid_limits(limits: ResourceLimits) -> bool:
    return (
        isinstance(limits, ResourceLimits)
        and isinstance(limits.timeout_seconds, (int, float))
        and not isinstance(limits.timeout_seconds, bool)
        and math.isfinite(limits.timeout_seconds)
        and limits.timeout_seconds > 0
        and isinstance(limits.memory_bytes, int)
        and not isinstance(limits.memory_bytes, bool)
        and limits.memory_bytes > 0
        and isinstance(limits.cpu_seconds, (int, float))
        and not isinstance(limits.cpu_seconds, bool)
        and math.isfinite(limits.cpu_seconds)
        and limits.cpu_seconds > 0
        and isinstance(limits.process_count, int)
        and not isinstance(limits.process_count, bool)
        and limits.process_count > 0
    )


class GrantAuthority:
    """In-process host issuer; never expose this object or its issue method to JS."""

    def __init__(
        self,
        *,
        approval_verifier: ApprovalVerifier | None = None,
        max_ttl_seconds: float = 300.0,
    ) -> None:
        if (
            not isinstance(max_ttl_seconds, (int, float))
            or isinstance(max_ttl_seconds, bool)
            or not math.isfinite(max_ttl_seconds)
            or max_ttl_seconds <= 0
        ):
            raise ValueError("max_ttl_seconds must be positive and finite")
        self._max_ttl_seconds = max_ttl_seconds
        self._approval_verifier = approval_verifier
        self._key = secrets.token_bytes(32)
        self._grants: dict[str, _GrantRecord] = {}
        self._lock = threading.Lock()

    def issue_approved(
        self,
        *,
        approval: HostApprovalReceipt,
        workspace: str | Path,
        adapter_identity: str,
        adapter_version: str,
        operations: Iterable[Operation],
        digest: str,
        limits: ResourceLimits,
        ttl_seconds: float,
    ) -> Grant:
        """Issue only from a trusted Python host approval path, never from bridge JSON."""
        if (
            not isinstance(ttl_seconds, (int, float))
            or isinstance(ttl_seconds, bool)
            or not math.isfinite(ttl_seconds)
            or not 0 < ttl_seconds <= self._max_ttl_seconds
        ):
            raise ValueError("grant lifetime is outside the allowed short-term window")
        try:
            operation_set = frozenset(operations)
        except (TypeError, ValueError) as exc:
            raise ValueError("grant must name known operations") from exc
        if not operation_set or any(not isinstance(operation, Operation) for operation in operation_set):
            raise ValueError("grant must name known operations")
        if not _valid_limits(limits):
            raise ValueError("all resource ceilings must be positive and finite")
        if (
            not isinstance(digest, str)
            or len(digest) != 64
            or any(ch not in "0123456789abcdef" for ch in digest.lower())
        ):
            raise ValueError("config digest must be a SHA-256 hex digest")
        if (
            not isinstance(approval, HostApprovalReceipt)
            or not isinstance(approval.receipt_id, str)
            or not approval.receipt_id
        ):
            raise ValueError("trusted host approval receipt is required")
        if (
            not isinstance(adapter_identity, str)
            or not adapter_identity.strip()
            or not isinstance(adapter_version, str)
            or not adapter_version.strip()
        ):
            raise ValueError("adapter identity and version are required")

        scope = GrantScope(
            workspace=canonical_workspace(workspace),
            adapter_identity=adapter_identity,
            adapter_version=adapter_version,
            operations=operation_set,
            config_digest=digest.lower(),
            limits=limits,
        )
        if self._approval_verifier is None:
            raise ValueError("trusted host approval verifier is unavailable")
        try:
            approved = self._approval_verifier.consume(approval, scope)
        except Exception as exc:
            raise ValueError("host approval verification failed") from exc
        if approved is not True:
            raise ValueError("grant scope has no matching host approval")
        expires_at = time.monotonic() + ttl_seconds
        nonce = secrets.token_urlsafe(32)
        payload = f"{nonce}:{expires_at:.9f}".encode("ascii")
        signature = hmac.new(self._key, payload, hashlib.sha256).hexdigest()
        token = f"{nonce}.{signature}"
        with self._lock:
            self._grants[token] = _GrantRecord(scope, expires_at)
        return Grant(token=token)

    def revoke(self, grant: Grant) -> None:
        if isinstance(grant, Grant) and isinstance(grant.token, str):
            with self._lock:
                self._grants.pop(grant.token, None)

    def lookup(self, grant: Grant | None) -> tuple[GrantScope, float] | None:
        if not isinstance(grant, Grant) or not isinstance(grant.token, str):
            return None
        with self._lock:
            entry = self._grants.get(grant.token)
            if entry is None:
                return None
            nonce, separator, signature = grant.token.rpartition(".")
            if not separator:
                return None
            payload = f"{nonce}:{entry.expires_at:.9f}".encode("ascii")
            expected = hmac.new(self._key, payload, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected):
                return None
            return entry.scope, entry.expires_at

    def bind_session(self, grant: Grant, session_id: str) -> str | None:
        """Consume launch/attach authority once and bind the grant to one session."""
        with self._lock:
            record = self._record(grant)
            if record is None or time.monotonic() >= record.expires_at:
                return "grant_expired_or_invalid"
            if record.session_id is not None:
                return "grant_already_bound"
            record.session_id = session_id
            return None

    def use_session(self, grant: Grant, session_id: str, *, close: bool = False) -> str | None:
        """Authorize a repeated operation within the bound, open session."""
        with self._lock:
            record = self._record(grant)
            if record is None or time.monotonic() >= record.expires_at:
                return "grant_expired_or_invalid"
            if record.closed:
                return "session_closed"
            if record.session_id is None:
                return "session_not_started"
            if record.session_id != session_id:
                return "session_mismatch"
            if close:
                record.closed = True
            return None

    def _record(self, grant: Grant) -> _GrantRecord | None:
        if not isinstance(grant, Grant) or not isinstance(grant.token, str):
            return None
        record = self._grants.get(grant.token)
        if record is None:
            return None
        nonce, separator, signature = grant.token.rpartition(".")
        if not separator:
            return None
        payload = f"{nonce}:{record.expires_at:.9f}".encode("ascii")
        expected = hmac.new(self._key, payload, hashlib.sha256).hexdigest()
        return record if hmac.compare_digest(signature, expected) else None


class ExecutionPolicy:
    """No authority or enforcing supervisor means every operation is denied."""

    def __init__(
        self,
        authority: GrantAuthority | None = None,
        supervisor: ExecutionSupervisor | None = None,
    ) -> None:
        self._authority = authority
        self._supervisor = supervisor

    def authorize(self, spec: ExecutionSpec, grant: Grant | None) -> Authorization:
        if self._authority is None:
            return Authorization(False, "grant_authority_unavailable")
        if self._supervisor is None:
            return Authorization(False, "resource_enforcing_supervisor_unavailable")
        if not isinstance(spec, ExecutionSpec):
            return Authorization(False, "execution_spec_invalid")
        if (
            not isinstance(spec.workspace, (str, Path))
            or not isinstance(spec.adapter_identity, str)
            or not isinstance(spec.adapter_version, str)
            or not isinstance(spec.operation, str)
            or not isinstance(spec.config_digest, str)
            or not isinstance(spec.session_id, str)
            or not spec.session_id
        ):
            return Authorization(False, "execution_spec_invalid")
        if not _valid_limits(spec.limits):
            return Authorization(False, "requested_limits_invalid")
        try:
            limits_enforced = self._supervisor.enforces(spec.limits)
        except Exception:
            return Authorization(False, "resource_enforcement_check_failed")
        if limits_enforced is not True:
            return Authorization(False, "resource_limits_not_enforced")

        found = self._authority.lookup(grant)
        if found is None:
            return Authorization(False, "grant_missing_invalid_or_revoked")
        scope, expires_at = found
        if time.monotonic() >= expires_at:
            self._authority.revoke(grant)  # type: ignore[arg-type]
            return Authorization(False, "grant_expired")

        try:
            workspace = canonical_workspace(spec.workspace)
        except (OSError, RuntimeError, TypeError, ValueError):
            return Authorization(False, "workspace_invalid")
        if workspace != scope.workspace:
            return Authorization(False, "workspace_mismatch")
        if spec.adapter_identity != scope.adapter_identity:
            return Authorization(False, "adapter_identity_mismatch")
        if spec.adapter_version != scope.adapter_version:
            return Authorization(False, "adapter_version_mismatch")
        try:
            operation = Operation(spec.operation)
        except ValueError:
            return Authorization(False, "operation_unknown")
        if operation not in scope.operations:
            return Authorization(False, "operation_not_granted")
        if spec.config_digest.lower() != scope.config_digest:
            return Authorization(False, "config_digest_mismatch")
        if not _within(spec.limits, scope.limits):
            return Authorization(False, "requested_limits_exceed_grant")

        if operation in (Operation.LAUNCH, Operation.ATTACH):
            session_error = self._authority.bind_session(grant, spec.session_id)
            if session_error is not None:
                reason = "grant_already_bound" if session_error == "grant_already_bound" else session_error
                return Authorization(False, reason)
        else:
            session_error = self._authority.use_session(
                grant, spec.session_id, close=operation is Operation.DISCONNECT
            )
            if session_error is not None:
                return Authorization(False, session_error)
        return Authorization(True, "authorized", spec.limits)


def _within(requested: ResourceLimits, granted: ResourceLimits) -> bool:
    return (
        requested.timeout_seconds <= granted.timeout_seconds
        and requested.memory_bytes <= granted.memory_bytes
        and requested.cpu_seconds <= granted.cpu_seconds
        and requested.process_count <= granted.process_count
    )
