create or replace function public.edge_journal_from_nba_live() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text;
begin
 v_status:=upper(coalesce(new.payload->>'status','PASS'));
 insert into public.edge_decision_journal_v1
 (issued_at,source,source_reference,sport,event_id,starts_at,player_id,market_type,side,line,odds,book,decision,model_probability,model_version,context,evidence,provenance)
 values (new.decided_at,'nba_live_decisions_v1',new.decision_id,'NBA',new.payload->>'eventID',new.starts_at,new.payload->>'playerID',
 coalesce(new.payload->>'market','unknown'),new.payload->>'side',
 nullif(new.payload->>'line','')::numeric,nullif(new.payload->>'odds','')::integer,new.payload->>'book',
 case when v_status in ('BUY','AVOID','PASS','WATCH','REVERSED') then v_status else 'PASS' end,
 nullif(new.payload->>'modelProbability','')::numeric,new.model_hash,
 jsonb_build_object('identity',new.identity,'approval_id',new.approval_id,'production_eligible',new.payload->'productionEligible','original_status',v_status),
 jsonb_build_object('decision_id',new.decision_id,'reason',new.payload->'reason','reasons',new.payload->'reasons','quote_at',new.payload->'quoteAt','evidence',new.payload->'evidence'),
 'system')
 on conflict(source,source_reference) do nothing;
 return new;
end $$;
drop trigger if exists edge_journal_nba_live_insert on public.nba_live_decisions_v1;
create trigger edge_journal_nba_live_insert after insert on public.nba_live_decisions_v1 for each row execute function public.edge_journal_from_nba_live();

