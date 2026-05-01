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
- **Inkomende goederen** (`labels.html`) — A6 doos-labels printen.
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

## Wat NIET doen

- Geen feature branches / PRs — alles direct naar main
- Niet `--no-verify` gebruiken zonder te begrijpen waarom de hook waarschuwt
- Geen wachtwoorden, API-keys of credentials in code (helper leest uit
  `server/.env` lokaal, of uit `main.js` env-vars die alleen in installer
  zitten)
- Geen secrets committen — `dev-credentials.json` staat in `.gitignore`
- Niet de huisstijl per ongeluk weghalen bij refactor (zie historie:
  is al twee keer gebeurd)
