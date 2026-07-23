// Cloudflare Worker — generieke data-store voor Fonteyn Dashboard modules
//
// Doel: server-side state-opslag zonder dat de bundled-Electron-server
// daarvoor moet worden bijgewerkt. macOS-installs zonder Apple Developer
// signing kunnen niet auto-updaten, dus elke nieuwe module die
// staat-opslag nodig heeft mag NIET in server/index.js terechtkomen.
// Deze worker neemt die rol over: generieke key-value-opslag in Cloudflare
// KV, met per-module buckets.
//
// API:
//   GET  /data/<bucket>   → return JSON state (of {} als leeg)
//   PUT  /data/<bucket>   → vervang JSON state (body = JSON)
//
// Auth: ALLOWED_BUCKETS-whitelist + secret-header X-Fonteyn-Auth.
// Het secret zit als Cloudflare-secret in env.SHARED_SECRET (niet in code).
//
// Beveiliging-niveau: matig. De secret zit ook in de HTML van het
// dashboard; iedereen die de HTML kan zien (= ingelogde Fonteyn-medewerker
// + Logic4-credentials nodig) kan 'm zien. Dat is acceptabel voor data
// op deze schaal (~10-30 records met persoonsgegevens).

const ALLOWED_BUCKETS = new Set([
  "personeel",
  "koeien",
  "rapportage",       // Jaartargets per afdeling, review-toewijzingen
  "douane-specs",     // Handmatig aangevulde HS/origin/gewicht/dims per artikel
  "retouren",         // Retour-registratie per order (reden/locatie/uitleg/adviseur)
  "voorraad",         // Voorraadbeheer: adviseur-map (UserId→naam) + dealer-markering per debiteur
  "voorraad-pipeline",// Voorraadbeheer pipeline: containers (nr/besteld/ETA/herkomst + spa-regels) — door Chantal beheerd
  "dealer-accounts",  // Dealerportaal: toegestane dealers (email/bedrijf/debtorIds) + contactEmail — beheer via interne tegel
  "dealer-docs",      // Dealerportaal: documenten/specsheets (titel/model/url)
  "dealer-requests",  // Dealerportaal: reserveringsaanvragen van dealers (beheer via interne tegel)
  "dealer-prices",    // Dealerportaal: dealerprijs per model (voor 30%-aanbetaling via Mollie)
  "spa-catalog",      // Model → varianten (artikelcode/kleur/productId) uit Logic4 — tools/build-spa-catalog.mjs
  "voorraad-hallen",  // Echte hal-voorraad per model uit Logic4 (warehouse Fonteyn) — tools/build-stock.mjs
  "voorraad-schepen", // Schip-voorraad uit commercial invoices (ref/schip/eta + regels per model)
  "voorraad-prioriteit", // Chantal's allocatie-volgorde per model (byModel: {model: [ordernr,…]})
  "reserveringen-live",  // Reserveringen-ledger uit Logic4 (uur-sync): per model open orders + betaald/vervallen
  // Toekomstige modules toevoegen aan deze whitelist
]);

// Patroon-buckets: modules die per periode een eigen bucket gebruiken
// (omdat één bucket de 1 MB-limiet zou overschrijden bij groeiende data).
// signin-YYYY-MM = UK showroom bezoekersregistratie, één bucket per maand
// (handtekeningen als vector-strokes ≈ 2 KB per bezoeker).
const ALLOWED_BUCKET_PATTERNS = [
  /^signin-\d{4}-\d{2}$/,
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Fonteyn-Auth, X-Dealer-Session, X-DP-Admin",
  "Access-Control-Max-Age": "86400",
};

function reply(status, body, extraHeaders = {}) {
  const isJson = typeof body !== "string";
  return new Response(isJson ? JSON.stringify(body) : body, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": isJson ? "application/json" : "text/plain",
      ...extraHeaders,
    },
  });
}

// ─── Sign In (UK) verwijderd ────────────────────────────────────────
// De kiosk (signin.html + /signin, /email/send, /verify, /sms/*, /v)
// is vervangen door een extern systeem en hier opgeruimd. De historische
// bezoekersdata blijft bereikbaar via /data/signin-YYYY-MM (pattern hierboven).

// ─── Dealerportaal ──────────────────────────────────────────────────
// Publiek web-portaal voor dealers (dealers.fonteyn.nl, voorlopig op de
// workers.dev-URL): GET /dealers serveert de pagina (vers van GitHub main,
// zelfde patroon als de oude kiosk). Login = magic-link per e-mail (Resend);
// alleen adressen die intern in de beheertegel zijn toegevoegd (bucket
// dealer-accounts) krijgen een link. Sessies en login-tokens staan als
// losse KV-keys (dp-sess:/dp-login:) met TTL — bewust NIET via /data
// bereikbaar. De dealer-API's geven uitsluitend dealer-veilige data terug:
// geaggregeerde voorraad (geen klantnamen, geen inkoopprijzen), documenten
// en een contactformulier. De interne SHARED_SECRET komt hier nergens aan
// te pas.

const DP_LOGIN_TTL = 15 * 60;            // magic-link 15 min geldig
const DP_SESS_TTL  = 30 * 24 * 3600;     // sessie 30 dagen

// Best-effort rate-limiter op KV (eventual consistent — geen harde garantie,
// wel een echte rem op mail-bombing en wachtwoord-raden). Per IP + scope:
// max `limit` pogingen per `windowSec`. Cloudflare geeft het echte client-IP
// door in CF-Connecting-IP.
async function rateLimited(env, request, scope, limit, windowSec) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = "rl:" + scope + ":" + ip;
  const cur = parseInt(await env.FONTEYN_DATA.get(key) || "0", 10);
  if (cur >= limit) {
    console.log("[ratelimit] " + scope + " geblokkeerd voor " + ip);
    return true;
  }
  // TTL vernieuwt per schrijf — venster schuift op; prima voor best-effort.
  await env.FONTEYN_DATA.put(key, String(cur + 1), { expirationTtl: windowSec });
  return false;
}

async function dpSendEmail(env, to, subject, html, replyTo) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    console.log("[dp-mail] niet geconfigureerd (RESEND_API_KEY/MAIL_FROM ontbreekt)");
    return { ok: false, error: "mail-not-configured" };
  }
  const body = { from: env.MAIL_FROM, to: [String(to).toLowerCase()], subject, html };
  if (replyTo) body.reply_to = [replyTo];
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const respText = await r.text().catch(() => "");
  console.log("[dp-mail] to=" + to + " status=" + r.status + " resp=" + respText.slice(0, 300));
  return { ok: r.ok, status: r.status };
}

async function dpGetAccounts(env) {
  const data = await env.FONTEYN_DATA.get("dealer-accounts", { type: "json" });
  return data || { dealers: [], contactEmail: "gerrit@fonteyn.nl" };
}

function dpFindDealer(accounts, email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  return (accounts.dealers || []).find(d => String(d.email || "").toLowerCase() === e && d.active !== false) || null;
}

async function dpSession(env, request) {
  const tok = request.headers.get("X-Dealer-Session") || "";
  if (!tok || tok.length < 20) return null;
  const sess = await env.FONTEYN_DATA.get("dp-sess:" + tok, { type: "json" });
  return sess || null;
}

// ─── Wachtwoorden: PBKDF2-SHA256, alleen de hash wordt bewaard ────────
// Niemand (ook beheerders met bucket-toegang niet) kan het wachtwoord
// terugzien — er staat alleen salt+hash in dealer-accounts.
async function dpHashPassword(password, saltB64, iterations) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), c => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const iter = iterations || 50000;
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, km, 256);
  return { salt: btoa(String.fromCharCode(...salt)), iter, hash: btoa(String.fromCharCode(...new Uint8Array(bits))) };
}
async function dpVerifyPassword(password, pw) {
  if (!pw || !pw.salt || !pw.hash) return false;
  const h = await dpHashPassword(password, pw.salt, pw.iter);
  return h.hash === pw.hash;
}
function dpNewSessionToken() { return crypto.randomUUID() + crypto.randomUUID().replace(/-/g, ""); }

// POST /dealers/login  { email }             → magic-link per mail (vangnet)
// POST /dealers/login  { email, password }   → direct inloggen met wachtwoord
async function dpHandleLogin(request, env, url) {
  let body = {};
  try { body = await request.json(); } catch {}
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  // Wachtwoord-route: sessie direct teruggeven, geen mail nodig
  if (password) {
    if (await rateLimited(env, request, "dppw", 10, 900)) return reply(429, { ok: false, error: "too-many-attempts" });
    const accounts = await dpGetAccounts(env);
    const dealer = dpFindDealer(accounts, email);
    if (!dealer || !(await dpVerifyPassword(password, dealer.pw))) {
      return reply(401, { ok: false, error: "invalid-login" });   // generiek — geen enumeratie
    }
    const sess = dpNewSessionToken();
    await env.FONTEYN_DATA.put("dp-sess:" + sess, JSON.stringify({ email, company: dealer.company || "", since: new Date().toISOString() }), { expirationTtl: DP_SESS_TTL });
    return reply(200, { ok: true, session: sess, company: dealer.company || "" });
  }

  // Altijd hetzelfde antwoord — geen e-mail-enumeratie mogelijk
  const generic = reply(200, { ok: true, message: "if-known-mail-sent" });
  if (!email || !email.includes("@")) return generic;
  // Rem op mail-bombing/adres-proberen: 5 loginpogingen per kwartier per IP.
  // Zelfde generieke antwoord, zodat ook dit geen enumeratie-signaal geeft.
  if (await rateLimited(env, request, "dplogin", 5, 900)) return generic;
  const accounts = await dpGetAccounts(env);
  const dealer = dpFindDealer(accounts, email);
  if (!dealer) return generic;
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  await env.FONTEYN_DATA.put("dp-login:" + token, JSON.stringify({ email, company: dealer.company || "" }), { expirationTtl: DP_LOGIN_TTL });
  const link = url.origin + "/dealers/auth?t=" + token;
  await dpSendEmail(env, email, "Your Passion Partners login link",
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">' +
    '<h2 style="color:#c8102e;">Passion Partners</h2>' +
    '<p>Hello ' + (dealer.company ? dealer.company : "") + ',</p>' +
    '<p>Click the button below to log in. This link is valid for 15 minutes.</p>' +
    '<p style="margin:26px 0;"><a href="' + link + '" ' +
    'style="background:#c8102e;color:#fff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:10px;display:inline-block;">Log in to the portal</a></p>' +
    '<p style="color:#888;font-size:12px;">If you did not request this, you can ignore this email.</p></div>');
  return generic;
}

