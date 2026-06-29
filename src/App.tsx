import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Swimmer,
  Meet,
  Entry,
  RosterItem,
  loadSwimmers,
  saveSwimmers,
  loadMeets,
  saveMeets,
  loadProxy,
  loadResults,
  saveResults,
  resultKey,
  makeSwimmer,
  matchesName,
  buildRoster,
  buildTeams,
  teamSwimmers,
  importFile,
  importUrl,
  importMeetCode,
  cacheMeet,
  backendBase,
  getFeedback,
  buildMeetPack,
  applyResults,
  buildProgress,
  SwimmerProgress,
  ImportOutcome,
  sendReport,
} from "./store.ts";
import { computeCut, CutResult, goalSplits, splitDeltas, eventMeta, segInfo, goalChance, fmt } from "./cuts.ts";
import { DEFAULT_PROXY, FEEDBACK_URL, KOFI_URL, IS_NATIVE, APP_TOKEN, FEEDBACK_ENABLED, rateUrl } from "./config.ts";
import { Geolocation } from "@capacitor/geolocation";
import { getTheme, setTheme, Theme } from "./theme.ts";
import { t, getLang, setLang, LANGS, Lang } from "./i18n.ts";
import day from "./day.json";
import meetsDirectory from "./meets.json";

type Nav = "home" | "live" | "import" | "swimmers" | "watching" | "progress" | "teams" | "about" | "settings";

// 🫧 Easter egg: tap the 🏊 logo 5× fast for a random pre-race taunt to psych yourself up.
// Tiered by edge: "mild" is wholesome (safe for the 8-and-unders and the default), "medium"
// is classic playground cheek, "savage" is opt-in only. The "keep it kind" setting (Settings)
// caps which tiers can appear — a stressed parent shouldn't stumble onto "back of the pack."
// English on purpose — it's a bit, not UI text. ("Smell my bubbles" retired with honors.)
type TauntTier = "mild" | "medium" | "savage";
const TIER_RANK: Record<TauntTier, number> = { mild: 0, medium: 1, savage: 2 };
const TAUNTS: { text: string; tier: TauntTier }[] = [
  // mild — wholesome
  { text: "See you at the wall", tier: "mild" },
  { text: "Catch me if you can (you can't)", tier: "mild" },
  { text: "Blink and I'm gone", tier: "mild" },
  { text: "Negative split, positive vibes, see ya never", tier: "mild" },
  { text: "I came to drop times, not friends", tier: "mild" },
  { text: "Kick harder, it's cute when you try", tier: "mild" },
  { text: "Save some lane lines for the rest of us", tier: "mild" },
  { text: "My warm-up is your race pace", tier: "mild" },
  // medium — cheeky
  { text: "Eat my bubbles 🫧", tier: "medium" },
  { text: "Eat my wake", tier: "medium" },
  { text: "I'll be dry before you finish", tier: "medium" },
  { text: "Lane 4 don't lose", tier: "medium" },
  { text: "My splits called — they said you're not invited", tier: "medium" },
  { text: "I left you a postcard at the 50", tier: "medium" },
  { text: "That wasn't a flip turn, that was a goodbye wave", tier: "medium" },
  { text: "Less splashing, more passing", tier: "medium" },
  { text: "The wall and I have an understanding", tier: "medium" },
  { text: "Taper'd up and ready to embarrass you", tier: "medium" },
  // savage — opt-in
  { text: "Touch the wall and weep", tier: "savage" },
  { text: "Hope you packed a snack for the back of the pack", tier: "savage" },
  { text: "Your streamline is more of a stream-decline", tier: "savage" },
  { text: "I'm not fast, you're just chronologically delayed", tier: "savage" },
  { text: "DQ stands for Definitely Quicker (than you)", tier: "savage" },
  { text: "Bring a towel — for the tears", tier: "savage" },
];

// A meet listed in the community directory (bundled, and refreshed from the repo at runtime).
interface DirMeet {
  id: string;
  title: string;
  city?: string;
  state?: string;
  lsc?: string;
  start?: string;
  end?: string;
  lat?: number;
  lng?: number;
  heatUrl?: string;
  resultsUrl?: string;
  infoUrl?: string;
  resultsPageUrl?: string; // external results page (e.g. SwimCloud) — a link to view, not import
}
// Raw copy in the repo so the community can add meets via PR without an app release.
const DIRECTORY_URL = "https://raw.githubusercontent.com/chesler410/heat-guardian/main/src/meets.json";
type Role = "parent" | "coach" | "swimmer"; // swimmer = "My Meet" self-mode; behaves like parent

function displayName(n: string): string {
  if (n.includes(",")) {
    const [last, first] = n.split(",").map((s) => s.trim());
    return first ? `${first} ${last}` : last;
  }
  return n;
}
const firstName = (n: string) => displayName(n).split(" ")[0];

const STROKE_ABBR: Record<string, string> = {
  Free: "FR", Freestyle: "FR", Back: "BK", Backstroke: "BK",
  Breast: "BR", Breaststroke: "BR", Brst: "BR", Fly: "FL", Butterfly: "FL", IM: "IM", Medley: "IM",
};
// Abbreviate the first stroke word; keep any suffix (e.g. "Relay"). Robust to full or short names.
const swimAbbr = (race: string) => {
  const [d, w, ...rest] = race.split(" ");
  return `${d} ${STROKE_ABBR[w] ?? w}${rest.length ? " " + rest.join(" ") : ""}`;
};
// Always derive the short race label from the description (fixes meets imported before the
// nickname fix, whose stored race may still read "Butterfly").
const raceOf = (e: Entry) => eventMeta(e.desc).race + (e.relay ? " Relay" : "");
const heatNum = (h: string | null) => h?.match(/Heat\s+(\d+)/)?.[1] ?? "—";
// Parse a swim time ("1:38.50" / "30.90" / "NT") to seconds; NaN when not a real time.
const parseTime = (t?: string): number => {
  const s = (t || "").replace("*", "").trim();
  if (!s || /^nt$/i.test(s)) return NaN;
  if (s.includes(":")) { const [m, sec] = s.split(":"); return parseInt(m, 10) * 60 + parseFloat(sec); }
  return parseFloat(s);
};
// Split a "M:SS.hh" / "SS.hh" time into its three parts (for the mobile field UI).
const parseTimeParts = (v: string): { m: string; s: string; c: string } => {
  const mm = /^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,2}))?$/.exec((v || "").trim());
  return mm ? { m: mm[1] || "", s: mm[2] || "", c: mm[3] || "" } : { m: "", s: "", c: "" };
};
// Reassemble three fields into a canonical time string ("" when all blank).
const composeTime = (m: string, s: string, c: string): string => {
  if (!m && !s && !c) return "";
  const cc = c ? c.padEnd(2, "0").slice(0, 2) : "00";
  return m ? `${m}:${(s || "0").padStart(2, "0")}.${cc}` : `${s || "0"}.${cc}`;
};

// Mobile-friendly time entry: three numeric fields (min : sec . hundredths) instead of one
// free-text box you'd have to hunt ":" and "." for. Syncs if the value is set externally
// (e.g. tapping a "splits for BB" goal chip) without stealing focus while you type.
function TimeFields({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const p = parseTimeParts(value);
  const [m, setM] = useState(p.m);
  const [s, setS] = useState(p.s);
  const [c, setC] = useState(p.c);
  useEffect(() => {
    if (value !== composeTime(m, s, c)) { const q = parseTimeParts(value); setM(q.m); setS(q.s); setC(q.c); }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const digits = (v: string, n: number) => v.replace(/\D/g, "").slice(0, n);
  return (
    <span className="timefields">
      <input className="tf tf-m" inputMode="numeric" placeholder="m" maxLength={2} autoFocus={autoFocus}
        value={m} onChange={(e) => { const v = digits(e.target.value, 2); setM(v); onChange(composeTime(v, s, c)); }} />
      <span className="tf-sep">:</span>
      <input className="tf tf-s" inputMode="numeric" placeholder="ss" maxLength={2}
        value={s} onChange={(e) => { const v = digits(e.target.value, 2); setS(v); onChange(composeTime(m, v, c)); }} />
      <span className="tf-sep">.</span>
      <input className="tf tf-c" inputMode="numeric" placeholder="hh" maxLength={2}
        value={c} onChange={(e) => { const v = digits(e.target.value, 2); setC(v); onChange(composeTime(m, s, v)); }} />
    </span>
  );
}

// Native in-app review (StoreKit / Play) popup at a positive moment (marking a meet complete),
// once ever. No-op on web (the About "Rate" link covers that). Lazy-imported + guarded so the
// web build never touches the native plugin.
async function maybeAskReview() {
  if (!IS_NATIVE) return;
  try {
    if (localStorage.getItem("reviewAsked") === "1") return;
    localStorage.setItem("reviewAsked", "1");
    const mod = await import("@capacitor-community/in-app-review");
    await mod.InAppReview.requestReview();
  } catch {
    /* plugin unavailable — fine, the About rate link still works */
  }
}

// A swimmer's age for display — prefer the saved swimmer's age, fall back to the meet entry's.
const deAge = (d: DE): number | undefined => d.age ?? (parseInt(d.e.age, 10) || undefined);
const ageTag = (a?: number): string => (a != null ? ` · ${a}` : "");
// Numeric heat for ordering: real swim order is event → heat → lane. Heats with no number
// (TBD / not yet seeded) sort to the end so assigned heats lead.
const heatOrd = (h: string | null) => { const m = h?.match(/Heat\s+(\d+)/); return m ? parseInt(m[1], 10) : 9999; };
const swimOrder = (a: DE, b: DE) => a.e.event - b.e.event || heatOrd(a.e.heat) - heatOrd(b.e.heat) || a.e.lane - b.e.lane;
const levelClass = (l?: string | null) => "lvl lvl-" + (l ? l.toLowerCase() : "none");
const ageNum = (a: string) => parseInt(a, 10) || undefined;
const blurOnEnter = (ev: { key: string; target: EventTarget }) => {
  if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
};

// localStorage-backed useState; an empty value clears the key.
function useStored<T extends string = string>(key: string, fallback: NoInfer<T>): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => (localStorage.getItem(key) as T | null) || fallback);
  const set = (next: T) => {
    setV(next);
    if (next) localStorage.setItem(key, next);
    else localStorage.removeItem(key);
  };
  return [v, set];
}

// Transient confirmation message (share/pack toasts); clears itself after 2.5s.
function useToast(): [string, (m: string) => void] {
  const [msg, setMsg] = useState("");
  const show = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 2500);
  };
  return [msg, show];
}

// Shareable meet link: encode the meet's public import URL(s) so a teammate who opens the
// link imports the same meet on their own device (no backend). u = import URL, r = results,
// tm = team name (set when a coach shares — lets the recipient set up coach mode in one tap).
interface SharePayload { t?: string; u: string; r?: string; tm?: string }
function buildShareUrl(p: SharePayload): string {
  return `${location.origin}${location.pathname}?add=${encodeURIComponent(JSON.stringify(p))}`;
}
function readSharePayload(): SharePayload | null {
  try {
    const s = new URLSearchParams(location.search).get("add");
    if (!s) return null;
    const o = JSON.parse(decodeURIComponent(s));
    return o && typeof o.u === "string" && o.u ? o : null;
  } catch {
    return null;
  }
}
async function shareMeet(p: SharePayload): Promise<"shared" | "copied" | "fail"> {
  const url = buildShareUrl(p);
  if (navigator.share) {
    try { await navigator.share({ title: p.t || "Swim meet", url }); return "shared"; }
    catch (e: any) { if (e?.name === "AbortError") return "shared"; }
  }
  try { await navigator.clipboard.writeText(url); return "copied"; } catch { return "fail"; }
}

interface DE {
  e: Entry;
  color: string;
  swimmer: string;
  age?: number;
  gender?: "Girls" | "Boys";
  meetId: string;
}

const cutFor = (d: DE, result?: string): CutResult | null =>
  d.e.relay ? null : computeCut(d.e.desc, result || d.e.seed, { age: d.age, gender: d.gender });

