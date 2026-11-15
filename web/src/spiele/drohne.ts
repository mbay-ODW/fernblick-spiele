// Drohnenrennen: mit einer kleinen Drohne durch leuchtende Ringe rund ums Haus fliegen – gegen die Uhr
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Kontext, Spiel } from "./typen";

const R_DROHNE = 0.25;

/** Modell → three: (x, z oben, y) */
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, y);

/** Strecke in Modellkoordinaten [x, y, z über EG-Fußboden]: Terrasse → Garten → Hecke → Hof → Dach → Westseite → Terrasse */
const STRECKE: [number, number, number][] = [
  [3.9, 17.6, 1.4],   // über die Gartentreppe
  [8.5, 19.6, 1.6],   // Garten Südost
  [13.6, 15.8, 2.2],  // um den Laubbaum
  [14.0, 8.5, 2.3],   // an der Hecke entlang
  [13.8, 3.0, 2.4],   // Ende der Hecke
  [10.3, 1.2, 2.2],   // über den Hof
  [9.6, -4.2, 3.2],   // Hof Nord
  [3.9, -3.6, 4.6],   // hinter dem Haus hoch
  [3.9, 2.0, 8.3],    // über den First
  [3.9, 8.8, 8.3],    // First Süd
  [-2.4, 9.8, 3.0],   // Westseite runter
  [-1.6, 16.6, 1.8],  // am Obstbaum vorbei
  [3.9, 14.2, 1.2],   // Ziel: zurück auf die Terrasse
];

interface Ring { mitte: THREE.Vector3; normale: THREE.Vector3; radius: number; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; seite: number }

function drohneBauen(): { gruppe: THREE.Group; rotoren: THREE.Object3D[]; leds: THREE.MeshStandardMaterial[] } {
  const g = new THREE.Group();
  const dunkel = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.3 });
  const hell = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.4 });
  const koerper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.3), hell);
  g.add(koerper);
  const kamera = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), dunkel);
  kamera.position.set(0, -0.03, -0.15);
  g.add(kamera);
  const rotoren: THREE.Object3D[] = [];
  const leds: THREE.MeshStandardMaterial[] = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.22), dunkel);
    arm.position.set(sx * 0.1, 0, sz * 0.1);
    arm.rotation.y = Math.atan2(sx, sz);
    g.add(arm);
    const nabe = new THREE.Group();
    nabe.position.set(sx * 0.18, 0.04, sz * 0.18);
    const scheibe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.004, 24),
      new THREE.MeshStandardMaterial({ color: 0x9fb6c4, transparent: true, opacity: 0.3, depthWrite: false }));
    const blatt = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.006, 0.02), dunkel);
    nabe.add(scheibe, blatt);
    g.add(nabe);
    rotoren.push(blatt);
    // vorne grün, hinten rot
    const led = new THREE.MeshStandardMaterial({ color: sz < 0 ? 0x2fd67a : 0xe8455a, emissive: sz < 0 ? 0x2fd67a : 0xe8455a, emissiveIntensity: 1.5 });
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), led);
    l.position.set(sx * 0.18, -0.02, sz * 0.18);
    g.add(l);
    leds.push(led);
  }
  g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  return { gruppe: g, rotoren, leds };
}

export class DrohnenSpiel implements Spiel {
  private k!: Kontext;
  private drohne!: ReturnType<typeof drohneBauen>;
  private body!: RAPIER.RigidBody;
  private wischHoch = 0;
  private collider!: RAPIER.Collider;
  private ctrl!: RAPIER.KinematicCharacterController;
  private ringe: Ring[] = [];
  private naechster = 0;
  private zeit = 0;
  private laeuft = false;
  private gier = Math.PI;
  private v = new THREE.Vector3();
  private phase = 0;
  private kamPos = new THREE.Vector3();
  private letztePos = new THREE.Vector3();

