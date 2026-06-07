import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// base must match the GitHub Pages subpath when deployed there.
export default defineConfig({
  base: process.env.APP_BASE ?? "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false, // we register manually (below) so the scope respects base
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "my-swimmer",
        short_name: "my-swimmer",
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
