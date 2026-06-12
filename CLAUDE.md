# Fonteyn Dashboard — projectgids voor Claude

Dit bestand wordt automatisch ingelezen door elke Claude Code-sessie die deze
repo opent. Houd 'm bondig en up-to-date — wat hier staat is gedeelde kennis
voor alle sessies (Logistiek, Orderstatus, toekomstige modules).

## Wat is dit project

Electron-app **Fonteyn Dashboard** voor het kantoor in Uddel. Bundelt meerdere
interne tools onder één login (Logic4-account). Geïnstalleerd als native app
op Mac (.dmg) en Windows (.exe). Gebruikt door o.a. Manon (logistiek), Don,
Arno, Dolf, Gerriette.

Repo `douanepapieren-data` is **zowel** broncode **als** runtime-data:
- `main.js` + `package.json` → Electron-shell, gebundeld in de installer
- `dashboard.html`, `douane.html`, `labels.html`, `order-status.html`,
  `stuurcijfers.html` → de tools, **live opgehaald van GitHub** bij elke start
- `manifest.json` → lijst van bestanden die de app moet downloaden
- `server/` → lokale helper-server (Logic4 API-proxy, sessies)
- `article-codes.json`, `spec-database.json` → data voor douane-tool

## Deploy-flow — push naar main = deploy

**Pushen naar `main` IS de deploy.** De Electron-app haalt bij elke start
`manifest.json` + alle genoemde files van `raw.githubusercontent.com/.../main`
en cachet ze in `userData/live`. Geen aparte release-stap nodig voor HTML/JSON
updates. Alleen voor `main.js` / dependency-changes is een nieuwe `.dmg/.exe`
release nodig (electron-updater regelt dat automatisch via GitHub Releases).

**Daarom:** geen feature-branches, geen PRs. Direct committen naar `main`.
Wel altijd eerst rebasen — zie hieronder.

## Multi-session werkregels

Er werken meerdere Claude-sessies parallel aan deze repo (verschillende
modules tegelijk). Om elkaars werk niet te overschrijven:

1. **Vóór elke edit:** `git fetch origin main && git rebase origin/main`
2. **Vóór elke push:** rebase opnieuw als je langer dan een paar minuten bezig bent
3. **De `pre-push` hook** in `.git/hooks/pre-push` blokkeert pushes die een
   bestand sterk inkrimpen of recente origin/main-commits missen. Override met
   `git push --no-verify` (alleen als je zeker weet dat het klopt).
4. **Lees `git log --oneline -10` voordat je een gedeeld bestand bewerkt**
   (vooral `dashboard.html`, `manifest.json`, `main.js`).

## Huisstijl Fonteyn

Strikte huisstijl, niet aanpassen tenzij user vraagt:

- **Primair:** `--fonteyn-green: #144734` (donkergroen, header / brand)
- **Donker variant:** `--fonteyn-green-dark: #0d3325`
- **Accent CTA:** `--fonteyn-lime: #8bc53f` (knoppen, hover-borders)
- **Accent donker:** `--fonteyn-lime-dark: #72a531`
- **Lichte highlight:** `--fonteyn-cream: #fff9ae` (bv. "Binnenkort"-badges)
- **Body bg:** `#f5f4ef` (warme off-white)
- **Font:** Montserrat (400/500/600/700) via Google Fonts
- **Logo:** `fonteyn-logo.png` (witte tekst + gouden waterdruppel — alleen op
  donkere achtergrond gebruiken)

Header op elke pagina: dark green met logo links, user-info + logout rechts.
Login-scherm: groene brand-balk bovenaan met logo, witte form-body eronder,
lime "Inloggen" knop.

## Naam-formattering

Begroeting in dashboard gebruikt `prettyNameFromEmail()`:
`gerriette@fonteyn.nl` → "Gerriette",  `jan.pieter@fonteyn.nl` → "Jan Pieter".

