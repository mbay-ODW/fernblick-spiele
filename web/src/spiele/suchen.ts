// Schatzsuche: Schätze auf, unter und neben Möbeln sowie in Räumen verteilen, einsammeln gegen die Uhr
import * as THREE from "three";
import { Kontext, Spiel } from "./typen";

interface Schatz { gruppe: THREE.Group; glanz?: THREE.Sprite; gefunden: boolean; phase: number }

const OBEN_TYPEN = /tisch|sideboard|kommode|regal|nachttisch|bank|board|schrank|faecher|bett|sofa|sessel|unterbau|waschmasch|trockner|container/;
const UNTER_TYPEN = /bett|sofa|ecksofa|esstisch|couchtisch|schreibtisch|sessel|esssofa|bank|tagesbett/;
const NIE = /teppich|bild|spiegel|leuchte|wandspot|pflanze|tv$/;

function schatzModell(art: number, leuchtend: boolean): THREE.Group {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xf2c230, metalness: 0.9, roughness: 0.25, emissive: leuchtend ? 0x553c00 : 0x000000 });
  const farben = [0x2fb6ff, 0xe8457a, 0x7a4fd6, 0x2fd67a];
  const stein = new THREE.MeshStandardMaterial({ color: farben[art % 4], metalness: 0.2, roughness: 0.08, emissive: leuchtend ? farben[art % 4] : 0, emissiveIntensity: 0.35 });
  switch (art % 5) {
    case 0: { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.025, 28), gold); m.rotation.x = Math.PI / 2; g.add(m); break; }
    case 1: g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.11), stein)); break;
    case 2: {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.018, 10, 24), gold);
      const schaft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.025), gold);
      schaft.position.y = -0.11;
      const bart = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.025), gold);
      bart.position.set(0.03, -0.17, 0);
      g.add(ring, schaft, bart);
      break;
    }
    case 3: {
      const s = new THREE.Shape();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.05 : 0.12, a = (i / 10) * Math.PI * 2 + Math.PI / 2; s[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r); }
      g.add(new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false }), gold));
      break;
    }
    default: {
      const truhe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.15), new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.7 }));
      const deckel = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.04, 0.16), gold);
      deckel.position.y = 0.08;
      g.add(truhe, deckel);
    }
  }
  g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  g.userData.schatz = true;
  return g;
}

function glanzSprite(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const v = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  v.addColorStop(0, "rgba(255,240,170,0.95)");
  v.addColorStop(0.35, "rgba(255,220,120,0.35)");
  v.addColorStop(1, "rgba(255,220,120,0)");
  x.fillStyle = v;
  x.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.set(0.7, 0.7, 1);
  return s;
}

function punktInPoly(x: number, y: number, p: [number, number][]) {
  let drin = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) drin = !drin;
  }
  return drin;
}

export class Suchspiel implements Spiel {
  private k!: Kontext;
  private schaetze: Schatz[] = [];
  private zeit = 0;
  private laeuft = false;
  private ray = new THREE.Raycaster();

  start(k: Kontext) {
    this.k = k;
    const stufe = k.optionen.stufe ?? "leicht";
    const anzahl = stufe === "leicht" ? 5 : stufe === "mittel" ? 8 : 12;
    const leuchtend = stufe !== "schwer";
    k.welt.tageszeit(k.optionen.zeit === "nacht");
    const orte = this.verstecke(stufe);
    for (let i = 0; i < Math.min(anzahl, orte.length); i++) {
      const g = schatzModell(i, leuchtend);
      g.position.copy(orte[i]).add(new THREE.Vector3(0, 0.14, 0));
      const s: Schatz = { gruppe: g, gefunden: false, phase: Math.random() * 6 };
      if (leuchtend) { s.glanz = glanzSprite(); g.add(s.glanz); }
      k.welt.szene.add(g);
      this.schaetze.push(s);
    }
    this.zeit = 0;
    this.laeuft = true;
    k.hud.meldung(`Finde ${this.schaetze.length} Schätze!`, 2500);
    this.anzeige();
  }

