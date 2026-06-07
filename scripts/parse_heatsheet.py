#!/usr/bin/env python3
"""Hy-Tek heat-sheet parser using word coordinates (PyMuPDF).

Heat sheets are laid out in N fixed columns per page. We read every word with its
(x,y) position, detect column left-edges from the "#<event>" headers, bucket each
word into a column by x, rebuild reading-order lines per column, then parse
events -> heats -> lane entries. Coordinate bucketing is robust to seed times that
visually spill toward the next column (which broke character-offset slicing).

Usage: python parse_heatsheet.py <heatsheet.pdf> [swimmer surname]
"""
import re
import sys
import fitz  # PyMuPDF

HEADER_RE = re.compile(r"^#(\d+)\s+(.+?)\s*$")
HEAT_RE = re.compile(r"Heat\s+(\d+)\s+of\s+(\d+)\s+(\w+)")
ENTRY_RE = re.compile(
    r"^(\d{1,2})\s+([A-Za-z'.\- ]+?,\s*[A-Za-z'.\-]+(?:\s+[A-Za-z])?)\s+"
    r"(\d{1,2})\s+([A-Z0-9\-]+)\s+([\d:]+\.\d{2}|NT)$"
)


def column_lefts(words):
    """Detect column left-edges from the repeated 'Lane' column header.

    Every heat-sheet column starts with a 'Lane Name Age Team Seed Time' row, so
    the x of each 'Lane' token marks a column's left edge. This is far more stable
    than '#<event>' tokens, and naturally ignores non-table pages (no 'Lane').

    We require the 'Lane' token to be immediately followed by 'Name' on the same
    row, so a swimmer whose *name* contains 'Lane' doesn't create a false column."""
    names_by_row = {}
    for x0, y0, x1, y1, txt, *_ in words:
        names_by_row.setdefault(round(y0 / 3), []).append((x0, txt))
    xs = []
    for x0, y0, x1, y1, txt, *_ in words:
        if txt != "Lane":
            continue
        row = names_by_row.get(round(y0 / 3), [])
        if any(txt2 == "Name" and 0 < x2 - x0 < 60 for x2, txt2 in row):
            xs.append(x0)
    xs.sort()
    if not xs:
        return []
    lefts = []
    for x in xs:
        if not lefts or x - lefts[-1] > 40:   # new column if >40pt gap
            lefts.append(x)
    return lefts


def assign_column(x, lefts):
    col = 0
    for i, lx in enumerate(lefts):
        if x >= lx - 5:
            col = i
    return col


def lines_for_column(words, col, lefts):
    bounds = lefts + [10**9]
    lo, hi = bounds[col] - 5, bounds[col + 1] - 5
    sel = [w for w in words if lo <= w[0] < hi]
    sel.sort(key=lambda w: (round(w[1] / 3), w[0]))
    lines, cur, cur_y = [], [], None
    for x0, y0, x1, y1, txt, *_ in sel:
        if cur_y is None or abs(y0 - cur_y) <= 3:
            cur.append(txt)
            cur_y = y0 if cur_y is None else cur_y
        else:
            lines.append(" ".join(cur))
            cur, cur_y = [txt], y0
    if cur:
        lines.append(" ".join(cur))
    return lines


def parse_lines(lines, events):
    cur_event = cur_desc = cur_heat = None
    for line in lines:
        line = line.strip()
        if not line:
            continue
        h = HEADER_RE.match(line)
        if h:
            cur_event, cur_desc, cur_heat = h.group(1), h.group(2).strip(), None
            continue
        hm = HEAT_RE.search(line)
        if hm:
            cur_heat = f"Heat {hm.group(1)} of {hm.group(2)} {hm.group(3)}"
            continue
        e = ENTRY_RE.match(line)
        if e and cur_event:
            lane, name, age, team, seed = e.groups()
            events.append({
                "event": int(cur_event), "desc": cur_desc, "heat": cur_heat,
                "lane": int(lane), "name": name.strip(), "age": age,
                "team": team, "seed": seed,
            })


def main():
    pdf, surname = sys.argv[1], (sys.argv[2].lower() if len(sys.argv) > 2 else None)
    doc = fitz.open(pdf)
    events = []
    # Hy-Tek flows column-major (newspaper style): an event can start at the bottom
    # of one column and continue at the top of the next. So we stitch every column,
    # in reading order across all pages, into ONE stream and parse it once, letting
    # event/heat context carry across column and page breaks.
    ordered = []
    maxcols = 0
    for page in doc:
        words = page.get_text("words")
        if not words:
            continue
        lefts = column_lefts(words)
        maxcols = max(maxcols, len(lefts))
        for col in range(len(lefts)):
            ordered.extend(lines_for_column(words, col, lefts))
    parse_lines(ordered, events)

    print(f"# up to {maxcols} columns/page; {len(events)} total entries\n",
          file=sys.stderr)
    if surname:
        events = [e for e in events if surname in e["name"].lower()]
    events.sort(key=lambda e: (e["event"], e["heat"] or "", e["lane"]))
    for e in events:
        print(f"Event #{e['event']:<3} {e['desc']}")
        print(f"    {e['heat'] or '(heat n/a)'}  |  Lane {e['lane']}  |  "
              f"{e['name']} ({e['age']}, {e['team']})  seed {e['seed']}")
    print(f"\n# {len(events)} entries for "
          f"{surname or 'everyone'}", file=sys.stderr)


if __name__ == "__main__":
    main()
