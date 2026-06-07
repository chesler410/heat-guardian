# my-swimmer 🏊

A free, ad-free **meet-day companion** for swim families. Add your swimmers once, import a
meet's heat sheet, and see all your kids' events on one page — sectioned by date.

### ▶️ Live app: https://chesler410.github.io/my-swimmer/  ·  Demo: [?demo](https://chesler410.github.io/my-swimmer/?demo)

It's *not* another stats database (myswimio / SwimCloud already do history). It's built for
the cold pool deck at 6am: "what's my kid swimming, when, what do they need to beat, and
when do they eat."

## What it does

- **The whole family on one page** — add multiple swimmers, grouped by **session/date**
- **Parent or Coach mode** — a first-run prompt picks your role (saved on-device). Parents track
  their own kids; **coaches pick a team and see every swimmer on it** on the home screen.
- **Per event:** heat, lane, seed (best), the **next motivational cut** (+delta, ≈ per length),
  and the **🏆 Southeastern championship cut** (qualified ✓ or how much to drop)
- **Live roster search** + **Teams** browser — pick swimmers by name or by team; a separate
  **Watching** tab for following teammates/rivals apart from your own kids
- **Per-swimmer Progress** — best time per event across every meet, with the **improvement drop**
  and the cut level reached
- **Per-event private notes** — jot coaching feedback on any event card
- **Relays** included (swimmer shown as a leg, with the team time)
- **Goal & splits** — target splits to hit a goal or a specific cut (even or realistic pacing),
  plus log actual splits and finish times on deck
- **Arm-table view** — compact `Ev · Ht · Ln · Swim` (+ optional PB / Cut / Champ columns) to
  copy onto a swimmer's arm, sectioned by date
- **Timed fueling & hydration** — enter the first-race time for a clock-time plan, between-races
  electrolyte guidance, and **calendar reminders (.ics)**; plus warm-up / stretching / meals
- **Imports**: Hy-Tek heat/psych **PDFs**, **results PDFs** (overlays actual swum times → real
  PBs & cuts), and **SD3 (SDIF)** export files
- **Live results** — paste a meet's public live-results link; while it runs, new times overlay
  onto your swimmers automatically (~1 min refresh), with a LIVE banner and last-updated status
- **Find a meet near you** — a community meet directory on the Add-meet screen: filter by state or
  tap "Near me" (geolocation), then open/import a listed meet. The list is bundled and refreshed
  from the repo, so meets can be added by PR without an app release
- **Share a meet** — a Share button makes a link that imports the meet on a teammate's device in
  one tap (carries the public PDF/results URLs, not your data). Post it in the team chat or site
- **8 languages** (EN/ES/ZH/PT/DE/VI/FR/RU — full parity), **light/dark theme**, **team logo**
  (auto-derives a brand color), responsive desktop layout, installable

## How to use

1. **Pick your role** the first time — Parent or Coach (changeable anytime in About).
2. **Add meet** → pick a meet from "Find a meet near you," or upload the heat-sheet PDF(s) /
   `.sd3` file, or paste a direct PDF link. (To follow live, paste the results link under Live results.)
3. **Swimmers** (parents) → search the meet roster and tap your kids; or, as a **coach**, pick
   your team. Watch teammates/rivals in the **Watching** tab.
4. **Home** → everyone's events, by date, with cuts and fueling. Toggle **Cards / Arm table**.
   **Progress** shows each swimmer's best time per event over time.

## Design & privacy

- **Local-first PWA** — no accounts, no backend. Your swimmers' names and meet data live only
  in your browser and are never uploaded. COPPA-friendly by design.
- **In-browser parsing** — heat/results sheets (Hy-Tek Meet Manager) are parsed on your device
  with pdf.js, and **SD3 (SDIF)** files are parsed directly. Course (LCM/SCY) and age group are
  read from each event.
- **Time standards** are bundled (USA Swimming 2024–2028 motivational, all ages/genders/courses;
  Southeastern championship cuts). Refreshed per season; not a live feed.
- **No live "rankings" API exists** — USA Swimming's data is locked (Sisense), so the heat
  sheet's seed time is used as the best-time proxy. See [`docs/data-sources.md`](docs/data-sources.md).
- Not affiliated with USA Swimming, Meet Mobile, or any meet host.

**Real meet PDFs contain minors' info and are git-ignored — never commit them.**

## Project layout

- `src/` — the PWA (React + TypeScript + Vite). `parser.ts` (pdf.js heat/results parser),
  `sdif.ts` (SD3/SDIF parser), `cuts.ts` (standards + cuts), `store.ts` (local storage +
  roster/progress), `i18n.ts` (8-language strings), `App.tsx` (UI).
- `scripts/` — Python builders for the bundled data: `build_standards.py`,
  `build_se_champs.py` (run when standards change), plus the original PyMuPDF parser.
- `proxy/` — optional Cloudflare Worker so "paste a link" can fetch host-blocked PDFs.
- `docs/` — decisions, data-source research, parsing notes, roadmap.

## Develop

```bash
npm install
npm run dev      # local dev
npm run build    # production build (CI sets APP_BASE=/my-swimmer/ for GitHub Pages)
```

Deploys to GitHub Pages on push to `main` via `.github/workflows/deploy.yml`.

### Add a meet to the directory

Append an entry to [`src/meets.json`](src/meets.json) and open a PR — it appears in
"Find a meet near you" for everyone (the app refreshes the list from `main` at runtime):

```json
{ "id": "unique-slug", "title": "2026 Spring Invitational", "city": "Pensacola",
  "state": "FL", "lsc": "SE", "start": "2026-06-05", "end": "2026-06-07",
  "lat": 30.42, "lng": -87.22,
  "heatUrl": "https://…/heatsheet.pdf", "resultsUrl": "https://…/results.pdf",
  "infoUrl": "https://…/meet-page" }
```

`heatUrl`/`resultsUrl` are optional (give a one-tap import / Go-live when present); `infoUrl`
is the public meet page. No personal data — just public meet links.

## Status

Live and in active use by swim families, iterating on their feedback. Offline support is
temporarily off (the service worker is self-destroying while we stabilize rapid releases);
an in-app **"new version — refresh"** banner covers updates meanwhile.

**Where it's headed** — turning this into a shared tool for the whole swim community: richer
Hy-Tek imports (HY3/CL2 with per-length splits), accounts + cloud sync, cloud-shared team pages,
and a native app. See [`docs/roadmap.md`](docs/roadmap.md).

E2E/parser tests live in `scripts/` (`test_sdif.mjs`, `e2e_*.mjs`) and run against a built
`dist/` with Edge/Chromium via puppeteer-core.
