from scripts.supabase.compare_inventory import compare_inventory


def _base():
    return {
        "tables": [{"schema": "public", "name": "a", "structure_sha256": "1"}],
        "views": [],
        "functions": [],
        "indexes": [],
        "extensions": [],
        "rls": [],
        "grants": [],
    }


def test_missing_object_is_reported():
    expected = _base()
    actual = {**_base(), "tables": []}
    diff = compare_inventory(expected, actual)
    assert [x["identity"] for x in diff["missing"]] == ["public.a"]


def test_unexpected_object_is_reported():
    expected = {**_base(), "tables": []}
    actual = _base()
    diff = compare_inventory(expected, actual)
    assert [x["identity"] for x in diff["unexpected"]] == ["public.a"]


def test_changed_hash_is_reported():
    expected = {
        **_base(),
        "functions": [{"schema": "public", "name": "f", "identity_arguments": "", "definition_sha256": "a"}],
    }
    actual = {
        **_base(),
        "functions": [{"schema": "public", "name": "f", "identity_arguments": "", "definition_sha256": "b"}],
    }
    diff = compare_inventory(expected, actual)
    assert [x["identity"] for x in diff["changed"]] == ["public.f()"]


def test_order_differences_do_not_create_drift():
    expected = {
        **_base(),
        "extensions": [{"name": "a", "version": "1"}, {"name": "b", "version": "1"}],
    }
    actual = {
        **_base(),
        "extensions": [{"name": "b", "version": "1"}, {"name": "a", "version": "1"}],
    }
    assert compare_inventory(expected, actual) == {"missing": [], "unexpected": [], "changed": []}


def test_grant_hash_compares_semantics_not_display_order():
    expected = {
        **_base(),
        "grants": [{"object_type": "TABLE", "object_identity": "public.a", "grant_sha256": "same"}],
    }
    actual = {
        **_base(),
        "grants": [{"grant_sha256": "same", "object_identity": "public.a", "object_type": "TABLE"}],
    }
    assert compare_inventory(expected, actual) == {"missing": [], "unexpected": [], "changed": []}
