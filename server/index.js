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

const app = express();
app.use(express.json());

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
