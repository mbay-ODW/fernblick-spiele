// Parcours: Über Möbel durchs Haus, die Treppe hoch, oben weiter, wieder runter und durch die Glasfront über
// Terrasse und Gartentreppe ins Ziel. Kontrollpunkte der Reihe nach berühren, auf Zeit.
// Option „Boden verboten“: Wer im Haus den Fußboden berührt, muss zurück zum letzten Kontrollpunkt.
import * as THREE from "three";
import { Kontext, Spiel } from "./typen";

interface Punkt { pos: THREE.Vector3; gruppe: THREE.Group; ring: THREE.Mesh; schwebe: THREE.Mesh; strahl: THREE.Mesh; ziel: boolean }

const OBEN = /tisch|sideboard|kommode|regal|nachttisch|bank|board|schrank|bett|sofa|sessel|hocker|truhe|kallax|unterbau|container|waschmasch|trockner/;
const NIE = /teppich|bild|spiegel|leuchte|wandspot|pflanze|tv$|vorhang|lampe/;
const PFEILE = ["⬆", "↗", "➡", "↘", "⬇", "↙", "⬅", "↖"];

export class ParcoursSpiel implements Spiel {
  private k!: Kontext;
  private punkte: Punkt[] = [];
  private naechster = 0;
  private zeit = 0;
  private laeuft = false;
  private bodenVerboten = false;
  private sperre = 0; // nach dem Zurücksetzen kurz keine Bodenprüfung
  private gruppe = new THREE.Group();
  private ray = new THREE.Raycaster();
  private matAktiv = new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffb400, emissiveIntensity: 1.2, roughness: 0.3 });
  private matSpaeter = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x88aaff, emissiveIntensity: 0.25, transparent: true, opacity: 0.4, roughness: 0.5 });
  private matZiel = new THREE.MeshStandardMaterial({ color: 0x3ad16a, emissive: 0x1aa04a, emissiveIntensity: 0.9 });
  private matStrahl = new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });

  start(k: Kontext) {
    this.k = k;
    this.bodenVerboten = k.optionen.boden === "verboten";
    const lang = k.optionen.laenge === "lang";
    const route = this.routeBauen(lang);
    route.forEach((p, i) => this.punktSetzen(p, i === route.length - 1));
    k.welt.szene.add(this.gruppe);
    this.naechster = 0;
    this.darstellen();
    this.zeit = 0;
    this.laeuft = true;
    k.hud.meldung(this.bodenVerboten ? `${this.punkte.length} Punkte – der Boden im Haus ist verboten!` : `Lauf zu allen ${this.punkte.length} Punkten!`, 2600);
    this.anzeige();
  }

  // --- Strecke ------------------------------------------------------------------------------
  private art(o: THREE.Object3D | null): string {
    for (; o; o = o.parent) {
      if (o.userData?.moebelId) return "moebel";
      if (o.userData?.art) return String(o.userData.art);
    }
    return "";
  }

  /** Strahl von oben auf (x, y) im Modell; liefert Treffer, wenn Art passt (leer = beliebig), Fläche waagrecht und Luft darüber */
  private treffer(x: number, y: number, vonZ: number, bisZ: number, erlaubt: string[] | null, frei = 1.0): THREE.Vector3 | null {
    const w = this.k.welt;
    this.ray.set(new THREE.Vector3(x, vonZ, y), new THREE.Vector3(0, -1, 0));
    this.ray.far = vonZ - bisZ;
    const t = this.ray.intersectObject(w.haus, true).find((h) => (h.object as THREE.Mesh).isMesh && this.art(h.object) !== "panorama");
    if (!t?.face) return null;
    if (erlaubt && !erlaubt.includes(this.art(t.object))) return null;
    if (t.face.normal.clone().transformDirection(t.object.matrixWorld).y < 0.7) return null;
    const oben = w.strahl(t.point.clone().add(new THREE.Vector3(0, 0.03, 0)), new THREE.Vector3(0, 1, 0), 9);
    if (oben && oben.abstand < frei) return null;
    return t.point.clone();
  }

  private moebelOben(geschoss: string): THREE.Vector3[] {
    const d = this.k.welt.daten;
    const z0 = geschoss === "OG" ? d.geschosse.OG : d.geschosse.EG;
    const aus: THREE.Vector3[] = [];
    for (const m of d.moebel) {
      const typ = String(m.typ).toLowerCase();
      if (m.geschoss !== geschoss || NIE.test(typ) || !OBEN.test(typ)) continue;
      const p = this.treffer(m.pos[0], m.pos[1], z0 + 2.3, z0 + 0.2, ["moebel"], 0.9);
      if (p && p.y - z0 > 0.3 && p.y - z0 < 1.25) aus.push(p);
    }
    return aus;
  }

  private bodenPunkte(geschoss: string, anzahl: number): THREE.Vector3[] {
    const d = this.k.welt.daten;
    const z0 = geschoss === "OG" ? d.geschosse.OG : d.geschosse.EG;
    const aus: THREE.Vector3[] = [];
    for (const r of d.raeume.filter((r) => r.geschoss === geschoss)) {
      const xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]);
      for (let i = 0; i < anzahl; i++) {
        const x = Math.min(...xs) + Math.random() * (Math.max(...xs) - Math.min(...xs));
        const y = Math.min(...ys) + Math.random() * (Math.max(...ys) - Math.min(...ys));
        const p = this.treffer(x, y, z0 + 1.2, z0 - 0.3, ["boden"], 1.8);
        if (p && Math.abs(p.y - z0) < 0.1) aus.push(p);
      }
    }
    return aus;
  }

  /** Nächster-Nachbar-Reihenfolge ab einem Punkt, Mindestabstand zwischen Punkten */
  private reihe(von: THREE.Vector3, kandidaten: THREE.Vector3[], anzahl: number): THREE.Vector3[] {
    const rest = kandidaten.filter((p, i) => kandidaten.findIndex((q) => q.distanceTo(p) < 1.2) === i);
    const aus: THREE.Vector3[] = [];
    let akt = von;
    while (aus.length < anzahl && rest.length) {
      rest.sort((a, b) => a.distanceTo(akt) - b.distanceTo(akt));
      const i = rest.findIndex((p) => p.distanceTo(akt) > 1.3);
      const p = rest.splice(i < 0 ? 0 : i, 1)[0];
      aus.push(p);
      akt = p;
    }
    return aus;
  }

  private routeBauen(lang: boolean): THREE.Vector3[] {
    const start = this.k.figur.start;
    const eg = this.k.welt.daten.geschosse.EG;
    const nEG = lang ? 5 : 3, nOG = lang ? 3 : 1;
    // EG: Möbel; bei erlaubtem Boden notfalls auch Bodenpunkte
    let egK = this.moebelOben("EG");
    if (egK.length < nEG && !this.bodenVerboten) egK = egK.concat(this.bodenPunkte("EG", 2));
    const egTeil = this.reihe(start, egK, nEG);
    // OG: Möbel und (bei erlaubtem Boden) Bodenpunkte
    let ogK = this.moebelOben("OG");
    if (!this.bodenVerboten) ogK = ogK.concat(this.bodenPunkte("OG", 1));
    const ogTeil = this.reihe(egTeil[egTeil.length - 1] ?? start, ogK, nOG);
    const route = [...egTeil, ...ogTeil];
    // Zurück unten: ein Möbel nahe der Glasfront (lang), dann raus auf die Terrasse und in den Garten
    if (lang) {
      const front = this.moebelOben("EG").filter((p) => !route.some((q) => q.distanceTo(p) < 0.5)).sort((a, b) => b.z - a.z)[0];
      if (front) route.push(front);
    }
    const terrasse = this.treffer(3.9, 13.6, eg + 2, eg - 1.5, null, 1.6);
    if (terrasse) route.push(terrasse);
    if (lang) {
      const treppe = this.treffer(3.9, 16.4, eg + 2, eg - 3, null, 1.6);
      if (treppe) route.push(treppe);
    }
    const ziel = this.treffer(3.9, 18.6, eg + 2, eg - 5, null, 1.6) ?? this.treffer(3.9, 14.5, eg + 2, eg - 3, null, 1.6);
    if (ziel) route.push(ziel);
    return route;
  }

  // --- Darstellung --------------------------------------------------------------------------
  private punktSetzen(p: THREE.Vector3, ziel: boolean) {
    const g = new THREE.Group();
    g.position.copy(p);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 10, 40), this.matSpaeter);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.04;
    const schwebe = new THREE.Mesh(ziel ? new THREE.BoxGeometry(0.5, 0.32, 0.03) : new THREE.TorusGeometry(0.22, 0.035, 8, 28), this.matSpaeter);
    schwebe.position.y = 1.15;
    const strahl = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7, 12, 1, true), this.matStrahl);
    strahl.position.y = 3.5;
    strahl.visible = false;
    g.add(ring, schwebe, strahl);
    if (ziel) {
      const stange = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.3 }));
      stange.position.set(-0.27, 0.7, 0);
      g.add(stange);
      schwebe.position.set(0, 1.22, 0);
    }
    this.gruppe.add(g);
    this.punkte.push({ pos: p, gruppe: g, ring, schwebe, strahl, ziel });
  }

  private darstellen() {
    this.punkte.forEach((p, i) => {
      const fertig = i < this.naechster, aktiv = i === this.naechster;
      p.gruppe.visible = !fertig;
      const m = aktiv ? (p.ziel ? this.matZiel : this.matAktiv) : this.matSpaeter;
      p.ring.material = m;
      p.schwebe.material = m;
      p.strahl.visible = aktiv;
      p.gruppe.scale.setScalar(aktiv ? 1 : 0.75);
    });
  }

  private anzeige() {
    const s = Math.floor(this.zeit), m = Math.floor(s / 60);
    const uhr = `⏱ ${m}:${String(s % 60).padStart(2, "0")}`;
    const p = this.punkte[this.naechster];
    if (!p) { this.k.hud.anzeige(`🏁 ${uhr}`); return; }
    const f = this.k.figur.fuss();
    const dx = p.pos.x - f.x, dz = p.pos.z - f.z;
    const g = this.k.figur.gier;
    const vx = -Math.sin(g), vz = -Math.cos(g);
    // Winkel Blickrichtung → Ziel (positiv = rechts)
    const w = Math.atan2(vx * dz - vz * dx, vx * dx + vz * dz);
    const pfeil = PFEILE[(Math.round(w / (Math.PI / 4)) + 8) % 8];
    const hoch = p.pos.y - f.y > 1.2 ? " ⤴" : p.pos.y - f.y < -1.2 ? " ⤵" : "";
    this.k.hud.anzeige(`${pfeil}${hoch} ${this.naechster + 1} / ${this.punkte.length} · ${Math.round(Math.hypot(dx, dz))} m · ${uhr}`);
  }

  // --- Ablauf -------------------------------------------------------------------------------
  private erreicht() {
    const p = this.punkte[this.naechster];
    this.naechster++;
    navigator.vibrate?.(30);
    if (this.naechster >= this.punkte.length || p.ziel) {
      this.laeuft = false;
      this.darstellen();
      this.k.hud.meldung("🏁 Ziel!", 1500);
      this.k.fertig({ zeit_ms: Math.max(1000, Math.round(this.zeit * 1000)), punkte: this.punkte.length, text: "Parcours geschafft!" });
      return;
    }
    const rest = this.punkte.length - this.naechster;
    this.k.hud.meldung(rest === 1 ? "Jetzt ins Ziel!" : `✔ Noch ${rest}`, 900);
    this.darstellen();
  }

  /** Steht die Figur im Haus auf dem Fußboden (EG/OG)? */
  private aufBoden(): boolean {
    const f = this.k.figur.fuss();
    const d = this.k.welt.daten.geschosse;
    if (Math.abs(f.y - d.EG) > 0.08 && Math.abs(f.y - d.OG) > 0.08) return false;
    this.ray.set(f.clone().add(new THREE.Vector3(0, 0.15, 0)), new THREE.Vector3(0, -1, 0));
    this.ray.far = 0.35;
    const t = this.ray.intersectObject(this.k.welt.haus, true)[0];
    return !!t && this.art(t.object) === "boden";
  }

  update(dt: number) {
    for (const p of this.punkte) { p.schwebe.rotation.y += dt * 1.8; }
    const akt = this.punkte[this.naechster];
    if (akt) this.matAktiv.emissiveIntensity = 1 + Math.sin(this.zeit * 5) * 0.35;
    if (!this.laeuft) return;
    this.zeit += dt;
    this.sperre = Math.max(0, this.sperre - dt);
    const f = this.k.figur.fuss();
    if (akt && Math.hypot(akt.pos.x - f.x, akt.pos.z - f.z) < 0.7 && f.y - akt.pos.y > -0.5 && f.y - akt.pos.y < 1.2) this.erreicht();
    // Boden verboten: erst ab dem ersten Kontrollpunkt (am Start steht man auf dem Boden)
    if (this.laeuft && this.bodenVerboten && this.naechster > 0 && this.sperre <= 0 && this.k.figur.amBoden && this.aufBoden()) {
      const zurueck = this.punkte[this.naechster - 1].pos;
      this.k.figur.setzen(zurueck.clone().add(new THREE.Vector3(0, 0.05, 0)));
      this.sperre = 1;
      this.k.hud.meldung("😬 Boden berührt – zurück!", 1300);
      navigator.vibrate?.([30, 40, 30]);
    }
    this.anzeige();
  }

  tipp(): boolean {
    return false;
  }

  pause(an: boolean) {
    this.laeuft = !an && this.naechster < this.punkte.length;
  }

  ende() {
    this.laeuft = false;
    this.k.welt.szene.remove(this.gruppe);
    this.gruppe.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    for (const m of [this.matAktiv, this.matSpaeter, this.matZiel, this.matStrahl]) m.dispose();
    this.punkte = [];
  }
}
