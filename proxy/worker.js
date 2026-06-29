// Heat Guardian backend (Cloudflare Worker). Three routes, all free-tier friendly:
//   GET  /?url=<pdf>      — stateless CORS fetch-helper for public heat-sheet PDFs (original use)
//   POST /meet            — store a parsed meet-pack JSON in R2, return a short share code
//   GET  /meet/<code>     — fetch a shared meet-pack JSON (so phones skip the big-PDF parse)
//   POST /feedback        — AI post-meet feedback from a swimmer's own notes (COPPA-minimized)
//
// Deploy: see README.md. Bindings (set in wrangler.toml): MEETS (R2 bucket), RL (KV, optional).
// Secret: ANTHROPIC_API_KEY (wrangler secret put). Optional secret: APP_TOKEN (obfuscation gate).

import Anthropic from "@anthropic-ai/sdk";
import { mergeRealtime, sha256 } from "./live.js";

const MAX_PDF_BYTES = 30 * 1024 * 1024; // 30 MB
const MAX_LIVE_FILE_BYTES = 512 * 1024; // 512 KB — one event's HTML results page is tiny
const LIVE_FILE_CAP = 400; // max stored files per live meet (events × rounds, generous)
const LIVE_INGEST_DAILY_CAP = 5000; // per-IP/day pushes — a busy meet uploads each event many times
const MAX_MEET_BYTES = 3 * 1024 * 1024; // 3 MB — a meet-pack JSON is small
const MAX_FEEDBACK_BYTES = 24 * 1024; // 24 KB of swim context + notes is plenty
// Spend math: one Opus 4.8 feedback call ≈ 1.5¢ (~1k tokens in + ~400 out). The owner's Anthropic
// monthly spend limit (~$20) is the hard, ironclad stop. These caps are defense-in-depth to slow the
// burn and block single-day abuse so no one bad day eats the month:
const FEEDBACK_DAILY_CAP = 40; // per-IP/day (~$0.60/IP) — stops one user/script hammering it
const FEEDBACK_GLOBAL_DAILY_CAP = 150; // ALL feedback calls/day ≈ $2.25/day max — generous headroom
// for a real meet day (normal pilot use is well under this), but sized so it can't blow the ~$20/mo.
const MEET_DAILY_CAP = 60; // per-IP/day share uploads, to deter storage spam (no AI cost)
const MAX_REPORT_BYTES = 8 * 1024; // a feedback note + small context
const REPORT_DAILY_CAP = 50; // per-IP/day in-app feedback reports

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const text = (s, status = 200, extra = {}) => new Response(s, { status, headers: { ...CORS, ...extra } });

// Unambiguous code alphabet (no 0/O/1/I) → 6 chars ≈ 1B combos, easy to read aloud/type.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const makeCode = () => {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join("");
};

const today = () => new Date().toISOString().slice(0, 10);
const clientIp = (request) => request.headers.get("cf-connecting-ip") || "anon";
// Best-effort daily counter backed by KV. Returns true if allowed (and increments), false if the
// cap is hit. No-op (always allows) when the RL namespace isn't bound, so the worker still runs
// before you enable KV — but enable it for real protection (see wrangler.toml).
async function underCap(env, key, cap) {
  if (!env.RL) return true;
  const used = Number((await env.RL.get(key)) || 0);
  if (used >= cap) return false;
  await env.RL.put(key, String(used + 1), { expirationTtl: 86400 });
  return true;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      // --- Shared meet cache (R2) ---
      const meetMatch = /^\/meet\/([23456789A-HJ-NP-Z]{4,12})$/.exec(path);
      if (meetMatch && request.method === "GET") return getMeet(env, meetMatch[1]);
      if (path === "/meet" && request.method === "POST") return putMeet(env, request);

      // --- Host bridge: live results pushed from the meet computer's c:\realtime folder ---
      if (path === "/live" && request.method === "POST") return liveCreate(env, request);
      const liveMatch = /^\/live\/([23456789A-HJ-NP-Z]{4,12})$/.exec(path);
      if (liveMatch && request.method === "POST") return liveIngest(env, request, liveMatch[1]);
      if (liveMatch && request.method === "GET") return liveServe(env, liveMatch[1]);

      // --- In-app feedback report → notify the developer (webhook/email) + durable R2 log ---
      if (path === "/report" && request.method === "POST") return report(env, request);

      // --- AI post-meet feedback ---
      if (path === "/feedback" && request.method === "POST") return feedback(env, request);

      // --- Original PDF fetch-helper (default route) ---
      return proxyPdf(url);
    } catch (e) {
      return text("Server error: " + (e && e.message ? e.message : e), 500);
    }
  },
};

