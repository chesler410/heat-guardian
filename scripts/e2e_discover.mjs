// E2E: the meet directory ("Find a meet near you") embedded in the Add meet screen.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json" };

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
  await page.goto(base);
  await page.evaluate(() => localStorage.setItem("role", "parent"));
  await page.reload({ waitUntil: "networkidle0" });

  // Discover is NOT a separate tab anymore — it lives on Add meet.
  const tabs = await page.$$eval(".tabs button", (b) => b.map((x) => x.textContent.trim()));
  ok(!tabs.some((t) => /discover/i.test(t)), `No standalone Discover tab (tabs: ${tabs.join("|")})`);

  // Open Add meet
  for (const h of await page.$$(".tabs button")) {
    const txt = await page.evaluate((el) => el.textContent.trim(), h);
    if (/add meet|import/i.test(txt)) { await h.click(); break; }
  }
  await new Promise((r) => setTimeout(r, 400));

  ok(!!(await page.$(".discover")), "Meet directory card present on Add meet");
  const body = await page.evaluate(() => document.body.innerText);
  ok(/Find a meet near you/i.test(body), "Friendly heading shown");
  ok(/GPAC Tom Lalor/i.test(body), "Seeded meet (GPAC Tom Lalor) listed");
  ok(/Pensacola, FL/.test(body), "Meet location shown");
  ok(/Jun 5.?.?Jun 7, 2026|Jun 5–7, 2026/.test(body), `Date range formatted (${(body.match(/Jun[^\n]*2026/) || ["?"])[0]})`);

  // Has an "Open meet page" action (seed has infoUrl), and a Suggest link
  const openLink = await page.$$eval("a.chip", (as) => as.map((a) => a.textContent.trim()));
  ok(openLink.some((x) => /open meet page/i.test(x)), `Open-meet-page action present (${openLink.join("|")})`);
  ok(/Suggest a meet/i.test(body), "Suggest-a-meet CTA present");

  // State filter exists and lists FL
  const opts = await page.$$eval(".disc-state option", (o) => o.map((x) => x.textContent.trim()));
  ok(opts.includes("FL"), `State filter includes FL (${opts.join(",")})`);
} finally {
  console.log("\n" + log.join("\n"));
  await browser.close();
  server.close();
}
