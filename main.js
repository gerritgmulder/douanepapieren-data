// Electron main process voor de Fonteyn-tools (dashboard + modules).
//
// Wat deze doet:
// 1. Bakt de Logic4 app-level keys in (PublicKey/SecretKey/CompanyKey/Administration).
//    Username/password zitten NIET meer ingebakken — iedereen logt in via het
//    dashboard met z'n eigen Logic4-account.
// 2. Haalt bij elke start een `manifest.json` van GitHub waarin staat welke
//    HTML- en data-bestanden de tool gebruikt. Download elk bestand naar de
//    live-cache in userData. Zo kunnen we modules toevoegen zonder een nieuwe
//    .exe naar gebruikers te sturen.
// 3. Start de helper-server (server/index.js) op 127.0.0.1:3737.
// 4. Opent één venster dat de shell (dashboard.html) laadt.

import { app, BrowserWindow, Menu, shell, dialog, ipcMain } from "electron";
import pkg from "electron-updater";
const { autoUpdater } = pkg;
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════
// Auto-update vanaf GitHub — manifest-driven.
// ═══════════════════════════════════════════════════════════════
// De repo `douanepapieren-data` bevat een `manifest.json` en alle HTML/JSON
// bestanden die daarin genoemd worden. Bij elke start:
//   (1) manifest ophalen, (2) elk bestand downloaden naar live-cache.
// Faalt het netwerk: we draaien door op de laatst-gecachte versie (of, bij
// allereerste run ooit, op de in de .exe meegebundelde defaults).
//
// Om een nieuwe module toe te voegen: push de .html naar de data-repo en
// voeg 'm toe aan manifest.json. Geen nieuwe .exe nodig.
// ═══════════════════════════════════════════════════════════════
const GITHUB_USER   = "gerritgmulder";
const GITHUB_REPO   = "douanepapieren-data";
const GITHUB_BRANCH = "main";
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;
// Vangnet als raw.githubusercontent.com geblokkeerd is (sommige bedrijfs-
// firewalls doen dat): onze eigen worker serveert dezelfde bestanden.
const OTA_BASE = "https://fonteyn-data-store.g-mulder.workers.dev/ota";

// Bundled defaults: als de userData live-map leeg is, kopieer deze bestanden.
// Dit zijn de bestanden die ook in de .exe terechtkomen via electron-packager.
const BUNDLED_DEFAULTS = [
  { name: "manifest.json",       path: path.join(__dirname, "manifest.json") },
  { name: "dashboard.html",      path: path.join(__dirname, "dashboard.html") },
  { name: "douane.html",         path: path.join(__dirname, "douane.html") },
  { name: "douanetool.html",     path: path.join(__dirname, "douanetool.html") }, // legacy redirect
  { name: "labels.html",         path: path.join(__dirname, "labels.html") },
  { name: "order-status.html",   path: path.join(__dirname, "order-status.html") },
  { name: "stuurcijfers.html",   path: path.join(__dirname, "stuurcijfers.html") },
  { name: "stuurcijfers-engine.js", path: path.join(__dirname, "stuurcijfers-engine.js") },
  { name: "fonteyn-logo.png",       path: path.join(__dirname, "fonteyn-logo.png") },
  { name: "article-codes.json",     path: path.join(__dirname, "server", "article-codes.json") },
  { name: "spec-database.json",     path: path.join(__dirname, "server", "spec-database.json") },
  { name: "packaging-database.json", path: path.join(__dirname, "packaging-database.json") },
  { name: "transport.html",         path: path.join(__dirname, "transport.html") },
  { name: "eikensingel.html",       path: path.join(__dirname, "eikensingel.html") },
  { name: "prijslijst.html",        path: path.join(__dirname, "prijslijst.html") },
  { name: "passion-logo.png",       path: path.join(__dirname, "passion-logo.png") },
  { name: "bankkoppeling.html",     path: path.join(__dirname, "bankkoppeling.html") },
  { name: "personeel.html",         path: path.join(__dirname, "personeel.html") },
];

let liveDir = null;

async function bootstrapLiveDir() {
  // DEV-MODE: als we via `npm start` draaien (niet uit een gepackte .exe), lees
  // direct uit de projectmap. Dan zie je bij elke Cmd+R meteen je code-wijzigingen
  // zonder omweg via cache of GitHub. In productie (Manons .exe) blijft alles
  // zoals vanouds: cache in userData/live + auto-update vanaf GitHub.
  if (!app.isPackaged) {
    liveDir = __dirname;
    console.log(`[dev-mode] HTML/JSON worden direct uit projectmap geserveerd: ${liveDir}`);
    console.log(`[dev-mode] (auto-update vanaf GitHub is overgeslagen)`);
    return;
  }

  liveDir = path.join(app.getPath("userData"), "live");
  await fs.mkdir(liveDir, { recursive: true });

  // Bij allereerste run: kopieer bundled defaults zodat we sowieso kunnen werken,
  // ook offline. Als een bestand al bestaat in live/ (van vorige sessie), laat staan.
  for (const f of BUNDLED_DEFAULTS) {
    const dest = path.join(liveDir, f.name);
    if (!existsSync(dest)) {
      try {
        if (existsSync(f.path)) {
          await fs.copyFile(f.path, dest);
          console.log(`[bootstrap] ${f.name} gekopieerd uit bundled defaults`);
        }
      } catch (e) {
        console.warn(`[bootstrap] kon ${f.name} niet kopiëren:`, e.message);
      }
    }
  }
}

