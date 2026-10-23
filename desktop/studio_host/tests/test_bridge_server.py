from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from websockets.exceptions import ConnectionClosed

from studio_host.bridge_server import BridgeServer
from studio_host.host_service import HostService


class Relay:
    def __init__(self) -> None:
        self.bridge: BridgeServer | None = None

    async def event(self, event: dict) -> None:
        if self.bridge is not None:
            await self.bridge.broadcast_event(event)

    async def console(self, line: dict) -> None:
        if self.bridge is not None:
            await self.bridge.broadcast_console(line)


class BridgeServerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.relay = Relay()
        self.service = HostService(
            Path(self.temp.name),
            Path(__file__).resolve().parents[3] / "languages",
            self.relay.event,
            self.relay.console,
        )
        self.bridge = BridgeServer(self.service)
        self.relay.bridge = self.bridge
        self.bridge.start()
        self.assertTrue(self.bridge.port)

    async def asyncTearDown(self) -> None:
        self.bridge.stop()
        self.temp.cleanup()

    async def connect(self):
        import websockets
        return await websockets.connect(f"ws://127.0.0.1:{self.bridge.port}/bridge")

    async def authenticate(self, ws) -> None:
        await ws.send(json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "bridge.authenticate",
            "params": {"token": self.bridge.token},
        }))
        reply = json.loads(await asyncio.wait_for(ws.recv(), timeout=3))
        self.assertTrue(reply["result"]["authenticated"])

    async def test_wrong_token_is_closed(self) -> None:
        ws = await self.connect()
        await ws.send(json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "bridge.authenticate",
            "params": {"token": "wrong"},
        }))
        with self.assertRaises(ConnectionClosed):
            await asyncio.wait_for(ws.recv(), timeout=3)
        await ws.close()

    async def test_rpc_and_scripted_debug_events(self) -> None:
        ws = await self.connect()
        try:
            await self.authenticate(ws)
            await ws.send(json.dumps({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "app.info",
                "params": {},
            }))
            reply = json.loads(await asyncio.wait_for(ws.recv(), timeout=3))
            self.assertEqual(reply["result"]["mode"], "desktop")

            await ws.send(json.dumps({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "debug.start",
                "params": {},
            }))
            first = await self.wait_for_frames(ws)
            self.assertEqual(first["stopEpoch"], 1)
            self.assertEqual(first["frames"][0]["scopes"][0]["values"][0]["value"], "[5, 1, 4, 2]")

            await ws.send(json.dumps({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "debug.step",
                "params": {"threadId": "1", "kind": "over"},
            }))
            second = await self.wait_for_frames(ws)
            self.assertEqual(second["stopEpoch"], 3)
            self.assertEqual(second["label"], "比较 5 与 1")
            seen = next(value for value in second["frames"][0]["scopes"][0]["values"] if value["name"] == "seen")
            self.assertEqual(seen["children"][0]["name"], "5")
        finally:
            await ws.close()

    async def wait_for_frames(self, ws) -> dict:
        for _ in range(20):
            raw = await asyncio.wait_for(ws.recv(), timeout=3)
            message = json.loads(raw)
            if message.get("method") == "debug.event" and message["params"].get("type") == "framesLoaded":
                return message["params"]
        self.fail("framesLoaded event was not received")


if __name__ == "__main__":
    unittest.main()