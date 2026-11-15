// Eingabe für PC (WASD, Maus mit Pointer-Lock) und Tablet/Handy (Steuerknüppel links, Wischen rechts, Knöpfe)
export interface Tipp { x: number; y: number }

export class Eingabe {
  vor = 0;
  seit = 0;
  rennen = false;
  private sprungGedrueckt = false;
  private tasten = new Set<string>();
  private blick = { dx: 0, dy: 0 };
  tipps: Tipp[] = [];
  aktion = false;
  ansichtWechsel = false;
  pause = false;
  readonly touch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  private knueppel: { id: number; x0: number; y0: number } | null = null;
  private wisch = new Map<number, { x: number; y: number; x0: number; y0: number; t: number }>();
  private aus: (() => void)[] = [];
  private knopfBasis!: HTMLElement;
  private knopfGriff!: HTMLElement;

  constructor(private flaeche: HTMLElement, private hud: HTMLElement) {
    const an = <K extends keyof WindowEventMap>(ziel: Window | HTMLElement, typ: K | string, fn: (e: any) => void, opt?: any) => {
      ziel.addEventListener(typ as any, fn, opt);
      this.aus.push(() => ziel.removeEventListener(typ as any, fn, opt));
    };
    an(window, "keydown", (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input")) return;
      this.tasten.add(e.code);
      if (e.code === "Space") { this.sprungGedrueckt = true; e.preventDefault(); }
      if (e.code === "KeyV") this.ansichtWechsel = true;
      if (e.code === "KeyE" || e.code === "Enter") this.aktion = true;
      if (e.code === "Escape" || e.code === "KeyP") this.pause = true;
      this.achsen();
    });
    an(window, "keyup", (e: KeyboardEvent) => { this.tasten.delete(e.code); this.achsen(); });
    an(window, "blur", () => { this.tasten.clear(); this.achsen(); });
    // Maus: Klick fängt den Zeiger (Blick mit der Maus), ohne Fang Ziehen = umschauen
    let ziehen: { x: number; y: number; x0: number; y0: number } | null = null;
    an(flaeche, "mousedown", (e: MouseEvent) => {
      if (this.touch) return;
      if (document.pointerLockElement === flaeche) { this.tipps.push({ x: innerWidth / 2, y: innerHeight / 2 }); return; }
      ziehen = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY };
    });
    an(window, "mousemove", (e: MouseEvent) => {
      if (document.pointerLockElement === flaeche) { this.blick.dx += e.movementX; this.blick.dy += e.movementY; return; }
      if (ziehen) { this.blick.dx += e.clientX - ziehen.x; this.blick.dy += e.clientY - ziehen.y; ziehen.x = e.clientX; ziehen.y = e.clientY; }
    });
    an(window, "mouseup", (e: MouseEvent) => {
      if (!ziehen) return;
      const kurz = Math.hypot(e.clientX - ziehen.x0, e.clientY - ziehen.y0) < 6;
      ziehen = null;
      if (kurz) { this.tipps.push({ x: e.clientX, y: e.clientY }); flaeche.requestPointerLock?.(); }
    });
    // Touch: linke Hälfte Steuerknüppel, rechte Hälfte Blick und Antippen
    an(flaeche, "touchstart", (e: TouchEvent) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < innerWidth * 0.42 && !this.knueppel) {
          this.knueppel = { id: t.identifier, x0: t.clientX, y0: t.clientY };
          this.knueppelZeigen(t.clientX, t.clientY, 0, 0);
        } else this.wisch.set(t.identifier, { x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY, t: performance.now() });
      }
    }, { passive: false });
    an(flaeche, "touchmove", (e: TouchEvent) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (this.knueppel?.id === t.identifier) {
          const r = 55;
          let dx = t.clientX - this.knueppel.x0, dy = t.clientY - this.knueppel.y0;
          const l = Math.hypot(dx, dy);
          if (l > r) { dx *= r / l; dy *= r / l; }
          this.seit = dx / r;
          this.vor = -dy / r;
          this.rennen = l > r * 1.6;
          this.knueppelZeigen(this.knueppel.x0, this.knueppel.y0, dx, dy);
          continue;
        }
        const w = this.wisch.get(t.identifier);
        if (w) { this.blick.dx += (t.clientX - w.x) * 1.6; this.blick.dy += (t.clientY - w.y) * 1.6; w.x = t.clientX; w.y = t.clientY; }
      }
    }, { passive: false });
    const ende = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (this.knueppel?.id === t.identifier) { this.knueppel = null; this.vor = this.seit = 0; this.rennen = false; this.knueppelVerstecken(); }
        const w = this.wisch.get(t.identifier);
        if (w) {
          if (Math.hypot(t.clientX - w.x0, t.clientY - w.y0) < 12 && performance.now() - w.t < 350) this.tipps.push({ x: t.clientX, y: t.clientY });
          this.wisch.delete(t.identifier);
        }
      }
    };
    an(flaeche, "touchend", ende);
    an(flaeche, "touchcancel", ende);
    this.knueppelBauen();
  }

  private achsen() {
    if (this.knueppel) return;
    const k = this.tasten;
    this.vor = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    this.seit = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    this.rennen = k.has("ShiftLeft") || k.has("ShiftRight");
  }

  private knueppelBauen() {
    this.knopfBasis = document.createElement("div");
    this.knopfBasis.className = "knueppel";
    this.knopfGriff = document.createElement("div");
    this.knopfGriff.className = "knueppel-griff";
    this.knopfBasis.append(this.knopfGriff);
    this.knopfBasis.hidden = true;
    this.hud.append(this.knopfBasis);
  }

  private knueppelZeigen(x: number, y: number, dx: number, dy: number) {
    this.knopfBasis.hidden = false;
    this.knopfBasis.style.left = `${x}px`;
    this.knopfBasis.style.top = `${y}px`;
    this.knopfGriff.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  private knueppelVerstecken() {
    this.knopfBasis.hidden = true;
  }

  springen() { this.sprungGedrueckt = true; }

  /** Taste gerade gedrückt (KeyboardEvent.code, z. B. "KeyQ", "ShiftLeft") */
  taste(code: string): boolean { return this.tasten.has(code); }
  /** Spiel-Knöpfe im HUD (gedrückt halten), siehe Hud.knopf */
  knoepfe: Record<string, boolean> = {};
  /** einmal pro Bild abholen */
  sprung(): boolean { const s = this.sprungGedrueckt; this.sprungGedrueckt = false; return s; }
  blickAbholen(): { dx: number; dy: number } { const b = { ...this.blick }; this.blick.dx = this.blick.dy = 0; return b; }
  einmal(feld: "aktion" | "ansichtWechsel" | "pause"): boolean { const v = this[feld]; this[feld] = false; return v; }

  freigeben() {
    for (const f of this.aus) f();
    this.knopfBasis.remove();
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
