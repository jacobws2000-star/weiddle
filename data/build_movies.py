#!/usr/bin/env python3
"""
Build the Weiddle *movie* dataset (the film-guessing game).

Data sources (all fetched at build time, cached, so the live site hits no API):
  - TMDB  (themoviedb.org) — the spine. Discover the popular English pool, then
    per film pull details + credits in one call:
      /discover/movie          curate the pool (popularity / vote_count gated)
      /movie/{id}?append_to_response=credits
        -> title, release year, runtime, genres, revenue (worldwide box office),
           imdb_id, lead actor (cast order 0), director (crew job=Director)
    Auth: v4 Read Access Token in the Authorization header (env TMDB_TOKEN).
  - OMDb  (omdbapi.com) — the IMDb rating, resolved by the imdb_id TMDB hands us.
    Auth: free API key as a query param (env OMDB_KEY).
  - Wikidata (CC0) — FALLBACK rating only, when OMDb has no IMDb rating.

Output: public/movies.json  (consumed by the static game).

LICENSING NOTE (ads are planned for weiddle.com):
  TMDB is free for NON-commercial use with attribution; OMDb/IMDb ratings are
  likewise non-commercial. Six of the seven fields (year, lead actor, genre,
  runtime, director, box office) have CC0 equivalents on Wikidata, and the rating
  already falls back to Wikidata here — so the eventual commercial migration is
  "prefer Wikidata sources", not a rewrite. Revisit sourcing before monetizing.

Run:  TMDB_TOKEN=... OMDB_KEY=... python3 data/build_movies.py
      [--limit N] [--pages P] [--min-votes V] [--refresh]
"""

import argparse
import http.client
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, ".cache_movies")
OUT_PATH = os.path.join(HERE, "..", "public", "movies.json")

TMDB_API = "https://api.themoviedb.org/3"
OMDB_API = "https://www.omdbapi.com/"
WD_SPARQL = "https://query.wikidata.org/sparql"

TMDB_TOKEN = os.environ.get("TMDB_TOKEN", "")
OMDB_KEY = os.environ.get("OMDB_KEY", "")

UA = "weiddle-movies-builder/1.0 (personal project; build-time only)"
SLEEP = 0.05  # polite delay between uncached requests

# --- Curation knobs (tunable; see notes in curate_pool) ------------------------
# The pool is English-language, popular films. We gate on vote_count as the proxy
# for "enough people have seen it" — this lets a cheap-but-popular film in and
# keeps well-funded flops nobody watched out. NOT gated on box office.
DEFAULT_PAGES = 100        # TMDB pages of 20 = up to 2000 candidates before gating
DEFAULT_MIN_VOTES = 300    # vote_count floor; raise for a tighter, more famous pool
DOCUMENTARY_GENRE_ID = 99  # excluded

os.makedirs(CACHE_DIR, exist_ok=True)


# ---------- HTTP with on-disk caching (mirrors build_dataset.py) ----------
def _cache_path(url, tag=""):
    key = re.sub(r"[^a-zA-Z0-9]+", "_", tag + url)[:180]
    return os.path.join(CACHE_DIR, key + ".json")


def fetch(url, headers=None, refresh=False, tag=""):
    """GET a JSON URL with on-disk caching and basic retry.

    `tag` distinguishes cache entries when the same path is hit with different
    auth/params that we deliberately keep out of the cache key (e.g. the OMDb key).
    """
    cp = _cache_path(url, tag)
    if not refresh and os.path.exists(cp):
        with open(cp) as f:
            return json.load(f)
    hdrs = {"User-Agent": UA, "Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    last_err = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode("utf-8"))
            with open(cp, "w") as f:
                json.dump(data, f)
            time.sleep(SLEEP)
            return data
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError,
                http.client.HTTPException, json.JSONDecodeError, OSError) as e:
            last_err = e
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last_err}")


def tmdb(path, refresh=False, **params):
    """GET a TMDB v3 endpoint using the v4 bearer token."""
    if not TMDB_TOKEN:
        raise SystemExit("TMDB_TOKEN is not set — export your TMDB v4 Read Access Token.")
    qs = ("?" + urllib.parse.urlencode(params)) if params else ""
    return fetch(f"{TMDB_API}{path}{qs}",
                 headers={"Authorization": f"Bearer {TMDB_TOKEN}"},
                 refresh=refresh, tag="tmdb")


