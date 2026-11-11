# Explanation evidence validation

Scope: historical defensive efficiency, defense versus archived listed position and historical box-score usage in the existing expandable deep dives. Both NBA models, approvals, forecasts and collection schedules remain unchanged.

Implemented a service-role-only read RPC, bounded to 300 accepted histories and 1,000 current selection bindings. Archived BDL data must match the recorded SHA, exact game and reconciled player IDs. Explanations are computed separately and have zero production weight. API enrichment runs alongside the primary request, caches for five minutes and fails unavailable per selection without changing authoritative decisions or quotes.

Review fixes: reject incomplete raw team totals for usage; reject partially verified opposing rosters for defense versus position; isolate malformed explanation evidence. No fallback to name guessing or favorable partial samples.

Tests: 178 Node tests, 78 Python tests; browser regression covers native disclosure, refresh preservation, keyboard access and 390px layout. Production RPC grants verified: anon=false, authenticated=false, service_role=true. Query body EXPLAIN ANALYZE approximately 479ms; function approximately 1.3s warmed (first cold call 5.4s). Client timeout six seconds; failed reads cached thirty seconds.

Archive audit at implementation: 152 accepted histories, 55 matching archived BDL box scores. Initial 70 mapped player/event selections: defensive efficiency available on 70, full-roster position allowance on 4, fully reconciled historical usage on 16. These are coverage observations, not validation results or model improvements. Missing context remains explicitly unavailable; samples grow only through the existing verified collector.

Ruling: retain conservative full-roster checks even though they reduce DvP coverage; dropping conflicting players could bias the displayed average. Historical roster position is not an assigned defender. Historical usage is not projected usage. Do not use this evidence to reinterpret prior frozen-model forecasts.
