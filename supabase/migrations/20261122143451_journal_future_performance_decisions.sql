create or replace function public.edge_journal_from_performance_decision() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.edge_decision_journal_v1(issued_at,source,source_reference,sport,event_id,starts_at,market_type,side,line,odds,book,decision,model_probability,model_version,context,evidence,provenance)
 values(new.issued_at,'performance_decisions',new.id::text,coalesce(new.payload->>'sport','UNKNOWN'),new.payload->>'event_id',
 nullif(new.payload->>'starts_at','')::timestamptz,coalesce(new.payload->>'market_type',new.market_key,'unknown'),new.payload->>'side',
 nullif(new.payload->>'line','')::numeric,nullif(new.payload->>'odds','')::integer,new.payload->>'book',
 case when upper(coalesce(new.status,'')) in ('BUY','AVOID','PASS','WATCH','REVERSED','PLACED') then upper(new.status) else 'WATCH' end,
 nullif(new.payload->>'model_probability','')::numeric,new.payload->>'model_version',
 jsonb_build_object('market_key',new.market_key,'source_key',new.source_key,'qualified',new.qualified,'original_status',new.status),
 coalesce(new.evidence,'{}'::jsonb),'system')
 on conflict(source,source_reference) do nothing;
 return new;
end $$;
drop trigger if exists edge_journal_performance_insert on public.performance_decisions;
create trigger edge_journal_performance_insert after insert on public.performance_decisions for each row execute function public.edge_journal_from_performance_decision();

