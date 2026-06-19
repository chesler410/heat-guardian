// Generate the 1024² icon master + 2732² splash screens that @capacitor/assets needs
// (it only had assets/logo.svg before). Rasterizes the SVG with sharp (already a dep).
// Run: node scripts/build_app_icons.mjs   — then CI's `capacitor-assets generate` fans
// these out to every iOS/Android icon + splash size.
import sharp from "sharp";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const A = (f) => resolve(root, "assets", f);
const svg = readFileSync(A("logo.svg"));
const BG = "#06243f"; // app background_color (matches manifest + capacitor.config.ts)

// High density so the 64-viewBox SVG rasterizes crisp at large sizes.
const render = (px) => sharp(svg, { density: 2400 }).resize(px, px);

// 1024² icon master — the navy rounded tile is already in the SVG, so this works as the
// plain logo source; capacitor-assets derives all icon sizes (incl. maskable) from it.
await render(1024).png().toFile(A("logo.png"));

// Splash: the logo centered on the app's navy at ~36% of the canvas, light + dark the same
// (the brand is already dark, so one treatment reads well on both).
async function splash(file) {
  const S = 2732;
  const logo = await render(Math.round(S * 0.36)).png().toBuffer();
  await sharp({ create: { width: S, height: S, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toFile(A(file));
}
await splash("splash.png");
await splash("splash-dark.png");

console.log("Wrote assets/logo.png (1024²), splash.png + splash-dark.png (2732²).");
