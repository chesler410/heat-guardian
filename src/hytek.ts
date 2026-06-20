// Pure Hy-Tek text/HTML results parsing — no pdf.js, so it runs in Node (unit-testable) and
// in the browser. Used for the live-results path: Hy-Tek "Real-Time Results to the Web" pages.

export interface Finisher {
  event: number;
  desc: string;
  name: string;
  finals: string;
}

// Does this text look like a Hy-Tek "Results to the Web" page (live or static)?
export function looksLikeHytekHtml(text: string): boolean {
  return /HY-TEK/i.test(text) && /\bEvent\s+\d+/i.test(text);
}

// Parse a Hy-Tek "Real-Time Results to the Web" page — the live-results format hosts publish.
// It's a single <pre> block of column-aligned text: "Event N <desc>", then result rows
// "place  Last, First  Year/Age  Team  Seed  Finals" with indented split lines beneath. Same
// column layout as the results PDFs, so it yields the same Finisher[] the live overlay consumes.
export function parseHytekHtml(html: string): { title: string; finishers: Finisher[] } {
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(html);
  const text = (pre ? pre[1] : html)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
  const lines = text.split(/\r?\n/);

  // Meet name = a centered line near the top (starts with the year, not the HY-TEK banner).
  let title = "Live results";
  for (let i = 0; i < Math.min(lines.length, 14); i++) {
    const l = lines[i].trim();
    if (/^\d{4}\b/.test(l) && l.length > 12 && !/HY-TEK/i.test(l)) { title = l; break; }
  }

  // Hy-Tek HTML abbreviates the course ("Yard"/"Meter"); eventMeta wants the full form. Yards
  // are always SCY; Meters default to LCM (most age-group summer meets) — refine if needed.
  const normDesc = (d: string) =>
    d.replace(/(?<!SC |LC )\bYard\b/g, "SC Yard").replace(/(?<!SC |LC )\bMeter\b/g, "LC Meter");

  const finishers: Finisher[] = [];
  let ev: number | null = null;
  let desc = "";
  const timeRe = /\b(\d{1,2}:\d{2}\.\d{2}|\d{1,3}\.\d{2})\b/g;
  for (const raw of lines) {
    const em = /^Event\s+(\d+)\s+(.+?)\s*$/.exec(raw.trim());
    if (em) { ev = parseInt(em[1], 10); desc = normDesc(em[2].trim()); continue; }
    if (ev == null) continue;
    // result row: a place (1, *1 tie, --) then "Last, First", then a 2+ space column gap.
    const rm = /^\s*(?:\*?\d+|--)\s+([A-Za-z][\w.'\-]*(?:\s[A-Za-z][\w.'\-]*)*,\s*[A-Za-z][\w.'\- ]*?)\s{2,}/.exec(raw);
    if (!rm) continue;
    const times = raw.match(timeRe);
    if (!times || !times.length) continue; // skip DQ/NS/SCR rows (no time to overlay)
    finishers.push({ event: ev, desc, name: rm[1].replace(/\s+/g, " ").trim(), finals: times[times.length - 1] });
  }
  return { title, finishers };
}
