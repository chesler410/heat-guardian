# Heat Guardian — roadmap & future plans

**Vision:** make meet day calm for every swim family — and grow from a personal, on-device
tool into a *shared* tool for the whole swim community (families, teams, and coaches),
without losing the things that make it good today: free, fast, private, ad-free.

---

## Where it is today (shipped)

A local-first PWA (React/TS, in-browser pdf.js parsing, data on-device):
- **Calm two-tab layout** — **Home** (meet-day timeline + each swimmer's Progress folded in) and
  **Swimmers** (a single people hub: My swimmers + Watch list, find a swimmer by search *or* by
  team). Add-meet, appearance (theme + language), the taunt easter-egg setting, and About all
  live behind a **⚙ Settings** gear, out of the way.
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

- **"Share to Heat Guardian" (native share target)** — the real fix for *"find the file a parent got
  in an email/text."* Instead of hunting Files/Downloads, a parent opens the PDF in Mail / Files /
  Drive / their team chat, taps the OS **Share** sheet, and picks **Heat Guardian** → it imports.
  Covers email, Drive, and team chat in one capability (and beats a Google-Drive OAuth integration,
  which would add accounts/COPPA surface this app avoids). *Needs native work in the Capacitor wrap:
  an **iOS Share Extension** (declare a PDF/`public.data` activation rule, hand the file to the web
  layer) and an **Android intent-filter** (`ACTION_SEND` / `ACTION_VIEW` for `application/pdf`, read
  the `content://` URI). Until then, the in-app upload + the new "where's my file?" hint cover it.*
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

     **🧭 Breadcrumb — "how does Meet Mobile get results electronically?"** The honest answer
     (verified June 2026): it doesn't have a secret pipe. Meet Manager **uploads** results to
     Active's servers over a private, authenticated meet-host channel — there is **no public API
     and no read endpoint** to subscribe to. The *same data* a host can also publish openly is the
     Hy-Tek real-time page above. So the realistic expansions, in order, are: **(a)** a **flat-HTML
     parser** for the real-time results page (we only parse the PDF variant today — needs one
     sample page to lock the column layout); **(b)** **HY3 ingestion** (the host's own results file,
     splits included); **(c)** if a meet host is willing, they can point us at their published
     real-time URL and our poller already overlays it live. What we will **not** do: scrape Meet
     Mobile's private feed (ToS + brittle). If a sanctioned results API ever appears (it doesn't
     today — SWIMS 3.0 is membership-only), this poller is where it would plug in.
  2. **Results PDFs** posted during/after the meet — same parser, manual or live.
- **On-deck manual entry** remains the always-works fallback (and feeds splits).
- **Discovery ("meets near me")** has **no clean public API** — and SWIMS 3.0 does NOT provide one
  (its third-party API is *membership/registration only*: getMemberDetails / getVendorClubs /
  registration-link + member-lifecycle events; **no meets, times, or results**, confirmed against
  thirdparty-api-documentation.swimsmember.org). So the vendor program does **not** unlock this.
  Shipped instead: a **community meet directory** (bundled `src/meets.json`, refreshed from the
  repo at runtime, filter by state + geolocation "near me") on the Add-meet screen — zero backend,
  grows by PR/feedback. Next: seed more LSCs; optional opt-in crowd submissions.
- **USA Swimming Data Hub** (historical times/rankings) is still **Sisense-locked** for scraping;
  the SWIMS API is the sanctioned route to that data.

## Native app

Already a PWA. To reach the app stores: wrap with **Capacitor** (same codebase → iOS/Android
shells), enabling store listings, reliable offline, and true push. Mostly packaging + assets +
a privacy policy; the core carries over directly. **iOS needs no Mac** — reuse the macOS-runner
TestFlight CI + App Store Connect API key already proven in the sibling `health-rpg` repo
(account-level secrets are reusable). Full step-by-step in [`docs/appify.md`](appify.md);
privacy policy ready in [`docs/privacy.md`](privacy.md).

## Sustainability (stay free for families)

- **Free + optional tip jar** to start.
- **Club/team sponsorship** (B2B) is the cleaner revenue path than charging parents.
- **Freemium** later (cloud sync / premium standards) — only once the free tier is loved.

## Get involved

Feedback drives this — in-app **💬 Send feedback** (Google Form) → triaged into GitHub issues.
Native-speaker translation fixes and standards PDFs for other LSCs are especially welcome.
