from __future__ import annotations

import asyncio
import importlib.metadata
import sys
import tempfile
import unittest
from pathlib import Path

from studio_host.host_service import HostService


def _debugpy_available() -> bool:
    try:
        importlib.metadata.version("debugpy")
        return True
    except importlib.metadata.PackageNotFoundError:
        return False


@unittest.skipUnless(sys.platform == "win32", "real debugpy test currently targets Windows Job Object")
@unittest.skipUnless(_debugpy_available(), "debugpy is not installed in the host interpreter")
class RealDebugServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="studio-real-test-")
        self.root = Path(self.temp.name)
        (self.root / "fixture.py").write_text(
            "def accumulate(nums):\n"
            "    total = 0\n"
            "    for value in nums:\n"
            "        total += value\n"
            "    return total\n"
            "\n"
            "if __name__ == '__main__':\n"
            "    print(accumulate([1, 2, 3]))\n",
            encoding="utf-8",
        )
        self.frames: asyncio.Queue[dict] = asyncio.Queue()
        self.events: list[dict] = []

        async def on_event(event: dict) -> None:
            self.events.append(event)
            if event.get("type") == "framesLoaded":
                await self.frames.put(event)

        async def on_console(line: dict) -> None:
            self.events.append({"console": line})

        self.service = HostService(
            self.root,
            Path(__file__).resolve().parents[3] / "languages",
            on_event,
            on_console,
        )

    async def asyncTearDown(self) -> None:
        await self.service.close()
        self.temp.cleanup()

    async def test_real_debugpy_stops_steps_and_cleans_up(self) -> None:
        approval = self.service.issue_run_approval("fixture.py", [4])
        result = await self.service.handle("debug.startReal", {
            "receiptId": approval["receiptId"],
            "program": "fixture.py",
            "breakpoints": [4],
        })
        self.assertFalse(result["scripted"])
        first = await asyncio.wait_for(self.frames.get(), timeout=20)
        self.assertEqual(first["stopEpoch"], 1)
        self.assertEqual(first["coverage"]["state"], "complete")
        frame = first["frames"][0]
        self.assertEqual(frame["name"], "accumulate")
        self.assertEqual(frame["line"], 4)
        values = {value["name"]: value for value in frame["scopes"][0]["values"]}
        self.assertEqual(values["nums"]["value"], "[1, 2, 3]")
        self.assertEqual(len(values["nums"]["children"]), 3)
        self.assertEqual(values["total"]["value"], "0")

        await self.service.handle("debug.step", {"threadId": "1", "kind": "over"})
        second = await asyncio.wait_for(self.frames.get(), timeout=20)
        self.assertEqual(second["stopEpoch"], 3)
        values2 = {value["name"]: value for value in second["frames"][0]["scopes"][0]["values"]}
        self.assertEqual(values2["total"]["value"], "1")

        await self.service.handle("debug.stop", {})
        self.assertTrue(any(event.get("type") == "runEnded" for event in self.events))

    async def test_record_mode_builds_a_complete_frame_timeline(self) -> None:
        approval = self.service.issue_run_approval("fixture.py", [], "record")
        result = await self.service.handle("debug.startReal", {
            "receiptId": approval["receiptId"],
            "program": "fixture.py",
            "breakpoints": [],
            "mode": "record",
        })
        self.assertEqual(result["mode"], "record")
        frames = []
        for _ in range(30):
            try:
                frames.append(await asyncio.wait_for(self.frames.get(), timeout=0.8))
            except asyncio.TimeoutError:
                break
            if any(event.get("type") == "runEnded" for event in self.events):
                break
        self.assertGreaterEqual(len(frames), 5)
        self.assertTrue(frames[0]["label"].startswith("第 1 帧"))
        lines = [frame["frames"][0].get("line") for frame in frames if frame["frames"]]
        self.assertIn(2, lines)
        self.assertIn(4, lines)
        self.assertTrue(any(event.get("type") == "runEnded" for event in self.events))


if __name__ == "__main__":
    unittest.main()