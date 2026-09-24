"""Export the latest labeled player-prop training rows from Supabase."""

from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen


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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = (
        os.environ.get("SUPABASE_SECRET_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    )
    if not url or not key:
        raise SystemExit(
            "SUPABASE_URL and SUPABASE_SECRET_KEY or "
            "SUPABASE_SERVICE_ROLE_KEY are required."
        )

    headers = {
        "apikey": key,
        "content-type": "application/json",
        "accept": "application/json",
    }
    # Legacy service-role keys are JWTs and can also be sent as Bearer tokens.
    if key.startswith("eyJ"):
        headers["authorization"] = f"Bearer {key}"

    request = Request(
        f"{url}/rest/v1/rpc/export_player_prop_training_rows",
        data=b"{}",
        headers=headers,
        method="POST",
    )
    with urlopen(request, timeout=60) as response:
        rows = json.loads(response.read().decode("utf-8"))

    if not isinstance(rows, list) or not rows:
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
    print("SNAPSHOT_SOURCE=SUPABASE_LIVE")


if __name__ == "__main__":
    main()
