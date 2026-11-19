import sqlite3
import pytest
from src.sharp_money_supabase_sync import build_rows, sync


def make_db(path):
    with sqlite3.connect(path) as db:
        db.execute("""create table split_observations (
            event_id text,league text,market text,selection text,book text,source text,
            observed_at text,start_at text,ticket_pct real,handle_pct real,
            ticket_count integer,open_line real,current_line real,
            line_moved_toward_selection integer)""")
        db.execute("""insert into split_observations values
            ('g1','NBA','spread','HOME','DraftKings','VSiN',
            '2026-11-19T18:00:00+00:00','2026-11-19T22:00:00+00:00',
            28,67,1000,-5.5,-3.5,1)""")


def test_dry_run_never_sends(tmp_path):
    path=tmp_path/"x.sqlite"
    make_db(path)
    r=sync(path,authorized=True)
    assert r=={"mode":"DRY_RUN","rows":1,"uploaded":0}


def test_permission_required(tmp_path):
    with pytest.raises(PermissionError):
        sync(tmp_path/"missing.sqlite")


def test_mapping(tmp_path):
    path=tmp_path/"x.sqlite"
    make_db(path)
    row=build_rows(path)[0]
    assert row["starts_at"].startswith("2026")
    assert row["movement_toward_selection"] is True
    assert "start_at" not in row


def test_commit_requires_credentials(tmp_path):
    path=tmp_path/"x.sqlite"
    make_db(path)
    with pytest.raises(ValueError):
        sync(path,authorized=True,commit=True,url="http://example.com",secret="placeholder")
