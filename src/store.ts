// Local-first storage (no backend/accounts): swimmers + imported meets in localStorage.
// Meets keep their FULL parsed roster so you can search swimmers and add them any time
// (re-matching is automatic). COPPA-friendly: nothing leaves the device.
import { parsePdf, Finisher } from "./parser";
import { looksLikeHytekHtml, parseHytekHtml } from "./hytek";
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

// --- Backend (Cloudflare Worker): shared meet cache + AI feedback. Same Worker as the fetch
// proxy, so the base URL is just its origin. Returns null when no proxy/backend is configured —
// callers degrade gracefully (these features are dark until the owner deploys the backend).
export function backendBase(proxy: string): string | null {
  try {
    return proxy ? new URL(proxy).origin : null;
  } catch {
    return null;
  }
}

// Push a parsed meet to the shared cache; returns a short code others import with. The heavy PDF
// parse happens once, on whoever shares — recipients (phones included) just pull the small JSON.
export async function cacheMeet(meet: Meet, results: Record<string, string>, proxy: string): Promise<string> {
  const base = backendBase(proxy);
  if (!base) throw new Error("share_unavailable");
  const res = await fetch(`${base}/meet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildMeetPack(meet, results)),
  });
  if (!res.ok) throw new Error("share_failed");
  const j = (await res.json()) as { code?: string };
  if (!j.code) throw new Error("share_failed");
  return j.code;
}

export async function importMeetCode(code: string, proxy: string): Promise<ImportOutcome> {
  const base = backendBase(proxy);
  if (!base) throw new Error("share_unavailable");
  const res = await fetch(`${base}/meet/${encodeURIComponent(code.trim().toUpperCase())}`);
  if (res.status === 404) throw new Error("code_not_found");
  if (!res.ok) throw new Error("share_failed");
  const pack = parseMeetPack(await res.text(), "Shared meet");
  if (!pack) throw new Error("err_no_events");
  return { kind: "meet", meet: pack.meet, results: pack.results };
}

// AI post-meet feedback. Caller passes COPPA-minimized swim context only (no name/team).
export async function getFeedback(
  swims: { race: string; seed?: string; result?: string; cut?: string; note?: string; name?: string }[],
  age: number | undefined,
  proxy: string,
  opts?: { kind?: "swimmer" | "team"; teamName?: string; appToken?: string }
): Promise<string> {
  const base = backendBase(proxy);
  if (!base) throw new Error("feedback_unavailable");
  const res = await fetch(`${base}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(opts?.appToken ? { "X-HG-Token": opts.appToken } : {}) },
    body: JSON.stringify({ swims, age, kind: opts?.kind, teamName: opts?.teamName }),
  });
  if (res.status === 429) throw new Error("feedback_rate_limited");
  if (!res.ok) throw new Error("feedback_failed");
  const j = (await res.json()) as { feedback?: string };
  return j.feedback || "";
}

