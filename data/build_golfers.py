#!/usr/bin/env python3
"""
Build the Puttle golfer dataset (the golfer-guessing game on weiddle.com).

TWO sources merge here:

  1. data/golfers_seed.py — the curated ~90 marquee names. Their golf numbers
     (majors / PGA wins / turned-pro year) are hand-verified, so for any golfer
     that also appears in the bulk pool the SEED values win.

  2. data/.cache_golf/stats.json — the bulk pool (~2.9k golfers) scraped from
     Wikipedia {{Infobox golfer}} by golf_universe.py + golf_stats.py. This is
     what powers the deep Hard/Extreme tiers the seed alone can't reach.

Clue columns the live grid shows: Country, Age (from DOB), Turned Pro, Majors,
PGA Wins. (Handedness was dropped — it isn't sourceable for thousands of players,
so it would have been a near-constant "Right" that silently lies about lefties.)

TIERS are assigned by RANK on a composite fame score, not a single threshold:
`majors*5 + pgaWins` (the old gate) only reaches ~800 golfers, far short of the
target pool sizes, so we fold in worldwide pro wins and Wikipedia footprint
(recognizability) to spread fame across the long tail, then slice by rank:

    Normal  = top NORMAL_N   (biggest names; Daily draws from here)
    Hard    = top HARD_N
    Extreme = everyone playable

A golfer is "playable" only with a plausible turned-pro year (1900-2026) so the
Turned Pro column is never blank; seed golfers are always playable.

Output: public/golfers.json (the live site hits no API). Border adjacency (the
orange "borders the answer" color) is reused from data/borders.py.

Prereqs (cheap on a warm cache):
    python3 data/golf_universe.py     # Wikidata roster  -> .cache_golf/universe.json
    python3 data/golf_stats.py        # WP infoboxes     -> .cache_golf/stats.json
Then:
    python3 data/build_golfers.py [--refresh]
"""

import json
import os
import sys
from datetime import datetime, timezone

from build_dataset import norm_name
from golfers_seed import GOLFERS

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(HERE, "..", "public", "golfers.json")
STATS_PATH = os.path.join(HERE, ".cache_golf", "stats.json")
GENDER_PATH = os.path.join(HERE, ".cache_golf", "gender.json")

# Target tier sizes (cumulative pools). Rank cutoffs, so sizes are guaranteed
# regardless of how lumpy the fame distribution is.
NORMAL_N = 650     # target 500-750
HARD_N = 1250      # target 1000-1500
# Extreme = all playable (target 2000+)

PRO_WINS_CAP = 250  # De Vicenzo ~229 is real; anything above is a parse artifact.

# Wikidata country labels -> the nationality vocabulary borders.py knows. Labels
# not listed pass through unchanged (already-correct ones like "Japan", "Sweden",
# "England"); any that borders.py still can't place just lose orange bordering,
# which build_borders reports and tolerates.
COUNTRY_NORM = {
    "United States": "USA",
    "United States of America": "USA",
    "United Kingdom": "United Kingdom",
    "United Kingdom of Great Britain and Ireland": "United Kingdom",
    "People's Republic of China": "China",
    "Republic of China": "Taiwan",
    "Chinese Taipei": "Taiwan",
    "Empire of Japan": "Japan",
    "Kingdom of Denmark": "Denmark",
    "Kingdom of the Netherlands": "Netherlands",
    "Czech Republic": "Czechia",
    "Republic of Ireland": "Ireland",
    "Republic of Korea": "South Korea",
    "Korea": "South Korea",
    "Soviet Union": "Russia",
    "Russian Federation": "Russia",
    "Kingdom of Great Britain": "United Kingdom",
    "German Reich": "Germany",
    "West Germany": "Germany",
}


def norm_country(c):
    return COUNTRY_NORM.get(c, c)


def fame(majors, pga, pro, sitelinks):
    """Composite recognizability+accomplishment score used only for tier ranking.

    Majors dominate (a multi-major great must outrank a journeyman), PGA wins
    next, then worldwide pro wins and Wikipedia language coverage fill in the
    long tail so Hard/Extreme have enough depth. Tuned by eyeballing the top of
    the ranking and the tier boundaries (see the --report output)."""
    pro = min(pro or 0, PRO_WINS_CAP)
    return (majors or 0) * 12 + (pga or 0) * 3 + pro * 0.5 + (sitelinks or 0) * 1.0


def load_bulk():
    if not os.path.exists(STATS_PATH):
        print(f"[warn] {STATS_PATH} missing — run golf_universe.py then golf_stats.py",
              file=sys.stderr)
        return []
    return json.load(open(STATS_PATH))


def load_genders():
    """qid -> "male"/"female"/"other" from golf_gender.py; {} if not built yet."""
    if not os.path.exists(GENDER_PATH):
        print(f"[warn] {GENDER_PATH} missing — run golf_gender.py to drop women's "
              f"golfers (building with everyone for now)", file=sys.stderr)
        return {}
    return json.load(open(GENDER_PATH))


def playable_year(y):
    return isinstance(y, int) and 1900 <= y <= 2026


