// The app-icon MASTER is assets/logo.png — the full-bleed navy shield (1024², committed
// directly). In CI, `capacitor-assets generate` fans it out to every iOS/Android icon size.
// This script regenerates the splash screens FROM that same icon, centered on the icon's own
// navy so the tile blends seamlessly into the splash background.
//
// Run after dropping in a new icon:  node scripts/build_app_icons.mjs
import sharp from "sharp";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const A = (f) => resolve(root, "assets", f);
const SRC = A("logo.png");

// Sample the icon's corner so the splash background exactly matches its navy (no visible seam).
const c = await sharp(SRC).extract({ left: 6, top: 6, width: 1, height: 1 }).raw().toBuffer();
const BG = { r: c[0], g: c[1], b: c[2], alpha: 1 };

// Splash: the shield centered at ~40% of a 2732² canvas on the icon's navy. Light + dark are the
// same (the brand is already dark, so one treatment reads well on both).
async function splash(file) {
  const S = 2732;
  const logo = await sharp(SRC).resize(Math.round(S * 0.4)).png().toBuffer();
  await sharp({ create: { width: S, height: S, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toFile(A(file));
}
await splash("splash.png");
await splash("splash-dark.png");

console.log(
  "Regenerated splash.png + splash-dark.png from assets/logo.png (bg #" +
    [c[0], c[1], c[2]].map((x) => x.toString(16).padStart(2, "0")).join("") +
    ")."
);
