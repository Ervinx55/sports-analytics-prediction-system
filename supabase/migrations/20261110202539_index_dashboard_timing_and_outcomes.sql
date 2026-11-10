SET LOCAL lock_timeout = '2s';
CREATE INDEX IF NOT EXISTS decision_timing_sport_start_idx ON public.decision_timing_shadow (sport, starts_at, leg_type);
CREATE INDEX IF NOT EXISTS outcome_attribution_evaluated_idx ON public.decision_outcome_attribution (evaluated_at DESC);
