# -*- coding: utf-8 -*-
"""Schrijft LEESMIJ.md en HERSTEL.md in de backupmap, met de echte aantallen erin.
Wordt aangeroepen door tools/backup-dashboard.sh."""
import os, sys, json, datetime

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

# wrangler levert nette JSON; die parsen we ook zo. Met de oude regelsplitsing
# bleef de komma aan de naam plakken ("SHARED_SECRET",) en dat stond zo in
# HERSTEL.md - onhandig als je het moet overtypen achter wrangler secret put.
try:
    geheim = sorted(g["name"] for g in json.loads(lees("cloudflare/config/geheimen-namen.txt", "[]")))
except (ValueError, KeyError, TypeError):
    geheim = []
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

# Hoeveel bucketsleutels hebben een teken dat in de bestandsnaam een liggend
# streepje wordt? Dat getal staat in HERSTEL.md en moet meebewegen; het is de
# reden dat de herstellus een script is en geen for-lus over *.json.
try:
    _namen = [x["name"] for x in json.loads(lees("cloudflare/kv/alle-sleutels.json", "[]"))]
except ValueError:
    _namen = []
_soort = lambda n: n.split(":")[0] if ":" in n else ""
_bucketsleutels = [n for n in _namen if _soort(n) not in
                   ("dpfile", "plfile", "schipfile", "dp-sess", "mailsleutel", "dp-login")]
_verminkt = [n for n in _bucketsleutels
             if any(not ((c.isalnum() and c.isascii()) or c in "._-") for c in n)]
# Welke soorten dat zijn, wisselt: de spa-foto's staan er altijd, een uitnodiging
# (dp-invite:) en een rate-limit-teller (rl:) komen en gaan. Daarom opsommen wat
# er nu staat in plaats van een lijstje dat over een maand niet meer klopt.
_telling = {}
for n in _verminkt:
    _telling[n.split(":")[0]] = _telling.get(n.split(":")[0], 0) + 1
_soorten = ", ".join("%d x `%s:`" % (a, s2) for s2, a in
                     sorted(_telling.items(), key=lambda x: (-x[1], x[0]))) or "geen op dit moment"

# Welke van de achttien workergeheimen staan echt in deze backup? Vastgesteld
# bij de herstelrepetitie van 01-09-2026 door sleutels/ regel voor regel naast
# geheimen-namen.txt te leggen. "De rest haal je bij de leverancier op" klinkt
# geruststellender dan het is, dus staat het hier per naam.
uit_backup = {
    "SHARED_SECRET":          "sleutels/fonteyn-teamsleutel-dashboard.txt",
    "DP_ADMIN_KEY":           "sleutels/fonteyn-beheersleutel-dealerportaal.txt",
    "MOLLIE_API_KEY":         "sleutels/fonteyn-mollie-key.txt",
    "FLEXPORT_CLIENT_ID":     "sleutels/Flexport API.rtf",
    "FLEXPORT_CLIENT_SECRET": "sleutels/Flexport API.rtf",
    "QB_CLIENT_ID":           "sleutels/fonteyn-api-quickbooks-id-secret.rtf",
    "QB_CLIENT_SECRET":       "sleutels/fonteyn-api-quickbooks-id-secret.rtf",
    "LOGIC4_USERNAME":        "sleutels/server-env.txt",
    "LOGIC4_PASSWORD":        "sleutels/server-env.txt",
}
waar_opnieuw = {
    "LOGIC4_COMPANYKEY":    "Logic4 (beheerscherm, of de accountmanager)",
    "LOGIC4_PUBLICKEY":     "Logic4 (beheerscherm, of de accountmanager)",
    "LOGIC4_SECRETKEY":     "Logic4 (beheerscherm, of de accountmanager)",
    "LOGIC4_ADMINISTRATION":"Logic4 (beheerscherm, of de accountmanager)",
    "RESEND_API_KEY":       "Resend, onder API Keys",
    "KIOSK_KEY":            "zelf verzinnen; daarna in de kiosk-app gelijkzetten",
    "KIOSK_REDIRECT_URL":   "zelf invullen; het adres waar de kiosk op terugkomt",
    "QB_API_BASE":          "QuickBooks; het adres van de API, geen wachtwoord",
    "MAIL_FROM":            "zelf invullen; het afzenderadres van de mails",
}
# De namenlijst van Cloudflare is leidend. Staat er ooit een geheim bij dat
# hierboven niet voorkomt, dan valt het vanzelf in de tweede tabel op als
# onbekend - liever dat dan dat het stilletjes verdwijnt.
alle_geheim = geheim or sorted(set(uit_backup) | set(waar_opnieuw))
rij_wel = [f"| `{n}` | `{uit_backup[n]}` |" for n in alle_geheim if n in uit_backup]
rij_niet = [f"| `{n}` | {waar_opnieuw.get(n, 'ONBEKEND - uitzoeken')} |" for n in alle_geheim if n not in uit_backup]
tabel_wel = chr(10).join(rij_wel) or "| - | geen |"
tabel_niet = chr(10).join(rij_niet) or "| - | geen |"

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

Daarna de geheimen zetten, stuk voor stuk:

    npx wrangler secret put <NAAM> --cwd data-worker

