import csv
import sqlite3
from datetime import datetime, timedelta, timezone
import pytest
from src.sharp_money_ingest import import_csv

NOW = datetime(2026, 11, 19, 18, tzinfo=timezone.utc)
FIELDS = ["event_id","league","market","selection","book","source",
          "observed_at","start_at","ticket_pct","handle_pct","ticket_count",
          "open_line","current_line","line_moved_toward_selection"]


def make_csv(path, **updates):
    row = dict(event_id="game-1",league="NBA",market="spread",selection="HOME",
               book="DraftKings",source="VSiN",observed_at=(NOW-timedelta(minutes=3)).isoformat(),
               start_at=(NOW+timedelta(hours=2)).isoformat(),ticket_pct="28",
               handle_pct="67",ticket_count="1200",open_line="-5.5",
               current_line="-3.5",line_moved_toward_selection="true")
    row.update(updates)
    with open(path, "w", newline="") as f:
        w=csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerow(row)


def test_explicit_permission_required(tmp_path):
    f=tmp_path/"split.csv"
    make_csv(f)
    with pytest.raises(PermissionError):
        import_csv(f,tmp_path/"db.sqlite",as_of=NOW)


def test_import_and_deduplicate(tmp_path):
    f=tmp_path/"split.csv"
    db=tmp_path/"db.sqlite"
    make_csv(f)
    assert import_csv(f,db,authorized=True,as_of=NOW)["rejected_rows"]==0
    import_csv(f,db,authorized=True,as_of=NOW)
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT COUNT(*) FROM split_observations").fetchone()[0]==1
        assert c.execute("SELECT divergence_points FROM split_observations").fetchone()[0]==39


def test_missing_split_rejected(tmp_path):
    f=tmp_path/"split.csv"
    make_csv(f,handle_pct="")
    result=import_csv(f,tmp_path/"db.sqlite",authorized=True,as_of=NOW)
    assert result["rejected_rows"]==1


def test_postgame_rejected(tmp_path):
    f=tmp_path/"split.csv"
    make_csv(f,start_at=(NOW-timedelta(minutes=10)).isoformat())
    assert import_csv(f,tmp_path/"db.sqlite",authorized=True,as_of=NOW)["rejected_rows"]==1