/**
 * Lees een lokaal bestand als tekst. Null bij falen.
 */
async function readLocalText(filePath) {
  try { return await fs.readFile(filePath, "utf-8"); } catch { return null; }
}

/**
 * Fetch met timeout en cache-buster. Returnt Buffer of null bij falen.
 */
async function fetchRaw(url) {
  try {
    const r = await fetch(`${url}?t=${Date.now()}`, {
      signal: AbortSignal.timeout(8000),
      headers: { "Cache-Control": "no-cache" }
    });
    if (!r.ok) {
      console.warn(`[update] ${url}: HTTP ${r.status}`);
      return null;
    }
    return Buffer.from(await r.arrayBuffer());
  } catch (e) {
    console.warn(`[update] ${url} niet opgehaald (offline?):`, e.message);
    return null;
  }
}

/* Hetzelfde, maar met een vraag vooraf: is dit bestand eigenlijk wel veranderd?
   ═══════════════════════════════════════════════════════════════════════
   GitHub geeft bij elk bestand een ETag mee. Sturen we die de volgende keer
   terug, dan antwoordt GitHub met 304 "niet gewijzigd" en komt er geen inhoud
   over de lijn. Bij een gewone start is er niets veranderd en scheelt dat het
   grootste deel van het verkeer.

   Geeft hij 304, dan houden we het bestand dat er al staat. */
async function fetchRawEtag(url, etag) {
  try {
    const koppen = { "Accept-Encoding": "gzip" };
    if (etag) koppen["If-None-Match"] = etag;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: koppen });
    if (r.status === 304) return { ongewijzigd: true, etag };
    if (!r.ok) { console.warn(`[update] ${url}: HTTP ${r.status}`); return null; }
    return { buf: Buffer.from(await r.arrayBuffer()), etag: r.headers.get("etag") || null };
  } catch (e) {
    console.warn(`[update] ${url} niet opgehaald (offline?):`, e.message);
    return null;
  }
}

/* Een rijtje werk parallel afhandelen. Eén voor één ophalen kostte op een
   trage kantoorlijn seconden per bestand, en met 77 bestanden liep het
   opstarten daardoor op tot bijna twintig seconden (Gerrit, 7 sep 2026:
   "het moet gewoon 3 seconden zijn"). Twaalf tegelijk is genoeg om de lijn te
   vullen zonder GitHub te overvragen. */
async function parallel(lijst, aantal, doe) {
  const rij = lijst.slice();
  const werkers = Array.from({ length: Math.min(aantal, rij.length) }, async () => {
    while (rij.length) { const item = rij.shift(); await doe(item); }
  });
  await Promise.all(werkers);
}

