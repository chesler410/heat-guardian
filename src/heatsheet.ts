// Pure Hy-Tek heat-sheet parsing pipeline (no pdf.js / worker imports) so it can be
// unit-tested in node against real extracted words. parser.ts handles the pdf.js text
// extraction, then hands the per-page Word[] arrays to buildParsed() here.
import type { Finisher } from "./hytek";

export interface Word {
  x: number;
  y: number;
  s: string;
}

export interface RawEntry {
  event: number;
  desc: string;
  heat: string | null;
  lane: number;
  name: string;
  age: string;
  team: string;
  seed: string;
  session: string | null;
  relay?: boolean;
}

const HEADER = /^#(\d+)\s+(.+?)\s*$/;
const HEAT = /Heat\s+(\d+)\s+of\s+(\d+)\s+(\w+)/;
// Continuation running-header at the top of a column/page that carries an event mid-break:
// "Heat 8 (#3 Girls 13 & Over 200 LC Meter Freestyle)". It has NO "of M", so HEAT misses it
// and the block's swimmers would otherwise inherit the PREVIOUS heat's number (two heats merge).
// We treat it as a heat boundary AND re-assert the event, since the "#N …" line may not repeat.
const HEAT_CONT = /^Heat\s+(\d+)\s+\(#(\d+)\s+(.+?)\)/;
// Relay team row: "4 PAC-LA W109 A 2:04.11" -> lane, team, (code), letter, seed
const RELAY_TEAM = /^(\d{1,2})\s+([A-Z0-9\-]+)\s+[A-Z0-9]+\s+[A-Z]\s+([\d:]+\.\d{2}|NT)$/;
// Relay member(s): "Smith, Amelia A 16 Lard, Kinlee G 16" (two per line)
const RELAY_MEMBER = /([A-Za-z'.\-]+,\s*[A-Za-z'.\-]+(?:\s+[A-Za-z])?)\s+(\d{1,2})/g;
const SESSION_MARK = "@@SESSION@@";
// "Meet Program - Friday Morning" running header → the day/session for that page.
const SESSION_HDR =
  /Meet Program\s*-\s*((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\s+(?:Morning|Afternoon|Evening|Prelims|Finals|AM|PM)?)/i;
// lane  Last[ Last…], First[ Middle…][ Initial]  age  TEAM  seed
// Given/family names can be multi-word ("Garate Blair, Sofi", "Gipson, Ava Grace G"); the
// name stops at the first numeric token (age). Team allows "!" (Hy-Tek's UN!-SE exhibition).
const ENTRY =
  /^(\d{1,2})\s+([A-Za-z'.\-]+(?:\s+[A-Za-z'.\-]+)*,\s*[A-Za-z'.\-]+(?:\s+[A-Za-z'.\-]+)*)\s+(\d{1,2})\s+([A-Z0-9\-!]+)\s+([\d:]+\.\d{2}|NT)$/;
// A standalone achieved-cut label (e.g. "SES", "FUTU", "SECT") printed next to a seed time.
// These tokens have no comma/digit/hyphen and break the anchored ENTRY regex when they land
// mid-row in a dense "Meet Program" column, so we strip them as a fallback (see parseLines).
const CUT_LABEL = /^[A-Z]{2,5}$/;

