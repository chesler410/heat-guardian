# my-swimmer

A **meet-day companion** for swim parents. Upload a meet's heat sheet (and psych sheet)
PDF, pick your swimmer(s), and get a clean personal timeline for the day:

- **Your swimmer's events only** — event #, heat, lane, seed time, approx. session time
- **Personal best (PB)** per event
- **The next cut to beat** — just the next rung up the ladder, not the whole chart
- **The next ranking time to beat** — same idea, the next tier only
- **Hydration & snack timing** woven around the event schedule

It is *not* another analytics database. myswimio and SwimCloud already do history and stats.
This is built for the cold pool deck at 6am: phone in hand, flaky wifi, "what's my kid
swimming, when, what do they need to beat, and when do they eat."

## Status

Early planning. See [`docs/`](docs/) for decisions, data-source research, and roadmap.

## Key decisions so far

- **Platform:** Installable web app (PWA) — one codebase, offline-capable, no app-store friction
- **Primary user:** Parent of one or more swimmers
- **Data backbone:** Uploaded PDFs (works at any meet, any timing vendor, offline, no ToS risk)
- **Enrichment:** USA Swimming Data Hub for historical PBs + official time standards
- **PDF parser approach:** TBD — decided after reviewing real example heat sheets

## Privacy

Heat sheets contain minors' names and times. **Real meet PDFs are git-ignored** and must
never be committed. See [`samples/README.md`](samples/README.md).
