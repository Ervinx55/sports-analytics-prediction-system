"""Private Edge Lab slip archive page for the Streamlit analytics dashboard.

Server-side secrets required:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  EDGE_LAB_DASHBOARD_PASSWORD

Never expose SUPABASE_SERVICE_ROLE_KEY through client code or the page.
"""
from __future__ import annotations

import hmac
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import pandas as pd
import streamlit as st


st.set_page_config(page_title="Edge Lab | Slip History", layout="wide")
st.title("Edge Lab — Slip History")
st.caption("Historical tickets and research hypotheses. Ticket screenshots are not official settlements or calibrated forecasts.")


def secret(name: str) -> str:
    value = os.environ.get(name, "")
    if value:
        return value
    try:
        return str(st.secrets.get(name, ""))
    except (FileNotFoundError, KeyError):
        return ""


password = secret("EDGE_LAB_DASHBOARD_PASSWORD")
if not password:
    st.warning("Edge Lab history is locked. Configure EDGE_LAB_DASHBOARD_PASSWORD in the server's private secrets.")
    st.stop()

if not st.session_state.get("edge_lab_authorized", False):
    with st.form("edge_lab_unlock"):
        entered = st.text_input("Edge Lab access password", type="password")
        unlock = st.form_submit_button("Unlock history")
    if unlock:
        if hmac.compare_digest(entered, password):
            st.session_state["edge_lab_authorized"] = True
            st.rerun()
        else:
            st.error("Incorrect password.")
    st.stop()

if st.button("Lock history"):
    st.session_state["edge_lab_authorized"] = False
    st.rerun()

url = secret("SUPABASE_URL").rstrip("/")
api_key = secret("SUPABASE_SERVICE_ROLE_KEY")
if not url.startswith("https://") or not api_key:
    st.error("Server-side Supabase connection is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY privately.")
    st.stop()


@st.cache_data(ttl=60, show_spinner=False)
def get_slips(project_url: str, _service_key: str) -> list[dict]:
    req = Request(
        f"{project_url}/rest/v1/rpc/edge_lab_slip_history_v1",
        data=b"{}",
        method="POST",
        headers={
            "apikey": _service_key,
            "Authorization": f"Bearer {_service_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    with urlopen(req, timeout=12) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, list):
        raise ValueError("Unexpected archive response")
    return payload


if st.button("Refresh archive"):
    get_slips.clear()

try:
    slips = get_slips(url, api_key)
except (HTTPError, URLError, TimeoutError, ValueError):
    st.error("The private Edge Lab archive is currently unavailable. Check server secrets and database RPC permissions.")
    st.stop()

if not slips:
    st.info("No archived slips have been recorded yet.")
    st.stop()

st.metric("Archived slips", len(slips))
for slip in slips:
    label = f"{slip['event_date']} · {slip['slip_key']}"
    with st.expander(label, expanded=True):
        a, b, c = st.columns(3)
        a.metric("Entry", f"${float(slip.get('ticket_wager_usd') or 0):.2f}")
        b.metric("Potential payout", f"${float(slip.get('potential_payout_usd') or 0):.2f}")
        c.metric("Recorded status", str(slip.get("reported_slip_status", "UNKNOWN")).replace("_", " "))
        st.caption(f"Source: {slip.get('source', '')} · Captured stage: {slip.get('recorded_at_stage', '')}")
        rows = []
        for leg in slip.get("legs") or []:
            rows.append({
                "Player": leg.get("player"),
                "Market": leg.get("market"),
                "Side": leg.get("side"),
                "Ticket line": leg.get("line"),
                "Screenshot stat": leg.get("screenshot_stat"),
                "Model paper hypothesis": "Yes" if leg.get("prior_assistant_paper_buy") else "No",
                "Original model line": leg.get("prior_paper_line", "—"),
            })
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
        st.caption("A green screenshot leg is not a verified final settlement. Paper hypotheses are separate from official model predictions.")
        if slip.get("integrity_notes"):
            st.info(slip["integrity_notes"])
