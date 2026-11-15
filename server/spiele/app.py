"""FastAPI: Familien-Anmeldung, Hauswelt (Kopie aus dem Planer), Spieler mit Avatar, Bestzeiten, Oberfläche."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
import socket
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any

import httpx
from fastapi import Body, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from spiele import speicher

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("spiele")
WEB = Path(os.environ.get("SPIELE_WEB", Path(__file__).resolve().parents[2] / "web" / "dist"))
COOKIE = "fbs_sitzung"
SITZUNG_SEK = 120 * 86400
ABRUF_SEK = 600
_fehlversuche: dict[str, list[float]] = {}


# --- Hauswelt vom Planer holen -----------------------------------------------------------
async def welt_abrufen(erzwingen: bool = False) -> dict[str, Any]:
    """Holt die übergebene Spielwelt vom Planer, wenn sie neuer ist als die lokale Kopie."""
    url = os.environ.get("PLANER_URL", "").rstrip("/")
    token = os.environ.get("SPIELWELT_TOKEN", "")
    if not url or not token:
        return speicher.welt_meta()
    h = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=60) as c:
        meta = (await c.get(f"{url}/spielwelt/meta.json", headers=h)).raise_for_status().json()
        lokal = speicher.welt_meta()
        if meta.get("version", 0) and (erzwingen or meta["version"] != lokal.get("version")):
            glb = (await c.get(f"{url}/spielwelt/haus.glb", headers=h)).raise_for_status().content
            welt = (await c.get(f"{url}/spielwelt/welt.json", headers=h)).raise_for_status().content
            speicher.welt_ablegen(meta, glb, welt)
            log.info("Spielwelt v%s vom Planer übernommen (%d kB)", meta["version"], len(glb) // 1024)
    return speicher.welt_meta()


async def _abruf_schleife() -> None:
    while True:
        try:
            await welt_abrufen()
        except Exception as e:  # noqa: BLE001 – Planer kurz nicht erreichbar: nächster Versuch
            log.warning("Spielwelt-Abruf fehlgeschlagen: %s", e)
        await asyncio.sleep(ABRUF_SEK)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    speicher.daten()
    aufgabe = asyncio.create_task(_abruf_schleife())
    yield
    aufgabe.cancel()
    with suppress(asyncio.CancelledError):
        await aufgabe


app = FastAPI(title="Fernblick-Spiele", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(ValueError)
async def _wertfehler(request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=400)


# --- Anmeldung (ein Familien-Kennwort) ----------------------------------------------------
def _sig(*teile: str) -> str:
    return hmac.new(speicher.schluessel(), "|".join(teile).encode(), hashlib.sha256).hexdigest()


def _kennwort() -> str:
    return os.environ.get("SPIELE_KENNWORT", "")


def _kennwort_marke() -> str:
    # Kennwortwechsel beendet alle Sitzungen
    return hashlib.sha256(_kennwort().encode()).hexdigest()[:16]


def _vertraute_ips() -> set[str] | None:
    roh = os.environ.get("SPIELE_TRUSTED_PROXIES", "").strip()
    if not roh:
        return None
    ips: set[str] = set()
    for teil in roh.replace(",", " ").split():
        try:
            ips.update(str(i[4][0]) for i in socket.getaddrinfo(teil, None))
        except OSError:
            ips.add(teil)
    return ips


def _client_ip(request: Request) -> str:
    ip = request.client.host if request.client else "?"
    vertraut = _vertraute_ips()
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd and vertraut is not None and ip in vertraut:
        return fwd.split(",")[0].strip()
    return ip


def angemeldet(request: Request) -> None:
    if os.environ.get("SPIELE_DEV") == "1":
        return
    wert = request.cookies.get(COOKIE, "")
    try:
        bis, sig = wert.split(".", 1)
        if int(bis) > time.time() and _kennwort() and hmac.compare_digest(sig, _sig("sitzung", bis, _kennwort_marke())):
            return
    except ValueError:
        pass
    raise HTTPException(401, "Bitte anmelden")


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "build": os.environ.get("SPIELE_BUILD", "dev"), "welt": speicher.welt_meta().get("version", 0)}


@app.post("/api/anmelden")
def anmelden(request: Request, response: Response, daten: dict[str, Any] = Body(...)) -> dict[str, Any]:
    ip = _client_ip(request)
    jetzt = time.time()
    _fehlversuche[ip] = [t for t in _fehlversuche.get(ip, []) if jetzt - t < 900]
    if len(_fehlversuche[ip]) >= 5:
        raise HTTPException(429, "Zu viele Versuche – in 15 Minuten nochmal.")
    if not _kennwort() or not hmac.compare_digest(str(daten.get("kennwort", "")).encode(), _kennwort().encode()):
        _fehlversuche[ip].append(jetzt)
        raise HTTPException(401, "Kennwort stimmt nicht.")
    _fehlversuche.pop(ip, None)
    bis = str(int(jetzt) + SITZUNG_SEK)
    response.set_cookie(COOKIE, f"{bis}.{_sig('sitzung', bis, _kennwort_marke())}", max_age=SITZUNG_SEK, httponly=True,
                        secure=os.environ.get("SPIELE_PUBLIC_URL", "").startswith("https"), samesite="lax", path="/")
    return {"ok": True}


@app.post("/api/abmelden")
def abmelden(response: Response) -> dict[str, Any]:
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@app.get("/api/ich", dependencies=[Depends(angemeldet)])
def ich() -> dict[str, Any]:
    return {"ok": True}


# --- Hauswelt -----------------------------------------------------------------------------
@app.get("/api/welt/meta", dependencies=[Depends(angemeldet)])
def welt_meta() -> dict[str, Any]:
    return speicher.welt_meta()


@app.post("/api/welt/aktualisieren", dependencies=[Depends(angemeldet)])
async def welt_aktualisieren() -> dict[str, Any]:
    try:
        return await welt_abrufen()
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Planer nicht erreichbar: {e}") from e


@app.get("/api/welt/{datei}", dependencies=[Depends(angemeldet)])
def welt_datei(datei: str) -> FileResponse:
    if datei not in ("haus.glb", "welt.json"):
        raise HTTPException(404)
    p = speicher.welt_ordner() / datei
    if not p.exists():
        raise HTTPException(404, "Noch keine Hauswelt vorhanden – im Planer „Spielwelt übergeben“ drücken.")
    v = speicher.welt_meta().get("version", 0)
    return FileResponse(p, media_type="model/gltf-binary" if datei.endswith(".glb") else "application/json",
                        headers={"Cache-Control": "private, max-age=0, must-revalidate", "ETag": f'"welt-{v}-{datei}"'})


# --- Spieler und Bestzeiten ---------------------------------------------------------------
@app.get("/api/spieler", dependencies=[Depends(angemeldet)])
def spieler() -> list[dict[str, Any]]:
    return speicher.spieler_liste()


@app.put("/api/spieler/{name}", dependencies=[Depends(angemeldet)])
def spieler_setzen(name: str, daten: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return speicher.spieler_setzen(name, daten.get("avatar") or {}, daten.get("einstellungen") or {})


@app.get("/api/bestzeiten", dependencies=[Depends(angemeldet)])
def bestzeiten(spiel: str, variante: str = "") -> list[dict[str, Any]]:
    return speicher.bestzeiten(spiel, variante)


@app.post("/api/bestzeiten", dependencies=[Depends(angemeldet)])
def bestzeit(daten: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return speicher.bestzeit_eintragen(daten.get("spiel", ""), daten.get("variante", ""), daten.get("name", ""),
                                       int(daten.get("zeit_ms", 0)), int(daten.get("punkte", 0)),
                                       int(speicher.welt_meta().get("version", 0)))


# --- Oberfläche ---------------------------------------------------------------------------
if (WEB / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")

    @app.get("/{pfad:path}", include_in_schema=False)
    def oberflaeche(pfad: str) -> Response:
        if pfad.startswith("api/"):
            raise HTTPException(404)
        datei = (WEB / pfad).resolve()
        if pfad and datei.is_file() and WEB.resolve() in datei.parents:
            return FileResponse(datei)
        return FileResponse(WEB / "index.html", headers={"Cache-Control": "no-cache"})
