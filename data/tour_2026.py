#!/usr/bin/env python3
"""
2026 PGA Tour membership for Puttle's "Tour '26" game mode.

Scope: the *established regulars* — the 2025 FedEx Cup top 125 who kept their
Tour cards for 2026. This deliberately EXCLUDES the 20 Korn Ferry Tour rookie
graduates: they're obscure to the weekly-viewer audience the mode is built for,
and several have no sourceable data. LIV players are naturally absent (they earn
no FedEx Cup points), which is correct — a PGA Tour viewer never sees them.

Two lists, both consumed by build_golfers.py:

  TOUR_PRESENT — current members already in the main golfer dataset. These just
                 get a `tour2026: true` flag; their stats are already curated.

  TOUR_ADD     — current members the Wikipedia bulk scrape missed (younger /
                 less-decorated regulars). Full rows, hand-verified against
                 Wikipedia + Wikidata, injected into the dataset so they're
                 guessable and pickable. Tuple order matches golfers_seed.py's
                 golf fields (no handedness):
                     (name, country, dob, turnedPro, majors, pgaWins)

Source: 2025 FedEx Cup final standings (ESPN) + per-player Wikipedia/Wikidata.
Refresh yearly after the Tour Championship: swap in the new FedEx Cup top 125,
re-run the reconciliation, and update both lists.
"""

# Already in golfers.json — flag only.
TOUR_PRESENT = [
    'Adam Scott',
    'Akshay Bhatia',
    'Aldrich Potgieter',
    'Alejandro Tosti',
    'Alexander Norén',
    'An Byeong-hun',
    'Andrew Novak',
    'Austin Eckroat',
    'Beau Hossler',
    'Ben Griffin',
    'Billy Horschel',
    'Brian Campbell',
    'Brian Harman',
    'Cam Davis',
    'Chad Ramey',
    'Chan Kim',
    'Chris Gotterup',
    'Chris Kirk',
    'Christiaan Bezuidenhout',
    'Collin Morikawa',
    'Corey Conners',
    'Daniel Berger',
    'David Lipsky',
    'Davis Riley',
    'Davis Thompson',
    'Denny McCarthy',
    'Erik van Rooyen',
    'Gary Woodland',
    'Harris English',
    'Harry Hall',
    'Henrik Norlander',
    'Hideki Matsuyama',
    'Im Sung-jae',
    'J. J. Spaun',
    'J. T. Poston',
    'Jackson Suber',
    'Jake Knapp',
    'Jason Day',
    'Jhonattan Vegas',
    'Joel Dahmen',
    'Jordan Spieth',
    'Justin Rose',
    'Justin Thomas',
    'Keegan Bradley',
    'Keith Mitchell',
    'Kevin Yu',
    'Kim Si-woo',
    'Kurt Kitayama',
    'Lee Hodges',
    'Lucas Glover',
    'Ludvig Åberg',
    'Mackenzie Hughes',
    'Matt Fitzpatrick',
    'Matt McCarty',
    'Max Homa',
    'Michael Kim',
    'Min Woo Lee',
    'Nick Taylor',
    'Nico Echavarría',
    'Nicolai Højgaard',
    'Patrick Cantlay',
    'Patrick Rodgers',
    'Paul Peterson',
    'Rasmus Højgaard',
    'Rickie Fowler',
    'Robert MacIntyre',
    'Rory McIlroy',
    'Russell Henley',
    'Ryan Fox',
    'Ryan Gerard',
    'Ryo Hisatsune',
    'Sam Burns',
    'Sami Välimäki',
    'Scottie Scheffler',
    'Sepp Straka',
    'Shane Lowry',
    'Stephan Jäger',
    'Taylor Moore',
    'Taylor Pendrith',
    'Thomas Detry',
    'Tom Hoge',
    'Tom Kim',
    'Tommy Fleetwood',
    'Tony Finau',
    'Victor Perez',
    'Viktor Hovland',
    'William Mouw',
    'Wyndham Clark',
    'Xander Schauffele',
    'Zach Johnson',
]

# Missing from the bulk pool — full rows, verified against Wikipedia + Wikidata
# (and ESPN player bios for the handful with no Wikipedia article).
# (name, country, dob, turnedPro, majors, pgaWins). Win/major counts are a live
# snapshot, same as the rest of the dataset (the grid's ±2 win / ±1 major
# tolerance cushions the drift). All 35 non-dataset FedEx-125 members are here.
TOUR_ADD = [
    ('Aaron Rai', 'United Kingdom', '1995-03-03', 2012, 1, 2),
    ('Alex Smalley', 'USA', '1996-10-21', 2019, 0, 0),
    ('Andrew Putnam', 'USA', '1989-01-25', 2011, 0, 1),
    ('Bud Cauley', 'USA', '1990-03-16', 2011, 0, 1),
    ('Cameron Young', 'USA', '1997-05-07', 2019, 0, 3),
    ('Chandler Phillips', 'USA', '1996-02-12', 2019, 0, 0),
    ('Danny Walker', 'USA', '1995-10-04', 2018, 0, 0),
    ('Emiliano Grillo', 'Argentina', '1992-09-14', 2011, 0, 2),
    ('Eric Cole', 'USA', '1988-06-12', 2009, 0, 0),
    ('Garrick Higgo', 'South Africa', '1999-05-12', 2019, 0, 2),
    ('Harry Higgs', 'USA', '1991-12-04', 2014, 0, 0),
    ('Hayden Springer', 'USA', '1997-09-01', 2019, 0, 0),
    ('Isaiah Salinda', 'USA', '1997-03-13', 2019, 0, 0),
    ('Jacob Bridgeman', 'USA', '1999-12-06', 2022, 0, 1),
    ('Jesper Svensson', 'Sweden', '1996-03-14', 2019, 0, 0),
    ('Joe Highsmith', 'USA', '2000-04-19', 2022, 0, 1),
    ('Justin Lower', 'USA', '1989-04-04', 2011, 0, 0),
    ('Karl Vilips', 'Australia', '2001-08-16', 2024, 0, 1),
    ('Kevin Roy', 'USA', '1990-03-15', 2012, 0, 0),
    ('Kristoffer Ventura', 'Norway', '1995-02-24', 2018, 0, 0),
    ('Mac Meissner', 'USA', '1999-02-18', 2021, 0, 0),
    ('Mark Hubbard', 'USA', '1989-05-24', 2012, 0, 0),
    ('Matt Wallace', 'United Kingdom', '1990-04-12', 2012, 0, 1),
    ('Matti Schmid', 'Germany', '1997-11-18', 2021, 0, 0),
    ('Maverick McNealy', 'USA', '1995-11-07', 2017, 0, 1),
    ('Max Greyserman', 'USA', '1995-05-31', 2017, 0, 0),
    ('Max McGreevy', 'USA', '1995-05-03', 2017, 0, 0),
    ('Michael Thorbjornsen', 'USA', '2001-09-16', 2024, 0, 1),
    ('Patrick Fishburn', 'USA', '1992-07-21', 2018, 0, 0),
    ('Ricky Castillo', 'USA', '2001-08-28', 2023, 0, 1),
    ('Rico Hoey', 'Philippines', '1995-09-19', 2017, 0, 0),
    ('Sam Ryder', 'USA', '1989-12-15', 2012, 0, 0),
    ('Sam Stevens', 'USA', '1996-07-04', 2018, 0, 0),
    ('Thorbjørn Olesen', 'Denmark', '1989-12-21', 2008, 0, 0),
    ('Vince Whaley', 'USA', '1995-03-14', 2017, 0, 0),
]
