// E2E smoke for the simplified nav: 2 tabs (Home + Swimmers) + ⚙ Settings, the merged
// Swimmers hub (My swimmers + Watch list in one place), Progress folded into Home, the
// Settings screen (theme/language/taunt tier), and the 🫧 taunt easter egg. Plus the
// carried-over note + logo-brand checks. Drives Edge headless against the built dist/.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");
const EDGE = process.env.HG_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/" || p === "/my-swimmer/" || p === "/my-swimmer") p = "/index.html";
  p = p.replace(/^\/my-swimmer/, "");
  const file = path.join(DIST, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(fs.readFileSync(path.join(DIST, "index.html")));
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

const log = [];
const ok = (c, m) => { log.push(`${c ? "PASS" : "FAIL"}: ${m}`); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}/my-swimmer/`;

const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => log.push("PAGEERROR: " + e.message));

  // Seed: one meet (two entries) + two swimmers (mine + watch).
  await page.goto(base);
  await page.evaluate(() => {
    const meet = {
      id: "m1", title: "Test Meet", importedAt: Date.now(), source: "upload",
      entries: [
        { event: 1, race: "100 Free", desc: "Girls 10 & Under 100 SC Yard Freestyle", heat: "Heat 1 of 1 Finals", lane: 4, name: "Doe, Amy", age: "10", team: "ABC", seed: "1:10.00", session: null },
        { event: 2, race: "50 Free", desc: "Boys 11-12 50 SC Yard Freestyle", heat: "Heat 1 of 1 Finals", lane: 3, name: "Roe, Ben", age: "12", team: "XYZ", seed: "30.00", session: null },
      ],
    };
    localStorage.setItem("role", "parent");
    localStorage.setItem("meets", JSON.stringify([meet]));
    localStorage.setItem("swimmers", JSON.stringify([
      { id: "s1", name: "Doe, Amy", team: "ABC", age: 10, gender: "Girls", color: "#0b3d91" },
      { id: "s2", name: "Roe, Ben", team: "XYZ", age: 12, gender: "Boys", color: "#1f9d57", watch: true },
    ]));
  });
  await page.reload({ waitUntil: "networkidle0" });

  const clickTab = async (re) => {
    const handles = await page.$$(".tabs button");
    for (const h of handles) {
      const txt = await page.evaluate((el) => el.textContent.trim(), h);
      if (re.test(txt)) { await h.click(); await sleep(300); return true; }
    }
    return false;
  };

  // --- Nav is Home / Swimmers / Live, plus a gear ---
  const tabs = await page.$$eval(".tabs button", (bs) => bs.map((b) => b.textContent.trim()));
  ok(tabs.length === 3, `Three primary tabs (got ${tabs.length}: ${tabs.join("|")})`);
  ok(tabs.some((t) => /live/i.test(t)), "Live tab present");
  ok(!tabs.some((t) => /watch|progress|team|about|add meet/i.test(t)), "No Watching/Progress/Teams/About/Add-meet tabs");
  ok((await page.$(".gear-btn")) !== null, "Gear (settings) button present");

  // --- Swimmers hub shows BOTH mine and watch in one screen ---
  await clickTab(/swimmer/i);
  let body = await page.evaluate(() => document.body.innerText);
  ok(/Amy/.test(body) && /Ben/.test(body), "Swimmers hub shows mine (Amy) and watch (Ben) together");
  ok(/By team|Search/i.test(body), "Find card offers Search / By-team modes");

  // --- Progress folded into Home (collapsible) ---
  await clickTab(/home|today|day/i);
  await sleep(200);
  const progToggle = await page.$$eval("button", (bs) => bs.findIndex((b) => /Progress/i.test(b.textContent)));
  ok(progToggle >= 0, "Progress section toggle present on Home");

  // --- Settings screen: add-meet, theme, language, taunt tiers, about ---
  await page.click(".gear-btn");
  await sleep(300);
  const settingsText = await page.evaluate(() => document.body.innerText);
  ok(/Add a meet/i.test(settingsText), "Settings: Add-a-meet row");
  ok(/Theme/i.test(settingsText), "Settings: theme control");
  ok(/Kind|Cheeky|Savage/i.test(settingsText), "Settings: taunt tier control");
  ok(/About/i.test(settingsText), "Settings: About row");
  // Default taunt tier persists as 'mild'
  const tier = await page.evaluate(() => JSON.parse(localStorage.getItem("tauntTier") || '"mild"'));
  ok(tier === "mild", `Taunt tier defaults to mild (got ${tier})`);

  // --- 🫧 taunt easter egg: tap the brand 5× → a taunt pops ---
  await clickTab(/home|today|day/i);
  await sleep(150);
  for (let i = 0; i < 5; i++) { await page.click(".brand"); await sleep(60); }
  await sleep(150);
  const taunt = await page.$(".taunt-pop");
  ok(taunt !== null, "Taunt easter egg pops after 5 logo taps");

  // --- Per-event note saves + displays (carried over) ---
  await clickTab(/home|today|day/i);
  await sleep(300);
  const addBtn = await page.$$("button");
  let noteOpened = false;
  for (const b of addBtn) {
    const t = await page.evaluate((el) => el.textContent, b);
    if (/note/i.test(t) && /add|note/i.test(t)) { await b.click(); noteOpened = true; break; }
  }
  ok(noteOpened, "Found an add-note control on an event card");
  if (noteOpened) {
    await page.waitForSelector("textarea.note-input", { timeout: 2000 });
    await page.type("textarea.note-input", "Great underwaters!");
    await page.evaluate(() => document.querySelector("textarea.note-input").blur());
    await sleep(300);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("notes") || "{}"));
    ok(Object.values(saved).includes("Great underwaters!"), `Note persisted (${JSON.stringify(saved)})`);
  }

  // --- Logo brand color sets header background (carried over) ---
  await page.evaluate(() => { localStorage.setItem("brandColor", "#e8123a"); });
  await page.reload({ waitUntil: "networkidle0" });
  const brandVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand").trim());
  ok(brandVar === "#e8123a", `--brand CSS var applied (${brandVar})`);
} finally {
  console.log("\n" + log.join("\n"));
  await browser.close();
  server.close();
}
