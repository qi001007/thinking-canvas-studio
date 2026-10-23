from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from studio_host.execution_policy import GrantScope, Operation
from studio_host.host_approval import ApprovalRegistry
from studio_host.ports import ResourceLimits


class ApprovalRegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.limits = ResourceLimits(timeout_seconds=10, memory_bytes=1024, cpu_seconds=5, process_count=2)
        self.scope = GrantScope(
            workspace=self.root,
            adapter_identity="python.debugpy",
            adapter_version="1.6.7",
            operations=frozenset({Operation.LAUNCH}),
            config_digest="0" * 64,
            limits=self.limits,
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_receipt_is_single_use_and_scope_bound(self) -> None:
        registry = ApprovalRegistry()
        receipt = registry.issue(self.scope)
        self.assertTrue(registry.consume(receipt, self.scope))
        self.assertFalse(registry.consume(receipt, self.scope))
        other = GrantScope(
            workspace=self.root,
            adapter_identity="python.debugpy",
            adapter_version="1.6.7",
            operations=frozenset({Operation.LAUNCH}),
            config_digest="1" * 64,
            limits=self.limits,
        )
        second = registry.issue(self.scope)
        self.assertFalse(registry.consume(second, other))


if __name__ == "__main__":
    unittest.main()