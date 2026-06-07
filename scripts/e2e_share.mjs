// E2E: shareable meet link — a ?add=<links> deep link offers to import on a teammate's
// device, and Home shows a Share button for url-imported meets.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.startsWith("/samples/")) {
    const f = path.join(ROOT, p);
    if (fs.existsSync(f)) { res.writeHead(200, { "Content-Type": "application/pdf" }); return res.end(fs.readFileSync(f)); }
    res.writeHead(404); return res.end("no");
  }
  p = p.replace(/^\/my-swimmer/, "");
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
const port = server.address().port;
const base = `http://localhost:${port}/my-swimmer/`;
const resultsUrl = `http://localhost:${port}/samples/results1.pdf`;

const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => log.push("PAGEERROR: " + e.message));

  // Seed a recipient: parent role, a swimmer in results1.pdf, and a matching heat-sheet meet.
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.setItem("role", "parent");
    localStorage.setItem("swimmers", JSON.stringify([{ id: "s1", name: "Bornstein, Cassia", team: "X", age: 10, gender: "Girls", color: "#0b3d91" }]));
    localStorage.setItem("meets", JSON.stringify([{
      id: "m1", title: "Long Course Meet", importedAt: Date.now(), source: "upload",
      entries: [{ event: 1, race: "800 Free", desc: "Girls 10 & Under 800 LC Meter Freestyle", heat: "Heat 1 of 1 Finals", lane: 4, name: "Bornstein, Cassia", age: "10", team: "X", seed: "15:15.00", session: null }],
    }]));
  });

  // --- Open a shared meet link (what a teammate would tap) ---
  const payload = encodeURIComponent(JSON.stringify({ t: "Shared State Champs", u: resultsUrl }));
  await page.goto(`${base}?add=${payload}`, { waitUntil: "networkidle0" });
  let body = await page.evaluate(() => document.body.innerText);
  ok(/shared with you/i.test(body), "Shared-meet prompt appears from the link");
  ok(/Shared State Champs/.test(body), "Shared meet title shown");

  // Tap "Import this meet"
  let clicked = false;
  for (const b of await page.$$(".share-import button.primary")) { await b.click(); clicked = true; break; }
  ok(clicked, "Tapped Import this meet");

  let filled = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 300));
    filled = await page.evaluate(() => JSON.parse(localStorage.getItem("results") || "{}"));
    if (Object.keys(filled).length) break;
  }
  ok(filled && filled["m1|1|Bornstein, Cassia"] === "13:56.62", `Shared link imported + overlaid 13:56.62 (${JSON.stringify(filled)})`);
  const urlNow = await page.evaluate(() => location.search);
  ok(urlNow === "", "?add= param cleared after import");

  // --- Share button on a url-imported meet (has sourceUrl) ---
  await page.evaluate((u) => {
    localStorage.setItem("meets", JSON.stringify([{
      id: "m2", title: "Linked Meet", importedAt: Date.now(), source: "url", sourceUrl: u,
      entries: [{ event: 1, race: "800 Free", desc: "Girls 10 & Under 800 LC Meter Freestyle", heat: "Heat 1 of 1 Finals", lane: 4, name: "Bornstein, Cassia", age: "10", team: "X", seed: "15:15.00", session: null }],
    }]));
  }, resultsUrl);
  await page.goto(base, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 400));
  ok(!!(await page.$(".meet-share")), "Share button shown on a url-imported meet");

  // A meet WITHOUT sourceUrl (uploaded) should not show Share
  await page.evaluate(() => {
    const m = JSON.parse(localStorage.getItem("meets"));
    m[0].source = "upload"; delete m[0].sourceUrl;
    localStorage.setItem("meets", JSON.stringify(m));
  });
  await page.reload({ waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 300));
  ok(!(await page.$(".meet-share")), "No Share button for an uploaded (no-URL) meet");
} finally {
  console.log("\n" + log.join("\n"));
  await browser.close();
  server.close();
}
