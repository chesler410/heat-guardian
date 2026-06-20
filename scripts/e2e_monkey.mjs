// Monkey test 🐒 — unleashes random clicks / typing / select / navigation on the built app
// and FAILS on any pageerror, console error, or ErrorBoundary trip. Catches crashes from
// interaction sequences no scripted test would think to try (the app's ErrorBoundary +
// self-heal mean a crash shows a fallback screen — the monkey surfaces what triggers it).
// Browser via $HG_BROWSER (CI sets Chrome; default = local Edge). Actions via $MONKEY_ACTIONS.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");
const BROWSER = process.env.HG_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const ACTIONS = Number(process.env.MONKEY_ACTIONS || 500);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/" || p === "/my-swimmer/" || p === "/my-swimmer" || p === "/heat-guardian/" || p === "/heat-guardian") p = "/index.html";
  p = p.replace(/^\/(my-swimmer|heat-guardian)/, "");
  const file = path.join(DIST, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(fs.readFileSync(path.join(DIST, "index.html")));
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: "new", args: ["--no-sandbox"] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text().slice(0, 200)); });

  // Seed realistic data so there's a full UI to maul (parent role, a meet, two swimmers).
  await page.goto(base);
  await page.evaluate(() => {
    const meet = {
      id: "m1", title: "Monkey Invitational", importedAt: Date.now(), source: "upload", start: new Date().toISOString().slice(0, 10),
      entries: [
        { event: 1, race: "100 Free", desc: "Girls 10 & Under 100 SC Yard Freestyle", heat: "Heat 1 of 1 Finals", lane: 4, name: "Doe, Amy", age: "10", team: "ABC", seed: "1:10.00", session: "Saturday Morning" },
        { event: 2, race: "50 Free", desc: "Boys 11-12 50 SC Yard Freestyle", heat: "Heat 1 of 1 Finals", lane: 3, name: "Roe, Ben", age: "12", team: "XYZ", seed: "30.00", session: "Saturday Morning" },
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

  // Each action: pick a random visible, enabled, in-app control and interact with it.
  const tripped = () => page.evaluate(() => {
    const t = document.body.innerText || "";
    return t.includes("Something went wrong") || t.includes("Couldn't load the app");
  });
  for (let i = 0; i < ACTIONS; i++) {
    await page.evaluate(() => {
      const sel = "button, a, input, select, textarea, [role=button]";
      const els = [...document.querySelectorAll(sel)].filter((e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        if (r.width <= 0 || r.height <= 0 || s.visibility === "hidden" || s.display === "none" || e.disabled) return false;
        if (e.tagName === "A") { const h = e.getAttribute("href") || ""; if (h.startsWith("http") || e.target === "_blank") return false; } // stay in-app
        return true;
      });
      if (!els.length) return;
      const el = els[Math.floor(Math.random() * els.length)];
      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea") {
        const samples = ["1:23.45", "33.10", "Doe, Amy", "TNT", "😀🦈", "<b>x</b>", "999999999", "   ", "2026-06-20", "https://x.test/a.pdf"];
        el.focus();
        el.value = samples[Math.floor(Math.random() * samples.length)];
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (tag === "select") {
        if (el.options.length) { el.selectedIndex = Math.floor(Math.random() * el.options.length); el.dispatchEvent(new Event("change", { bubbles: true })); }
      } else {
        el.click();
      }
    });
    await sleep(6);
    if (await tripped()) { errors.push(`ERRORBOUNDARY tripped at action ${i}`); break; }
  }

  console.log(errors.length ? "FAIL: monkey found problems" : `PASS: ${ACTIONS} monkey actions, no errors`);
  if (errors.length) { console.log(errors.slice(0, 25).join("\n")); process.exitCode = 1; }
} finally {
  await browser.close();
  server.close();
}
