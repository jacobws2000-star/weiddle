#!/usr/bin/env python3
"""
Enrich missing fighter data (nationality + date of birth) from Wikidata.

ESPN leaves many older fighters' nationality blank (`flag.alt == "default"`) and
some without a date of birth, so they fail build_dataset.py's completeness gate.
Wikidata (CC0) has structured citizenship (P27) and DOB (P569) for most of them.

This is a *manually run* enrichment step. It writes two reviewable data files that
get committed and read by build_dataset.py — the normal build stays offline and
deterministic:

  data/nationalities_auto.py   NATIONALITIES_AUTO = { name: nationality }
  data/dobs.py                 DOBS               = { name: "YYYY-MM-DD" }

Manual data (data/nationalities.py) overrides these, so hand-corrections stick.

Design decisions:
  - Match a fighter to a Wikidata item by requiring occupation "mixed martial
    artist" (Q11607585) — guards against same-name collisions.
  - Nationality basis = legal citizenship (P27). Dual citizenship is tiebroken by
    "country for sport" (P1532); still-ambiguous cases are reported, not guessed.
  - UK citizenship is refined to England/Scotland/Wales via place of birth (P19).

Run:  python3 data/wikidata_enrich.py   [--limit N]
Cached + throttled; safe to re-run (resumes from data/.cache/wikidata_cache.json).
"""

import glob
import json
import os
import re
import socket
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, ".cache")
WD_CACHE = os.path.join(CACHE_DIR, "wikidata_cache.json")
UA = {"User-Agent": "octagonle-dataset-builder/1.0 (personal project; build-time only)"}
THROTTLE = 0.4

MMA_OCCUPATION = "Q11607585"          # occupation: mixed martial artist
UK = "Q145"                           # United Kingdom
UK_CONSTITUENTS = {"Q21": "England", "Q22": "Scotland", "Q25": "Wales"}

# Wikidata country label -> the game's nationality vocabulary, where they differ.
# Labels already identical to a game nationality pass through (see qid_to_nat).
ALIASES = {
    "United States of America": "USA", "United States": "USA",
    "Czech Republic": "Czechia",
    "Turkey": "Türkiye",
    "North Macedonia": "Macedonia",
    "Democratic Republic of the Congo": "Democratic Republic of Congo",
    "Bosnia and Herzegovina": "Bosnia & Herzegovina",
    "Russian Federation": "Russia",
    "Islamic Republic of Iran": "Iran",
    "Republic of Ireland": "Ireland",
    "Kingdom of the Netherlands": "Netherlands",
    "People's Republic of China": "China",
    "East Germany": "Germany", "West Germany": "Germany",
    "Socialist Republic of Vietnam": "Vietnam",
}

os.makedirs(CACHE_DIR, exist_ok=True)


def norm_name(name):
    if not name:
        return ""
    n = unicodedata.normalize("NFKD", name)
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = re.sub(r"[^a-z0-9 ]", "", n.lower()).strip()
    return re.sub(r"\s+", " ", n)


# ---------- Wikidata API (cached + throttled) ----------
_cache = json.load(open(WD_CACHE)) if os.path.exists(WD_CACHE) else {}
_dirty = 0


def _save():
    tmp = WD_CACHE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(_cache, f)
    os.replace(tmp, WD_CACHE)


def api(params):
    global _dirty
    params = dict(params, format="json")
    key = urllib.parse.urlencode(sorted(params.items()))
    if key in _cache:
        return _cache[key]
    url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(params)
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            data = json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))
            _cache[key] = data
            _dirty += 1
            if _dirty % 25 == 0:
                _save()
            time.sleep(THROTTLE)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, socket.timeout, json.JSONDecodeError):
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("wikidata request failed: " + key)


def claim_entity_ids(claims, prop):
    out = []
    for c in claims.get(prop, []):
        dv = c.get("mainsnak", {}).get("datavalue")
        if dv and dv.get("type") == "wikibase-entityid":
            out.append(dv["value"]["id"])
    return out


def claim_times(claims, prop):
    out = []
    for c in claims.get(prop, []):
        dv = c.get("mainsnak", {}).get("datavalue")
        if dv and dv.get("type") == "time":
            out.append(dv["value"]["time"])
    return out


