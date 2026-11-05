# Edge Lab private slip history dashboard

Status: Source implemented; NOT verified as deployed to a live user-facing site.

## Files
- Streamlit page: `pages/1_Edge_Lab.py`
- Database: private table `edge_lab.slip_archive`
- Read-only RPC: `public.edge_lab_slip_history_v1()` in Supabase project `yeoxroijaptomomshdii`

## Security
- RPC is executable by `service_role` only (explicitly denied to `PUBLIC`, `anon`, and `authenticated`).
- The Streamlit page requires `EDGE_LAB_DASHBOARD_PASSWORD` before it retrieves data.
- Never put `SUPABASE_SERVICE_ROLE_KEY` in browser JavaScript, GitHub, publicly visible Vercel variables, screenshots or chat.
- Store it only as a private server runtime secret. Use a different strong dashboard password.
- The Streamlit history page is historical evidence, not an official pregame-model prediction ledger.

## Server-only secrets required
- `SUPABASE_URL=https://yeoxroijaptomomshdii.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=<private project service-role credential>`
- `EDGE_LAB_DASHBOARD_PASSWORD=<unique strong dashboard password>`

Set these in your private Streamlit app server environment or Streamlit Cloud secrets. Do not include values in source code or examples.

## Local check
1. Ensure Python dependencies in `requirements.txt` are installed.
2. Run `streamlit run app.py`.
3. Click the `Edge Lab` page in Streamlit navigation.
4. Supply the private dashboard password.
5. Confirm the 2026-11-04 six-leg PrizePicks record displays with status `IN_PROGRESS`, `$15` entry, and `$532.50` potential payout.
6. Verify a visitor without the password cannot read records.
7. Update slip status only against confirmed final bookmaker settlement; a green in-game screenshot is not proof of payment.

## Scope limit
This repository's visible frontend is a **Streamlit** app (`app.py`), while Vercel currently hosts a lightweight odds API (`api/sharp.js`). The connected Vercel account did not expose a linked frontend deployment. If a separate Edge Lab website exists, adapt its protected server API to use this service-role-only RPC; do not expose the key or private data from the browser.

## Model integrity
- Four of the six screenshot legs correspond to earlier assistant-generated paper hypotheses.
- Keyonte George ticket line (Over 20.5) differs from the original research line (Over 21.5).
- Jaylen Brown and Isaiah Hartenstein are user ticket legs, not assistant-generated pregame picks.
- No historical event has been fabricated or backdated into `performance_predictions`/`performance_decisions`.
- Automated official settlement remains unconfigured.
