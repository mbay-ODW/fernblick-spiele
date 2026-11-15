"""Ablage unter SPIELE_DATA: Hauswelt-Kopie, Schlüssel, SQLite (Spieler, Bestzeiten)."""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def daten() -> Path:
    p = Path(os.environ.get("SPIELE_DATA", "/data"))
    p.mkdir(parents=True, exist_ok=True)
    return p


def jetzt() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def schluessel() -> bytes:
    p = daten() / "schluessel"
    if not p.exists():
        p.write_text(secrets.token_urlsafe(48))
        p.chmod(0o600)
    return p.read_text().strip().encode()


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    c = sqlite3.connect(daten() / "spiele.sqlite")
    c.row_factory = sqlite3.Row
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS spieler (name TEXT PRIMARY KEY, avatar TEXT NOT NULL DEFAULT '{}',
            einstellungen TEXT NOT NULL DEFAULT '{}', geaendert TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS bestzeiten (id INTEGER PRIMARY KEY AUTOINCREMENT, spiel TEXT NOT NULL,
            variante TEXT NOT NULL, name TEXT NOT NULL, zeit_ms INTEGER NOT NULL, punkte INTEGER NOT NULL DEFAULT 0,
            welt_version INTEGER NOT NULL DEFAULT 0, zeit TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS bz_spiel ON bestzeiten (spiel, variante, zeit_ms);
        """
    )
    try:
        yield c
        c.commit()
    finally:
        c.close()


# --- Spieler ------------------------------------------------------------------------
def spieler_liste() -> list[dict[str, Any]]:
    with db() as c:
        rows = c.execute("SELECT name, avatar, einstellungen, geaendert FROM spieler ORDER BY geaendert DESC").fetchall()
    return [{"name": r["name"], "avatar": json.loads(r["avatar"]), "einstellungen": json.loads(r["einstellungen"]),
             "geaendert": r["geaendert"]} for r in rows]


def spieler_setzen(name: str, avatar: dict[str, Any], einstellungen: dict[str, Any]) -> dict[str, Any]:
    name = name_pruefen(name)
    roh_a, roh_e = json.dumps(avatar)[:4000], json.dumps(einstellungen)[:2000]
    with db() as c:
        c.execute("INSERT INTO spieler (name, avatar, einstellungen, geaendert) VALUES (?, ?, ?, ?) "
                  "ON CONFLICT(name) DO UPDATE SET avatar=excluded.avatar, einstellungen=excluded.einstellungen, "
                  "geaendert=excluded.geaendert", (name, roh_a, roh_e, jetzt()))
    return {"name": name, "avatar": avatar, "einstellungen": einstellungen}


def name_pruefen(name: str) -> str:
    name = " ".join(str(name).split())[:20]
    if not name:
        raise ValueError("Name fehlt")
    return name


# --- Bestzeiten ---------------------------------------------------------------------
def bestzeiten(spiel: str, variante: str, anzahl: int = 10) -> list[dict[str, Any]]:
    with db() as c:
        rows = c.execute("SELECT name, zeit_ms, punkte, zeit FROM bestzeiten WHERE spiel=? AND variante=? "
                         "ORDER BY zeit_ms ASC, id ASC LIMIT ?", (spiel, variante, anzahl)).fetchall()
    return [dict(r) for r in rows]


def bestzeit_eintragen(spiel: str, variante: str, name: str, zeit_ms: int, punkte: int, welt_version: int) -> dict[str, Any]:
    name = name_pruefen(name)
    if not (1000 <= int(zeit_ms) <= 6 * 3600 * 1000):
        raise ValueError("Zeit unplausibel")
    spiel, variante = str(spiel)[:30], str(variante)[:40]
    with db() as c:
        c.execute("INSERT INTO bestzeiten (spiel, variante, name, zeit_ms, punkte, welt_version, zeit) VALUES (?,?,?,?,?,?,?)",
                  (spiel, variante, name, int(zeit_ms), int(punkte), int(welt_version), jetzt()))
        platz = c.execute("SELECT COUNT(*) FROM bestzeiten WHERE spiel=? AND variante=? AND zeit_ms < ?",
                          (spiel, variante, int(zeit_ms))).fetchone()[0] + 1
    return {"platz": platz, "liste": bestzeiten(spiel, variante)}


# --- Hauswelt (Kopie aus dem Planer) ------------------------------------------------
def welt_ordner() -> Path:
    p = daten() / "welt"
    p.mkdir(parents=True, exist_ok=True)
    return p


def welt_meta() -> dict[str, Any]:
    p = welt_ordner() / "meta.json"
    return json.loads(p.read_text()) if p.exists() else {"version": 0}


def welt_ablegen(meta: dict[str, Any], glb: bytes, welt: bytes) -> None:
    d = welt_ordner()
    for name, inhalt in (("haus.glb", glb), ("welt.json", welt)):
        (d / f"{name}.tmp").write_bytes(inhalt)
        (d / f"{name}.tmp").replace(d / name)
    meta = {**meta, "abgeholt": jetzt()}
    (d / "meta.json.tmp").write_text(json.dumps(meta))
    (d / "meta.json.tmp").replace(d / "meta.json")
