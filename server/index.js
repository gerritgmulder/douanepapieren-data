// Fonteyn helper-server (multi-module dashboard).
// - Serveert dashboard.html op http://localhost:3737/ (met module-HTMLs daaromheen)
// - Per-user login tegen Logic4 via POST /api/login — sessie-token retour
// - Alle data-routes achter auth-middleware (Authorization: Bearer <sessionId>)

import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import {
  getToken,
  getTokenForUser,
  clearTokenCache,
  getOrder,
  getOrderLines,
  getProducts,
  getProductsBySupplierCode,
  getProductsSample,
  getPurchaseOrderLines,
  getDebtor
} from "./logic4.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARENT_DIR = path.resolve(__dirname, "..");
const PORT = parseInt(process.env.PORT || "3737", 10);

// HTML_DIR / DATA_DIR worden door Electron's main.js gezet naar de live-cache,
// zodat auto-updates van GitHub direct gebruikt worden. Als deze env vars niet
// bestaan (bv. wanneer de helper standalone draait) vallen we terug op de
// "klassieke" paden in de project-folder.
const HTML_DIR = process.env.HTML_DIR || PARENT_DIR;
const DATA_DIR = process.env.DATA_DIR || __dirname;
// Stuurcijfers-opslag: aparte dir die NIET door GitHub auto-update wordt overschreven.
// Standaard onder de projectmap voor dev; Electron's main.js zet deze naar userData/stuurcijfers in productie.
const STUURCIJFERS_DIR = process.env.STUURCIJFERS_DIR || path.join(PARENT_DIR, ".stuurcijfers-data");
fs.mkdirSync(STUURCIJFERS_DIR, { recursive: true });

const app = express();
// Stuurcijfers-tabellen kunnen groot zijn (Grootboektransacties ~50MB JSON).
// Default 100kb body-limit van express.json is niet genoeg.
app.use(express.json({ limit: "200mb" }));

// ============================================================
// Sessie-beheer (in-memory, non-persistent)
// ============================================================
// Map<sessionId, {username, password, createdAt, lastUsedAt}>
// Password wordt bewaard omdat Logic4-tokens na ~1u verlopen en we dan stilletjes
// een nieuw token willen halen zonder de user opnieuw te laten inloggen.
// Alles blijft in het process-geheugen — stop de server = sessies weg.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 uur idle → log opnieuw in
const _sessions = new Map();

function createSession(username, password) {
  const id = crypto.randomBytes(24).toString("base64url");
  const now = Date.now();
  _sessions.set(id, { username, password, createdAt: now, lastUsedAt: now });
  return id;
}

function getSession(id) {
  const s = _sessions.get(id);
  if (!s) return null;
  if (Date.now() - s.lastUsedAt > SESSION_TTL_MS) {
    _sessions.delete(id);
    return null;
  }
  s.lastUsedAt = Date.now();
  return s;
}

function destroySession(id) {
  _sessions.delete(id);
}

// Ruim periodiek verlopen sessies op (elk uur)
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of _sessions) {
    if (s.lastUsedAt < cutoff) _sessions.delete(id);
  }
}, 60 * 60 * 1000).unref();

function extractBearer(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/);
  return m ? m[1] : null;
}

function requireAuth(req, res, next) {
  const id = extractBearer(req);
  if (!id) return res.status(401).json({ ok: false, error: "Niet ingelogd." });
  const sess = getSession(id);
  if (!sess) return res.status(401).json({ ok: false, error: "Sessie verlopen — log opnieuw in." });
  req.auth = { username: sess.username, password: sess.password, sessionId: id };
  next();
}

// ============================================================
// Statische bestanden
// ============================================================
// Landing = dashboard.html. Elke module (douane.html, transport.html, …) zit
// gewoon in dezelfde map en is bereikbaar via /douane.html etc.
// no-store zorgt dat Electron's Chromium altijd de verse versie pakt nadat
// auto-update een nieuw bestand heeft binnengehaald.
app.use("/", express.static(HTML_DIR, {
  extensions: ["html"],
  index: "dashboard.html",
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-store, must-revalidate");
  }
}));

// ============================================================
// Dev-only: prefill login vanuit dev-credentials.json in de projectmap
// Alleen op Gerrits eigen machine — in Manons .exe is die file er niet.
// ============================================================
app.get("/api/dev-credentials", (req, res) => {
  const candidates = [
    path.join(PARENT_DIR, "dev-credentials.json"),
    path.join(__dirname, "..", "dev-credentials.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        const j = JSON.parse(raw);
        return res.json({ ok: true, email: j.email || "", password: j.password || "" });
      } catch (e) {
        return res.status(500).json({ ok: false, error: "dev-credentials.json corrupt: " + e.message });
      }
    }
  }
  return res.status(404).json({ ok: false });
});

// ============================================================
// Publieke endpoints (geen login nodig)
// ============================================================

app.get("/api/health", (req, res) => {
  const env = {
    publickey:      !!process.env.LOGIC4_PUBLICKEY,
    secretkey:      !!process.env.LOGIC4_SECRETKEY,
    companykey:     !!process.env.LOGIC4_COMPANYKEY,
    administration: !!process.env.LOGIC4_ADMINISTRATION,
  };
  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
  res.json({
    ok: missing.length === 0,
    server: "fonteyn-helper",
    version: "0.3.0",
    appCredentialsConfigured: env,
    missing,
    activeSessions: _sessions.size
  });
});

