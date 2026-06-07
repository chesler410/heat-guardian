// E2E for feedback fixes: arm-table highlights achieved-cut rows (tinted by level),
// and time inputs allow ":" (inputMode text, not decimal/numeric).
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
  await page.evaluate(() => {
    localStorage.setItem("role", "parent");
    localStorage.setItem("view", "table");
    localStorage.setItem("swimmers", JSON.stringify([{ id: "s1", name: "Doe, Amy", team: "X", age: 10, gender: "Girls", color: "#0b3d91" }]));
    localStorage.setItem("meets", JSON.stringify([{
      id: "m1", title: "SCY Meet", importedAt: Date.now(), source: "upload",
      entries: [
        // Blazing time → should achieve a cut (row highlighted)
        { event: 1, race: "50 Free", desc: "Girls 10 & Under 50 SC Yard Freestyle", heat: "Heat 1 of 1 Finals", lane: 4, name: "Doe, Amy", age: "10", team: "X", seed: "25.00", session: null },
        // NT → no cut (row not highlighted)
        { event: 2, race: "100 Free", desc: "Girls 10 & Under 100 SC Yard Freestyle", heat: "Heat 1 of 1 Finals", lane: 4, name: "Doe, Amy", age: "10", team: "X", seed: "NT", session: null },
      ],
    }]));
  });
  await page.reload({ waitUntil: "networkidle0" });

  // Arm table is the default view (set above). Check highlight.
  await page.waitForSelector("table.arm", { timeout: 3000 });
  const rows = await page.$$eval("table.arm tbody tr", (trs) => trs.map((tr) => ({ cls: tr.className, txt: tr.innerText })));
  ok(rows.length === 2, `2 arm-table rows (${rows.length})`);
  const ach = rows.filter((r) => /arm-ach/.test(r.cls));
  ok(ach.length === 1, `exactly one achieved row highlighted (${ach.length})`);
  ok(ach[0] && /lvl-/.test(ach[0].cls), `achieved row tinted by level (${ach[0]?.cls})`);
  ok(ach[0] && /✓/.test(ach[0].txt), "achieved row shows a ✓ marker");
  const ntRow = rows.find((r) => /100|NT/.test(r.txt));
  ok(ntRow && !/arm-ach/.test(ntRow.cls), "NT event row is not highlighted");

  // --- Colon fix: time inputs use inputMode text (so ':' is typeable on mobile) ---
  await page.evaluate(() => localStorage.setItem("view", "cards"));
  await page.reload({ waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 300));
  ok(!!(await page.$(".fuel")), "parent mode still shows the fueling section");
  // click the first "add time" control
  for (const b of await page.$$(".result-entry button")) { await b.click(); break; }
  await page.waitForSelector("input.result-input", { timeout: 2000 });
  const im = await page.$eval("input.result-input", (el) => el.getAttribute("inputmode"));
  ok(im === "text", `time input uses inputMode="text" (was decimal) → colon typeable (${im})`);
  // and it accepts a colon value
  await page.type("input.result-input", "1:08.45");
  const val = await page.$eval("input.result-input", (el) => el.value);
  ok(val === "1:08.45", `colon accepted in time field (${val})`);
} finally {
  console.log("\n" + log.join("\n"));
  await browser.close();
  server.close();
}
