// Feuerwache – Nächte im Odenwald: tagsüber draußen Bäume fällen und Holz im Rucksack heimtragen, im HWR den
// Ofen füttern. Nachts schleichen Nachtschatten ums Haus – sie fürchten Licht: Solange das Feuer brennt, kommen sie
// nicht ins Haus, und mit der Taschenlampe kann man sie verscheuchen. Gewertet wird die Zahl überstandener Nächte.
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Kontext, Spiel, SpielInfo } from "./typen";

export const FEUERWACHE_INFO: SpielInfo = {
  id: "feuerwache", titel: "Feuerwache – Nächte im Odenwald", emoji: "🔥", kurz: "Holz hacken, Ofen heizen, die Nacht überstehen",
  text: "Tagsüber fällst du draußen mit der Axt Bäume und trägst das Holz im Rucksack nach Hause in den Ofen im HWR. "
    + "Nachts schleichen Nachtschatten ums Haus. Sie haben Angst vor Licht: Solange das Feuer brennt, trauen sie sich nicht hinein, "
    + "und mit der Taschenlampe kannst du sie verscheuchen. Geht das Feuer aus, wird es gefährlich! Wie viele Nächte schaffst du?",
  bereit: true,
  wertung: "punkte",
  einheit: "Nächte",
  optionen: [
    { id: "tempo", titel: "Tageslänge", werte: [["kurz", "Kurz (1 Min. Tag)"], ["normal", "Normal (1,5 Min. Tag)"]], standard: "normal" },
    { id: "naechte", titel: "Ziel", werte: [["10", "10 Nächte"], ["99", "99 Nächte"]], standard: "10" },
  ],
};

const RUCKSACK = 5;
const HAUS = { x0: -0.45, x1: 8.25, z0: -0.45, z1: 11.6 }; // Außenmaße des Hauses (Modell x/y) mit etwas Rand

interface Baum { gruppe: THREE.Group; stamm: THREE.Mesh; collider: RAPIER.Collider | null; r: number; schlaege: number; noetig: number;
  wackeln: number; faellt: number; richtung: number; weg: boolean }
interface Scheit { mesh: THREE.Mesh }
interface Span { mesh: THREE.Mesh; v: THREE.Vector3; t: number }
interface Schatten { gruppe: THREE.Group; mats: THREE.Material[]; zustand: "jagen" | "fliehen" | "weg"; licht: number; t: number;
  wartet: number; deckkraft: number; phase: number }

// Bereiche für Bäume (Modell x/y): Garten Süd, Westseite, Ostseite, Wiese Nord
const ZONEN: [number, number, number, number][] = [
  [0, 14, 16.6, 20.4], [-5.6, -1.4, -3, 19.5], [9.4, 14.6, 5.5, 18.5], [0, 7.5, -4.5, -2.2],
];

function zufall(a: number, b: number) { return a + Math.random() * (b - a); }

