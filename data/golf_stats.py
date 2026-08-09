#!/usr/bin/env python3
"""
Step 2 of the Puttle bulk expansion: turn the Wikidata universe (golf_universe.py)
into playable rows by scraping each golfer's English Wikipedia {{Infobox golfer}}.

The infobox is the only place the Weddle-grid numbers exist as structured data:

  yearpro   -> turnedPro   (year they turned professional)
  pgawins   -> pgaWins     (PGA Tour wins; 0 for most non-US players)
  prowins   -> proWins     (total worldwide professional wins; kept for fame)
  majorwins -> majors      (major championships; if blank, we count "Won" in the
                            masters/usopen/open/pga result fields)

Presence of {{Infobox golfer}} is ALSO our golfer filter: it drops the cross-sport
pollution in the universe (tennis players etc. who list "golfer" as a Wikidata
occupation but whose article carries a different infobox), so `sitelinks` becomes a
clean golf-recognizability signal.

Fetches are cached one file per article under data/.cache_golf/wt/ so reruns are
free. Output: data/.cache_golf/stats.json (only rows with a golfer infobox).

Run:  python3 data/golf_stats.py [--workers N]
"""
import json, os, re, sys, time, hashlib, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache_golf")
WT_DIR = os.path.join(CACHE, "wt")
UNIVERSE = os.path.join(CACHE, "universe.json")
OUT = os.path.join(CACHE, "stats.json")
UA = "puttle-dataset-builder/1.0 (weiddle.com; jacobws2000@gmail.com)"
API = "https://en.wikipedia.org/w/api.php"


def wikitext(title):
    """Cached fetch of an article's raw wikitext (one JSON file per title).

    Only *successful* responses are cached — a transient failure must never be
    written to disk, or it poisons the cache (an early run cached ~2700 empties
    when 16 workers tripped Wikipedia's rate limiter). Returns "" on give-up so
    the caller skips the row this run and a rerun retries it.
    """
    key = hashlib.md5(title.encode("utf-8")).hexdigest()
    cp = os.path.join(WT_DIR, key + ".json")
    if os.path.exists(cp):
        with open(cp) as f:
            return json.load(f).get("wt", "")
    url = API + "?" + urllib.parse.urlencode(
        {"action": "parse", "page": title, "prop": "wikitext", "format": "json",
         "redirects": 1, "maxlag": 5})
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.load(r)
            if "error" in d:  # e.g. maxlag — back off and retry
                raise RuntimeError(d["error"].get("code", "api-error"))
            wt = d.get("parse", {}).get("wikitext", {}).get("*", "")
            with open(cp, "w") as f:  # cache successes only
                json.dump({"wt": wt}, f)
            return wt
        except Exception:
            time.sleep(1.5 * (i + 1))
    return ""  # give up this run; not cached, so a rerun retries


def infobox_fields(wt):
    """Extract {{Infobox golfer}} params as a lowercased name->value dict.

    Returns None when the article has no golfer infobox (our filter for real
    golfers). Grabs the template body by brace-matching so nested {{...}} values
    (major results, links) don't cut it short.
    """
    m = re.search(r"\{\{\s*[Ii]nfobox\s+golfer", wt)
    if not m:
        return None
    i = m.start()
    depth = 0
    end = len(wt)
    for j in range(i, len(wt)):
        if wt[j:j+2] == "{{":
            depth += 1
        elif wt[j:j+2] == "}}":
            depth -= 1
            if depth == 0:
                end = j
                break
    body = wt[i:end]
    fields = {}
    # Split on the template's own field pipes only. The template's outer "{{"
    # sits at depth 1, so field pipes are the pipes seen at depth == 1; pipes
    # inside nested {{...}} or [[...|...]] are deeper and must not split.
    depth = 0
    cur = ""
    parts = []
    k = 0
    while k < len(body):
        two = body[k:k+2]
        if two == "{{" or two == "[[":
            depth += 1; cur += two; k += 2; continue
        if two == "}}" or two == "]]":
            depth -= 1; cur += two; k += 2; continue
        ch = body[k]
        if ch == "|" and depth == 1:
            parts.append(cur); cur = ""; k += 1; continue
        cur += ch; k += 1
    parts.append(cur)
    for p in parts[1:]:
        if "=" not in p:
            continue
        name, _, val = p.partition("=")
        fields[name.strip().lower()] = val.strip()
    return fields


def first_int(s):
    if not s:
        return None
    # strip html comments
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    m = re.search(r"\d+", s)
    return int(m.group()) if m else None


def count_major_wins(fields):
    """Fallback major count: how many of the 4 majors show a Won result."""
    n = 0
    for k in ("masters", "usopen", "open", "pga"):
        v = fields.get(k, "")
        if re.search(r"Won\b", v):
            n += 1
    return n


def parse_row(u):
    wt = wikitext(u["article"])
    f = infobox_fields(wt)
    if f is None:
        return None  # not a golfer article
    year = first_int(f.get("yearpro") or f.get("turnedpro"))
    pga = first_int(f.get("pgawins"))
    pro = first_int(f.get("prowins"))
    majors = first_int(f.get("majorwins"))
    counted = count_major_wins(f)
    if majors is None:
        majors = counted
    else:
        majors = max(majors, counted)
    return {
        "qid": u["qid"],
        "name": u["name"],
        "dob": u["dob"],
        "country": u["country"],
        "sitelinks": u["sitelinks"],
        "turnedPro": year,
        "pgaWins": pga if pga is not None else 0,
        "proWins": pro if pro is not None else 0,
        "majors": majors,
    }


def main():
    os.makedirs(WT_DIR, exist_ok=True)
    workers = 12
    if "--workers" in sys.argv:
        workers = int(sys.argv[sys.argv.index("--workers") + 1])
    universe = json.load(open(UNIVERSE))
    print(f"[stats] scraping {len(universe)} articles ({workers} workers)…", file=sys.stderr)
    out = []
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for r in ex.map(parse_row, universe):
            done += 1
            if done % 250 == 0:
                print(f"  {done}/{len(universe)} ({len(out)} golfers)", file=sys.stderr)
            if r is not None:
                out.append(r)
    out.sort(key=lambda r: -r["sitelinks"])
    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"[done] {len(out)} golfers with an Infobox golfer -> {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
