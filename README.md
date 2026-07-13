# Octagonle

A UFC-themed Weddle-style guessing game. Guess the mystery fighter; each guess
reveals how close you are on Division, Nationality, Wins, Losses, Height, Age,
Stance, Debut year, and Champion status — with green (exact), yellow (close),
and ↑/↓ arrows toward the answer. Nationality also turns **orange** when the
guessed country shares a border with the answer's country.

Endless mode: a new random active-roster fighter every game.

## Structure

```
data/
  build_dataset.py   # ESPN public API -> public/fighters.json
  champions.py       # curated champion name set (isChampion flag)
  nationalities.py   # hand-verified nationalities for fighters ESPN leaves blank
  wikidata_enrich.py # Wikidata lookup -> nationalities_auto.py + dobs.py
  nationalities_auto.py / dobs.py  # generated: Wikidata nationality + DOB fills
  borders.py         # GeoNames country-border adjacency (orange nationality)
  .cache/            # cached API responses (gitignore)
public/
  index.html
  styles.css
  game.js
  fighters.json      # generated dataset (the game's DB)
```

## Data source

All fighter data comes from **ESPN's public MMA API** (no key/auth, JSON):

- Roster:   `sports.core.api.espn.com/v2/sports/mma/leagues/ufc/athletes`
- Detail:   `.../athletes/{id}` — weight class, nationality (flag), height, DOB, stance, reach
- Records:  `.../athletes/{id}/records` — wins / losses / draws
- Debut:    `.../athletes/{id}/eventlog` — earliest event year

Champion status is merged from `data/champions.py`. ESPN leaves many older
fighters' nationality (and some DOBs) blank, so they're filled from two sources so
the all-time **Classic — Extreme** pool can include them: hand-verified entries in
`data/nationalities.py`, and **Wikidata** (CC0) via `data/wikidata_enrich.py`,
which writes `data/nationalities_auto.py` (citizenship, P27) and `data/dobs.py`
(date of birth, P569). Hand-verified data overrides the Wikidata-derived data. Age
is computed client-side from DOB so it never goes stale. Fetching happens only at
build time and is cached; the live game hits no network API.

Country-border adjacency (the orange Nationality color) comes from **GeoNames'**
public `countryInfo.txt` dump (CC BY 4.0), fetched at build time by
`data/borders.py` and baked into `fighters.json`.

## Build the dataset

```bash
python3 data/build_dataset.py            # full active roster (~a few minutes)
python3 data/build_dataset.py --limit 200  # quick subset for testing
python3 data/build_dataset.py --refresh    # bypass cache
```

Only active fighters with a valid weight class, nationality, DOB and record are
kept.

## Run locally

```bash
cd public && python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

Static — push `public/` to GitHub Pages or Netlify.

## Notes / attribution

Data via ESPN's public endpoints; used at low volume, cached, for a personal
project. Champion list is maintained manually in `data/champions.py` as titles
change. Country borders © GeoNames (geonames.org), CC BY 4.0.
