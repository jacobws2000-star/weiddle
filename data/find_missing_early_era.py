#!/usr/bin/env python3
"""
List every fighter who competed in a UFC bout from 1993-2009 that is NOT in the
game's current fighters.json.

Source: English Wikipedia (complete UFC event cards, structured as
{{MMAevent bout|weightclass|winner|def.|loser|...}} templates).
Matched against public/fighters.json using build_dataset.py's norm_name().
"""
import json, os, re, sys, time, unicodedata, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "wpcache")
os.makedirs(CACHE, exist_ok=True)
UA = {"User-Agent": "octagonle-dataset-builder/1.0 (personal project; build-time only)"}


def norm_name(name):
    """Identical to data/build_dataset.py:norm_name — strip accents, lowercase."""
    if not name:
        return ""
    n = unicodedata.normalize("NFKD", name)
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = re.sub(r"[^a-z0-9 ]", "", n.lower()).strip()
    return re.sub(r"\s+", " ", n)


def wikitext(page):
    cp = os.path.join(CACHE, re.sub(r"[^A-Za-z0-9]+", "_", page)[:150] + ".txt")
    if os.path.exists(cp):
        return open(cp, encoding="utf-8").read()
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
        {"action": "parse", "page": page, "prop": "wikitext", "format": "json",
         "redirects": "1"})
    req = urllib.request.Request(url, headers=UA)
    d = None
    for attempt in range(6):
        try:
            d = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
            break
        except urllib.error.HTTPError as e:
            if e.code == 429:                      # back off and let the API breathe
                time.sleep(5 * (attempt + 1))
                continue
            print(f"  !! {page}: {e}", file=sys.stderr)
            return ""
        except Exception as e:
            time.sleep(2 * (attempt + 1))
    if d is None:
        print(f"  !! {page}: gave up after retries", file=sys.stderr)
        return ""
    if "error" in d:
        print(f"  !! {page}: {d['error'].get('code')}", file=sys.stderr)
        return ""
    t = d["parse"]["wikitext"]["*"]
    open(cp, "w", encoding="utf-8").write(t)
    time.sleep(0.5)   # polite
    return t


MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def past_events():
    """(page_title, year) for every past UFC event listed on 'List of UFC events'."""
    wt = wikitext("List of UFC events")
    start = wt.find('id="Past events"')
    body = wt[start:]
    out = []
    for row in body.split("|-"):
        m_link = re.search(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]", row)
        m_date = re.search(r"\{\{dts\|(\d{4})\|(\w+)\|(\d+)", row)
        if not (m_link and m_date):
            continue
        # Strip section anchors ("Foo#Foo") and take every row: the first wikilink in
        # a past-events row is always the Event cell. Filtering on a "UFC" prefix drops
        # real cards (Ultimate Ultimate 1995/1996, Ortiz vs. Shamrock 3).
        page = m_link.group(1).strip().split("#")[0].strip()
        year = int(m_date.group(1))
        if page:
            out.append((page, year))
    # dedupe, preserving order
    seen, uniq = set(), []
    for p, y in out:
        if p not in seen:
            seen.add(p); uniq.append((p, y))
    return uniq


def split_params(s):
    """Split template params on top-level | (ignore | inside [[..]] / {{..}})."""
    parts, buf, depth_b, depth_t = [], "", 0, 0
    i = 0
    while i < len(s):
        c = s[i]
        if s.startswith("[[", i): depth_b += 1; buf += "[["; i += 2; continue
        if s.startswith("]]", i): depth_b -= 1; buf += "]]"; i += 2; continue
        if s.startswith("{{", i): depth_t += 1; buf += "{{"; i += 2; continue
        if s.startswith("}}", i): depth_t -= 1; buf += "}}"; i += 2; continue
        if c == "|" and depth_b == 0 and depth_t == 0:
            parts.append(buf); buf = ""; i += 1; continue
        buf += c; i += 1
    parts.append(buf)
    return parts


def _tidy(f):
    # Strip ANY parenthetical disambiguator, not a whitelist: titles in the wild
    # include "(kickboxer)", "(English wrestler)", "(Mixed martial artist)", and a
    # whitelist silently splits one fighter into two entries.
    f = re.sub(r"\s*\([^)]*\)\s*", " ", f)
    f = f.replace("'''", "").replace("''", "").strip(" *")
    return re.sub(r"\s+", " ", f).strip()


