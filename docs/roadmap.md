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
- [ ] NEXT: in-browser PDF upload (pdf.js port of the parser) so any meet works
- [ ] NEXT: swimmer picker + multi-swimmer (siblings)

## Phase 3 — Fueling
- [ ] Hydration/snack timing woven around the schedule
- [ ] Configurable per swimmer

## Phase 4 — Pool-deck polish
- [ ] "You're up in ~N events" countdown; "mark heat done"
- [ ] Relay alerts (easy to miss)
- [ ] Travel/arrival math (leave-by time)
- [ ] Offline-first / installable PWA hardening
- [ ] Post-meet: auto-detect new PBs + cuts achieved → shareable card

## Ideas parking lot
(Add freely — more coming from the user.)
