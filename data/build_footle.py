#!/usr/bin/env python3
"""
Build public/footle_players.json — 2025-26 Premier League "starters" for Footle.

A player qualifies as a starter if they made >= 10 league starts (game_started)
in the 2025/26 Premier League season. Each guess in the game grades six columns:
Nationality, Club, Position, Age, Goals, Shirt number.

Source: the official Premier League API (footballapi.pulselive.com), which needs
only an Origin/Referer header (no key) and, unlike FBref, isn't behind a bot wall.
compSeason 777 = 2025/26. Per club, one `staff` call yields each player's shirt
number, position (G/D/M/F), national team, date of birth, season appearances and
goals. A per-player `stats` call adds exact starts (game_started) and minutes; we
only make it for players with >= 10 appearances (starts <= appearances, so this
can't drop a real starter). Minutes drive the Daily's weighted target pick.

Nationality borders/continents reuse borders.py (home nations stay distinct — the
Premier League fields England/Scotland/Wales/Northern Ireland separately, and
borders.py's MANUAL_BORDERS already makes them mutually adjacent). The 2025/26
final league table is baked in as `clubTable` so the Club column can shade a guess
by how close its club finished to the answer's.

Re-runnable: every API response is cached under .cache_footle/, so reruns touch no
network. Pass --refresh to re-fetch everything.

Output shape mirrors golfers.json so the frontend loader is a near copy:
  { meta, players:[{name, club, nation, pos, dob, goals, shirt, starts, min}],
    borders, continents, clubTable }
"""

import json
import os
import sys
import time
import datetime
import urllib.request
import urllib.error

from borders import build_borders, build_continents

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache_footle")
OUT = os.path.join(HERE, "..", "public", "footle_players.json")

SEASON = 777  # 2025/26
BASE = "https://footballapi.pulselive.com/football"
HEADERS = {
    "Origin": "https://www.premierleague.com",
    "Referer": "https://www.premierleague.com/",
    "User-Agent": "footle-dataset-builder/1.0 (personal project; build-time only)",
}
START_MIN = 10          # >= this many starts to qualify
APPS_PREFILTER = 10     # only fetch per-player starts when apps >= this

POSITION = {"G": "GK", "D": "DEF", "M": "MID", "F": "FWD"}

# Premier League API country name -> borders.py nationality vocabulary. Only the
# ones that differ are listed; names that already match (Spain, France, Brazil,
# England, Portugal, Netherlands, ...) pass through unchanged.
COUNTRY_MAP = {
    "United States": "USA",
    "Republic of Ireland": "Ireland",
    "Korea Republic": "South Korea",
    "South Korea": "South Korea",
    "Turkey": "Türkiye",
    "Turkiye": "Türkiye",
    # The PL API spells these with a curly apostrophe / its own forms.
    "Cote D’Ivoire": "Ivory Coast",
    "Cote D'Ivoire": "Ivory Coast",
    "Côte d’Ivoire": "Ivory Coast",
    "DR Congo": "Democratic Republic of Congo",
    "Congo DR": "Democratic Republic of Congo",
    "Bosnia and Herzegovina": "Bosnia & Herzegovina",
    "Czech Republic": "Czechia",
    "Cape Verde Islands": "Cape Verde",
    "Trinidad and Tobago": "Trinidad",
}

# Long official club names -> short display used across the grid, autocomplete,
# and the clubTable keys. Keep in sync with the standings lookup below.
CLUB_SHORT = {
    "Arsenal": "Arsenal",
    "Aston Villa": "Aston Villa",
    "Bournemouth": "Bournemouth",
    "AFC Bournemouth": "Bournemouth",
    "Brentford": "Brentford",
    "Brighton & Hove Albion": "Brighton",
    "Brighton and Hove Albion": "Brighton",
    "Burnley": "Burnley",
    "Chelsea": "Chelsea",
    "Crystal Palace": "Crystal Palace",
    "Everton": "Everton",
    "Fulham": "Fulham",
    "Leeds United": "Leeds",
    "Liverpool": "Liverpool",
    "Manchester City": "Man City",
    "Manchester United": "Man United",
    "Newcastle United": "Newcastle",
    "Nottingham Forest": "Nott'm Forest",
    "Sunderland": "Sunderland",
    "Tottenham Hotspur": "Tottenham",
    "West Ham United": "West Ham",
    "Wolverhampton Wanderers": "Wolves",
}