// Login: probeer een Logic4-token te halen met de meegegeven credentials.
// Lukt dat → sessie aanmaken, id retour. Mislukt → 401.
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: "E-mail en wachtwoord zijn beide verplicht." });
  }
  try {
    await getTokenForUser(username, password); // throws on failure
    const sessionId = createSession(username, password);
    res.json({ ok: true, sessionId, user: { email: username } });
  } catch (e) {
    // Opschonen: een mislukte poging mag geen half-gevulde cache achterlaten
    clearTokenCache(username);
    res.status(401).json({ ok: false, error: "Inloggen bij Logic4 mislukt: " + e.message });
  }
});

// ============================================================
// Beschermde endpoints (sessie vereist)
// ============================================================

app.post("/api/logout", requireAuth, (req, res) => {
  destroySession(req.auth.sessionId);
  clearTokenCache(req.auth.username);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ ok: true, user: { email: req.auth.username } });
});

// Artikelcode-database (mapping productcode → SKU/merk/omschrijving)
let _articleCodes = null;
function loadArticleCodes() {
  if (_articleCodes) return _articleCodes;
  const p = path.join(DATA_DIR, "article-codes.json");
  if (!fs.existsSync(p)) {
    console.warn(`⚠️  article-codes.json niet gevonden in ${DATA_DIR}.`);
    _articleCodes = {};
    return _articleCodes;
  }
  try {
    _articleCodes = JSON.parse(fs.readFileSync(p, "utf-8"));
    console.log(`✓ Artikelcode-database geladen: ${Object.keys(_articleCodes).length} entries`);
  } catch (e) {
    console.error("Kon article-codes.json niet parsen:", e.message);
    _articleCodes = {};
  }
  return _articleCodes;
}
loadArticleCodes();

app.get("/api/article-codes", requireAuth, (req, res) => {
  res.json(loadArticleCodes());
});

// Spa-spec-database (model-naam → afmetingen, dryWeight, fullWeight, brand)
let _specDatabase = null;
function loadSpecDatabase() {
  if (_specDatabase) return _specDatabase;
  const p = path.join(DATA_DIR, "spec-database.json");
  if (!fs.existsSync(p)) {
    console.warn(`⚠️  spec-database.json niet gevonden in ${DATA_DIR}.`);
    _specDatabase = {};
    return _specDatabase;
  }
  try {
    _specDatabase = JSON.parse(fs.readFileSync(p, "utf-8"));
    console.log(`✓ Spa-spec-database geladen: ${Object.keys(_specDatabase).length} modellen`);
  } catch (e) {
    console.error("Kon spec-database.json niet parsen:", e.message);
    _specDatabase = {};
  }
  return _specDatabase;
}
loadSpecDatabase();

app.get("/api/spec-database", requireAuth, (req, res) => {
  res.json(loadSpecDatabase());
});

// ════════════════════════════════════════════════════════════════════
// Packaging-database (verpakkings-afmetingen + gewicht per product, voor
// de Transport-laden tegel). Bron: Excel "Maten + gewichten.xlsx" → via
// tools/parse_packaging.py omgezet naar packaging-database.json.
// Multi-box producten (bv. Laos loungeset = 3 dozen) worden ondersteund.
// ════════════════════════════════════════════════════════════════════
let _packagingDatabase = null;
function loadPackagingDatabase() {
  if (_packagingDatabase) return _packagingDatabase;
  const p = path.join(DATA_DIR, "packaging-database.json");
  if (!fs.existsSync(p)) {
    console.warn(`⚠️  packaging-database.json niet gevonden in ${DATA_DIR}.`);
    _packagingDatabase = { categories: [] };
    return _packagingDatabase;
  }
  try {
    _packagingDatabase = JSON.parse(fs.readFileSync(p, "utf-8"));
    const total = (_packagingDatabase.categories || []).reduce((s, c) => s + (c.products || []).length, 0);
    console.log(`✓ Packaging-database geladen: ${total} producten in ${(_packagingDatabase.categories || []).length} categorieën`);
  } catch (e) {
    console.error("Kon packaging-database.json niet parsen:", e.message);
    _packagingDatabase = { categories: [] };
  }
  return _packagingDatabase;
}
loadPackagingDatabase();

app.get("/api/packaging-database", requireAuth, (req, res) => {
  res.json(loadPackagingDatabase());
});

// ════════════════════════════════════════════════════════════════════
// User-specs — handmatige overrides per artikelcode (sku/dims/gw/nw/
// hs-code/origin). Vroeger lokaal in localStorage van Manon's machine,
// nu server-side zodat alle gebruikers van de app diezelfde edits zien.
// Manon vult 1x in, Don/Dolf/Gerrit zien 't bij volgende order.
//
// Storage: user-specs.json in USER_SPECS_DIR (set door Electron's main.js
// naar userData/user-specs in productie; dev: .user-specs/ in projectroot).
// ════════════════════════════════════════════════════════════════════
const USER_SPECS_DIR = process.env.USER_SPECS_DIR || path.join(PARENT_DIR, ".user-specs");
fs.mkdirSync(USER_SPECS_DIR, { recursive: true });
const USER_SPECS_FILE = path.join(USER_SPECS_DIR, "user-specs.json");

