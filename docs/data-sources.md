# Data sources research (2026-06-06)

Goal: "marry" swim data across apps via APIs so parents stop tracking by hand.
Finding: **there is no clean public times API anywhere** — which is exactly the unsolved
parent pain. The strategy below works around it.

## Landscape

| Source | Times/results API? | Verdict |
|---|---|---|
| **USA Swimming – Data Hub** (`data.usaswimming.org/datahub`) | No *official* API, but the public Data Hub UI queries a JSON backend. | ✅ Best legit source. Official times history + official time standards. Respect rate limits / terms. Endpoint not yet pinned. |
| **USA Swimming – SWIMS Vendor API** (`thirdparty-api-documentation.swimsmember.org`) | Membership/registration only — explicitly **not** times. Vendor approval required. | ❌ Not useful. |
| **SwimCloud** | No public API. Community scraper `SwimScraper` (PyPI) exists. | ⚠️ Fragile + ToS gray area. Don't depend on it. |
| **Meet Mobile (Active Network)** | `Activity Search API v2` finds meets, not live results. Live results behind paid sub, no public results API. | ❌ for data; reverse-engineering violates ToS. |
| **TeamUnify / OnDeck** | Team-side, auth-gated. | ❌ Not for parents pulling arbitrary swimmers. |

## Resulting data strategy

- **PDF (uploaded) = what's happening at *this* meet.** Heat/lane/seed/schedule. Primary ingest.
- **Data Hub = everything about *my swimmer* historically + the cuts.** Enrichment.
- **Meet Mobile's live role** is reproduced locally: uploaded heat sheet + manual
  "mark heat done" tap. We lose live auto-sync but keep what matters offline.

## To validate next

- [ ] Confirm Data Hub times endpoint + request/response shape (need a swimmer name, or a
      browser network-tab capture of an individual times search).
- [ ] Confirm official time-standard tables are pullable (motivational + championship cuts),
      and how they version per season.

## Reference links

- USA Swimming Data Hub: https://data.usaswimming.org/datahub
- Individual Times Search: https://data.usaswimming.org/datahub/usas/individualsearch
- Individual Event Rank: https://data.usaswimming.org/datahub/usas/timeseventrank
- SWIMS vendor API docs: https://thirdparty-api-documentation.swimsmember.org/
- SwimScraper: https://pypi.org/project/SwimScraper/
- Active/Meet Mobile API forum: https://developer.active.com/forum/read/189066
