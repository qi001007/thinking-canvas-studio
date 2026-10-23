"""Loopback static server for the built renderer."""

from __future__ import annotations

import functools
import http.server
import threading
from pathlib import Path


class _Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def list_directory(self, path: str):  # type: ignore[override]
        self.send_error(404, "directory listing is disabled")
        return None

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, format: str, *args: object) -> None:
        return


class StaticServer:
    def __init__(self, directory: Path) -> None:
        root = Path(directory).resolve()
        if not (root / "index.html").is_file():
            raise FileNotFoundError(
                f"renderer build not found at {root}; run `npm run build` first"
            )
        handler = functools.partial(_Handler, directory=str(root))
        self._server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self._thread: threading.Thread | None = None
        self.port = int(self._server.server_address[1])

    @property
    def origin(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def url(self) -> str:
        return f"{self.origin}/?desktop=1"

    def start(self) -> None:
        if self._thread is not None:
            raise RuntimeError("static server already started")
        self._thread = threading.Thread(target=self._server.serve_forever, name="studio-static", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=3)
            self._thread = None