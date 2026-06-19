# Appify Heat Guardian (iOS + Android)

Goal: ship the current PWA to the App Store and Google Play with the least work,
reusing the Apple pipeline already proven in the **health-rpg** repo.

## Why this is easy here
Heat Guardian is a **web app (React/Vite PWA)**. Unlike health-rpg (native SwiftUI →
needs a separate Kotlin app for Android), we wrap the *same* web build with
**Capacitor** to get **both** an iOS and an Android app from one codebase. No UI
rebuild, no backend, no health APIs.

## What we reuse from health-rpg (the hard part — already done)
- **Apple Developer Program membership** (team prefix `com.chesler410`). Heat Guardian
  becomes `com.chesler410.nextheat`.
- **Mac-less iOS builds.** health-rpg's `.github/workflows/testflight.yml` builds on
  a **`macos-15` GitHub Actions runner** and uploads to TestFlight using an
  **App Store Connect API key** (`-allowProvisioningUpdates`, automatic signing).
  Those secrets are **account-level and reusable**:
  - `APPSTORE_CONNECT_KEY_ID`, `APPSTORE_CONNECT_ISSUER_ID`, `APPSTORE_CONNECT_KEY_BASE64`
  - `APPLE_TEAM_ID`
  Copy those four secrets into the heat-guardian repo and the iOS upload "just works"
  from CI — **no Mac required.**
- Reference docs in health-rpg: `testflight-setup.md`, `signing-durable-fix.md`,
  `appstore-listing.md`, `mac-quickstart.md`, `adhoc-kid-device.md`.

## Costs
- **Apple Developer Program** — $99/yr (already have it). Publish under it.
- **Google Play Developer** — **$25 one-time**.
- Capacitor, Android Studio, GitHub Actions macOS minutes — free (within limits).

## Android (fully doable on Windows, no device)
1. `npx cap add android` → an Android Studio project wrapping `dist/`.
2. Build the signed **.aab** in Android Studio (or CI on `ubuntu-latest`).
3. Test in **Android Studio's emulator** (AVD → Pixel). No physical device needed.
4. Google Play → **Internal testing** track → invite testers by email.
- Capacitor **bundles the web app inside the binary**, so we avoid the TWA
  `/.well-known/assetlinks.json` problem of a github.io subpath.

## iOS (no Mac — via CI)
1. CI step `npx cap add ios` + `npx cap sync` on the macOS runner.
2. `xcodebuild archive` → export `.ipa` → upload via the App Store Connect API key
   (mirror health-rpg's `testflight.yml`, minus the Supabase/Sentry xcconfig bits).
3. Create the app record in App Store Connect (bundle `com.chesler410.nextheat`).
4. TestFlight → internal testers (your phone, wife, parents).
- Local Mac work is optional; only needed if you want to run the iOS Simulator.

## Prerequisites in the web app
- **Re-enable offline** — swap the current `selfDestroying` service worker back to a
  real precaching PWA SW (Capacitor serves bundled assets, so the old github.io
  cache/scope issues don't apply inside the app shell). Stores expect offline.
- **App icons + splash** — one 1024² master → `@capacitor/assets` generates all sizes.
- **Privacy policy URL** — see `docs/privacy.md` (local-first: nothing is collected),
  host it (GitHub Pages) and link it in both store listings.
- **Store listing** — name ("Heat Guardian — Meet Day"), short/long description,
  screenshots (phone + tablet), category Sports, age rating 4+.

## Recommended order
1. Re-enable offline SW + generate icons (web-side, Windows).
2. `npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android` + `cap init`.
3. **Android first** (entirely on Windows): emulator → Play internal track.
4. **iOS via CI**: copy the 4 Apple secrets from health-rpg's repo, add a Capacitor
   TestFlight workflow, ship to TestFlight.
5. Public release once both internal tracks look good.

## Your one-time setup checklist (the parts only you can do)

Code/CI is in place: `capacitor.config.ts` (appId `com.chesler410.nextheat`),
`.github/workflows/ios-testflight.yml`, `.github/workflows/android-release.yml`,
icon source `assets/logo.svg`. Native folders (`ios/`, `android/`) are generated in CI.

**iOS (no Mac):**
1. App Store Connect → **create the app** (bundle `com.chesler410.nextheat`, name "Heat Guardian").
2. In the heat-guardian GitHub repo → Settings → Secrets → Actions, **copy these 4 from the
   health-rpg repo** (account-level, reusable): `APPSTORE_CONNECT_KEY_ID`,
   `APPSTORE_CONNECT_ISSUER_ID`, `APPSTORE_CONNECT_KEY_BASE64`, `APPLE_TEAM_ID`.
3. Run the **iOS TestFlight** workflow (Actions tab → Run workflow). It builds + uploads.
   - If automatic signing churns, fall back to health-rpg's manual-keychain steps.

**Android ($25 one-time):**
1. Pay the **Google Play Developer** registration ($25, one time).
2. Create an **upload keystore** (command in `android-release.yml`); set 4 secrets:
   `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
   `ANDROID_KEY_PASSWORD`.
3. Run the **Android build** workflow → download the `.aab` artifact → Play Console →
   Internal testing → upload. (Emulator testing via Android Studio AVD, no device needed.)

**Both stores:** host `docs/privacy.md` (link it in each listing), add screenshots +
descriptions. App icon auto-generates from `assets/logo.svg`.

## Notes / guardrails
- COPPA: local-first means **no data collection**, so we're a normal Sports app, not
  the strict Kids Category — but keep the privacy policy explicit about it.
- Apple 4.2 ("minimum functionality"): we're a real bundled app with offline + native
  share/calendar, not a thin web shell, so this isn't a concern.
- Keep the PWA on GitHub Pages too — the web version stays the no-install option.