function loadUserSpecs() {
  try {
    if (!fs.existsSync(USER_SPECS_FILE)) return {};
    return JSON.parse(fs.readFileSync(USER_SPECS_FILE, "utf-8"));
  } catch (e) {
    console.warn("[user-specs] kon niet lezen:", e.message);
    return {};
  }
}

function saveUserSpecs(data) {
  // Atomic write: schrijf naar tijdelijk bestand en hernoem. Voorkomt
  // corrupte JSON als de helper crasht midden in een schrijfactie.
  const tmp = USER_SPECS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, USER_SPECS_FILE);
}

// Geldig formaat voor één spec-entry. We accepteren losse velden; ontbrekende
// velden blijven ongezet zodat een latere PUT alleen wat ie krijgt overschrijft.
const USER_SPEC_FIELDS = ["sku", "dims", "gw", "nw", "hs", "origin"];

app.get("/api/user-specs", requireAuth, (req, res) => {
  res.json(loadUserSpecs());
});

app.put("/api/user-specs/:code", requireAuth, (req, res) => {
  const code = String(req.params.code || "").trim();
  if (!code || code.length > 50) {
    return res.status(400).json({ error: "ongeldige code" });
  }
  const incoming = req.body || {};
  // Filter alleen bekende velden — geen prototype-pollution etc.
  const cleaned = {};
  for (const k of USER_SPEC_FIELDS) {
    if (incoming[k] !== undefined && incoming[k] !== null) {
      // gw/nw zijn nummers, rest strings. Lege strings = veld unset (laat weg).
      if (k === "gw" || k === "nw") {
        const n = parseFloat(incoming[k]);
        if (!isNaN(n)) cleaned[k] = n;
      } else {
        const s = String(incoming[k]).trim();
        if (s) cleaned[k] = s;
      }
    }
  }
  const all = loadUserSpecs();
  if (Object.keys(cleaned).length === 0) {
    // Niets te bewaren → behandel als delete (cleared all fields)
    delete all[code];
  } else {
    all[code] = cleaned;
  }
  try {
    saveUserSpecs(all);
    res.json({ ok: true, code, spec: all[code] || null });
  } catch (e) {
    console.error("[user-specs] save fail:", e);
    res.status(500).json({ error: "opslaan mislukt: " + e.message });
  }
});

app.delete("/api/user-specs/:code", requireAuth, (req, res) => {
  const code = String(req.params.code || "").trim();
  const all = loadUserSpecs();
  if (code in all) {
    delete all[code];
    try { saveUserSpecs(all); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }
  res.json({ ok: true, code });
});

// ════════════════════════════════════════════════════════════════════
// Packaging-overrides — handmatig ingevulde verpakkingsdata per art.code,
// voor de Transport-laden tool. Format: { "<code>": { l, w, h, weight,
// name? } } in cm/kg. Server-side opslag zodat Manon's invoer ook voor
// Don/Dolf/Gerrit/Fonteynbot beschikbaar is.
// ════════════════════════════════════════════════════════════════════
const PACKAGING_OVERRIDES_FILE = path.join(USER_SPECS_DIR, "packaging-overrides.json");

function loadPackagingOverrides() {
  try {
    if (!fs.existsSync(PACKAGING_OVERRIDES_FILE)) return {};
    return JSON.parse(fs.readFileSync(PACKAGING_OVERRIDES_FILE, "utf-8"));
  } catch (e) {
    console.warn("[packaging-overrides] kon niet lezen:", e.message);
    return {};
  }
}

function savePackagingOverrides(data) {
  const tmp = PACKAGING_OVERRIDES_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, PACKAGING_OVERRIDES_FILE);
}

app.get("/api/packaging-overrides", requireAuth, (req, res) => {
  res.json(loadPackagingOverrides());
});

app.put("/api/packaging-overrides/:code", requireAuth, (req, res) => {
  const code = String(req.params.code || "").trim();
  if (!code || code.length > 50) return res.status(400).json({ error: "ongeldige code" });

  const incoming = req.body || {};
  const cleaned = {};
  // Top-level (legacy) single-box velden — achterwaartse compat
  for (const k of ["l", "w", "h", "weight"]) {
    if (incoming[k] !== undefined && incoming[k] !== null && incoming[k] !== "") {
      const n = parseFloat(incoming[k]);
      if (!isNaN(n) && n > 0) cleaned[k] = n;
    }
  }
  // Nieuwe multi-box format: array van dozen
  if (Array.isArray(incoming.boxes)) {
    const validBoxes = incoming.boxes
      .map(b => {
        if (!b || typeof b !== "object") return null;
        const cb = {};
        for (const k of ["l", "w", "h", "weight"]) {
          if (b[k] != null && b[k] !== "") {
            const n = parseFloat(b[k]);
            if (!isNaN(n) && n > 0) cb[k] = n;
          }
        }
        // Box moet minstens L+B+H hebben om geldig te zijn
        return (cb.l && cb.w && cb.h) ? cb : null;
      })
      .filter(Boolean);
    if (validBoxes.length) cleaned.boxes = validBoxes;
  }
  if (incoming.name) cleaned.name = String(incoming.name).slice(0, 200);

  const all = loadPackagingOverrides();
  // Niets bruikbaars opgegeven? Verwijder de hele override.
  const hasContent = cleaned.boxes && cleaned.boxes.length
    || (cleaned.l && cleaned.w && cleaned.h);
  if (!hasContent) {
    delete all[code];
  } else {
    // Vervangen i.p.v. mergen — de client stuurt altijd de complete state.
    all[code] = cleaned;
  }
  try {
    savePackagingOverrides(all);
    res.json({ ok: true, code, override: all[code] || null });
  } catch (e) {
    console.error("[packaging-overrides] save fail:", e);
    res.status(500).json({ error: "opslaan mislukt: " + e.message });
  }
});