// In-app feedback → the Worker /report endpoint (which notifies the developer + logs to R2).
// Just the user's note + small app context (no names). Returns false if the backend isn't up.
export async function sendReport(text: string, ctx: string, proxy: string): Promise<boolean> {
  const base = backendBase(proxy);
  if (!base) return false;
  try {
    const res = await fetch(`${base}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, ctx }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- USA Swimming Data Hub (via the Worker's cached /usas proxy) -----------
// The Worker fronts USA Swimming's public Data Hub. Athlete search + best times are anonymous;
// full history + meet search use the Worker's held session (it returns {error:"needs_session"}
// with HTTP 503 if the owner hasn't set it up). All callers degrade to [] gracefully.

export interface UsasAthlete {
  memberId: string;
  fullName: string;
  shortName?: string;
  clubName?: string;
  lscCode?: string;
  swimmerAge?: number;
  isNcaa?: number;
  profilePicUrl?: string | null;
}

export interface UsasBestTime {
  swimTimeRecognitionId: number;
  strokeName: string;
  strokeAbbreviation: string; // FR/BK/BR/FL/IM
  distance: number; // yards/meters
  courseCode: string; // SCY / SCM / LCM
  swimTime: string; // "1:33.42"
}

export interface UsasMeet {
  meetId: number;
  meetName: string;
  meetType: string;
  meetDate: string; // "Jun 26 - 28, 2026"
  courseCode: string;
  teams?: number;
  swims?: number;
  swimmers?: number;
}

async function usasGet<T>(path: string, proxy: string): Promise<T[]> {
  const base = backendBase(proxy);
  if (!base) return [];
  try {
    const res = await fetch(`${base}/usas/${path}`);
    if (!res.ok) return []; // 503 needs_session, 4xx, etc. → degrade quietly
    const j = await res.json();
    return Array.isArray(j) ? (j as T[]) : [];
  } catch {
    return [];
  }
}

// Search USA Swimming athletes by name (anonymous). Min 2 chars.
export function searchUsasAthletes(name: string, proxy: string): Promise<UsasAthlete[]> {
  const q = name.trim();
  if (q.length < 2) return Promise.resolve([]);
  return usasGet<UsasAthlete>(`athletes?name=${encodeURIComponent(q)}`, proxy);
}

// Best time per event for a member (anonymous).
export function usasBestTimes(memberId: string, proxy: string): Promise<UsasBestTime[]> {
  return usasGet<UsasBestTime>(`athletes/${encodeURIComponent(memberId)}/bests`, proxy);
}

// Meets filtered by LSC (≈ region) + optional date range — the "meets near me" feed.
// Needs the Worker's held session; returns [] if unavailable. Dates are "M/D/YYYY".
export function usasMeets(
  opts: { lsc?: string; zone?: string; name?: string; from?: string; to?: string },
  proxy: string
): Promise<UsasMeet[]> {
  const qs = new URLSearchParams();
  if (opts.lsc) qs.set("lsc", opts.lsc);
  if (opts.zone) qs.set("zone", opts.zone);
  if (opts.name) qs.set("name", opts.name);
  if (opts.from) qs.set("from", opts.from);
  if (opts.to) qs.set("to", opts.to);
  return usasGet<UsasMeet>(`meets?${qs.toString()}`, proxy);
}

export async function importBuffer(buf: ArrayBuffer, fallback: string, source: "upload" | "url", sourceUrl?: string): Promise<ImportOutcome> {
  // SD3 / SDIF and meet packs are plain text (not a PDF). Detect and parse into a meet.
  if (!isPdf(buf)) {
    const text = new TextDecoder("utf-8").decode(buf);
    const pack = parseMeetPack(text, fallback);
    if (pack) return { kind: "meet", ...pack };
    if (looksLikeSdif(text)) {
      const s = parseSdif(text);
      if (!s.entries.length) throw new Error("err_no_events");
      return { kind: "meet", meet: toMeet(s.title, s.entries, fallback, source, sourceUrl) };
    }
    // Hy-Tek "Real-Time Results to the Web" page — overlays live/actual times (the live path).
    if (looksLikeHytekHtml(text)) {
      const h = parseHytekHtml(text);
      if (!h.finishers.length) throw new Error("err_no_results");
      return { kind: "results", title: h.title, finishers: h.finishers };
    }
  }
  const r = await parsePdf(buf);
  if (r.kind === "results") {
    if (!r.finishers.length) throw new Error("err_no_results");
    return { kind: "results", title: r.title, finishers: r.finishers };
  }
  // Thrown messages are i18n KEYS — App translates them (t() passes plain strings through).
  // "announcement" hint = the user grabbed the meet info/entry packet, not a heat sheet.
  if (!r.entries.length) throw new Error(r.hint === "announcement" ? "err_announcement" : "err_no_events");
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

// For each swimmer, per event (course-aware) across all meets:
//  • best  — current best time, from seed/psych entry times AND logged/overlaid results,
//             whichever is faster (so the column is never empty just because nothing's logged).
//  • count — number of times ACTUALLY swum (logged results only). Seeds don't count: a new
//             meet's seed is usually the prior best copied in, so counting them would record
//             swims that never happened and let old meets bleed into a freshly-added one.
//  • drop  — improvement across real swims only (needs ≥2 logged results); seeds never create it.
export function buildProgress(
  swimmers: Swimmer[],
  meets: Meet[],
  results: Record<string, string>
): SwimmerProgress[] {
  return swimmers
    .map((sw) => {
      const groups = new Map<string, { race: string; course: string; key: string; desc: string; swims: number[]; seedBest: number }>();
      for (const m of meets)
        for (const e of m.entries) {
          if (e.relay || !matchesName(sw.name, e.name)) continue;
          const meta = eventMeta(e.desc);
          if (!meta.key) continue;
          const course = courseOf(e.desc);
          const gk = `${course}|${meta.key}`;
          if (!groups.has(gk)) groups.set(gk, { race: meta.race, course, key: meta.key, desc: e.desc, swims: [], seedBest: Infinity });
          const g = groups.get(gk)!;
          const swum = _toSec(results[resultKey(m.id, e.event, sw.name)] || "");
          if (isFinite(swum)) g.swims.push(swum);
          const seed = _toSec(e.seed !== "NT" ? e.seed : "");
          if (isFinite(seed)) g.seedBest = Math.min(g.seedBest, seed);
        }
      const events: ProgressEvent[] = [...groups.values()]
        .map((g) => {
          const swimBest = g.swims.length ? Math.min(...g.swims) : Infinity;
          const swimWorst = g.swims.length ? Math.max(...g.swims) : 0;
          const best = Math.min(swimBest, g.seedBest); // current best: swum or seed, whichever faster
          return {
            key: g.key,
            race: g.race,
            course: g.course,
            desc: g.desc,
            best: fmt(best),
            bestSec: best,
            count: g.swims.length, // real swims only
            drop: g.swims.length > 1 ? +(swimWorst - swimBest).toFixed(2) : null,
          };
        })
        .filter((ev) => isFinite(ev.bestSec))
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

// Fetch a meet document by URL — a PDF, or a Hy-Tek "Results to the Web" HTML page (the live
// path). Browsers block cross-origin fetches unless the host allows CORS, so we try the shared
// fetch helper first, then a direct fetch (CORS-friendly hosts only).
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
      if (looksLikeHytekHtml(new TextDecoder("utf-8").decode(buf))) return buf; // live HTML results
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
