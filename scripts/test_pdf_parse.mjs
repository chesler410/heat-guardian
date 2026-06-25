// Node harness for the pure heat-sheet pipeline (src/heatsheet.ts), driven by the SAME
// pdf.js the app uses (legacy build for node). Extracts a Word[] per page, calls buildParsed,
// and reports entry counts so we can catch parser regressions against the sample PDFs.
// Usage: node scripts/test_pdf_parse.mjs [glob-substring]
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildParsed, findTitle } from "../src/heatsheet.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function listPdfs(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) listPdfs(p, acc);
    else if (e.toLowerCase().endsWith(".pdf")) acc.push(p);
  }
  return acc;
}

async function pagesOf(path) {
  const data = new Uint8Array(readFileSync(path));
  const doc = await getDocument({ data, verbosity: 0 }).promise;
  const pages = [];
  let title = "Meet";
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const words = tc.items
      .filter((it) => typeof it.str === "string" && it.str.trim())
      .map((it) => ({ x: it.transform[4], y: it.transform[5], s: it.str.trim() }));
    if (p === 1) title = findTitle(words);
    pages.push(words);
  }
  return { pages, title };
}

const filter = process.argv[2] || "";
const files = listPdfs("samples").filter((f) => f.includes(filter)).sort();
for (const f of files) {
  try {
    const { pages, title } = await pagesOf(f);
    const r = buildParsed(pages, title);
    if (r.kind === "results") {
      console.log(`${f.padEnd(52)} results  finishers=${r.finishers.length}`);
    } else {
      const bad = r.entries.filter((e) => !/^[A-Za-z'.\- ]+,/.test(e.name)).length;
      console.log(
        `${f.padEnd(52)} heat     entries=${String(r.entries.length).padStart(4)}` +
          `  events=${new Set(r.entries.map((e) => e.event)).size}` +
          (bad ? `  BAD_NAMES=${bad}` : "") +
          (r.hint ? `  hint=${r.hint}` : "")
      );
    }
  } catch (e) {
    console.log(`${f.padEnd(52)} ERROR ${e.message}`);
  }
}
