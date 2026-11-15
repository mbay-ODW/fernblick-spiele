// Ferienhaus-Tycoon: ein Tag als Gastgeber – Gäste kommen an, haben Wünsche, du rennst hin und erfüllst sie
import * as THREE from "three";
import { Kontext, Spiel } from "./typen";

type Raum = Kontext["welt"]["daten"]["raeume"][number];

interface WunschArt { id: string; emoji: string; text: string; raeume?: string[]; moebel?: RegExp; imGastraum?: boolean }

const WUENSCHE: WunschArt[] = [
  { id: "bett", emoji: "🛏", text: "Bett machen", moebel: /bett/, imGastraum: true },
  { id: "klopapier", emoji: "🧻", text: "Klopapier fehlt", raeume: ["bad"] },
  { id: "handtuch", emoji: "🛁", text: "Frische Handtücher", raeume: ["bad"] },
  { id: "licht", emoji: "💡", text: "Licht kaputt", imGastraum: true },
  { id: "fruehstueck", emoji: "🍽", text: "Frühstück bitte", moebel: /esstisch|tisch|kueche|küche|insel/, raeume: ["wohnen"] },
  { id: "heizung", emoji: "🔥", text: "Zu kalt – Heizung!", raeume: ["hwr"] },
  { id: "kruemel", emoji: "🧹", text: "Krümel wegfegen", imGastraum: true },
  { id: "wlan", emoji: "📶", text: "WLAN geht nicht", raeume: ["hwr", "diele"] },
];

const GAST_FARBEN = [0xe8457a, 0x2fb6ff, 0x7a4fd6, 0x2fd67a, 0xf28b30, 0x3a8fd6, 0xd6c22f, 0x9a5b3a];
const HAUT = [0xf1c9a5, 0xd9a47a, 0xa86f4c, 0x6e4630];
const NAMEN = ["Familie Schmitt", "Oma Inge", "Herr Yilmaz", "Lena & Tom", "Familie Weber", "Frau Nowak", "Die Müllers", "Opa Karl"];

interface Wunsch {
  art: WunschArt;
  gast: Gast;
  pos: THREE.Vector3;
  sprite: THREE.Sprite;
  leinwand: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  dauer: number;
  rest: number;
  stufe: number;
}

interface Gast {
  name: string;
  gruppe: THREE.Group;
  raum: Raum;
  weg: THREE.Vector3[];
  tempo: number;
  bleibtBis: number;
  naechsterWunsch: number;
  geht: boolean;
  weg_fertig: boolean;
  phase: number;
}

interface Funke { sprite: THREE.Sprite; v: THREE.Vector3; leben: number }

function punktInPoly(x: number, y: number, p: [number, number][]) {
  let drin = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) drin = !drin;
  }
  return drin;
}

/** Zufälliger Punkt im Raum (mit Abstand zum Rand, so gut es geht) */
function punktImRaum(r: Raum): [number, number] {
  const xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let i = 0; i < 40; i++) {
    const x = x0 + 0.5 + Math.random() * Math.max(0.01, x1 - x0 - 1), y = y0 + 0.5 + Math.random() * Math.max(0.01, y1 - y0 - 1);
    if (punktInPoly(x, y, r.polygon)) return [x, y];
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

function gastModell(): THREE.Group {
  const g = new THREE.Group();
  const kleid = new THREE.MeshStandardMaterial({ color: GAST_FARBEN[Math.floor(Math.random() * GAST_FARBEN.length)], roughness: 0.8 });
  const haut = new THREE.MeshStandardMaterial({ color: HAUT[Math.floor(Math.random() * HAUT.length)], roughness: 0.7 });
  const hose = new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.9 });
  const koerper = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.24), kleid);
  koerper.position.y = 1.0;
  const kopf = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), haut);
  kopf.position.y = 1.47;
  const auge = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const x of [-0.07, 0.07]) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), auge);
    a.position.set(x, 1.5, -0.165);
    g.add(a);
  }
  for (const x of [-0.11, 0.11]) {
    const bein = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.72, 0.2), hose);
    bein.position.set(x, 0.36, 0);
    bein.name = x < 0 ? "beinL" : "beinR";
    g.add(bein);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.52, 0.15), kleid);
    arm.position.set(x * 2.5, 1.0, 0);
    g.add(arm);
  }
  g.add(koerper, kopf);
  g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  return g;
}

