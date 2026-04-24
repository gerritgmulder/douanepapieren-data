// Logic4 API-client.
// Authenticatie: OAuth2 client_credentials (zie https://api.logic4server.nl/oauth2).
// Per-user token-cache: elke ingelogde gebruiker heeft een eigen Logic4-token
// in memory, 1 uur geldig. App-level keys (public/secret/company/admin) komen
// uit env vars; username/password worden per request meegegeven door de caller
// (komen uit de sessie die door index.js wordt beheerd).

const TOKEN_URL = "https://idp.logic4server.nl/token";
const API_BASE  = "https://api.logic4server.nl";

// Map<username, {token, expiresAt}>
const _tokenCache = new Map();

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Ontbrekende env var: ${name}`);
  return v;
}

// Logic4 vereist dat spaties in een element worden vervangen door _ en
// underscores door __. Niet strikt nodig zolang creds zelf geen spatie/underscore
// bevatten, maar voor de zekerheid:
function logic4Encode(s) {
  return String(s).replace(/_/g, "__").replace(/ /g, "_");
}

/**
 * Haal een Logic4-access-token op voor een specifieke gebruiker.
 * Gebruikt de in-memory cache om niet bij elke API-call opnieuw naar IDP te gaan.
 */
export async function getTokenForUser(username, password) {
  if (!username || !password) {
    throw new Error("getTokenForUser: username en password zijn verplicht.");
  }
  const now = Date.now();
  const cached = _tokenCache.get(username);
  if (cached && now < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const PUB   = logic4Encode(requireEnv("LOGIC4_PUBLICKEY"));
  const SEC   = logic4Encode(requireEnv("LOGIC4_SECRETKEY"));
  const COMP  = logic4Encode(requireEnv("LOGIC4_COMPANYKEY"));
  const ADMIN = logic4Encode(requireEnv("LOGIC4_ADMINISTRATION"));
  const USER  = logic4Encode(username);
  const PASS  = logic4Encode(password);

  const body = new URLSearchParams();
  body.set("client_id", `${PUB} ${COMP} ${USER}`);
  body.set("client_secret", `${SEC} ${PASS}`);
  body.set("scope", `api administration.${ADMIN}`);
  body.set("grant_type", "client_credentials");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Token request faalde: HTTP ${res.status} — ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("Geen access_token in response: " + JSON.stringify(data));

  const ttlMs = (data.expires_in || 3600) * 1000;
  _tokenCache.set(username, { token: data.access_token, expiresAt: now + ttlMs });
  return data.access_token;
}

/**
 * Verwijder een gebruiker (of de hele cache) uit de token-cache.
 * Handig bij logout of bij wachtwoord-wijziging.
 */
export function clearTokenCache(username) {
  if (username) _tokenCache.delete(username);
  else _tokenCache.clear();
}

/**
 * Legacy/dev fallback: gebruikt LOGIC4_USERNAME/PASSWORD uit env.
 * Alleen nog nuttig voor de debug-endpoints (test-auth, probe-order) als iemand
 * die env vars lokaal zet. In productie (via Electron-wrapper) zijn ze niet
 * gezet — dan moet via /api/login worden gewerkt.
 */
export async function getToken() {
  const user = process.env.LOGIC4_USERNAME;
  const pass = process.env.LOGIC4_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      "Geen user-credentials gevonden. Log in via /api/login, of zet " +
      "LOGIC4_USERNAME en LOGIC4_PASSWORD in server/.env voor dev/debug."
    );
  }
  return getTokenForUser(user, pass);
}

/**
 * Resolve-volgorde voor auth: expliciete token > authCtx > env-fallback.
 */
async function resolveToken(opts) {
  if (opts.token) return opts.token;
  if (opts.authCtx) return getTokenForUser(opts.authCtx.username, opts.authCtx.password);
  return getToken();
}

async function apiCall(path, opts = {}) {
  const token = await resolveToken(opts);
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Logic4 ${opts.method || "GET"} ${path} faalde: HTTP ${res.status} — ${txt.slice(0, 300)}`);
  }
  return res.json();
}

// ============================================================
// Endpoints
// Alle data-functies accepteren een optionele authCtx = {username, password}.
// Als niet meegegeven valt het terug op getToken() (env) — handig voor CLI/debug.
// ============================================================

/**
 * Haal een verkooporder op aan de hand van het ordernummer.
 * POST /v3/Orders/GetOrders met { Id: <ordernummer> }
 */
export async function getOrder(orderNr, authCtx) {
  return apiCall("/v3/Orders/GetOrders", {
    method: "POST",
    body: { Id: parseInt(orderNr, 10), TakeRecords: 1 },
    authCtx
  });
}

/**
 * Haal regelitems van een order op.
 * POST /v3/Orders/GetOrderRows met { OrderId: <ordernummer> }
 */
export async function getOrderLines(orderNr, authCtx) {
  return apiCall("/v3/Orders/GetOrderRows", {
    method: "POST",
    body: { OrderId: parseInt(orderNr, 10), TakeRecords: 500 },
    authCtx
  });
}

