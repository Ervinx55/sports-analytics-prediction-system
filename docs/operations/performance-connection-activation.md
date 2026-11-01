# Performance tracking: safe activation gate

Status: BLOCKED until an authenticated end-to-end smoke test passes.
Project: Supabase `yeoxroijaptomomshdii`.

## Deployed endpoints
- `capture-sport-predictions`: deployed with JWT required; scheduled mode returns `TRUSTED_SOURCE_ADAPTER_UNAVAILABLE` until a trusted source is connected. The direct mode still requires fully evidenced, immutable pregame model payloads.
- `settle-sport-predictions`: deployed with JWT required; POST returns `VERIFIED_FINAL_RESULT_ADAPTER_UNAVAILABLE` until reliable results and exact mappings are implemented.
- Neither endpoint currently creates official decisions or settlements.

## 1. Credential prerequisite — manual, inside Supabase, never in source or chat

The dispatcher `public.dispatch_performance_job_v1` reads `snapshot_project_url` and `performance_service_role_key` from Vault.
`snapshot_project_url` is present; `performance_service_role_key` is absent.
Provision the project’s existing *service role JWT* as Vault secret named
`performance_service_role_key` using the authenticated Supabase Dashboard Vault UI.
Do not place it in GitHub, messages, public client env variables, or logs.
If the project uses a newer secret key instead of a JWT, update and test the
Edge Function authentication strategy rather than forcing incompatible tokens.
Only project administrators should configure this.

Read-only check:
```sql
select
 exists(select 1 from vault.secrets where name='snapshot_project_url') as url_configured,
 exists(select 1 from vault.secrets where name='performance_service_role_key') as dispatcher_credential_configured;
```

## 2. Trusted source adapters — not present yet

Before activating scheduled capture, connect the existing predictive model and
quote source to a canonical immutable payload with:
- sport/event mapping, market/side/line, book and odds, model version/mode
- model and market probability **with known probability basis**
- original source observation ID, quote timestamp and actual server receipt
- independently generated model probability, exact settlement-rule version
- trusted provenance for model evidence and quote snapshot

Do not use the existing 130 invalid SHADOW rows as live evidence or invent historical records.
Do not use a fair-market probability as if it came from an independent model.

Before activating settlement, connect a final-result provider with exact
event/player identity, verified final status, correction/revision semantics and
market-specific push/void handling. Never derive outcomes from a quote or a predicted score.

## 3. Verify before activating automation

Check that `capture-sport-predictions` and `settle-sport-predictions` are ACTIVE,
have JWT verification enabled, and reject requests without authorization.

A **controlled genuine pregame** candidate must satisfy:
1. Capture returns a prediction ID and database marks it valid and LIVE.
2. An explicitly issued, pregame qualified decision links to that same ID.
3. After authoritative final results, one settlement links to the same ID.
4. Replaying the capture and settlement does not duplicate or mutate the original row.
5. The performance reader counts exactly one eligible decision and its latest settlement.
6. Legacy diagnostics, post-start captures, and shadow cases remain excluded.

If ANY condition fails, keep `cron.job.active=false` and
`pipeline_component_registry.enabled=false` for the affected sport.
Enable NFL/NBA **only after** the entire chain is verified.

Read-only operational check:
```sql
select
 (select count(*) from public.performance_predictions) predictions,
 (select count(*) from public.performance_predictions where valid and model_mode='LIVE') valid_live,
 (select count(*) from public.performance_decisions) decisions,
 (select count(*) from public.performance_settlement_queue) queued,
 (select count(*) from public.performance_settlements) settlements;
select jobname,active from cron.job where jobname like 'performance-%' order by jobname;
select component_key,enabled from public.pipeline_component_registry
where component_key like 'performance_%' order by component_key;
```

## Rollback
Disable only the affected sport's cron and component registry entries. Retain immutable
predictions, decisions, and settlement revisions for auditability. Avoid exposing
privileged credentials to the public Data API.
