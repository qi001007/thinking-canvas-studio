"""Loopback WebSocket JSON-RPC bridge with token authentication."""

from __future__ import annotations

import asyncio
import hmac
import json
import secrets
import threading
import time
from collections.abc import Sequence
from typing import Any

from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from .bridge_contract import BridgeContract, BridgeContractError
from .host_service import HostService, RpcError
from .workspace import WorkspaceError

ALLOWED_METHODS = frozenset({
    "bridge.authenticate",
    "app.info",
    "languages.list",
    "workspace.list",
    "workbench.create",
    "workbench.info",
    "workbench.read",
    "workbench.write",
    "analysis.analyze",
    "workspace.readText",
    "workspace.writeText",
    "boards.load",
    "boards.save",
    "debug.start",
    "debug.startReal",
    "debug.stop",
    "debug.continue",
    "debug.step",
    "debug.pause",
    "debug.stackFrames",
    "debug.scopes",
    "debug.variables",
})


class BridgeServer:
    def __init__(
        self,
        host: HostService,
        *,
        allowed_origins: Sequence[str] = (),
        token: str | None = None,
        host_name: str = "127.0.0.1",
    ) -> None:
        if host_name not in {"127.0.0.1", "::1", "localhost"}:
            raise ValueError("the bridge must bind to loopback")
        self._host = host
        self._token = token or secrets.token_urlsafe(32)
        self._allowed_origins = tuple(allowed_origins) if allowed_origins else None
        self._host_name = host_name
        self._contract = BridgeContract(ALLOWED_METHODS)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop_event: asyncio.Event | None = None
        self._ready = threading.Event()
        self._thread: threading.Thread | None = None
        self._clients: set[ServerConnection] = set()
        self.port = 0

    @property
    def token(self) -> str:
        return self._token

    def start(self, timeout: float = 8.0) -> None:
        if self._thread is not None:
            raise RuntimeError("bridge server already started")
        self._thread = threading.Thread(target=self._run, name="studio-bridge", daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout):
            raise RuntimeError("bridge server did not start in time")

    def stop(self, timeout: float = 5.0) -> None:
        loop = self._loop
        thread = self._thread
        if loop is None or thread is None:
            return
        asyncio.run_coroutine_threadsafe(self._shutdown(), loop)
        thread.join(timeout)
        self._thread = None
        self._loop = None

    def _run(self) -> None:
        try:
            asyncio.run(self._serve())
        except Exception:
            self._ready.set()

    async def _serve(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._stop_event = asyncio.Event()
        async with serve(
            self._handle_connection,
            self._host_name,
            0,
            origins=self._allowed_origins,
            max_size=2 * 1024 * 1024,
            compression=None,
            ping_interval=20,
            ping_timeout=20,
        ) as server:
            sockets = server.sockets
            self.port = int(sockets[0].getsockname()[1])
            self._ready.set()
            await self._stop_event.wait()
            await self._host.close()

    async def _shutdown(self) -> None:
        if self._stop_event is not None:
            self._stop_event.set()

    async def _handle_connection(self, websocket: ServerConnection) -> None:
        authenticated = False
        try:
            async for raw in websocket:
                if not isinstance(raw, str):
                    await self._error(websocket, None, -32600, "binary messages are not supported")
                    continue
                try:
                    envelope = json.loads(raw)
                except json.JSONDecodeError:
                    await self._error(websocket, None, -32700, "invalid JSON")
                    continue
                if not authenticated:
                    authenticated = await self._authenticate(websocket, envelope)
                    if not authenticated:
                        await websocket.close(code=1008, reason="unauthorized")
                        return
                    continue
                try:
                    request_id, method, params = self._contract.validate_request(envelope)
                except BridgeContractError as exc:
                    await self._error(websocket, None, -32600, str(exc))
                    continue
                if not isinstance(params, dict):
                    await self._error(websocket, request_id, -32602, "params must be an object")
                    continue
                try:
                    result = await self._host.handle(method, params)
                    await websocket.send(json.dumps({
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "result": result,
                    }, ensure_ascii=False))
                except RpcError as exc:
                    await self._error(websocket, request_id, exc.code, exc.message)
                except WorkspaceError as exc:
                    await self._error(websocket, request_id, -32602, str(exc))
                except Exception as exc:
                    await self._error(websocket, request_id, -32603, str(exc))
        except ConnectionClosed:
            pass
        finally:
            self._clients.discard(websocket)

    async def _authenticate(self, websocket: ServerConnection, envelope: object) -> bool:
        if not isinstance(envelope, dict):
            return False
        if envelope.get("jsonrpc") != "2.0":
            return False
        if envelope.get("method") != "bridge.authenticate":
            return False
        params = envelope.get("params")
        token = params.get("token") if isinstance(params, dict) else None
        if not isinstance(token, str) or not hmac.compare_digest(token, self._token):
            return False
        self._clients.add(websocket)
        await websocket.send(json.dumps({
            "jsonrpc": "2.0",
            "id": envelope.get("id"),
            "result": {"authenticated": True, "serverTime": time.time()},
        }))
        return True

    async def _error(self, websocket: ServerConnection, request_id: object, code: int, message: str) -> None:
        try:
            await websocket.send(json.dumps({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": code, "message": message},
            }, ensure_ascii=False))
        except ConnectionClosed:
            pass

    async def broadcast_event(self, event: dict[str, Any]) -> None:
        await self._broadcast("debug.event", event)

    async def broadcast_console(self, line: dict[str, Any]) -> None:
        await self._broadcast("console.line", line)

    async def _broadcast(self, method: str, params: dict[str, Any]) -> None:
        payload = json.dumps({"jsonrpc": "2.0", "method": method, "params": params}, ensure_ascii=False)
        for websocket in list(self._clients):
            try:
                await websocket.send(payload)
            except ConnectionClosed:
                self._clients.discard(websocket)
            except Exception:
                self._clients.discard(websocket)