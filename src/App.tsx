import { useMemo, useState } from "react";
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
  importFile,
  importUrl,
} from "./store.ts";
import { computeCut, CutResult } from "./cuts.ts";
import { DEFAULT_PROXY, FEEDBACK_URL } from "./config.ts";
import { getTheme, setTheme, Theme } from "./theme.ts";
import day from "./day.json";

type Nav = "home" | "import" | "swimmers" | "about";

function displayName(n: string): string {
  if (n.includes(",")) {
    const [last, first] = n.split(",").map((s) => s.trim());
    return first ? `${first} ${last}` : last;
  }
  return n;
}
const firstName = (n: string) => displayName(n).split(" ")[0];

const STROKE_ABBR: Record<string, string> = { Free: "FR", Back: "BK", Breast: "BR", Fly: "FL", IM: "IM" };
const swimAbbr = (race: string) => {
  const [d, ...r] = race.split(" ");
  return `${d} ${STROKE_ABBR[r.join(" ")] ?? r.join(" ")}`;
};
const heatNum = (h: string | null) => h?.match(/Heat\s+(\d+)/)?.[1] ?? "—";
const levelClass = (l?: string | null) => "lvl lvl-" + (l ? l.toLowerCase() : "none");

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
}: {
  d: DE;
  showSwimmer: boolean;
  result?: string;
  onSetResult: (val: string) => void;
}) {
  const { e } = d;
  const [editing, setEditing] = useState(false);
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
        <span className="ev-race">{e.race}</span>
        {cut?.achieved && <span className={levelClass(cut.achieved)}>{cut.achieved}</span>}
      </div>
      <div className="ev-meta">
        <span>{e.heat ?? "Heat TBD"}</span>
        <span className="lane">Lane {e.lane}</span>
        <span>
          {e.relay ? "Team" : result ? "Swam" : "Seed"} <strong>{time}</strong>
        </span>
      </div>
      {e.relay && <div className="cut muted">🏁 Relay — {e.team}</div>}
      {/* SE championship cut shown first — it's the priority target */}
      {cut?.champ && (
        <div className="champ">
          <span>🏆 SE Champ {cut.champ.time}</span>
          {cut.champ.met ? (
            <span className="champ-met">made it ✓</span>
          ) : (
            <span className="champ-need">need {cut.champ.needed.toFixed(2)}s</span>
          )}
        </div>
      )}
      {cut?.nextCut ? (
        <div className="cut">
          <span>
            Next cut → <strong>{cut.nextCut.level}</strong> {cut.nextCut.time}
          </span>
          <span className={"need" + (close ? " need-close" : "")}>
            drop {cut.nextCut.needed.toFixed(2)}s{close ? " — so close! 🔥" : ""}
          </span>
        </div>
      ) : cut ? (
        <div className="cut muted">Top standard reached 🏆</div>
      ) : e.relay ? null : (
        <div className="cut muted">No standard for this event</div>
      )}
      {!e.relay && (
      <div className="result-entry">
        {editing ? (
          <input
            className="field result-input"
            autoFocus
            defaultValue={result || ""}
            placeholder="Time swum, e.g. 1:38.50"
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
            {result ? "✎ edit swum time" : "＋ add the time they swam"}
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
  cols: { pb: boolean; cut: boolean };
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
  return (
    <div className="card">
      <table className="arm">
        <thead>
          <tr>
            {multi && <th>Who</th>}
            <th>Ev</th>
            <th>Ht</th>
            <th>Ln</th>
            <th>Swim</th>
            {cols.pb && <th>PB</th>}
            {cols.cut && <th>Cut</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d, i) => (
            <tr key={i}>
              {multi && <td style={{ color: d.color, fontWeight: 600 }}>{firstName(d.swimmer)}</td>}
              <td className="mono">{d.e.event}</td>
              <td className="mono">{heatNum(d.e.heat)}</td>
              <td className="mono">{d.e.lane}</td>
              <td>{swimAbbr(d.e.race)}</td>
              {cols.pb && <td className="mono">{pbOf(d)}</td>}
              {cols.cut && <td className="mono">{cutOf(d)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted arm-note">Ev = event, Ht = heat, Ln = lane. FR free · BK back · BR breast · FL fly · IM.</p>
    </div>
  );
}

function Fueling() {
  return (
    <section className="card fuel">
      <h2>💧 Fueling &amp; hydration</h2>
      <ul>
        <li>Sip water steadily all session — don't wait until thirsty.</li>
        <li>Light carb snack ~60–90 min before the first race (banana, toast, granola bar).</li>
        <li>Between races more than ~45 min apart: small snack + a few sips.</li>
        <li>Avoid heavy or new foods within ~45 min of a race.</li>
        <li>Warm/ready ~20–30 min before each event is called.</li>
      </ul>
    </section>
  );
}

function Disclaimer() {
  const [hidden, setHidden] = useState(() => localStorage.getItem("dismiss-disclaimer") === "1");
  if (hidden) return null;
  return (
    <div className="disclaimer">
      <span>
        ⚠️ Events are auto-read from the meet's PDF. PDF reading isn't perfect —{" "}
        <strong>always double-check against the official heat sheet.</strong>
      </span>
      <button
        onClick={() => {
          localStorage.setItem("dismiss-disclaimer", "1");
          setHidden(true);
        }}
      >
        Got it
      </button>
    </div>
  );
}

export function App() {
  const [nav, setNav] = useState<Nav>(() => {
    const t = new URLSearchParams(location.search).get("tab");
    return (["home", "import", "swimmers", "about"].includes(t || "") ? t : "home") as Nav;
  });
  const [swimmers, setSwimmers] = useState<Swimmer[]>(loadSwimmers);
  const [meets, setMeets] = useState<Meet[]>(loadMeets);
  const [view, setView] = useState<"cards" | "table">(
    () => (localStorage.getItem("view") as "cards" | "table") || "cards"
  );
  const [filter, setFilter] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [results, setResultsState] = useState<Record<string, string>>(loadResults);
  const [theme, setThemeState] = useState<Theme>(getTheme);

  const roster = useMemo(() => buildRoster(meets), [meets]);

  function setResult(meetId: string, event: number, name: string, val: string) {
    const next = { ...results };
    const k = resultKey(meetId, event, name);
    if (val.trim()) next[k] = val.trim();
    else delete next[k];
    setResultsState(next);
    saveResults(next);
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
  function addSwimmer(name: string, team: string, age?: number, gender?: "Girls" | "Boys") {
    if (!name.trim()) return;
    if (swimmers.some((s) => matchesName(s.name, name) && (s.team || "") === (team || ""))) return;
    persistSwimmers([...swimmers, makeSwimmer(name, team, swimmers.length, age, gender)]);
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
    const added: Meet[] = [];
    let err = "";
    for (const f of Array.from(files)) {
      try {
        added.push(await importFile(f));
      } catch (e: any) {
        err = e?.message || `Couldn't read ${f.name}.`;
      }
    }
    finishImport(added, err);
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

  function finishImport(added: Meet[], err: string) {
    if (added.length) {
      persistMeets([...added, ...meets]);
      const total = added.reduce((n, m) => n + m.entries.length, 0);
      setMsg(`Imported ${added.length} file(s) — ${total} swimmers found. Now pick yours below.`);
      setNav(swimmers.length ? "home" : "swimmers");
    } else if (err) {
      setMsg(err);
    }
    setBusy(false);
  }

  return (
    <div className="app">
      <header className="apphead">
        <div className="brandrow">
          <div className="brand">🏊 my-swimmer</div>
          <button className="theme-btn" onClick={cycleTheme} aria-label="Theme" title={`Theme: ${theme}`}>
            {theme === "auto" ? "🅰 Auto" : theme === "light" ? "☀ Light" : "🌙 Dark"}
          </button>
        </div>
        <nav className="tabs">
          {(["home", "import", "swimmers", "about"] as Nav[]).map((t) => (
            <button key={t} className={nav === t ? "on" : ""} onClick={() => setNav(t)}>
              {t === "import" ? "Add meet" : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
      </header>

      {nav === "home" && (
        <Home
          swimmers={swimmers}
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
        />
      )}
      {nav === "import" && <ImportView busy={busy} msg={msg} onFiles={onFiles} onUrl={onUrl} goAbout={() => setNav("about")} />}
      {nav === "swimmers" && (
        <SwimmersView
          swimmers={swimmers}
          roster={roster}
          addSwimmer={addSwimmer}
          removeSwimmer={removeSwimmer}
          goImport={() => setNav("import")}
        />
      )}
      {nav === "about" && <About />}
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
  const { swimmers, meets, view, pickView, filter, toggleFilter, results, setResult } = props;
  const [showSample, setShowSample] = useState(() => location.search.includes("demo"));
  const [cols, setCols] = useState<{ pb: boolean; cut: boolean }>(() => {
    try {
      return JSON.parse(localStorage.getItem("armcols") || '{"pb":true,"cut":false}');
    } catch {
      return { pb: true, cut: false };
    }
  });
  function toggleCol(k: "pb" | "cut") {
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
      {meets.length === 0 && swimmers.length === 0 && (
        <Empty title="Welcome 🏊" body="Add a meet's heat sheet, pick your swimmers, and see all their events — events, heats, lanes, and the next time standard to chase — on one page." cta="Add a meet" onCta={props.goImport} />
      )}
      {meets.length > 0 && swimmers.length === 0 && (
        <Empty title="Pick your swimmers" body="Your meet is loaded. Now tell us which swimmers are yours — search the meet's roster." cta="Choose swimmers" onCta={props.goSwimmers} />
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
              <h2>🎯 Closest to a new cut</h2>
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
          <div className="events-head">
            <h2 className="section-title">Meets ({meets.length})</h2>
            <div className="seg">
              <button className={view === "cards" ? "on" : ""} onClick={() => pickView("cards")}>
                Cards
              </button>
              <button className={view === "table" ? "on" : ""} onClick={() => pickView("table")}>
                Arm table
              </button>
            </div>
          </div>
          {view === "table" && (
            <div className="colchips">
              Columns:
              <button className={"chip sm" + (cols.pb ? " on" : "")} onClick={() => toggleCol("pb")}>
                PB
              </button>
              <button className={"chip sm" + (cols.cut ? " on" : "")} onClick={() => toggleCol("cut")}>
                Cut
              </button>
            </div>
          )}
          {groups.map(({ meet, items }: any) => (
            <div className="meet-block" key={meet.id}>
              <div className="meet-head">
                <h3>{meet.title}</h3>
                <button className="remove" onClick={() => props.removeMeet(meet.id)}>
                  ✕
                </button>
              </div>
              {items.length === 0 ? (
                <p className="muted meet-empty">None of your swimmers are in this meet.</p>
              ) : (
                bySession(items).map((sec) => (
                  <div className="session-block" key={sec.label}>
                    {sec.label !== "Events" && <div className="session-head">📅 {sec.label}</div>}
                    {view === "cards" ? (
                      sec.items.map((d, i) => (
                        <EntryCard
                          key={i}
                          d={d}
                          showSwimmer={swimmers.length > 1}
                          result={resultOf(d)}
                          onSetResult={(v: string) => setResult(d.meetId, d.e.event, d.swimmer, v)}
                        />
                      ))
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
        Got feedback?{" "}
        <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
          💬 Tell us
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
        {open ? "▾" : "▸"} See a sample (demo data — not your swimmer)
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

function ImportView(props: { busy: boolean; msg: string; onFiles: (f: FileList | null) => void; onUrl: (u: string) => void; goAbout: () => void }) {
  const [url, setUrl] = useState("");
  return (
    <div>
      <div className="card">
        <h2>Add a meet</h2>
        <p className="muted">Paste the meet's heat-sheet PDF link — no download needed.</p>
        <input className="field" placeholder="https://…/heatsheet.pdf" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoFocus />
        <button className="primary" disabled={props.busy || !url.trim()} onClick={() => props.onUrl(url)}>
          {props.busy ? "Opening…" : "Open link"}
        </button>
        <p className="muted small">Tip: most meet sites have a “Heat Sheet (PDF)” link you can copy. Many meets post one per session — add each.</p>
      </div>

      <div className="card">
        <h3>Backup: upload a PDF</h3>
        <p className="muted">If a link won't open, download the PDF and pick it here. Everything is read on your phone; nothing is uploaded.</p>
        <label className="secondary filelabel">
          {props.busy ? "Reading…" : "📄 Upload PDF(s)"}
          <input type="file" accept="application/pdf" multiple disabled={props.busy} onChange={(e) => props.onFiles(e.target.files)} hidden />
        </label>
      </div>

      {props.msg && <p className="importmsg">{props.msg}</p>}
    </div>
  );
}

function SwimmersView(props: {
  swimmers: Swimmer[];
  roster: RosterItem[];
  addSwimmer: (name: string, team: string, age?: number, gender?: "Girls" | "Boys") => void;
  removeSwimmer: (id: string) => void;
  goImport: () => void;
}) {
  const [q, setQ] = useState("");
  const [manual, setManual] = useState(false);
  const [mName, setMName] = useState("");
  const [mTeam, setMTeam] = useState("");

  const ql = q.trim().toLowerCase();
  const results = ql
    ? props.roster
        .filter((r) => r.name.toLowerCase().includes(ql) || r.team.toLowerCase().includes(ql))
        .slice(0, 12)
    : [];
  const isAdded = (name: string) => props.swimmers.some((s) => matchesName(s.name, name));

  // group selected swimmers by team
  const byTeam = new Map<string, Swimmer[]>();
  for (const s of props.swimmers) {
    const t = s.team || "—";
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t)!.push(s);
  }

  return (
    <div>
      <div className="card">
        <h2>Your swimmers</h2>
        {props.swimmers.length === 0 && <p className="muted">None yet — search a meet's roster below.</p>}
        {[...byTeam.keys()].sort().map((team) => (
          <div key={team}>
            {byTeam.size > 1 && <div className="team-head">{team}</div>}
            {byTeam.get(team)!.map((s) => (
              <div className="kid-row" key={s.id}>
                <span className="kid-dot" style={{ background: s.color }} />
                <span className="kid-name">
                  {displayName(s.name)}{" "}
                  <span className="muted">
                    {[s.gender, s.age, s.team].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <button className="remove" onClick={() => props.removeSwimmer(s.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Find a swimmer</h2>
        {props.roster.length === 0 ? (
          <>
            <p className="muted">Import a meet first, then search its roster here to pick your swimmers.</p>
            <button className="primary" onClick={props.goImport}>
              Add a meet
            </button>
          </>
        ) : (
          <>
            <input className="field" placeholder="Type a name or team…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            {ql && results.length === 0 && <p className="muted">No swimmer matching “{q}” in your imported meets.</p>}
            <div className="results">
              {results.map((r, i) => {
                const added = isAdded(r.name);
                return (
                  <button
                    key={i}
                    className="result"
                    disabled={added}
                    onClick={() => props.addSwimmer(r.name, r.team, parseInt(r.age, 10) || undefined, r.gender)}
                  >
                    <span className="result-name">{displayName(r.name)}</span>
                    <span className="result-meta">
                      {[r.gender, r.age, r.team].filter(Boolean).join(" · ")}
                    </span>
                    <span className="result-add">{added ? "✓" : "+"}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        <button className="inline-link manual-toggle" onClick={() => setManual(!manual)}>
          {manual ? "– cancel manual add" : "+ add by name manually"}
        </button>
        {manual && (
          <div className="manual">
            <input className="field" placeholder="Swimmer name" value={mName} onChange={(e) => setMName(e.target.value)} />
            <input className="field" placeholder="Team (optional)" value={mTeam} onChange={(e) => setMTeam(e.target.value)} />
            <button
              className="primary"
              onClick={() => {
                props.addSwimmer(mName, mTeam);
                setMName("");
                setMTeam("");
                setManual(false);
              }}
            >
              Add swimmer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function About() {
  const [proxy, setProxy] = useState(loadProxy);
  const [adv, setAdv] = useState(false);
  return (
    <div className="card about">
      <h2>About my-swimmer</h2>
      <p>A free, ad-free meet-day companion for swim families. Import a meet's published heat sheet, see all your swimmers' events on one page, the next cut to beat, and fueling tips.</p>

      <a className="primary feedback-btn" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
        💬 Send feedback
      </a>

      <h3>How to use it</h3>
      <ol className="howto">
        <li><strong>Add meet</strong> → paste the meet's heat-sheet PDF link and tap <em>Open link</em> (or use the <em>Upload</em> backup). Meets often post one PDF per session — add each.</li>
        <li><strong>Swimmers</strong> → type a name and tap your swimmer from the live results (it shows team, age &amp; gender so you pick the right one). Repeat for each child.</li>
        <li><strong>Home</strong> → all your swimmers' events appear grouped by day, with the next SE championship cut and motivational cut for each.</li>
        <li>Tap <strong>Cards / Arm table</strong> to switch views. The arm table is the compact lineup to copy onto an arm; use the <em>PB</em>/<em>Cut</em> column toggles to add detail.</li>
        <li>After a race, tap <strong>“add the time they swam”</strong> on that event to log it — the cuts update instantly so you can see if they made it.</li>
        <li><strong>Theme</strong> — use the Auto / Light / Dark button at the top right.</li>
      </ol>
      <p className="muted small">Age &amp; gender come from the most recent heat sheet you import, and decide which time standards apply — so import the latest sheet for the truest times.</p>

      <h3>Your privacy</h3>
      <p>Everything runs on your device. Your swimmers' names and meet data are stored only in this browser and are never uploaded to a server. Clearing your browser data removes them.</p>

      <h3>Please double-check</h3>
      <p>Events are auto-read from PDF heat sheets, which isn't perfect. Always verify event, heat, and lane against the official posted heat sheet before a race.</p>

      <h3>Not affiliated</h3>
      <p className="muted">Not affiliated with or endorsed by USA Swimming, Meet Mobile, or any meet host. It simply reads heat sheets you provide. Time standards are USA Swimming 2024–2028 motivational standards plus Southeastern championship cuts.</p>
      <p className="muted">Made by a swim parent. Feedback welcome.</p>

      <button className="inline-link" onClick={() => setAdv(!adv)} style={{ marginTop: 12 }}>
        {adv ? "– hide advanced" : "Advanced"}
      </button>
      {adv && (
        <div className="manual">
          <p className="muted small">
            Custom fetch helper for “paste a link” (optional; only if you self-host one). Use{" "}
            <code>{"{url}"}</code> for the link.
          </p>
          <input className="field" placeholder="https://you.workers.dev/?url={url}" value={proxy} onChange={(e) => setProxy(e.target.value)} />
          <button className="primary" onClick={() => saveProxy(proxy)}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}
