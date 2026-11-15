// Verstecken online: zwei bis sechs Geräte in einem Raum (Code), einer sucht, die anderen verstecken sich.
// Der Server reicht Nachrichten nur weiter; Runden steuert der Gastgeber (erster im Raum).
import * as THREE from "three";
import { Kontext, Spiel } from "./typen";
import { Avatar, AvatarCfg, STANDARD_AVATAR } from "../avatar";
import { api } from "../api";

const VERSTECK_S = 30;
const SUCH_S = 240;
const ZEICHEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne 0/O, 1/I

interface Mitspieler {
  id: string;
  name: string;
  cfgText: string;
  avatar: Avatar;
  schild: THREE.Sprite;
  ziel: THREE.Vector3;
  gier: number;
  tempo: number;
  inLuft: boolean;
  gesehen: boolean; // schon eine Position bekommen
}

type Phase = "wahl" | "verbinden" | "lobby" | "verstecken" | "suchen";

function namensschild(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const x = c.getContext("2d")!;
  x.font = "bold 34px Nunito, system-ui, sans-serif";
  const b = Math.min(250, x.measureText(text).width + 28);
  x.fillStyle = "rgba(0,0,0,0.6)";
  x.beginPath();
  x.roundRect((256 - b) / 2, 6, b, 52, 22);
  x.fill();
  x.fillStyle = "#fff";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, 128, 33);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(1.0, 0.25, 1);
  s.position.y = 2.05;
  s.renderOrder = 10;
  return s;
}

const uhr = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

export class VersteckenSpiel implements Spiel {
  private k!: Kontext;
  private ws: WebSocket | null = null;
  private code = "";
  private ich = "";
  private liste: { id: string; name: string; avatar: any }[] = [];
  private andere = new Map<string, Mitspieler>();
  private phase: Phase = "wahl";
  private beendet = false;
  private versuche = 0;
  private sendTakt = 0;
  private letztePos = new THREE.Vector3();
  private rundeNr = 0;
  private sucher = "";
  private verstecker = new Set<string>();
  private gefunden = new Set<string>();
  private phaseZeit = 0; // Sekunden seit Phasenbeginn
  private suchZeit = 0;
  private schirm!: HTMLElement;
  private ray = new THREE.Raycaster();

  start(k: Kontext) {
    this.k = k;
    this.schirm = document.createElement("div");
    Object.assign(this.schirm.style, {
      position: "absolute", inset: "0", background: "#000", color: "#fff", display: "none", alignItems: "center",
      justifyContent: "center", flexDirection: "column", fontSize: "44px", fontWeight: "900", pointerEvents: "none", textAlign: "center",
    });
    k.hud.leiste().parentElement!.prepend(this.schirm);
    this.wahlZeigen();
  }

  // --- Oberfläche: Raum wählen und Lobby ----------------------------------------------------
  private knopf(text: string, fn: () => void, zweit = false) {
    const b = document.createElement("button");
    b.className = zweit ? "zweit" : "gross";
    b.textContent = text;
    b.style.pointerEvents = "auto";
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    return b;
  }

  private kasten(...kinder: (HTMLElement | string)[]) {
    const d = document.createElement("div");
    Object.assign(d.style, { background: "#f6f1e6", color: "#22301e", borderRadius: "18px", padding: "14px 16px", display: "flex",
      flexDirection: "column", gap: "10px", minWidth: "min(360px, 80vw)", boxShadow: "0 8px 30px #0005", pointerEvents: "auto" });
    d.append(...kinder);
    const l = this.k.hud.leiste();
    l.replaceChildren(d);
    return d;
  }

  private text(t: string, gross = false) {
    const p = document.createElement("div");
    p.textContent = t;
    Object.assign(p.style, { fontSize: gross ? "26px" : "16px", fontWeight: gross ? "900" : "700", textAlign: "center" });
    return p;
  }

  private wahlZeigen() {
    this.phase = "wahl";
    this.k.figur.gesperrt = true;
    const feld = document.createElement("input");
    feld.type = "text";
    feld.placeholder = "Code, z. B. K7PX";
    feld.maxLength = 6;
    feld.autocapitalize = "characters";
    Object.assign(feld.style, { textTransform: "uppercase", textAlign: "center", letterSpacing: "4px" });
    feld.addEventListener("keydown", (e) => { if (e.key === "Enter") beitreten(); });
    const beitreten = () => {
      const c = feld.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (c.length < 3) { this.k.hud.meldung("Bitte den Code vom anderen Gerät eingeben", 1800); return; }
      this.verbinden(c);
    };
    this.kasten(
      this.text("🙈 Verstecken online", true),
      this.knopf("Neuen Raum öffnen", () => {
        let c = "";
        for (let i = 0; i < 4; i++) c += ZEICHEN[Math.floor(Math.random() * ZEICHEN.length)];
        this.verbinden(c);
      }),
      this.text("oder einem Raum beitreten:"),
      feld,
      this.knopf("Beitreten", beitreten, true),
    );
    this.k.hud.anzeige("🙈 Verstecken online");
  }

