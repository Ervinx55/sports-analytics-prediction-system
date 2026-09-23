from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB_URL = os.environ.get(
    "SUPABASE_DB_URL",
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
)

REQUIRED_OBJECTS = {
    "tables": [
        "market_grade_observations",
        "player_prop_observations",
        "sharp_source_quotes",
        "market_uncertainty_shadow",
        "market_price_sensitivity_shadow",
        "mlb_verification_snapshots",
        "mlb_weather_park_snapshots",
        "sharp_disagreement_shadow",
        "market_decision_fusion_shadow",
        "player_prop_decision_fusion_shadow",
        "player_prop_market_quotes",
        "player_prop_clv",
        "parlay_correlation_shadow",
        "decision_timing_shadow",
        "model_governance_registry",
        "model_governance_evaluations",
        "decision_outcome_attribution",
        "pipeline_component_registry",
        "pipeline_http_request_log",
    ],
    "views": [
        "market_uncertainty_latest",
        "market_price_sensitivity_latest",
        "mlb_verification_latest",
        "mlb_weather_park_latest",
        "sharp_disagreement_latest",
        "market_decision_fusion_latest",
        "player_prop_decision_fusion_latest",
        "player_prop_clv_latest",
        "parlay_correlation_latest",
        "decision_timing_latest",
        "model_governance_latest",
        "pipeline_component_health_v1",
    ],
    "functions": [
        "compute_market_uncertainty_v1",
        "compute_price_sensitivity_v1",
        "compute_decision_fusion_v1",
        "compute_player_prop_fusion_v1",
        "compute_parlay_correlation_v1",
        "decision_timing_bucket_v1",
        "compute_outcome_attribution_v1",
        "enqueue_pipeline_http_v1",
        "reconcile_pipeline_http_requests_v1",
    ],
}

SERVICE_ONLY_TABLES = [
    "market_uncertainty_shadow",
    "market_price_sensitivity_shadow",
    "mlb_verification_snapshots",
    "mlb_weather_park_snapshots",
    "sharp_disagreement_shadow",
    "market_decision_fusion_shadow",
    "player_prop_decision_fusion_shadow",
    "player_prop_market_quotes",
    "player_prop_clv",
    "parlay_correlation_shadow",
    "decision_timing_shadow",
    "model_governance_registry",
    "model_governance_evaluations",
    "decision_outcome_attribution",
    "pipeline_component_registry",
    "pipeline_http_request_log",
]


def validate_report(report: dict) -> list[str]:
    errors: list[str] = []
    for key in ("database_ok", "security_ok", "functions_ok", "cron_ok"):
        if report.get(key) is not True:
            errors.append(f"{key} is not true")
    payload_errors = report.get("errors")
    if not isinstance(payload_errors, list):
        errors.append("errors must be a list")
    elif payload_errors:
        errors.extend(str(x) for x in payload_errors)
    return errors


def psql(sql: str) -> str:
    result = subprocess.run(
        ["psql", DB_URL, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def check_database(errors: list[str]) -> bool:
    ok = True
    for kind, names in REQUIRED_OBJECTS.items():
        if kind == "tables":
            relation_kind = "r"
            for name in names:
                found = psql(
                    "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                    f"where n.nspname='public' and c.relname='{name}' and c.relkind='{relation_kind}';"
                )
                if found != "1":
                    errors.append(f"missing table public.{name}")
                    ok = False
        elif kind == "views":
            for name in names:
                found = psql(
                    "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                    f"where n.nspname='public' and c.relname='{name}' and c.relkind in ('v','m');"
                )
                if found != "1":
                    errors.append(f"missing view public.{name}")
                    ok = False
        else:
            for name in names:
                found = psql(
                    "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                    f"where n.nspname='public' and p.proname='{name}';"
                )
                if found == "0":
                    errors.append(f"missing function public.{name}")
                    ok = False
    return ok


def check_security(errors: list[str]) -> bool:
    ok = True
    for name in SERVICE_ONLY_TABLES:
        rls = psql(
            "select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace "
            f"where n.nspname='public' and c.relname='{name}' and c.relkind='r';"
        )
        if rls != "true":
            errors.append(f"RLS not enabled on public.{name}")
            ok = False
        anon = psql(f"select has_table_privilege('anon','public.{name}','SELECT')::text;")
        auth = psql(f"select has_table_privilege('authenticated','public.{name}','SELECT')::text;")
        service = psql(f"select has_table_privilege('service_role','public.{name}','SELECT')::text;")
        if anon != "false" or auth != "false" or service != "true":
            errors.append(
                f"unexpected grants on public.{name}: anon={anon} authenticated={auth} service_role={service}"
            )
            ok = False
    return ok


def check_functions(errors: list[str]) -> bool:
    from scripts.supabase.validate_reconstruction import validate_repository

    repo_errors = validate_repository(ROOT)
    if repo_errors:
        errors.extend(f"repository: {x}" for x in repo_errors)
        return False

    manifest = json.loads(
        (ROOT / "supabase" / "manifests" / "edge-functions.json").read_text()
    )
    if len(manifest.get("items", [])) != 49:
        errors.append("edge function manifest does not contain 49 functions")
        return False
    return True


def check_cron(errors: list[str]) -> bool:
    manifest = json.loads(
        (ROOT / "supabase" / "manifests" / "cron-jobs.json").read_text()
    )
    expected = {item["jobname"]: item["schedule"] for item in manifest.get("items", [])}
    rows = psql(
        "select coalesce(jsonb_object_agg(jobname,schedule),'{}'::jsonb)::text "
        "from cron.job;"
    )
    actual = json.loads(rows or "{}")
    missing = sorted(set(expected) - set(actual))
    changed = sorted(name for name in expected if name in actual and actual[name] != expected[name])
    if missing:
        errors.append("missing cron jobs: " + ", ".join(missing))
    if changed:
        errors.append("cron schedule mismatch: " + ", ".join(changed))
    return not missing and not changed


def main() -> int:
    errors: list[str] = []
    report = {
        "database_ok": False,
        "security_ok": False,
        "functions_ok": False,
        "cron_ok": False,
        "errors": errors,
    }

    try:
        report["database_ok"] = check_database(errors)
        report["security_ok"] = check_security(errors)
        report["functions_ok"] = check_functions(errors)
        report["cron_ok"] = check_cron(errors)
    except Exception as exc:
        errors.append(f"{type(exc).__name__}: {exc}")

    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if not validate_report(report) else 1


if __name__ == "__main__":
    raise SystemExit(main())
