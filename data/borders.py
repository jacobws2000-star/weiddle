"""
Country-border adjacency for the Octagonle Nationality column.

The game colors a guess's nationality cell orange when the guessed fighter's
country shares a border with the target's country. Border data comes from
GeoNames' public `countryInfo.txt` dump (CC BY 4.0, no auth): its `neighbours`
column lists each country's bordering countries as ISO2 codes.

`build_borders(nationalities)` maps every game nationality string to the sorted
list of *other game nationalities* that border it, restricted to the nationalities
actually present in the dataset. The result is symmetric and is attached to
public/fighters.json under the top-level "borders" key (one artifact, one fetch;
the live game never touches the network).

GeoNames uses ISO2 codes and treats England/Scotland/Wales as one country (GB),
so two manual overrides are layered on top of the raw data — see MANUAL_BORDERS.
"""

import os
import sys
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, ".cache")
GEONAMES_URL = "https://download.geonames.org/export/dump/countryInfo.txt"
UA = "octagonle-dataset-builder/1.0 (personal project; build-time only)"

# Every nationality string the game's dataset uses -> ISO2 country code.
# GeoNames collapses the UK home nations into GB; "Korea" is treated as South
# Korea (KR). Keep this in sync with the `nationality` values in fighters.json.
NATIONALITY_TO_ISO2 = {
    "USA": "US", "Brazil": "BR", "Russia": "RU", "Canada": "CA",
    "Australia": "AU", "Mexico": "MX", "England": "GB", "China": "CN",
    "Poland": "PL", "South Korea": "KR", "France": "FR", "Sweden": "SE",
    "Japan": "JP", "Ireland": "IE", "New Zealand": "NZ", "Argentina": "AR",
    "Georgia": "GE", "Kazakhstan": "KZ", "Ukraine": "UA", "Peru": "PE",
    "Germany": "DE", "Netherlands": "NL", "Spain": "ES", "Venezuela": "VE",
    "Uzbekistan": "UZ", "Morocco": "MA", "Ecuador": "EC", "Serbia": "RS",
    "Wales": "GB", "Azerbaijan": "AZ", "Nigeria": "NG", "Türkiye": "TR",
    "Italy": "IT", "Denmark": "DK", "Kyrgyzstan": "KG", "Armenia": "AM",
    "Chile": "CL", "Lithuania": "LT", "Romania": "RO",
    "Democratic Republic of Congo": "CD", "India": "IN", "Croatia": "HR",
    "Guam": "GU", "South Africa": "ZA", "Korea": "KR", "Scotland": "GB",
    "Tajikistan": "TJ", "Jamaica": "JM", "Afghanistan": "AF", "Bolivia": "BO",
    "Albania": "AL", "Belgium": "BE", "Czechia": "CZ", "Israel": "IL",
    "Colombia": "CO", "Panama": "PA", "Philippines": "PH", "Portugal": "PT",
    "Bahrain": "BH", "Switzerland": "CH", "Palestine": "PS", "Vietnam": "VN",
    "Iran": "IR", "Cameroon": "CM", "Mongolia": "MN", "Zimbabwe": "ZW",
    "Moldova": "MD", "Norway": "NO", "Puerto Rico": "PR", "Lebanon": "LB",
    "United Arab Emirates": "AE", "Slovakia": "SK", "Cuba": "CU", "Ghana": "GH",
    "Bosnia & Herzegovina": "BA", "Macedonia": "MK", "Iraq": "IQ",
    "Austria": "AT", "Guyana": "GY", "Cyprus": "CY", "Aruba": "AW",
    "Uganda": "UG", "Iceland": "IS", "Egypt": "EG", "Jordan": "JO",
    "Luxembourg": "LU", "Suriname": "SR", "Indonesia": "ID", "Myanmar": "MM",
    "Bulgaria": "BG", "Thailand": "TH", "Hungary": "HU", "Niger": "NE",
    "Tunisia": "TN", "Haiti": "HT", "Paraguay": "PY", "Hong Kong": "HK",
    "Singapore": "SG", "Finland": "FI", "Belarus": "BY",
    "Dominican Republic": "DO", "Senegal": "SN", "El Salvador": "SV",
    # Nationalities the event-history fighters brought in. GeoNames folds
    # Northern Ireland into GB like the other home nations, so its land border
    # with Ireland lives in MANUAL_BORDERS. Taiwan and Angola aren't in the
    # dataset yet — they're here so wikidata_enrich stops rejecting them.
    "Greece": "GR", "Costa Rica": "CR", "Uruguay": "UY", "Nicaragua": "NI",
    "Liberia": "LR", "Cape Verde": "CV", "Trinidad": "TT",
    "Northern Ireland": "GB", "American Samoa": "AS", "Virgin Islands": "VI",
    "Taiwan": "TW", "Angola": "AO",
}

