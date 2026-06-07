// E2E: real GPAC heat sheet → meet.start captured, and Home session headers show
// "Day N · Weekday, Mon D — Part".
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");
const PDF = path.join(__dirname, "..", "samples", "gpac", "1564078.pdf");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]).replace(/^\/my-swimmer/, "");
  if (p === "/" || p === "") p = "/index.html";
  const file = path.join(DIST, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(fs.readFileSync(path.join(DIST, "index.html"))); }
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
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("role", "parent");
    localStorage.setItem("view", "cards");
    localStorage.setItem("swimmers", JSON.stringify([{ id: "s1", name: "Hughes", team: "TNT-SE", age: 10, gender: "Girls", color: "#0b3d91" }]));
  });
  await page.reload({ waitUntil: "networkidle0" });
  for (const h of await page.$$(".tabs button")) { const t = await page.evaluate((el) => el.textContent.trim(), h); if (/add meet|import/i.test(t)) { await h.click(); break; } }
  await page.waitForSelector('input[type=file]', { timeout: 3000 });
  await (await page.$('input[type=file]')).uploadFile(PDF);
  let meets = [];
  for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 500)); meets = await page.evaluate(() => JSON.parse(localStorage.getItem("meets") || "[]")); if (meets.length) break; }
  ok(meets.length === 1, `heat sheet imported (${meets.length} meet)`);
  ok(meets[0] && meets[0].start === "2026-06-05", `meet start date captured (${meets[0]?.start})`);

  // go Home
  for (const h of await page.$$(".tabs button")) { const t = await page.evaluate((el) => el.textContent.trim(), h); if (/home|today/i.test(t)) { await h.click(); break; } }
  await new Promise((r) => setTimeout(r, 600));
  const heads = await page.$$eval(".session-head", (els) => els.map((e) => e.textContent.trim()));
  console.log("session heads:", JSON.stringify(heads));
  ok(heads.some((h) => /Day 1/.test(h)), "session header shows Day 1");
  ok(heads.some((h) => /Friday/.test(h) && /Jun 5/.test(h)), "header shows weekday + date (Friday, Jun 5)");
  ok(heads.some((h) => /Day 2/.test(h) && /Jun 6/.test(h)), "Day 2 maps to Jun 6");
  ok(heads.some((h) => /Day 3/.test(h) && /Jun 7/.test(h)), "Day 3 maps to Jun 7");
} finally {
  console.log("\n" + log.join("\n"));
  await browser.close();
  server.close();
}
