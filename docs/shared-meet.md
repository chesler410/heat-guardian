# Shared live meet — "one import serves the whole team"

*Design spec for task #14. The app-side realization of `docs/bridging-the-gap.md` Bridge #3
(crowd-sourced live entry) and the shared meet object. **Apps-first** — see
[[prioritize-apps-over-web]].*

## Goal

A parent imports a meet once and publishes it. Everyone else on the team **joins by link**
instead of re-importing, and **results captured by anyone flow to everyone** on that meet. One
good import covers the whole team — parents, swimmers, and the coach.

Two principles carry through:

1. **One shared object, many readers.** The published meet is the single source; each device
   personalizes it (your swimmers light up) but reads the same results.
2. **Provenance is visible and honest.** A time's *source* (documented seed, manually entered by
   the room, auto-captured live, or official results) is always shown. Manually entered times
   carry a clear **"manually entered"** disclaimer — see [[verify-parsed-results]].

## What already exists (and the gap)

The plumbing is mostly built (`src/store.ts`, `proxy/worker.js`):

- `cacheMeet(meet, results, proxy)` → `POST /meet` stores a meet pack `{meet, results}` in R2,
  returns a **new random 6-char code** each time.
- `importMeetCode(code, proxy)` → `GET /meet/<code>` pulls it back into `{meet, results}`.
- Team share links + share codes + the meet directory are shipped.
- Results are keyed locally `meetId|event|name` → time (`resultKey`, `store.ts:106`); the wire
  format is `Record<string, string>`.

**The gap:** today's shared pack is a **frozen snapshot**. Whoever shares bakes in their results
at that instant; the code is random per-POST; recipients get a one-time copy that never updates.
To make results "push out," the shared object must become **mutable and re-pulled**, with a
**stable code** and a **provenance layer**.

## Data model

### Meet identity

The **share code is the meet's stable identity.** The first publisher mints it once; everyone
who joins that code reads/writes the same R2 object. (Slice 1 can keep the existing immutable
snapshot and just re-pull; slice 2 needs the mutable object below.)

### Result cell (the provenance layer)

Extend the wire format from `Record<string, string>` to `Record<string, ResultCell>`, keeping
backward-compat (a bare `string` is read as a legacy `official` cell):

```ts
type ResultSource =
  | "seed"      // from the heat-sheet import — a documented entry/seed time, NOT a result
  | "crowd"     // manually entered by an attendee — UNCONFIRMED, needs the "manually entered" tag
  | "live"      // auto-captured from a Hy-Tek live web feed (machine-read, pre-official)
  | "official"; // from the official results PDF / SD3 import — CONFIRMED

interface ResultCell {
  time: string;        // "1:43.32"
  src: ResultSource;
  at: number;          // epoch ms, last write
  agree?: number;      // # of independent crowd entries that match this time (for promotion)
  confirmed?: boolean; // true by default for live/official (the machine/legal record); for crowd,
                       // true only once a machine source corroborates. Drives the tentative styling.
  // No name/email/account of the contributor — accountless. Provenance is the SOURCE, not the person.
}
```

Key local helper (`store.ts`): `resultKey(meetId, event, name)` stays the keying; the value
becomes a `ResultCell`. The arm-table / cards read `cell.time` and style by `cell.src` +
`cell.confirmed`.

### Confidence / display precedence

When more than one source has a value for the same swim, show the highest-confidence one:

```
official  >  live  >  crowd(agree ≥ 2)  >  crowd(single)  >  seed
```

**Trust the machine over the parent's eyes.** `live` (the Hy-Tek real-time feed straight from
Meet Manager) is the **legal record** — it is what was recorded until an audit or a review against
a DQ / equipment malfunction. So:

- **`live` and `official` are authoritative/trusted by default** (`confirmed: true`), NOT rendered
  as tentative. `official` is simply the post-review final (it reflects any DQ/correction the live
  feed predates), so it overrides `live` *only when it actually differs.*
- **Only `crowd`/manual is tentative** — it gets the bold "unconfirmed" + `✍︎ manually entered`
  treatment. A crowd time **never overrides a `live` or `official` value**; the machine wins, full
  stop. Crowd is a stopgap *only* where no live feed exists, and it yields the instant a machine
  source arrives.

## UI spec

### The "bold until you click" affordance (the user's idea — it doubles as the trust signal)

- Only a **manually entered, unconfirmed** time (`crowd`, `!confirmed`) renders **bold/outlined**
  with a source chip, distinct from the documented `seed` (plain). `live` and `official` render as
  **trusted/solid** (the green swum-time pill we just shipped) — they are the machine record, not
  something to second-guess.
- **Tap the time → a provenance sheet:** shows source ("✍︎ Manually entered by the room",
  "📡 Live from the host's results page", "📄 From the official results"), the timestamp, agree
  count, and a **"Verify against official results ↗"** action (jump to the meet's results
  link/import). This is where "click to see the results" lands.

### The "manually entered" disclaimer (explicit requirement)

Crowd-contributed times must be unmistakably labeled as manually entered and fallible:

