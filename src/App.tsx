import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  saveProxy,
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
  applyResults,
  buildProgress,
  SwimmerProgress,
  ImportOutcome,
} from "./store.ts";
import { computeCut, CutResult, goalSplits, eventMeta, segInfo } from "./cuts.ts";
import { DEFAULT_PROXY, FEEDBACK_URL } from "./config.ts";
import { getTheme, setTheme, Theme } from "./theme.ts";
import { t, getLang, setLang, LANGS, Lang } from "./i18n.ts";
import day from "./day.json";
import meetsDirectory from "./meets.json";

type Nav = "home" | "import" | "swimmers" | "watching" | "progress" | "teams" | "about";

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
}
// Raw copy in the repo so the community can add meets via PR without an app release.
const DIRECTORY_URL = "https://raw.githubusercontent.com/chesler410/my-swimmer/main/src/meets.json";
type Role = "parent" | "coach";

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
const levelClass = (l?: string | null) => "lvl lvl-" + (l ? l.toLowerCase() : "none");

// Shareable meet link: encode the meet's public import URL(s) so a teammate who opens the
// link imports the same meet on their own device (no backend). u = import URL, r = results.
interface SharePayload { t?: string; u: string; r?: string }
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
  note,
  onNote,
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
  note?: string;
  onNote?: (val: string) => void;
}) {
  const { e } = d;
  const [editing, setEditing] = useState(false);
  const [showSplits, setShowSplits] = useState(false);
  const [editNote, setEditNote] = useState(false);
  const splits = e.relay ? null : goalSplits(e.desc, goal || "", pacing || "even");
  const actualArr = (asplits || "").split(",").map((x) => x.trim()).filter(Boolean);
  const seg = e.relay ? null : segInfo(e.desc);
  const time = result || e.seed;
  const cut = cutFor(d, result);
  const close = cut?.nextCut && cut.nextCut.needed <= 1.0;
  return (
    <div className={"card event" + (close ? " close" : "") + (result ? " has-result" : "")}>
      <div className="ev-top">
        {showSwimmer && (
          <span className="kid-tag" style={{ background: d.color }}>
            {firstName(d.swimmer)}
          </span>
        )}
        <span className="ev-num">#{e.event}</span>
        <span className="ev-race">{raceOf(e)}</span>
        {cut?.achieved && <span className={levelClass(cut.achieved)}>{cut.achieved}</span>}
      </div>
      <div className="ev-meta">
        <span>{e.heat ?? t("heat_tbd")}</span>
        <span className="lane">{t("lane", { n: e.lane })}</span>
        <span>
          {e.relay ? t("team_label") : result ? t("swam") : t("seed")} <strong>{time}</strong>
        </span>
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
      {!e.relay && (
      <div className="result-entry">
        {editing ? (
          <input
            className="field result-input"
            autoFocus
            defaultValue={result || ""}
            placeholder={t("timeph")}
            inputMode="decimal"
            onBlur={(ev) => {
              onSetResult(ev.target.value.trim());
              setEditing(false);
            }}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
            }}
          />
        ) : (
          <button className="inline-link" onClick={() => setEditing(true)}>
            {result ? t("edittime") : t("addtime")}
          </button>
        )}
      </div>
      )}
      {!e.relay && (
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
              <input
                key={"g" + (goal || "")}
                className="field result-input"
                defaultValue={goal || ""}
                placeholder={t("goal_ph")}
                inputMode="decimal"
                onBlur={(ev) => onGoal?.(ev.target.value.trim())}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
                }}
              />
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
              {splits && (
                <table className="splittable">
                  <thead>
                    <tr>
                      <th>m</th>
                      <th>{t("splits_target")}</th>
                      {actualArr.length > 0 && <th>{t("swam")}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {splits.map((s, i) => (
                      <tr key={i}>
                        <td className="mono">{s.dist}</td>
                        <td className="mono">{s.cum}</td>
                        {actualArr.length > 0 && <td className="mono actual">{actualArr[i] || "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <input
                className="field result-input"
                defaultValue={asplits || ""}
                placeholder={t("actual_ph")}
                onBlur={(ev) => onSplits?.(ev.target.value.trim())}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
                }}
              />
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
              placeholder={t("note_ph")}
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
              {t("note_add")}
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
          {sorted.map((d, i) => (
            <tr key={i}>
              {multi && <td style={{ color: d.color, fontWeight: 600 }}>{firstName(d.swimmer)}</td>}
              <td className="mono">{d.e.event}</td>
              <td className="mono">{heatNum(d.e.heat)}</td>
              <td className="mono">{d.e.lane}</td>
              <td>{swimAbbr(raceOf(d.e))}</td>
              {cols.pb && <td className="mono">{pbOf(d)}</td>}
              {cols.cut && <td className="mono">{cutOf(d)}</td>}
              {cols.champ && <td className="mono">{champOf(d)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="muted arm-note">{t("armlegend")}</p>
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
  let s = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//my-swimmer//EN\r\nCALSCALE:GREGORIAN\r\n";
  events.forEach(([mins, title], i) => {
    s +=
      "BEGIN:VEVENT\r\n" +
      `UID:ms-${dateStr}-${i}-${Math.random().toString(36).slice(2)}@my-swimmer\r\n` +
      `DTSTAMP:${stamp}\r\nDTSTART:${icsDateTime(dateStr, mins)}\r\nDURATION:PT5M\r\n` +
      `SUMMARY:🏊 ${title}\r\n` +
      `BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:${title}\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\n` +
      "END:VEVENT\r\n";
  });
  return s + "END:VCALENDAR\r\n";
}
function downloadIcs(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "my-swimmer-fuel.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function Fueling() {
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => localStorage.getItem("meetDate") || today);
  const [time, setTime] = useState(() => localStorage.getItem("firstRaceTime") || "");
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
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              localStorage.setItem("meetDate", e.target.value);
            }}
          />
        </label>
        <label className="fuel-time">
          {t("fuel_first")}{" "}
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              localStorage.setItem("firstRaceTime", e.target.value);
            }}
          />
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
  const [coachTeam, setCoachTeamState] = useState<string>(() => localStorage.getItem("coachTeam") || "");
  function setRole(r: Role | null) {
    setRoleState(r);
    if (r) localStorage.setItem("role", r);
    else localStorage.removeItem("role");
  }
  function setCoachTeam(team: string) {
    setCoachTeamState(team);
    if (team) localStorage.setItem("coachTeam", team);
    else localStorage.removeItem("coachTeam");
  }
  const [view, setView] = useState<"cards" | "table">(
    () => (localStorage.getItem("view") as "cards" | "table") || "cards"
  );
  const [filter, setFilter] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [results, setResultsState] = useState<Record<string, string>>(loadResults);
  const [notes, setNotesState] = useState<Record<string, string>>(() => loadMap("notes"));
  const [goals, setGoalsState] = useState<Record<string, string>>(() => loadMap("goals"));
  const [asplits, setAsplitsState] = useState<Record<string, string>>(() => loadMap("actualsplits"));
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [lang, setLangState] = useState<Lang>(getLang);
  const [pacing, setPacingState] = useState<"even" | "realistic">(
    () => (localStorage.getItem("pacing") as "even" | "realistic") || "even"
  );
  function setPacing(p: "even" | "realistic") {
    setPacingState(p);
    localStorage.setItem("pacing", p);
  }
  const [logo, setLogoState] = useState(() => localStorage.getItem("teamLogo") || "");
  function setLogo(v: string) {
    setLogoState(v);
    if (v) localStorage.setItem("teamLogo", v);
    else localStorage.removeItem("teamLogo");
  }
  const [brand, setBrandState] = useState(() => localStorage.getItem("brandColor") || "");
  function setBrand(v: string) {
    setBrandState(v);
    if (v) localStorage.setItem("brandColor", v);
    else localStorage.removeItem("brandColor");
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
  const [liveUrl, setLiveUrlState] = useState(() => localStorage.getItem("liveUrl") || "");
  const [liveOn, setLiveOnState] = useState(() => localStorage.getItem("liveOn") === "1");
  const [liveStatus, setLiveStatus] = useState("");
  function setLiveUrl(v: string) {
    setLiveUrlState(v);
    localStorage.setItem("liveUrl", v);
  }
  function setLiveOn(v: boolean) {
    setLiveOnState(v);
    localStorage.setItem("liveOn", v ? "1" : "0");
  }
  // Community meet directory: start with the bundled copy, then refresh from the repo.
  const [directory, setDirectory] = useState<DirMeet[]>(meetsDirectory as DirMeet[]);
  useEffect(() => {
    fetch(DIRECTORY_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d) && d.length) setDirectory(d); })
      .catch(() => { /* keep bundled */ });
  }, []);
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
    kind: "goal" | "splits" | "note",
    meetId: string,
    event: number,
    name: string,
    val: string
  ) {
    const map = kind === "goal" ? goals : kind === "splits" ? asplits : notes;
    const setter = kind === "goal" ? setGoalsState : kind === "splits" ? setAsplitsState : setNotesState;
    const storeKey = kind === "goal" ? "goals" : kind === "splits" ? "actualsplits" : "notes";
    const next = { ...map };
    const k = resultKey(meetId, event, name);
    if (val.trim()) next[k] = val.trim();
    else delete next[k];
    setter(next);
    localStorage.setItem(storeKey, JSON.stringify(next));
  }
  function cycleTheme() {
    const order: Theme[] = ["auto", "light", "dark"];
    const next = order[(order.indexOf(theme) + 1) % 3];
    setThemeState(next);
    setTheme(next);
  }

  function persistSwimmers(s: Swimmer[]) {
    setSwimmers(s);
    saveSwimmers(s);
  }
  function persistMeets(m: Meet[]) {
    setMeets(m);
    saveMeets(m);
  }
  function pickView(v: "cards" | "table") {
    setView(v);
    localStorage.setItem("view", v);
  }
  function addSwimmer(name: string, team: string, age?: number, gender?: "Girls" | "Boys", watch?: boolean) {
    if (!name.trim()) return;
    if (swimmers.some((s) => matchesName(s.name, name) && (s.team || "") === (team || ""))) return;
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
        err = e?.message || `Couldn't read ${f.name}.`;
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
      finishImport([], e?.message || "Couldn't fetch that link.");
    }
  }

  function finishImport(outcomes: ImportOutcome[], err: string) {
    const newMeets = outcomes.flatMap((o) => (o.kind === "meet" ? [o.meet] : []));
    const resultSets = outcomes.flatMap((o) => (o.kind === "results" ? [o] : []));
    let meetsNext = meets;
    if (newMeets.length) {
      meetsNext = [...newMeets, ...meets];
      persistMeets(meetsNext);
    }
    const parts: string[] = [];
    if (newMeets.length) {
      const total = newMeets.reduce((n, m) => n + m.entries.length, 0);
      parts.push(`Imported ${newMeets.length} meet file(s) — ${total} swimmers found.`);
    }
    if (resultSets.length) {
      let r = results;
      let matched = 0;
      for (const rs of resultSets) {
        const applied = applyResults(rs.finishers, swimmers, meetsNext, r);
        r = applied.results;
        matched += applied.matched;
      }
      setResultsState(r);
      saveResults(r);
      parts.push(
        matched > 0
          ? `Results: filled ${matched} actual time(s) for your swimmers. 🏁`
          : `Results read, but no times matched your swimmers — import that meet's heat sheet and pick your swimmers first.`
      );
    }
    if (!outcomes.length && err) parts.push(err);
    if ((newMeets.length || resultSets.length) && (swimmers.length || coaching)) setNav("home");
    else if (newMeets.length && !swimmers.length && !coaching) setNav("swimmers");
    setMsg(parts.join(" ").trim());
    setBusy(false);
  }

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
    <div className="app">
      <UpdateBanner />
      <header className="apphead">
        <div className="brandrow">
          <div className="brand">
            {logo && <img className="team-logo" src={logo} alt="" />}🏊 my-swimmer
          </div>
          <div className="head-ctrls">
            <select className="lang-sel" value={lang} onChange={(e) => changeLang(e.target.value as Lang)} aria-label={t("lang_label")}>
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.label}
                </option>
              ))}
            </select>
            <button className="theme-btn" onClick={cycleTheme} aria-label="Theme">
              {theme === "auto" ? "🅰 " + t("th_auto") : theme === "light" ? "☀ " + t("th_light") : "🌙 " + t("th_dark")}
            </button>
          </div>
        </div>
        {role && !(role === "coach" && !coachTeam) && (
          <nav className="tabs">
            {((coaching
              ? ["home", "import", "progress", "teams", "about"]
              : ["home", "import", "swimmers", "watching", "progress", "teams", "about"]) as Nav[]).map((tb) => (
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
        <RolePicker onPick={(r) => { setRole(r); if (r === "parent") setCoachTeam(""); }} />
      )}
      {role === "coach" && !coachTeam && (
        <CoachTeamPicker
          teams={buildTeams(meets)}
          onPick={setCoachTeam}
          goImport={() => setNav("import")}
          onBack={() => setRole(null)}
        />
      )}

      {gated && pendingShare && (
        <div className="card share-import">
          <h3>📥 {t("share_got")}</h3>
          <p className="disc-title">{pendingShare.t || t("share_meet")}</p>
          <div className="disc-actions">
            <button className="primary" onClick={() => { onUrl(pendingShare.u); clearShare(); }}>{t("share_import")}</button>
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
          pickView={pickView}
          filter={filter}
          toggleFilter={toggleFilter}
          goImport={() => setNav("import")}
          goSwimmers={() => setNav("swimmers")}
          removeMeet={(id) => persistMeets(meets.filter((m) => m.id !== id))}
          results={results}
          setResult={setResult}
          goals={goals}
          asplits={asplits}
          notes={notes}
          setMap={setMap}
          pacing={pacing}
          setPacing={setPacing}
          liveOn={liveOn}
          liveStatus={liveStatus}
        />
      )}
      {gated && nav === "import" && (
        <ImportView
          busy={busy}
          msg={msg}
          onFiles={onFiles}
          onUrl={onUrl}
          goAbout={() => setNav("about")}
          liveUrl={liveUrl}
          liveOn={liveOn}
          liveStatus={liveStatus}
          setLiveUrl={setLiveUrl}
          setLiveOn={setLiveOn}
          directory={directory}
          onGoLive={(u: string) => { setLiveUrl(u); setLiveOn(true); setNav("home"); }}
        />
      )}
      {gated && !coaching && (nav === "swimmers" || nav === "watching") && (
        <SwimmersView
          swimmers={swimmers}
          roster={roster}
          addSwimmer={addSwimmer}
          removeSwimmer={removeSwimmer}
          goImport={() => setNav("import")}
          mode={nav === "watching" ? "watch" : "mine"}
        />
      )}
      {gated && nav === "progress" && (
        <ProgressView
          progress={buildProgress(activeSwimmers, meets, results)}
          goImport={() => setNav("import")}
          goSwimmers={() => setNav(coaching ? "import" : "swimmers")}
        />
      )}
      {gated && nav === "teams" && (
        <TeamsView
          teams={buildTeams(meets)}
          swimmers={swimmers}
          addSwimmer={addSwimmer}
          goImport={() => setNav("import")}
        />
      )}
      {gated && nav === "about" && <About logo={logo} setLogo={setLogo} setBrand={setBrand} role={role} onChangeRole={() => setRole(null)} />}
    </div>
  );
}

function TeamsView(props: {
  teams: { team: string; swimmers: RosterItem[] }[];
  swimmers: Swimmer[];
  addSwimmer: (name: string, team: string, age?: number, gender?: "Girls" | "Boys", watch?: boolean) => void;
  goImport: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const status = (name: string) => {
    const s = props.swimmers.find((x) => matchesName(x.name, name));
    return s ? (s.watch ? "watch" : "mine") : null;
  };
  if (props.teams.length === 0) {
    return <Empty title={t("nav_teams")} body={t("teams_none")} cta={t("sw_addmeet")} onCta={props.goImport} />;
  }
  return (
    <div>
      <p className="muted teams-intro">{t("teams_intro")}</p>
      {props.teams.map(({ team, swimmers }) => (
        <div className="card team-card" key={team}>
          <button className="team-row" onClick={() => setOpen(open === team ? null : team)}>
            <span className="team-name">{team}</span>
            <span className="muted">{t("nswim", { n: swimmers.length })} {open === team ? "▾" : "▸"}</span>
          </button>
          {open === team && (
            <div className="team-swimmers">
              {swimmers.map((r, i) => {
                const st = status(r.name);
                return (
                  <div className="ts-row" key={i}>
                    <span className="ts-name">
                      {displayName(r.name)}{" "}
                      <span className="muted">{[r.gender, r.age].filter(Boolean).join(" · ")}</span>
                    </span>
                    {st ? (
                      <span className={"ts-tag " + st}>{st === "watch" ? t("watchlist") : t("myswimmers")}</span>
                    ) : (
                      <span className="ts-actions">
                        <button className="chip sm" onClick={() => props.addSwimmer(r.name, r.team, parseInt(r.age, 10) || undefined, r.gender, false)}>
                          + {t("add_mine")}
                        </button>
                        <button className="chip sm" onClick={() => props.addSwimmer(r.name, r.team, parseInt(r.age, 10) || undefined, r.gender, true)}>
                          + {t("add_watch")}
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
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
    items.sort((a, b) => a.e.event - b.e.event);
    return { meet: m, items };
  });
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

function Home(props: any) {
  const { swimmers, meets, view, pickView, filter, toggleFilter, results, setResult, goals, asplits, notes, setMap, pacing, setPacing, liveOn, liveStatus } = props;
  const [showSample, setShowSample] = useState(() => location.search.includes("demo"));
  const [shareMsg, setShareMsg] = useState("");
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
  const groups = buildDisplay(meets, swimmers, filter);
  const all = groups.flatMap((g: any) => g.items as DE[]);
  const closest = all
    .map((d: DE) => ({ d, cut: cutFor(d, resultOf(d)) }))
    .filter((x) => x.cut?.nextCut)
    .sort((a, b) => a.cut!.nextCut!.needed - b.cut!.nextCut!.needed)
    .slice(0, 3);

  return (
    <>
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

      {meets.length > 0 && swimmers.length > 0 && (
        <>
          <Disclaimer />
          {swimmers.length > 1 && (
            <div className="chips">
              {swimmers.map((k: Swimmer) => {
                const on = filter.size === 0 || filter.has(k.id);
                return (
                  <button
                    key={k.id}
                    className={"chip" + (on ? " on" : "")}
                    style={on ? { background: k.color, borderColor: k.color, color: "#fff" } : {}}
                    onClick={() => toggleFilter(k.id)}
                  >
                    {firstName(k.name)}
                  </button>
                );
              })}
            </div>
          )}
          {closest.length > 0 && (
            <section className="card highlight">
              <h2>🎯 {t("closest")}</h2>
              {closest.map(({ d, cut }: any, i: number) => (
                <div className="hl-row" key={i}>
                  <span>
                    {swimmers.length > 1 ? `${firstName(d.swimmer)} · ` : ""}
                    {d.e.race}
                  </span>
                  <span className="hl-need">
                    {cut.nextCut.level} in {cut.nextCut.needed.toFixed(2)}s
                  </span>
                </div>
              ))}
            </section>
          )}
          <Fueling />
          <Prep />
          <div className="events-head">
            <h2 className="section-title">{t("meets", { n: meets.length })}</h2>
            <div className="seg">
              <button className={view === "cards" ? "on" : ""} onClick={() => pickView("cards")}>
                {t("v_cards")}
              </button>
              <button className={view === "table" ? "on" : ""} onClick={() => pickView("table")}>
                {t("v_table")}
              </button>
            </div>
          </div>
          {view === "table" && (
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
          {groups.map(({ meet, items }: any) => (
            <div className="meet-block" key={meet.id}>
              <div className="meet-head">
                <h3>{meet.title}</h3>
                {courseLabel(meet) && <span className="course-badge">{courseLabel(meet)}</span>}
                {meet.sourceUrl && (
                  <button
                    className="meet-share"
                    title={t("share_btn")}
                    onClick={async () => {
                      const r = await shareMeet({ t: meet.title, u: meet.sourceUrl });
                      setShareMsg(r === "copied" ? t("share_copied") : r === "shared" ? "" : t("share_fail"));
                      setTimeout(() => setShareMsg(""), 2500);
                    }}
                  >
                    🔗
                  </button>
                )}
                <button className="remove" onClick={() => props.removeMeet(meet.id)}>
                  ✕
                </button>
              </div>
              {items.length === 0 ? (
                <p className="muted meet-empty">{t("em_none_meet")}</p>
              ) : (
                bySession(items).map((sec) => (
                  <div className={"session-block" + (view === "cards" ? " grid" : "")} key={sec.label}>
                    {sec.label !== "Events" && <div className="session-head">📅 {sec.label}</div>}
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
                            onGoal={(v: string) => setMap("goal", d.meetId, d.e.event, d.swimmer, v)}
                            onSplits={(v: string) => setMap("splits", d.meetId, d.e.event, d.swimmer, v)}
                            onNote={(v: string) => setMap("note", d.meetId, d.e.event, d.swimmer, v)}
                            pacing={pacing}
                            setPacing={setPacing}
                          />
                        );
                      })
                    ) : (
                      <ArmTable items={sec.items} results={results} cols={cols} />
                    )}
                  </div>
                ))
              )}
            </div>
          ))}
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
  const [shareMsg, setShareMsg] = useState("");
  const states = [...new Set(props.meets.map((m) => m.state).filter(Boolean))].sort() as string[];

  function findNearMe() {
    if (!navigator.geolocation) { setGeoMsg(t("disc_geoerr")); return; }
    setGeoMsg(t("disc_locating"));
    navigator.geolocation.getCurrentPosition(
      (pos) => { setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoMsg(""); setStateFilter(""); },
      () => setGeoMsg(t("disc_geoerr"))
    );
  }

  let list = props.meets.filter((m) => !stateFilter || m.state === stateFilter);
  if (here) {
    list = [...list].sort((a, b) => {
      const da = a.lat != null && a.lng != null ? miBetween(here, { lat: a.lat, lng: a.lng }) : 1e9;
      const db = b.lat != null && b.lng != null ? miBetween(here, { lat: b.lat, lng: b.lng }) : 1e9;
      return da - db;
    });
  } else {
    list = [...list].sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  }

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

      {list.length === 0 ? (
        <div className="disc-empty">
          <p className="muted">{t("disc_none")}</p>
          <a className="secondary" href={props.suggestUrl} target="_blank" rel="noopener noreferrer">{t("disc_suggest")}</a>
        </div>
      ) : (
        <>
          {list.map((m) => {
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
                  {(m.heatUrl || m.resultsUrl) && (
                    <button className="chip sm" onClick={async () => { const r = await shareMeet({ t: m.title, u: m.heatUrl || m.resultsUrl!, r: m.resultsUrl }); setShareMsg(r === "copied" ? t("share_copied") : ""); setTimeout(() => setShareMsg(""), 2500); }}>🔗 {t("share_btn")}</button>
                  )}
                  {m.infoUrl && <a className="chip sm" href={m.infoUrl} target="_blank" rel="noopener noreferrer">{t("disc_open")}</a>}
                </div>
              </div>
            );
          })}
          <p className="feedback-foot">
            <a href={props.suggestUrl} target="_blank" rel="noopener noreferrer">{t("disc_suggest")}</a>
          </p>
        </>
      )}
    </div>
  );
}

function ProgressView(props: { progress: SwimmerProgress[]; goImport: () => void; goSwimmers: () => void }) {
  if (!props.progress.length)
    return <Empty title={t("prog_empty_t")} body={t("prog_empty_b")} cta={t("prog_empty_cta")} onCta={props.goSwimmers} />;
  return (
    <div>
      <p className="teams-intro muted">{t("prog_intro")}</p>
      {props.progress.map((sp) => (
        <div className="card" key={sp.swimmer.id}>
          <div className="prog-head">
            <span className="kid-tag" style={{ background: sp.swimmer.color }}>
              {firstName(sp.swimmer.name)}
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
  );
}

function ImportView(props: {
  busy: boolean;
  msg: string;
  onFiles: (f: FileList | null) => void;
  onUrl: (u: string) => void;
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
  const [liveDraft, setLiveDraft] = useState(props.liveUrl);
  return (
    <div>
      <DiscoverView
        meets={props.directory}
        onImport={(u: string) => props.onUrl(u)}
        onGoLive={props.onGoLive}
        suggestUrl={FEEDBACK_URL}
      />

      <div className="card">
        <h2>{t("imp_title")}</h2>
        <p className="muted">{t("imp_tip")}</p>
        <p className="imp-note">📄 {t("imp_results")}</p>
        <input className="field" placeholder="https://…/heatsheet.pdf" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoFocus />
        <button className="primary" disabled={props.busy || !url.trim()} onClick={() => props.onUrl(url)}>
          {props.busy ? t("imp_opening") : t("imp_open")}
        </button>
        <p className="muted small">{t("imp_linktip")}</p>
      </div>

      <div className={"card live-card" + (props.liveOn ? " on" : "")}>
        <h3>{props.liveOn && <span className="live-dot" />}{t("live_h")}</h3>
        <p className="muted">{t("live_b")}</p>
        <input
          className="field"
          placeholder="https://…/results.pdf"
          value={liveDraft}
          onChange={(e) => setLiveDraft(e.target.value)}
          inputMode="url"
          disabled={props.liveOn}
        />
        {props.liveOn ? (
          <button className="secondary" onClick={() => props.setLiveOn(false)}>
            {t("live_stop")}
          </button>
        ) : (
          <button
            className="primary"
            disabled={!liveDraft.trim()}
            onClick={() => {
              props.setLiveUrl(liveDraft.trim());
              props.setLiveOn(true);
            }}
          >
            {t("live_start")}
          </button>
        )}
        {props.liveStatus && <p className="live-status">{props.liveStatus}</p>}
        <p className="muted small">{t("live_tip")}</p>
      </div>

      <div className="card">
        <h3>{t("imp_backup")}</h3>
        <p className="muted">{t("imp_backuptip")}</p>
        <label className="secondary filelabel">
          {props.busy ? t("imp_reading") : t("imp_upload")}
          <input type="file" accept="application/pdf,.sd3,.txt" multiple disabled={props.busy} onChange={(e) => props.onFiles(e.target.files)} hidden />
        </label>
        <p className="muted small">{t("imp_sd3")}</p>
      </div>

      {props.msg && <p className="importmsg">{props.msg}</p>}

      <div className="card">
        <h3>{t("src_h")}</h3>
        <p className="muted small">{t("src_note")}</p>
        <ul className="src-links">
          <li><a href="https://data.usaswimming.org/datahub/usas/individualsearch" target="_blank" rel="noreferrer">USA Swimming — Individual Times Search</a></li>
          <li><a href="https://swimstandards.com" target="_blank" rel="noreferrer">SwimStandards — time standards & best times</a></li>
          <li><a href="https://www.swimcloud.com" target="_blank" rel="noreferrer">SwimCloud — rankings & results</a></li>
        </ul>
      </div>
    </div>
  );
}

function SwimmersView(props: {
  swimmers: Swimmer[];
  roster: RosterItem[];
  addSwimmer: (name: string, team: string, age?: number, gender?: "Girls" | "Boys", watch?: boolean) => void;
  removeSwimmer: (id: string) => void;
  goImport: () => void;
  mode: "mine" | "watch";
}) {
  const [q, setQ] = useState("");
  const [manual, setManual] = useState(false);
  const [mName, setMName] = useState("");
  const [mTeam, setMTeam] = useState("");
  const watchMode = props.mode === "watch";

  const ql = q.trim().toLowerCase();
  const results = ql
    ? props.roster
        .filter((r) => r.name.toLowerCase().includes(ql) || r.team.toLowerCase().includes(ql))
        .slice(0, 12)
    : [];
  const isAdded = (name: string) => props.swimmers.some((s) => matchesName(s.name, name));
  const list = props.swimmers.filter((s) => (watchMode ? s.watch : !s.watch));

  return (
    <div>
      <div className="card">
        <h2>{watchMode ? t("watchlist") : t("myswimmers")}</h2>
        {list.length === 0 && <p className="muted">{t("sw_none")}</p>}
        {list.map((s) => (
          <div className="kid-row" key={s.id}>
            <span className="kid-dot" style={{ background: s.color }} />
            <span className="kid-name">
              {displayName(s.name)}{" "}
              <span className="muted">{[s.gender, s.age, s.team].filter(Boolean).join(" · ")}</span>
            </span>
            <button className="remove" onClick={() => props.removeSwimmer(s.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>{t("sw_find")}</h2>
        {props.roster.length === 0 ? (
          <>
            <p className="muted">{t("sw_importfirst")}</p>
            <button className="primary" onClick={props.goImport}>
              {t("sw_addmeet")}
            </button>
          </>
        ) : (
          <>
            <input className="field" placeholder={t("sw_search")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            {ql && results.length === 0 && <p className="muted">{t("sw_nomatch", { q })}</p>}
            <div className="results">
              {results.map((r, i) => {
                const added = isAdded(r.name);
                return (
                  <button
                    key={i}
                    className="result"
                    disabled={added}
                    onClick={() => props.addSwimmer(r.name, r.team, parseInt(r.age, 10) || undefined, r.gender, watchMode)}
                  >
                    <span className="result-name">{displayName(r.name)}</span>
                    <span className="result-meta">{[r.gender, r.age, r.team].filter(Boolean).join(" · ")}</span>
                    <span className="result-add">{added ? "✓" : "+"}</span>
                  </button>
                );
              })}
            </div>
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
                props.addSwimmer(mName, mTeam, undefined, undefined, watchMode);
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

// Pick the logo's most vivid (bright + saturated) non-gray color, for header branding.
function vividColor(ctx: CanvasRenderingContext2D, w: number, h: number): string | null {
  const data = ctx.getImageData(0, 0, w, h).data;
  let best: [number, number, number] | null = null;
  let bestScore = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 510;
    const s = mx === mn ? 0 : (mx - mn) / (255 - Math.abs(mx + mn - 255));
    if (s < 0.35 || l < 0.2 || l > 0.85) continue; // skip gray / near-black / near-white
    const score = s * (0.55 + 0.45 * l); // favor brighter
    if (score > bestScore) {
      bestScore = score;
      best = [r, g, b];
    }
  }
  return best ? "#" + best.map((v) => v.toString(16).padStart(2, "0")).join("") : null;
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
    cb(c.toDataURL("image/png"), ctx ? vividColor(ctx, w, h) : null);
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
}

function About({ logo, setLogo, setBrand, role, onChangeRole }: { logo: string; setLogo: (v: string) => void; setBrand: (v: string) => void; role: Role | null; onChangeRole: () => void }) {
  return (
    <div className="card about">
      <h2>{t("ab_title")}</h2>
      <p>{t("ab_intro")}</p>

      <div className="role-line">
        <span className="muted">{role === "coach" ? "🧑‍🏫 " + t("role_coach") : "👪 " + t("role_parent")}</span>
        <button className="inline-link" onClick={onChangeRole}>{t("role_change")}</button>
      </div>

      <a className="primary feedback-btn" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
        {t("fb_send")}
      </a>

      <h3>{t("logo_h")}</h3>
      {logo && <img className="team-logo lg" src={logo} alt="team logo" />}
      <div>
        <label className="secondary filelabel">
          {t("logo_add")}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) processLogo(f, (url, color) => { setLogo(url); setBrand(color || ""); });
            }}
          />
        </label>
        {logo && (
          <button className="link" onClick={() => { setLogo(""); setBrand(""); }}>
            {t("logo_remove")}
          </button>
        )}
      </div>
      <p className="muted small">{t("logo_note")}</p>

      <h3>{t("ab_howto")}</h3>
      <ol className="howto">
        <li>{t("ab_step1")}</li>
        <li>{t("ab_step2")}</li>
        <li>{t("ab_step3")}</li>
        <li>{t("ab_step4")}</li>
      </ol>

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