// GET /dealers/auth?t=… → login-token inwisselen voor sessie, terug naar portaal
async function dpHandleAuth(request, env, url) {
  const t = url.searchParams.get("t") || "";
  const login = t ? await env.FONTEYN_DATA.get("dp-login:" + t, { type: "json" }) : null;
  if (!login) {
    return new Response("<html><body style='font-family:Arial;padding:40px;text-align:center'><h2>Link expired</h2><p>This login link is no longer valid. Please request a new one.</p><p><a href='" + url.origin + "/dealers'>Back to the portal</a></p></body></html>",
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  await env.FONTEYN_DATA.delete("dp-login:" + t);   // eenmalig bruikbaar
  const sess = dpNewSessionToken();
  await env.FONTEYN_DATA.put("dp-sess:" + sess, JSON.stringify({ email: login.email, company: login.company, since: new Date().toISOString() }), { expirationTtl: DP_SESS_TTL });
  // Token in het URL-FRAGMENT (#s=…), niet als queryparameter: fragmenten
  // verlaten de browser nooit (geen server/proxy-logs, geen referrers).
  return new Response(null, { status: 302, headers: { "Location": url.origin + "/dealers#s=" + sess } });
}

// Voorraad-aggregatie per model — NIEUWE definitie (Arno/Chantal, 15 jul):
//   available = fysiek in de Fonteyn-hallen (bucket voorraad-hallen, uit Logic4)
//   onTheWater = op het schip (bucket voorraad-schepen, uit commercial invoices)
//   Minus de eigen portaal-claims (bucket dealer-requests, betaalde/open).
// Een partner mag ALTIJD reserveren; niet-op-voorraad = backorder.
async function dpStockModels(env) {
  const hallen = await env.FONTEYN_DATA.get("voorraad-hallen", { type: "json" });
  const schepen = await env.FONTEYN_DATA.get("voorraad-schepen", { type: "json" });
  const reqData = (await env.FONTEYN_DATA.get("dealer-requests", { type: "json" })) || {};
  const priceData = (await env.FONTEYN_DATA.get("dealer-prices", { type: "json" })) || {};

  const byModel = {};
  const ensure = m => (byModel[m] = byModel[m] || { model: m, available: 0, physical: 0, onTheWater: 0, nextEta: null, variants: {} });

  // Seed vanuit de prijslijst: élk verkoopbaar model verschijnt (ook met 0
  // voorraad → backorder), zodat partners altijd kunnen bestellen.
  for (const m of Object.keys(priceData.prices || {})) ensure(m);

  // Hal-voorraad: available = VRIJE voorraad (fysiek − verkocht); physical =
  // fysiek aantal (intern voor Chantal). Kleurvarianten tonen de vrije voorraad.
  for (const [model, v] of Object.entries((hallen && hallen.models) || {})) {
    const e = ensure(model);
    e.available += Number(v.available != null ? v.available : v.hal) || 0;   // v.hal = oud formaat (terugval)
    e.physical += Number(v.physical != null ? v.physical : v.hal) || 0;
    for (const [code, qty] of Object.entries(v.variants || {})) e.variants[code] = (e.variants[code] || 0) + (Number(qty) || 0);
  }
  // Schip-voorraad (+ vroegste ETA als bekend)
  for (const ship of (schepen && schepen.ships) || []) {
    for (const [model, qty] of Object.entries(ship.models || {})) {
      const e = ensure(model);
      e.onTheWater += Number(qty) || 0;
      if (ship.eta && (!e.nextEta || ship.eta < e.nextEta)) e.nextEta = ship.eta;
    }
  }
  // Portaal-claims van dit moment aftrekken van 'available' (open of betaald)
  for (const r of (Array.isArray(reqData.requests) ? reqData.requests : [])) {
    if (r.allocationReleased) continue;
    if (!["open", "paid"].includes(r.paymentStatus) && r.status !== "paid") continue;
    const e = byModel[String(r.model || "").trim()];
    if (e) e.available = Math.max(0, e.available - (Number(r.qty) || 0));
  }

  const models = Object.values(byModel)
    .map(m => ({ ...m, variants: Object.entries(m.variants).map(([code, qty]) => ({ code, qty })).filter(x => x.qty > 0) }))
    .sort((a, b) => (b.available - a.available) || (b.onTheWater - a.onTheWater) || String(a.model).localeCompare(String(b.model)));
  return { updated: (hallen && hallen.updated) || null, shipsUpdated: (schepen && schepen.updated) || null, models };
}

// Collectie-kleuren (uit de prijslijst-banners): partners zien elk model in
// de kleur van zijn Passion-collectie.
const DP_COLLECTION_COLORS = {
  "Pure": "#e4551f", "Dream": "#e4551f", "Signature": "#3e7d3f",
  "Exclusive": "#a62c39", "Modern": "#454545", "Sport & Fitness": "#2e79b5",
  "Turbine Grand": "#2e79b5", "Ice Baths": "#2ca6d6", "Eden Premium": "#3ba89b",
  "Overflow": "#6b4e9e", "Heat Pumps": "#6b7280",
};

// GET /dealers/api/stock — geaggregeerd per model, dealer-veilig, mét
// partnerprijs ($ + Freight Surcharge Warehouse Uddel) + collectie/kleur.
// ALLEEN modellen die op de prijslijst staan (verkoopbaar assortiment) —
// oude/uitlopende modellen en andere merken worden niet aan partners getoond.
async function dpHandleStock(env) {
  const agg = await dpStockModels(env);
  const priceData = (await env.FONTEYN_DATA.get("dealer-prices", { type: "json" })) || {};
  const prices = priceData.prices || {};
  // Catalogus: alle kleurvarianten per model (code → nette kleurnaam)
  const catalog = (await env.FONTEYN_DATA.get("spa-catalog", { type: "json" })) || {};
  const catModels = catalog.models || {};
  const codeName = {};
  for (const vs of Object.values(catModels))
    for (const v of vs) codeName[v.code] = String(v.desc || v.code).replace(/^.*\|\s*/, "");
  // Live wisselkoers voor de EUR-weergave (partnerprijzen ex. BTW; BTW hangt
  // van de individuele debiteur af en wordt pas bij het reserveren berekend).
  const rate = Number(priceData.meta && priceData.meta.rate) > 0 ? Number(priceData.meta.rate) : 1.11;
  const models = [];
  for (const m of agg.models) {
    const p = prices[m.model];
    if (!(p && typeof p === "object" && Number(p.usd) > 0)) continue;   // alleen prijslijst
    // ALLE kleuren uit de catalogus, elk met de vrije voorraad (0 = backorder),
    // zodat een partner ook bij een backorder-model een kleur kan kiezen.
    const freeByCode = {};
    for (const v of (m.variants || [])) freeByCode[v.code] = v.qty;
    m.variants = (catModels[m.model] || []).map(v => ({
      code: v.code, name: codeName[v.code] || v.code, free: Number(freeByCode[v.code]) || 0,
    }));
    m.partnerUsd = Number(p.usd);
    m.surchargeUsd = Number(p.surcharge) || 0;
    m.partnerEur = Math.round(Number(p.usd) / rate);                        // USD → EUR via live koers
    m.surchargeEur = Math.round((Number(p.surcharge) || 0) / rate);
    m.retailEur = Number(p.retailEur) || null;
    m.collection = p.collection || null;
    m.collectionColor = DP_COLLECTION_COLORS[p.collection] || "#9ca3af";
    models.push(m);
  }
  return reply(200, { ok: true, updated: agg.updated, shipsUpdated: agg.shipsUpdated, rate, models });
}

// GET /dealers/api/myspas — de eigen reserveringen van deze partner, MET de
// verwachte levering per spa (uit de reserveringen-ledger / leverforecast).
// Koppeling: debtorIds op het dealer-account ↔ debtorId in de ledger.
async function dpHandleMySpas(env, sess) {
  const accounts = await dpGetAccounts(env);
  const dealer = dpFindDealer(accounts, sess.email);
  const debtorIds = new Set(((dealer && dealer.debtorIds) || []).map(String).filter(Boolean));
  if (!debtorIds.size) return reply(200, { ok: true, linked: false, spas: [] });
  const ledger = (await env.FONTEYN_DATA.get("reserveringen-live", { type: "json" })) || {};
  const spas = [];
  for (const [model, list] of Object.entries(ledger.byModel || {})) {
    for (const r of list) {
      if (!debtorIds.has(String(r.debtorId))) continue;
      spas.push({
        ordernr: r.ordernr, date: r.datum, model, kleur: r.kleur || null, qty: r.qty,
        status: r.status, betaald: r.betaald, betaaldPct: r.betaaldPct,
        verwacht: r.verwacht || null, verwachtSchip: r.verwachtSchip || null,
      });
    }
  }
  spas.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return reply(200, { ok: true, linked: true, spas, ledgerUpdated: ledger.updated || null });
}

// ─── Prijs & aanbetaling (wisselkoers + BTW uit Logic4) ──────────────
// Rekenregels (Gerrit/Arno 15 jul):
//  • Basis = ALTIJD de dollarprijs uit de lijst (+ surcharge + $50 packing bij
//    losse levering via Fonteyn).
//  • US-partner: bedragen in USD, geen BTW (buiten EU).
//  • EU/NL: EUR = USD / koers, koers = wisselkoers.nl EUR/USD − 0,03 (instelbaar,
//    dealer-prices.meta.rate, default 1,11).
//  • BTW: rechtstreeks uit Logic4 per debiteur (VatCode.Percent). NL 21%,
//    EU-partner met geldig BTW-nr = 0% (ICL), buiten EU 0%. Geen eigen logica.
//  • Aanbetaling = 30% van het totaal INCL. BTW.
async function dpDebtorVatPercent(env, debtorId) {
  if (!debtorId) return 0;
  try {
    const token = await l4Token(env);
    const r = await fetch("https://api.logic4server.nl/v3/Relations/GetCustomers", {
      method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ Id: Number(debtorId), TakeRecords: 1 }),
    });
    const j = await r.json().catch(() => null);
    const c = Array.isArray(j) ? j[0] : (j && (j.Customers || [])[0]);
    return Number(c && c.VatCode && c.VatCode.Percent) || 0;
  } catch (e) { return 0; }
}

async function dpRate(env) {
  const pd = (await env.FONTEYN_DATA.get("dealer-prices", { type: "json" })) || {};
  const r = Number(pd.meta && pd.meta.rate);
  return r > 0 ? r : 1.11;
}

// Bereken aanbetaling. vatPercent optioneel meegeven (anders 0). Voor US wordt
// vatPercent genegeerd (nooit BTW). Retourneert bedragen + opbouw.
function dpDepositCalc(pEntry, { isUS, qty, rate, vatPercent, withSurcharge = true, fraction = 0.30 }) {
  const usd = Number(pEntry.usd) || 0;
  const sur = withSurcharge ? (Number(pEntry.surcharge) || 0) : 0;
  const pack = withSurcharge ? 50 : 0;
  const q = Number(qty) || 1;
  const f = fraction > 0 ? fraction : 0.30;              // 0.30 = aanbetaling, 1.0 = volledig
  if (isUS) {
    const unit = usd + sur + pack;                       // USD, geen BTW
    const total = unit * q;
    return { currency: "USD", vatPercent: 0, exVatUnit: unit, totalExVat: total, totalInclVat: total, deposit: Math.round(total * f * 100) / 100 };
  }
  const r = rate > 0 ? rate : 1.11;
  const exVatUnit = (usd + sur + pack) / r;              // USD → EUR
  const totalExVat = exVatUnit * q;
  const vat = Number(vatPercent) || 0;
  const totalInclVat = totalExVat * (1 + vat / 100);
  return { currency: "EUR", vatPercent: vat, exVatUnit, totalExVat, totalInclVat, deposit: Math.round(totalInclVat * f * 100) / 100 };
}

