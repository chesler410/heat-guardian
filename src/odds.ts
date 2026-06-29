// Just-for-fun race predictions from seed times. Two things parents ask on deck: "where might
// my kid place?" and "could they win?" We answer with a seed-based ranking plus a modeled win
// chance (Monte Carlo: each swimmer's race time ~ Normal(seed, ~2.5%·seed), count how often each
// finishes first). Deterministic (seeded RNG) so the number doesn't flicker between renders.
//
// IMPORTANT framing (see the disclaimer string): a HEAT win is not an age-group/event win —
// heats are seeded by time, so the fastest swimmers can be spread across heats. We surface both
// the heat placing and the full-event (age-group) placing precisely so that's never confusing.

export interface OddsEntry {
  seed: string;
  heat: string | null;
}

export interface OddsResult {
  fieldSize: number; // entries in the event with a usable seed
  eventRank: number; // 1-based predicted place across the whole event (= the age group)
  heatSize: number; // entries in this heat with a usable seed
  heatRank: number; // 1-based predicted place within the heat
  winPct: number; // modeled chance of being fastest in the event (0–100)
  heatWinPct: number; // modeled chance of being fastest in the heat (0–100)
}

function toSec(t: string): number {
  const s = (t || "").replace("*", "").trim();
  if (!s || /^nt$/i.test(s)) return NaN;
  if (s.includes(":")) {
    const [m, sec] = s.split(":");
    return parseInt(m, 10) * 60 + parseFloat(sec);
  }
  return parseFloat(s);
}

const heatOf = (h: string | null): number => {
  const m = h?.match(/Heat\s+(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

// Tiny deterministic PRNG + standard normal, so a given field always yields the same odds.
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const SIGMA_REL = 0.025; // ~2.5% race-to-race variability around the seed time
const TRIALS = 3000;

export function computeOdds(field: OddsEntry[], meIdx: number): OddsResult | null {
  const me = field[meIdx];
  const mySec = me ? toSec(me.seed) : NaN;
  if (!isFinite(mySec)) return null;
  const myHeat = heatOf(me.heat);

  // Only swimmers with a real seed can be modeled; NT/blank are unknowns we leave out.
  const seeded = field
    .map((f, i) => ({ sec: toSec(f.seed), heat: heatOf(f.heat), isMe: i === meIdx }))
    .filter((f) => isFinite(f.sec));
  if (seeded.length < 2) return null;

  const heatField = seeded.filter((f) => f.heat === myHeat);

  const eventRank = 1 + seeded.filter((f) => !f.isMe && f.sec < mySec).length;
  const heatRank = 1 + heatField.filter((f) => !f.isMe && f.sec < mySec).length;

  const rng = mulberry32(Math.round(mySec * 1000) ^ (seeded.length * 2654435761));
  let eventWins = 0;
  let heatWins = 0;
  for (let trial = 0; trial < TRIALS; trial++) {
    let best = Infinity;
    let bestIsMe = false;
    let heatBest = Infinity;
    let heatBestIsMe = false;
    for (const f of seeded) {
      const time = f.sec * (1 + SIGMA_REL * gauss(rng));
      if (time < best) {
        best = time;
        bestIsMe = f.isMe;
      }
      if (f.heat === myHeat && time < heatBest) {
        heatBest = time;
        heatBestIsMe = f.isMe;
      }
    }
    if (bestIsMe) eventWins++;
    if (heatBestIsMe) heatWins++;
  }

  return {
    fieldSize: seeded.length,
    eventRank,
    heatSize: heatField.length,
    heatRank,
    winPct: Math.round((eventWins / TRIALS) * 100),
    heatWinPct: Math.round((heatWins / TRIALS) * 100),
  };
}
