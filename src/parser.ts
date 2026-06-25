// In-browser Hy-Tek heat-sheet parser. Uses pdf.js text item coordinates to extract a
// Word[] per page, then hands off to the pure pipeline in heatsheet.ts (which detects
// columns from the "Lane"/"Heat" headers, stitches columns column-major, and parses
// events/heats/lanes). The pipeline lives in its own worker-free module so it can be
// unit-tested in node (scripts/test_pdf_parse.mjs).
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Finisher } from "./hytek";
import { Word, RawEntry, ParsedPdf, buildParsed, findTitle } from "./heatsheet";
export type { Finisher, RawEntry, ParsedPdf };
export { looksLikeHytekHtml, parseHytekHtml } from "./hytek";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

function pageWords(tc: any): Word[] {
  return tc.items
    .filter((it: any) => typeof it.str === "string" && it.str.trim())
    .map((it: any) => ({ x: it.transform[4], y: it.transform[5], s: it.str.trim() }));
}

// Parse a PDF, auto-detecting a heat sheet vs a results sheet.
export async function parsePdf(data: ArrayBuffer): Promise<ParsedPdf> {
  const doc = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise; // 0=errors only (mute font warnings)
  const pages: Word[][] = [];
  let title = "Meet";
  for (let p = 1; p <= doc.numPages; p++) {
    const words = pageWords(await (await doc.getPage(p)).getTextContent());
    if (p === 1) title = findTitle(words);
    pages.push(words);
  }
  return buildParsed(pages, title);
}
