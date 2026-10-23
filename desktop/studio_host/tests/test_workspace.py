from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from studio_host.workspace import WorkspaceError, WorkspaceStore


class WorkspaceStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = WorkspaceStore(self.root)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_lists_seeded_source_files_and_skips_private_metadata(self) -> None:
        self.store.ensure_demo_files()
        files = self.store.list_files()
        paths = [item["path"] for item in files]
        self.assertEqual(paths, ["main.py", "notes.md", "two_sum.py"])
        self.assertNotIn(".thinking-canvas", "".join(paths))

    def test_read_write_round_trip_and_atomic_overwrite(self) -> None:
        self.store.write_text("src/note.txt", "one")
        self.assertEqual(self.store.read_text("src/note.txt"), "one")
        self.store.write_text("src/note.txt", "two")
        self.assertEqual(self.store.read_text("src/note.txt"), "two")
        self.assertEqual((self.root / "src" / "note.txt").read_text(encoding="utf-8"), "two")

    def test_rejects_traversal_and_absolute_paths(self) -> None:
        for path in ("../outside.txt", "a/../../outside.txt", "C:/outside.txt", ""):
            with self.assertRaises(WorkspaceError):
                self.store.write_text(path, "x")

    def test_rejects_oversized_content(self) -> None:
        with self.assertRaises(WorkspaceError):
            self.store.write_text("big.txt", "x" * (self.store.max_text_bytes + 1))

    def test_board_round_trip_and_bad_payload(self) -> None:
        board = {"id": "b", "title": "T", "scene": {"nodes": [], "edges": []}}
        self.store.save_board(board)
        self.assertEqual(self.store.load_board(), board)
        (self.root / ".thinking-canvas" / "boards" / "bad.json").write_text(
            json.dumps({"id": "bad"}), encoding="utf-8"
        )
        with self.assertRaises(WorkspaceError):
            self.store.load_board("bad.json")

    def test_board_name_cannot_escape(self) -> None:
        with self.assertRaises(WorkspaceError):
            self.store.load_board("../outside.json")


if __name__ == "__main__":
    unittest.main()