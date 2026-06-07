import { useState } from "react";
import type { MeetDay, SwimEvent } from "./types.ts";
import day from "./day.json";

const data = day as MeetDay;

function displayName(n: string | null): string {
  if (!n) return "Swimmer";
  const [last, first] = n.split(",").map((s) => s.trim());
  return first ? `${first} ${last}` : last;
}

function Disclaimer() {
  const [hidden, setHidden] = useState(
    () => localStorage.getItem("dismiss-disclaimer") === "1"
  );
  if (hidden) return null;
  return (
    <div className="disclaimer">
      <span>
        ⚠️ These details were auto-read from the meet's PDF heat sheet. PDF reading
        isn't perfect — <strong>always double-check against the official sheet</strong>{" "}
        before relying on a time, heat, or lane.
      </span>
      <button
        onClick={() => {
          localStorage.setItem("dismiss-disclaimer", "1");
          setHidden(true);
        }}
        aria-label="Dismiss"
      >
        Got it
      </button>
    </div>
  );
}

function Fueling() {
  return (
    <section className="card fuel">
      <h2>💧 Fueling &amp; hydration</h2>
      <ul>
        <li>Sip water steadily all session — don't wait until thirsty.</li>
        <li>
          Light carb snack <strong>~60–90 min before the first race</strong> (banana,
          toast, granola bar).
        </li>
        <li>Between races more than ~45 min apart: small snack + a few sips.</li>
        <li>Avoid heavy or new foods within ~45 min of a race.</li>
        <li>Warm/ready ~20–30 min before each event is called.</li>
      </ul>
      <p className="muted">
        Timing sharpens once session start times are added — this is general guidance
        for now.
      </p>
    </section>
  );
}

function levelClass(lvl?: string | null) {
  return "lvl lvl-" + (lvl ? lvl.toLowerCase() : "none");
}

function EventCard({ e }: { e: SwimEvent }) {
  const close = e.nextCut && e.nextCut.needed <= 1.0;
  return (
    <div className={"card event" + (close ? " close" : "")}>
      <div className="ev-top">
        <span className="ev-num">#{e.event}</span>
        <span className="ev-race">{e.race}</span>
        {e.achieved && <span className={levelClass(e.achieved)}>{e.achieved}</span>}
      </div>
      <div className="ev-meta">
        <span>{e.heat ?? "Heat TBD"}</span>
        <span className="lane">Lane {e.lane}</span>
        <span>
          Best <strong>{e.seed}</strong>
        </span>
      </div>
      {e.nextCut ? (
        <div className="cut">
          <span>
            Next cut → <strong>{e.nextCut.level}</strong> {e.nextCut.time}
          </span>
          <span className={"need" + (close ? " need-close" : "")}>
            drop {e.nextCut.needed.toFixed(2)}s{close ? " — so close! 🔥" : ""}
          </span>
        </div>
      ) : (
        <div className="cut muted">Top standard reached 🏆</div>
      )}
    </div>
  );
}

function SwimmerName() {
  const fallback = displayName(data.swimmer.name);
  const [name, setName] = useState(
    () => localStorage.getItem("swimmerName") || ""
  );
  const [editing, setEditing] = useState(false);
  const shown = name || fallback;

  function save(v: string) {
    const clean = v.trim();
    setName(clean);
    localStorage.setItem("swimmerName", clean);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        className="name-input"
        autoFocus
        defaultValue={name}
        placeholder="Swimmer's name"
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    );
  }
  return (
    <button className="name-btn" onClick={() => setEditing(true)}>
      {shown} <span className="edit" aria-label="Edit name">✎</span>
    </button>
  );
}

export function App() {
  const events = [...data.events].sort((a, b) => a.event - b.event);
  const closest = [...events]
    .filter((e) => e.nextCut)
    .sort((a, b) => (a.nextCut!.needed - b.nextCut!.needed))
    .slice(0, 3);

  return (
    <div className="app">
      <header>
        <h1>🏊 <SwimmerName /></h1>
        <div className="sub">
          {data.swimmer.age} &middot; {data.swimmer.team} &middot; {data.course}
        </div>
        <div className="meet">{data.meet}</div>
      </header>

      <Disclaimer />

      {closest.length > 0 && (
        <section className="card highlight">
          <h2>🎯 Closest to a new cut</h2>
          {closest.map((e) => (
            <div className="hl-row" key={e.event}>
              <span>{e.race}</span>
              <span className="hl-need">
                {e.nextCut!.level} in {e.nextCut!.needed.toFixed(2)}s
              </span>
            </div>
          ))}
        </section>
      )}

      <Fueling />

      <h2 className="section-title">Events ({events.length})</h2>
      {events.map((e) => (
        <EventCard key={e.event} e={e} />
      ))}

      <footer>
        <div className="muted">
          Standards: {data.standardsSet}. Seed time is treated as the swimmer's current best.
        </div>
      </footer>
    </div>
  );
}
