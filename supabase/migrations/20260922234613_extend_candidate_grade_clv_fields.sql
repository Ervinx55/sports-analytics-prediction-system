
    alter table public.candidate_grades
      add column if not exists initial_implied_probability numeric,
      add column if not exists closing_implied_probability numeric,
      add column if not exists clv_implied_pp numeric,
      add column if not exists model_vs_close_pp numeric;
  
