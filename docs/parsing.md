# Heat-sheet parsing — approach & findings

**Decision: local, coordinate-based parsing. No LLM required for the core extraction.**
Validated against two real, differently-formatted meets (one long-course meters, one
short-course yards) with the same code.

## Why local parsing works

Hy-Tek Meet Manager heat sheets are highly regular:
- Fixed multi-column layout (typically 3 columns/page).
- Each column = `Lane Name Age Team Seed Time` table header, then `#<event> <desc>`,
  then `Heat X of Y <round>`, then lane rows: `<lane> <Last, First M> <age> <TEAM> <seed>`.
- Events flow **column-major** (newspaper style): an event can start at the bottom of
  one column and continue at the top of the next.

So coordinate-aware text extraction is enough — we don't need an LLM to read it.
(LLM-assist stays in reserve for exotic formats or as a fallback confidence check.)

## The three problems we hit (and fixed)

1. **Columns interleave on a line.** `pdftotext -layout` puts 3 columns' text on one
   line, mis-associating an entry with a neighboring column's event header.
   → Use word (x,y) coordinates (PyMuPDF) and bucket words into columns by x.

2. **Column-major flow.** Parsing each column in isolation drops entries that continue
   into the next column (no header in their own column).
   → Stitch columns in reading order (col0→col1→col2, across pages) into one stream
     and parse once, carrying event/heat context across column and page breaks.

3. **False columns from data.** A swimmer named "...Lane..." created a spurious column
   anchor, splitting a real column and orphaning headers.
   → Only treat "Lane" as a column header when immediately followed by "Name" (the real
     table header row).

## Current prototype

`scripts/parse_heatsheet.py <heatsheet.pdf> [surname]` — PyMuPDF + regex.
Result: extracted all 10 of one swimmer's events from a 13-page sheet
(event #, description, heat, lane, seed) and 337 entries from a second meet's sheet.

## Known limits / next

- **Relays** parse differently (members listed as legs); not yet handled.
- **Multi-session meets** post several PDFs (e.g. CMSA splits by session) — ingest must
  accept multiple files per meet and merge into one timeline.
- **Prelims/Finals** rounds and "Timed Finals" wording variants need test coverage.
- Approx. wall-clock time per event (for fueling) needs session start times + heat pacing.
- Port to the browser via pdf.js (same coordinate idea) for the offline PWA, OR run the
  Python parser server-side. TBD.

## Reliability principle (per user, 2026-06-06)

PDF scrubbing is fuzzy and will not always be perfect. The app must **always show a
clear disclaimer and prompt the user to double-check parsed results against the official
heat sheet.** Make parsed values easy to review/edit; never present them as authoritative.
Accuracy improves over time, but the verification prompt stays.
