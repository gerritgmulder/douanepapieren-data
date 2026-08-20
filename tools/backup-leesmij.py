# -*- coding: utf-8 -*-
"""Schrijft LEESMIJ.md en HERSTEL.md in de backupmap, met de echte aantallen erin.
Wordt aangeroepen door tools/backup-dashboard.sh."""
import os, sys, datetime

D = sys.argv[1]

def tel(pad):
    n = b = 0
    for wortel, _, bestanden in os.walk(os.path.join(D, pad)):
        for f in bestanden:
            p = os.path.join(wortel, f)
            try: n += 1; b += os.path.getsize(p)
            except OSError: pass
    return n, b

def mooi(b):
    for e in ["B", "KB", "MB", "GB"]:
        if b < 1024: return "%.0f %s" % (b, e)
        b /= 1024.0
    return "%.1f TB" % b

buckets = tel("cloudflare/kv/buckets")
dealer  = tel("cloudflare/kv/documenten/dealerportaal")
prijs   = tel("cloudflare/kv/documenten/prijslijsten")
schepen = tel("cloudflare/kv/documenten/schepen")
sleutels= tel("sleutels")
geheugen= tel("projectgeheugen")
totaal  = tel(".")

def lees(p, standaard=""):
    try: return open(os.path.join(D, p)).read()
    except OSError: return standaard

stand = lees("repo/stand.txt").splitlines()
haal  = lambda k: next((r.split(":", 1)[1].strip() for r in stand if r.startswith(k)), "onbekend")
commit, titel = haal("commit"), haal("titel")

geheim = [r.split(': "')[1].rstrip('"') for r in lees("cloudflare/config/geheimen-namen.txt").splitlines()
          if '"name"' in r]
nu = datetime.datetime.now().strftime("%d-%m-%Y om %H:%M")

open(os.path.join(D, "LEESMIJ.md"), "w").write(f"""# Backup Fonteyn Dashboard

**Laatst bijgewerkt: {nu}.**
Code op commit `{commit[:12]}` - "{titel}"
{totaal[0]} bestanden, {mooi(totaal[1])}.

Deze map wordt elke week ververst door `tools/backup-dashboard.sh` uit de repo.
Het is steeds dezelfde map, geen stapel gedateerde kopieën. Zet je hem op een
externe schijf, dan bouw je daar vanzelf je geschiedenis op.

---

## Waar dit voor is

Het dashboard draait niet op een pc maar op GitHub (de code) en Cloudflare
(de gegevens). Een kapotte laptop raakt het dashboard dus niet: die installeer
je opnieuw en je bent terug. Deze backup is voor het andere geval - de gegevens
bij Cloudflare weg, of het account kwijt.

De buckets zijn daarbij het onvervangbare deel. De code staat ook op GitHub,
maar van de voorraad, de schepen, de reserveringen, de retouren, de
dealeraccounts, het personeel en het activiteitenlogboek bestaat verder niets.

**Herstellen na een ramp: zie HERSTEL.md.**

---

## Wat er in zit

| map | wat | bestanden | omvang |
|---|---|---:|---:|
| `repo/` | de code, plus de volledige git-historie | 3 | {mooi(os.path.getsize(os.path.join(D,'repo/bestanden-nu.tar.gz')) + (os.path.getsize(os.path.join(D,'repo/historie.bundle')) if os.path.exists(os.path.join(D,'repo/historie.bundle')) else 0))} |
| `cloudflare/kv/buckets/` | de gegevens, als leesbare JSON | {buckets[0]} | {mooi(buckets[1])} |
| `cloudflare/kv/documenten/dealerportaal/` | de documenten van het partnerportaal | {dealer[0]} | {mooi(dealer[1])} |
| `cloudflare/kv/documenten/prijslijsten/` | de ingelezen prijslijsten en facturen | {prijs[0]} | {mooi(prijs[1])} |
| `cloudflare/kv/documenten/schepen/` | commercial invoices bij een schip | {schepen[0]} | {mooi(schepen[1])} |
| `sleutels/` | **wachtwoorden** - lees het bestand daarin | {sleutels[0]} | {mooi(sleutels[1])} |
| `projectgeheugen/` | afspraken, openstaande vragen, gemaakte keuzes | {geheugen[0]} | {mooi(geheugen[1])} |
| `cloudflare/config/` | wrangler.toml, manifest.json, CLAUDE.md, toegang.js, tegels.js | | |

`repo/bestanden-nu.tar.gz` is de werkmap zonder `node_modules`.
`repo/historie.bundle` is de complete git-historie; uitpakken met
`git clone historie.bundle douanepapieren-data`.

---

## Wat er NIET in zit

**Lopende sessies.** Sleutels van ingelogde dealers en van medewerkers die op
hun telefoon "ingelogd blijven" hebben aangevinkt. Daar zit een geldig
Logic4-token in op naam van die persoon. Ze verlopen vanzelf en zijn bij een
herstel nutteloos. De namen staan in `cloudflare/kv/niet-meegenomen.txt`.

**Niet alle achttien geheimen van de worker.** Wat er wél is, staat in
`sleutels/`. De rest bestaat alleen binnen Cloudflare; zie HERSTEL.md.

**De .dmg en .exe van de app.** Die bouw je uit deze code.

---

## Controleren of alles heel is

Vanuit deze map:

    shasum -a 256 -c controle.sha256

Doe dat vooral nadat je hem naar een externe schijf hebt gekopieerd.

## Let op

`~/Documents` wordt door iCloud gesynchroniseerd, dus deze map staat ook in de
wolk - dat is meteen een kopie buiten deze Mac. Maar er staan bedrijfsgegevens
in (personeel, dealeraccounts, het activiteitenlogboek) en sinds kort ook
wachtwoorden. Wil je dat niet, verplaats de map dan naar bijvoorbeeld
`~/Backups`; alleen Bureaublad en Documenten synchroniseren.
""")

