#!/usr/bin/env python3
"""
Build the Puttle golfer dataset (the golfer-guessing game on weiddle.com).

The playable pool is the curated list in data/golfers_seed.py (see that file for
why the golf-specific numbers — majors, PGA Tour wins, turned-pro year — are
curated rather than scraped). This script enriches each seed golfer from ESPN's
public golf API by name:

  - League roster:  sports.core.api.espn.com/v2/sports/golf/leagues/pga/athletes
  - Athlete detail: .../athletes/{id}  ->  citizenship, hand (R/L), dateOfBirth

ESPN's `dateOfBirth` and `hand` are preferred when present (authoritative/fresh);
the seed's values are the fallback (needed for older legends ESPN's current
roster omits). Country always comes from the seed so it matches borders.py.

Output: public/golfers.json  (consumed by the static game; the live site hits no
API). Border adjacency (the orange "borders the answer" color) is reused from
data/borders.py, exactly like the UFC build.

Run:  python3 data/build_golfers.py  [--limit N] [--refresh]
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

# Reuse the UFC builder's cached fetch + name normalizer verbatim.
from build_dataset import fetch, norm_name
from golfers_seed import GOLFERS

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(HERE, "..", "public", "golfers.json")
API = "https://sports.core.api.espn.com/v2/sports/golf/leagues/pga"

# Majors are weighted 5x a regular tour win so a multi-major great outranks a
# high-volume winner. Tiers gate the pool by this fame score (mirrors Cindle's
# voteCount gating); guess counts scale as the pool deepens.
def fame(majors, pga_wins):
    return majors * 5 + pga_wins


def espn_index(refresh=False):
    """Map normalized golfer name -> ESPN athlete detail, from the paginated roster.

    Roster items carry a full `$ref` to each athlete's detail; we fetch those
    directly (all cached). This is the one expensive step, and only on a cold
    cache. Only names we actually need (the seed) get resolved, to keep it cheap.
    """
    want = {norm_name(row[0]) for row in GOLFERS}
    refs = []
    page = 1
    while True:
        try:
            d = fetch(f"{API}/athletes?limit=1000&page={page}", refresh=refresh)
        except RuntimeError:
            break
        refs += [it["$ref"] for it in d.get("items", []) if it.get("$ref")]
        if page >= d.get("pageCount", 1):
            break
        page += 1

    by_name = {}
    for ref in refs:
        if len(by_name) == len(want):
            break  # found everyone we need; skip the rest of the 4000-strong roster
        try:
            d = fetch(ref, refresh=refresh)
        except RuntimeError:
            continue
        name = d.get("displayName") or d.get("fullName")
        key = norm_name(name)
        if key in want and key not in by_name:
            by_name[key] = d
    return by_name


def build(limit=None, refresh=False, use_espn=True):
    seed = GOLFERS[:limit] if limit else GOLFERS
    print(f"[seed] {len(seed)} curated golfers", file=sys.stderr)

    if use_espn:
        print("[espn] indexing ESPN golf roster (cold cache is slow)…", file=sys.stderr)
        espn = espn_index(refresh=refresh)
        print(f"[espn] {len(espn)} ESPN golfers indexed", file=sys.stderr)
    else:
        espn = {}
        print("[espn] skipped (--no-espn); using seed dob/hand as-is", file=sys.stderr)

    golfers = []
    matched = 0
    for name, country, hand, dob, turned_pro, majors, pga_wins in seed:
        d = espn.get(norm_name(name))
        if d:
            matched += 1
            dob = d.get("dateOfBirth") or dob          # prefer ESPN (fresh)
            h = (d.get("hand") or {}).get("abbreviation")
            if h in ("R", "L"):
                hand = h
        # dob is required (drives the Age column); every seed row has one, so this
        # only trips if a row is left blank.
        if not dob:
            print(f"[skip] {name}: no DOB", file=sys.stderr)
            continue
        golfers.append({
            "name": name,
            "country": country,
            "hand": hand,
            "dob": str(dob)[:10],
            "turnedPro": turned_pro,
            "majors": majors,
            "pgaWins": pga_wins,
            "fame": fame(majors, pga_wins),
        })

    golfers.sort(key=lambda g: g["name"])

    # Orange nationality-border adjacency, reused from the UFC pipeline.
    try:
        from borders import build_borders
        borders = build_borders({g["country"] for g in golfers}, refresh=refresh)
    except Exception as e:  # never let border data break the core build
        print(f"[borders] skipped ({e})", file=sys.stderr)
        borders = {}

    out = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "count": len(golfers),
            "source": "curated seed (majors/wins/turned-pro) + ESPN golf API (dob/hand)",
        },
        "golfers": golfers,
        "borders": borders,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    normal = sum(1 for g in golfers if g["fame"] >= 15)
    hard = sum(1 for g in golfers if g["fame"] >= 6)
    print(f"[done] {len(golfers)} golfers -> {OUT_PATH} "
          f"({matched} enriched from ESPN; Normal {normal} [fame>=15], "
          f"Hard {hard} [fame>=6], Extreme {len(golfers)}; "
          f"{len(borders)} countries with borders)", file=sys.stderr)


if __name__ == "__main__":
    args = sys.argv[1:]
    limit = None
    refresh = "--refresh" in args
    use_espn = "--no-espn" not in args
    if "--limit" in args:
        limit = int(args[args.index("--limit") + 1])
    build(limit=limit, refresh=refresh, use_espn=use_espn)