app.delete("/api/packaging-overrides/:code", requireAuth, (req, res) => {
  const code = String(req.params.code || "").trim();
  const all = loadPackagingOverrides();
  if (code in all) {
    delete all[code];
    try { savePackagingOverrides(all); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }
  res.json({ ok: true, code });
});

// ════════════════════════════════════════════════════════════════════
// Eikensingel-vakantiepark — 10 bungalows, multi-booking per huis,
// schoonmaak- en betaalstatus voor de beheerders/schoonmakers.
//
// Storage: state.json in EIKENSINGEL_DIR. Whole-state get/put — concurrency
// is laag (1-2 beheerders), last-write-wins prima.
// ════════════════════════════════════════════════════════════════════
const EIKENSINGEL_DIR = process.env.EIKENSINGEL_DIR || path.join(PARENT_DIR, ".eikensingel-data");
fs.mkdirSync(EIKENSINGEL_DIR, { recursive: true });
const EIKENSINGEL_FILE = path.join(EIKENSINGEL_DIR, "state.json");

// Default: 10 huizen, 1+2 voor buitenlandse medewerkers, 3-10 voor verhuur.
function defaultEikensingelState() {
  const houses = {};
  for (let i = 1; i <= 10; i++) {
    houses[String(i)] = (i === 1 || i === 2)
      ? { id: i, type: "employee", occupant: "", notes: "", bookings: [] }
      : { id: i, type: "rental", notes: "", bookings: [] };
  }
  return { houses, lastUpdated: null };
}

function loadEikensingelState() {
  try {
    if (!fs.existsSync(EIKENSINGEL_FILE)) {
      const def = defaultEikensingelState();
      fs.writeFileSync(EIKENSINGEL_FILE, JSON.stringify(def, null, 2));
      return def;
    }
    return JSON.parse(fs.readFileSync(EIKENSINGEL_FILE, "utf-8"));
  } catch (e) {
    console.warn("[eikensingel] kon niet lezen:", e.message);
    return defaultEikensingelState();
  }
}

function saveEikensingelState(data) {
  data.lastUpdated = new Date().toISOString();
  const tmp = EIKENSINGEL_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, EIKENSINGEL_FILE);
}

// Sanitize één house-payload: filter onbekende velden, valideer bookings.
function sanitizeHouse(input, defaults) {
  const out = { ...defaults };
  if (input.type === "employee" || input.type === "rental") out.type = input.type;
  if (typeof input.occupant === "string") out.occupant = input.occupant.slice(0, 200);
  if (typeof input.notes === "string") out.notes = input.notes.slice(0, 1000);
  if (Array.isArray(input.bookings)) {
    out.bookings = input.bookings.map(b => sanitizeBooking(b)).filter(Boolean);
  }
  return out;
}