async function fetchLiveUpdates() {
  // 1) Haal het manifest op. Valideer als JSON voordat we 'm opslaan.
  //    Eerst rechtstreeks bij GitHub; lukt dat niet, dan via onze eigen
  //    Cloudflare-worker, die hetzelfde bestand serverside bij GitHub haalt.
  //    Aanleiding (26 aug 2026): op de kantoor-pc van Arno is
  //    raw.githubusercontent.com geblokkeerd terwijl github.com en de worker
  //    het daar gewoon doen — de tegels bleven daardoor dagenlang oud staan
  //    terwijl de schil zich netjes bijwerkte.
  let bron = "github";
  let manifestBuf = await fetchRaw(`${RAW_BASE}/manifest.json`);
  if (!manifestBuf || manifestBuf.length === 0) {
    bron = "worker";
    manifestBuf = await fetchRaw(`${OTA_BASE}/manifest.json`);
  }
  let remoteManifest = null;
  if (manifestBuf && manifestBuf.length > 0) {
    try {
      remoteManifest = JSON.parse(manifestBuf.toString("utf-8"));
      await fs.writeFile(path.join(liveDir, "manifest.json"), manifestBuf);
      console.log(`[update] ✓ manifest.json (v${remoteManifest.version || "?"}) opgehaald via ${bron}`);
    } catch (e) {
      console.warn(`[update] manifest.json ongeldig JSON:`, e.message);
      remoteManifest = null;
    }
  }

  // Welke weg het werd, komt in de live-map te staan zodat dashboard.html
  // het kan meesturen — zo is op afstand te zien welke pc's op het vangnet
  // draaien. Geen manifest via geen van beide wegen = "cache".
  try {
    await fs.writeFile(path.join(liveDir, "ota-bron.json"),
      JSON.stringify({ bron: remoteManifest ? bron : "cache", ts: new Date().toISOString() }));
  } catch {}

  // 2) Fallback: als remote niet werkte, gebruik de lokale manifest om te weten
  //    welke files we zouden willen (bv. om alsnog wat te refreshen als dat lukt).
  if (!remoteManifest) {
    const localManifestText = await readLocalText(path.join(liveDir, "manifest.json"));
    if (localManifestText) {
      try { remoteManifest = JSON.parse(localManifestText); } catch {}
    }
  }
  if (!remoteManifest || !Array.isArray(remoteManifest.files)) {
    console.warn("[update] geen bruikbaar manifest — draai door op huidige live-cache");
    return;
  }

  // 3) Download elk bestand uit het manifest, langs dezelfde weg als het
  //    manifest. Faalt één bestand via GitHub, dan vangt de worker dat op.
  /* Alle bestanden tegelijk in plaats van één voor één, en alleen ophalen wat
     écht veranderd is.

     Hiervoor ging dit met een lus van 77 bestanden achter elkaar, elk met een
     cache-buster erachter zodat er ook nog eens niets gecachet kon worden. Op
     een trage lijn kostte dat bijna twintig seconden, en al die tijd stond er
     nog geen venster in beeld. Gerrit (7 sep 2026): "19 seconden duurt het om
     de app te openen. Het moet gewoon 3 seconden zijn."

     Nu twaalf tegelijk, met de ETag van de vorige keer erbij. Is er niets
     veranderd, dan antwoordt GitHub met 304 en komt er geen inhoud over de
     lijn - wat bij een gewone start voor bijna elk bestand geldt. */
  const basis = bron === "worker" ? OTA_BASE : RAW_BASE;
  const etagPad = path.join(liveDir, "ota-etags.json");
  let etags = {};
  try { etags = JSON.parse(await readLocalText(etagPad) || "{}") || {}; } catch { etags = {}; }

  const teDoen = remoteManifest.files.filter(e => e && e.name && e.name !== "manifest.json");
  let bij = 0, gelijk = 0, mis = 0;
  const begonnen = Date.now();

  await parallel(teDoen, 12, async (entry) => {
    /* Een bestand dat er nog niet staat moet altijd opgehaald worden, ook als
       we er toevallig een ETag van hebben - anders zou een gewiste live-map
       leeg blijven. */
    const doelPad = path.join(liveDir, entry.name);
    const heeftAl = existsSync(doelPad);
    let r = await fetchRawEtag(`${basis}/${entry.name}`, heeftAl ? etags[entry.name] : null);
    if (!r && basis === RAW_BASE) r = await fetchRawEtag(`${OTA_BASE}/${entry.name}`, null);
    if (!r) { mis++; return; }
    if (r.ongewijzigd) { gelijk++; return; }
    const buf = r.buf;
    if (!buf || buf.length === 0) { mis++; return; }

    // Optionele validatie: voor JSON-bestanden niet overschrijven met corrupt bestand
    if (entry.validate === "json" || entry.name.endsWith(".json")) {
      try { JSON.parse(buf.toString("utf-8")); }
      catch {
        console.warn(`[update] ${entry.name}: ongeldige JSON, overschrijven overgeslagen`);
        return;
      }
    }
    /* Eerst ernaast schrijven, dan omwisselen.
       ═══════════════════════════════════════════════════════════════════
       Sinds het bijwerken achter het venster door loopt in plaats van
       ervoor, kan het hulpprogramma een bestand aan het uitserveren zijn op
       hetzelfde moment dat het hier wordt overschreven. Rechtstreeks
       schrijven levert dan een halve pagina op - en dat is precies het soort
       storing waar niemand iets van begrijpt.

       Een rename op hetzelfde volume is één handeling: wie leest, krijgt óf
       het oude bestand óf het nieuwe, nooit een half bestand. */
    const tijdelijk = doelPad + ".nieuw";
    try {
      await fs.writeFile(tijdelijk, buf);
      await fs.rename(tijdelijk, doelPad);
      etags[entry.name] = r.etag;
      bij++;
    } catch (e) {
      try { await fs.unlink(tijdelijk); } catch {}
      console.warn(`[update] ${entry.name} niet opgeslagen:`, e.message);
    }
  });

  try { await fs.writeFile(etagPad, JSON.stringify(etags)); } catch {}
  console.log(`[update] ${bij} bijgewerkt, ${gelijk} ongewijzigd, ${mis} niet opgehaald ` +
              `(${((Date.now()-begonnen)/1000).toFixed(1)}s)`);
}

// ═══════════════════════════════════════════════════════════════
// Logic4 APP-LEVEL credentials (worden door server/index.js gelezen uit env).
// Username/password zitten bewust NIET in deze .exe — die komen via login.
// ═══════════════════════════════════════════════════════════════
process.env.LOGIC4_PUBLICKEY      = "hrr6nE8Nmbb7DvoWsXyH5T6N";
process.env.LOGIC4_SECRETKEY      = "XSr8tqJ7KH8qHnAty7xEx4Ls";
process.env.LOGIC4_COMPANYKEY     = "9mNSxLw2zHCs";
process.env.LOGIC4_ADMINISTRATION = "1";
process.env.PORT                  = "3737";

const PORT = 3737;
const URL  = `http://127.0.0.1:${PORT}/`;

let mainWindow = null;
/* De extra tegelvensters, op paginanaam. Zo weten we of een tegel al ergens
   openstaat en kunnen we hem naar voren halen in plaats van verdubbelen. */
const tegelVensters = new Map();

/* Een tegel in een eigen venster. Iets kleiner dan het hoofdvenster en steeds
   een stukje verschoven, zodat een tweede venster niet precies op het eerste
   valt en je denkt dat er niets gebeurde. */
