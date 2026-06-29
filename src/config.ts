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

// Where the in-app "Feedback" button sends people — a Google Form (works for testers AND at
// release; not GitHub, which is too techy for parents and was only ever a fallback). Defaults
// to the live form so it's correct in the native app builds too (which don't pass the env var).
// During TestFlight/Play testing, testers also have the store's built-in screenshot feedback.
export const FEEDBACK_URL: string =
  import.meta.env.VITE_FEEDBACK_URL || "https://forms.gle/EmQcAHaMxBTg3QJU6";

// Optional tip jar (free app, no ads). Shown in About.
export const KOFI_URL: string = import.meta.env.VITE_KOFI_URL || "https://ko-fi.com/chesler410";

// AI post-meet feedback (swimmer + coach team summary) is DISABLED for now: it was costing
// per-tap Anthropic spend and, with the current context-gathering, kept summarizing only one
// swimmer. Kept dark behind this flag (UI hidden, Worker route untouched) so it can be switched
// back on once it's cheaper and the per-swimmer context bug is fixed. Flip to true to restore.
export const FEEDBACK_ENABLED = false;

// Optional obfuscation token for the AI /feedback endpoint. Empty by default (the endpoint is
// protected by the Worker's rate limits + your Anthropic spend cap). If you later set the APP_TOKEN
// secret on the Worker, ALSO rebuild the apps with VITE_APP_TOKEN set to the same value — otherwise
// feedback returns 403. Leave BOTH unset to rely on rate limits alone (recommended for testing).
export const APP_TOKEN: string = import.meta.env.VITE_APP_TOKEN || "";
