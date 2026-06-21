# Heat Guardian backend (one Cloudflare Worker, free tier)

This is the `my-swimmer-fetch` Worker. It does three things on one domain:

| Route | What it does | Needs |
|---|---|---|
| `GET /?url=<pdf>` | The original CORS fetch-helper for public heat-sheet PDFs | nothing |
| `POST /meet` → `{code}` · `GET /meet/<code>` | **Shared meet cache** — one person parses the big PDF once, everyone pulls a tiny JSON | R2 bucket |
| `POST /feedback` → `{feedback}` | **AI post-meet feedback** from a swimmer's own notes (key stays server-side) | Anthropic key (+ KV for rate-limit) |

The fetch-helper already works with no setup. The two new routes need a one-time setup below.

## One-time setup (the owner, ~10 min)

```bash
cd proxy
npm install                         # project deps
npm install @anthropic-ai/sdk       # the Claude SDK (bundled into the Worker)
npm install -D wrangler             # the deploy CLI
npx wrangler login                  # opens a browser

# 1. Shared meet cache (R2) — free tier is plenty
npx wrangler r2 bucket create heat-guardian-meets
#    (optional auto-purge: in the dashboard, R2 → heat-guardian-meets → Settings →
#     add a lifecycle rule "expire objects after 60 days" — keeps it COPPA-clean)

# 2. Rate-limit store (KV) for /feedback
npx wrangler kv namespace create RL
#    → copy the printed id into wrangler.toml's [[kv_namespaces]] id = "..."

# 3. The Claude key (NEVER ships in the app — lives only here)
npx wrangler secret put ANTHROPIC_API_KEY
#    (paste your key from console.anthropic.com when prompted)
#    optional obfuscation gate the app also sends:
# npx wrangler secret put APP_TOKEN

# 4. Ship it
npx wrangler deploy
```

**Then, the real cost backstop:** in the Anthropic console set a **monthly spend limit + email alert**.
Feedback runs ~1.2¢/meet on Opus 4.8 (swap the model to `claude-sonnet-4-6` in `worker.js` to
roughly halve it), so a low cap is just insurance against abuse.

## Notes
- Keeping the name `my-swimmer-fetch` means the app's existing proxy URL keeps working — the new
  routes are added to the same Worker, same domain.
- `/feedback` is **COPPA-minimized**: the app sends only swim context + the swimmer's own notes,
  never a name or team. The Worker stores nothing for feedback and validates/caps every input.
- `/meet` stores only the parsed meet-pack JSON (events/lineups) the app already shares; cap 3 MB.
