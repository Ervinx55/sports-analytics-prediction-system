-- Preserve the original journal. Imported research and unknown original issue
-- times remain distinguishable from observations actually captured before play.
alter table public.edge_decision_journal_v1 alter column issued_at drop not null;
alter table public.edge_decision_journal_v1 alter column recorded_at set default clock_timestamp();
do $$ begin
  if exists(select 1 from public.edge_decision_journal_v1
    where not ((source='nba_live_decisions_v1' and sport='NBA') or (source='market_grade_observations' and sport='MLB'))) then
    raise exception 'LEGACY_JOURNAL_SCOPE_REQUIRES_REVIEW';
  end if;
end $$;
alter table public.edge_decision_journal_v1
  add column if not exists market_scope text not null default 'FULL_GAME',
  add column if not exists record_kind text not null default 'evaluation',
  add column if not exists record_content_sha256 text;
alter table public.edge_decision_journal_v1 drop constraint if exists edge_decision_journal_v1_decision_check;
alter table public.edge_decision_journal_v1 add constraint edge_decision_journal_v1_decision_check
  check (decision in ('BUY','AVOID','PASS','WATCH','REVERSED','PLACED','SELECT_RESEARCH','SELECT_RESEARCH_PRICE_CONDITIONAL','RETAIN','REPORTED_SELECTION'));
alter table public.edge_decision_journal_v1 add constraint edge_decision_journal_scope_check
  check (market_scope in ('FULL_GAME','FIRST_HALF','SECOND_HALF','FIRST_QUARTER','SECOND_QUARTER','THIRD_QUARTER','FOURTH_QUARTER','UNKNOWN'));
-- Recovered rows belong to full-game NBA/MLB capture contracts. Other future
-- writers must supply an explicit scope; an absent period is never graded.
alter table public.edge_decision_journal_v1 alter column market_scope set default 'UNKNOWN';
alter table public.edge_decision_journal_v1 add constraint edge_decision_journal_record_kind_check
  check (record_kind in ('evaluation','recommendation','documented_ticket'));
create index if not exists edge_journal_previous_idx on public.edge_decision_journal_v1(previous_decision_id);
create index if not exists edge_journal_match_idx on public.edge_decision_journal_v1
  (sport,event_id,starts_at,player_id,market_type,market_scope,id);
create index if not exists edge_journal_report_time_idx on public.edge_decision_journal_v1
  ((coalesce(issued_at,recorded_at)));

-- Trigger functions need no elevation: their collectors already use service_role.
alter function public.edge_decision_journal_immutable() security invoker;
alter function public.edge_decision_journal_immutable() set search_path=pg_catalog,public,pg_temp;
alter function public.edge_journal_from_market_grade() security invoker;
alter function public.edge_journal_from_performance_decision() security invoker;
alter function public.edge_journal_from_nba_live() security invoker;
revoke all on function public.edge_decision_journal_immutable(),public.edge_journal_from_market_grade(),
  public.edge_journal_from_performance_decision(),public.edge_journal_from_nba_live() from public,anon,authenticated;
grant execute on function public.edge_decision_journal_immutable(),public.edge_journal_from_market_grade(),
  public.edge_journal_from_performance_decision(),public.edge_journal_from_nba_live() to service_role;
revoke all on public.edge_decision_journal_v1,public.edge_journal_daily_scorecard_v1,
  public.edge_journal_quality_v1,public.edge_journal_outcome_research_v1,public.edge_nba_prop_outcome_audit_v1
  from public,anon,authenticated;
revoke all on public.edge_decision_journal_v1 from service_role;
revoke all on sequence public.edge_decision_journal_v1_id_seq from service_role;
grant select,insert on public.edge_decision_journal_v1 to service_role;
grant usage,select on sequence public.edge_decision_journal_v1_id_seq to service_role;

