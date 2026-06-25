# Host bridge — live results straight from Meet Manager (no FTP, no Active account)

This is the **primary play** from [bridging-the-gap.md](bridging-the-gap.md): become the live layer
at a meet by letting the computer operator publish results to Heat Guardian directly, more easily
than Active's Meet Mobile uploader or Hy-Tek's own FTP web export.

## The key fact (confirmed by the MM8 user guide, p.368)

Hy-Tek Meet Manager's **"Real-Time Results to the Web"** feature writes each event's results as a
Hy-Tek HTML file into a **local folder, `c:\realtime`**, every time the operator presses **F12** —
*even when the FTP upload is turned off*. The manual: results are "*uploaded to your web site instead
of just being stored in the `c:\realtime` directory.*" So the data is already sitting on disk, in
exactly the format the app's `parseHytekHtml()` already reads. We just need to move it.

## Architecture — push, never poll (and the meet PC is never exposed)

> **You don't open anything on the meet computer.** A tiny watcher runs *on* that PC (or any PC on
> the same LAN that can read the folder) and makes **outbound HTTPS** calls to our Worker. Outbound
> 443 works on virtually every locked-down meet network; there are no inbound ports, nothing to
> firewall, nothing reachable from outside. This is exactly how Active's Meet Mobile uploader works —
> we're the open equivalent, pushing to *our* cloud instead of theirs.

```
  Meet PC (closed)                         Cloudflare Worker (edge)            Parents' phones
  ┌────────────────────┐   outbound POST   ┌────────────────────────┐  GET    ┌──────────────┐
  │ Meet Manager (F12) │ ───────────────▶  │ POST /live/<code>      │ ◀────── │ Heat Guardian│
  │   ↓ writes          │   HTTPS 443       │   stores in R2         │  /live/ │  live poll    │
  │ c:\realtime\*.htm   │                   │ GET  /live/<code>      │  <code> │  (every ~20s) │
  │   ↑ realtime-bridge │                   │   merges → Hy-Tek HTML │ ──────▶ │ overlays times│
  └────────────────────┘                   └────────────────────────┘         └──────────────┘
```

## Worker endpoints (proxy/worker.js)

| Route | Who | What |
|---|---|---|
| `POST /live` `{title}` | operator, once | creates a session → `{ code, token }` |
| `POST /live/<code>?name=<file>` | watcher | ingest one event's HTML; header `X-HG-Live-Token: <token>` |
| `GET /live/<code>` | the app / parents | merged Hy-Tek page of all events (token-free, read-only) |

Writes are token-gated on purpose — live results are the trusted record, not crowd-writable. Only a
SHA-256 hash of the token is stored. Files are merged on read by `proxy/live.js` (`mergeRealtime`),
proven end-to-end by `node scripts/test_live_bridge.mjs`.

## Operator steps

1. In MM: **Run → Preferences → Web Real-Time**, enable Real-Time Results (this is what creates
   `c:\realtime`). FTP/web-site setup is **not** required for the bridge — we read the local folder.
2. Create the session once (any internet PC):
   ```powershell
   Invoke-RestMethod -Method Post https://<your-worker>/live `
     -Body (@{title='2026 SE Richard Quick Invitational'} | ConvertTo-Json) -ContentType application/json
   ```
   Note the **code** (give to parents) and **token** (keep secret).
3. On the meet PC, leave the watcher running:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\realtime-bridge.ps1 `
     -Base https://<your-worker> -Code ABC234 -Token <token>
   ```
4. Run the meet normally. Each **F12** writes an event file → the watcher pushes it → parents see
   actual times in-app within seconds. (Re-pressing F12 re-publishes and overlays the latest.)

## App side

No app change required for the overlay: point the app's **live results URL** at
`https://<your-worker>/live/<code>`, or wire the code into the live-import box. The existing live
poller fetches that URL and runs `parseHytekHtml()` over it, overlaying actual times onto matched
swimmers — the same path used for hosts that publish an open Hy-Tek results page.

## Status

- ✅ Worker routes (`/live`) + `mergeRealtime` — unit-tested (`test_live_bridge.mjs`) **and**
  verified end-to-end against local R2 via `wrangler dev` (create → ingest → bad-token 403 →
  merged page → 404 on unknown code).
- ✅ Watcher (`scripts/realtime-bridge.ps1`).
- ✅ In-app **"…or a live code from the host"** entry under Import → Live results (all 8 languages).
- ⏳ **Production deploy of the Worker** — pending. Run `cd proxy && npx wrangler deploy`.

After deploy, the only manual step at a meet is: create a session (`POST /live`), run the watcher
on the meet PC with the code+token, and hand the code to parents.
