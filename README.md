# Heat Guardian 🏊🛡️

An **ad-free meet-day companion** for swim families. Add your swimmers once, import a meet's heat
sheet (or follow live results), and see every kid's events on one calm page — heats, lanes, the
next time cut to chase, and fueling — sectioned by day.

### 📱 iOS (TestFlight) · Android (Play testing) · Web: https://chesler410.github.io/heat-guardian/ · Demo: [?demo](https://chesler410.github.io/heat-guardian/?demo)

It's *not* another stats database (SwimCloud already does history). It's built for the cold pool
deck at 6am: "what's my kid swimming, when, what do they need to beat, and when do they eat."
Increasingly it's a **live layer** too — live results as they post, team sharing by code, and an
optional swimmer-facing mode with encouraging AI post-meet feedback.

## What it does

- **The whole family on one page** — add multiple swimmers, grouped by **session/date**; the
  selected swimmer's **name + team** label the screen
- **Three roles** — a first-run prompt picks **Parent**, **Coach**, or **Swimmer / "My Meet"**
  (saved on-device). Parents track their kids; **coaches pick a team** and see every swimmer on it;
  **swimmers** manage their own meet — pick themselves, highlight **friends**, and reflect on each
  swim ("how did it feel?")
- **✨ AI post-meet feedback** *(swimmer mode)* — turns a swimmer's own reflections + times into
  warm, encouraging, age-appropriate feedback. COPPA-minimized: only swim context + their notes are
  sent (never name/team), through a server-side proxy that holds the API key
- **Per event:** heat, lane, seed (best), the **next motivational cut** (+delta, ≈ per length),
  and the **🏆 Southeastern championship cut** (qualified ✓ or how much to drop)
- **Calm two-tab layout** — **Home** and **Swimmers**, with Add-meet, theme, language, and
  About tucked behind a **⚙ Settings** gear so meet day stays uncluttered
- **One Swimmers hub** — your **My swimmers** and your **Watch list** in one place; find a
  swimmer by **search** *or* by **browsing teams**, then add as yours or to watch
- **Per-swimmer Progress** — best time per event across every meet (with the **improvement drop**
  and cut level reached), folded right into Home
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
- **Share a meet — by code or link.** **`#️⃣ Code`** uploads the parsed meet to the backend cache
  and gives a short share code; a teammate types it under *Add a meet* and gets the whole meet (one
  person parses the big PDF once — phones skip it). **`🔗 Link`** shares the public source URL.
  Sharing in **coach mode** adds your team so the recipient gets a one-tap "Coach this team" setup.
- **Meet packs** — the **`📤`** button also saves a meet as a small `.heatguardian.json` file
  (entries + logged times) for the team chat — no re-parsing on import
- **No duplicate meets** — re-importing a heat sheet you already have is skipped, not stored twice
- **8 languages** (EN/ES/ZH/PT/DE/VI/FR/RU — full parity), **light/dark theme**, **team logo**
  (auto-derives a brand color), responsive desktop layout, installable

## How to use

1. **Pick your role** the first time — Parent or Coach (changeable anytime in Settings).
2. **Add a meet** — open **⚙ Settings → Add a meet**: pick one from "Find a meet near you," or
   upload the heat-sheet PDF(s) / `.sd3` file / a teammate's `.heatguardian.json` meet pack, or paste
   a direct PDF link. (Saved a sheet from a team email? Tap Upload and look under "Recents." To
   follow live, paste the results link under Live results.)
3. **Swimmers** (parents) → find your kids by **search** or by **browsing teams**, then add them as
   yours or to your **Watch list** (both live on this one screen); or, as a **coach**, pick your team.
4. **Home** → everyone's events, by date, with cuts and fueling. Toggle **Cards / Arm table**, and
   expand **📈 Progress** for each swimmer's best time per event over time.

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
- `proxy/` — the Cloudflare Worker backend: a CORS fetch proxy for "paste a link", an R2-backed
  shared-meet cache (`/meet` — the share-by-code feature), and a server-side AI-feedback proxy
  (`/feedback` — holds the Anthropic key so it never ships in the app).
- `docs/` — decisions, data-source research, parsing notes, roadmap.

## Develop

```bash
npm install
npm run dev      # local dev
npm run build    # production build (CI sets APP_BASE=/heat-guardian/ for GitHub Pages)
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

Live and in active use by swim families, iterating on their feedback. The **native (app-store)
build runs fully offline** via a precaching service worker; the **web build** keeps a
self-destroying worker (offline off) to avoid stale-cache issues from rapid releases. Either
way, an in-app **"new version — refresh"** banner covers updates.

**Where it's headed** — turning this into a shared tool for the whole swim community: richer
Hy-Tek imports (HY3/CL2 with per-length splits), accounts + cloud sync, cloud-shared team pages,
and a native app. See [`docs/roadmap.md`](docs/roadmap.md).

**Shipping to the app stores:** step-by-step owner checklist in
[`docs/ship-checklist.md`](docs/ship-checklist.md) (Capacitor + reused Apple CI; no Mac needed).

E2E/parser tests live in `scripts/` (`test_sdif.mjs`, `e2e_*.mjs`) and run against a built
`dist/` with Edge/Chromium via puppeteer-core.
