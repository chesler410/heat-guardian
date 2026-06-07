// Local-first storage (no backend/accounts): swimmers + imported meets in localStorage.
// Meets keep their FULL parsed roster so you can search swimmers and add them any time
// (re-matching is automatic). COPPA-friendly: nothing leaves the device.
import { parseHeatSheet } from "./parser";
import { eventMeta } from "./cuts";

export interface Entry {
  event: number;
  race: string; // "100 Fly"
  desc: string;
  heat: string | null;
  lane: number;
  name: string; // as printed: "Last, First M"
  age: string;
  team: string;
  seed: string;
  session: string | null; // e.g. "Friday Morning", from the heat sheet
  relay?: boolean;
}

export interface Meet {
  id: string;
  title: string;
  importedAt: number;
  entries: Entry[];
  source: "upload" | "url";
}

export interface Swimmer {
  id: string;
  name: string; // canonical name picked from a roster, "Last, First"
  team?: string;
  age?: number;
  gender?: "Girls" | "Boys";
  color: string;
}

export interface RosterItem {
  name: string;
  team: string;
  age: string;
  gender?: "Girls" | "Boys";
  count: number;
}

const SWIMMERS = "swimmers";
const MEETS = "meets";
const RESULTS = "results";
const PROXY = "proxyUrl";
const COLORS = ["#0b3d91", "#1f9d57", "#b3501f", "#7d4bd0", "#c2185b", "#0a8a8a"];
const uid = () => Math.random().toString(36).slice(2, 9);

function load<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

export const loadSwimmers = () => load<Swimmer>(SWIMMERS);
export const saveSwimmers = (s: Swimmer[]) => localStorage.setItem(SWIMMERS, JSON.stringify(s));
export const loadMeets = () => load<Meet>(MEETS);
export const saveMeets = (m: Meet[]) => localStorage.setItem(MEETS, JSON.stringify(m));
export const loadProxy = () => localStorage.getItem(PROXY) || "";
export const saveProxy = (u: string) => localStorage.setItem(PROXY, u.trim());

export function makeSwimmer(name: string, team: string, index: number, age?: number, gender?: "Girls" | "Boys"): Swimmer {
  return { id: uid(), name: name.trim(), team: team.trim() || undefined, age, gender, color: COLORS[index % COLORS.length] };
}

// Manual result times entered on deck, keyed by meet+event+swimmer.
export const resultKey = (meetId: string, event: number, name: string) => `${meetId}|${event}|${name}`;
export function loadResults(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(RESULTS) || "{}"); } catch { return {}; }
}
export function saveResults(r: Record<string, string>) {
  localStorage.setItem(RESULTS, JSON.stringify(r));
}

const tokens = (s: string) => s.toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);

export function matchesName(swimmerName: string, entryName: string): boolean {
  const k = tokens(swimmerName);
  const e = new Set(tokens(entryName));
  return k.length > 0 && k.every((t) => e.has(t));
}

// Unique swimmers across all imported meets, for live search. Age/gender come from the
// LATEST imported meet (swimmers age up), so process oldest→newest and let the latest win.
export function buildRoster(meets: Meet[]): RosterItem[] {
  const map = new Map<string, RosterItem>();
  for (const m of [...meets].sort((a, b) => a.importedAt - b.importedAt))
    for (const e of m.entries) {
      const key = `${e.name}|${e.team}`;
      const gender = eventMeta(e.desc).gender ?? undefined;
      const cur = map.get(key);
      if (cur) {
        cur.count++;
        cur.age = e.age; // latest meet wins
        if (gender) cur.gender = gender;
      } else {
        map.set(key, { name: e.name, team: e.team, age: e.age, gender, count: 1 });
      }
    }
  return [...map.values()].sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
}

function toMeet(title: string, entries: any[], fallback: string, source: "upload" | "url"): Meet {
  const mapped: Entry[] = entries.map((r) => ({
    ...r,
    race: eventMeta(r.desc).race + (r.relay ? " Relay" : ""),
  }));
  return { id: uid(), title: title || fallback, importedAt: Date.now(), entries: mapped, source };
}

export async function importBuffer(buf: ArrayBuffer, fallback: string, source: "upload" | "url"): Promise<Meet> {
  const { title, entries } = await parseHeatSheet(buf);
  if (!entries.length) throw new Error("No events found — is this a Hy-Tek heat sheet PDF?");
  return toMeet(title, entries, fallback, source);
}

export async function importFile(file: File): Promise<Meet> {
  return importBuffer(await file.arrayBuffer(), file.name.replace(/\.pdf$/i, ""), "upload");
}

const isPdf = (buf: ArrayBuffer) => {
  const b = new Uint8Array(buf.slice(0, 5));
  return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
};

// Fetch a PDF by URL. Browsers block cross-origin fetches unless the host allows CORS,
// so we try the shared fetch helper first, then a direct fetch (CORS-friendly hosts only).
export async function fetchPdfBuffer(url: string, proxy: string): Promise<ArrayBuffer> {
  const enc = encodeURIComponent(url);
  const tries: string[] = [];
  if (proxy) tries.push(proxy.includes("{url}") ? proxy.replace("{url}", enc) : proxy + enc);
  tries.push(url); // direct (works only if the host sends CORS headers)
  for (const t of tries) {
    try {
      const res = await fetch(t);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (isPdf(buf)) return buf;
    } catch {
      /* try next */
    }
  }
  throw new Error("Couldn't open that link here — tap “Upload PDF” instead and pick the file.");
}

export async function importUrl(url: string, proxy: string): Promise<Meet> {
  const buf = await fetchPdfBuffer(url.trim(), proxy);
  const fallback = url.split("/").pop()?.replace(/\.pdf.*$/i, "") || "Meet";
  return importBuffer(buf, fallback, "url");
}
