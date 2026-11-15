// Escape-Room: Die Türen sind verriegelt. Finde vier farbige Ziffernkarten im Haus und tipp den Code ins Tastenfeld.
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Kontext, Spiel } from "./typen";

interface Farbe { name: string; emoji: string; hex: string }
const FARBEN: Farbe[] = [
  { name: "rot", emoji: "🟥", hex: "#d93a3a" },
  { name: "blau", emoji: "🟦", hex: "#2f6fd6" },
  { name: "grün", emoji: "🟩", hex: "#2fa84f" },
  { name: "gelb", emoji: "🟨", hex: "#e8b81c" },
];

/** Hinweise je Raum: [Muster für id/Name, leicht, schwer] */
const HINWEISE: [RegExp, string, string][] = [
  [/bad|wc|dusch/i, "im Bad 🛁", "wo es nass wird"],
  [/schlaf/i, "im Schlafzimmer 🛏️", "wo Mama und Papa träumen"],
  [/kind/i, "im Kinderzimmer 🧸", "wo die Kinder ihre Träume haben"],
  [/galerie/i, "oben auf der Galerie", "ganz oben, wo man runtergucken kann"],
  [/hwr|technik|wirtschaft/i, "im Hauswirtschaftsraum", "wo die Wäsche wohnt"],
  [/diele|flur|eingang/i, "in der Diele", "wo man die Schuhe auszieht"],
  [/wohn|koch|küche|kueche|ess/i, "im Wohnraum mit Küche", "wo es nach Essen duftet"],
];

interface Karte { farbe: Farbe; ziffer: number; raum: string; hinweis: string; gruppe: THREE.Group; glanz?: THREE.Sprite; gefunden: boolean; phase: number }

function punktInPoly(x: number, y: number, p: [number, number][]) {
  let drin = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) drin = !drin;
  }
  return drin;
}

function mischen<T>(a: T[]): T[] {
  return a.map((x) => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map((x) => x[1]);
}

function karteModell(f: Farbe, ziffer: number): THREE.Group {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 176;
  const x = c.getContext("2d")!;
  x.fillStyle = "#fbf6e6"; x.fillRect(0, 0, 128, 176);
  x.strokeStyle = f.hex; x.lineWidth = 14; x.strokeRect(7, 7, 114, 162);
  x.fillStyle = f.hex; x.font = "900 112px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(String(ziffer), 64, 94);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.275), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
  m.castShadow = true;
  const g = new THREE.Group();
  const halter = new THREE.Group();
  halter.add(m);
  halter.position.y = 0.16;
  g.add(halter);
  g.userData.karte = true;
  return g;
}

function glanzSprite(hex: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const col = new THREE.Color(hex);
  const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
  const v = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  v.addColorStop(0, `rgba(${rgb},0.9)`);
  v.addColorStop(0.4, `rgba(${rgb},0.3)`);
  v.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = v; x.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.set(0.8, 0.8, 1);
  s.position.y = 0.16;
  return s;
}

/** Tastenfeld an der Tür: Säule mit Bildschirm und Farbschild */
function tastenfeldModell(reihenfolge: Farbe[]): THREE.Group {
  const g = new THREE.Group();
  const saeule = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.15, 0.14), new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.5 }));
  saeule.position.y = 0.575;
  g.add(saeule);
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const x = c.getContext("2d")!;
  x.fillStyle = "#14181c"; x.fillRect(0, 0, 256, 256);
  x.fillStyle = "#7bdc6a"; x.font = "800 30px system-ui, sans-serif"; x.textAlign = "center";
  x.fillText("CODE?", 128, 44);
  reihenfolge.forEach((f, i) => { x.fillStyle = f.hex; x.fillRect(22 + i * 56, 70, 46, 46); });
  x.fillStyle = "#cfd6dc"; x.font = "700 26px system-ui, sans-serif";
  ["1 2 3", "4 5 6", "7 8 9", "  0  "].forEach((t, i) => x.fillText(t, 128, 150 + i * 28));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const schirm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.04), [
    ...Array(4).fill(new THREE.MeshStandardMaterial({ color: 0x2b2d30 })),
    new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6 }),
    new THREE.MeshStandardMaterial({ color: 0x2b2d30 }),
  ]);
  schirm.position.y = 1.3;
  schirm.rotation.x = -0.25;
  g.add(schirm);
  g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  g.userData.tastenfeld = true;
  return g;
}

