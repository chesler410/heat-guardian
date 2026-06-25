// Pure helpers for the host-bridge live path (shared by the Worker and the node tests).
// The bridge ingests Hy-Tek "Real-Time Results to the Web" HTML files (one per event, the
// files MM writes to c:\realtime) and merges them into ONE Hy-Tek page so the app's existing
// parseHytekHtml() — which reads a single <pre> of "Event N …" rows — consumes them unchanged.

// Text inside the first <pre>…</pre>, else the tag-stripped body. Hy-Tek per-event result
// files are a single <pre> block; this pulls just the column-aligned result text.
export function extractPre(html) {
  const m = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(html || "");
  const body = m ? m[1] : String(html || "").replace(/<[^>]+>/g, "");
  return body
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/\s+$/g, "");
}

// Merge per-event files (sorted by name) into one Hy-Tek page. We keep each file's "Event N …"
// header + rows and drop the repeated banners, then wrap in a single <pre> with a HY-TEK marker
// so looksLikeHytekHtml() passes. Only blocks from the first "Event N" line onward are kept, so
// per-file title/banner lines don't pollute the merged result text.
export function mergeRealtime(files, title = "Live results") {
  const blocks = [];
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    const txt = extractPre(f.text);
    const idx = txt.search(/^\s*Event\s+\d+\b/m);
    if (idx >= 0) blocks.push(txt.slice(idx).replace(/\s+$/g, ""));
  }
  const pre = `${title}\n\nHY-TEK's MEET MANAGER — Real-Time Results\n\n${blocks.join("\n\n")}\n`;
  return `<html><body><pre>\n${pre}\n</pre></body></html>`;
}

// SHA-256 hex (Workers + Node both expose crypto.subtle). Used to store only a HASH of the
// per-meet write token, never the token itself.
export async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
