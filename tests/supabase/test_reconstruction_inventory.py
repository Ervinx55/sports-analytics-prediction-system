from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "scripts" / "supabase" / "validate_reconstruction.py"


def _load_validator():
    if not VALIDATOR.exists():
        pytest.fail("reconstruction validator is not implemented")
    spec = importlib.util.spec_from_file_location("validate_reconstruction", VALIDATOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_reconstruction_tree_is_complete():
    module = _load_validator()
    errors = module.validate_repository(ROOT)
    assert errors == []


def test_secret_files_are_ignored():
    gitignore = (ROOT / ".gitignore").read_text()
    assert "supabase/.env" in gitignore
    assert "supabase/.temp/" in gitignore
