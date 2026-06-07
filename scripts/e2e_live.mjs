// E2E: Live results — point the poller at a real results PDF (served same-origin) and
// verify it auto-overlays the swum time onto a matching swimmer, with banner + status.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".pdf": "application/pdf" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  // Serve real sample PDFs from the repo's samples/ dir (the "live results" source).
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

  // Seed: parent role, a swimmer who appears in results1.pdf, and a matching heat-sheet meet
  // (slower seed) so the live results have an event to overlay onto.
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.setItem("role", "parent");
    localStorage.setItem("swimmers", JSON.stringify([
      { id: "s1", name: "Bornstein, Cassia", team: "X", age: 10, gender: "Girls", color: "#0b3d91" },
    ]));
    localStorage.setItem("meets", JSON.stringify([{
      id: "m1", title: "Long Course Meet", importedAt: Date.now(), source: "upload",
      entries: [{ event: 1, race: "800 Free", desc: "Girls 10 & Under 800 LC Meter Freestyle", heat: "Heat 1 of 1 Finals", lane: 4, name: "Bornstein, Cassia", age: "10", team: "X", seed: "15:15.00", session: null }],
    }]));
  });
  await page.reload({ waitUntil: "networkidle0" });

  const clickTab = async (re) => {
    for (const h of await page.$$(".tabs button")) {
      const txt = await page.evaluate((el) => el.textContent.trim(), h);
      if (re.test(txt)) { await h.click(); await new Promise((r) => setTimeout(r, 250)); return true; }
    }
    return false;
  };

  // --- Live card present in Import ---
  await clickTab(/add meet|import/i);
  ok(!!(await page.$(".live-card")), "Live results card present in Import");

  // Enter the results URL and Start live
  await page.type(".live-card input.field", resultsUrl);
  const startBtn = await page.$(".live-card button.primary");
  await startBtn.click();

  // The poller fires immediately; wait for the overlay to land.
  let filled = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 300));
    filled = await page.evaluate(() => JSON.parse(localStorage.getItem("results") || "{}"));
    if (Object.keys(filled).length) break;
  }
  ok(filled && filled["m1|1|Bornstein, Cassia"] === "13:56.62", `Live poll overlaid the finals time 13:56.62 (got ${JSON.stringify(filled)})`);

  const liveOn = await page.evaluate(() => localStorage.getItem("liveOn"));
  ok(liveOn === "1", "liveOn persisted");
  const status = await page.evaluate(() => document.querySelector(".live-status")?.textContent || "");
  ok(/filled|1/.test(status), `Live status reports a fill (${status})`);

  // --- Home shows the LIVE banner and the swum time ---
  await clickTab(/home|today/i);
  await new Promise((r) => setTimeout(r, 300));
  ok(!!(await page.$(".live-banner")), "LIVE banner shown on Home while live is on");
  const homeText = await page.evaluate(() => document.body.innerText);
  ok(/13:56\.62/.test(homeText), "Home shows the overlaid swum time");

  // --- Stop live clears the banner ---
  await clickTab(/add meet|import/i);
  const stopBtn = await page.$(".live-card button.secondary");
  await stopBtn.click();
  await new Promise((r) => setTimeout(r, 200));
  ok((await page.evaluate(() => localStorage.getItem("liveOn"))) === "0", "Stop live clears liveOn");
  await clickTab(/home|today/i);
  await new Promise((r) => setTimeout(r, 200));
  ok(!(await page.$(".live-banner")), "LIVE banner gone after stopping");
} finally {
  console.log("\n" + log.join("\n"));
  await browser.close();
  server.close();
}