  private lobbyZeigen() {
    if (this.phase !== "lobby") return;
    const host = this.liste[0]?.id === this.ich;
    const namen = this.liste.map((s, i) => `${i === 0 ? "👑 " : ""}${s.name}${s.id === this.ich ? " (du)" : ""}`).join(" · ");
    const kinder: (HTMLElement | string)[] = [
      this.text(`Code für das andere Tablet: ${this.code}`, true),
      this.text(`Im Raum: ${namen || "…"}`),
    ];
    if (host && this.liste.length >= 2) kinder.push(this.knopf("▶ Runde starten", () => this.rundeAnsagen()));
    else if (host) kinder.push(this.text("Warte auf Mitspieler …"));
    else kinder.push(this.text("Warte, bis der Gastgeber 👑 die Runde startet …"));
    kinder.push(this.knopf("Raum verlassen", () => { this.trennen(); this.wahlZeigen(); }, true));
    this.kasten(...kinder);
  }

  // --- Verbindung -------------------------------------------------------------------------
  private verbinden(code: string) {
    this.code = code;
    this.phase = "verbinden";
    this.kasten(this.text(`Verbinde mit Raum ${code} …`, true));
    const ws = api.versteckenVerbinden(code);
    this.ws = ws;
    ws.onopen = () => {
      this.versuche = 0;
      ws.send(JSON.stringify({ typ: "hallo", name: this.k.spieler.name, avatar: this.k.spieler.avatar }));
    };
    ws.onmessage = (e) => {
      let m: any;
      try { m = JSON.parse(e.data); } catch { return; }
      this.nachricht(m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws || this.beendet) return;
      this.ws = null;
      this.andereLeeren();
      if (e.code === 4403) { this.k.hud.meldung("Der Raum ist voll", 2500); this.wahlZeigen(); return; }
      if (e.code === 4401) { this.k.hud.meldung("Nicht angemeldet – bitte neu anmelden", 2500); this.wahlZeigen(); return; }
      if (this.versuche++ < 5) {
        this.k.hud.meldung("Verbindung weg – verbinde neu …", 1800);
        this.rundeAbbrechen();
        setTimeout(() => { if (!this.beendet && !this.ws) this.verbinden(code); }, 2000);
      } else {
        this.k.hud.meldung("Keine Verbindung zum Server", 2500);
        this.wahlZeigen();
      }
    };
  }

