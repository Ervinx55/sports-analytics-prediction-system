from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

KINDS = ("tables", "views", "functions", "indexes", "extensions", "rls", "grants")


def _identity(kind: str, item: dict[str, Any]) -> str:
    if kind in ("tables", "views"):
        return f"{item.get('schema', 'public')}.{item['name']}"
    if kind == "functions":
        return f"{item.get('schema', 'public')}.{item['name']}({item.get('identity_arguments', '')})"
    if kind == "indexes":
        return f"{item.get('schema', 'public')}.{item['table']}.{item['name']}"
    if kind == "extensions":
        return item["name"]
    if kind == "rls":
        return f"{item.get('schema', 'public')}.{item['table']}"
    if kind == "grants":
        return f"{item['object_type']}|{item['object_identity']}"
    raise KeyError(kind)


def _normalized(kind: str, item: dict[str, Any]) -> dict[str, Any]:
    ignored = {"captured_at"}
    return {k: item[k] for k in sorted(item) if k not in ignored}


def compare_inventory(expected: dict[str, Any], actual: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {"missing": [], "unexpected": [], "changed": []}
    for kind in KINDS:
        exp = {_identity(kind, x): x for x in expected.get(kind, [])}
        act = {_identity(kind, x): x for x in actual.get(kind, [])}
        for key in sorted(exp.keys() - act.keys()):
            result["missing"].append({"kind": kind, "identity": key, "expected": exp[key]})
        for key in sorted(act.keys() - exp.keys()):
            result["unexpected"].append({"kind": kind, "identity": key, "actual": act[key]})
        for key in sorted(exp.keys() & act.keys()):
            if _normalized(kind, exp[key]) != _normalized(kind, act[key]):
                result["changed"].append({
                    "kind": kind,
                    "identity": key,
                    "expected": exp[key],
                    "actual": act[key],
                })
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("expected", type=Path)
    parser.add_argument("actual", type=Path)
    args = parser.parse_args()
    expected = json.loads(args.expected.read_text())
    actual = json.loads(args.actual.read_text())
    diff = compare_inventory(expected, actual)
    print(json.dumps(diff, indent=2, sort_keys=True))
    return 1 if any(diff.values()) else 0


if __name__ == "__main__":
    raise SystemExit(main())