// ─── Voorraad claimen bij reserveringen ──────────────────────────────
// De beschikbaar-teller wordt in dpStockModels LIVE berekend: hal-voorraad
// minus alle open/betaalde portaal-claims (bucket dealer-requests). We hoeven
// dus niets aan een aparte voorraadtabel te muteren — de claim is impliciet
// zodra de aanvraag met status open/paid in dealer-requests staat, en de
// vrijgave is impliciet zodra hij op expired/canceled/failed
// (allocationReleased) gaat. Dit voorkomt dubbel-reserveren zonder losse
// tellerstaat. Een partner mag ALTIJD reserveren (ook backorder).
function dpSnapshotClaim(model, qty) {
  return { model, requested: Number(qty) || 1, ts: new Date().toISOString() };
}

// POST /dealers/api/reserve  { model, qty, note } — fase 3-fundament:
// reserveringsaanvraag vastleggen + mail naar sales. De Mollie-betaallink
// wordt hier aangehaakt zodra MOLLIE_API_KEY als worker-secret bestaat.
async function dpHandleReserve(request, env, sess, url) {
  let body = {};
  try { body = await request.json(); } catch {}
  const model = String(body.model || "").trim().slice(0, 80);
  const qty = Math.max(1, Math.min(50, parseInt(body.qty, 10) || 1));
  const note = String(body.note || "").slice(0, 1500);
  // Kleurvariant (optioneel): artikelcode uit de catalogus. Bepaalt de
  // Logic4-productregel; valt anders terug op de prijslijst-code.
  const variantCode = String(body.variant || "").trim().slice(0, 20) || null;
  const variantName = String(body.variantName || "").trim().slice(0, 120) || null;
  if (!model) return reply(400, { ok: false, error: "model-required" });
  const data = (await env.FONTEYN_DATA.get("dealer-requests", { type: "json" })) || {};
  if (!Array.isArray(data.requests)) data.requests = [];
  const entry = {
    id: crypto.randomUUID(), ts: new Date().toISOString(),
    email: sess.email, company: sess.company || "",
    model, qty, note, status: "new",
    variant: variantCode, variantName,
  };
  if (variantCode) entry.productCode = variantCode;
  // Volledig betalen (100%) mag ALLEEN als de spa nu op voorraad is (dan wordt
  // hij direct geleverd). Anders altijd 30% aanbetaling. Server-side gecheckt.
  const wantsFull = body.payFull === true;
  let checkoutUrl = null;
  if (env.MOLLIE_API_KEY) {
    const priceData = (await env.FONTEYN_DATA.get("dealer-prices", { type: "json" })) || {};
    const accountsPre = await dpGetAccounts(env);
    const dealerPre = dpFindDealer(accountsPre, sess.email);
    const isUS = String((dealerPre && dealerPre.region) || "").toUpperCase() === "US";
    const debtorId = dealerPre && (dealerPre.debtorIds || [])[0];
    const pEntry = (priceData.prices || {})[model];
    if (pEntry && pEntry.code && !entry.productCode) entry.productCode = String(pEntry.code);
    if (pEntry && Number(pEntry.usd) > 0) {
      // Voorraad-check voor 100%-optie: alleen als vrij ≥ gevraagd aantal.
      const hallen = (await env.FONTEYN_DATA.get("voorraad-hallen", { type: "json" })) || {};
      const beschikbaar = ((hallen.models || {})[model] || {}).available || 0;
      const payFull = wantsFull && beschikbaar >= qty;
      const rate = await dpRate(env);
      const vatPercent = isUS ? 0 : await dpDebtorVatPercent(env, debtorId);   // BTW uit Logic4
      const calc = dpDepositCalc(pEntry, { isUS, qty, rate, vatPercent, fraction: payFull ? 1.0 : 0.30 });
      entry.currency = calc.currency;
      entry.vatPercent = calc.vatPercent;
      entry.payFull = payFull;
      const label = payFull ? "Full payment (in stock)" : "30% deposit";
      const pay = await dpCreateMolliePayment(env, calc.deposit,
        label + " — " + qty + "x " + model + " (" + (sess.company || sess.email) + ")",
        url.origin + "/dealers?paid=1",
        url.origin + "/dealers/webhook",
        { requestId: entry.id }, calc.currency);
      if (pay.ok) {
        entry.deposit = calc.deposit;
        entry.paymentId = pay.id;
        entry.paymentStatus = "open";
        checkoutUrl = pay.checkoutUrl;
        entry.allocation = dpSnapshotClaim(model, qty);
      }
    }
  }
  data.requests.push(entry);
  await env.FONTEYN_DATA.put("dealer-requests", JSON.stringify(data));
  const accounts = await dpGetAccounts(env);
  const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  await dpSendEmail(env, accounts.contactEmail || "gerrit@fonteyn.nl",
    "[Partnerportaal] Reservering: " + qty + "x " + model + " — " + (sess.company || sess.email),
    '<div style="font-family:Arial,sans-serif;">' +
    '<p><b>Nieuwe reserveringsaanvraag via het partnerportaal</b></p>' +
    '<p><b>Dealer:</b> ' + esc(sess.company || "") + ' &lt;' + esc(sess.email) + '&gt;<br>' +
    '<b>Model:</b> ' + esc(model) + '<br><b>Aantal:</b> ' + qty +
    (entry.deposit ? '<br><b>Aanbetaling (30%):</b> ' + (entry.currency === 'USD' ? '$' : '€') + ' ' + entry.deposit.toFixed(2) + ' — Mollie-link naar dealer gestuurd' : '') + '</p>' +
    (note ? '<p style="white-space:pre-wrap;border-left:3px solid #8bc53f;padding-left:12px;">' + esc(note) + '</p>' : '') +
    '<p style="color:#888;font-size:12px;">Ook zichtbaar in de beheertegel Dealerportaal. Reply gaat direct naar de dealer.</p></div>',
    sess.email);
  return reply(200, { ok: true, checkoutUrl: checkoutUrl, deposit: entry.deposit || null, currency: entry.currency || null, payFull: !!entry.payFull });
}

