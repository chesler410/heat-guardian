import type { CapacitorConfig } from "@capacitor/cli";

// Wraps the built web app (dist/) into native iOS + Android shells. The web build
// for Capacitor must use base "/" (the default — only the GitHub Pages build sets
// APP_BASE=/heat-guardian/), so assets resolve from the app root.
// Note: the bundle id stays com.chesler410.nextheat (registered before the rename to
// Heat Guardian) — a bundle id never has to match the display name.
const config: CapacitorConfig = {
  appId: "com.chesler410.nextheat",
  appName: "Heat Guardian",
  webDir: "dist",
  backgroundColor: "#06243f",
  ios: { contentInset: "always" },
  // Route window.fetch through native HTTP on iOS/Android so it bypasses the WebView's CORS
  // (which blocked the meet-link/proxy fetch on phones — desktop browsers were fine). On web
  // this is a no-op, so the Cloudflare proxy still covers CORS-blocked hosts there.
  plugins: { CapacitorHttp: { enabled: true } },
};

export default config;
