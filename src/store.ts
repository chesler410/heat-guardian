// Local-first storage (no backend/accounts): swimmers + imported meets in localStorage.
// Meets keep their FULL parsed roster so you can search swimmers and add them any time
// (re-matching is automatic). COPPA-friendly: nothing leaves the device.
import { parsePdf, Finisher } from "./parser";
import { parseSdif, looksLikeSdif } from "./sdif";
import { eventMeta, fmt } from "./cuts";

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
  sourceUrl?: string; // the link it came from (url imports), so the meet can be re-shared
  start?: string; // meet's first day (ISO), for Day-N / dated session headers
}

export interface Swimmer {
  id: string;
  name: string; // canonical name picked from a roster, "Last, First"
  team?: string;
  age?: number;
  gender?: "Girls" | "Boys";
  color: string;
  watch?: boolean; // true = on the watch list (follow), false/undefined = your own swimmer
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

export function makeSwimmer(name: string, team: string, index: number, age?: number, gender?: "Girls" | "Boys", watch?: boolean): Swimmer {
  return { id: uid(), name: name.trim(), team: team.trim() || undefined, age, gender, color: COLORS[index % COLORS.length], watch };
}

// Coach mode: turn a team's full roster into swimmer objects for the home/progress views.
// Ids are deterministic (so filter chips stay stable) and these are NOT persisted as the
// user's own swimmers — they're derived live from imported meets for the chosen team.
export function teamSwimmers(meets: Meet[], team: string): Swimmer[] {
  return buildRoster(meets)
    .filter((r) => (r.team || "") === team)
    .map((r, i) => ({
      id: "coach:" + r.name + "|" + r.team,
      name: r.name,
      team: r.team,
      age: parseInt(r.age, 10) || undefined,
      gender: r.gender,
      color: COLORS[i % COLORS.length],
    }));
}

// Roster grouped by team, for the Team browse view.
export function buildTeams(meets: Meet[]): { team: string; swimmers: RosterItem[] }[] {
  const map = new Map<string, RosterItem[]>();
  for (const it of buildRoster(meets)) {
    const t = it.team || "—";
    if (!map.has(t)) map.set(t, []);
    map.get(t)!.push(it);
  }
  return [...map.entries()]
    .map(([team, swimmers]) => ({ team, swimmers }))
    .sort((a, b) => a.team.localeCompare(b.team));
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

function toMeet(title: string, entries: any[], fallback: string, source: "upload" | "url", sourceUrl?: string, start?: string): Meet {
  const mapped: Entry[] = entries.map((r) => ({
    ...r,
    race: eventMeta(r.desc).race + (r.relay ? " Relay" : ""),
  }));
  return { id: uid(), title: title || fallback, importedAt: Date.now(), entries: mapped, source, sourceUrl, start };
}

export type ImportOutcome =
  | { kind: "meet"; meet: Meet; results?: Record<string, string> } // results: meet-pack overlay, keys WITHOUT the meet-id prefix
  | { kind: "results"; title: string; finishers: Finisher[] };

// Meet pack (.heatguardian.json): the already-parsed meet + its result overlay as a small file,
// so meets imported from uploaded PDFs can be shared too (no re-fetch/re-parse for the
// recipient). Result keys are stored WITHOUT the meet-id prefix — ids are random per device,
// so the importer re-prefixes them with the new meet's id.
export function buildMeetPack(meet: Meet, results: Record<string, string>) {
  const slice: Record<string, string> = {};
  const prefix = meet.id + "|";
  for (const [k, v] of Object.entries(results)) if (k.startsWith(prefix)) slice[k.slice(prefix.length)] = v;
  return {
    app: "heat-guardian" as const,
    kind: "meet-pack" as const,
    v: 1 as const,
    meet: { title: meet.title, start: meet.start, sourceUrl: meet.sourceUrl, entries: meet.entries },
    results: slice,
  };
}

export function parseMeetPack(text: string, fallback = "Meet"): { meet: Meet; results: Record<string, string> } | null {
  try {
    const p = JSON.parse(text);
    // Accept the current id and the pre-rename "my-swimmer" id so older shared packs still import.
    if ((p?.app !== "heat-guardian" && p?.app !== "my-swimmer") || p?.kind !== "meet-pack" || p?.v !== 1 || !Array.isArray(p?.meet?.entries)) return null;
    const src = p.meet.sourceUrl ? "url" : "upload"; // keep the link so the recipient can re-share it
    const meet = toMeet(p.meet.title, p.meet.entries, fallback, src, p.meet.sourceUrl || undefined, p.meet.start || undefined);
    return { meet, results: p.results && typeof p.results === "object" ? p.results : {} };
  } catch {
    return null;
  }
}

export async function importBuffer(buf: ArrayBuffer, fallback: string, source: "upload" | "url", sourceUrl?: string): Promise<ImportOutcome> {
  // SD3 / SDIF and meet packs are plain text (not a PDF). Detect and parse into a meet.
  if (!isPdf(buf)) {
    const text = new TextDecoder("utf-8").decode(buf);
    const pack = parseMeetPack(text, fallback);
    if (pack) return { kind: "meet", ...pack };
    if (looksLikeSdif(text)) {
      const s = parseSdif(text);
      if (!s.entries.length) throw new Error("No events found in this SD3 file.");
      return { kind: "meet", meet: toMeet(s.title, s.entries, fallback, source, sourceUrl) };
    }
  }
  const r = await parsePdf(buf);
  if (r.kind === "results") {
    if (!r.finishers.length) throw new Error("No results found in this PDF.");
    return { kind: "results", title: r.title, finishers: r.finishers };
  }
  if (!r.entries.length) throw new Error("No events found — is this a Hy-Tek heat sheet or results PDF?");
  return { kind: "meet", meet: toMeet(r.title, r.entries, fallback, source, sourceUrl, r.start) };
}

export async function importFile(file: File): Promise<ImportOutcome> {
  return importBuffer(await file.arrayBuffer(), file.name.replace(/(\.(heatguardian|myswimmer))?\.(pdf|sd3|zip|hy3|cl2|json)$/i, ""), "upload");
}

// Apply a results sheet to existing meets: fill the actual (Finals) time for each matched
// swimmer's event (matched by name + race key + course), so cuts recompute and PBs show.
export function applyResults(
  finishers: Finisher[],
  swimmers: Swimmer[],
  meets: Meet[],
  results: Record<string, string>
): { results: Record<string, string>; matched: number } {
  const next = { ...results };
  let matched = 0;
  for (const f of finishers) {
    const sw = swimmers.find((s) => matchesName(s.name, f.name));
    if (!sw) continue;
    const fm = eventMeta(f.desc);
    if (!fm.key) continue;
    for (const m of meets)
      for (const e of m.entries) {
        if (!matchesName(sw.name, e.name)) continue;
        const em = eventMeta(e.desc);
        if (em.key === fm.key && em.course === fm.course) {
          next[resultKey(m.id, e.event, sw.name)] = f.finals;
          matched++;
        }
      }
  }
  return { results: next, matched };
}

// ---- Per-swimmer progress: best time per event across every imported meet ----
const _toSec = (t: string): number => {
  const s = (t || "").replace("*", "").trim();
  if (!s || s === "NT") return NaN;
  if (s.includes(":")) {
    const [m, sec] = s.split(":");
    return parseInt(m, 10) * 60 + parseFloat(sec);
  }
  return parseFloat(s);
};
const courseOf = (desc: string): string =>
  /LC Meter/i.test(desc) ? "LCM" : /SC Yard/i.test(desc) ? "SCY" : /SC Meter/i.test(desc) ? "SCM" : "";

export interface ProgressEvent {
  key: string; // "100 FR"
  race: string; // "100 Free"
  course: string; // LCM / SCY / SCM / ""
  desc: string; // a representative event description (for cut computation)
  best: string; // best (fastest) time, formatted
  bestSec: number;
  count: number; // number of recorded swims for this event
  drop: number | null; // seconds dropped from slowest→fastest (improvement), if >1 swim
}
export interface SwimmerProgress {
  swimmer: Swimmer;
  events: ProgressEvent[];
}

// For each swimmer, gather their fastest time per event (course-aware) across all meets,
// using the actual (results/manual) time when present, otherwise the seed/entry time.
export function buildProgress(
  swimmers: Swimmer[],
  meets: Meet[],
  results: Record<string, string>
): SwimmerProgress[] {
  return swimmers
    .map((sw) => {
      const groups = new Map<string, { race: string; course: string; key: string; desc: string; times: number[] }>();
      for (const m of meets)
        for (const e of m.entries) {
          if (e.relay || !matchesName(sw.name, e.name)) continue;
          const meta = eventMeta(e.desc);
          if (!meta.key) continue;
          const override = results[resultKey(m.id, e.event, sw.name)];
          const sec = _toSec(override || (e.seed !== "NT" ? e.seed : ""));
          if (!isFinite(sec)) continue;
          const course = courseOf(e.desc);
          const gk = `${course}|${meta.key}`;
          if (!groups.has(gk)) groups.set(gk, { race: meta.race, course, key: meta.key, desc: e.desc, times: [] });
          groups.get(gk)!.times.push(sec);
        }
      const events: ProgressEvent[] = [...groups.values()]
        .map((g) => {
          const best = Math.min(...g.times);
          const worst = Math.max(...g.times);
          return {
            key: g.key,
            race: g.race,
            course: g.course,
            desc: g.desc,
            best: fmt(best),
            bestSec: best,
            count: g.times.length,
            drop: g.times.length > 1 ? +(worst - best).toFixed(2) : null,
          };
        })
        .sort(
          (a, b) =>
            a.course.localeCompare(b.course) ||
            (parseInt(a.key, 10) || 0) - (parseInt(b.key, 10) || 0) ||
            a.key.localeCompare(b.key)
        );
      return { swimmer: sw, events };
    })
    .filter((sp) => sp.events.length > 0);
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

export async function importUrl(url: string, proxy: string): Promise<ImportOutcome> {
  const buf = await fetchPdfBuffer(url.trim(), proxy);
  const fallback = url.split("/").pop()?.replace(/\.pdf.*$/i, "") || "Meet";
  return importBuffer(buf, fallback, "url", url.trim());
}