def clean_fighter(field):
    """'[[Manvel Gamburyan|Manny Gamburyan]]' -> ('Manvel Gamburyan', 'Manny Gamburyan').

    Cards often display a ring name while linking the article under the fighter's
    legal name — which is the form ESPN (and so fighters.json) tends to use. Return
    both and match on either; the ring name alone reads as a false "missing".
    """
    f = field.strip()
    f = re.sub(r"\{\{[^{}]*\}\}", "", f)                 # flagicons etc
    f = re.sub(r"<ref[^>]*>.*?</ref>", "", f, flags=re.S)
    f = re.sub(r"<[^>]+>", "", f)
    m = re.search(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", f)
    if m:
        return _tidy(m.group(1)), _tidy(m.group(2) or m.group(1))
    t = _tidy(f)
    return t, t


NOT_A_NAME = {"", "def.", "vs.", "n/a", "na", "draw", "nc", "no contest"}


def bouts(wt):
    """Every (winner, loser) pair from the {{MMAevent bout}} templates on a page."""
    pairs = []
    for m in re.finditer(r"\{\{MMAevent bout\s*\|", wt, re.I):
        i = m.end()
        depth, j = 1, i
        while j < len(wt) and depth:
            if wt.startswith("{{", j): depth += 1; j += 2; continue
            if wt.startswith("}}", j): depth -= 1; j += 2; continue
            j += 1
        p = split_params(wt[i:j - 2])
        if len(p) < 4:
            continue
        for target, disp in (clean_fighter(p[1]), clean_fighter(p[3])):
            if disp and disp.lower() not in NOT_A_NAME and not disp.startswith("#"):
                pairs.append((target, disp))
    return pairs


def main():
    game = json.load(open("/Users/jacobshapiro/dev/octagonle/public/fighters.json"))
    have = {norm_name(f["name"]) for f in game["fighters"]}
    print(f"[game] {len(game['fighters'])} fighters in fighters.json", file=sys.stderr)

    evs = [(p, y) for p, y in past_events() if 1993 <= y <= 2009]
    print(f"[events] {len(evs)} UFC events dated 1993-2009", file=sys.stderr)

    seen = {}     # norm -> {"name":.., "events":set(), "years":set()}
    for i, (page, year) in enumerate(evs):
        if i % 25 == 0:
            print(f"  ...{i}/{len(evs)}", file=sys.stderr)
        wt = wikitext(page)
        if not wt:
            continue
        names = bouts(wt)
        if not names:
            print(f"  ?? no bouts parsed: {page}", file=sys.stderr)
        for target, disp in names:
            # Key on the DISPLAYED name: one fighter reaches the cards under several
            # article titles ("Frank Edgar" / "Frankie Edgar", "Maurice Smith" /
            # "Maurice Smith (kickboxer)"), and keying on the title double-counts them.
            # Two different UFC fighters sharing a display name in this era doesn't happen.
            k = norm_name(disp) or norm_name(target)
            if not k:
                continue
            e = seen.setdefault(k, {"name": disp, "alts": set(), "events": set(),
                                    "years": set()})
            e["alts"].add(norm_name(target))
            e["events"].add(page)
            e["years"].add(year)

    # Present if the display name OR any article title it appeared under is on the roster.
    missing = {k: v for k, v in seen.items()
               if k not in have and not (v["alts"] & have)}
    print(f"[total] {len(seen)} distinct fighters competed 1993-2009", file=sys.stderr)
    print(f"[missing] {len(missing)} of them are NOT in fighters.json", file=sys.stderr)

    rows = sorted(missing.values(), key=lambda v: (-len(v["events"]), v["name"]))
    out = [{"name": v["name"], "bouts": len(v["events"]),
            "years": f"{min(v['years'])}-{max(v['years'])}" if len(v["years"]) > 1 else str(min(v["years"])),
            "events": sorted(v["events"])} for v in rows]
    json.dump({"totalCompeted": len(seen), "inGame": len(seen) - len(missing),
               "missing": out}, open(os.path.join(HERE, "missing_1993_2009.json"), "w"), indent=1)
    print(f"[done] wrote missing_1993_2009.json", file=sys.stderr)


if __name__ == "__main__":
    main()
