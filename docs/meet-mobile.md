# Can the app pull in / piggyback on Meet Mobile?

Short answer: **not in a way we'd want to ship.** Meet Mobile is the right *idea* (live results in your hand), but the wrong *pipe* for us. The honest path to the same outcome is the live-results plumbing we already have, plus the host bridge. This note explains why, and what to do instead.

## What Meet Mobile actually is

"Meet Mobile" is an app from Active Network (the company behind Hy-Tek Meet Manager). When a meet host runs Meet Manager, they can publish results to Active's cloud; the Meet Mobile app reads them back through Active's **private** backend API.

Key facts that decide this for us:

- **There is no public/documented API.** The endpoints the app talks to are internal to Active. They aren't licensed for third-party apps, and there's no developer program for them.
- **Access is gated.** Requests carry app-identifying credentials/headers. To "act as a user" we'd have to impersonate the official client — i.e. reverse-engineer and replay its private API with spoofed credentials.
- **It's a moving target.** Private APIs change without notice. A scraper built today can break mid-season with no warning, which is exactly when parents are relying on it.
- **Terms of Service.** Active's terms prohibit automated/unauthorized access and scraping. Impersonating their client to pull data is a ToS violation and a real legal/brand risk for a kids' app we intend to put in the App Store and Play Store. Apple/Google review can also reject apps that scrape another service against its terms.

So "piggyback as a user on Meet Mobile" is technically *possible* (people have reverse-engineered it) but it's ToS-violating, fragile, and not something to anchor a shippable product on.

## What we already have that gets the same result — legitimately

The live-results outcome doesn't require Meet Mobile. The same Meet Manager that feeds Meet Mobile can publish **"Real-Time Results to the Web"** — plain HTML result pages. We already parse those:

- `src/hytek.ts` — `looksLikeHytekHtml()` / `parseHytekHtml()` read the `<pre>` results page into `Finisher[]`.
- `src/store.ts` — `fetchPdfBuffer()` / `importBuffer()` accept that HTML on the live path; `applyResults()` overlays the times onto the right swimmer+event.
- Live polling: the app can poll a public results URL on a timer and overlay new times as they post (`liveUrl` / `liveOn` in `App.tsx`).

When the host publishes results to a public web URL, we are a normal reader of a public page — no impersonation, no ToS problem.

## The better bet: the host bridge

For meets where the host *doesn't* publish a public web page, the answer isn't to scrape Active — it's to read from the source we can legitimately touch: the meet PC itself. The **host bridge** prototype already does this:

- `scripts/realtime-bridge.ps1` watches Meet Manager's `C:\realtime` export on the host PC and pushes results to our Worker (`proxy/live.js`, `/live/<code>`); the app overlays them live. See `docs/host-bridge.md` and `docs/bridging-the-gap.md`.

This is strictly better than piggybacking Meet Mobile: it's first-party data we're authorized to read, it's not subject to Active's API changes, and a host opting in is a clean consent model.

## Recommendation

1. **Don't** build a Meet Mobile client/scraper. ToS + fragility + store-review risk outweigh the convenience.
2. **Do** keep leaning on the existing Hy-Tek "Results to the Web" parsing + public-URL polling for hosts that publish.
3. **Do** invest in the host bridge for hosts that don't — it's the durable, consent-based version of the same feature.
4. If we ever want Active's data officially, the only safe route is a **partnership/licensed API** with Active Network, not impersonation.

_Last reviewed: 2026-06-28._
