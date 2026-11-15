// Spielfigur: Laufen, Rennen, Springen, Treppen (Rapier Character Controller) und vier Kameraansichten
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Welt } from "./welt";
import { Avatar, AvatarCfg } from "./avatar";
import { Eingabe } from "./eingabe";

export type KameraModus = "ich" | "hinten" | "vorne" | "oben";
export const KAMERA_REIHE: KameraModus[] = ["ich", "hinten", "vorne", "oben"];
export const KAMERA_NAME: Record<KameraModus, string> = { ich: "Ich-Ansicht", hinten: "Von hinten", vorne: "Von vorne", oben: "Von oben" };

const R = 0.27, HALB = 0.58; // Kapsel: 2·0,58 + 2·0,27 = 1,70 m
const AUGE = 1.58;

export class Figur {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  private ctrl: RAPIER.KinematicCharacterController;
  avatar: Avatar;
  gier = 0;
  nick = 0;
  private vy = 0;
  amBoden = false;
  modus: KameraModus;
  start: THREE.Vector3;
  private kamAbstand = 3.2;
  /** Gesperrt (Pause, Endbildschirm): keine Bewegung */
  gesperrt = false;
  /** Ruht: Spiel steuert selbst (z. B. Drohne) – keine Bewegung, keine Kamera, Blick wird nicht abgeholt */
  ruht = false;