function opentegel(url) {
  const naam = (() => { try { return new URL(url).pathname; } catch (e) { return url; } })();
  const bestaand = tegelVensters.get(naam);
  if (bestaand && !bestaand.isDestroyed()) {
    if (bestaand.isMinimized()) bestaand.restore();
    bestaand.focus();
    return bestaand;
  }
  const n = tegelVensters.size;
  const hoofd = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : { x: 60, y: 60 };
  const venster = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    x: hoofd.x + 40 + (n % 5) * 26, y: hoofd.y + 40 + (n % 5) * 26,
    title: "Fonteyn Dashboard", autoHideMenuBar: true, backgroundColor: "#f6f6f8",
    webPreferences: {
      contextIsolation: true, nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      scrollBounce: true, enableBlinkFeatures: "OverscrollHistoryNavigation",
    },
  });
  // Ook vanuit een tegelvenster moet een volgende tegel weer een eigen venster
  // krijgen; anders werkt het alleen vanaf het dashboard.
  venster.webContents.setWindowOpenHandler(({ url: u }) => {
    if (!u.startsWith(URL)) { shell.openExternal(u); return { action: "deny" }; }
    opentegel(u);
    return { action: "deny" };
  });
  /* Binnen het venster mag je gewoon doorklikken (terug naar Dashboard,
     een andere tegel). De sleutel volgt de pagina waar het venster nú staat,
     zodat 'al open' blijft kloppen. */
  venster.webContents.on("did-navigate-in-page", () => onthoud(venster));
  venster.webContents.on("did-navigate", () => onthoud(venster));
  venster.on("closed", () => {
    for (const [k, v] of tegelVensters) if (v === venster) tegelVensters.delete(k);
  });
  venster.webContents.setUserAgent(venster.webContents.getUserAgent() + " " + appUA());
  tegelVensters.set(naam, venster);
  venster.loadURL(url);
  return venster;
}
function onthoud(venster) {
  for (const [k, v] of tegelVensters) if (v === venster) tegelVensters.delete(k);
  try { tegelVensters.set(new URL(venster.webContents.getURL()).pathname, venster); } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════
// Helper-server starten als child-import
// ═══════════════════════════════════════════════════════════════
async function startHelper() {
  // Helper-server moet in de live-map zoeken voor HTML en JSON-databases.
  process.env.HTML_DIR = liveDir;
  process.env.DATA_DIR = liveDir;
  // Stuurcijfers-data leeft NIET in liveDir (die wordt overschreven door GitHub
  // auto-update), maar in een aparte persistent dir per gebruiker.
  // Dev-mode: in projectmap onder .stuurcijfers-data/ (gitignored).
  const stuurDir = app.isPackaged
    ? path.join(app.getPath("userData"), "stuurcijfers")
    : path.join(__dirname, ".stuurcijfers-data");
  await fs.mkdir(stuurDir, { recursive: true });
  process.env.STUURCIJFERS_DIR = stuurDir;
  console.log(`[stuurcijfers] data-dir: ${stuurDir}`);
  // Douanepapieren user-specs: handmatige overrides per artikelcode die Manon
  // invult (sku/dims/gw/nw/hs-code/origin). Server-side opslag zodat élke
  // gebruiker van de app diezelfde data ziet — niet meer per-machine.
  const userSpecsDir = app.isPackaged
    ? path.join(app.getPath("userData"), "user-specs")
    : path.join(__dirname, ".user-specs");
  await fs.mkdir(userSpecsDir, { recursive: true });
  process.env.USER_SPECS_DIR = userSpecsDir;
  console.log(`[user-specs] data-dir: ${userSpecsDir}`);

  // GEDEELDE product-specs (artikelcode → SKU/HS/origin/boxes) op de netwerk-
  // schijf zodat álle gebruikers dezelfde data delen. Eerst proberen of de
  // share toegankelijk is, anders fallback naar lokale userData met warning.
  const shareCandidates = process.platform === "win32"
    ? ["G:\\Fonteyn\\Fonteyn-Dashboard-Data", "\\\\fonfile\\data\\Fonteyn\\Fonteyn-Dashboard-Data"]
    : ["/Volumes/data/Fonteyn/Fonteyn-Dashboard-Data"];
  /* De netwerkschijf even aftikken - maar met een klok erbij.
     ═══════════════════════════════════════════════════════════════════
     Een schrijftest op een netwerkpad dat er niet is geeft geen nette fout:
     Windows blijft seconden tot minuten wachten op een SMB-antwoord dat nooit
     komt. Dat gebeurde bij elke start, vóórdat er een venster in beeld stond,
     en was een groot deel van de negentien seconden waar Gerrit over viel
     (7 sep 2026).

     Nu krijgt elke kandidaat anderhalve seconde. Antwoordt hij niet, dan gaan
     we door op de lokale map - precies wat er ook gebeurde als de schijf er
     echt niet was, alleen nu zonder het wachten. De test zelf blijft in de
     achtergrond aflopen; daar heeft niemand last van. */
  const metKlok = (belofte, ms) => Promise.race([
    belofte,
    new Promise((_, weiger) => setTimeout(() => weiger(new Error("te traag")), ms)),
  ]);
  /* De kandidaten tegelijk aftikken, niet na elkaar.
     Op Windows staan er twee in de lijst. Achter elkaar met anderhalve
     seconde elk is dat drie seconden voordat er iets in beeld komt, terwijl
     ze niets van elkaar weten. Tegelijk kost het er anderhalf, en meestal
     minder: de eerste die antwoordt wint. */
  const proeven = await Promise.all(shareCandidates.map(async (cand) => {
    try {
      await metKlok((async () => {
        await fs.mkdir(cand, { recursive: true });
        // Schrijftest: schrijf en verwijder een tijdelijk bestand
        const probe = path.join(cand, ".write-probe");
        await fs.writeFile(probe, String(Date.now()));
        await fs.unlink(probe);
      })(), 1500);
      return cand;
    } catch (e) {
      if (String(e.message) === "te traag")
        console.warn(`[product-specs] ${cand} antwoordde niet binnen 1,5s - overgeslagen`);
      return null;
    }
  }));
  // De volgorde van shareCandidates blijft leidend: G: gaat voor \\fonfile.
  let sharedDir = proeven.find(Boolean) || null;
  if (sharedDir) console.log(`[product-specs] gedeeld op netwerkschijf: ${sharedDir}`);
  if (!sharedDir) {
    sharedDir = app.isPackaged
      ? path.join(app.getPath("userData"), "product-specs-fallback")
      : path.join(__dirname, ".product-specs-fallback");
    await fs.mkdir(sharedDir, { recursive: true });
    console.log(`[product-specs] ⚠️  netwerkschijf niet bereikbaar — fallback naar lokaal: ${sharedDir}`);
    console.log(`[product-specs]   data wordt NIET gedeeld met andere gebruikers tot de share weer beschikbaar is.`);
  }
  process.env.SHARED_SPECS_DIR = sharedDir;
  // Eikensingel-vakantiepark-state (boekingen, schoonmaak, betalingen per huis).
  const eikensingelDir = app.isPackaged
    ? path.join(app.getPath("userData"), "eikensingel")
    : path.join(__dirname, ".eikensingel-data");
  await fs.mkdir(eikensingelDir, { recursive: true });
  process.env.EIKENSINGEL_DIR = eikensingelDir;
  console.log(`[eikensingel] data-dir: ${eikensingelDir}`);
  // Personeel-state (medewerkers, kamers, toewijzingen — vervangt het
  // 'Roemenen en Kroaten.xlsx' bestand).
  const personeelDir = app.isPackaged
    ? path.join(app.getPath("userData"), "personeel")
    : path.join(__dirname, ".personeel-data");
  await fs.mkdir(personeelDir, { recursive: true });
  process.env.PERSONEEL_DIR = personeelDir;
  console.log(`[personeel] data-dir: ${personeelDir}`);
  const helperPath = pathToFileURL(path.join(__dirname, "server", "index.js")).href;
  await import(helperPath);
}

/* Draait er al een helper op 3737?

   Dat gebeurt als een vorige afsluiting een proces heeft laten staan, of als
   iemand het dashboard twee keer opstart. De helper probeerde dan opnieuw te
   luisteren op een bezette poort, en dat werd een kaal JavaScript-foutscherm:
   "listen EADDRINUSE: address already in use 127.0.0.1:3737" (Chantal,
   13 aug 2026).

   Is het onze eigen helper, dan is er niets aan de hand en gebruiken we die.
   Antwoordt er iets anders op die poort, dan zeggen we dat in gewone taal in
   plaats van met een stacktrace. */
function helperAlActief(maxMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(`${URL}api/health`, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ bezet: true, vanOns: res.statusCode === 200 }));
    });
    req.on("error", (err) => {
      // ECONNREFUSED = niemand luistert, dus de poort is vrij.
      resolve(err && err.code === "ECONNREFUSED" ? { bezet: false } : { bezet: true, vanOns: false });
    });
    req.setTimeout(maxMs, () => { req.destroy(); resolve({ bezet: true, vanOns: false }); });
  });
}

