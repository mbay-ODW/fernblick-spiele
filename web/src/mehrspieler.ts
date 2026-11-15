// Zusammen spielen: Raum mit Code (WebSocket, der Server reicht Nachrichten nur weiter), Mitspieler als Avatare
import * as THREE from "three";
import { Avatar, AvatarCfg, STANDARD_AVATAR } from "./avatar";
import { api } from "./api";
import { Welt } from "./welt";
import { Figur } from "./figur";

export interface Mitglied { id: string; name: string; avatar: AvatarCfg }

/** Raum-Code ohne verwechselbare Zeichen (0/O, 1/I) */
export function neuerCode(): string {
  const z = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => z[Math.floor(Math.random() * z.length)]).join("");
}

/** Gleicher Zufall auf allen Geräten (Mulberry32) */
export function zufallMitSamen(samen: number): () => number {
  let a = samen >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Raum {
  ws: WebSocket;
  ich = "";
  mitglieder: Mitglied[] = [];
  offen = false;
  private hoerer = new Set<(m: any) => void>();

  constructor(public code: string, private name: string, private avatar: AvatarCfg) {
    this.ws = api.versteckenVerbinden(code);
    this.ws.onopen = () => { this.offen = true; this.senden({ typ: "hallo", name: this.name, avatar: this.avatar }); };
    this.ws.onclose = () => { this.offen = false; this.melden({ typ: "getrennt" }); };
    this.ws.onmessage = (e) => {
      let m: any;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.typ === "du") this.ich = m.id;
      if (m.typ === "spieler") this.mitglieder = m.liste;
      this.melden(m);
    };
  }

  /** Der Erste im Raum leitet (startet Runden) */
  get leiter(): boolean { return !!this.ich && this.mitglieder[0]?.id === this.ich; }
  nameVon(id: string): string { return this.mitglieder.find((m) => m.id === id)?.name ?? "?"; }
  senden(m: any) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  hoeren(fn: (m: any) => void): () => void { this.hoerer.add(fn); return () => this.hoerer.delete(fn); }
  private melden(m: any) { for (const f of [...this.hoerer]) f(m); }
  schliessen() { this.hoerer.clear(); this.ws.onclose = null; this.ws.close(); }
}

function namensSchild(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const x = c.getContext("2d")!;
  x.font = "bold 34px system-ui, sans-serif";
  const b = Math.min(250, x.measureText(text).width + 28);
  x.fillStyle = "rgba(0,0,0,0.55)";
  x.beginPath(); x.roundRect((256 - b) / 2, 6, b, 52, 20); x.fill();
  x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(text, 128, 33);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(1.1, 0.275, 1);
  s.renderOrder = 10;
  return s;
}

interface Anderer { avatar: Avatar; schild: THREE.Sprite; ziel: THREE.Vector3; gier: number; tempo: number; luft: boolean; cfg: string }

/** Zeigt die anderen Spieler im Raum und schickt die eigene Lage 10× pro Sekunde */
export class Mitspieler {
  private andere = new Map<string, Anderer>();
  private takt = 0;
  private letzte: THREE.Vector3 | null = null;
  private aus: () => void;
  /** Namen über den Köpfen zeigen */
  schilder = true;

  constructor(private welt: Welt, private raum: Raum, private figur: Figur) {
    this.aus = raum.hoeren((m) => {
      if (m.typ === "spieler") this.abgleichen();
      if (m.typ === "pos" && m.von) {
        const a = this.holen(m.von);
        if (!a || !Array.isArray(m.p)) return;
        a.ziel.set(m.p[0], m.p[1], m.p[2]);
        a.gier = m.g ?? 0; a.tempo = m.t ?? 0; a.luft = !!m.l;
        if (!a.avatar.gruppe.visible) { a.avatar.gruppe.position.copy(a.ziel); a.avatar.gruppe.visible = true; }
      }
    });
    this.abgleichen();
  }

  private holen(id: string): Anderer | undefined {
    if (id === this.raum.ich) return undefined;
    const mg = this.raum.mitglieder.find((m) => m.id === id);
    if (!mg) return undefined;
    const cfgText = JSON.stringify(mg.avatar ?? {});
    let a = this.andere.get(id);
    if (a && a.cfg !== cfgText) { this.entfernenEiner(id); a = undefined; }
    if (!a) {
      const avatar = new Avatar({ ...STANDARD_AVATAR, ...(mg.avatar ?? {}) });
      avatar.gruppe.visible = false;
      const schild = namensSchild(mg.name);
      schild.position.y = 2.05;
      avatar.gruppe.add(schild);
      this.welt.szene.add(avatar.gruppe);
      a = { avatar, schild, ziel: new THREE.Vector3(), gier: 0, tempo: 0, luft: false, cfg: cfgText };
      this.andere.set(id, a);
    }
    return a;
  }

  private abgleichen() {
    const ids = new Set(this.raum.mitglieder.map((m) => m.id));
    for (const id of [...this.andere.keys()]) if (!ids.has(id)) this.entfernenEiner(id);
    for (const m of this.raum.mitglieder) this.holen(m.id);
  }

  private entfernenEiner(id: string) {
    const a = this.andere.get(id);
    if (a) this.welt.szene.remove(a.avatar.gruppe);
    this.andere.delete(id);
  }

  /** Position eines Mitspielers (Füße) oder null */
  lage(id: string): THREE.Vector3 | null { return this.andere.get(id)?.avatar.gruppe.position ?? null; }

  update(dt: number) {
    this.takt += dt;
    if (this.takt > 0.1) {
      this.takt = 0;
      const f = this.figur.fuss();
      const tempo = this.letzte ? Math.min(1, Math.hypot(f.x - this.letzte.x, f.z - this.letzte.z) / 0.1 / 5.6) : 0;
      this.letzte = f;
      this.raum.senden({ typ: "pos", p: [+f.x.toFixed(3), +f.y.toFixed(3), +f.z.toFixed(3)], g: +this.figur.avatar.gruppe.rotation.y.toFixed(3),
        t: +tempo.toFixed(2), l: !this.figur.amBoden });
    }
    for (const a of this.andere.values()) {
      const g = a.avatar.gruppe;
      g.position.lerp(a.ziel, Math.min(1, dt * 10));
      let d = a.gier - g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.rotation.y += d * Math.min(1, dt * 10);
      a.avatar.animieren(dt, a.tempo, a.luft);
      a.schild.visible = this.schilder;
    }
  }

  entfernen() {
    this.aus();
    for (const id of [...this.andere.keys()]) this.entfernenEiner(id);
  }
}
