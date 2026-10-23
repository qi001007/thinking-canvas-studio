"""Windows Job Object supervisor for real adapter processes.

Limits are applied by the OS. The wall timeout is enforced by this host.
"""

from __future__ import annotations

import asyncio
import ctypes
import os
import socket
import subprocess
import sys
import threading
import time
from collections import deque
from ctypes import wintypes
from pathlib import Path
from typing import Any

from .ports import AdapterTransport, ExecutionSpec, ResourceLimits
from .socket_transport import SocketAdapterTransport, connect_loopback

if sys.platform == "win32":
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _LARGE_INTEGER = ctypes.c_longlong
    _SIZE_T = ctypes.c_size_t
    _ULONG_PTR = ctypes.c_size_t

    class _IO_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_ulonglong),
            ("WriteOperationCount", ctypes.c_ulonglong),
            ("OtherOperationCount", ctypes.c_ulonglong),
            ("ReadTransferCount", ctypes.c_ulonglong),
            ("WriteTransferCount", ctypes.c_ulonglong),
            ("OtherTransferCount", ctypes.c_ulonglong),
        ]

    class _JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", _LARGE_INTEGER),
            ("PerJobUserTimeLimit", _LARGE_INTEGER),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", _SIZE_T),
            ("MaximumWorkingSetSize", _SIZE_T),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", _ULONG_PTR),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class _JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", _JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", _IO_COUNTERS),
            ("ProcessMemoryLimit", _SIZE_T),
            ("JobMemoryLimit", _SIZE_T),
            ("PeakProcessMemoryUsed", _SIZE_T),
            ("PeakJobMemoryUsed", _SIZE_T),
        ]

    _kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    _kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    _kernel32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    _kernel32.SetInformationJobObject.restype = wintypes.BOOL
    _kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    _kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
    _kernel32.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
    _kernel32.TerminateJobObject.restype = wintypes.BOOL
    _kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    _kernel32.CloseHandle.restype = wintypes.BOOL

    _JOB_OBJECT_LIMIT_PROCESS_TIME = 0x00000002
    _JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008
    _JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100
    _JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200
    _JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
    _JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9


class SupervisorError(RuntimeError):
    """The target could not be launched under OS-enforced limits."""