# Manual adjacencies GeoNames can't express, added on top of the raw neighbours.
# Each pair is made mutual. Keyed by nationality (not ISO2) since these are
# specifically about game nationalities.
MANUAL_BORDERS = [
    # British Isles cluster: GeoNames folds England/Scotland/Wales into GB, so
    # their internal borders (and the land border on the island of Ireland) are
    # invisible in the data. Treat all four as mutually bordering (user decision).
    # Northern Ireland is also GB to GeoNames, and it carries the one real land
    # border in the cluster (with Ireland) rather than a notional one.
    ("England", "Scotland"), ("England", "Wales"), ("England", "Ireland"),
    ("Scotland", "Wales"), ("Scotland", "Ireland"), ("Wales", "Ireland"),
    ("Northern Ireland", "Ireland"), ("Northern Ireland", "England"),
    ("Northern Ireland", "Scotland"), ("Northern Ireland", "Wales"),
    # Hong Kong physically borders mainland China, but GeoNames leaves HK's
    # neighbours column empty.
    ("Hong Kong", "China"),
]


def fetch_neighbours(refresh=False):
    """Download+cache GeoNames countryInfo.txt; return {iso2: set(neighbour iso2)}."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    cp = os.path.join(CACHE_DIR, "geonames_countryInfo.txt")
    if refresh or not os.path.exists(cp):
        req = urllib.request.Request(GEONAMES_URL, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode("utf-8")
        with open(cp, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        with open(cp, encoding="utf-8") as f:
            text = f.read()

    neighbours = {}
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) < 18:
            continue
        iso2 = cols[0].strip()
        raw = cols[17].strip()  # column 18 (0-indexed 17) = neighbours
        neighbours[iso2] = {c for c in raw.split(",") if c}
    return neighbours


def build_borders(nationalities, refresh=False):
    """Map each present nationality -> sorted list of bordering present nationalities.

    `nationalities` is the set of nationality strings in the dataset. Only pairs
    where both sides are present are emitted; the map is symmetric and omits
    nationalities that end up with no borders (island nations, etc.).
    """
    present = set(nationalities)
    unknown = present - set(NATIONALITY_TO_ISO2)
    if unknown:
        print(f"[borders] WARNING: no ISO2 mapping for {sorted(unknown)} "
              f"(add them to NATIONALITY_TO_ISO2)", file=sys.stderr)

    neighbours = fetch_neighbours(refresh=refresh)
    adj = {n: set() for n in present}

    # GeoNames-derived: a borders b if either side lists the other's ISO2.
    plist = [n for n in present if n in NATIONALITY_TO_ISO2]
    for i, a in enumerate(plist):
        ia = NATIONALITY_TO_ISO2[a]
        for b in plist[i + 1:]:
            ib = NATIONALITY_TO_ISO2[b]
            if ia == ib:
                continue  # same country (e.g. England/Wales both GB)
            if ib in neighbours.get(ia, ()) or ia in neighbours.get(ib, ()):
                adj[a].add(b)
                adj[b].add(a)

    # Manual overrides (only when both sides are in the dataset).
    for a, b in MANUAL_BORDERS:
        if a in present and b in present:
            adj[a].add(b)
            adj[b].add(a)

    return {n: sorted(v) for n, v in adj.items() if v}
