// Gemeinsame Schnittstelle aller Spiele (Module) und die Liste fürs Menü
import { Welt } from "../welt";
import { Figur } from "../figur";
import { Eingabe } from "../eingabe";

export interface Option { id: string; titel: string; werte: [string, string][]; standard: string }

export interface SpielInfo {
  id: string;
  titel: string;
  emoji: string;
  kurz: string;
  text: string;
  bereit: boolean;
  optionen: Option[];
  /** "zeit" (Standard, kürzeste Zeit gewinnt) oder "punkte" (meiste Punkte gewinnen, Server: PUNKTE_SPIELE) */
  wertung?: "zeit" | "punkte";
  /** Einheit der Punkte für Bestenliste und Endbildschirm, z. B. "Sekunden", "Münzen", "Nächte" */
  einheit?: string;
  /** ohne Bestenliste (Kreativ, Verstecken online) */
  ohneListe?: boolean;
}

export interface Hud {
  anzeige(text: string): void;
  meldung(text: string, ms?: number): void;
  /** Zusätzlicher runder Knopf rechts (über dem Sprungknopf); solange gedrückt ist eingabe.knoepfe[id] = true.
   *  beiDruck wird beim Drücken aufgerufen (für Einmal-Aktionen). Gibt das Element zurück (Text änderbar). */
  knopf(id: string, text: string, beiDruck?: () => void): HTMLElement;
  /** Freie HUD-Fläche unten mittig (z. B. Inventar, Farbpalette); wird beim Spielende geleert */
  leiste(): HTMLElement;
}

export interface Kontext {
  welt: Welt;
  figur: Figur;
  eingabe: Eingabe;
  hud: Hud;
  optionen: Record<string, string>;
  /** Name und Avatar des Spielers (für Online-Spiele und Speicherstände) */
  spieler: { name: string; avatar: any };
  /** Spiel zu Ende: Zeit in ms (für die Bestenliste), Text für den Endbildschirm */
  fertig(ergebnis: { zeit_ms: number; punkte: number; text: string }): void;
}

export interface Spiel {
  start(k: Kontext): void;
  update(dt: number): void;
  /** Antippen/Klicken an Bildschirmposition; true = verbraucht */
  tipp?(x: number, y: number): boolean;
  /** Pausezeit nicht mitzählen */
  pause?(an: boolean): void;
  ende(): void;
}

export const SPIELE: SpielInfo[] = [
  {
    id: "suchen", titel: "Schatzsuche", emoji: "💎", kurz: "Finde alle versteckten Schätze im Haus",
    text: "Im ganzen Haus sind Schätze versteckt – auf Regalen, unter Betten, hinter dem Sofa, oben auf der Galerie. Lauf herum und sammle alle ein, so schnell du kannst. Antippen oder einfach hinlaufen!",
    bereit: true,
    optionen: [
      { id: "stufe", titel: "Schwierigkeit", werte: [["leicht", "Leicht (5, leuchten)"], ["mittel", "Mittel (8)"], ["schwer", "Schwer (12, gut versteckt)"]], standard: "leicht" },
      { id: "zeit", titel: "Tageszeit", werte: [["tag", "☀️ Tag"], ["nacht", "🔦 Nacht mit Taschenlampe"]], standard: "tag" },
    ],
  },
  { id: "lava", titel: "Der Boden ist Lava", emoji: "🌋", kurz: "Die Lava steigt – klettere nach oben!", text: "", bereit: false, optionen: [] },
  { id: "parcours", titel: "Parcours", emoji: "🏃", kurz: "Über Möbel und Balken zum Ziel", text: "", bereit: false, optionen: [] },
  { id: "drohne", titel: "Drohnenrennen", emoji: "🚁", kurz: "Flieg durch die Ringe", text: "", bereit: false, optionen: [] },
  { id: "escape", titel: "Escape-Room", emoji: "🔐", kurz: "Finde den Weg nach draußen", text: "", bereit: false, optionen: [] },
  { id: "kreativ", titel: "Kreativ", emoji: "🧱", kurz: "Bau deine eigene Welt", text: "", bereit: false, optionen: [] },
  { id: "tycoon", titel: "Ferienhaus-Tycoon", emoji: "💰", kurz: "Richte ein und mach Gäste glücklich", text: "", bereit: false, optionen: [] },
  { id: "verstecken", titel: "Verstecken online", emoji: "🙈", kurz: "Zu zweit auf zwei Geräten", text: "", bereit: false, optionen: [] },
];