De volledige namenlijst zoals Cloudflare hem kent staat in
`cloudflare/config/geheimen-namen.txt`. Van die {len(alle_geheim)} geheimen zitten
er {len(rij_wel)} in deze backup en {len(rij_niet)} niet. Op die tweede helft
loopt een herstel vast, dus hier staat per naam waar hij vandaan moet komen.

**Wel in de backup** - overtypen uit deze map:

| geheim | staat in |
|---|---|
{tabel_wel}

**Niet in de backup** - opnieuw ophalen:

| geheim | waar vandaan |
|---|---|
{tabel_niet}

Let op de vier Logic4-sleutels: `LOGIC4_COMPANYKEY`, `LOGIC4_PUBLICKEY`,
`LOGIC4_SECRETKEY` en `LOGIC4_ADMINISTRATION`. Zonder die vier komt de worker
niet bij Logic4 binnen en liggen voorraad, orders en Houston stil - de rest van
het dashboard komt wel gewoon terug. Ze staan nergens in deze backup en ook
nergens anders buiten Cloudflare; opnieuw opvragen bij Logic4 is de enige weg,
en Gerrit weet bij wie. Reken erop dat daar een werkdag overheen kan gaan, dus
begin er meteen mee en niet aan het eind.

`SHARED_SECRET` is de teamsleutel: dezelfde waarde die in `sleutels/` staat.
Zet je daar iets anders neer, dan moet iedereen opnieuw inloggen.

## 4. De gegevens terug

Hiervoor staan twee scripts in de repo. Doe dit niet met de hand: de
bestandsnamen in `buckets/` zijn niet allemaal gelijk aan de sleutelnaam, en
dat zie je pas als het dashboard dingen niet meer vindt (zie het kader onderaan
deze stap).

    cd ~/GitHub/douanepapieren-data
    bash tools/herstel-buckets.sh    --dry-run
    bash tools/herstel-documenten.sh --dry-run

`--dry-run` schrijft niets; het laat alleen zien welke sleutel uit welk bestand
zou komen en welke sleutels geen bestand hebben. Klopt dat beeld, dan echt:

    bash tools/herstel-buckets.sh    --namespace-id <id>
    bash tools/herstel-documenten.sh --namespace-id <id>

Beide vragen eerst om een bevestiging (`--ja` slaat die over) en tellen aan het
eind hoeveel sleutels ze hebben teruggezet en welke ze niet konden vinden.
Staat deze backupmap ergens anders dan op de standaardplek, geef dan
`--backup "<map>"` mee.

Eén sleutel met de hand terugzetten kan ook, bijvoorbeeld als er per ongeluk
maar één bucket is gewist:

    npx wrangler kv key put "voorraad-schepen" \\
      --path "cloudflare/kv/buckets/voorraad-schepen.json" \\
      --namespace-id <id> --remote

> **Waarom niet met een lus over de bestanden**
>
> Dat lijkt makkelijker en gaat op twee manieren mis.
>
> `backup-een-sleutel.sh` maakt van de sleutel een veilige bestandsnaam: alles
> buiten `A-Za-z0-9._-` wordt een liggend streepje. Van de {len(_bucketsleutels)}
> buckets hebben er nu {len(_verminkt)} zo'n teken in de sleutel: {_soorten}.
> Dat aantal wisselt - de spa-foto's blijven, een uitnodiging (`dp-invite:`) of
> een rate-limit-teller (`rl:`) komt en gaat. `basename` levert voor zo'n sleutel
> `spafoto_bliss` op in plaats van `spafoto:bliss`: de sleutel bestaat dan wel,
> maar niemand vraagt hem ooit op.
>
> En niet elke bucket is JSON. In `buckets/` staan `.json`, `.txt` en `.bin`
> door elkaar; de spa-foto's zijn allemaal `.bin`. Een lus over `*.json` slaat
> die zonder één woord over.
>
> De scripts doen het daarom andersom: ze lopen `cloudflare/kv/alle-sleutels.json`
> af, rekenen daaruit de bestandsnaam uit, zoeken het bestand ongeacht de
> extensie, en zetten het terug onder de echte sleutelnaam.

De documenten (`dpfile:`, `plfile:`, `schipfile:`) hebben dit probleem juist
niet: die houden hun echte pad, want er wordt niets aan gesaneerd. Het pad
achter de dubbele punt is precies het pad binnen de map:

    dpfile:<pad>     ->  cloudflare/kv/documenten/dealerportaal/<pad>
    plfile:<pad>     ->  cloudflare/kv/documenten/prijslijsten/<pad>
    schipfile:<pad>  ->  cloudflare/kv/documenten/schepen/<pad>

Bij `schipfile:` begint het pad zelf al met `schepen/`, dus die bestanden staan
onder `documenten/schepen/schepen/...`. Dat ziet er dubbel uit maar hoort zo;
haal je die tweede map weg, dan vindt het herstelscript de bestanden niet meer.

    npx wrangler kv key put "dpfile:spas/eu/passion-spas/relax.pdf" \\
      --path "cloudflare/kv/documenten/dealerportaal/spas/eu/passion-spas/relax.pdf" \\
      --namespace-id <id> --remote

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