  constructor(private welt: Welt, cfg: AvatarCfg, modus: KameraModus) {
    const s = welt.daten.start;
    // Startpunkt aus der ersten Ansicht des Planers (Kamerahöhe → Fußhöhe)
    const fuss = new THREE.Vector3(s.pos[0], Math.max(0, s.pos[1] - 1.65), s.pos[2]);
    this.start = fuss.clone();
    this.gier = Math.atan2(-(s.ziel[0] - s.pos[0]), -(s.ziel[2] - s.pos[2]));
    this.body = welt.physik.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(fuss.x, fuss.y + HALB + R + 0.02, fuss.z));
    this.collider = welt.physik.createCollider(RAPIER.ColliderDesc.capsule(HALB, R), this.body);
    this.ctrl = welt.physik.createCharacterController(0.02);
    this.ctrl.setUp({ x: 0, y: 1, z: 0 });
    this.ctrl.enableAutostep(0.3, 0.12, false);
    this.ctrl.enableSnapToGround(0.3);
    this.ctrl.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.ctrl.setMinSlopeSlideAngle((65 * Math.PI) / 180);
    this.avatar = new Avatar(cfg);
    welt.szene.add(this.avatar.gruppe);
    this.modus = modus;
    this.anwenden();
  }

  fuss(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y - HALB - R, t.z);
  }

  kopf(): THREE.Vector3 {
    return this.fuss().add(new THREE.Vector3(0, AUGE, 0));
  }

  setzen(p: THREE.Vector3, gier?: number) {
    this.body.setTranslation({ x: p.x, y: p.y + HALB + R + 0.02, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + HALB + R + 0.02, z: p.z });
    this.vy = 0;
    if (gier !== undefined) this.gier = gier;
  }

  ansichtWeiter() {
    this.modus = KAMERA_REIHE[(KAMERA_REIHE.indexOf(this.modus) + 1) % KAMERA_REIHE.length];
    this.anwenden();
  }

  private anwenden() {
    this.avatar.gruppe.visible = this.modus !== "ich";
    if (this.modus !== "oben") this.welt.schnitt.constant = 1e6;
  }

  update(dt: number, e: Eingabe) {
    if (this.ruht) return;
    const b = e.blickAbholen();
    const empf = e.touch ? 0.0042 : 0.0026;
    this.gier -= b.dx * empf;
    this.nick = Math.max(-1.35, Math.min(1.35, this.nick - b.dy * empf));
    if (e.einmal("ansichtWechsel")) this.ansichtWeiter();
    const sprung = e.sprung();
    let mx = 0, mz = 0, tempo = 0;
    if (!this.gesperrt) {
      const vor = e.vor, seit = e.seit;
      const l = Math.min(1, Math.hypot(vor, seit));
      if (l > 0.08) {
        const v = (e.rennen ? 5.6 : 3.2) * l;
        const sin = Math.sin(this.gier), cos = Math.cos(this.gier);
        // vorwärts = −z in Blickrichtung
        const fx = -sin, fz = -cos, rx = cos, rz = -sin;
        const n = Math.hypot(vor, seit) || 1;
        mx = ((fx * vor + rx * seit) / n) * v;
        mz = ((fz * vor + rz * seit) / n) * v;
        tempo = v / 5.6;
      }
      if (sprung && this.amBoden) this.vy = 6.4;
    }
    this.vy = Math.max(-25, this.vy - 18 * dt);
    const wunsch = { x: mx * dt, y: this.vy * dt, z: mz * dt };
    this.ctrl.computeColliderMovement(this.collider, wunsch);
    const m = this.ctrl.computedMovement();
    this.amBoden = this.ctrl.computedGrounded();
    if (this.amBoden && this.vy < 0) this.vy = 0;
    if (this.vy > 0 && m.y < wunsch.y * 0.5) this.vy = 0; // Kopf gestoßen
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    // herausgefallen? zurück zum Start
    if (t.y < -15) this.setzen(this.start);
    // Avatar folgt der Kapsel; dreht sich in Laufrichtung (Ich/hinten: Blickrichtung)
    const f = this.fuss();
    this.avatar.gruppe.position.copy(f);
    // Ich/hinten: Körper folgt dem Blick; vorne/oben: Körper dreht in Laufrichtung
    const folgtBlick = this.modus === "ich" || this.modus === "hinten";
    if (folgtBlick || mx || mz) {
      const ziel = folgtBlick ? this.gier : Math.atan2(-mx, -mz);
      let d = ziel - this.avatar.gruppe.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.avatar.gruppe.rotation.y += d * Math.min(1, dt * 12);
    }
    this.avatar.animieren(dt, tempo, !this.amBoden);
    this.kameraSetzen(dt);
  }

  private kameraSetzen(dt: number) {
    const k = this.welt.kamera;
    const kopf = this.kopf();
    const blick = new THREE.Vector3(-Math.sin(this.gier) * Math.cos(this.nick), Math.sin(this.nick), -Math.cos(this.gier) * Math.cos(this.nick));
    if (this.modus === "ich") {
      k.position.copy(kopf);
      k.lookAt(kopf.clone().add(blick));
      return;
    }
    if (this.modus === "oben") {
      // Von oben: Haus über Kopfhöhe weggeschnitten, Kamera schräg darüber
      const f = this.fuss();
      this.welt.schnitt.constant = f.y + 2.3;
      const hinter = new THREE.Vector3(Math.sin(this.gier), 0, Math.cos(this.gier)).multiplyScalar(2.2);
      const ziel = f.clone().add(new THREE.Vector3(0, 0.8, 0));
      const pos = ziel.clone().add(hinter).add(new THREE.Vector3(0, 7.5, 0));
      k.position.lerp(pos, Math.min(1, dt * 8));
      k.lookAt(ziel);
      return;
    }
    // Schulterblick von hinten bzw. von vorne; Kamera rückt vor Wänden heran
    const richtung = this.modus === "hinten" ? blick.clone().negate() : blick.clone().setY(-blick.y);
    if (this.modus === "vorne") richtung.set(Math.sin(this.gier) * -1, 0.25, Math.cos(this.gier) * -1).normalize();
    const ziel = kopf.clone().add(new THREE.Vector3(0, 0.3, 0));
    const treffer = this.welt.strahl(ziel, richtung, this.kamAbstand + 0.3, this.collider);
    const abstand = treffer ? Math.max(0.35, treffer.abstand - 0.25) : this.kamAbstand;
    k.position.copy(ziel).addScaledVector(richtung, abstand);
    k.lookAt(ziel);
  }

  entfernen() {
    this.welt.physik.removeCharacterController(this.ctrl);
    this.welt.physik.removeRigidBody(this.body);
    this.welt.szene.remove(this.avatar.gruppe);
    this.welt.schnitt.constant = 1e6;
  }
}
