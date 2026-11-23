create or replace function public.edge_journal_from_market_grade() returns trigger language plpgsql security definer set search_path = public,pg_temp as $$
begin
 insert into public.edge_decision_journal_v1 (issued_at,source,source_reference,sport,event_id,starts_at,market_type,side,line,odds,book,decision,model_probability,model_version,context,evidence,provenance)
 values (new.captured_at,'market_grade_observations',new.id::text,new.sport,new.event_id,new.starts_at,new.market_type,new.market_side,new.line,new.best_odds,new.best_book,
 case when upper(coalesce(new.non_sharp_status,'')) in ('PASS','AVOID') then upper(new.non_sharp_status) else 'WATCH' end,
 new.model_probability,new.model_version,
 jsonb_build_object('market_label',new.market_label,'away_team',new.away_team,'home_team',new.home_team,'original_status',new.non_sharp_status),
 jsonb_build_object('reason',new.reason,'ev_pct',new.ev_pct,'edge_pct_points',new.edge_pct_points,'raw',new.raw),'system')
 on conflict (source,source_reference) do nothing;
 return new;
end $$;
drop trigger if exists edge_journal_market_grade_insert on public.market_grade_observations;
create trigger edge_journal_market_grade_insert after insert on public.market_grade_observations for each row execute function public.edge_journal_from_market_grade();
insert into public.edge_decision_journal_v1 (issued_at,source,source_reference,sport,event_id,starts_at,market_type,side,line,odds,book,decision,model_probability,model_version,context,evidence,provenance)
select captured_at,'market_grade_observations',id::text,sport,event_id,starts_at,market_type,market_side,line,best_odds,best_book,
case when upper(coalesce(non_sharp_status,'')) in ('PASS','AVOID') then upper(non_sharp_status) else 'WATCH' end,
model_probability,model_version,
jsonb_build_object('market_label',market_label,'away_team',away_team,'home_team',home_team,'original_status',non_sharp_status),
jsonb_build_object('reason',reason,'ev_pct',ev_pct,'edge_pct_points',edge_pct_points,'raw',raw),'historical_backfill'
from public.market_grade_observations
on conflict (source,source_reference) do nothing;