def build(report=False):
    bulk = load_bulk()
    genders = load_genders()
    by_name = {}  # normalized name -> record
    dropped_women = 0

    # 1) Bulk pool first (lower priority; seed overwrites below).
    for r in bulk:
        # Puttle is a men's-golf game; the gender-neutral infobox lets women in,
        # so drop anyone Wikidata (P21, via golf_gender.py) marks female. Missing
        # gender is treated as not-female so a man with sparse Wikidata survives.
        if genders.get(r.get("qid")) == "female":
            dropped_women += 1
            continue
        y = r.get("turnedPro")
        if not playable_year(y):
            continue  # keep the Turned Pro column honest
        key = norm_name(r["name"])
        if not key:
            continue
        by_name[key] = {
            "name": r["name"],
            "country": norm_country(r["country"]),
            "dob": str(r["dob"])[:10],
            "turnedPro": y,
            "majors": r.get("majors") or 0,
            "pgaWins": r.get("pgaWins") or 0,
            "proWins": min(r.get("proWins") or 0, PRO_WINS_CAP),
            "sitelinks": r.get("sitelinks") or 0,
        }

    # 2) Curated seed — authoritative for its golfers. Reuse a bulk match's
    #    sitelinks/proWins (fame inputs) when the seed golfer is also in bulk.
    for name, country, hand, dob, turned_pro, majors, pga_wins in GOLFERS:
        key = norm_name(name)
        prev = by_name.get(key, {})
        by_name[key] = {
            "name": name,
            "country": country,                       # seed country is border-safe
            "dob": str(dob)[:10],
            "turnedPro": turned_pro,
            "majors": majors,
            "pgaWins": pga_wins,
            "proWins": prev.get("proWins", pga_wins),  # fallback if unseen in bulk
            "sitelinks": prev.get("sitelinks", 0),
            "seed": True,
        }

    golfers = list(by_name.values())

    # Fame + rank-based tiers (1 Normal, 2 Hard, 3 Extreme).
    for g in golfers:
        g["fame"] = round(fame(g["majors"], g["pgaWins"], g["proWins"], g["sitelinks"]), 1)
    golfers.sort(key=lambda g: (-g["fame"], g["name"]))
    for i, g in enumerate(golfers):
        g["tier"] = 1 if i < NORMAL_N else (2 if i < HARD_N else 3)

    if report:
        print(f"\n[report] {len(golfers)} playable golfers", file=sys.stderr)
        print(f"  Normal (tier 1): {sum(1 for g in golfers if g['tier']==1)}", file=sys.stderr)
        print(f"  Hard   (tier<=2): {sum(1 for g in golfers if g['tier']<=2)}", file=sys.stderr)
        print(f"  Extreme(all):     {len(golfers)}", file=sys.stderr)
        print("  --- top 25 (Normal head; Daily pool) ---", file=sys.stderr)
        for g in golfers[:25]:
            print(f"    {g['fame']:>7}  {g['name']} ({g['country']}) "
                  f"maj={g['majors']} pga={g['pgaWins']} pro={g['proWins']} sl={g['sitelinks']}",
                  file=sys.stderr)
        print(f"  --- Normal/Hard boundary (#{NORMAL_N}) ---", file=sys.stderr)
        for g in golfers[NORMAL_N-3:NORMAL_N+3]:
            print(f"    {g['fame']:>7}  {g['name']} ({g['country']}) maj={g['majors']} pga={g['pgaWins']}",
                  file=sys.stderr)
        print(f"  --- Hard/Extreme boundary (#{HARD_N}) ---", file=sys.stderr)
        for g in golfers[HARD_N-3:HARD_N+3]:
            print(f"    {g['fame']:>7}  {g['name']} ({g['country']}) maj={g['majors']} pga={g['pgaWins']}",
                  file=sys.stderr)

    # Strip internal-only fields, sort alphabetically for the shipped file.
    out_golfers = []
    for g in sorted(golfers, key=lambda g: g["name"]):
        out_golfers.append({
            "name": g["name"],
            "country": g["country"],
            "dob": g["dob"],
            "turnedPro": g["turnedPro"],
            "majors": g["majors"],
            "pgaWins": g["pgaWins"],
            "fame": g["fame"],
            "tier": g["tier"],
        })

    try:
        from borders import build_borders, build_continents
        countries = {g["country"] for g in out_golfers}
        borders = build_borders(countries)
        continents = build_continents(countries)
    except Exception as e:
        print(f"[borders] skipped ({e})", file=sys.stderr)
        borders = {}
        continents = {}

    out = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "count": len(out_golfers),
            "tiers": {"normal": NORMAL_N, "hard": HARD_N, "extreme": len(out_golfers)},
            "source": "curated seed (majors/wins/turned-pro) + Wikipedia infobox bulk pool",
        },
        "golfers": out_golfers,
        "borders": borders,
        "continents": continents,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    print(f"[done] {len(out_golfers)} golfers -> {OUT_PATH} "
          f"(Normal {sum(1 for g in out_golfers if g['tier']==1)}, "
          f"Hard {sum(1 for g in out_golfers if g['tier']<=2)}, "
          f"Extreme {len(out_golfers)}; {len(borders)} countries with borders; "
          f"dropped {dropped_women} women's golfers)",
          file=sys.stderr)


if __name__ == "__main__":
    build(report="--report" in sys.argv or "-r" in sys.argv)
