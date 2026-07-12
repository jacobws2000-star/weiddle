#!/usr/bin/env python3
"""
Build the Octagonle fighter dataset.

Data source: ESPN's public MMA core API (no key/auth, JSON).
  - League roster:  sports.core.api.espn.com/v2/sports/mma/leagues/ufc/athletes
  - Athlete detail: .../athletes/{id}
  - Records:        .../athletes/{id}/records
  - Event log:      .../athletes/{id}/eventlog   (earliest event -> UFC debut year)

Champion tags: data/champions.py (curated set merged by normalized name).

Output: public/fighters.json  (consumed by the static game; the live site hits no API).

All network responses are cached under data/.cache/ so reruns are cheap and polite.
Run:  python3 data/build_dataset.py   [--limit N] [--refresh]
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, ".cache")
OUT_PATH = os.path.join(HERE, "..", "public", "fighters.json")
API = "https://sports.core.api.espn.com/v2/sports/mma"
UA = "octagonle-dataset-builder/1.0 (personal project; build-time only)"
SLEEP = 0.05  # polite delay between uncached requests

os.makedirs(CACHE_DIR, exist_ok=True)


def _cache_path(url):
    key = re.sub(r"[^a-zA-Z0-9]+", "_", url)[:180]
    return os.path.join(CACHE_DIR, key + ".json")


def fetch(url, refresh=False):
    """GET a JSON URL with on-disk caching and basic retry."""
    cp = _cache_path(url)
    if not refresh and os.path.exists(cp):
        with open(cp) as f:
            return json.load(f)
    last_err = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode("utf-8"))
            with open(cp, "w") as f:
                json.dump(data, f)
            time.sleep(SLEEP)
            return data
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last_err = e
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last_err}")


def fetch_many(urls, workers=8):
    """Fetch several URLs concurrently. Returns {url: data_or_None}, order-independent.

    Used to parallelize the per-bout competition/opponent lookups, which dominate
    the title-bout build. Cached URLs return near-instantly; the pool mainly helps
    on first (uncached) runs.
    """
    def _one(u):
        try:
            return u, fetch(u)
        except RuntimeError:
            return u, None
    out = {}
    if not urls:
        return out
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for u, data in ex.map(_one, urls):
            out[u] = data
    return out


def norm_name(name):
    """Normalize a name for cross-source matching (strip accents, lowercase)."""
    if not name:
        return ""
    n = unicodedata.normalize("NFKD", name)
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = re.sub(r"[^a-z0-9 ]", "", n.lower()).strip()
    n = re.sub(r"\s+", " ", n)
    return n


def athlete_ids():
    """Collect every UFC athlete id via paginated league roster."""
    ids = []
    page = 1
    while True:
        d = fetch(f"{API}/leagues/ufc/athletes?limit=1000&page={page}")
        items = d.get("items", [])
        for it in items:
            m = re.search(r"/athletes/(\d+)", it.get("$ref", ""))
            if m:
                ids.append(m.group(1))
        if page >= d.get("pageCount", 1):
            break
        page += 1
    return ids


def get_record(aid):
    try:
        d = fetch(f"{API}/athletes/{aid}/records?lang=en&region=us")
    except RuntimeError:
        return None
    for it in d.get("items", []):
        if it.get("name") == "overall":
            stats = {s["name"]: s.get("value") for s in it.get("stats", [])}
            return {
                "wins": int(stats.get("wins", 0) or 0),
                "losses": int(stats.get("losses", 0) or 0),
                "draws": int(stats.get("draws", 0) or 0),
                "summary": it.get("summary", ""),
            }
    return None


def get_debut_year(aid):
    """UFC debut year = date of the athlete's earliest *UFC* event.

    The event log mixes UFC bouts with fights from other promotions and is
    paginated (newest-first). We page through all of it, keep only UFC bouts
    (identified by `/leagues/ufc/` in each item's competition ref), then fetch
    the single earliest UFC event to read its year. This avoids returning an
    MMA/regional debut (e.g. a Brazilian Predador FC fight) instead of the UFC
    debut, and avoids the truncated-first-page bug for high-volume fighters.
    """
    ufc_items = []
    page = 1
    while page <= 8:  # safety cap against pathological pagination
        try:
            d = fetch(f"{API}/athletes/{aid}/eventlog?lang=en&region=us&page={page}")
        except RuntimeError:
            break
        ev = d.get("events", {})
        items = ev.get("items", []) if isinstance(ev, dict) else []
        for it in items:
            comp_ref = (it.get("competition") or {}).get("$ref", "")
            if "/leagues/ufc/" in comp_ref:
                ufc_items.append(it)
        if page >= ev.get("pageCount", 1):
            break
        page += 1

    if not ufc_items:
        return None
    # newest-first => earliest UFC bout is the last UFC item
    ref = (ufc_items[-1].get("event") or {}).get("$ref")
    if not ref:
        return None
    try:
        edata = fetch(ref)
    except RuntimeError:
        return None
    dt = edata.get("date")
    if dt:
        m = re.match(r"(\d{4})", dt)
        if m:
            return int(m.group(1))
    return None


def get_title_bouts(aid):
    """Ordered list of a fighter's completed UFC championship bouts.

    A bout is a title fight when its competition `types[].text` contains "Title"
    (ESPN's gold-belt marker). Only completed bouts (item `played` is True) are
    kept. Each entry is event-name-free so the game clue never leaks the answer:
        {year, division, opponent, result}
    result is "Won" / "Lost" / "Draw".
    """
    # Phase 1: page the event log (cheap) and collect the competition ref of every
    # completed UFC bout.
    comp_refs = []
    page = 1
    while page <= 8:  # safety cap: 8 * 25 = 200 bouts, more than any career
        try:
            d = fetch(f"{API}/athletes/{aid}/eventlog?lang=en&region=us&page={page}")
        except RuntimeError:
            break
        ev = d.get("events", {})
        items = ev.get("items", []) if isinstance(ev, dict) else []
        for it in items:
            if not it.get("played"):
                continue  # skip scheduled/upcoming
            cref = (it.get("competition") or {}).get("$ref", "")
            if "/leagues/ufc/" in cref:
                comp_refs.append(cref)
        if page >= ev.get("pageCount", 1):
            break
        page += 1

    # Phase 2: fetch all competitions in parallel (the bottleneck), keep title bouts.
    comps = fetch_many(comp_refs)
    bouts = []
    opp_refs = []
    for cref in comp_refs:
        comp = comps.get(cref)
        if not comp:
            continue
        division = next((t.get("text") for t in comp.get("types", [])
                         if "title" in (t.get("text", "").lower())), None)
        if not division:
            continue
        competitors = comp.get("competitors", [])
        mine = next((c for c in competitors if c.get("id") == aid), None)
        opp = next((c for c in competitors if c.get("id") != aid), None)
        if not mine or not opp:
            continue
        if mine.get("winner"):
            result = "Won"
        elif opp.get("winner"):
            result = "Lost"
        else:
            result = "Draw"
        # Year straight from the competition date (no extra event fetch).
        year = None
        mo = re.match(r"(\d{4})", comp.get("date", "") or "")
        if mo:
            year = int(mo.group(1))
        oref = (opp.get("athlete") or {}).get("$ref")
        if oref:
            opp_refs.append(oref)
        bouts.append({
            "year": year,
            "division": division.replace("UFC ", "").replace(" Title", ""),
            "opponent_ref": oref,
            "result": result,
        })

    # Phase 3: resolve opponent names in parallel (only for title bouts, few).
    opps = fetch_many(opp_refs)
    for b in bouts:
        oref = b.pop("opponent_ref", None)
        adata = opps.get(oref) if oref else None
        b["opponent"] = (adata or {}).get("displayName", "Unknown") if adata else "Unknown"

    bouts.sort(key=lambda b: (b["year"] or 0))
    return bouts


def top_ten_ids(refresh=False):
    """Athlete ids ranked in the top 10 of any UFC ranking set (divisions + P4P).

    Returns {athlete_id: best_rank}.
    """
    try:
        idx = fetch(f"{API}/leagues/ufc/rankings", refresh=refresh)
    except RuntimeError:
        return {}
    best = {}
    for it in idx.get("items", []):
        ref = it.get("$ref")
        if not ref:
            continue
        try:
            rset = fetch(ref, refresh=refresh)
        except RuntimeError:
            continue
        for entry in rset.get("ranks", []):
            pos = entry.get("current")
            if pos is None or pos > 10:
                continue
            m = re.search(r"/athletes/(\d+)", (entry.get("athlete") or {}).get("$ref", ""))
            if not m:
                continue
            aid = m.group(1)
            if aid not in best or pos < best[aid]:
                best[aid] = pos
    return best


def build(limit=None, refresh=False):
    try:
        from champions import CHAMPION_NAMES
    except ImportError:
        CHAMPION_NAMES = set()
    champ_norm = {norm_name(n) for n in CHAMPION_NAMES}

    top10 = top_ten_ids(refresh=refresh)
    print(f"[rankings] {len(top10)} top-10 ranked athletes", file=sys.stderr)

    ids = athlete_ids()
    if limit:
        ids = ids[:limit]
    print(f"[roster] {len(ids)} athlete ids", file=sys.stderr)

    fighters = []
    kept = 0
    for i, aid in enumerate(ids):
        if i % 100 == 0:
            print(f"  ...{i}/{len(ids)} (kept {kept})", file=sys.stderr)
        try:
            d = fetch(f"{API}/athletes/{aid}?lang=en&region=us", refresh=refresh)
        except RuntimeError:
            continue

        # Active-roster filter
        if not d.get("active"):
            continue
        wc = (d.get("weightClass") or {}).get("text")
        flag = (d.get("flag") or {})
        nationality = flag.get("alt")
        dob = d.get("dateOfBirth")
        if not wc or not nationality or nationality == "default" or not dob:
            continue

        rec = get_record(aid)
        if not rec:
            continue

        name = d.get("displayName") or d.get("fullName")
        is_champ = norm_name(name) in champ_norm
        fighters.append({
            "id": aid,
            "name": name,
            "nickname": d.get("nickname") or "",
            "weightClass": wc,
            "nationality": nationality,
            "heightIn": d.get("height"),
            "displayHeight": d.get("displayHeight"),
            "reachIn": d.get("reach"),
            "stance": (d.get("stance") or {}).get("text") or "",
            "dob": dob,
            "wins": rec["wins"],
            "losses": rec["losses"],
            "draws": rec["draws"],
            "record": rec["summary"],
            "debutYear": get_debut_year(aid),
            "isChampion": is_champ,
            "topTen": aid in top10,
            "rank": top10.get(aid),
            # title-bout history only needed for champions (Title Defense mode)
            "titleBouts": get_title_bouts(aid) if is_champ else [],
            "headshot": f"https://a.espncdn.com/i/headshots/mma/players/full/{aid}.png",
        })
        kept += 1

    # De-dup by normalized name, keep the one with most fights.
    by_name = {}
    for f in fighters:
        k = norm_name(f["name"])
        if k not in by_name or (f["wins"] + f["losses"]) > (by_name[k]["wins"] + by_name[k]["losses"]):
            by_name[k] = f
    fighters = sorted(by_name.values(), key=lambda x: x["name"])

    meta = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "count": len(fighters),
        "source": "ESPN public MMA API",
    }
    out = {"meta": meta, "fighters": fighters}
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    champs = sum(1 for f in fighters if f["isChampion"])
    ranked = sum(1 for f in fighters if f["topTen"])
    tbouts = sum(len(f["titleBouts"]) for f in fighters)
    print(f"[done] {len(fighters)} fighters -> {OUT_PATH} "
          f"({champs} champions, {ranked} top-10 ranked, {tbouts} title bouts)", file=sys.stderr)


if __name__ == "__main__":
    args = sys.argv[1:]
    limit = None
    refresh = "--refresh" in args
    if "--limit" in args:
        limit = int(args[args.index("--limit") + 1])
    build(limit=limit, refresh=refresh)
