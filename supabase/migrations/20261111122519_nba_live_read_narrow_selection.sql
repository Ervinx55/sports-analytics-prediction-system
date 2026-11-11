-- Select latest IDs before loading decision payloads. Approval checks are unchanged.
CREATE OR REPLACE FUNCTION public.read_nba_live_decisions_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 with latest_ids as materialized (select distinct on(identity,model_hash) decision_id from nba_live_decisions_v1 where starts_at>now() and decided_at>now()-interval '24 hours' order by identity,model_hash,decided_at desc,decision_id desc),
 latest as (select d.* from latest_ids k join nba_live_decisions_v1 d using(decision_id)),
 checked as(select d.*,d.payload->>'status'='PLAY' and d.generation=(select generation from nba_live_refresh_v1 where singleton) and d.valid_until>now() and a.status='APPROVED' and a.model_hash=d.model_hash and (a.review->>'effectiveAt')::timestamptz<=now() and (a.review->>'expiresAt')::timestamptz>now() as cleared from latest d left join nba_model_approvals_v1 a on a.id=d.approval_id order by d.decided_at desc limit 500)
 select jsonb_build_object('generatedAt',now(),'contract','nba-reviewed-live-v1','decisions',coalesce(jsonb_agg((payload-'evidence')||case when coalesce(cleared,false) then '{}'::jsonb else jsonb_build_object('status','PASS','productionEligible',false,'productionWeight',0,'reason',case when payload->>'status'='PLAY' then 'Approval revoked/expired, refresh superseded, or price/decision validity expired.' else payload->>'reason' end) end),'[]')) from checked;
$function$
;
