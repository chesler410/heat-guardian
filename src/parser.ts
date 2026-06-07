// In-browser Hy-Tek heat-sheet parser (port of scripts/parse_heatsheet.py).
// Uses pdf.js text item coordinates: detect columns from the "Lane ... Name"
// header, bucket words by x, stitch columns column-major, parse events/heats/lanes.
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

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

export interface ParseResult {
  title: string;
  entries: RawEntry[];
}

export async function parseHeatSheet(data: ArrayBuffer): Promise<ParseResult> {
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const ordered: string[] = [];
  let title = "Meet";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const words: Word[] = tc.items
      .filter((it: any) => typeof it.str === "string" && it.str.trim())
      .map((it: any) => ({ x: it.transform[4], y: it.transform[5], s: it.str.trim() }));
    if (p === 1) {
      const top = [...words].sort((a, b) => b.y - a.y);
      const titleLine = top.find((w) =>
        /invitational|championship|classic|meet|open|cup|sectional/i.test(w.s)
      );
      if (titleLine) {
        const row = words
          .filter((w) => Math.abs(w.y - titleLine.y) <= 3)
          .sort((a, b) => a.x - b.x);
        title = row.map((w) => w.s).join(" ").trim().replace(/(\d)\s+(\d)/g, "$1$2");
      }
    }
    // Tag this page's events with their session from the "Meet Program - <day>" header.
    const pageText = [...words].sort((a, b) => b.y - a.y || a.x - b.x).map((w) => w.s).join(" ");
    const sm = SESSION_HDR.exec(pageText);
    if (sm) ordered.push(SESSION_MARK + sm[1].replace(/\s+/g, " ").trim());
    const lefts = columnLefts(words);
    for (let c = 0; c < lefts.length; c++) ordered.push(...linesForColumn(words, c, lefts));
  }
  const entries: RawEntry[] = [];
  parseLines(ordered, entries);
  return { title, entries };
}
