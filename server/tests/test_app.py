import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SPIELE_DATA", str(tmp_path))
    monkeypatch.setenv("SPIELE_KENNWORT", "Fernblick-Familie")
    monkeypatch.delenv("SPIELE_DEV", raising=False)
    monkeypatch.delenv("PLANER_URL", raising=False)
    from spiele import app as modul
    modul._fehlversuche.clear()
    with TestClient(modul.app) as c:
        yield c


def test_anmeldung_noetig(client):
    assert client.get("/api/health").json()["ok"]
    for pfad in ("/api/ich", "/api/welt/meta", "/api/welt/haus.glb", "/api/spieler", "/api/bestzeiten?spiel=suchen"):
        assert client.get(pfad).status_code == 401, pfad
    assert client.post("/api/anmelden", json={"kennwort": "falsch"}).status_code == 401
    r = client.post("/api/anmelden", json={"kennwort": "Fernblick-Familie"})
    assert r.status_code == 200 and "httponly" in r.headers["set-cookie"].lower()
    assert client.get("/api/ich").status_code == 200


def test_sperre_nach_fehlversuchen(client):
    for _ in range(5):
        assert client.post("/api/anmelden", json={"kennwort": "nein"}).status_code == 401
    assert client.post("/api/anmelden", json={"kennwort": "Fernblick-Familie"}).status_code == 429


def test_kennwortwechsel_beendet_sitzung(client, monkeypatch):
    client.post("/api/anmelden", json={"kennwort": "Fernblick-Familie"})
    assert client.get("/api/ich").status_code == 200
    monkeypatch.setenv("SPIELE_KENNWORT", "Neues-Kennwort")
    assert client.get("/api/ich").status_code == 401


def test_spieler_und_bestzeiten(client):
    client.post("/api/anmelden", json={"kennwort": "Fernblick-Familie"})
    r = client.put("/api/spieler/Elias", json={"avatar": {"oberteil": "#3366ff"}, "einstellungen": {"kamera": "hinten"}})
    assert r.json()["name"] == "Elias"
    assert client.get("/api/spieler").json()[0]["avatar"]["oberteil"] == "#3366ff"
    assert client.post("/api/bestzeiten", json={"spiel": "suchen", "variante": "leicht-tag", "name": "Elias",
                                                "zeit_ms": 95000}).json()["platz"] == 1
    r = client.post("/api/bestzeiten", json={"spiel": "suchen", "variante": "leicht-tag", "name": "Papa", "zeit_ms": 80000})
    assert r.json()["platz"] == 1 and [x["name"] for x in r.json()["liste"]] == ["Papa", "Elias"]
    ohne_name = {"spiel": "suchen", "variante": "x", "name": "", "zeit_ms": 5000}
    assert client.post("/api/bestzeiten", json=ohne_name).status_code == 400
    zu_schnell = {"spiel": "suchen", "variante": "x", "name": "A", "zeit_ms": 5}
    assert client.post("/api/bestzeiten", json=zu_schnell).status_code == 400


def test_welt_abruf_vom_planer(client, monkeypatch, tmp_path):
    from spiele import app as modul

    glb = b"glTF" + b"\x00" * 40
    aufrufe = []

    def antwort(request):
        import httpx
        aufrufe.append(str(request.url))
        assert request.headers["authorization"] == "Bearer tok"
        if request.url.path.endswith("meta.json"):
            return httpx.Response(200, json={"version": 3})
        if request.url.path.endswith("haus.glb"):
            return httpx.Response(200, content=glb)
        return httpx.Response(200, json={"format": 1})

    import httpx
    echt = httpx.AsyncClient
    monkeypatch.setattr(modul.httpx, "AsyncClient", lambda **kw: echt(transport=httpx.MockTransport(antwort), **kw))
    monkeypatch.setenv("PLANER_URL", "https://planer.example")
    monkeypatch.setenv("SPIELWELT_TOKEN", "tok")
    client.post("/api/anmelden", json={"kennwort": "Fernblick-Familie"})
    assert client.post("/api/welt/aktualisieren").json()["version"] == 3
    assert client.get("/api/welt/haus.glb").content == glb
    n = len(aufrufe)
    client.post("/api/welt/aktualisieren")
    assert len(aufrufe) == n + 1  # gleiche Version: nur meta.json


def _anmelden(client):
    assert client.post("/api/anmelden", json={"kennwort": "Fernblick-Familie"}).status_code == 200


def test_punkte_spiele_und_bauwerke(client):
    _anmelden(client)
    for name, punkte in (("Elias", 40), ("Murat", 90)):
        client.post("/api/bestzeiten", json={"spiel": "lava", "variante": "normal", "name": name, "zeit_ms": 60000,
                                             "punkte": punkte})
    liste = client.get("/api/bestzeiten", params={"spiel": "lava", "variante": "normal"}).json()
    assert [x["name"] for x in liste] == ["Murat", "Elias"]
    assert client.get("/api/kreativ/Elias").json() == {"bloecke": []}
    assert client.put("/api/kreativ/Elias", json={"bloecke": [[1, 2, 3, 4]]}).json() == {"anzahl": 1}
    assert client.get("/api/kreativ/Elias").json()["bloecke"] == [[1, 2, 3, 4]]
    assert client.put("/api/kreativ/Elias", json={"bloecke": [[1, 2, "x", 4]]}).status_code == 400


def test_verstecken_raum(client):
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect), client.websocket_connect("/api/ws/verstecken/ABC") as ws:
        ws.receive_json()  # ohne Anmeldung: geschlossen
    _anmelden(client)
    with client.websocket_connect("/api/ws/verstecken/abc") as a:
        ida = a.receive_json()["id"]
        a.receive_json()
        with client.websocket_connect("/api/ws/verstecken/ABC") as b:
            b.receive_json()
            assert len(b.receive_json()["liste"]) == 2
            a.receive_json()
            b.send_json({"typ": "hallo", "name": "Elias", "avatar": {"haut": 1}})
            assert any(x["name"] == "Elias" for x in a.receive_json()["liste"])
            b.receive_json()
            a.send_json({"typ": "pos", "p": [1, 2, 3]})
            m = b.receive_json()
            assert m["typ"] == "pos" and m["von"] == ida
