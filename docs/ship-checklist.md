# Ship checklist — your one-time setup to get Heat Guardian into the stores

Everything in code/CI is already done. This is the list of steps that need **you**
(accounts, payments, secrets). Work top to bottom; iOS and Android are independent.

Bundle id: **`com.chesler410.nextheat`** · App name: **Heat Guardian**
Workflows: `.github/workflows/ios-testflight.yml`, `.github/workflows/android-release.yml`
(Background + rationale: `docs/appify.md`.)

---

## Step 0 — reusable Apple secrets (account-level, from health-rpg)

⚠️ GitHub secrets are **write-only** — you can't view the values stored in the
health-rpg repo. Re-enter the *source* values into:
**heat-guardian repo → Settings → Secrets and variables → Actions → New repository secret.**

| Secret name | Where to get the value |
|---|---|
| `APPLE_TEAM_ID` | developer.apple.com → Membership details (10-char Team ID) |
| `APPSTORE_CONNECT_KEY_ID` | App Store Connect → Users and Access → Integrations → App Store Connect API → your key's ID |
| `APPSTORE_CONNECT_ISSUER_ID` | same page → "Issuer ID" (UUID at top) |
| `APPSTORE_CONNECT_KEY_BASE64` | base64 of your saved `AuthKey_XXXX.p8`. If you didn't save it, create a new API key (Admin/App Manager role) and download the `.p8` once. |

Make the base64 (PowerShell):
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8")) | Set-Clipboard
```

---

## Step 1 — iOS → TestFlight (no Mac needed)

1. **App Store Connect → Apps → ➕ → New App**
   - Platform: iOS · Name: **Heat Guardian** · Bundle ID: **com.chesler410.nextheat**
     (register the App ID at developer.apple.com → Identifiers if it's not in the dropdown)
   - SKU: anything (e.g. `nextheat`).
2. Confirm the 4 secrets from Step 0 are set in the heat-guardian repo.
3. **GitHub → Actions → "iOS TestFlight" → Run workflow.**
4. Build appears in App Store Connect → TestFlight in ~10–20 min. Add yourself +
   wife/parents as internal testers.
   - If it fails on signing, the fallback is health-rpg's manual-keychain method
     (cert + provisioning-profile secrets) — ping for help, paste the red log.

---

## Step 2 — Android → Google Play ($25 one-time)

1. **Pay the Google Play Developer registration** ($25, one time) at
   play.google.com/console.
2. **Create an upload keystore.** Easiest in **Android Studio** (you'll want it for
   the emulator anyway): Build → Generate Signed App Bundle/APK → "Create new…"
   keystore. Remember the passwords + alias. (CLI alt, needs a JDK:
   `keytool -genkeypair -v -keystore upload-keystore.jks -alias heatguardian -keyalg RSA -keysize 2048 -validity 9125`)
3. Set 4 repo secrets (Actions secrets, same place as Step 0):
   - `ANDROID_KEYSTORE_BASE64` —
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("upload-keystore.jks")) | Set-Clipboard`
   - `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
4. **GitHub → Actions → "Android build (.aab)" → Run workflow** → download the
   `heat-guardian-release-aab` artifact.
5. **Play Console → Create app → Internal testing → Create release → upload the .aab**
   → add testers by email. (Consider enrolling in Play App Signing when prompted.)
6. Test in **Android Studio → Device Manager → create a Pixel emulator** — no
   physical device needed.

---

## Step 3 — store listing (both)

- **Privacy policy URL** (required): host `docs/privacy.md` (e.g. GitHub Pages) and
  paste the link in both listings. It already says "collects nothing."
- **Description**: short + full (the README's "What it does" is a good base).
- **Screenshots**: phone (required) + tablet/iPad. Use `?demo` on the live site for
  a clean sample screen.
- **Category**: Sports · **Age rating**: 4+ / Everyone · **Price**: Free.
- App icon auto-generates from `assets/logo.svg` during the CI build.

---

## Costs recap
- Apple Developer Program — **$99/yr** (already have it).
- Google Play — **$25 once**.
- Everything else (Capacitor, Android Studio, GitHub Actions) — free.

## When you're back
Kick off the **iOS TestFlight** workflow first (fewest steps). If it's green you'll
have it on your phone via TestFlight the same day. Paste any red logs and I'll fix
the workflow — Apple/Gradle first runs sometimes need a one-line tweak.
