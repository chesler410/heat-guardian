// Unit test for the Hy-Tek "Results to the Web" parser (live-results format). Bundles the
// pure src/hytek.ts with esbuild (no pdf.js dep) and asserts finisher extraction against an
// ANONYMIZED sample in the real meetresults.com <pre> column layout (fake names — no PII).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "scripts", "_hytek.bundle.mjs");
execSync(`npx esbuild "${path.join(root, "src", "hytek.ts")}" --bundle --format=esm --outfile="${out}" --platform=node`, { stdio: "inherit" });
const { parseHytekHtml, looksLikeHytekHtml } = await import("file://" + out.replace(/\\/g, "/"));
fs.rmSync(out, { force: true });

// Real Hy-Tek "Results to the Web" layout (single <pre>), names anonymized.
const SAMPLE = `<html><body><pre>
                                    HY-TEK's MEET MANAGER 8.0 6/20/2026 01:28 PM
            2026 Sample Spring Invitational
        June 26 - 28, 2026 | Sample Aquatic Center
                                    Results
Event 1  Girls 10 & Under 100 Yard Freestyle
===============================================================================
    Name                    Age School                  Seed     Finals
===============================================================================
  1 Doe, Amy                  10 TNT-SE                  1:10.00  1:08.50
                  33.10       1:08.50 (35.40)
  2 Roe, Beth Ann             10 ABC                       NT     1:12.30
Event 2  Boys 11-12 50 Yard Butterfly
===============================================================================
    Name                    Age School                  Seed     Finals
===============================================================================
  1 Smith, John               12 XYZ                     30.00    28.95
 -- Jones, Sam                11 DEF                       NT       DQ
</pre></body></html>`;

const log = [];
const ok = (c, m) => { log.push((c ? "PASS" : "FAIL") + ": " + m); if (!c) process.exitCode = 1; };

ok(looksLikeHytekHtml(SAMPLE), "detects Hy-Tek HTML");
const { title, finishers } = parseHytekHtml(SAMPLE);
ok(/2026 Sample Spring Invitational/.test(title), `title (${title})`);
ok(finishers.length === 3, `3 finishers, DQ skipped (got ${finishers.length})`);
const amy = finishers.find((f) => /Doe, Amy/.test(f.name));
ok(amy?.finals === "1:08.50", `Amy finals = last time on row, not split (${amy?.finals})`);
ok(/SC Yard/.test(amy?.desc || ""), `desc normalized Yard->SC Yard (${amy?.desc})`);
const beth = finishers.find((f) => /Roe, Beth Ann/.test(f.name));
ok(beth?.finals === "1:12.30", `multi-word first name + NT seed (${beth?.finals})`);
const john = finishers.find((f) => /Smith, John/.test(f.name));
ok(john?.finals === "28.95", `finals after a numeric seed (${john?.finals})`);
ok(!finishers.some((f) => /Jones/.test(f.name)), "DQ row (no time) excluded");

console.log("\n" + log.join("\n"));
