// Klötzchen-Avatar: Farben, Frisur, Kopfbedeckung, Gesicht; einfache Lauf-Animation
import * as THREE from "three";

export interface AvatarCfg {
  haut: string;
  haare: string;
  frisur: "kurz" | "lang" | "stachel" | "zopf" | "glatze";
  oberteil: string;
  hose: string;
  schuhe: string;
  kopf: "keins" | "kappe" | "muetze" | "krone" | "helm" | "hut";
  kopfFarbe: string;
  gesicht: "lachen" | "cool" | "staunen" | "zwinkern" | "frech";
  augen: string;
}

export const STANDARD_AVATAR: AvatarCfg = {
  haut: "#e8b98f", haare: "#4a3222", frisur: "kurz", oberteil: "#2f6fd6", hose: "#37415a", schuhe: "#f2f2f2",
  kopf: "kappe", kopfFarbe: "#d6452f", gesicht: "lachen", augen: "#2b4a7a",
};

export const AUSWAHL = {
  haut: ["#f6d3b3", "#e8b98f", "#c98f62", "#a06a43", "#6e4429", "#4a2c1a"],
  haare: ["#1d1611", "#4a3222", "#8a5a2b", "#d9b25f", "#e8e0c8", "#c2412b", "#3a6ad6", "#2fa36b", "#d64fa8"],
  kleidung: ["#2f6fd6", "#d6452f", "#2fa36b", "#f2c230", "#8a4fd6", "#f2f2f2", "#222831", "#37415a", "#f28c28", "#4fc3d6", "#6b4b32", "#e86aa0"],
  augen: ["#2b4a7a", "#3f7a3a", "#5a3a22", "#222222", "#7a4fd6"],
  frisur: [["kurz", "Kurz"], ["lang", "Lang"], ["stachel", "Stachelig"], ["zopf", "Zopf"], ["glatze", "Keine"]],
  kopf: [["keins", "Nichts"], ["kappe", "Kappe"], ["muetze", "Mütze"], ["krone", "Krone"], ["helm", "Helm"], ["hut", "Hut"]],
  gesicht: [["lachen", "Lachen"], ["cool", "Cool"], ["staunen", "Staunen"], ["zwinkern", "Zwinkern"], ["frech", "Frech"]],
} as const;

const box = (b: number, h: number, t: number, farbe: string | THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(b, h, t), typeof farbe === "string" ? new THREE.MeshStandardMaterial({ color: farbe, roughness: 0.8 }) : farbe);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