// Fase 3 — Mollie-betaallink (wacht op MOLLIE_API_KEY als worker-secret).
// Zodra de key er is: aanroepen vanuit de reserve-flow met het aanbetalings-
// bedrag, checkoutUrl teruggeven aan het portaal, en een /dealers/webhook
// route toevoegen voor de betaalstatus.
async function dpCreateMolliePayment(env, amount, description, redirectUrl, webhookUrl, metadata, currency) {
  if (!env.MOLLIE_API_KEY) return { ok: false, error: "mollie-not-configured" };
  const payload = {
    amount: { currency: currency || "EUR", value: Number(amount).toFixed(2) },
    description, redirectUrl,
  };
  if (webhookUrl) payload.webhookUrl = webhookUrl;
  if (metadata) payload.metadata = metadata;
  const r = await fetch("https://api.mollie.com/v2/payments", {
    method: "POST",
    headers: { "Authorization": "Bearer " + env.MOLLIE_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) return { ok: false, error: "mollie-http-" + r.status };
  return { ok: true, id: j.id, checkoutUrl: j._links && j._links.checkout && j._links.checkout.href };
}

// POST /dealers/api/setpassword { password } — dealer stelt (of wijzigt) zijn
// eigen wachtwoord; vereist een geldige sessie (eerste keer via magic-link).
async function dpHandleSetPassword(request, env, sess) {
  let body = {};
  try { body = await request.json(); } catch {}
  const password = String(body.password || "");
  if (password.length < 8) return reply(400, { ok: false, error: "min-8-chars" });
  const accounts = await dpGetAccounts(env);
  const dealer = dpFindDealer(accounts, sess.email);
  if (!dealer) return reply(403, { ok: false, error: "unknown-dealer" });
  dealer.pw = await dpHashPassword(password);
  await env.FONTEYN_DATA.put("dealer-accounts", JSON.stringify(accounts));
  console.log("[dp-pw] wachtwoord (opnieuw) ingesteld voor " + sess.email);
  return reply(200, { ok: true });
}

// GET /dealers/api/requests — de eigen reserveringsaanvragen van deze dealer,
// zodat een verzoek na indienen zichtbaar blijft (status: new/paid/…).
async function dpHandleMyRequests(env, sess) {
  const data = (await env.FONTEYN_DATA.get("dealer-requests", { type: "json" })) || {};
  const mine = (Array.isArray(data.requests) ? data.requests : [])
    .filter(r => String(r.email || "").toLowerCase() === String(sess.email || "").toLowerCase())
    .map(r => ({ ts: r.ts, model: r.model, qty: r.qty, status: r.status,
                 deposit: r.deposit || null, currency: r.currency || null, paymentStatus: r.paymentStatus || null }))
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  return reply(200, { ok: true, requests: mine });
}

// GET /dealers/api/docs — losse links (docs) + documentbibliotheek (library:
// categorieën → mappen → bestanden; gevuld via tools/dp-upload-docs.mjs)
async function dpHandleDocs(env) {
  const data = await env.FONTEYN_DATA.get("dealer-docs", { type: "json" });
  const docs = (data && data.docs) || [];
  const library = (data && data.library) || null;
  return reply(200, { ok: true, docs, library });
}

// ─── Documentbibliotheek: bestanden in KV ────────────────────────────
// Elk bestand is een losse KV-key dpfile:<id> (binair). De mappenboom staat
// in bucket dealer-docs onder 'library'. Upload alleen met de beheersleutel;
// download alleen met een geldige dealer-sessie. Max 24 MB (KV-limiet 25).
const DP_FILE_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
};

function dpFileId(url) {
  const id = (url.searchParams.get("id") || "").toLowerCase();
  return /^[a-z0-9/_.\- ()&]{3,200}$/.test(id) && !id.includes("..") ? id : null;
}

// PUT /dealers/admin/file?id=<pad/naam.pdf>  (X-DP-Admin, body = binair)
async function dpAdminPutFile(request, env, url) {
  const id = dpFileId(url);
  if (!id) return reply(400, { ok: false, error: "bad-id" });
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return reply(400, { ok: false, error: "empty-body" });
  if (buf.byteLength > 24 * 1024 * 1024) return reply(413, { ok: false, error: "max-24mb" });
  await env.FONTEYN_DATA.put("dpfile:" + id, buf);
  return reply(200, { ok: true, id, bytes: buf.byteLength });
}

// GET /dealers/api/file?id=… (dealer-sessie vereist — afgedwongen in de router)
async function dpServeFile(env, url) {
  const id = dpFileId(url);
  if (!id) return reply(400, { ok: false, error: "bad-id" });
  const buf = await env.FONTEYN_DATA.get("dpfile:" + id, { type: "arrayBuffer" });
  if (!buf) return reply(404, { ok: false, error: "not-found" });
  const ext = id.split(".").pop();
  const name = id.split("/").pop().replace(/"/g, "");
  return new Response(buf, { headers: {
    "Content-Type": DP_FILE_TYPES[ext] || "application/octet-stream",
    "Content-Disposition": 'inline; filename="' + name + '"',
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    ...corsHeaders,
  } });
}

// POST /dealers/api/vraag  { subject, message } — mail naar sales
async function dpHandleVraag(request, env, sess) {
  let body = {};
  try { body = await request.json(); } catch {}
  const subject = String(body.subject || "").slice(0, 150);
  const message = String(body.message || "").slice(0, 4000);
  if (!subject.trim() || !message.trim()) return reply(400, { ok: false, error: "subject-and-message-required" });
  const accounts = await dpGetAccounts(env);
  const to = accounts.contactEmail || "gerrit@fonteyn.nl";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sent = await dpSendEmail(env, to,
    "[Partnerportaal] " + subject + " — " + (sess.company || sess.email),
    '<div style="font-family:Arial,sans-serif;">' +
    '<p><b>Dealer:</b> ' + esc(sess.company || "") + ' &lt;' + esc(sess.email) + '&gt;</p>' +
    '<p><b>Onderwerp:</b> ' + esc(subject) + '</p>' +
    '<p style="white-space:pre-wrap;border-left:3px solid #8bc53f;padding-left:12px;">' + esc(message) + '</p>' +
    '<p style="color:#888;font-size:12px;">Beantwoord deze mail — reply gaat direct naar de dealer.</p></div>',
    sess.email);
  return reply(sent.ok ? 200 : 502, { ok: sent.ok });
}

// GET /dealers → portaalpagina vers van GitHub main (cache ≤10s)
async function dpHandlePage(env) {
  const cb = Math.floor(Date.now() / 10000);
  const r = await fetch(
    "https://raw.githubusercontent.com/gerritgmulder/douanepapieren-data/main/dealerportal.html?cb=" + cb,
    { cf: { cacheTtl: 10, cacheEverything: true } }
  );
  if (!r.ok) {
    return new Response("Portal temporarily unavailable — please try again in a minute.", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
  const html = await r.text();
  // SAFETY: strikte security-headers op de publieke portaalpagina.
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://raw.githubusercontent.com; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "X-Robots-Tag": "noindex, nofollow",
  } });
}

// ─── Logic4-order aanmaken na betaalde aanbetaling ───────────────────
// Endpoint GEVERIFIEERD (9 jul 2026, via validatie-probes): POST
// /v3/Orders/AddUpdateOrder — vereist minimaal OrderStatus + debiteur.
// Auth: fonteynbot (LOGIC4_USERNAME/PASSWORD als worker-secrets).
let _l4tok = null;
async function l4Token(env) {
  if (_l4tok && Date.now() < _l4tok.exp - 60000) return _l4tok.t;
  const f = new URLSearchParams();
  f.set("client_id", l4enc(env.LOGIC4_PUBLICKEY) + " " + l4enc(env.LOGIC4_COMPANYKEY) + " " + l4enc(env.LOGIC4_USERNAME));
  f.set("client_secret", l4enc(env.LOGIC4_SECRETKEY) + " " + l4enc(env.LOGIC4_PASSWORD));
  f.set("scope", "api administration." + l4enc(env.LOGIC4_ADMINISTRATION || "1"));
  f.set("grant_type", "client_credentials");
  const r = await fetch("https://idp.logic4server.nl/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: f.toString() });
  const j = await r.json().catch(() => null);
  if (!j || !j.access_token) throw new Error("logic4-token-failed (" + r.status + ")");
  _l4tok = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

// Maakt de verkooporder (status 25 = 30% aanbetaald) onder het debiteur-
// nummer van de dealer. Prijzen-bucket mag per model een object zijn
// ({price, code}) of een kaal getal (alleen prijs, regel zonder artikelcode).
async function dpCreateLogic4Order(env, opts) {
  if (!env.LOGIC4_USERNAME || !env.LOGIC4_PASSWORD) return { ok: false, error: "logic4-user-not-configured" };
  const token = await l4Token(env);
  const payload = {
    OrderStatus: { Id: opts.statusId || 25 },        // 25=30% aanbetaald · 30=volledig betaald
    DebtorId: Number(opts.debtorId),
    // VERPLICHT veld — ontbreken hiervan geeft een 500 (geen validatiefout!)
    CreationDate: new Date().toISOString().slice(0, 19),
    Reference: opts.reference || "",
    Notes: opts.remarks || "",
    // Regel zonder ProductCode laat Logic4 óók met een 500 crashen — dus:
    // mét artikelcode een echte productregel, zonder code een regel-loze
    // order (model/aantal staan in Notes; sales vult de regel aan).
    OrderRows: opts.productCode
      ? [{ ProductCode: String(opts.productCode), Description: opts.description, Qty: Number(opts.qty) || 1 }]
      : [],
  };
  if (!opts.productCode) payload.Notes = "LET OP: regel handmatig toevoegen — " + opts.description + "\n" + (opts.remarks || "");
  const r = await fetch("https://api.logic4server.nl/v3/Orders/AddUpdateOrder", {
    method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch {}
  if (!r.ok) {
    console.log("[dp-logic4] order faalde HTTP " + r.status + ": " + txt.slice(0, 300));
    return { ok: false, error: "HTTP " + r.status + " — " + ((j && (j.detail || j.title)) || txt.slice(0, 200)) };
  }
  // Logic4 geeft het nieuwe ordernummer terug als kaal getal ("3517369")
  const orderId = (typeof j === "number" && j) || (j && (j.Id || (j.Value && j.Value.Id))) || null;
  console.log("[dp-logic4] order aangemaakt: " + orderId + " (debiteur " + opts.debtorId + ")");
  return { ok: true, orderId, raw: orderId ? undefined : txt.slice(0, 300) };
}

// Registreer een (aan)betaling op een BESTAANDE Logic4-order (particulier/
// showroom). Dagboek Mollie=42, MatchingLedgerId=78 (vooruitontvangen) — zie
// de Logic4/Optivaize-afspraken. Zet de order daarna op 30% aanbetaald (25).
async function dpRegisterPayment(env, orderId, amountEur, mollieId) {
  const token = await l4Token(env);
  const pay = await fetch("https://api.logic4server.nl/v3/Orders/AddPayment", {
    method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      OrderId: Number(orderId), AmountIncl: Number(amountEur),
      Description: "30% aanbetaling via dashboard (Mollie " + mollieId + ")",
      BookingId: 42, MatchingLedgerId: 78,
    }),
  });
  if (!pay.ok) return { ok: false, error: "AddPayment HTTP " + pay.status + " — " + (await pay.text()).slice(0, 200) };
  // Status → 30% aanbetaald
  await fetch("https://api.logic4server.nl/v3/Orders/UpdateOrderStatus", {
    method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ OrderId: Number(orderId), StatusId: 25 }),
  }).catch(() => {});
  console.log("[dp-logic4] betaling geregistreerd op order " + orderId);
  return { ok: true };
}

// POST /dealers/admin/reserve-for — Chantal reserveert intern voor een partner
// of particulier. Maakt een Mollie-aanbetalingslink en MAILT die (i.p.v.
// meteen betalen). Body:
//   { model, qty, variant?, variantName?, note?, custType:'partner'|'particulier',
//     email, debtorId?, existingOrderId? }
// - partner: email = partner-adres; order wordt ná betaling aangemaakt.
// - particulier: existingOrderId = de bestaande Logic4-order; email wordt uit
//   Logic4 gelezen als niet meegegeven; ná betaling wordt AddPayment gedaan.
async function dpAdminReserveFor(request, env, url) {
  let b = {};
  try { b = await request.json(); } catch {}
  const model = String(b.model || "").trim().slice(0, 80);
  const qty = Math.max(1, Math.min(50, parseInt(b.qty, 10) || 1));
  const custType = b.custType === "particulier" ? "particulier" : "partner";
  if (!model) return reply(400, { ok: false, error: "model-required" });
  if (!env.MOLLIE_API_KEY) return reply(503, { ok: false, error: "mollie-not-configured" });

  // E-mail bepalen. Particulier zonder e-mail → uit de Logic4-order lezen.
  let email = String(b.email || "").trim().toLowerCase();
  let debtorId = b.debtorId || null;
  const existingOrderId = custType === "particulier" ? (parseInt(b.existingOrderId, 10) || null) : null;
  if (custType === "particulier" && existingOrderId && (!email || !debtorId)) {
    try {
      const token = await l4Token(env);
      const or = await fetch("https://api.logic4server.nl/v3/Orders/GetOrders", {
        method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ Id: existingOrderId, TakeRecords: 1 }),
      });
      const oj = await or.json().catch(() => null);
      const o = Array.isArray(oj) ? oj[0] : (oj && (oj.Orders || [])[0]);
      if (o) {
        debtorId = debtorId || o.DebtorId;
        const addr = o.InvoiceAddress || o.AccountAddress || {};
        email = email || String(addr.Email || addr.EmailAddress || "").toLowerCase();
      }
    } catch (e) { /* val terug op meegegeven e-mail */ }
  }
  if (!email || !email.includes("@")) return reply(400, { ok: false, error: "email-required (kon niet uit Logic4 lezen)" });

  // Prijs + valuta: particulier = altijd EUR (NL-showroom); partner = regio.
  // BTW uit Logic4 per debiteur (particulier: uit de order; partner: account).
  const priceData = (await env.FONTEYN_DATA.get("dealer-prices", { type: "json" })) || {};
  const pEntry = (priceData.prices || {})[model];
  if (!(pEntry && Number(pEntry.usd) > 0)) return reply(400, { ok: false, error: "geen prijs voor " + model });
  const accounts = await dpGetAccounts(env);
  const dealer = dpFindDealer(accounts, email);
  const isUS = custType === "partner" && String((dealer && dealer.region) || "").toUpperCase() === "US";
  const rate = await dpRate(env);
  const vatPercent = isUS ? 0 : await dpDebtorVatPercent(env, debtorId || (dealer && (dealer.debtorIds || [])[0]));
  const calc = dpDepositCalc(pEntry, { isUS, qty, rate, vatPercent });
  const { currency, deposit } = calc;

  const data = (await env.FONTEYN_DATA.get("dealer-requests", { type: "json" })) || {};
  if (!Array.isArray(data.requests)) data.requests = [];
  const entry = {
    id: crypto.randomUUID(), ts: new Date().toISOString(),
    email, targetEmail: email, company: (dealer && dealer.company) || "", model, qty,
    variant: b.variant || null, variantName: b.variantName || null,
    productCode: b.variant || (pEntry.code || null),
    note: String(b.note || "").slice(0, 1500), status: "new",
    adminInitiated: true, custType, debtorId, existingOrderId,
    currency, deposit, vatPercent: calc.vatPercent, paymentStatus: "open",
  };
  const pay = await dpCreateMolliePayment(env, deposit,
    "30% deposit — " + qty + "x " + model + (entry.company ? " (" + entry.company + ")" : ""),
    url.origin + "/dealers?paid=1", url.origin + "/dealers/webhook",
    { requestId: entry.id }, currency);
  if (!pay.ok) return reply(502, { ok: false, error: pay.error || "mollie-failed" });
  entry.paymentId = pay.id;
  data.requests.push(entry);
  await env.FONTEYN_DATA.put("dealer-requests", JSON.stringify(data));

  // Mail met aanbetalingsverzoek + link naar de partner/particulier
  const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sym = currency === "USD" ? "$" : "€";
  const sent = await dpSendEmail(env, email,
    "Aanbetalingsverzoek Fonteyn — " + qty + "x " + model,
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">' +
    '<h2 style="color:#c8102e;">Passion Spas</h2>' +
    '<p>Beste ' + (entry.company || "klant") + ',</p>' +
    '<p>Voor uw reservering van <b>' + qty + '&times; ' + esc(model) + '</b>' + (entry.variantName ? ' (' + esc(entry.variantName) + ')' : '') +
    ' staat een aanbetaling van <b>' + sym + ' ' + deposit.toFixed(2) + '</b> (30%) klaar.</p>' +
    '<p style="margin:26px 0;"><a href="' + pay.checkoutUrl + '" style="background:#c8102e;color:#fff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:10px;display:inline-block;">Aanbetaling voldoen</a></p>' +
    '<p style="color:#888;font-size:12px;">Na ontvangst bevestigen wij uw reservering. Vragen? Beantwoord deze e-mail.</p></div>',
    (accounts.contactEmail || undefined));
  return reply(200, { ok: true, deposit, currency, emailedTo: email, mailSent: sent.ok, checkoutUrl: pay.checkoutUrl });
}

