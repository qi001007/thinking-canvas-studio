from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from studio_host.language_packages import LanguagePackageError, load_language_packages


class LanguagePackageTests(unittest.TestCase):
    def test_loads_declarative_packages(self) -> None:
        packages = load_language_packages(Path(__file__).resolve().parents[3] / "languages")
        self.assertEqual({item.id for item in packages}, {"python", "cpp", "typescript", "java"})
        python = next(item for item in packages if item.id == "python")
        self.assertEqual(python.adapter, "debugpy")
        self.assertEqual(python.status, "demo")
        self.assertIn(".py", python.extensions)
        self.assertIn("program", python.launch)

    def test_rejects_empty_language_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(LanguagePackageError):
                load_language_packages(Path(temp))


if __name__ == "__main__":
    unittest.main()