open(os.path.join(D, "HERSTEL.md"), "w").write(f"""# Herstellen na een ramp

Stap voor stap. Je hebt nodig: deze map, een Cloudflare-account, een
GitHub-account, en de wachtwoorden uit `sleutels/`.

Reken op een uur, waarvan het meeste wachten is.

---

## 0. Eerst dit: is het wel nodig?

Het dashboard draait op GitHub en Cloudflare, niet op een pc. Ga eerst na wat
er echt stuk is:

- **Alleen jouw laptop kapot?** Niets aan de hand. Installeer de app opnieuw,
  log in, klaar. Deze map heb je niet nodig.
- **Eén bucket per ongeluk gewist?** Zet alleen die terug, stap 4. Doe niet
  alles, want dan draai je ook alles terug wat sindsdien is bijgewerkt.
- **Alles kwijt bij Cloudflare?** Dan de hele lijst hieronder.

---

## 1. De code terug

    tar xzf repo/bestanden-nu.tar.gz -C ~/GitHub/douanepapieren-data
    cd ~/GitHub/douanepapieren-data && npm install

Of, met de volledige historie erbij:

    git clone repo/historie.bundle ~/GitHub/douanepapieren-data

Zet hem **niet** in `~/Documents`: die map wordt door iCloud gesynchroniseerd en
dat maakt git onwerkbaar traag (gemeten: 26 seconden voor iets van 0,05 seconde).

Daarna de repo weer aan GitHub koppelen en pushen. De app van elke medewerker
haalt zijn tegels rechtstreeks van `main`, dus zodra dat staat werkt het
dashboard voor iedereen weer.

## 2. De opslag bij Cloudflare

Maak een KV-namespace aan en zet het nieuwe id in `data-worker/wrangler.toml`,
in de plaats van het oude. Is het account intact en alleen de inhoud weg, dan
kun je het bestaande id gewoon laten staan.

## 3. De worker uitrollen

    npx wrangler deploy --cwd data-worker

Daarna de achttien geheimen zetten. Wat in `sleutels/` staat kun je overtypen;
de rest haal je opnieuw op bij de leverancier (Logic4, Resend, Mollie,
QuickBooks, Flexport).

    npx wrangler secret put <NAAM> --cwd data-worker

De namen zijn:

{chr(10).join("    " + n for n in geheim) if geheim else "    zie cloudflare/config/geheimen-namen.txt"}

`SHARED_SECRET` is de teamsleutel: dezelfde waarde die in `sleutels/` staat.
Zet je daar iets anders neer, dan moet iedereen opnieuw inloggen.

## 4. De gegevens terug

Per bucket:

    npx wrangler kv key put "voorraad-schepen" \\
      --path "cloudflare/kv/buckets/voorraad-schepen.json" \\
      --namespace-id <id> --remote

En allemaal in één keer, vanuit deze map:

    for f in cloudflare/kv/buckets/*.json; do
      naam=$(basename "$f" .json)
      npx wrangler kv key put "$naam" --path "$f" --namespace-id <id> --remote
    done

De documenten gaan net zo, met de oorspronkelijke sleutelnaam ervoor:
`dpfile:` voor alles onder `dealerportaal/`, `plfile:` voor `prijslijsten/`,
`schipfile:` voor `schepen/`. Het pad achter de dubbele punt is precies het pad
binnen die map.

    npx wrangler kv key put "dpfile:spas/eu/passion-spas/relax.pdf" \\
      --path "cloudflare/kv/documenten/dealerportaal/spas/eu/passion-spas/relax.pdf" \\
      --namespace-id <id> --remote

Let op: een bucketnaam met een dubbele punt of een schuine streep is in de
bestandsnaam een liggend streepje geworden. Voor de gewone buckets speelt dat
niet; voor `plfile:` en `schipfile:` staat de echte naam in
`cloudflare/kv/alle-sleutels.json`.

## 5. Nakijken

- Open het dashboard en log in.
- Voorraadbeheer: staan de schepen er weer?
- Partnerportaal: opent een document?
- Activiteitenlogboek: komt er een nieuwe regel bij?

## 6. Wat je Claude moet vertellen

De map `projectgeheugen/` bevat wat er over dit project is afgesproken: hoe de
mails eruit horen te zien, wat er nog uitstaat bij Chantal, Kevin en Osman,
waarom de vertaaltegel op Workers AI draait. Kopieer die bestanden terug naar
`~/.claude/projects/<projectmap>/memory/`, dan weet een nieuwe sessie weer waar
het over gaat. `cloudflare/config/CLAUDE.md` is de technische uitleg.
""")

print("     LEESMIJ.md en HERSTEL.md geschreven (%d bestanden, %s)" % (totaal[0], mooi(totaal[1])))