export class EscapeSpiel implements Spiel {
  private k!: Kontext;
  private karten: Karte[] = [];
  private reihenfolge: Farbe[] = [];
  private tastenfeld!: THREE.Group;
  private sperren: RAPIER.Collider[] = [];
  private zeit = 0;
  private laeuft = false;
  private offen = false;
  private eingabeText = "";
  private feld: HTMLElement | null = null;
  private chips!: HTMLElement;
  private tasteAus: (() => void) | null = null;
  private ray = new THREE.Raycaster();
  private hinweisZeit = 0;

  start(k: Kontext) {
    this.k = k;
    k.welt.tageszeit(false);
    k.welt.tuerenGesperrt = true; // Haustür und Glasfront bleiben zu, bis der Code stimmt
    const schwer = k.optionen.stufe === "schwer";
    this.reihenfolge = mischen(FARBEN);
    // Glasfront verriegelt: unsichtbare Sperre davor (Modell y ≈ 11,25, x 0..7,78)
    const s = k.welt.physik.createCollider(RAPIER.ColliderDesc.cuboid(4.1, 1.5, 0.06).setTranslation(3.89, 1.4, 11.25));
    this.sperren.push(s);
    // Tastenfeld hinter dem Startpunkt (an der Tür)
    const start = k.figur.start;
    const gier = k.figur.gier;
    const rueck = new THREE.Vector3(Math.sin(gier), 0, Math.cos(gier));
    const frei = k.welt.strahl(start.clone().add(new THREE.Vector3(0, 1, 0)), rueck, 1.2, k.figur.collider);
    const abstand = frei ? Math.max(0.45, frei.abstand - 0.25) : 0.9;
    this.tastenfeld = tastenfeldModell(this.reihenfolge);
    this.tastenfeld.position.copy(start).addScaledVector(rueck, abstand);
    this.tastenfeld.rotation.y = gier;
    k.welt.szene.add(this.tastenfeld);
    // Karten in vier Räumen verstecken
    const orte = this.orte(schwer);
    FARBEN.forEach((f, i) => {
      const o = orte[i];
      if (!o) return;
      const ziffer = Math.floor(Math.random() * 10);
      const g = karteModell(f, ziffer);
      g.position.copy(o.p);
      const karte: Karte = { farbe: f, ziffer, raum: o.raum, hinweis: o.hinweis, gruppe: g, gefunden: false, phase: Math.random() * 6 };
      if (!schwer) { karte.glanz = glanzSprite(f.hex); g.add(karte.glanz); }
      k.welt.szene.add(g);
      this.karten.push(karte);
    });
    // HUD: Zettel-Knopf und Kartenleiste
    k.hud.knopf("zettel", "📜", () => this.zettelZeigen());
    this.chips = document.createElement("div");
    this.chips.style.display = "flex";
    this.chips.style.gap = "8px";
    k.hud.leiste().append(this.chips);
    this.chipsZeigen();
    this.zeit = 0;
    this.laeuft = true;
    k.hud.meldung("🔒 Alles verriegelt! Finde die 4 Ziffern.", 2600);
    setTimeout(() => this.laeuft && this.zettelZeigen(), 2700);
    this.anzeige();
  }

