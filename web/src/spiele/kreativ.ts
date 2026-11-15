// Kreativ: Klötzchen bauen wie in Minecraft – 0,5-m-Raster, Farben, Bauen/Abbauen, Speichern je Spieler
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Kontext, Spiel } from "./typen";
import { api } from "../api";

const RASTER = 0.5;
const MAX = 4000;
const REICHWEITE = 9;

export const KREATIV_FARBEN: { name: string; farbe: number; glas?: boolean }[] = [
  { name: "Holz", farbe: 0xa8784a },
  { name: "Stein", farbe: 0x8f9296 },
  { name: "Gras", farbe: 0x5f9a3c },
  { name: "Glas", farbe: 0x8fd3ff, glas: true },
  { name: "Rot", farbe: 0xd8413a },
  { name: "Gelb", farbe: 0xf2c230 },
  { name: "Weiß", farbe: 0xf4f1ea },
  { name: "Schwarz", farbe: 0x26282b },
  { name: "Blau", farbe: 0x2f6fd6 },
  { name: "Lila", farbe: 0x8a4fd6 },
];

interface Block { x: number; y: number; z: number; farbe: number; collider: RAPIER.Collider; index: number }

const schluessel = (x: number, y: number, z: number) => `${x},${y},${z}`;
const mitte = (n: number) => n * RASTER + RASTER / 2;

