# Bridging the gap — from "import app" to the live layer for swim meets

*Heat Guardian's north star. Built for the people: free, family-first, community-owned.*

> **Status note (2026-06-21):** this used to be a strategy of educated guesses. A working local
> swim coach has now answered our pipeline questionnaire and **confirmed the whole picture**. This
> rewrite reflects what we *know*, not what we hoped. The headline change: the **host bridge** is no
> longer a far-off "Phase 4" — it's the **primary play**, because the open web feed we built a parser
> for only exists at a minority of meets.

## The pipeline, as confirmed by a coach

Every USA Swimming meet our coach runs looks like this:

- **Hy-Tek Meet Manager** (sometimes alongside Colorado Timing / Daktronics) generates complete,
  real-time results at the timing table. This is the source of truth on deck.
- A trained **computer operator** (a volunteer official or a paid timing contractor) runs Meet
  Manager and controls where the data goes.
- **Meet Mobile (Active Network) is pushed live during essentially every meet** — event by event.
  It is *the* live channel families already use. It is **closed** (Active-owned, no public API).
- **Most local meets distribute only Meet Mobile + post-session PDFs.** The open Hy-Tek "Real-Time
  Results to the Web" export (a public auto-updating results page) **exists but is inconsistent** —
  only larger / tech-forward meets bother to enable it.
- **Heat sheets and results PDFs** land on the team's GoMotion / TeamUnify site (and sometimes by
  email or in Meet Mobile).
- **SWIMS and SwimCloud are post-meet only** — hours to days later, never live.
- **The people who actually control the real-time feed are the computer operator and the timing
  rep.** They decide what gets published and where.

**The honest read:** the data exists and is generated live at every meet. The gap is **distribution**
— the live feed goes to one closed app (Meet Mobile) and otherwise to PDFs after the fact. That gap
is the entire reason there's room for Heat Guardian. Our job is **not** to find the public API that
doesn't exist; it's to **bridge the distribution gap ourselves** and become the *live layer*.

## The principle

> A meet in Heat Guardian is **one live, shared object**, fed by whichever source is available.
> Importing a PDF is the **cold-start / offline fallback** — never our identity.

## The primary play: a host bridge for the computer operator

