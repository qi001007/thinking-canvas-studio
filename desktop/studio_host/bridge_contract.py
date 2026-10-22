"""Minimal JSON-RPC 2.0 request/response validation for a future local bridge."""

from __future__ import annotations

from collections.abc import Iterable
from typing import TypeAlias

JsonId: TypeAlias = str | int


class BridgeContractError(ValueError):
    """JSON-RPC envelope, allowlist, or request/response matching failure."""


class BridgeContract:
    """Envelope validator only; no listener, dispatcher, or request-id idempotency."""

    _NEVER_ALLOWED = frozenset({"execution.grant", "runtime.grant"})

    def __init__(self, allowed_methods: Iterable[str] = ()) -> None:
        methods = frozenset(allowed_methods)
        if any(not isinstance(method, str) or not method for method in methods):
            raise ValueError("allowed method names must be non-empty strings")
        if any(_is_grant_method(method) for method in methods):
            raise ValueError("grant issuance cannot be exposed through the bridge")
        self._allowed_methods = methods
        self._pending: set[JsonId] = set()

    def validate_request(self, envelope: object) -> tuple[JsonId, str, object | None]:
        """Accept allowlisted requests only; JSON-RPC notifications are unsupported."""
        if not isinstance(envelope, dict):
            raise BridgeContractError("request envelope must be an object")
        if envelope.get("jsonrpc") != "2.0":
            raise BridgeContractError("jsonrpc must be '2.0'")
        request_id = envelope.get("id")
        if not _valid_id(request_id):
            raise BridgeContractError("request id must be a string or integer")
        method = envelope.get("method")
        if not isinstance(method, str) or not method:
            raise BridgeContractError("method must be a non-empty string")
        if _is_grant_method(method):
            raise BridgeContractError("grant issuance is forbidden through the bridge")
        if method not in self._allowed_methods:
            raise BridgeContractError(f"method is not allowlisted: {method}")
        if "params" in envelope and not isinstance(envelope["params"], (dict, list)):
            raise BridgeContractError("params must be an object or array")
        extras = set(envelope) - {"jsonrpc", "id", "method", "params"}
        if extras:
            raise BridgeContractError("request contains unsupported fields")
        return request_id, method, envelope.get("params")

    def expect_response(self, request_id: object) -> None:
        """Track an outbound response ID; this does not deduplicate request execution."""
        if not _valid_id(request_id):
            raise BridgeContractError("pending id must be a string or integer")
        if request_id in self._pending:
            raise BridgeContractError("request id is already pending")
        self._pending.add(request_id)

    def validate_response(self, envelope: object) -> tuple[JsonId, object]:
        if not isinstance(envelope, dict):
            raise BridgeContractError("response envelope must be an object")
        if envelope.get("jsonrpc") != "2.0":
            raise BridgeContractError("jsonrpc must be '2.0'")
        response_id = envelope.get("id")
        if not _valid_id(response_id) or response_id not in self._pending:
            raise BridgeContractError("response id does not match a pending request")
        has_result = "result" in envelope
        has_error = "error" in envelope
        if has_result == has_error:
            raise BridgeContractError("response must contain exactly one of result or error")
        extras = set(envelope) - {"jsonrpc", "id", "result", "error"}
        if extras:
            raise BridgeContractError("response contains unsupported fields")
        value = envelope["result"] if has_result else envelope["error"]
        if has_error:
            error = value
            if (
                not isinstance(error, dict)
                or not isinstance(error.get("code"), int)
                or isinstance(error.get("code"), bool)
                or not isinstance(error.get("message"), str)
            ):
                raise BridgeContractError("error response must contain integer code and message")
        self._pending.remove(response_id)
        return response_id, value


def _valid_id(value: object) -> bool:
    return isinstance(value, (str, int)) and not isinstance(value, bool)


def _is_grant_method(method: str) -> bool:
    return "grant" in method.casefold()