// POST /dealers/admin/testorder { debtorId, model, qty, productCode? } —
// gecontroleerde proeforder (X-DP-Admin) voor de livegang-test. Maakt een
// ECHTE order aan; alleen gebruiken met een debiteurnummer dat daarna in
// Logic4 opgeruimd/geannuleerd wordt.
async function dpAdminTestOrder(request, env) {
  let b = {};
  try { b = await request.json(); } catch {}
  if (!b.debtorId) return reply(400, { ok: false, error: "debtorId-required" });
  const res = await dpCreateLogic4Order(env, {
    debtorId: b.debtorId, qty: b.qty || 1, productCode: b.productCode || null,
    reference: "DP-TEST",
    remarks: "PROEFORDER dealerportaal — mag geannuleerd worden",
    description: (b.qty || 1) + "x " + (b.model || "Testmodel") + " — proeforder partnerportaal (niet uitleveren)",
  }).catch(e => ({ ok: false, error: String(e.message || e) }));
  return reply(res.ok ? 200 : 502, res);
}

// POST /dealers/webhook — Mollie betaalstatus (fase 3). Mollie stuurt alleen
// een payment-id (form-encoded); wij halen de status server-side op en werken
// de bijbehorende reserveringsaanvraag bij (koppeling via metadata.requestId
// die we bij het aanmaken van de betaling meegeven). Altijd 200 antwoorden —
// anders blijft Mollie eindeloos retryen.
async function dpHandleMollieWebhook(request, env) {
  if (!env.MOLLIE_API_KEY) return reply(200, { ok: true });   // nog niet actief
  let id = "";
  try { id = new URLSearchParams(await request.text()).get("id") || ""; } catch {}
  if (!id) return reply(200, { ok: true });
  const r = await fetch("https://api.mollie.com/v2/payments/" + encodeURIComponent(id), {
    headers: { "Authorization": "Bearer " + env.MOLLIE_API_KEY },
  });
  const p = await r.json().catch(() => null);
  if (!r.ok || !p) return reply(200, { ok: true });
  const reqId = p.metadata && p.metadata.requestId;
  if (reqId) {
    const data = (await env.FONTEYN_DATA.get("dealer-requests", { type: "json" })) || {};
    const list = Array.isArray(data.requests) ? data.requests : [];
    const item = list.find(x => x.id === reqId);
    if (item) {
      item.paymentId = p.id;
      item.paymentStatus = p.status;   // paid / open / failed / expired / canceled
      if (p.status === "paid") item.status = "paid";
      // Betaling niet doorgegaan → geclaimde voorraad weer vrijgeven
      // Betaling niet doorgegaan → claim vervalt (available telt 'm niet meer mee)
      if (["expired", "canceled", "failed"].includes(p.status)) item.allocationReleased = true;
      // Aanbetaling binnen → Logic4 bijwerken. Twee gevallen:
      //  A) particulier / bestaande order (existingOrderId): de order stáát al
      //     in Logic4 (showroomverkoop) → alleen de 30%-betaling registreren
      //     (AddPayment, dagboek Mollie=42, MatchingLedger 78) + status → 25.
      //  B) partner: order bestaat nog niet → aanmaken (status 25) onder het
      //     debiteurnummer van de partner. Idempotent: nooit dubbel.
      if (p.status === "paid" && !item.logic4OrderId && !item.logic4PaidRegistered) {
        try {
          if (item.existingOrderId) {
            const res = await dpRegisterPayment(env, item.existingOrderId, item.deposit || 0, p.id);
            if (res.ok) { item.logic4PaidRegistered = true; item.logic4OrderId = item.existingOrderId; delete item.logic4Error; }
            else item.logic4Error = res.error;
          } else {
            const accounts = await dpGetAccounts(env);
            const dealer = dpFindDealer(accounts, item.targetEmail || item.email);
            const debtorId = item.debtorId || (dealer && (dealer.debtorIds || [])[0]);
            if (!debtorId) {
              item.logic4Error = "geen debtorId gekoppeld aan " + (item.targetEmail || item.email);
            } else {
              const sym = item.currency === "USD" ? "$" : "€";
              const bedragTxt = item.payFull ? "volledig betaald" : "30% aanbetaald";
              const res = await dpCreateLogic4Order(env, {
                debtorId, qty: item.qty, productCode: item.productCode || null,
                statusId: item.payFull ? 30 : 25,        // 30 = volledig betaald, vrijgeven leveren
                reference: "DP-" + String(item.id).slice(0, 8),
                remarks: "Partnerportaal-reservering — " + bedragTxt + ": " + sym + " " + (item.deposit || 0).toFixed(2) + " (Mollie " + p.id + ")" + (item.note ? "\nNotitie: " + item.note : ""),
                description: item.qty + "x " + item.model + " — partnerportaal (" + bedragTxt + " via Mollie)",
              });
              if (res.ok) { item.logic4OrderId = res.orderId; delete item.logic4Error; }
              else item.logic4Error = res.error;
            }
          }
        } catch (e) { item.logic4Error = String(e.message || e); }
      }
      await env.FONTEYN_DATA.put("dealer-requests", JSON.stringify(data));
    }
  }
  console.log("[dp-mollie] webhook " + id + " status=" + p.status);
  return reply(200, { ok: true });
}

// ─── Admin-endpoints (alleen interne beheertegel, X-Fonteyn-Auth) ─────
// mailstatus: Resend-bezorgstatus opvragen (delivered/bounced/…) voor
// diagnose van niet-aangekomen mails. loginlink: magic-link genereren
// ZONDER e-mail — kopieerbaar, voor als de mail van een dealer (of Outlook)
// niet meewerkt. Zelfde geldigheid als de mail-link (15 min, eenmalig).
// SAFETY: de interne SHARED_SECRET staat in de tegel-HTML van een PUBLIEKE
// repo en is dus als gelekt te beschouwen. Alles wat dealers raakt vereist
// daarom een APARTE beheersleutel (DP_ADMIN_KEY, alleen als worker-secret +
// eenmalig per beheerder-computer ingevoerd in de beheertegel).
function dpIsAdmin(request, env) {
  const h = request.headers.get("X-DP-Admin") || "";
  return !!env.DP_ADMIN_KEY && h === env.DP_ADMIN_KEY;
}

async function dpAdminMailStatus(env, url) {
  const id = url.searchParams.get("id") || "";
  if (!id) return reply(400, { ok: false, error: "id-required" });
  const r = await fetch("https://api.resend.com/emails/" + encodeURIComponent(id), {
    headers: { "Authorization": "Bearer " + env.RESEND_API_KEY },
  });
  const j = await r.json().catch(() => null);
  return reply(r.ok ? 200 : 502, { ok: r.ok, status: r.status, mail: j });
}

async function dpAdminLoginLink(request, env, url) {
  let body = {};
  try { body = await request.json(); } catch {}
  const email = String(body.email || "").trim().toLowerCase();
  const accounts = await dpGetAccounts(env);
  const dealer = dpFindDealer(accounts, email);
  if (!dealer) return reply(404, { ok: false, error: "geen actieve dealer met dit e-mailadres" });
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  await env.FONTEYN_DATA.put("dp-login:" + token, JSON.stringify({ email, company: dealer.company || "" }), { expirationTtl: DP_LOGIN_TTL });
  return reply(200, { ok: true, link: url.origin + "/dealers/auth?t=" + token, validMinutes: 15 });
}

