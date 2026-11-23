
create index if not exists options_paper_trades_setup_snapshot_idx
  on public.options_paper_trades (setup_snapshot_id);
