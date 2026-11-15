// Der Boden ist Lava: Die Lava steigt in Stufen – auf Möbel, die Treppe hoch, ins OG. Wer sie berührt, ist raus.
// Wertung: ganze Sekunden überlebt (Bonus, wer bis zum Schluss durchhält).
import * as THREE from "three";
import { Kontext, Spiel } from "./typen";

interface Stufe { ziel: number; anstieg: number; pause: number }

const COUNTDOWN = 5;
const GNADE = 0.4;        // so lange darf man die Lava berühren, bevor es vorbei ist
const DURCHHALTEN = 20;   // Sekunden auf der letzten Stufe bis „Gewonnen“
const BONUS = 60;

function lavaTextur(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const x = c.getContext("2d")!;
  x.fillStyle = "#b32400";
  x.fillRect(0, 0, n, n);
  // helle, glühende Adern und dunkle Krusten
  for (let i = 0; i < 70; i++) {
    const px = Math.random() * n, py = Math.random() * n, r = 10 + Math.random() * 38;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    const hell = Math.random() < 0.55;
    g.addColorStop(0, hell ? "rgba(255,220,90,0.9)" : "rgba(60,10,0,0.75)");
    g.addColorStop(1, hell ? "rgba(255,120,20,0)" : "rgba(60,10,0,0)");
    x.fillStyle = g;
    // nahtlos: an den Rändern wiederholen
    for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) { x.save(); x.translate(dx, dy); x.fillRect(px - r, py - r, 2 * r, 2 * r); x.restore(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(28, 28);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class LavaSpiel implements Spiel {
  private k!: Kontext;
  private zeit = 0;           // Spielzeit seit Start (inkl. Countdown)
  private laeuft = false;
  private hoehe = -0.3;       // Lavaoberkante (three y)
  private stufen: Stufe[] = [];
  private stufe = 0;
  private phase: "countdown" | "anstieg" | "pause" | "ende" = "countdown";
  private phaseZeit = 0;
  private startHoehe = -0.3;
  private beruehrt = 0;
  private endeZeit = 0;       // Zeit auf der letzten Stufe
  private gruppe = new THREE.Group();
  private tex!: THREE.CanvasTexture;
  private mat!: THREE.MeshStandardMaterial;
  private licht = new THREE.PointLight(0xff6a1a, 6, 9, 1.6);
  private funken: { m: THREE.Mesh; v: THREE.Vector3; t: number }[] = [];
  private blitz: HTMLDivElement | null = null;
  private letzterCount = -1;

  start(k: Kontext) {
    this.k = k;
    const eg = k.welt.daten.geschosse.EG, og = k.welt.daten.geschosse.OG;
    const f = { langsam: 1.45, normal: 1, schnell: 0.7 }[k.optionen.tempo as "langsam" | "normal" | "schnell"] ?? 1;
    // Stufen: Boden → niedrige Möbel → Tische/Treppe → OG-Boden → OG-Möbel
    this.stufen = [
      { ziel: eg + 0.15, anstieg: 3, pause: 14 * f },
      { ziel: eg + 0.55, anstieg: 12 * f, pause: 14 * f },
      { ziel: eg + 1.0, anstieg: 12 * f, pause: 12 * f },
      { ziel: og + 0.1, anstieg: 30 * f, pause: 12 * f },
      { ziel: og + 0.4, anstieg: 10 * f, pause: Infinity },
    ];
    this.startHoehe = this.hoehe = eg - 0.3;

    this.tex = lavaTextur();
    this.mat = new THREE.MeshStandardMaterial({ color: 0x5a1400, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 1.25, map: this.tex, roughness: 0.6 });
    const ebene = new THREE.Mesh(new THREE.CircleGeometry(70, 64), this.mat);
    ebene.rotation.x = -Math.PI / 2;
    ebene.position.set(3.9, 0, 5.5);
    ebene.receiveShadow = false;
    this.gruppe.add(ebene, this.licht);
    k.welt.szene.add(this.gruppe);

    this.blitz = document.createElement("div");
    Object.assign(this.blitz.style, { position: "fixed", inset: "0", background: "radial-gradient(circle, rgba(255,60,0,0) 40%, rgba(255,40,0,0.55) 100%)", pointerEvents: "none", opacity: "0", transition: "opacity .15s", zIndex: "5" });
    document.body.append(this.blitz);

    this.zeit = 0;
    this.phase = "countdown";
    this.phaseZeit = 0;
    this.laeuft = true;
    k.hud.meldung("🌋 Gleich steigt die Lava – klettere nach oben!", 2200);
    this.anzeige();
  }

  private anzeige() {
    const s = Math.floor(Math.max(0, this.zeit - COUNTDOWN)), m = Math.floor(s / 60);
    const ueberBoden = Math.max(0, this.hoehe - this.k.welt.daten.geschosse.EG);
    this.k.hud.anzeige(`🌋 Lava ${ueberBoden.toFixed(1).replace(".", ",")} m · ⏱ ${m}:${String(s % 60).padStart(2, "0")}`);
  }

  private beenden(gewonnen: boolean) {
    if (!this.laeuft) return;
    this.laeuft = false;
    const sek = Math.max(1, Math.floor(this.zeit - COUNTDOWN));
    const punkte = sek + (gewonnen ? BONUS : 0);
    if (this.blitz) this.blitz.style.opacity = gewonnen ? "0" : "1";
    this.k.fertig({
      zeit_ms: Math.max(1000, Math.round((this.zeit - COUNTDOWN) * 1000)),
      punkte,
      text: gewonnen ? `Gewonnen! Du bist der Lava entkommen (+${BONUS} Bonus)` : `Du hast ${sek} Sekunden überlebt!`,
    });
  }

  private lavaBewegen(dt: number) {
    this.phaseZeit += dt;
    const st = this.stufen[this.stufe];
    if (this.phase === "countdown") {
      const rest = Math.ceil(COUNTDOWN - this.phaseZeit);
      if (rest !== this.letzterCount && rest > 0 && rest <= 3) { this.k.hud.meldung(String(rest), 900); }
      this.letzterCount = rest;
      if (this.phaseZeit >= COUNTDOWN) { this.phase = "anstieg"; this.phaseZeit = 0; this.startHoehe = this.hoehe; this.k.hud.meldung("Der Boden ist Lava! 🔥", 1500); }
      return;
    }
    if (this.phase === "anstieg") {
      const a = Math.min(1, this.phaseZeit / st.anstieg);
      this.hoehe = this.startHoehe + (st.ziel - this.startHoehe) * (a * a * (3 - 2 * a));
      if (a >= 1) { this.phase = "pause"; this.phaseZeit = 0; if (this.stufe === this.stufen.length - 1) this.k.hud.meldung(`Halte ${DURCHHALTEN} Sekunden durch!`, 2000); }
      return;
    }
    if (this.phase === "pause") {
      if (this.stufe === this.stufen.length - 1) {
        this.endeZeit += dt;
        if (this.endeZeit >= DURCHHALTEN) this.beenden(true);
        return;
      }
      if (this.phaseZeit >= st.pause) {
        this.stufe++;
        this.phase = "anstieg";
        this.phaseZeit = 0;
        this.startHoehe = this.hoehe;
        this.k.hud.meldung("⚠️ Die Lava steigt weiter!", 1600);
      } else if (st.pause - this.phaseZeit < 3 && st.pause - this.phaseZeit + dt >= 3) {
        this.k.hud.meldung("Gleich steigt sie wieder …", 1200);
      }
    }
  }

  private funkeNeu(nah: THREE.Vector3) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffc040 }));
    const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 5;
    m.position.set(nah.x + Math.cos(a) * r, this.hoehe + 0.02, nah.z + Math.sin(a) * r);
    this.gruppe.add(m);
    this.funken.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 1.5, (Math.random() - 0.5) * 0.6), t: 0 });
  }

  update(dt: number) {
    if (!this.laeuft) return;
    this.zeit += dt;
    this.lavaBewegen(dt);
    // Lava zeichnen: fließende Textur, pulsierendes Glühen, Licht in Spielernähe
    this.gruppe.children[0].position.y = this.hoehe;
    this.tex.offset.x += dt * 0.018;
    this.tex.offset.y += dt * 0.011;
    this.mat.emissiveIntensity = 1.15 + Math.sin(this.zeit * 2.3) * 0.15;
    const f = this.k.figur.fuss();
    this.licht.position.set(f.x, this.hoehe + 0.6, f.z);
    if (this.phase !== "countdown" && Math.random() < dt * 12) this.funkeNeu(f);
    for (const s of [...this.funken]) {
      s.t += dt;
      s.v.y -= 3 * dt;
      s.m.position.addScaledVector(s.v, dt);
      if (s.t > 1.2) { this.gruppe.remove(s.m); s.m.geometry.dispose(); this.funken.splice(this.funken.indexOf(s), 1); }
    }
    // Berührt?
    if (this.phase !== "countdown" && f.y < this.hoehe + 0.02) {
      this.beruehrt += dt;
      if (this.blitz) this.blitz.style.opacity = "1";
      if (this.beruehrt === dt) this.k.hud.meldung("🔥 Heiß! Schnell runter da!", 600);
      if (this.beruehrt >= GNADE) { this.k.hud.meldung("🔥 In die Lava gefallen!", 1500); this.beenden(false); return; }
    } else {
      this.beruehrt = 0;
      if (this.blitz) this.blitz.style.opacity = "0";
    }
    this.anzeige();
  }

  private laeuftVorPause = true;

  pause(an: boolean) {
    if (this.phase === "ende") return;
    if (an) this.laeuftVorPause = this.laeuft;
    this.laeuft = !an && this.laeuftVorPause;
  }

  ende() {
    this.laeuft = false;
    this.phase = "ende";
    this.k.welt.szene.remove(this.gruppe);
    this.gruppe.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
    this.tex?.dispose();
    this.funken = [];
    this.blitz?.remove();
    this.blitz = null;
  }
}
