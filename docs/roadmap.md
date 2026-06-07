# my-swimmer — roadmap & future plans

**Vision:** make meet day calm for every swim family — and grow from a personal, on-device
tool into a *shared* tool for the whole swim community (families, teams, and coaches),
without losing the things that make it good today: free, fast, private, ad-free.

---

## Where it is today (shipped)

A local-first PWA (React/TS, in-browser pdf.js parsing, data on-device):
- Multi-swimmer **family hub**; separate **My swimmers** / **Watching** tabs; **Teams** browser
- Per-event **motivational cut** (+ per-length breakdown) and **Southeastern championship cut**
- **Goal & splits** (even/realistic) + on-deck split & finish-time logging; **relays**
- **Arm-table** view (PB/Cut/Champ columns); by-date sections; cards/table
- **Per-event private notes**; **per-swimmer Progress** (best time per event across all meets + improvement)
- **Parent / Coach mode** (on-device): first-run role prompt; a coach picks a team and their home
  screen shows every swimmer on it (the multi-device/cloud version is the backend step below)
- **Imports**: Hy-Tek heat/psych **PDFs**, **results PDFs** (overlay actual times), and **SD3 (SDIF)** files
- **Live results** (auto-refresh): poll a public results URL every minute; new times overlay onto
  your swimmers automatically, with a LIVE banner + last-updated status
- **Timed fueling** + between-races electrolyte guidance + **.ics reminders**; warm-up/stretch/meals
- **8 languages**, light/dark theme, **team logo** (auto-derives a brand color), responsive desktop, refresh banner
- Bundled standards (USA Swimming 2024–2028 motivational, all ages/genders/courses; SE champ)

## Near-term (no backend needed)

- **HY3 / CL2 import** — the richer Hy-Tek formats (HY3 has full results + splits; CL2 entries).
  SD3 (SDIF) already lands; HY3 adds per-length splits and is the next file target.
  *(Needs a real .sd3 to certify SDIF column offsets, and a sample .hy3 to start HY3.)*
- **Re-enable offline** — bring back a proper service worker (precaching) now that the
  blank-page/cache issues are stable, keeping the refresh banner.
- **Finish translations** — full coverage for FR/RU and the longer About/prep/fuel text; invite
  native-speaker corrections via the feedback form.
- **More standards** — SE winter/SCY champ doc; other LSCs' championship cuts; sectionals/futures/
  junior-national cuts; source from official LSC pages. Sources backed up in `scripts/sources/`.
- **Polish** — add-a-swimmer re-matches existing meets; share/print the arm chart; "up next" countdown.

## The "shared tool" leap (needs accounts + a backend)

This is the step from *personal* to *community*. It introduces a server, so it's a deliberate
crossing — weighed against privacy and cost.

- **Accounts + cloud sync** — set up swimmers once, see them on both parents' phones.
- **Shared team pages & branding** — a team's logo/colors and roster maintained centrally
  (today's logo is per-device on purpose); coaches/managers publish a meet's lineups.
- **Coach / team-admin view (cloud)** — the on-device coach mode already shows a chosen team's
  whole roster; the cloud step adds central roster ownership, relay planning, and heat-sheet
  distribution across coaches/devices.
- **Sharing** — send a swimmer's day or an arm chart to family; group/team links.
- **Notifications** — "you're up in ~N events," fuel reminders as push (needs the SW + opt-in).

### Guardrails for that step
- **COPPA / minors' privacy** is the gating concern: storing children's data on a server triggers
  real obligations (consent, privacy policy, retention). Local-first sidesteps most of it; cloud
  must be designed for it from day one.
- Keep a **free tier**; never sell data; ad-free.

## Data & "real-time" reality  *(researched June 2026)*

- **Meet Mobile (Active Network) & BigFish "Live Results"** — both closed apps, **no public
  results API**. Active's only dev API is "Activity Search" (event *registration*, not results).
  Tapping their private feed would breach ToS and be brittle — out of scope on purpose.
- **The same data is public two ways**, and we use both:
  1. **Hy-Tek "Real-Time Results to the Web"** — a Meet Manager feature that publishes live,
     auto-updating results to a public URL (host presses F12 each race). Our **Live results**
     poller refreshes that URL every minute. *(Today it parses the PDF form; a flat-HTML parser
     is the next add once we have a sample page.)*
  2. **Results PDFs** posted during/after the meet — same parser, manual or live.
- **On-deck manual entry** remains the always-works fallback (and feeds splits).
- **Discovery ("meets near me")** has **no clean public API**. The real unlock is USA Swimming's
  **SWIMS 3.0 vendor API** (real-time member/meet/results data) — but it requires becoming an
  **approved 3rd-party vendor** (application + agreement via usaswimming.org 3rd-party vendor
  resources). Worth pursuing now that the app is real and in use; until approved, discovery is
  manual (saved meet/result URLs, team GoMotion/TeamUnify pages).
- **USA Swimming Data Hub** (historical times/rankings) is still **Sisense-locked** for scraping;
  the SWIMS API is the sanctioned route to that data.

## Native app

Already a PWA. To reach the app stores: wrap with **Capacitor** (same codebase → iOS/Android
shells), enabling store listings, reliable offline, and true push. Mostly packaging + assets +
a privacy policy; the core carries over directly.

## Sustainability (stay free for families)

- **Free + optional tip jar** to start.
- **Club/team sponsorship** (B2B) is the cleaner revenue path than charging parents.
- **Freemium** later (cloud sync / premium standards) — only once the free tier is loved.

## Get involved

Feedback drives this — in-app **💬 Send feedback** (Google Form) → triaged into GitHub issues.
Native-speaker translation fixes and standards PDFs for other LSCs are especially welcome.
