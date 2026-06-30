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
// Pool length + unit from the course phrase. Independent of the cut-standard course (which only
// knows LCM/SCY) so SC Meter (a 25 m pool) still gets splits even though it has no USA-S standards.
export function poolOf(desc: string): { len: number; unit: string } | null {
  if (/LC Meter/i.test(desc)) return { len: 50, unit: "m" };
  if (/SC Meter/i.test(desc)) return { len: 25, unit: "m" };
  if (/SC Yard/i.test(desc)) return { len: 25, unit: "y" };
  return null;
}

export function segInfo(desc: string): { dist: number; len: number; unit: string; n: number } | null {
  const m = eventMeta(desc);
  const pool = poolOf(desc);
  if (!m.key || !pool) return null;
  const dist = parseInt(m.key, 10);
  if (!dist) return null;
  const n = Math.round(dist / pool.len);
  return { dist, len: pool.len, unit: pool.unit, n };
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
  const pool = poolOf(desc);
  if (!m.key || !pool) return null;
  const dist = parseInt(m.key, 10);
  const poolLen = pool.len; // length of pool (LCM 50, SCY/SCM 25)
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

// Standard-normal CDF (Abramowitz & Stegun 7.1.26 erf approximation) — good to ~1e-7.
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

// Kind, OPTIMISTIC "chance of hitting the next goal this race" from the drop needed. Models the
// swimmer's next-swim improvement as Normal(≈2.5% of their time, σ≈4%) — generous on purpose,
// since age-group kids drop real time — and returns P(improvement ≥ needed), clamped 1–99. The
// UI only ever SHOWS it when it clears an encouraging threshold (≥60%) and the parent opts in, so
// a little one never sees a discouraging long-shot number. needed/seed in seconds; null if N/A.
export function goalChance(seedSec: number, neededSec: number): number | null {
  if (!isFinite(seedSec) || !isFinite(neededSec) || seedSec <= 0) return null;
  if (neededSec <= 0) return 99; // already at or under the goal time
  const r = neededSec / seedSec; // fraction of their time they need to drop
  const p = normalCdf((0.025 - r) / 0.04);
  return Math.max(1, Math.min(99, Math.round(p * 100)));
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
  return cutCore(course, gender, ageGroup, key, seed);
}

// The standards lookup itself, decoupled from heat-sheet parsing — so USA Swimming best times (which
// already give distance/stroke/course as structured fields) can be graded the same way as seed times.
function cutCore(course: string, gender: "Girls" | "Boys", ageGroup: string, key: string, timeStr: string): CutResult | null {
  const ladder = standards[course]?.[gender]?.[ageGroup]?.[key];
  if (!ladder) return null;
  const seedSec = toSec(timeStr);

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

// Grade a USA Swimming best time (structured fields) against the bundled standards + SE champ cuts.
// Returns null when we can't grade it (missing gender/age, SCM course, or an event not in the tables).
export function cutForBest(opts: {
  distance: number; strokeAbbr: string; course: string; age?: number | null; gender?: "Girls" | "Boys" | null; time: string;
}): CutResult | null {
  const { distance, strokeAbbr, course, age, gender, time } = opts;
  if (!gender || age == null || (course !== "SCY" && course !== "LCM")) return null;
  return cutCore(course, gender, ageToGroup(age), `${distance} ${strokeAbbr}`, time);
}