// Wacht tot de helper antwoord geeft op /api/health (max 10s)
function waitForHelper(maxMs = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryOnce = () => {
      const req = http.get(`${URL}api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        if (Date.now() - start > maxMs) return reject(new Error("Helper-timeout"));
        setTimeout(tryOnce, 200);
      });
      req.on("error", () => {
        if (Date.now() - start > maxMs) return reject(new Error("Helper-timeout"));
        setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

/* De appversie in de user-agent zetten.
   ═══════════════════════════════════════════════════════════════════
   Twee dingen tegelijk. Het activiteitenlogboek probeerde de versie hier al
   uit te lezen ("fonteyn-dashboard/x.y.z") maar die stond er nooit in, dus
   werd het altijd "app · Electron 3x.y".

   En belangrijker: de pagina's kunnen hieraan zien of ze in een schil draaien
   die tegels in een eigen appvenster kan openen. Doen ze dat niet, dan komt
   een tegel met target="_blank" bij de oude schil in de BROWSER terecht -
   en dan heb je één venster in de app en de rest in Chrome, en zie je op de
   Windows-taakbalk je andere schermen niet meer staan. Gerrit (7 sep 2026):
   "dat werkt verwarrend."

   Zolang deze markering ontbreekt houdt het dashboard het bij het oude
   gedrag: openen in hetzelfde venster. Zodra de schil is bijgewerkt staat de
   markering er en verschijnen de eigen vensters vanzelf. */
function appUA(){ try { return "fonteyn-dashboard/" + app.getVersion(); } catch (e) { return "fonteyn-dashboard/0"; } }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    title: "Fonteyn Dashboard",
    autoHideMenuBar: true,
    backgroundColor: "#f6f6f8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      // Mac-trackpad: laat Chromium de native overscroll-back/forward
      // animatie tonen + rubber-band scroll-effect.
      scrollBounce: true,
      enableBlinkFeatures: "OverscrollHistoryNavigation"
    }
  });

  // Mac trackpad / Magic Mouse: 2-vinger swipe links/rechts → vorige/volgende
  // pagina in de in-app history. macOS-only event; op Windows/Linux geen-op.
  mainWindow.webContents.on("swipe", (_e, direction) => {
    const wc = mainWindow.webContents;
    if (direction === "right" && wc.canGoBack())    wc.goBack();
    if (direction === "left"  && wc.canGoForward()) wc.goForward();
  });

  /* Tweede scherm. Gerrit (7 sep 2026): "IEDEREEN bij Fonteyn heeft twee
     schermen, dus ik wil een tweede venster kunnen openen zodat Planning en
     Voorraadbeheer tegelijk open staan."

     Een tegel met target="_blank" komt hier langs. Wijst hij naar het
     dashboard zelf (127.0.0.1:3737), dan openen we een eigen venster; al het
     andere gaat naar de standaardbrowser zoals altijd.

     Staat dezelfde tegel al in een venster, dan halen we dát venster naar
     voren in plaats van er een tweede te maken. Anders zit je na een middag
     werken met acht keer Voorraadbeheer op je scherm.

     Op een shell die deze regel nog niet heeft (Macs werken zichzelf niet bij)
     valt het terug op openExternal: de tegel opent dan in de browser, op
     hetzelfde adres en dus met dezelfde inlog. Onhandiger, maar niet stuk. */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(URL)) { shell.openExternal(url); return { action: "deny" }; }
    opentegel(url);
    return { action: "deny" };
  });

  mainWindow.webContents.setUserAgent(mainWindow.webContents.getUserAgent() + " " + appUA());
  mainWindow.loadURL(URL);

  const menu = Menu.buildFromTemplate([
    {
      label: "Bestand",
      submenu: [
        { role: "quit", label: "Afsluiten" }
      ]
    },
    {
      label: "Bewerken",
      submenu: [
        { role: "undo", label: "Ongedaan maken" },
        { role: "redo", label: "Opnieuw" },
        { type: "separator" },
        { role: "cut",  label: "Knippen" },
        { role: "copy", label: "Kopiëren" },
        { role: "paste", label: "Plakken" },
        { role: "selectAll", label: "Alles selecteren" }
      ]
    },
    {
      label: "Beeld",
      submenu: [
        { role: "reload", label: "Vernieuwen" },
        { role: "zoomIn",  label: "Inzoomen" },
        { role: "zoomOut", label: "Uitzoomen" },
        { role: "resetZoom", label: "Standaard zoom" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Volledig scherm" }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

// ═══════════════════════════════════════════════════════════════
// Auto-update van de .exe zelf via GitHub Releases.
// electron-updater download nieuwe installer op de achtergrond, installeert
// 'm stilletjes bij het afsluiten van de app en herstart de app.
// Manon hoeft niks te doen — alleen afsluiten of computer opnieuw opstarten.
// ═══════════════════════════════════════════════════════════════
function setupAutoUpdater() {
  if (!app.isPackaged) return; // alleen in productie
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", (err) => console.warn("[updater] error:", err?.message || err));
  autoUpdater.on("update-available", (info) => {
    console.log(`[updater] nieuwe versie ${info.version} wordt gedownload…`);
  });
  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[updater] ${info.version} gedownload — installatie bij afsluiten.`);
    /* Dit stond alleen in de console, en daar kijkt niemand. Gevolg: een
       update lag klaar en niemand wist het, dus bleef iedereen op de oude
       versie werken en werkte een nieuwe functie "niet". Precies dat gebeurde
       op 7 sep 2026 met de tegels in een eigen venster.

       Nu een balkje in beeld. Geen dialoog die het werk blokkeert - alleen
       zeggen dat afsluiten genoeg is, en dat je hem kunt wegklikken. */
    const balk = `(function(){
      if (document.getElementById("fpUpdateBalk")) return;
      var d = document.createElement("div");
      d.id = "fpUpdateBalk";
      d.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#144734;color:#fff;"+
        "padding:10px 16px;font:14px/1.45 Montserrat,system-ui,sans-serif;display:flex;gap:12px;"+
        "align-items:center;box-shadow:0 -2px 12px rgba(0,0,0,.25)";
      d.innerHTML = "<span>Er staat een nieuwe versie van het Dashboard klaar (${info.version}). "+
        "<b>Sluit het Dashboard af en start het opnieuw</b> om hem te installeren.</span>";
      var b = document.createElement("button");
      b.textContent = "Later";
      b.style.cssText = "margin-left:auto;background:transparent;border:1px solid rgba(255,255,255,.5);"+
        "color:#fff;border-radius:7px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer";
      b.onclick = function(){ d.remove(); };
      d.appendChild(b);
      document.body.appendChild(d);
    })();`;
    for (const v of [mainWindow, ...tegelVensters.values()]) {
      if (v && !v.isDestroyed()) v.webContents.executeJavaScript(balk).catch(() => {});
    }
  });
  // Check direct bij starten én daarna elk uur
  autoUpdater.checkForUpdates().catch(e => console.warn("[updater] check fail:", e.message));
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 60 * 60 * 1000);
}

