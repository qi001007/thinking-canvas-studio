from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

from studio_host.ports import ExecutionSpec, ResourceLimits
from studio_host.windows_supervisor import WindowsJobObjectSupervisor


@unittest.skipUnless(sys.platform == "win32", "Windows Job Object is Windows-only")
class WindowsSupervisorTests(unittest.TestCase):
    def test_job_object_accepts_requested_limits(self) -> None:
        supervisor = WindowsJobObjectSupervisor()
        limits = ResourceLimits(timeout_seconds=10, memory_bytes=256 * 1024 * 1024, cpu_seconds=10, process_count=4)
        self.assertTrue(supervisor.enforces(limits))


@unittest.skipUnless(sys.platform == "win32", "Windows Job Object is Windows-only")
class WindowsSupervisorTimeoutTests(unittest.IsolatedAsyncioTestCase):
    async def test_wall_timeout_terminates_the_job(self) -> None:
        with tempfile.TemporaryDirectory(prefix="studio-timeout-") as temp:
            root = Path(temp)
            program = root / "fixture.py"
            program.write_text("import time\nwhile True:\n    time.sleep(0.1)\n", encoding="utf-8")
            limits = ResourceLimits(timeout_seconds=1, memory_bytes=256 * 1024 * 1024, cpu_seconds=30, process_count=4)
            supervisor = WindowsJobObjectSupervisor()
            spec = ExecutionSpec(
                workspace=root,
                adapter_identity="python.debugpy",
                adapter_version="test",
                operation="launch",
                config_digest="0" * 64,
                limits=limits,
                session_id="timeout-test",
                launch_config={"interpreter": sys.executable, "program": str(program), "args": []},
            )
            transport = await supervisor.launch(spec)
            await asyncio.sleep(1.6)
            self.assertTrue(supervisor.timed_out)
            await supervisor.terminate(transport)


if __name__ == "__main__":
    unittest.main()