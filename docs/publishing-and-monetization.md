# Publishing & monetization playbook

Everything for taking Heat Guardian to a paid-ready public release. Nothing here is urgent —
it's the checklist for "when you're ready to get this next step out there."

_Last updated: 2026-06-29._

## 1. Business structure — individual + Small Business Program (for income)

You want income, so **stay an individual developer** and enroll in the Small Business Program.
Do **not** use the nonprofit fee waiver — it waives the $99 but **legally bars in-app purchases /
selling digital goods**, so you couldn't earn anything.

- Apple Developer Program: **$99/yr** (individual is fine; no LLC needed to start).
- **Small Business Program** → **15%** commission instead of 30% (you qualify under $1M/yr, or
  auto-qualify as a new developer). Enroll in App Store Connect → it applies ~15 days after the
  enrolling fiscal month. Re-confirm yearly.
- Google Play: **$25 one-time**.
- (Revisit an LLC only once real money flows — it's a liability/tax decision, not a requirement.)

Refs: developer.apple.com/app-store/small-business-program/ · developer.apple.com/help/account/membership/fee-waivers/

## 2. Rate-us prompt

**Shipped, dormant.** `src/config.ts` has `APP_STORE_URL` / `PLAY_STORE_URL` (empty) and
`rateUrl()`. The `⭐ Rate Heat Guardian` button in About appears once a store URL is set.

- **After launch:** set `VITE_APP_STORE_URL` and `VITE_PLAY_STORE_URL` (CI env or in `config.ts`)
  to the live listings → the button lights up and picks the right store per platform.
- **Optional nicer upgrade — native in-app review popup** (rate without leaving the app):
  - Add a Capacitor plugin, e.g. `@capacitor-community/in-app-review`.
  - `npx cap sync` (the CI build runs `cap add ios/android` + `cap sync`, so the plugin is picked up).
  - Call `InAppReview.requestReview()` at a positive moment (e.g. after a meet's last heat is
    marked complete, once per version, throttled by Apple). Falls back to the store link on web.
  - Ask the agent to wire this — it's small, but can't be verified on web (native-only).

## 3. Support / tip In-App Purchase (RevenueCat)

Cleanest path for tips on both stores. **Free app + a "Support Heat Guardian" tip** (consumables,
e.g. $1.99 / $4.99 / $9.99).

**You do (one-time):**
1. Create a **RevenueCat** account (free tier).
2. Sign Apple's **Paid Applications Agreement** (App Store Connect → Agreements) + set up banking/tax.
3. Create the tip products in **App Store Connect** (consumable IAPs) and **Play Console**.
4. Connect them in RevenueCat; grab the **public SDK key** + **product/offering IDs**.
5. Hand the agent the key + IDs.

**Agent does:**
- Add `@revenuecat/purchases-capacitor`, build a Support/Tip UI (About/Settings), gate it so it's
  inert until configured (like `FEEDBACK_ENABLED`), wire purchase + restore.
- Validate together on a TestFlight/internal build (IAP can't be tested on web or without sandbox).

## 4. Feedback after publishing (no accounts needed)

- **In-app Feedback form** (Google Form, `FEEDBACK_URL`) keeps working. **Turn on email
  notifications:** Form → Responses → ⋮ → "Get email notifications for new responses."
- **App Store / Play reviews** — public; **reply** to them from the consoles.
- **Keep a TestFlight beta track running in parallel** post-launch — engaged parents stay there and
  give rich, screenshot feedback before each update.
- **Optional upgrade:** route in-app feedback through the Cloudflare Worker → email/push you
  (uses the Cloudflare Email Service). More reliable notifications than the form. Build when ready.

## 5. Notes / guardrails

- **No external donation links inside native apps** — Ko-fi stays web-only (gated by `IS_NATIVE`).
  Native tips must go through store billing (handled by RevenueCat).
- **"Subscribe to your team"** would require **accounts + minors' data** — a real privacy/compliance
  step-up that breaks the current local-first, no-accounts, COPPA-friendly model. Keep it behind a
  clear demand signal; it's the line where the app gains a backend identity layer.
- Version is **held at 0.1.2** until Apple review clears (only build numbers increment).
