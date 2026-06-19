# Decision log

Newest first. Each entry: what we decided, and why.

## 2026-06-06 — Initial scope & architecture

- **Product = meet-day companion, not analytics.** The wedge is live pool-deck use
  (schedule, next cut, next ranking time, fueling), not historical stats — myswimio /
  SwimCloud already own history.
- **Platform: PWA.** One codebase across phones/desktop, installs to home screen,
  works offline. Best fit for flaky pool-deck wifi without app-store friction.
- **Primary user: parent.** Multi-swimmer timeline matters (siblings in one meet).
- **Data backbone = uploaded PDFs.** Heat sheet + psych sheet. Works for any meet and
  any timing vendor, fully offline, zero ToS risk. This is the resilient core.
- **Enrichment = USA Swimming Data Hub.** Once we know the swimmer, pull full PB history
  + official time standards. The only legit "marry the data" source (official, no scraping).
- **No dependence on private/competitor APIs.** Meet Mobile / SwimCloud have no usable
  public results API; scraping is brittle and ToS-risky. See `data-sources.md`.
- **PDF parser approach: deferred** until we review 2-3 real heat sheets from different
  meets. Choice is local text-extraction (pdf.js) vs. LLM-assisted structuring.

## Open questions

- Exact USA Swimming Data Hub times endpoint (needs a swimmer name or a network capture).
- Hydration/snack model — generic heuristics vs. configurable per swimmer.
- Product name (repo is `Heat Guardian`; product name TBD).
- Tech stack specifics (likely Vite + React + TS PWA; confirm after parser decision).
