from __future__ import annotations

import asyncio
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
        result = await self.service.handle("analysis.analyze", {"path": info["path"]})
        self.assertEqual(result["coverage"]["state"], "complete")
        self.assertGreaterEqual(result["stats"]["functions"], 3)
        self.assertEqual(result["stats"]["classes"], 2)
        nodes = result["scene"]["nodes"]
        edges = result["scene"]["edges"]
        by_label = {node["label"]: node for node in nodes}
        self.assertIn("Layer", by_label)
        self.assertIn("继承 · model.py", by_label)
        self.assertEqual(by_label["Layer"]["card"]["kind"], "class")
        self.assertIn("Base", [node["label"] for node in nodes])
        self.assertTrue(any(edge["kind"] == "inherits" and edge.get("label") == "Base" for edge in edges))
        self.assertTrue(any(edge["kind"] == "calls" and edge.get("label") == "helper" for edge in edges))
        self.assertTrue(any(edge["kind"] == "imports" for edge in edges))
        self.assertTrue(any(edge["kind"] == "iterates" for edge in edges))
        self.assertTrue(any(edge["kind"] == "returns" for edge in edges))

    async def test_syntax_error_does_not_get_faked_as_structure(self) -> None:
        info = await self.service.handle("workbench.create", {"sourceFile": "model.py"})
        await self.service.handle("workbench.write", {"path": info["path"], "content": "def broken(:\n    pass\n"})
        result = await self.service.handle("analysis.analyze", {"path": info["path"]})
        self.assertIn("SyntaxError", result["error"])
        self.assertEqual(result["scene"]["nodes"], [])
        self.assertEqual(result["coverage"]["state"], "unknown")

    async def test_workbench_create_is_stable_and_read_write_round_trips(self) -> None:
        first = await self.service.handle("workbench.create", {"sourceFile": "model.py"})
        second = await self.service.handle("workbench.create", {"sourceFile": "model.py"})
        self.assertEqual(first["path"], second["path"])
        await self.service.handle("workbench.write", {"path": first["path"], "content": first["content"] + "\n# note\n"})
        read = await self.service.handle("workbench.read", {"path": first["path"]})
        self.assertTrue(read["content"].endswith("# note\n"))


if __name__ == "__main__":
    unittest.main()