  start(k: Kontext) {
    this.k = k;
    k.welt.tageszeit(false);
    k.figur.ruht = true;
    k.figur.avatar.gruppe.visible = false;
    // Drohne auf der Terrasse
    const start = v3(3.9, 13.4, 0.9);
    this.drohne = drohneBauen();
    this.drohne.gruppe.position.copy(start);
    k.welt.szene.add(this.drohne.gruppe);
    const w = k.welt.physik;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y, start.z));
    this.collider = w.createCollider(RAPIER.ColliderDesc.ball(R_DROHNE), this.body);
    this.ctrl = w.createCharacterController(0.03);
    this.ctrl.setUp({ x: 0, y: 1, z: 0 });
    this.ctrl.setSlideEnabled(true);
    this.letztePos.copy(start);
    this.kamPos.copy(start).add(new THREE.Vector3(0, 1.4, -3));
    // Ringe
    const schwer = k.optionen.ringe === "schwer";
    const punkte: THREE.Vector3[] = [];
    STRECKE.forEach((p, i) => {
      if (schwer && i > 0 && i % 2 === 0) {
        const q = STRECKE[i - 1];
        punkte.push(v3((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2 + (i % 4 ? 0.7 : -0.4)));
      }
      punkte.push(v3(p[0], p[1], p[2]));
    });
    const radius = schwer ? 0.85 : 1.5;
    punkte.forEach((p, i) => {
      const vor = i > 0 ? punkte[i - 1] : start;
      const nach = punkte[i + 1] ?? p.clone().add(p.clone().sub(vor));
      const normale = nach.clone().sub(vor).normalize();
      const mat = new THREE.MeshStandardMaterial({ color: 0x39c6ff, emissive: 0x39c6ff, emissiveIntensity: 0.4, transparent: true, opacity: 0.35, roughness: 0.3 });
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, schwer ? 0.06 : 0.08, 10, 48), mat);
      mesh.position.copy(p);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normale);
      k.welt.szene.add(mesh);
      this.ringe.push({ mitte: p, normale, radius, mesh, mat, seite: Math.sign(start.clone().sub(p).dot(normale)) || -1 });
    });
    this.naechster = 0;
    this.markieren();
    k.hud.knopf("hoch", "⬆");
    k.hud.knopf("runter", "⬇");
    this.zeit = 0;
    this.laeuft = true;
    k.hud.meldung(`Flieg durch alle ${this.ringe.length} Ringe!`, 2500);
    this.anzeige();
  }

  private markieren() {
    this.ringe.forEach((r, i) => {
      r.mesh.visible = i >= this.naechster;
      const aktiv = i === this.naechster;
      r.mat.color.set(aktiv ? 0xf2c230 : i === this.ringe.length - 1 ? 0x7bdc6a : 0x39c6ff);
      r.mat.emissive.copy(r.mat.color);
      r.mat.emissiveIntensity = aktiv ? 1.4 : 0.35;
      r.mat.opacity = aktiv ? 1 : 0.3;
    });
  }

  private anzeige() {
    const s = Math.floor(this.zeit), m = Math.floor(s / 60);
    this.k.hud.anzeige(`🚁 Ring ${Math.min(this.naechster + 1, this.ringe.length)}/${this.ringe.length} · ⏱ ${m}:${String(s % 60).padStart(2, "0")}`);
  }

  update(dt: number) {
    const k = this.k, e = k.eingabe;
    if (this.laeuft) this.zeit += dt;
    this.phase += dt;
    e.sprung(); // Leertaste setzt sonst den Sprung-Merker der Figur
    const b = e.blickAbholen();
    this.gier -= b.dx * (e.touch ? 0.0042 : 0.0026);
    // Hoch/runter auch per Wischen bzw. Maus (Option: normal, umgekehrt wie beim Flugzeug, aus)
    const art = k.optionen.hoehe ?? "normal";
    if (art !== "aus") {
      const vz = art === "umgekehrt" ? 1 : -1;
      this.wischHoch = Math.max(-5, Math.min(5, this.wischHoch + vz * b.dy * (e.touch ? 0.09 : 0.05)));
    }
    this.wischHoch *= Math.exp(-dt * 5);
    const steuern = this.laeuft && !k.figur.gesperrt;
    // Wunschgeschwindigkeit
    const ziel = new THREE.Vector3();
    if (steuern) {
      const tempo = e.rennen ? 11 : 7;
      const sin = Math.sin(this.gier), cos = Math.cos(this.gier);
      ziel.x = (-sin * e.vor + cos * e.seit) * tempo;
      ziel.z = (-cos * e.vor - sin * e.seit) * tempo;
      const hoch = e.taste("Space") || e.taste("KeyE") || e.knoepfe.hoch;
      const runter = e.taste("ShiftLeft") || e.taste("ShiftRight") || e.taste("KeyQ") || e.taste("KeyC") || e.knoepfe.runter;
      ziel.y = (hoch ? 4 : 0) - (runter ? 4 : 0) + this.wischHoch;
    }
    this.v.lerp(ziel, Math.min(1, dt * 3.5));
    const schweben = Math.sin(this.phase * 2.3) * 0.04;
    const wunsch = { x: this.v.x * dt, y: (this.v.y + schweben) * dt, z: this.v.z * dt };
    const figurC = k.figur.collider;
    this.ctrl.computeColliderMovement(this.collider, wunsch, undefined, undefined, (c) => c.handle !== figurC.handle);
    const m = this.ctrl.computedMovement();
    const t = this.body.translation();
    const neu = new THREE.Vector3(t.x + m.x, Math.min(t.y + m.y, 30), t.z + m.z);
    this.body.setNextKinematicTranslation(neu);
    // Modell: neigt sich in Flugrichtung, Rotoren drehen
    const g = this.drohne.gruppe;
    g.position.copy(neu);
    g.rotation.order = "YXZ";
    g.rotation.y = this.gier;
    const lokalVor = -(this.v.x * -Math.sin(this.gier) + this.v.z * -Math.cos(this.gier));
    const lokalSeit = this.v.x * Math.cos(this.gier) - this.v.z * Math.sin(this.gier);
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, lokalVor * 0.03, Math.min(1, dt * 6));
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, -lokalSeit * 0.03, Math.min(1, dt * 6));
    for (const r of this.drohne.rotoren) r.rotation.y += dt * 45;
    for (const l of this.drohne.leds) l.emissiveIntensity = 1 + Math.sin(this.phase * 8) * 0.6;
    // Ringe: Ebene von der richtigen Seite durchflogen, nah genug an der Mitte
    if (this.laeuft) {
      const r = this.ringe[this.naechster];
      const d = neu.clone().sub(r.mitte).dot(r.normale);
      const seite = Math.sign(d) || r.seite;
      const nah = neu.distanceTo(r.mitte) < r.radius;
      if ((seite !== r.seite && nah) || (Math.abs(d) < 0.25 && nah && neu.distanceTo(r.mitte) < r.radius * 0.8)) this.durch();
      else r.seite = seite;
      r.mesh.scale.setScalar(this.naechster < this.ringe.length ? 1 + Math.sin(this.phase * 4) * 0.04 : 1);
    }
    this.letztePos.copy(neu);
    this.kamera(dt, neu);
    if (this.laeuft) this.anzeige();
  }

  private durch() {
    const k = this.k;
    this.naechster++;
    navigator.vibrate?.(30);
    if (this.naechster >= this.ringe.length) {
      this.laeuft = false;
      this.markieren();
      k.hud.meldung("Ziel! 🏁", 1500);
      k.fertig({ zeit_ms: Math.round(this.zeit * 1000), punkte: this.ringe.length, text: `Alle ${this.ringe.length} Ringe geschafft!` });
      return;
    }
    const neu = this.ringe[this.naechster];
    neu.seite = Math.sign(this.letztePos.clone().sub(neu.mitte).dot(neu.normale)) || -1;
    this.markieren();
    const rest = this.ringe.length - this.naechster;
    k.hud.meldung(rest === 1 ? "Letzter Ring!" : `Noch ${rest}`, 900);
  }

  /** Verfolgerkamera hinter und über der Drohne, rückt vor Wänden heran */
  private kamera(dt: number, p: THREE.Vector3) {
    const kam = this.k.welt.kamera;
    const hinten = new THREE.Vector3(Math.sin(this.gier), 0.42, Math.cos(this.gier)).normalize();
    const max = 3.4;
    const treffer = this.k.welt.strahl(p, hinten, max + 0.3, this.collider);
    const abstand = treffer ? Math.max(0.5, treffer.abstand - 0.25) : max;
    const ziel = p.clone().addScaledVector(hinten, abstand);
    this.kamPos.lerp(ziel, Math.min(1, dt * 7));
    kam.position.copy(this.kamPos);
    kam.lookAt(p.clone().add(new THREE.Vector3(-Math.sin(this.gier) * 2, 0.2, -Math.cos(this.gier) * 2)));
  }

  pause(an: boolean) {
    this.laeuft = !an && this.naechster < this.ringe.length;
  }

  ende() {
    const k = this.k;
    for (const r of this.ringe) { k.welt.szene.remove(r.mesh); r.mesh.geometry.dispose(); r.mat.dispose(); }
    this.ringe = [];
    k.welt.szene.remove(this.drohne.gruppe);
    const w = k.welt.physik;
    w.removeCharacterController(this.ctrl);
    w.removeRigidBody(this.body);
    k.figur.ruht = false;
    k.figur.avatar.gruppe.visible = k.figur.modus !== "ich";
  }
}
