// Heat Guardian backend (Cloudflare Worker). Three routes, all free-tier friendly:
//   GET  /?url=<pdf>      — stateless CORS fetch-helper for public heat-sheet PDFs (original use)
//   POST /meet            — store a parsed meet-pack JSON in R2, return a short share code
//   GET  /meet/<code>     — fetch a shared meet-pack JSON (so phones skip the big-PDF parse)
//   POST /feedback        — AI post-meet feedback from a swimmer's own notes (COPPA-minimized)
//
// Deploy: see README.md. Bindings (set in wrangler.toml): MEETS (R2 bucket), RL (KV, optional).
// Secret: ANTHROPIC_API_KEY (wrangler secret put). Optional secret: APP_TOKEN (obfuscation gate).

import Anthropic from "@anthropic-ai/sdk";

const MAX_PDF_BYTES = 30 * 1024 * 1024; // 30 MB
const MAX_MEET_BYTES = 3 * 1024 * 1024; // 3 MB — a meet-pack JSON is small
const MAX_FEEDBACK_BYTES = 24 * 1024; // 24 KB of swim context + notes is plenty
const FEEDBACK_DAILY_CAP = 40; // per-IP/day, when KV is bound
const FEEDBACK_GLOBAL_DAILY_CAP = 250; // ALL feedback calls/day — a hard spend backstop so abuse or
// a viral spike can't run up the AI bill; pairs with the monthly cap you set in the Anthropic console.
const MEET_DAILY_CAP = 60; // per-IP/day share uploads, to deter storage spam

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
