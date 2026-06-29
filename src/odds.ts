// Just-for-fun race predictions from seed times. Two things parents ask on deck: "where might
// my kid place?" and "could they win?" We answer with a seed-based ranking plus a modeled win
// chance (Monte Carlo: each swimmer's race time ~ Normal(seed, ~2.5%·seed), count how often each
// finishes first). Deterministic (seeded RNG) so the number doesn't flicker between renders.
//
// IMPORTANT framing (see the disclaimer string): a HEAT win is not an age-group/event win —
// heats are seeded by time, so the fastest swimmers can be spread across heats. We surface both
// the heat placing and the full-event (age-group) placing precisely so that's never confusing.

export interface OddsResult {
  fieldSize: number; // same-gender, same-age-group swimmers in this event (with a usable seed)
  eventRank: number; // 1-based predicted place within that gender + age group
  heatSize: number; // swimmers in this heat with a usable seed
  heatRank: number; // 1-based predicted place within the heat (actual heatmates, any age)
  winPct: number; // modeled chance of being fastest in the age group (0–100)
  heatWinPct: number; // modeled chance of being fastest in the heat (0–100)
}

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

// 1-based seed rank of me within a list of seed-seconds (ties share by strict "faster than me").
const rankOf = (secs: number[], meIdx: number): number =>
  1 + secs.filter((s, i) => i !== meIdx && s < secs[meIdx]).length;

// Monte-Carlo chance that `me` posts the fastest time, modeling each swim as Normal(seed, ~2.5%).
function winShare(secs: number[], meIdx: number, salt: number): number {
  const rng = mulberry32((Math.round(secs[meIdx] * 1000) ^ (secs.length * 2654435761) ^ salt) >>> 0);
  let wins = 0;
  for (let trial = 0; trial < TRIALS; trial++) {
    let best = Infinity;
    let bestI = -1;
    for (let i = 0; i < secs.length; i++) {
      const time = secs[i] * (1 + SIGMA_REL * gauss(rng));
      if (time < best) { best = time; bestI = i; }
    }
    if (bestI === meIdx) wins++;
  }
  return Math.round((wins / TRIALS) * 100);
}

// `group` = same gender + age-group field (for age-group standing); `heat` = actual heatmates.
// Each is a list of seed-seconds with the index of the swimmer in question. group needs ≥2.
export function computeOdds(
  group: { secs: number[]; meIdx: number },
  heat: { secs: number[]; meIdx: number }
): OddsResult | null {
  if (group.meIdx < 0 || group.secs.length < 2 || !isFinite(group.secs[group.meIdx])) return null;
  const heatOk = heat.meIdx >= 0 && heat.secs.length >= 2;
  return {
    fieldSize: group.secs.length,
    eventRank: rankOf(group.secs, group.meIdx),
    winPct: winShare(group.secs, group.meIdx, 1),
    heatSize: heatOk ? heat.secs.length : 0,
    heatRank: heatOk ? rankOf(heat.secs, heat.meIdx) : 0,
    heatWinPct: heatOk ? winShare(heat.secs, heat.meIdx, 2) : 0,
  };
}
