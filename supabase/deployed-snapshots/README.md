# Observed production function bundles

These versioned directories preserve the exact file bytes returned by Supabase
for the deployments observed on 2026-11-23. Each bundle keeps its own original
file names and directory layout. The authoritative names, entrypoint, version,
gateway JWT setting, deployed bundle digest, and individual file digests are in
`supabase/manifests/edge-functions.json`.

This is source recovery, not approval to deploy the captured behavior. Do not
copy these bundles wholesale into the working application tree or deploy them
automatically. Review the caller, authentication, data-write, and model-gating
contracts before a future deployment. The existing working sources may contain
newer reviewed changes. Two separate deployed bundles also contain different
versions of the same helper path; their private bundle layouts are intentional.

The manifest's `entrypoint` refers to an actual returned bundle file name.
`hostedEntrypointPath` records historical build metadata and can contain a stale
build-directory prefix. It is provenance, not a local path to deploy. The
newly recorded `config.toml` sections preserve observed gateway settings; they
do not make a default function-directory deployment appropriate.

The two `LOCAL_SOURCE` manifest entries retain their existing working-source
hashes separately from `deploymentObservation.files`. A reviewed fix that is
subsequently deployed can instead point at its verified canonical source.
Older snapshots remain historical evidence and must not replace that fix.

Do not normalize formatting or line endings in these files. Reconstruction
validation checks exact SHA-256 values, including nested file entries. Captured
whitespace is preserved even when a generic whitespace check flags it.

No production function was redeployed by copying these snapshots. Current
schema, grants, RLS, cron settings, data quality, and model approval require
their own review; matching a source inventory does not establish those facts.