export class FeuerwacheSpiel implements Spiel {
  private k!: Kontext;
  private wurzel = new THREE.Group();
  private baeume: Baum[] = [];
  private scheite: Scheit[] = [];
  private spaene: Span[] = [];
  private schatten: Schatten[] = [];
  private eigene = new Set<number>();
  private ray = new THREE.Raycaster();
  // Ofen
  private ofen = new THREE.Group();
  private ofenPos = new THREE.Vector3();
  private feuerLicht = new THREE.PointLight(0xff8a3a, 0, 16, 1.6);
  private flammen: THREE.Mesh[] = [];
  private glut!: THREE.MeshStandardMaterial;
  private brennstoff = 60;
  // Ablauf
  private nacht = false;
  private phasenZeit = 0;
  private tagLaenge = 90;
  private nachtLaenge = 60;
  private tag = 1;
  private ueberstanden = 0;
  private ziel = 10;
  private herzen = 3;
  private rucksack = 0;
  private gesamt = 0;
  private laeuft = false;
  private hackPause = 0;
  private kratzPause = 0;
  private gewarnt = false;
  private warAus = false;
  private leisteRuck!: HTMLElement;
  private leisteFeuer!: HTMLElement;
  private blitz!: HTMLElement;
  private holzMat = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.9 });
  private schnittMat = new THREE.MeshStandardMaterial({ color: 0xd9b07a, roughness: 0.8 });
  private laubMats = [0x3f6b2a, 0x4f7a2c, 0x2f5a2a, 0x5d7f33].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
  private spanMat = new THREE.MeshStandardMaterial({ color: 0xe0bd86, roughness: 0.8 });

  start(k: Kontext) {
    this.k = k;
    const kurz = k.optionen.tempo === "kurz";
    this.tagLaenge = kurz ? 60 : 90;
    this.nachtLaenge = kurz ? 45 : 60;
    this.ziel = Number(k.optionen.naechte) || 10;
    k.welt.szene.add(this.wurzel);
    k.welt.tageszeit(false);
    this.ofenBauen();
    this.baeumeAuffuellen(20);
    // HUD
    const leiste = k.hud.leiste();
    this.leisteRuck = document.createElement("div");
    this.leisteRuck.className = "feld";
    this.leisteFeuer = document.createElement("div");
    this.leisteFeuer.className = "feld";
    leiste.append(this.leisteRuck, this.leisteFeuer);
    k.hud.knopf("axt", "🪓", () => this.hacken());
    this.blitz = document.createElement("div");
    Object.assign(this.blitz.style, { position: "fixed", inset: "0", background: "radial-gradient(circle, transparent 40%, rgba(200,0,0,0.55))",
      pointerEvents: "none", opacity: "0", transition: "opacity .35s", zIndex: "5" });
    document.body.append(this.blitz);
    this.laeuft = true;
    k.hud.meldung("☀️ Tag 1 – hack Holz für den Ofen im HWR!", 3500);
    this.anzeige();
  }

  // --- Hilfen ------------------------------------------------------------------------------
  /** Bodenhöhe per Strahl nach unten (ohne eigene Bäume und ohne die Spielfigur) */
  private boden(x: number, z: number, vonY = 30, max = 60): number | null {
    const r = new RAPIER.Ray({ x, y: vonY, z }, { x: 0, y: -1, z: 0 });
    const fig = this.k.figur.collider;
    const t = this.k.welt.physik.castRay(r, max, true, undefined, undefined, undefined, undefined,
      (c) => !this.eigene.has(c.handle) && c.handle !== fig.handle);
    return t ? vonY - t.timeOfImpact : null;
  }

  private imHaus(x: number, z: number, rand = 0) {
    return x > HAUS.x0 - rand && x < HAUS.x1 + rand && z > HAUS.z0 - rand && z < HAUS.z1 + rand;
  }

  private feuerAn() { return this.brennstoff > 0; }

  // --- Ofen im HWR --------------------------------------------------------------------------
  private ofenBauen() {
    const d = this.k.welt.daten;
    const raum = d.raeume.find((r) => r.id === "hwr") ?? d.raeume.find((r) => r.geschoss === "EG");
    let cx = 3.9, cz = 5.5, gz = d.geschosse.EG;
    if (raum) {
      cx = raum.polygon.reduce((s, p) => s + p[0], 0) / raum.polygon.length;
      cz = raum.polygon.reduce((s, p) => s + p[1], 0) / raum.polygon.length;
      gz = raum.geschoss === "OG" ? d.geschosse.OG : d.geschosse.EG;
    }
    const fy = this.boden(cx, cz, gz + 1.2, 2) ?? gz;
    // nächste Wand suchen
    let best: { p: THREE.Vector3; dir: THREE.Vector3; a: number } | null = null;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const t = this.k.welt.strahl(new THREE.Vector3(cx, fy + 1.0, cz), dir, 4, this.k.figur.collider);
      if (t && (!best || t.abstand < best.a)) best = { p: t.punkt, dir, a: t.abstand };
    }
    const dir = best?.dir ?? new THREE.Vector3(1, 0, 0);
    const pos = best ? best.p.clone().addScaledVector(dir, -0.4) : new THREE.Vector3(cx, fy, cz);
    pos.y = fy;
    this.ofenPos.copy(pos);
    const g = this.ofen;
    const metall = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.5, metalness: 0.6 });
    const korpus = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.45), metall);
    korpus.position.y = 0.425;
    const fuss = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.5), metall);
    fuss.position.y = 0.03;
    const rohr = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.4, 16), metall);
    rohr.position.set(0, 1.55, 0.05);
    this.glut = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff6a1a, emissiveIntensity: 1.5 });
    const fenster = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.32), this.glut);
    fenster.position.set(0, 0.45, -0.226);
    fenster.rotation.y = Math.PI;
    g.add(korpus, fuss, rohr, fenster);
    const flammeMat = new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 8), flammeMat);
      f.position.set(-0.1 + i * 0.1, 0.38, -0.235);
      this.flammen.push(f);
      g.add(f);
    }
    // Vorderseite (−z lokal) zeigt in den Raum
    g.position.copy(pos);
    g.rotation.y = Math.atan2(dir.x, dir.z);
    g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    this.feuerLicht.position.set(pos.x - dir.x * 0.5, pos.y + 0.8, pos.z - dir.z * 0.5);
    this.wurzel.add(g, this.feuerLicht);
    const c = this.k.welt.physik.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.45, 0.25).setTranslation(pos.x, pos.y + 0.45, pos.z)
      .setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, g.rotation.y, 0))));
    this.eigene.add(c.handle);
    this.ofenCollider = c;
  }
  private ofenCollider: RAPIER.Collider | null = null;

  // --- Bäume -------------------------------------------------------------------------------
  private baeumeAuffuellen(soll: number) {
    let versuche = 0;
    while (this.baeume.filter((b) => !b.weg).length < soll && versuche++ < 400) {
      const [x0, x1, y0, y1] = ZONEN[Math.floor(Math.random() * ZONEN.length)];
      const x = zufall(x0, x1), z = zufall(y0, y1);
      if (this.imHaus(x, z, 1.2)) continue;
      if (Math.hypot(x - 3.9, z - 16.4) < 1.8) continue; // Gartentreppe
      if (Math.hypot(x - 14.1, z - 20) < 1.8) continue; // Schuppen
      if (this.baeume.some((b) => !b.weg && Math.hypot(b.gruppe.position.x - x, b.gruppe.position.z - z) < 2.0)) continue;
      const f = this.k.figur.fuss();
      if (Math.hypot(f.x - x, f.z - z) < 2) continue;
      const y = this.boden(x, z);
      if (y === null || y < -8) continue;
      this.baumSetzen(x, y, z);
    }
  }

  private baumSetzen(x: number, y: number, z: number) {
    const h = zufall(2.2, 3.8), r = zufall(0.13, 0.22);
    const g = new THREE.Group();
    const stamm = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, h * 0.6, 10), this.holzMat);
    stamm.position.y = h * 0.3;
    g.add(stamm);
    const laub = this.laubMats[Math.floor(Math.random() * this.laubMats.length)];
    if (Math.random() < 0.5) {
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(h * 0.3 * (1 - i * 0.22), h * 0.38, 10), laub);
        c.position.y = h * (0.45 + i * 0.17);
        g.add(c);
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(h * zufall(0.17, 0.24), 1), laub);
        c.position.set(zufall(-0.3, 0.3), h * zufall(0.62, 0.85), zufall(-0.3, 0.3));
        g.add(c);
      }
    }
    g.position.set(x, y - 0.05, z);
    g.rotation.y = Math.random() * 6;
    g.traverse((o) => { (o as THREE.Mesh).castShadow = true; (o as THREE.Mesh).receiveShadow = true; });
    this.wurzel.add(g);
    const col = this.k.welt.physik.createCollider(RAPIER.ColliderDesc.cylinder(h * 0.3, r).setTranslation(x, y + h * 0.3, z));
    this.eigene.add(col.handle);
    this.baeume.push({ gruppe: g, stamm, collider: col, r, schlaege: 0, noetig: Math.round(3 + (r - 0.13) * 20), wackeln: 0, faellt: -1,
      richtung: 0, weg: false });
  }

  private hacken() {
    if (!this.laeuft || this.hackPause > 0) return false;
    const f = this.k.figur.fuss();
    let best: Baum | null = null, bd = 1e9;
    for (const b of this.baeume) {
      if (b.weg || b.faellt >= 0) continue;
      const d = Math.hypot(b.gruppe.position.x - f.x, b.gruppe.position.z - f.z) - b.r;
      if (d < bd) { bd = d; best = b; }
    }
    if (!best || bd > 1.3) { this.k.hud.meldung("Geh näher an einen Baum 🌲", 1000); this.hackPause = 0.3; return false; }
    this.hackPause = 0.35;
    best.schlaege++;
    best.wackeln = 0.35;
    navigator.vibrate?.(25);
    const p = best.gruppe.position;
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), this.spanMat);
      m.position.set(p.x + zufall(-0.15, 0.15), p.y + 0.9, p.z + zufall(-0.15, 0.15));
      this.wurzel.add(m);
      this.spaene.push({ mesh: m, v: new THREE.Vector3(zufall(-1.5, 1.5), zufall(1.5, 3), zufall(-1.5, 1.5)), t: 0.7 });
    }
    if (best.schlaege >= best.noetig) {
      best.faellt = 0;
      best.richtung = Math.atan2(p.x - f.x, p.z - f.z);
      if (best.collider) { this.eigene.delete(best.collider.handle); this.k.welt.physik.removeCollider(best.collider, false); best.collider = null; }
      this.k.hud.meldung("Baum fällt! 🌲", 900);
    }
    return true;
  }

  private scheiteAblegen(b: Baum) {
    const p = b.gruppe.position;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const g = new THREE.CylinderGeometry(0.09, 0.09, 0.55, 10);
      const m = new THREE.Mesh(g, [this.holzMat, this.schnittMat, this.schnittMat]);
      const d = 0.6 + i * 0.5;
      const x = p.x + Math.sin(b.richtung) * d + zufall(-0.2, 0.2), z = p.z + Math.cos(b.richtung) * d + zufall(-0.2, 0.2);
      const y = this.boden(x, z) ?? p.y;
      m.position.set(x, y + 0.09, z);
      m.rotation.set(0, zufall(0, Math.PI), Math.PI / 2);
      m.castShadow = true;
      m.userData.scheit = true;
      this.wurzel.add(m);
      this.scheite.push({ mesh: m });
    }
  }

  private aufheben(s: Scheit) {
    if (this.rucksack >= RUCKSACK) return false;
    this.rucksack++;
    this.wurzel.remove(s.mesh);
    this.scheite = this.scheite.filter((x) => x !== s);
    if (this.rucksack === RUCKSACK) this.k.hud.meldung("🎒 Rucksack voll – ab zum Ofen!", 1500);
    return true;
  }

  // --- Nachtschatten -------------------------------------------------------------------------
  private schattenErzeugen() {
    const g = new THREE.Group();
    const mats: THREE.Material[] = [];
    const rauch = new THREE.MeshBasicMaterial({ color: 0x07070d, transparent: true, opacity: 0.88, depthWrite: false });
    mats.push(rauch);
    const teile: [number, number, number, number, number, number][] = [
      [0, 0.55, 0, 0.42, 0.55, 0.36], [0, 1.15, 0.05, 0.3, 0.32, 0.3], [0, 1.45, 0.1, 0.22, 0.24, 0.22], [0.2, 0.9, 0, 0.12, 0.35, 0.12], [-0.2, 0.9, 0, 0.12, 0.35, 0.12],
    ];
    for (const [x, y, z, sx, sy, sz] of teile) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), rauch);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      g.add(m);
    }
    const augeMat = new THREE.MeshBasicMaterial({ color: 0xf6ff7a, transparent: true });
    mats.push(augeMat);
    for (const x of [-0.08, 0.08]) {
      const a = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), augeMat);
      a.position.set(x, 1.5, -0.12);
      g.add(a);
    }
    // Rauchfetzen
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(zufall(0.08, 0.16), 8, 6), rauch);
      m.position.set(zufall(-0.35, 0.35), zufall(0.1, 1.2), zufall(0.1, 0.5));
      m.userData.fetzen = true;
      g.add(m);
    }
    const s: Schatten = { gruppe: g, mats, zustand: "jagen", licht: 0, t: 0, wartet: 0, deckkraft: 0, phase: Math.random() * 6 };
    this.schattenPlatzieren(s);
    this.wurzel.add(g);
    this.schatten.push(s);
  }

  private schattenPlatzieren(s: Schatten) {
    // am Rand des Grundstücks, möglichst weit weg vom Spieler
    const f = this.k.figur.fuss();
    let best: THREE.Vector3 | null = null, bd = -1;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const x = 4 + Math.cos(a) * 13, z = 8 + Math.sin(a) * 13;
      const y = this.boden(x, z);
      if (y === null) continue;
      const d = Math.hypot(x - f.x, z - f.z);
      if (d > bd) { bd = d; best = new THREE.Vector3(x, y, z); }
    }
    s.gruppe.position.copy(best ?? new THREE.Vector3(4, 0, 22));
    s.zustand = "jagen";
    s.licht = 0;
    s.wartet = 0;
    s.deckkraft = 0;
  }

  private schattenUpdate(s: Schatten, dt: number) {
    const f = this.k.figur.fuss();
    const p = s.gruppe.position;
    s.phase += dt;
    if (s.zustand === "weg") {
      s.wartet -= dt;
      s.deckkraft = Math.max(0, s.deckkraft - dt * 1.5);
      if (s.wartet <= 0 && this.nacht) this.schattenPlatzieren(s);
    } else {
      s.deckkraft = Math.min(1, s.deckkraft + dt * 0.8);
      // Licht der Taschenlampe (folgt der Kamera)
      const kam = this.k.welt.kamera;
      const zuS = p.clone().add(new THREE.Vector3(0, 1, 0)).sub(kam.position);
      const dist = zuS.length();
      const vorne = new THREE.Vector3();
      kam.getWorldDirection(vorne);
      const angeleuchtet = this.k.welt.nacht && dist < 9 && vorne.angleTo(zuS) < THREE.MathUtils.degToRad(18)
        && !this.k.welt.strahl(kam.position.clone(), zuS.clone().normalize(), Math.max(0.1, dist - 0.6), this.k.figur.collider);
      // Feuerschein im Haus
      const imFeuerschein = this.feuerAn() && this.imHaus(p.x, p.z);
      if (angeleuchtet || imFeuerschein) {
        s.licht += dt;
        s.zustand = "fliehen";
        s.t = 1.8;
        if (s.licht > 1.2 && !imFeuerschein) {
          s.zustand = "weg";
          s.wartet = 10;
          this.k.hud.meldung("Verscheucht! 🔦", 900);
        }
      } else s.licht = Math.max(0, s.licht - dt * 0.5);
      const weg = new THREE.Vector3(p.x - f.x, 0, p.z - f.z);
      const d = weg.length();
      weg.normalize();
      let tempo = 0;
      let richtung = weg.clone();
      if (s.zustand === "fliehen") {
        s.t -= dt;
        tempo = 3.6;
        if (imFeuerschein) {
          // raus aus dem Haus, zur nächsten Außenseite
          const mx = (HAUS.x0 + HAUS.x1) / 2, mz = (HAUS.z0 + HAUS.z1) / 2;
          richtung = new THREE.Vector3(p.x - mx, 0, p.z - mz).normalize();
        }
        if (s.t <= 0) s.zustand = "jagen";
      } else {
        richtung = weg.negate();
        tempo = Math.min(3.0, 1.5 + 0.12 * this.tag);
        if (d < 0.2) tempo = 0;
      }
      if (tempo > 0) {
        const nx = p.x + richtung.x * tempo * dt, nz = p.z + richtung.z * tempo * dt;
        const sperre = (x: number, z: number) => this.feuerAn() && s.zustand === "jagen" && this.imHaus(x, z, 0.2);
        if (!sperre(nx, nz)) { p.x = nx; p.z = nz; }
        else if (!sperre(nx, p.z)) p.x = nx;
        else if (!sperre(p.x, nz)) p.z = nz;
        const y = this.boden(p.x, p.z, p.y + 1.2, 4);
        if (y !== null) p.y += (y - p.y) * Math.min(1, dt * 8);
        s.gruppe.rotation.y = Math.atan2(-richtung.x, -richtung.z);
      }
      // Kratzer
      if (s.zustand === "jagen" && this.kratzPause <= 0 && d < 0.75 && Math.abs(p.y - f.y) < 1.5) this.kratzer(s, weg);
    }
    // Aussehen: schweben, Rauch wabern
    for (const m of s.mats) (m as THREE.MeshBasicMaterial).opacity = (m === s.mats[0] ? 0.88 : 1) * s.deckkraft;
    s.gruppe.visible = s.deckkraft > 0.01;
    s.gruppe.children.forEach((c, i) => {
      if (c.userData.fetzen) c.position.y = ((c.position.y + dt * 0.4 + i * 0.001) % 1.3) + 0.05;
    });
    s.gruppe.position.y += Math.sin(s.phase * 3) * 0.002;
  }

  private kratzer(s: Schatten, vonSchatten: THREE.Vector3) {
    this.herzen--;
    this.kratzPause = 1.5;
    s.zustand = "fliehen";
    s.t = 2.0;
    navigator.vibrate?.([60, 40, 60]);
    this.blitz.style.opacity = "1";
    setTimeout(() => (this.blitz.style.opacity = "0"), 250);
    // Rückstoß, ohne durch Wände
    const dir = vonSchatten.clone().negate().setY(0).normalize();
    const kopf = this.k.figur.fuss().add(new THREE.Vector3(0, 0.5, 0));
    const t = this.k.welt.strahl(kopf, dir, 1.6, this.k.figur.collider);
    const w = t ? Math.max(0, t.abstand - 0.45) : 1.4;
    this.k.figur.setzen(this.k.figur.fuss().addScaledVector(dir, w));
    if (this.herzen <= 0) {
      this.laeuft = false;
      this.k.hud.meldung("Oh nein – erwischt!", 1500);
      this.k.fertig({ zeit_ms: Math.max(1000, Math.round(this.gesamt * 1000)), punkte: this.ueberstanden,
        text: this.ueberstanden === 1 ? "Du hast 1 Nacht überlebt!" : `Du hast ${this.ueberstanden} Nächte überlebt!` });
    } else this.k.hud.meldung(`Autsch, ein Kratzer! Noch ${"❤️".repeat(this.herzen)}`, 1400);
    this.anzeige();
  }

  // --- Tag und Nacht ------------------------------------------------------------------------
  private nachtBeginnt() {
    this.nacht = true;
    this.phasenZeit = 0;
    this.k.welt.tageszeit(true);
    this.k.hud.meldung(`🌙 Nacht ${this.tag} – bleib im Licht!`, 2500);
    const anzahl = Math.min(3, 1 + Math.floor((this.tag - 1) / 2));
    for (const s of this.schatten) this.schattenPlatzieren(s);
    while (this.schatten.length < anzahl) this.schattenErzeugen();
  }

  private tagBeginnt() {
    this.nacht = false;
    this.phasenZeit = 0;
    this.gewarnt = false;
    this.ueberstanden++;
    this.tag++;
    this.k.welt.tageszeit(false);
    for (const s of this.schatten) { s.zustand = "weg"; s.wartet = 1e9; }
    if (this.ueberstanden >= this.ziel) {
      this.laeuft = false;
      this.k.fertig({ zeit_ms: Math.max(1000, Math.round(this.gesamt * 1000)), punkte: this.ueberstanden,
        text: `Geschafft! Alle ${this.ziel} Nächte überstanden! 🔥` });
      return;
    }
    this.k.hud.meldung(`☀️ Tag ${this.tag} – geschafft, ${this.ueberstanden} ${this.ueberstanden === 1 ? "Nacht" : "Nächte"}!`, 2500);
    // gefällte Bäume wachsen woanders nach
    for (const b of this.baeume.filter((x) => x.weg)) this.wurzel.remove(b.gruppe);
    this.baeume = this.baeume.filter((b) => !b.weg);
    this.baeumeAuffuellen(20);
  }

  private anzeige() {
    const zeit = this.nacht ? `🌙 Nacht ${this.tag}` : `☀️ Tag ${this.tag}`;
    this.k.hud.anzeige(`${zeit} · 🔥 ${Math.round(this.brennstoff)}% · ${"❤️".repeat(Math.max(0, this.herzen))}`);
    this.leisteRuck.textContent = `🎒 ${this.rucksack}/${RUCKSACK}`;
    this.leisteFeuer.textContent = this.feuerAn() ? `🔥 Ofen ${Math.round(this.brennstoff)}%` : "🧊 Ofen aus!";
  }

  // --- Schleife -----------------------------------------------------------------------------
  update(dt: number) {
    // Späne und fallende Bäume laufen auch nach dem Ende kurz weiter
    for (const s of this.spaene) {
      s.t -= dt;
      s.v.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.rotation.x += dt * 8;
    }
    for (const s of this.spaene.filter((x) => x.t <= 0)) this.wurzel.remove(s.mesh);
    this.spaene = this.spaene.filter((x) => x.t > 0);
    for (const b of this.baeume) {
      if (b.wackeln > 0) {
        b.wackeln -= dt;
        b.gruppe.rotation.z = Math.sin(b.wackeln * 60) * 0.03;
      }
      if (b.faellt >= 0 && !b.weg) {
        b.faellt += dt;
        const w = Math.min(Math.PI / 2, (b.faellt / 0.9) ** 2 * (Math.PI / 2));
        b.gruppe.rotation.set(0, 0, 0);
        b.gruppe.rotateOnWorldAxis(new THREE.Vector3(Math.cos(b.richtung), 0, -Math.sin(b.richtung)), w);
        if (b.faellt > 1.1) {
          b.weg = true;
          b.gruppe.visible = false;
          this.scheiteAblegen(b);
        }
      }
    }
    // Ofen-Flammen
    const an = this.feuerAn();
    const flackern = 0.85 + Math.sin(performance.now() * 0.013) * 0.08 + Math.random() * 0.07;
    this.feuerLicht.intensity = an ? (6 + (this.brennstoff / 100) * 22) * flackern : 0;
    this.glut.emissiveIntensity = an ? 0.6 + (this.brennstoff / 100) * 2 * flackern : 0.05;
    for (const [i, f] of this.flammen.entries()) {
      f.visible = an;
      f.scale.y = (0.5 + this.brennstoff / 120) * (0.8 + Math.sin(performance.now() * 0.02 + i * 2) * 0.25);
    }
    if (!this.laeuft) return;
    this.gesamt += dt;
    this.phasenZeit += dt;
    this.hackPause = Math.max(0, this.hackPause - dt);
    this.kratzPause = Math.max(0, this.kratzPause - dt);
    // Brennstoff
    this.brennstoff = Math.max(0, this.brennstoff - dt * (this.nacht ? 0.9 : 0.45));
    if (!an && !this.warAus) { this.k.hud.meldung("🧊 Das Feuer ist aus! Schnell Holz holen!", 2500); }
    this.warAus = !an;
    const f = this.k.figur.fuss();
    // Holz in den Ofen
    if (this.rucksack > 0 && Math.hypot(f.x - this.ofenPos.x, f.z - this.ofenPos.z) < 1.5 && Math.abs(f.y - this.ofenPos.y) < 1.2) {
      const war = this.brennstoff;
      this.brennstoff = Math.min(100, this.brennstoff + this.rucksack * 20);
      this.k.hud.meldung(war <= 0 ? `🔥 Feuer brennt wieder! (+${this.rucksack} Scheite)` : `🔥 +${this.rucksack} Scheite im Ofen`, 1400);
      this.rucksack = 0;
    }
    // Holz aufsammeln (hinlaufen)
    for (const s of [...this.scheite]) {
      const p = s.mesh.position;
      if (Math.hypot(p.x - f.x, p.z - f.z) < 0.8 && Math.abs(p.y - f.y) < 1.2) {
        if (!this.aufheben(s)) break;
      }
    }
    // Tageswechsel
    if (!this.nacht) {
      if (!this.gewarnt && this.phasenZeit > this.tagLaenge - 12) {
        this.gewarnt = true;
        this.k.hud.meldung("Die Nacht kommt – ist genug Holz im Ofen? 🌆", 3000);
      }
      if (this.phasenZeit >= this.tagLaenge) this.nachtBeginnt();
    } else {
      for (const s of this.schatten) this.schattenUpdate(s, dt);
      if (this.laeuft && this.phasenZeit >= this.nachtLaenge) this.tagBeginnt();
    }
    if (this.laeuft) this.anzeige();
  }

  tipp(x: number, y: number): boolean {
    if (!this.laeuft) return false;
    // Holzscheit antippen
    this.ray.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), this.k.welt.kamera);
    const treffer = this.ray.intersectObjects(this.scheite.map((s) => s.mesh), false)[0];
    if (treffer) {
      const s = this.scheite.find((q) => q.mesh === treffer.object);
      const f = this.k.figur.fuss();
      if (s && treffer.object.position.distanceTo(f) < 3) {
        if (!this.aufheben(s)) this.k.hud.meldung("🎒 Rucksack ist voll!", 1000);
        return true;
      }
    }
    return this.hacken();
  }

  pause(an: boolean) {
    if (this.herzen > 0 && this.ueberstanden < this.ziel) this.laeuft = !an;
  }

  ende() {
    this.laeuft = false;
    const ph = this.k.welt.physik;
    for (const b of this.baeume) if (b.collider) ph.removeCollider(b.collider, false);
    if (this.ofenCollider) ph.removeCollider(this.ofenCollider, false);
    this.eigene.clear();
    this.k.welt.szene.remove(this.wurzel);
    this.wurzel.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.baeume = [];
    this.scheite = [];
    this.spaene = [];
    this.schatten = [];
    this.blitz?.remove();
    this.leisteRuck?.remove();
    this.leisteFeuer?.remove();
    this.k.welt.tageszeit(false);
  }
}
