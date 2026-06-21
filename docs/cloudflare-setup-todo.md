# ☁️ Cloudflare backend — YOUR setup checklist (do when fresh)

The backend **code is already written + committed** (`proxy/worker.js`). These are the account
steps only you can do (they need your Cloudflare login + your Anthropic key). ~10 minutes.
Full detail is in `proxy/README.md`; this is the quick checklist.

Run everything from the `proxy/` folder:

```bash
cd C:\dev\my-swimmer\proxy
```

- [ ] **Install deps:** `npm install && npm install @anthropic-ai/sdk && npm install -D wrangler`
- [ ] **Log in:** `npx wrangler login`  (opens a browser)
- [ ] **Create the R2 bucket** (shared-meet cache): `npx wrangler r2 bucket create heat-guardian-meets`
      - ⚠️ R2 may ask for a **card on file** even on the free tier (no charge unless you exceed free limits — you won't).
- [ ] **Create the KV namespace** (feedback rate-limit): `npx wrangler kv namespace create RL`
      - 📋 Copy the printed **id** into `proxy/wrangler.toml` → `[[kv_namespaces]] id = "..."`
- [ ] **Set the Claude key** (server-side only, never in the app): `npx wrangler secret put ANTHROPIC_API_KEY`
      - Paste your key from console.anthropic.com when prompted.
- [ ] **Deploy:** `npx wrangler deploy`
- [ ] **Set a spend cap + email alert** in the Anthropic console (the real abuse backstop).
- [ ] **Tell Claude it's live** (and the worker URL) → Claude wires the app's Share-by-code +
      "✨ Get feedback" buttons against the now-live endpoints.

### Optional / later
- [ ] R2 auto-purge (COPPA tidy): dashboard → R2 → `heat-guardian-meets` → Settings → lifecycle
      rule "expire objects after 60 days".
- [ ] Cheaper feedback: change `claude-opus-4-8` → `claude-sonnet-4-6` in `proxy/worker.js`.

### Endpoint contract (so the app wiring already matches)
- `POST /meet`  body = meet-pack JSON  → `{ "code": "AB23CD" }`
- `GET  /meet/<code>`  → the meet-pack JSON (404 `{ "error": "not_found" }` if missing)
- `POST /feedback`  body = `{ swims:[{race,seed,result,cut,note}], age? }`  → `{ "feedback": "..." }`
  (no name/team — COPPA-minimized)
