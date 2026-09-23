from __future__ import annotations

import argparse
import json
import os
import subprocess
import urllib.request
from pathlib import Path
from typing import Any

from scripts.supabase.compare_inventory import compare_inventory

ROOT = Path(__file__).resolve().parents[2]


def psql_rows(sql: str) -> list[dict[str, Any]]:
    wrapped = f"select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb)::text from ({sql}) q;"
    proc = subprocess.run(
        ["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", wrapped],
        check=True,
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )
    return json.loads(proc.stdout.strip() or "[]")


def live_inventory(project_ref: str) -> dict[str, Any]:
    tables = psql_rows("""
select 'public' as schema,c.relname as name,
       encode(extensions.digest(convert_to((
         select jsonb_agg(jsonb_build_object(
           'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
           'not_null',a.attnotnull,'default',pg_get_expr(ad.adbin,ad.adrelid)
         ) order by a.attnum)::text
         from pg_attribute a
         left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum
         where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
       ),'UTF8'),'sha256'),'hex') as structure_sha256
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p')
order by c.relname
""")
    views = psql_rows("""
select 'public' as schema,v.viewname as name,
       encode(extensions.digest(convert_to(pg_get_viewdef(format('%I.%I',v.schemaname,v.viewname)::regclass,true),'UTF8'),'sha256'),'hex') as definition_sha256,
       coalesce((select option_value='true' from pg_options_to_table(c.reloptions) where option_name='security_invoker'),false) as security_invoker
from pg_views v
join pg_class c on c.oid=format('%I.%I',v.schemaname,v.viewname)::regclass
where v.schemaname='public'
order by v.viewname
""")
    functions = psql_rows("""
select 'public' as schema,p.proname as name,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       p.prosecdef as security_definer,
       encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex') as definition_sha256
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
order by p.proname,pg_get_function_identity_arguments(p.oid)
""")
    indexes = psql_rows("""
select 'public' as schema,tablename as table,indexname as name,
       encode(extensions.digest(convert_to(indexdef,'UTF8'),'sha256'),'hex') as definition_sha256
from pg_indexes where schemaname='public'
order by tablename,indexname
""")
    extensions = psql_rows("""
select extname as name,extversion as version from pg_extension order by extname
""")
    rls = psql_rows("""
select 'public' as schema,c.relname as table,c.relrowsecurity as enabled,c.relforcerowsecurity as forced
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p')
order by c.relname
""")
    grants = psql_rows("""
with g as (
 select 'TABLE' object_type,table_schema||'.'||table_name object_identity,grantee,privilege_type privilege
 from information_schema.role_table_grants
 where table_schema='public' and grantee in ('anon','authenticated','service_role')
 union all
 select 'ROUTINE',routine_schema||'.'||routine_name||'('||specific_name||')',grantee,privilege_type
 from information_schema.role_routine_grants
 where routine_schema='public' and grantee in ('anon','authenticated','service_role')
)
select object_type,object_identity,
       encode(extensions.digest(convert_to(string_agg(grantee||':'||privilege,',' order by grantee,privilege),'UTF8'),'sha256'),'hex') as grant_sha256
from g group by object_type,object_identity
order by object_type,object_identity
""")
    return {
        "project_ref": project_ref,
        "tables": tables,
        "views": views,
        "functions": functions,
        "indexes": indexes,
        "extensions": extensions,
        "rls": rls,
        "grants": grants,
    }


def live_migrations() -> list[dict[str, str]]:
    return psql_rows("""
select version::text as version,name
from supabase_migrations.schema_migrations
order by version
""")


def live_cron() -> list[dict[str, Any]]:
    return psql_rows("""
select jobname,schedule,active,
       encode(extensions.digest(convert_to(command,'UTF8'),'sha256'),'hex') as command_sha256
from cron.job
order by jobname
""")


def live_functions(project_ref: str, token: str) -> list[dict[str, Any]]:
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{project_ref}/functions",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        data = json.load(response)
    if not isinstance(data, list):
        raise RuntimeError("Supabase function list response was not an array")
    return data


def compare_exact(expected: list[dict[str, Any]], actual: list[dict[str, Any]], keys: tuple[str, ...]) -> dict[str, Any]:
    def ident(x: dict[str, Any]) -> str:
        return "|".join(str(x.get(k, "")) for k in keys)
    exp = {ident(x): x for x in expected}
    act = {ident(x): x for x in actual}
    return {
        "missing": [exp[k] for k in sorted(exp.keys() - act.keys())],
        "unexpected": [act[k] for k in sorted(act.keys() - exp.keys())],
        "changed": [
            {"identity": k, "expected": exp[k], "actual": act[k]}
            for k in sorted(exp.keys() & act.keys())
            if exp[k] != act[k]
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("drift-report.json"))
    args = parser.parse_args()

    project_ref = os.environ["SUPABASE_PROJECT_ID"]
    token = os.environ["SUPABASE_ACCESS_TOKEN"]

    expected_inventory = json.loads((ROOT / "supabase/manifests/production-inventory.json").read_text())
    expected_cron = json.loads((ROOT / "supabase/manifests/cron-jobs.json").read_text())["items"]
    migration_manifest = json.loads((ROOT / "supabase/manifests/migrations.json").read_text())["items"]
    expected_migrations = [
        {"version": str(x["version"]), "name": x["name"]}
        for x in migration_manifest if x.get("recoveredFromProduction")
    ]
    edge_manifest = json.loads((ROOT / "supabase/manifests/edge-functions.json").read_text())["items"]
    expected_functions = [
        {
            "slug": x["slug"],
            "status": x["status"],
            "version": int(x["version"]),
            "verify_jwt": bool(x["verify_jwt"]),
            "ezbr_sha256": x["bundle_sha256"],
        }
        for x in edge_manifest
    ]

    actual_inventory = live_inventory(project_ref)
    schema_diff = compare_inventory(expected_inventory, actual_inventory)
    migration_diff = compare_exact(expected_migrations, live_migrations(), ("version",))
    cron_diff = compare_exact(expected_cron, live_cron(), ("jobname",))

    actual_functions = [
        {
            "slug": x["slug"],
            "status": x["status"],
            "version": int(x["version"]),
            "verify_jwt": bool(x["verify_jwt"]),
            "ezbr_sha256": x.get("ezbr_sha256"),
        }
        for x in live_functions(project_ref, token)
        if x.get("status") == "ACTIVE"
    ]
    function_diff = compare_exact(expected_functions, actual_functions, ("slug",))

    report = {
        "project_ref": project_ref,
        "read_only": True,
        "migration_diff": migration_diff,
        "function_diff": function_diff,
        "schema_security_diff": schema_diff,
        "cron_diff": cron_diff,
    }
    drift = any(
        any(section.values())
        for section in (migration_diff, function_diff, schema_diff, cron_diff)
    )
    report["drift"] = drift
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 1 if drift else 0


if __name__ == "__main__":
    raise SystemExit(main())
