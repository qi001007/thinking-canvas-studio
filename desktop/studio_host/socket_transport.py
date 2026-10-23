"""DAP transport over a loopback TCP socket."""

from __future__ import annotations

import asyncio


class SocketAdapterTransport:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self._reader = reader
        self._writer = writer

    async def send(self, data: bytes) -> None:
        self._writer.write(data)
        await self._writer.drain()

    async def receive(self, max_bytes: int) -> bytes:
        return await self._reader.read(max_bytes)

    async def close(self) -> None:
        self._writer.close()
        try:
            await self._writer.wait_closed()
        except (ConnectionError, OSError):
            pass


async def connect_loopback(port: int, *, timeout: float = 10.0) -> SocketAdapterTransport:
    reader, writer = await asyncio.wait_for(
        asyncio.open_connection("127.0.0.1", port),
        timeout=timeout,
    )
    return SocketAdapterTransport(reader, writer)