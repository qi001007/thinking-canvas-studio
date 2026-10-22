from __future__ import annotations

import unittest

from studio_host.bridge_contract import BridgeContract, BridgeContractError


class BridgeContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.contract = BridgeContract({"workspace.read", "runtime.launch"})

    def test_accepts_allowlisted_request(self) -> None:
        self.assertEqual(
            self.contract.validate_request(
                {"jsonrpc": "2.0", "id": 7, "method": "workspace.read", "params": {"path": "a.py"}}
            ),
            (7, "workspace.read", {"path": "a.py"}),
        )

    def test_rejects_unknown_and_grant_methods(self) -> None:
        with self.assertRaisesRegex(BridgeContractError, "not allowlisted"):
            self.contract.validate_request({"jsonrpc": "2.0", "id": 1, "method": "unknown"})
        with self.assertRaisesRegex(BridgeContractError, "forbidden"):
            self.contract.validate_request({"jsonrpc": "2.0", "id": 1, "method": "execution.grant"})
        with self.assertRaisesRegex(BridgeContractError, "forbidden"):
            self.contract.validate_request({"jsonrpc": "2.0", "id": 1, "method": "runtime.issueGrant"})
        with self.assertRaisesRegex(ValueError, "cannot be exposed"):
            BridgeContract({"execution.grant"})

    def test_rejects_invalid_envelopes(self) -> None:
        invalid = [
            None,
            {"jsonrpc": "1.0", "id": 1, "method": "workspace.read"},
            {"jsonrpc": "2.0", "id": True, "method": "workspace.read"},
            {"jsonrpc": "2.0", "id": None, "method": "workspace.read"},
            {"jsonrpc": "2.0", "id": 1, "method": "workspace.read", "params": "bad"},
            {"jsonrpc": "2.0", "id": 1, "method": "workspace.read", "extra": 1},
        ]
        for envelope in invalid:
            with self.subTest(envelope=envelope), self.assertRaises(BridgeContractError):
                self.contract.validate_request(envelope)

    def test_matches_responses_to_pending_request_ids(self) -> None:
        self.contract.expect_response("req-1")
        self.assertEqual(
            self.contract.validate_response({"jsonrpc": "2.0", "id": "req-1", "result": {"ok": True}}),
            ("req-1", {"ok": True}),
        )
        with self.assertRaisesRegex(BridgeContractError, "does not match"):
            self.contract.validate_response({"jsonrpc": "2.0", "id": "req-1", "result": None})

    def test_rejects_duplicate_pending_ids_and_notifications(self) -> None:
        self.contract.expect_response("same")
        with self.assertRaisesRegex(BridgeContractError, "already pending"):
            self.contract.expect_response("same")
        with self.assertRaisesRegex(BridgeContractError, "id"):
            self.contract.validate_request({"jsonrpc": "2.0", "method": "workspace.read"})

    def test_rejects_mismatched_or_malformed_responses(self) -> None:
        self.contract.expect_response(4)
        with self.assertRaisesRegex(BridgeContractError, "does not match"):
            self.contract.validate_response({"jsonrpc": "2.0", "id": 5, "result": None})
        invalid = [
            {"jsonrpc": "2.0", "id": 4},
            {"jsonrpc": "2.0", "id": 4, "result": None, "error": {"code": 1, "message": "x"}},
            {"jsonrpc": "2.0", "id": 4, "error": {"code": True, "message": "x"}},
        ]
        for envelope in invalid:
            with self.subTest(envelope=envelope), self.assertRaises(BridgeContractError):
                self.contract.validate_response(envelope)


if __name__ == "__main__":
    unittest.main()