function gesichtTextur(cfg: AvatarCfg): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = cfg.haut;
  g.fillRect(0, 0, 128, 128);
  const auge = (x: number, zu = false) => {
    if (zu) { g.fillStyle = "#222"; g.fillRect(x - 10, 56, 20, 4); return; }
    g.fillStyle = "#fff"; g.fillRect(x - 11, 46, 22, 20);
    g.fillStyle = cfg.augen; g.fillRect(x - 6, 50, 12, 14);
    g.fillStyle = "#111"; g.fillRect(x - 3, 54, 6, 7);
  };
  if (cfg.gesicht === "cool") {
    g.fillStyle = "#111"; g.fillRect(22, 46, 84, 18); g.fillRect(40, 46, 48, 6);
  } else {
    auge(42);
    auge(86, cfg.gesicht === "zwinkern");
  }
  g.fillStyle = "#6b2b2b";
  if (cfg.gesicht === "staunen") g.fillRect(56, 84, 16, 18);
  else if (cfg.gesicht === "frech") { g.fillRect(44, 88, 40, 6); g.fillStyle = "#d65a6b"; g.fillRect(66, 92, 12, 10); }
  else { g.fillRect(44, 86, 40, 6); g.fillRect(40, 80, 6, 8); g.fillRect(82, 80, 6, 8); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Avatar ca. 1,75 m groß, Füße bei y = 0, Blick in −z */
export class Avatar {
  gruppe = new THREE.Group();
  private beinL!: THREE.Object3D;
  private beinR!: THREE.Object3D;
  private armL!: THREE.Object3D;
  private armR!: THREE.Object3D;
  private phase = 0;

  constructor(public cfg: AvatarCfg) {
    this.bauen();
  }

  bauen() {
    const c = this.cfg;
    this.gruppe.clear();
    const gelenk = (x: number, y: number) => { const g = new THREE.Group(); g.position.set(x, y, 0); return g; };
    // Beine (Drehpunkt Hüfte)
    this.beinL = gelenk(-0.12, 0.78);
    this.beinR = gelenk(0.12, 0.78);
    for (const b of [this.beinL, this.beinR]) {
      b.add(box(0.22, 0.66, 0.24, c.hose, 0, -0.33, 0));
      b.add(box(0.23, 0.12, 0.28, c.schuhe, 0, -0.72, -0.02));
      this.gruppe.add(b);
    }
    // Körper
    this.gruppe.add(box(0.5, 0.6, 0.28, c.oberteil, 0, 1.08, 0));
    // Arme (Drehpunkt Schulter)
    this.armL = gelenk(-0.34, 1.34);
    this.armR = gelenk(0.34, 1.34);
    for (const a of [this.armL, this.armR]) {
      a.add(box(0.17, 0.42, 0.2, c.oberteil, 0, -0.18, 0));
      a.add(box(0.16, 0.2, 0.19, c.haut, 0, -0.48, 0));
      this.gruppe.add(a);
    }
    // Kopf: Gesicht vorne (−z)
    const haut = new THREE.MeshStandardMaterial({ color: c.haut, roughness: 0.75 });
    const gesicht = new THREE.MeshStandardMaterial({ map: gesichtTextur(c), roughness: 0.75 });
    const kopf = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), [haut, haut, haut, haut, haut, gesicht]);
    kopf.position.y = 1.58; // Materialreihenfolge Box: +x, −x, +y, −y, +z, −z → Gesicht zeigt nach −z (vorne)
    kopf.castShadow = true;
    this.gruppe.add(kopf);
    const haare = c.haare;
    if (c.frisur !== "glatze") {
      this.gruppe.add(box(0.42, 0.09, 0.42, haare, 0, 1.8, 0));
      this.gruppe.add(box(0.42, 0.26, 0.06, haare, 0, 1.66, 0.19));
      if (c.frisur === "lang") { this.gruppe.add(box(0.42, 0.42, 0.08, haare, 0, 1.52, 0.2)); for (const s of [-1, 1]) this.gruppe.add(box(0.05, 0.3, 0.3, haare, s * 0.21, 1.6, 0.04)); }
      if (c.frisur === "stachel") for (let i = 0; i < 5; i++) this.gruppe.add(box(0.07, 0.12, 0.07, haare, -0.16 + i * 0.08, 1.88, (i % 2) * 0.08 - 0.02));
      if (c.frisur === "zopf") this.gruppe.add(box(0.1, 0.34, 0.1, haare, 0, 1.5, 0.26));
    }
    const kf = c.kopfFarbe;
    if (c.kopf === "kappe") { this.gruppe.add(box(0.44, 0.1, 0.44, kf, 0, 1.84, 0)); this.gruppe.add(box(0.36, 0.03, 0.2, kf, 0, 1.8, -0.3)); }
    if (c.kopf === "muetze") { this.gruppe.add(box(0.44, 0.16, 0.44, kf, 0, 1.86, 0)); this.gruppe.add(box(0.12, 0.12, 0.12, "#f2f2f2", 0, 2.0, 0)); }
    if (c.kopf === "helm") { this.gruppe.add(box(0.46, 0.2, 0.46, kf, 0, 1.82, 0.01)); this.gruppe.add(box(0.46, 0.06, 0.04, "#9fd3ff", 0, 1.66, -0.23)); }
    if (c.kopf === "hut") { this.gruppe.add(box(0.6, 0.03, 0.6, kf, 0, 1.79, 0)); this.gruppe.add(box(0.36, 0.2, 0.36, kf, 0, 1.9, 0)); }
    if (c.kopf === "krone") {
      const gold = new THREE.MeshStandardMaterial({ color: "#f2c230", metalness: 0.8, roughness: 0.3 });
      this.gruppe.add(box(0.44, 0.08, 0.44, gold, 0, 1.83, 0));
      for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18], [0, -0.2]]) this.gruppe.add(box(0.07, 0.1, 0.07, gold, x, 1.92, z));
    }
  }

  setzen(cfg: AvatarCfg) {
    this.cfg = cfg;
    this.bauen();
  }

  /** tempo 0..1 (Laufen), inLuft: Sprungpose */
  animieren(dt: number, tempo: number, inLuft: boolean) {
    this.phase += dt * (6 + tempo * 6) * (tempo > 0.05 ? 1 : 0);
    const w = inLuft ? 0.5 : Math.sin(this.phase) * 0.7 * Math.min(1, tempo);
    const ziel = (o: THREE.Object3D, a: number) => (o.rotation.x += (a - o.rotation.x) * Math.min(1, dt * 14));
    ziel(this.beinL, inLuft ? -0.5 : w);
    ziel(this.beinR, inLuft ? 0.3 : -w);
    ziel(this.armL, inLuft ? -2.6 : -w);
    ziel(this.armR, inLuft ? -2.6 : w);
  }
}