  /** Je Karte ein anderer Raum (wenn möglich), Platz auf Möbeln oder dem Boden – per Strahl gegen das Haus */
  private orte(schwer: boolean): { p: THREE.Vector3; raum: string; hinweis: string }[] {
    const w = this.k.welt, d = w.daten;
    const gz = (g: string) => (g === "OG" ? d.geschosse.OG : d.geschosse.EG);
    const runter = new THREE.Vector3(0, -1, 0), hoch = new THREE.Vector3(0, 1, 0);
    const ray = new THREE.Raycaster();
    const art = (o: THREE.Object3D | null): string => {
      for (; o; o = o.parent) {
        if (o.userData?.moebelId) return "moebel";
        if (o.userData?.art) return String(o.userData.art);
      }
      return "";
    };
    const treffer = (x: number, y: number, vonZ: number, bisZ: number, erlaubt: string[]): THREE.Vector3 | null => {
      ray.set(new THREE.Vector3(x, vonZ, y), runter);
      ray.far = vonZ - bisZ;
      const t = ray.intersectObject(w.haus, true)[0];
      if (!t?.face || !erlaubt.includes(art(t.object))) return null;
      if (t.face.normal.clone().transformDirection(t.object.matrixWorld).y < 0.7) return null;
      const darueber = w.strahl(t.point.clone().add(new THREE.Vector3(0, 0.02, 0)), hoch, 9);
      if (!darueber || darueber.abstand < 0.4) return null;
      return t.point.clone();
    };
    const start = this.k.figur.start;
    const startRaum = d.raeume.find((r) => Math.abs(gz(r.geschoss) - start.y) < 1.2 && punktInPoly(start.x, start.z, r.polygon));
    const kandidaten: { p: THREE.Vector3; raum: string; hinweis: string }[][] = [];
    for (const raum of mischen(d.raeume)) {
      const z0 = gz(raum.geschoss);
      const plaetze: THREE.Vector3[] = [];
      // Möbel im Raum (Oberseiten bis 1,5 m)
      for (const m of d.moebel) {
        const [mx, my] = m.pos;
        if (m.geschoss !== raum.geschoss || !punktInPoly(mx, my, raum.polygon)) continue;
        if (/teppich|bild|spiegel|leuchte|wandspot|pflanze/.test(String(m.typ))) continue;
        for (let i = 0; i < 2; i++) {
          const r = ((m.rot_grad ?? 0) * Math.PI) / 180, [b, t] = m.masse_bth;
          const u = (Math.random() - 0.5) * b * 0.5, v = (Math.random() - 0.5) * t * 0.4;
          const p = treffer(mx + u * Math.cos(r) - v * Math.sin(r), my + u * Math.sin(r) + v * Math.cos(r), z0 + 1.9, z0 + 0.15, ["moebel"]);
          if (p && p.y - z0 > 0.2 && p.y - z0 < 1.5) plaetze.push(p);
        }
      }
      // freier Boden
      const xs = raum.polygon.map((p) => p[0]), ys = raum.polygon.map((p) => p[1]);
      for (let i = 0; i < 8; i++) {
        const x = Math.min(...xs) + Math.random() * (Math.max(...xs) - Math.min(...xs));
        const y = Math.min(...ys) + Math.random() * (Math.max(...ys) - Math.min(...ys));
        if (!punktInPoly(x, y, raum.polygon)) continue;
        const p = treffer(x, y, z0 + 1.0, z0 - 0.3, ["boden"]);
        if (p && Math.abs(p.y - z0) < 0.1) plaetze.push(p);
      }
      const gut = plaetze.filter((p) => p.distanceTo(start) > 2.2);
      if (!gut.length) continue;
      const h = HINWEISE.find(([re]) => re.test(raum.id) || re.test(raum.name));
      const hinweis = h ? (schwer ? h[2] : h[1]) : schwer ? `irgendwo im ${raum.geschoss === "OG" ? "Obergeschoss" : "Erdgeschoss"}` : `im Raum „${raum.name}“`;
      const eintraege = mischen(gut).map((p) => ({ p, raum: raum.id, hinweis }));
      // Startraum nur als Notlösung
      if (startRaum && raum.id === startRaum.id) kandidaten.push(eintraege);
      else kandidaten.unshift(eintraege);
    }
    const wahl: { p: THREE.Vector3; raum: string; hinweis: string }[] = [];
    for (let runde = 0; wahl.length < 4 && runde < 4; runde++)
      for (const liste of kandidaten) {
        if (wahl.length >= 4) break;
        const p = liste.find((x) => !wahl.some((w2) => w2.p.distanceTo(x.p) < 1.5));
        if (p && (runde > 0 || !wahl.some((w2) => w2.raum === p.raum))) wahl.push(p);
      }
    return wahl;
  }

