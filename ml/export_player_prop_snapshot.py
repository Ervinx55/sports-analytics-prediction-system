"""Export the latest labeled player-prop training rows from Supabase.

GitHub Actions uses short-lived OIDC identity and a locked-down Edge Function.
Local/admin callers may still use a Supabase secret/service-role key directly.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen


OIDC_AUDIENCE = "edge-lab-supabase-ml-export"
OIDC_FUNCTION = "github-ml-training-export"
PAGE_SIZE = 500

REQUIRED_COLUMNS = {
    "observation_id",
    "feature_available_at",
    "starts_at",
    "event_id",
    "player_id",
    "stat_id",
    "line",
    "side",
    "model_probability",
    "market_fair_probability",
    "won",
    "pushed",
    "outcome",
}


def _read_json(request: Request, timeout: int = 60):
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _github_oidc_token() -> str:
    request_url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", "")
    request_token = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
    if not request_url or not request_token:
        raise SystemExit(
            "GitHub OIDC environment is unavailable. "
            "The workflow needs permissions.id-token=write."
        )

    audience = os.environ.get(
        "SUPABASE_ML_EXPORT_AUDIENCE",
        OIDC_AUDIENCE,
    )
    parts = urlsplit(request_url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    query.append(("audience", audience))
    oidc_url = urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            parts.path,
            urlencode(query),
            parts.fragment,
        )
    )
    payload = _read_json(
        Request(
            oidc_url,
            headers={
                "Authorization": f"bearer {request_token}",
                "Accept": "application/json",
            },
            method="GET",
        ),
        timeout=30,
    )
    token = payload.get("value") if isinstance(payload, dict) else None
    if not token:
        raise SystemExit("GitHub OIDC provider returned no token.")
    return str(token)


def _fetch_oidc_rows(url: str) -> list[dict]:
    token = _github_oidc_token()
    endpoint = os.environ.get(
        "SUPABASE_ML_EXPORT_URL",
        f"{url}/functions/v1/{OIDC_FUNCTION}",
    )
    rows: list[dict] = []
    offset = 0

    while True:
        request = Request(
            endpoint,
            data=json.dumps(
                {"offset": offset, "limit": PAGE_SIZE}
            ).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        payload = _read_json(request)
        if not isinstance(payload, dict) or payload.get("ok") is not True:
            raise SystemExit(
                "OIDC training export returned an invalid response."
            )
        page = payload.get("rows")
        if not isinstance(page, list):
            raise SystemExit(
                "OIDC training export did not return a rows array."
            )
        rows.extend(page)

        if payload.get("done") is True:
            break
        next_offset = payload.get("nextOffset")
        if not isinstance(next_offset, int) or next_offset <= offset:
            raise SystemExit(
                "OIDC training export returned an invalid nextOffset."
            )
        offset = next_offset

    return rows


def _fetch_service_rows(url: str) -> list[dict]:
    key = (
        os.environ.get("SUPABASE_SECRET_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    )
    if not key:
        raise SystemExit(
            "No GitHub OIDC identity or Supabase server key is available."
        )

    headers = {
        "apikey": key,
        "content-type": "application/json",
        "accept": "application/json",
    }
    if key.startswith("eyJ"):
        headers["authorization"] = f"Bearer {key}"

    rows = _read_json(
        Request(
            f"{url}/rest/v1/rpc/export_player_prop_training_rows",
            data=b"{}",
            headers=headers,
            method="POST",
        )
    )
    if not isinstance(rows, list):
        raise SystemExit("Supabase RPC training export returned invalid data.")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not url:
        raise SystemExit("SUPABASE_URL is required.")

    has_oidc = bool(
        os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL")
        and os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    )
    if has_oidc:
        rows = _fetch_oidc_rows(url)
        source = "SUPABASE_LIVE_OIDC"
    else:
        rows = _fetch_service_rows(url)
        source = "SUPABASE_LIVE_SERVICE"

    if not rows:
        raise SystemExit("Supabase training export returned no rows.")

    columns = list(rows[0].keys())
    missing = sorted(REQUIRED_COLUMNS - set(columns))
    if missing:
        raise SystemExit(
            "Supabase training export is missing required columns: "
            + ", ".join(missing)
        )

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column) for column in columns})

    print(f"SNAPSHOT_ROWS={len(rows)}")
    print(f"SNAPSHOT_SOURCE={source}")


if __name__ == "__main__":
    main()