The coach's answers reordered our whole roadmap. We originally bet on the open Hy-Tek web feed
(Bridge #2 below). But that feed is the *exception*, not the rule — so a parser for it, while real,
only fires at a minority of meets. The thing that's true at **every** meet is: a computer operator
is sitting at Meet Manager, and Meet Manager can already export results in real time.

So the real unlock is a **host bridge**:

> A dead-simple "**also publish to Heat Guardian**" path for the computer operator — easier to set
> up than Active's uploader or Hy-Tek's FTP web export. They flip it on once; **every parent at that
> meet gets live results in-app, no import, ever.**

This is exactly how Meet Mobile works under the hood — Active ships an uploader that watches Meet
Manager's results folder and pushes to their cloud. We build the **open equivalent** and push to
*our* cloud (the Cloudflare Worker + R2 cache that's already live). The difference is who it serves:
Active's pipe is closed and monetized; ours is free, family-first, and one tap to read.

**Why this is the moat, not just a feature:** if a host runs *our* bridge, we are the live layer at
that meet — not an import tool racing PDFs. Adoption is the defensibility. And the path to adoption
is a relationship, not a scrape: **the computer operator and the timing rep are the partners.** They
already understand real-time data flow; we make their lives easier, not harder.

**First beachhead:** our own LSC (TNT-SE / GPAC, Pensacola). One friendly computer operator running
the bridge at one meet proves the entire loop.

## The bridges (now in true priority order)

When a parent opens a meet, the app uses the best source available:

1. **Host bridge (primary).** The computer operator runs our tiny uploader → live results flow to
   the shared meet object → every attendee reads them live. *Needs a host partner; that's the moat.*

2. **Host's Hy-Tek "Real-Time Results to the Web" feed (opportunistic).** Where a host *does* enable
   the public web export, we poll it and parse it — zero cooperation needed. We already poll; the
   open piece is a **flat-HTML parser** for that page (today we parse the PDF variant). Real now, but
   only at the minority of tech-forward meets — so it's a bonus, not the foundation.

3. **Crowd-sourced live entry (universal fallback, genuinely novel).** When there's no bridge and no
   feed, *the people are the sensor* — attendees already see the times on the board. Make the meet a
   **shared live document** where attendees collectively enter results, aggregated in real time.
   "First person to see the 50 Free shares it → the whole meet has it." No API, ever. No incumbent
   does this.

4. **Post-session PDF import (everywhere, today).** The heat sheet and results PDFs always show up on
   the team site. Import stays rock-solid and offline — it's the cold-start that works at 100% of
   meets and the thing that already earns trust.

## The north star: the shared live meet

All sources flow into **one shared meet object** (keyed by the meet). Whoever has the best feed feeds
it; everyone at the meet reads it live. Personalized on each device (your swimmer's cuts/PBs light
up), shared at the core. Import-a-PDF becomes the fallback it should be.

## Phased plan

- **Phase 0 — today (shipped).** Local-first import (heat sheets, results, SD3, packs), per-meet
  share links + meet packs + share-by-code, a curated **meet directory** with "view results ↗"
  links, live-results polling of public PDF URLs, the meet-lifecycle archive, the **shared meet cache
  (Cloudflare R2 + Worker)**, and **AI post-meet feedback** (swimmer + coach team summary). Import
  works offline, always.
- **Phase 1 — the host-bridge prototype (the primary bet).** A tiny desktop helper the computer
  operator runs: watch Meet Manager's real-time export folder → push parsed results to `POST /meet`.
  Validate end-to-end with one friendly operator at one LSC meet. *(Bridge #1 — the moat.)*
- **Phase 2 — crowd-sourced live entry.** Attendees co-edit the shared meet's live results; merge +
  conflict resolution; "live" badge. Works at any meet with no host cooperation. *(Bridge #3.)*
- **Phase 3 — the opportunistic web parser.** Flat-HTML parser for Hy-Tek real-time results pages, so
  the tech-forward meets that publish one light up automatically. *(Bridge #2.)*
- **Phase 4 — ecosystem.** Notifications ("you're up in ~N events"), team rosters, coach publish, and
  outreach to modern cloud-timing entrants (Swimmingly et al.) as potential rails/partners.

*(Re-ordered from the pre-coach plan: the host bridge moved from last to first, and the web parser —
once "Phase 1" — dropped to a later opportunistic add, because the coach confirmed it's the rare
case.)*

## Who we talk to

- **The computer operator (admin official).** The single best technical contact — they run Meet
  Manager and control the real-time feed. The bridge is built *for* them.
- **The timing-system rep / contractor.** Understands the data flow across hosts; a yes here scales
  past one meet.
- **Not** Active / Hy-Tek's closed feeds. We don't need them; we route around them by partnering with
  the humans who already hold the data.

## Guardrails (non-negotiable)

- **COPPA / minors' privacy is the gating concern** for anything that leaves the device. The shared
  cache and bridge carry *already-public* heat-sheet/results data (lower risk than collecting new
  PII), but must be designed for it from day one: disclosed in the privacy policy, **auto-purged
  shortly after the meet**, accountless where possible, minimal fields.
- **Stay ToS-clean.** We consume the **host's** own publications and the live feed a host *chooses*
  to send us via the bridge. We do **not** read Meet Mobile's closed feed or scrape SwimCloud's
  pages. Linking *to* them is fine; ingesting their data is not.
- **For the people.** Free core, ad-free, never sell data. Sustainability via tips / club sponsorship
  / optional cloud — never a paywall on a stressed parent at 6am.

## What we will NOT do

- Scrape Meet Mobile / SwimCloud / Active's private feeds (ToS + brittle + store-review risk).
- Store more about a child than the public heat sheet already does.
- Become a closed wall ourselves. The whole point is to open the gap, not move it.

---

*The incumbents being asleep on tech isn't the obstacle — it's the opening. The coach confirmed the
data is right there at every meet; it just only flows to a closed app and to PDFs. Build the bridge
that opens it, partner with the operators who hold it, and become the live layer — for the people.*