  /** Verstecke per Strahl gegen das Haus: Oberflächen von Möbeln, Boden darunter, freie Stellen in Räumen */
  private verstecke(stufe: string): THREE.Vector3[] {
    const w = this.k.welt, d = w.daten;
    const gz = (g: string) => (g === "OG" ? d.geschosse.OG : d.geschosse.EG);
    const oben: THREE.Vector3[] = [], unten: THREE.Vector3[] = [], boden: THREE.Vector3[] = [];
    const runter = new THREE.Vector3(0, -1, 0), hoch = new THREE.Vector3(0, 1, 0);
    // Treffer per Strahl gegen das Hausmodell: nur Möbel-Oberseiten oder echter Boden, mit genug Luft darüber
    const ray = new THREE.Raycaster();
    const art = (o: THREE.Object3D | null): string => {
      for (; o; o = o.parent) {
        if (o.userData?.moebelId) return "moebel";
        if (o.userData?.art) return String(o.userData.art);
      }
      return "";
    };
    const trefferAuf = (x: number, y: number, vonZ: number, bisZ: number, erlaubt: string, frei = 0.35): THREE.Vector3 | null => {
      ray.set(new THREE.Vector3(x, vonZ, y), runter);
      ray.far = vonZ - bisZ;
      const t = ray.intersectObject(w.haus, true)[0];
      if (!t?.face || art(t.object) !== erlaubt) return null;
      if (t.face.normal.clone().transformDirection(t.object.matrixWorld).y < 0.7) return null;
      const darueber = w.strahl(t.point.clone().add(new THREE.Vector3(0, 0.02, 0)), hoch, 9);
      if (!darueber || darueber.abstand < frei) return null;
      return t.point.clone();
    };
    const maxHoehe = stufe === "leicht" ? 1.3 : 1.7;
    for (const m of d.moebel) {
      const typ = String(m.typ);
      if (NIE.test(typ)) continue;
      const z0 = gz(m.geschoss);
      const [b, t] = m.masse_bth;
      const r = ((m.rot_grad ?? 0) * Math.PI) / 180;
      const lokal = (u: number, v: number): [number, number] => [m.pos[0] + u * Math.cos(r) - v * Math.sin(r), m.pos[1] + u * Math.sin(r) + v * Math.cos(r)];
      if (OBEN_TYPEN.test(typ)) {
        const [x, y] = lokal((Math.random() - 0.5) * b * 0.5, (Math.random() - 0.5) * t * 0.4);
        const p = trefferAuf(x, y, z0 + 1.95, z0 + 0.2, "moebel");
        if (p && p.y - z0 > 0.25 && p.y - z0 < maxHoehe) oben.push(p);
      }
      if (UNTER_TYPEN.test(typ)) {
        const [x, y] = lokal((Math.random() - 0.5) * b * 0.3, (Math.random() - 0.5) * t * 0.3);
        const p = trefferAuf(x, y, z0 + 0.2, z0 - 0.3, "boden", 0.12);
        if (p) unten.push(p);
      }
    }
    for (const raum of d.raeume) {
      const z0 = gz(raum.geschoss);
      const xs = raum.polygon.map((p) => p[0]), ys = raum.polygon.map((p) => p[1]);
      for (let i = 0; i < 6; i++) {
        const x = Math.min(...xs) + Math.random() * (Math.max(...xs) - Math.min(...xs));
        const y = Math.min(...ys) + Math.random() * (Math.max(...ys) - Math.min(...ys));
        if (!punktInPoly(x, y, raum.polygon)) continue;
        const p = trefferAuf(x, y, z0 + 1.0, z0 - 0.3, "boden");
        if (p && Math.abs(p.y - z0) < 0.1) boden.push(p);
      }
    }
    const mischen = <T,>(a: T[]) => a.map((x) => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map((x) => x[1]);
    const start = this.k.figur.start;
    const quellen = stufe === "leicht" ? [...mischen(oben), ...mischen(boden)] : stufe === "mittel" ? [...mischen([...oben, ...unten]), ...mischen(boden)] : [...mischen(unten), ...mischen(oben), ...mischen(boden)];
    const wahl: THREE.Vector3[] = [];
    for (const p of quellen) {
      if (p.distanceTo(start) < 2.5) continue;
      if (wahl.some((q) => q.distanceTo(p) < 1.6)) continue;
      wahl.push(p);
    }
    return wahl;
  }

  private anzeige() {
    const gef = this.schaetze.filter((s) => s.gefunden).length;
    const s = Math.floor(this.zeit), m = Math.floor(s / 60);
    this.k.hud.anzeige(`💎 ${gef} / ${this.schaetze.length}   ⏱ ${m}:${String(s % 60).padStart(2, "0")}`);
  }

  private einsammeln(s: Schatz) {
    if (s.gefunden) return;
    s.gefunden = true;
    this.k.welt.szene.remove(s.gruppe);
    const rest = this.schaetze.filter((x) => !x.gefunden).length;
    this.k.hud.meldung(rest ? `Gefunden! Noch ${rest}` : "Alle gefunden! 🎉", 1400);
    navigator.vibrate?.(40);
    if (!rest) {
      this.laeuft = false;
      const ms = Math.round(this.zeit * 1000);
      this.k.fertig({ zeit_ms: ms, punkte: this.schaetze.length, text: `Alle ${this.schaetze.length} Schätze gefunden!` });
    }
    this.anzeige();
  }

  update(dt: number) {
    if (this.laeuft) this.zeit += dt;
    const f = this.k.figur.fuss();
    for (const s of this.schaetze) {
      if (s.gefunden) continue;
      s.phase += dt;
      s.gruppe.rotation.y += dt * 1.6;
      s.gruppe.children[0].position.y = Math.sin(s.phase * 2.2) * 0.03;
      if (s.glanz) s.glanz.material.opacity = 0.55 + Math.sin(s.phase * 3) * 0.3;
      // hinlaufen genügt: nah dran und etwa auf Augen-/Greifhöhe
      const p = s.gruppe.position;
      if (this.laeuft && Math.hypot(p.x - f.x, p.z - f.z) < 0.55 && p.y - f.y > -0.4 && p.y - f.y < 1.9) this.einsammeln(s);
    }
    if (this.laeuft) this.anzeige();
  }

  tipp(x: number, y: number): boolean {
    if (!this.laeuft) return false;
    const k = this.k.welt.kamera;
    this.ray.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), k);
    const offen = this.schaetze.filter((s) => !s.gefunden);
    const hits = this.ray.intersectObjects(offen.map((s) => s.gruppe), true);
    if (!hits.length) return false;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && !o.userData.schatz) o = o.parent;
    const s = offen.find((q) => q.gruppe === o);
    if (!s) return false;
    // nur aus der Nähe (Figur bis 3,5 m entfernt) und ohne Wand dazwischen
    const kopf = this.k.figur.kopf();
    const d = s.gruppe.position.distanceTo(kopf);
    if (d > 3.5) { this.k.hud.meldung("Zu weit weg – geh näher ran!", 1200); return true; }
    const richtung = s.gruppe.position.clone().sub(kopf).normalize();
    const wand = this.k.welt.strahl(kopf, richtung, d - 0.15, this.k.figur.collider);
    if (wand) return false;
    this.einsammeln(s);
    return true;
  }

  pause(an: boolean) {
    this.laeuft = !an && this.schaetze.some((s) => !s.gefunden);
  }

  ende() {
    for (const s of this.schaetze) this.k.welt.szene.remove(s.gruppe);
    this.schaetze = [];
    this.k.welt.tageszeit(false);
  }
}
