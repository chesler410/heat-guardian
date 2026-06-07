# Shared "paste a link" helper (set up ONCE by the site owner)

Meet sites (gomotion/TeamUnify) block apps from fetching their PDFs directly (CORS).
This tiny free Cloudflare Worker fetches the PDF and adds the missing header, so **every
parent's "paste a link" just works with zero setup**. You only do this once.

## Easiest: Cloudflare dashboard (no installs)

1. Make a free account at https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Worker**.
2. Name it `my-swimmer-fetch`, click **Deploy**, then **Edit code**.
3. Delete the sample, paste the contents of [`worker.js`](worker.js), **Deploy**.
4. Copy the URL it gives you, e.g. `https://my-swimmer-fetch.<you>.workers.dev`.

## Or: command line

```bash
npm i -g wrangler && wrangler login
cd proxy && wrangler deploy   # prints your worker URL
```

## Final step — turn it on for everyone

In the GitHub repo: **Settings → Secrets and variables → Actions → Variables → New variable**

- Name: `PROXY_URL`
- Value: `https://my-swimmer-fetch.<you>.workers.dev/?url={url}`  ← keep the `?url={url}`

Then re-run the deploy (push any commit, or Actions → Deploy → Run). Done — paste-a-link now
works for all users, no per-person setup. Until this is set, the app simply tells users to
tap **Upload** (which always works).