function sanitizeBooking(b) {
  if (!b || typeof b !== "object") return null;
  // Datums valideren als YYYY-MM-DD
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(String(b.from || ""))) return null;
  if (!dateRe.test(String(b.to || "")))   return null;
  const cleanedSource = ["airbnb", "booking", "website", "direct", "other"].includes(b.source) ? b.source : "other";
  return {
    id: typeof b.id === "string" && b.id ? b.id.slice(0, 50) : `b_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    guestName: String(b.guestName || "").slice(0, 200),
    from: b.from,
    to: b.to,
    source: cleanedSource,
    paid: Boolean(b.paid),
    cleanedBefore: Boolean(b.cleanedBefore),
    amount: Number.isFinite(+b.amount) && +b.amount >= 0 ? +b.amount : 0,
    phone: String(b.phone || "").slice(0, 50),
    email: String(b.email || "").slice(0, 200),
    notes: String(b.notes || "").slice(0, 1000),
  };
}

// ─── Toegang Eikensingel ────────────────────────────────────────────
// Twee rollen:
//  - "full":   ziet alles, mag alles bewerken + verwijderen + toevoegen
//  - "booker": ziet alles, mag ALLEEN nieuwe boekingen toevoegen
// We accepteren zowel email-form als Logic4-username (bv. "fonteyn.fransje").
const EIKENSINGEL_FULL = new Set([
  "fransje@fonteyn.nl", "fransje", "fonteyn.fransje",
  "danique@fonteyn.nl", "danique", "fonteyn.danique",
  "gerrit@fonteyn.nl",  "gerrit",
  "fonteynbot@fonteyn.nl", "fonteyn.bot", "fonteynbot",
]);
const EIKENSINGEL_BOOKER = new Set([
  ...EIKENSINGEL_FULL,
  "rosalie@fonteyn.nl",  "rosalie",  "fonteyn.rosalie",
  "evelinde@fonteyn.nl", "evelinde", "fonteyn.evelinde",
  "fabiola@fonteyn.nl",  "fabiola",  "fonteyn.fabiola",
  "julia@fonteyn.nl",    "julia",    "fonteyn.julia",
  "karina@fonteyn.nl",   "karina",   "fonteyn.karina",
]);
function eikensingelRole(req) {
  const u = (req.auth?.username || "").toLowerCase();
  if (EIKENSINGEL_FULL.has(u)) return "full";
  if (EIKENSINGEL_BOOKER.has(u)) return "booker";
  return null;
}
function requireEikensingelRead(req, res, next) {
  if (!eikensingelRole(req)) return res.status(403).json({ error: "geen toegang tot Eikensingel" });
  next();
}
function requireEikensingelFull(req, res, next) {
  if (eikensingelRole(req) !== "full") return res.status(403).json({ error: "alleen Fransje/Danique mag bewerken/verwijderen" });
  next();
}

app.get("/api/eikensingel/role", requireAuth, (req, res) => {
  res.json({ role: eikensingelRole(req) || "none" });
});

app.get("/api/eikensingel", requireAuth, requireEikensingelRead, (req, res) => {
  res.json(loadEikensingelState());
});

// PUT op héél het huis: alleen 'full' (Fransje/Danique/Gerrit/Bot)
app.put("/api/eikensingel/houses/:id", requireAuth, requireEikensingelFull, (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!/^([1-9]|10)$/.test(id)) return res.status(400).json({ error: "ongeldige huisnummer (1-10)" });
  const state = loadEikensingelState();
  const cur = state.houses[id] || { id: parseInt(id, 10), type: "rental", notes: "", bookings: [] };
  state.houses[id] = sanitizeHouse(req.body || {}, cur);
  state.houses[id].id = parseInt(id, 10);
  try {
    saveEikensingelState(state);
    res.json({ ok: true, house: state.houses[id] });
  } catch (e) {
    console.error("[eikensingel] save fail:", e);
    res.status(500).json({ error: "opslaan mislukt: " + e.message });
  }
});

// POST: nieuwe boeking toevoegen — booker-rol mag dit ook (read+add).
// Body = één booking-object. Wijzigen of verwijderen kan alleen 'full' via PUT.
app.post("/api/eikensingel/houses/:id/bookings", requireAuth, requireEikensingelRead, (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!/^([1-9]|10)$/.test(id)) return res.status(400).json({ error: "ongeldige huisnummer (1-10)" });
  const booking = sanitizeBooking(req.body || {});
  if (!booking) return res.status(400).json({ error: "ongeldige boeking (datums verplicht in YYYY-MM-DD)" });

  const state = loadEikensingelState();
  if (!state.houses[id]) {
    state.houses[id] = { id: parseInt(id, 10), type: "rental", notes: "", bookings: [] };
  }
  if (!Array.isArray(state.houses[id].bookings)) state.houses[id].bookings = [];
  state.houses[id].bookings.push(booking);
  try {
    saveEikensingelState(state);
    res.json({ ok: true, booking, house: state.houses[id] });
  } catch (e) {
    console.error("[eikensingel] add booking fail:", e);
    res.status(500).json({ error: "opslaan mislukt: " + e.message });
  }
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Generieke Logic4-proxy.
 * Laat de front-end (HTML-modules die via GitHub auto-updaten) elk Logic4-
 * endpoint aanroepen zonder dat er nieuwe server-code nodig is.
 *
 * Request:
 *   POST /api/logic4-call
 *   { "path": "/v3/BuyOrders/GetBuyOrderRows", "method": "POST", "body": 37272 }
 *
 * Response:
 *   { ok: true, status: 200, data: <whatever Logic4 returned> }
 *
 * Dankzij deze endpoint hoeft de .exe NOOIT meer ververst te worden voor
 * nieuwe Logic4-calls — pushen van alleen de HTML naar GitHub is voldoende.
 * ═══════════════════════════════════════════════════════════════════════
 */
app.post("/api/logic4-call", requireAuth, async (req, res) => {
  const { path: apiPath, method = "POST", body } = req.body || {};
  if (!apiPath || typeof apiPath !== "string" || !apiPath.startsWith("/v")) {
    return res.status(400).json({
      ok: false,
      error: "Ongeldig pad. Gebruik '/v3/…' of '/v1.1/…' etc."
    });
  }
  // Whitelist HTTP methods
  const allowedMethods = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
  const m = String(method).toUpperCase();
  if (!allowedMethods.has(m)) {
    return res.status(400).json({ ok: false, error: `Method ${m} niet toegestaan.` });
  }
  try {
    const token = await getTokenForUser(req.auth.username, req.auth.password);
    const url = `https://api.logic4server.nl${apiPath}`;
    const fetchOpts = {
      method: m,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };
    if (body !== undefined && m !== "GET") {
      fetchOpts.body = JSON.stringify(body);
    }
    const r = await fetch(url, fetchOpts);
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    res.json({ ok: r.ok, status: r.status, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Order ophalen op nummer
app.get("/api/order/:nr", requireAuth, async (req, res) => {
  const orderNr = String(req.params.nr).trim();
  if (!/^\d+$/.test(orderNr)) {
    return res.status(400).json({ ok: false, error: "Ordernummer moet numeriek zijn." });
  }
  try {
    const [orderResp, rowsResp] = await Promise.all([
      getOrder(orderNr, req.auth),
      getOrderLines(orderNr, req.auth)
    ]);
    res.json({
      ok: true,
      orderNr,
      order: orderResp,
      rows: rowsResp
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/products", requireAuth, async (req, res) => {
  const codes = String(req.query.codes || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!codes.length) return res.status(400).json({ ok: false, error: "Gebruik ?codes=100250,100522" });
  try {
    res.json({ ok: true, raw: await getProducts(codes, req.auth) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/debtor/:id", requireAuth, async (req, res) => {
  try {
    res.json({ ok: true, raw: await getDebtor(parseInt(req.params.id, 10), req.auth) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Lookup Fonteyn-artikelcodes op basis van leveranciers-codes.
 * Gebruikt door de label-tool (Inkomende goederen).
 *
 * Request:  GET /api/products-by-supplier-code?codes=91652,91811,91812
 * Response: { ok: true, mapping: { "91652": {fonteynCode: "770873", description: "..."} } }
 *
 * Als een code niet gevonden wordt, ontbreekt hij in `mapping` — de frontend
 * kan 'm dan met lege Fonteyn-code tonen en Manon kan 'm handmatig invullen.
 */
/**
 * Haal de regels van een inkooporder op. Elke regel bevat zowel de Fonteyn-
 * artikelcode als de leveranciers-code — wat de label-tool nodig heeft zonder
 * 20.000 producten te scannen.
 *
 * Request:  GET /api/purchase-order-lines?po=37272
 * Response: { ok, lines: [{fonteynCode, supplierCode, description, aantal, raw}], rawCount }
 */
app.get("/api/purchase-order-lines", requireAuth, async (req, res) => {
  const po = String(req.query.po || "").trim();
  if (!po) {
    return res.status(400).json({ ok: false, error: "Gebruik ?po=37272" });
  }
  try {
    const rawLines = await getPurchaseOrderLines(po, req.auth);
    const lines = rawLines.map(r => ({
      fonteynCode: String(r.ProductCode || ""),
      supplierCode: String(r.CreditorProductCode || ""),
      description: r.ProductDesc1 || r.Description || r.ProductDesc2 || "",
      aantal: Math.round(Number(r.QtyToDeliver ?? r.QtyToOrder ?? 1)),
    }));
    const firstRaw = rawLines[0] || null;
    res.json({
      ok: true,
      lines,
      rawCount: rawLines.length,
      sampleRawLine: firstRaw,
      sampleFieldNames: firstRaw ? Object.keys(firstRaw) : [],
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/products-by-supplier-code", requireAuth, async (req, res) => {
  const codes = String(req.query.codes || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  if (!codes.length) {
    return res.status(400).json({ ok: false, error: "Gebruik ?codes=91652,91811,..." });
  }
  try {
    const { mapping, scanned, pages } = await getProductsBySupplierCode(codes, req.auth);

    // Als we niks vonden: één sample meesturen zodat we de veldnamen zien.
    let diagnostics = null;
    if (Object.keys(mapping).length === 0) {
      try {
        const sample = await getProductsSample(req.auth, 1);
        diagnostics = {
          productsScanned: scanned,
          pagesFetched: pages,
          sampleProduct: sample[0] || null,
          sampleProductFieldNames: sample[0] ? Object.keys(sample[0]) : [],
        };
      } catch (e) {
        diagnostics = { productsScanned: scanned, pagesFetched: pages, sampleError: e.message };
      }
    }

    res.json({
      ok: true,
      mapping,
      found: Object.keys(mapping).length,
      requested: codes.length,
      productsScanned: scanned,
      pagesFetched: pages,
      diagnostics
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// Stuurcijfers — JSON-opslag voor de financiële tabellen
// ============================================================
// Toegang: ingelogd én gerriette@fonteyn.nl of dolf@fonteyn.nl.
// De extra wachtwoord-laag ('Meerveld') zit aan de frontend-kant; hier checken
// we alleen op e-mail om te voorkomen dat een ander Logic4-account toch de
// endpoints aanroept met een gestolen sessie-id.
// Accepteert zowel email-form als Logic4-username, zoals ORDERSTATUS_ALLOWED.
const STUURCIJFERS_ALLOWED_EMAILS = new Set([
  "gerriette@fonteyn.nl",  "gerriette",
  "dolf@fonteyn.nl",       "fonteyn.dolf",
  "fonteynbot@fonteyn.nl", "fonteyn.bot", "fonteynbot",
]);

// Whitelist van geldige tabel-namen (= sheet-namen uit het datamodel).
// Voorkomt dat iemand met path-traversal naar willekeurige files schrijft.
const STUURCIJFERS_TABLES = new Set([
  // Bron-data
  "rubriceringen_logic",
  "beginbalans",
  "grootboektransacties",
  "korting_per_factuur",
  "toerekening_korting_garantie",
  // Configuratie
  "koppelen_groepen",
  "koppelen_rubrieken",
  "correctie_voorraadtelling",
  "normalisaties",
  "rekenblad",
  "verkoopkosten_verdeeld",
  "verkoopkosten_onverdeeld",
  "verdeling_verkoopkosten",
  "bedrijfskosten_verdeeld",
  "bedrijfskosten_onverdeeld",
  "stamgegevens",
  // Berekende output (read-only — wordt door JS-formules gevuld vanuit bovenstaande)
  "out_balans",
  "out_periodebalans",
  "out_resultaten_artikelgroep",
  "out_resultaten_samengevat",
]);

function requireStuurAuth(req, res, next) {
  if (!STUURCIJFERS_ALLOWED_EMAILS.has((req.auth?.username || "").toLowerCase())) {
    return res.status(403).json({ ok: false, error: "Geen toegang tot stuurcijfers." });
  }
  next();
}

function stuurFilePath(name) {
  if (!STUURCIJFERS_TABLES.has(name)) return null;
  return path.join(STUURCIJFERS_DIR, `${name}.json`);
}

// Lijst alle tabellen + meta (rij-aantal, laatste wijziging) — voor de overzichtspagina.
app.get("/api/stuurcijfers/tables", requireAuth, requireStuurAuth, (req, res) => {
  const tables = [];
  for (const name of STUURCIJFERS_TABLES) {
    const p = stuurFilePath(name);
    let rows = 0;
    let updatedAt = null;
    if (p && fs.existsSync(p)) {
      try {
        const stat = fs.statSync(p);
        updatedAt = stat.mtime.toISOString();
        // Snelle rij-telling: parse alleen als file < 5MB; anders hopen we dat de UI dat zelf telt
        if (stat.size < 5 * 1024 * 1024) {
          const data = JSON.parse(fs.readFileSync(p, "utf-8"));
          if (Array.isArray(data?.rows)) rows = data.rows.length;
        } else {
          rows = -1; // 'groot' — UI vraagt dit zelf op als je de tabel opent
        }
      } catch {}
    }
    tables.push({ name, rows, updatedAt });
  }
  res.json({ ok: true, tables });
});

// Eén tabel ophalen.
app.get("/api/stuurcijfers/tables/:name", requireAuth, requireStuurAuth, (req, res) => {
  const p = stuurFilePath(req.params.name);
  if (!p) return res.status(400).json({ ok: false, error: "Onbekende tabel." });
  if (!fs.existsSync(p)) return res.json({ ok: true, name: req.params.name, columns: [], rows: [] });
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    res.json({ ok: true, name: req.params.name, ...data });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Kon tabel niet lezen: " + e.message });
  }
});

// Eén tabel opslaan (overschrijft volledig). Body: { columns: [...], rows: [[...]] }
app.put("/api/stuurcijfers/tables/:name", requireAuth, requireStuurAuth, (req, res) => {
  const p = stuurFilePath(req.params.name);
  if (!p) return res.status(400).json({ ok: false, error: "Onbekende tabel." });
  const { columns, rows } = req.body || {};
  if (!Array.isArray(columns) || !Array.isArray(rows)) {
    return res.status(400).json({ ok: false, error: "Body moet { columns: [], rows: [[...]] } zijn." });
  }
  try {
    fs.writeFileSync(p, JSON.stringify({ columns, rows, savedAt: new Date().toISOString() }));
    res.json({ ok: true, rows: rows.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Kon tabel niet opslaan: " + e.message });
  }
});

// ============================================================
// Orderstatus-module — apply + audit-log
// Schrijft naar een gedeelde CSV op de Fonteyn-fileshare zodat Don/Arno/Dolf
// (en management) altijd terug kunnen zien wat de tool heeft gewijzigd.
// ============================================================

// Accepteert zowel email-form als Logic4-username (bv. "fonteyn.don"),
// zodat de check werkt ongeacht in welk format de gebruiker bij Logic4 inlogt.
const ORDERSTATUS_ALLOWED = new Set([
  "gerrit@fonteyn.nl",     "gerrit",
  "don@fonteyn.nl",        "fonteyn.don",
  "arno@fonteyn.nl",       "fonteyn.arno",
  "dolf@fonteyn.nl",       "fonteyn.dolf",
  "fonteynbot@fonteyn.nl", "fonteyn.bot", "fonteynbot",
]);

function requireOrderStatusAccess(req, res, next) {
  const email = (req.auth?.username || "").toLowerCase();
  if (!ORDERSTATUS_ALLOWED.has(email)) {
    return res.status(403).json({ ok: false, error: "Geen toegang tot deze actie." });
  }
  next();
}

function getAuditDir() {
  if (process.env.AUDIT_DIR) return process.env.AUDIT_DIR;
  if (process.platform === "win32") return "G:\\Fonteyn\\Orderstatus-Audit";
  return "/Volumes/data/Fonteyn/Orderstatus-Audit"; // Mac met SMB-mount van \\fonfile\data
}

function getAuditCsvPath() {
  return path.join(getAuditDir(), "audit.csv");
}

const AUDIT_HEADER = [
  "timestamp", "user", "order_id", "customer", "total", "paid",
  "old_status_id", "old_status_label",
  "new_status_id", "new_status_label",
  "success", "error"
].join(";");

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[;"\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvRow(obj) {
  return [
    obj.timestamp, obj.user, obj.order_id, obj.customer,
    obj.total, obj.paid,
    obj.old_status_id, obj.old_status_label,
    obj.new_status_id, obj.new_status_label,
    obj.success ? "true" : "false",
    obj.error || ""
  ].map(csvEscape).join(";");
}

function ensureAuditFile() {
  const dir = getAuditDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = getAuditCsvPath();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, AUDIT_HEADER + "\n", "utf-8");
  }
  return file;
}

function appendAuditRow(row) {
  const file = ensureAuditFile();
  fs.appendFileSync(file, csvRow(row) + "\n", "utf-8");
}

app.post("/api/order-status/apply", requireAuth, requireOrderStatusAccess, async (req, res) => {
  const { changes } = req.body || {};
  if (!Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({ ok: false, error: "Geen wijzigingen meegegeven." });
  }
  try {
    ensureAuditFile();
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: `Audit-log kan niet worden geschreven (${getAuditDir()}): ${e.message}`
    });
  }
  let token;
  try {
    token = await getTokenForUser(req.auth.username, req.auth.password);
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Auth bij Logic4 mislukt: " + e.message });
  }

  const results = [];
  for (const ch of changes) {
    const orderId = parseInt(ch.orderId, 10);
    const newStatusId = parseInt(ch.newStatusId, 10);
    if (!Number.isFinite(orderId) || !Number.isFinite(newStatusId)) {
      results.push({ orderId: ch.orderId, success: false, error: "Ongeldige orderId/newStatusId" });
      appendAuditRow({
        timestamp: new Date().toISOString(),
        user: req.auth.username,
        order_id: ch.orderId,
        customer: ch.customer || "",
        total: ch.total ?? "",
        paid: ch.paid ?? "",
        old_status_id: ch.currentStatusId ?? "",
        old_status_label: ch.currentStatusLabel || "",
        new_status_id: ch.newStatusId ?? "",
        new_status_label: ch.newStatusLabel || "",
        success: false,
        error: "Ongeldige orderId/newStatusId"
      });
      continue;
    }
    let success = false;
    let errorMsg = "";
    try {
      const r = await fetch("https://api.logic4server.nl/v3/Orders/UpdateOrderStatus", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ OrderId: orderId, StatusId: newStatusId })
      });
      if (r.ok) success = true;
      else {
        const txt = await r.text();
        errorMsg = `HTTP ${r.status}: ${txt.slice(0, 200)}`;
      }
    } catch (e) {
      errorMsg = e.message;
    }
    results.push({ orderId, success, error: success ? undefined : errorMsg });
    appendAuditRow({
      timestamp: new Date().toISOString(),
      user: req.auth.username,
      order_id: orderId,
      customer: ch.customer || "",
      total: ch.total ?? "",
      paid: ch.paid ?? "",
      old_status_id: ch.currentStatusId ?? "",
      old_status_label: ch.currentStatusLabel || "",
      new_status_id: newStatusId,
      new_status_label: ch.newStatusLabel || "",
      success,
      error: errorMsg
    });
  }
  const applied = results.filter(r => r.success).length;
  const failed  = results.length - applied;
  res.json({ ok: true, applied, failed, results, auditPath: getAuditCsvPath() });
});

app.get("/api/order-status/audit-log", requireAuth, requireOrderStatusAccess, (req, res) => {
  const limit = Math.max(1, Math.min(2000, parseInt(req.query.limit, 10) || 200));
  const file = getAuditCsvPath();
  if (!fs.existsSync(file)) return res.json({ ok: true, rows: [], total: 0, path: file });
  let raw;
  try { raw = fs.readFileSync(file, "utf-8"); }
  catch (e) { return res.status(500).json({ ok: false, error: `Kon audit-log niet lezen: ${e.message}` }); }
  const lines = raw.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return res.json({ ok: true, rows: [], total: 0, path: file });
  const header = lines[0].split(";");
  const dataLines = lines.slice(1);
  const recent = dataLines.slice(-limit).reverse();

  const parseCsvLine = (line) => {
    const out = []; let cur = ""; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else cur += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ";") { out.push(cur); cur = ""; }
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  };

  const rows = recent.map(line => {
    const vals = parseCsvLine(line);
    const obj = {};
    header.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
  res.json({ ok: true, rows, total: dataLines.length, path: file });
});

// ============================================================
// Debug/dev-endpoints (werken alleen als LOGIC4_USERNAME/PASSWORD in env staan)
// ============================================================

app.get("/api/test-auth", async (req, res) => {
  try {
    const token = await getToken();
    res.json({ ok: true, tokenPreview: token.slice(0, 24) + "..." });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("┌──────────────────────────────────────────────┐");
  console.log("│  Fonteyn helper draait                       │");
  console.log(`│  Open in browser:  http://localhost:${PORT}/    │`);
  console.log("│  Stop met Ctrl+C                             │");
  console.log("└──────────────────────────────────────────────┘");
  console.log("");
});
