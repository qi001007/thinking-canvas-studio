"""Trusted host approval receipts for real launches."""

from __future__ import annotations

import secrets
import threading
import time

from .execution_policy import GrantScope, HostApprovalReceipt


class ApprovalRegistry:
    """Receipts are issued only by the trusted desktop approval path."""

    def __init__(self, ttl_seconds: float = 120.0) -> None:
        if ttl_seconds <= 0:
            raise ValueError("approval ttl must be positive")
        self._ttl = ttl_seconds
        self._lock = threading.Lock()
        self._items: dict[str, tuple[GrantScope, float]] = {}

    def issue(self, scope: GrantScope) -> HostApprovalReceipt:
        receipt_id = secrets.token_urlsafe(24)
        with self._lock:
            self._items[receipt_id] = (scope, time.monotonic() + self._ttl)
        return HostApprovalReceipt(receipt_id)

    def consume(self, receipt: HostApprovalReceipt, scope: GrantScope) -> bool:
        if not isinstance(receipt, HostApprovalReceipt) or not isinstance(receipt.receipt_id, str):
            return False
        with self._lock:
            item = self._items.pop(receipt.receipt_id, None)
        if item is None:
            return False
        stored_scope, expires_at = item
        return time.monotonic() < expires_at and stored_scope == scope