// ═══════════════════════════════════════════════════════════════
// IPC: silent-print voor labels.html
// ═══════════════════════════════════════════════════════════════
// Het label-printer-werk in labels.html roept "Alle labels printen" en
// dat triggert standaard `window.print()` → systeem-dialoog → user kiest
// printer + landscape. Onhandig: de printer is altijd "ZDesigner" en de
// orientatie is altijd landscape, dus we laten dat hier door Electron
// rechtstreeks doen. We zoeken een printer wiens naam "zdesigner" bevat
// (case-insensitive); is die er niet, valt 't terug op de default-printer.
ipcMain.handle("fonteyn:list-printers", async (event) => {
  try {
    const wc = event.sender;
    if (typeof wc.getPrintersAsync === "function") {
      return await wc.getPrintersAsync();
    }
    // Fallback voor oudere Electron-versies (sync API):
    return wc.getPrinters ? wc.getPrinters() : [];
  } catch (e) {
    console.warn("[print] list-printers faalde:", e.message);
    return [];
  }
});

ipcMain.handle("fonteyn:print-labels", async (event, opts = {}) => {
  const wc = event.sender;
  const wantedSubstring = (opts.printerSubstring || "zdesigner").toLowerCase();
  // Zoek de juiste printer — eerst exacte match op gewenste substring,
  // anders gewoon de system-default.
  let deviceName = undefined;
  try {
    const printers = (typeof wc.getPrintersAsync === "function")
      ? await wc.getPrintersAsync()
      : (wc.getPrinters ? wc.getPrinters() : []);
    const match = printers.find(p => (p.name || "").toLowerCase().includes(wantedSubstring));
    if (match) deviceName = match.name;
  } catch (e) {
    console.warn("[print] kon printers niet inventariseren:", e.message);
  }
  // BELANGRIJK — silent:false (= toont systeem-print-dialoog).
  //
  // Eerder (v0.17–0.19.2) deden we silent:true om dialoog over te slaan.
  // Resultaat: maandenlange chaos met blanco labels, gedraaide content,
  // verschillende output per machine — omdat de ZDesigner-driver onze
  // page-size + orientation hints anders interpreteert dan we dachten.
  //
  // Nieuwe strategie (v0.19.3): toon de native print-dialoog mét alle
  // defaults pre-filled (printer = ZDesigner, page-size = 209×99mm,
  // landscape). Manon ziet een dialoog ze KENT, klikt 1× OK, klaar.
  // Eerste keer eventueel "Onthouden voor deze printer" aanvinken in
  // Windows zodat 't daarna ook 1 klik blijft. Betrouwbaar, geen
  // mysterie meer.
  return new Promise((resolve) => {
    wc.print({
      silent: false,
      printBackground: true,
      deviceName,
      landscape: true,
      pageSize: { width: 209000, height: 99000 },
      margins: { marginType: "none" },
      copies: 1,
    }, (success, errorType) => {
      if (!success) console.warn("[print] mislukt of geannuleerd:", errorType);
      resolve({ ok: !!success, deviceName: deviceName || null, error: success ? null : errorType });
    });
  });
});