async function handleDealerRoutes(request, env, url) {
  const p = url.pathname.replace(/\/+$/, "");
  if (p === "/dealers" && request.method === "GET") return dpHandlePage(env);
  if (p === "/dealers/login" && request.method === "POST") return dpHandleLogin(request, env, url);
  if (p === "/dealers/auth" && request.method === "GET") return dpHandleAuth(request, env, url);

  if (p === "/dealers/webhook" && request.method === "POST") return dpHandleMollieWebhook(request, env);

  // Admin (interne beheertegel, shared secret — géén dealer-sessie)
  if (p.startsWith("/dealers/admin/")) {
    if (!dpIsAdmin(request, env)) return reply(401, { ok: false, error: "unauthorized" });
    if (p === "/dealers/admin/mailstatus" && request.method === "GET") return dpAdminMailStatus(env, url);
    if (p === "/dealers/admin/loginlink" && request.method === "POST") return dpAdminLoginLink(request, env, url);
    if (p === "/dealers/admin/file" && request.method === "PUT") return dpAdminPutFile(request, env, url);
    if (p === "/dealers/admin/testorder" && request.method === "POST") return dpAdminTestOrder(request, env);
    if (p === "/dealers/admin/reserve-for" && request.method === "POST") return dpAdminReserveFor(request, env, url);
    if (p === "/dealers/admin/refresh-stock" && request.method === "POST") return reply(200, await dpRefreshHalStock(env).catch(e => ({ ok: false, error: String(e.message || e) })));
    if (p === "/dealers/admin/refresh-reserveringen" && request.method === "POST") return reply(200, await dpRefreshReservations(env).catch(e => ({ ok: false, error: String(e.message || e) })));
    return reply(404, "Not found");
  }

  // Alles hieronder vereist een geldige dealer-sessie
  if (p.startsWith("/dealers/api/")) {
    const sess = await dpSession(env, request);
    if (!sess) return reply(401, { ok: false, error: "not-logged-in" });
    if (p === "/dealers/api/me" && request.method === "GET") {
      const accounts = await dpGetAccounts(env);
      const dealer = dpFindDealer(accounts, sess.email);
      return reply(200, { ok: true, email: sess.email, company: sess.company || "",
        hasPassword: !!(dealer && dealer.pw),
        region: (dealer && dealer.region) || "EU" });
    }
    if (p === "/dealers/api/setpassword" && request.method === "POST") return dpHandleSetPassword(request, env, sess);
    if (p === "/dealers/api/logout" && request.method === "POST") {
      // Sessie ook server-side weggooien — localStorage wissen alleen liet
      // het token 30 dagen bruikbaar in KV staan.
      const tok = request.headers.get("X-Dealer-Session") || "";
      if (tok) await env.FONTEYN_DATA.delete("dp-sess:" + tok);
      return reply(200, { ok: true });
    }
    if (p === "/dealers/api/stock" && request.method === "GET") return dpHandleStock(env);
    if (p === "/dealers/api/myspas" && request.method === "GET") return dpHandleMySpas(env, sess);
    if (p === "/dealers/api/requests" && request.method === "GET") return dpHandleMyRequests(env, sess);
    if (p === "/dealers/api/reserve" && request.method === "POST") return dpHandleReserve(request, env, sess, url);
    if (p === "/dealers/api/docs" && request.method === "GET") return dpHandleDocs(env);
    if (p === "/dealers/api/file" && request.method === "GET") return dpServeFile(env, url);
    if (p === "/dealers/api/vraag" && request.method === "POST") return dpHandleVraag(request, env, sess);
  }
  return reply(404, "Not found");
}

// ─── Team-sleutel automatisch uitdelen aan ingelogde medewerkers ─────
// POST /internal/teamkey { username, password } — verifieert de Logic4-login
// (zelfde token-request als de Electron-helper) en geeft bij succes de
// team-sleutel terug. Zo krijgt élke medewerker de sleutel ONZICHTBAAR bij
// het normale inloggen: niemand hoeft iets in te vullen. De toegangsdrempel
// is exact gelijk aan de app zelf (geldige Logic4-inlog vereist); het
// wachtwoord wordt alleen doorgegeven aan Logic4's IDP en nergens opgeslagen.
function l4enc(v) { return String(v).replace(/_/g, "__").replace(/ /g, "_"); }

async function handleTeamKey(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) return reply(400, { ok: false, error: "credentials-required" });
  // Zonder rem is dit endpoint een open brute-force-proxy richting Logic4's
  // IDP (met de teamsleutel als prijs). 10 pogingen per kwartier per IP is
  // ruim voor legitiem gebruik (1 poging per login).
  if (await rateLimited(env, request, "teamkey", 10, 900)) {
    return reply(429, { ok: false, error: "too-many-attempts" });
  }
  if (!env.LOGIC4_PUBLICKEY || !env.LOGIC4_SECRETKEY || !env.LOGIC4_COMPANYKEY) {
    return reply(503, { ok: false, error: "logic4-not-configured" });
  }
  const form = new URLSearchParams();
  form.set("client_id", l4enc(env.LOGIC4_PUBLICKEY) + " " + l4enc(env.LOGIC4_COMPANYKEY) + " " + l4enc(username));
  form.set("client_secret", l4enc(env.LOGIC4_SECRETKEY) + " " + l4enc(password));
  form.set("scope", "api administration." + l4enc(env.LOGIC4_ADMINISTRATION || "1"));
  form.set("grant_type", "client_credentials");
  const r = await fetch("https://idp.logic4server.nl/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!r.ok) {
    console.log("[teamkey] Logic4-verificatie faalde voor " + username + " (HTTP " + r.status + ")");
    return reply(401, { ok: false, error: "logic4-login-failed" });
  }
  const j = await r.json().catch(() => null);
  if (!j || !j.access_token) return reply(401, { ok: false, error: "logic4-login-failed" });
  console.log("[teamkey] uitgegeven aan " + username);
  return reply(200, { ok: true, teamkey: env.SHARED_SECRET });
}

// ─── Uur-sync (Cloudflare Cron) ──────────────────────────────────────
// Ververst elk uur de vrije hal-voorraad uit Logic4 (warehouse "Fonteyn")
// zodat het Partnerportaal altijd actueel is zonder handmatig een script te
// draaien. Nieuwe aanbetalingen/verkopen wijzigen de reserveringen in Logic4
// → de vrije voorraad verschuift → hier automatisch opgepikt.
async function dpRefreshHalStock(env) {
  const catalog = (await env.FONTEYN_DATA.get("spa-catalog", { type: "json" })) || {};
  const codeToModel = {};
  for (const [model, variants] of Object.entries(catalog.models || {}))
    for (const v of variants) codeToModel[v.code] = model;
  if (!Object.keys(codeToModel).length) return { ok: false, error: "geen catalogus" };

  const token = await l4Token(env);
  const perModel = {};   // model → { available, physical, variants }
  const PAGE = 5000;
  for (let page = 0; page < 20; page++) {
    const r = await fetch("https://api.logic4server.nl/v3/Stock/GetStockForWarehouses", {
      method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ WareHouseId: 21, TakeRecords: PAGE, SkipRecords: page * PAGE }),
    });
    if (!r.ok) break;
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      const model = codeToModel[String(row.ProductCode || "")];
      if (!model) continue;
      const free = Math.max(0, Number(row.FreeStock) || 0);
      const qty = Number(row.Qty) || 0;
      if (!perModel[model]) perModel[model] = { available: 0, physical: 0, variants: {} };
      perModel[model].available += free;
      perModel[model].physical += qty;
      if (free > 0) perModel[model].variants[String(row.ProductCode)] = free;
    }
    if (rows.length < PAGE) break;
  }
  await env.FONTEYN_DATA.put("voorraad-hallen", JSON.stringify({
    updated: new Date().toISOString(), warehouse: "Fonteyn (hallen F/K)",
    basis: "vrije voorraad (fysiek − verkocht/gereserveerd), per kleur afgekapt op 0", models: perModel,
  }));
  return { ok: true, models: Object.keys(perModel).length };
}

