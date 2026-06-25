// Proves the host-bridge round trip: two Hy-Tek "Real-Time Results to the Web" per-event files
// (the kind MM writes to c:\realtime) → mergeRealtime() (what GET /live/<code> returns) → the
// app's existing looksLikeHytekHtml()/parseHytekHtml() → Finisher[]. No app changes needed.
import { mergeRealtime, extractPre } from "../proxy/live.js";
import { looksLikeHytekHtml, parseHytekHtml } from "../src/hytek.ts";

// A realistic single-event MM realtime page: one <pre> with a banner then "Event N …" rows.
const eventFile = (n, title, rows) =>
  `<html><head><title>${title}</title></head><body><pre>\n` +
  `                     2026 SE Richard Quick Invitational\n` +
  `                                Results\n\n` +
  `Event ${n}\n${rows}\n` +
  `</pre></body></html>`;

const f1 = {
  name: "Event0001.htm",
  text: eventFile(
    "1  Girls 13 & Over 50 LC Meter Butterfly",
    "Event 1",
    "=====================================================================\n" +
      "  1 Modlin, Emmie D          14 SA-GA              33.45      33.19\n" +
      "  2 Duckett, Annisto         15 NWGA-GA            33.50      33.61\n" +
      "  3 Walker, Aurelie J        21 WAKE-SE            28.72      28.40"
  ),
};
const f2 = {
  name: "Event0002.htm",
  text: eventFile(
    "2  Boys 13 & Over 50 LC Meter Butterfly",
    "Event 2",
    "=====================================================================\n" +
      "  1 Odam, Hayden             16 TNT-SE             26.43      26.10\n" +
      " --  Seiple, Carter R        18 HSC-IL             27.34         DQ"
  ),
};

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS: " : "FAIL: ") + msg); if (!cond) fail++; };

// Merge in REVERSE order to confirm numeric-name sorting orders events 1 then 2.
const merged = mergeRealtime([f2, f1], "Richard Quick — Live");

ok(looksLikeHytekHtml(merged), "merged page is recognized as Hy-Tek HTML");
const { finishers } = parseHytekHtml(merged);

ok(finishers.length === 5, `parsed 5 finishers across 2 events (got ${finishers.length})`);
ok(finishers.filter((f) => f.event === 1).length === 3, "event 1 has 3 finishers");
ok(finishers.filter((f) => f.event === 2).length === 2, "event 2 has 2 finishers (DQ row kept — has a time)");

const emmie = finishers.find((f) => /Modlin/.test(f.name));
ok(emmie && emmie.finals === "33.19", `Modlin finals = last (finals) time 33.19 (got ${emmie && emmie.finals})`);
ok(emmie && /50 LC Meter Butterfly/.test(emmie.desc), "event desc carried through (50 LC Meter Butterfly)");

ok(/Event 1/.test(merged) && merged.indexOf("Event 1") < merged.indexOf("Event 2"), "events ordered 1 before 2 despite reversed input");
ok(extractPre("<pre>a &amp; b</pre>") === "a & b", "extractPre unescapes entities");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
