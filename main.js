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

import { app, BrowserWindow, Menu, shell, dialog } from "electron";
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

async function fetchLiveUpdates() {
  // 1) Haal het manifest op. Valideer als JSON voordat we 'm opslaan.
  const manifestBuf = await fetchRaw(`${RAW_BASE}/manifest.json`);
  let remoteManifest = null;
  if (manifestBuf && manifestBuf.length > 0) {
    try {
      remoteManifest = JSON.parse(manifestBuf.toString("utf-8"));
      await fs.writeFile(path.join(liveDir, "manifest.json"), manifestBuf);
      console.log(`[update] ✓ manifest.json (v${remoteManifest.version || "?"}) opgehaald`);
    } catch (e) {
      console.warn(`[update] manifest.json ongeldig JSON:`, e.message);
      remoteManifest = null;
    }
  }

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

  // 3) Download elk bestand uit het manifest.
  for (const entry of remoteManifest.files) {
    if (!entry || !entry.name) continue;
    // Skip manifest.json zelf — die hebben we hierboven al.
    if (entry.name === "manifest.json") continue;

    const buf = await fetchRaw(`${RAW_BASE}/${entry.name}`);
    if (!buf || buf.length === 0) continue;

    // Optionele validatie: voor JSON-bestanden niet overschrijven met corrupt bestand
    if (entry.validate === "json" || entry.name.endsWith(".json")) {
      try { JSON.parse(buf.toString("utf-8")); }
      catch {
        console.warn(`[update] ${entry.name}: ongeldige JSON, overschrijven overgeslagen`);
        continue;
      }
    }

    try {
      await fs.writeFile(path.join(liveDir, entry.name), buf);
      console.log(`[update] ✓ ${entry.name} bijgewerkt (${buf.length} bytes)`);
    } catch (e) {
      console.warn(`[update] ${entry.name} niet opgeslagen:`, e.message);
    }
  }
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
  let sharedDir = null;
  for (const cand of shareCandidates) {
    try {
      await fs.mkdir(cand, { recursive: true });
      // Schrijftest: schrijf en verwijder een tijdelijk bestand
      const probe = path.join(cand, ".write-probe");
      await fs.writeFile(probe, String(Date.now()));
      await fs.unlink(probe);
      sharedDir = cand;
      console.log(`[product-specs] gedeeld op netwerkschijf: ${sharedDir}`);
      break;
    } catch {/* probeer volgende */ }
  }
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
  const helperPath = pathToFileURL(path.join(__dirname, "server", "index.js")).href;
  await import(helperPath);
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

  // Externe links in de standaard-browser openen
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

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
    // Toon subtiele notificatie — geen blokkerende dialog want de update
    // gaat automatisch bij afsluiten, dat mag ze 's avonds stilletjes doen.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        console.log("Nieuwe versie ${info.version} gedownload — wordt geïnstalleerd bij afsluiten.");
      `).catch(() => {});
    }
  });
  // Check direct bij starten én daarna elk uur
  autoUpdater.checkForUpdates().catch(e => console.warn("[updater] check fail:", e.message));
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 60 * 60 * 1000);
}

app.whenReady().then(async () => {
  try {
    await bootstrapLiveDir();
    // Auto-update skippen in dev — anders overschrijft GitHub onze lokale edits
    if (app.isPackaged) {
      await fetchLiveUpdates(); // fail-safe — bij offline gewoon doorgaan met cache
    }
    await startHelper();
    await waitForHelper();
  } catch (e) {
    console.error("Opstartfout:", e);
  }
  createWindow();
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