function funkenSprite(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const x = c.getContext("2d")!;
  const v = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  v.addColorStop(0, "rgba(255,245,180,1)");
  v.addColorStop(1, "rgba(255,200,60,0)");
  x.fillStyle = v;
  x.fillRect(0, 0, 32, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  s.scale.setScalar(0.18);
  return s;
}

export class TycoonSpiel implements Spiel {
  private k!: Kontext;
  private gaeste: Gast[] = [];
  private wuensche: Wunsch[] = [];
  private funken: Funke[] = [];
  private bewertungen: number[] = [5];
  private muenzen = 0;
  private zeit = 0;
  private dauer = 180;
  private naechsterGast = 3;
  private laeuft = false;
  private eingang = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private namen = [...NAMEN];

  start(k: Kontext) {
    this.k = k;
    k.welt.tageszeit(false);
    this.dauer = (Number(k.optionen.dauer) || 3) * 60;
    this.eingang.copy(k.figur.start);
    this.namen.sort(() => Math.random() - 0.5);
    this.laeuft = true;
    k.hud.meldung("Gleich kommen die ersten Gäste! 🏡", 2500);
    this.anzeige();
  }

  private sterne() {
    return this.bewertungen.reduce((a, b) => a + b, 0) / this.bewertungen.length;
  }

  private anzeige() {
    const rest = Math.max(0, Math.ceil(this.dauer - this.zeit));
    const m = Math.floor(rest / 60);
    this.k.hud.anzeige(`💰 ${this.muenzen} · ⭐ ${this.sterne().toFixed(1).replace(".", ",")} · ⏱ ${m}:${String(rest % 60).padStart(2, "0")}`);
  }

  private geschossZ(g: string) {
    const d = this.k.welt.daten.geschosse;
    return g === "OG" ? d.OG : d.EG;
  }

  // --- Gäste -------------------------------------------------------------------------
  private gastAnkunft() {
    const raeume = this.k.welt.daten.raeume;
    const beliebt = raeume.filter((r) => /schlaf|kinder|wohn|galerie/.test(r.id));
    const auswahl = beliebt.length ? beliebt : raeume;
    if (!auswahl.length) return;
    const raum = auswahl[Math.floor(Math.random() * auswahl.length)];
    const [x, y] = punktImRaum(raum);
    const ziel = new THREE.Vector3(x, this.geschossZ(raum.geschoss), y);
    const gruppe = gastModell();
    gruppe.position.copy(this.eingang);
    this.k.welt.szene.add(gruppe);
    const name = this.namen.length ? this.namen.pop()! : "Ein Gast";
    const gast: Gast = { name, gruppe, raum, weg: [ziel], tempo: 1.3 + Math.random() * 0.4, bleibtBis: this.zeit + 70 + Math.random() * 30,
      naechsterWunsch: this.zeit + 6 + Math.random() * 6, geht: false, weg_fertig: false, phase: 0 };
    this.gaeste.push(gast);
    this.k.hud.meldung(`🛎 ${name} ist angekommen!`, 1800);
  }

  private gastBewegen(g: Gast, dt: number) {
    const ziel = g.weg[0];
    if (!ziel) { g.weg_fertig = true; return; }
    const p = g.gruppe.position;
    const d = new THREE.Vector3(ziel.x - p.x, 0, ziel.z - p.z);
    const l = d.length();
    const schritt = g.tempo * dt;
    // Höhe gleitet mit (ins OG ohne Treppenweg)
    const rest = Math.max(l, 0.001);
    p.y += (ziel.y - p.y) * Math.min(1, schritt / rest);
    if (l <= schritt) {
      p.set(ziel.x, ziel.y, ziel.z);
      g.weg.shift();
    } else {
      p.addScaledVector(d.normalize(), schritt);
      g.gruppe.rotation.y = Math.atan2(-d.x, -d.z);
    }
    g.phase += dt * 8;
    const schwung = g.weg.length ? Math.sin(g.phase) * 0.5 : 0;
    const bl = g.gruppe.getObjectByName("beinL"), br = g.gruppe.getObjectByName("beinR");
    if (bl) bl.rotation.x = schwung;
    if (br) br.rotation.x = -schwung;
  }

  // --- Wünsche ------------------------------------------------------------------------
  private wunschOrt(art: WunschArt, gast: Gast): THREE.Vector3 | null {
    const d = this.k.welt.daten;
    const raeume = art.imGastraum ? [gast.raum] : d.raeume.filter((r) => art.raeume?.includes(r.id));
    if (art.moebel) {
      const kandidaten = d.moebel.filter((m) => art.moebel!.test(String(m.typ)) && (!raeume.length || raeume.some((r) => r.id === m.raum)));
      const alle = kandidaten.length ? kandidaten : d.moebel.filter((m) => art.moebel!.test(String(m.typ)));
      if (alle.length) {
        const m = alle[Math.floor(Math.random() * alle.length)];
        return new THREE.Vector3(m.pos[0], this.geschossZ(m.geschoss) + (m.z ?? 0) + m.masse_bth[2] + 0.45, m.pos[1]);
      }
    }
    if (!raeume.length) return null;
    const r = raeume[Math.floor(Math.random() * raeume.length)];
    const [x, y] = punktImRaum(r);
    return new THREE.Vector3(x, this.geschossZ(r.geschoss) + (art.id === "licht" ? 1.9 : art.id === "kruemel" ? 0.45 : 1.2), y);
  }

  private wunschBild(w: Wunsch) {
    const c = w.leinwand, x = c.getContext("2d")!;
    const anteil = Math.max(0, w.rest / w.dauer);
    x.clearRect(0, 0, 128, 128);
    x.fillStyle = "rgba(255,255,255,0.92)";
    x.beginPath();
    x.arc(64, 64, 44, 0, Math.PI * 2);
    x.fill();
    // Zeitring: grün → gelb → rot
    const farbe = anteil > 0.5 ? "#3fbf4a" : anteil > 0.25 ? "#f2c230" : "#e0412f";
    x.strokeStyle = "rgba(0,0,0,0.15)";
    x.lineWidth = 12;
    x.beginPath();
    x.arc(64, 64, 54, 0, Math.PI * 2);
    x.stroke();
    x.strokeStyle = farbe;
    x.beginPath();
    x.arc(64, 64, 54, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * anteil);
    x.stroke();
    x.font = "54px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(w.art.emoji, 64, 68);
    w.tex.needsUpdate = true;
  }

  private wunschAnlegen(g: Gast) {
    const offen = this.wuensche.filter((w) => w.gast === g).length;
    if (offen >= 2) return;
    const belegt = new Set(this.wuensche.map((w) => w.art.id));
    const moeglich = WUENSCHE.filter((a) => !belegt.has(a.id));
    if (!moeglich.length) return;
    const art = moeglich[Math.floor(Math.random() * moeglich.length)];
    const pos = this.wunschOrt(art, g);
    if (!pos) return;
    const leinwand = document.createElement("canvas");
    leinwand.width = leinwand.height = 128;
    const tex = new THREE.CanvasTexture(leinwand);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.setScalar(0.55);
    sprite.renderOrder = 10;
    sprite.position.copy(pos);
    sprite.userData.wunsch = true;
    const dauer = this.dauer >= 300 ? 40 : 35;
    const w: Wunsch = { art, gast: g, pos, sprite, leinwand, tex, dauer, rest: dauer, stufe: -1 };
    this.wunschBild(w);
    this.k.welt.szene.add(sprite);
    this.wuensche.push(w);
    this.k.hud.meldung(`${art.emoji} ${g.name}: ${art.text}`, 2200);
  }

  private wunschWeg(w: Wunsch) {
    this.k.welt.szene.remove(w.sprite);
    w.tex.dispose();
    w.sprite.material.dispose();
    this.wuensche = this.wuensche.filter((x) => x !== w);
  }

  private erfuellen(w: Wunsch) {
    const anteil = w.rest / w.dauer;
    const lohn = 10 + Math.round(10 * anteil);
    this.muenzen += lohn;
    this.bewertungen.push(anteil > 0.5 ? 5 : 4);
    this.funkenSpruehen(w.pos);
    this.wunschWeg(w);
    this.k.hud.meldung(`✨ +${lohn} 💰 ${w.gast.name} freut sich!`, 1300);
    navigator.vibrate?.(40);
  }

  private funkenSpruehen(p: THREE.Vector3) {
    for (let i = 0; i < 14; i++) {
      const s = funkenSprite();
      s.position.copy(p);
      this.k.welt.szene.add(s);
      const a = Math.random() * Math.PI * 2;
      this.funken.push({ sprite: s, v: new THREE.Vector3(Math.cos(a) * 1.2, 1.5 + Math.random() * 1.5, Math.sin(a) * 1.2), leben: 0.7 });
    }
  }

  // --- Ablauf -------------------------------------------------------------------------
  update(dt: number) {
    // Funken laufen auch nach Tagesende aus
    for (const f of this.funken) {
      f.leben -= dt;
      f.v.y -= 4 * dt;
      f.sprite.position.addScaledVector(f.v, dt);
      f.sprite.material.opacity = Math.max(0, f.leben / 0.7);
    }
    for (const f of this.funken.filter((x) => x.leben <= 0)) { this.k.welt.szene.remove(f.sprite); f.sprite.material.map?.dispose(); f.sprite.material.dispose(); }
    this.funken = this.funken.filter((x) => x.leben > 0);
    if (!this.laeuft) return;
    this.zeit += dt;
    if (this.zeit >= this.naechsterGast && this.gaeste.filter((g) => !g.geht).length < 4 && this.zeit < this.dauer - 25) {
      this.gastAnkunft();
      this.naechsterGast = this.zeit + 20 + Math.random() * 10;
    }
    for (const g of this.gaeste) {
      this.gastBewegen(g, dt);
      if (!g.geht && g.weg_fertig && this.zeit >= g.naechsterWunsch) {
        this.wunschAnlegen(g);
        g.naechsterWunsch = this.zeit + 14 + Math.random() * 10;
      }
      if (!g.geht && this.zeit >= g.bleibtBis && !this.wuensche.some((w) => w.gast === g)) {
        g.geht = true;
        g.weg = [this.eingang.clone()];
        g.weg_fertig = false;
        this.k.hud.meldung(`👋 ${g.name} reist ab`, 1500);
      }
    }
    for (const g of this.gaeste.filter((x) => x.geht && !x.weg.length)) this.k.welt.szene.remove(g.gruppe);
    this.gaeste = this.gaeste.filter((x) => !(x.geht && !x.weg.length));
    // Wünsche: Zeit, Bild, Hinlaufen
    const f = this.k.figur.fuss();
    for (const w of [...this.wuensche]) {
      w.rest -= dt;
      const stufe = Math.ceil((w.rest / w.dauer) * 40);
      if (stufe !== w.stufe) { w.stufe = stufe; this.wunschBild(w); }
      w.sprite.position.y = w.pos.y + Math.sin(this.zeit * 3 + w.dauer) * 0.05;
      if (w.rest <= 0) {
        this.bewertungen.push(1);
        this.wunschWeg(w);
        this.k.hud.meldung(`😠 ${w.gast.name} ist enttäuscht (${w.art.text})`, 1800);
        continue;
      }
      if (Math.hypot(w.pos.x - f.x, w.pos.z - f.z) < 1.2 && w.pos.y - f.y > -0.6 && w.pos.y - f.y < 2.6) this.erfuellen(w);
    }
    if (this.zeit >= this.dauer) this.tagEnde();
    this.anzeige();
  }

  private tagEnde() {
    this.laeuft = false;
    for (const w of [...this.wuensche]) this.wunschWeg(w);
    for (const g of this.gaeste) { g.geht = true; g.weg = [this.eingang.clone()]; }
    const sterne = this.sterne();
    const punkte = this.muenzen + Math.round(sterne * 20);
    this.anzeige();
    this.k.fertig({ zeit_ms: Math.round(this.dauer * 1000), punkte, text: `Tag geschafft! ⭐ ${sterne.toFixed(1).replace(".", ",")} · 💰 ${this.muenzen}` });
  }

  tipp(x: number, y: number): boolean {
    if (!this.laeuft || !this.wuensche.length) return false;
    this.ray.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), this.k.welt.kamera);
    const t = this.ray.intersectObjects(this.wuensche.map((w) => w.sprite), false)[0];
    if (!t) return false;
    const w = this.wuensche.find((q) => q.sprite === t.object);
    if (!w) return false;
    const kopf = this.k.figur.kopf();
    if (w.pos.distanceTo(kopf) > 3.5) { this.k.hud.meldung("Zu weit weg – lauf hin!", 1200); return true; }
    const richtung = w.pos.clone().sub(kopf).normalize();
    if (this.k.welt.strahl(kopf, richtung, w.pos.distanceTo(kopf) - 0.2, this.k.figur.collider)) return false;
    this.erfuellen(w);
    return true;
  }

  pause(an: boolean) {
    this.laeuft = !an && this.zeit < this.dauer;
  }

  ende() {
    for (const w of [...this.wuensche]) this.wunschWeg(w);
    for (const g of this.gaeste) this.k.welt.szene.remove(g.gruppe);
    for (const f of this.funken) this.k.welt.szene.remove(f.sprite);
    this.gaeste = [];
    this.funken = [];
  }
}