# Wikidata height (P2048) -> ESPN-style {heightIn, displayHeight}. Value is a
# quantity in metres (unit Q11573) or centimetres (Q174728).
def claim_height(claims):
    for c in claims.get("P2048", []):
        dv = c.get("mainsnak", {}).get("datavalue")
        if not dv or dv.get("type") != "quantity":
            continue
        try:
            amount = float(dv["value"]["amount"])
        except (KeyError, ValueError):
            continue
        unit = (dv["value"].get("unit") or "").rsplit("/", 1)[-1]
        cm = amount if unit == "Q174728" else amount * 100  # default: metres
        if cm < 120 or cm > 230:
            continue  # implausible for an adult fighter
        inches = cm / 2.54
        total = round(inches)
        return {"heightIn": round(inches, 1),
                "displayHeight": f"{total // 12}' {total % 12}\""}
    return None


def get_claims(ids):
    res = {}
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        e = api({"action": "wbgetentities", "ids": "|".join(chunk), "props": "claims"})
        for qid, ent in e.get("entities", {}).items():
            res[qid] = ent.get("claims", {})
    return res


def get_labels(ids):
    res = {}
    ids = [q for q in set(ids) if q]
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        e = api({"action": "wbgetentities", "ids": "|".join(chunk),
                 "props": "labels", "languages": "en"})
        for qid, ent in e.get("entities", {}).items():
            res[qid] = ent.get("labels", {}).get("en", {}).get("value")
    return res


def fmt_dob(times):
    for t in times:
        m = re.match(r"\+?(\d{4})-(\d{2})-(\d{2})", t)
        if m and m.group(2) != "00" and m.group(3) != "00":
            return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return None


def resolve_uk(pob_qid):
    """Walk place-of-birth up the P131 chain to England/Scotland/Wales."""
    if not pob_qid:
        return None
    seen = set()
    frontier = [pob_qid]
    for _ in range(4):
        if not frontier:
            break
        cl = get_claims(frontier)
        nxt = []
        for q in frontier:
            for adm in claim_entity_ids(cl.get(q, {}), "P131"):
                if adm in UK_CONSTITUENTS:
                    return UK_CONSTITUENTS[adm]
                if adm not in seen:
                    nxt.append(adm)
                    seen.add(adm)
        frontier = nxt
    return None


def find_fighter_item(name):
    """Return claims of the best Wikidata item for `name` that is an MMA fighter."""
    s = api({"action": "wbsearchentities", "search": name, "language": "en",
             "type": "item", "limit": 7})
    ids = [h["id"] for h in s.get("search", [])]
    if not ids:
        return None
    allclaims = get_claims(ids)
    for qid in ids:  # search order = relevance
        cl = allclaims.get(qid, {})
        if MMA_OCCUPATION in claim_entity_ids(cl, "P106"):
            return cl
    return None


# ---------- Target fighters (blank nationality and/or DOB) ----------
def roster_targets():
    ids = set()
    for fp in glob.glob(os.path.join(CACHE_DIR, "*leagues_ufc_athletes*")):
        try:
            d = json.load(open(fp))
        except Exception:
            continue
        for it in d.get("items", []):
            m = re.search(r"/athletes/(\d+)", it.get("$ref", ""))
            if m:
                ids.add(m.group(1))

    def detail(aid):
        for fp in glob.glob(os.path.join(CACHE_DIR, f"*athletes_{aid}_lang_en_region_us.json")):
            try:
                return json.load(open(fp))
            except Exception:
                return None
        return None

    targets = []
    for aid in ids:
        d = detail(aid)
        if not d:
            continue
        name = d.get("displayName") or d.get("fullName")
        if not name:
            continue
        nat = (d.get("flag") or {}).get("alt")
        need_nat = (not nat) or nat == "default"
        need_dob = not d.get("dateOfBirth")
        need_height = not d.get("height")
        if need_nat or need_dob or need_height:
            targets.append((name, need_nat, need_dob, need_height))
    # de-dup by normalized name
    seen, uniq = set(), []
    for t in sorted(targets):
        k = norm_name(t[0])
        if k not in seen:
            seen.add(k)
            uniq.append(t)
    return uniq


