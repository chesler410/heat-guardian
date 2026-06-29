// Derive a swimmer's age-group/gender/course/event from the event description and
// compute the next USA Swimming motivational cut to beat from the bundled standards.
import standardsData from "./standards.json";
import seChampsData from "./se_champs.json";

type Ladder = Record<string, string>;
type Standards = Record<string, Record<string, Record<string, Record<string, Ladder>>>>;
const standards = standardsData as Standards;
// se_champs: course -> gender -> age -> "50 FR" -> qualifying time
const seChamps = seChampsData as Record<string, Record<string, Record<string, Record<string, string>>>>;

export const LEVELS = ["B", "BB", "A", "AA", "AAA", "AAAA"];

const STROKE_ABBR: Record<string, string> = {
  Freestyle: "FR", Backstroke: "BK", Breaststroke: "BR", Butterfly: "FL",
};

export interface EventMeta {
  gender: "Girls" | "Boys" | null;
  ageGroup: string | null;
  course: "LCM" | "SCY" | null;
  key: string | null; // e.g. "100 FL"
  race: string; // e.g. "100 Fly"
}

export function ageToGroup(age: number): string {
  return age <= 10 ? "10U" : age <= 12 ? "11-12" : age <= 14 ? "13-14" : age <= 16 ? "15-16" : "17-18";
}

export function eventMeta(desc: string): EventMeta {
  const gender = /girls?|women/i.test(desc)
    ? "Girls"
    : /boys?|men/i.test(desc)
    ? "Boys"
    : null;

  let ageGroup: string | null = null;
  if (/10 ?& ?under|8 ?& ?under|9-10/i.test(desc)) ageGroup = "10U";
  else if (/11-12/.test(desc)) ageGroup = "11-12";
  else if (/13-14/.test(desc)) ageGroup = "13-14";
  else if (/15-16/.test(desc)) ageGroup = "15-16";
  else if (/17-18|15 ?& ?over|senior|open/i.test(desc)) ageGroup = "17-18";

  const course = /LC Meter/i.test(desc) ? "LCM" : /SC Yard/i.test(desc) ? "SCY" : null;

  const dm = /(\d+)\s+(?:LC Meter|SC Yard|SC Meter)\s+([A-Za-z ]+)/.exec(desc);
  let key: string | null = null;
  let race = desc;
  if (dm) {
    const dist = dm[1];
    const word = dm[2].trim().split(/\s+/)[0];
    const isIM = /individual medley|IM/i.test(dm[2]);
    const abbr = isIM ? "IM" : STROKE_ABBR[word] ?? word;
    // Short nickname keyed by abbreviation: Butterfly→Fly, Freestyle→Free, etc.
    const ABBR_TITLE: Record<string, string> = { FR: "Free", BK: "Back", BR: "Breast", FL: "Fly", IM: "IM" };
    const title = isIM ? "IM" : ABBR_TITLE[abbr] ?? word;
    key = `${dist} ${abbr}`;
    race = `${dist} ${title}`;
  }
  return { gender, ageGroup, course, key, race };
}

function toSec(t: string): number {
  t = t.replace("*", "").trim();
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    return parseInt(m, 10) * 60 + parseFloat(s);
  }
  return parseFloat(t);
}

export function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m ? `${m}:${s.toFixed(2).padStart(5, "0")}` : s.toFixed(2);
}

export interface CutResult {
  achieved: string | null;
  nextCut: { level: string; time: string; needed: number } | null;
  champ: { time: string; met: boolean; needed: number } | null; // Southeastern champ cut
}

// Number/size of pool lengths for an event (for per-length pace math).
export function segInfo(desc: string): { dist: number; len: number; unit: string; n: number } | null {
  const m = eventMeta(desc);
  if (!m.course || !m.key) return null;
  const dist = parseInt(m.key, 10);
  const len = m.course === "LCM" ? 50 : 25;
  const unit = m.course === "LCM" ? "m" : "y";
  const n = Math.round(dist / len);
  return { dist, len, unit, n };
}