/** Klötzchen-Textur: helle Kante, leichtes Rauschen */
function klotzTextur(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 300; i++) {
    const g = 215 + Math.random() * 40;
    x.fillStyle = `rgb(${g},${g},${g})`;
    x.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
  }
  x.strokeStyle = "rgba(0,0,0,0.35)";
  x.lineWidth = 4;
  x.strokeRect(2, 2, 60, 60);
  x.strokeStyle = "rgba(255,255,255,0.5)";
  x.lineWidth = 2;
  x.strokeRect(6, 6, 52, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export class KreativSpiel implements Spiel {
  private k!: Kontext;
  private bloecke = new Map<string, Block>();
  private netze: THREE.InstancedMesh[] = [];
  /** je Farbe: Liste der Schlüssel in Instanz-Reihenfolge */
  private belegung: string[][] = [];
  private geist!: THREE.Mesh;
  private farbe = 0;
  private bauen = true;
  private modusKnopf!: HTMLElement;
  private farbKnoepfe: HTMLElement[] = [];
  private speichernTimer = 0;
  private geaendert = false;
  private geladen = false;
  private ray = new THREE.Raycaster();
  private gruppe = new THREE.Group();
  private tasteVorher = new Set<string>();

  start(k: Kontext) {
    this.k = k;
    k.welt.tageszeit(false);
    k.welt.szene.add(this.gruppe);
    const geo = new THREE.BoxGeometry(RASTER, RASTER, RASTER);
    const tex = klotzTextur();
    KREATIV_FARBEN.forEach((f, i) => {
      const m = new THREE.MeshStandardMaterial({ color: f.farbe, map: tex, roughness: f.glas ? 0.1 : 0.85,
        transparent: !!f.glas, opacity: f.glas ? 0.45 : 1, depthWrite: !f.glas });
      const n = new THREE.InstancedMesh(geo, m, MAX);
      n.count = 0;
      n.castShadow = !f.glas;
      n.receiveShadow = true;
      n.frustumCulled = false;
      n.userData.kreativ = true;
      this.netze[i] = n;
      this.belegung[i] = [];
      this.gruppe.add(n);
    });
    this.geist = new THREE.Mesh(new THREE.BoxGeometry(RASTER * 1.02, RASTER * 1.02, RASTER * 1.02),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.geist.add(new THREE.LineSegments(new THREE.EdgesGeometry(this.geist.geometry), new THREE.LineBasicMaterial({ color: 0xffffff })));
    this.geist.visible = false;
    this.gruppe.add(this.geist);

    // HUD: Modus, Löschen, Farbpalette
    this.modusKnopf = k.hud.knopf("kreativ-modus", "🧱", () => this.modusWechseln());
    this.modusKnopf.classList.add("an");
    k.hud.knopf("kreativ-weg", "🗑", () => {
      if (this.bloecke.size && confirm("Wirklich alle Blöcke abreißen?")) this.allesWeg();
    });
    const leiste = k.hud.leiste();
    this.farbKnoepfe = KREATIV_FARBEN.map((f, i) => {
      const b = document.createElement("button");
      b.className = "farbknopf" + (i === this.farbe ? " an" : "");
      b.title = `${f.name} (${i + 1 < 10 ? i + 1 : 0})`;
      b.style.background = `#${f.farbe.toString(16).padStart(6, "0")}`;
      if (f.glas) b.style.opacity = "0.7";
      const waehlen = (e: Event) => { e.preventDefault(); e.stopPropagation(); this.farbeWaehlen(i); };
      b.addEventListener("touchstart", waehlen, { passive: false });
      b.addEventListener("mousedown", waehlen);
      leiste.append(b);
      return b;
    });
    this.anzeige();
    k.hud.meldung("Bau los! 🧱 = bauen, ⛏ = abbauen", 2500);
    api.bauwerk(k.spieler.name)
      .then((d: { bloecke: number[][] }) => {
        for (const [x, y, z, f] of d.bloecke ?? []) this.setzen(x, y, z, f, false);
        this.netzeAktualisieren();
        this.anzeige();
      })
      .catch(() => k.hud.meldung("Gespeichertes Bauwerk nicht geladen", 2000))
      .finally(() => (this.geladen = true));
  }

  private anzeige() {
    this.k.hud.anzeige(`🧱 ${this.bloecke.size} Blöcke · ${this.bauen ? "Bauen" : "Abbauen"} · ${KREATIV_FARBEN[this.farbe].name}`);
  }

  private modusWechseln() {
    this.bauen = !this.bauen;
    this.modusKnopf.textContent = this.bauen ? "🧱" : "⛏";
    this.modusKnopf.classList.toggle("an", this.bauen);
    (this.geist.material as THREE.MeshBasicMaterial).color.set(this.bauen ? 0xffffff : 0xff4040);
    this.anzeige();
  }

  private farbeWaehlen(i: number) {
    this.farbe = i;
    this.farbKnoepfe.forEach((b, j) => b.classList.toggle("an", j === i));
    if (!this.bauen) this.modusWechseln();
    this.anzeige();
  }

  /** Block setzen (ohne Netz-Aktualisierung, die macht netzeAktualisieren) */
  private setzen(x: number, y: number, z: number, farbe: number, merken = true): boolean {
    const s = schluessel(x, y, z);
    if (this.bloecke.has(s) || this.bloecke.size >= MAX) return false;
    farbe = Math.max(0, Math.min(KREATIV_FARBEN.length - 1, farbe | 0));
    const collider = this.k.welt.physik.createCollider(RAPIER.ColliderDesc.cuboid(RASTER / 2, RASTER / 2, RASTER / 2).setTranslation(mitte(x), mitte(y), mitte(z)));
    const liste = this.belegung[farbe];
    this.bloecke.set(s, { x, y, z, farbe, collider, index: liste.length });
    liste.push(s);
    if (merken) this.aenderung();
    return true;
  }

  private entfernen(s: string) {
    const b = this.bloecke.get(s);
    if (!b) return;
    this.k.welt.physik.removeCollider(b.collider, false);
    const liste = this.belegung[b.farbe];
    // letzten Eintrag an die frei gewordene Stelle ziehen
    const letzter = liste.pop()!;
    if (letzter !== s) {
      liste[b.index] = letzter;
      this.bloecke.get(letzter)!.index = b.index;
    }
    this.bloecke.delete(s);
    this.aenderung();
  }

  private allesWeg() {
    for (const b of this.bloecke.values()) this.k.welt.physik.removeCollider(b.collider, false);
    this.bloecke.clear();
    this.belegung = this.belegung.map(() => []);
    this.netzeAktualisieren();
    this.aenderung();
    this.anzeige();
  }

  private netzeAktualisieren() {
    const m = new THREE.Matrix4();
    this.netze.forEach((n, i) => {
      const liste = this.belegung[i];
      liste.forEach((s, j) => {
        const b = this.bloecke.get(s)!;
        m.makeTranslation(mitte(b.x), mitte(b.y), mitte(b.z));
        n.setMatrixAt(j, m);
      });
      n.count = liste.length;
      n.instanceMatrix.needsUpdate = true;
    });
    // Strahl-Abfragen brauchen die neuen Collider sofort
    this.k.welt.physik.propagateModifiedBodyPositionsToColliders?.();
  }

  private aenderung() {
    this.geaendert = true;
    clearTimeout(this.speichernTimer);
    this.speichernTimer = window.setTimeout(() => this.speichern(), 2000);
  }

  private speichern() {
    if (!this.geaendert || !this.geladen) return;
    this.geaendert = false;
    const liste = [...this.bloecke.values()].map((b) => [b.x, b.y, b.z, b.farbe]);
    api.bauwerkSpeichern(this.k.spieler.name, liste).catch(() => {
      this.geaendert = true;
      this.k.hud.meldung("Speichern fehlgeschlagen – versuche es gleich nochmal", 2000);
    });
  }

  /** Ziel-Zelle per Strahl von der Kamera durch Bildschirmpunkt (x, y) */
  private ziel(x: number, y: number): { bau: [number, number, number]; weg: string | null } | null {
    const kam = this.k.welt.kamera;
    this.ray.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), kam);
    const r = this.ray.ray;
    const t = this.k.welt.strahl(r.origin.clone(), r.direction.clone(), REICHWEITE, this.k.figur.collider);
    if (!t) return null;
    // nicht zu weit von der Figur weg bauen
    if (t.punkt.distanceTo(this.k.figur.kopf()) > 6.5) return null;
    const n = t.normale;
    const zelle = (p: THREE.Vector3): [number, number, number] => [Math.floor(p.x / RASTER), Math.floor(p.y / RASTER), Math.floor(p.z / RASTER)];
    const bau = zelle(t.punkt.clone().addScaledVector(n, RASTER / 2));
    const innen = zelle(t.punkt.clone().addScaledVector(n, -RASTER / 2));
    const s = schluessel(...innen);
    return { bau, weg: this.bloecke.has(s) ? s : null };
  }

  private kollidiertMitFigur(x: number, y: number, z: number): boolean {
    const f = this.k.figur.fuss();
    const x0 = x * RASTER, x1 = x0 + RASTER, z0 = z * RASTER, z1 = z0 + RASTER, y0 = y * RASTER, y1 = y0 + RASTER;
    const nx = Math.max(x0, Math.min(f.x, x1)), nz = Math.max(z0, Math.min(f.z, z1));
    const horizontal = Math.hypot(nx - f.x, nz - f.z) < 0.3;
    const vertikal = y1 > f.y - 0.02 && y0 < f.y + 1.72;
    return horizontal && vertikal;
  }

  private ausfuehren(x: number, y: number): boolean {
    const z = this.ziel(x, y);
    if (!z) return false;
    if (this.bauen) {
      const [bx, by, bz] = z.bau;
      if (this.kollidiertMitFigur(bx, by, bz)) { this.k.hud.meldung("Da stehst du gerade!", 900); return true; }
      if (this.bloecke.size >= MAX) { this.k.hud.meldung(`Höchstens ${MAX} Blöcke`, 1500); return true; }
      if (this.setzen(bx, by, bz, this.farbe)) navigator.vibrate?.(15);
    } else {
      if (!z.weg) return false;
      this.entfernen(z.weg);
      navigator.vibrate?.(15);
    }
    this.netzeAktualisieren();
    this.anzeige();
    return true;
  }

  update() {
    const e = this.k.eingabe;
    // Tasten: 1–9/0 Farbe, R Modus (nur beim Drücken)
    const jetzt = new Set<string>();
    for (let i = 0; i < KREATIV_FARBEN.length; i++) {
      const code = `Digit${(i + 1) % 10}`;
      if (e.taste(code)) { jetzt.add(code); if (!this.tasteVorher.has(code)) this.farbeWaehlen(i); }
    }
    if (e.taste("KeyR")) { jetzt.add("KeyR"); if (!this.tasteVorher.has("KeyR")) this.modusWechseln(); }
    this.tasteVorher = jetzt;
    // Vorschau an der Bildmitte
    const z = this.ziel(innerWidth / 2, innerHeight / 2);
    if (!z || (!this.bauen && !z.weg)) { this.geist.visible = false; return; }
    this.geist.visible = true;
    if (this.bauen) this.geist.position.set(mitte(z.bau[0]), mitte(z.bau[1]), mitte(z.bau[2]));
    else {
      const b = this.bloecke.get(z.weg!)!;
      this.geist.position.set(mitte(b.x), mitte(b.y), mitte(b.z));
    }
  }

  tipp(x: number, y: number): boolean {
    return this.ausfuehren(x, y);
  }

  ende() {
    clearTimeout(this.speichernTimer);
    this.speichern();
    for (const b of this.bloecke.values()) this.k.welt.physik.removeCollider(b.collider, false);
    this.bloecke.clear();
    for (const n of this.netze) { n.geometry.dispose(); (n.material as THREE.Material).dispose(); }
    this.k.welt.szene.remove(this.gruppe);
    this.k.hud.leiste().replaceChildren();
  }
}