Splitst op `.` `-` `_`, eerste letter van elk deel wordt hoofdletter, rest
lowercase. Werkt ook als user al hoofdletters typt.

## Tile-toegang per gebruiker

`dashboard.html` → `TILE_ACCESS` mapping bepaalt welke tegels zichtbaar zijn
per e-mailadres (lowercase). Server doet ook een check op rol-gebonden
endpoints, dus client-only verstoppen is niet veilig genoeg — beide kanten
afdichten.

## Modules — wat zit waar

- **Douanepapieren** (`douane.html`) — PDF-invoice → CMR-papieren. Logic4 of
  PDF-upload als bron. Bewerkbare regels (slepen, verwijderen), auto-fill via
  `article-codes.json` + `spec-database.json`. `getSpec(code, description)`
  gebruikt regel-omschrijving als primaire bron, articleCodes als fallback.
- **Inkomende goederen** (`labels.html`) — doos-labels printen op een
  Zebra ZDesigner GK420d (thermisch). **Bewezen-correcte print-setup
  (live-sessie Manon, juni 2026):** Printstand **Gedraaid**, Label
  **104 × 214 mm**, ÉN de ZDesigner-driver op exact 104×214
  (Voorkeursinstellingen → Grootte). De **214** is de volledige pitch
  (perforatie-tot-perforatie incl. gap), NIET de zichtbare labelhoogte
  van 210mm. Met de verkeerde lengte schoof de printer een blanco
  tussenlabel uit bij elke print — maanden zoekwerk. Pitch verkeerd =
  blanco's; maat veranderen zonder de échte pitch deed niks. Na elke
  rol-/maatwijziging ook de GK420d **gap-sensor herkalibreren**: FEED-
  knop ~6-7 knipperingen ingedrukt houden. Maat + printstand-keuze zijn
  uit de UI gehaald (v0.20.0) — 104×214 gedraaid staat hardcoded.
  Print-route: "Labels printen" toont een bevestigingspopup en print
  dan **silent** naar de ZDesigner via de Electron-bridge
  `printLabelsSilent` (portrait 104×214, main.js handler
  `fonteyn:print-labels-silent`). Oude shells zonder die bridge vallen
  terug op `window.print()`. Diagnose-truc: print naar "Microsoft Print to PDF"
  en tel de pagina's — 2 voor 2 labels = onze kant goed, blanco's zijn
  dan printer-kant (pitch/kalibratie).
- **Orderstatus** (`order-status.html`) — beperkte doelgroep (don/arno/dolf),
  Logic4 betaalde-orders status updaten met audit-trail.
- **Stuurcijfers** (`stuurcijfers.html`) — Logic4 Excel client-side parsen,
  formules voor financiële OUT_-tabbladen. Extra wachtwoord ('Meerveld').
  Alleen voor gerriette + dolf.

## Logic4 helper-server

`server/index.js` draait op `127.0.0.1:3737`. Doet auth (sessies in geheugen),
proxy naar Logic4 API met app-level keys uit env (gezet door `main.js`).
Endpoints: `/api/login`, `/api/me`, `/api/logout`, `/api/order/:nr`,
`/api/article-codes`, `/api/spec-database`, `/api/orderstatus/*`,
`/api/stuurcijfers/*`. Alle pages doen same-origin fetches via deze server.

## Auto-update

- HTML/JSON: bij elke start via manifest (zie boven). Géén release nodig.
- Electron shell zelf: `electron-updater` checkt GitHub Releases bij start +
  elk uur. Installeert stilletjes bij quit. Builds via GitHub Actions
  workflow op tag push.

## Screenshots — 2000px-limiet opgelost via auto-resize

Bij gesprekken met **meerdere** afbeeldingen handhaaft Claude een harde
**2000px-limiet** (lange zijde) op álle plaatjes in de conversatie. macOS
screenshots staan op native Retina-resolutie (3024–3840 px breed), dus die
overschrijden die grens vrijwel altijd.

