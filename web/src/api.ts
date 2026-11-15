// REST-Zugriff auf den Spiele-Server (Sitzung per Cookie)
async function antwort(r: Response): Promise<any> {
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const e = new Error(d.detail ?? `${r.status} ${r.statusText}`) as Error & { status: number };
    e.status = r.status;
    throw e;
  }
  return r.json();
}
const json = (method: string, body: any) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  ich: () => fetch("/api/ich").then(antwort),
  anmelden: (kennwort: string) => fetch("/api/anmelden", json("POST", { kennwort })).then(antwort),
  weltMeta: () => fetch("/api/welt/meta").then(antwort),
  spieler: () => fetch("/api/spieler").then(antwort),
  spielerSpeichern: (name: string, avatar: any, einstellungen: any) =>
    fetch(`/api/spieler/${encodeURIComponent(name)}`, json("PUT", { avatar, einstellungen })).then(antwort),
  bestzeiten: (spiel: string, variante: string) =>
    fetch(`/api/bestzeiten?spiel=${encodeURIComponent(spiel)}&variante=${encodeURIComponent(variante)}`).then(antwort),
  bestzeit: (d: { spiel: string; variante: string; name: string; zeit_ms: number; punkte: number }) =>
    fetch("/api/bestzeiten", json("POST", d)).then(antwort),
};
