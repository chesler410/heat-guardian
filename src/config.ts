import { Capacitor } from "@capacitor/core";

// True only inside the native iOS/Android shell (false on the web PWA). Used to hide the
// Ko-fi tip jar in store builds — Apple/Google restrict external donation links, so the
// tip jar lives on the web version only; native monetization (if any) must use store billing.
export const IS_NATIVE = Capacitor.isNativePlatform();

// One shared fetch helper for the whole app, set once by the site owner (not per user).
// Set VITE_PROXY_URL at build time (see .github/workflows/deploy.yml) to the deployed
// Cloudflare Worker, using {url} where the link goes:
//   https://my-swimmer-fetch.<account>.workers.dev/?url={url}
// When set, "paste a link" works for everyone with no setup. When empty, the app falls
// back to a direct fetch (works only for CORS-friendly hosts) and nudges users to Upload.
export const DEFAULT_PROXY: string = import.meta.env.VITE_PROXY_URL ?? "";

// Where the in-app "Feedback" button sends people. Set repo variable FEEDBACK_URL to a
// Google Form (or Tally/Typeform) link. Falls back to the GitHub issues page.
export const FEEDBACK_URL: string =
  import.meta.env.VITE_FEEDBACK_URL || "https://github.com/chesler410/heat-guardian/issues";

// Optional tip jar (free app, no ads). Shown in About.
export const KOFI_URL: string = import.meta.env.VITE_KOFI_URL || "https://ko-fi.com/chesler410";
