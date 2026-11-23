from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import pytest

from scripts.supabase import smoke_rebuild
from scripts.supabase.validate_reconstruction import validate_repository


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


def source_entry(root: Path, relative: str, body: bytes) -> dict:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return {"path": relative, "name": path.name, "sha256": hashlib.sha256(body).hexdigest()}


@pytest.fixture
def repository(tmp_path):
    root = tmp_path / "repository"
    manifests = root / "supabase/manifests"
    for name in ("migrations", "edge-functions", "cron-jobs", "toolchain"):
        write_json(manifests / f"{name}.json", {"items": []})
    write_json(manifests / "production-inventory.json", {})
    (root / "supabase/config.toml").write_text('project_id = "fixture"\n')
    (root / "supabase/functions/_shared").mkdir(parents=True)
    current = source_entry(root, "supabase/functions/local-only/index.ts", b"// local source\n")
    deployed_local = source_entry(root, "supabase/deployed-snapshots/local-only/v2/index.ts", b"// deployed local variant\n")
    deployed_remote = source_entry(root, "supabase/deployed-snapshots/remote-only/v3/index.ts", b"// deployed remote-only source\n")
    previous_remote = source_entry(root, "supabase/deployed-snapshots/remote-only/v2/index.ts", b"// previous deployed remote source\n")
    items = [
        {"slug": "local-only", "status": "LOCAL_SOURCE", "files": [current],
         "deploymentObservation": {"version": 2, "files": [deployed_local]}},
        {"slug": "remote-only", "status": "ACTIVE", "version": 3, "files": [deployed_remote],
         "previousDeployment": {"version": 2, "files": [previous_remote]}},
    ]
    write_json(manifests / "edge-functions.json", {"items": items})
    return root, items


def save_items(root: Path, items) -> None:
    write_json(root / "supabase/manifests/edge-functions.json", {"items": items})


def entries(items, location):
    if location == "deployment":
        return items[0]["deploymentObservation"]["files"]
    if location == "previous":
        return items[1]["previousDeployment"]["files"]
    return items[0 if location == "local" else 1]["files"]


def test_canonical_and_snapshot_identities_are_a_union(repository):
    root, _ = repository
    assert validate_repository(root) == []


@pytest.mark.parametrize("location", ["local", "active", "deployment", "previous"])
def test_modified_source_bytes_fail_the_recorded_hash(repository, location):
    root, items = repository
    entry = entries(items, location)[0]
    (root / entry["path"]).write_bytes(b"// modified after capture\n")
    assert any("sha256 mismatch" in e and entry["path"] in e for e in validate_repository(root))


@pytest.mark.parametrize("location", ["active", "deployment", "previous"])
def test_missing_snapshot_file_fails(repository, location):
    root, items = repository
    entry = entries(items, location)[0]
    (root / entry["path"]).unlink()
    assert any("missing file" in e and entry["path"] in e for e in validate_repository(root))


@pytest.mark.parametrize("shape", [None, {}, "not-a-list", [], ["not-an-object"]])
@pytest.mark.parametrize("location", ["active", "deployment", "previous"])
def test_invalid_nested_file_containers_fail(repository, shape, location):
    root, items = repository
    owner = {
        "deployment": items[0]["deploymentObservation"],
        "previous": items[1]["previousDeployment"],
        "active": items[1],
    }[location]
    owner["files"] = shape
    save_items(root, items)
    assert any("files" in e and ("list" in e or "object" in e) for e in validate_repository(root))


@pytest.mark.parametrize("value", [None, [], "not-an-object"])
@pytest.mark.parametrize("field,index", [("deploymentObservation", 0), ("previousDeployment", 1)])
def test_invalid_deployment_container_fails(repository, value, field, index):
    root, items = repository
    items[index][field] = value
    save_items(root, items)
    assert any(f"{field} must be an object" in e for e in validate_repository(root))


@pytest.mark.parametrize("field,value", [("path", None), ("path", ""), ("path", []), ("sha256", None), ("sha256", ""), ("sha256", "not-a-digest")])
def test_nested_file_identity_and_digest_are_required(repository, field, value):
    root, items = repository
    items[1]["files"][0][field] = value
    save_items(root, items)
    assert any(field in e for e in validate_repository(root))


@pytest.mark.parametrize("kind", ["absolute", "parent", "symlink", "directory"])
def test_source_paths_must_be_contained_relative_real_files(repository, kind):
    root, items = repository
    entry = items[1]["files"][0]
    if kind == "absolute":
        entry["path"] = str(root / entry["path"])
    elif kind == "parent":
        outside = source_entry(root.parent, "outside.ts", b"// outside\n")
        entry.update(outside, path="../outside.ts")
    elif kind == "symlink":
        outside = root.parent / "outside.ts"
        outside.write_bytes(b"// outside\n")
        original = root / entry["path"]
        original.unlink()
        original.symlink_to(outside)
        entry["sha256"] = hashlib.sha256(outside.read_bytes()).hexdigest()
    else:
        entry["path"] = str(Path(entry["path"]).parent)
    save_items(root, items)
    assert any("path" in e or "file" in e for e in validate_repository(root))


def test_duplicate_function_identity_fails(repository):
    root, items = repository
    items.append(copy.deepcopy(items[1]))
    save_items(root, items)
    assert any("duplicate function slug: remote-only" in e for e in validate_repository(root))