// Reserveringen-ledger: élke openstaande Logic4-order met een spa is een
// reservering. Statussen: 15 = wachten op 30% aanbetaling, 25 = 30% aanbetaald,
// 1 = verkooporder (uitgeleverde orders staan op 3 = Afgehandeld en vallen dus
// vanzelf weg). MAGAZIJN is bepalend (staat per orderregel, WarehouseId):
//   21 = Fonteyn         → echte NL-reservering (uit Fonteyn-voorraad)
//   27 = Dealer magazijn → containerorder (gaat rechtstreeks naar de dealer)
//   50 = Warehouse Texas → Amerika (apart, telt NIET mee voor NL)
// 'betaald' komt uit de ECHTE betaling (Totals.Calc_TotalPayed), niet uit de
// status — een order kan op 'wachten' staan terwijl er al geld binnen is.
const DP_RESV_STATUSES = [15, 25, 1];
const WH_NAMES = { 19: "Geen", 20: "OUD Kelder", 21: "Fonteyn", 25: "Showroommodel", 26: "Outlet", 27: "Dealer magazijn", 49: "Derving", 50: "Warehouse Texas USA", 51: "Transporteur", 52: "Retouren" };
const WH_TEXAS = 50, WH_DEALER = 27;
// Kleur = het stuk ná de '|' in de regelomschrijving ("Relax Spa | Sterling White with Grey").
function dpRowColor(desc) {
  const s = String(desc || "");
  const i = s.indexOf("|");
  if (i < 0) return null;
  return s.slice(i + 1).replace(/\b(spa|swimspa)\b/gi, "").replace(/\s+/g, " ").trim() || null;
}
async function dpRefreshReservations(env) {
  const catalog = (await env.FONTEYN_DATA.get("spa-catalog", { type: "json" })) || {};
  const codeToModel = {};
  for (const [model, variants] of Object.entries(catalog.models || {}))
    for (const v of variants) codeToModel[v.code] = model;
  // partner/particulier: dealer-accounts (debtorIds) + klantType-hint uit 'voorraad'
  const accounts = await dpGetAccounts(env);
  const partnerDebtors = new Set();
  for (const d of (accounts.dealers || [])) for (const id of (d.debtorIds || [])) partnerDebtors.add(String(id));
  const voorraad = (await env.FONTEYN_DATA.get("voorraad", { type: "json" })) || {};
  const klantType = voorraad.klantType || {};

  const token = await l4Token(env);
  const fromIso = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 19);
  const byModel = {};      // NL (magazijn ≠ Texas): { model: [lijnen] }
  const byModelUSA = {};   // Amerika (magazijn 50)
  const statusName = { 15: "wachten op aanbetaling", 25: "30% aanbetaald", 1: "verkooporder" };
  for (const st of DP_RESV_STATUSES) {
    for (let page = 0; page < 8; page++) {
      const r = await fetch("https://api.logic4server.nl/v3/Orders/GetOrders", {
        method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ StatusId: st, CreationDateFrom: fromIso, TakeRecords: 500, SkipRecords: page * 500 }),
      });
      if (!r.ok) break;
      const data = await r.json().catch(() => []);
      const arr = Array.isArray(data) ? data : ((data && data.Orders) || []);
      if (!arr.length) break;
      for (const o of arr) {
        // Betaling uit de order-totalen (niet uit de status): het echte %.
        const T = o.Totals || {};
        const totaal = Number(T.AmountIncl) || 0;
        const aanbetaling = Number(T.Calc_TotalPayed) || 0;
        const betaaldPct = totaal > 0 ? Math.round((aanbetaling / totaal) * 100) : 0;
        const betaald = !!T.IsPaid || aanbetaling > 0;   // er is écht geld binnen
        const dId = String(o.DebtorId);
        const company = (o.InvoiceAddress && o.InvoiceAddress.CompanyName) || (o.AccountAddress && o.AccountAddress.CompanyName) || "";
        const type = partnerDebtors.has(dId) ? "partner"
          : (klantType[dId] === "dealer" ? "partner"
            : (company.trim() ? "zakelijk" : "particulier"));
        const naam = company.trim() || (o.InvoiceAddress && o.InvoiceAddress.ContactName) || ("Debiteur " + o.DebtorId);
        // Regels groeperen per model+kleur+magazijn binnen deze order.
        const groups = {};
        for (const row of (o.OrderRows || [])) {
          const model = codeToModel[String(row.ProductCode || "")];
          if (!model) continue;
          const undelivered = (Number(row.Qty) || 0) - (Number(row.QtyDeliverd) || 0);
          if (undelivered <= 0) continue;
          const wh = Number(row.WarehouseId) || 0;
          const kleur = dpRowColor(row.Description);
          const key = model + "||" + (kleur || "") + "||" + wh;
          (groups[key] = groups[key] || { model, kleur, wh, qty: 0 }).qty += undelivered;
        }
        for (const gkey of Object.keys(groups)) {
          const gr = groups[gkey];
          const usa = gr.wh === WH_TEXAS;
          const container = gr.wh === WH_DEALER || gr.qty > 2;   // >2 stuks of Dealer magazijn = containerverdenking
          const line = {
            ordernr: o.Id, debtorId: o.DebtorId, naam, type,
            model: gr.model, kleur: gr.kleur || null, qty: gr.qty,
            warehouseId: gr.wh, magazijn: WH_NAMES[gr.wh] || ("magazijn " + gr.wh),
            container, regio: usa ? "USA" : "NL",
            datum: String(o.CreationDate).slice(0, 10), statusId: st, status: statusName[st] || String(st),
            betaald, betaaldPct, aanbetaling: Math.round(aanbetaling), totaal: Math.round(totaal),
          };
          const bucket = usa ? byModelUSA : byModel;
          (bucket[gr.model] = bucket[gr.model] || []).push(line);
        }
      }
      if (arr.length < 500) break;
    }
  }
  // Sorteren: betaald eerst, dan op datum
  const srt = (a, b) => (b.betaald - a.betaald) || String(a.datum).localeCompare(String(b.datum));
  for (const list of Object.values(byModel)) list.sort(srt);
  for (const list of Object.values(byModelUSA)) list.sort(srt);

  // ── Leverforecast: wijs elke actieve reservering toe aan de eerstvolgende
  // voorraad. Voorraadstroom per model: eerst wat NU in de hal vrij is, dan de
  // schepen op ETA-volgorde. Elke reservering krijgt een 'verwacht':
  //   "voorraad" = nu leverbaar · <ISO-datum> = met dat schip (ETA) ·
  //   "op-schip" = op een schip zonder ETA · "productie" = na de bekende schepen.
  const hallen = (await env.FONTEYN_DATA.get("voorraad-hallen", { type: "json" })) || {};
  const schepen = (await env.FONTEYN_DATA.get("voorraad-schepen", { type: "json" })) || {};
  const shipsByModel = {};
  for (const s of (schepen.ships || [])) {
    for (const [model, q] of Object.entries(s.models || {})) {
      (shipsByModel[model] = shipsByModel[model] || []).push({ eta: s.eta || null, qty: Number(q) || 0, vessel: s.vessel || "" });
    }
  }
  for (const [model, list] of Object.entries(byModel)) {
    const buckets = [];
    const hal = ((hallen.models || {})[model] || {}).available || 0;
    if (hal > 0) buckets.push({ kind: "voorraad", eta: null, left: hal });
    (shipsByModel[model] || [])
      .sort((a, b) => String(a.eta || "9999").localeCompare(String(b.eta || "9999")))
      .forEach(sh => buckets.push({ kind: sh.eta ? "schip" : "op-schip", eta: sh.eta, left: sh.qty, vessel: sh.vessel }));
    let bi = 0;
    for (const r of list) {
      // Containerorders (Dealer magazijn) gaan rechtstreeks naar de dealer en
      // trekken NIET uit de Fonteyn-voorraad — die krijgen 'dealer-direct'.
      if (r.container && r.warehouseId === WH_DEALER) { r.verwacht = "dealer-direct"; continue; }
      let need = r.qty, landing = null;
      while (need > 0 && bi < buckets.length) {
        const take = Math.min(need, buckets[bi].left);
        buckets[bi].left -= take; need -= take; landing = buckets[bi];
        if (buckets[bi].left <= 0) bi++;
      }
      // 'verwacht' = waar de LAATSTE unit van deze order landt (hele order pas dan compleet)
      r.verwacht = need > 0 ? "productie" : (landing.kind === "voorraad" ? "voorraad" : (landing.eta || "op-schip"));
      if (landing && landing.vessel) r.verwachtSchip = landing.vessel;
    }
  }

  await env.FONTEYN_DATA.put("reserveringen-live", JSON.stringify({ updated: new Date().toISOString(), byModel, byModelUSA }));
  const total = Object.values(byModel).reduce((n, l) => n + l.length, 0);
  const totalUSA = Object.values(byModelUSA).reduce((n, l) => n + l.length, 0);
  return { ok: true, models: Object.keys(byModel).length, reserveringen: total, amerika: totalUSA };
}

// ─── Merzario-tracking (MyMerzario Tracking API) ─────────────────────
// Read-only zending/container-tracking van vervoerder Merzario. LET OP:
// dit endpoint heeft GEEN api-key/login — het referentienummer (container,
// house bill, orderreferentie of shipment-ID) ís de sleutel. We roepen het
// server-side aan (de browser zou op CORS + Cloudflare-bot-challenge stuiten)
// en cachen elk resultaat ~4 uur in KV ('merzario-cache'), want het endpoint
// zit zelf achter Cloudflare en mag niet te vaak bevraagd worden.
const MERZARIO_URL = "https://www-mbvrid.wisegrid.net/Glow/api/tracker/trackerList";
const MERZARIO_TTL_MS = 4 * 60 * 60 * 1000;   // 4 uur

// Normaliseer één ruw tracking-record naar een compacte, veilige vorm voor de tegel.
function normalizeTrackRecord(rec) {
  const d = (rec && rec.data) || {};
  const prog = (rec && rec.progress) || {};
  const legs = Array.isArray(rec && rec.routingLegs) ? rec.routingLegs : [];
  const events = Array.isArray(rec && rec.events) ? rec.events : [];
  const ev0 = events[0] || null;
  // Beste ETA = de overall-aankomst uit progress (lokale tijd, geen offset) →
  // pak alleen de datum (YYYY-MM-DD) voor het date-veld in de tegel.
  const arrival = prog.arrival || (legs.length ? legs[legs.length - 1].eta : null) || null;
  const etaDate = arrival ? String(arrival).slice(0, 10) : null;
  const departure = prog.departure || null;
  return {
    entityType: rec.entityType || null,
    container: (d.CONTAINERNUMBER || "").trim() || null,
    shipmentId: d.SHIPMENTID || null,
    orderReference: d.ORDERREFERENCE || null,
    houseBill: d.HOUSEBILLNUMBER || null,
    vessel: (d.VESSELCODE || "").trim() || null,          // veldnaam misleidt: bevat de scheepsnaam
    voyage: (d.VOYAGEFLIGHT || "").trim() || null,
    originPort: d.ORIGINPORT || d.LOADPORTIATA || null,
    originCountry: d.ORIGINPORTCOUNTRY || d.LOADPORTCOUNTRY || null,
    destPort: d.DESTINATIONPORT || null,
    destCountry: d.DESTINATIONPORTCOUNTRY || d.DISCHARGEPORTCOUNTRY || null,
    transportMode: d.TRANSPORTMODE || null,
    departure,
    departureIsEstimate: !!prog.departureIsEstimate,
    arrival,
    eta: etaDate,
    arrivalIsEstimate: prog.arrivalIsEstimate !== false,   // default: behandel als schatting
    progress: typeof prog.progress === "number" ? Math.round(prog.progress * 100) : null,
    lastEvent: ev0 ? (ev0.description || ev0.eventDescription || "") : null,
    lastEventUtc: ev0 ? (ev0.eventTimeUtc || null) : null,
  };
}

// Vraag tracking op voor een lijst referenties, met KV-cache. Geeft een map
// { ref: normalizedRecord|null } terug (null = niet gevonden/te achterhalen).
async function merzarioTrack(env, refs, opts = {}) {
  const wanted = [...new Set((refs || []).map(r => String(r || "").trim()).filter(Boolean))].slice(0, 50);
  const out = {};
  if (!wanted.length) return out;

  const cache = (await env.FONTEYN_DATA.get("merzario-cache", { type: "json" })) || { records: {} };
  cache.records = cache.records || {};
  const now = Date.now();
  const force = !!opts.force;
  const stale = [];
  for (const ref of wanted) {
    const hit = cache.records[ref];
    if (!force && hit && hit.fetchedAt && (now - hit.fetchedAt) < MERZARIO_TTL_MS) {
      out[ref] = hit.record;                // vers genoeg uit cache
    } else {
      stale.push(ref);
    }
  }

  if (stale.length) {
    let arr = [];
    try {
      const r = await fetch(MERZARIO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ trackingNumbers: stale }),
      });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        arr = Array.isArray(j) ? j : [];
      } else {
        // 429/5xx of Cloudflare-challenge: laat oude cache staan, markeer live-fout
        out.__error = "Merzario gaf HTTP " + r.status + " (probeer later opnieuw).";
      }
    } catch (e) {
      out.__error = "Merzario niet bereikbaar: " + (e.message || e);
    }
    // Records terugmatchen op elke referentie waarop we konden zoeken
    for (const rec of arr) {
      const norm = normalizeTrackRecord(rec);
      const keys = [norm.container, norm.shipmentId, norm.orderReference, norm.houseBill].filter(Boolean);
      for (const ref of stale) {
        if (keys.includes(ref)) {
          out[ref] = norm;
          cache.records[ref] = { fetchedAt: now, record: norm };
        }
      }
    }
    // Referenties zonder match expliciet op null (en cachen, zodat we niet blijven hameren)
    for (const ref of stale) {
      if (!(ref in out)) { out[ref] = null; cache.records[ref] = { fetchedAt: now, record: null }; }
    }
    // Cache opschonen (max 500 refs) en wegschrijven
    const keys = Object.keys(cache.records);
    if (keys.length > 500) {
      keys.sort((a, b) => (cache.records[b].fetchedAt || 0) - (cache.records[a].fetchedAt || 0));
      const keep = {}; keys.slice(0, 500).forEach(k => keep[k] = cache.records[k]);
      cache.records = keep;
    }
    await env.FONTEYN_DATA.put("merzario-cache", JSON.stringify(cache));
  }
  return out;
}

