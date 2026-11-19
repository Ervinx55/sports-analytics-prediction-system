"""Opt-in server-side sync of verified local split snapshots to Supabase.

Uses the existing SQLite archive. Default is dry-run. Never expose the
secret key in browser bundles or logs. No automated vendor scraping.
"""
import argparse
import json
import os
import sqlite3
from urllib.request import Request, urlopen
from urllib.parse import urlparse


def build_rows(db_path):
    with sqlite3.connect(db_path) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute("""SELECT event_id,league,market,selection,book,source,
            observed_at,start_at,ticket_pct,handle_pct,ticket_count,
            open_line,current_line,line_moved_toward_selection
            FROM split_observations ORDER BY observed_at""").fetchall()
    output = []
    for row in rows:
        r = dict(row)
        r["starts_at"] = r.pop("start_at")
        movement = r.pop("line_moved_toward_selection")
        r["movement_toward_selection"] = None if movement is None else bool(movement)
        output.append(r)
    return output


def sync(db_path, *, url=None, secret=None, authorized=False, commit=False, sender=None):
    if not authorized:
        raise PermissionError("Source-use authorization must be explicitly attested")
    rows = build_rows(db_path)
    if not commit:
        return {"mode": "DRY_RUN", "rows": len(rows), "uploaded": 0}
    url = (url or os.environ.get("SUPABASE_URL", "")).rstrip("/")
    secret = secret or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".supabase.co"):
        raise ValueError("Expected HTTPS Supabase project URL")
    if not secret:
        raise ValueError("Server-side Supabase secret key is missing")
    if not rows:
        return {"mode": "COMMIT", "rows": 0, "uploaded": 0}
    endpoint = url + "/rest/v1/edge_sharp_money_snapshots?on_conflict=event_id,market,selection,book,source,observed_at"
    transport = sender or urlopen
    uploaded = 0
    for offset in range(0, len(rows), 100):
        batch = rows[offset:offset+100]
        req = Request(endpoint, data=json.dumps(batch).encode("utf-8"), method="POST",
            headers={"apikey": secret, "Authorization": "Bearer " + secret,
                     "Content-Type": "application/json",
                     "Prefer": "resolution=ignore-duplicates,return=minimal"})
        with transport(req, timeout=30) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError("Supabase rejected a batch")
        uploaded += len(batch)
    return {"mode": "COMMIT", "rows": len(rows),
            "submitted": uploaded, "note": "Submitted includes duplicate rows ignored by database"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--authorized", action="store_true")
    parser.add_argument("--commit", action="store_true",
                        help="Opt in to real Supabase writes; default dry-run")
    args = parser.parse_args()
    print(json.dumps(sync(args.db, authorized=args.authorized, commit=args.commit)))


if __name__ == "__main__":
    main()