create or replace function public.record_edge_decision_v1(p_decision jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,pg_temp set timezone='UTC' as $$
declare v public.edge_decision_journal_v1; existing public.edge_decision_journal_v1; prior public.edge_decision_journal_v1;
begin
  if jsonb_typeof(p_decision) is distinct from 'object' or octet_length(p_decision::text)>65536 then
    raise exception 'INVALID_DECISION_PAYLOAD';
  end if;
  v.source:=nullif(btrim(p_decision->>'source'),'');
  v.source_reference:=nullif(btrim(p_decision->>'sourceReference'),'');
  v.sport:=upper(nullif(btrim(p_decision->>'sport'),''));
  v.event_id:=nullif(btrim(p_decision->>'eventId'),'');
  v.player_id:=nullif(btrim(p_decision->>'playerId'),'');
  v.player_name:=nullif(btrim(p_decision->>'playerName'),'');
  v.market_type:=lower(nullif(btrim(p_decision->>'marketType'),''));
  v.market_scope:=coalesce(p_decision->>'marketScope','UNKNOWN');
  v.side:=upper(nullif(btrim(p_decision->>'side'),''));
  if v.side='MORE' then v.side:='OVER'; elsif v.side='LESS' then v.side:='UNDER'; end if;
  v.line:=nullif(p_decision->>'line','')::numeric;
  v.odds:=nullif(p_decision->>'odds','')::integer;
  v.book:=nullif(btrim(p_decision->>'book'),'');
  v.model_probability:=nullif(p_decision->>'modelProbability','')::numeric;
  v.model_version:=nullif(btrim(p_decision->>'modelVersion'),'');
  v.decision:=upper(nullif(btrim(p_decision->>'decision'),''));
  v.provenance:=p_decision->>'provenance';
  v.record_kind:=coalesce(p_decision->>'recordKind','recommendation');
  v.context:=coalesce(p_decision->'context','{}'::jsonb);
  v.evidence:=coalesce(p_decision->'evidence','{}'::jsonb);
  v.previous_decision_id:=nullif(p_decision->>'previousDecisionId','')::bigint;
  v.is_documented_wager:=coalesce((p_decision->>'isDocumentedWager')::boolean,false);
  if v.source is null or v.source_reference is null or v.sport is null or v.market_type is null
    or v.decision is null or v.provenance is null or jsonb_typeof(v.context)<>'object'
    or jsonb_typeof(v.evidence)<>'object' or v.evidence='{}'::jsonb then raise exception 'DECISION_PROVENANCE_REQUIRED'; end if;
  if v.line::text in ('NaN','Infinity','-Infinity') or v.model_probability::text in ('NaN','Infinity','-Infinity')
    or (v.odds is not null and abs(v.odds::bigint)<100) then raise exception 'INVALID_DECISION_NUMBER'; end if;
  if (p_decision->>'issuedAt' is not null and p_decision->>'issuedAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$')
    or (p_decision->>'startsAt' is not null and p_decision->>'startsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$') then
    raise exception 'EXPLICIT_TIMESTAMP_TIMEZONE_REQUIRED';
  end if;
  v.issued_at:=(p_decision->>'issuedAt')::timestamptz;
  v.starts_at:=(p_decision->>'startsAt')::timestamptz;
  if v.issued_at>clock_timestamp()+interval '5 minutes' then raise exception 'FUTURE_ISSUE_TIME'; end if;
  if v.is_documented_wager and (v.provenance<>'documented_ticket' or v.record_kind<>'documented_ticket'
    or nullif(v.evidence->>'ticketReference','') is null) then raise exception 'DOCUMENTED_TICKET_REQUIRED'; end if;
  if v.previous_decision_id is not null then
    select * into prior from public.edge_decision_journal_v1 where id=v.previous_decision_id;
    if not found or (prior.sport,prior.event_id,prior.starts_at,prior.player_id,prior.market_type,prior.market_scope)
      is distinct from (v.sport,v.event_id,v.starts_at,v.player_id,v.market_type,v.market_scope)
      or prior.issued_at>v.issued_at then raise exception 'PREVIOUS_DECISION_IDENTITY_MISMATCH'; end if;
  end if;
  v.record_content_sha256:=encode(sha256(convert_to((to_jsonb(v)-'id'-'recorded_at'-'record_content_sha256')::text,'UTF8')),'hex');
  insert into public.edge_decision_journal_v1
    (issued_at,source,source_reference,sport,event_id,starts_at,player_id,player_name,market_type,side,line,odds,book,
     decision,previous_decision_id,model_probability,model_version,context,evidence,provenance,is_documented_wager,
     market_scope,record_kind,record_content_sha256)
  values(v.issued_at,v.source,v.source_reference,v.sport,v.event_id,v.starts_at,v.player_id,v.player_name,v.market_type,v.side,
    v.line,v.odds,v.book,v.decision,v.previous_decision_id,v.model_probability,v.model_version,v.context,v.evidence,v.provenance,
    v.is_documented_wager,v.market_scope,v.record_kind,v.record_content_sha256)
  on conflict(source,source_reference) do nothing returning * into existing;
  if not found then
    select * into existing from public.edge_decision_journal_v1 where source=v.source and source_reference=v.source_reference;
    if existing.record_content_sha256 is distinct from v.record_content_sha256 then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  end if;
  return jsonb_build_object('journalId',existing.id,'recordedAt',existing.recorded_at,
    'issuedAt',existing.issued_at,'documentedWager',existing.is_documented_wager,
    'captureTiming',case when existing.issued_at is null then 'ORIGINAL_TIME_UNKNOWN'
      when existing.starts_at is null then 'EVENT_TIME_UNKNOWN'
      when existing.recorded_at>=existing.starts_at then 'IMPORTED_AFTER_EVENT_START' else 'CAPTURED_BEFORE_START' end);
end $$;

-- These are reviewed statistical results, never sportsbook ticket settlements.
-- Provider outcomes remain separate and are not promoted to official evidence.
create table public.edge_official_result_revisions_v1 (
  id bigint generated always as identity primary key,
  recorded_at timestamptz not null default clock_timestamp(),
  result_key text not null,
  revision integer not null check(revision>0),
  supersedes_result_id bigint,
  sport text not null check(sport in ('NBA','NFL','NHL','MLB')),
  event_id text not null,
  starts_at timestamptz not null,
  player_id text,
  market_type text not null,
  market_scope text not null check(market_scope in ('FULL_GAME','FIRST_HALF','SECOND_HALF','FIRST_QUARTER','SECOND_QUARTER','THIRD_QUARTER','FOURTH_QUARTER')),
  actual_value numeric,
  away_score integer check(away_score>=0),
  home_score integer check(home_score>=0),
  participation text not null check(participation in ('PLAYED','NOT_APPLICABLE')),
  official_event_id text not null,
  official_player_id text,
  source_url text not null,
  source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
  source_capture_format text not null check(source_capture_format in ('ORIGIN_RESPONSE_BYTES','SEARCH_SERVICE_EXTRACTED_OFFICIAL_PAGE')),
  retrieved_at timestamptz not null,
  verified_by text not null,
  identity_evidence jsonb not null,
  content_sha256 text not null,
  unique(result_key,revision), unique(result_key,id), unique(supersedes_result_id),
  foreign key(result_key,supersedes_result_id) references public.edge_official_result_revisions_v1(result_key,id),
  check((revision=1 and supersedes_result_id is null) or (revision>1 and supersedes_result_id is not null)),
  check(actual_value is null or actual_value::text not in ('NaN','Infinity','-Infinity'))
);
create index edge_official_result_match_idx on public.edge_official_result_revisions_v1
  (sport,event_id,starts_at,player_id,market_type,market_scope,revision desc);
create index edge_official_result_content_idx on public.edge_official_result_revisions_v1(result_key,content_sha256);
create table public.edge_journal_grades_v1 (
  journal_id bigint not null references public.edge_decision_journal_v1(id),
  result_id bigint not null references public.edge_official_result_revisions_v1(id),
  graded_at timestamptz not null default clock_timestamp(),
  actual_value numeric not null,
  outcome text not null check(outcome in ('W','L','PUSH')),
  policy text not null default 'STATISTICAL_THRESHOLD_ONLY' check(policy='STATISTICAL_THRESHOLD_ONLY'),
  primary key(journal_id,result_id)
);
create index edge_journal_grade_result_idx on public.edge_journal_grades_v1(result_id,journal_id);
create trigger edge_official_result_immutable before update or delete on public.edge_official_result_revisions_v1
  for each row execute function public.edge_decision_journal_immutable();
create trigger edge_journal_grade_immutable before update or delete on public.edge_journal_grades_v1
  for each row execute function public.edge_decision_journal_immutable();
alter table public.edge_official_result_revisions_v1 enable row level security;
alter table public.edge_journal_grades_v1 enable row level security;
revoke all on public.edge_official_result_revisions_v1,public.edge_journal_grades_v1 from public,anon,authenticated;
revoke all on public.edge_official_result_revisions_v1,public.edge_journal_grades_v1 from service_role;
revoke all on sequence public.edge_official_result_revisions_v1_id_seq from service_role;
grant select,insert on public.edge_official_result_revisions_v1,public.edge_journal_grades_v1 to service_role;
grant usage,select on sequence public.edge_official_result_revisions_v1_id_seq to service_role;

create or replace function public.record_edge_official_result_v1(p_result jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,pg_temp set timezone='UTC' as $$
declare v public.edge_official_result_revisions_v1; prior public.edge_official_result_revisions_v1;
  identical public.edge_official_result_revisions_v1; official_domain text;
begin
  if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>65536
    or p_result->>'status' is distinct from 'FINAL' then raise exception 'REVIEWED_FINAL_RESULT_REQUIRED'; end if;
  v.sport:=upper(nullif(btrim(p_result->>'sport'),''));
  v.event_id:=nullif(btrim(p_result->>'eventId'),'');
  v.player_id:=nullif(btrim(p_result->>'playerId'),'');
  v.market_type:=lower(nullif(btrim(p_result->>'marketType'),''));
  v.market_scope:=p_result->>'marketScope';
  v.official_event_id:=nullif(btrim(p_result->>'officialEventId'),'');
  v.official_player_id:=nullif(btrim(p_result->>'officialPlayerId'),'');
  v.source_url:=p_result->>'sourceUrl';
  v.source_sha256:=p_result->>'sourceSha256';
  v.source_capture_format:=p_result->>'sourceCaptureFormat';
  v.verified_by:=nullif(btrim(p_result->>'verifiedBy'),'');
  v.identity_evidence:=p_result->'identityEvidence';
  v.participation:=p_result->>'participation';
  v.actual_value:=(p_result->>'actualValue')::numeric;
  v.away_score:=(p_result->>'awayScore')::integer;
  v.home_score:=(p_result->>'homeScore')::integer;
  v.supersedes_result_id:=(p_result->>'supersedesResultId')::bigint;
  if v.event_id is null or v.official_event_id is null or v.verified_by is null
    or jsonb_typeof(v.identity_evidence) is distinct from 'object' or v.identity_evidence='{}'::jsonb then
    raise exception 'EXACT_OFFICIAL_IDENTITY_REVIEW_REQUIRED'; end if;
  official_domain:=case v.sport when 'NBA' then 'nba' when 'NFL' then 'nfl' when 'NHL' then 'nhl' when 'MLB' then 'mlb' end;
  if official_domain is null or v.source_url is null or lower(v.source_url) !~
    ('^https://([a-z0-9-]+\.)*'||official_domain||'\.com(/|$)') then raise exception 'OFFICIAL_SOURCE_URL_REQUIRED'; end if;
  if p_result->>'startsAt' is null or p_result->>'retrievedAt' is null
    or p_result->>'startsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
    or p_result->>'retrievedAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'EXPLICIT_TIMESTAMP_TIMEZONE_REQUIRED'; end if;
  v.starts_at:=(p_result->>'startsAt')::timestamptz;
  v.retrieved_at:=(p_result->>'retrievedAt')::timestamptz;
  if v.retrieved_at<v.starts_at or v.retrieved_at>clock_timestamp() or v.starts_at>=clock_timestamp() then raise exception 'INVALID_RESULT_RETRIEVAL_TIME'; end if;
  -- This binds a named reviewer's assertion to the captured source and both ID
  -- namespaces. It does not claim that URL/ID equality alone verifies a box score.
  if nullif(btrim(v.identity_evidence->>'reference'),'') is null
    or jsonb_build_array(v.identity_evidence->>'eventId',(v.identity_evidence->>'startsAt')::timestamptz,
      v.identity_evidence->>'playerId',v.identity_evidence->>'officialEventId',v.identity_evidence->>'officialPlayerId',
      v.identity_evidence->>'marketScope',v.identity_evidence->>'marketType',v.identity_evidence->>'sourceSha256',v.identity_evidence->>'sourceCaptureFormat')
    is distinct from jsonb_build_array(v.event_id,v.starts_at,v.player_id,v.official_event_id,v.official_player_id,
      v.market_scope,v.market_type,v.source_sha256,v.source_capture_format) then raise exception 'OFFICIAL_IDENTITY_EVIDENCE_MISMATCH'; end if;
  if v.market_type in ('moneyline','spread','total') then
    if v.player_id is not null or v.official_player_id is not null or v.away_score is null or v.home_score is null
      or v.participation is distinct from 'NOT_APPLICABLE' or v.actual_value is not null then raise exception 'INVALID_TEAM_RESULT'; end if;
  elsif v.market_type in ('points','rebounds','assists','threes','points_assists','points_rebounds','rebounds_assists',
      'points_rebounds_assists','pra','rushing_yards','receiving_yards','passing_yards','receptions','passing_attempts','rushing_attempts') then
    if v.player_id is null or v.official_player_id is null or v.actual_value is null
      or v.participation is distinct from 'PLAYED' or v.away_score is not null or v.home_score is not null then raise exception 'INVALID_PLAYER_RESULT'; end if;
    if v.actual_value<>trunc(v.actual_value) or (v.actual_value<0 and (v.sport='NBA'
      or v.market_type not in ('rushing_yards','receiving_yards','passing_yards'))) then raise exception 'INVALID_COUNT_STATISTIC'; end if;
  else raise exception 'UNSUPPORTED_RESULT_MARKET'; end if;
  v.result_key:=encode(sha256(convert_to(jsonb_build_array(v.sport,v.event_id,v.starts_at,v.player_id,v.market_type,v.market_scope)::text,'UTF8')),'hex');
  v.content_sha256:=encode(sha256(convert_to((to_jsonb(v)-'id'-'recorded_at'-'content_sha256'-'revision'-'supersedes_result_id'-'retrieved_at')::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v.result_key,0));
  select * into identical from public.edge_official_result_revisions_v1 where result_key=v.result_key
    and content_sha256=v.content_sha256 and supersedes_result_id is not distinct from v.supersedes_result_id;
  if found then return jsonb_build_object('resultId',identical.id,'revision',identical.revision,'inserted',false); end if;
  select * into prior from public.edge_official_result_revisions_v1 where result_key=v.result_key order by revision desc limit 1;
  if found then
    if v.supersedes_result_id is null then raise exception 'PREVIOUS_RESULT_REQUIRED'; end if;
    if v.supersedes_result_id<>prior.id then raise exception 'STALE_RESULT_REVISION'; end if;
    v.revision:=prior.revision+1;
  else
    if v.supersedes_result_id is not null then raise exception 'PREVIOUS_RESULT_IDENTITY_MISMATCH'; end if;
    v.revision:=1;
  end if;
  insert into public.edge_official_result_revisions_v1
    (result_key,revision,supersedes_result_id,sport,event_id,starts_at,player_id,market_type,market_scope,actual_value,
     away_score,home_score,participation,official_event_id,official_player_id,source_url,source_sha256,source_capture_format,retrieved_at,verified_by,identity_evidence,content_sha256)
  values(v.result_key,v.revision,v.supersedes_result_id,v.sport,v.event_id,v.starts_at,v.player_id,v.market_type,v.market_scope,v.actual_value,
    v.away_score,v.home_score,v.participation,v.official_event_id,v.official_player_id,v.source_url,v.source_sha256,v.source_capture_format,v.retrieved_at,v.verified_by,v.identity_evidence,v.content_sha256)
  returning id into v.id;
  return jsonb_build_object('resultId',v.id,'revision',v.revision,'inserted',true);
end $$;

create or replace function public.grade_edge_journal_result_v1(p_result_id bigint,p_limit integer default 1000)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare r public.edge_official_result_revisions_v1; inserted_count integer; remaining_count integer;
begin
  if p_limit is null or p_limit<1 or p_limit>2000 then raise exception 'GRADE_BATCH_LIMIT_1_TO_2000'; end if;
  select * into r from public.edge_official_result_revisions_v1 where id=p_result_id;
  if not found then raise exception 'OFFICIAL_RESULT_NOT_FOUND'; end if;
  -- Serialize with both result corrections and other graders without granting
  -- UPDATE on either immutable ledger to its service caller.
  perform pg_advisory_xact_lock(hashtextextended(r.result_key,0));
  if exists(select 1 from public.edge_official_result_revisions_v1 where result_key=r.result_key and revision>r.revision) then
    raise exception 'SUPERSEDED_RESULT_CANNOT_GRADE'; end if;
  with candidates as (
    select j.id,j.line,upper(j.side) as side,
      case when r.market_type='total' then r.away_score+r.home_score
        when r.market_type in ('moneyline','spread') then case upper(j.side) when 'HOME' then r.home_score else r.away_score end
        else r.actual_value end as actual_value
    from public.edge_decision_journal_v1 j
    where j.sport=r.sport and j.event_id=r.event_id and j.starts_at=r.starts_at
      and j.player_id is not distinct from r.player_id and j.market_type=r.market_type and j.market_scope=r.market_scope
      and ((r.market_type in ('moneyline','spread') and upper(j.side) in ('HOME','AWAY'))
        or (r.market_type not in ('moneyline','spread') and upper(j.side) in ('OVER','UNDER','MORE','LESS')))
      and (r.market_type='moneyline' or (j.line is not null and j.line::text not in ('NaN','Infinity','-Infinity')))
      and not exists(select 1 from public.edge_journal_grades_v1 g where g.journal_id=j.id and g.result_id=r.id)
    order by j.id limit p_limit
  ), comparisons as (
    select *,case when r.market_type in ('moneyline','spread') then actual_value+case when r.market_type='spread' then line else 0 end
        -case side when 'HOME' then r.away_score else r.home_score end
      when side in ('OVER','MORE') then actual_value-line else line-actual_value end as margin from candidates
  )
  insert into public.edge_journal_grades_v1(journal_id,result_id,actual_value,outcome)
  select id,r.id,actual_value,case when margin=0 then 'PUSH' when margin>0 then 'W' else 'L' end from comparisons
  on conflict(journal_id,result_id) do nothing;
  get diagnostics inserted_count=row_count;
  select count(*) into remaining_count from public.edge_decision_journal_v1 j
    where j.sport=r.sport and j.event_id=r.event_id and j.starts_at=r.starts_at
      and j.player_id is not distinct from r.player_id and j.market_type=r.market_type and j.market_scope=r.market_scope
      and ((r.market_type in ('moneyline','spread') and upper(j.side) in ('HOME','AWAY'))
        or (r.market_type not in ('moneyline','spread') and upper(j.side) in ('OVER','UNDER','MORE','LESS')))
      and (r.market_type='moneyline' or (j.line is not null and j.line::text not in ('NaN','Infinity','-Infinity')))
      and not exists(select 1 from public.edge_journal_grades_v1 g where g.journal_id=j.id and g.result_id=r.id);
  return jsonb_build_object('resultId',r.id,'revision',r.revision,'inserted',inserted_count,'remaining',remaining_count,
    'policy','STATISTICAL_THRESHOLD_ONLY','documentedWagerSettlement',false);
end $$;

-- Bounded, private report. Every refresh is retained, but each exact market side
-- is counted once using the earliest recorded decision. No ROI is manufactured.
create or replace function public.edge_journal_scorecard_v2(p_from timestamptz,p_to timestamptz,p_record_kind text default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,pg_temp set timezone='UTC' as $$
declare report jsonb;
begin
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_from>=p_to or p_to-p_from>interval '31 days' then raise exception 'SCORECARD_WINDOW_MAX_31_DAYS'; end if;
  if p_record_kind is not null and p_record_kind not in ('evaluation','recommendation','documented_ticket') then
    raise exception 'INVALID_RECORD_KIND'; end if;
  with raw as materialized (
    select * from public.edge_decision_journal_v1 where coalesce(issued_at,recorded_at)>=p_from and coalesce(issued_at,recorded_at)<p_to
      and (p_record_kind is null or record_kind=p_record_kind)
  ), ranked as (
    select j.*,row_number() over(partition by sport,event_id,starts_at,player_id,market_type,market_scope,upper(side),line
      order by recorded_at,id) as n from raw j
    where event_id is not null and starts_at is not null and market_scope<>'UNKNOWN'
      and ((market_type in ('moneyline','spread') and upper(side) in ('HOME','AWAY'))
        or (market_type not in ('moneyline','spread') and upper(side) in ('OVER','UNDER','MORE','LESS')))
      and (market_type='moneyline' or (line is not null and line::text not in ('NaN','Infinity','-Infinity')))
      and (market_type in ('moneyline','spread','total') or player_id is not null)
  ), unique_markets as (
    select j.*,g.outcome from ranked j left join lateral (
      select grade.outcome from public.edge_journal_grades_v1 grade
      join public.edge_official_result_revisions_v1 r on r.id=grade.result_id
      where grade.journal_id=j.id and not exists(select 1 from public.edge_official_result_revisions_v1 later
        where later.result_key=r.result_key and later.revision>r.revision)
      order by r.revision desc limit 1
    ) g on true where j.n=1
  )
  select jsonb_build_object('from',p_from,'to',p_to,'recordKind',p_record_kind,
    'rawRecords',(select count(*) from raw),
    'uniqueMarketSides',count(*),'uniqueGames',count(distinct (sport,event_id,starts_at)),
    'gradedMarketSides',count(*) filter(where outcome is not null),
    'wins',count(*) filter(where outcome='W'),'losses',count(*) filter(where outcome='L'),'pushes',count(*) filter(where outcome='PUSH'),
    'prospectiveMarketSides',count(*) filter(where provenance='system' and issued_at<starts_at and recorded_at<starts_at),
    'unknownOriginalTimeRecords',(select count(*) from raw where issued_at is null),
    'unresolvedIdentityRecords',(select count(*) from raw)-(select count(*) from ranked),
    'wagerSettlementCount',0,'bettingROI',null,'policy','STATISTICAL_THRESHOLD_ONLY',
    'selectionRule','EARLIEST_RECORDED_DECISION_PER_EXACT_MARKET_SIDE',
    'byDecision',(select coalesce(jsonb_agg(d),'[]'::jsonb) from (
      select decision,count(*) as markets,count(*) filter(where outcome='W') as wins,
        count(*) filter(where outcome='L') as losses,count(*) filter(where outcome='PUSH') as pushes
      from unique_markets group by decision order by decision
    ) d)) into report from unique_markets;
  return report;
end $$;

-- Statistical result matching does not require a quoted price or forecast.
create or replace view public.edge_journal_quality_v1 with (security_invoker=true) as
select id,issued_at,sport,source,source_reference,decision,market_type,
  case when market_scope='UNKNOWN' then 'MISSING_MARKET_SCOPE'
    when market_type not in ('moneyline','spread','total','points','rebounds','assists','threes','points_assists','points_rebounds','rebounds_assists',
      'points_rebounds_assists','pra','rushing_yards','receiving_yards','passing_yards','receptions','passing_attempts','rushing_attempts') then 'UNSUPPORTED_MARKET'
    when event_id is null then 'MISSING_EVENT' when starts_at is null then 'MISSING_START_TIME'
    when side is null then 'MISSING_SIDE'
    when (market_type in ('moneyline','spread') and upper(side) not in ('HOME','AWAY'))
      or (market_type not in ('moneyline','spread') and upper(side) not in ('OVER','UNDER','MORE','LESS')) then 'INVALID_SIDE'
    when line is null and market_type<>'moneyline' then 'MISSING_LINE'
    when line::text in ('NaN','Infinity','-Infinity') then 'INVALID_LINE'
    when market_type not in ('moneyline','spread','total') and player_id is null then 'MISSING_PLAYER_ID'
    else 'READY_FOR_STATISTICAL_OUTCOME_MATCH' end as reconciliation_state
from public.edge_decision_journal_v1;
revoke all on function public.record_edge_decision_v1(jsonb),public.record_edge_official_result_v1(jsonb),
  public.grade_edge_journal_result_v1(bigint,integer),public.edge_journal_scorecard_v2(timestamptz,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.record_edge_decision_v1(jsonb),public.record_edge_official_result_v1(jsonb),
  public.grade_edge_journal_result_v1(bigint,integer),public.edge_journal_scorecard_v2(timestamptz,timestamptz,text) to service_role;
revoke all on public.edge_journal_quality_v1 from public,anon,authenticated;
grant select on public.edge_journal_daily_scorecard_v1,public.edge_journal_quality_v1,
  public.edge_journal_outcome_research_v1,public.edge_nba_prop_outcome_audit_v1 to service_role;

-- Keep period provenance at capture: the MLB and NBA v1 pipelines admit only
-- full-game markets; the generic performance stream requires an explicit period.
create or replace function public.edge_journal_from_market_grade() returns trigger language plpgsql security invoker set search_path = public,pg_temp as $$
begin
 insert into public.edge_decision_journal_v1 (issued_at,source,source_reference,sport,event_id,starts_at,market_type,side,line,odds,book,decision,model_probability,model_version,context,evidence,provenance,market_scope)
 values (new.captured_at,'market_grade_observations',new.id::text,new.sport,new.event_id,new.starts_at,new.market_type,new.market_side,new.line,new.best_odds,new.best_book,
 case when upper(coalesce(new.non_sharp_status,'')) in ('PASS','AVOID') then upper(new.non_sharp_status) else 'WATCH' end,
 new.model_probability,new.model_version,
 jsonb_build_object('market_label',new.market_label,'away_team',new.away_team,'home_team',new.home_team,'original_status',new.non_sharp_status),
 jsonb_build_object('reason',new.reason,'ev_pct',new.ev_pct,'edge_pct_points',new.edge_pct_points,'raw',new.raw),'system','FULL_GAME')
 on conflict (source,source_reference) do nothing;
 return new;
end $$;

create or replace function public.edge_journal_from_performance_decision() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 insert into public.edge_decision_journal_v1(issued_at,source,source_reference,sport,event_id,starts_at,market_type,side,line,odds,book,decision,model_probability,model_version,context,evidence,provenance,market_scope)
 values(new.issued_at,'performance_decisions',new.id::text,coalesce(new.payload->>'sport','UNKNOWN'),new.payload->>'event_id',
 nullif(new.payload->>'starts_at','')::timestamptz,coalesce(new.payload->>'market_type',new.market_key,'unknown'),new.payload->>'side',
 nullif(new.payload->>'line','')::numeric,nullif(new.payload->>'odds','')::integer,new.payload->>'book',
 case when upper(coalesce(new.status,'')) in ('BUY','AVOID','PASS','WATCH','REVERSED','PLACED') then upper(new.status) else 'WATCH' end,
 nullif(new.payload->>'model_probability','')::numeric,new.payload->>'model_version',
 jsonb_build_object('market_key',new.market_key,'source_key',new.source_key,'qualified',new.qualified,'original_status',new.status),
 coalesce(new.evidence,'{}'::jsonb),'system',case upper(coalesce(new.payload->>'market_scope',new.payload->>'marketScope',new.payload->>'period','UNKNOWN')) when 'GAME' then 'FULL_GAME' when 'FULL_GAME' then 'FULL_GAME' when 'FIRST_HALF' then 'FIRST_HALF' when 'SECOND_HALF' then 'SECOND_HALF' when 'FIRST_QUARTER' then 'FIRST_QUARTER' when 'SECOND_QUARTER' then 'SECOND_QUARTER' when 'THIRD_QUARTER' then 'THIRD_QUARTER' when 'FOURTH_QUARTER' then 'FOURTH_QUARTER' else 'UNKNOWN' end)
 on conflict(source,source_reference) do nothing;
 return new;
end $$;

create or replace function public.edge_journal_from_nba_live() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_status text;
begin
 v_status:=upper(coalesce(new.payload->>'status','PASS'));
 insert into public.edge_decision_journal_v1
 (issued_at,source,source_reference,sport,event_id,starts_at,player_id,market_type,side,line,odds,book,decision,model_probability,model_version,context,evidence,provenance,market_scope)
 values (new.decided_at,'nba_live_decisions_v1',new.decision_id,'NBA',new.payload->>'eventID',new.starts_at,new.payload->>'playerID',
 coalesce(new.payload->>'market','unknown'),new.payload->>'side',
 nullif(new.payload->>'line','')::numeric,nullif(new.payload->>'odds','')::integer,new.payload->>'book',
 case when v_status in ('BUY','AVOID','PASS','WATCH','REVERSED') then v_status else 'PASS' end,
 nullif(new.payload->>'modelProbability','')::numeric,new.model_hash,
 jsonb_build_object('identity',new.identity,'approval_id',new.approval_id,'production_eligible',new.payload->'productionEligible','original_status',v_status),
 jsonb_build_object('decision_id',new.decision_id,'reason',new.payload->'reason','reasons',new.payload->'reasons','quote_at',new.payload->'quoteAt','evidence',new.payload->'evidence'),
 'system','FULL_GAME')
 on conflict(source,source_reference) do nothing;
 return new;
end $$;