  private zettelZeigen() {
    const zeilen = this.karten.map((c) => `${c.farbe.emoji} ${c.gefunden ? `= ${c.ziffer} ✔` : c.hinweis}`);
    this.k.hud.meldung(`📜 ${zeilen.join("\n")}`, 6500);
    const m = document.getElementById("meldung");
    if (m) { m.style.whiteSpace = "pre-line"; m.style.fontSize = "20px"; }
  }

  private chipsZeigen() {
    this.chips.replaceChildren(...this.reihenfolge.map((f) => {
      const c = this.karten.find((x) => x.farbe === f);
      const el = document.createElement("div");
      el.className = "feld";
      el.style.borderBottom = `4px solid ${f.hex}`;
      el.textContent = `${f.emoji} ${c?.gefunden ? c.ziffer : "?"}`;
      return el;
    }));
  }

  private anzeige() {
    const gef = this.karten.filter((c) => c.gefunden).length;
    const s = Math.floor(this.zeit), m = Math.floor(s / 60);
    this.k.hud.anzeige(`🔐 ${gef} / ${this.karten.length} Ziffern   ⏱ ${m}:${String(s % 60).padStart(2, "0")}`);
  }

  private einsammeln(c: Karte) {
    if (c.gefunden) return;
    c.gefunden = true;
    this.k.welt.szene.remove(c.gruppe);
    navigator.vibrate?.(40);
    const rest = this.karten.filter((x) => !x.gefunden).length;
    this.k.hud.meldung(`${c.farbe.emoji} Ziffer ${c.ziffer}! ${rest ? `Noch ${rest}` : "Jetzt zum Tastenfeld an der Tür!"}`, 2000);
    this.chipsZeigen();
  }

  private amTastenfeld(): boolean {
    const f = this.k.figur.fuss(), p = this.tastenfeld.position;
    return Math.hypot(f.x - p.x, f.z - p.z) < 1.6 && Math.abs(f.y - p.y) < 1;
  }

  update(dt: number) {
    if (this.laeuft && !this.offen) this.zeit += dt;
    const f = this.k.figur.fuss();
    for (const c of this.karten) {
      if (c.gefunden) continue;
      c.phase += dt;
      c.gruppe.rotation.y += dt * 1.2;
      c.gruppe.children[0].position.y = 0.16 + Math.sin(c.phase * 2) * 0.03;
      if (c.glanz) c.glanz.material.opacity = 0.5 + Math.sin(c.phase * 3) * 0.3;
      const p = c.gruppe.position;
      if (this.laeuft && Math.hypot(p.x - f.x, p.z - f.z) < 0.55 && p.y - f.y > -0.4 && p.y - f.y < 1.9) this.einsammeln(c);
    }
    if (this.laeuft && !this.offen && this.amTastenfeld()) {
      this.hinweisZeit -= dt;
      if (this.hinweisZeit <= 0) {
        this.k.hud.meldung(this.k.eingabe.touch ? "Tastenfeld antippen" : "E oder Klick: Tastenfeld", 1500);
        this.hinweisZeit = 4;
      }
    } else this.hinweisZeit = 0;
    if (this.laeuft) this.anzeige();
  }