// Column left-edges for a page. Dense "Meet Program" layouts tile 2-3 heats across the page;
// each heat block usually starts at the same x, but only SOME blocks carry a "Lane Name ..."
// header row. The "Heat N of M" line, by contrast, prints once per column at the column's
// left edge — so we seed candidates from BOTH the Lane header AND every Heat header, then
// cluster. (Standard single-column sheets collapse to one left edge.)
function columnLefts(words: Word[]): number[] {
  const cand: number[] = [];
  const lanes = words.filter((w) => /^Lane\b/.test(w.s));
  for (const ln of lanes) {
    const row = words.filter((w) => Math.abs(w.y - ln.y) <= 3);
    const hasName =
      /Name/.test(ln.s) || row.some((w) => /^Name\b/.test(w.s) && w.x > ln.x);
    if (hasName) cand.push(ln.x);
  }
  // "Heat N of M" prints once per column at the column's left edge — and unlike the Lane
  // header it appears for EVERY tiled column, so it recovers columns a sparse Lane row misses.
  for (const h of words.filter((w) => /^Heat\b/.test(w.s))) cand.push(h.x);
  // RESULTS sheets have no Lane/Heat but a "Name Age Team …" header per column. Seed from each
  // "Name" (shifted left of the leading place number); and anchor the leftmost column at the page
  // margin (0) so flush-left event titles aren't clipped. On heat sheets these cluster out harmlessly.
  const names = words.filter((w) => /^Name$/.test(w.s));
  for (const n of names) cand.push(n.x - 20);
  if (names.length) cand.push(0);
  cand.sort((a, b) => a - b);
  const lefts: number[] = [];
  for (const x of cand) if (!lefts.length || x - lefts[lefts.length - 1] > 40) lefts.push(x);
  return lefts;
}

function linesForColumn(words: Word[], col: number, lefts: number[]): string[] {
  const bounds = [...lefts, 1e9];
  const lo = bounds[col] - 5;
  const hi = bounds[col + 1] - 5;
  const sel = words
    .filter((w) => w.x >= lo && w.x < hi)
    .sort((a, b) => b.y - a.y || a.x - b.x); // top-to-bottom (pdf y is up), then left-right
  // Group words into rows by y, then sort each row by x before joining. pdf.js sometimes
  // renders a lane+name a sub-pixel off the numeric fields, so the global y-sort can emit a
  // row's tokens out of left-right order ("17 OST-SE 30.90 1 Chamberlin…"); re-sorting the
  // row by x restores "1 Chamberlin… 17 OST-SE 30.90".
  const rows: Word[][] = [];
  let cur: Word[] = [];
  let cy: number | null = null;
  for (const w of sel) {
    if (cy === null || Math.abs(w.y - cy) <= 3) {
      cur.push(w);
      if (cy === null) cy = w.y;
    } else {
      rows.push(cur);
      cur = [w];
      cy = w.y;
    }
  }
  if (cur.length) rows.push(cur);
  return rows.map((r) => r.sort((a, b) => a.x - b.x).map((w) => w.s).join(" "));
}

// Try the entry regex; if it fails, retry with standalone cut-labels (SES/FUTU/…) removed.
function matchEntry(line: string): RegExpExecArray | null {
  const m = ENTRY.exec(line);
  if (m) return m;
  const stripped = line.split(/\s+/).filter((t) => !CUT_LABEL.test(t)).join(" ");
  return stripped === line ? null : ENTRY.exec(stripped);
}

function parseLines(lines: string[], out: RawEntry[]) {
  let ev: string | null = null;
  let desc = "";
  let heat: string | null = null;
  let session: string | null = null;
  let isRelay = false;
  let relayTeam: { lane: number; team: string; seed: string } | null = null;
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (line.startsWith(SESSION_MARK)) {
      session = line.slice(SESSION_MARK.length) || null;
      continue;
    }
    const h = HEADER.exec(line);
    if (h) {
      ev = h[1];
      desc = h[2].trim();
      heat = null;
      isRelay = /relay/i.test(desc);
      relayTeam = null;
      continue;
    }
    const hc = HEAT_CONT.exec(line);
    if (hc) {
      heat = `Heat ${hc[1]}`; // total ("of M") isn't in this header; the number is what we group on
      ev = hc[2]; // re-assert the event in case the page break dropped the "#N …" header
      desc = hc[3].trim();
      isRelay = /relay/i.test(desc);
      relayTeam = null;
      continue;
    }
    const hm = HEAT.exec(line);
    if (hm) {
      heat = `Heat ${hm[1]} of ${hm[2]} ${hm[3]}`;
      continue;
    }
    if (isRelay && ev) {
      const rt = RELAY_TEAM.exec(line);
      if (rt) {
        relayTeam = { lane: parseInt(rt[1], 10), team: rt[2], seed: rt[3] };
        continue;
      }
      if (relayTeam) {
        let m: RegExpExecArray | null;
        RELAY_MEMBER.lastIndex = 0;
        while ((m = RELAY_MEMBER.exec(line))) {
          out.push({
            event: parseInt(ev, 10),
            desc,
            heat,
            lane: relayTeam.lane,
            name: m[1].trim(),
            age: m[2],
            team: relayTeam.team,
            seed: relayTeam.seed,
            session,
            relay: true,
          });
        }
      }
      continue;
    }
    const e = matchEntry(line);
    if (e && ev) {
      out.push({
        event: parseInt(ev, 10),
        desc,
        heat,
        lane: parseInt(e[1], 10),
        name: e[2].trim(),
        age: e[3],
        team: e[4],
        seed: e[5],
        session,
      });
    }
  }
}

