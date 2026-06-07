#!/usr/bin/env python3
"""Build one swimmer's meet-day JSON: schedule + PB(seed) + next cut to beat.

Combines the heat-sheet parser with the USA Swimming motivational standards to
produce the data the PWA renders. Seed time is treated as the swimmer's current
best (entry times are best times) — shown with a verify-this disclaimer.

Usage: python build_swimmer_day.py <heatsheet.pdf> <surname> <standards.pdf> > day.json
"""
import json
import re
import sys
import importlib.util
import fitz

spec = importlib.util.spec_from_file_location("p", "scripts/parse_heatsheet.py")
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)

LEVELS = ["B", "BB", "A", "AA", "AAA", "AAAA"]  # slow -> fast
STROKE = {"Freestyle": "Free", "Backstroke": "Back", "Breaststroke": "Breast",
          "Butterfly": "Fly", "Individual Medley": "IM"}


def to_sec(t):
    t = t.replace("*", "").strip()
    if ":" in t:
        m, s = t.split(":")
        return int(m) * 60 + float(s)
    return float(t)


def fmt(sec):
    m, s = divmod(sec, 60)
    return f"{int(m)}:{s:05.2f}" if m else f"{s:.2f}"


def standards_girls_10u_lcm(path):
    """Parse the first (10&U) girls block of the LCM standards PDF."""
    toks = [t for t in fitz.open(path)[0].get_text().splitlines() if t.strip()]
    table, seen = {}, set()
    for i, tok in enumerate(toks):
        m = re.search(r"(\d+)\s+(Free|Back|Breast|Fly|IM)\s+L$", tok.strip())
        if not m:
            continue
        key = f"{m.group(1)} {m.group(2)}"
        if key in seen:          # second block = next age group; stop
            break
        seen.add(key)
        girls = [to_sec(toks[i - 6 + k]) for k in range(6)]  # B..AAAA
        table[key] = dict(zip(LEVELS, girls))
    return table


def event_key(desc):
    dm = re.search(r"(\d+)\s+(?:LC Meter|SC Yard|SC Meter)\s+(\w[\w ]*\w)", desc)
    if not dm:
        return None
    dist, stroke = dm.group(1), dm.group(2)
    return f"{dist} {STROKE.get(stroke, stroke)}"


def next_cut(seed_sec, ladder):
    """Return (achieved_level, next_level, next_time_sec, delta) given a ladder."""
    achieved, nxt, nxt_t = None, None, None
    for lvl in LEVELS:                       # slow -> fast
        std = ladder.get(lvl)
        if std is None:
            continue
        if seed_sec <= std:
            achieved = lvl
        elif nxt is None:
            nxt, nxt_t = lvl, std
            break
    # if achieved is top level, no next; if none achieved, next is B
    if nxt is None and achieved != "AAAA":
        for lvl in LEVELS:
            if ladder.get(lvl) and seed_sec > ladder[lvl]:
                nxt, nxt_t = lvl, ladder[lvl]
                break
    delta = (seed_sec - nxt_t) if nxt_t else None
    return achieved, nxt, nxt_t, delta


def main():
    hs, surname, std = sys.argv[1], sys.argv[2], sys.argv[3]
    doc = fitz.open(hs)
    p0 = [l.strip() for l in doc[0].get_text().splitlines() if l.strip()]
    title = next((l for l in p0 if re.search(
        r"invitational|championship|classic|meet|open|cup|sectional", l, re.I)
        and not l.lower().startswith("page")), p0[0] if p0 else "Meet")
    ordered = []
    for page in doc:
        w = page.get_text("words")
        if not w:
            continue
        lefts = P.column_lefts(w)
        for c in range(len(lefts)):
            ordered.extend(P.lines_for_column(w, c, lefts))
    events = []
    P.parse_lines(ordered, events)
    mine = [e for e in events if surname.lower() in e["name"].lower()]
    mine.sort(key=lambda e: e["event"])

    table = standards_girls_10u_lcm(std)
    out_events = []
    for e in mine:
        key = event_key(e["desc"])
        ladder = table.get(key or "", {})
        rec = {"event": e["event"], "race": key or e["desc"], "desc": e["desc"],
               "heat": e["heat"], "lane": e["lane"], "seed": e["seed"]}
        if ladder and e["seed"] != "NT":
            ach, nxt, nxt_t, delta = next_cut(to_sec(e["seed"]), ladder)
            rec["achieved"] = ach
            rec["nextCut"] = {"level": nxt, "time": fmt(nxt_t),
                              "needed": round(delta, 2)} if nxt else None
            rec["ladder"] = {k: fmt(v) for k, v in ladder.items()}
        out_events.append(rec)

    swimmer = mine[0] if mine else {}
    print(json.dumps({
        "meet": title,
        "swimmer": {"name": swimmer.get("name"), "age": swimmer.get("age"),
                    "team": swimmer.get("team")},
        "course": "LCM",
        "standardsSet": "USA Swimming 2024-2028 Motivational (Girls 10&U, LCM)",
        "events": out_events,
    }, indent=2))


if __name__ == "__main__":
    main()
