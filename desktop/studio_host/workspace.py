"""Local workspace storage with strict relative paths and atomic writes."""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

SOURCE_EXTENSIONS = {
    ".py": "python",
    ".pyi": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".java": "java",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".md": "markdown",
    ".json": "json",
    ".css": "css",
    ".html": "html",
}

SKIP_DIRECTORIES = frozenset({".thinking-canvas", ".git", "__pycache__", "node_modules", ".venv"})


class WorkspaceError(ValueError):
    """Invalid path or content for the local workspace."""


@dataclass(slots=True)
class WorkspaceStore:
    root: Path
    max_text_bytes: int = 2 * 1024 * 1024
    _root: Path = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._root = Path(self.root).expanduser().resolve()
        self._root.mkdir(parents=True, exist_ok=True)
        for relative in ("boards", "traces", "layouts", "notes"):
            (self._root / ".thinking-canvas" / relative).mkdir(parents=True, exist_ok=True)

    @property
    def root_path(self) -> Path:
        return self._root

    def list_files(self) -> list[dict[str, str]]:
        files: list[dict[str, str]] = []
        for path in sorted(self._root.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(self._root)
            if any(part in SKIP_DIRECTORIES or part.startswith(".") for part in relative.parts):
                continue
            language = SOURCE_EXTENSIONS.get(path.suffix.lower())
            if language is None:
                continue
            files.append({
                "path": relative.as_posix(),
                "name": path.name,
                "kind": "file",
                "language": language,
            })
        return files

    def resolve_file(self, relative_path: str) -> Path:
        path = self._resolve(relative_path)
        if not path.is_file():
            raise WorkspaceError(f"file not found: {relative_path}")
        return path

    def read_text(self, relative_path: str) -> str:
        path = self._resolve(relative_path)
        if not path.is_file():
            raise WorkspaceError(f"file not found: {relative_path}")
        if path.stat().st_size > self.max_text_bytes:
            raise WorkspaceError("file exceeds the text size limit")
        return path.read_text(encoding="utf-8")

    def write_text(self, relative_path: str, content: str) -> None:
        if not isinstance(content, str):
            raise WorkspaceError("content must be text")
        encoded = content.encode("utf-8")
        if len(encoded) > self.max_text_bytes:
            raise WorkspaceError("content exceeds the text size limit")
        path = self._resolve(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, encoded)

    def load_board(self, name: str = "demo.json") -> dict[str, Any] | None:
        path = self._resolve(f".thinking-canvas/boards/{sanitize_name(name)}")
        if not path.is_file():
            return None
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise WorkspaceError(f"invalid board file: {exc}") from exc
        if not isinstance(value, dict) or not isinstance(value.get("scene"), dict):
            raise WorkspaceError("board file must contain a scene object")
        return value

    def save_board(self, board: dict[str, Any], name: str = "demo.json") -> None:
        if not isinstance(board, dict) or not isinstance(board.get("scene"), dict):
            raise WorkspaceError("board must contain a scene object")
        payload = json.dumps(board, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        path = self._resolve(f".thinking-canvas/boards/{sanitize_name(name)}")
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, payload)

    def ensure_demo_files(self) -> None:
        for relative, content in DEMO_FILES.items():
            path = self._resolve(relative)
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                atomic_write(path, content.encode("utf-8"))

    def _resolve(self, relative_path: str) -> Path:
        if not isinstance(relative_path, str) or not relative_path.strip():
            raise WorkspaceError("path must be a non-empty string")
        pure = PurePosixPath(relative_path.replace("\\", "/"))
        if (
            pure.is_absolute()
            or any(part in ("..", "") for part in pure.parts)
            or (pure.parts and pure.parts[0].endswith(":"))
        ):
            raise WorkspaceError("path must stay inside the workspace")
        if pure.parts and pure.parts[0] == ".thinking-canvas" and "boards" not in pure.parts:
            raise WorkspaceError("only board documents are exposed through the bridge")
        resolved = (self._root / Path(*pure.parts)).resolve()
        if not resolved.is_relative_to(self._root):
            raise WorkspaceError("path must stay inside the workspace")
        return resolved


def sanitize_name(name: str) -> str:
    if not isinstance(name, str) or not name or "/" in name or "\\" in name or name.startswith("."):
        raise WorkspaceError("board name is invalid")
    return name


def atomic_write(path: Path, payload: bytes) -> None:
    descriptor, temp_name = tempfile.mkstemp(prefix=".studio-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


DEMO_FILES: dict[str, str] = {
    "main.py": '''def bubble_sort(nums: list[int]) -> list[int]:
    n = len(nums)
    seen = {}
    for i in range(n - 1):
        swapped = False
        for j in range(n - 1 - i):
            seen[nums[j]] = j
            if nums[j] > nums[j + 1]:
                nums[j], nums[j + 1] = nums[j + 1], nums[j]
                swapped = True
        if not swapped:
            break
    return nums


if __name__ == "__main__":
    print(bubble_sort([5, 1, 4, 2]))
''',
    "two_sum.py": '''def two_sum(nums: list[int], target: int) -> list[int]:
    seen: dict[int, int] = {}
    for index, value in enumerate(nums):
        need = target - value
        if need in seen:
            return [seen[need], index]
        seen[value] = index
    return []


if __name__ == "__main__":
    print(two_sum([2, 7, 11, 15], 9))
''',
    "notes.md": "# 冒泡排序 · 第一轮\n\n- 不变量：j 扫过的位置已经有序。\n- 指针 i 表示当前轮次，j 表示当前比较位置。\n",
}