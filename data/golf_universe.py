#!/usr/bin/env python3
"""
Step 1 of the Puttle bulk expansion: pull the *universe* of playable golfers from
Wikidata.

WHY: the curated seed (golfers_seed.py) tops out at ~90 marquee names because the
golf numbers a Weddle grid needs — majors, tour wins, turned-pro year — aren't in
any clean API, so they were hand-typed. To reach the deep Hard/Extreme tiers we
need thousands of players, which no human types by hand. Wikidata gives us the
roster (who is a golfer, born when, from where, how famous) and Wikipedia's
{{Infobox golfer}} gives us the numbers (see golf_stats.py).

This step outputs data/.cache_golf/universe.json: one row per golfer that has an
English Wikipedia article + a date of birth + a citizenship. `sitelinks` (how many
language Wikipedias cover them) is our recognizability signal — it's what lets the
tiers hit their target sizes when PGA-win counts run out in the long tail.

Country preference: P1532 "country for sport" first (golf distinguishes England /
Scotland / Wales / N. Ireland, which citizenship P27 = "United Kingdom" loses),
then P27.

Run:  python3 data/golf_universe.py        # writes universe.json
"""
import json, os, sys, time, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache_golf")
OUT = os.path.join(CACHE, "universe.json")
UA = "puttle-dataset-builder/1.0 (weiddle.com; jacobws2000@gmail.com)"
ENDPOINT = "https://query.wikidata.org/sparql"

# Golfer occupation = Q11303721. Prefer sport-country (P1532) over citizenship
# (P27) so British home nations survive. sitelinks = fame proxy.
QUERY = """
SELECT ?p ?name ?dob ?sportCountry ?citizen ?article ?sitelinks WHERE {
  ?p wdt:P106 wd:Q11303721 ;
     wdt:P569 ?dobRaw ;
     wikibase:sitelinks ?sitelinks .
  ?article schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> .
  OPTIONAL { ?p wdt:P1532 ?sc . ?sc rdfs:label ?scLab . FILTER(LANG(?scLab)="en") }
  OPTIONAL { ?p wdt:P27  ?c . ?c rdfs:label ?cLab . FILTER(LANG(?cLab)="en") }
  BIND(YEAR(?dobRaw) AS ?dobYear)
  FILTER(?dobYear >= %d && ?dobYear < %d)
  ?p rdfs:label ?name . FILTER(LANG(?name)="en")
  BIND(STR(?dobRaw) AS ?dob)
  BIND(?scLab AS ?sportCountry)
  BIND(?cLab AS ?citizen)
}
"""


def sparql(q, tries=4):
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": q, "format": "json"})
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/sparql-results+json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception as e:
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"sparql failed: {last}")


def main():
    os.makedirs(CACHE, exist_ok=True)
    rows = {}
    # Window by birth-year to keep each result set small enough for the public
    # endpoint (it times out on one giant query with labels + sitelinks).
    for lo in range(1900, 2012, 4):
        hi = lo + 4
        d = sparql(QUERY % (lo, hi))
        b = d["results"]["bindings"]
        print(f"[wd] {lo}-{hi}: {len(b)} rows", file=sys.stderr)
        for it in b:
            qid = it["p"]["value"].rsplit("/", 1)[-1]
            article = urllib.parse.unquote(it["article"]["value"].rsplit("/", 1)[-1]).replace("_", " ")
            country = it.get("sportCountry", {}).get("value") or it.get("citizen", {}).get("value")
            if not country:
                continue
            prev = rows.get(qid)
            # keep the row that has a sport-country if duplicates arrive
            if prev and prev.get("_sport") and "sportCountry" not in it:
                continue
            rows[qid] = {
                "qid": qid,
                "name": it["name"]["value"],
                "dob": it["dob"]["value"][:10],
                "country": country,
                "article": article,
                "sitelinks": int(it["sitelinks"]["value"]),
                "_sport": "sportCountry" in it,
            }
    out = list(rows.values())
    for r in out:
        r.pop("_sport", None)
    out.sort(key=lambda r: -r["sitelinks"])
    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"[done] {len(out)} golfers -> {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
