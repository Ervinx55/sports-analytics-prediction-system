create or replace view public.player_prop_training_export
with (security_invoker = true)
as
select
  f.*,
  r.won,
  r.pushed,
  r.outcome
from public.player_prop_feature_store f
join public.player_prop_results r
  on r.observation_id = f.observation_id
where r.won is not null;

revoke all on public.player_prop_training_export from anon, authenticated;
grant select on public.player_prop_training_export to service_role;

drop function if exists public.export_player_prop_training_rows();

create function public.export_player_prop_training_rows()
returns setof public.player_prop_training_export
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from public.player_prop_training_export
  order by starts_at, feature_available_at, observation_id;
$$;

revoke all on function public.export_player_prop_training_rows()
  from public, anon, authenticated;
grant execute on function public.export_player_prop_training_rows()
  to service_role;
