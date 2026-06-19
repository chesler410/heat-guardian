import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { writeFileSync } from "fs";
import { resolve } from "path";

// Unique id per build; baked into the app AND written to version.json so open tabs can
// detect a new deploy and prompt a refresh.
const buildId = process.env.BUILD_ID || String(Date.now());

// The GitHub Pages web build sets APP_BASE (the /heat-guardian/ subpath); the Capacitor
// native build leaves it unset (base "/"). We use that to split service-worker behavior:
//   - Pages (web): selfDestroying — unregisters old SWs + clears caches, the fix for the
//     stale-cache blank pages that rapid deploys caused. Offline stays off on the web.
//   - Native (Capacitor): a real precaching SW so the app works offline, which the app
//     stores expect. The stale-cache risk doesn't apply — Capacitor serves bundled assets.
// Either way the in-app refresh banner (version.json poll) still prompts updates.
const isPagesWeb = !!process.env.APP_BASE;

// base must match the GitHub Pages subpath when deployed there.
export default defineConfig({
  base: process.env.APP_BASE ?? "/",
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    {
      name: "emit-version",
      writeBundle(options) {
        writeFileSync(resolve(options.dir || "dist", "version.json"), JSON.stringify({ id: buildId }));
      },
    },
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false, // we register manually (below) so the scope respects base
      // See isPagesWeb above: web stays self-destroying (stale-cache fix, offline off),
      // native gets a real precaching SW (offline on, expected by the stores).
      selfDestroying: isPagesWeb,
      includeAssets: ["favicon.svg"],
      workbox: {
        // Precache the app shell + the pdf.js worker (it's larger than the 2 MB default),
        // so heat-sheet parsing works offline inside the native app.
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,ico,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        name: "Heat Guardian",
        short_name: "Heat Guardian",
        description: "Meet-day companion: your swimmer's events, cuts, and fueling.",
        theme_color: "#0b3d91",
        background_color: "#06243f",
        display: "standalone",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ]
      }
    })
  ]
});
