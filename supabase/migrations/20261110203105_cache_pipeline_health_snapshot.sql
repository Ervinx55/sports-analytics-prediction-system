-- Keep expensive monitoring reads off the interactive request path.
CREATE TABLE public.pipeline_health_snapshot (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 observed_at timestamptz NOT NULL,
 data jsonb NOT NULL CHECK (jsonb_typeof(data)='array')
);
ALTER TABLE public.pipeline_health_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pipeline_health_snapshot FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pipeline_health_snapshot TO service_role;
INSERT INTO public.pipeline_health_snapshot (id, observed_at, data)
SELECT true, now(), coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.critical DESC, h.subsystem, h.display_name), '[]'::jsonb)
FROM public.pipeline_component_health_v1 h
ON CONFLICT (id) DO UPDATE SET observed_at=excluded.observed_at, data=excluded.data;
SELECT cron.schedule('refresh-pipeline-health-snapshot', '* * * * *', $job$INSERT INTO public.pipeline_health_snapshot (id, observed_at, data)
SELECT true, now(), coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.critical DESC, h.subsystem, h.display_name), '[]'::jsonb)
FROM public.pipeline_component_health_v1 h
ON CONFLICT (id) DO UPDATE SET observed_at=excluded.observed_at, data=excluded.data;$job$);
