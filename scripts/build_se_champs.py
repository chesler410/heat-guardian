#!/usr/bin/env python3
"""Parse Southeastern Swimming championship qualifying-time PDFs.

Layout per age band (mirrored, dual-course):
    GIRLS[LCM SCY]  <event name>  BOYS[SCY LCM]   x2 age groups across the page,
with "10&UNDER / 11&12 / 13&14 / 15&16 / 17&18" header rows delimiting bands.
For each event token we take the 2 nearest numbers on its left (girls: LCM,SCY)
and the 2 nearest on its right (boys: SCY,LCM); the age is the header above whose
x is nearest the event.

Output: src/se_champs.json -> { course: { gender: { age: { "50 FR": "37.89" } } } }
Usage: python scripts/build_se_champs.py
"""
import json
import re
import fitz

SRC = "samples/se_lc_champs.pdf"
STROKE = {"Free": "FR", "Back": "BK", "Breast": "BR", "Fly": "FL", "IM": "IM"}
AGE_RE = re.compile(r"(8&UNDER|10&UNDER|11&12|13&14|15&16|17&18)", re.I)
EVENT_RE = re.compile(r"^(\d+)\s+(Free|Back|Breast|Fly|IM)$")
NUM_RE = re.compile(r"^[\d:]+\.\d{2}$")


def norm_age(s):
    s = s.upper().replace(" ", "")
    return {"8&UNDER": "10U", "10&UNDER": "10U", "11&12": "11-12",
            "13&14": "13-14", "15&16": "15-16", "17&18": "17-18"}.get(s, s)


def rows_of(page, tol=4):
    words = sorted(page.get_text("words"), key=lambda w: (w[1], w[0]))
    rows, cur, cy = [], [], None
    for w in words:
        if cy is None or abs(w[1] - cy) <= tol:
            cur.append(w)
            cy = w[1] if cy is None else cy
        else:
            rows.append(cur)
            cur, cy = [w], w[1]
    if cur:
        rows.append(cur)
    return rows


STROKES = set(STROKE)


def main():
    out = {}
    for page in fitz.open(SRC):
        ages = []  # current band: list of (x_center, ageKey)
        for row in rows_of(page):
            row = sorted(row, key=lambda w: w[0])
            cx = lambda w: (w[0] + w[2]) / 2
            # event tokens = a distance word (50/100/...) followed by a stroke word
            events = []
            for i in range(len(row) - 1):
                if re.fullmatch(r"\d{2,4}", row[i][4]) and row[i + 1][4] in STROKES:
                    events.append((cx(row[i]), f"{row[i][4]} {STROKE[row[i + 1][4]]}"))
            age_hits = [(cx(w), norm_age(w[4])) for w in row if AGE_RE.fullmatch(w[4])]
            if age_hits and not events:
                ages = age_hits
                continue
            if not ages or not events:
                continue
            nums = [(cx(w), w[4]) for w in row if NUM_RE.match(w[4])]
            for ex, key in events:
                age = min(ages, key=lambda a: abs(a[0] - ex))[1]
                left = sorted([n for n in nums if n[0] < ex], key=lambda n: -n[0])[:2]
                right = sorted([n for n in nums if n[0] > ex], key=lambda n: n[0])[:2]
                left = [v for _, v in sorted(left, key=lambda n: n[0])]   # [LCM, SCY]
                right = [v for _, v in sorted(right, key=lambda n: n[0])]  # [SCY, LCM]
                if len(left) == 2:
                    out.setdefault("LCM", {}).setdefault("Girls", {}).setdefault(age, {})[key] = left[0]
                    out.setdefault("SCY", {}).setdefault("Girls", {}).setdefault(age, {})[key] = left[1]
                if len(right) == 2:
                    out.setdefault("SCY", {}).setdefault("Boys", {}).setdefault(age, {})[key] = right[0]
                    out.setdefault("LCM", {}).setdefault("Boys", {}).setdefault(age, {})[key] = right[1]

    json.dump(out, open("src/se_champs.json", "w", encoding="utf-8"), indent=1)
    for c in out:
        for g in out[c]:
            print(f"{c} {g}: ages={list(out[c][g])} ({sum(len(v) for v in out[c][g].values())} events)")
    print("\ncheck LCM Girls 10U 50 FR (expect 37.89):", out.get("LCM", {}).get("Girls", {}).get("10U", {}).get("50 FR"))
    print("check SCY Girls 10U 50 FR (expect 33.19):", out.get("SCY", {}).get("Girls", {}).get("10U", {}).get("50 FR"))


if __name__ == "__main__":
    main()
