"""
Curated seed for Puttle (the golfer-guessing game).

WHY THIS EXISTS: ESPN's public golf API reliably gives a golfer's citizenship,
handedness and date of birth, but NOT the marquee golf numbers a Weddle-style
grid needs — majors won, PGA Tour win total, and the year they turned pro.
ESPN's golf stats/rankings endpoints are unreliable (they 404 / error), and
Wikidata has no clean property for majors or tour wins either. So those three
numbers are curated here, the same hand-maintained pattern as champions.py /
nationalities.py.

build_golfers.py merges this seed with the much larger bulk pool scraped from
Wikipedia (golf_universe.py + golf_stats.py). For any golfer that appears in both,
these curated values WIN — this is the hand-verified override for the marquee
names. The `country` here is authoritative and must be a nationality string
borders.py knows (see NATIONALITY_TO_ISO2) so the orange "borders the answer"
color works. (`hand` is retained in the tuples for reference but is no longer a
clue column — handedness isn't sourceable across the ~2.5k-golfer pool.)

MAINTENANCE: `pgaWins` is a SNAPSHOT (~2024 season) and drifts as active players
keep winning; `majors` and `turnedPro` are effectively static. Correct any entry
in place and rerun build_golfers.py. `hand` is "R" or "L".
"""

# name, country, hand, dob (YYYY-MM-DD), turnedPro, majors, pgaWins(≈2024)
GOLFERS = [
    ("Tiger Woods",         "USA",              "R", "1975-12-30", 1996, 15, 82),
    ("Jack Nicklaus",       "USA",              "R", "1940-01-21", 1961, 18, 73),
    ("Arnold Palmer",       "USA",              "R", "1929-09-10", 1954,  7, 62),
    ("Gary Player",         "South Africa",     "R", "1935-11-01", 1953,  9, 24),
    ("Ben Hogan",           "USA",              "R", "1912-08-13", 1930,  9, 64),
    ("Sam Snead",           "USA",              "R", "1912-05-27", 1934,  7, 82),
    ("Byron Nelson",        "USA",              "R", "1912-02-04", 1932,  5, 52),
    ("Tom Watson",          "USA",              "R", "1949-09-04", 1971,  8, 39),
    ("Lee Trevino",         "USA",              "R", "1939-12-01", 1960,  6, 29),
    ("Hale Irwin",          "USA",              "R", "1945-06-03", 1968,  3, 20),
    ("Ben Crenshaw",        "USA",              "R", "1952-01-11", 1973,  2, 19),
    ("Tom Kite",            "USA",              "R", "1949-12-09", 1972,  1, 19),
    ("Raymond Floyd",       "USA",              "R", "1942-09-04", 1961,  4, 22),
    ("Johnny Miller",       "USA",              "R", "1947-04-29", 1969,  2, 25),
    ("Larry Nelson",        "USA",              "R", "1947-09-10", 1971,  3, 10),
    ("Curtis Strange",      "USA",              "R", "1955-01-30", 1976,  2, 17),
    ("Payne Stewart",       "USA",              "R", "1957-01-30", 1979,  3, 11),
    ("Nick Faldo",          "England",          "R", "1957-07-18", 1976,  6,  9),
    ("Seve Ballesteros",    "Spain",            "R", "1957-04-09", 1974,  5,  9),
    ("Greg Norman",         "Australia",        "R", "1955-02-10", 1976,  2, 20),
    ("Bernhard Langer",     "Germany",          "R", "1957-08-27", 1972,  2,  3),
    ("Sandy Lyle",          "Scotland",         "R", "1958-02-09", 1977,  2,  6),
    ("Ian Woosnam",         "Wales",            "R", "1958-03-02", 1976,  1,  1),
    ("Jose Maria Olazabal", "Spain",            "R", "1966-02-05", 1985,  2,  6),
    ("Nick Price",          "Zimbabwe",         "R", "1957-01-28", 1977,  3, 18),
    ("Mark O'Meara",        "USA",              "R", "1957-01-13", 1980,  2, 16),
    ("Fred Couples",        "USA",              "R", "1959-10-03", 1980,  1, 15),
    ("Davis Love III",      "USA",              "R", "1964-04-13", 1985,  1, 21),
    ("Corey Pavin",         "USA",              "R", "1959-11-16", 1982,  1, 15),
    ("John Daly",           "USA",              "R", "1966-04-28", 1987,  2,  5),
    ("David Graham",        "Australia",        "R", "1946-05-23", 1962,  2,  8),
    ("Vijay Singh",         "Fiji",             "R", "1963-02-22", 1982,  3, 34),
    ("Ernie Els",           "South Africa",     "R", "1969-10-17", 1989,  4, 19),
    ("Phil Mickelson",      "USA",              "L", "1970-06-16", 1992,  6, 45),
    ("Retief Goosen",       "South Africa",     "R", "1969-02-03", 1990,  2,  7),
    ("Jim Furyk",           "USA",              "R", "1970-05-12", 1992,  1, 17),
    ("David Duval",         "USA",              "R", "1971-11-09", 1993,  1, 13),
    ("Padraig Harrington",  "Ireland",          "R", "1971-08-31", 1995,  3,  6),
    ("Mike Weir",           "Canada",           "L", "1970-05-12", 1992,  1,  8),
    ("Angel Cabrera",       "Argentina",        "R", "1969-09-12", 1989,  2,  3),
    ("Geoff Ogilvy",        "Australia",        "R", "1977-06-11", 1998,  1,  8),
    ("Trevor Immelman",     "South Africa",     "R", "1979-12-16", 1999,  1,  2),
    ("Zach Johnson",        "USA",              "R", "1976-02-24", 1998,  2, 12),
    ("Stewart Cink",        "USA",              "R", "1973-05-21", 1995,  1,  8),
    ("Lucas Glover",        "USA",              "R", "1979-11-12", 2001,  1,  6),
    ("Graeme McDowell",     "Northern Ireland", "R", "1979-07-30", 2002,  1,  4),
    ("Louis Oosthuizen",    "South Africa",     "R", "1982-10-19", 2002,  1,  1),
    ("Charl Schwartzel",    "South Africa",     "R", "1984-08-31", 2002,  1,  2),
    ("Bubba Watson",        "USA",              "L", "1978-11-05", 2002,  2, 12),
    ("Keegan Bradley",      "USA",              "R", "1986-06-07", 2008,  1,  8),
    ("Webb Simpson",        "USA",              "R", "1985-08-08", 2008,  1,  7),
    ("Jason Dufner",        "USA",              "R", "1977-03-24", 2000,  1,  5),
    ("Justin Rose",         "England",          "R", "1980-07-30", 1998,  1, 11),
    ("Sergio Garcia",       "Spain",            "R", "1980-01-09", 1999,  1, 11),
    ("Henrik Stenson",      "Sweden",           "R", "1976-04-05", 1998,  1,  6),
    ("Adam Scott",          "Australia",        "R", "1980-07-16", 2000,  1, 14),
    ("Martin Kaymer",       "Germany",          "R", "1984-12-28", 2005,  2,  3),
    ("Darren Clarke",       "Northern Ireland", "R", "1968-08-14", 1990,  1,  1),
    ("Rory McIlroy",        "Northern Ireland", "R", "1989-05-04", 2007,  4, 27),
    ("Jordan Spieth",       "USA",              "R", "1993-07-27", 2012,  3, 13),
    ("Jason Day",           "Australia",        "R", "1987-11-12", 2006,  1, 13),
    ("Dustin Johnson",      "USA",              "R", "1984-06-22", 2007,  2, 24),
    ("Brooks Koepka",       "USA",              "R", "1990-05-03", 2012,  5,  8),
    ("Justin Thomas",       "USA",              "R", "1993-04-29", 2013,  2, 15),
    ("Bryson DeChambeau",   "USA",              "R", "1993-09-16", 2016,  2,  8),
    ("Jon Rahm",            "Spain",            "R", "1994-11-10", 2016,  2, 11),
    ("Collin Morikawa",     "USA",              "R", "1997-02-06", 2019,  2,  6),
    ("Xander Schauffele",   "USA",              "R", "1993-10-25", 2015,  2,  8),
    ("Scottie Scheffler",   "USA",              "R", "1996-06-21", 2018,  2, 12),
    ("Wyndham Clark",       "USA",              "R", "1993-12-29", 2017,  1,  3),
    ("Matt Fitzpatrick",    "England",          "R", "1994-09-19", 2013,  1,  2),
    ("Cameron Smith",       "Australia",        "R", "1993-08-18", 2013,  1,  6),
    ("Hideki Matsuyama",    "Japan",            "R", "1992-02-25", 2013,  1, 10),
    ("Danny Willett",       "England",          "R", "1987-10-03", 2008,  1,  1),
    ("Shane Lowry",         "Ireland",          "R", "1987-04-02", 2009,  1,  2),
    ("Francesco Molinari",  "Italy",            "R", "1982-11-08", 2004,  1,  3),
    ("Gary Woodland",       "USA",              "R", "1984-05-21", 2007,  1,  4),
    ("Jimmy Walker",        "USA",              "R", "1979-01-16", 2001,  1,  6),
    ("Patrick Reed",        "USA",              "R", "1990-08-05", 2011,  1,  9),
    ("Rickie Fowler",       "USA",              "R", "1988-12-13", 2009,  0,  6),
    ("Tony Finau",          "USA",              "R", "1989-09-14", 2007,  0,  6),
    ("Patrick Cantlay",     "USA",              "R", "1992-03-17", 2012,  0,  8),
    ("Viktor Hovland",      "Norway",           "R", "1997-09-18", 2019,  0,  6),
    ("Tommy Fleetwood",     "England",          "R", "1991-01-19", 2010,  0,  0),
    ("Tyrrell Hatton",      "England",          "R", "1991-10-14", 2011,  0,  1),
    ("Max Homa",            "USA",              "R", "1990-11-19", 2013,  0,  6),
    ("Sam Burns",           "USA",              "R", "1996-07-29", 2017,  0,  5),
    ("Luke Donald",         "England",          "R", "1977-12-07", 2001,  0,  5),
    ("Lee Westwood",        "England",          "R", "1973-04-24", 1993,  0,  2),
    ("Ian Poulter",         "England",          "R", "1976-01-10", 1995,  0,  2),
]
