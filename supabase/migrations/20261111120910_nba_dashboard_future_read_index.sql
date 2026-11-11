-- Cover future-game dashboard reads without changing decisions or model inputs.
set lock_timeout = '3s';
create index nba_live_future_read_v1 on public.nba_live_decisions_v1 (starts_at, decided_at) include (identity, model_hash, decision_id);
