// USA Swimming Data Hub proxy ------------------------------------------------
// Thin, cached server-side proxy in front of USA Swimming's PUBLIC Data Hub backend
// (the same one powering data.usaswimming.org and, evidently, competitor apps). Reverse-engineered
// 2026-06-30 from the Data Hub SPA. NOT the membership "SWIMS 3.0 vendor API" — that one has no
// times. This is the public consumer data: athlete search, best times, full time history, and meets.
//
// Why proxy at all (don't call from the app):
//   • One place to cache → we hit USA Swimming rarely, never hammer it from thousands of phones.
//   • CORS: the app calls our Worker (already CORS-open), not a 3rd-party host.
//   • Meet search needs a logged-in session; the Worker holds ONE, the app never sees credentials.
//
// Auth model discovered:
//   • times-api / person-api  → ANONYMOUS works with three headers (no token, no key).
//   • meet-api (meet search)  → returns app-level 403 to Anonymous; needs a real Usas-Sub/Session.
//     Provide via secrets USAS_SUB + USAS_SID (capture from a logged-in browser; see README).

const HOSTS = {
  times: "https://times-api.usaswimming.org",
  person: "https://person-api.usaswimming.org",
  meet: "https://meet-api.usaswimming.org",
};

// The Data Hub validates Device-Id *format* (rejects e.g. an all-zeros UUID). The SPA builds it as
//   n = btoa(`${platform} - ${vendor} - ${fingerprint} - ${ts}`); id = n[0:15]+n[0:5]+n[15:]
// Any base64 string of that rough shape passes. We derive ONE stable id for the Worker (a steady
// client looks far less abusive than a new id per request).
function deviceId() {
  const n = btoa(`CloudflareWorker - HeatGuardian - heat-guardian-proxy - 1700000000000`);
  return n.slice(0, 15) + n.slice(0, 5) + n.slice(15);
}

function usasHeaders(env, { auth = false } = {}) {
  const h = {
    "Content-Type": "application/json",
    "Device-Id": deviceId(),
    AppName: "DataHub",
    "Usas-Sub-Id": "Anonymous",
  };
  // Authenticated endpoints (meet search): use the held session if configured.
  if (auth && env.USAS_SUB) {
    h["Usas-Sub-Id"] = env.USAS_SUB;
    if (env.USAS_SID) h["Usas-Session-Id"] = env.USAS_SID;
  }
  return h;
}

// Edge-cached upstream call. `cacheUrl` is a synthetic key (string); `ttl` seconds (0 = no cache).
async function usasFetch(env, host, path, { method = "GET", body = null, auth = false, cacheUrl = null, ttl = 0 } = {}) {
  const cache = caches.default;
  const cacheKey = cacheUrl ? new Request(cacheUrl) : null;
  if (cacheKey && method === "GET") {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const upstream = await fetch(`${HOSTS[host]}${path}`, {
    method,
    headers: usasHeaders(env, { auth }),
    body: body != null ? JSON.stringify(body) : undefined,
  });
  // Pass through the upstream status/body; normalize a couple of known cases for the app.
  const text = await upstream.text();
  const resp = new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": ttl ? `public, max-age=${ttl}` : "no-store" },
  });
  if (cacheKey && ttl && upstream.ok) await cache.put(cacheKey, resp.clone());
  return resp;
}

// --- Public surface used by the Worker router -------------------------------

// GET /usas/athletes?name=Caeleb%20Dressel  → [{ memberId, fullName, clubName, lscCode, swimmerAge, ... }]
export async function searchAthletes(env, name) {
  const q = (name || "").trim();
  if (q.length < 2) return badRequest("name must be at least 2 characters");
  return usasFetch(env, "times", "/swims/TimesSearch/GetMembersForFilters", {
    method: "POST",
    body: { name: q },
    // Search is POST upstream; cache by name at the edge via a synthetic GET key.
    cacheUrl: `https://usas-cache/athletes/${encodeURIComponent(q.toLowerCase())}`,
    ttl: 3600, // 1h — roster/name results barely change
  });
}

// GET /usas/athletes/:id/bests  → best time per event (stroke, distance, course, swimTime)
export async function bestTimes(env, memberId) {
  const id = safeId(memberId);
  if (!id) return badRequest("bad memberId");
  return usasFetch(env, "times", `/swims/TimesSearch/GetBestTimesForMember/${id}`, {
    cacheUrl: `https://usas-cache/bests/${id}`,
    ttl: 21600, // 6h — best times move only when a new meet posts
  });
}