def test_same_count_wrong_identity_does_not_pass(repository):
    root, items = repository
    # Counts alone are deliberately equal even in the old canonical-only check.
    (root / "supabase/functions/remote-only").mkdir()
    items[1]["slug"] = "wrong-slug"
    save_items(root, items)
    errors = validate_repository(root)
    assert any("missing function identities" in e and "remote-only" in e for e in errors)
    assert any("without source directories" in e and "wrong-slug" in e for e in errors)


def test_unrepresented_snapshot_identity_fails(repository):
    root, _ = repository
    source_entry(root, "supabase/deployed-snapshots/orphan/v1/index.ts", b"// orphan\n")
    assert any("missing function identities" in e and "orphan" in e for e in validate_repository(root))


@pytest.mark.parametrize("kind", [
    "active_other_slug", "active_canonical_unverified", "active_wrong_version",
    "observation_wrong_version", "observation_canonical", "local_points_to_snapshot",
    "active_other_slug_with_parity", "active_other_slug_symlink",
    "previous_wrong_version", "previous_canonical_with_parity", "previous_other_slug",
])
def test_source_files_are_bound_to_their_owning_slug_version_and_status(repository, kind):
    root, items = repository
    local, active = items
    if kind == "active_other_slug":
        active["files"] = copy.deepcopy(local["files"])
    elif kind == "active_canonical_unverified":
        active["files"] = [source_entry(root, "supabase/functions/remote-only/index.ts", b"// unverified canonical\n")]
    elif kind == "active_wrong_version":
        active["version"] = 999
    elif kind == "observation_wrong_version":
        local["deploymentObservation"]["version"] = 999
    elif kind == "observation_canonical":
        local["deploymentObservation"]["files"] = copy.deepcopy(local["files"])
    elif kind == "previous_wrong_version":
        active["previousDeployment"]["version"] = 999
    elif kind == "previous_canonical_with_parity":
        active["previousDeployment"]["files"] = [source_entry(root, "supabase/functions/remote-only/index.ts", b"// current reviewed deployment\n")]
        active["sourceRecovery"] = {"localSourceParityVerified": True}
    elif kind == "previous_other_slug":
        active["previousDeployment"]["files"] = copy.deepcopy(local["deploymentObservation"]["files"])
    elif kind == "local_points_to_snapshot":
        local["files"] = copy.deepcopy(local["deploymentObservation"]["files"])
    elif kind == "active_other_slug_symlink":
        path = root / active["files"][0]["path"]
        path.unlink()
        path.symlink_to(root / local["files"][0]["path"])
        active["files"][0]["sha256"] = local["files"][0]["sha256"]
    else:
        active["files"] = copy.deepcopy(local["files"])
        active["sourceRecovery"] = {"localSourceParityVerified": True}
    save_items(root, items)
    assert any("function source identity" in e for e in validate_repository(root))


@pytest.mark.parametrize("parity", [True, False, None, "true", 1])
def test_only_explicit_true_parity_allows_own_reviewed_canonical_source(repository, parity):
    root, items = repository
    items[1]["files"] = [source_entry(root, "supabase/functions/remote-only/index.ts", b"// reviewed deployment\n")]
    items[1]["sourceRecovery"] = {"localSourceParityVerified": parity}
    save_items(root, items)
    errors = validate_repository(root)
    if parity is True:
        assert errors == []
    else:
        assert any("function source identity" in e for e in errors)


@pytest.mark.parametrize("version", [None, True, 0, "3"])
@pytest.mark.parametrize("location", ["active", "previous"])
def test_observed_version_is_a_positive_integer(repository, version, location):
    root, items = repository
    owner = items[1]["previousDeployment"] if location == "previous" else items[1]
    owner["version"] = version
    save_items(root, items)
    assert any("version must be a positive integer" in e for e in validate_repository(root))


def test_secret_scan_still_covers_exact_deployed_snapshots(repository):
    root, items = repository
    entry = items[1]["files"][0]
    body = ("// " + "sb" + "_secret_" + "fixture_not_a_real_credential\n").encode()
    (root / entry["path"]).write_bytes(body)
    entry["sha256"] = hashlib.sha256(body).hexdigest()
    save_items(root, items)
    assert any("possible secret" in e and entry["path"] in e for e in validate_repository(root))


def test_smoke_function_check_uses_validated_identity_inventory_not_fixed_count(repository, monkeypatch):
    root, _ = repository
    monkeypatch.setattr(smoke_rebuild, "ROOT", root)
    errors = []
    assert smoke_rebuild.check_functions(errors) is True
    assert errors == []


def test_smoke_function_check_rejects_empty_inventory(repository, monkeypatch):
    root, _ = repository
    save_items(root, [])
    monkeypatch.setattr(smoke_rebuild, "ROOT", root)
    # Isolate the additional nonempty guard after successful repository validation.
    monkeypatch.setattr("scripts.supabase.validate_reconstruction.validate_repository", lambda _: [])
    errors = []
    assert smoke_rebuild.check_functions(errors) is False
    assert any("nonempty" in e for e in errors)


def test_smoke_function_check_keeps_repository_corruption_gate(repository, monkeypatch):
    root, items = repository
    (root / items[1]["files"][0]["path"]).write_bytes(b"// tampered\n")
    monkeypatch.setattr(smoke_rebuild, "ROOT", root)
    errors = []
    assert smoke_rebuild.check_functions(errors) is False
    assert any("repository:" in e and "sha256 mismatch" in e for e in errors)
