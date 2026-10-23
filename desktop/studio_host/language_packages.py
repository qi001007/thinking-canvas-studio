"""Declarative language packages. Adapters are installed separately."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

VALID_STATUS = frozenset({"demo", "available", "not-installed"})


class LanguagePackageError(ValueError):
    """Invalid language package manifest."""


@dataclass(frozen=True, slots=True)
class LanguagePackage:
    id: str
    name: str
    extensions: tuple[str, ...]
    adapter: str
    status: str
    launch: dict[str, Any]
    notes: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "extensions": list(self.extensions),
            "adapter": self.adapter,
            "status": self.status,
            "launch": self.launch,
            "notes": self.notes,
        }


def load_language_packages(root: Path) -> list[LanguagePackage]:
    packages: list[LanguagePackage] = []
    for manifest in sorted(Path(root).glob("*/manifest.json")):
        try:
            value = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise LanguagePackageError(f"invalid manifest {manifest}: {exc}") from exc
        packages.append(_parse_manifest(value, manifest))
    if not packages:
        raise LanguagePackageError(f"no language manifests under {root}")
    return packages


def _parse_manifest(value: object, manifest: Path) -> LanguagePackage:
    if not isinstance(value, dict):
        raise LanguagePackageError(f"{manifest}: manifest must be an object")
    package_id = value.get("id")
    name = value.get("name")
    extensions = value.get("extensions")
    adapter = value.get("adapter")
    status = value.get("status")
    launch = value.get("launch")
    notes = value.get("notes", "")
    if not all(isinstance(item, str) and item.strip() for item in (package_id, name, adapter, status)):
        raise LanguagePackageError(f"{manifest}: id, name, adapter and status are required")
    if status not in VALID_STATUS:
        raise LanguagePackageError(f"{manifest}: unknown status {status!r}")
    if not isinstance(extensions, list) or not extensions or not all(isinstance(item, str) and item.startswith(".") for item in extensions):
        raise LanguagePackageError(f"{manifest}: extensions must be a non-empty list of suffixes")
    if not isinstance(launch, dict):
        raise LanguagePackageError(f"{manifest}: launch must be an object")
    if not isinstance(notes, str):
        raise LanguagePackageError(f"{manifest}: notes must be text")
    assert isinstance(package_id, str) and isinstance(name, str) and isinstance(adapter, str) and isinstance(status, str)
    return LanguagePackage(
        id=package_id,
        name=name,
        extensions=tuple(extensions),
        adapter=adapter,
        status=status,
        launch=dict(launch),
        notes=notes,
    )