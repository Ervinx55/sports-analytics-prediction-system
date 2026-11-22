# MLB verification recovery — diagnostic plan

Status: investigation only. No production changes or betting-gate relaxation.

## Confirmed architecture
- Vercel production alias `sports-analytics-prediction-system-tau.vercel.app` maps to project `sports-analytics-prediction-system-6ihx`, deployed from this repository's `master`.
- Current `api/` contains `sharp.js` and `crypto-candles.js`; `api/verify.js` and `api/decision.js` are absent.
- Supabase functions include `refresh-mlb-verification-gate`, `mlb-verification-status`, and `pipeline-health-status`.
- `mlb-verification-status` explicitly returns `shadowOnly: true` and `affectsDecision: false`. It is not proof of a production FINAL_PLAY gate.

## Diagnosis before implementation
1. Probe the live `/api/verify?date=YYYY-MM-DD` and `/api/decision?date=YYYY-MM-DD` responses and record HTTP status, content type, and request IDs. Distinguish 404 missing route, 401 authentication, 429 quota, and 500 internal errors.
2. Check production deployment's function list and build logs; confirm whether the routes ever existed in the deployed artifact. Do not infer source from the alias alone.
3. Check Supabase `pipeline-health-status` and `mlb-verification-status` with safe credentials; record timestamps, stale jobs, errors, and verification counts.
4. Trace whether any actual decision endpoint consumes Supabase team/prop verification gates. Preserve `shadowOnly` until explicitly reviewed.
5. Inspect `api/sharp.js` upstream errors. The configured SportsGameOdds feed does not independently establish direct Pinnacle/Circa/BookMaker confirmation.
6. Add structured, sanitized diagnostics and regression tests for missing routes, expired odds, provider outages, conflicting total lines, absent confirmed lineups, and absent direct sharp confirmation.

## Status taxonomy
- `MODEL_PASS`: candidate clears model threshold but has not cleared final gates.
- `DATA_BLOCKED`: required data unavailable, stale, or provider failed.
- `SHARP_PENDING`: direct sharp confirmation absent.
- `FINAL_PLAY`: every mandatory gate passed, with audited odds, timestamp, model probability, and EV.
- `PASS`: genuine negative or disqualifying signal.

Do not promote any candidate to FINAL_PLAY when required evidence is missing. Maintain a separate shadow outcome log to measure calibration and closing-line value.
