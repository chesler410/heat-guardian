// One shared fetch helper for the whole app, set once by the site owner (not per user).
// Set VITE_PROXY_URL at build time (see .github/workflows/deploy.yml) to the deployed
// Cloudflare Worker, using {url} where the link goes:
//   https://my-swimmer-fetch.<account>.workers.dev/?url={url}
// When set, "paste a link" works for everyone with no setup. When empty, the app falls
// back to a direct fetch (works only for CORS-friendly hosts) and nudges users to Upload.
export const DEFAULT_PROXY: string = import.meta.env.VITE_PROXY_URL ?? "";
