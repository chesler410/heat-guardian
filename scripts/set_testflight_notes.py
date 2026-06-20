#!/usr/bin/env python3
"""Set the TestFlight "What to Test" notes on the just-uploaded build, via the App Store
Connect API. NON-FATAL: if the build isn't queryable yet (still processing) it warns and
exits 0 so it never fails the release — you can always set notes by hand in App Store Connect.

Env:
  ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (.p8 path), APP_BUNDLE_ID, BUILD_NUMBER, TEST_NOTES
Needs: pyjwt[crypto].
"""
import json, os, sys, time, urllib.request
import jwt  # PyJWT

KEY_ID = os.environ["ASC_KEY_ID"]
ISSUER = os.environ["ASC_ISSUER_ID"]
KEY = open(os.environ["ASC_KEY_PATH"]).read()
BUNDLE = os.environ["APP_BUNDLE_ID"]
NUMBER = os.environ["BUILD_NUMBER"]
NOTES = (os.environ.get("TEST_NOTES") or "").strip() or "Internal build."
BASE = "https://api.appstoreconnect.apple.com"


def token() -> str:
    now = int(time.time())
    return jwt.encode({"iss": ISSUER, "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"},
                      KEY, algorithm="ES256", headers={"kid": KEY_ID, "typ": "JWT"})


def api(method: str, path: str, body=None):
    req = urllib.request.Request(
        BASE + path, method=method,
        headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body else None)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def main() -> int:
    try:
        apps = api("GET", f"/v1/apps?filter[bundleId]={BUNDLE}").get("data", [])
        if not apps:
            print("::warning::app not found for bundle " + BUNDLE); return 0
        app_id = apps[0]["id"]
        build = None
        for _ in range(8):  # poll ~4 min for the build to register (it uploads, then processes)
            data = api("GET", f"/v1/builds?filter[app]={app_id}&filter[version]={NUMBER}&limit=1").get("data", [])
            if data:
                build = data[0]; break
            time.sleep(30)
        if not build:
            print("::warning::build not queryable yet — set 'What to Test' in App Store Connect"); return 0
        bid = build["id"]
        locs = api("GET", f"/v1/builds/{bid}/betaBuildLocalizations").get("data", [])
        enus = next((l for l in locs if l["attributes"]["locale"] == "en-US"), None)
        if enus:
            api("PATCH", f"/v1/betaBuildLocalizations/{enus['id']}",
                {"data": {"type": "betaBuildLocalizations", "id": enus["id"], "attributes": {"whatsToTest": NOTES}}})
        else:
            api("POST", "/v1/betaBuildLocalizations",
                {"data": {"type": "betaBuildLocalizations",
                          "attributes": {"locale": "en-US", "whatsToTest": NOTES},
                          "relationships": {"build": {"data": {"type": "builds", "id": bid}}}}})
        print(f"Set 'What to Test' on build {NUMBER}.")
    except Exception as e:  # never fail the release over test notes
        print(f"::warning::could not set test notes: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
