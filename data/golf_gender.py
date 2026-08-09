#!/usr/bin/env python3
"""
Step 1.5 of the Puttle bulk expansion: look up each universe golfer's gender
from Wikidata (P21 "sex or gender").

WHY: the bulk pool is scraped from Wikipedia's {{Infobox golfer}}, which is
gender-neutral, so LPGA / women's golfers flow in alongside the men. Puttle is a
men's-golf game, so build_golfers.py drops anyone this step marks female. The
curated seed (golfers_seed.py) is men-only, so only the bulk needs filtering.

Reads the QIDs from universe.json and batches them through the Wikidata SPARQL
endpoint with a VALUES clause. Writes data/.cache_golf/gender.json:
{qid: "male" | "female" | "other"}. QIDs with no P21 are simply omitted (the
caller treats "missing" as not-female so a man with sparse Wikidata isn't lost).

Run:  python3 data/golf_gender.py   # writes gender.json
"""
import json, os, sys, time, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache_golf")
UNIVERSE = os.path.join(CACHE, "universe.json")
OUT = os.path.join(CACHE, "gender.json")
UA = "puttle-dataset-builder/1.0 (weiddle.com; jacobws2000@gmail.com)"
ENDPOINT = "https://query.wikidata.org/sparql"

# Wikidata gender item QIDs we care about; everything else is bucketed "other"
# (non-binary/trans items etc.), which build_golfers keeps (not female).
MALE = "Q6581097"
FEMALE = "Q6581072"

QUERY = """
SELECT ?p ?gender WHERE {
  VALUES ?p { %s }
  ?p wdt:P21 ?g .
  BIND(STRAFTER(STR(?g), "entity/") AS ?gender)
}
"""


def sparql(q, tries=4):
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": q, "format": "json"})
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": UA,
                              "Accept": "application/sparql-results+json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception as e:
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"sparql failed: {last}")


def bucket(gender_qid):
    if gender_qid == MALE:
        return "male"
    if gender_qid == FEMALE:
        return "female"
    return "other"


def main():
    universe = json.load(open(UNIVERSE))
    qids = [r["qid"] for r in universe]
    out = {}
    BATCH = 250  # VALUES clause stays well under the endpoint's limits
    for i in range(0, len(qids), BATCH):
        chunk = qids[i:i + BATCH]
        values = " ".join(f"wd:{q}" for q in chunk)
        d = sparql(QUERY % values)
        for it in d["results"]["bindings"]:
            qid = it["p"]["value"].rsplit("/", 1)[-1]
            out[qid] = bucket(it["gender"]["value"])
        print(f"[gender] {min(i + BATCH, len(qids))}/{len(qids)}", file=sys.stderr)

    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    n_f = sum(1 for v in out.values() if v == "female")
    n_m = sum(1 for v in out.values() if v == "male")
    missing = len(qids) - len(out)
    print(f"[done] {len(out)} genders -> {OUT} "
          f"(male {n_m}, female {n_f}, other {len(out) - n_m - n_f}; "
          f"{missing} QIDs had no P21)", file=sys.stderr)


if __name__ == "__main__":
    main()
