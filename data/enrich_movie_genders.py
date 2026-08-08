#!/usr/bin/env python3
"""One-shot enrichment: add directorGender / leadActorGender to the EXISTING
public/movies.json, sourced entirely from the cached TMDB credits (no API calls,
so the locked 1000-film set is preserved exactly).

TMDB gender codes: 0 unknown, 1 female, 2 male, 3 non-binary.

build_movies.py already emits these fields for future full builds; this script
just backfills the current dataset without re-curating the pool.

Run:  python3 data/enrich_movie_genders.py
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, ".cache_movies")
OUT_PATH = os.path.join(HERE, "..", "public", "movies.json")


def cached_detail(mid):
    """Return the cached /movie/{id} detail dict for a TMDB id, or None."""
    hits = glob.glob(os.path.join(CACHE_DIR, f"tmdb*movie_{mid}_append*"))
    if not hits:
        return None
    with open(hits[0]) as f:
        return json.load(f)


def genders_for(mid):
    d = cached_detail(mid)
    if not d:
        return None, None
    credits = d.get("credits") or {}
    cast = sorted((credits.get("cast") or []), key=lambda c: c.get("order", 999))
    lead_gender = cast[0].get("gender") if cast else None
    director = next((c for c in (credits.get("crew") or [])
                     if c.get("job") == "Director"), None)
    dir_gender = director.get("gender") if director else None
    return dir_gender, lead_gender


def main():
    with open(OUT_PATH) as f:
        data = json.load(f)
    movies = data["movies"]

    missing = 0
    for m in movies:
        dir_g, lead_g = genders_for(m["id"])
        if dir_g is None and lead_g is None:
            missing += 1
        # Insert in a stable spot next to the name each describes.
        m["leadActorGender"] = lead_g
        m["directorGender"] = dir_g

    # Re-key each record so gender sits beside its name (nicer diffs / readability).
    ordered = []
    for m in movies:
        o = {}
        for k, v in m.items():
            if k == "leadActorGender" or k == "directorGender":
                continue
            o[k] = v
            if k == "leadActor":
                o["leadActorGender"] = m["leadActorGender"]
            if k == "director":
                o["directorGender"] = m["directorGender"]
        ordered.append(o)
    data["movies"] = ordered

    with open(OUT_PATH, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    from collections import Counter
    print(f"[done] {len(movies)} films enriched -> {OUT_PATH}", file=sys.stderr)
    print("  director gender:", dict(Counter(m["directorGender"] for m in ordered)), file=sys.stderr)
    print("  lead actor gender:", dict(Counter(m["leadActorGender"] for m in ordered)), file=sys.stderr)
    if missing:
        print(f"  WARNING: {missing} films had no cached detail (genders left null)", file=sys.stderr)


if __name__ == "__main__":
    main()
