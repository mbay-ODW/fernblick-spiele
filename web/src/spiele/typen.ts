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
  /** auch zusammen online spielbar (Raum mit Code, gemeinsamer Start, Mitspieler sichtbar) */
  mehrspieler?: boolean;
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
  /** Nur beim Zusammen-Spielen: Raum (senden/hoeren) und die Mitspieler */
  mp?: { raum: import("../mehrspieler").Raum; mitspieler: import("../mehrspieler").Mitspieler };
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
  {
    id: "lava", titel: "Der Boden ist Lava", emoji: "🌋", kurz: "Die Lava steigt – klettere nach oben!",
    text: "Gleich wird der Boden zu glühender Lava! Sie steigt immer weiter: erst über den Boden, dann über Sofa und Betten, dann die Treppe hoch bis ins Obergeschoss. Spring auf Möbel, renn die Treppe hoch und finde die höchsten Plätze. Wer die Lava berührt, ist raus – wie lange hältst du durch? Zusammen: Wer bleibt am längsten übrig?",
    bereit: true, wertung: "punkte", einheit: "Sekunden", mehrspieler: true,
    optionen: [
      { id: "tempo", titel: "Tempo", werte: [["langsam", "🐢 Langsam"], ["normal", "🙂 Normal"], ["schnell", "🔥 Schnell"]], standard: "normal" },
    ],
  },
  {
    id: "parcours", titel: "Parcours", emoji: "🏃", kurz: "Über Möbel und Treppe bis ins Ziel im Garten",
    text: "Lauf und spring der Reihe nach zu allen leuchtenden Ringen: über Möbel, die Treppe hoch, oben weiter, wieder runter und durch die Glasfront über die Terrasse und die Gartentreppe ins Ziel. Der Pfeil oben zeigt dir den Weg. Profis spielen mit „Boden verboten“: Wer im Haus den Fußboden berührt, muss zurück! Zusammen: Wettrennen auf derselben Strecke.",
    bereit: true, mehrspieler: true,
    optionen: [
      { id: "laenge", titel: "Strecke", werte: [["kurz", "Kurz"], ["lang", "Lang"]], standard: "kurz" },
      { id: "boden", titel: "Fußboden", werte: [["erlaubt", "Erlaubt"], ["verboten", "😬 Verboten"]], standard: "erlaubt" },
    ],
  },
  {
    id: "drohne", titel: "Drohnenrennen", emoji: "🚁", kurz: "Flieg durch die Ringe rund ums Haus",
    text: "Steuere eine kleine Drohne von der Terrasse aus durch alle leuchtenden Ringe: über den Garten, um die Bäume, an der Hecke entlang, über den Hof und das Dach und zurück. Der gelbe Ring ist der nächste. Hoch: Leertaste/E oder ⬆, runter: Umschalt/Q oder ⬇, drehen mit Maus oder Wischen.",
    bereit: true, wertung: "zeit",
    optionen: [{ id: "ringe", titel: "Strecke", werte: [["leicht", "Leicht (große Ringe)"], ["schwer", "Schwer (kleine Ringe, mehr)"]], standard: "leicht" }],
  },
  {
    id: "escape", titel: "Escape-Room", emoji: "🔐", kurz: "Finde den Code und entkomme",
    text: "Alle Türen sind verriegelt! Im Haus sind vier farbige Karten mit Ziffern versteckt. Der Zettel 📜 verrät, in welchen Räumen. Sammle alle ein und tipp den Code am Tastenfeld an der Tür ein, in der Reihenfolge der Farben auf dem Schild. Falscher Code kostet 10 Sekunden.",
    bereit: true, wertung: "zeit",
    optionen: [{ id: "stufe", titel: "Schwierigkeit", werte: [["leicht", "Leicht (Karten leuchten, genaue Hinweise)"], ["schwer", "Schwer (Rätsel-Hinweise, kein Leuchten)"]], standard: "leicht" }],
  },
  {
    id: "kreativ", titel: "Kreativ", emoji: "🧱", kurz: "Bau deine eigene Welt", ohneListe: true, bereit: true,
    text: "Bau mit bunten Klötzchen, was du willst – Türme, Brücken, eine Burg im Garten! Mit 🧱 setzt du Blöcke, mit ⛏ baust du sie ab. Unten wählst du die Farbe. Auf deine Blöcke kannst du draufklettern. Dein Bauwerk wird automatisch gespeichert. PC: Klick = bauen/abbauen, 1–0 Farbe, R wechselt zwischen Bauen und Abbauen.",
    optionen: [],
  },
  {
    id: "tycoon", titel: "Ferienhaus-Tycoon", emoji: "💰", kurz: "Mach die Gäste glücklich", wertung: "punkte", einheit: "Münzen", bereit: true,
    text: "Du bist heute der Gastgeber im Fernblick! Gäste kommen an und haben Wünsche: Bett machen, Klopapier, Frühstück, Heizung … Lauf schnell hin, dann gibt's Münzen. Je schneller, desto mehr! Wartet ein Gast zu lange, gibt's schlechte Sterne.",
    optionen: [{ id: "dauer", titel: "Wie lange?", werte: [["3", "3 Minuten"], ["5", "5 Minuten"]], standard: "3" }],
  },
  {
    id: "feuerwache", titel: "Feuerwache – Nächte im Odenwald", emoji: "🔥", kurz: "Holz hacken, Ofen heizen, die Nacht überstehen",
    text: "Tagsüber fällst du draußen mit der Axt Bäume und trägst das Holz im Rucksack nach Hause in den Ofen im HWR. Nachts schleichen Nachtschatten ums Haus. Sie haben Angst vor Licht: Solange das Feuer brennt, trauen sie sich nicht hinein, und mit der Taschenlampe kannst du sie verscheuchen. Geht das Feuer aus, wird es gefährlich! Wie viele Nächte schaffst du?",
    bereit: true, wertung: "punkte", einheit: "Nächte",
    optionen: [
      { id: "tempo", titel: "Tageslänge", werte: [["kurz", "Kurz (1 Min. Tag)"], ["normal", "Normal (1,5 Min. Tag)"]], standard: "normal" },
      { id: "naechte", titel: "Ziel", werte: [["10", "10 Nächte"], ["99", "99 Nächte"]], standard: "10" },
    ],
  },
  {
    id: "verstecken", titel: "Verstecken online", emoji: "🙈", kurz: "Zu zweit (oder mehr) auf mehreren Geräten",
    text: "Ein Gerät öffnet einen Raum und zeigt einen Code, die anderen geben den Code ein. Der Gastgeber 👑 startet die Runde: Einer sucht, alle anderen haben 30 Sekunden zum Verstecken – der Sucher hat so lange die Augen zu. Danach 4 Minuten suchen: Geh nah ran oder tippe die anderen an, wenn du sie siehst. Findet der Sucher alle, gewinnt er – sonst gewinnen die Versteckten!",
    bereit: true, ohneListe: true, optionen: [],
  },
];
