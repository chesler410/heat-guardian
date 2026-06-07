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

const STROKE_TITLE: Record<string, string> = {
  Free: "Free", Back: "Back", Breast: "Breast", Fly: "Fly", IM: "IM",
};
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
    const title = isIM ? "IM" : STROKE_TITLE[abbr] ?? word;
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
  ladder: Ladder | null;
  champ: { time: string; met: boolean; needed: number } | null; // Southeastern champ cut
}

export function computeCut(desc: string, seed: string): CutResult | null {
  if (seed === "NT") return null;
  const m = eventMeta(desc);
  if (!m.gender || !m.ageGroup || !m.course || !m.key) return null;
  const ladder = standards[m.course]?.[m.gender]?.[m.ageGroup]?.[m.key];
  if (!ladder) return null;

  const seedSec = toSec(seed);

  // Southeastern championship qualifying cut (single time per event), if available.
  let champ: CutResult["champ"] = null;
  const champStr = seChamps[m.course]?.[m.gender]?.[m.ageGroup]?.[m.key];
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
  const fmtLadder: Ladder = {};
  for (const lvl of LEVELS) if (ladder[lvl]) fmtLadder[lvl] = fmt(toSec(ladder[lvl]));
  return {
    achieved,
    nextCut:
      nextLevel && nextTime !== null
        ? { level: nextLevel, time: fmt(nextTime), needed: +(seedSec - nextTime).toFixed(2) }
        : null,
    ladder: fmtLadder,
    champ,
  };
}