export type ParsedPdf =
  // hint: "announcement" when a heat parse finds no entries but the text looks like a meet
  // info/announcement packet (sanction, rules, entry fees) — lets the UI say "grab the
  // Results / Meet Program / Psych Sheet instead" rather than a generic "no events".
  | { kind: "heat"; title: string; entries: RawEntry[]; start?: string; hint?: "announcement" }
  | { kind: "results"; title: string; finishers: Finisher[] };

// A meet announcement/entry packet (vs a seeded heat sheet) is mostly prose: sanction
// language, rules, entry fees, warm-up times. Two+ of these markers with no parsed entries
// means the user grabbed the info doc, not the heat sheet. BUT some hosts staple the heat
// sheet onto the back of the info packet — if the doc has many Hy-Tek "Heat N of M" headers
// it's a real (if unparsed) heat sheet, not an announcement, so don't mislabel it.
function looksLikeAnnouncement(pages: Word[][]): boolean {
  const text = pages.map((w) => w.map((x) => x.s).join(" ")).join(" ");
  if ((text.match(/Heat\s+\d+\s+of\s+\d+/gi) || []).length >= 3) return false; // has a heat sheet
  const markers = [/sanction/i, /USA Swimming/i, /entry fee/i, /warm-?up/i, /technical rules/i, /order of events/i, /time standards?/i, /entries? (close|due|deadline)/i];
  return markers.filter((re) => re.test(text)).length >= 2;
}

// The meet's first day, from a "M/D/YYYY to M/D/YYYY" range in the running header (ISO).
// (Anchored on "to" so we don't grab the Hy-Tek print date.)
function findMeetStart(pages: Word[][]): string | undefined {
  for (const words of pages) {
    const txt = words.map((w) => w.s).join(" ");
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+to\s+\d{1,2}\/\d{1,2}\/\d{4}/.exec(txt);
    if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return undefined;
}

function findTitle(words: Word[]): string {
  // Skip the Hy-Tek running header ("HY-TEK's MEET MANAGER … Page 1") — "MEET" there would
  // otherwise win over the real meet name on the line below it.
  const junk = (s: string) => /hy-?tek|meet manager|^page\b/i.test(s);
  const tl = [...words].sort((a, b) => b.y - a.y).find((w) =>
    !junk(w.s) && /invitational|championship|classic|meet|open|cup|sectional/i.test(w.s)
  );
  if (!tl) return "Meet";
  return words.filter((w) => Math.abs(w.y - tl.y) <= 3 && !junk(w.s)).sort((a, b) => a.x - b.x)
    .map((w) => w.s).join(" ").trim()
    .replace(/(\d)\s+(\d)/g, "$1$2")
    // drop a trailing Hy-Tek date range: "… - 6/26/2026 to 6/28/2026"
    .replace(/\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}\s+to\s+\d{1,2}\/\d{1,2}\/\d{4}.*$/, "")
    .trim() || "Meet";
}

