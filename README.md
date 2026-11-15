# Fernblick-Spiele

Das Ferienhaus Fernblick als Spielwelt: eine App mit Spielemenü, eigenem Avatar und Bestenlisten.
Die Hauswelt (3D-Modell und Möbeldaten) kommt aus dem [Fernblick-Planer](https://github.com/mbay-ODW/fernblick-planer):
dort im Reiter **Teilen → „Spielwelt übergeben“**. Der Spiele-Server holt die übergebene Fassung per Token ab
(alle 10 Minuten oder sofort mit `POST /api/welt/aktualisieren`). Der Planer bleibt davon unberührt.

## Spiele

| Spiel | Stand |
|---|---|
| 💎 Schatzsuche – Schätze auf, unter und neben Möbeln finden, Tag oder Nacht mit Taschenlampe | fertig |
| 🌋 Der Boden ist Lava · 🏃 Parcours · 🚁 Drohnenrennen · 🔐 Escape-Room · 🧱 Kreativ · 💰 Tycoon · 🙈 Verstecken online | geplant |

Jedes Spiel ist ein Modul unter `web/src/spiele/` (Schnittstelle `Spiel` in `typen.ts`) und erscheint als Kachel im Menü.

## Aufbau

- `web/` – Vite + TypeScript + three.js, Physik mit Rapier (Laufen, Rennen, Springen, Treppen, Kollision mit dem ganzen Haus)
  - `welt.ts` Szene, Licht (Tag/Nacht), Hausmodell, Kollision
  - `figur.ts` Spielfigur und Kameraansichten: Ich, von hinten, von vorne, von oben (Haus über Kopfhöhe ausgeblendet)
  - `avatar.ts` Klötzchen-Avatar mit Editor (Haut, Frisur, Haare, Gesicht, Augen, Kleidung, Kopfbedeckung)
  - `eingabe.ts` PC: W A S D, Umschalt rennen, Leertaste springen, V Ansicht, Maus (Klick fängt den Zeiger), Esc Pause;
    Tablet/Handy: Steuerknüppel links, rechts wischen zum Umschauen, Knöpfe für Springen, Ansicht und Pause
- `server/` – FastAPI: Familien-Kennwort (Cookie, 120 Tage), Hauswelt-Kopie, Spieler mit Avatar, Bestzeiten (SQLite)
- Als App installierbar (Web-App-Manifest, Vollbild, Querformat)

## Entwicklung

```bash
cd server && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
SPIELE_DATA=./daten SPIELE_DEV=1 .venv/bin/uvicorn spiele.app:app --port 8000
cd web && npm ci && npm run dev
```

`SPIELE_DEV=1` schaltet die Anmeldung ab (nur lokal). Eine Hauswelt zum Testen: `daten/welt/{haus.glb,welt.json,meta.json}`
aus dem Planer (Datenordner `spielwelt/`).

## Betrieb

Image `ghcr.io/<owner>/fernblick-spiele:sha-<commit>` baut die CI bei jedem Push. Stack: `deploy/docker-compose.yml`,
Werte siehe `deploy/.env.example` (nur im Portainer-Stack setzen, nicht einchecken).