Symptoom: `An image in the conversation exceeds the dimension limit for
many-image requests (2000px). Start a new session with fewer images.`
Eén te grote screenshot blokkeert daarna élk vervolgbericht in dezelfde
sessie. Workaround als het tóch nog eens optreedt: **fork het gesprek**
op een punt vóór de problematische afbeelding.

**Auto-resize setup (actief op deze Mac, 2026-05-11):**
- Screenshot-locatie verplaatst naar `~/Pictures/Screenshots/`
  (`defaults write com.apple.screencapture location ...`). Reden: macOS
  TCC blokkeert LaunchAgents van het lezen van `~/Desktop`, dus die map
  is niet bruikbaar voor automatische verwerking.
- LaunchAgent `~/Library/LaunchAgents/com.gerrit.screenshot-resize.plist`
  watcht `~/Pictures/Screenshots/` en triggert het script
  `~/.local/bin/resize-screenshots.sh`, die elke nieuwe screenshot met
  `sips -Z 1800` verkleint zodra de lange zijde > 1800 px is.
- Log: `~/.local/share/resize-screenshots.log`.

**Reverten:**
```sh
launchctl bootout "gui/$(id -u)/com.gerrit.screenshot-resize"
rm ~/Library/LaunchAgents/com.gerrit.screenshot-resize.plist
rm ~/.local/bin/resize-screenshots.sh
defaults delete com.apple.screencapture location  # screenshots terug naar Bureaublad
killall SystemUIServer
```

## Codewoord `Manon-dag` — opgespaard werk voor dag-met-Manon

