import { Capacitor } from "@capacitor/core";

// True only inside the native iOS/Android shell (false on the web PWA). Used to hide the
// Ko-fi tip jar in store builds — Apple/Google restrict external donation links, so the
// tip jar lives on the web version only; native monetization (if any) must use store billing.
export const IS_NATIVE = Capacitor.isNativePlatform();

// The deployed Cloudflare Worker — one shared backend for the whole app (fetch proxy for
// "paste a link", the R2 share-by-code cache, and AI feedback). The app derives the backend
// base from this URL's origin, so it MUST be present in every build (web AND the native apps),
// not just where VITE_PROXY_URL happens to be set. So it defaults to the live worker rather than
// "" — otherwise share-by-code / feedback show "not set up" in the iOS/Android builds (whose
// build step doesn't pass VITE_PROXY_URL). VITE_PROXY_URL still overrides for web/forks.
export const DEFAULT_PROXY: string =
  import.meta.env.VITE_PROXY_URL || "https://my-swimmer-fetch.ches-hughes.workers.dev/?url={url}";

// Where the in-app "Feedback" button sends people. Set repo variable FEEDBACK_URL to a
// Google Form (or Tally/Typeform) link. Falls back to the GitHub issues page.
export const FEEDBACK_URL: string =
  import.meta.env.VITE_FEEDBACK_URL || "https://github.com/chesler410/heat-guardian/issues";

// Optional tip jar (free app, no ads). Shown in About.
export const KOFI_URL: string = import.meta.env.VITE_KOFI_URL || "https://ko-fi.com/chesler410";
