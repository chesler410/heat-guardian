# Bridging the gap — from "import app" to the live layer for swim meets

*Heat Guardian's north star. Built for the people: free, family-first, community-owned.*

## The problem, stated honestly

Swim timing is a near-monopoly. **Hy-Tek Meet Manager** (now Active Network) generates complete,
real-time results at the pool deck of every sanctioned meet. Every "platform" you've heard of —
**Meet Mobile, SwimCloud, TeamUnify/GoMotion, Swimmingly** — simply *ingests and displays* that
data behind a closed wall. None expose a public API to pull results out. USA Swimming's **SWIMS**
is the system of record but locked (membership/vendor API only — no meets, times, or results,
verified June 2026). It is a genuinely backwards corner of sports tech.

**The reframe that unlocks everything:** the data already *exists* — the host generates it live at
every meet. The gap is not *existence*, it's **distribution**. Nobody exposes it. That gap is
exactly why there is room for Heat Guardian. So the goal is not "find the API that doesn't exist."
The goal is **bridge the distribution gap ourselves** and become the *live layer* — not another
download/import/upload app.

## The principle

> A meet in Heat Guardian is **one live, shared object**, fed by whichever source is available.
> Importing a PDF is the **cold-start / offline fallback** — never our identity.

## The three bridges (priority cascade)

When a parent opens a meet, the app uses the best source available, in this order:

1. **Host's Hy-Tek "Real-Time Results to the Web" feed** — *lowest friction, real now.*
   Many hosts already publish a public URL that Meet Manager pushes each race to. We already poll
   it; the missing piece is a **flat-HTML parser** for that page (today we parse only the PDF
   variant). Zero host cooperation needed for meets that publish it. Genuine live results.

2. **A host-side bridge (how Meet Mobile actually works).** Meet Mobile isn't magic — the host
   runs Meet Manager + Active's uploader that watches the results folder and pushes to Active's
   cloud. **We build an open version:** a tiny desktop helper the timing table runs that reads
   Meet Manager's real-time export and pushes to *our* cloud. Then **every parent at that meet
   gets live results in-app, no import, ever.** Needs host adoption — and that's the moat: if a
   host runs *our* bridge, we're the live layer, not an import tool. **Our LSC's meets are the
   beachhead.**

3. **Crowd-sourced live entry (universal fallback, and genuinely novel).** When there's no feed
   and no bridge, *the people are the sensor* — attendees already see the times. We already have
   manual entry; make a meet a **shared live document** where attendees collectively enter results,
   aggregated in real time. "First person to see the 50 Free shares it → the whole meet has it."
   No API required, ever. No incumbent does this.

## The north star: the shared live meet

All three bridges flow into **one shared meet object** (keyed by the meet). Whoever has the best
source feeds it; everyone at the meet reads it live. Personalized on each device (your swimmer's
cuts/PBs light up), shared at the core. Import-a-PDF becomes the fallback it should be.

## Phased plan

- **Phase 0 — today (shipped).** Local-first import (heat sheets, results, SD3, packs), per-meet
  share links + meet packs, a curated **meet directory** with "view results ↗" links, live-results
  polling of public PDF URLs, the meet-lifecycle archive. Import works offline, always.
- **Phase 1 — the live parser.** Flat-HTML parser for Hy-Tek real-time results pages → real live
  results from any host that publishes one. Self-contained; no backend. *(Bridge #1.)*
- **Phase 2 — the shared meet cache (Cloudflare R2 behind the existing Worker).** One person
  imports/parses → the small parsed pack is cached per-meet; everyone else at that meet pulls the
  lightweight JSON (also fixes big-PDF parsing on phones). This is the substrate for crowd + bridge.
  *(Enables #3; COPPA-designed — see guardrails.)*
- **Phase 3 — crowd-sourced live entry.** Attendees co-edit the shared meet's live results; merge +
  conflict resolution; "live" badge. *(Bridge #3.)*
- **Phase 4 — the host bridge.** Open desktop uploader: watch Meet Manager's export folder → push
  to the shared meet. Adopt one host (our LSC) → prove the loop. *(Bridge #2 — the moat.)*
- **Phase 5 — ecosystem.** Notifications ("you're up in ~N events"), team rosters, coach publish,
  and outreach to modern cloud-timing entrants (Swimmingly et al.) as potential rails/partners.

## Guardrails (non-negotiable)

- **COPPA / minors' privacy is the gating concern** for anything that leaves the device. The shared
  cache holds *already-public* heat-sheet/results data (lower risk than collecting new PII), but it
  must be designed for it from day one: disclosed in the privacy policy, **auto-purged shortly after
  the meet**, accountless where possible, minimal fields.
- **Stay ToS-clean.** We consume the **host's** public publications and links we're given — we do
  **not** scrape closed apps (Meet Mobile's private feed, SwimCloud's pages). Linking *to* them is
  fine; ingesting their data is not.
- **For the people.** Free core, ad-free, never sell data. Sustainability via tips / club
  sponsorship / optional cloud — never a paywall on a stressed parent at 6am.

## What we will NOT do

- Scrape Meet Mobile / SwimCloud / Active's private feeds (ToS + brittle + store-review risk).
- Store more about a child than the public heat sheet already does.
- Become a closed wall ourselves. The whole point is to open the gap, not move it.

---

*The incumbents being asleep on tech isn't the obstacle — it's the opening. We're not late. We're
early. Build the live layer, for the people.*