// Silent print mét door de renderer opgegeven paginamaat (portrait).
// Voor de labels-tegel v0.20+: de juiste setup is bewezen 104×214mm
// gedraaid, en die staat vast. De renderer (labels.html) heeft de
// content via CSS al 90° gedraaid op een 104×214 portrait-pagina —
// hier hoeven we dus ALLEEN silent te printen naar de ZDesigner met
// exact die paginamaat (portrait, GEEN landscape-flag, geen marges).
//
// Aparte handler-naam zodat oude shells (die deze niet kennen) de
// nieuwe labels.html veilig laten terugvallen op window.print().
ipcMain.handle("fonteyn:print-labels-silent", async (event, opts = {}) => {
  const wc = event.sender;
  const wantedSubstring = (opts.printerSubstring || "zdesigner").toLowerCase();
  let deviceName = undefined;
  try {
    const printers = (typeof wc.getPrintersAsync === "function")
      ? await wc.getPrintersAsync()
      : (wc.getPrinters ? wc.getPrinters() : []);
    const match = printers.find(p => (p.name || "").toLowerCase().includes(wantedSubstring));
    if (match) deviceName = match.name;
  } catch (e) {
    console.warn("[print-silent] kon printers niet inventariseren:", e.message);
  }
  if (!deviceName) {
    // Geen ZDesigner gevonden — laat de renderer terugvallen op een dialoog.
    return { ok: false, error: "printer-not-found", deviceName: null };
  }
  const wMm = Number(opts.pageWidthMm) || 104;
  const hMm = Number(opts.pageHeightMm) || 214;
  return new Promise((resolve) => {
    wc.print({
      silent: true,
      printBackground: true,
      deviceName,
      landscape: false,
      pageSize: { width: Math.round(wMm * 1000), height: Math.round(hMm * 1000) },
      margins: { marginType: "none" },
      copies: 1,
    }, (success, errorType) => {
      if (!success) console.warn("[print-silent] mislukt:", errorType);
      resolve({ ok: !!success, deviceName: deviceName || null, error: success ? null : errorType });
    });
  });
});