// GET /usas/athletes/:id/times?course=&event=  → full time history via the filter endpoint.
// memberId goes in the body as `memberId`; remaining filters are optional pass-throughs.
// GATED: like meet search, this returns 403 to Anonymous — needs the held session (USAS_SUB).
export async function allTimes(env, memberId, filters = {}) {
  const id = safeId(memberId);
  if (!id) return badRequest("bad memberId");
  if (!env.USAS_SUB) return needsSession("Full time history");
  const events = String(filters.event || "");
  const timeStandardType = String(filters.timeStandardType || "");
  const body = {
    memberId: id,
    bestTimesOnly: filters.bestTimesOnly ? 1 : 0,
    competitionGenderTypeId: Number(filters.gender || 0),
    course: filters.course || null,
    eventId: Number(filters.eventId || 0),
    seasonKey: filters.seasonKey || null,
    startDate: filters.startDate || null,
    endDate: filters.endDate || null,
    minAge: filters.minAge || null,
    maxAge: filters.maxAge || null,
    lscCode: null,
    zoneCode: null,
    events: events || null,
    timeStandardType: timeStandardType || null,
  };
  return usasFetch(env, "times", "/swims/TimesSearch/GetAllTimesForFilters", {
    method: "POST",
    body,
    auth: true,
    cacheUrl: `https://usas-cache/times/${id}/${encodeURIComponent(JSON.stringify(body))}`,
    ttl: 3600,
  });
}

// GET /usas/athletes/:id/meets  → meets this swimmer competed in (newest first). GATED.
export async function swimmerMeets(env, memberId) {
  const id = safeId(memberId);
  if (!id) return badRequest("bad memberId");
  if (!env.USAS_SUB) return needsSession("Swimmer meets");
  return usasFetch(env, "times", `/swims/TimesSearch/GetSwimmerMeets/${id}`, {
    auth: true,
    cacheUrl: `https://usas-cache/swmeets/${id}`,
    ttl: 3600,
  });
}

// GET /usas/athletes/:id/meets/:meetId  → this swimmer's swims at one meet, WITH finishPosition,
// timeDrop, sessionName (Prelim/Final), and timeStandard. The place + drop/add view. GATED.
export async function meetTimes(env, memberId, meetId) {
  const id = safeId(memberId);
  const mid = String(meetId || "").replace(/[^0-9]/g, "");
  if (!id || !mid) return badRequest("bad memberId/meetId");
  if (!env.USAS_SUB) return needsSession("Meet times");
  return usasFetch(env, "times", `/swims/TimesSearch/GetSwimmerMeetTimes/${id}/${mid}`, {
    auth: true,
    cacheUrl: `https://usas-cache/swmeettimes/${id}/${mid}`,
    ttl: 21600,
  });
}

// GET /usas/athletes/:id/standards  → time standards (cuts) this swimmer has achieved. GATED.
export async function swimmerStandards(env, memberId) {
  const id = safeId(memberId);
  if (!id) return badRequest("bad memberId");
  if (!env.USAS_SUB) return needsSession("Swimmer standards");
  return usasFetch(env, "times", `/swims/SearchFilter/GetSwimmerTimeStandards/${id}`, {
    auth: true,
    cacheUrl: `https://usas-cache/swstd/${id}`,
    ttl: 21600,
  });
}

// GET /usas/athletes/:id/progression  → top events with powerPoints + swimDate (career arc). GATED.
export async function progression(env, memberId) {
  const id = safeId(memberId);
  if (!id) return badRequest("bad memberId");
  if (!env.USAS_SUB) return needsSession("Progression");
  return usasFetch(env, "person", `/swims/Person/DataHub/Dashboard/member/${id}/Event`, {
    auth: true,
    cacheUrl: `https://usas-cache/prog/${id}`,
    ttl: 21600,
  });
}

// GET /usas/meet/:meetId  → meet summary (name, type, date, course, counts). GATED.
export async function meetInfo(env, meetId) {
  const mid = String(meetId || "").replace(/[^0-9]/g, "");
  if (!mid) return badRequest("bad meetId");
  if (!env.USAS_SUB) return needsSession("Meet info");
  return usasFetch(env, "meet", `/swims/Meet/${mid}/SFflat`, {
    auth: true,
    cacheUrl: `https://usas-cache/meetinfo/${mid}`,
    ttl: 21600,
  });
}

