// In-browser Hy-Tek heat-sheet parser (port of scripts/parse_heatsheet.py).
// Uses pdf.js text item coordinates: detect columns from the "Lane ... Name"
// header, bucket words by x, stitch columns column-major, parse events/heats/lanes.
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Finisher } from "./hytek";
export type { Finisher };
export { looksLikeHytekHtml, parseHytekHtml } from "./hytek";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface Word {
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
// Relay team row: "4 PAC-LA W109 A 2:04.11" -> lane, team, (code), letter, seed
const RELAY_TEAM = /^(\d{1,2})\s+([A-Z0-9\-]+)\s+[A-Z0-9]+\s+[A-Z]\s+([\d:]+\.\d{2}|NT)$/;
// Relay member(s): "Smith, Amelia A 16 Lard, Kinlee G 16" (two per line)
const RELAY_MEMBER = /([A-Za-z'.\-]+,\s*[A-Za-z'.\-]+(?:\s+[A-Za-z])?)\s+(\d{1,2})/g;
const SESSION_MARK = "@@SESSION@@";
// "Meet Program - Friday Morning" running header → the day/session for that page.
const SESSION_HDR =
  /Meet Program\s*-\s*((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\s+(?:Morning|Afternoon|Evening|AM|PM))/i;
const ENTRY =
  /^(\d{1,2})\s+([A-Za-z'.\- ]+?,\s*[A-Za-z'.\-]+(?:\s+[A-Za-z])?)\s+(\d{1,2})\s+([A-Z0-9\-]+)\s+([\d:]+\.\d{2}|NT)$/;

function columnLefts(words: Word[]): number[] {
  const lanes = words.filter((w) => /^Lane\b/.test(w.s));
  const xs: number[] = [];
  for (const ln of lanes) {
    const row = words.filter((w) => Math.abs(w.y - ln.y) <= 3);
    const hasName =
      /Name/.test(ln.s) || row.some((w) => /^Name\b/.test(w.s) && w.x > ln.x);
    if (hasName) xs.push(ln.x);
  }
  xs.sort((a, b) => a - b);
  const lefts: number[] = [];
  for (const x of xs) if (!lefts.length || x - lefts[lefts.length - 1] > 40) lefts.push(x);
  return lefts;
}

function linesForColumn(words: Word[], col: number, lefts: number[]): string[] {
  const bounds = [...lefts, 1e9];
  const lo = bounds[col] - 5;
  const hi = bounds[col + 1] - 5;
  const sel = words
    .filter((w) => w.x >= lo && w.x < hi)
    .sort((a, b) => b.y - a.y || a.x - b.x); // top-to-bottom (pdf y is up), then left-right
  const lines: string[] = [];
  let cur: string[] = [];
  let cy: number | null = null;
  for (const w of sel) {
    if (cy === null || Math.abs(w.y - cy) <= 3) {
      cur.push(w.s);
      if (cy === null) cy = w.y;
    } else {
      lines.push(cur.join(" "));
      cur = [w.s];
      cy = w.y;
    }
  }
  if (cur.length) lines.push(cur.join(" "));
  return lines;
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
    const e = ENTRY.exec(line);
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

function pageWords(tc: any): Word[] {
  return tc.items
    .filter((it: any) => typeof it.str === "string" && it.str.trim())
    .map((it: any) => ({ x: it.transform[4], y: it.transform[5], s: it.str.trim() }));
}
function findTitle(words: Word[]): string {
  const tl = [...words].sort((a, b) => b.y - a.y).find((w) =>
    /invitational|championship|classic|meet|open|cup|sectional/i.test(w.s)
  );
  if (!tl) return "Meet";
  return words.filter((w) => Math.abs(w.y - tl.y) <= 3).sort((a, b) => a.x - b.x)
    .map((w) => w.s).join(" ").trim().replace(/(\d)\s+(\d)/g, "$1$2");
}

const EVENT_RES = /Event\s+(\d+)\s+(.+)/;
const TIME_TOK = /^\d{0,2}:?\d{2}\.\d{2}$/;
const NAME_RES = /[A-Za-z'.\-]+,\s+[A-Za-z'.\-]+(?:\s+[A-Za-z]\b)?/;

// Parse a PDF, auto-detecting a heat sheet vs a results sheet.
export async function parsePdf(data: ArrayBuffer): Promise<ParsedPdf> {
  const doc = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise; // 0=errors only (mute font warnings)
  const pages: Word[][] = [];
  let title = "Meet";
  for (let p = 1; p <= doc.numPages; p++) {
    const words = pageWords(await (await doc.getPage(p)).getTextContent());
    if (p === 1) title = findTitle(words);
    pages.push(words);
  }
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

// Pick, per finisher row, the time nearest the "Finals" column (vs the Seed column).
function parseResultsPages(pages: Word[][]): Finisher[] {
  const out: Finisher[] = [];
  let ev: number | null = null;
  let desc = "";
  for (const words of pages) {
    const finalsXs = words.filter((w) => /Finals/.test(w.s)).map((w) => w.x);
    const fx = finalsXs.length ? finalsXs[0] : 1e9;
    const rows = new Map<number, Word[]>();
    for (const w of words) {
      const k = Math.round(w.y / 2);
      if (!rows.has(k)) rows.set(k, []);
      rows.get(k)!.push(w);
    }
    for (const k of [...rows.keys()].sort((a, b) => b - a)) {
      const row = rows.get(k)!.sort((a, b) => a.x - b.x);
      const txt = row.map((w) => w.s).join(" ");
      const em = EVENT_RES.exec(txt);
      if (em) {
        ev = parseInt(em[1], 10);
        desc = em[2].trim();
        continue;
      }
      const nm = NAME_RES.exec(txt);
      const times = row.filter((w) => TIME_TOK.test(w.s));
      if (nm && times.length && ev != null) {
        const finals = times.reduce((b, t) => (Math.abs(t.x - fx) < Math.abs(b.x - fx) ? t : b)).s;
        out.push({ event: ev, desc, name: nm[0].trim(), finals });
      }
    }
  }
  return out;
}