def norm_title(t):
    if not t:
        return ""
    n = unicodedata.normalize("NFKD", t)
    n = "".join(c for c in n if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", n.lower())).strip()


# ---------- Rating: OMDb (IMDb) with a Wikidata fallback ----------
def imdb_rating_omdb(imdb_id, refresh=False):
    """IMDb rating (0-10 float) for a film via OMDb, keyed by imdb_id. None if absent."""
    if not imdb_id or not OMDB_KEY:
        return None
    url = f"{OMDB_API}?i={urllib.parse.quote(imdb_id)}&apikey={OMDB_KEY}"
    try:
        d = fetch(url, refresh=refresh, tag="omdb")  # key kept out of cache filename via tag
    except RuntimeError:
        return None
    val = (d or {}).get("imdbRating")
    try:
        return float(val) if val and val != "N/A" else None
    except (TypeError, ValueError):
        return None


def imdb_rating_wikidata(imdb_id, refresh=False):
    """FALLBACK rating from Wikidata (CC0): IMDb review score (P444) for the film
    identified by its IMDb id (P345). Returns a 0-10 float or None.

    Wikidata stores review scores as strings like "8.5" or "8.5/10"; we parse the
    numerator. This fires only when OMDb has no rating, which is rare for a
    popular English pool.
    """
    if not imdb_id:
        return None
    q = f"""
    SELECT ?score WHERE {{
      ?film wdt:P345 "{imdb_id}" .
      ?film p:P444 ?st .
      ?st ps:P444 ?score .
      ?st pq:P447 wd:Q37312 .        # review by: IMDb
    }} LIMIT 1
    """
    url = f"{WD_SPARQL}?{urllib.parse.urlencode({'query': q, 'format': 'json'})}"
    try:
        d = fetch(url, refresh=refresh, tag="wd")
    except RuntimeError:
        return None
    try:
        raw = d["results"]["bindings"][0]["score"]["value"]
    except (KeyError, IndexError):
        return None
    m = re.match(r"\s*([0-9]+(?:\.[0-9]+)?)", raw)
    return float(m.group(1)) if m else None


def resolve_rating(imdb_id, refresh=False):
    """IMDb rating with source label: OMDb first, Wikidata fallback."""
    r = imdb_rating_omdb(imdb_id, refresh=refresh)
    if r is not None:
        return r, "imdb"
    r = imdb_rating_wikidata(imdb_id, refresh=refresh)
    if r is not None:
        return r, "wikidata"
    return None, None


# ---------- Curation ----------
def genre_map(refresh=False):
    d = tmdb("/genre/movie/list", language="en-US", refresh=refresh)
    return {g["id"]: g["name"] for g in d.get("genres", [])}


def curate_pool(pages, min_votes, refresh=False):
    """Return a list of TMDB movie ids for the English, popular, non-doc pool.

    Discover sorted by vote_count desc (most-rated first = most-recognized),
    English original language, adult excluded, documentaries excluded, and a
    vote_count floor. No box-office floor, so cheap-but-popular films qualify.
    No hard year floor — obscure old films fall out on the vote_count gate.
    """
    ids, seen = [], set()
    for page in range(1, pages + 1):
        d = tmdb("/discover/movie", refresh=refresh,
                 sort_by="vote_count.desc",
                 with_original_language="en",
                 include_adult="false",
                 include_video="false",
                 without_genres=str(DOCUMENTARY_GENRE_ID),
                 **{"vote_count.gte": min_votes},
                 page=page)
        results = d.get("results", [])
        if not results:
            break
        for m in results:
            mid = m.get("id")
            if mid and mid not in seen and (m.get("vote_count") or 0) >= min_votes:
                seen.add(mid)
                ids.append(mid)
        if page >= d.get("total_pages", 1):
            break
    return ids


def build_movie(mid, genres, refresh=False):
    """Fetch one film and assemble its record, or None if it fails the gate."""
    try:
        d = tmdb(f"/movie/{mid}", append_to_response="credits",
                 language="en-US", refresh=refresh)
    except RuntimeError:
        return None

    title = d.get("title")
    date = d.get("release_date") or ""
    year = int(date[:4]) if re.match(r"\d{4}", date) else None
    runtime = d.get("runtime") or None
    revenue = d.get("revenue") or 0          # worldwide gross; 0 == unknown
    imdb_id = d.get("imdb_id")
    genre_names = [g["name"] for g in d.get("genres", []) if g.get("name")]

    credits = d.get("credits") or {}
    cast = sorted((credits.get("cast") or []), key=lambda c: c.get("order", 999))
    lead_actor = cast[0]["name"] if cast else None
    # TMDB gender: 0 unknown, 1 female, 2 male, 3 non-binary. Kept so the game can
    # give a "right gender" (yellow) hint on the Director / Lead Actor columns.
    lead_actor_gender = cast[0].get("gender") if cast else None
    director_person = next((c for c in (credits.get("crew") or [])
                            if c.get("job") == "Director"), None)
    director = director_person["name"] if director_person else None
    director_gender = director_person.get("gender") if director_person else None

    # Completeness gate: every clue column except box office must be present, or the
    # film can't populate the grid. Box office is the weakest field for older/cheap
    # films, so a missing revenue is allowed (stored null) rather than dropping the film.
    if not (title and year and runtime and genre_names and lead_actor and director):
        return None

    rating, rating_src = resolve_rating(imdb_id, refresh=refresh)

    return {
        "id": mid,
        "imdbId": imdb_id,
        "title": title,
        "year": year,
        "leadActor": lead_actor,
        "leadActorGender": lead_actor_gender,     # 0 unknown / 1 female / 2 male / 3 non-binary
        "genres": genre_names,
        "runtime": runtime,                       # minutes
        "director": director,
        "directorGender": director_gender,        # 0 unknown / 1 female / 2 male / 3 non-binary
        "boxOffice": revenue or None,             # USD worldwide, null if unknown
        "rating": rating,                         # 0-10; IMDb, else Wikidata, else null
        "ratingSource": rating_src,
        # Kept so the front-end can derive difficulty tiers (Normal/Hard/Extreme)
        # client-side, the way the UFC game derives era pools from lastUfcYear.
        "popularity": d.get("popularity"),
        "voteCount": d.get("vote_count"),
        "poster": (f"https://image.tmdb.org/t/p/w342{d['poster_path']}"
                   if d.get("poster_path") else None),
    }


def build(limit=None, pages=DEFAULT_PAGES, min_votes=DEFAULT_MIN_VOTES, refresh=False):
    genres = genre_map(refresh=refresh)
    print(f"[genres] {len(genres)} TMDB genres", file=sys.stderr)

    ids = curate_pool(pages, min_votes, refresh=refresh)
    print(f"[pool] {len(ids)} candidate films "
          f"(English, vote_count>={min_votes}, no docs)", file=sys.stderr)
    if limit:
        ids = ids[:limit]

    movies, kept = [], 0
    for i, mid in enumerate(ids):
        if i % 100 == 0:
            print(f"  ...{i}/{len(ids)} (kept {kept})", file=sys.stderr)
        rec = build_movie(mid, genres, refresh=refresh)
        if rec:
            movies.append(rec)
            kept += 1

    # De-dup by normalized title+year (remakes keep distinct years).
    by_key = {}
    for m in movies:
        k = (norm_title(m["title"]), m["year"])
        if k not in by_key or (m["voteCount"] or 0) > (by_key[k]["voteCount"] or 0):
            by_key[k] = m
    movies = sorted(by_key.values(), key=lambda m: (m["title"], m["year"]))

    with_box = sum(1 for m in movies if m["boxOffice"])
    with_rating = sum(1 for m in movies if m["rating"] is not None)
    wiki_rating = sum(1 for m in movies if m["ratingSource"] == "wikidata")
    meta = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "count": len(movies),
        "source": "TMDB (+ OMDb/IMDb rating, Wikidata fallback)",
        "attribution": "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    }
    out = {"meta": meta, "movies": movies,
           "genres": sorted(set(g for m in movies for g in m["genres"]))}
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"[done] {len(movies)} films -> {OUT_PATH} "
          f"(box office on {with_box}, rating on {with_rating} "
          f"[{wiki_rating} via Wikidata fallback])", file=sys.stderr)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Build the Weiddle movie dataset.")
    p.add_argument("--limit", type=int, help="cap films processed (quick test runs)")
    p.add_argument("--pages", type=int, default=DEFAULT_PAGES,
                   help="TMDB discover pages to scan (20 films each)")
    p.add_argument("--min-votes", type=int, default=DEFAULT_MIN_VOTES,
                   help="vote_count floor for the pool")
    p.add_argument("--refresh", action="store_true", help="bypass cache")
    a = p.parse_args()
    build(limit=a.limit, pages=a.pages, min_votes=a.min_votes, refresh=a.refresh)
