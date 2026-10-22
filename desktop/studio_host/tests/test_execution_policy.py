from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from studio_host.execution_policy import (
    ExecutionPolicy,
    Grant,
    GrantAuthority,
    GrantScope,
    HostApprovalReceipt,
    Operation,
    config_digest,
)
from studio_host.ports import ExecutionSpec, ResourceLimits


LIMITS = ResourceLimits(timeout_seconds=5, memory_bytes=64 * 1024 * 1024, cpu_seconds=3, process_count=1)
DIGEST = config_digest({"argv": ["fixture.py"], "cwd": "."})


class NonEnforcingTestSupervisor:
    """Test double only. It deliberately does not start or supervise processes."""

    def __init__(self, enforced: object = True) -> None:
        self.enforced = enforced

    def enforces(self, limits: ResourceLimits) -> object:
        return self.enforced


class TestApprovalVerifier:
    """Test-only receipt verifier. It is not an application approval mechanism."""

    def consume(self, receipt: HostApprovalReceipt, scope: GrantScope) -> bool:
        return receipt.receipt_id == "test-approval" and bool(scope.operations)


class NonBooleanApprovalVerifier:
    def consume(self, receipt: HostApprovalReceipt, scope: GrantScope) -> bool:
        return 1  # type: ignore[return-value]


class ExecutionPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp.name)
        self.authority = GrantAuthority(approval_verifier=TestApprovalVerifier(), max_ttl_seconds=2)
        self.policy = ExecutionPolicy(self.authority, NonEnforcingTestSupervisor())
        self.grant = self.issue()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def issue(self, *, ttl: float = 1, operations: object = None) -> Grant:
        return self.authority.issue_approved(
            approval=HostApprovalReceipt("test-approval"),
            workspace=self.workspace,
            adapter_identity="python.debugpy",
            adapter_version="fixture-version",
            operations=operations or frozenset({
                Operation.LAUNCH, Operation.ATTACH, Operation.EVALUATE,
                Operation.CONTINUE, Operation.STEP, Operation.DISCONNECT,
            }),
            digest=DIGEST,
            limits=LIMITS,
            ttl_seconds=ttl,
        )

    def spec(self, **changes: object) -> ExecutionSpec:
        values: dict[str, object] = {
            "workspace": self.workspace,
            "adapter_identity": "python.debugpy",
            "adapter_version": "fixture-version",
            "operation": Operation.LAUNCH.value,
            "config_digest": DIGEST,
            "limits": LIMITS,
            "session_id": "test-session",
        }
        values.update(changes)
        return ExecutionSpec(**values)  # type: ignore[arg-type]

    def test_default_policy_denies_without_authority_or_supervisor(self) -> None:
        self.assertEqual(
            ExecutionPolicy().authorize(self.spec(), self.grant).reason,
            "grant_authority_unavailable",
        )
        self.assertEqual(
            ExecutionPolicy(self.authority).authorize(self.spec(), self.grant).reason,
            "resource_enforcing_supervisor_unavailable",
        )

    def test_authority_without_host_approval_verifier_cannot_issue(self) -> None:
        authority = GrantAuthority()
        with self.assertRaisesRegex(ValueError, "verifier is unavailable"):
            authority.issue_approved(
                approval=HostApprovalReceipt("browser-supplied"),
                workspace=self.workspace,
                adapter_identity="python.debugpy",
                adapter_version="fixture-version",
                operations=frozenset({Operation.LAUNCH}),
                digest=DIGEST,
                limits=LIMITS,
                ttl_seconds=1,
            )

    def test_approval_verifier_must_return_literal_true(self) -> None:
        authority = GrantAuthority(approval_verifier=NonBooleanApprovalVerifier())
        with self.assertRaisesRegex(ValueError, "no matching host approval"):
            authority.issue_approved(
                approval=HostApprovalReceipt("test-approval"), workspace=self.workspace,
                adapter_identity="python.debugpy", adapter_version="fixture-version",
                operations={Operation.LAUNCH}, digest=DIGEST, limits=LIMITS, ttl_seconds=1,
            )

    def test_rejects_missing_forged_and_wrong_operation_grants(self) -> None:
        self.assertFalse(self.policy.authorize(self.spec(), None).allowed)
        self.assertFalse(self.policy.authorize(self.spec(), Grant("forged.token")).allowed)
        self.assertEqual(
            self.policy.authorize(self.spec(operation=Operation.READ_MEMORY.value), self.grant).reason,
            "operation_not_granted",
        )

    def test_rejects_wrong_workspace(self) -> None:
        other = self.workspace / "other"
        other.mkdir()
        result = self.policy.authorize(self.spec(workspace=other), self.grant)
        self.assertEqual(result.reason, "workspace_mismatch")

    def test_rejects_wrong_adapter_identity_or_version(self) -> None:
        self.assertEqual(
            self.policy.authorize(self.spec(adapter_identity="other"), self.grant).reason,
            "adapter_identity_mismatch",
        )
        self.assertEqual(
            self.policy.authorize(self.spec(adapter_version="other"), self.grant).reason,
            "adapter_version_mismatch",
        )

    def test_rejects_wrong_config_digest_and_excess_limits(self) -> None:
        self.assertEqual(
            self.policy.authorize(self.spec(config_digest="0" * 64), self.grant).reason,
            "config_digest_mismatch",
        )
        larger = ResourceLimits(timeout_seconds=6, memory_bytes=LIMITS.memory_bytes, cpu_seconds=3, process_count=1)
        self.assertEqual(
            self.policy.authorize(self.spec(limits=larger), self.grant).reason,
            "requested_limits_exceed_grant",
        )

    def test_rejects_expired_grant(self) -> None:
        expiring = self.issue(ttl=0.01)
        time.sleep(0.03)
        self.assertEqual(self.policy.authorize(self.spec(), expiring).reason, "grant_expired")

    def test_supervisor_without_enforcement_always_denies(self) -> None:
        policy = ExecutionPolicy(self.authority, NonEnforcingTestSupervisor(enforced=False))
        self.assertEqual(policy.authorize(self.spec(), self.grant).reason, "resource_limits_not_enforced")

    def test_supervisor_must_return_literal_true(self) -> None:
        policy = ExecutionPolicy(self.authority, NonEnforcingTestSupervisor(enforced=1))
        self.assertEqual(policy.authorize(self.spec(), self.grant).reason, "resource_limits_not_enforced")

    def test_valid_scoped_grant_passes_policy_logic_only(self) -> None:
        result = self.policy.authorize(self.spec(), self.grant)
        self.assertTrue(result.allowed)
        self.assertEqual(result.reason, "authorized")
        self.assertEqual(result.limits, LIMITS)

    def test_authorization_returns_requested_budget_not_larger_grant_ceiling(self) -> None:
        requested = ResourceLimits(timeout_seconds=2, memory_bytes=32 * 1024 * 1024, cpu_seconds=1, process_count=1)
        result = self.policy.authorize(self.spec(limits=requested), self.grant)
        self.assertTrue(result.allowed)
        self.assertEqual(result.limits, requested)

    def test_mutating_issued_operation_set_does_not_expand_grant(self) -> None:
        operations = {Operation.LAUNCH, Operation.EVALUATE}
        grant = self.issue(operations=operations)
        operations.add(Operation.READ_MEMORY)
        self.assertTrue(self.policy.authorize(self.spec(), grant).allowed)
        self.assertEqual(
            self.policy.authorize(self.spec(operation=Operation.READ_MEMORY.value), grant).reason,
            "operation_not_granted",
        )

    def test_failed_start_does_not_bind_grant_and_success_binds_once(self) -> None:
        self.assertEqual(
            self.policy.authorize(self.spec(config_digest="0" * 64), self.grant).reason,
            "config_digest_mismatch",
        )
        self.assertTrue(self.policy.authorize(self.spec(), self.grant).allowed)
        self.assertEqual(self.policy.authorize(self.spec(), self.grant).reason, "grant_already_bound")
        self.assertEqual(
            self.policy.authorize(self.spec(operation=Operation.ATTACH.value), self.grant).reason,
            "grant_already_bound",
        )

    def test_session_operations_repeat_and_are_bound_to_one_session(self) -> None:
        self.assertEqual(
            self.policy.authorize(self.spec(operation=Operation.CONTINUE.value), self.grant).reason,
            "session_not_started",
        )
        self.assertTrue(self.policy.authorize(self.spec(), self.grant).allowed)
        for operation in (Operation.STEP, Operation.STEP, Operation.CONTINUE, Operation.CONTINUE):
            self.assertTrue(self.policy.authorize(self.spec(operation=operation.value), self.grant).allowed)
        self.assertEqual(
            self.policy.authorize(
                self.spec(session_id="other-session", operation=Operation.STEP.value), self.grant
            ).reason,
            "session_mismatch",
        )
        self.assertTrue(self.policy.authorize(self.spec(operation=Operation.DISCONNECT.value), self.grant).allowed)
        self.assertEqual(
            self.policy.authorize(self.spec(operation=Operation.CONTINUE.value), self.grant).reason,
            "session_closed",
        )


if __name__ == "__main__":
    unittest.main()