1. **On every crowd cell** — a persistent inline tag: **`✍︎ manually entered`** (i18n key, all 8
   languages). Never show a crowd time as if it were official.
2. **One-time join disclaimer** — the first time a user opens a meet that contains crowd times, a
   dismissible banner: *"Some times here are entered by hand by other attendees and may contain
   errors. Always check the official posted results before counting on a time."*
3. **On the contribute form** — when a user enters a time to share, a line under the field:
   *"Your time will be shared with the team marked as manually entered. Please double-check it
   against the board."* (Mirrors the existing parse disclaimer pattern — [[verify-parsed-results]].)

All three are real i18n keys with full 8-language parity ([[keep-langs-and-readme-current]]).

## Sync mechanism

- **Read:** clients **poll** `GET /meet/<code>` on the same cadence as the existing live-results
  poller (~60 s; the live machinery already exists — `e2e_live.mjs`). Merge incoming cells:
  for each key, take the higher-confidence/newer cell; never overwrite a local `official` with a
  remote `crowd`.
- **Write (slice 2):** `POST /meet/<code>/results` with a small patch of changed cells. The
  Worker merges into the stored object (read-modify-write in R2; tolerate last-write-wins at the
  cell level — meet results are low-contention). Bump an `updatedAt` so clients can skip no-op pulls.
- **Offline-first:** local entry always works and is the source of truth on-device; sharing is an
  overlay. A failed POST just queues — the parent never loses their own logged time.

## Worker API changes (`proxy/worker.js`)

- Make the meet object **mutable under a stable code** (slice 2): keep `POST /meet` for first
  publish (returns code), add `POST /meet/<code>/results` (merge patch; validate JSON; cap size;
  same R2 bucket).
- `GET /meet/<code>` unchanged in shape, now returns the merged `ResultCell` map + `updatedAt`.
- Keep the existing guards: 3 MB cap, JSON-only, CORS, `customMetadata.createdAt` for purge.

## Trust & abuse model (the hard half — slice 2)

Open, accountless writes mean one wrong entry can propagate. Mitigations that stay simple and
accountless:

- **Unconfirmed-until-verified** is the core defense — the bold/`✍︎ manually entered` state *tells
  the user not to fully trust it.* The UI never launders a crowd time into an official one.
- **2-agree promotion:** a `crowd` time only reaches normal confidence when ≥ 2 independent
  entries match (`agree ≥ 2`). A lone outlier stays visibly tentative.
- **The machine wins:** any `live` or `official` cell overwrites a `crowd` value and is trusted
  (`confirmed`) — live is the legal record, official is its post-review final. A crowd time can
  never override either; it exists only to fill the gap until a machine source arrives.
- **Append-only-ish:** prefer recording the latest cell with provenance over destructive
  overwrite, so a bad value is *superseded*, not lost — and an official import can always correct.
- **Rate limit:** reuse the optional per-IP KV limiter already in the Worker for the results POST.

## Privacy / COPPA

- Times are **already-public board data**; the swimmer identity (name) is what the heat sheet
  already prints. Lower-risk category per the bridging-the-gap guardrails — but still designed for
  minors: **accountless** (no contributor identity stored — provenance is the *source*, not the
  person), **auto-purged** shortly after the meet (R2 `createdAt`), minimal fields, disclosed in
  the privacy policy (the About copy already discloses the share-by-code upload).
- The **"manually entered" disclaimer** is also a privacy/accuracy honesty measure: we never imply
  certainty we don't have about a child's result.

## Rollout (apps-first)

- **Slice 1 — Join + read (lowest risk, do first).** "Join this meet" by link/code → read-only
  shared results overlay with the provenance display (`seed` vs `crowd`/`live` vs `official`,
  bold-until-confirmed, tap-for-provenance). Poll + merge. Can ship on the *existing* immutable
  snapshot first (re-pull on open), upgrading to the mutable object when slice 2 lands. **This
  alone delivers "one import covers the whole team"** for any meet where one person imports results.
- **Slice 2 — Crowd write.** The contribute flow + `POST /meet/<code>/results`, the
  manually-entered disclaimer (all three placements), 2-agree promotion, and merge/conflict
  handling. Trust-sensitive; gate behind real-world validation.

Validate both on a device (iOS/Android) with the Lalor sample pair ([[lalor-sample-pair]]) before
widening. Extend the test harness ([[testing-and-strategy]]): a new `e2e_shared.mjs` that publishes
a meet, joins from a second client, contributes a crowd time, and asserts it surfaces as
`✍︎ manually entered` / unconfirmed, then `official` import promotes it to confirmed.

## Open questions

- **Code distribution at scale:** how does the *first* publisher get chosen / how do teammates
  discover the code without friction? (Team share links already help; a meet in the directory
  could carry a canonical code.)
- **Stale meets:** when does a shared meet stop accepting writes? (Tie to `start` + a few days,
  matching the archive/purge logic.)
- **Live + crowd interplay:** if a host *does* publish a live feed, does it auto-publish into the
  same shared object so crowd entry becomes unnecessary there? (Yes — `live` simply outranks
  `crowd`.)