// Goal pacing per pool length. "even" = equal pace; "realistic" = mild positive split (first
// half a touch faster, like a real race), summing to the goal. Returns BOTH the per-length
// interval ("each" — the exact time for that length) and the running total ("cum").
export function goalSplits(
  desc: string,
  goal: string,
  pacing: "even" | "realistic" = "even",
  splitLen?: number // override the segment length (e.g. split a 100 LC by 25 → 4 splits)
): { dist: number; each: string; cum: string }[] | null {
  if (!goal) return null;
  const m = eventMeta(desc);
  if (!m.course || !m.key) return null;
  const dist = parseInt(m.key, 10);
  const poolLen = m.course === "LCM" ? 50 : 25; // length of pool
  // Use the chosen split length when it divides the distance evenly; else fall back to the pool.
  const len = splitLen && dist % splitLen === 0 ? splitLen : poolLen;
  const n = Math.round(dist / len);
  const g = toSec(goal);
  if (!(n >= 2) || !g || isNaN(g)) return null;
  // per-length weights (sum to n). realistic: spread of ±3% from first to last length.
  const spread = 0.06;
  const w = (k: number) => (pacing === "realistic" ? 1 + spread * ((k - 1) / (n - 1) - 0.5) : 1);
  const out: { dist: number; each: string; cum: string }[] = [];
  let cum = 0;
  for (let k = 1; k <= n; k++) {
    const seg = (g / n) * w(k);
    cum += seg;
    out.push({ dist: k * len, each: fmt(seg), cum: fmt(cum) });
  }
  return out;
}

// Turn CUMULATIVE split times (how a results sheet prints them — 50/100/150…) into the exact
// per-length interval each length took. Blank/unparseable entries pass through as "".
export function splitDeltas(cum: string[]): string[] {
  let prev = 0;
  return cum.map((c) => {
    const s = toSec(c);
    if (isNaN(s)) return "";
    const d = s - prev;
    prev = s;
    return fmt(d);
  });
}

export function computeCut(
  desc: string,
  seed: string,
  override?: { age?: number | null; gender?: "Girls" | "Boys" | null }
): CutResult | null {
  if (seed === "NT") return null;
  const m = eventMeta(desc);
  // The swimmer's known age/gender (from the latest heat sheet) win over the event text —
  // this fixes "Open"/mixed events and keeps standards correct as a swimmer ages up.
  const gender = override?.gender ?? m.gender;
  const ageGroup = override?.age != null ? ageToGroup(override.age) : m.ageGroup;
  const course = m.course;
  const key = m.key;
  if (!gender || !ageGroup || !course || !key) return null;
  const ladder = standards[course]?.[gender]?.[ageGroup]?.[key];
  if (!ladder) return null;

  const seedSec = toSec(seed);

  // Southeastern championship qualifying cut (single time per event), if available.
  let champ: CutResult["champ"] = null;
  const champStr = seChamps[course]?.[gender]?.[ageGroup]?.[key];
  if (champStr) {
    const t = toSec(champStr);
    champ = { time: fmt(t), met: seedSec <= t, needed: +(seedSec - t).toFixed(2) };
  }
  let achieved: string | null = null;
  let nextLevel: string | null = null;
  let nextTime: number | null = null;
  for (const lvl of LEVELS) {
    const std = ladder[lvl];
    if (std == null) continue;
    if (seedSec <= toSec(std)) achieved = lvl;
    else if (nextLevel === null) {
      nextLevel = lvl;
      nextTime = toSec(std);
      break;
    }
  }
  if (nextLevel === null && achieved !== "AAAA") {
    for (const lvl of LEVELS) {
      if (ladder[lvl] && seedSec > toSec(ladder[lvl])) {
        nextLevel = lvl;
        nextTime = toSec(ladder[lvl]);
        break;
      }
    }
  }
  return {
    achieved,
    nextCut:
      nextLevel && nextTime !== null
        ? { level: nextLevel, time: fmt(nextTime), needed: +(seedSec - nextTime).toFixed(2) }
        : null,
    champ,
  };
}