def fetch(url, key, refresh=False):
    """GET url as JSON, caching the raw body under .cache_footle/<key>.json."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, key + ".json")
    if os.path.exists(path) and not refresh:
        with open(path, encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                pass  # corrupt/empty cache — fall through and re-fetch
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8")
    time.sleep(0.15)  # be polite to the API
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return None  # empty/HTML body (some player-stats endpoints 204) — don't cache
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return data


def club_short(name):
    return CLUB_SHORT.get(name, name)


def map_country(name):
    return COUNTRY_MAP.get(name, name)


def dob_from_millis(millis):
    if millis is None:
        return None
    return datetime.datetime.utcfromtimestamp(millis / 1000).strftime("%Y-%m-%d")


def build(refresh=False):
    # 1) Teams + final table for 2025/26.
    teams = fetch(f"{BASE}/compseasons/{SEASON}/teams", "teams", refresh)
    teams = teams if isinstance(teams, list) else teams.get("content", [])
    team_names = {t["id"]: t["name"] for t in teams}

    standings = fetch(f"{BASE}/standings?compSeasons={SEASON}&altIds=true",
                      "standings", refresh)
    club_table = {}
    for entry in standings["tables"][0]["entries"]:
        club_table[club_short(entry["team"]["name"])] = entry["position"]

    # 2) Squad (staff) per club: shirt, position, nationality, DOB, apps.
    # The staff endpoint returns each club's 2025-26 roster with *club-scoped*
    # apps/goals, so a January-window transferee (e.g. Semenyo: Bournemouth ->
    # Man City) legitimately shows up under both clubs. Collect every stint keyed
    # by player id; a player is attributed to the club where they made the most
    # appearances, and season-total goals/starts/minutes come from the per-player
    # endpoint below (never the club-scoped staff figure). The same club listed
    # twice for one player (an occasional API artifact) is deduped by keeping the
    # higher apps count.
    stints = {}  # pid -> {name, nation, dob, clubs: {club: {apps, shirt, pos}}}
    for t in teams:
        tid, tname = t["id"], t["name"]
        staff = fetch(f"{BASE}/teams/{tid}/compseasons/{SEASON}/staff",
                      f"staff_{tid}", refresh)
        club = club_short(tname)
        for p in staff.get("players", []):
            pid = p.get("id")  # the key the /stats/player endpoint wants
            if pid is None:
                continue
            info = p.get("info", {})
            apps = int(p.get("appearances") or 0)
            nat = (p.get("nationalTeam") or {}).get("country")
            birth = ((p.get("birth") or {}).get("date") or {}).get("millis")
            rec = stints.setdefault(pid, {
                "name": (p.get("name") or {}).get("display"),
                "nation": map_country(nat) if nat else None,
                "dob": dob_from_millis(birth),
                "clubs": {},
            })
            cur = rec["clubs"].get(club)
            if cur is None or apps > cur["apps"]:
                rec["clubs"][club] = {
                    "apps": apps,
                    "shirt": info.get("shirtNum"),
                    "pos": POSITION.get(info.get("position"), info.get("position")),
                }

    # 3) Exact starts + season-total goals/minutes per candidate; keep starters.
    # Pre-filter on total apps across clubs (starts <= apps, so < 10 apps can't be
    # a >= 10-start player); this avoids a per-player call for the long tail.
    starters = []
    for pid, rec in stints.items():
        total_apps = sum(c["apps"] for c in rec["clubs"].values())
        if total_apps < APPS_PREFILTER:
            continue
        club, meta = max(rec["clubs"].items(), key=lambda kv: kv[1]["apps"])
        try:
            s = fetch(f"{BASE}/stats/player/{pid}?comps=1&compSeasons={SEASON}",
                      f"pstats_{pid}", refresh)
        except urllib.error.HTTPError as e:
            print(f"[warn] stats {rec['name']} ({pid}): {e}", file=sys.stderr)
            continue
        if not s:
            print(f"[warn] empty stats for {rec['name']} ({pid})", file=sys.stderr)
            continue
        stat = {x.get("name"): x.get("value") for x in s.get("stats", [])}
        starts = int(stat.get("game_started") or 0)
        if starts < START_MIN:
            continue
        starters.append({
            "name": rec["name"],
            "club": club,
            "nation": rec["nation"],
            "pos": meta["pos"],
            "dob": rec["dob"],
            "goals": int(stat.get("goals") or 0),
            "shirt": meta["shirt"],
            "starts": starts,
            "min": int(stat.get("mins_played") or 0),
        })

    # 4) Nationality borders + continents (reuse borders.py; home nations distinct).
    nats = {p["nation"] for p in starters if p["nation"]}
    borders = build_borders(nats, refresh=refresh)
    continents = build_continents(nats, refresh=refresh)

    out = {
        "meta": {
            "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "season": "2025/26",
            "source": "Premier League API (pulselive) compSeason 777",
            "rule": f"players with >= {START_MIN} league starts",
            "count": len(starters),
        },
        "players": sorted(starters, key=lambda p: (-p["min"], p["name"])),
        "borders": borders,
        "continents": continents,
        "clubTable": club_table,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    # --- report / sanity gates ---
    by_club = {}
    for p in starters:
        by_club.setdefault(p["club"], 0)
        by_club[p["club"]] += 1
    no_shirt = sum(1 for p in starters if p["shirt"] is None)
    no_nat = sum(1 for p in starters if not p["nation"])
    no_dob = sum(1 for p in starters if not p["dob"])
    print(f"[done] {len(starters)} starters -> {os.path.relpath(OUT, HERE)}")
    print(f"       clubs: {len(by_club)}/20  "
          f"(min {min(by_club.values())}, max {max(by_club.values())} per club)")
    print(f"       missing shirt {no_shirt}, nationality {no_nat}, dob {no_dob}")
    print(f"       nationalities: {len(nats)}")
    unmapped = sorted(nats - set(borders) - set(continents))
    if unmapped:
        print(f"       [check] no border/continent for: {unmapped}", file=sys.stderr)


if __name__ == "__main__":
    build(refresh="--refresh" in sys.argv)