const EVENT_RES = /Event\s+(\d+)\s+(.+)/;
const TIME_TOK_G = /\d{0,2}:?\d{1,2}\.\d{2}/g;
const NAME_RES = /[A-Za-z'.\-]+,\s+[A-Za-z'.\-]+(?:\s+[A-Za-z]\b)?/;
// Compact results event header with no "Event N" — e.g. "Girls 10&U 50 Meter Free",
// "Boys 11-12 100 Yard Back". A gender word, then a distance + Yard/Meter + stroke word.
const EVENT_RES_COMPACT = /^(?:Girls|Boys|Women|Men|Mixed)\b.*?\b\d+\s+(?:Yard|Meter)\s+[A-Za-z]/;
// A finisher line = has a "Last, First" name and ends with a finals time. Works for both the
// "place Name age TEAM finals" layout and the "TeamName place Name age seed finals" layout.
const ENDS_TIME = /\d{1,2}\.\d{2}\s*$/;
// Expand a compact header to the full phrase eventMeta() keys on. "Meter" → "LC Meter" (US meets
// that write bare "Meter" are long-course; SCM is rare); "Yard" → "SC Yard"; strokes spelled out.
function normResultsDesc(line: string): string {
  return line
    .replace(/(?<!SC )(?<!LC )\bYard\b/g, "SC Yard")
    .replace(/(?<!SC )(?<!LC )\bMeter\b/g, "LC Meter")
    .replace(/\bFree\b/g, "Freestyle")
    .replace(/\bBack\b/g, "Backstroke")
    .replace(/\bBreast\b/g, "Breaststroke")
    .replace(/\bFly\b/g, "Butterfly");
}

// Build the parsed result from already-extracted per-page words.
export function buildParsed(pages: Word[][], title: string): ParsedPdf {
  // Heat sheets have a "Lane" column; results don't. (Both contain the word "Finals" —
  // heat sheets in "Heat 1 of 1 Finals" — so "Lane" is the reliable discriminator.)
  const hasLane = pages.some((w) => w.some((x) => /^Lane\b/.test(x.s)));
  const hasFinals = pages.some((w) => w.some((x) => /Finals/.test(x.s)));
  if (!hasLane && hasFinals) {
    return { kind: "results", title, finishers: parseResultsPages(pages) };
  }
  const ordered: string[] = [];
  for (const words of pages) {
    const pageText = [...words].sort((a, b) => b.y - a.y || a.x - b.x).map((w) => w.s).join(" ");
    const sm = SESSION_HDR.exec(pageText);
    if (sm) ordered.push(SESSION_MARK + sm[1].replace(/\s+/g, " ").trim());
    const lefts = columnLefts(words);
    for (let c = 0; c < lefts.length; c++) ordered.push(...linesForColumn(words, c, lefts));
  }
  const entries: RawEntry[] = [];
  parseLines(ordered, entries);
  const hint = entries.length === 0 && looksLikeAnnouncement(pages) ? ("announcement" as const) : undefined;
  return { kind: "heat", title, entries, start: findMeetStart(pages), hint };
}

export { findTitle };

// Parse results COLUMN-MAJOR (results are often tiled 2-3 across the page, like the heat sheets),
// so events/finishers read in true order instead of interleaving columns. Within a column each
// finisher line carries its place + name + the finals time (splits are on their own line beneath).
function parseResultsPages(pages: Word[][]): Finisher[] {
  const out: Finisher[] = [];
  let ev = 0;
  let desc = "";
  for (const words of pages) {
    const lefts = columnLefts(words);
    for (let c = 0; c < lefts.length; c++) {
      for (const raw of linesForColumn(words, c, lefts)) {
        const line = raw.trim();
        if (!line) continue;
        const em = EVENT_RES.exec(line); // "Event 7 Girls 10 & Under 50 LC Meter Freestyle"
        if (em) { ev = parseInt(em[1], 10); desc = em[2].trim(); continue; }
        if (EVENT_RES_COMPACT.test(line)) { ev++; desc = normResultsDesc(line); continue; } // compact header
        const nm = NAME_RES.exec(line);
        if (desc && nm && ENDS_TIME.test(line)) {
          const times = line.match(TIME_TOK_G);
          if (times && times.length) out.push({ event: ev, desc, name: nm[0].replace(/\s+/g, " ").trim(), finals: times[times.length - 1] });
        }
      }
    }
  }
  return out;
}
