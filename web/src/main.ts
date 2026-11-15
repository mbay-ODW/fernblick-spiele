// Fernblick-Spiele: App-Hülle mit Anmeldung, Spielemenü, Avatar-Editor, Einstellungen, Spielablauf
import "./stil.css";
import * as THREE from "three";
import { api } from "./api";
import { Welt, Qualitaet } from "./welt";
import { Figur, KameraModus, KAMERA_NAME, KAMERA_REIHE } from "./figur";
import { Avatar, AvatarCfg, AUSWAHL, STANDARD_AVATAR } from "./avatar";
import { Eingabe } from "./eingabe";
import { SPIELE, SpielInfo, Spiel, Kontext } from "./spiele/typen";
import { Suchspiel } from "./spiele/suchen";

const MODULE: Record<string, () => Spiel> = { suchen: () => new Suchspiel() };

interface Profil { name: string; avatar: AvatarCfg; kamera: KameraModus; qualitaet: Qualitaet; optionen: Record<string, Record<string, string>> }

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attr: Record<string, any> = {}, ...kinder: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attr)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) (e as any)[k] = v;
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const k of kinder) if (k !== null && k !== undefined && k !== false) e.append(k as any);
  return e;
}

const zeitText = (ms: number) => {
  const s = ms / 1000, m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

const geraet = matchMedia("(pointer: coarse)").matches;

class App {
  ebene = document.getElementById("ebene")!;
  buehne = document.getElementById("buehne")!;
  hud = document.getElementById("hud")!;
  profil: Profil;
  welt: Welt | null = null;
  weltVersion = -1;
  private lauf: { spiel: Spiel; info: SpielInfo; optionen: Record<string, string>; figur: Figur; eingabe: Eingabe; aus: () => void; pausiert: boolean; fertig: boolean } | null = null;
  private vorschau: { renderer: THREE.WebGLRenderer; avatar: Avatar; aus: boolean } | null = null;

  constructor() {
    let p: Partial<Profil> = {};
    try { p = JSON.parse(localStorage.getItem("fbs_profil") ?? "{}"); } catch { /* leer */ }
    this.profil = { name: p.name ?? "", avatar: { ...STANDARD_AVATAR, ...(p.avatar ?? {}) }, kamera: p.kamera ?? "hinten",
      qualitaet: p.qualitaet ?? (geraet ? "mittel" : "hoch"), optionen: p.optionen ?? {} };
  }

  speichern(server = true) {
    try { localStorage.setItem("fbs_profil", JSON.stringify(this.profil)); } catch { /* privat */ }
    if (server && this.profil.name) api.spielerSpeichern(this.profil.name, this.profil.avatar, { kamera: this.profil.kamera }).catch(() => {});
  }

  async start() {
    try {
      await api.ich();
      this.menue();
    } catch {
      this.anmeldung();
    }
  }

  private zeigen(...inhalt: Node[]) {
    this.vorschauAus();
    this.ebene.replaceChildren(...inhalt);
    this.ebene.hidden = false;
  }

  // --- Anmeldung -----------------------------------------------------------------------
  anmeldung(fehler = "") {
    const kw = h("input", { type: "password", placeholder: "Familien-Kennwort", autocomplete: "current-password" }) as HTMLInputElement;
    const los = async () => {
      try { await api.anmelden(kw.value); this.menue(); }
      catch (e) { this.anmeldung((e as Error).message); }
    };
    kw.onkeydown = (e) => e.key === "Enter" && los();
    this.zeigen(h("div", { class: "karte schmal mitte" },
      h("div", { class: "logo" }, "🏡"), h("h1", {}, "Fernblick-Spiele"),
      h("p", { class: "leise" }, "Bitte das Familien-Kennwort eingeben."), kw,
      fehler ? h("p", { class: "fehler" }, fehler) : null,
      h("button", { class: "gross", onclick: los }, "Los geht's")));
    setTimeout(() => kw.focus(), 50);
  }

  // --- Menü ----------------------------------------------------------------------------
  menue() {
    if (!this.profil.name) return this.spielerWahl();
    const kacheln = SPIELE.map((s) => h("button", { class: "kachel" + (s.bereit ? "" : " bald"), onclick: () => (s.bereit ? this.spielInfo(s) : this.toast(`${s.titel} kommt bald!`)) },
      h("span", { class: "emoji" }, s.emoji), h("strong", {}, s.titel), h("span", { class: "leise" }, s.kurz), s.bereit ? null : h("span", { class: "marke" }, "bald")));
    this.zeigen(h("div", { class: "menue" },
      h("header", {},
        h("div", { class: "titel" }, h("span", { class: "logo" }, "🏡"), h("div", {}, h("h1", {}, "Fernblick-Spiele"), h("span", { class: "leise" }, "Dein Ferienhaus als Spielwelt"))),
        h("div", { class: "spieler" },
          h("button", { class: "chip", onclick: () => this.spielerWahl() }, `👤 ${this.profil.name}`),
          h("button", { class: "chip", onclick: () => this.avatarEditor() }, "🎨 Avatar"),
          h("button", { class: "chip", onclick: () => this.einstellungen() }, "⚙️"))),
      h("div", { class: "kacheln" }, ...kacheln)));
  }

  spielerWahl() {
    const name = h("input", { type: "text", placeholder: "Dein Name", maxlength: 20, value: this.profil.name }) as HTMLInputElement;
    const liste = h("div", { class: "chips" });
    const weiter = (n: string, avatar?: AvatarCfg, kamera?: KameraModus) => {
      n = n.trim();
      if (!n) return;
      this.profil.name = n;
      if (avatar) this.profil.avatar = { ...STANDARD_AVATAR, ...avatar };
      if (kamera) this.profil.kamera = kamera;
      this.speichern();
      this.menue();
    };
    api.spieler().then((alle: any[]) => {
      for (const s of alle) liste.append(h("button", { class: "chip", onclick: () => weiter(s.name, s.avatar, s.einstellungen?.kamera) }, `👤 ${s.name}`));
    }).catch(() => {});
    name.onkeydown = (e) => e.key === "Enter" && weiter(name.value);
    this.zeigen(h("div", { class: "karte schmal mitte" }, h("h2", {}, "Wer spielt?"), liste, name,
      h("button", { class: "gross", onclick: () => weiter(name.value) }, "Weiter")));
    setTimeout(() => name.focus(), 50);
  }

  // --- Avatar-Editor --------------------------------------------------------------------
  avatarEditor() {
    const cfg: AvatarCfg = { ...this.profil.avatar };
    const leinwand = h("div", { class: "avatar-vorschau" });
    const neu = () => this.vorschau?.avatar.setzen({ ...cfg });
    const farben = (titel: string, feld: keyof AvatarCfg, liste: readonly string[]) => h("div", { class: "zeile" }, h("label", {}, titel),
      h("div", { class: "farben" }, ...liste.map((f) => h("button", { class: "farbe" + (cfg[feld] === f ? " an" : ""), style: { background: f }, title: f,
        onclick: (e: Event) => { (cfg as any)[feld] = f; for (const b of (e.target as HTMLElement).parentElement!.children) b.classList.remove("an"); (e.target as HTMLElement).classList.add("an"); neu(); } }))));
    const wahl = (titel: string, feld: keyof AvatarCfg, liste: readonly (readonly [string, string])[]) => h("div", { class: "zeile" }, h("label", {}, titel),
      h("div", { class: "chips" }, ...liste.map(([w, t]) => h("button", { class: "chip" + (cfg[feld] === w ? " an" : ""),
        onclick: (e: Event) => { (cfg as any)[feld] = w; for (const b of (e.target as HTMLElement).parentElement!.children) b.classList.remove("an"); (e.target as HTMLElement).classList.add("an"); neu(); } }, t))));
    this.zeigen(h("div", { class: "editor" },
      h("div", { class: "editor-links" }, leinwand, h("p", { class: "leise mitte-text" }, "Ziehen zum Drehen")),
      h("div", { class: "editor-rechts" },
        h("h2", {}, `Avatar von ${this.profil.name}`),
        farben("Haut", "haut", AUSWAHL.haut), wahl("Frisur", "frisur", AUSWAHL.frisur), farben("Haare", "haare", AUSWAHL.haare),
        wahl("Gesicht", "gesicht", AUSWAHL.gesicht), farben("Augen", "augen", AUSWAHL.augen),
        farben("Oberteil", "oberteil", AUSWAHL.kleidung), farben("Hose", "hose", AUSWAHL.kleidung), farben("Schuhe", "schuhe", AUSWAHL.kleidung),
        wahl("Auf dem Kopf", "kopf", AUSWAHL.kopf), farben("Farbe Kopf", "kopfFarbe", AUSWAHL.kleidung),
        h("div", { class: "knoepfe" },
          h("button", { class: "gross", onclick: () => { this.profil.avatar = cfg; this.speichern(); this.menue(); } }, "Speichern"),
          h("button", { class: "zweit", onclick: () => this.menue() }, "Abbrechen")))));
    this.vorschauStarten(leinwand, cfg);
  }

  private vorschauStarten(behaelter: HTMLElement, cfg: AvatarCfg) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    behaelter.append(renderer.domElement);
    const szene = new THREE.Scene();
    szene.add(new THREE.HemisphereLight(0xffffff, 0x6b5a45, 1.6));
    const sonne = new THREE.DirectionalLight(0xffffff, 1.8);
    sonne.position.set(2, 3, -3);
    szene.add(sonne);
    const kam = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    kam.position.set(0, 1.25, -4.2);
    kam.lookAt(0, 0.95, 0);
    const avatar = new Avatar(cfg);
    szene.add(avatar.gruppe);
    const v = { renderer, avatar, aus: false };
    this.vorschau = v;
    let drehen = 0.4, ziehen: number | null = null;
    renderer.domElement.addEventListener("pointerdown", (e) => (ziehen = e.clientX));
    addEventListener("pointerup", () => (ziehen = null));
    addEventListener("pointermove", (e) => { if (ziehen !== null) { drehen += (e.clientX - ziehen) * 0.012; ziehen = e.clientX; } });
    const bild = () => {
      if (v.aus) return;
      requestAnimationFrame(bild);
      const w = behaelter.clientWidth, hh = behaelter.clientHeight;
      if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, hh); kam.aspect = w / hh; kam.updateProjectionMatrix(); }
      if (ziehen === null) drehen += 0.006;
      avatar.gruppe.rotation.y = drehen;
      avatar.animieren(1 / 60, 0.25, false);
      renderer.render(szene, kam);
    };
    bild();
  }

  private vorschauAus() {
    if (!this.vorschau) return;
    this.vorschau.aus = true;
    this.vorschau.renderer.dispose();
    this.vorschau.renderer.domElement.remove();
    this.vorschau = null;
  }

  // --- Einstellungen --------------------------------------------------------------------
  einstellungen() {
    const chips = <T extends string>(liste: [T, string][], aktuell: T, setzen: (w: T) => void) => h("div", { class: "chips" },
      ...liste.map(([w, t]) => h("button", { class: "chip" + (w === aktuell ? " an" : ""), onclick: () => { setzen(w); this.speichern(); this.einstellungen(); } }, t)));
    this.zeigen(h("div", { class: "karte schmal mitte" }, h("h2", {}, "Einstellungen"),
      h("label", {}, "Grafik"), chips<Qualitaet>([["niedrig", "Schnell"], ["mittel", "Mittel"], ["hoch", "Schön"]], this.profil.qualitaet, (w) => { this.profil.qualitaet = w; this.welt = null; this.buehne.replaceChildren(); this.weltVersion = -1; }),
      h("label", {}, "Kamera beim Start"), chips<KameraModus>(KAMERA_REIHE.map((k) => [k, KAMERA_NAME[k]]), this.profil.kamera, (w) => (this.profil.kamera = w)),
      h("p", { class: "leise" }, geraet ? "Steuerung: linker Daumen laufen, rechts wischen zum Umschauen, Knöpfe für Springen und Ansicht." : "Steuerung: W A S D laufen, Umschalt rennen, Leertaste springen, V Ansicht wechseln, Maus umschauen (Klick fängt die Maus), Esc Pause."),
      h("button", { class: "gross", onclick: () => this.menue() }, "Fertig")));
  }

  // --- Spiel-Info und Start -------------------------------------------------------------
  private variante(info: SpielInfo, opt: Record<string, string>) {
    return info.optionen.map((o) => opt[o.id] ?? o.standard).join("-");
  }

  spielInfo(info: SpielInfo) {
    const opt: Record<string, string> = {};
    for (const o of info.optionen) opt[o.id] = this.profil.optionen[info.id]?.[o.id] ?? o.standard;
    const liste = h("ol", { class: "bestenliste" });
    const ladeListe = () => {
      liste.replaceChildren(h("li", { class: "leise" }, "lädt …"));
      api.bestzeiten(info.id, this.variante(info, opt)).then((l: any[]) => {
        liste.replaceChildren(...(l.length ? l.map((x) => h("li", { class: x.name === this.profil.name ? "ich" : "" }, h("span", {}, x.name), h("span", {}, zeitText(x.zeit_ms)))) : [h("li", { class: "leise" }, "Noch keine Zeiten – sei der Erste!")]));
      }).catch(() => liste.replaceChildren());
    };
    const optionen = info.optionen.map((o) => h("div", { class: "zeile" }, h("label", {}, o.titel), h("div", { class: "chips" },
      ...o.werte.map(([w, t]) => h("button", { class: "chip" + (opt[o.id] === w ? " an" : ""), onclick: (e: Event) => {
        opt[o.id] = w;
        for (const b of (e.target as HTMLElement).parentElement!.children) b.classList.remove("an");
        (e.target as HTMLElement).classList.add("an");
        ladeListe();
      } }, t)))));
    this.zeigen(h("div", { class: "karte mitte info" },
      h("div", { class: "info-kopf" }, h("span", { class: "emoji gross-emoji" }, info.emoji), h("h2", {}, info.titel)),
      h("p", {}, info.text), ...optionen,
      h("h3", {}, "🏆 Bestenliste"), liste,
      h("div", { class: "knoepfe" },
        h("button", { class: "gross", onclick: () => { this.profil.optionen[info.id] = { ...opt }; this.speichern(false); this.spielStarten(info, opt); } }, "▶ Spielen"),
        h("button", { class: "zweit", onclick: () => this.menue() }, "Zurück"))));
    ladeListe();
  }

  private async weltBereit(): Promise<Welt> {
    const meta = await api.weltMeta();
    if (!meta.version) throw new Error("Es gibt noch keine Hauswelt. Papa muss im Planer „Spielwelt übergeben“ drücken.");
    if (this.welt && this.weltVersion === meta.version) return this.welt;
    const balken = h("div", { class: "balken-innen" });
    this.zeigen(h("div", { class: "karte schmal mitte" }, h("div", { class: "logo" }, "🏡"), h("h2", {}, "Das Haus wird geladen …"), h("div", { class: "balken" }, balken)));
    if (!this.welt) this.welt = new Welt(this.buehne, this.profil.qualitaet);
    await this.welt.laden((a) => (balken.style.width = `${Math.round(a * 100)}%`));
    this.weltVersion = meta.version;
    return this.welt;
  }

  async spielStarten(info: SpielInfo, optionen: Record<string, string>) {
    let welt: Welt;
    try { welt = await this.weltBereit(); }
    catch (e) { this.zeigen(h("div", { class: "karte schmal mitte" }, h("h2", {}, "Hoppla"), h("p", {}, (e as Error).message), h("button", { class: "gross", onclick: () => this.menue() }, "Zurück"))); return; }
    this.ebene.hidden = true;
    this.ebene.replaceChildren();
    this.hudBauen();
    const figur = new Figur(welt, this.profil.avatar, this.profil.kamera);
    const eingabe = new Eingabe(welt.renderer.domElement, this.hud);
    const spiel = MODULE[info.id]();
    const lauf = { spiel, info, optionen, figur, eingabe, aus: () => {}, pausiert: false, fertig: false };
    this.lauf = lauf;
    const k: Kontext = { welt, figur, eingabe, optionen, hud: { anzeige: (t) => (document.getElementById("anzeige")!.textContent = t), meldung: (t, ms) => this.meldung(t, ms) },
      fertig: (e) => this.spielFertig(e) };
    spiel.start(k);
    lauf.aus = welt.schleife((dt) => {
      if (eingabe.einmal("pause")) { if (lauf.pausiert) this.weiter(); else if (!lauf.fertig) this.pausieren(); }
      if (lauf.pausiert) return;
      figur.update(dt, eingabe);
      spiel.update(dt);
      while (eingabe.tipps.length) { const t = eingabe.tipps.shift()!; spiel.tipp?.(t.x, t.y); }
      if (eingabe.einmal("aktion")) spiel.tipp?.(innerWidth / 2, innerHeight / 2);
      document.getElementById("ansichtName")!.textContent = KAMERA_NAME[figur.modus];
      document.getElementById("fadenkreuz")!.hidden = !(document.pointerLockElement && figur.modus === "ich");
    });
    welt.start();
  }

  private hudBauen() {
    this.hud.replaceChildren(...[
      h("div", { class: "hud-oben" }, h("div", { id: "anzeige", class: "anzeige" }, ""),
        h("div", { class: "hud-knoepfe" },
          h("button", { class: "rund", title: "Ansicht wechseln (V)", onclick: () => { this.lauf?.figur.ansichtWeiter(); this.profil.kamera = this.lauf!.figur.modus; this.speichern(false); } }, "👁"),
          h("button", { class: "rund", title: "Pause (Esc)", onclick: () => this.pausieren() }, "⏸"))),
      h("div", { id: "ansichtName", class: "ansicht-name" }, ""),
      h("div", { id: "meldung", class: "meldung", hidden: true }, ""),
      h("div", { id: "fadenkreuz", class: "fadenkreuz", hidden: true }, "+"),
      geraet ? h("button", { class: "sprung", ontouchstart: (e: Event) => { e.preventDefault(); this.lauf?.eingabe.springen(); } }, "⤒") : null,
    ].filter((x) => !!x) as HTMLElement[]);
    this.hud.hidden = false;
  }

  private meldungTimer = 0;
  meldung(text: string, ms = 1500) {
    const m = document.getElementById("meldung");
    if (!m) return;
    m.textContent = text;
    m.hidden = false;
    clearTimeout(this.meldungTimer);
    this.meldungTimer = window.setTimeout(() => (m.hidden = true), ms);
  }

  toast(text: string) {
    const t = h("div", { class: "toast" }, text);
    document.body.append(t);
    setTimeout(() => t.remove(), 1800);
  }

  pausieren() {
    const l = this.lauf;
    if (!l || l.fertig) return;
    l.pausiert = true;
    l.figur.gesperrt = true;
    l.spiel.pause?.(true);
    if (document.pointerLockElement) document.exitPointerLock();
    this.zeigen(h("div", { class: "karte schmal mitte" }, h("h2", {}, "Pause"),
      h("button", { class: "gross", onclick: () => this.weiter() }, "▶ Weiter"),
      h("button", { class: "zweit", onclick: () => { const { info, optionen } = l; this.spielBeenden(); this.spielStarten(info, optionen); } }, "↻ Neu starten"),
      h("button", { class: "zweit", onclick: () => { this.spielBeenden(); this.menue(); } }, "☰ Zurück zum Menü")));
  }

  weiter() {
    const l = this.lauf;
    if (!l) return;
    this.ebene.hidden = true;
    l.pausiert = false;
    l.figur.gesperrt = false;
    l.spiel.pause?.(false);
  }

  private async spielFertig(e: { zeit_ms: number; punkte: number; text: string }) {
    const l = this.lauf;
    if (!l) return;
    l.fertig = true;
    l.figur.gesperrt = true;
    if (document.pointerLockElement) document.exitPointerLock();
    const variante = this.variante(l.info, l.optionen);
    const liste = h("ol", { class: "bestenliste" });
    const platz = h("p", { class: "platz" }, "");
    setTimeout(() => this.zeigen(h("div", { class: "karte schmal mitte" },
      h("div", { class: "logo" }, "🏆"), h("h2", {}, e.text), h("p", { class: "zeit-gross" }, zeitText(e.zeit_ms)), platz, liste,
      h("button", { class: "gross", onclick: () => { const { info, optionen } = l; this.spielBeenden(); this.spielStarten(info, optionen); } }, "↻ Nochmal"),
      h("button", { class: "zweit", onclick: () => { this.spielBeenden(); this.menue(); } }, "☰ Menü"))), 900);
    try {
      const r = await api.bestzeit({ spiel: l.info.id, variante, name: this.profil.name, zeit_ms: e.zeit_ms, punkte: e.punkte });
      platz.textContent = r.platz === 1 ? "🥇 Neuer Rekord!" : `Platz ${r.platz}`;
      liste.replaceChildren(...r.liste.map((x: any) => h("li", { class: x.name === this.profil.name && x.zeit_ms === e.zeit_ms ? "ich" : "" }, h("span", {}, x.name), h("span", {}, zeitText(x.zeit_ms)))));
    } catch { platz.textContent = ""; }
  }

  spielBeenden() {
    const l = this.lauf;
    if (!l) return;
    l.aus();
    l.spiel.ende();
    l.figur.entfernen();
    l.eingabe.freigeben();
    this.welt?.stopp();
    this.hud.hidden = true;
    this.hud.replaceChildren();
    this.lauf = null;
  }
}

const app = new App();
(window as any).fbs = app;
(window as any).fbsTHREE = THREE;
app.start();