// POST /track  { trackingNumbers:[...], force?:bool }  → { ok, results:{ref:rec|null}, error? }
// Intern (team-sleutel X-Fonteyn-Auth), gebruikt door de Voorraadbeheer-tegel.
async function handleTrack(request, env) {
  const auth = request.headers.get("X-Fonteyn-Auth") || "";
  if (!env.SHARED_SECRET || auth !== env.SHARED_SECRET) return reply(401, { ok: false, error: "Unauthorized" });
  let body = {};
  try { body = await request.json(); } catch { return reply(400, { ok: false, error: "Body moet JSON zijn" }); }
  const refs = Array.isArray(body.trackingNumbers) ? body.trackingNumbers : [];
  if (!refs.length) return reply(400, { ok: false, error: "trackingNumbers ontbreekt" });
  const results = await merzarioTrack(env, refs, { force: body.force === true });
  const error = results.__error || null; delete results.__error;
  return reply(200, { ok: !error || Object.keys(results).length > 0, error, results });
}

// ─── QuickBooks Online (Amerika / Passion Spas USA) ──────────────────
// Read-only koppeling met QuickBooks Online via OAuth2 (authorization code).
// client_id/secret als worker-secrets (QB_CLIENT_ID/QB_CLIENT_SECRET); tokens
// + realmId in KV ('qb-tokens'). We doen ALLEEN leesacties (SELECT-query's) —
// nooit schrijven, factureren of geld verplaatsen.
const QB_AUTH   = "https://appcenter.intuit.com/connect/oauth2";
const QB_TOKEN  = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QB_SCOPE  = "com.intuit.quickbooks.accounting";
// API-basis verschilt per omgeving: sandbox (Development-keys) vs productie
// (Production-keys). Instelbaar via worker-secret QB_API_BASE; default productie.
const qbApiBase = (env) => (env.QB_API_BASE === "sandbox"
  ? "https://sandbox-quickbooks.api.intuit.com"
  : (env.QB_API_BASE && env.QB_API_BASE.startsWith("http") ? env.QB_API_BASE : "https://quickbooks.api.intuit.com"));
const qbRedirectUri = (url) => url.origin + "/amerika/qb/callback";

async function qbGetTokens(env) { return (await env.FONTEYN_DATA.get("qb-tokens", { type: "json" })) || null; }

// Geldig access token (ververst met refresh_token als 't bijna verlopen is)
async function qbAccessToken(env) {
  const t = await qbGetTokens(env);
  if (!t || !t.refresh_token) throw new Error("QuickBooks niet gekoppeld");
  if (t.access_token && t.expiresAt && Date.now() < t.expiresAt - 60000) return t;
  const basic = btoa(env.QB_CLIENT_ID + ":" + env.QB_CLIENT_SECRET);
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  const r = await fetch(QB_TOKEN, { method: "POST", headers: { "Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" }, body });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.access_token) throw new Error("QB token-refresh faalde (" + r.status + ")");
  const nt = { ...t, access_token: j.access_token, refresh_token: j.refresh_token || t.refresh_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  await env.FONTEYN_DATA.put("qb-tokens", JSON.stringify(nt));
  return nt;
}
async function qbQuery(env, sql) {
  const t = await qbAccessToken(env);
  const u = qbApiBase(env) + "/v3/company/" + t.realmId + "/query?minorversion=73&query=" + encodeURIComponent(sql);
  const r = await fetch(u, { headers: { "Authorization": "Bearer " + t.access_token, "Accept": "application/json" } });
  // intuit_tid uit de response-header vastleggen (helpt Intuit-support bij troubleshooting)
  const tid = r.headers.get("intuit_tid") || "";
  if (!r.ok) {
    const body = (await r.text()).slice(0, 300);
    console.error("[qb] query-fout status=" + r.status + " intuit_tid=" + tid + " body=" + body);
    throw new Error("QB query HTTP " + r.status + " (intuit_tid " + tid + "): " + body);
  }
  return await r.json();
}
// Start de OAuth-flow (team-sleutel als query-param, want dit is een browser-redirect)
async function qbHandleConnect(request, env, url) {
  if (!env.SHARED_SECRET || (url.searchParams.get("key") || "") !== env.SHARED_SECRET) return reply(401, "Unauthorized");
  if (!env.QB_CLIENT_ID) return reply(500, "QuickBooks nog niet geconfigureerd (QB_CLIENT_ID ontbreekt).");
  const state = crypto.randomUUID();
  await env.FONTEYN_DATA.put("qb-state:" + state, "1", { expirationTtl: 600 });
  const p = new URLSearchParams({ client_id: env.QB_CLIENT_ID, response_type: "code", scope: QB_SCOPE, redirect_uri: qbRedirectUri(url), state });
  return Response.redirect(QB_AUTH + "?" + p.toString(), 302);
}
async function qbHandleCallback(request, env, url) {
  const code = url.searchParams.get("code"), realmId = url.searchParams.get("realmId"), state = url.searchParams.get("state") || "";
  const okState = await env.FONTEYN_DATA.get("qb-state:" + state);
  if (!okState) return new Response("Ongeldige of verlopen sessie — probeer opnieuw te verbinden.", { status: 400 });
  await env.FONTEYN_DATA.delete("qb-state:" + state);
  if (!code || !realmId) return new Response("Geen code/realmId ontvangen van QuickBooks.", { status: 400 });
  const basic = btoa(env.QB_CLIENT_ID + ":" + env.QB_CLIENT_SECRET);
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: qbRedirectUri(url) });
  const r = await fetch(QB_TOKEN, { method: "POST", headers: { "Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" }, body });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.access_token) return new Response("Token-uitwisseling faalde (" + r.status + ").", { status: 502 });
  await env.FONTEYN_DATA.put("qb-tokens", JSON.stringify({ realmId, access_token: j.access_token, refresh_token: j.refresh_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000, connectedAt: new Date().toISOString() }));
  return new Response("<!doctype html><meta charset='utf-8'><body style='font-family:sans-serif;padding:48px;text-align:center'><h2>✅ QuickBooks gekoppeld</h2><p>Passion Spas USA is verbonden. Je kunt dit tabblad sluiten en terug naar het dashboard.</p></body>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
async function qbHandleStatus(request, env) {
  if (!env.SHARED_SECRET || (request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
  const t = await qbGetTokens(env);
  return reply(200, { ok: true, configured: !!env.QB_CLIENT_ID, connected: !!(t && t.refresh_token), realmId: (t && t.realmId) || null, connectedAt: (t && t.connectedAt) || null, omgeving: env.QB_API_BASE === "sandbox" ? "sandbox" : "productie" });
}
async function qbHandleData(request, env) {
  if (!env.SHARED_SECRET || (request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false, error: "Unauthorized" });
  try {
    const invJson = await qbQuery(env, "SELECT * FROM Invoice ORDERBY TxnDate DESC MAXRESULTS 100");
    const custJson = await qbQuery(env, "SELECT * FROM Customer MAXRESULTS 500");
    const invoices = ((invJson.QueryResponse && invJson.QueryResponse.Invoice) || []).map(i => ({
      id: i.Id, nr: i.DocNumber || null, datum: i.TxnDate || null,
      klant: (i.CustomerRef && i.CustomerRef.name) || null,
      totaal: Number(i.TotalAmt) || 0, openstaand: Number(i.Balance) || 0, valuta: (i.CurrencyRef && i.CurrencyRef.value) || "USD",
    }));
    const customers = ((custJson.QueryResponse && custJson.QueryResponse.Customer) || []).map(c => ({
      id: c.Id, naam: c.DisplayName || c.CompanyName || null, bedrijf: c.CompanyName || null,
      email: (c.PrimaryEmailAddr && c.PrimaryEmailAddr.Address) || null, openstaand: Number(c.Balance) || 0, actief: c.Active !== false,
    }));
    return reply(200, { ok: true, invoices, customers });
  } catch (e) {
    console.error("[qb] data-fout: " + String(e.message || e));   // logbaar voor troubleshooting
    return reply(200, { ok: false, error: String(e.message || e) });
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        if (!env.LOGIC4_USERNAME) { console.log("[cron] geen Logic4-creds"); return; }
        const s = await dpRefreshHalStock(env);
        console.log("[cron] hal-voorraad: " + JSON.stringify(s));
        const rv = await dpRefreshReservations(env);
        console.log("[cron] reserveringen: " + JSON.stringify(rv));
      } catch (e) { console.log("[cron] fout: " + (e.message || e)); }
    })());
  },

  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Team-sleutel voor medewerkers (Logic4-login als bewijs)
    if (url.pathname === "/internal/teamkey" && request.method === "POST") {
      return handleTeamKey(request, env);
    }

    // Merzario-tracking (intern, team-sleutel) — zie handleTrack
    if (url.pathname === "/track" && request.method === "POST") {
      return handleTrack(request, env);
    }

    // QuickBooks Online (Amerika) — OAuth-flow + read-only data
    if (url.pathname === "/amerika/qb/connect")  return qbHandleConnect(request, env, url);
    if (url.pathname === "/amerika/qb/callback") return qbHandleCallback(request, env, url);
    if (url.pathname === "/amerika/qb/status")   return qbHandleStatus(request, env);
    if (url.pathname === "/amerika/qb/data")     return qbHandleData(request, env);

    // Dealerportaal (publiek, eigen sessie-auth — géén shared secret)
    if (url.pathname === "/dealers" || url.pathname.startsWith("/dealers/")) {
      return handleDealerRoutes(request, env, url);
    }

    const m = url.pathname.match(/^\/data\/([a-z0-9_-]{2,40})\/?$/i);
    if (!m) return reply(404, "Not found");
    const bucket = m[1].toLowerCase();
    if (!ALLOWED_BUCKETS.has(bucket) && !ALLOWED_BUCKET_PATTERNS.some(re => re.test(bucket))) {
      return reply(403, `Bucket '${bucket}' not whitelisted`);
    }

    // Auth. LET OP: dealer-buckets bevatten data van échte dealers en zijn
    // NIET benaderbaar met het (publiek zichtbare) shared secret — alleen
    // met de aparte beheersleutel DP_ADMIN_KEY.
    if (bucket.startsWith("dealer-")) {
      if (!dpIsAdmin(request, env)) return reply(403, "Dealer-buckets vereisen de beheersleutel (X-DP-Admin)");
    } else {
      const authHeader = request.headers.get("X-Fonteyn-Auth") || "";
      const expected = env.SHARED_SECRET || "";
      if (!expected || authHeader !== expected) {
        return reply(401, "Unauthorized");
      }
    }

    if (request.method === "GET") {
      const data = await env.FONTEYN_DATA.get(bucket, { type: "json" });
      return reply(200, data || {});
    }

    if (request.method === "PUT") {
      const body = await request.text();
      // Valideer dat 't parsable JSON is
      try { JSON.parse(body); }
      catch { return reply(400, "Body must be valid JSON"); }
      // Limiet: max 1 MB per bucket (KV-limiet is 25 MB, 1 MB is ruim
      // genoeg voor onze schaal van enkele tientallen records)
      if (body.length > 1024 * 1024) {
        return reply(413, "Payload too large (max 1 MB)");
      }
      await env.FONTEYN_DATA.put(bucket, body);
      return reply(200, { ok: true, bytes: body.length });
    }

    return reply(405, "Method not allowed");
  },
};
