#!/usr/bin/env python3
"""Build / enrich the meet directory (src/meets.json) for Heat Guardian.

This is the "front door" pipeline behind *Find a meet near you*. It takes curated meet
sources (scripts/sources/meet_sources.json — fed by PRs and the in-app Suggest-a-meet
form) and turns them into directory entries the app fetches at runtime — with NO backend
and WITHOUT storing any swimmer data. For each meet it:

  1. CLASSIFIES each candidate PDF link as a heat sheet / results / info packet, so the app
     only offers "Import heat sheet" / "Import results" on a real one (never the meet
     info/entry packet — the exact thing that fails when pasted by hand).
  2. SCRAPES meet metadata (title, dates, city/state, LSC) from the info packet text.
  3. GEOCODES "City, ST" -> lat/lng via OpenStreetMap Nominatim (cached, polite).
  4. MERGES into src/meets.json (additive — never drops a human-curated field).

Public links only -> ToS-safe; nothing about swimmers is read or stored -> COPPA-safe.
Run locally (`python scripts/build_directory.py`) or by .github/workflows/directory.yml
on a schedule + manual dispatch.
"""
from __future__ import annotations
import json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "meets.json"
SOURCES = ROOT / "scripts" / "sources" / "meet_sources.json"
GEOCACHE = ROOT / "scripts" / "sources" / "_geocache.json"
UA = "heat-guardian-directory/1.0 (+https://github.com/chesler410/heat-guardian)"

MONTHS = {m: i for i, m in enumerate(
    ["january","february","march","april","may","june","july","august","september","october","november","december"], 1)}
LSC_NAMES = {"southeastern": "SE", "florida swimming": "FL", "florida gold coast": "FG", "gulf": "GU", "georgia": "GA"}


