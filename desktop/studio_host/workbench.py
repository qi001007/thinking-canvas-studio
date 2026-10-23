"""Isolated Python workbench with inherited source-module context."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .workspace import WorkspaceError, WorkspaceStore

WORKBENCH_DIR = ".thinking-canvas/workbench"
WORKBENCH_EXTENSIONS = {".py": "python"}


@dataclass(frozen=True, slots=True)
class WorkbenchInfo:
    path: str
    source_file: str
    language: str
    content: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "sourceFile": self.source_file,
            "language": self.language,
            "content": self.content,
        }


class WorkbenchStore:
    def __init__(self, workspace: WorkspaceStore) -> None:
        self._workspace = workspace
        self._root = workspace.root_path / WORKBENCH_DIR
        self._root.mkdir(parents=True, exist_ok=True)

    def create(self, source_relative: str) -> WorkbenchInfo:
        source = self._workspace.resolve_file(source_relative)
        language = WORKBENCH_EXTENSIONS.get(source.suffix.lower())
        if language is None:
            raise WorkspaceError("workbench is currently available for Python files")
        digest = hashlib.sha256(source_relative.encode("utf-8")).hexdigest()[:8]
        stem = _safe_stem(source.stem)
        name = f"{stem}-{digest}.py"
        path = self._root / name
        meta_path = self._root / f"{stem}-{digest}.json"
        if path.is_file() and meta_path.is_file():
            meta = self._read_meta(meta_path)
            return WorkbenchInfo(
                path=f"{WORKBENCH_DIR}/{name}",
                source_file=str(meta.get("sourceFile", source_relative)),
                language=language,
                content=path.read_text(encoding="utf-8"),
            )
        context_name = f"tc_context_{digest}"
        context_path = self._root / f"{context_name}.py"
        if not context_path.is_file():
            context_path.write_text(_context_source(source, self._workspace.root_path), encoding="utf-8")
        content = _template(source.name, context_name)
        path.write_text(content, encoding="utf-8")
        meta_path.write_text(json.dumps({
            "sourceFile": source_relative,
            "language": language,
            "createdAt": _now(),
            "path": f"{WORKBENCH_DIR}/{name}",
            "contextModule": context_name,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return WorkbenchInfo(
            path=f"{WORKBENCH_DIR}/{name}",
            source_file=source_relative,
            language=language,
            content=content,
        )

    def info(self, workbench_path: str) -> WorkbenchInfo:
        relative = self._resolve_workbench(workbench_path)
        path = self._workspace.root_path / relative
        if not path.is_file():
            raise WorkspaceError("workbench file not found")
        meta_path = self._meta_for(relative)
        meta = self._read_meta(meta_path)
        return WorkbenchInfo(
            path=relative,
            source_file=str(meta.get("sourceFile", "")),
            language=str(meta.get("language", "python")),
            content=path.read_text(encoding="utf-8"),
        )

    def read(self, workbench_path: str) -> str:
        relative = self._resolve_workbench(workbench_path)
        path = self._workspace.root_path / relative
        if not path.is_file():
            raise WorkspaceError("workbench file not found")
        return path.read_text(encoding="utf-8")

    def write(self, workbench_path: str, content: str) -> None:
        relative = self._resolve_workbench(workbench_path)
        path = self._workspace.root_path / relative
        if not path.is_file():
            raise WorkspaceError("workbench file not found")
        if len(content.encode("utf-8")) > self._workspace.max_text_bytes:
            raise WorkspaceError("workbench exceeds the text size limit")
        path.write_text(content, encoding="utf-8")

    def source_path(self, workbench_path: str) -> Path | None:
        info = self.info(workbench_path)
        if not info.source_file:
            return None
        try:
            return self._workspace.resolve_file(info.source_file)
        except WorkspaceError:
            return None

    def resolve_program(self, relative_path: str) -> Path:
        normalized = relative_path.replace("\\", "/")
        if normalized.startswith(WORKBENCH_DIR + "/"):
            relative = self._resolve_workbench(normalized)
            path = self._workspace.root_path / relative
            if not path.is_file():
                raise WorkspaceError("workbench file not found")
            return path
        return self._workspace.resolve_file(relative_path)

    def _resolve_workbench(self, workbench_path: str) -> str:
        normalized = workbench_path.replace("\\", "/")
        if not normalized.startswith(WORKBENCH_DIR + "/"):
            raise WorkspaceError("not a workbench path")
        name = normalized[len(WORKBENCH_DIR) + 1:]
        if not name or "/" in name or "\\" in name or ".." in name or not name.endswith(".py"):
            raise WorkspaceError("invalid workbench path")
        return f"{WORKBENCH_DIR}/{name}"

    def _meta_for(self, relative: str) -> Path:
        path = Path(relative)
        return self._root / f"{path.stem}.json"

    @staticmethod
    def _read_meta(path: Path) -> dict[str, Any]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise WorkspaceError(f"invalid workbench metadata: {exc}") from exc
        if not isinstance(value, dict):
            raise WorkspaceError("invalid workbench metadata")
        return value


def _template(source_name: str, context_module: str) -> str:
    return f'''# 函数工作台 · 继承自 {source_name}
# 上下文由隐藏的 {context_module}.py 提供；这里只写你的函数/类。
from {context_module} import *  # noqa: F401,F403


# 保存后，右侧画布会显示这里的结构。
# 例如：
# def my_function(values: list[float]) -> float:
#     total = 0
#     for value in values:
#         total += value
#     return total


if __name__ == "__main__":
    # 在这里写测试输入，然后点“真实运行”。
    # 例如：print(my_function([1, 2, 3]))
    pass
'''


def _context_source(source: Path, workspace_root: Path) -> str:
    source_literal = json.dumps(str(source.resolve()), ensure_ascii=False)
    root_literal = json.dumps(str(workspace_root.resolve()), ensure_ascii=False)
    return f'''# 自动生成：加载源文件的 import / 顶层定义，供函数工作台继承。
import importlib.util as _tc_importlib
import sys as _tc_sys
from pathlib import Path as _tc_Path

_tc_source = _tc_Path({source_literal})
_tc_sys.path.insert(0, {root_literal})
_tc_sys.path.insert(0, str(_tc_source.parent))
_tc_spec = _tc_importlib.spec_from_file_location("__tc_source__", _tc_source)
if _tc_spec is None or _tc_spec.loader is None:
    raise RuntimeError("无法加载源文件上下文: " + str(_tc_source))
_tc_context = _tc_importlib.module_from_spec(_tc_spec)
_tc_spec.loader.exec_module(_tc_context)
__all__ = [key for key in vars(_tc_context) if not key.startswith("__")]
globals().update({{key: vars(_tc_context)[key] for key in __all__}})
'''


def _safe_stem(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._")
    return cleaned or "workbench"


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()