Als de user de term **`Manon-dag`** noemt (in welke vorm dan ook — "we gaan
een Manon-dag doen", "het is Manon-dag", etc.), haal dan dit plan op en
presenteer het stap-voor-stap. Het is werk dat per se met Manon erbij moet,
omdat het haar input vereist (klant→adviseur-mapping invullen). Niet zelf
proberen uit te voeren zonder bevestiging van de user.

### Achtergrond — waarom dit moet wachten

Bij order-ophalen in Douanepapieren faalt de auto-fill van **Advisor +
Advisor-email** voor portal-orders (klant plaatst zelf via webshop).
Diagnose (sessie 2026-05-24):
- Order 3510276 (Florida Pools — A-MAC, DebtorId 878848794) heeft alleen
  `UserId = 2005726` (= customer-portal-account, geen interne adviseur)
- ALLE 13 Logic4-endpoints voor Debtors/Customers/Users/Globalizations
  retourneren 404 → API-key heeft geen scope op die modules
- Wel werkend: `/v3/Orders/*`, `/v3/Products/*`, `/v3/BuyOrders/*`

We hebben dus géén Logic4-route om adviseur op te halen. Oplossing:
**klant→adviseur-mapping handmatig invullen** (eenmalig per actieve klant,
~50-100 stuks) en opslaan in Cloudflare KV zodat 't shared is + auto-fillt
bij elke volgende order van dezelfde klant.

### Voor de Manon-dag — voorbereiding zonder Manon

Eerst proberen Logic4-support te bellen of mailen of de API-key uitgebreid
kan worden met scope `Debtors` en `Users`/`SalesEmployees`. Als dat lukt is
er geen Manon-dag nodig — de bestaande code in `douane.html`
(`mapLogic4Order` checkt al debtor.AccountManagerId etc.) werkt dan
automatisch. Dit eerst proberen voordat we Manon's tijd vragen.

### Op de Manon-dag — wat ik (Claude) moet bouwen

1. **KV-bucket `advisors`** toevoegen aan `data-worker/src/worker.js`
   (ALLOWED_BUCKETS) en pushen naar Cloudflare. Formaat per record:
   ```js
   {
     "878848794": { name: "Manon", email: "manon@fonteyn.nl",
                    customerName: "Florida pools and spas - A-MAC",
                    addedBy: "manon@fonteyn.nl", addedAt: "2026-..." }
   }
   ```

2. **Vaste adviseur-lijst hardcoden** in douane.html (bovenaan):
   ```js
   const FONTEYN_ADVISORS = [
     { name: "Manon", email: "manon@fonteyn.nl" },
     { name: "Don",   email: "don@fonteyn.nl" },
     { name: "Arno",  email: "arno@fonteyn.nl" },
     { name: "Dolf",  email: "dolf@fonteyn.nl" },
     { name: "Gerrit",email: "gerrit@fonteyn.nl" },
     // checken bij Manon of er nog meer/andere zijn — Gerriette? Sales-team?
   ];
   ```

3. **UI in douane.html — twee plekken**:
   - **Bij order-ophalen**: als `DebtorId` niet in mapping zit, toon banner
     bovenaan met dropdown "Wie is de adviseur van [klant-naam]?" + opslaan-
     knop. Na opslaan vult 't direct het Advisor-veld + slaat op in KV.
   - **Knop "Adviseurs beheren"** opent een modal met alle bestaande
     koppelingen, zoekveld, en mogelijkheid om te wijzigen of verwijderen.
     Lijst sorteerbaar op klantnaam.

4. **Auto-fill in mapLogic4Order**:
   - Na `loadAdvisorMappingFromServer()` (te maken, analoog aan
     `loadUserSpecsFromServer`)
   - Check `state.advisors[String(o.DebtorId)]` — als bestaat: vul direct
   - Anders: laat banner zien, advisor-velden blijven leeg

5. **Bulk-invul-modus (optioneel maar handig op die dag)**:
   - Modal "Bulk koppelen": haalt laatste 100 orders op via Logic4,
     extraheert unieke DebtorIds, toont één-voor-één met dropdown
   - Manon klikt door, ik schrijf elke keuze direct naar KV
   - Zo zit binnen 30-60 min de meeste catalogus vast

### Met Manon op de dag — agenda

1. **00:00-00:15** — Plan doornemen, vragen beantwoorden
2. **00:15-00:45** — Ik bouw de UI (modal + auto-fill + KV-sync) live
3. **00:45-01:30** — Bulk-modus draaien: Manon klikt door 50-100 klanten,
   ik los bugs op terwijl ze invult
4. **01:30-02:00** — Eindcheck: paar willekeurige orders ophalen, advisor
   moet auto-vullen. Edge-cases (klant zonder adviseur = "nog te koppelen"
   banner)
5. **Rest van de dag** — andere openstaande douane-wensen die Manon heeft
   (vraag haar bij start van de dag wat er nog niet goed werkt)

### Niet vergeten

- **EORI-veld blijft handmatig** — die kwam ook uit de debtor, maar dat
  endpoint is óók 404. Voeg EORI eveneens toe aan de advisor-mapping per
  klant (handig om in één keer mee te nemen tijdens bulk-modus)
- **Hsign-code (HS code) blijft handmatig** — Manon vult deze nu al per
  order in, niet automatiseren
- **Test op order 3510276** als referentie-case — die heeft alle pijn-
  punten in één order
- **Geen Logic4-API-calls toevoegen** voor klant-lookup — die zijn al
  geprobeerd en falen allemaal met 404

## Wat NIET doen

- Geen feature branches / PRs — alles direct naar main
- Niet `--no-verify` gebruiken zonder te begrijpen waarom de hook waarschuwt
- Geen wachtwoorden, API-keys of credentials in code (helper leest uit
  `server/.env` lokaal, of uit `main.js` env-vars die alleen in installer
  zitten)
- Geen secrets committen — `dev-credentials.json` staat in `.gitignore`
- Niet de huisstijl per ongeluk weghalen bij refactor (zie historie:
  is al twee keer gebeurd)