function EntryCard({
  d,
  showSwimmer,
  result,
  onSetResult,
  goal,
  asplits,
  onGoal,
  onSplits,
  pacing,
  setPacing,
  splitBy,
  setSplitBy,
  note,
  onNote,
  done,
  onToggleDone,
  showProb,
  swimmer,
}: {
  d: DE;
  showSwimmer: boolean;
  result?: string;
  onSetResult: (val: string) => void;
  goal?: string;
  asplits?: string;
  onGoal?: (val: string) => void;
  onSplits?: (val: string) => void;
  pacing?: "even" | "realistic";
  setPacing?: (p: "even" | "realistic") => void;
  splitBy?: string; // "" = pool length; "25"/"50" override the split segment length
  setSplitBy?: (v: string) => void;
  note?: string;
  onNote?: (val: string) => void;
  done?: boolean; // heat marked complete on deck (so "Up next" advances without a logged time)
  onToggleDone?: () => void;
  showProb?: boolean; // parent opted in to next-goal probability snapshots (off in coach mode)
  swimmer?: boolean; // "My Meet" mode — frame the note as the swimmer's own reflection
}) {
  const { e } = d;
  const [editing, setEditing] = useState(false);
  const [showSplits, setShowSplits] = useState(false);
  const [editNote, setEditNote] = useState(false);
  const [showTimer, setShowTimer] = useState(false);
  // Keep blank positions so each entered split stays aligned with its length (no filter).
  const actualArr = (asplits || "").split(",").map((x) => x.trim());
  const hasActual = actualArr.some(Boolean);
  // segInfo works for ANY course (incl. SC Meter) + ANY distance; relays get leg splits too.
  const seg = segInfo(e.desc);
  // A split length is valid only if it's a whole number of pool lengths (you can't split finer than
  // a length) AND it divides the race into ≥2 pieces. Offer pool-length / 50 / 100 where they fit.
  const splitOk = (c: number) => !!seg && c % seg.len === 0 && seg.dist % c === 0 && seg.dist / c >= 2;
  const splitOpts = seg ? [...new Set([seg.len, 50, 100])].filter(splitOk).sort((a, b) => a - b) : [];
  // Default to per-50 (the universal split convention: 200→4, 500→10, 1500→30) when it fits, so
  // distance events don't explode into per-25 rows; else the pool length; else the coarsest option.
  const defSplit = splitOpts.includes(50) ? 50 : splitOpts.includes(seg?.len ?? 0) ? seg!.len : (splitOpts[splitOpts.length - 1] || 0);
  const effSplit = splitBy && splitOk(+splitBy) ? +splitBy : defSplit;
  const splitN = effSplit ? Math.round((seg?.dist ?? 0) / effSplit) : 0;
  const splitDists = seg && splitN >= 2 ? Array.from({ length: splitN }, (_, i) => (i + 1) * effSplit) : null;
  // Distances the live stopwatch times (the per-length splits, or just the finish for a 50).
  const timerDists = splitDists ?? (seg ? [seg.dist] : null);
  // Goal splits are for individual races only (relays have a team time, not a personal goal).
  const splits = e.relay ? null : goalSplits(e.desc, goal || "", pacing || "even", effSplit || undefined);
  const setSplitRow = (i: number, v: string) => {
    const arr = (asplits || "").split(",").map((x) => x.trim());
    while (arr.length < splitN) arr.push("");
    arr[i] = v;
    let end = arr.length;
    while (end > 0 && !arr[end - 1]) end--;
    onSplits?.(arr.slice(0, end).join(", "));
  };
  const time = result || e.seed;
  const cut = cutFor(d, result);
  const close = cut?.nextCut && cut.nextCut.needed <= 1.0;
  const actualEach = splitDeltas(actualArr);
  // Time dropped vs the seed/entry time — the satisfying "got faster" number (à la Meet Mobile).
  const dropped = (() => {
    if (e.relay || !result) return null;
    const a = parseTime(result);
    const b = parseTime(e.seed);
    return isFinite(a) && isFinite(b) && b > a ? +(b - a).toFixed(2) : null;
  })();
  const age = d.age ?? (parseInt(e.age, 10) || undefined);
  const isDQ = result === "DQ"; // a disqualification logged on deck (stored as the result "DQ")
  // Chance of hitting the next motivational cut this race, from the drop still needed.
  const goalP = !e.relay && !result && cut?.nextCut ? goalChance(parseTime(e.seed), cut.nextCut.needed) : null;
  return (
    <div className={"card event" + (close ? " close" : "") + (result ? " has-result" : "") + (done && !result ? " done" : "")}>
      {showTimer && timerDists && seg && (
        <SplitTimer
          dists={timerDists}
          unit={seg.unit}
          onSave={(cum, finalTime) => { onSplits?.(cum.join(", ")); if (!result && !e.relay) onSetResult(finalTime); }}
          onClose={() => setShowTimer(false)}
        />
      )}
      <div className="ev-top">
        {showSwimmer && (
          <span className="kid-tag" style={{ background: d.color }}>
            {firstName(d.swimmer)}{age != null ? ` · ${age}` : ""}
          </span>
        )}
        <span className="ev-num">#{e.event}</span>
        <span className="ev-race">{raceOf(e)}</span>
        {cut?.achieved && <span className={levelClass(cut.achieved)}>{cut.achieved}</span>}
      </div>
      <div className="ev-meta">
        <span>{e.heat ?? t("heat_tbd")}</span>
        <span className="lane">{t("lane", { n: e.lane })}</span>
        {isDQ ? (
          <span className="dq-tag">DQ</span>
        ) : (
          <span className={!e.relay && result ? "swam-val" : undefined}>
            {e.relay ? t("team_label") : result ? t("swam") : t("seed")} <strong>{time}</strong>
          </span>
        )}
        {dropped != null && <span className="dropped-badge">▼ {dropped.toFixed(2)} {t("dropped")}</span>}
      </div>
      {e.relay && <div className="cut muted">🏁 {t("relaylbl")} — {e.team}</div>}
      {/* SE championship cut shown first — it's the priority target */}
      {cut?.champ && (
        <div className="champ">
          <span>🏆 {t("sechamp")} {cut.champ.time}</span>
          {cut.champ.met ? (
            <span className="champ-met">{t("madeit")}</span>
          ) : (
            <span className="champ-need">{t("need", { s: cut.champ.needed.toFixed(2) })}</span>
          )}
        </div>
      )}
      {cut && !cut.champ && <div className="champ muted">🏆 {t("nochamp")}</div>}
      {cut?.nextCut ? (
        <div className="cut">
          <span>
            {t("nextcut")} <strong>{cut.nextCut.level}</strong> {cut.nextCut.time}
          </span>
          <span className={"need" + (close ? " need-close" : "")}>
            {t("drop", { s: cut.nextCut.needed.toFixed(2) })}{close ? t("soclose") : ""}
            {seg && seg.n >= 2 && (
              <span className="per-each">
                {" "}
                {t("per_each", { s: (cut.nextCut.needed / seg.n).toFixed(2), len: seg.len, unit: seg.unit })}
              </span>
            )}
          </span>
        </div>
      ) : cut ? (
        <div className="cut muted">{t("topstd")}</div>
      ) : e.relay ? null : (
        <div className="cut muted">{t("nostd")}</div>
      )}
      {showProb && !e.relay && !result && cut?.nextCut && goalP != null && goalP >= 60 && (
        <div className="odds">
          <div className="odds-line odds-win">
            🎯 {t("goal_chance", { lvl: cut.nextCut.level })} <strong>{goalP}%</strong>
          </div>
          <div className="odds-note">{t("goal_note", { s: cut.nextCut.needed.toFixed(2) })}</div>
        </div>
      )}
      {!e.relay && (
      <div className="result-entry">
        {editing ? (
          <span className="tf-edit">
            <TimeFields value={isDQ ? "" : result || ""} onChange={(v) => onSetResult(v)} autoFocus />
            <button className="inline-link" onClick={() => setEditing(false)}>✓</button>
          </span>
        ) : isDQ ? (
          <button className="inline-link" onClick={() => onSetResult("")}>DQ ✕</button>
        ) : (
          <>
            <button className="inline-link" onClick={() => setEditing(true)}>
              {result ? t("edittime") : swimmer ? t("addtime_me") : t("addtime")}
            </button>
            {!result && <button className="dq-link" onClick={() => onSetResult("DQ")} title="Disqualified">DQ</button>}
          </>
        )}
        {!result && onToggleDone && (
          <button className={"done-toggle" + (done ? " on" : "")} onClick={onToggleDone}>
            {done ? t("done_undo") : t("mark_done")}
          </button>
        )}
      </div>
      )}
      {(!e.relay || splitDists) && (
        <div className="splits-sec">
          <button className="inline-link" onClick={() => setShowSplits((v) => !v)}>
            {t("splits_toggle")}
          </button>
          {showSplits && (
            <div className="splits-body">
              {(cut?.nextCut || (cut?.champ && !cut.champ.met)) && (
                <div className="splits-for">
                  {cut?.nextCut && (
                    <button className="chip sm" onClick={() => onGoal?.(cut.nextCut!.time)}>
                      {t("splits_for", { lvl: cut.nextCut.level })}
                    </button>
                  )}
                  {cut?.champ && !cut.champ.met && (
                    <button className="chip sm" onClick={() => onGoal?.(cut.champ!.time)}>
                      {t("splits_for", { lvl: t("sechamp") })}
                    </button>
                  )}
                </div>
              )}
              {!e.relay && (
                <div className="tf-row">
                  <span className="tf-lbl">{t("goal_lbl")}</span>
                  <TimeFields value={goal || ""} onChange={(v) => onGoal?.(v)} />
                </div>
              )}
              {splits && setPacing && (
                <div className="seg pace-seg">
                  <span className="pace-label">{t("pace_label")}</span>
                  <button className={pacing === "even" ? "on" : ""} onClick={() => setPacing("even")}>
                    {t("pace_even")}
                  </button>
                  <button className={pacing === "realistic" ? "on" : ""} onClick={() => setPacing("realistic")}>
                    {t("pace_real")}
                  </button>
                </div>
              )}
              {splitOpts.length > 1 && setSplitBy && seg && (
                <div className="seg pace-seg">
                  <span className="pace-label">{t("split_by")}</span>
                  {splitOpts.map((len) => (
                    <button key={len} className={effSplit === len ? "on" : ""} onClick={() => setSplitBy(String(len))}>
                      {len}{seg.unit}
                    </button>
                  ))}
                </div>
              )}
              {splits && (
                <table className="splittable">
                  <thead>
                    <tr>
                      <th>m</th>
                      <th>{t("splits_each")}</th>
                      <th>{t("splits_total")}</th>
                      {hasActual && <th>{t("swam")} · {t("splits_each")}</th>}
                      {hasActual && <th>{t("swam")} · {t("splits_total")}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {splits.map((s, i) => (
                      <tr key={i}>
                        <td className="mono">{s.dist}</td>
                        <td className="mono">{s.each}</td>
                        <td className="mono">{s.cum}</td>
                        {hasActual && <td className="mono actual">{actualEach[i] || "—"}</td>}
                        {hasActual && <td className="mono actual">{actualArr[i] || "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {timerDists && seg && (
                <button className="timer-open" onClick={() => setShowTimer(true)}>⏱ {t("timer_live")}</button>
              )}
              {splitDists && seg && (
                <div className="splitrows">
                  <span className="tf-lbl">{t("actual_lbl")}</span>
                  {splitDists.map((dist, i) => (
                    <div className="splitrow" key={i}>
                      <span className="splitrow-d mono">{dist}{seg.unit}</span>
                      <TimeFields value={actualArr[i] || ""} onChange={(v) => setSplitRow(i, v)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {!e.relay && (
        <div className="note-sec">
          {editNote ? (
            <textarea
              className="field note-input"
              autoFocus
              defaultValue={note || ""}
              placeholder={swimmer ? t("note_ph_me") : t("note_ph")}
              rows={2}
              onBlur={(ev) => {
                onNote?.(ev.target.value.trim());
                setEditNote(false);
              }}
            />
          ) : note ? (
            <div className="note-shown" onClick={() => setEditNote(true)}>
              📝 {note} <span className="muted">{t("note_edit")}</span>
            </div>
          ) : (
            <button className="inline-link" onClick={() => setEditNote(true)}>
              {swimmer ? t("note_add_me") : t("note_add")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ArmTable({
  items,
  results,
  cols,
}: {
  items: DE[];
  results: Record<string, string>;
  cols: { pb: boolean; cut: boolean; champ: boolean };
}) {
  const multi = new Set(items.map((d) => d.swimmer)).size > 1;
  const sorted = [...items].sort(
    (a, b) => (a.e.team || "").localeCompare(b.e.team || "") || a.e.event - b.e.event
  );
  const pbOf = (d: DE) => results[resultKey(d.meetId, d.e.event, d.swimmer)] || d.e.seed;
  const cutOf = (d: DE) => {
    const c = cutFor(d, results[resultKey(d.meetId, d.e.event, d.swimmer)]);
    return c?.nextCut ? `${c.nextCut.level} ${c.nextCut.time}` : "—";
  };
  const champOf = (d: DE) => {
    const c = cutFor(d, results[resultKey(d.meetId, d.e.event, d.swimmer)]);
    return c?.champ ? c.champ.time : "—";
  };
  // Highlight a row the swimmer has already qualified for, tinted by the highest cut reached
  // (motivational ladder B→AAAA; falls back to the 🏆 SE champ cut if that's all that's met).
  const achievedOf = (d: DE): { cls: string; label: string } | null => {
    const c = cutFor(d, results[resultKey(d.meetId, d.e.event, d.swimmer)]);
    if (!c) return null;
    if (c.achieved) return { cls: "lvl-" + c.achieved.toLowerCase(), label: c.achieved };
    if (c.champ?.met) return { cls: "arm-champ", label: "🏆" };
    return null;
  };
  return (
    <div className="card">
      <div className="arm-wrap">
      <table className="arm">
        <thead>
          <tr>
            {multi && <th>Who</th>}
            <th>Ev</th>
            <th>Ht</th>
            <th>Ln</th>
            <th>Swim</th>
            {cols.pb && <th>{t("c_pb")}</th>}
            {cols.cut && <th>{t("c_cut")}</th>}
            {cols.champ && <th>🏆</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d, i) => {
            const ach = achievedOf(d);
            return (
              <tr key={i} className={ach ? "arm-ach " + ach.cls : ""}>
                {multi && <td style={{ color: d.color, fontWeight: 600 }}>{firstName(d.swimmer)}</td>}
                <td className="mono">{d.e.event}</td>
                <td className="mono">{heatNum(d.e.heat)}</td>
                <td className="mono">{d.e.lane}</td>
                <td>
                  {swimAbbr(raceOf(d.e))}
                  {ach && <span className="arm-tick" title={t("arm_qualified", { lvl: ach.label })}>✓ {ach.label}</span>}
                </td>
                {cols.pb && <td className="mono">{pbOf(d)}</td>}
                {cols.cut && <td className="mono">{cutOf(d)}</td>}
                {cols.champ && <td className="mono">{champOf(d)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <p className="muted arm-note">{t("armlegend")} {t("arm_achnote")}</p>
    </div>
  );
}

function parseHM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}
function fmtClock(mins: number): string {
  let m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${ap}`;
}

function icsDateTime(dateStr: string, mins: number): string {
  const [y, mo, da] = dateStr.split("-");
  const m = ((mins % 1440) + 1440) % 1440;
  return `${y}${mo}${da}T${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}00`;
}
function buildIcs(dateStr: string, start: number): string {
  const events: [number, string][] = [
    [start - 75, t("ics_carbs")],
    [start - 30, t("ics_hydrate")],
    [start - 20, t("ics_warm")],
  ];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  let s = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//heat-guardian//EN\r\nCALSCALE:GREGORIAN\r\n";
  events.forEach(([mins, title], i) => {
    s +=
      "BEGIN:VEVENT\r\n" +
      `UID:hg-${dateStr}-${i}-${Math.random().toString(36).slice(2)}@heat-guardian\r\n` +
      `DTSTAMP:${stamp}\r\nDTSTART:${icsDateTime(dateStr, mins)}\r\nDURATION:PT5M\r\n` +
      `SUMMARY:🏊 ${title}\r\n` +
      `BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:${title}\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\n` +
      "END:VEVENT\r\n";
  });
  return s + "END:VCALENDAR\r\n";
}
function downloadFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadIcs(text: string) {
  downloadFile("heat-guardian-fuel.ics", new Blob([text], { type: "text/calendar" }));
}

// Save the parsed meet (+ its result overlay) as a .heatguardian.json pack to post in the
// team chat — works for uploaded PDFs too, which the URL share link can't carry.
function downloadPack(meet: Meet, results: Record<string, string>) {
  const slug = meet.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "meet";
  downloadFile(`${slug}.heatguardian.json`, new Blob([JSON.stringify(buildMeetPack(meet, results))], { type: "application/json" }));
}

function Fueling() {
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useStored("meetDate", today);
  const [time, setTime] = useStored("firstRaceTime", "");
  const start = parseHM(time);
  const by = (off: number) => (start != null ? t("fuel_by", { t: fmtClock(start + off) }) : "");
  const after = (off: number) => (start != null ? t("fuel_after", { t: fmtClock(start + off) }) : "");
  return (
    <section className="card fuel">
      <button className="prep-toggle" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} 💧 {t("fuel_title")}
      </button>
      {open && (
      <>
      <div className="fuel-inputs">
        <label className="fuel-time">
          {t("fuel_date")}{" "}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="fuel-time">
          {t("fuel_first")}{" "}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <ul>
        <li>{t("fuel_1")}</li>
        <li><b>{by(-75)}</b>{t("fuel_2")}</li>
        <li><b>{after(-45)}</b>{t("fuel_4")}</li>
        <li><b>{by(-25)}</b>{t("fuel_5")}</li>
        <li>{t("fuel_3")}</li>
      </ul>
      {start != null && (
        <button className="secondary" onClick={() => downloadIcs(buildIcs(date, start))}>
          {t("ics_btn")}
        </button>
      )}
      <h4 className="between-h">🥤 {t("between_h")}</h4>
      <ul>
        <li>{t("btw_short")}</li>
        <li>{t("btw_mid")}</li>
        <li>{t("btw_long")}</li>
        <li>{t("btw_session")}</li>
      </ul>
      <p className="muted small">{t("hydrate_note")}</p>
      </>
      )}
    </section>
  );
}

function Prep() {
  const [open, setOpen] = useState(false);
  return (
    <section className="card prep">
      <button className="prep-toggle" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {t("prep_title")}
      </button>
      {open && (
        <div className="prep-body">
          <h4>{t("warmup_h")}</h4>
          <ul>
            <li>{t("warmup_1")}</li>
            <li>{t("warmup_2")}</li>
            <li>{t("warmup_3")}</li>
            <li>{t("warmup_4")}</li>
          </ul>
          <h4>{t("stretch_h")}</h4>
          <ul>
            <li>{t("stretch_1")}</li>
            <li>{t("stretch_2")}</li>
          </ul>
          <h4>{t("meals_h")}</h4>
          <ul>
            <li>{t("meals_1")}</li>
            <li>{t("meals_2")}</li>
            <li>{t("meals_3")}</li>
          </ul>
          <p className="muted small">{t("prep_note")}</p>
        </div>
      )}
    </section>
  );
}

function Disclaimer() {
  const [hidden, setHidden] = useState(() => localStorage.getItem("dismiss-disclaimer") === "1");
  if (hidden) return null;
  return (
    <div className="disclaimer">
      <span>⚠️ {t("disclaimer")}</span>
      <button
        onClick={() => {
          localStorage.setItem("dismiss-disclaimer", "1");
          setHidden(true);
        }}
      >
        {t("gotit")}
      </button>
    </div>
  );
}

// Detects a new deploy (build id changed) and prompts a refresh — for tabs left open.
function UpdateBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let on = true;
    const check = async () => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (on && j.id && j.id !== __BUILD_ID__) setStale(true);
      } catch {
        /* offline / ignore */
      }
    };
    check();
    const iv = setInterval(check, 120000);
    const onVis = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      on = false;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  if (!stale) return null;
  return (
    <div className="update-banner">
      <span>🆕 {t("update_avail")}</span>
      <button onClick={() => location.reload()}>{t("update_refresh")}</button>
    </div>
  );
}

function darken(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  return (
    "#" +
    [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => Math.round(v * f).toString(16).padStart(2, "0"))
      .join("")
  );
}

function loadMap(key: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

export function App() {
  const [nav, setNav] = useState<Nav>(() => {
    const t = new URLSearchParams(location.search).get("tab");
    return (["home", "import", "swimmers", "watching", "progress", "teams", "about"].includes(t || "") ? t : "home") as Nav;
  });
  const [swimmers, setSwimmers] = useState<Swimmer[]>(loadSwimmers);
  const [meets, setMeets] = useState<Meet[]>(loadMeets);
  const [role, setRoleState] = useState<Role | null>(() => (localStorage.getItem("role") as Role) || null);
  const [coachTeam, setCoachTeam] = useStored("coachTeam", "");
  function setRole(r: Role | null) {
    setRoleState(r);
    if (r) localStorage.setItem("role", r);
    else localStorage.removeItem("role");
  }
  const [view, setView] = useStored<"cards" | "table">("view", "cards");
  const [filter, setFilter] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [shareCode, setShareCode] = useState(""); // a meet just shared → show its code persistently
  const [copied, setCopied] = useState(false);
  const [results, setResultsState] = useState<Record<string, string>>(loadResults);
  const [notes, setNotesState] = useState<Record<string, string>>(() => loadMap("notes"));
  const [goals, setGoalsState] = useState<Record<string, string>>(() => loadMap("goals"));
  const [asplits, setAsplitsState] = useState<Record<string, string>>(() => loadMap("actualsplits"));
  // Heat completion: "1" = this swim has been marked done on deck. Lets "Up next" advance past
  // races that already happened even when no time was logged for them.
  const [done, setDoneState] = useState<Record<string, string>>(() => loadMap("done"));
  // Heat-LEVEL completion for the follow-along heatsheet (slash the whole heat box), keyed
  // meetId|event|heatNum. Separate from per-swim `done`; both feed "Up next" so a slashed heat
  // also clears your swimmer from what's coming.
  const [heatDone, setHeatDoneState] = useState<Record<string, string>>(() => loadMap("heatdone"));
  // Bulk so the heat tracker can complete a run of heats at once (marking a heat done also
  // sweeps every earlier heat done — if heat 10 just swam, 1–9 are over too).
  function setHeatsDone(meetId: string, heats: { event: number; ho: number }[], on: boolean) {
    const next = { ...heatDone };
    for (const h of heats) {
      const k = `${meetId}|${h.event}|${h.ho}`;
      if (on) next[k] = "1"; else delete next[k];
    }
    setHeatDoneState(next);
    localStorage.setItem("heatdone", JSON.stringify(next));
  }
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [lang, setLangState] = useState<Lang>(getLang);
  const [pacing, setPacing] = useStored<"even" | "realistic">("pacing", "even");
  const [splitBy, setSplitBy] = useStored<string>("splitBy", ""); // "" = pool length; "25"/"50" override
  const [lefty, setLefty] = useStored<string>("lefty", ""); // "1" = left-handed layout (controls mirrored)
  const [probSnap, setProbSnap] = useStored<string>("probSnap", ""); // "1" = show next-goal probability snapshots (opt-in, off by default)
  const [myTeam, setMyTeam] = useStored<string>("myTeam", ""); // your team — sticks until you change it; highlights the whole team on deck
  const [logo, setLogo] = useStored("teamLogo", "");
  const [brand, setBrand] = useStored("brandColor", "");
  // 🫧 taunt easter egg: 5 quick taps on the logo → a random taunt toast (see TAUNTS).
  // tauntTier caps the edge: "mild" (default) keeps it kind; "savage" unlocks all tiers.
  const [tauntTier, setTauntTier] = useStored<TauntTier>("tauntTier", "mild");
  const [taunt, setTaunt] = useState("");
  const tapRef = useRef<{ n: number; at: number }>({ n: 0, at: 0 });
  function bumpLogo() {
    const now = Date.now();
    const r = tapRef.current;
    r.n = now - r.at < 1500 ? r.n + 1 : 1;
    r.at = now;
    if (r.n >= 5) {
      r.n = 0;
      const pool = TAUNTS.filter((x) => TIER_RANK[x.tier] <= TIER_RANK[tauntTier]);
      setTaunt(pool[Math.floor(Math.random() * pool.length)].text);
      setTimeout(() => setTaunt(""), 2600);
    }
  }
  useEffect(() => {
    const el = document.documentElement;
    if (brand) {
      el.style.setProperty("--brand", brand);
      el.style.setProperty("--brand2", darken(brand, 0.6));
    } else {
      el.style.removeProperty("--brand");
      el.style.removeProperty("--brand2");
    }
  }, [brand]);

  function changeLang(l: Lang) {
    setLang(l);
    setLangState(l);
  }

  const roster = useMemo(() => buildRoster(meets), [meets]);
  // In coach mode the active list is the whole chosen team's roster (derived live);
  // parents use their own saved swimmers.
  const coaching = role === "coach" && !!coachTeam;
  // Show the normal tabbed app only once a role is chosen (and a coach has picked a team).
  const gated = role !== null && !(role === "coach" && !coachTeam);
  const activeSwimmers = useMemo(
    () => (coaching ? teamSwimmers(meets, coachTeam) : swimmers),
    [coaching, coachTeam, meets, swimmers]
  );
  // Live results: poll a public results URL on a timer and overlay new times as they post.
  const [liveUrl, setLiveUrl] = useStored("liveUrl", "");
  const [liveOn, setLiveOnState] = useState(() => localStorage.getItem("liveOn") === "1");
  const [liveStatus, setLiveStatus] = useState("");
  function setLiveOn(v: boolean) {
    setLiveOnState(v);
    localStorage.setItem("liveOn", v ? "1" : "0");
  }
  // Community meet directory: start with the bundled copy, then refresh from the repo.
  const [directory, setDirectory] = useState<DirMeet[]>(meetsDirectory as DirMeet[]);
  const loadDirectory = useCallback(
    () =>
      fetch(DIRECTORY_URL)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (Array.isArray(d) && d.length) setDirectory(d); })
        .catch(() => { /* keep bundled */ }),
    []
  );
  useEffect(() => { loadDirectory(); }, [loadDirectory]);

  // A meet shared via link (?add=...) — offer to import it.
  const [pendingShare, setPendingShare] = useState<SharePayload | null>(readSharePayload);
  function clearShare() {
    setPendingShare(null);
    history.replaceState({}, "", location.pathname + location.hash);
  }

  function setResult(meetId: string, event: number, name: string, val: string) {
    const next = { ...results };
    const k = resultKey(meetId, event, name);
    if (val.trim()) next[k] = val.trim();
    else delete next[k];
    setResultsState(next);
    saveResults(next);
  }
  function setMap(
    kind: "goal" | "splits" | "note" | "done",
    meetId: string,
    event: number,
    name: string,
    val: string
  ) {
    const map = kind === "goal" ? goals : kind === "splits" ? asplits : kind === "note" ? notes : done;
    const setter = kind === "goal" ? setGoalsState : kind === "splits" ? setAsplitsState : kind === "note" ? setNotesState : setDoneState;
    const storeKey = kind === "goal" ? "goals" : kind === "splits" ? "actualsplits" : kind === "note" ? "notes" : "done";
    const next = { ...map };
    const k = resultKey(meetId, event, name);
    if (val.trim()) next[k] = val.trim();
    else delete next[k];
    setter(next);
    localStorage.setItem(storeKey, JSON.stringify(next));
  }

  function persistSwimmers(s: Swimmer[]) {
    setSwimmers(s);
    saveSwimmers(s);
  }
  function persistMeets(m: Meet[]) {
    setMeets(m);
    saveMeets(m);
  }
  function addSwimmer(name: string, team: string, age?: number, gender?: "Girls" | "Boys", watch?: boolean) {
    if (!name.trim()) return;
    const existing = swimmers.find((s) => matchesName(s.name, name) && (s.team || "") === (team || ""));
    if (existing) {
      // Already on the list — flip their list (mine ↔ watch) when you tap the OTHER button,
      // instead of silently doing nothing (the bug where "Watch" looked unresponsive).
      if (!!existing.watch !== !!watch) persistSwimmers(swimmers.map((s) => (s.id === existing.id ? { ...s, watch } : s)));
      return;
    }
    persistSwimmers([...swimmers, makeSwimmer(name, team, swimmers.length, age, gender, watch)]);
  }
  function removeSwimmer(id: string) {
    persistSwimmers(swimmers.filter((s) => s.id !== id));
  }
  function toggleFilter(id: string) {
    const n = new Set(filter);
    n.has(id) ? n.delete(id) : n.add(id);
    setFilter(n);
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMsg("");
    const outcomes: ImportOutcome[] = [];
    let err = "";
    for (const f of Array.from(files)) {
      try {
        outcomes.push(await importFile(f));
      } catch (e: any) {
        // store throws i18n keys (err_*) for known cases; t() passes plain messages through.
        err = e?.message ? t(e.message) : `Couldn't read ${f.name}.`;
      }
    }
    finishImport(outcomes, err);
  }

  async function onUrl(url: string) {
    if (!url.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      finishImport([await importUrl(url, loadProxy() || DEFAULT_PROXY)], "");
    } catch (e: any) {
      finishImport([], e?.message ? t(e.message) : "Couldn't fetch that link.");
    }
  }

  // Import a meet someone shared via a short code (pulls the cached JSON — no re-parse).
  async function onCode(code: string) {
    if (!code.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      finishImport([await importMeetCode(code, loadProxy() || DEFAULT_PROXY)], "");
    } catch (e: any) {
      finishImport([], t(e?.message || "share_failed"));
    }
  }

  // Go live from a host-bridge code: results are served at <backend>/live/<code> as a Hy-Tek page,
  // so we just point the live poller at that URL — same overlay path as a public results link.
  function onLiveCode(code: string) {
    const c = code.trim().toUpperCase();
    if (!c) return;
    const base = backendBase(loadProxy() || DEFAULT_PROXY);
    if (!base) { setMsg(t("share_unavailable")); return; }
    setLiveUrl(`${base}/live/${encodeURIComponent(c)}`);
    setLiveOn(true);
    setNav("home");
  }

  // Push this meet to the shared cache and show the code to pass to teammates.
  async function onShareMeet(meet: Meet) {
    setBusy(true);
    setMsg("");
    try {
      const code = await cacheMeet(meet, results, loadProxy() || DEFAULT_PROXY);
      try { await navigator.clipboard?.writeText(code); } catch { /* clipboard may be blocked */ }
      setShareCode(code); // persistent banner with Copy / Share, instead of a fleeting toast
      setCopied(true);
    } catch (e: any) {
      setMsg(t(e?.message || "share_failed"));
    }
    setBusy(false);
  }

  function finishImport(outcomes: ImportOutcome[], err: string) {
    // Same-meet files MERGE into one meet keyed by title+start — so importing all of a meet's
    // session PDFs (Friday Prelims, Saturday, Sunday…) yields ONE meet carrying every session,
    // and re-importing a sheet is a no-op (identical entries are deduped, not duplicated).
    // Results imports (kind "results") overlay times onto matched swimmers, not add a meet.
    const meetKey = (m: Meet) => `${m.title.trim().toLowerCase()}|${m.start || ""}`;
    const entryKey = (e: Entry) => `${e.event}|${e.heat}|${e.lane}|${e.name}|${e.session ?? ""}`;
    const incoming = outcomes.flatMap((o) =>
      o.kind === "meet" ? [{ ...o.meet, entries: [...o.meet.entries] }] : []
    );
    const merged = meets.map((m) => ({ ...m, entries: [...m.entries] })); // mutable copies
    const byKey = new Map<string, Meet>();
    for (const m of merged) if (!byKey.has(meetKey(m))) byKey.set(meetKey(m), m);
    const idMap = new Map<string, string>(); // source meet id → final stored meet id
    const freshMeets: Meet[] = [];
    let addedEntries = 0;
    for (const src of incoming) {
      const k = meetKey(src);
      let target = byKey.get(k);
      if (!target) {
        target = src;
        byKey.set(k, target);
        freshMeets.push(target);
        addedEntries += target.entries.length;
      } else {
        const seen = new Set(target.entries.map(entryKey));
        for (const e of src.entries)
          if (!seen.has(entryKey(e))) { target.entries.push(e); seen.add(entryKey(e)); addedEntries++; }
      }
      idMap.set(src.id, target.id);
    }
    const resultSets = outcomes.flatMap((o) => (o.kind === "results" ? [o] : []));
    let meetsNext = meets;
    if (freshMeets.length || addedEntries) {
      meetsNext = [...freshMeets, ...merged];
      persistMeets(meetsNext);
    }
    const parts: string[] = [];
    if (freshMeets.length) parts.push(`Imported ${freshMeets.length} meet(s) — ${addedEntries} entries loaded.`);
    else if (addedEntries) parts.push(`Added ${addedEntries} entries to your meet.`);
    else if (incoming.length) parts.push(`Those entries were already imported.`);
    // Meet packs bundle a result overlay keyed without the meet id (ids differ per device) —
    // re-prefix each key with the FINAL meet's id (the new meet, or the one it merged into).
    let r = results;
    let dirty = false;
    for (const o of outcomes)
      if (o.kind === "meet" && o.results)
        for (const [k, v] of Object.entries(o.results)) {
          if (!dirty) { r = { ...results }; dirty = true; }
          r[`${idMap.get(o.meet.id) ?? o.meet.id}|${k}`] = v;
        }
    // Read role/team fresh: "Coach this team" on a share link sets them right before the
    // async import lands, so the closure's `coaching` can be stale here.
    const teamNow = localStorage.getItem("role") === "coach" ? localStorage.getItem("coachTeam") || "" : "";
    const coachingNow = !!teamNow;
    if (resultSets.length) {
      // Coaches match results against the whole team roster (incl. meets imported in this
      // same batch), like the live poller does — not just the persisted swimmer list.
      const matchable = coachingNow ? teamSwimmers(meetsNext, teamNow) : swimmers;
      let matched = 0;
      for (const rs of resultSets) {
        const applied = applyResults(rs.finishers, matchable, meetsNext, r);
        r = applied.results;
        matched += applied.matched;
      }
      dirty = true;
      parts.push(
        matched > 0
          ? `Results: filled ${matched} actual time(s) for your swimmers. 🏁`
          : `Results read, but no times matched your swimmers — import that meet's heat sheet and pick your swimmers first.`
      );
    }
    if (dirty) {
      setResultsState(r);
      saveResults(r);
    }
    if (!outcomes.length && err) parts.push(err);
    if ((freshMeets.length || addedEntries || resultSets.length) && (swimmers.length || coachingNow)) setNav("home");
    else if (freshMeets.length && !swimmers.length && !coachingNow) setNav("swimmers");
    setMsg(parts.join(" ").trim());
    setBusy(false);
  }

  // Show the import confirmation/error as an app-level toast (auto-clears) so it survives the
  // navigation to Home/Swimmers on a successful import — otherwise it unmounts with ImportView
  // and the parent gets zero feedback that anything happened.
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(""), 6000);
    return () => clearTimeout(id);
  }, [msg]);

  // One live poll: fetch the results URL, overlay any new times, and report what changed.
  const pollLive = useCallback(async () => {
    if (!liveUrl.trim()) return;
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    try {
      const outcome = await importUrl(liveUrl, loadProxy() || DEFAULT_PROXY);
      if (outcome.kind === "results") {
        const applied = applyResults(outcome.finishers, activeSwimmers, meets, results);
        setResultsState(applied.results);
        saveResults(applied.results);
        setLiveStatus(applied.matched > 0 ? t("live_updated", { time: now, n: applied.matched }) : t("live_none", { time: now }));
      } else {
        // A heat sheet at the live URL: add it if it's new (lets events show up to overlay).
        if (!meets.some((m) => m.title === outcome.meet.title)) persistMeets([outcome.meet, ...meets]);
        setLiveStatus(t("live_none", { time: now }));
      }
    } catch {
      setLiveStatus(t("live_err", { time: now }));
    }
  }, [liveUrl, activeSwimmers, meets, results]);

  // Keep a stable 60s interval that always calls the latest pollLive (avoids resetting the
  // timer every time results change, which would otherwise re-poll in a tight loop).
  const pollRef = useRef(pollLive);
  pollRef.current = pollLive;
  useEffect(() => {
    if (!liveOn || !liveUrl.trim()) {
      if (!liveOn) setLiveStatus("");
      return;
    }
    pollRef.current();
    const id = setInterval(() => pollRef.current(), 60000);
    return () => clearInterval(id);
  }, [liveOn, liveUrl]);

  return (
    <div className={"app" + (lefty === "1" ? " lefty" : "")}>
      <UpdateBanner />
      {taunt && <div className="taunt-pop" onClick={() => setTaunt("")}>{taunt}</div>}
      {msg && <div className="app-toast" onClick={() => setMsg("")}>{msg}</div>}
      {busy && !msg && <div className="app-toast busy-toast">⏳ {t("imp_working")}</div>}
      {shareCode && (
        <div className="share-code-banner">
          <div className="scb-text">
            <span className="scb-label">{t("share_code_label")}</span>
            <strong className="scb-value">{shareCode}</strong>
            <span className="scb-hint">{t("share_code_hint")}</span>
          </div>
          <div className="scb-actions">
            <button
              className="chip sm"
              onClick={async () => { try { await navigator.clipboard?.writeText(shareCode); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}
            >
              {copied ? t("share_copied2") : t("share_copy")}
            </button>
            {typeof navigator !== "undefined" && (navigator as any).share && (
              <button
                className="chip sm"
                onClick={() => (navigator as any).share({ title: "Heat Guardian", text: t("share_msg_text", { code: shareCode }) }).catch(() => {})}
              >
                {t("share_share")}
              </button>
            )}
            <button className="chip sm scb-x" onClick={() => setShareCode("")}>✕</button>
          </div>
        </div>
      )}
      <header className="apphead">
        <div className="brandrow">
          <div className="brand" onClick={bumpLogo} title="Heat Guardian">
            {logo && <img className="team-logo" src={logo} alt="" />}🏊 Heat Guardian
          </div>
          <div className="head-ctrls">
            {/* Language stays reachable on first run (before Settings exists); once you're
                in, language + theme live in Settings to keep the header calm. */}
            {!gated && (
              <select className="lang-sel" value={lang} onChange={(e) => changeLang(e.target.value as Lang)} aria-label={t("lang_label")}>
                {LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.flag} {l.label}
                  </option>
                ))}
              </select>
            )}
            {gated && (
              <button className={"gear-btn" + (nav === "settings" || nav === "import" || nav === "about" ? " on" : "")} onClick={() => setNav("settings")} aria-label={t("nav_settings")}>
                ⚙
              </button>
            )}
          </div>
        </div>
        {role && !(role === "coach" && !coachTeam) && (
          <nav className="tabs">
            {((coaching ? ["home", "live"] : ["home", "swimmers", "live"]) as Nav[]).map((tb) => (
              <button key={tb} className={nav === tb ? "on" : ""} onClick={() => setNav(tb)}>
                {t("nav_" + tb)}
              </button>
            ))}
          </nav>
        )}
        {coaching && (
          <div className="coachbar">
            <span>🧑‍🏫 {t("role_coach")} · <strong>{coachTeam}</strong></span>
            <button className="coach-switch" onClick={() => { setCoachTeam(""); }}>{t("coach_switch")}</button>
          </div>
        )}
      </header>

      {role === null && (
        <RolePicker onPick={(r) => { setRole(r); if (r !== "coach") setCoachTeam(""); setNav("home"); }} />
      )}
      {role === "coach" && !coachTeam && (
        <CoachTeamPicker
          teams={buildTeams(meets)}
          onPick={setCoachTeam}
          goImport={() => setNav("import")}
          onBack={() => setRole(null)}
        />
      )}

      {/* Team links also show during first-run setup — "Coach this team" IS the setup. */}
      {pendingShare && (gated || pendingShare.tm) && (
        <div className="card share-import">
          <h3>📥 {t("share_got")}</h3>
          <p className="disc-title">{pendingShare.t || t("share_meet")}</p>
          {pendingShare.tm && <p className="muted">{t("share_team", { team: pendingShare.tm })}</p>}
          <div className="disc-actions">
            <button className="primary" onClick={() => { onUrl(pendingShare.u); clearShare(); }}>{t("share_import")}</button>
            {pendingShare.tm && (
              <button
                className="chip"
                onClick={() => {
                  setRole("coach");
                  setCoachTeam(pendingShare.tm!);
                  onUrl(pendingShare.u);
                  clearShare();
                }}
              >
                🧑‍🏫 {t("share_coach")}
              </button>
            )}
            {pendingShare.r && (
              <button className="chip golive" onClick={() => { setLiveUrl(pendingShare.r!); setLiveOn(true); clearShare(); setNav("home"); }}>🔴 {t("disc_golive")}</button>
            )}
            <button className="inline-link" onClick={clearShare}>{t("share_dismiss")}</button>
          </div>
        </div>
      )}
      {gated && nav === "home" && (
        <Home
          swimmers={activeSwimmers}
          meets={meets}
          view={view}
          pickView={setView}
          filter={filter}
          toggleFilter={toggleFilter}
          goImport={() => setNav("import")}
          goSwimmers={() => setNav("swimmers")}
          progress={buildProgress(activeSwimmers, meets, results)}
          removeMeet={(id: string) => persistMeets(meets.filter((m) => m.id !== id))}
          onShareMeet={onShareMeet}
          results={results}
          setResult={setResult}
          goals={goals}
          asplits={asplits}
          notes={notes}
          done={done}
          heatDone={heatDone}
          setHeatsDone={setHeatsDone}
          setMap={setMap}
          pacing={pacing}
          setPacing={setPacing}
          splitBy={splitBy}
          setSplitBy={setSplitBy}
          probSnap={probSnap}
          myTeam={myTeam}
          liveOn={liveOn}
          liveStatus={liveStatus}
          coach={coaching}
          coachTeam={coaching ? coachTeam : ""}
          swimmer={role === "swimmer"}
        />
      )}
      {gated && nav === "live" && (
        <LiveView
          meets={meets}
          swimmers={activeSwimmers}
          myTeam={myTeam}
          heatDone={heatDone}
          setHeatsDone={setHeatsDone}
          goImport={() => setNav("import")}
        />
      )}
      {gated && nav === "import" && (
        <>
          <button className="back-link" onClick={() => setNav("settings")}>‹ {t("nav_settings")}</button>
          <ImportView
            busy={busy}
            msg={msg}
            onFiles={onFiles}
            onUrl={onUrl}
            onCode={onCode}
            onLiveCode={onLiveCode}
            goAbout={() => setNav("about")}
            liveUrl={liveUrl}
            liveOn={liveOn}
            liveStatus={liveStatus}
            setLiveUrl={setLiveUrl}
            setLiveOn={setLiveOn}
            directory={directory}
            onGoLive={(u: string) => { setLiveUrl(u); setLiveOn(true); setNav("home"); }}
          />
        </>
      )}
      {gated && !coaching && nav === "swimmers" && (
        <SwimmersView
          swimmers={swimmers}
          roster={roster}
          teams={buildTeams(meets)}
          addSwimmer={addSwimmer}
          removeSwimmer={removeSwimmer}
          goImport={() => setNav("import")}
          swimmer={role === "swimmer"}
        />
      )}
      {gated && nav === "settings" && (
        <SettingsView
          goImport={() => setNav("import")}
          goAbout={() => setNav("about")}
          theme={theme}
          setTheme={(v: Theme) => { setTheme(v); setThemeState(v); }}
          lang={lang}
          changeLang={changeLang}
          tauntTier={tauntTier}
          setTauntTier={setTauntTier}
          lefty={lefty}
          setLefty={setLefty}
          probSnap={probSnap}
          setProbSnap={setProbSnap}
          myTeam={myTeam}
          setMyTeam={setMyTeam}
          teams={buildTeams(meets).map((t) => t.team)}
          role={role}
          onChangeRole={() => setRole(null)}
          logo={logo}
          setLogo={setLogo}
          setBrand={setBrand}
        />
      )}
      {gated && nav === "about" && (
        <>
          <button className="back-link" onClick={() => setNav("settings")}>‹ {t("nav_settings")}</button>
          <About />
        </>
      )}
    </div>
  );
}

function buildDisplay(meets: Meet[], swimmers: Swimmer[], filter: Set<string>) {
  const active = swimmers.filter((s) => filter.size === 0 || filter.has(s.id));
  return meets.map((m) => {
    const items: DE[] = [];
    for (const s of active)
      for (const e of m.entries)
        if (matchesName(s.name, e.name))
          items.push({ e, color: s.color, swimmer: s.name, age: s.age, gender: s.gender, meetId: m.id });
    items.sort(swimOrder);
    return { meet: m, items };
  });
}

// The whole meet program as Event → Heat → Lanes (every swimmer, not just yours) — the data
// the follow-along heatsheet renders. Heats with no number (TBD) sort last via heatOrd.
interface ProgHeat { ho: number; label: string; total: number; lanes: Entry[] }
interface ProgEvent { event: number; race: string; heats: ProgHeat[] }
// The age-group phrase from an event desc, e.g. "Girls 13 & Over 200 LC Meter Free" → "13 & Over"
// (for the heat-tracker age filter — meets often run "12 & Under" and "13 & Over" sessions).
function agePhrase(desc: string): string {
  const m = /^(?:Girls|Boys|Women|Men|Mixed|Open)\s+(.+?)\s+\d{2,4}\s+(?:LC|SC)\b/i.exec(desc);
  return m ? m[1].trim() : "";
}
function buildProgram(entries: Entry[]): ProgEvent[] {
  const events = new Map<number, { race: string; heats: Map<number, Entry[]> }>();
  for (const e of entries) {
    if (!events.has(e.event)) events.set(e.event, { race: e.race, heats: new Map() });
    const ev = events.get(e.event)!;
    const ho = heatOrd(e.heat);
    if (!ev.heats.has(ho)) ev.heats.set(ho, []);
    ev.heats.get(ho)!.push(e);
  }
  return [...events.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([event, ev]) => {
      const heatList = [...ev.heats.entries()].sort((a, b) => a[0] - b[0]);
      return {
        event,
        race: ev.race,
        heats: heatList.map(([ho, lanes]) => ({
          ho,
          label: lanes[0]?.heat || "",
          total: heatList.length,
          lanes: [...lanes].sort((a, b) => a.lane - b.lane),
        })),
      };
    });
}

// Full-screen follow-along heatsheet: the paper-deck workflow on a phone. Tap a heat box to
// "slash" it off when it finishes; your own/watched swimmers' lanes are highlighted (the pen
// circle); the first un-slashed heat is tagged "now". Heat completion persists + feeds Up next.
function FollowHeats({ meet, swimmers, myTeam, heatDone, setHeatsDone, onClose }: {
  meet: Meet;
  swimmers: Swimmer[];
  myTeam: string;
  heatDone: Record<string, string>;
  setHeatsDone: (meetId: string, heats: { event: number; ho: number }[], on: boolean) => void;
  onClose: () => void;
}) {
  const swimmerFor = (name: string) => swimmers.find((s) => matchesName(s.name, name)) || null;
  // Your team(s) — your saved (non-watch) swimmers' teams PLUS your sticky "my team" pick. Every
  // teammate on deck gets a lighter highlight even if you haven't added them, for team-wide
  // visibility (coaches see this for free since their roster IS the team; parents get it too).
  const myTeams = useMemo(() => {
    const s = new Set(swimmers.filter((sw) => !sw.watch && sw.team).map((sw) => sw.team));
    if (myTeam) s.add(myTeam);
    return s;
  }, [swimmers, myTeam]);
  // "now", cascade, and completion are computed on the FULL program (true meet position) so a
  // filtered view never loses track of where the meet actually is.
  const fullProgram = useMemo(() => buildProgram(meet.entries), [meet]);
  const flat = useMemo(() => fullProgram.flatMap((ev) => ev.heats.map((h) => ({ event: ev.event, ho: h.ho }))), [fullProgram]);
  const nowRef = useRef<HTMLDivElement | null>(null);
  const isDone = (event: number, ho: number) => !!heatDone[`${meet.id}|${event}|${ho}`];
  let nowId: string | null = null;
  for (const ev of fullProgram) {
    for (const h of ev.heats) if (!isDone(ev.event, h.ho)) { nowId = `${ev.event}|${h.ho}`; break; }
    if (nowId) break;
  }

  // ---- Meet start time + loose per-heat clock estimate + meet-complete ----
  const [startT, setStartT] = useState<string>(() => { try { return JSON.parse(localStorage.getItem("meetstart") || "{}")[meet.id] || ""; } catch { return ""; } });
  const saveStart = (v: string) => {
    setStartT(v);
    try { const m = JSON.parse(localStorage.getItem("meetstart") || "{}"); if (v) m[meet.id] = v; else delete m[meet.id]; localStorage.setItem("meetstart", JSON.stringify(m)); } catch { /* ignore */ }
  };
  const startMin = (() => { const m = /^(\d{1,2}):(\d{2})$/.exec(startT); return m ? +m[1] * 60 + +m[2] : null; })();
  // Loose estimate: each heat ≈ distance-scaled swim + ~1 min of starts/turnover. Deliberately rough.
  const est = useMemo(() => {
    const offset: Record<string, number> = {};
    let cum = 0;
    for (const ev of fullProgram) {
      const dist = parseInt(ev.race, 10);
      const per = (isFinite(dist) ? dist : 50) / 100 * 1.4 + 1.0;
      for (const h of ev.heats) { offset[`${ev.event}|${h.ho}`] = cum; cum += per; }
    }
    return { offset, total: cum };
  }, [fullProgram]);
  const clockOf = (id: string): string | null => {
    if (startMin == null) return null;
    const mins = startMin + (est.offset[id] || 0);
    const hh = Math.floor(mins / 60) % 24;
    const mm = Math.round(mins % 60);
    return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")}${hh < 12 ? "a" : "p"}`;
  };
  const allDone = flat.length > 0 && flat.every((f) => isDone(f.event, f.ho));
  const toggleComplete = () => {
    const completing = !allDone;
    setHeatsDone(meet.id, flat, completing);
    if (completing) maybeAskReview(); // a meet just wrapped — a good moment to ask for a rating
  };
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const overdue = startMin != null && !allDone && nowMin > startMin + est.total + 20;

  // ---- Filters: my swimmers, day/session, age group, event ----
  const [fMine, setFMine] = useState(false);
  const [fDay, setFDay] = useState("");
  const [fAge, setFAge] = useState("");
  const [fEvent, setFEvent] = useState("");
  const days = useMemo(() => [...new Set(meet.entries.map((e) => e.session).filter(Boolean))] as string[], [meet]);
  const ages = useMemo(() => [...new Set(meet.entries.map((e) => agePhrase(e.desc)).filter(Boolean))].sort(), [meet]);
  const hasFilter = fMine || !!fDay || !!fAge || !!fEvent;
  const program = useMemo(() => {
    if (!hasFilter) return fullProgram;
    const mineHeats = new Set<string>();
    if (fMine) for (const e of meet.entries) if (swimmerFor(e.name)) mineHeats.add(`${e.event}|${heatOrd(e.heat)}`);
    const keep = meet.entries.filter((e) => {
      if (fEvent && e.event !== +fEvent) return false;
      if (fDay && e.session !== fDay) return false;
      if (fAge && agePhrase(e.desc) !== fAge) return false;
      if (fMine && !mineHeats.has(`${e.event}|${heatOrd(e.heat)}`)) return false;
      return true;
    });
    return buildProgram(keep);
  }, [fullProgram, meet, fMine, fDay, fAge, fEvent, hasFilter, swimmers]);
  // Marking a heat done sweeps it AND every earlier heat done (skipping ahead closes the past);
  // undo clears just that one. Either way the list shrinks, so "now" naturally moves forward.
  const toggleHeat = (event: number, ho: number, currentlyDone: boolean) => {
    if (currentlyDone) {
      setHeatsDone(meet.id, [{ event, ho }], false);
    } else {
      const idx = flat.findIndex((f) => f.event === event && f.ho === ho);
      setHeatsDone(meet.id, flat.slice(0, idx + 1), true);
    }
  };
  const jumpNow = () => nowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  // Auto-advance: when the current heat closes, glide to the new "now". Scrolling stays free —
  // this only fires when nowId actually changes (open, or a heat marked done), not while you browse.
  useEffect(() => { nowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [nowId]);

  return (
    <div className="fh-overlay">
      <div className="fh-bar">
        <button className="fh-close" title={t("fh_close")} onClick={onClose}>✕</button>
        <span className="fh-title">{meet.title}</span>
        {nowId && <button className="fh-jump" onClick={jumpNow}>⏱ {t("fh_jump_now")}</button>}
      </div>
      <p className="fh-hint">{t("fh_tap")}</p>
      <div className="fh-meta">
        <label className="fh-start">⏰ {t("meet_start")} <input type="time" value={startT} onChange={(e) => saveStart(e.target.value)} /></label>
        <button className={"fh-complete" + (allDone ? " on" : "")} onClick={toggleComplete}>
          {allDone ? "✓ " + t("meet_complete_done") : t("meet_complete")}
        </button>
      </div>
      {overdue && (
        <button className="fh-overdue" onClick={toggleComplete}>{t("meet_over_q")}</button>
      )}
      <div className="fh-filters">
        <button className={"fh-fchip" + (fMine ? " on" : "")} onClick={() => setFMine((v) => !v)}>★ {t("fh_f_mine")}</button>
        {days.length > 1 && (
          <select className="fh-fsel" value={fDay} onChange={(e) => setFDay(e.target.value)}>
            <option value="">{t("fh_f_day")}</option>
            {days.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {ages.length > 1 && (
          <select className="fh-fsel" value={fAge} onChange={(e) => setFAge(e.target.value)}>
            <option value="">{t("fh_f_age")}</option>
            {ages.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        {fullProgram.length > 1 && (
          <select className="fh-fsel" value={fEvent} onChange={(e) => setFEvent(e.target.value)}>
            <option value="">{t("fh_f_event")}</option>
            {fullProgram.map((ev) => <option key={ev.event} value={ev.event}>#{ev.event} {ev.race}</option>)}
          </select>
        )}
        {hasFilter && (
          <button className="fh-fclear" onClick={() => { setFMine(false); setFDay(""); setFAge(""); setFEvent(""); }}>✕ {t("fh_f_clear")}</button>
        )}
      </div>
      <div className="fh-scroll">
        {program.length === 0 ? (
          <p className="muted fh-empty">{hasFilter ? t("fh_f_none") : t("fh_empty")}</p>
        ) : (
          program.map((ev) => (
            <div className="fh-event" key={ev.event}>
              <h3 className="fh-evhead">#{ev.event} · {ev.race}</h3>
              {ev.heats.map((h) => {
                const id = `${ev.event}|${h.ho}`;
                const done = isDone(ev.event, h.ho);
                const now = id === nowId;
                return (
                  <div
                    className={"fh-heat" + (done ? " done" : "") + (now ? " now" : "")}
                    key={id}
                    ref={now ? nowRef : undefined}
                  >
                    <button className={"fh-heat-head" + (done ? " done" : "")} onClick={() => toggleHeat(ev.event, h.ho, done)}>
                      <span className="fh-heat-label">
                        <span className="fh-heat-ev">#{ev.event} {ev.race}</span>
                        <span className="fh-heat-no">
                          {h.ho >= 9999 ? t("heat_tbd") : t("heat_n", { n: h.ho }) + (h.total > 1 ? ` / ${h.total}` : "")}
                          {now && <span className="fh-now-tag">⏱ {t("fh_now")}</span>}
                          {!done && clockOf(id) && <span className="fh-est">~{clockOf(id)}</span>}
                        </span>
                      </span>
                      <span className={"fh-donebtn" + (done ? " on" : "")}>{done ? t("fh_heat_undo") : t("fh_heat_done")}</span>
                    </button>
                    <div className="fh-lanes">
                      {h.lanes.map((e, i) => {
                        const sw = swimmerFor(e.name);
                        const teammate = !sw && !e.relay && !!e.team && myTeams.has(e.team);
                        return (
                          <div className={"fh-lane" + (sw ? " mine" : teammate ? " teammate" : "")} key={i} style={sw ? { borderLeftColor: sw.color } : undefined}>
                            <span className="fh-ln" style={sw ? { background: sw.color, color: "#fff", borderColor: sw.color } : undefined}>{e.lane}</span>
                            <span className="fh-nm">{sw && <span className="fh-you" style={{ color: sw.color }}>★ </span>}{e.relay ? e.team : displayName(e.name)}{!e.relay && parseInt(e.age, 10) > 0 ? <span className="fh-age"> · {parseInt(e.age, 10)}</span> : null}</span>
                            {!e.relay && <span className="fh-team">{e.team}</span>}
                            <span className="fh-seed mono">{e.seed}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Live split stopwatch — what parents actually do on deck: tap Start at the strobe flash, then
// tap Split each time their swimmer touches the wall. Records the cumulative time at each length
// (lap time = the delta) and saves them straight into the swim's splits (+ the finish as the time).
function SplitTimer({ dists, unit, onSave, onClose }: {
  dists: number[];
  unit: string;
  onSave: (cumulative: string[], finalTime: string) => void;
  onClose: () => void;
}) {
  const [startAt, setStartAt] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [laps, setLaps] = useState<number[]>([]); // cumulative ms at each wall touch
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    let id = 0;
    const loop = () => { tick((t) => t + 1); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [running]);
  const total = dists.length;
  const done = laps.length >= total;
  const elapsed = startAt == null ? 0 : running ? performance.now() - startAt : (laps.length ? laps[laps.length - 1] : 0);
  const fmtMs = (ms: number) => fmt(ms / 1000);
  const start = () => { setStartAt(performance.now()); setLaps([]); setRunning(true); };
  const split = () => {
    if (startAt == null || done) return;
    try { navigator.vibrate?.(15); } catch { /* no haptics */ }
    setLaps((l) => { const next = [...l, performance.now() - startAt]; if (next.length >= total) setRunning(false); return next; });
  };
  const reset = () => { setStartAt(null); setRunning(false); setLaps([]); };
  const save = () => { if (!laps.length) return; const cum = laps.map(fmtMs); onSave(cum, cum[cum.length - 1]); onClose(); };
  return (
    <div className="timer-overlay">
      <div className="fh-bar">
        <button className="fh-close" title={t("fh_close")} onClick={onClose}>✕</button>
        <span className="fh-title">⏱ {t("timer_live")}</span>
      </div>
      <p className="fh-hint">{t("timer_tip")}</p>
      <div className="timer-clock mono">{fmtMs(elapsed)}</div>
      <button
        className={"timer-big" + (done ? " done" : "")}
        onClick={startAt == null ? start : done ? undefined : split}
        disabled={done}
      >
        {startAt == null ? t("timer_start") : done ? "✓ " + t("timer_done") : t("timer_split")}
        {startAt != null && !done && <span className="timer-next">{dists[laps.length]}{unit}</span>}
      </button>
      <div className="timer-laps">
        {laps.map((ms, i) => (
          <div className="timer-lap" key={i}>
            <span className="mono timer-d">{dists[i]}{unit}</span>
            <span className="mono">{fmtMs(ms - (i ? laps[i - 1] : 0))}</span>
            <span className="mono timer-cum">{fmtMs(ms)}</span>
          </div>
        ))}
      </div>
      <div className="timer-actions">
        {running && laps.length > 0 && <button className="secondary" onClick={() => setLaps((l) => l.slice(0, -1))}>{t("timer_undo")}</button>}
        {startAt != null && <button className="secondary" onClick={reset}>{t("timer_reset")}</button>}
        {laps.length > 0 && <button className="primary" onClick={save}>{t("timer_save")}</button>}
      </div>
    </div>
  );
}

// The "Live" tab — a first-class home for the follow-along heatsheet. Lists your meets (active
// ones first); tap one to open the heat tracker. The per-meet "Follow heats" button still works.
function LiveView({ meets, swimmers, myTeam, heatDone, setHeatsDone, goImport }: {
  meets: Meet[];
  swimmers: Swimmer[];
  myTeam: string;
  heatDone: Record<string, string>;
  setHeatsDone: (meetId: string, heats: { event: number; ho: number }[], on: boolean) => void;
  goImport: () => void;
}) {
  const [sel, setSel] = useState<Meet | null>(null);
  if (sel) {
    return <FollowHeats meet={sel} swimmers={swimmers} myTeam={myTeam} heatDone={heatDone} setHeatsDone={setHeatsDone} onClose={() => setSel(null)} />;
  }
  if (!meets.length) {
    return <Empty title={t("em_nomeet_t")} body={t("em_nomeet_b")} cta={t("sw_addmeet")} onCta={goImport} />;
  }
  const todayMid = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const ordered = [...meets].sort((a, b) => {
    const ap = ((meetEndMs(a) ?? Infinity) + 3 * 86400000 < todayMid) ? 1 : 0;
    const bp = ((meetEndMs(b) ?? Infinity) + 3 * 86400000 < todayMid) ? 1 : 0;
    return ap - bp || b.importedAt - a.importedAt;
  });
  return (
    <div className="live-view">
      <p className="section-title">🏊 {t("live_pick")}</p>
      {ordered.map((m) => (
        <button key={m.id} className="card live-pick" onClick={() => setSel(m)}>
          <span className="live-pick-title">{m.title}</span>
          <span className="live-pick-go">{t("follow_heats")} ›</span>
        </button>
      ))}
    </div>
  );
}

function courseLabel(meet: Meet): string {
  const c = eventMeta(meet.entries[0]?.desc || "").course;
  return c === "LCM" ? t("course_lcm") : c === "SCY" ? t("course_scy") : c === "SCM" ? t("course_scm") : "";
}

function bySession(items: DE[]): { label: string; items: DE[] }[] {
  const order: string[] = [];
  const map = new Map<string, DE[]>();
  for (const d of items) {
    const s = d.e.session || "Events";
    if (!map.has(s)) {
      map.set(s, []);
      order.push(s);
    }
    map.get(s)!.push(d);
  }
  return order.map((s) => ({ label: s, items: map.get(s)! }));
}

// The meet's last calendar day (ms at local midnight), derived from how many distinct session
// days it spans from meet.start. Null when the start is unknown (then we never auto-archive it).
function meetEndMs(meet: Meet): number | null {
  if (!meet.start) return null;
  const days = new Set<string>();
  for (const e of meet.entries) if (e.session && e.session !== "Events") days.add(e.session.split(" ")[0]);
  const d = new Date(meet.start + "T00:00:00");
  d.setDate(d.getDate() + (Math.max(1, days.size) - 1));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// One day/session block on Home — collapsible. defaultOpen is set by the smart focus logic
// (today's session if the meet is running, else the first upcoming day) so meet day shows
// only the relevant events and past/future days stay tucked away. Tap the header to toggle.
function SessionBlock(props: { head: string | null; count: number; grid: boolean; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(props.defaultOpen);
  const body = <div className={props.grid ? "session-items grid" : "session-items"}>{props.children}</div>;
  if (!props.head) return <div className="session-block">{body}</div>; // "Events" — no day header
  return (
    <div className="session-block">
      <button className="session-head toggle" onClick={() => setOpen((o) => !o)}>
        <span>📅 {props.head}</span>
        <span className="sess-meta">🏊 {props.count} {open ? "▾" : "▸"}</span>
      </button>
      {open && body}
    </div>
  );
}

function Home(props: any) {
  const { swimmers, meets, view, pickView, filter, toggleFilter, results, setResult, goals, asplits, notes, done, heatDone, setHeatsDone, setMap, pacing, setPacing, splitBy, setSplitBy, probSnap, myTeam, liveOn, liveStatus, coach, coachTeam, progress, swimmer } = props;
  // Next-goal probability shows only when the parent opted in AND not in coach mode (it would
  // clutter a coach's already-full team view, and coaches don't need the per-kid encouragement).
  const showProb = probSnap === "1" && !coach;
  const [followMeet, setFollowMeet] = useState<Meet | null>(null);
  const [showSample, setShowSample] = useState(() => location.search.includes("demo"));
  const [shareMsg, showToast] = useToast();
  const [cols, setCols] = useState<{ pb: boolean; cut: boolean; champ: boolean }>(() => {
    try {
      return { pb: true, cut: false, champ: false, ...JSON.parse(localStorage.getItem("armcols") || "{}") };
    } catch {
      return { pb: true, cut: false, champ: false };
    }
  });
  function toggleCol(k: "pb" | "cut" | "champ") {
    const next = { ...cols, [k]: !cols[k] };
    setCols(next);
    localStorage.setItem("armcols", JSON.stringify(next));
  }
  const resultOf = (d: DE) => results[resultKey(d.meetId, d.e.event, d.swimmer)];
  // A swim is "done" if its time is logged, it's checked off, OR its whole heat was slashed off
  // in the heat tracker — any of those should drop it out of "Up next".
  const doneOf = (d: DE) =>
    !!done[resultKey(d.meetId, d.e.event, d.swimmer)] || !!heatDone[`${d.meetId}|${d.e.event}|${heatOrd(d.e.heat)}`];
  // Meet lifecycle: a meet auto-tucks into a collapsed "Past meets" archive ~3 days after its
  // last session, so between the bursty meet weekends Home stays focused on the active/upcoming
  // meet and never defaults to a stale one. Records persist — Progress spans every meet, the
  // past meet just moves to the archive (nothing is deleted).
  const todayMid = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const isPast = (m: Meet) => { const e = meetEndMs(m); return e != null && e + 3 * 86400000 < todayMid; };
  const allGroups = buildDisplay(meets, swimmers, filter);
  const groups = allGroups.filter((g: any) => !isPast(g.meet)); // active / upcoming
  const pastGroups = allGroups.filter((g: any) => isPast(g.meet)); // archived
  const all = groups.flatMap((g: any) => g.items as DE[]);
  const closest = all
    .map((d: DE) => ({ d, cut: cutFor(d, resultOf(d)) }))
    .filter((x) => x.cut?.nextCut)
    .sort((a, b) => a.cut!.nextCut!.needed - b.cut!.nextCut!.needed)
    .slice(0, 3);
  // "Up next" — the soonest upcoming races for your swimmers (earliest event #s in program
  // order). A race drops off once it has a logged time OR is checked off as done on deck — so
  // the list reflects what's actually still coming, not just what you've had time to type.
  const upNext: DE[] = all
    .filter((d: DE) => !d.e.relay && !resultOf(d) && !doneOf(d))
    .sort(swimOrder)
    .slice(0, swimmers.length > 1 ? 3 : 2);
  // Whose meet is this? With a single swimmer in focus (only one, or filtered to one), label the
  // screen with their name + team — the arm table/cards otherwise don't show whose swims these are.
  const focused: Swimmer | null =
    swimmers.length === 1 ? swimmers[0] : filter.size === 1 ? swimmers.find((s: Swimmer) => filter.has(s.id)) || null : null;

  // Only show filter chips for swimmers actually entered in an active/upcoming meet. A kid you
  // followed for a past meet stays saved (and in Progress history) but shouldn't crowd the
  // current meet's chip bar once that meet has passed — past meets untether from "now".
  const chipSwimmers = swimmers.filter((s: Swimmer) =>
    meets.some((m: Meet) => !isPast(m) && m.entries.some((e: Entry) => matchesName(s.name, e.name)))
  );

  // Phase 3b — AI post-meet feedback, swimmer mode only. We gather the swimmer's OWN swims (not
  // friends) that have a time or a reflection, and send COPPA-minimized context (race/seed/result/
  // cut/note) — never name or team. The Worker holds the key; we degrade gracefully if it's down.
  const mineNames = new Set(swimmers.filter((s: Swimmer) => !s.watch).map((s: Swimmer) => s.name));
  const fbSwims = !swimmer
    ? []
    : all
        .filter((d: DE) => !d.e.relay && mineNames.has(d.swimmer))
        .map((d: DE) => {
          const k = resultKey(d.meetId, d.e.event, d.swimmer);
          const c = cutFor(d, results[k]);
          const cut = c?.achieved ? `made ${c.achieved}` : c?.nextCut ? `${c.nextCut.needed.toFixed(2)}s from ${c.nextCut.level}` : "";
          return { race: raceOf(d.e), seed: d.e.seed, result: results[k], cut, note: notes[k] };
        })
        .filter((s) => s.result || s.note);
  // Coach team summary input — the team's resulted swims across loaded meets, with FIRST names
  // (the coach needs to know who); no last names / contact / location leave the device.
  const teamFbSwims = !coach
    ? []
    : allGroups
        .flatMap((g: any) => g.items as DE[])
        .filter((d: DE) => !d.e.relay && (results[resultKey(d.meetId, d.e.event, d.swimmer)] || notes[resultKey(d.meetId, d.e.event, d.swimmer)]))
        .map((d: DE) => {
          const k = resultKey(d.meetId, d.e.event, d.swimmer);
          const c = cutFor(d, results[k]);
          const cut = c?.achieved ? `made ${c.achieved}` : c?.champ?.met ? "made SE champ" : "";
          return { name: firstName(d.swimmer), race: raceOf(d.e), result: results[k], cut };
        })
        .slice(0, 60);
  const [fb, setFb] = useState<{ loading: boolean; text: string; err: string }>({ loading: false, text: "", err: "" });
  async function runFeedback(kind: "swimmer" | "team" = "swimmer") {
    const swims = kind === "team" ? teamFbSwims : fbSwims;
    if (!swims.length) return;
    setFb({ loading: true, text: "", err: "" });
    try {
      const me = swimmers.find((s: Swimmer) => !s.watch);
      const opts: { kind?: "swimmer" | "team"; teamName?: string; appToken?: string } = {
        appToken: APP_TOKEN || undefined,
      };
      if (kind === "team") { opts.kind = "team"; opts.teamName = coachTeam; }
      const text = await getFeedback(
        swims,
        kind === "swimmer" ? me?.age : undefined,
        loadProxy() || DEFAULT_PROXY,
        opts
      );
      setFb({ loading: false, text, err: "" });
    } catch (e: any) {
      setFb({ loading: false, text: "", err: t(e?.message || "feedback_failed") });
    }
  }

  // Coach view: a quick team-stats summary instead of the parent fueling/prep sections.
  const teamStats = coach
    ? (() => {
        // Count across the loaded meet(s) INCLUDING past/archived ones — a coach reviews meets
        // after they happen, so a finished meet should still show real numbers (not 0). "Swimmers"
        // is the meet's actual attendees (entries), not the full roster.
        const teamItems = allGroups.flatMap((g: any) => g.items as DE[]);
        let achieved = 0;
        let champ = 0;
        for (const d of teamItems) {
          const c = cutFor(d, resultOf(d));
          if (c?.achieved) achieved++;
          if (c?.champ?.met) champ++;
        }
        return { swimmers: new Set(teamItems.map((d: DE) => d.swimmer)).size, events: teamItems.length, achieved, champ };
      })()
    : null;

  return (
    <>
      {followMeet && (
        <FollowHeats
          meet={followMeet}
          swimmers={swimmers}
          myTeam={myTeam}
          heatDone={heatDone}
          setHeatsDone={setHeatsDone}
          onClose={() => setFollowMeet(null)}
        />
      )}
      {liveOn && (
        <button className="live-banner" onClick={props.goImport}>
          <span className="live-dot" /> {t("live_badge")}
          {liveStatus ? <span className="live-banner-status"> · {liveStatus}</span> : null}
        </button>
      )}
      {shareMsg && <p className="share-toast">{shareMsg}</p>}
      {meets.length === 0 && swimmers.length === 0 && (
        <Empty title={t("em_welcome_t")} body={t("em_welcome_b")} cta={t("sw_addmeet")} onCta={props.goImport} />
      )}
      {meets.length > 0 && swimmers.length === 0 && (
        <Empty title={t("em_pick_t")} body={t("em_pick_b")} cta={t("em_choose")} onCta={props.goSwimmers} />
      )}
      {meets.length === 0 && swimmers.length > 0 && (
        <Empty title={t("em_nomeet_t")} body={t("em_nomeet_b")} cta={t("sw_addmeet")} onCta={props.goImport} />
      )}

      {meets.length > 0 && swimmers.length > 0 && (
        <>
          <Disclaimer />
          {teamStats && (
            <section className="card teamstats">
              <h2>📊 {t("team_stats")}</h2>
              <div className="stat-row">
                <div className="stat"><span className="stat-n">{teamStats.swimmers}</span><span className="stat-l">{t("ts_swimmers")}</span></div>
                <div className="stat"><span className="stat-n">{teamStats.events}</span><span className="stat-l">{t("ts_events")}</span></div>
                <div className="stat"><span className="stat-n">{teamStats.achieved}</span><span className="stat-l">{t("ts_cuts")}</span></div>
                <div className="stat"><span className="stat-n">{teamStats.champ}</span><span className="stat-l">🏆 {t("sechamp")}</span></div>
              </div>
            </section>
          )}
          {FEEDBACK_ENABLED && coach && teamFbSwims.length > 0 && (
            <section className="card feedback-card">
              <h2>✨ {t("fb_team_title")}</h2>
              {fb.text ? <p className="fb-text">{fb.text}</p> : <p className="muted">{t("fb_team_sub")}</p>}
              {fb.err && <p className="fb-err">{fb.err}</p>}
              <button className="primary" disabled={fb.loading} onClick={() => runFeedback("team")}>
                {fb.loading ? t("fb_loading") : fb.text ? t("fb_again") : t("fb_team_go")}
              </button>
              <p className="muted small">{t("fb_disclaimer")}</p>
            </section>
          )}
          {chipSwimmers.length > 1 && (
            <div className="chips">
              {chipSwimmers.map((k: Swimmer) => {
                const on = filter.size === 0 || filter.has(k.id);
                return (
                  <button
                    key={k.id}
                    className={"chip" + (on ? " on" : "")}
                    style={on ? { background: k.color, borderColor: k.color, color: "#fff" } : {}}
                    onClick={() => toggleFilter(k.id)}
                  >
                    {firstName(k.name)}{ageTag(k.age)}
                  </button>
                );
              })}
            </div>
          )}
          {focused && (
            <div className="focus-swimmer">
              🏊 <strong>{displayName(focused.name)}</strong>
              {focused.age != null ? <span className="fs-team"> · {focused.age}</span> : null}
              {focused.team ? <span className="fs-team"> · {focused.team}</span> : null}
            </div>
          )}
          {upNext.length > 0 && (
            <section className="card upnext">
              <h2>⏱ {t("upnext")}</h2>
              {upNext.map((d: DE, i: number) => {
                const hn = d.e.heat ? /Heat\s+(\d+)/.exec(d.e.heat)?.[1] : null;
                return (
                  <div className="un-row" key={i}>
                    <span className="un-who">
                      {swimmers.length > 1 ? <strong>{firstName(d.swimmer)}{ageTag(deAge(d))} </strong> : null}{d.e.race}
                    </span>
                    <span className="un-where">
                      {hn ? t("heat_n", { n: hn }) + " · " : ""}{t("lane", { n: d.e.lane })}
                    </span>
                    <button
                      className="un-done"
                      title={t("mark_done")}
                      onClick={() => setMap("done", d.meetId, d.e.event, d.swimmer, "1")}
                    >
                      ✓
                    </button>
                  </div>
                );
              })}
            </section>
          )}
          {closest.length > 0 && (
            <section className="card highlight">
              <h2>🎯 {t("closest")}</h2>
              {closest.map(({ d, cut }: any, i: number) => (
                <div className="hl-row" key={i}>
                  <span>
                    {swimmers.length > 1 ? `${firstName(d.swimmer)}${ageTag(deAge(d))} · ` : ""}
                    {d.e.race}
                  </span>
                  <span className="hl-need">
                    {cut.nextCut.level} in {cut.nextCut.needed.toFixed(2)}s
                  </span>
                </div>
              ))}
            </section>
          )}
          {FEEDBACK_ENABLED && swimmer && fbSwims.length > 0 && (
            <section className="card feedback-card">
              <h2>✨ {t("fb_title")}</h2>
              {fb.text ? <p className="fb-text">{fb.text}</p> : <p className="muted">{t("fb_sub")}</p>}
              {fb.err && <p className="fb-err">{fb.err}</p>}
              <button className="primary" disabled={fb.loading} onClick={() => runFeedback()}>
                {fb.loading ? t("fb_loading") : fb.text ? t("fb_again") : t("fb_go")}
              </button>
              <p className="muted small">{t("fb_disclaimer")}</p>
            </section>
          )}
          {!coach && groups.length > 0 && <Fueling />}
          {!coach && groups.length > 0 && <Prep />}
          {(groups.length > 0 || pastGroups.length > 0) && (
          <div className="events-head">
            {groups.length > 0 && <h2 className="section-title">{t("meets", { n: groups.length })}</h2>}
            <div className="seg">
              <button className={view === "cards" ? "on" : ""} onClick={() => pickView("cards")}>
                {t("v_cards")}
              </button>
              <button className={view === "table" ? "on" : ""} onClick={() => pickView("table")}>
                {t("v_table")}
              </button>
            </div>
          </div>
          )}
          {(groups.length > 0 || pastGroups.length > 0) && view === "table" && (
            <div className="colchips">
              {t("columns")}
              <button className={"chip sm colpb" + (cols.pb ? " on" : "")} onClick={() => toggleCol("pb")}>
                {cols.pb ? "✓ " : ""}{t("c_pb")}
              </button>
              <button className={"chip sm colcut" + (cols.cut ? " on" : "")} onClick={() => toggleCol("cut")}>
                {cols.cut ? "✓ " : ""}{t("c_cut")}
              </button>
              <button className={"chip sm colchamp" + (cols.champ ? " on" : "")} onClick={() => toggleCol("champ")}>
                {cols.champ ? "✓ " : ""}🏆 {t("sechamp")}
              </button>
            </div>
          )}
          {(() => {
            const renderMeet = (meet: Meet, items: DE[]) => {
            const secs = bySession(items);
            const startDate = meet.start ? new Date(meet.start + "T00:00:00") : null;
            const dayOrder: string[] = [];
            for (const s of secs) {
              const wd = s.label.split(" ")[0];
              if (s.label !== "Events" && !dayOrder.includes(wd)) dayOrder.push(wd);
            }
            // ONE source of truth for a session's date = meet.start + its position in dayOrder
            // (the chronological sequence of meet days). Used for the printed date, ordering,
            // AND auto-open, so they always agree even when the PDF's weekday labels don't line
            // up with meet.start (start comes from the directory/URL; labels come from the PDF).
            const secDate = (label: string): Date | null => {
              const idx = dayOrder.indexOf(label.split(" ")[0]);
              if (!startDate || idx < 0) return null;
              const d = new Date(startDate);
              d.setDate(d.getDate() + idx);
              d.setHours(0, 0, 0, 0);
              return d;
            };
            const secDateMs = (label: string): number | null => secDate(label)?.getTime() ?? null;
            // "Day 1 · Friday, Jun 5 — Morning" from a session like "Friday Morning".
            const sessionHead = (raw: string): string => {
              const wd = raw.split(" ")[0];
              const part = raw.slice(wd.length).trim();
              const n = dayOrder.indexOf(wd);
              const dayPart = dayOrder.length > 1 && n >= 0 ? t("day_n", { n: n + 1 }) + " · " : "";
              const d = secDate(raw);
              const datePart = d ? ", " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
              return `${dayPart}${wd}${datePart}${part ? " — " + part : ""}`;
            };
            const todayMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
            // Which day to auto-open: today's (meet running), else the next upcoming day, else
            // the MOST RECENT day (a just-finished meet still in the grace window) — not the
            // oldest. Then open ALL of that day's sessions (a parent's there all day), not just
            // the first. No dated sessions → open the first.
            const dated = secs.map((s) => ({ label: s.label, ms: secDateMs(s.label) })).filter((x) => x.ms != null) as { label: string; ms: number }[];
            let focusDayMs: number | null = null;
            if (dated.some((x) => x.ms === todayMs)) focusDayMs = todayMs;
            else {
              const upcoming = dated.filter((x) => x.ms >= todayMs).sort((a, b) => a.ms - b.ms);
              focusDayMs = upcoming.length ? upcoming[0].ms : dated.length ? Math.max(...dated.map((x) => x.ms)) : null;
            }
            const openLabels = new Set(
              focusDayMs != null ? dated.filter((x) => x.ms === focusDayMs).map((x) => x.label) : secs[0] ? [secs[0].label] : []
            );
            const oneSession = secs.length <= 1;
            return (
            <div className="meet-block" key={meet.id}>
              <div className="meet-head">
                <h3>{meet.title}</h3>
                {courseLabel(meet) && <span className="course-badge">{courseLabel(meet)}</span>}
                {/* Per-meet "add results" — opens the import flow to overlay actual swum times.
                    Deprecate this one button if/when live electronic results land. */}
                <button className="meet-pack mh-follow" onClick={() => setFollowMeet(meet)}>
                  🏊 {t("follow_heats")}
                </button>
                <button className="meet-pack mh-results" title={t("results_tip")} onClick={() => props.goImport()}>
                  📊 {t("results_w")}
                </button>
                <span className="mh-share">
                  <span className="mh-share-lbl">{t("share_label")}</span>
                  {meet.sourceUrl && (
                    <button
                      className="meet-share"
                      title={t("share_btn")}
                      onClick={async () => {
                        const r = await shareMeet({ t: meet.title, u: meet.sourceUrl!, tm: coachTeam || undefined });
                        showToast(r === "copied" ? t("share_copied") : r === "shared" ? "" : t("share_fail"));
                      }}
                    >
                      🔗 {t("share_link_w")}
                    </button>
                  )}
                  <button className="meet-pack" title={t("share_code_btn")} onClick={() => props.onShareMeet(meet)}>
                    #️⃣ {t("share_code_w")}
                  </button>
                  <button
                    className="meet-pack"
                    title={t("pack_export")}
                    onClick={() => {
                      downloadPack(meet, results);
                      showToast(t("pack_saved"));
                    }}
                  >
                    📤
                  </button>
                </span>
                <button className="remove" onClick={() => props.removeMeet(meet.id)}>
                  ✕
                </button>
              </div>
              {items.length === 0 ? (
                <p className="muted meet-empty">{t("em_none_meet")}</p>
              ) : (
                secs.map((sec) => (
                  <SessionBlock
                    key={sec.label}
                    head={sec.label !== "Events" ? sessionHead(sec.label) : null}
                    count={sec.items.length}
                    grid={view === "cards"}
                    defaultOpen={oneSession || openLabels.has(sec.label)}
                  >
                    {view === "cards" ? (
                      sec.items.map((d, i) => {
                        const k = resultKey(d.meetId, d.e.event, d.swimmer);
                        return (
                          <EntryCard
                            key={i}
                            d={d}
                            showSwimmer={swimmers.length > 1}
                            result={resultOf(d)}
                            onSetResult={(v: string) => setResult(d.meetId, d.e.event, d.swimmer, v)}
                            goal={goals[k]}
                            asplits={asplits[k]}
                            note={notes[k]}
                            done={!!done[k]}
                            showProb={showProb}
                            swimmer={swimmer}
                            onGoal={(v: string) => setMap("goal", d.meetId, d.e.event, d.swimmer, v)}
                            onSplits={(v: string) => setMap("splits", d.meetId, d.e.event, d.swimmer, v)}
                            onNote={(v: string) => setMap("note", d.meetId, d.e.event, d.swimmer, v)}
                            onToggleDone={() => setMap("done", d.meetId, d.e.event, d.swimmer, done[k] ? "" : "1")}
                            pacing={pacing}
                            setPacing={setPacing}
                            splitBy={splitBy}
                            setSplitBy={setSplitBy}
                          />
                        );
                      })
                    ) : (
                      <ArmTable items={sec.items} results={results} cols={cols} />
                    )}
                  </SessionBlock>
                ))
              )}
            </div>
            );
            };
            return (
              <>
                {groups.length > 0
                  ? groups.map((g: any) => renderMeet(g.meet, g.items))
                  : pastGroups.length > 0 && (
                      <div className="no-active-wrap">
                        <p className="muted no-active">{t("no_upcoming")}</p>
                        <button className="primary" onClick={props.goImport}>{t("sw_addmeet")}</button>
                      </div>
                    )}
                {pastGroups.length > 0 && (
                  <Foldable title={<>🗄️ {t("past_meets")} ({pastGroups.length})</>}>
                    {pastGroups.map((g: any) => renderMeet(g.meet, g.items))}
                  </Foldable>
                )}
              </>
            );
          })()}
          <ProgressSection progress={progress || []} />
        </>
      )}

      <SampleBlock open={showSample} setOpen={setShowSample} />

      <p className="feedback-foot">
        {t("fb_got")}{" "}
        <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
          {t("fb_tell")}
        </a>
      </p>
    </>
  );
}

function SampleBlock({ open, setOpen }: { open: boolean; setOpen: (b: boolean) => void }) {
  const d = day as any;
  return (
    <div className="sample">
      <button className="sample-toggle" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {t("sample_toggle")}
      </button>
      {open && (
        <div className="sample-body">
          <div className="sample-badge">SAMPLE</div>
          <h3>{d.meet}</h3>
          {bySession(
            d.events.map((e: any) => ({
              e: { ...e, name: "Sample Swimmer", team: "DEMO-SE", session: `Day ${e.day}` },
              color: "#9aa7b3",
              swimmer: "Sample Swimmer",
              age: 10,
              gender: "Girls" as const,
              meetId: "sample",
            }))
          ).map((sec) => (
            <div className="session-block" key={sec.label}>
              <div className="session-head">📅 {sec.label}</div>
              {sec.items.map((d2, i) => (
                <EntryCard key={i} d={d2} showSwimmer={false} result={undefined} onSetResult={() => {}} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty(props: { title: string; body: string; cta: string; onCta: () => void }) {
  return (
    <div className="card empty">
      <h2>{props.title}</h2>
      <p>{props.body}</p>
      <button className="primary" onClick={props.onCta}>
        {props.cta}
      </button>
    </div>
  );
}

function RolePicker(props: { onPick: (r: Role) => void }) {
  return (
    <div className="card rolepick">
      <h2>{t("role_q")}</h2>
      <p className="muted">{t("role_sub")}</p>
      <div className="role-opts">
        <button className="role-opt" onClick={() => props.onPick("parent")}>
          <span className="role-emoji">👪</span>
          <span className="role-name">{t("role_parent")}</span>
          <span className="role-desc">{t("role_parent_d")}</span>
        </button>
        <button className="role-opt" onClick={() => props.onPick("swimmer")}>
          <span className="role-emoji">🏊</span>
          <span className="role-name">{t("role_swimmer")}</span>
          <span className="role-desc">{t("role_swimmer_d")}</span>
        </button>
        <button className="role-opt" onClick={() => props.onPick("coach")}>
          <span className="role-emoji">🧑‍🏫</span>
          <span className="role-name">{t("role_coach")}</span>
          <span className="role-desc">{t("role_coach_d")}</span>
        </button>
      </div>
    </div>
  );
}

function CoachTeamPicker(props: {
  teams: { team: string; swimmers: RosterItem[] }[];
  onPick: (team: string) => void;
  goImport: () => void;
  onBack: () => void;
}) {
  return (
    <div className="card">
      <button className="inline-link" onClick={props.onBack}>← {t("role_back")}</button>
      <h2>{t("coach_pick_t")}</h2>
      <p className="muted">{t("coach_pick_b")}</p>
      {props.teams.length === 0 ? (
        <>
          <p className="muted">{t("coach_none")}</p>
          <button className="primary" onClick={props.goImport}>{t("sw_addmeet")}</button>
        </>
      ) : (
        <div className="team-list">
          {props.teams.map(({ team, swimmers }) => (
            <button className="result" key={team} onClick={() => props.onPick(team)}>
              <span className="result-name">{team}</span>
              <span className="result-meta">{t("nswim", { n: swimmers.length })}</span>
              <span className="result-add">→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtDateRange(start?: string, end?: string): string {
  if (!start) return "";
  const opt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = new Date(start + "T00:00:00");
  const sStr = s.toLocaleDateString(undefined, opt);
  if (!end || end === start) return `${sStr}, ${s.getFullYear()}`;
  const e = new Date(end + "T00:00:00");
  // Same month → "Jun 5–7, 2026"; otherwise "Jun 28 – Jul 2, 2026".
  const eStr = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
    ? e.getDate().toString()
    : e.toLocaleDateString(undefined, opt);
  return `${sStr}–${eStr}, ${e.getFullYear()}`;
}
// Great-circle distance in miles (for the "near me" sort).
function miBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180, la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.sqrt(h)));
}

function DiscoverView(props: {
  meets: DirMeet[];
  onImport: (url: string) => void;
  onGoLive: (url: string) => void;
  suggestUrl: string;
}) {
  const [stateFilter, setStateFilter] = useState("");
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState("");
  const [shareMsg, showToast] = useToast();
  const states = [...new Set(props.meets.map((m) => m.state).filter(Boolean))].sort() as string[];

  // Real device location via the Capacitor Geolocation plugin (proper native permission flow on
  // iOS/Android; navigator.geolocation on web). Clearing the state filter makes "showing all"
  // honest whether we got a fix (sort by distance) or were denied (fall back to the full list).
  async function findNearMe() {
    setGeoMsg(t("disc_locating"));
    try {
      if (IS_NATIVE) {
        const perm = await Geolocation.requestPermissions();
        if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
          setGeoMsg(t("disc_geoerr"));
          setStateFilter("");
          return;
        }
      }
      // GPS-first (gets a fix outdoors even with no network), accept a recent cached fix, and a
      // generous timeout — Android's network-location fix is often slow or unavailable indoors.
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 120000 });
      setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setGeoMsg("");
      setStateFilter("");
    } catch {
      setGeoMsg(t("disc_geoerr"));
      setStateFilter("");
    }
  }

  // "Find a meet near you" is for UPCOMING meets — hide ones whose last day has already
  // passed (same past-date logic as Home's archive), so a finished meet drops off the list.
  const todayISO = new Date().toISOString().slice(0, 10);
  const RADIUS_MI = 150; // what "near you" actually means — a reasonable drive to a meet
  const upcoming = props.meets
    .filter((m) => !stateFilter || m.state === stateFilter)
    .filter((m) => (m.end || m.start || todayISO) >= todayISO);
  // With a real location fix, split into genuinely-near (≤ radius) and everything else ("Farther
  // out"), nearest-first — so "near me" reflects real proximity instead of just re-sorting.
  let near: DirMeet[];
  let far: DirMeet[] = [];
  if (here) {
    const withD = upcoming
      .map((m) => ({ m, d: m.lat != null && m.lng != null ? miBetween(here, { lat: m.lat, lng: m.lng }) : Infinity }))
      .sort((a, b) => a.d - b.d);
    near = withD.filter((x) => x.d <= RADIUS_MI).map((x) => x.m);
    far = withD.filter((x) => x.d > RADIUS_MI).slice(0, 6).map((x) => x.m);
  } else {
    near = [...upcoming].sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  }

  const renderCard = (m: DirMeet) => {
    const dist = here && m.lat != null && m.lng != null ? miBetween(here, { lat: m.lat, lng: m.lng }) : null;
    return (
      <div className="disc-card" key={m.id}>
        <div className="disc-date">📅 {fmtDateRange(m.start, m.end)}</div>
        <div className="disc-title">{m.title}</div>
        <div className="disc-loc muted">
          {[m.city, m.state].filter(Boolean).join(", ")}{m.lsc ? ` · ${m.lsc}` : ""}
          {dist != null ? <span className="disc-dist"> · {t("disc_mi", { n: dist })}</span> : null}
        </div>
        <div className="disc-actions">
          {m.heatUrl && <button className="chip sm" onClick={() => props.onImport(m.heatUrl!)}>{t("disc_import")}</button>}
          {m.resultsUrl && <button className="chip sm" onClick={() => props.onImport(m.resultsUrl!)}>{t("disc_results")}</button>}
          {m.resultsUrl && <button className="chip sm golive" onClick={() => props.onGoLive(m.resultsUrl!)}>🔴 {t("disc_golive")}</button>}
          {m.resultsPageUrl && <a className="chip sm" href={m.resultsPageUrl} target="_blank" rel="noopener noreferrer">📊 {t("disc_viewresults")}</a>}
          {(m.heatUrl || m.resultsUrl) && (
            <button className="chip sm" onClick={async () => { const r = await shareMeet({ t: m.title, u: m.heatUrl || m.resultsUrl!, r: m.resultsUrl }); showToast(r === "copied" ? t("share_copied") : ""); }}>🔗 {t("share_btn")}</button>
          )}
          {m.infoUrl && <a className="chip sm" href={m.infoUrl} target="_blank" rel="noopener noreferrer">{t("disc_open")}</a>}
        </div>
      </div>
    );
  };

  return (
    <div className="card discover">
      <h2>📍 {t("disc_h")}</h2>
      <p className="muted">{t("disc_intro")}</p>
      <div className="disc-filters">
        <select className="field disc-state" value={stateFilter} onChange={(e) => { setStateFilter(e.target.value); setHere(null); }}>
          <option value="">{t("disc_all_states")}</option>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className={"chip" + (here ? " on" : "")} onClick={findNearMe}>{t("disc_near")}</button>
      </div>
      {geoMsg && <p className="muted small">{geoMsg}</p>}
      {shareMsg && <p className="share-toast">{shareMsg}</p>}

      {near.length === 0 && far.length === 0 ? (
        <div className="disc-empty">
          <p className="muted">{here ? t("disc_near_none", { n: RADIUS_MI }) : t("disc_none")}</p>
          <a className="secondary" href={props.suggestUrl} target="_blank" rel="noopener noreferrer">{t("disc_suggest")}</a>
        </div>
      ) : (
        <>
          {here && near.length === 0 && far.length > 0 && <p className="muted small">{t("disc_near_none", { n: RADIUS_MI })}</p>}
          {near.map(renderCard)}
          {here && far.length > 0 && (
            <>
              <div className="disc-far-label">{t("disc_far")}</div>
              {far.map(renderCard)}
            </>
          )}
          <p className="feedback-foot">
            <a href={props.suggestUrl} target="_blank" rel="noopener noreferrer">{t("disc_suggest")}</a>
          </p>
        </>
      )}
    </div>
  );
}

// Per-swimmer best-time progress, folded into Home as a collapsible section (default closed
// so meet day stays calm). Was its own tab; now lives under Home.
function ProgressSection({ progress }: { progress: SwimmerProgress[] }) {
  const [open, setOpen] = useState(false);
  if (!progress.length) return null;
  return (
    <section className="card prep">
      <button className="prep-toggle" onClick={() => setOpen(!open)}>
        📈 {t("nav_progress")} <span className="prep-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="prog-body">
      {progress.map((sp) => (
        <div className="prog-card" key={sp.swimmer.id}>
          <div className="prog-head">
            <span className="kid-tag" style={{ background: sp.swimmer.color }}>
              {firstName(sp.swimmer.name)}{ageTag(sp.swimmer.age)}
            </span>
            {sp.swimmer.watch && <span className="ts-tag watch">{t("nav_watching")}</span>}
          </div>
          <table className="progtable">
            <thead>
              <tr>
                <th>{t("prog_event")}</th>
                <th>{t("prog_best")}</th>
                <th>{t("prog_swims")}</th>
                <th>{t("prog_level")}</th>
              </tr>
            </thead>
            <tbody>
              {sp.events.map((ev) => {
                const cut = computeCut(ev.desc, ev.best, { age: sp.swimmer.age, gender: sp.swimmer.gender });
                return (
                  <tr key={ev.course + ev.key}>
                    <td className="prog-ev">
                      {swimAbbr(ev.race)}{" "}
                      {ev.course && <span className="course-badge">{ev.course}</span>}
                    </td>
                    <td className="mono prog-best">
                      {ev.best}
                      {ev.drop ? <span className="drop">▼{ev.drop.toFixed(2)}</span> : null}
                    </td>
                    <td className="mono">{ev.count}</td>
                    <td className="prog-lvl">
                      {cut?.achieved && <span className={levelClass(cut.achieved)}>{cut.achieved}</span>}
                      {cut?.champ?.met && <span className="champ-met sm">🏆</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
        </div>
      )}
    </section>
  );
}

// A collapsible card — used to tuck the secondary Add-meet options (live results, sources)
// out of the way so the screen leads with the primary path and isn't a wall of cards.
function Foldable(props: { title: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!props.defaultOpen);
  return (
    <div className="card">
      <button className="prep-toggle" onClick={() => setOpen((o) => !o)}>
        {props.title} <span className="prep-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="fold-body">{props.children}</div>}
    </div>
  );
}

function ImportView(props: {
  busy: boolean;
  msg: string;
  onFiles: (f: FileList | null) => void;
  onUrl: (u: string) => void;
  onCode: (c: string) => void;
  onLiveCode: (c: string) => void;
  goAbout: () => void;
  liveUrl: string;
  liveOn: boolean;
  liveStatus: string;
  setLiveUrl: (v: string) => void;
  setLiveOn: (v: boolean) => void;
  directory: DirMeet[];
  onGoLive: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [liveDraft, setLiveDraft] = useState(props.liveUrl);
  const [liveCode, setLiveCode] = useState("");
  return (
    <div>
      {/* Front and center: a shared code is the fastest way in (no PDF hunting), so it leads. */}
      <div className="card code-card">
        <h2>{t("imp_have_code_h")}</h2>
        <p className="muted">{t("imp_have_code_b")}</p>
        <div className="code-row">
          <input
            className="field code-input"
            placeholder={t("imp_code_ph")}
            value={code}
            maxLength={12}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ""))}
            onKeyDown={blurOnEnter}
            autoFocus
          />
          <button className="primary" disabled={props.busy || code.trim().length < 4} onClick={() => { props.onCode(code); setCode(""); }}>
            {t("imp_code_btn")}
          </button>
        </div>
      </div>

      <DiscoverView
        meets={props.directory}
        onImport={(u: string) => props.onUrl(u)}
        onGoLive={props.onGoLive}
        suggestUrl={FEEDBACK_URL}
      />

      <div className="card">
        <h2>{t("imp_title")}</h2>
        <p className="imp-note">📋 {t("imp_what")}</p>
        <div className="imp-types">
          <p className="imp-types-h">{t("imp_types_h")}</p>
          <ul>
            <li>{t("imp_type_psych")}</li>
            <li>{t("imp_type_heat")}</li>
            <li>{t("imp_type_results")}</li>
            <li>{t("imp_type_other")}</li>
          </ul>
        </div>
        <input className="field" placeholder="https://…/heatsheet.pdf" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
        <button className="primary" disabled={props.busy || !url.trim()} onClick={() => { props.onUrl(url); setUrl(""); }}>
          {props.busy ? t("imp_opening") : t("imp_open")}
        </button>
        <label className="secondary filelabel">
          {props.busy ? t("imp_reading") : t("imp_upload")}
          <input type="file" accept="application/pdf,.sd3,.txt,.json,.heatguardian.json,.myswimmer.json,.htm,.html,text/html" multiple disabled={props.busy} onChange={(e) => props.onFiles(e.target.files)} hidden />
        </label>
        <p className="muted small">💡 {t("imp_findfile")}</p>
      </div>

      <Foldable title={<>{props.liveOn ? <span className="live-dot" /> : "⏱ "}{t("live_h")}</>} defaultOpen={props.liveOn}>
        <p className="muted">{t("live_b")}</p>
        <input className="field" placeholder="https://…/results.pdf" value={liveDraft} onChange={(e) => setLiveDraft(e.target.value)} inputMode="url" disabled={props.liveOn} />
        {props.liveOn ? (
          <button className="secondary" onClick={() => props.setLiveOn(false)}>{t("live_stop")}</button>
        ) : (
          <button className="primary" disabled={!liveDraft.trim()} onClick={() => { props.setLiveUrl(liveDraft.trim()); props.setLiveOn(true); }}>{t("live_start")}</button>
        )}
        {!props.liveOn && (
          <div className="code-row">
            <span className="code-or">{t("live_code_or")}</span>
            <input
              className="field code-input"
              placeholder={t("imp_code_ph")}
              value={liveCode}
              maxLength={12}
              onChange={(e) => setLiveCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ""))}
              onKeyDown={blurOnEnter}
            />
            <button className="secondary" disabled={liveCode.trim().length < 4} onClick={() => { props.onLiveCode(liveCode); setLiveCode(""); }}>
              {t("live_code_btn")}
            </button>
          </div>
        )}
        {props.liveStatus && <p className="live-status">{props.liveStatus}</p>}
        <p className="muted small">{t("live_tip")}</p>
      </Foldable>

      <Foldable title={<>🔎 {t("src_h")}</>}>
        <p className="muted small">{t("src_note")}</p>
        <ul className="src-links">
          <li><a href="https://data.usaswimming.org/datahub/usas/individualsearch" target="_blank" rel="noreferrer">USA Swimming — Individual Times Search</a></li>
          <li><a href="https://swimstandards.com" target="_blank" rel="noreferrer">SwimStandards — time standards & best times</a></li>
          <li><a href="https://www.swimcloud.com" target="_blank" rel="noreferrer">SwimCloud — rankings & results</a></li>
        </ul>
      </Foldable>
    </div>
  );
}

// The people hub: My swimmers + Watch list in one place, and one "Find a swimmer" card that
// works two ways — search by name, or browse by team (the old Teams tab, folded in: pick a
// team to find a swimmer). Each match adds as "mine" or "watch". Replaces SwimmersView +
// Watching + TeamsView.
function SwimmersView(props: {
  swimmers: Swimmer[];
  roster: RosterItem[];
  teams: { team: string; swimmers: RosterItem[] }[];
  addSwimmer: (name: string, team: string, age?: number, gender?: "Girls" | "Boys", watch?: boolean) => void;
  removeSwimmer: (id: string) => void;
  goImport: () => void;
  swimmer?: boolean; // "My Meet" mode — reframes "My swimmers/Watching" as "Me/Friends"
}) {
  const [find, setFind] = useState<"search" | "teams">("search");
  const [q, setQ] = useState("");
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [mName, setMName] = useState("");
  const [mTeam, setMTeam] = useState("");

  const ql = q.trim().toLowerCase();
  const results = ql
    ? props.roster.filter((r) => r.name.toLowerCase().includes(ql) || r.team.toLowerCase().includes(ql)).slice(0, 12)
    : [];
  const statusOf = (name: string) => {
    const s = props.swimmers.find((x) => matchesName(x.name, name));
    return s ? (s.watch ? "watch" : "mine") : null;
  };
  const mine = props.swimmers.filter((s) => !s.watch);
  const watch = props.swimmers.filter((s) => s.watch);

  const kidRow = (s: Swimmer) => (
    <div className="kid-row" key={s.id}>
      <span className="kid-dot" style={{ background: s.color }} />
      <span className="kid-name">
        {displayName(s.name)} <span className="muted">{[s.gender, s.age, s.team].filter(Boolean).join(" · ")}</span>
      </span>
      <button className="remove" onClick={() => props.removeSwimmer(s.id)}>✕</button>
    </div>
  );

  const rosterRow = (r: RosterItem, key: number | string) => {
    const st = statusOf(r.name);
    return (
      <div className="roster-row" key={key}>
        <span className="roster-info">
          <span className="result-name">{displayName(r.name)}</span>
          <span className="result-meta">{[r.gender, r.age, r.team].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="add-btns">
          <button className="chip sm" disabled={st === "mine"} onClick={() => props.addSwimmer(r.name, r.team, ageNum(r.age), r.gender, false)}>
            {st === "mine" ? "✓ " : "+ "}{props.swimmer ? t("sw_me") : t("sw_mine")}
          </button>
          <button className="chip sm" disabled={st === "watch"} onClick={() => props.addSwimmer(r.name, r.team, ageNum(r.age), r.gender, true)}>
            {st === "watch" ? "✓ " : props.swimmer ? "👤 " : "👁 "}{props.swimmer ? t("sw_friend") : t("sw_watch")}
          </button>
        </span>
      </div>
    );
  };

  return (
    <div>
      <div className="card">
        <h2>{props.swimmer ? "🏊 " + t("me_h") : t("myswimmers")}</h2>
        {mine.length === 0 && <p className="muted">{props.swimmer ? t("sw_none_me") : t("sw_none")}</p>}
        {mine.map(kidRow)}
      </div>

      {watch.length > 0 && (
        <div className="card">
          <h2>{props.swimmer ? "👥 " + t("friends_h") : "👁 " + t("watchlist")}</h2>
          {watch.map(kidRow)}
        </div>
      )}

      <div className="card">
        <h2>{t("sw_find")}</h2>
        {props.roster.length === 0 ? (
          <>
            <p className="muted">{t("sw_importfirst")}</p>
            <button className="primary" onClick={props.goImport}>{t("sw_addmeet")}</button>
          </>
        ) : (
          <>
            <div className="seg full">
              <button className={find === "search" ? "on" : ""} onClick={() => setFind("search")}>🔎 {t("sw_bysearch")}</button>
              <button className={find === "teams" ? "on" : ""} onClick={() => setFind("teams")}>👥 {t("sw_byteam")}</button>
            </div>
            {find === "search" ? (
              <>
                <input className="field" placeholder={t("sw_search")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                {ql && results.length === 0 && <p className="muted">{t("sw_nomatch", { q })}</p>}
                <div className="results">{results.map((r, i) => rosterRow(r, i))}</div>
              </>
            ) : (
              <div className="teams">
                {props.teams.map(({ team, swimmers }) => (
                  <div className="team-card" key={team}>
                    <button className="team-row" onClick={() => setOpenTeam(openTeam === team ? null : team)}>
                      <span className="team-name">{team}</span>
                      <span className="muted">{t("nswim", { n: swimmers.length })} {openTeam === team ? "▾" : "▸"}</span>
                    </button>
                    {openTeam === team && <div className="team-swimmers">{swimmers.map((r, i) => rosterRow(r, i))}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <button className="inline-link manual-toggle" onClick={() => setManual(!manual)}>
          {manual ? t("sw_manualcancel") : t("sw_manual")}
        </button>
        {manual && (
          <div className="manual">
            <input className="field" placeholder={t("sw_nameph")} value={mName} onChange={(e) => setMName(e.target.value)} />
            <input className="field" placeholder={t("sw_teamph")} value={mTeam} onChange={(e) => setMTeam(e.target.value)} />
            <button
              className="primary"
              onClick={() => {
                props.addSwimmer(mName, mTeam, undefined, undefined, false);
                setMName("");
                setMTeam("");
                setManual(false);
              }}
            >
              {t("sw_add")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Pick the logo's DOMINANT vivid color (the one covering the most area among saturated,
// non-gray pixels) for header branding — not the single brightest pixel, which grabs a small
// bright accent (e.g. an orange flourish) over the real brand color (the big red text). We
// bucket similar colors together and return the average of the most-prevalent bucket.
function dominantColor(ctx: CanvasRenderingContext2D, w: number, h: number): string | null {
  const data = ctx.getImageData(0, 0, w, h).data;
  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 510;
    const s = mx === mn ? 0 : (mx - mn) / (255 - Math.abs(mx + mn - 255));
    if (s < 0.35 || l < 0.2 || l > 0.85) continue; // skip gray / near-black / near-white
    const key = (r >> 5) + "-" + (g >> 5) + "-" + (b >> 5); // group near-identical colors
    const bkt = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    bkt.r += r; bkt.g += g; bkt.b += b; bkt.n++;
    buckets.set(key, bkt);
  }
  let best: { r: number; g: number; b: number; n: number } | null = null;
  for (const bkt of buckets.values()) if (!best || bkt.n > best.n) best = bkt;
  if (!best) return null;
  const r = Math.round(best.r / best.n), g = Math.round(best.g / best.n), b = Math.round(best.b / best.n);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function processLogo(file: File, cb: (dataUrl: string, color: string | null) => void) {
  const img = new Image();
  img.onload = () => {
    const max = 160;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx?.drawImage(img, 0, 0, w, h);
    cb(c.toDataURL("image/png"), ctx ? dominantColor(ctx, w, h) : null);
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
}

// Settings: the "out of the way" home for Add-a-meet, appearance (theme + language), the
// taunt edge setting, and a link into About/help. Reached via the ⚙ in the header.
function SettingsView(props: {
  goImport: () => void;
  goAbout: () => void;
  theme: Theme;
  setTheme: (v: Theme) => void;
  lang: Lang;
  changeLang: (l: Lang) => void;
  tauntTier: TauntTier;
  setTauntTier: (v: TauntTier) => void;
  lefty: string;
  setLefty: (v: string) => void;
  probSnap: string;
  setProbSnap: (v: string) => void;
  myTeam: string;
  setMyTeam: (v: string) => void;
  teams: string[];
  role: Role | null;
  onChangeRole: () => void;
  logo: string;
  setLogo: (v: string) => void;
  setBrand: (v: string) => void;
}) {
  const themes: Theme[] = ["auto", "light", "dark"];
  const tiers: TauntTier[] = ["mild", "medium", "savage"];
  return (
    <div className="settings">
      <button className="settings-row primary-row" onClick={props.goImport}>
        <span className="settings-ico">➕</span>
        <span className="settings-tx">
          <strong>{t("set_addmeet")}</strong>
          <span className="muted">{t("set_addmeet_b")}</span>
        </span>
        <span className="settings-chev">›</span>
      </button>

      <div className="card">
        <h3>{t("set_appearance")}</h3>
        <label className="set-label">{t("set_theme")}</label>
        <div className="seg full">
          {themes.map((th) => (
            <button key={th} className={props.theme === th ? "on" : ""} onClick={() => props.setTheme(th)}>
              {th === "auto" ? "🅰 " + t("th_auto") : th === "light" ? "☀ " + t("th_light") : "🌙 " + t("th_dark")}
            </button>
          ))}
        </div>
        <label className="set-label">{t("lang_label")}</label>
        <select className="field" value={props.lang} onChange={(e) => props.changeLang(e.target.value as Lang)}>
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
          ))}
        </select>
        <label className="set-label">{t("set_hand")}</label>
        <div className="seg full">
          <button className={props.lefty !== "1" ? "on" : ""} onClick={() => props.setLefty("")}>👉 {t("hand_right")}</button>
          <button className={props.lefty === "1" ? "on" : ""} onClick={() => props.setLefty("1")}>👈 {t("hand_left")}</button>
        </div>
        <label className="set-label">🎯 {t("set_prob")}</label>
        <p className="muted small">{t("set_prob_b")}</p>
        <div className="seg full">
          <button className={props.probSnap !== "1" ? "on" : ""} onClick={() => props.setProbSnap("")}>{t("prob_off")}</button>
          <button className={props.probSnap === "1" ? "on" : ""} onClick={() => props.setProbSnap("1")}>{t("prob_on")}</button>
        </div>
      </div>

      <div className="card">
        <h3>🫧 {t("set_taunts")}</h3>
        <p className="muted small">{t("set_taunts_b")}</p>
        <div className="seg full">
          {tiers.map((ti) => (
            <button key={ti} className={props.tauntTier === ti ? "on" : ""} onClick={() => props.setTauntTier(ti)}>
              {t("taunt_" + ti)}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>👤 {props.role === "coach" ? t("role_coach") : props.role === "swimmer" ? t("role_swimmer") : t("role_parent")}</h3>
        <button className="secondary" onClick={props.onChangeRole}>{t("role_change")}</button>
        <label className="set-label">🏊 {t("set_team")}</label>
        <p className="muted small">{t("set_team_b")}</p>
        <select className="field" value={props.myTeam} onChange={(e) => props.setMyTeam(e.target.value)}>
          <option value="">{t("team_none")}</option>
          {(props.myTeam && !props.teams.includes(props.myTeam) ? [props.myTeam, ...props.teams] : props.teams).map((tm) => (
            <option key={tm} value={tm}>{tm}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <h3>{t("logo_h")}</h3>
        {props.logo && <img className="team-logo lg" src={props.logo} alt="team logo" />}
        <div>
          <label className="secondary filelabel">
            {t("logo_add")}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) processLogo(f, (url, color) => { props.setLogo(url); props.setBrand(color || ""); });
              }}
            />
          </label>
          {props.logo && (
            <button className="link" onClick={() => { props.setLogo(""); props.setBrand(""); }}>
              {t("logo_remove")}
            </button>
          )}
        </div>
        <p className="muted small">{t("logo_note")}</p>
      </div>

      <button className="settings-row" onClick={props.goAbout}>
        <span className="settings-ico">ℹ️</span>
        <span className="settings-tx">
          <strong>{t("set_about")}</strong>
          <span className="muted">{t("set_about_b")}</span>
        </span>
        <span className="settings-chev">›</span>
      </button>
    </div>
  );
}

// In-app feedback composer → the Worker /report endpoint (which pings the developer in real time).
function FeedbackBox() {
  const [txt, setTxt] = useState("");
  const [status, setStatus] = useState<"" | "sending" | "ok" | "fail">("");
  const send = async () => {
    if (!txt.trim() || status === "sending") return;
    setStatus("sending");
    const ctx = `${getLang()} ${IS_NATIVE ? "app" : "web"} ${localStorage.getItem("role") || "?"}`;
    const ok = await sendReport(txt.trim(), ctx, loadProxy() || DEFAULT_PROXY);
    setStatus(ok ? "ok" : "fail");
    if (ok) setTxt("");
  };
  return (
    <div className="fb-box">
      <textarea
        className="field note-input"
        rows={3}
        placeholder={t("fb_inapp_ph")}
        value={txt}
        onChange={(e) => { setTxt(e.target.value); if (status) setStatus(""); }}
      />
      <button className="primary" disabled={!txt.trim() || status === "sending"} onClick={send}>
        {status === "sending" ? t("fb_loading") : t("fb_inapp_send")}
      </button>
      {status === "ok" && <p className="fb-text">{t("fb_inapp_thanks")}</p>}
      {status === "fail" && <p className="fb-err">{t("fb_inapp_fail")}</p>}
    </div>
  );
}

function About() {
  return (
    <div className="card about">
      <h2>{t("ab_title")}</h2>
      <p>{t("ab_intro")}</p>

      <h3>💬 {t("fb_inapp_h")}</h3>
      <FeedbackBox />
      <a className="inline-link" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
        {t("fb_inapp_or")}
      </a>

      {rateUrl() && (
        <a className="secondary rate-btn" href={rateUrl()} target="_blank" rel="noopener noreferrer">
          ⭐ {t("rate_btn")}
        </a>
      )}

      {!IS_NATIVE && (
        <>
          <h3>{t("kofi_h")}</h3>
          <p className="muted">{t("kofi_b")}</p>
          <a className="secondary kofi-btn" href={KOFI_URL} target="_blank" rel="noopener noreferrer">
            ☕ {t("kofi_btn")}
          </a>
        </>
      )}

      <h3>{t("ab_howto")}</h3>
      <ol className="howto">
        <li>{t("ab_step1")}</li>
        <li>{t("ab_step2")}</li>
        <li>{t("ab_step3")}</li>
        <li>{t("ab_step4")}</li>
      </ol>

      <h3>{t("ab_auto_h")}</h3>
      <p>{t("ab_auto_b")}</p>

      <h3>{t("ab_privacy_h")}</h3>
      <p>{t("ab_privacy_b")}</p>

      <h3>{t("ab_check_h")}</h3>
      <p>{t("ab_check_b")}</p>

      <h3>{t("ab_aff_h")}</h3>
      <p className="muted">{t("ab_aff_b")}</p>
      <p className="muted small">{t("ab_lang_note")}</p>
    </div>
  );
}