  private trennen() {
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; ws.close(); }
    this.andereLeeren();
    this.rundeAbbrechen();
    this.liste = [];
  }

  private senden(m: any) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private nachricht(m: any) {
    switch (m.typ) {
      case "du":
        this.ich = String(m.id);
        if (this.phase === "verbinden") { this.phase = "lobby"; this.k.figur.gesperrt = false; }
        break;
      case "spieler":
        this.listeSetzen(Array.isArray(m.liste) ? m.liste : []);
        break;
      case "pos": {
        const s = this.andere.get(m.von);
        if (!s || !Array.isArray(m.p)) break;
        s.ziel.set(+m.p[0] || 0, +m.p[1] || 0, +m.p[2] || 0);
        if (!s.gesehen) { s.avatar.gruppe.position.copy(s.ziel); s.gesehen = true; s.avatar.gruppe.visible = true; }
        s.gier = +m.g || 0;
        s.tempo = +m.t || 0;
        s.inLuft = !!m.l;
        break;
      }
      case "runde":
        this.rundeStarten(String(m.sucher), Number(m.nr) || 0);
        break;
      case "gefunden":
        this.gefundenSetzen(String(m.id));
        break;
    }
  }

  private listeSetzen(liste: { id: string; name: string; avatar: any }[]) {
    this.liste = liste;
    const ids = new Set(liste.map((s) => s.id));
    for (const [id, s] of this.andere) {
      if (!ids.has(id)) { this.avatarWeg(s); this.andere.delete(id); }
    }
    for (const s of liste) {
      if (s.id === this.ich) continue;
      const cfgText = JSON.stringify(s.avatar ?? {});
      const alt = this.andere.get(s.id);
      if (alt && alt.cfgText === cfgText && alt.name === s.name) continue;
      const pos = alt?.avatar.gruppe.position.clone();
      if (alt) this.avatarWeg(alt);
      const cfg: AvatarCfg = { ...STANDARD_AVATAR, ...(s.avatar ?? {}) };
      const avatar = new Avatar(cfg);
      const schild = namensschild(s.name);
      avatar.gruppe.add(schild);
      avatar.gruppe.visible = !!alt?.gesehen;
      if (pos) avatar.gruppe.position.copy(pos);
      this.k.welt.szene.add(avatar.gruppe);
      this.andere.set(s.id, { id: s.id, name: s.name, cfgText, avatar, schild, ziel: pos ?? new THREE.Vector3(), gier: alt?.gier ?? 0,
        tempo: 0, inLuft: false, gesehen: !!alt?.gesehen });
    }
    // Versteckte, die gegangen sind, zählen nicht mehr
    if (this.phase === "verstecken" || this.phase === "suchen") {
      for (const id of [...this.verstecker]) if (!ids.has(id)) this.verstecker.delete(id);
      if (!ids.has(this.sucher)) { this.k.hud.meldung("Der Sucher ist weg – Runde abgebrochen", 2200); this.rundeAbbrechen(); }
      else this.pruefeEnde();
    }
    this.lobbyZeigen();
  }

  private avatarWeg(s: Mitspieler) {
    this.k.welt.szene.remove(s.avatar.gruppe);
    s.schild.material.map?.dispose();
    s.schild.material.dispose();
  }

  private andereLeeren() {
    for (const s of this.andere.values()) this.avatarWeg(s);
    this.andere.clear();
  }

  // --- Runden -----------------------------------------------------------------------------
  private rundeAnsagen() {
    if (this.liste.length < 2) return;
    const nr = this.rundeNr + 1;
    const sucher = this.liste[(nr - 1) % this.liste.length].id;
    this.senden({ typ: "runde", sucher, nr });
    this.rundeStarten(sucher, nr);
  }

  private rundeStarten(sucher: string, nr: number) {
    this.rundeNr = Math.max(this.rundeNr, nr);
    this.sucher = sucher;
    this.verstecker = new Set(this.liste.map((s) => s.id).filter((id) => id !== sucher));
    this.gefunden.clear();
    this.phase = "verstecken";
    this.phaseZeit = 0;
    this.suchZeit = 0;
    this.k.hud.leiste().replaceChildren();
    const f = this.k.figur;
    if (sucher === this.ich) {
      f.setzen(f.start);
      f.gesperrt = true;
      this.schirm.style.display = "flex";
      this.k.hud.meldung("Du suchst! Augen zu …", 2200);
    } else {
      f.gesperrt = false;
      const name = this.liste.find((s) => s.id === sucher)?.name ?? "?";
      this.k.hud.meldung(`${name} sucht – versteck dich! 🙈`, 2500);
    }
    this.schilderAnpassen();
  }

  private suchenStarten() {
    this.phase = "suchen";
    this.phaseZeit = 0;
    this.schirm.style.display = "none";
    if (this.sucher === this.ich) {
      this.k.figur.gesperrt = false;
      this.k.hud.meldung("Los, such sie! 🔍", 1800);
    } else this.k.hud.meldung("Achtung, die Suche beginnt! 🤫", 1800);
    this.schilderAnpassen();
  }

  private gefundenSetzen(id: string) {
    if (this.phase !== "suchen" || !this.verstecker.has(id) || this.gefunden.has(id)) return;
    this.gefunden.add(id);
    const name = id === this.ich ? "Du" : this.liste.find((s) => s.id === id)?.name ?? "?";
    if (id === this.ich) { this.k.hud.meldung("Du wurdest gefunden! 👀", 2200); navigator.vibrate?.(80); }
    else this.k.hud.meldung(`${name} gefunden! (${this.gefunden.size}/${this.verstecker.size})`, 1600);
    this.schilderAnpassen();
    this.pruefeEnde();
  }

  private pruefeEnde() {
    if (this.phase !== "suchen") return;
    const alle = [...this.verstecker].every((id) => this.gefunden.has(id));
    if (this.verstecker.size && alle) this.rundeEnde(`Alle gefunden in ${uhr(this.suchZeit)}! Der Sucher gewinnt 🏆`);
    else if (!this.verstecker.size) this.rundeEnde("Niemand mehr zum Suchen da");
  }

  private rundeEnde(text: string) {
    this.k.hud.meldung(text, 3500);
    this.rundeAbbrechen();
  }

  private rundeAbbrechen() {
    this.schirm.style.display = "none";
    if (this.phase === "verstecken" || this.phase === "suchen") {
      this.phase = this.ws ? "lobby" : "verbinden";
      this.k.figur.gesperrt = false;
    }
    this.schilderAnpassen();
    this.lobbyZeigen();
  }

  /** Während der Suche sieht der Sucher keine Namensschilder der Versteckten */
  private schilderAnpassen() {
    const sucheIch = this.sucher === this.ich && (this.phase === "verstecken" || this.phase === "suchen");
    for (const s of this.andere.values()) s.schild.visible = !(sucheIch && this.verstecker.has(s.id) && !this.gefunden.has(s.id));
  }

  /** Sicht vom Kopf des Suchers zum Kopf des anderen (Haus dazwischen?) */
  private sichtbar(s: Mitspieler): boolean {
    const kopf = this.k.figur.kopf();
    const ziel = s.avatar.gruppe.position.clone().add(new THREE.Vector3(0, 1.45, 0));
    const d = kopf.distanceTo(ziel);
    if (d < 0.2) return true;
    const t = this.k.welt.strahl(kopf, ziel.clone().sub(kopf).normalize(), d - 0.1, this.k.figur.collider);
    return !t;
  }

  // --- Schleife ---------------------------------------------------------------------------
  update(dt: number) {
    const f = this.k.figur;
    // Eigene Position senden (10 Hz)
    this.sendTakt += dt;
    if (this.sendTakt >= 0.1 && this.ws) {
      const p = f.fuss();
      const tempo = Math.min(1, p.distanceTo(this.letztePos) / this.sendTakt / 5.6);
      this.letztePos.copy(p);
      this.sendTakt = 0;
      this.senden({ typ: "pos", p: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)], g: +f.avatar.gruppe.rotation.y.toFixed(3), t: +tempo.toFixed(2), l: !f.amBoden });
    }
    // Andere weich nachführen
    for (const s of this.andere.values()) {
      const g = s.avatar.gruppe;
      g.position.lerp(s.ziel, Math.min(1, dt * 10));
      let d = s.gier - g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.rotation.y += d * Math.min(1, dt * 10);
      s.avatar.animieren(dt, s.tempo, s.inLuft);
    }
    // Sperren nach Pause/Weiter wiederherstellen (Raumwahl, Sucher mit Augen zu)
    if (this.phase === "wahl" || (this.phase === "verstecken" && this.sucher === this.ich)) f.gesperrt = true;
    // Phasen
    this.phaseZeit += dt;
    if (this.phase === "verstecken") {
      const rest = VERSTECK_S - this.phaseZeit;
      if (this.sucher === this.ich) this.schirm.textContent = `Augen zu! ${Math.max(0, Math.ceil(rest))}`;
      this.k.hud.anzeige(`🙈 Verstecken ${uhr(rest)}`);
      if (rest <= 0) this.suchenStarten();
    } else if (this.phase === "suchen") {
      this.suchZeit += dt;
      const rest = SUCH_S - this.phaseZeit;
      this.k.hud.anzeige(`🔍 Suchen ${uhr(rest)} · ${this.gefunden.size}/${this.verstecker.size} gefunden`);
      if (this.sucher === this.ich) {
        for (const id of this.verstecker) {
          if (this.gefunden.has(id)) continue;
          const s = this.andere.get(id);
          if (!s?.gesehen) continue;
          if (s.avatar.gruppe.position.distanceTo(f.fuss()) < 1.5 && this.sichtbar(s)) this.finden(id);
        }
      }
      if (rest <= 0 && this.phase === "suchen") this.rundeEnde(`Zeit um! Die Versteckten gewinnen 🙈 (${this.gefunden.size}/${this.verstecker.size} gefunden)`);
    } else if (this.phase === "lobby") {
      this.k.hud.anzeige(`🙈 Raum ${this.code} · ${this.liste.length} ${this.liste.length === 1 ? "Spieler" : "Spieler"}`);
    }
  }

  private finden(id: string) {
    this.senden({ typ: "gefunden", id });
    this.gefundenSetzen(id);
  }

  tipp(x: number, y: number): boolean {
    if (this.phase !== "suchen" || this.sucher !== this.ich) return false;
    this.ray.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), this.k.welt.kamera);
    const offen = [...this.verstecker].filter((id) => !this.gefunden.has(id)).map((id) => this.andere.get(id)).filter((s): s is Mitspieler => !!s?.gesehen);
    const hits = this.ray.intersectObjects(offen.map((s) => s.avatar.gruppe), true);
    if (!hits.length) return false;
    const s = offen.find((q) => { for (let o: THREE.Object3D | null = hits[0].object; o; o = o.parent) if (o === q.avatar.gruppe) return true; return false; });
    if (!s) return false;
    if (s.avatar.gruppe.position.distanceTo(this.k.figur.fuss()) > 4) { this.k.hud.meldung("Zu weit weg – geh näher ran!", 1200); return true; }
    if (!this.sichtbar(s)) return false;
    this.finden(s.id);
    return true;
  }

  pause(_an: boolean) {
    // Online läuft die Runde weiter; die Figur sperrt die App selbst
  }

  ende() {
    this.beendet = true;
    this.trennen();
    this.schirm.remove();
    this.k.hud.leiste().replaceChildren();
    this.k.figur.gesperrt = false;
  }
}