class WindowsJobObjectSupervisor:
    """Starts debugpy in a Job Object; refuses to report success without limits."""

    def __init__(self, *, startup_timeout: float = 12.0) -> None:
        self._startup_timeout = startup_timeout
        self._job: int | None = None
        self._process: subprocess.Popen[bytes] | None = None
        self._transport: SocketAdapterTransport | None = None
        self._timer: threading.Timer | None = None
        self._log: deque[str] = deque(maxlen=80)
        self._timed_out = False
        self._lock = threading.Lock()

    def enforces(self, limits: ResourceLimits) -> bool:
        if sys.platform != "win32":
            return False
        job = self._create_job(limits)
        if job is None:
            return False
        _kernel32.CloseHandle(job)
        return True

    @property
    def timed_out(self) -> bool:
        return self._timed_out

    def log_tail(self) -> str:
        return "\n".join(self._log)

    async def launch(self, spec: ExecutionSpec) -> AdapterTransport:
        if sys.platform != "win32":
            raise SupervisorError("Windows Job Object supervisor is unavailable on this platform")
        with self._lock:
            if self._process is not None:
                raise SupervisorError("a supervised target is already running")
        job = self._create_job(spec.limits)
        if job is None:
            raise SupervisorError("could not create a Job Object with the requested limits")
        try:
            port = _free_port()
            command = _debugpy_command(spec, port)
            environment = os.environ.copy()
            environment["PYTHONUNBUFFERED"] = "1"
            environment["PYDEVD_DISABLE_FILE_VALIDATION"] = "1"
            creation_flags = 0
            if hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
                creation_flags |= subprocess.CREATE_NEW_PROCESS_GROUP
            if hasattr(subprocess, "CREATE_NO_WINDOW"):
                creation_flags |= subprocess.CREATE_NO_WINDOW
            process = subprocess.Popen(
                command,
                cwd=str(spec.workspace),
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=creation_flags,
            )
            try:
                assigned = _kernel32.AssignProcessToJobObject(job, int(process._handle))  # type: ignore[attr-defined]
            except (AttributeError, OSError) as exc:
                process.kill()
                _close_pipes(process)
                raise SupervisorError(f"could not assign target to Job Object: {exc}") from exc
            if not assigned:
                process.kill()
                _close_pipes(process)
                raise SupervisorError(f"AssignProcessToJobObject failed: {ctypes.get_last_error()}")
            _start_drain(process.stdout, self._log)
            _start_drain(process.stderr, self._log)
            transport = await self._connect_with_retry(port, process)
            timer = threading.Timer(spec.limits.timeout_seconds, self._on_timeout, args=(job,))
            timer.daemon = True
            timer.start()
            with self._lock:
                self._job = job
                self._process = process
                self._transport = transport
                self._timer = timer
                self._timed_out = False
            return transport
        except Exception:
            _kernel32.TerminateJobObject(job, 1)
            _kernel32.CloseHandle(job)
            raise

    async def attach(self, spec: ExecutionSpec) -> AdapterTransport:
        raise SupervisorError("attach is not implemented; use launch")

    async def terminate(self, transport: AdapterTransport) -> None:
        with self._lock:
            timer = self._timer
            job = self._job
            process = self._process
            current = self._transport
            self._timer = None
            self._job = None
            self._process = None
            self._transport = None
        if timer is not None:
            timer.cancel()
        if current is not None and current is not transport:
            await current.close()
        try:
            await transport.close()
        except (ConnectionError, OSError):
            pass
        if job is not None:
            _kernel32.TerminateJobObject(job, 1)
            _kernel32.CloseHandle(job)
        if process is not None:
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
            _close_pipes(process)

    def _create_job(self, limits: ResourceLimits) -> int | None:
        if sys.platform != "win32":
            return None
        job = _kernel32.CreateJobObjectW(None, None)
        if not job:
            return None
        info = _JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = (
            _JOB_OBJECT_LIMIT_PROCESS_TIME
            | _JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | _JOB_OBJECT_LIMIT_PROCESS_MEMORY
            | _JOB_OBJECT_LIMIT_JOB_MEMORY
            | _JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        )
        info.BasicLimitInformation.PerProcessUserTimeLimit = int(limits.cpu_seconds * 10_000_000)
        info.BasicLimitInformation.ActiveProcessLimit = limits.process_count
        info.ProcessMemoryLimit = limits.memory_bytes
        info.JobMemoryLimit = limits.memory_bytes
        ok = _kernel32.SetInformationJobObject(
            job,
            _JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
            ctypes.byref(info),
            ctypes.sizeof(info),
        )
        if not ok:
            _kernel32.CloseHandle(job)
            return None
        return int(job)

    async def _connect_with_retry(self, port: int, process: subprocess.Popen[bytes]) -> SocketAdapterTransport:
        deadline = time.monotonic() + self._startup_timeout
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise SupervisorError(f"debugpy exited during startup: {self.log_tail()}")
            try:
                return await connect_loopback(port, timeout=0.8)
            except (ConnectionError, OSError, asyncio.TimeoutError):
                await asyncio.sleep(0.06)
        raise SupervisorError(f"debugpy did not accept a DAP connection: {self.log_tail()}")

    def _on_timeout(self, job: int) -> None:
        self._timed_out = True
        try:
            _kernel32.TerminateJobObject(job, 124)
        except OSError:
            pass


def _debugpy_command(spec: ExecutionSpec, port: int) -> list[str]:
    config = spec.launch_config
    interpreter = config.get("interpreter")
    program = config.get("program")
    arguments = config.get("args", [])
    if not isinstance(interpreter, str) or not Path(interpreter).is_file():
        raise SupervisorError("interpreter must be an existing executable")
    if not isinstance(program, str) or not Path(program).is_file():
        raise SupervisorError("program must be an existing file")
    if not isinstance(arguments, list) or not all(isinstance(item, str) for item in arguments):
        raise SupervisorError("args must be a list of strings")
    return [
        interpreter,
        "-Xfrozen_modules=off",
        "-m",
        "debugpy",
        "--listen",
        f"127.0.0.1:{port}",
        "--wait-for-client",
        program,
        *[str(item) for item in arguments],
    ]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _close_pipes(process: subprocess.Popen[bytes]) -> None:
    for stream in (process.stdout, process.stderr):
        try:
            if stream is not None:
                stream.close()
        except (OSError, ValueError):
            pass


def _start_drain(stream: Any, target: deque[str]) -> None:
    if stream is None:
        return

    def run() -> None:
        try:
            for raw in iter(stream.readline, b""):
                line = raw.decode("utf-8", "replace").rstrip()
                if line:
                    target.append(line)
        except (OSError, ValueError):
            pass

    threading.Thread(target=run, daemon=True).start()