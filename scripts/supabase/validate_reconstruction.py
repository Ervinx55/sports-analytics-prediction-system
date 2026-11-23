from __future__ import annotations

import argparse
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


def _function_slugs(root: Path) -> set[str]:
    canonical = root / "supabase" / "functions"
    snapshots = root / "supabase" / "deployed-snapshots"
    slugs = {
        path.name for path in canonical.iterdir()
        if path.is_dir() and not path.name.startswith("_")
    } if canonical.is_dir() else set()
    if snapshots.is_dir():
        slugs.update(path.name for path in snapshots.iterdir() if path.is_dir())
    return slugs


def _valid_function_slug(value) -> bool:
    return (
        isinstance(value, str) and bool(value.strip()) and value == value.strip()
        and value not in (".", "..") and Path(value).name == value and "\\" not in value
    )


def _snapshot_source_roots(slug: str, observation: dict, location: str, errors: list[str]) -> tuple[Path, ...]:
    version = observation.get("version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        errors.append(f"{location}: version must be a positive integer")
        return ()
    return (Path("supabase/deployed-snapshots") / slug / f"v{version}",)


def _validate_source_file(
    root: Path, entry: dict, location: str, errors: list[str], *, require_hash: bool = True,
    source_roots: tuple[Path, ...] | None = None,
) -> None:
    path_value = entry.get("path")
    if not isinstance(path_value, str) or not path_value.strip():
        errors.append(f"{location}: path must be a nonempty relative string")
        return
    relative = Path(path_value)
    if relative.is_absolute() or ".." in relative.parts:
        errors.append(f"{location}: path must be contained and relative: {path_value}")
        return
    try:
        path = (root / relative).resolve()
    except (OSError, RuntimeError):
        errors.append(f"{location}: cannot resolve path {path_value}")
        return
    if not path.is_relative_to(root):
        errors.append(f"{location}: path escapes repository: {path_value}")
        return
    if source_roots is not None and not any(
        relative.is_relative_to(base) and path.is_relative_to(root / base)
        for base in source_roots
    ):
        errors.append(f"{location}: path does not match function source identity: {path_value}")
        return
    if not path.is_file():
        errors.append(f"{location}: missing file or not a file: {path_value}")
        return
    expected_hash = entry.get("sha256")
    if expected_hash is None and not require_hash:
        return
    if not isinstance(expected_hash, str) or re.fullmatch(r"[a-f0-9]{64}", expected_hash) is None:
        errors.append(f"{location}: sha256 must be 64 lowercase hexadecimal characters: {path_value}")
        return
    try:
        actual_hash = _sha256(path)
    except OSError:
        errors.append(f"{location}: cannot read file {path_value}")
        return
    if actual_hash != expected_hash:
        errors.append(f"{location}: sha256 mismatch {path_value}")


def _validate_source_files(
    root: Path, files, location: str, errors: list[str], source_roots: tuple[Path, ...],
) -> None:
    if not isinstance(files, list) or not files:
        errors.append(f"{location}: files must be a nonempty list")
        return
    for index, entry in enumerate(files):
        if not isinstance(entry, dict):
            errors.append(f"{location}: files[{index}] must be an object")
            continue
        _validate_source_file(
            root, entry, f"{location}.files[{index}]", errors, source_roots=source_roots,
        )


def check_secrets(root: Path) -> list[str]:
    root = root.resolve()
    errors: list[str] = []
    for path in _tracked_recovery_files(root):
        try:
            if not path.resolve().is_relative_to(root):
                errors.append(f"source file escapes repository: {path.relative_to(root)}")
                continue
            text = path.read_text(errors="ignore")
        except (OSError, RuntimeError) as exc:
            errors.append(f"cannot read {path}: {exc}")
            continue
        for pattern in SECRET_PATTERNS:
            if pattern.search(text):
                errors.append(f"possible secret in {path.relative_to(root)}")
                break
    return errors


def validate_repository(root: Path) -> list[str]:
    root = root.resolve()
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
    if isinstance(edge_items, list):
        slugs: set[str] = set()
        for item in edge_items:
            if not isinstance(item, dict):
                continue  # The manifest-entry shape error is reported below.
            slug = item.get("slug")
            if not _valid_function_slug(slug):
                errors.append("edge-functions.json: slug must be a nonempty string")
                continue
            if slug in slugs:
                errors.append(f"edge-functions.json: duplicate function slug: {slug}")
            slugs.add(slug)
        directory_slugs = _function_slugs(root)
        missing = sorted(directory_slugs - slugs)
        unexpected = sorted(slugs - directory_slugs)
        if missing:
            errors.append("edge-functions.json: missing function identities: " + ", ".join(missing))
        if unexpected:
            errors.append("edge-functions.json: function identities without source directories: " + ", ".join(unexpected))

    for manifest_name in ("migrations.json", "edge-functions.json"):
        items = manifests.get(manifest_name, {}).get("items", [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                errors.append(f"{manifest_name}: item must be an object")
                continue
            path_value = item.get("path")
            if path_value:
                _validate_source_file(root, item, manifest_name, errors, require_hash=False)
            if manifest_name == "edge-functions.json":
                slug = item.get("slug")
                if not _valid_function_slug(slug):
                    continue  # The identity error is already reported above.
                location = f"edge-functions.json:{slug}"
                canonical = Path("supabase/functions") / slug
                if item.get("status") == "LOCAL_SOURCE":
                    source_roots = (canonical,)
                elif item.get("status") == "ACTIVE":
                    source_roots = _snapshot_source_roots(slug, item, location, errors)
                    recovery = item.get("sourceRecovery")
                    if isinstance(recovery, dict) and recovery.get("localSourceParityVerified") is True:
                        source_roots += (canonical,)
                else:
                    errors.append(f"{location}: status must be ACTIVE or LOCAL_SOURCE")
                    source_roots = ()
                _validate_source_files(root, item.get("files"), location, errors, source_roots)
                for field in ("deploymentObservation", "previousDeployment"):
                    if field not in item:
                        continue
                    observation = item[field]
                    if not isinstance(observation, dict):
                        errors.append(f"{location}: {field} must be an object")
                    else:
                        _validate_source_files(
                            root, observation.get("files"), f"{location}.{field}", errors,
                            _snapshot_source_roots(slug, observation, f"{location}.{field}", errors),
                        )

    errors.extend(check_secrets(root))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Supabase reconstruction source")
    parser.add_argument("--check-secrets", action="store_true", help="run only secret-pattern checks")
    parser.add_argument("root", nargs="?", default=".")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    errors = check_secrets(root) if args.check_secrets else validate_repository(root)
    for error in errors:
        print(error)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