// ---------------------------------------------------------------------------

async function proxyPdf(url) {
  const target = url.searchParams.get("url");
  if (!target || !/^https?:\/\//i.test(target)) return text("Pass ?url=<https link>", 400);
  let upstream;
  try {
    upstream = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/pdf,text/html,*/*" },
      redirect: "follow",
    });
  } catch (e) {
    return text("Fetch failed: " + e, 502);
  }
  if (!upstream.ok) return text("Upstream " + upstream.status, 502);
  if (Number(upstream.headers.get("content-length") || 0) > MAX_PDF_BYTES) return text("Too large", 413);
  const ct = upstream.headers.get("content-type") || "application/pdf";
  return new Response(upstream.body, {
    headers: { ...CORS, "Content-Type": ct, "Cache-Control": "public, max-age=3600" },
  });
}

async function putMeet(env, request) {
  if (!env.MEETS) return text("Meet cache not configured (bind R2 bucket MEETS)", 501);
  if (!(await underCap(env, `meet:${clientIp(request)}:${today()}`, MEET_DAILY_CAP)))
    return text("Rate limited — too many shares today.", 429);
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return text("Empty body", 400);
  if (body.byteLength > MAX_MEET_BYTES) return text("Meet too large", 413);
  // Validate it's JSON before we store it (don't host arbitrary blobs).
  try {
    JSON.parse(new TextDecoder().decode(body));
  } catch {
    return text("Body must be JSON", 400);
  }
  const code = makeCode();
  await env.MEETS.put(`meet/${code}.json`, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { createdAt: new Date().toISOString() },
  });
  return json({ code });
}

async function getMeet(env, code) {
  if (!env.MEETS) return text("Meet cache not configured", 501);
  const obj = await env.MEETS.get(`meet/${code}.json`);
  if (!obj) return json({ error: "not_found" }, 404);
  return new Response(obj.body, {
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=120" },
  });
}

// --- Host bridge ----------------------------------------------------------
// A computer operator runs the watcher agent (scripts/realtime-bridge.ps1) ON the meet PC.
// It watches c:\realtime and POSTs each changed event file OUTBOUND to /live/<code> — the meet
// PC is never exposed or polled; it only makes outbound HTTPS calls, exactly like Active's own
// Meet Mobile uploader. Parents' phones poll GET /live/<code> at the edge, never the meet PC.

// Create a live session: returns { code, token }. The operator enters the code into the watcher
// (and shares it with parents). The token gates writes; only its SHA-256 hash is stored.
async function liveCreate(env, request) {
  if (!env.MEETS) return text("Live cache not configured (bind R2 bucket MEETS)", 501);
  if (!(await underCap(env, `livenew:${clientIp(request)}:${today()}`, MEET_DAILY_CAP)))
    return text("Rate limited — too many new live meets today.", 429);
  let title = "Live results";
  try {
    const b = await request.json();
    if (b && typeof b.title === "string") title = b.title.slice(0, 120);
  } catch { /* title is optional */ }
  const code = makeCode();
  const token = makeCode() + makeCode(); // 12 chars
  await env.MEETS.put(`live/${code}/_meta.json`, JSON.stringify({ title, tokenHash: await sha256(token), createdAt: new Date().toISOString() }), {
    httpMetadata: { contentType: "application/json" },
  });
  return json({ code, token });
}

// Ingest one event's HTML (body = raw file, ?name=<filename>). Token-gated so only the operator
// who created the session can publish — live results are the trusted record, not crowd-writable.
async function liveIngest(env, request, code) {
  if (!env.MEETS) return text("Live cache not configured", 501);
  if (!(await underCap(env, `livein:${clientIp(request)}:${today()}`, LIVE_INGEST_DAILY_CAP)))
    return text("Rate limited.", 429);
  const meta = await env.MEETS.get(`live/${code}/_meta.json`);
  if (!meta) return json({ error: "not_found" }, 404);
  const { tokenHash } = await meta.json();
  const token = request.headers.get("x-hg-live-token") || "";
  if (!token || (await sha256(token)) !== tokenHash) return text("Forbidden", 403);
  const name = (new URL(request.url).searchParams.get("name") || "event.htm").replace(/[^\w.\-]/g, "_").slice(0, 80);
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return text("Empty body", 400);
  if (body.byteLength > MAX_LIVE_FILE_BYTES) return text("File too large", 413);
  await env.MEETS.put(`live/${code}/files/${name}`, body, { httpMetadata: { contentType: "text/html" } });
  return json({ ok: true, name });
}

// Serve the merged live results as one Hy-Tek page so the app's existing live poller (which runs
// parseHytekHtml over a fetched URL) overlays actual times with no app changes — point the live
// URL at this endpoint, or import the code.
async function liveServe(env, code) {
  if (!env.MEETS) return text("Live cache not configured", 501);
  const meta = await env.MEETS.get(`live/${code}/_meta.json`);
  if (!meta) return text("Live meet not found", 404);
  const { title } = await meta.json();
  const listed = await env.MEETS.list({ prefix: `live/${code}/files/`, limit: LIVE_FILE_CAP });
  const files = [];
  for (const o of listed.objects) {
    const obj = await env.MEETS.get(o.key);
    if (obj) files.push({ name: o.key.split("/").pop(), text: await obj.text() });
  }
  const html = mergeRealtime(files, title || "Live results");
  return new Response(html, { headers: { ...CORS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=15" } });
}

// In-app feedback → reach the developer in real time. Body: { text, ctx? }. Notifies via,
// in order of whatever you've configured, all best-effort and graceful:
//   1) R2 — a durable log of every report (so nothing is ever lost), if MEETS is bound
//   2) REPORT_WEBHOOK (secret) — a Discord/Slack incoming-webhook URL → instant phone push, ZERO
//      DNS setup (recommended). Discord wants {content}, Slack wants {text}; we send both keys.
//   3) EMAIL (send_email binding) + REPORT_TO + REPORT_FROM — email, if you onboarded a domain to
//      Cloudflare Email Sending (wrangler email sending enable <domain>).
// No PII is required — it's just the note the user typed plus app context (version/lang/role).
async function report(env, request) {
  if (!(await underCap(env, `report:${clientIp(request)}:${today()}`, REPORT_DAILY_CAP)))
    return json({ error: "rate_limited" }, 429);
  const raw = await request.arrayBuffer();
  if (raw.byteLength === 0) return text("Empty body", 400);
  if (raw.byteLength > MAX_REPORT_BYTES) return text("Too long", 413);
  let data;
  try { data = JSON.parse(new TextDecoder().decode(raw)); } catch { return text("Body must be JSON", 400); }
  const msg = String(data.text || "").slice(0, 4000).trim();
  if (!msg) return json({ error: "empty" }, 400);
  const ctx = String(data.ctx || "").replace(/[\r\n]+/g, " ").slice(0, 200);
  const when = new Date().toISOString();
  const note = `🏊 Heat Guardian feedback\n${when}\n${ctx ? `Context: ${ctx}\n` : ""}\n${msg}\n`;

  if (env.MEETS) { try { await env.MEETS.put(`report/${when}-${makeCode()}.txt`, note, { httpMetadata: { contentType: "text/plain" } }); } catch { /* logging is best-effort */ } }
  if (env.REPORT_WEBHOOK) {
    try { await fetch(env.REPORT_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: note, text: note }) }); } catch { /* best-effort */ }
  }
  if (env.EMAIL && env.REPORT_TO && env.REPORT_FROM) {
    try {
      await env.EMAIL.send({
        to: env.REPORT_TO,
        from: { email: env.REPORT_FROM, name: "Heat Guardian" },
        subject: "Heat Guardian feedback",
        text: note,
        html: `<pre style="font:14px/1.5 sans-serif;white-space:pre-wrap">${note.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
      });
    } catch { /* best-effort */ }
  }
  return json({ ok: true });
}

// COPPA-minimized AI feedback. The app sends ONLY swim context + the swimmer's own notes —
// never a name or team. We store nothing. Body: { swims: [{race, seed, result, cut, note}], age? }.
async function feedback(env, request) {
  if (!env.ANTHROPIC_API_KEY) return text("Feedback not configured (set ANTHROPIC_API_KEY)", 501);
  if (env.APP_TOKEN && request.headers.get("x-hg-token") !== env.APP_TOKEN) return text("Forbidden", 403);

  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_FEEDBACK_BYTES) return text("Too much input", 413);
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return text("Body must be JSON", 400);
  }
  const swims = Array.isArray(data.swims) ? data.swims.slice(0, 30) : [];
  if (!swims.length) return json({ error: "no_swims" }, 400);

  // Two-layer daily rate limit (best-effort, only enforced when KV namespace RL is bound):
  //   per-IP  — stops one user/script hammering the endpoint
  //   global  — a hard ceiling on total AI calls/day = the spend backstop
  if (!(await underCap(env, `fb:${clientIp(request)}:${today()}`, FEEDBACK_DAILY_CAP)))
    return json({ error: "rate_limited" }, 429);
  if (!(await underCap(env, `fbglobal:${today()}`, FEEDBACK_GLOBAL_DAILY_CAP)))
    return json({ error: "rate_limited" }, 429);

  const kind = data.kind === "team" ? "team" : "swimmer";
  let system, content;

  if (kind === "team") {
    // Coach team summary — addressed TO the coach ("you / your team"). First names are included so
    // the coach knows who, but no last names / contact / location. We store nothing.
    const lines = swims.map((s) => {
      const name = String(s.name || "A swimmer").replace(/["\n]/g, "").slice(0, 24);
      const race = String(s.race || s.event || "swim").slice(0, 40);
      const result = s.result ? `swam ${String(s.result).slice(0, 12)}` : "no time";
      const cut = s.cut ? ` (${String(s.cut).slice(0, 30)})` : "";
      return `- ${name} — ${race}: ${result}${cut}`;
    });
    const team = data.teamName ? ` "${String(data.teamName).replace(/["\n]/g, "").slice(0, 40)}"` : "";
    system =
      "You are an encouraging assistant to a youth swim coach, writing a short overall summary of " +
      "your team's meet, addressed directly to the coach (say 'you' and 'your team'). You get each " +
      "swimmer's first name, event, time, and cut status. In 3-5 short sentences: celebrate the " +
      "team's wins (best times, new cuts, notable drops — name a few swimmers by first name), then " +
      "one or two encouraging things to watch next time. Warm, positive, age-appropriate; never " +
      "harsh; never rank the kids against each other. Respond with ONLY the summary — no preamble, " +
      "no headings, no markdown.";
    content = `Here are your team's meet results for${team || " your team"}.\n\n${lines.join("\n")}\n\nWrite the coach's overall summary.`;
  } else {
    // Swimmer feedback — addressed TO the swimmer ("you"). No name/team is sent.
    const lines = swims.map((s) => {
      const race = String(s.race || s.event || "swim").slice(0, 40);
      const seed = s.seed ? `seed ${String(s.seed).slice(0, 12)}` : "";
      const result = s.result ? `swam ${String(s.result).slice(0, 12)}` : "no time yet";
      const cut = s.cut ? `(${String(s.cut).slice(0, 30)})` : "";
      const note = s.note ? ` — your note: "${String(s.note).slice(0, 300)}"` : "";
      return `- ${race}: ${[seed, result, cut].filter(Boolean).join(", ")}${note}`;
    });
    const age = Number.isFinite(+data.age) ? ` You are about ${+data.age} years old.` : "";
    system =
      "You are a warm, encouraging youth swim coach writing brief post-meet feedback directly to a " +
      "young swimmer (roughly ages 8-14), speaking to them as 'you'. You get only swim data (events, " +
      "times, cut standards) and the swimmer's own short notes — never their name. Write 2-4 short " +
      "sentences: celebrate something concrete (a best time, a cut you reached, effort or a feeling " +
      "you noted), then offer ONE gentle, specific thing to try next time. Always positive and " +
      "age-appropriate — never harsh, never discouraging, no scores or rankings against other kids. " +
      "Respond with ONLY the feedback text: no preamble, no greeting by name, no headings, no markdown.";
    content = `Here is your meet.${age}\n\n${lines.join("\n")}\n\nWrite my post-meet feedback, speaking to me as 'you'.`;
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  // Single short generation — Opus 4.8 (swap to "claude-sonnet-4-6" to ~halve cost). Thinking is
  // omitted for speed/cost; the "respond with ONLY" instruction keeps reasoning out of the output.
  const msg = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: kind === "team" ? 700 : 500,
    system,
    messages: [{ role: "user", content }],
  });
  if (msg.stop_reason === "refusal") return json({ error: "declined" }, 422);
  const out = msg.content.find((b) => b.type === "text");
  return json({ feedback: out ? out.text.trim() : "" });
}