def fetch(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


ANN_MARKERS = [r"sanction", r"USA Swimming", r"entry fee", r"warm-?up", r"technical rules",
               r"order of events", r"time standards?", r"entries? (close|due|deadline)"]


def classify_pdf(buf: bytes) -> str:
    """heat | results | info | unknown.

    A *seeded* sheet (heat sheet or results) has many Hy-Tek "Heat N of M" headers; an
    announcement/info packet has none (but DOES contain the word "Lane" in prose — pool
    description, rules — so a bare "Lane" check false-positives). So: count heat headers
    first; only then split heat (has a Lane column) vs results; otherwise fall back to the
    announcement markers.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return "unknown"
    doc = fitz.open(stream=buf, filetype="pdf")
    text = "\n".join(p.get_text() for p in doc)
    heat_hdrs = len(re.findall(r"Heat\s+\d+\s+of\s+\d+", text, re.I))
    has_lane = re.search(r"\bLane\b", text) is not None
    has_finals = re.search(r"\bFinals\b", text) is not None
    if heat_hdrs >= 3:
        return "heat" if has_lane else ("results" if has_finals else "heat")
    if sum(bool(re.search(m, text, re.I)) for m in ANN_MARKERS) >= 2:
        return "info"
    if has_finals and not has_lane:
        return "results"
    return "unknown"


def scrape_meta(buf: bytes) -> dict:
    """Pull title, dates, city/state, LSC out of an info-packet PDF (best effort)."""
    out: dict = {}
    try:
        import fitz
    except ImportError:
        return out
    doc = fitz.open(stream=buf, filetype="pdf")
    text = "\n".join(doc[p].get_text() for p in range(min(3, doc.page_count)))
    # Dates: "June 5-7, 2026" / "June 5 - June 7, 2026" / "June 5, 2026"
    m = re.search(r"([A-Z][a-z]+)\s+(\d{1,2})\s*[-–]\s*(?:([A-Z][a-z]+)\s+)?(\d{1,2}),?\s+(\d{4})", text)
    if m:
        mon1 = MONTHS.get(m.group(1).lower()); mon2 = MONTHS.get((m.group(3) or m.group(1)).lower())
        yr = int(m.group(5))
        if mon1: out["start"] = f"{yr:04d}-{mon1:02d}-{int(m.group(2)):02d}"
        if mon2: out["end"] = f"{yr:04d}-{mon2:02d}-{int(m.group(4)):02d}"
    # Location: "City, Florida" / "City, FL"
    loc = re.search(r"\n\s*([A-Z][A-Za-z.\s]+?),\s*(Florida|Alabama|Georgia|Mississippi|Tennessee|[A-Z]{2})\b", text)
    if loc:
        out["city"] = loc.group(1).strip()
        st = loc.group(2)
        out["state"] = st if len(st) == 2 else {"florida":"FL","alabama":"AL","georgia":"GA","mississippi":"MS","tennessee":"TN"}.get(st.lower(), st[:2].upper())
    for name, code in LSC_NAMES.items():
        if re.search(name, text, re.I):
            out["lsc"] = code; break
    return out


def geocode(city: str, state: str, cache: dict) -> tuple | None:
    key = f"{city}, {state}"
    if key in cache:
        return tuple(cache[key]) if cache[key] else None
    try:
        q = urllib.parse.urlencode({"q": key + ", USA", "format": "json", "limit": 1})
        data = json.loads(fetch("https://nominatim.openstreetmap.org/search?" + q, timeout=20))
        time.sleep(1.1)  # Nominatim politeness: <=1 req/sec
        ll = (round(float(data[0]["lat"]), 4), round(float(data[0]["lng" if "lng" in data[0] else "lon"]), 4)) if data else None
    except Exception as e:
        print(f"  geocode failed for {key}: {e}", file=sys.stderr); return None
    cache[key] = list(ll) if ll else None
    return ll


def main() -> int:
    existing = {m["id"]: m for m in json.loads(SRC.read_text(encoding="utf-8"))} if SRC.exists() else {}
    sources = json.loads(SOURCES.read_text(encoding="utf-8")) if SOURCES.exists() else []
    cache = json.loads(GEOCACHE.read_text(encoding="utf-8")) if GEOCACHE.exists() else {}

    for src in sources:
        mid = src["id"]
        entry = dict(existing.get(mid, {}))          # start from any curated entry
        entry["id"] = mid
        for k in ("title", "city", "state", "lsc", "start", "end", "infoUrl", "resultsPageUrl"):
            if src.get(k):                            # explicit source values win
                entry[k] = src[k]
        # Drop any stale labels for URLs we're about to (re)classify, so a link previously
        # mislabeled (e.g. an info packet stored as heatUrl) gets corrected this run.
        for url in src.get("links", []):
            for field in ("heatUrl", "resultsUrl", "infoUrl"):
                if entry.get(field) == url:
                    del entry[field]
        # Classify each candidate link, then scrape metadata from the info packet.
        for url in src.get("links", []):
            try:
                buf = fetch(url)
            except Exception as e:
                print(f"  fetch failed {url}: {e}", file=sys.stderr); continue
            kind = classify_pdf(buf)
            if kind == "heat": entry["heatUrl"] = url
            elif kind == "results": entry["resultsUrl"] = url
            elif kind == "info":
                entry.setdefault("infoUrl", url)
                for k, v in scrape_meta(buf).items():
                    entry.setdefault(k, v)            # don't override curated fields
            print(f"  {mid}: {url.split('/')[-1][:40]} -> {kind}")
        # Geocode if we have a place but no coords yet.
        if entry.get("city") and entry.get("state") and entry.get("lat") is None:
            ll = geocode(entry["city"], entry["state"], cache)
            if ll: entry["lat"], entry["lng"] = ll
        existing[mid] = entry

    out = sorted(existing.values(), key=lambda m: (m.get("start") or "", m.get("title") or ""))
    SRC.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    GEOCACHE.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(out)} meets to {SRC.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
