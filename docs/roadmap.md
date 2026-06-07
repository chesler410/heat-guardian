# Roadmap

A rough phasing. Order matters: prove the risky part (PDF parsing) before polish.

## Phase 0 — Foundations (now)
- [x] Project folder + repo + decision log + data-source research
- [ ] Collect 2-3 real heat sheets + a psych sheet from different meets
- [ ] Decide PDF parser approach from real samples

## Phase 1 — Parse & show "my swimmer's day" (the core risk)
- [x] Prototype parser: extract a swimmer's events (event #, desc, heat, lane, seed)
      — validated on 2 real meets (one LCM, one SCY). See `docs/parsing.md`.
- [ ] Handle relays (swimmers listed as legs, different layout)
- [ ] Multi-PDF ingest: meets that split by session post several PDFs → merge to one meet
- [ ] Upload UI for heat sheet PDF(s)
- [ ] **Disclaimer + review/edit step** — parsing is fuzzy; always prompt user to verify
- [ ] Render a clean per-swimmer timeline for the day
- [ ] Multi-swimmer merge (siblings in one timeline)

## Phase 2 — Cuts, PBs, rankings (the enrichment)
- [x] Load official time standards (USA Swimming 2024-2028, Girls 10&U LCM)
- [x] Per event: show PB (seed) + the *next* motivational cut to beat (delta)
- [ ] More age groups / courses (SCY) + boys standards
- [ ] Championship cuts (Sectionals/Futures/JNats), not just motivational
- [ ] Next *ranking* time to beat (separate from cuts)
- [ ] USA Swimming Data Hub for full PB history — BLOCKED: built on Sisense (JAQL,
      auth-token gated), no clean GET. Seed-as-PB covers entered events for now.

## Phase 4.5 — Shipped milestone (2026-06-07)
- [x] Installable PWA live at https://chesler410.github.io/my-swimmer/ (repo public)
- [x] Renders a real meet (sample data): schedule, cuts, closest-to-cut, fueling, disclaimer
- [x] Editable swimmer name (saved locally; repo ships generic sample data)
- [x] "Arm table" view (user request): by-day compact table with abbreviations
      (Ev/Swim/Ht/Ln) for writing the lineup on a swimmer's arm. Toggle vs Cards.
- [ ] NEXT: in-browser PDF upload (pdf.js port of the parser) so any meet works
- [ ] NEXT: swimmer picker + multi-swimmer (siblings)
- [ ] Day/session mapping from the PDF's session schedule (arm table currently uses
      a sample day split; real meets need the schedule parsed for accurate days + times)

## Phase 3 — Fueling
- [ ] Hydration/snack timing woven around the schedule
- [ ] Configurable per swimmer

## Phase 4 — Pool-deck polish
- [ ] "You're up in ~N events" countdown; "mark heat done"
- [ ] Relay alerts (easy to miss)
- [ ] Travel/arrival math (leave-by time)
- [ ] Offline-first / installable PWA hardening
- [ ] Post-meet: auto-detect new PBs + cuts achieved → shareable card

## Phase 5 — Family hub (the real product; user vision 2026-06-07)
"I'm Dad A with 3 kids — consolidate all my kids' events on one simple page."
- [ ] **Kid profiles** (name, age, team, LSC) stored on device; auto-match in any meet
- [ ] **Multi-swimmer merged timeline** — all 3 kids' events in one view, by day/time
- [ ] **Input: upload PDFs** (in-browser pdf.js parser) — the foundation, build first
- [ ] **Input: link a meet** — paste a gomotion/meet URL → fetch its published heat-sheet
      PDFs. Needs a tiny serverless proxy (browser CORS blocks cross-origin PDF fetch).
- [ ] **Input: search nearby meets → live published data** — AMBITIOUS / UNCERTAIN: no
      clean aggregated "meets near me" API exists (same wall as Data Hub/Meet Mobile).
      Likely needs scraping (ToS care) or USA Swimming meet search (Sisense-gated).
- [ ] **Cross-device sync of kid details** — needs a backend + accounts (cost). Local-only
      first; cloud sync is a separate, bigger step.

## Ideas parking lot
(Add freely — more coming from the user.)
