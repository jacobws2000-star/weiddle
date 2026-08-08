#!/usr/bin/env python3
"""One-shot enrichment: add oscarsWon (count of Academy Awards the film won) to
the EXISTING public/movies.json, parsed from OMDb's cached `Awards` summary — so
no API calls, and the locked 1000-film set is preserved exactly.

OMDb's Awards field reads like:
  "Won 4 Oscars. 34 wins & 71 nominations total"   -> 4
  "Nominated for 6 Oscars. 23 wins & 150 ..."       -> 0 (nominated, didn't win)
  "7 wins & 25 nominations total"                    -> 0 (no Oscars mentioned)
Films with no cached OMDb response fall back to 0 (both such films are non-winners).

build_movies.py also emits oscarsWon for future full builds; this backfills the
current dataset without re-curating the pool.

Run:  python3 data/enrich_movie_oscars.py
"""
import glob
import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, ".cache_movies")
OUT_PATH = os.path.join(HERE, "..", "public", "movies.json")

WON_OSCARS_RE = re.compile(r"\bWon\s+(\d+)\s+Oscar", re.I)


def awards_index():
    """imdbID -> Awards string, from every cached OMDb response."""
    idx = {}
    for p in glob.glob(os.path.join(CACHE_DIR, "*omdb*")):
        try:
            d = json.load(open(p))
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(d, dict) and d.get("imdbID"):
            idx[d["imdbID"]] = d.get("Awards")
    return idx


def oscars_won(imdb_id, idx):
    m = WON_OSCARS_RE.search(idx.get(imdb_id) or "")
    return int(m.group(1)) if m else 0


def main():
    idx = awards_index()
    with open(OUT_PATH) as f:
        data = json.load(f)

    missing = 0
    ordered = []
    for m in data["movies"]:
        if m["imdbId"] not in idx:
            missing += 1
        n = oscars_won(m["imdbId"], idx)
        # Re-emit the record with oscarsWon placed right after boxOffice.
        o = {}
        for k, v in m.items():
            if k == "oscarsWon":
                continue
            o[k] = v
            if k == "boxOffice":
                o["oscarsWon"] = n
        if "oscarsWon" not in o:      # safety: append if boxOffice key absent
            o["oscarsWon"] = n
        ordered.append(o)
    data["movies"] = ordered

    with open(OUT_PATH, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    dist = Counter(m["oscarsWon"] for m in ordered)
    print(f"[done] {len(ordered)} films enriched -> {OUT_PATH}", file=sys.stderr)
    print("  oscarsWon distribution:", dict(sorted(dist.items())), file=sys.stderr)
    print(f"  winners (>=1): {sum(v for k, v in dist.items() if k)} films"
          if False else
          f"  winners (>=1): {sum(1 for m in ordered if m['oscarsWon'])} films;"
          f" max: {max(dist)}", file=sys.stderr)
    if missing:
        print(f"  note: {missing} films had no cached OMDb (oscarsWon=0)", file=sys.stderr)


if __name__ == "__main__":
    main()
