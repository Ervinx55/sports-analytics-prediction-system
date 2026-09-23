from __future__ import annotations

import hashlib
import json
import re
import tomllib
from pathlib import Path
from typing import Iterable

MANIFESTS = (
    "migrations.json",
    "edge-functions.json",
    "production-inventory.json",
    "cron-jobs.json",
    "toolchain.json",
)

SECRET_PATTERNS = (
    re.compile(r"sb_secret_[A-Za-z0-9_-]+"),
    re.compile(r"SUPABASE_DB_PASSWORD\s*=\s*[^\s\"']+"),
    re.compile(r"Authorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._-]+", re.IGNORECASE),
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_json(path: Path, errors: list[str]) -> dict:
    try:
        value = json.loads(path.read_text())
    except FileNotFoundError:
        errors.append(f"missing manifest: {path.relative_to(path.parents[2])}")
        return {}
    except json.JSONDecodeError as exc:
        errors.append(f"invalid json: {path}: {exc}")
        return {}
    if not isinstance(value, dict):
        errors.append(f"manifest must be an object: {path}")
        return {}
    return value


def _tracked_recovery_files(root: Path) -> Iterable[Path]:
    for base in (root / "supabase", root / "scripts" / "supabase"):
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if path.is_file() and ".temp" not in path.parts:
                yield path


def _function_dirs(root: Path) -> list[Path]:
    base = root / "supabase" / "functions"
    if not base.exists():
        return []
    return sorted(p for p in base.iterdir() if p.is_dir() and not p.name.startswith("_"))


def validate_repository(root: Path) -> list[str]:
    errors: list[str] = []
    supabase = root / "supabase"
    manifests_dir = supabase / "manifests"

    config_path = supabase / "config.toml"
    if not config_path.exists():
        errors.append("missing supabase/config.toml")
    else:
        try:
            tomllib.loads(config_path.read_text())
        except tomllib.TOMLDecodeError as exc:
            errors.append(f"invalid supabase/config.toml: {exc}")

    manifests: dict[str, dict] = {}
    for name in MANIFESTS:
        path = manifests_dir / name
        manifests[name] = _load_json(path, errors)
        if path.exists() and name != "production-inventory.json":
            items = manifests[name].get("items")
            if not isinstance(items, list):
                errors.append(f"{name}: items must be a list")

    migration_manifest = manifests.get("migrations.json", {})
    migration_items = migration_manifest.get("items", [])
    migration_files = sorted((supabase / "migrations").glob("*.sql")) if (supabase / "migrations").exists() else []
    if isinstance(migration_items, list) and len(migration_items) != len(migration_files):
        errors.append(
            f"migration manifest count {len(migration_items)} != files {len(migration_files)}"
        )

    edge_manifest = manifests.get("edge-functions.json", {})
    edge_items = edge_manifest.get("items", [])
    function_dirs = _function_dirs(root)
    if isinstance(edge_items, list) and len(edge_items) != len(function_dirs):
        errors.append(
            f"edge function manifest count {len(edge_items)} != directories {len(function_dirs)}"
        )

    for manifest_name in ("migrations.json", "edge-functions.json"):
        items = manifests.get(manifest_name, {}).get("items", [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                errors.append(f"{manifest_name}: item must be an object")
                continue
            path_value = item.get("path")
            expected_hash = item.get("sha256")
            if path_value:
                path = root / str(path_value)
                if not path.exists():
                    errors.append(f"{manifest_name}: missing path {path_value}")
                elif expected_hash and _sha256(path) != expected_hash:
                    errors.append(f"{manifest_name}: sha256 mismatch {path_value}")

    for path in _tracked_recovery_files(root):
        try:
            text = path.read_text(errors="ignore")
        except OSError as exc:
            errors.append(f"cannot read {path}: {exc}")
            continue
        for pattern in SECRET_PATTERNS:
            if pattern.search(text):
                errors.append(f"possible secret in {path.relative_to(root)}")
                break

    return errors
