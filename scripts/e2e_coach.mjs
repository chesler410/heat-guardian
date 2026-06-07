// E2E: coach onboarding — role prompt → pick team → whole team on the home screen.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]).replace(/^\/my-swimmer/, "");
  if (p === "/" || p === "") p = "/index.html";
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

await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/my-swimmer/`;
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => log.push("PAGEERROR: " + e.message));

  // Seed a meet with two swimmers on team PASA, and NO role/swimmers (fresh user).
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.removeItem("role");
    localStorage.removeItem("coachTeam");
    localStorage.removeItem("swimmers");
    localStorage.setItem("meets", JSON.stringify([{
      id: "m1", title: "Conference Champs", importedAt: Date.now(), source: "upload",
      entries: [
        { event: 1, race: "100 Free", desc: "Girls 10 & Under 100 SC Yard Freestyle", heat: "Heat 1 of 1 Finals", lane: 4, name: "Doe, Amy", age: "10", team: "PASA", seed: "1:08.45", session: null },
        { event: 2, race: "50 Free", desc: "Boys 11-12 50 SC Yard Freestyle", heat: "Heat 1 of 1 Finals", lane: 3, name: "Roe, Ben", age: "12", team: "PASA", seed: "28.90", session: null },
        { event: 3, race: "50 Free", desc: "Girls 10 & Under 50 SC Yard Freestyle", heat: "Heat 1 of 1 Finals", lane: 2, name: "Lee, Mia", age: "9", team: "DACA", seed: "33.10", session: null },
      ],
    }]));
  });
  await page.reload({ waitUntil: "networkidle0" });

  // --- Role prompt appears on first run ---
  const body0 = await page.evaluate(() => document.body.innerText);
  ok(/parent or a coach/i.test(body0), "Role prompt shown on first run");
  const tabs0 = await page.$$(".tabs button");
  ok(tabs0.length === 0, "No tabs shown until a role is chosen");

  // Click the Coach option
  const clickByText = async (sel, re) => {
    for (const h of await page.$$(sel)) {
      const txt = await page.evaluate((el) => el.textContent.trim(), h);
      if (re.test(txt)) { await h.click(); await new Promise((r) => setTimeout(r, 300)); return true; }
    }
    return false;
  };
  ok(await clickByText(".role-opt", /coach/i), "Picked the Coach role");

  // --- Team picker appears ---
  const body1 = await page.evaluate(() => document.body.innerText);
  ok(/pick your team/i.test(body1), "Team picker shown after choosing Coach");
  // both teams listed
  ok(/PASA/.test(body1) && /DACA/.test(body1), "Teams from imported meet are listed");
  ok(await clickByText(".team-list .result", /PASA/), "Picked team PASA");

  // --- Coach home shows the whole PASA team (Amy + Ben), not DACA's Mia ---
  await new Promise((r) => setTimeout(r, 400));
  const body2 = await page.evaluate(() => document.body.innerText);
  ok(/Amy/.test(body2) && /Ben/.test(body2), "Coach home shows all PASA swimmers (Amy + Ben)");
  ok(!/Mia/.test(body2), "Other team's swimmer (Mia/DACA) is not shown");

  // Simplified coach home: team stats shown, parent fueling/prep fluff hidden
  ok(!!(await page.$(".teamstats")), "coach home shows the team-stats summary");
  ok(!(await page.$(".fuel")), "fueling/hydration section hidden in coach mode");
  ok(/Team at a glance/i.test(body2), "team-stats heading present");

  // Coach bar + tab set
  ok(/Coach · PASA/.test(body2) || /PASA/.test(body2), "Coach bar shows the chosen team");
  const tabNames = await page.$$eval(".tabs button", (bs) => bs.map((b) => b.textContent.trim()));
  ok(!tabNames.some((t) => /^Swimmers$|^Watching$/.test(t)), `Parent-only tabs hidden in coach mode (tabs: ${tabNames.join("|")})`);
  ok(tabNames.some((t) => /Progress/i.test(t)), "Progress tab still available to coach");

  // Persists across reload
  await page.reload({ waitUntil: "networkidle0" });
  const body3 = await page.evaluate(() => document.body.innerText);
  ok(/Amy/.test(body3) && !/parent or a coach/i.test(body3), "Coach + team persist across reload (no re-prompt)");

  // --- Switch team returns to the picker ---
  ok(await clickByText(".coach-switch", /.+/), "Clicked Switch team");
  const body4 = await page.evaluate(() => document.body.innerText);
  ok(/pick your team/i.test(body4), "Switch team returns to the team picker");
} finally {
  console.log("\n" + log.join("\n"));
  await browser.close();
  server.close();
}