  tipp(x: number, y: number): boolean {
    if (!this.laeuft || this.offen) return false;
    // Karte angetippt (aus der Nähe)?
    this.ray.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), this.k.welt.kamera);
    const offene = this.karten.filter((c) => !c.gefunden);
    const hits = this.ray.intersectObjects([...offene.map((c) => c.gruppe), this.tastenfeld], true);
    let o: THREE.Object3D | null = hits[0]?.object ?? null;
    while (o && !o.userData.karte && !o.userData.tastenfeld) o = o.parent;
    if (o?.userData.karte) {
      const c = offene.find((q) => q.gruppe === o)!;
      if (c.gruppe.position.distanceTo(this.k.figur.kopf()) < 3.5) { this.einsammeln(c); return true; }
      this.k.hud.meldung("Zu weit weg – geh näher ran!", 1200);
      return true;
    }
    if (this.amTastenfeld()) { this.feldOeffnen(); return true; }
    if (o?.userData.tastenfeld) { this.k.hud.meldung("Geh näher ans Tastenfeld!", 1200); return true; }
    return false;
  }

  private feldOeffnen() {
    this.offen = true;
    this.k.figur.gesperrt = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.eingabeText = "";
    const kasten = document.createElement("div");
    kasten.className = "karte";
    kasten.style.padding = "14px";
    kasten.style.gap = "8px";
    const schild = document.createElement("div");
    schild.style.textAlign = "center";
    schild.style.fontWeight = "800";
    schild.textContent = `Reihenfolge: ${this.reihenfolge.map((f) => f.emoji).join(" ")}`;
    const anzeige = document.createElement("div");
    anzeige.style.cssText = "text-align:center;font-size:32px;font-weight:900;letter-spacing:10px;font-variant-numeric:tabular-nums;background:#14181c;color:#7bdc6a;border-radius:10px;padding:6px";
    const zeigen = () => (anzeige.textContent = (this.eingabeText + "____").slice(0, 4));
    zeigen();
    const raster = document.createElement("div");
    raster.className = "tastenfeld";
    const druck = (t: string) => {
      if (t === "⌫") this.eingabeText = this.eingabeText.slice(0, -1);
      else if (t === "✓") { this.pruefen(); return; }
      else if (this.eingabeText.length < 4) this.eingabeText += t;
      zeigen();
      if (this.eingabeText.length === 4) setTimeout(() => this.offen && this.eingabeText.length === 4 && this.pruefen(), 250);
    };
    for (const t of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"]) {
      const b = document.createElement("button");
      b.textContent = t;
      b.addEventListener("click", (e) => { e.stopPropagation(); druck(t); });
      raster.append(b);
    }
    const zu = document.createElement("button");
    zu.className = "zweit";
    zu.textContent = "Schließen";
    zu.addEventListener("click", () => this.feldSchliessen());
    kasten.append(schild, anzeige, raster, zu);
    this.feld = kasten;
    this.k.hud.leiste().append(kasten);
    const taste = (e: KeyboardEvent) => {
      if (/^Digit\d$|^Numpad\d$/.test(e.code)) druck(e.code.slice(-1));
      else if (e.code === "Backspace") druck("⌫");
      else if (e.code === "Enter" || e.code === "NumpadEnter") druck("✓");
      else if (e.code === "Escape") this.feldSchliessen();
    };
    window.addEventListener("keydown", taste);
    this.tasteAus = () => window.removeEventListener("keydown", taste);
  }

  private feldSchliessen() {
    this.feld?.remove();
    this.feld = null;
    this.tasteAus?.();
    this.tasteAus = null;
    this.offen = false;
    this.k.figur.gesperrt = false;
  }

  private pruefen() {
    const code = this.reihenfolge.map((f) => this.karten.find((c) => c.farbe === f)?.ziffer ?? -1).join("");
    if (this.eingabeText === code) {
      this.feldSchliessen();
      this.laeuft = false;
      this.k.figur.gesperrt = true;
      this.k.hud.meldung("🔓 Die Tür ist auf! Geschafft!", 2500);
      this.k.fertig({ zeit_ms: Math.round(this.zeit * 1000), punkte: 4, text: "Du bist entkommen!" });
      return;
    }
    this.zeit += 10;
    this.eingabeText = "";
    this.feldSchliessen();
    this.k.hud.meldung("❌ Falsch! +10 Sekunden", 1800);
    navigator.vibrate?.([60, 40, 60]);
  }

  pause(an: boolean) {
    if (an && this.offen) this.feldSchliessen();
    this.laeuft = !an;
  }

  ende() {
    const k = this.k;
    k.welt.tuerenGesperrt = false;
    this.feldSchliessen();
    for (const c of this.karten) k.welt.szene.remove(c.gruppe);
    this.karten = [];
    k.welt.szene.remove(this.tastenfeld);
    for (const s of this.sperren) k.welt.physik.removeCollider(s, false);
    this.sperren = [];
    const m = document.getElementById("meldung");
    if (m) { m.style.whiteSpace = ""; m.style.fontSize = ""; }
  }
}