def main(limit=None):
    try:
        from borders import NATIONALITY_TO_ISO2
        vocab = set(NATIONALITY_TO_ISO2)
    except ImportError:
        vocab = set()

    targets = roster_targets()
    if limit:
        targets = targets[:limit]
    print(f"[targets] {len(targets)} fighters missing nationality, DOB and/or height", file=sys.stderr)

    # Pass 1: pull each fighter's raw claims.
    raw = {}   # name -> {p27, p1532, p19, dob, height, need_*}
    for i, (name, need_nat, need_dob, need_height) in enumerate(targets):
        if i % 25 == 0:
            print(f"  ...{i}/{len(targets)}", file=sys.stderr)
        cl = find_fighter_item(name)
        if cl is None:
            raw[name] = None
            continue
        raw[name] = {
            "p27": claim_entity_ids(cl, "P27"),
            "p1532": claim_entity_ids(cl, "P1532"),
            "p19": (claim_entity_ids(cl, "P19") or [None])[0],
            "dob": fmt_dob(claim_times(cl, "P569")),
            "height": claim_height(cl),
            "need_nat": need_nat, "need_dob": need_dob, "need_height": need_height,
        }
    _save()

    # Resolve country labels in one batched pass.
    country_qids = []
    for r in raw.values():
        if r:
            country_qids += r["p27"]
    labels = get_labels(country_qids)

    def qid_to_nat(qid, pob, report):
        if qid in UK_CONSTITUENTS:
            return UK_CONSTITUENTS[qid]
        if qid == UK:
            nat = resolve_uk(pob)
            if not nat:
                report["uk_defaulted"].append(qid)
                return "England"
            return nat
        label = labels.get(qid)
        nat = ALIASES.get(label) or (label if label in vocab else None)
        return nat

    # Pass 2: decide nationality + DOB + height.
    NAT, DOB, HEIGHT = {}, {}, {}
    report = {"unmatched": [], "ambiguous": [], "unmapped": [], "uk_defaulted": []}
    for name, r in raw.items():
        if r is None:
            report["unmatched"].append(name)
            continue
        if r["need_dob"] and r["dob"]:
            DOB[name] = r["dob"]
        if r["need_height"] and r["height"]:
            HEIGHT[name] = r["height"]
        if r["need_nat"]:
            cands = r["p27"]
            if len(set(cands)) > 1:
                inter = [q for q in cands if q in r["p1532"]]
                cands = inter if len(set(inter)) == 1 else cands
            if len(set(cands)) != 1:
                if cands:
                    report["ambiguous"].append((name, [labels.get(q, q) for q in cands]))
                continue
            nat = qid_to_nat(cands[0], r["p19"], report)
            if nat:
                NAT[name] = nat
            else:
                report["unmapped"].append((name, labels.get(cands[0], cands[0])))

    _save()
    _write_py(os.path.join(HERE, "nationalities_auto.py"), "NATIONALITIES_AUTO",
              NAT, "Auto-generated by wikidata_enrich.py — nationality (P27) from Wikidata.")
    _write_py(os.path.join(HERE, "dobs.py"), "DOBS",
              DOB, "Auto-generated by wikidata_enrich.py — date of birth (P569) from Wikidata.")
    _write_py(os.path.join(HERE, "heights.py"), "HEIGHTS",
              HEIGHT, "Auto-generated by wikidata_enrich.py — height (P2048) from Wikidata.")

    print(f"\n[done] nationality: {len(NAT)}   dob: {len(DOB)}   height: {len(HEIGHT)}", file=sys.stderr)
    print(f"  unmatched (no Wikidata MMA item): {len(report['unmatched'])}", file=sys.stderr)
    print(f"  ambiguous dual-citizenship: {len(report['ambiguous'])}", file=sys.stderr)
    print(f"  UK defaulted to England: {len(report['uk_defaulted'])}", file=sys.stderr)
    print(f"  unmapped country: {len(report['unmapped'])}", file=sys.stderr)
    for name, cs in report["ambiguous"][:40]:
        print(f"    AMBIGUOUS {name}: {cs}", file=sys.stderr)
    for name, c in report["unmapped"][:40]:
        print(f"    UNMAPPED  {name}: {c}", file=sys.stderr)


def _write_py(path, varname, mapping, doc):
    lines = [f'"""{doc}"""', "", f"{varname} = {{"]
    for k in sorted(mapping):
        lines.append(f'    {json.dumps(k, ensure_ascii=False)}: {json.dumps(mapping[k], ensure_ascii=False)},')
    lines.append("}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    args = sys.argv[1:]
    lim = int(args[args.index("--limit") + 1]) if "--limit" in args else None
    main(limit=lim)
