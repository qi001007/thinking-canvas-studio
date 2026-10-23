from __future__ import annotations

import asyncio
import unittest

from studio_host.debug_service import DemoDebugService


class DemoDebugServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.frames: asyncio.Queue[dict] = asyncio.Queue()
        self.events: list[dict] = []
        self.console: list[dict] = []

        async def on_event(event: dict) -> None:
            self.events.append(event)
            if event.get("type") == "framesLoaded":
                await self.frames.put(event)

        async def on_console(line: dict) -> None:
            self.console.append(line)

        self.service = DemoDebugService(on_event, on_console)

    async def asyncTearDown(self) -> None:
        await self.service.stop()

    async def test_start_step_and_stop_without_executing_user_code(self) -> None:
        result = await self.service.start()
        self.assertEqual(result["threadId"], "1")
        first = await asyncio.wait_for(self.frames.get(), timeout=3)
        self.assertEqual(first["stopEpoch"], 1)
        self.assertEqual(first["label"], "初始状态")
        frame = first["frames"][0]
        self.assertEqual(frame["name"], "bubble_sort")
        self.assertEqual(frame["scopes"][0]["values"][0]["value"], "[5, 1, 4, 2]")

        await self.service.step("over")
        second = await asyncio.wait_for(self.frames.get(), timeout=3)
        self.assertEqual(second["stopEpoch"], 3)
        self.assertEqual(second["label"], "比较 5 与 1")
        seen = next(value for value in second["frames"][0]["scopes"][0]["values"] if value["name"] == "seen")
        self.assertEqual(len(seen["children"]), 1)
        self.assertEqual(seen["children"][0]["name"], "5")

        await self.service.stop()
        self.assertTrue(any(event.get("type") == "runEnded" for event in self.events))
        self.assertTrue(any("没有执行用户代码" in line["text"] for line in self.console))


if __name__ == "__main__":
    unittest.main()