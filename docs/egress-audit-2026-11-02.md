# November 2 egress audit and containment

Supabase restricted service with HTTP 402 exceed_egress_quota. This audit did not change billing and did not establish the entire monthly billed egress total.

In the six-hour operational log window, weather_park, prop_clv, prop_grading, sharp_sources, team_grading and verification_gate each made 72 HTTP requests, all 402. sharp_clv made 36, player_prop_capture and model_audit six each, and model_governance one. These ten confirmed failing scheduled components were paused, and registry enabled flags set false. The already-disabled NBA research tracker was left disabled. Other database jobs, retention and reconciliation were not broadly disabled or deleted.

In the available 24-hour HTTP logs, dashboard-results had 296 successful responses with about 3.15 MB of declared response bodies. Numerous legacy REST endpoints had hundreds to thousands of 401 responses. Content-Length can be missing; edge and function logs can overlap; database/pooler traffic is not covered by these response totals. These observations demonstrate wasted requests but do not prove the original monthly quota cause. Table size is storage, not egress. The full billing usage breakdown and cycle reset remain unverified.

Paused schedules (all were enabled/active before containment):
- model_audit: mlb-model-audit-hourly, 20 * * * *
- model_governance: model-governance-6hour, 15 */6 * * *
- player_prop_capture: mlb-player-props-capture-hourly, 25 * * * *
- prop_clv: mlb-player-prop-clv-5min, */5 * * * *
- prop_grading: mlb-player-props-grading-live, */5 * * * *
- sharp_clv: mlb-sharp-clv-10min, */10 * * * *
- sharp_sources: mlb-sharp-sources-5min, */5 * * * *
- team_grading: mlb-team-market-grading-live, */5 * * * *
- verification_gate: mlb-verification-gate-5min, 3-59/5 * * * *
- weather_park: mlb-weather-park-5min, 4-59/5 * * * *

Restore individually after service restoration and a successful authenticated test: set the corresponding pipeline_component_registry.enabled=true, then cron.alter_job for the existing job name with active=true. Do not blindly enable all jobs or assume a quota reset repairs legacy credential errors. Schedules were retained unchanged.

Further savings to validate: fetch Results only when requested, share cached historical result responses, replace legacy failing REST readers, and query only required columns/date windows. No claim is made that buying a larger plan fixes those inefficiencies.
