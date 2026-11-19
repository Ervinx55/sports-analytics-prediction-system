"""Authorized CSV import and durable SQLite archive for pregame betting splits.

Operator supplies CSV exported with permission. No scraping, vendor API assumptions,
credential handling, or scheduled access. All writes are idempotent.
"""
import argparse
import csv
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from .sharp_money_research import SplitSnapshot, evaluate_split


SCHEMA = """
CREATE TABLE IF NOT EXISTS split_observations (
  event_id TEXT NOT NULL, league TEXT NOT NULL, market TEXT NOT NULL,
  selection TEXT NOT NULL, book TEXT NOT NULL, source TEXT NOT NULL,
  observed_at TEXT NOT NULL, start_at TEXT NOT NULL,
  ticket_pct REAL, handle_pct REAL, ticket_count INTEGER,
  open_line REAL, current_line REAL, line_moved_toward_selection INTEGER,
  divergence_points REAL, research_flags TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY(event_id, market, selection, book, source, observed_at)
);
"""


def _time(value):
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("Timezone required")
    return dt.astimezone(timezone.utc)


def _optional_float(value):
    return None if value is None or str(value).strip() == "" else float(value)


def _optional_int(value):
    return None if value is None or str(value).strip() == "" else int(value)


def _movement(value):
    if value is None or str(value).strip() == "":
        return None
    if str(value).lower() not in ("true", "false"):
        raise ValueError("Expected true, false, or blank for line movement")
    return str(value).lower() == "true"


def import_csv(csv_path, db_path, *, authorized=False, as_of=None):
    """Import verified snapshots, reject invalid rows, return counts.

    Permission is an explicit operator assertion; it is NOT inferred from
    website accessibility. No source request is made by this function.
    """
    if not authorized:
        raise PermissionError("Explicit authorized-source assertion required")
    now = as_of or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("as_of must have timezone")
    accepted = rejected = 0
    with sqlite3.connect(db_path) as conn:
        conn.execute(SCHEMA)
        with open(csv_path, newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                try:
                    x = SplitSnapshot(
                        event_id=row["event_id"], league=row["league"],
                        market=row["market"], selection=row["selection"],
                        book=row["book"], source=row["source"],
                        observed_at=_time(row["observed_at"]),
                        start_at=_time(row["start_at"]),
                        ticket_pct=_optional_float(row.get("ticket_pct")),
                        handle_pct=_optional_float(row.get("handle_pct")),
                        ticket_count=_optional_int(row.get("ticket_count")),
                        open_line=_optional_float(row.get("open_line")),
                        current_line=_optional_float(row.get("current_line")),
                        line_moved_toward_selection=_movement(row.get("line_moved_toward_selection")),
                        source_authorized=True)
                    result = evaluate_split(x, now)
                    if result.status != "RESEARCH_ONLY":
                        rejected += 1
                        continue
                    conn.execute(
                        """INSERT OR IGNORE INTO split_observations VALUES
                        (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (x.event_id, x.league, x.market, x.selection, x.book,
                         x.source, x.observed_at.isoformat(), x.start_at.isoformat(),
                         x.ticket_pct, x.handle_pct, x.ticket_count,
                         x.open_line, x.current_line,
                         None if x.line_moved_toward_selection is None else int(x.line_moved_toward_selection),
                         result.divergence_points, ",".join(result.research_flags),
                         now.astimezone(timezone.utc).isoformat()))
                    accepted += 1
                except (KeyError, ValueError, TypeError):
                    rejected += 1
        conn.commit()
    return {"valid_rows_processed": accepted, "rejected_rows": rejected}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--authorized", action="store_true",
                        help="Assert that you have permission to use this CSV")
    args = parser.parse_args()
    print(import_csv(args.csv, args.db, authorized=args.authorized))


if __name__ == "__main__":
    main()
