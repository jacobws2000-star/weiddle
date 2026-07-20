"""
Curated nationalities for UFC fighters ESPN leaves blank.

ESPN's athlete API returns `flag.alt == "default"` (no nationality) for many
older/retired fighters. Nationality is a required field for the game AND drives
the Nation column's green/yellow/orange colors, so those fighters are otherwise
dropped from the dataset — which is exactly the pre-2010 "all-time" cohort the
Classic **Extreme** difficulty is meant to include.

This map (name -> nationality, in the game's existing vocabulary) fills that gap.
It is merged in `build_dataset.py` by accent/case-insensitive name match, and only
used when ESPN provides no nationality of its own.

Accuracy matters (wrong data is visible in the grid and the border color), so this
is a *verified-confident subset*, not the full list of blank-nationality fighters:
fighters whose nationality can't be assigned with confidence are intentionally
omitted. Add more as they are verified.
"""

NATIONALITIES = {
    # --- USA ---
    "Randy Couture": "USA", "Mark Coleman": "USA", "Tra Telligman": "USA",
    "Zane Frazier": "USA", "James Toney": "USA", "Dan Henderson": "USA",
    "Evan Tanner": "USA", "Jorge Rivera": "USA", "Nate Quarry": "USA",
    "Matt Hughes": "USA", "Sean Sherk": "USA", "Matt Serra": "USA",
    "Rich Franklin": "USA", "Chris Lytle": "USA", "Shane Carwin": "USA",
    "Jay Hieron": "USA", "Kenny Florian": "USA", "Javier Vazquez": "USA",
    "Brock Lesnar": "USA", "Duane Ludwig": "USA", "David Terrell": "USA",
    "Pat Barry": "USA", "Shane Roller": "USA", "Mike Swick": "USA",
    "Forrest Griffin": "USA", "Brian Stann": "USA", "Amir Sadollah": "USA",
    "Mac Danzig": "USA", "Mike Pierce": "USA", "Luke Cummo": "USA",
    "Brian Bowles": "USA", "Brian Ebersole": "USA", "Charlie Brenneman": "USA",
    "Dan Miller": "USA", "Nick Catone": "USA", "KJ Noons": "USA",
    "Rory Markham": "USA", "Kyle Kingsbury": "USA", "Scott Jorgensen": "USA",
    "Pablo Garza": "USA", "Johny Hendricks": "USA", "Ryan LaFlare": "USA",
    "Brendan Schaub": "USA", "Alan Belcher": "USA", "Jamie Varner": "USA",
    "Jake Ellenberger": "USA", "Christian Morecraft": "USA", "Steve Cantwell": "USA",
    "Danny Downes": "USA", "Dustin Hazelett": "USA", "Jimy Hettes": "USA",
    "Josh Samman": "USA", "TJ Waldburger": "USA", "Josh Grispi": "USA",
    "Cole Escovedo": "USA", "Nate Mohr": "USA", "Chris Cope": "USA",
    "John Cholish": "USA", "Shane Del Rosario": "USA", "Eliot Marshall": "USA",
    "Sam Hoger": "USA", "Charles McCarthy": "USA", "Troy Mandaloniz": "USA",
    "Tim Credeur": "USA", "Rich Attonito": "USA", "Jared Rollins": "USA",
    "Gilbert Aldana": "USA", "Ricardo Romero": "USA", "Reese Andy": "USA",
    "Chris Tuchscherer": "USA", "Mike Ciesnolevicz": "USA", "Brian Melancon": "USA",
    "Matt Arroyo": "USA", "Christian Aguilera": "USA", "Adam Milstead": "USA",
    "Jeremy Larsen": "USA", "John Albert": "USA", "James Head": "USA",
    "Quinn Mulhern": "USA", "Cung Le": "USA",

    # --- Canada ---
    "Georges St-Pierre": "Canada", "Jason MacDonald": "Canada", "Jeff Joslin": "Canada",
    "Patrick Cote": "Canada", "Claude Patrick": "Canada", "Mark Bocek": "Canada",
    "Ryan Jimmo": "Canada", "Mark Hominick": "Canada", "Roland Delorme": "Canada",
    "Mitch Clarke": "Canada", "Antonio Carvalho": "Canada",

    # --- England ---
    "Michael Bisping": "England", "Brad Pickett": "England", "James Wilks": "England",
    "Jimi Manuwa": "England", "Dan Hardy": "England", "Rob Broughton": "England",
    "Phil Harris": "England", "Nick Osipczak": "England", "Michael Page": "England",
    "Paul Taylor": "England", "Danny Mitchell": "England",

    # --- Brazil ---
    "Thales Leites": "Brazil", "Fabricio Camoes": "Brazil", "Felipe Arantes": "Brazil",
    "Rafaello Oliveira": "Brazil", "Diego Henrique da Silva": "Brazil",
    "Wagner Silva": "Brazil", "Ricardo Abreu": "Brazil", "Alexandre Ferreira": "Brazil",

    # --- Elsewhere ---
    "Gerard Gordeau": "Netherlands", "Antoni Hardonk": "Netherlands",
    "Elvis Sinosic": "Australia", "Martin Kampmann": "Denmark",
    "Stanislav Nedkov": "Bulgaria", "Adlan Amagov": "Russia",
    "Jorgen Kruth": "Sweden", "Eiji Mitsuoka": "Japan",
    "Jianping Yang": "China", "Tina Lahdemaki": "Finland",
    "Tony DeSouza": "Peru",

    # --- Resolutions for Wikidata dual-citizenship / unmapped cases ---
    "Igor Zinoviev": "Russia",        # born USSR (Leningrad)
    "Krzysztof Soszynski": "Canada",  # Polish-born, competed for Canada
    "Farid Basharat": "England",      # born Birmingham, England
    "Ivan Menjivar": "El Salvador",   # Salvadoran-Canadian
    "Oleg Taktarov": "Russia",        # USSR-born; competed as Russian
    "Amar Suloev": "Armenia",         # competed as Armenian
    "Denis Kang": "Canada",           # born in France, competed out of Canada
    "Gary Goodridge": "Canada",       # Trinidad-born, competed out of Ontario
}