// GET /usas/meet/:meetId/events  → the meet's event list (eventId, eventCode, gender). GATED.
export async function meetEvents(env, meetId) {
  const mid = String(meetId || "").replace(/[^0-9]/g, "");
  if (!mid) return badRequest("bad meetId");
  if (!env.USAS_SUB) return needsSession("Meet events");
  return usasFetch(env, "meet", `/swims/Meet/${mid}/SFEvent`, {
    auth: true,
    cacheUrl: `https://usas-cache/meetevents/${mid}`,
    ttl: 21600,
  });
}

// GET /usas/meet/:meetId/event?eid=&gid=&sdate=&enum=&snum=  → one event's full results
// (eventTimes: fullName, memberId, swimTime, finishPosition, timeStandard, club, age). GATED.
// The upstream wants the abbreviated key {EId, GenderId, SDate, ENumber, SNumber} from an SFEvent row.
export async function meetEventResults(env, meetId, q = {}) {
  const mid = String(meetId || "").replace(/[^0-9]/g, "");
  if (!mid || !q.eid) return badRequest("bad meetId/event key");
  if (!env.USAS_SUB) return needsSession("Meet results");
  const body = {
    EId: Number(q.eid),
    GenderId: q.gid != null && q.gid !== "" ? Number(q.gid) : null,
    SDate: q.sdate || null,
    ENumber: q.enum != null && q.enum !== "" ? Number(q.enum) : null,
    SNumber: q.snum != null && q.snum !== "" ? Number(q.snum) : null,
  };
  return usasFetch(env, "meet", `/swims/Meet/${mid}/Datahub/SFEvent/time`, {
    method: "POST",
    body,
    auth: true,
    cacheUrl: `https://usas-cache/meetres/${mid}/${encodeURIComponent(JSON.stringify(body))}`,
    ttl: 21600,
  });
}

// GET /usas/meets?name=&lsc=SE&zone=&from=6/1/2026&to=7/1/2026  → meet list (the "meets near me"
// feed: filter by LSC ≈ region + date). The upstream filters by lscOrgUnitId, NOT the 2-letter code,
// so we resolve code→orgUnitId from GetLscs (cached ~24h; the list is effectively static).
// Requires a held session (USAS_SUB[/USAS_SID]); without it, upstream returns 403 and we say so.
export async function searchMeets(env, q = {}) {
  if (!env.USAS_SUB) return needsSession("Meet search");
  const body = {
    mName: (q.name || "").trim(),
    mType: q.type || null,
    isSanctioned: q.sanctioned ? 1 : 0,
    lscCode: q.lsc || null,
    lscOrgUnitId: q.lsc ? await lscOrgUnitId(env, q.lsc) : null,
    zoneCode: q.zone || null,
    zoneOrgUnitId: null,
    sDate: q.from || null,
    eDate: q.to || null,
    loggedInUserClubs: false,
  };
  return usasFetch(env, "meet", "/swims/Meet/SFSearch", {
    method: "POST",
    body,
    auth: true,
    cacheUrl: `https://usas-cache/meets/${encodeURIComponent(JSON.stringify(body))}`,
    ttl: 1800, // 30m
  });
}

// GET /usas/lscs  → [{ orgUnitId, lscCode, lscName }] (the LSC dropdown; cached ~24h).
// AUTH required: GetLscs returns the real encoded orgUnitId only to a logged-in session — anonymous
// gets orgUnitId:0, which makes meet filtering silently no-op. So this needs the held session.
export async function listLscs(env) {
  if (!env.USAS_SUB) return needsSession("LSC list");
  return usasFetch(env, "times", "/swims/SearchFilter/GetLscs", {
    auth: true,
    cacheUrl: "https://usas-cache/lscs",
    ttl: 86400,
  });
}

// Resolve a 2-letter LSC code (e.g. "SE") to its encoded orgUnitId, via the cached LSC list.
async function lscOrgUnitId(env, code) {
  try {
    const resp = await listLscs(env);
    if (!resp.ok) return null;
    const list = await resp.json();
    const hit = list.find((x) => x.lscCode === String(code).toUpperCase());
    return hit ? hit.orgUnitId : null;
  } catch {
    return null;
  }
}

const safeId = (s) => (/^[A-Za-z0-9]{6,32}$/.test(String(s || "")) ? String(s) : null);
const badRequest = (detail) =>
  new Response(JSON.stringify({ error: "bad_request", detail }), { status: 400, headers: { "Content-Type": "application/json" } });
// Anonymous works for name-search + best-times only; everything else is session-gated upstream.
const needsSession = (what) =>
  new Response(
    JSON.stringify({ error: "needs_session", detail: `${what} requires a logged-in USA Swimming session. Set USAS_SUB (and USAS_SID) secrets — see proxy/README.` }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
