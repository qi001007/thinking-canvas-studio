"""Thinking Canvas Studio desktop entry: pywebview + loopback bridge."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

from studio_host.bridge_server import BridgeServer
from studio_host.host_service import HostService
from studio_host.static_server import StaticServer

REPO_ROOT = Path(__file__).resolve().parents[1]
DEV_ORIGIN = "http://127.0.0.1:5173"
LOCAL_ORIGIN = "http://localhost:5173"


class EventRelay:
    """Late-bound bridge sink; host services are created before the bridge."""

    def __init__(self) -> None:
        self.bridge: BridgeServer | None = None

    async def event(self, event: dict[str, Any]) -> None:
        if self.bridge is not None:
            await self.bridge.broadcast_event(event)

    async def console(self, line: dict[str, Any]) -> None:
        if self.bridge is not None:
            await self.bridge.broadcast_console(line)


class DesktopApi:
    """Only these methods are exposed to the renderer through pywebview."""

    def __init__(self, port: int, token: str) -> None:
        self._port = port
        self._token = token

    def bridge_info(self) -> dict[str, Any]:
        return {"port": self._port, "token": self._token, "mode": "desktop"}

    def app_info(self) -> dict[str, Any]:
        return {"name": "Thinking Canvas Studio", "version": "0.1.0", "mode": "desktop"}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Thinking Canvas Studio")
    parser.add_argument("--dev", action="store_true", help="load the Vite dev server instead of frontend/dist")
    parser.add_argument("--smoke", action="store_true", help="start local services and verify host startup without a window")
    parser.add_argument("--workspace", type=Path, default=None, help="workspace directory")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    workspace = args.workspace
    if args.smoke:
        with tempfile.TemporaryDirectory(prefix="studio-smoke-") as temp:
            return _run_smoke(Path(temp))
    if workspace is None:
        workspace = REPO_ROOT / "workspace"
    workspace = workspace.expanduser().resolve()
    workspace.mkdir(parents=True, exist_ok=True)

    static_server: StaticServer | None = None
    if args.dev:
        url = f"{DEV_ORIGIN}/?desktop=1"
        allowed_origins = [DEV_ORIGIN, LOCAL_ORIGIN]
    else:
        try:
            static_server = StaticServer(REPO_ROOT / "frontend" / "dist")
        except FileNotFoundError as exc:
            print(f"{exc}", file=sys.stderr)
            print("Run `npm run build` first, or start with `--dev` while Vite is running.", file=sys.stderr)
            return 2
        static_server.start()
        url = static_server.url
        allowed_origins = [static_server.origin]

    relay = EventRelay()
    service = HostService(workspace, REPO_ROOT / "languages", relay.event, relay.console)
    bridge = BridgeServer(service, allowed_origins=allowed_origins)
    relay.bridge = bridge
    bridge.start()
    if bridge.port == 0:
        print("bridge failed to bind a loopback port", file=sys.stderr)
        if static_server is not None:
            static_server.stop()
        return 3

    print(f"workspace: {workspace}")
    print(f"renderer:  {url}")
    print(f"bridge:    ws://127.0.0.1:{bridge.port}/bridge")

    try:
        import webview
    except ImportError:
        print("pywebview is not installed; install desktop/requirements.txt", file=sys.stderr)
        bridge.stop()
        if static_server is not None:
            static_server.stop()
        return 4

    icon = REPO_ROOT / "desktop" / "app.ico"
    storage = REPO_ROOT / ".studio-local" / "webview"
    storage.mkdir(parents=True, exist_ok=True)
    webview.create_window(
        "Thinking Canvas Studio",
        url,
        js_api=DesktopApi(bridge.port, bridge.token),
        width=1450,
        height=900,
        min_size=(1100, 700),
        background_color="#f6f4ef",
    )
    try:
        webview.start(
            debug=False,
            private_mode=False,
            storage_path=str(storage),
            icon=str(icon) if icon.is_file() else None,
        )
    finally:
        bridge.stop()
        if static_server is not None:
            static_server.stop()
    return 0


def _run_smoke(workspace: Path) -> int:
    relay = EventRelay()
    service = HostService(workspace, REPO_ROOT / "languages", relay.event, relay.console)
    bridge = BridgeServer(service)
    relay.bridge = bridge
    bridge.start()
    try:
        info = asyncio.run(service.handle("app.info", {}))
        files = asyncio.run(service.handle("workspace.list", {}))
        print(json.dumps({
            "ok": bridge.port > 0,
            "info": info,
            "files": [item["path"] for item in files],
            "bridgePort": bridge.port,
        }, ensure_ascii=False))
        return 0
    finally:
        bridge.stop()


if __name__ == "__main__":
    raise SystemExit(main())