from __future__ import annotations

import asyncio
import shutil
import tempfile
import unittest
from pathlib import Path

from studio_host.host_service import HostService


class StaticAnalysisTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="studio-analysis-")
        self.root = Path(self.temp.name)
        (self.root / "model.py").write_text(
            "import math\n\nCONST = 7\n\n"
            "def helper(value):\n"
            "    return value + math.pi\n\n"
            "class Base:\n"
            "    def step(self, x):\n"
            "        return x\n",
            encoding="utf-8",
        )

        async def on_event(event: dict) -> None:
            pass

        async def on_console(line: dict) -> None:
            pass

        self.service = HostService(self.root, Path(__file__).resolve().parents[3] / "languages", on_event, on_console)

    async def asyncTearDown(self) -> None:
        await self.service.close()
        self.temp.cleanup()

    async def test_workbench_inherits_context_and_builds_class_graph(self) -> None:
        info = await self.service.handle("workbench.create", {"sourceFile": "model.py"})
        code = '''import math

class Layer(Base):
    scale: float = CONST

    def __init__(self, size):
        self.proj = helper(size)
        self.scale = CONST + 1

    def forward(self, x):
        total = 0
        for value in [x, x + 1]:
            total += value
        return self.proj + total
'''
        await self.service.handle("workbench.write", {"path": info["path"], "content": code})
        overview = await self.service.handle("analysis.analyze", {"path": info["path"], "view": "overview"})
        self.assertEqual(overview["coverage"]["state"], "complete")
        self.assertGreaterEqual(overview["stats"]["functions"], 1)
        self.assertEqual(overview["stats"]["classes"], 2)
        result = await self.service.handle("analysis.analyze", {"path": info["path"], "view": "structure"})
        self.assertEqual(result["stats"]["classes"], 2)
        focus_options = {option["label"]: option["id"] for option in result["focusOptions"]}
        nodes = result["scene"]["nodes"]
        edges = result["scene"]["edges"]
        by_label = {node["label"]: node for node in nodes}
        self.assertIn("Layer", by_label)
        self.assertEqual(by_label["Layer"]["card"]["kind"], "class")
        self.assertIn("Base", by_label)
        self.assertIn("scale", by_label)
        self.assertIn("Layer.__init__", by_label)
        self.assertIn("Layer.forward", by_label)
        self.assertNotIn("helper", by_label)
        self.assertTrue(any(edge["kind"] == "inherits" and edge.get("label") == "Base" for edge in edges))
        self.assertTrue(any(edge["kind"] == "method" for edge in edges))
        self.assertTrue(any(edge["kind"] == "imports" for edge in overview["scene"]["edges"]))

        init_view = await self.service.handle(
            "analysis.analyze",
            {"path": info["path"], "view": "structure", "focus": focus_options["Layer.__init__"]},
        )
        self.assertIn("helper", [node["label"] for node in init_view["scene"]["nodes"]])
        self.assertTrue(any(edge["kind"] == "calls" and edge.get("label") == "helper" for edge in init_view["scene"]["edges"]))

        forward_view = await self.service.handle(
            "analysis.analyze",
            {"path": info["path"], "view": "structure", "focus": focus_options["Layer.forward"]},
        )
        forward_labels = [node["label"] for node in forward_view["scene"]["nodes"]]
        self.assertIn("total", forward_labels)
        self.assertTrue(any(edge["kind"] == "iterates" for edge in forward_view["scene"]["edges"]))
        self.assertTrue(any(edge["kind"] == "returns" for edge in forward_view["scene"]["edges"]))

    async def test_nested_loops_branches_and_comprehensions_are_nested_nodes(self) -> None:
        info = await self.service.handle("workbench.create", {"sourceFile": "model.py"})
        code = '''def scan(rows):
    total = 0
    for row in rows:
        for value in row:
            if value > 0:
                total += value
    positives = [value for row in rows for value in row if value > 0]
    return total, positives
'''
        await self.service.handle("workbench.write", {"path": info["path"], "content": code})
        result = await self.service.handle("analysis.analyze", {"path": info["path"], "view": "structure"})
        labels = [node["label"] for node in result["scene"]["nodes"]]
        self.assertTrue(any(label.startswith("for row in rows") for label in labels))
        self.assertTrue(any(label.startswith("for value in row") for label in labels))
        self.assertTrue(any(label.startswith("if value > 0") for label in labels))
        self.assertTrue(any(label.startswith("[value for row in rows") for label in labels))
        branches = [node for node in result["scene"]["nodes"] if node.get("card", {}).get("kind") == "branch"]
        self.assertTrue(branches)
        nested = [
            edge for edge in result["scene"]["edges"]
            if edge["kind"] == "nested"
        ]
        self.assertGreaterEqual(len(nested), 3)

    async def test_syntax_error_does_not_get_faked_as_structure(self) -> None:
        info = await self.service.handle("workbench.create", {"sourceFile": "model.py"})
        await self.service.handle("workbench.write", {"path": info["path"], "content": "def broken(:\n    pass\n"})
        result = await self.service.handle("analysis.analyze", {"path": info["path"]})
        self.assertIn("SyntaxError", result["error"])
        self.assertEqual(result["scene"]["nodes"], [])
        self.assertEqual(result["coverage"]["state"], "unknown")

    @unittest.skipUnless(shutil.which("node"), "Node.js is required for the TypeScript analyzer")
    async def test_typescript_views_use_real_compiler_ast(self) -> None:
        (self.root / "fixture.ts").write_text(
            """import { Component } from '@angular/core';

class TensorPath {
  scale: number = 2;
  constructor(values: number[]) { this.values = values; this.total = 0; }
  score(): number { let result = 0; for (const value of this.values) { result += value * this.scale; } return result; }
}

function build(values: number[]): number { const path = new TensorPath(values); return path.score(); }
""",
            encoding="utf-8",
        )
        overview = await self.service.handle("analysis.analyze", {"path": "fixture.ts", "view": "overview"})
        self.assertIsNone(overview.get("error"))
        self.assertEqual(overview["sourceFile"], "fixture.ts")
        self.assertIn("TensorPath", [node["label"] for node in overview["scene"]["nodes"]])
        structure = await self.service.handle("analysis.analyze", {"path": "fixture.ts", "view": "structure"})
        labels = [node["label"] for node in structure["scene"]["nodes"]]
        self.assertIn("scale", labels)
        self.assertIn("TensorPath.score", labels)
        self.assertNotIn("result", labels)
        focus_options = {option["label"]: option["id"] for option in structure["focusOptions"]}
        method = await self.service.handle(
            "analysis.analyze",
            {"path": "fixture.ts", "view": "structure", "focus": focus_options["TensorPath.score"]},
        )
        self.assertIn("result", [node["label"] for node in method["scene"]["nodes"]])

    async def test_workbench_create_is_stable_and_read_write_round_trips(self) -> None:
        first = await self.service.handle("workbench.create", {"sourceFile": "model.py"})
        second = await self.service.handle("workbench.create", {"sourceFile": "model.py"})
        self.assertEqual(first["path"], second["path"])
        await self.service.handle("workbench.write", {"path": first["path"], "content": first["content"] + "\n# note\n"})
        read = await self.service.handle("workbench.read", {"path": first["path"]})
        self.assertTrue(read["content"].endswith("# note\n"))


if __name__ == "__main__":
    unittest.main()