// Debug-modus: schrijf de print-output naar PDF op het bureaublad i.p.v.
// naar de printer. Handig om vóór een grote print-batch te kunnen
// verifiëren dat oriëntatie + page-size kloppen, zonder labels te
// verspillen. Bestand verschijnt op het bureaublad als
// fonteyn-labels-debug-<timestamp>.pdf.
ipcMain.handle("fonteyn:print-labels-to-pdf", async (event) => {
  const wc = event.sender;
  try {
    const pdfBuffer = await wc.printToPDF({
      landscape: true,
      pageSize: { width: 209000, height: 99000 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(app.getPath("desktop"), `fonteyn-labels-debug-${stamp}.pdf`);
    await fs.writeFile(dest, pdfBuffer);
    return { ok: true, path: dest, bytes: pdfBuffer.length };
  } catch (e) {
    console.warn("[print-to-pdf] mislukt:", e.message);
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(async () => {
  /* Hoe lang elke stap duurt, in de console. Zonder die getallen is "de app
     start traag" niet op te lossen: op de ene pc is het de netwerkschijf, op
     de andere de download. Nu staat het er gewoon. */
  const t0 = Date.now();
  const klok = (wat, sinds) => console.log(`[start] ${wat}: ${((Date.now()-sinds)/1000).toFixed(1)}s`);
  try {
    let t = Date.now();
    await bootstrapLiveDir();
    klok("live-map klaarzetten", t);

    /* Het venster wacht NIET meer op de update.
       ═══════════════════════════════════════════════════════════════════
       Gerrit (7 sep 2026): "Het duurde 28(!!!) seconden bij mij om het
       Dashboard op te starten. We moeten echt <5 seconden zitten, altijd."

       Dat kwam hier vandaan. Er stond 'await updateKlaar' vóór
       createWindow(), en updateKlaar haalt het manifest plus alle tegels bij
       GitHub op. Op een trage of hakkelende verbinding is dat tientallen
       seconden waarin er niets te zien is - en die wachttijd levert niets op,
       want de app draait op de bestanden die al in de live-map staan. Wat er
       binnenkomt is voor de vólgende keer dat je een tegel opent.

       Dus: zodra het hulpprogramma luistert komt het venster in beeld. Het
       bijwerken loopt daarachter door en meldt zich als het klaar is. Alleen
       de allereerste keer, als de live-map nog helemaal leeg is, wordt er wél
       gewacht - dan valt er zonder download niets te tonen. */
    t = Date.now();
    const updateKlaar = (app.isPackaged ? fetchLiveUpdates() : Promise.resolve())
      .catch(e => console.warn("[update] overgeslagen:", e.message));

    /* Alleen zelf een helper starten als er nog geen draait. Zo maakt een
       tweede opstart of een blijven hangen proces de app niet meer stuk. */
    const bestaand = await helperAlActief();
    if (!bestaand.bezet) {
      await startHelper();
      await waitForHelper();
      klok("hulpprogramma", t);
    } else if (bestaand.vanOns) {
      console.log("[helper] draait al op 3737 - die wordt gebruikt.");
    } else {
      dialog.showErrorBox("Poort 3737 is bezet",
        "Er luistert al een ander programma op poort 3737, en daardoor kan het dashboard zijn " +
        "hulpprogramma niet starten.\n\nSluit het dashboard helemaal af (ook via Taakbeheer) en " +
        "start het opnieuw. Helpt dat niet, herstart dan de computer.");
    }

    /* De enige keer dat er wél gewacht moet worden: er staat nog geen
       dashboard.html in de live-map. Dat is de allereerste start na een
       installatie op een pc waar de gebundelde bestanden niet meekwamen. */
    if (app.isPackaged && !existsSync(path.join(liveDir, "dashboard.html"))) {
      console.log("[start] live-map is nog leeg - deze ene keer wachten op de download");
      await updateKlaar;
      klok("eerste keer inladen", t0);
    } else {
      /* Klaar met bijwerken? Dan een seintje naar het dashboard, dat zelf
         beslist of het iets zegt. Niet opdringen: iemand die midden in een
         order zit wil geen scherm dat onder zijn handen verspringt. */
      updateKlaar.then(function(){
        klok("bijwerken klaar (op de achtergrond)", t0);
        try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("ota-klaar"); } catch (e) {}
      });
    }
  } catch (e) {
    console.error("Opstartfout:", e);
  }
  createWindow();
  console.log(`[start] venster in beeld na ${((Date.now()-t0)/1000).toFixed(1)}s`);
  setupAutoUpdater();
});

app.on("window-all-closed", () => { app.quit(); });

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
