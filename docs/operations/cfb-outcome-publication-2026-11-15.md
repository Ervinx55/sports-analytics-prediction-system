# CFB outcome publication repair

On November 14, the collector returned HTTP 200 but showed zero settled forecasts after games finished. Its settlement loop read the last completely reconciled historical source. The next source could not replace that history while any other game had differing team-schedule observations, including ordinary live-score changes during the roughly three-hour rotation.

Settlement now recomputes reconciliation from the latest staged team schedules on every bounded refresh. A game's agreeing final observations can produce an immutable outcome revision independently of unrelated conflicts. Forecast generation still uses the complete last-good history; no captured forecast or model parameter is rewritten.

Conflicting observations append an invalid revision, with both teams' schedule evidence and the newest source observation timestamp. A missing game on one team's newer schedule is retained as explicit evidence; its timestamp can supersede an older valid result. No old-source final is used to bypass a current conflict. Existing SQL orders revisions by source observation time before insertion time.

Coverage adds outcomeSourceConflicts, outcomeRowsChecked and outcomeRevisionsThisRun so successful HTTP collection is distinguishable from result-publication progress. The existing forty-row settlement batches and ten-minute schedule are unchanged. Games may still wait for both team schedules to refresh; this change does not force incomplete or inconsistent results final.

Regression coverage includes agreed finals during a partial rotation, unrelated score conflicts, immutable model/history state, and newer missing-side evidence superseding a prior final. NBA and NFL remain frozen. CFB remains research-only; historical or newly settled accuracy does not authorize PLAY or prove profit.