/**
 * Haal de regels van een inkooporder (BuyOrder) op. Logic4's endpoint is
 * /v3/BuyOrders/GetBuyOrderRows, POST, body = het PO-nummer als losse
 * integer (geen wrapper-object!). Gevonden veldnamen per regel:
 *   ProductCode          -> Fonteyn-artikelcode (bv. 770873)
 *   CreditorProductCode  -> leveranciers-code (bv. 91652)
 *   ProductDesc1 / ProductDesc2 / Description -> omschrijving
 *   QtyToDeliver / QtyToOrder -> aantal
 */
export async function getPurchaseOrderLines(poNr, authCtx) {
  const orderId = parseInt(poNr, 10);
  if (!Number.isFinite(orderId)) throw new Error("Ongeldig PO-nummer: " + poNr);

  const r = await apiCall("/v3/BuyOrders/GetBuyOrderRows", {
    method: "POST",
    body: orderId,   // Let op: rauwe integer, geen object
    authCtx
  });
  return Array.isArray(r) ? r : [];
}

/**
 * Haal productdetails (HS-code, dimensies, gewichten, herkomst) op.
 */
export async function getProducts(productCodes, authCtx) {
  return apiCall("/v3/Products/GetProducts", {
    method: "POST",
    body: { ProductCodes: productCodes, TakeRecords: 500 },
    authCtx
  });
}

/**
 * Haal klantgegevens op (naam, adres).
 */
export async function getDebtor(debtorId, authCtx) {
  return apiCall("/v3/Debtors/GetDebtors", {
    method: "POST",
    body: { DebtorIds: [debtorId], TakeRecords: 1 },
    authCtx
  });
}

/**
 * Haal één pagina producten op (max 500 per call — Logic4's limit).
 * Logic4 geeft soms een bare array terug, soms {Products: [...]}. We
 * normaliseren dat hier.
 */
async function fetchProductsPage(body, authCtx) {
  const r = await apiCall("/v3/Products/GetProducts", { method: "POST", body, authCtx });
  if (Array.isArray(r)) return r;
  if (Array.isArray(r?.Products)) return r.Products;
  return [];
}

/**
 * Zoek producten op leveranciers-productcode (bv. "91652") door de hele
 * productcatalogus te pagineren en client-side te filteren. Logic4's
 * server-side filters werken niet betrouwbaar in deze installatie.
 *
 * Vroegtijdig stoppen zodra we alle gevraagde codes hebben gevonden.
 */
export async function getProductsBySupplierCode(supplierCodes, authCtx) {
  const list = (Array.isArray(supplierCodes) ? supplierCodes : [supplierCodes])
    .map(s => String(s).trim())
    .filter(Boolean);
  if (!list.length) return { mapping: {}, scanned: 0, pages: 0 };

  const wanted = new Set(list.map(s => s.toLowerCase()));
  const mapping = {};
  // Velden waarin de leveranciers-code mogelijk staat (ingesteld tijdens
  // diagnose — zodra we zeker weten welk veld Fonteyn gebruikt kunnen we
  // deze lijst inkorten voor snelheid).
  const candidateFields = [
    "ProducerProductCode", "ProducerProductCode2", "ProducerArticleCode",
    "SupplierProductCode", "SupplierCode", "SupplierArticleCode",
    "ExternalCode", "ProductCodeSupplier", "Barcode", "Sku"
  ];

  const PAGE_SIZE = 500;
  const MAX_PAGES = 40; // 20.000 producten als harde bovengrens
  let scanned = 0;
  let pages = 0;
  let skip = 0;

  for (pages = 0; pages < MAX_PAGES; pages++) {
    const batch = await fetchProductsPage(
      { TakeRecords: PAGE_SIZE, SkipRecords: skip },
      authCtx
    );
    if (!batch.length) break;
    scanned += batch.length;

    for (const p of batch) {
      for (const f of candidateFields) {
        const v = p[f];
        if (!v) continue;
        const key = String(v).toLowerCase();
        if (!wanted.has(key)) continue;
        const supplierCode = String(v);
        if (mapping[supplierCode]) continue;
        mapping[supplierCode] = {
          fonteynCode: String(p.ProductCode || ""),
          description: p.ProductName1 || p.ProductName2 || p.Description || "",
          brand: p.Brandname || p.Brand || ""
        };
      }
    }

    if (Object.keys(mapping).length >= wanted.size) break; // klaar
    if (batch.length < PAGE_SIZE) break; // eind van catalogus
    skip += PAGE_SIZE;
  }

  return { mapping, scanned, pages: pages + 1 };
}

/**
 * Diagnostisch: haal een kleine sample producten op zonder filter, zodat
 * Claude de veldnamen en response-structuur kan inspecteren.
 */
export async function getProductsSample(authCtx, count = 3) {
  return fetchProductsPage({ TakeRecords: count }, authCtx);
}
