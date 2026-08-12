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
  "voorraad-productie",  // Open inkooporders bij de 9 spa-fabrieken (uur-sync): per model in productie + ETA
  "specsheets",       // Marketing: specificatiesheets per spa-model (tekst + verkleinde foto's)
  "specsheet-iconen", // Marketing: icoontjes van de onderdelen op pagina 2, op artikelnummer
  "voorraad-inkooporders", // Welke proforma al een inkooporder is geworden — voorkomt dubbel bestellen
  "apparaten",        // Computer-sleutel (PC-XXXXXX) → herkenbare naam, voor het activiteitenlogboek
  "qb-wires",         // Amerika: wire-overzichten van Audrey (uit haar mail)
  "qb-verwerkt",      // Amerika: 'verwerkt in Logic4' per factuurnummer (lezen; schrijven via /amerika/qb/verwerkt)
  "qb-verborgen",     // Amerika: facturen die Chantal uit beeld heeft gehaald (dubbel ingeladen). Niet gewist: de bron levert ze opnieuw, dus we onthouden wát verborgen is en door wie.
  "spa-verborgen",    // Voorraad: Jazzi-bestellingen die Chantal uit de historie heeft weggeklikt. Zelfde reden — het voorstel wordt telkens opnieuw opgebouwd.
  "voorraad-notities",// Per reserveringsregel: opmerking + vinkjes afroep/inplannen/gepland (Chantal)
  "geldgoederen",     // Geld-goederenbeweging: laatste controle-momentopname + historie van de totalen
  "gg-bevindingen",   // Geld-goederenbeweging: per bevinding de status (open/opgepakt/opgelost/akkoord) + notitie
  "flexport-zendingen",// Flexport-overzicht (zendingen + containers). Ophalen duurt ~2,5 min, dus dit wordt hergebruikt.
  "flexport-token",   // Flexport-toegangstoken (24u geldig). Bewaren is verplicht: er mogen maar 10 tokens per dag worden opgehaald.
  "gg-bank",           // Bankaansluiting: laatste vergelijking bankafschriften vs Logic4 + historie
  "gg-1350",           // Vooruitontvangen bedragen: laatste doorrekening + historie per meting
  "gg-1630",           // Aansluiting grootboek 1630: laatste opstelling + historie per meting (accountant)
  "gg-artikelgroepen",// Artikelcode → productgroep-id + de groepsnamen. Voor de debiteurenlijst, die per factuur de afdeling moet bepalen. Opbouwen kost een minuut, dus wordt hij 30 dagen hergebruikt.
  "spa-aliassen",     // Modelnaam zoals hij getypt wordt → modelnaam in de spa-catalogus (eenmalige keuze door een mens)
  // De maten van de spa's zoals Chantal ze zelf invult, per model. Die gaan
  // vóór alle bestanden: de prijslijsten, de kistmaten en de specsheets zijn
  // wat leveranciers ooit hebben aangeleverd, dit is wat er echt klopt. Wordt
  // gebruikt door de tegel Container laden en door de voorraadwaardering in
  // Amerika, dus één plek voor allebei.
  "spa-maten",
  // Voorraad in Houston, zoals Chantal die bijhoudt. Nu nog een telling die per
  // mail binnenkomt; zodra magazijn Houston in Logic4 bestaat komt dit daaruit
  // en vervalt deze bucket. Bewust apart van 'voorraad-hallen': dat is de
  // Nederlandse hal-voorraad en die twee moeten niet door elkaar lopen.
  "amerika-voorraad",
  "taken",            // Persoonlijk takenblok: e-mailadres → eigen taken (tekst/datum/klaar)
  "taken-ritme",      // Terugkerende momenten (voorraadcontrole, kwartaalcontrole) + per persoon wanneer afgevinkt
  // De huisstijl-fonts (Sephir, Helvetica, Univers) zijn commercieel
  // gelicentieerd. Ze staan hier en NIET in de repo, want die is publiek —
  // in de repo zetten zou neerkomen op ze doorgeven aan iedereen.
  "specsheet-fonts",
  // Prijsafspraken met alle leveranciers en fabrieken (Gretha): de mappenboom
  // en de gegevens per bestand. De bestanden zélf staan als losse sleutels
  // (plfile:<id>) en gaan via /prijslijst/bestand — anders zou één map met
  // vijftig PDF's de omvangsgrens van deze bucket meteen opblazen.
  "prijslijsten",
  // Bankkoppeling: de openstaande posten uit Logic4 (een uur bewaard, ~2.500
  // regels) en het logboek van wat er via het dashboard is geboekt.
  "bank-openstaand",
  "bank-geboekt",
  // Debiteurenlijst: per openstaande factuur waarom hij openstaat. Het
  // dashboard sorteert voor op betaalwijze; wat een mens daarvan omzet wordt
  // hier bewaard en gaat daarna vóór dat vermoeden (Osman, 8 aug 2026).
  "debiteuren-status",
  // Toekomstige modules toevoegen aan deze whitelist
]);

// Patroon-buckets: modules die per periode een eigen bucket gebruiken
// (omdat één bucket de 1 MB-limiet zou overschrijden bij groeiende data).
// signin-YYYY-MM = UK showroom bezoekersregistratie, één bucket per maand
// (handtekeningen als vector-strokes ≈ 2 KB per bezoeker).
const ALLOWED_BUCKET_PATTERNS = [
  /^signin-\d{4}-\d{2}$/,
  /^activiteit-\d{4}-\d{2}$/,   // activiteitenlogboek (medewerkers), één bucket per maand
  /^partner-activiteit-\d{4}-\d{2}$/,   // partner-activiteitenlogboek (dealers), één bucket per maand
  // Eén sleutel per specificatiesheet. Alle sheets stonden in de bucket
  // 'specsheets' bij elkaar, en de foto's zitten als base64 in de sheet zelf.
  // Daardoor gold de omvangsgrens voor de sóm: vier sheets waren al 16 MB van
  // de 20, en Demi kon de vijfde niet meer opslaan (Gretha, 6 aug 2026).
  // Per sheet een eigen sleutel haalt die koppeling weg - een sheet erbij
  // maakt de bestaande niet zwaarder.
  /^specsheet-[a-z0-9]{4,24}$/,
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

const DP_LOGIN_TTL = 15 * 60;            // magic-link per mail: 15 min geldig
const DP_SESS_TTL  = 30 * 24 * 3600;     // sessie 30 dagen
// Een link die een beheerder zélf aanmaakt en met de hand doorgeeft (mail,
// WhatsApp, telefonisch) heeft een ander leven dan een link die de bezoeker
// net zelf heeft aangevraagd: hij ligt vaak een dag stil voordat hij wordt
// gebruikt. Met 15 minuten was hij daardoor bijna altijd al verlopen op het
// moment dat de ontvanger klikte (Gerrit over Gretha, 7 aug 2026). Zeven
// dagen — en nog steeds eenmalig, dus na gebruik meteen dood.
const DP_ADMIN_LINK_TTL = 7 * 24 * 3600;

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
    await dpLogPartner(env, { email, company: dealer.company || "" }, "login", "wachtwoord");
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
  await dpLogPartner(env, { email: login.email, company: login.company }, "login", "inloglink");
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
  // Portaal-claims aftrekken van 'available'. NIEUW (25 jul, Gerrit): een
  // aanvraag claimt pas voorraad als er ÉCHT is aanbetaald (paid). Een nog
  // niet-betaalde aanvraag ('open') houdt de voorraad alleen kort vast zolang
  // de dealer daadwerkelijk aan het afrekenen is (grace-window van 60 min);
  // daarna telt hij niet meer mee — geen betaling = geen reservering.
  const CLAIM_GRACE_MS = 60 * 60000;
  const nowMs = Date.now();
  for (const r of (Array.isArray(reqData.requests) ? reqData.requests : [])) {
    if (r.allocationReleased) continue;
    const paid = r.paymentStatus === "paid" || r.status === "paid";
    const payingNow = r.paymentStatus === "open" && r.ts && (nowMs - Date.parse(r.ts)) < CLAIM_GRACE_MS;
    if (!paid && !payingNow) continue;
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
  await dpLogPartner(env, sess, "reservering-aangevraagd",
    qty + "× " + model + (variantName ? " (" + variantName + ")" : "") +
    (checkoutUrl ? " — betaallink " + (entry.currency === "USD" ? "$" : "€") + (entry.deposit != null ? entry.deposit.toFixed(2) : "") : ""));
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
  await dpLogPartner(env, sess, "wachtwoord-ingesteld", "");
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

// Sommige prijslijsten tonen partnerprijs, dealerprijs en consumentenprijs
// naast elkaar. Voor een partner is dat geen probleem — die betaalt de
// partnerprijs en de dealerprijs is een presentatiemiddel dat niemand betaalt
// (Arno, 4 aug 2026). Voor een echte dealer wél: die zou dan zien wat een
// ander betaalt. Welke bestanden dit zijn staat in dealer-docs onder
// 'prijsgevoelig', zodat het bij de documenten zelf ligt en niet in code.
function dpPrijsgevoeligeIds(data) {
  const lijst = (data && data.prijsgevoelig && data.prijsgevoelig.bestanden) || [];
  return new Set(lijst.map(f => String(f.id || "").toLowerCase()).filter(Boolean));
}

async function dpIsDealer(env, sess) {
  if (!sess) return false;
  const accounts = await dpGetAccounts(env);
  const acc = dpFindDealer(accounts, sess.email);
  return String((acc && acc.soort) || "").toLowerCase() === "dealer";
}

// GET /dealers/api/docs — losse links (docs) + documentbibliotheek (library:
// categorieën → mappen → bestanden; gevuld via tools/dp-upload-docs.mjs)
async function dpHandleDocs(env, sess) {
  const data = await env.FONTEYN_DATA.get("dealer-docs", { type: "json" });
  const docs = (data && data.docs) || [];
  let library = (data && data.library) || null;

  if (library && await dpIsDealer(env, sess)) {
    const verboden = dpPrijsgevoeligeIds(data);
    if (verboden.size) {
      library = {
        ...library,
        categories: (library.categories || []).map(c => ({
          ...c,
          groups: (c.groups || []).map(g => ({
            ...g, files: (g.files || []).filter(f => !verboden.has(String(f.id || "").toLowerCase())),
          })).filter(g => g.files.length),
        })),
      };
    }
  }
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
async function dpServeFile(env, url, sess) {
  const id = dpFileId(url);
  if (!id) return reply(400, { ok: false, error: "bad-id" });
  // Uit de lijst halen is niet genoeg: wie het adres kent zou het bestand
  // anders alsnog kunnen opvragen.
  const docsData = await env.FONTEYN_DATA.get("dealer-docs", { type: "json" });
  if (dpPrijsgevoeligeIds(docsData).has(id) && await dpIsDealer(env, sess)) {
    return reply(403, { ok: false, error: "niet-beschikbaar-voor-dealers" });
  }
  const buf = await env.FONTEYN_DATA.get("dpfile:" + id, { type: "arrayBuffer" });
  if (!buf) return reply(404, { ok: false, error: "not-found" });
  const ext = id.split(".").pop();
  const name = id.split("/").pop().replace(/"/g, "");
  if (sess) await dpLogPartner(env, sess, "document-geopend", name);
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
  await dpLogPartner(env, sess, "vraag-gesteld", subject);
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
// SAFETY: de team-sleutel (SHARED_SECRET) staat NIET in de code — de tegels
// lezen hem uit localStorage, waar hij bij het inloggen automatisch terechtkomt.
// Maar hij komt daarmee wél op de computer van élke medewerker die inlogt, en
// is dus breed verspreid. Data van échte dealers verdient een smallere kring,
// en vereist daarom een APARTE beheersleutel: DP_ADMIN_KEY, die alleen als
// worker-secret bestaat en eenmalig per beheerder-computer wordt ingevoerd in
// de beheertegel.
// (Deze toelichting stond er eerder anders: dat het shared secret in de
// tegel-HTML zou staan. Dat klopt niet meer — de reden voor de tweede sleutel
// blijft, de onderbouwing is hierboven bijgesteld.)
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
  await env.FONTEYN_DATA.put("dp-login:" + token, JSON.stringify({ email, company: dealer.company || "" }), { expirationTtl: DP_ADMIN_LINK_TTL });
  return reply(200, { ok: true, link: url.origin + "/dealers/auth?t=" + token, validDays: DP_ADMIN_LINK_TTL / 86400 });
}

// POST /dealers/admin/wachtwoord { email, password } — beheerder zet een
// eerste wachtwoord voor een account.
//
// Waarom dit erbij moet: een inloglink is eenmalig, en dat botst met de
// mailfilters. Microsoft Defender (Safe Links) opent elke link in een
// binnenkomende mail zélf om hem te controleren. Die controle wisselt het
// token in, en de ontvanger krijgt daarna "Link expired" te zien — de link
// wás geldig, maar is al opgebruikt door de scanner. Dat verklaart waarom
// het langer geldig maken alléén niet genoeg is.
// Met een wachtwoord is er niets meer dat kan verlopen of onderweg wordt
// opgesnoept. Het wachtwoord wordt hier niet bewaard: alleen salt+hash, net
// als bij dpHandleSetPassword. De ontvanger kan het daarna zelf wijzigen.
async function dpAdminSetPassword(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (password.length < 8) return reply(400, { ok: false, error: "wachtwoord moet minstens 8 tekens zijn" });
  const accounts = await dpGetAccounts(env);
  const dealer = dpFindDealer(accounts, email);
  if (!dealer) return reply(404, { ok: false, error: "geen actief account met dit e-mailadres" });
  dealer.pw = await dpHashPassword(password);
  await env.FONTEYN_DATA.put("dealer-accounts", JSON.stringify(accounts));
  console.log("[dp-pw] wachtwoord door beheerder gezet voor " + email);
  await dpLogPartner(env, { email, company: dealer.company || "" }, "wachtwoord-ingesteld", "door beheerder");
  return reply(200, { ok: true, email });
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
    if (p === "/dealers/admin/wachtwoord" && request.method === "POST") return dpAdminSetPassword(request, env);
    if (p === "/dealers/admin/file" && request.method === "PUT") return dpAdminPutFile(request, env, url);
    if (p === "/dealers/admin/testorder" && request.method === "POST") return dpAdminTestOrder(request, env);
    if (p === "/dealers/admin/reserve-for" && request.method === "POST") return dpAdminReserveFor(request, env, url);
    if (p === "/dealers/admin/refresh-stock" && request.method === "POST") return reply(200, await dpRefreshHalStock(env).catch(e => ({ ok: false, error: String(e.message || e) })));
    if (p === "/dealers/admin/refresh-reserveringen" && request.method === "POST") return reply(200, await dpRefreshReservations(env).catch(e => ({ ok: false, error: String(e.message || e) })));

    if (p === "/dealers/admin/refresh-productie" && request.method === "POST") return reply(200, await dpRefreshProductie(env).catch(e => ({ ok: false, error: String(e.message || e) })));
    return reply(404, "Not found");
  }

  // Alles hieronder vereist een geldige dealer-sessie
  if (p.startsWith("/dealers/api/")) {
    const sess = await dpSession(env, request);
    if (!sess) return reply(401, { ok: false, error: "not-logged-in" });
    if (p === "/dealers/api/me" && request.method === "GET") {
      const accounts = await dpGetAccounts(env);
      const dealer = dpFindDealer(accounts, sess.email);
      await dpLogPartner(env, sess, "portaal-open", "");   // actieve sessie (dedup 5 min)
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
    if (p === "/dealers/api/docs" && request.method === "GET") return dpHandleDocs(env, sess);
    if (p === "/dealers/api/file" && request.method === "GET") return dpServeFile(env, url, sess);
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
// Welke orderstatussen tellen als openstaande reservering.
//
// Hier stonden alleen 15, 25 en 1, en daardoor was een order die verder in het
// proces zat onzichtbaar in de tegel, hoeveel er ook betaald was. Chantal liep
// daar tegenaan bij container 3517962 (status 28, 14.549,62 aanbetaald) en
// eerder bij order 3511087. Gemeten op 6 aug 2026 ging het om 14 containers
// met 213 spa's op Dealer magazijn die nergens te zien waren.
//
// 30 "Volledig betaald, vrijgeven leveren" en 28 "Gepland, wacht op betaling"
// horen er dus bij. 23 "Geannuleerd" bewust NIET, ook al hangen daar 3 orders
// met 44 spa's aan: die zijn afgeblazen en zouden het voorraadbeeld juist
// vervuilen.
const DP_RESV_STATUSES = [15, 25, 1, 28, 30];
const WH_NAMES = { 19: "Geen", 20: "OUD Kelder", 21: "Fonteyn", 25: "Showroommodel", 26: "Outlet", 27: "Dealer magazijn", 49: "Derving", 50: "Warehouse Texas USA", 51: "Transporteur", 52: "Retouren" };
const WH_TEXAS = 50, WH_DEALER = 27;
// Kleur = het stuk ná de '|' in de regelomschrijving ("Relax Spa | Sterling White with Grey").
function dpRowColor(desc) {
  const s = String(desc || "");
  const i = s.indexOf("|");
  if (i < 0) return null;
  return s.slice(i + 1).replace(/\b(spa|swimspa)\b/gi, "").replace(/\s+/g, " ").trim() || null;
}
// De 9 fabrieken waar Fonteyn spa's/swimspa's/sauna's inkoopt. Fuzzy gematcht
// op CreditorCompanyName (de spelling wisselt in Logic4). Zie geheugen.
const SPA_FACTORIES = [
  "guangzhou romex", "venus sanitary", "changzhou bigeer", "new normal bath",
  "ponfit spa", "sunrans sanitary", "huantong industry", "kasdaly pool spa", "gaoming yuehua",
];
const isSpaFactory = (name) => { const s = String(name || "").toLowerCase(); return SPA_FACTORIES.some(f => s.includes(f)); };
// Containernummer uit het Logic4-veld 'Uw referentie' (o.Reference). Chantal zet
// daar bij een dealer-container "container 3376" in; soms staat er alleen het
// nummer. Alles wat daar niet op lijkt laten we staan als vrije referentie.
function dpContainerNr(ref) {
  const s = String(ref || "").trim();
  if (!s) return null;
  // Minimaal 3 cijfers: "Barcelona 25 - Container 2" is een volgnummer, geen
  // containernummer. Die referentie tonen we ongewijzigd in de tegel.
  let m = s.match(/container[^0-9]*([0-9]{3,6}(?:[-&/][0-9]+)*)/i);
  if (m) return m[1];
  m = s.match(/^([0-9]{3,6}(?:[-&/][0-9]+)*)$/);
  return m ? m[1] : null;
}

// Open inkooporders (IKO's) bij de 9 fabrieken = wat er nu 'in productie' is.
// Per model de aantallen (nog te leveren) + verwachte leverdatum. Bucket
// 'voorraad-productie'. Komt in de leverforecast ná de schepen.
async function dpRefreshProductie(env) {
  const catalog = (await env.FONTEYN_DATA.get("spa-catalog", { type: "json" })) || {};
  const codeToModel = {};
  for (const [model, variants] of Object.entries(catalog.models || {})) for (const v of variants) codeToModel[v.code] = model;
  const token = await l4Token(env);
  const call = (path, body) => fetch("https://api.logic4server.nl" + path, {
    method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then(r => r.ok ? r.json() : []).catch(() => []);
  // Alle open inkooporders ophalen, dan filteren op de fabrieken
  let orders = [];
  for (let page = 0; page < 12; page++) {
    const arr = await call("/v3/BuyOrders/GetBuyOrders", { BuyOrderIsClosed: false, TakeRecords: 500, SkipRecords: page * 500 });
    const list = Array.isArray(arr) ? arr : ((arr && (arr.Records || arr.BuyOrders)) || []);
    if (!list.length) break; orders = orders.concat(list); if (list.length < 500) break;
  }
  const fact = orders.filter(o => isSpaFactory(o.CreditorCompanyName));
  const byModel = {};
  for (const o of fact) {
    const rowsResp = await call("/v3/BuyOrders/GetBuyOrderRowsByFilter", { BuyOrderId: o.Id, TakeRecords: 200 });
    const rows = Array.isArray(rowsResp) ? rowsResp : ((rowsResp && rowsResp.Records) || []);
    for (const r of rows) {
      const model = codeToModel[String(r.ProductCode || "")]; if (!model) continue;
      const qty = Number(r.QtyToDeliver) || Number(r.QtyToOrder) || 0; if (qty <= 0) continue;
      (byModel[model] = byModel[model] || []).push({
        iko: o.Id, fabriek: o.CreditorCompanyName || "", ref: String(o.Remarks || "").trim().slice(0, 80) || null,
        qty, eta: (r.ExpectedDeliveryDate || "").slice(0, 10) || null,
      });
    }
  }
  await env.FONTEYN_DATA.put("voorraad-productie", JSON.stringify({ updated: new Date().toISOString(), models: byModel }));
  const total = Object.values(byModel).reduce((n, l) => n + l.reduce((a, x) => a + x.qty, 0), 0);
  return { ok: true, modellen: Object.keys(byModel).length, stuks: total, ikos: fact.length };
}

// UserId → naam van de medewerker. Elke Logic4-order hangt aan de adviseur die
// hem heeft ingevoerd; Chantal wil die naam bij elke reservering zien. Eén keer
// per verversing ophalen. Faalt het, dan blijft 'adviseur' gewoon leeg — dat
// mag de hele reserveringen-sync nooit onderuit halen.
async function l4Medewerkers(env) {
  try {
    const token = await l4Token(env);
    const r = await fetch("https://api.logic4server.nl/v3/User/GetAllUsers", {
      headers: { "Authorization": "Bearer " + token },
    });
    if (!r.ok) return {};
    const data = await r.json().catch(() => null);
    const arr = Array.isArray(data) ? data : ((data && (data.Users || data.Records || data.Items)) || []);
    const map = {};
    for (const u of arr) {
      const id = u.Id != null ? u.Id : u.UserId;
      if (id == null) continue;
      let naam = String(u.FullName || u.Name || u.DisplayName || u.Username || "").trim();
      if (!naam) continue;
      // Logic4 zet 'ZZ OUD' of 'ZZ-OUD' vóór de naam van wie uit dienst is. Die
      // orders bestaan nog, dus de naam blijft staan — maar wél met de melding
      // erbij, anders lijkt het alsof die adviseur er nog werkt.
      const uitDienst = /^zz[\s-]*oud\b/i.test(naam);
      if (uitDienst) naam = naam.replace(/^zz[\s-]*oud\s*/i, "").trim() || naam;
      map[String(id)] = { naam, uitDienst };
    }
    return map;
  } catch (e) { return {}; }
}

// ══════════ Proforma invoice → inkooporder ══════════════════════════════
// De fabriek stuurt een proforma invoice met wat er besteld wordt. Manon typt
// dat nu handmatig over in Logic4. Hieronder wordt die lijst omgezet naar een
// inkooporder — maar altijd in twee stappen: eerst een voorstel dat een mens
// controleert, pas daarna het echte wegschrijven.

// Leverancier (fabrieksnaam) → CreditorId. Uit de bestaande inkooporders, want
// dáár staat welke naam bij welk crediteurnummer hoort. Geen giswerk.
async function ikoCrediteuren(env) {
  const token = await l4Token(env);
  const r = await fetch("https://api.logic4server.nl/v3/BuyOrders/GetBuyOrders", {
    method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ TakeRecords: 500 }),
  });
  if (!r.ok) return {};
  const data = await r.json().catch(() => []);
  const arr = Array.isArray(data) ? data : ((data && (data.Records || data.BuyOrders)) || []);
  const map = {};
  for (const o of arr) {
    const naam = String(o.CreditorCompanyName || "").trim();
    if (naam && o.CreditorId != null && !map[naam.toLowerCase()]) map[naam.toLowerCase()] = { id: o.CreditorId, naam };
  }
  return map;
}

// Model + kleur → artikelcode uit de spa-catalogus. De kleur op de proforma is
// vrije tekst ("Sterling Silver, Jazzi color #30"), dus we matchen op de
// kenmerkende woorden en niet op een exacte string.
// Modelnamen worden met de hand getypt en zijn navenant: "Tenerife Sup.",
// "Rewind NEW", "serene 6", "Mallorca sup/ Blackpool". Dit haalt de ruis eraf
// zodat de naam vergelijkbaar wordt zonder dat er iets wordt gegokt.
function ikoNormaliseerModel(naam) {
  return String(naam || "")
    .toLowerCase()
    .replace(/\bnew\b/g, " ")        // "Rewind NEW" is gewoon Rewind
    .replace(/\bsup\b\.?/g, "superior")
    .replace(/\bdia\b\.?/g, "diamond")
    .replace(/\blux\b\.?/g, "luxury")
    .replace(/[^a-z0-9]+/g, " ")     // punten, schuine strepen, dubbele spaties
    .replace(/\s+/g, " ")
    .trim();
}

// aliassen: door een mens vastgelegde koppeling "zoals Chantal het typt" →
// "zoals het model in de catalogus heet". Eén keer kiezen, daarna onthouden.
function ikoZoekArtikel(catalog, model, kleur, skirt, aliassen) {
  const modellen = catalog.models || {};
  let varianten = modellen[model] || [];
  let viaAndereNaam = null;

  // Hoe de modelnaam is gevonden bepaalt of het resultaat te vertrouwen is.
  // Een letterlijke of door een mens vastgelegde treffer is zeker; alleen een
  // gedeeltelijke naamsovereenkomst is dat niet.
  let modelZeker = true;

  // 1. Handmatige alias gaat vóór alles: die is bewust gekozen.
  if (!varianten.length && model && aliassen) {
    const doel = aliassen[ikoNormaliseerModel(model)];
    if (doel && modellen[doel]) { varianten = modellen[doel]; viaAndereNaam = doel; }
  }
  // 2. De fabriekscodelijst noemt hem "Exhilarate", Logic4 "Spa Exhilarate
  // Mighty Wave". Is er precies één catalogusmodel dat deze naam bevat, dan is
  // dat hem. Zijn er meerdere, dan gokken we niet — dan moet een mens kiezen.
  if (!varianten.length && model) {
    const genorm = ikoNormaliseerModel(model);
    const kaart = Object.keys(modellen).map(k => ({ k, n: ikoNormaliseerModel(k) }));
    // Eerst exact op de genormaliseerde naam: "serene 6" → "Serene 6",
    // "Tenerife Sup." → "Tenerife Superior". Dat is geen gok maar een treffer.
    const exact = kaart.filter(x => x.n === genorm);
    if (exact.length === 1) { varianten = modellen[exact[0].k]; viaAndereNaam = exact[0].k; }
    else {
      const kandidaten = kaart.filter(x => x.n.includes(genorm)).map(x => x.k);
      // Slechts een deel van de naam komt overeen — dat kan kloppen, maar
      // "Renew" binnen "Old Renew" laat zien dat het ook mis kan gaan.
      if (kandidaten.length === 1) { varianten = modellen[kandidaten[0]]; viaAndereNaam = kandidaten[0]; modelZeker = false; }
      else if (kandidaten.length > 1) return { meerdere: kandidaten };
    }
  }
  if (!varianten.length) return null;
  // De fabriek en Logic4 gebruiken andere woorden voor dezelfde kleur. Chantal:
  // wat op de proforma "Sterling Silver jazzi color #30" heet, staat in Logic4
  // als "Sterling White". Zonder deze vertaling matchte alleen "sterling" en
  // kwam er een willekeurige variant uit.
  const kleurVertaling = [[/sterling\s*silver/g, "sterling white"]];
  let schoon = String(kleur || "").toLowerCase().replace(/jazzi\s*colou?r\s*#?\d*/g, "");
  for (const [van, naar] of kleurVertaling) schoon = schoon.replace(van, naar);
  schoon = schoon.replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

  // De omkasting bepaalt de trim: "1130 GREY+OAK slat" is in Logic4
  // "GREY/oak trim", "OAK+1130 GREY slat" is "OAK/grey trim". Dat onderscheid
  // levert twee verschillende artikelcodes op bij dezelfde kuipkleur.
  const s = String(skirt || "").toLowerCase();
  let trim = null;
  if (/grey\s*\+\s*oak/.test(s) || /grey.*oak\s*slat/.test(s)) trim = "grey/oak";
  else if (/oak\s*\+.*grey/.test(s) || /^oak\b/.test(s)) trim = "oak/grey";
  // De kleur zelf schrijft de omkasting soms met een schuine streep:
  // "Sterling White with Grey/Oak". De volgorde is bepalend — grey/oak en
  // oak/grey zijn twee verschillende artikelen — en daar keken we niet naar.
  else if (/grey\s*\/\s*oak/.test(s)) trim = "grey/oak";
  else if (/oak\s*\/\s*grey/.test(s)) trim = "oak/grey";

  if (schoon || trim) {
    // Woorden van drie letters telden niet mee, en juist "oak" is er zo een.
    // Daardoor scoorden "Sterling White with DARK GREY" en "Sterling White with
    // GREY/oak trim" even hoog op de kleur "Sterling White with Grey/Oak" en
    // won de eerste. Drie letters doen nu wél mee.
    const woorden = schoon.split(" ").filter(w => w.length >= 3);
    let beste = null, besteScore = 0;
    for (const v of varianten) {
      const d = String(v.desc || "").toLowerCase();
      let score = woorden.filter(w => d.includes(w)).length;
      // De trim weegt zwaar: hij is juist het onderscheid tussen twee
      // artikelen die verder identiek heten.
      if (trim && d.includes(trim)) score += 3;
      else if (trim && /grey\/oak|oak\/grey/.test(d)) score -= 2;   // de ándere trim
      if (score > besteScore) { besteScore = score; beste = v; }
    }
    if (beste && besteScore > 0) return { ...beste, zeker: modelZeker, viaAndereNaam };
  }
  // Is er maar één uitvoering, dan kan het niet mis: die nemen we.
  if (varianten.length === 1) return { ...varianten[0], zeker: false, viaAndereNaam };
  // Anders: de gevraagde kleur bestaat niet bij dit model. Vroeger pakten we
  // dan de eerste uitvoering en zetten er 'onzeker' bij — dat leverde een
  // geloofwaardige maar verkeerde artikelcode op (Aquatic 3 in Mystic Mountain
  // werd Sterling White). Nu geven we niets terug en zeggen we wat er wél is.
  const beschikbaar = [...new Set(varianten.map(v => {
    const d = String(v.desc || ""); const i = d.indexOf("|");
    return (i < 0 ? d : d.slice(i + 1)).replace(/\bspa\b/ig, "").trim();
  }))].slice(0, 6);
  return { geenKleur: true, beschikbaar };
}

async function ikoVoorstel(env, body) {
  const regels = Array.isArray(body.regels) ? body.regels : [];
  if (!regels.length) return { ok: false, error: "geen regels ontvangen" };
  const catalog = (await env.FONTEYN_DATA.get("spa-catalog", { type: "json" })) || {};
  const aliassen = ((await env.FONTEYN_DATA.get("spa-aliassen", { type: "json" })) || {}).modellen || {};
  const crediteuren = await ikoCrediteuren(env);
  // De fabriek schrijft "JAZZI POOL AND SPA PRODUCTS CO.,LTD", Logic4 heeft
  // "Jazzi pool and spa products Co., Ltd". Alleen hoofdletters en leestekens
  // verschillen, dus die halen we er aan beide kanten uit vóór het vergelijken.
  const plat = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const gevraagd = plat(body.leverancier);
  let crediteur = null;
  if (gevraagd) {
    const sleutels = Object.keys(crediteuren);
    let hit = sleutels.find(n => plat(n) === gevraagd);
    if (!hit) hit = sleutels.find(n => plat(n).includes(gevraagd) || gevraagd.includes(plat(n)));
    if (hit) crediteur = crediteuren[hit];
  }
  const uit = [], waarschuwingen = [];
  for (const r of regels) {
    const model = r.model || null;
    const art = model ? ikoZoekArtikel(catalog, model, r.kleur, r.skirt, aliassen) : null;
    if (!model) waarschuwingen.push("Onbekende fabriekscode: " + (r.code || "?"));
    else if (art && art.meerdere)
      waarschuwingen.push(model + " komt in Logic4 onder meerdere namen voor (" + art.meerdere.join(", ") + ") — kies de juiste handmatig.");
    else if (art && art.geenKleur)
      waarschuwingen.push(model + " bestaat in Logic4 niet in de kleur \"" + (r.kleur || "?") + "\"" +
        (art.beschikbaar && art.beschikbaar.length ? (" — wél in: " + art.beschikbaar.join(", ")) : "") + ".");
    else if (!art) waarschuwingen.push("Er is in Logic4 geen artikel voor " + model + " — de fabriekscode is wél herkend, maar het model zelf ontbreekt in de catalogus.");
    else if (art.viaAndereNaam) waarschuwingen.push(model + " heet in Logic4 \"" + art.viaAndereNaam + "\" — controleer of dat klopt.");
    else if (!art.zeker) waarschuwingen.push(model + ": kleur \"" + (r.kleur || "") + "\" niet herkend — controleer de artikelcode");
    uit.push({
      code: r.code || null, model, kleur: r.kleur || null, skirt: r.skirt || null,
      aantal: Number(r.aantal) || 0,
      prijs: r.prijs != null ? Number(r.prijs) : null,
      artikelcode: (art && !art.meerdere && !art.geenKleur) ? art.code : null,
      productId: (art && !art.meerdere && !art.geenKleur) ? art.productId : null,
      omschrijving: (art && !art.meerdere && !art.geenKleur) ? art.desc : null,
      zeker: (art && !art.meerdere && !art.geenKleur) ? !!art.zeker : false,
    });
  }
  if (!crediteur) waarschuwingen.push("Leverancier \"" + (body.leverancier || "") + "\" niet gevonden in Logic4 — kies hem handmatig.");
  return {
    ok: true, crediteur, leveranciers: Object.values(crediteuren).map(c => ({ id: c.id, naam: c.naam })).sort((a, b) => a.naam.localeCompare(b.naam)),
    regels: uit, waarschuwingen,
    totaalStuks: uit.reduce((n, x) => n + x.aantal, 0),
    kanAanmaken: !!crediteur && uit.every(x => x.artikelcode) && uit.length > 0,
  };
}

async function ikoAanmaken(env, body) {
  const crediteurId = Number(body.crediteurId);
  const regels = Array.isArray(body.regels) ? body.regels : [];
  if (!crediteurId) return { ok: false, error: "geen leverancier gekozen" };
  if (!regels.length) return { ok: false, error: "geen regels" };
  if (regels.some(r => !r.artikelcode || !(Number(r.aantal) > 0)))
    return { ok: false, error: "elke regel heeft een artikelcode en een aantal groter dan nul nodig" };

  // Dubbel aanmaken voorkomen: dezelfde proforma-referentie mag maar één keer.
  // Zonder dit levert een dubbele klik twee inkooporders op bij de fabriek.
  const ref = String(body.referentie || "").trim();
  const reeds = (await env.FONTEYN_DATA.get("voorraad-inkooporders", { type: "json" })) || { orders: {} };
  // aanvullenOp = regels bijzetten in een inkooporder die er al is, in plaats
  // van een tweede aanmaken. Nodig omdat een proforma soms maar half wordt
  // besteld: bij de Jazzi-orders 3317, 3332 en 3342 bleven modellen liggen
  // waarvan de code toen nog niet in de catalogus stond, en die stonden daarna
  // nergens meer. Zonder deze route was de enige uitweg een tweede
  // inkooporder bij dezelfde fabriek, en dat is precies wat je niet wilt.
  const aanvullenOp = body.aanvullenOp != null ? Number(body.aanvullenOp) : null;
  if (ref && reeds.orders[ref] && !body.tochOpnieuw && !aanvullenOp) {
    return { ok: false, dubbel: true, bestaandeOrder: reeds.orders[ref].buyOrderId,
      error: "Voor proforma " + ref + " is al inkooporder " + reeds.orders[ref].buyOrderId + " aangemaakt op " + reeds.orders[ref].ts + "." };
  }

  const token = await l4Token(env);
  const call = async (pad, payload) => {
    const r = await fetch("https://api.logic4server.nl" + pad, {
      method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const tekst = await r.text();
    let j = null; try { j = JSON.parse(tekst); } catch (e) {}
    if (!r.ok) throw new Error(pad + " → HTTP " + r.status + " " + tekst.slice(0, 200));
    return j;
  };

  // Wat er bewust NIET is meebesteld hoort in de order zelf te staan, anders is
  // later niet te zien waarom de inkooporder afwijkt van de proforma.
  const overgeslagen = Array.isArray(body.overgeslagen) ? body.overgeslagen : [];
  let buyOrderId = aanvullenOp;
  if (!buyOrderId) {
    const kop = await call("/v3/BuyOrders/CreateBuyOrder", {
      CreditorId: crediteurId,
      Remarks: ("Proforma " + (ref || "") + " — via dashboard door " + (body.door || "onbekend") +
        (body.bestemming ? (" — bestemming: " + body.bestemming) : "") +
        (overgeslagen.length ? (" — NIET meebesteld: " + overgeslagen.join(", ")) : "")).trim().slice(0, 500),
      CreatedAt: new Date().toISOString(),
    });
    buyOrderId = kop && (kop.Id != null ? kop.Id : (kop.BuyOrderId != null ? kop.BuyOrderId : (kop.Value != null ? kop.Value : null)));
    if (buyOrderId == null) throw new Error("Logic4 gaf geen inkoopordernummer terug: " + JSON.stringify(kop).slice(0, 200));
  } else {
    // Bestaat die inkooporder wel, en welke artikelen staan er al op? Dezelfde
    // regel twee keer toevoegen zou stilletjes het dubbele bestellen.
    const bestaand = await call("/v3/BuyOrders/GetBuyOrderRowsByFilter", { BuyOrderId: buyOrderId, TakeRecords: 500 });
    const rijen = Array.isArray(bestaand) ? bestaand : ((bestaand && bestaand.Records) || []);
    const alAanwezig = new Set(rijen.map(x => String(x.ProductCode || "")));
    const dubbelOp = regels.filter(r => alAanwezig.has(String(r.artikelcode)));
    if (dubbelOp.length && !body.tochDubbeleRegels)
      return { ok: false, dubbeleRegels: dubbelOp.map(r => r.artikelcode),
        error: "Deze artikelen staan al op inkooporder " + buyOrderId + ": " + dubbelOp.map(r => r.artikelcode).join(", ") +
          ". Aanvullen zou het aantal verdubbelen." };
  }

  const toegevoegd = [], mislukt = [];
  for (const r of regels) {
    try {
      await call("/v3/BuyOrders/AddBuyOrderRow", {
        BuyOrderId: buyOrderId,
        ProductCode: String(r.artikelcode),
        QtyToOrder: Number(r.aantal),
        Price: r.prijs != null ? Number(r.prijs) : 0,
        Description: String(r.omschrijving || r.model || "").slice(0, 200),
        ExpectedDeliveryDate: body.eta || null,
      });
      toegevoegd.push(r.artikelcode);
    } catch (e) { mislukt.push({ artikelcode: r.artikelcode, fout: String(e.message || e) }); }
  }

  if (ref) {
    reeds.orders = reeds.orders || {};
    const eerder = reeds.orders[ref] || null;
    reeds.orders[ref] = { buyOrderId, ts: new Date().toISOString(), door: body.door || null,
      regels: (eerder && aanvullenOp ? (Number(eerder.regels) || 0) : 0) + toegevoegd.length };
    // Aanvullingen apart bijhouden: anders is later niet te zien dat er in twee
    // keer is besteld, en juist dát was hier het probleem.
    if (aanvullenOp) {
      reeds.orders[ref].aanvullingen = (eerder && eerder.aanvullingen ? eerder.aanvullingen : []).concat([{
        ts: new Date().toISOString(), door: body.door || null, regels: toegevoegd.length,
        artikelen: toegevoegd.slice(0, 40),
      }]);
    }
    await env.FONTEYN_DATA.put("voorraad-inkooporders", JSON.stringify(reeds));
  }
  return { ok: mislukt.length === 0, buyOrderId, toegevoegd: toegevoegd.length, mislukt,
    aangevuld: !!aanvullenOp };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SPA-INKOOP NAAR LOGIC4
   ═══════════════════════════════════════════════════════════════════════════

   De spa-inkoop liep buiten Logic4 om, omdat Jazzi niet in Logic4 kan. Chantal
   hield de bestellingen daarom in het dashboard bij: bucket 'voorraad-pipeline'
   (containers = Jazzi-ordernummers, met per regel model/kleur/aantal) en
   'voorraad-schepen' (deelleveringen met vaartuig en ETA).

   Dat is een tweede administratie geworden. Gevolg: de grootste productgroep
   van het bedrijf ontbreekt in de geld-goederenbeweging — er staat omzet
   tegenover een inkoop die in Logic4 niet bestaat.

   Deze functies zetten die lijst om in ECHTE inkooporders bij Jazzi:
     • één inkooporder per containernummer (= één Jazzi-order)
     • regels op artikelcode, gevonden via de spa-catalogus
     • ETA uit het schip dat bij die order hoort
     • referentie "Jazzi-order <nr>", zodat er nooit twee van worden gemaakt

   Wat NIET automatisch gaat, gaat ook niet automatisch: regels waarvan het
   model of de kleur niet met zekerheid te herleiden is, blijven staan tot een
   mens kiest. Die keuze wordt bewaard in 'spa-aliassen' en geldt daarna overal,
   ook voor de proforma-koppeling.
   ═══════════════════════════════════════════════════════════════════════════ */

const JAZZI_CREDITEUR = 160181;   // "Jazzi pool and spa products Co., Ltd"

// Welke containers zijn nog actueel? De oude bestellingen zijn allang geleverd;
// die alsnog als openstaande inkooporder aanmaken zou precies de fout maken die
// de accountant aanwijst (goederen die volgens de administratie nog moeten
// komen). Een container telt als actueel zolang er een schip naar verwijst, of
// zolang hij korter dan een jaar geleden is besteld.
function spaContainerActueel(container, schipRefs) {
  const nr = String(container.nr || "").trim();
  if (nr && schipRefs.has(nr)) return { actueel: true, reden: "er vaart nog een schip met deze order" };
  const besteld = container.besteld ? new Date(container.besteld).getTime() : NaN;
  if (!isFinite(besteld)) return { actueel: false, reden: "geen geldige besteldatum" };
  const dagen = Math.round((Date.now() - besteld) / 86400000);
  if (dagen <= 365) return { actueel: true, reden: besteld ? (dagen + " dagen geleden besteld") : "" };
  return { actueel: false, reden: dagen + " dagen geleden besteld — vrijwel zeker allang geleverd" };
}

// Uit "RZ2009DF3317-5&3332-2 to Rotterdam" komen de ordernummers 3317 en 3332.
// Eén schip bevat vaak deelleveringen van twee Jazzi-orders.
function spaOrdersUitSchip(ref) {
  const uit = new Set();
  const m = String(ref || "").match(/\d{4}(?=-\d)/g) || [];
  for (const x of m) uit.add(x);
  return uit;
}

async function spaMigratieVoorstel(env) {
  const pipeline = (await env.FONTEYN_DATA.get("voorraad-pipeline", { type: "json" })) || {};
  const schepen = (await env.FONTEYN_DATA.get("voorraad-schepen", { type: "json" })) || {};
  const catalog = (await env.FONTEYN_DATA.get("spa-catalog", { type: "json" })) || {};
  const aliassen = ((await env.FONTEYN_DATA.get("spa-aliassen", { type: "json" })) || {}).modellen || {};
  const gedaan = (await env.FONTEYN_DATA.get("voorraad-inkooporders", { type: "json" })) || { orders: {} };

  // Welke ordernummers varen er nog, en met welke ETA?
  const schipRefs = new Set(), etaPerOrder = {};
  for (const s of (schepen.ships || [])) {
    for (const nr of spaOrdersUitSchip(s.ref)) {
      schipRefs.add(nr);
      // De vroegste ETA is de eerstvolgende aankomst van deze order.
      if (s.eta && (!etaPerOrder[nr] || s.eta < etaPerOrder[nr])) etaPerOrder[nr] = s.eta;
    }
  }

  const containers = [];
  for (const c of (pipeline.containers || [])) {
    const nr = String(c.nr || "").trim();
    const ref = "Jazzi-order " + nr;
    const status = spaContainerActueel(c, schipRefs);
    const regels = [];
    let zeker = 0, nakijken = 0, onmogelijk = 0, spas = 0;

    for (const l of (c.lines || [])) {
      const aantal = Number(l.qty) || 0;
      spas += aantal;
      const art = ikoZoekArtikel(catalog, l.model, l.color, l.color, aliassen);
      let staat = "onmogelijk", uitleg = "", code = null, omschrijving = "";
      if (art && art.code) {
        code = art.code; omschrijving = art.desc || "";
        if (art.zeker) { staat = "zeker"; zeker++; }
        else {
          staat = "nakijken"; nakijken++;
          uitleg = art.viaAndereNaam ? ("heet in Logic4 \"" + art.viaAndereNaam + "\"") : "kleur niet zeker herkend";
        }
      } else if (art && art.geenKleur) {
        onmogelijk++;
        uitleg = "deze kleur bestaat niet bij dit model" + (art.beschikbaar && art.beschikbaar.length ? (" — wél: " + art.beschikbaar.join(", ")) : "");
      } else if (art && art.meerdere) {
        onmogelijk++;
        uitleg = "meerdere modellen mogelijk: " + art.meerdere.join(", ");
      } else {
        onmogelijk++;
        uitleg = "model onbekend in de spa-catalogus";
      }
      regels.push({
        model: l.model || "", kleur: l.color || "", aantal: aantal,
        artikelcode: code, artikelnaam: omschrijving, staat: staat, uitleg: uitleg
      });
    }

    containers.push({
      nr: nr, besteld: c.besteld || null, eta: etaPerOrder[nr] || c.eta || null,
      herkomst: c.herkomst || null,
      // Uit welk bestand deze bestelling is ingelezen, door wie en wanneer.
      // Anders is later niet meer na te gaan hoe hij in het dashboard kwam.
      import: c.import || null,
      actueel: status.actueel, reden: status.reden,
      alGedaan: gedaan.orders && gedaan.orders[ref] ? gedaan.orders[ref].buyOrderId : null,
      // Wie hem heeft aangemaakt en wanneer. Chantal zag op 5 aug 2026 drie
      // inkooporders staan en kon nergens zien waar die vandaan kwamen; haar
      // conclusie was dat het systeem ze zelf had gemaakt. Dat gebeurt niet -
      // er komt geen inkooporder zonder dat een mens op de knop drukt - maar
      // dat moet je dan wel kunnen zíen.
      gedaanDoor: gedaan.orders && gedaan.orders[ref] ? (gedaan.orders[ref].door || null) : null,
      gedaanOp: gedaan.orders && gedaan.orders[ref] ? (gedaan.orders[ref].ts || null) : null,
      spas: spas, zeker: zeker, nakijken: nakijken, onmogelijk: onmogelijk,
      referentie: ref, regels: regels
    });
  }

  containers.sort((a, b) => String(b.besteld || "").localeCompare(String(a.besteld || "")));
  return {
    ok: true, crediteur: JAZZI_CREDITEUR, containers: containers,
    schepen: (schepen.ships || []).map(s => ({
      ref: s.ref, vessel: s.vessel, eta: s.eta, containers: s.containers,
      orders: [...spaOrdersUitSchip(s.ref)]
    })),
    aliassen: aliassen
  };
}

// Eén container omzetten naar een inkooporder.
//
// LET OP — Cloudflare-limiet. De worker zit op het gratis plan en mag per
// aanroep maximaal 50 externe verzoeken doen. Een inkooporder met 78 regels
// is 1 + 78 verzoeken en loopt daar dus hard tegenaan: de eerste keer bleef
// order 3317 met 47 van de 78 regels achter. Daarom werkt dit nu in porties.
// De aanroeper herhaalt tot 'klaar' waar is.
//
// De functie is bewust herstelbaar: hij kijkt eerst welke artikelen al op de
// order staan en voegt alleen toe wat ontbreekt. Opnieuw aanroepen kan dus
// nooit dubbele regels opleveren, ook niet na een half mislukte poging.
const SPA_REGELS_PER_KEER = 30;

async function spaMigratieUitvoeren(env, body) {
  const nr = String(body.nr || "").trim();
  if (!nr) return { ok: false, error: "geen containernummer" };
  const voorstel = await spaMigratieVoorstel(env);
  const c = voorstel.containers.find(x => x.nr === nr);
  if (!c) return { ok: false, error: "container " + nr + " niet gevonden" };

  const mee = c.regels.filter(r => r.artikelcode && (body.ookNakijken || r.staat === "zeker"));
  const over = c.regels.filter(r => mee.indexOf(r) < 0);
  if (!mee.length) return { ok: false, error: "geen enkele regel van container " + nr + " is met zekerheid te koppelen" };

  const token = await l4Token(env);
  const call = async (pad, payload) => {
    const r = await fetch("https://api.logic4server.nl" + pad, {
      method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const tekst = await r.text();
    let j = null; try { j = JSON.parse(tekst); } catch (e) {}
    if (!r.ok) throw new Error("HTTP " + r.status + " " + tekst.slice(0, 200));
    return j;
  };

  // Bestaat de order al? Dan vullen we hem aan in plaats van een tweede te maken.
  let buyOrderId = Number(body.buyOrderId) || c.alGedaan || null;
  let nieuw = false;
  if (!buyOrderId) {
    const kop = await call("/v3/BuyOrders/CreateBuyOrder", {
      CreditorId: JAZZI_CREDITEUR,
      Remarks: (c.referentie + " — via dashboard door " + (body.door || "onbekend") +
        (c.herkomst ? (" — herkomst: " + c.herkomst) : "") +
        (over.length ? (" — NIET meegenomen: " + over.map(r => r.model + " " + r.kleur + " (" + r.aantal + "x)").join(", ")) : "")
      ).slice(0, 500),
      CreatedAt: new Date().toISOString(),
    });
    buyOrderId = kop && (kop.Id != null ? kop.Id : (kop.BuyOrderId != null ? kop.BuyOrderId : kop.Value));
    if (buyOrderId == null) return { ok: false, error: "Logic4 gaf geen inkoopordernummer terug" };
    nieuw = true;
    const reeds = (await env.FONTEYN_DATA.get("voorraad-inkooporders", { type: "json" })) || { orders: {} };
    reeds.orders = reeds.orders || {};
    reeds.orders[c.referentie] = { buyOrderId, ts: new Date().toISOString(), door: body.door || null, regels: 0 };
    await env.FONTEYN_DATA.put("voorraad-inkooporders", JSON.stringify(reeds));
  }

  // Wat staat er al op? Alleen aanvullen wat ontbreekt.
  const bestaand = {};
  if (!nieuw) {
    const rijen = await call("/v3/BuyOrders/GetBuyOrderRowsByFilter", { BuyOrderId: buyOrderId, TakeRecords: 1000, SkipRecords: 0 });
    for (const r of (rijen && rijen.Records ? rijen.Records : rijen) || []) {
      const code = String(r.ProductCode);
      bestaand[code] = (bestaand[code] || 0) + (Number(r.QtyToOrder) || 0);
    }
  }

  const teDoen = [];
  const nogNodig = Object.assign({}, bestaand);
  for (const r of mee) {
    const code = String(r.artikelcode);
    if (nogNodig[code] >= r.aantal) { nogNodig[code] -= r.aantal; continue; }
    teDoen.push(r);
  }

  const portie = teDoen.slice(0, SPA_REGELS_PER_KEER);
  const toegevoegd = [], mislukt = [];
  for (const r of portie) {
    try {
      await call("/v3/BuyOrders/AddBuyOrderRow", {
        BuyOrderId: buyOrderId,
        ProductCode: String(r.artikelcode),
        QtyToOrder: Number(r.aantal),
        Price: 0,
        Description: String(r.artikelnaam || (r.model + " " + r.kleur)).slice(0, 200),
        ExpectedDeliveryDate: c.eta || null,
      });
      toegevoegd.push(r.artikelcode);
    } catch (e) { mislukt.push({ artikelcode: r.artikelcode, model: r.model, kleur: r.kleur, fout: String(e.message || e) }); }
  }

  const restant = Math.max(0, teDoen.length - portie.length);
  return {
    ok: mislukt.length === 0 && restant === 0,
    buyOrderId, nieuw,
    toegevoegd: toegevoegd.length,
    mislukt,
    resterend: restant,
    klaar: restant === 0,
    totaalRegels: mee.length,
    overgeslagen: over.length
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   FLEXPORT — de expediteur als bron voor waar de containers zijn
   ═══════════════════════════════════════════════════════════════════════════

   Chantal hield met de hand bij welk schip welke spa's vervoert en wanneer het
   aankomt. Flexport, de expediteur, weet dat zelf en houdt het actueel. Die
   koppeling haalt dus niet alleen werk weg, hij is ook betrouwbaarder: bij
   vertraging verandert de datum bij Flexport, niet in een Excel.

   Hoe de koppeling met onze inkooporders loopt
   --------------------------------------------
   Flexport kent onze Jazzi-ordernummers niet als veld. Ze staan in de vrije
   naam van de zending, in dezelfde notatie die Chantal ook gebruikt:
   "3205-1&3224-1，荷兰8柜" bevat de orders 3205 en 3224. Daar halen we ze uit,
   met hetzelfde patroon als bij de schepen.

   Twee dingen om te weten
   -----------------------
   • De API valt zonder versie-header terug op v1, en v1 werkt niet met deze
     credentials. Vandaar Flexport-Version op elke aanroep.
   • Er mogen maar 10 tokens per dag worden opgehaald. Een token is 24 uur
     geldig, dus we bewaren hem in KV en halen alleen een nieuwe als hij
     bijna verloopt. Zonder dat zit je na tien aanroepen een dag op slot.
   ═══════════════════════════════════════════════════════════════════════════ */

const FLEXPORT_API = "https://api.flexport.com";
const FLEXPORT_VERSIE = "2023-07-01";

async function flexportToken(env) {
  const bewaard = await env.FONTEYN_DATA.get("flexport-token", { type: "json" });
  // Ruim voor het verlopen verversen, maar niet elke keer: 10 per dag is de limiet.
  if (bewaard && bewaard.token && bewaard.verlooptOp && (Date.parse(bewaard.verlooptOp) - Date.now()) > 3600000)
    return bewaard.token;

  const r = await fetch(FLEXPORT_API + "/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.FLEXPORT_CLIENT_ID, client_secret: env.FLEXPORT_CLIENT_SECRET,
      audience: FLEXPORT_API, grant_type: "client_credentials",
    }),
  });
  const tekst = await r.text();
  if (!r.ok) throw new Error("Flexport-token: HTTP " + r.status + " " + tekst.slice(0, 200));
  const j = JSON.parse(tekst);
  if (!j.access_token) throw new Error("Flexport gaf geen token terug");
  // De vervaldatum zit in het token zelf.
  let verlooptOp = new Date(Date.now() + 23 * 3600000).toISOString();
  try {
    const p = JSON.parse(atob(j.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (p.exp) verlooptOp = new Date(p.exp * 1000).toISOString();
  } catch (e) { /* dan de veilige schatting */ }
  await env.FONTEYN_DATA.put("flexport-token", JSON.stringify({ token: j.access_token, verlooptOp, opgehaald: new Date().toISOString() }));
  return j.access_token;
}

async function flexport(env, pad) {
  const token = await flexportToken(env);
  const r = await fetch(FLEXPORT_API + pad, {
    headers: { "Authorization": "Bearer " + token, "Flexport-Version": FLEXPORT_VERSIE, "Content-Type": "application/json" },
  });
  const tekst = await r.text();
  if (!r.ok) throw new Error(pad + " → HTTP " + r.status + " " + tekst.slice(0, 200));
  return JSON.parse(tekst);
}

// Alle pagina's van een Flexport-lijst. Per aanroep 100, en de worker mag op het
// gratis plan 50 externe verzoeken doen — vandaar de harde grens.
async function flexportAlles(env, pad, maxPaginas = 30) {
  const uit = [];
  for (let p = 1; p <= maxPaginas; p++) {
    const j = await flexport(env, pad + (pad.includes("?") ? "&" : "?") + "per=100&page=" + p);
    const d = (j.data && j.data.data) || [];
    uit.push(...d);
    if (!j.data || !j.data.next || d.length < 100) break;
  }
  return uit;
}

// "3205-1&3224-1，荷兰8柜" → ["3205","3224"]. Zelfde notatie als op de schepen.
function jazziOrdersUitTekst(tekst) {
  return [...new Set((String(tekst || "").match(/\b3\d{3}(?=-\d)/g) || []))];
}

// Het volledige overzicht ophalen duurt bij Flexport ruim twee minuten. Dat wil
// je niet bij elke schermweergave, dus het resultaat gaat in KV en wordt daaruit
// geserveerd tot het een paar uur oud is. Met 'vers' forceer je een verse ronde.
const FLEXPORT_CACHE_UREN = 6;

async function flexportOverzicht(env, vers) {
  if (!vers) {
    const bewaard = await env.FONTEYN_DATA.get("flexport-zendingen", { type: "json" });
    if (bewaard && bewaard.opgehaald && (Date.now() - Date.parse(bewaard.opgehaald)) < FLEXPORT_CACHE_UREN * 3600000)
      return Object.assign({}, bewaard, { uitCache: true });
  }
  const uitkomst = await flexportVers(env);
  await env.FONTEYN_DATA.put("flexport-zendingen", JSON.stringify(uitkomst));
  return uitkomst;
}

async function flexportVers(env) {
  const zendingen = await flexportAlles(env, "/shipments", 12);
  const containers = await flexportAlles(env, "/ocean/shipment_containers", 12);

  const perZending = {};
  for (const c of containers) {
    const id = c.shipment && c.shipment.id;
    if (!id) continue;
    (perZending[id] = perZending[id] || []).push(c);
  }

  const uit = zendingen.map(z => {
    const cs = perZending[z.id] || [];
    const eta = cs.map(c => c.estimated_arrival_date).filter(Boolean).sort()[0] || z.estimated_arrival_date || null;
    const aan = cs.map(c => c.actual_arrival_date).filter(Boolean).sort();
    return {
      id: z.id, naam: z.naam || z.name || "", status: z.status || "",
      jazziOrders: jazziOrdersUitTekst(z.name),
      eta: eta ? String(eta).slice(0, 10) : null,
      aangekomen: aan.length === cs.length && aan.length ? String(aan[aan.length - 1]).slice(0, 10) : null,
      vertrek: z.estimated_departure_date ? String(z.estimated_departure_date).slice(0, 10) : null,
      containers: cs.map(c => ({
        nr: c.container_number, maat: c.container_size,
        eta: c.estimated_arrival_date ? String(c.estimated_arrival_date).slice(0, 10) : null,
        aangekomen: c.actual_arrival_date ? String(c.actual_arrival_date).slice(0, 10) : null,
        afgeleverd: c.actual_delivery_date ? String(c.actual_delivery_date).slice(0, 10) : null,
        // De dag waarna de rederij demurrage rekent. Kost geld en zag niemand.
        laatsteVrijeDag: c.last_free_day_date ? String(c.last_free_day_date).slice(0, 10) : null,
      })),
    };
  });

  uit.sort((a, b) => String(b.eta || "").localeCompare(String(a.eta || "")));
  return { ok: true, opgehaald: new Date().toISOString(), zendingen: uit, aantalContainers: containers.length };
}

/* ═══════════════════════════════════════════════════════════════════════════
   DOCUMENTENKETEN JAZZI — van commercial invoice naar de inkooporder
   ═══════════════════════════════════════════════════════════════════════════

   Wat er nu gebeurt
   -----------------
   Jazzi mailt een commercial invoice met packing list zodra een deellevering
   het schip op gaat. Die wordt in het dashboard ingelezen en beland in bucket
   'voorraad-schepen'. In Logic4 gebeurt er niets: de inkooporder blijft staan
   met de datum die er bij het bestellen in is gezet, of met niets.

   Wat er hoort te gebeuren
   ------------------------
   Een commercial invoice zegt: déze spa's van déze Jazzi-order zitten op dit
   schip en komen op deze datum aan. Dat is precies de verwachte leverdatum op
   de inkooporderregel. Zetten we die, dan staat in Logic4 zelf wanneer de
   goederen komen — en klopt het overzicht 'in productie / onderweg' zonder
   tweede administratie.

   Twee stappen, bewust gescheiden
   -------------------------------
   1. VERSCHEEPT  — commercial invoice binnen. Alleen de verwachte leverdatum
      bijwerken. Er verandert niets aan de voorraad, want de goederen varen nog.
   2. ONTVANGEN   — de container staat fysiek in Uddel. Pas dán een
      inkooplevering boeken, want dat verhoogt de voorraad.

   Stap 2 automatisch doen op het moment dat de factuur binnenkomt zou goederen
   in de voorraad zetten die nog vier weken op zee liggen. Precies het soort
   afwijking dat de accountant nu al niet kan verklaren. Daarom is stap 2 een
   handeling van het magazijn, met dit scherm als voorbereiding.
   ═══════════════════════════════════════════════════════════════════════════ */

// Uit de opmerking van een inkooporder het Jazzi-ordernummer halen. Zo is de
// koppeling schip → inkooporder te leggen zonder een eigen tabel bij te houden.
function jazziOrderUitRemarks(remarks) {
  var m = String(remarks || "").match(/Jazzi-order\s*(\d{3,6})/i);
  return m ? m[1] : null;
}

async function spaOntvangstVoorstel(env) {
  const schepen = (await env.FONTEYN_DATA.get("voorraad-schepen", { type: "json" })) || {};
  const catalog = (await env.FONTEYN_DATA.get("spa-catalog", { type: "json" })) || {};
  const aliassen = ((await env.FONTEYN_DATA.get("spa-aliassen", { type: "json" })) || {}).modellen || {};
  const token = await l4Token(env);

  const call = async (pad, payload, methode) => {
    const r = await fetch("https://api.logic4server.nl" + pad, {
      method: methode || "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: methode === "GET" ? undefined : JSON.stringify(payload || {}),
    });
    const tekst = await r.text();
    let j = null; try { j = JSON.parse(tekst); } catch (e) {}
    if (!r.ok) throw new Error(pad + " → HTTP " + r.status + " " + tekst.slice(0, 200));
    return j && j.Records !== undefined ? j.Records : j;
  };

  // Alle open inkooporders bij Jazzi, op Jazzi-ordernummer.
  const orders = {};
  let skip = 0;
  for (let p = 0; p < 20; p++) {
    const r = await call("/v3/BuyOrders/GetBuyOrders",
      { SupplierId: JAZZI_CREDITEUR, BuyOrderIsClosed: false, TakeRecords: 500, SkipRecords: skip });
    if (!r || !r.length) break;
    for (const bo of r) {
      const nr = jazziOrderUitRemarks(bo.Remarks);
      if (nr) orders[nr] = { buyOrderId: bo.Id, remarks: bo.Remarks, regels: [] };
    }
    if (r.length < 500) break;
    skip += 500;
  }

  // De regels van die inkooporders erbij.
  for (const nr of Object.keys(orders)) {
    const rijen = await call("/v3/BuyOrders/GetBuyOrderRowsByFilter",
      { BuyOrderId: orders[nr].buyOrderId, TakeRecords: 1000, SkipRecords: 0 });
    orders[nr].regels = rijen || [];
  }

  // Artikelcode → modelnaam, om op model terug te kunnen vallen.
  const codeNaarModel = {};
  for (const [model, varianten] of Object.entries(catalog.models || {}))
    for (const v of varianten) codeNaarModel[String(v.code)] = model;

  // Per schip: welke regels horen erbij?
  const uit = [];
  for (const s of (schepen.ships || [])) {
    const hoortBij = [...spaOrdersUitSchip(s.ref)];
    const regels = [];
    let raak = 0, mis = 0;

    const kleuren = s.modelColors || {};
    for (const model of Object.keys(s.models || {})) {
      // Staat er een kleurverdeling, gebruik die; anders het model als geheel.
      const perKleur = kleuren[model] && Object.keys(kleuren[model]).length
        ? kleuren[model] : { "": s.models[model] };
      for (const kleur of Object.keys(perKleur)) {
        const aantal = Number(perKleur[kleur]) || 0;
        if (!aantal) continue;
        const art = ikoZoekArtikel(catalog, model, kleur, kleur, aliassen);
        const code = art && art.code ? String(art.code) : null;

        // Zoek een inkooporderregel met dit artikel op een van de orders van
        // dit schip. Zonder artikelcode kan dat niet — dan blijft het staan.
        let treffer = null, viaModel = false, keuzes = null;
        if (code) {
          for (const nr of hoortBij) {
            const o = orders[nr];
            if (!o) continue;
            const r = (o.regels || []).find(x => String(x.ProductCode) === code);
            if (r) { treffer = { jazziOrder: nr, buyOrderId: o.buyOrderId, rij: r }; break; }
          }
        }
        // Terugval op model. De commercial invoice noemt de omkasting vaak niet
        // ("Sterling Silver, #30"), de bestelling wel ("Sterling White with
        // Grey/Oak"). Dan verschilt de artikelcode terwijl het om dezelfde spa
        // gaat. Staat er van dat model precies één regel op de inkooporder,
        // dan is dat hem — een container bevat immers wat er besteld is.
        // Zijn er meerdere uitvoeringen besteld, dan gokken we niet.
        if (!treffer) {
          const model0 = (code && codeNaarModel[code]) ||
            (art && art.viaAndereNaam) || model;
          const kandidaten = [];
          for (const nr of hoortBij) {
            const o = orders[nr];
            if (!o) continue;
            for (const r of (o.regels || [])) {
              if (codeNaarModel[String(r.ProductCode)] === model0)
                kandidaten.push({ jazziOrder: nr, buyOrderId: o.buyOrderId, rij: r });
            }
          }
          if (kandidaten.length === 1) { treffer = kandidaten[0]; viaModel = true; }
          else if (kandidaten.length > 1) keuzes = kandidaten.map(k => String(k.rij.ProductCode));
        }
        if (treffer) raak++; else mis++;
        regels.push({
          model: model, kleur: kleur, aantal: aantal,
          artikelcode: code, artikelnaam: art && art.desc ? art.desc : "",
          zeker: !!(art && art.zeker) && !viaModel,
          viaModel: viaModel,
          jazziOrder: treffer ? treffer.jazziOrder : null,
          buyOrderId: treffer ? treffer.buyOrderId : null,
          buyOrderRowId: treffer ? treffer.rij.BuyOrderRowId : null,
          productId: treffer ? treffer.rij.ProductId : null,
          besteld: treffer ? Number(treffer.rij.QtyToOrder) || 0 : null,
          nogTeLeveren: treffer ? Number(treffer.rij.QtyToDeliver) || 0 : null,
          huidigeEta: treffer ? treffer.rij.ExpectedDeliveryDate : null,
          prijs: treffer ? Number(treffer.rij.Price) || 0 : 0,
          reden: treffer
            ? (viaModel ? "gekoppeld op model — de invoice noemt de omkasting niet, de bestelling wel" : "")
            : (keuzes
              ? "dit model is in meerdere uitvoeringen besteld (" + keuzes.join(", ") + ") — kies zelf welke"
              : (code
                ? "geen inkooporderregel met dit artikel op order " + hoortBij.join(" of ")
                : "artikel niet te herleiden uit model en kleur"))
        });
      }
    }

    uit.push({
      ref: s.ref, vessel: s.vessel || "", eta: s.eta || null,
      containers: s.containers || null, bestand: s.file || "",
      jazziOrders: hoortBij,
      // Welke van die orders bestaan al als inkooporder in Logic4?
      gekoppeld: hoortBij.filter(nr => !!orders[nr]),
      ontbreekt: hoortBij.filter(nr => !orders[nr]),
      spas: regels.reduce((t, r) => t + r.aantal, 0),
      raak: raak, mis: mis, regels: regels
    });
  }

  uit.sort((a, b) => String(a.eta || "9999").localeCompare(String(b.eta || "9999")));
  return { ok: true, schepen: uit, inkooporders: Object.keys(orders).length };
}

// Stap 1 — verscheept: de verwachte leverdatum op de inkooporderregels zetten.
// Verandert niets aan de voorraad.
async function spaOntvangstEta(env, body) {
  const ref = String(body.ref || "").trim();
  if (!ref) return { ok: false, error: "geen schip opgegeven" };
  const voorstel = await spaOntvangstVoorstel(env);
  const schip = voorstel.schepen.find(s => s.ref === ref);
  if (!schip) return { ok: false, error: "schip " + ref + " niet gevonden" };
  const eta = String(body.eta || schip.eta || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eta)) return { ok: false, error: "geen bruikbare aankomstdatum" };

  const token = await l4Token(env);
  const bijgewerkt = [], mislukt = [], overgeslagen = [];
  for (const r of schip.regels) {
    if (!r.buyOrderRowId) continue;
    // Eén inkooporderregel kan over meerdere schepen verdeeld zijn: van tien
    // bestelde Sensations varen er vier nu en zes later. De regel kan maar één
    // datum dragen, en dan is de eerstvolgende aankomst de bruikbare. Daarom
    // alleen vervroegen, nooit verlaten — anders hangt de uitkomst af van de
    // volgorde waarin iemand de schepen aanklikt.
    if (!body.forceer && r.huidigeEta) {
      const nu = String(r.huidigeEta).slice(0, 10);
      if (nu <= eta) { overgeslagen.push({ regel: r.buyOrderRowId, staatAl: nu }); continue; }
    }
    try {
      const resp = await fetch("https://api.logic4server.nl/v3/BuyOrders/UpdateBuyOrderRow", {
        method: "PATCH",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          BuyOrderRowId: r.buyOrderRowId,
          ExpectedDeliveryDate: eta,
          // Logic4 verwacht bij een PATCH ook prijs en aantal terug; laten we
          // die weg, dan zet hij ze op nul.
          Price: r.prijs, QtyToOrder: r.besteld
        }),
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status + " " + (await resp.text()).slice(0, 150));
      bijgewerkt.push(r.buyOrderRowId);
    } catch (e) { mislukt.push({ regel: r.buyOrderRowId, artikel: r.artikelcode, fout: String(e.message || e) }); }
  }
  return { ok: mislukt.length === 0, eta: eta, bijgewerkt: bijgewerkt.length,
           overgeslagen: overgeslagen.length, mislukt: mislukt };
}

// Stap 2 — ontvangen: de container staat in Uddel. Dit boekt wél voorraad.
// Status 'CreatedByAPI' zodat het magazijn ziet dat het uit het dashboard komt
// en het nog kan nalopen.
async function spaOntvangstBoeken(env, body) {
  const ref = String(body.ref || "").trim();
  if (!ref) return { ok: false, error: "geen schip opgegeven" };
  const voorstel = await spaOntvangstVoorstel(env);
  const schip = voorstel.schepen.find(s => s.ref === ref);
  if (!schip) return { ok: false, error: "schip " + ref + " niet gevonden" };

  // Per inkooporder één levering: Logic4 hangt een levering aan één order.
  const perOrder = {};
  for (const r of schip.regels) {
    if (!r.buyOrderId || !r.productId || !(r.aantal > 0)) continue;
    (perOrder[r.buyOrderId] = perOrder[r.buyOrderId] || []).push({
      BuyOrderRowId: r.buyOrderRowId,
      ProductId: r.productId,
      Qty_Delivered: r.aantal,
      BuyPrice: r.prijs || undefined,
      StockLocationId: body.locatie ? Number(body.locatie) : undefined,
      Remarks: (r.model + " " + r.kleur).trim().slice(0, 100)
    });
  }
  if (!Object.keys(perOrder).length) return { ok: false, error: "geen enkele regel van dit schip is aan een inkooporderregel gekoppeld" };

  const token = await l4Token(env);
  const gemaakt = [], mislukt = [];
  for (const buyOrderId of Object.keys(perOrder)) {
    try {
      const resp = await fetch("https://api.logic4server.nl/v3/BuyOrderDeliveries/CreateBuyOrderDelivery", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          BuyOrderId: Number(buyOrderId),
          SupplierId: JAZZI_CREDITEUR,
          Status: "CreatedByAPI",
          Description: ("Container " + ref).slice(0, 100),
          Remarks: ("Aangemeld via het dashboard door " + (body.door || "onbekend") +
            (schip.vessel ? (" — schip " + schip.vessel) : "")).slice(0, 400),
          ProcessMutationButDoNotCreatePickbon: true,
          Rows: perOrder[buyOrderId]
        }),
      });
      const tekst = await resp.text();
      if (!resp.ok) throw new Error("HTTP " + resp.status + " " + tekst.slice(0, 200));
      let j = null; try { j = JSON.parse(tekst); } catch (e) {}
      gemaakt.push({ buyOrderId: Number(buyOrderId), levering: j && (j.Id || j.BuyOrderDeliveryId || j.Value) || null, regels: perOrder[buyOrderId].length });
    } catch (e) { mislukt.push({ buyOrderId: Number(buyOrderId), fout: String(e.message || e) }); }
  }
  return { ok: mislukt.length === 0, gemaakt: gemaakt, mislukt: mislukt };
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
  const statusName = { 15: "wachten op aanbetaling", 25: "30% aanbetaald", 1: "verkooporder",
    28: "gepland, wacht op betaling", 30: "volledig betaald, vrijgeven leveren" };
  const medewerkers = await l4Medewerkers(env);
  // 40 pagina's van 500 = 20.000 orders per status. Stond op 8 (4.000), en de
  // lus stopte daarna zonder een spoor achter te laten - dezelfde stille
  // afkapping die bij de grootboeklezer een verkeerd saldo opleverde. De
  // grootste status telt nu 1.168 orders per jaar, dus 4.000 werd nog niet
  // geraakt, maar dat is geen geruststelling: het zou pas opvallen als het
  // voorraadbeeld al maanden gaten had.
  const MAX_PAGINAS_ORDERS = 40;
  for (const st of DP_RESV_STATUSES) {
    let afgekapt = true;
    for (let page = 0; page < MAX_PAGINAS_ORDERS; page++) {
      const r = await fetch("https://api.logic4server.nl/v3/Orders/GetOrders", {
        method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ StatusId: st, CreationDateFrom: fromIso, TakeRecords: 500, SkipRecords: page * 500 }),
      });
      if (!r.ok) { afgekapt = false; break; }
      const data = await r.json().catch(() => []);
      const arr = Array.isArray(data) ? data : ((data && data.Orders) || []);
      if (!arr.length) { afgekapt = false; break; }
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
          // Containerorder = UITSLUITEND magazijn 'Dealer magazijn'. NIET op aantal
          // filteren: een gewone partnerorder van 4 spa's is geen container en hoort
          // gewoon bij de partner-reserveringen (Chantal, 28-07-2026).
          const container = gr.wh === WH_DEALER;
          const line = {
            ordernr: o.Id, debtorId: o.DebtorId, naam, type,
            model: gr.model, kleur: gr.kleur || null, qty: gr.qty,
            warehouseId: gr.wh, magazijn: WH_NAMES[gr.wh] || ("magazijn " + gr.wh),
            container, regio: usa ? "USA" : "NL",
            referentie: String(o.Reference || "").trim() || null,
            containerNr: dpContainerNr(o.Reference),
            // Adviseur = de medewerker die de order in Logic4 heeft gezet.
            userId: o.UserId != null ? o.UserId : null,
            adviseur: (medewerkers[String(o.UserId)] || {}).naam || null,
            adviseurUitDienst: !!(medewerkers[String(o.UserId)] || {}).uitDienst,
            // Vaste sleutel voor deze regel, zodat Chantals opmerking en
            // vinkjes eraan blijven hangen als de lijst opnieuw wordt opgehaald.
            regelId: o.Id + "|" + gr.model + "|" + (gr.kleur || "") + "|" + gr.wh,
            datum: String(o.CreationDate).slice(0, 10), statusId: st, status: statusName[st] || String(st),
            betaald, betaaldPct, aanbetaling: Math.round(aanbetaling), totaal: Math.round(totaal),
          };
          const bucket = usa ? byModelUSA : byModel;
          (bucket[gr.model] = bucket[gr.model] || []).push(line);
        }
      }
      if (arr.length < 500) { afgekapt = false; break; }
    }
    // Een half opgehaalde status levert een voorraadbeeld op dat te laag is
    // zonder dat iemand het merkt. Liever luidruchtig in de logs.
    if (afgekapt) console.log("[reserveringen] LET OP: status " + st + " raakte de paginalimiet van " +
      (MAX_PAGINAS_ORDERS * 500) + " orders. Het beeld is niet compleet - verhoog MAX_PAGINAS_ORDERS.");
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
  const productie = (await env.FONTEYN_DATA.get("voorraad-productie", { type: "json" })) || {};
  const prodByModel = productie.models || {};
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
    // Productie (open fabrieks-IKO's) ná de schepen, op ETA-volgorde
    (prodByModel[model] || [])
      .slice().sort((a, b) => String(a.eta || "9999").localeCompare(String(b.eta || "9999")))
      .forEach(p => buckets.push({ kind: "productie", eta: p.eta, left: p.qty, iko: p.iko }));
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
      if (need > 0) { r.verwacht = "productie"; r.verwachtBron = "productie"; }
      else if (landing.kind === "voorraad") { r.verwacht = "voorraad"; r.verwachtBron = "voorraad"; }
      else if (landing.eta) { r.verwacht = landing.eta; r.verwachtBron = landing.kind; }   // schip- of productie-ETA
      else { r.verwacht = landing.kind === "productie" ? "productie" : "op-schip"; r.verwachtBron = landing.kind; }
      if (landing && landing.vessel) r.verwachtSchip = landing.vessel;
      if (landing && landing.iko) r.verwachtIko = landing.iko;
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

// Een ingevoerde referentie kan gecombineerd zijn ("3317-4&3332-1", "3332-7 & 3342-3").
// Merzario zoekt op één referentie tegelijk, dus splitsen we op & , ; / en spaties
// en proberen we elk deel + de hele string. (min. 3 tekens tegen ruis)
function merzarioCandidates(ref) {
  const parts = String(ref || "").split(/[&,;/\s]+/).map(s => s.trim()).filter(s => s.length >= 3);
  return [...new Set([String(ref || "").trim(), ...parts])].filter(Boolean);
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
    // Elke stale-referentie uitbreiden naar losse zoektermen (split op & , ; / spatie)
    const candByRef = {};                        // ref → [zoektermen]
    const allCandidates = new Set();
    for (const ref of stale) {
      const cands = merzarioCandidates(ref);
      candByRef[ref] = cands;
      cands.forEach(c => allCandidates.add(c));
    }
    let arr = [];
    try {
      const r = await fetch(MERZARIO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ trackingNumbers: [...allCandidates].slice(0, 100) }),
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
    // Records terugmatchen. LET OP: Merzario's ORDERREFERENCE kan zelf gecombineerd
    // zijn ("3317-6, 3332-3"), dus ook de record-sleutels in losse tokens splitsen.
    for (const rec of arr) {
      const norm = normalizeTrackRecord(rec);
      const keyTokens = new Set();
      for (const k of [norm.container, norm.shipmentId, norm.orderReference, norm.houseBill]) {
        if (!k) continue;
        keyTokens.add(String(k).trim());
        for (const part of String(k).split(/[&,;/\s]+/)) { const p = part.trim(); if (p.length >= 3) keyTokens.add(p); }
      }
      for (const ref of stale) {
        if (out[ref]) continue;                   // al gevonden
        if ((candByRef[ref] || []).some(c => keyTokens.has(c))) {
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

// ─── Activiteitenlogboek ─────────────────────────────────────────────
// Legt vast wie wanneer inlogt en welke tegel opent. Per maand een bucket
// (activiteit-YYYY-MM). Alleen leesbaar met de team-sleutel; de viewer-tegel
// is in het dashboard bovendien beperkt tot Gerrit/Dolf/Fonteynbot.
async function handleLog(request, env) {
  const auth = request.headers.get("X-Fonteyn-Auth") || "";
  if (!env.SHARED_SECRET || auth !== env.SHARED_SECRET) return reply(401, { ok: false });
  let b = {}; try { b = await request.json(); } catch { return reply(400, { ok: false }); }
  const user = String(b.user || "").toLowerCase().slice(0, 80);
  if (!user) return reply(200, { ok: true, skipped: true });
  const action = String(b.action || "open").slice(0, 40);
  // Kijken of aanpassen? Alles wat geen inzage-actie is, telt als wijziging —
  // zo kan het logboek filteren op "wie heeft er iets veranderd".
  const INZAGE = /^(open|login|logout)$/.test(action) || /-(gecontroleerd|bekeken|geopend)$/.test(action);
  const ev = {
    ts: new Date().toISOString(),
    user,
    tile: String(b.tile || "").slice(0, 40),
    action,
    // 1200 tekens: bij 200 werd een douanepapier-omschrijving middenin een woord
    // afgekapt, waardoor niet meer te lezen was wát iemand had ingevuld.
    detail: String(b.detail || "").slice(0, 1200),
    rol: String(b.rol || "").slice(0, 30) || null,   // rechten op moment van handelen
    // Apparaat: op wélke computer gebeurde dit. Zonder dit was niet na te gaan
    // waar een onverwachte inlog vandaan kwam.
    computer: String(b.computer || "").slice(0, 60) || null,
    platform: String(b.platform || "").slice(0, 40) || null,
    versie: String(b.versie || "").slice(0, 20) || null,
    wijziging: !INZAGE,
  };
  const bucket = "activiteit-" + ev.ts.slice(0, 7);   // YYYY-MM
  const data = (await env.FONTEYN_DATA.get(bucket, { type: "json" })) || { events: [] };
  data.events = data.events || [];
  // Dubbele 'open' binnen 5 min voor dezelfde gebruiker+tegel niet nog eens
  // loggen. WIJZIGINGEN nooit dedupliceren — die moeten stuk voor stuk
  // terug te vinden zijn (wie deed wat, wanneer).
  const last = data.events[data.events.length - 1];
  const dup = !ev.wijziging && last && last.user === ev.user && last.tile === ev.tile && last.action === ev.action &&
    (Date.parse(ev.ts) - Date.parse(last.ts)) < 5 * 60000;
  if (!dup) {
    data.events.push(ev);
    if (data.events.length > 5000) data.events = data.events.slice(-5000);
    await env.FONTEYN_DATA.put(bucket, JSON.stringify(data));
  }
  return reply(200, { ok: true });
}

// ─── Partner-activiteitenlogboek ─────────────────────────────────────
// Legt server-side vast wat dealers/partners op het publieke Passion
// Partners-portaal doen: inloggen, portaal openen, reserveren, documenten
// openen, vragen stellen, wachtwoord instellen. Aparte bucket per maand
// (partner-activiteit-YYYY-MM). BEWUST server-side: de publieke site heeft
// géén team-sleutel, dus loggen vanuit de browser zou de sleutel lekken
// (én zou te vervalsen zijn). De viewer-tegel leest met de team-sleutel.
async function dpLogPartner(env, sess, action, detail) {
  try {
    if (!sess || !sess.email) return;
    const ev = {
      ts: new Date().toISOString(),
      email: String(sess.email).toLowerCase().slice(0, 120),
      company: String(sess.company || "").slice(0, 120),
      action: String(action || "open").slice(0, 40),
      detail: String(detail || "").slice(0, 200),
    };
    const bucket = "partner-activiteit-" + ev.ts.slice(0, 7);   // YYYY-MM
    const data = (await env.FONTEYN_DATA.get(bucket, { type: "json" })) || { events: [] };
    data.events = data.events || [];
    // Zelfde actie+detail binnen 5 min voor dezelfde dealer niet dubbel loggen
    const last = data.events[data.events.length - 1];
    const dup = last && last.email === ev.email && last.action === ev.action && last.detail === ev.detail &&
      (Date.parse(ev.ts) - Date.parse(last.ts)) < 5 * 60000;
    if (!dup) {
      data.events.push(ev);
      if (data.events.length > 5000) data.events = data.events.slice(-5000);
      await env.FONTEYN_DATA.put(bucket, JSON.stringify(data));
    }
  } catch (e) { /* loggen mag nooit een dealer-actie breken */ }
}

// ─── QuickBooks Online (Amerika / Passion Spas USA) ──────────────────
// Read-only koppeling met QuickBooks Online via OAuth2 (authorization code).
// client_id/secret als worker-secrets (QB_CLIENT_ID/QB_CLIENT_SECRET); tokens
// + realmId in KV ('qb-tokens'). We doen ALLEEN leesacties (SELECT-query's) —
// nooit schrijven, factureren of geld verplaatsen.
// Publieke juridische pagina's voor de QuickBooks-app-review. Beschrijven
// waarheidsgetrouw wat de interne Fonteyn/Passion-integratie met data doet.
function legalPage(which) {
  const upd = "2026";
  const wrap = (title, body) => new Response(
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>" + title + " — Passion Partners / Fonteyn</title><style>body{font-family:-apple-system,Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.6}h1{color:#144734}h2{color:#144734;font-size:18px;margin-top:28px}small{color:#666}</style></head><body>" +
    body + "<hr><p><small>De Fonteyn Groep — Meervelderweg 52, 3888 NK Uddel, The Netherlands · Last updated " + upd + "</small></p></body></html>",
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });

  if (which === "privacy") {
    return wrap("Privacy Policy",
      "<h1>Privacy Policy</h1>" +
      "<p>This policy describes how the internal <b>Passion App</b> dashboard integration (“the App”), operated by De Fonteyn Groep for Passion Spas, handles data. The App is used only by authorised Fonteyn/Passion employees.</p>" +
      "<h2>What data we access</h2><p>With the customer’s explicit authorisation, the App reads <b>invoice and customer records</b> from the connected QuickBooks Online company via Intuit’s official API. Access is strictly <b>read-only</b>; the App never creates, changes, deletes, or moves any financial data in QuickBooks.</p>" +
      "<h2>How we use it</h2><p>The data is shown to authorised staff to plan production and orders. It is not sold, rented, or shared with any third party, and is not used for advertising.</p>" +
      "<h2>Storage &amp; security</h2><p>Access tokens are stored encrypted at rest in Cloudflare’s key-value store and transmitted only over TLS/HTTPS. Access requires internal authentication. Tokens can be revoked at any time by disconnecting the App.</p>" +
      "<h2>Retention</h2><p>We retain only the authorisation tokens needed to keep the connection active. Disconnecting removes them.</p>" +
      "<h2>Contact</h2><p>Questions: <a href=\"mailto:g.mulder@intenza.nl\">g.mulder@intenza.nl</a>.</p>");
  }
  return wrap("End-User License Agreement",
    "<h1>End-User License Agreement</h1>" +
    "<p>This EULA governs use of the internal <b>Passion App</b> dashboard integration (“the App”), operated by De Fonteyn Groep for Passion Spas.</p>" +
    "<h2>License</h2><p>The App is provided for internal use by authorised Fonteyn/Passion employees only. It connects to QuickBooks Online with the user’s authorisation to <b>read</b> invoice and customer data for production and order planning.</p>" +
    "<h2>Acceptable use</h2><p>Users must be authorised, keep their access confidential, and use the App only for legitimate business purposes. The App performs read-only operations and never modifies financial records or moves funds.</p>" +
    "<h2>Warranty &amp; liability</h2><p>The App is provided “as is” without warranty. De Fonteyn Groep is not liable for indirect or consequential damages arising from its use.</p>" +
    "<h2>Termination</h2><p>Access may be withdrawn at any time. The customer can revoke access by disconnecting the App in QuickBooks.</p>" +
    "<h2>Contact</h2><p><a href=\"mailto:g.mulder@intenza.nl\">g.mulder@intenza.nl</a>.</p>");
}

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

// ── Amerika → Logic4: nieuwe QuickBooks-facturen accorderen ──────────
// Vaste gegevens (Gerrit): debiteur 878871433 (Passion Spa South LLC),
// magazijn 50 (Warehouse Texas). Vanaf factuurnummer 3300 (t/m nieuwste).
const AMERIKA_DEBTOR = 878871433;
const AMERIKA_WAREHOUSE = 50;
const AMERIKA_VANAF = 3300;
const QB_ART_FEE = "789456";      // Houston Fee + Freight
const QB_ART_CC = "100000";       // Credit Card Charge
const QB_ART_PART = "13265448";   // spa-onderdeel (alles zonder spa-naam)

// Vind de Logic4-artikelcode voor een spa-model + kleur via de catalogus
// (beste kleur-match op woord-overlap; anders de eerste variant).
function qbSpaCode(catalog, model, kleur) {
  const variants = (catalog.models || {})[model] || [];
  if (!variants.length) return null;
  const words = String(kleur || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  let best = variants[0], bestScore = -1;
  for (const v of variants) {
    const vc = String(v.desc || "").toLowerCase();
    const score = words.reduce((n, w) => n + (vc.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return best.code || null;
}

// Regel-mapping: QuickBooks-factuurregel → Logic4-orderregel (of null = overslaan)
function qbMapLine(name, qty, amount, catalog, spaModels) {
  const full = String(name || "").trim();
  if (!full) return null;
  // QuickBooks zet er soms een categorie vóór ("Swim Spa:Dynamic…", "Jet:PASS-D1…").
  // Neem het deel ná de laatste ':' als de eigenlijke productnaam.
  const n = full.includes(":") ? full.slice(full.lastIndexOf(":") + 1).trim() : full;
  const low = n.toLowerCase();
  if (!n) return null;
  if (/^wire\b/.test(low)) return null;                                  // Wire: nooit op de order
  if (low.startsWith("houston") || low.startsWith("freight")) return { productCode: QB_ART_FEE, description: n, qty, price: amount, kind: "kosten" };
  if (low.startsWith("credit card")) return { productCode: QB_ART_CC, description: n, qty, price: amount, kind: "kosten" };
  const model = spaModels.find(m => low === m.toLowerCase() || low.startsWith(m.toLowerCase() + " "));
  if (model) {
    const kleur = n.slice(model.length).trim();
    return { productCode: qbSpaCode(catalog, model, kleur) || null, description: n, qty, price: amount, kind: "spa", model, kleur };
  }
  return { productCode: QB_ART_PART, description: n, qty, price: amount, kind: "onderdeel" };   // alles anders = onderdeel
}

// Volledige spa-modellenlijst = catalogus (SKT) ∪ prijslijst (bevat ook de
// swimspa's als Dynamic/Activity/Fitness die niet in de catalogus staan).
// Langste namen eerst, zodat "Activity 1 Deep" vóór "Activity 1" matcht.
async function qbSpaModelList(env, catalog) {
  const prices = (await env.FONTEYN_DATA.get("dealer-prices", { type: "json" })) || {};
  return [...new Set([...Object.keys(catalog.models || {}), ...Object.keys(prices.prices || {})])]
    .sort((a, b) => b.length - a.length);
}

// Parse één QBO-invoice → {docNr, id, klant, datum, totaal, rows[], overgeslagen[]}
function qbMapInvoice(inv, catalog, spaModels) {
  const rows = [], skipped = [];
  for (const line of (inv.Line || [])) {
    if (line.DetailType !== "SalesItemLineDetail") continue;
    const d = line.SalesItemLineDetail || {};
    const name = (d.ItemRef && d.ItemRef.name) || line.Description || "";
    const qty = Number(d.Qty) || 1;
    const amount = Number(line.Amount) || 0;
    const m = qbMapLine(name, qty, amount, catalog, spaModels);
    if (m) rows.push(m); else if (name) skipped.push(name);
  }
  // Betaalstatus uit QuickBooks: Balance = wat er nog openstaat. 0 = volledig
  // betaald door de dealer ("payment received" op de invoice), gelijk aan het
  // totaal = niets betaald, ertussenin = deels betaald.
  const totaal = Number(inv.TotalAmt) || 0;
  const open = inv.Balance != null ? Number(inv.Balance) : totaal;
  const betaaldBedrag = Math.max(0, totaal - open);
  return {
    docNr: inv.DocNumber || null, id: inv.Id,
    klant: (inv.CustomerRef && inv.CustomerRef.name) || "", datum: inv.TxnDate || null,
    totaal, rows, overgeslagen: skipped,
    openstaand: open,
    betaaldBedrag,
    betaald: open <= 0.005 && totaal > 0,                        // volledig voldaan
    deelsBetaald: open > 0.005 && betaaldBedrag > 0.005,         // gedeeltelijk
  };
}

/* GET /amerika/qb/omzet?van=2025-01-01&tot=2025-12-31 — omzet over een periode.
   Read-only, teamsleutel vereist.

   Waarom apart van /invoices: die route levert alleen facturen vanaf nummer
   3300, en dat is bewust - Chantal hoeft de historie niet na te lopen. Maar
   daardoor begint die lijst pas op 13 april 2026 en is er geen enkel cijfer
   over 2025 uit te halen.

   Waarom de winst-en-verliesrekening en niet een optelling van facturen: dat
   is wat QuickBooks zelf omzet noemt. Creditnota's, losse kasontvangsten en
   correcties tellen daarin mee en in een factuuroptelling niet. Ik geef de
   factuuroptelling er wel bij, want als die twee ver uiteenlopen zegt dat
   iets over de administratie en wil je dat zien in plaats van kiezen. */
async function qbOmzetPeriode(env, van, tot, methode) {
  const t = await qbAccessToken(env);
  const u = qbApiBase(env) + "/v3/company/" + t.realmId +
    "/reports/ProfitAndLoss?minorversion=73&accounting_method=" + (methode === "Cash" ? "Cash" : "Accrual") +
    "&start_date=" + encodeURIComponent(van) + "&end_date=" + encodeURIComponent(tot);
  const r = await fetch(u, { headers: { "Authorization": "Bearer " + t.access_token, "Accept": "application/json" } });
  if (!r.ok) throw new Error("ProfitAndLoss HTTP " + r.status + " " + (await r.text()).slice(0, 200));
  const rap = await r.json();

  // Het rapport is een boom van Rows met Summary-regels. We zoeken de secties
  // op naam in plaats van op positie, want die verschilt per inrichting.
  const gevonden = {};
  const loop = (rijen) => {
    for (const rij of (rijen && rijen.Row) || []) {
      const kop = rij.Header && rij.Header.ColData && rij.Header.ColData[0] && rij.Header.ColData[0].value;
      const som = rij.Summary && rij.Summary.ColData;
      if (kop && som && som.length > 1) gevonden[String(kop).toLowerCase()] = Number(som[som.length - 1].value) || 0;
      if (rij.Rows) loop(rij.Rows);
      if (rij.ColData && rij.ColData.length > 1) {
        const naam = String(rij.ColData[0].value || "").toLowerCase();
        if (naam) gevonden[naam] = Number(rij.ColData[rij.ColData.length - 1].value) || 0;
      }
    }
  };
  loop(rap.Rows);
  const pak = (...namen) => {
    for (const n of namen) for (const k of Object.keys(gevonden)) if (k.includes(n)) return gevonden[k];
    return null;
  };

  // Factuuroptelling als tweede meting.
  let facturen = 0, aantal = 0;
  for (let page = 0; page < 20; page++) {
    const j = await qbQuery(env, "SELECT * FROM Invoice WHERE TxnDate >= '" + van + "' AND TxnDate <= '" + tot +
      "' ORDERBY TxnDate STARTPOSITION " + (page * 1000 + 1) + " MAXRESULTS 1000");
    const rows = (j.QueryResponse && j.QueryResponse.Invoice) || [];
    for (const inv of rows) { facturen += Number(inv.TotalAmt) || 0; aantal++; }
    if (rows.length < 1000) break;
  }

  return {
    ok: true, van, tot, methode: methode === "Cash" ? "Cash" : "Accrual",
    valuta: rap.Header && rap.Header.Currency || "USD",
    omzet: pak("total income", "totaal inkomsten", "income"),
    kostprijs: pak("total cost of goods sold", "cost of goods sold"),
    brutowinst: pak("gross profit", "brutowinst"),
    nettoresultaat: pak("net income", "net operating income"),
    facturen: { aantal, bedrag: Math.round(facturen * 100) / 100 },
    secties: gevonden,
  };
}
async function qbHandleOmzet(request, env, url) {
  if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
  const van = url.searchParams.get("van") || "2025-01-01";
  const tot = url.searchParams.get("tot") || "2025-12-31";
  // Kasstelsel of factuurstelsel maakt hier veel uit; QuickBooks staat bij
  // veel bedrijven standaard op Cash en dan is de omzet lager dan op Accrual.
  try { return reply(200, await qbOmzetPeriode(env, van, tot, url.searchParams.get("methode"))); }
  catch (e) { return reply(200, { ok: false, error: String(e.message || e) }); }
}

// GET /amerika/qb/invoices — nieuwe facturen (docNr >= 3300) met voorgestelde
// Logic4-mapping + of ze al geaccordeerd zijn. Read-only.
// Alle QuickBooks-facturen ophalen mét paginering. QBO geeft max 1000 rijen
// per query; met alleen "MAXRESULTS 200" bleef de lijst hangen op de nieuwste
// ~200 facturen (Chantal zag daardoor niets ouder dan 3408). We pagineren nu
// op DocNumber tot we voorbij AMERIKA_VANAF zijn, zodat álles vanaf 3300
// binnenkomt. Harde cap van 10 pagina's als veiligheidsrem.
async function qbAllInvoices(env) {
  const PAGE = 1000;
  const all = [];
  for (let page = 0; page < 10; page++) {
    const start = page * PAGE + 1;   // QBO STARTPOSITION is 1-based
    const j = await qbQuery(env,
      "SELECT * FROM Invoice ORDERBY DocNumber DESC STARTPOSITION " + start + " MAXRESULTS " + PAGE);
    const rows = (j.QueryResponse && j.QueryResponse.Invoice) || [];
    all.push(...rows);
    if (rows.length < PAGE) break;   // laatste pagina
    // Zodra de hele pagina onder de ondergrens ligt, hoeven we niet verder.
    const hoogste = rows.reduce((mx, inv) => Math.max(mx, parseInt(inv.DocNumber, 10) || 0), 0);
    if (hoogste < AMERIKA_VANAF) break;
  }
  return all;
}

async function qbHandleInvoices(request, env) {
  if (!env.SHARED_SECRET || (request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false, error: "Unauthorized" });
  try {
    const catalog = (await env.FONTEYN_DATA.get("spa-catalog", { type: "json" })) || {};
    const spaModels = await qbSpaModelList(env, catalog);
    const approved = (await env.FONTEYN_DATA.get("qb-approved", { type: "json" })) || { ids: {} };
    const audrey = (await env.FONTEYN_DATA.get("qb-audrey", { type: "json" })) || { ids: {} };
    const verwerkt = (await env.FONTEYN_DATA.get("qb-verwerkt", { type: "json" })) || { ids: {} };
    const raw = await qbAllInvoices(env);
    const invoices = raw
      // Alleen de doorlopende factuurnummering (3300+). QuickBooks bevat ook
      // oude facturen met een datum-nummer ("09232024_02"); parseInt maakte daar
      // 9232024 van, waardoor ze ten onrechte in de lijst kwamen. Daarom eisen
      // we een puur numeriek nummer van 4-5 cijfers.
      .filter(inv => {
        const doc = String(inv.DocNumber || "").trim();
        if (!/^\d{4,5}$/.test(doc)) return false;
        return parseInt(doc, 10) >= AMERIKA_VANAF;
      })
      .map(inv => {
        const m = qbMapInvoice(inv, catalog, spaModels);
        m.geaccordeerd = !!(approved.ids && approved.ids[m.docNr]);
        m.logic4Order = m.geaccordeerd ? approved.ids[m.docNr].orderId : null;
        m.geaccordeerdTs = m.geaccordeerd ? (approved.ids[m.docNr].ts || null) : null;
        m.audrey = !!(audrey.ids && audrey.ids[m.docNr]);
        const v = verwerkt.ids && verwerkt.ids[m.docNr];
        m.verwerkt = !!v;
        m.verwerktTs = v ? (v.ts || null) : null;
        m.verwerktDoor = v ? (v.user || null) : null;
        return m;
      })
      .sort((a, b) => (parseInt(b.docNr, 10) || 0) - (parseInt(a.docNr, 10) || 0));
    return reply(200, { ok: true, invoices });
  } catch (e) {
    console.error("[qb] invoices-fout: " + String(e.message || e));
    return reply(200, { ok: false, error: String(e.message || e) });
  }
}

// Maak één Logic4-order voor een geparste Amerika-factuur (magazijn Texas).
async function dpCreateAmerikaOrder(env, mapped) {
  const token = await l4Token(env);
  const withCode = mapped.rows.filter(r => r.productCode);
  const missing = mapped.rows.filter(r => !r.productCode);   // spa zonder gevonden artikelcode
  let notes = "Automatisch uit QuickBooks-factuur " + (mapped.docNr || "") + " (Passion Spa South).";
  if (missing.length) notes += "\nLET OP — handmatig toevoegen (geen artikelcode gevonden):\n" +
    missing.map(r => "  • " + r.qty + "x " + r.description).join("\n");
  const payload = {
    OrderStatus: { Id: 1 },                         // Verkooporder
    DebtorId: AMERIKA_DEBTOR,
    CreationDate: new Date().toISOString().slice(0, 19),   // verplicht
    Reference: "QuickBooks " + (mapped.docNr || ""),
    Notes: notes,
    OrderRows: withCode.map(r => ({
      ProductCode: String(r.productCode), Description: r.description,
      Qty: Number(r.qty) || 1, WarehouseId: AMERIKA_WAREHOUSE,
    })),
  };
  const r = await fetch("https://api.logic4server.nl/v3/Orders/AddUpdateOrder", {
    method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
  if (!r.ok) { console.log("[qb-order] faalde HTTP " + r.status + ": " + txt.slice(0, 300)); return { ok: false, error: "HTTP " + r.status + " — " + txt.slice(0, 200) }; }
  const orderId = (typeof j === "number" && j) || (j && (j.Id || (j.Value && j.Value.Id))) || null;
  return { ok: true, orderId };
}

// POST /amerika/qb/approve { docNrs:[...] } — maak Logic4-orders voor de
// geselecteerde facturen. Side-effect: alleen op expliciete actie van Chantal.
async function qbHandleApprove(request, env) {
  if (!env.SHARED_SECRET || (request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false, error: "Unauthorized" });
  let body = {}; try { body = await request.json(); } catch {}
  const docNrs = (Array.isArray(body.docNrs) ? body.docNrs : []).map(String);
  if (!docNrs.length) return reply(400, { ok: false, error: "geen facturen geselecteerd" });
  const catalog = (await env.FONTEYN_DATA.get("spa-catalog", { type: "json" })) || {};
  const spaModels = await qbSpaModelList(env, catalog);
  const approved = (await env.FONTEYN_DATA.get("qb-approved", { type: "json" })) || { ids: {} };
  approved.ids = approved.ids || {};
  const results = [];
  for (const docNr of docNrs) {
    if (approved.ids[docNr]) { results.push({ docNr, ok: true, orderId: approved.ids[docNr].orderId, already: true }); continue; }
    try {
      const j = await qbQuery(env, "SELECT * FROM Invoice WHERE DocNumber = '" + docNr.replace(/'/g, "") + "'");
      const inv = ((j.QueryResponse && j.QueryResponse.Invoice) || [])[0];
      if (!inv) { results.push({ docNr, ok: false, error: "factuur niet gevonden" }); continue; }
      const mapped = qbMapInvoice(inv, catalog, spaModels);
      const res = await dpCreateAmerikaOrder(env, mapped);
      if (res.ok) { approved.ids[docNr] = { orderId: res.orderId, ts: new Date().toISOString() }; results.push({ docNr, ok: true, orderId: res.orderId }); }
      else results.push({ docNr, ok: false, error: res.error });
    } catch (e) { results.push({ docNr, ok: false, error: String(e.message || e) }); }
  }
  await env.FONTEYN_DATA.put("qb-approved", JSON.stringify(approved));
  return reply(200, { ok: true, results });
}

// POST /amerika/qb/audrey { docNr, ontvangen } — Chantal vinkt zelf aan dat het
// geld van Audrey binnen is. Puur een eigen administratie-vlag (staat los van
// de QuickBooks-betaalstatus van de dealer), opgeslagen in bucket 'qb-audrey'.
async function qbHandleAudrey(request, env) {
  if (!env.SHARED_SECRET || (request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false, error: "Unauthorized" });
  let body = {}; try { body = await request.json(); } catch {}
  const docNr = String(body.docNr || "").trim();
  if (!docNr) return reply(400, { ok: false, error: "docNr ontbreekt" });
  const data = (await env.FONTEYN_DATA.get("qb-audrey", { type: "json" })) || { ids: {} };
  data.ids = data.ids || {};
  if (body.ontvangen) data.ids[docNr] = { ts: new Date().toISOString(), user: String(body.user || "").slice(0, 80) };
  else delete data.ids[docNr];
  await env.FONTEYN_DATA.put("qb-audrey", JSON.stringify(data));
  return reply(200, { ok: true, ontvangen: !!body.ontvangen });
}

// POST /amerika/qb/verwerkt { docNr, verwerkt, user } — "verwerkt in Logic4"
// per FACTUURNUMMER. Eén centrale waarheid: het vinkje in het Audrey-tabblad
// en de lijst 'geaccordeerd — nog te verwerken' lezen allebei hieruit, zodat
// ze niet uit elkaar kunnen lopen. Een geaccordeerde factuur blijft in het
// Audrey-tabblad staan totdat dit vinkje aan gaat (een Logic4-order betekent
// immers nog niet dat de betaling gekoppeld is).
async function qbHandleVerwerkt(request, env) {
  if (!env.SHARED_SECRET || (request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false, error: "Unauthorized" });
  let body = {}; try { body = await request.json(); } catch {}
  const docNr = String(body.docNr || "").trim();
  if (!docNr) return reply(400, { ok: false, error: "docNr ontbreekt" });
  const data = (await env.FONTEYN_DATA.get("qb-verwerkt", { type: "json" })) || { ids: {} };
  data.ids = data.ids || {};
  if (body.verwerkt) data.ids[docNr] = { ts: new Date().toISOString(), user: String(body.user || "").slice(0, 80) };
  else delete data.ids[docNr];
  await env.FONTEYN_DATA.put("qb-verwerkt", JSON.stringify(data));
  return reply(200, { ok: true, verwerkt: !!body.verwerkt, docNr });
}

/* Verbergen in plaats van verwijderen. Zowel de QuickBooks-facturen als de
   Jazzi-bestellingen worden telkens opnieuw uit de bron opgebouwd; echt wissen
   kan dus niet — de volgende keer staan ze er weer. Chantal wil ze wél uit
   beeld hebben, want dubbel ingeladen orders leiden tot dubbel werk (4 aug
   2026). We onthouden daarom wát verborgen is, door wie en wanneer, zodat het
   terug te halen is als er een vraag over komt. */
async function verbergHandler(request, env, bucket) {
  if (!env.SHARED_SECRET || (request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false, error: "Unauthorized" });
  let body = {}; try { body = await request.json(); } catch {}
  const id = String(body.id || "").trim();
  if (!id) return reply(400, { ok: false, error: "id ontbreekt" });
  const data = (await env.FONTEYN_DATA.get(bucket, { type: "json" })) || { ids: {} };
  data.ids = data.ids || {};
  if (body.verborgen === false) delete data.ids[id];
  else data.ids[id] = { ts: new Date().toISOString(), user: String(body.user || "").slice(0, 80), reden: String(body.reden || "").slice(0, 200) };
  await env.FONTEYN_DATA.put(bucket, JSON.stringify(data));
  return reply(200, { ok: true, id, verborgen: body.verborgen !== false });
}

// ─── Prijslijsten fabrikanten (Gretha) ───────────────────────────────
// De prijsafspraken met alle leveranciers en fabrieken staan nu verspreid
// over mailboxen en mappen. Alles begint bij de inkoop met de juiste
// prijslijst, dus die horen op één plek te staan (Dolf/Gerrit, 7 aug 2026).
//
// Zelfde opzet als de documentbibliotheek van het partnerportaal: het
// bestand zelf is een losse KV-sleutel (plfile:<id>, binair), de mappenboom
// en alle gegevens eromheen staan in bucket 'prijslijsten'. Dat moet apart,
// want een bucket is JSON met een maximum van een paar MB — een map met
// vijftig PDF's past daar nooit in. Losse sleutels hebben elk hun eigen
// ruimte, dus een lijst erbij maakt de bestaande niet zwaarder (dezelfde les
// als bij de specificatiesheets).
//
// Toegang: de team-sleutel, net als de andere interne tegels. Bewust NIET de
// dealer-beheersleutel — dit is geen dealerdata en Gretha hoort niet aan het
// partnerbestand te kunnen komen. Wie de tegel te zien krijgt, regelt
// dashboard.html.
const PL_TYPES = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  csv: "text/csv", txt: "text/plain",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
};

// Het id wordt door de tegel gemaakt (tijdstempel + toeval + extensie) en
// nooit door een mens getypt. Streng controleren kan dus zonder iemand voor
// de voeten te lopen, en houdt gekke sleutels uit de opslag.
function plBestandId(url) {
  const id = String(url.searchParams.get("id") || "").toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{5,90}$/.test(id) && !id.includes("..") ? id : null;
}

function plAuthOk(request, env) {
  return !!env.SHARED_SECRET && (request.headers.get("X-Fonteyn-Auth") || "") === env.SHARED_SECRET;
}

// PUT /prijslijst/bestand?id=… — body is het bestand zelf (binair).
async function plZetBestand(request, env, url) {
  if (!plAuthOk(request, env)) return reply(401, { ok: false, error: "Unauthorized" });
  const id = plBestandId(url);
  if (!id) return reply(400, { ok: false, error: "ongeldig id" });
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return reply(400, { ok: false, error: "leeg bestand" });
  // 24 MB — de opslag zelf houdt bij 25 op. Een prijslijst is een PDF of een
  // Excel en zit daar ver onder; een bestand dat hier tegenaan loopt is
  // vrijwel zeker iets anders (een scan op volle resolutie bijvoorbeeld).
  if (buf.byteLength > 24 * 1024 * 1024) return reply(413, { ok: false, error: "bestand is groter dan 24 MB" });
  await env.FONTEYN_DATA.put("plfile:" + id, buf);
  return reply(200, { ok: true, id, bytes: buf.byteLength });
}

// GET /prijslijst/bestand?id=… — de sleutel gaat als header mee, niet in het
// adres: een adres belandt in logboeken, browsergeschiedenis en verwijzingen.
async function plGeefBestand(request, env, url) {
  if (!plAuthOk(request, env)) return reply(401, { ok: false, error: "Unauthorized" });
  const id = plBestandId(url);
  if (!id) return reply(400, { ok: false, error: "ongeldig id" });
  const buf = await env.FONTEYN_DATA.get("plfile:" + id, { type: "arrayBuffer" });
  if (!buf) return reply(404, { ok: false, error: "bestand niet gevonden" });
  const ext = id.split(".").pop();
  return new Response(buf, { headers: {
    ...corsHeaders,
    "Content-Type": PL_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}

// POST /prijslijst/verwijder { id } — alleen het bestand zelf. De tegel haalt
// hem daarna uit het overzicht. Andersom (eerst uit het overzicht) zou een
// bestand achterlaten dat niemand meer kan vinden maar wel ruimte inneemt.
async function plWisBestand(request, env) {
  if (!plAuthOk(request, env)) return reply(401, { ok: false, error: "Unauthorized" });
  let body = {}; try { body = await request.json(); } catch {}
  const ids = Array.isArray(body.ids) ? body.ids : [body.id];
  const gewist = [];
  for (const raw of ids) {
    const id = String(raw || "").toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{5,90}$/.test(id) || id.includes("..")) continue;
    await env.FONTEYN_DATA.delete("plfile:" + id);
    gewist.push(id);
  }
  if (!gewist.length) return reply(400, { ok: false, error: "geen geldig id" });
  return reply(200, { ok: true, gewist });
}

// ─── Bankkoppeling ───────────────────────────────────────────────────
// De tegel leest een MT940 en koppelt de betalingen aan openstaande posten.
// Het koppelen zelf gebeurt in de tegel (bank-matching.js); hier staan de
// drie dingen die alleen Logic4 kan beantwoorden.
//
// Waarom de openstaande posten hier worden bewaard: het zijn er ~2.500 en ze
// veranderen per dag nauwelijks. Bij elke upload opnieuw ophalen is zonde;
// een uur bewaren is ruim genoeg en scheelt Osman het wachten.
//
// Let op de grens van 50 subverzoeken per aanroep (gratis laag van
// Cloudflare). Daarom is elk endpoint hieronder begrensd op een aantal per
// aanroep en doet de tegel de rest in porties.
const BANK_CACHE_TTL = 3600 * 1000;

// Wie betalingen mag wegschrijven. Zelfde groep als in dashboard.html, die
// bepaalt wie de tegel te zien krijgt; hier staat hij nog een keer omdat het
// scherm zichzelf niet mag bewaken bij iets dat de administratie verandert.
const BANK_BOEKERS = new Set([
  "osman@fonteyn.nl", "osman", "fonteyn.osman",
  "rowan@fonteyn.nl", "rowan", "fonteyn.rowan",
  "rico@fonteyn.nl", "rico", "fonteyn.rico",
  "reinier@fonteyn.nl", "reinier", "fonteyn.reinier",
  "gerrit@fonteyn.nl", "gerrit", "fonteyn.gerrit",
  "dolf@fonteyn.nl", "fonteyn.dolf", "dolf",
  "fonteynbot@fonteyn.nl", "fonteyn.bot", "fonteynbot",
]);

async function bankOpenstaand(env, vers) {
  const bewaard = await env.FONTEYN_DATA.get("bank-openstaand", { type: "json" });
  if (!vers && bewaard && bewaard.updated && (Date.now() - Date.parse(bewaard.updated)) < BANK_CACHE_TTL) {
    return { ok: true, uitCache: true, updated: bewaard.updated, posten: bewaard.posten || [] };
  }
  const token = await l4Token(env);
  const r = await fetch("https://api.logic4server.nl/v3/Orders/GetOpenPaymentInvoices", {
    method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ TakeRecords: 5000 }),
  });
  if (!r.ok) throw new Error("Logic4 gaf HTTP " + r.status + " op de openstaande posten");
  const lijst = await r.json();
  // Alleen wat de koppeling nodig heeft. Een factuur zonder nummer of zonder
  // openstaand bedrag valt af: daar is niets aan te koppelen.
  const posten = (Array.isArray(lijst) ? lijst : []).filter(p => p && p.InvoiceId && Number(p.AmountOutstanding) > 0)
    .map(p => ({
      InvoiceId: p.InvoiceId, DebtorId: p.DebtorId,
      TotalAmount: Number(p.TotalAmount) || 0,
      AmountOutstanding: Number(p.AmountOutstanding) || 0,
      InvoiceDate: p.InvoiceDate || null, DueDate: p.DueDate || null,
      DaysPastDueDate: p.DaysPastDueDate == null ? null : p.DaysPastDueDate,
    }));
  const opslag = { updated: new Date().toISOString(), posten };
  await env.FONTEYN_DATA.put("bank-openstaand", JSON.stringify(opslag));
  return { ok: true, uitCache: false, updated: opslag.updated, posten };
}

// Namen van debiteuren. Logic4 kent geen filter op meerdere ids en ook geen
// zoeken op naam (nagelopen: Ids/DebtorIds/CustomerIds/Name/SearchString
// worden allemaal genegeerd), en de klantenlijst is 200.000 regels lang. Eén
// aanroep per debiteur is dus de enige weg - vandaar de portie van 40.
async function bankDebiteuren(env, ids) {
  const uniek = [...new Set((ids || []).map(x => Number(x)).filter(x => x > 0))].slice(0, 40);
  const token = await l4Token(env);
  const namen = {};
  for (const id of uniek) {
    try {
      const r = await fetch("https://api.logic4server.nl/v3/Relations/GetCustomers", {
        method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ Id: id, TakeRecords: 1 }),
      });
      const j = await r.json().catch(() => null);
      const c = Array.isArray(j) ? j[0] : null;
      if (!c) continue;
      const persoon = [c.FirstName, c.Preposition, c.LastName].filter(Boolean).join(" ").trim();
      namen[String(id)] = { naam: c.CompanyName || persoon || "", plaats: c.City || "", persoon };
    } catch (e) { /* één debiteur die niet lukt mag de rest niet ophouden */ }
  }
  return { ok: true, namen, gevraagd: uniek.length, meer: (ids || []).length > uniek.length };
}

// Orders opzoeken op nummer. In de praktijk noemt een klant een ordernummer
// en geen factuurnummer, dus dit is de belangrijkste opzoekactie van de hele
// koppeling. Totals.Calc_TotalPayed zegt wat er al op staat, AmountIncl wat
// het kost; het verschil is wat er nog open staat.
async function bankOrders(env, nrs) {
  const uniek = [...new Set((nrs || []).map(x => Number(x)).filter(x => x > 0))].slice(0, 40);
  const token = await l4Token(env);
  const orders = {};
  for (const nr of uniek) {
    try {
      const r = await fetch("https://api.logic4server.nl/v3/Orders/GetOrders", {
        method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ Id: nr, TakeRecords: 1 }),
      });
      const j = await r.json().catch(() => null);
      const o = Array.isArray(j) ? j[0] : null;
      if (!o) continue;
      const t = o.Totals || {};
      const a = o.AccountAddress || {};
      const totaal = Number(t.AmountIncl) || 0;
      const betaald = Number(t.Calc_TotalPayed) || 0;
      orders[String(nr)] = {
        orderNr: nr, debiteurId: o.DebtorId || null,
        naam: a.CompanyName || [a.FirstName, a.Preposition, a.LastName].filter(Boolean).join(" ").trim() || "",
        totaal, betaald, open: Math.round((totaal - betaald) * 100) / 100,
        status: (o.OrderStatus && o.OrderStatus.Value) || null,
        isPaid: !!t.IsPaid,
        factuurNr: o.InvoiceBelongsToOrderNumber || null,
      };
    } catch (e) { /* één order dat niet lukt mag de rest niet ophouden */ }
  }
  return { ok: true, orders, gevraagd: uniek.length, meer: (nrs || []).length > uniek.length };
}

// Van factuur naar order. AddPayment werkt op een ORDER, terwijl de
// openstaande posten facturen zijn; het ordernummer staat op de factuur
// (InvoiceBelongsToOrderNumber). Wordt pas opgehaald voor de regels die
// iemand daadwerkelijk wil boeken.
async function bankFactuurOrder(env, paren) {
  const lijst = (Array.isArray(paren) ? paren : []).slice(0, 25);
  const token = await l4Token(env);
  // Per debiteur één aanroep: meerdere facturen van dezelfde klant kosten zo
  // niet meerdere verzoeken.
  const perDebiteur = {};
  for (const p of lijst) {
    const d = String(p.debtorId || "");
    if (!d) continue;
    (perDebiteur[d] = perDebiteur[d] || []).push(String(p.invoiceId));
  }
  const uit = {};
  for (const [debtorId, facturen] of Object.entries(perDebiteur)) {
    try {
      const r = await fetch("https://api.logic4server.nl/v3/Orders/GetInvoices", {
        method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ DebtorId: Number(debtorId), TakeRecords: 500 }),
      });
      const j = await r.json().catch(() => null);
      const alle = Array.isArray(j) ? j : [];
      for (const f of facturen) {
        const gevonden = alle.find(x => String(x.Id) === f);
        if (!gevonden) { uit[f] = { fout: "factuur niet gevonden bij deze debiteur" }; continue; }
        const naam = (gevonden.AccountAddress && (gevonden.AccountAddress.CompanyName ||
          [gevonden.AccountAddress.FirstName, gevonden.AccountAddress.LastName].filter(Boolean).join(" "))) || "";
        uit[f] = {
          orderNr: gevonden.InvoiceBelongsToOrderNumber || null,
          naam,
          totaal: (gevonden.Totals && Number(gevonden.Totals.AmountIncl)) || null,
        };
      }
    } catch (e) {
      for (const f of facturen) uit[f] = { fout: String(e.message || e) };
    }
  }
  return { ok: true, facturen: uit };
}

// Betalingen wegschrijven. Dit verandert de administratie en is niet terug te
// draaien, dus: de zware beheersleutel (net als het aanmaken van een
// inkooporder en het boeken van een ontvangst), een harde grens per keer, en
// per regel een eigen uitkomst zodat één mislukking de rest niet meesleept.
/* Betalingen van een bankafschrift wegschrijven naar Logic4.

   LET OP - hier zat de fout die Osman op 11 aug 2026 meldde ("0 betalingen
   geboekt, er is een fout opgetreden, geef deze referentiecode door"). De
   aanroep miste twee velden en gebruikte een derde verkeerd:

     Amount   →  moet AmountIncl zijn, anders boekt Logic4 nul euro
     BookingId        ontbrak - het dagboek waarin de betaling landt
     MatchingLedgerId ontbrak - zonder die twee geeft Logic4 een 500

   Dat stond allemaal al in bol.html, bevestigd door Max van Logic4, en in de
   betaalregistratie van het partnerportaal. Ik heb het bij het bouwen van deze
   tegel niet overgenomen; daardoor heeft er nooit één betaling geboekt kunnen
   worden.

   Het dagboek komt niet uit een vaste waarde hier maar wordt door de tegel
   meegegeven. Een betaling in het verkeerde dagboek is geld op de verkeerde
   plek, en dat mag dit dashboard niet stilletjes voor iemand invullen. */
async function bankBoeken(env, body) {
  const regels = (Array.isArray(body.regels) ? body.regels : []).slice(0, 30);
  if (!regels.length) return { ok: false, error: "geen regels meegegeven" };
  const bookingId = Number(body.bookingId);
  const matchingLedgerId = Number(body.matchingLedgerId) || 78;
  if (!bookingId) return { ok: false, error: "geen dagboek gekozen. Kies eerst het dagboek van deze bankrekening; zonder dagboek weigert Logic4 de boeking." };
  const token = await l4Token(env);
  const door = String(body.door || "").slice(0, 80);
  const uit = [];
  for (const r of regels) {
    const orderNr = Number(r.orderNr);
    const bedrag = Number(r.bedrag);
    if (!orderNr || !(bedrag > 0)) { uit.push({ ...r, ok: false, error: "ordernummer of bedrag ontbreekt" }); continue; }
    // De omschrijving is wat Osman later in Logic4 terugziet. Datum en
    // afschrift erin, zodat een boeking naar de bankregel terug te leiden is.
    const omschrijving = String(r.omschrijving || "").slice(0, 200) || "Bankbetaling";
    const datum = /^\d{4}-\d{2}-\d{2}$/.test(String(r.datum || "")) ? r.datum : new Date().toISOString().slice(0, 10);
    try {
      const resp = await fetch("https://api.logic4server.nl/v3/Orders/AddPayment", {
        method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          OrderId: orderNr,
          AmountIncl: bedrag,
          BookingId: bookingId,
          MatchingLedgerId: matchingLedgerId,
          DateTime: datum + "T12:00:00",
          Description: omschrijving,
        }),
      });
      const tekst = await resp.text();
      let j = null; try { j = JSON.parse(tekst); } catch {}
      if (!resp.ok) {
        // Het hele antwoord meesturen. "Er is een fout opgetreden" zonder meer
        // liet niemand verder komen; met de tekst erbij is de volgende poging
        // tenminste te duiden.
        uit.push({ ...r, ok: false,
          error: (j && (j.detail || j.title)) || ("HTTP " + resp.status),
          antwoord: tekst.slice(0, 300) });
      } else {
        uit.push({ ...r, ok: true, geboekt: bedrag });
      }
    } catch (e) { uit.push({ ...r, ok: false, error: String(e.message || e) }); }
  }
  const gelukt = uit.filter(x => x.ok).length;
  // Vastleggen wie wat heeft geboekt - een betaling in de administratie moet
  // herleidbaar zijn tot een persoon.
  const logboek = (await env.FONTEYN_DATA.get("bank-geboekt", { type: "json" })) || { boekingen: [] };
  logboek.boekingen = (logboek.boekingen || []).slice(-4000);
  logboek.boekingen.push({ ts: new Date().toISOString(), door, aantal: gelukt,
    totaal: uit.filter(x => x.ok).reduce((n, x) => n + Number(x.geboekt || 0), 0),
    regels: uit.map(x => ({ orderNr: x.orderNr, factuur: x.invoiceId || null, bedrag: x.bedrag, ok: x.ok, error: x.error || null })) });
  await env.FONTEYN_DATA.put("bank-geboekt", JSON.stringify(logboek));
  return { ok: true, gelukt, mislukt: uit.length - gelukt, resultaten: uit };
}

/* ─── Grootboekrekeningen en btw-codes ─────────────────────────────────────
   Logic4 wil in een memoriaalregel niet het rekeningnummer (1220) maar het
   interne LedgerId. Deze lijst maakt dat verschil onzichtbaar: de tegel praat
   in rekeningnummers, hier wordt het omgezet.

   De btw-code is verplicht op elke mutatie. Voor een tussenrekening is dat
   nul procent; die code wordt hier opgezocht en niet geraden. Is er geen
   nul-procentcode, dan gaat er niets weg en zegt hij dat. */
async function bankGrootboeken(env) {
  const token = await l4Token(env);
  const haal = async (pad) => {
    const r = await fetch("https://api.logic4server.nl" + pad, {
      method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: "{}",
    });
    const tekst = await r.text();
    let j = null; try { j = JSON.parse(tekst); } catch {}
    if (!r.ok) throw new Error(pad + " gaf HTTP " + r.status + " — " + tekst.slice(0, 200));
    return Array.isArray(j) ? j : ((j && (j.Value || j.Records)) || []);
  };
  const [ledgers, btw] = await Promise.all([
    haal("/v3/Financial/GetLedgers"),
    haal("/v3/Financial/GetVatCodes"),
  ]);
  const nul = (btw || []).find(v => Number(v.Percent) === 0);
  return {
    ok: true,
    grootboeken: (ledgers || []).map(l => ({ id: l.Id, code: l.Code, naam: l.Description || "" })),
    btwNul: nul ? { id: nul.Id, naam: nul.Name || "", percent: nul.Percent } : null,
  };
}

/* ─── Memoriaal: een bankregel op een grootboekrekening ────────────────────
   Voor alles wat niet bij één order hoort: de dagafrekening van de
   pinautomaat, de uitbetalingen van Stripe/Shopify, Mollie en Pay.nl. Die
   gaan als memoriaalboeking naar een tussenrekening.

   Eén boeking per bankregel, met één mutatie: de tegenrekening. De bankkant
   zit in het dagboek zelf - een dagboek van het type bank heeft zijn eigen
   grootboekrekening, precies zoals in het Dagboek-scherm van Logic4 waar je
   ook alleen de tegenrekening invult.

   LET OP: de eerste die hiermee geboekt wordt hoort in Logic4 nagekeken te
   worden voordat de rest volgt. Dit is geld op een rekening zetten. */
async function bankMemoriaal(env, body) {
  const regels = (Array.isArray(body.regels) ? body.regels : []).slice(0, 30);
  if (!regels.length) return { ok: false, error: "geen regels meegegeven" };
  const bookingId = Number(body.bookingId);
  if (!bookingId) return { ok: false, error: "geen dagboek gekozen" };

  let lijsten;
  try { lijsten = await bankGrootboeken(env); }
  catch (e) { return { ok: false, error: "grootboekrekeningen ophalen faalde: " + (e.message || e) }; }
  if (!lijsten.btwNul) return { ok: false, error: "geen btw-code van 0% gevonden in Logic4. Zonder btw-code weigert Logic4 de mutatie." };
  const perCode = {};
  lijsten.grootboeken.forEach(g => { perCode[String(g.code)] = g; });

  const token = await l4Token(env);
  const uit = [];
  for (const r of regels) {
    const bedrag = Number(r.bedrag);
    const rek = String(r.rekening || "").trim();
    const gb = perCode[rek];
    if (!gb) { uit.push({ ...r, ok: false, error: "grootboekrekening " + (rek || "(leeg)") + " bestaat niet in Logic4" }); continue; }
    if (!(bedrag > 0)) { uit.push({ ...r, ok: false, error: "bedrag ontbreekt" }); continue; }
    const datum = /^\d{4}-\d{2}-\d{2}$/.test(String(r.datum || "")) ? r.datum : new Date().toISOString().slice(0, 10);
    try {
      const resp = await fetch("https://api.logic4server.nl/v3/Financial/AddFinancialGeneralBookingWithMutations", {
        method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          Reference: String(r.referentie || "Bankafschrift").slice(0, 60),
          BookingDateTime: datum + "T12:00:00",
          FinancialBookId: bookingId,
          Mutations: [{
            LedgerId: gb.id,
            VatCode: lijsten.btwNul.id,
            AmountIncl: bedrag,
            Description: String(r.omschrijving || "").slice(0, 200) || "Bankafschrift",
          }],
        }),
      });
      const tekst = await resp.text();
      let j = null; try { j = JSON.parse(tekst); } catch {}
      if (!resp.ok) uit.push({ ...r, ok: false, error: (j && (j.detail || j.title)) || ("HTTP " + resp.status), antwoord: tekst.slice(0, 300) });
      else uit.push({ ...r, ok: true, geboekt: bedrag, rekeningNaam: gb.naam });
    } catch (e) { uit.push({ ...r, ok: false, error: String(e.message || e) }); }
  }
  const gelukt = uit.filter(x => x.ok).length;
  const logboek = (await env.FONTEYN_DATA.get("bank-geboekt", { type: "json" })) || { boekingen: [] };
  logboek.boekingen = (logboek.boekingen || []).slice(-4000);
  logboek.boekingen.push({ ts: new Date().toISOString(), door: String(body.door || "").slice(0, 80),
    soort: "memoriaal", aantal: gelukt,
    totaal: uit.filter(x => x.ok).reduce((n, x) => n + Number(x.geboekt || 0), 0),
    regels: uit.map(x => ({ rekening: x.rekening, bedrag: x.bedrag, ok: x.ok, error: x.error || null })) });
  await env.FONTEYN_DATA.put("bank-geboekt", JSON.stringify(logboek));
  return { ok: true, gelukt, mislukt: uit.length - gelukt, resultaten: uit };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        if (!env.LOGIC4_USERNAME) { console.log("[cron] geen Logic4-creds"); return; }
        const s = await dpRefreshHalStock(env);
        console.log("[cron] hal-voorraad: " + JSON.stringify(s));
        const pr = await dpRefreshProductie(env).catch(e => ({ ok: false, error: String(e.message || e) }));
        console.log("[cron] productie: " + JSON.stringify(pr));
        const rv = await dpRefreshReservations(env);   // leest voorraad-productie voor de forecast
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

    // Activiteitenlogboek — tegels sturen hier een event bij openen/login
    if (url.pathname === "/log" && request.method === "POST") {
      return handleLog(request, env);
    }

    // ── Proforma invoice → inkooporder (Chantal & Manon) ──────────────────
    // Twee stappen, bewust gescheiden: 'voorstel' leest alleen en mag met de
    // team-sleutel; 'aanmaken' schrijft écht een inkooporder in Logic4 en
    // vereist daarom de zwaardere beheersleutel.
    if (url.pathname === "/voorraad/inkooporder/voorstel" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const body = await request.json().catch(() => ({}));
      return reply(200, await ikoVoorstel(env, body).catch(e => ({ ok: false, error: String(e.message || e) })));
    }
    if (url.pathname === "/voorraad/inkooporder/aanmaken" && request.method === "POST") {
      if ((request.headers.get("X-DP-Admin") || "") !== env.DP_ADMIN_KEY) return reply(401, { ok: false, error: "beheersleutel vereist" });
      const body = await request.json().catch(() => ({}));
      return reply(200, await ikoAanmaken(env, body).catch(e => ({ ok: false, error: String(e.message || e) })));
    }

    // Spa-inkoop naar Logic4. Het voorstel is alleen-lezen (teamsleutel);
    // daadwerkelijk een inkooporder aanmaken vereist de beheersleutel, net als
    // bij de proforma-koppeling. Zo kan niemand met alleen leesrechten per
    // ongeluk inkooporders in de administratie zetten.
    if (url.pathname === "/voorraad/spa-migratie/voorstel" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      return reply(200, await spaMigratieVoorstel(env).catch(e => ({ ok: false, error: String(e.message || e) })));
    }
    if (url.pathname === "/voorraad/spa-migratie/uitvoeren" && request.method === "POST") {
      if ((request.headers.get("X-DP-Admin") || "") !== env.DP_ADMIN_KEY) return reply(401, { ok: false, error: "beheersleutel vereist" });
      const body = await request.json().catch(() => ({}));
      return reply(200, await spaMigratieUitvoeren(env, body).catch(e => ({ ok: false, error: String(e.message || e) })));
    }
    // Een modelnaam die Chantal anders typt dan Logic4 hem kent, eenmalig
    // koppelen. Geldt daarna overal — ook voor de proforma-koppeling.
    if (url.pathname === "/voorraad/spa-migratie/alias" && request.method === "POST") {
      if ((request.headers.get("X-DP-Admin") || "") !== env.DP_ADMIN_KEY) return reply(401, { ok: false, error: "beheersleutel vereist" });
      const body = await request.json().catch(() => ({}));
      const van = ikoNormaliseerModel(body.van), naar = String(body.naar || "").trim();
      if (!van || !naar) return reply(400, { ok: false, error: "van en naar zijn allebei nodig" });
      const opslag = (await env.FONTEYN_DATA.get("spa-aliassen", { type: "json" })) || { modellen: {} };
      opslag.modellen = opslag.modellen || {};
      opslag.modellen[van] = naar;
      opslag.gewijzigd = new Date().toISOString();
      await env.FONTEYN_DATA.put("spa-aliassen", JSON.stringify(opslag));
      return reply(200, { ok: true, van, naar });
    }

    // Flexport — waar zijn de containers volgens de expediteur.
    if (url.pathname === "/voorraad/flexport/overzicht" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const body = await request.json().catch(() => ({}));
      return reply(200, await flexportOverzicht(env, !!body.vers).catch(e => ({ ok: false, error: String(e.message || e) })));
    }

    // Documentenketen Jazzi: commercial invoice → inkooporder.
    // Voorstel is alleen-lezen; de datum bijwerken en de ontvangst boeken
    // vereisen de beheersleutel. De ontvangst verhoogt echt de voorraad, dus
    // die zit achter dezelfde drempel als het aanmaken van een inkooporder.
    if (url.pathname === "/voorraad/spa-ontvangst/voorstel" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      return reply(200, await spaOntvangstVoorstel(env).catch(e => ({ ok: false, error: String(e.message || e) })));
    }
    if (url.pathname === "/voorraad/spa-ontvangst/eta" && request.method === "POST") {
      if ((request.headers.get("X-DP-Admin") || "") !== env.DP_ADMIN_KEY) return reply(401, { ok: false, error: "beheersleutel vereist" });
      const body = await request.json().catch(() => ({}));
      return reply(200, await spaOntvangstEta(env, body).catch(e => ({ ok: false, error: String(e.message || e) })));
    }
    if (url.pathname === "/voorraad/spa-ontvangst/boeken" && request.method === "POST") {
      if ((request.headers.get("X-DP-Admin") || "") !== env.DP_ADMIN_KEY) return reply(401, { ok: false, error: "beheersleutel vereist" });
      const body = await request.json().catch(() => ({}));
      return reply(200, await spaOntvangstBoeken(env, body).catch(e => ({ ok: false, error: String(e.message || e) })));
    }

    // Juridische pagina's (publiek) — nodig voor de QuickBooks-app-review
    if (url.pathname === "/legal/privacy") return legalPage("privacy");
    if (url.pathname === "/legal/eula")    return legalPage("eula");

    // QuickBooks Online (Amerika) — OAuth-flow + read-only data
    if (url.pathname === "/amerika/qb/connect")  return qbHandleConnect(request, env, url);
    if (url.pathname === "/amerika/qb/callback") return qbHandleCallback(request, env, url);
    if (url.pathname === "/amerika/qb/status")   return qbHandleStatus(request, env);
    if (url.pathname === "/amerika/qb/data")     return qbHandleData(request, env);
    if (url.pathname === "/amerika/qb/invoices") return qbHandleInvoices(request, env);
    if (url.pathname === "/amerika/qb/omzet")    return qbHandleOmzet(request, env, url);
    // De wisselkoers staat in dealer-prices, en dat is een dealer-bucket die
    // met de team-sleutel niet gelezen mag worden. Voor de waardebepaling van
    // de voorraad in Houston is alleen die ene koers nodig; die geven we hier
    // apart terug, zodat er niet ergens een tweede koers gaat rondslingeren.
    if (url.pathname === "/amerika/koers" && request.method === "GET") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const dp = (await env.FONTEYN_DATA.get("dealer-prices", { type: "json" })) || {};
      const koers = Number(dp.meta && dp.meta.rate) > 0 ? Number(dp.meta.rate) : 1.11;
      return reply(200, { ok: true, koers, bron: "partnerportaal (wisselkoers.nl EUR/USD min 0,03)" });
    }
    if (url.pathname === "/amerika/qb/approve" && request.method === "POST") return qbHandleApprove(request, env);
    if (url.pathname === "/amerika/qb/audrey"  && request.method === "POST") return qbHandleAudrey(request, env);
    if (url.pathname === "/amerika/qb/verwerkt" && request.method === "POST") return qbHandleVerwerkt(request, env);
    if (url.pathname === "/amerika/qb/verberg" && request.method === "POST") return verbergHandler(request, env, "qb-verborgen");
    if (url.pathname === "/voorraad/verberg" && request.method === "POST") return verbergHandler(request, env, "spa-verborgen");

    // Bankkoppeling. Lezen mag met de team-sleutel; boeken verandert de
    // administratie en vereist daarom de beheersleutel, net als het aanmaken
    // van een inkooporder.
    if (url.pathname === "/bank/openstaand" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const body = await request.json().catch(() => ({}));
      return reply(200, await bankOpenstaand(env, !!body.vers).catch(e => ({ ok: false, error: String(e.message || e) })));
    }
    if (url.pathname === "/bank/debiteuren" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const body = await request.json().catch(() => ({}));
      return reply(200, await bankDebiteuren(env, body.ids).catch(e => ({ ok: false, error: String(e.message || e) })));
    }
    if (url.pathname === "/bank/orders" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const body = await request.json().catch(() => ({}));
      return reply(200, await bankOrders(env, body.nrs).catch(e => ({ ok: false, error: String(e.message || e) })));
    }
    if (url.pathname === "/bank/factuurorder" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const body = await request.json().catch(() => ({}));
      return reply(200, await bankFactuurOrder(env, body.paren).catch(e => ({ ok: false, error: String(e.message || e) })));
    }
    if (url.pathname === "/bank/boeken" && request.method === "POST") {
      // Boeken zat eerst achter een aparte sleutel. Dat leverde niets op en
      // kostte wel gedoe: Osman kon niet werken en er moest een wachtwoord
      // rondgaan (8 aug 2026). Wie deze tegel kan openen is al iemand van
      // financiën met een geldige Logic4-inlog, en elke boeking wordt op naam
      // vastgelegd. Daarom: team-sleutel plus een korte lijst van wie mag
      // boeken. Diezelfde lijst staat in dashboard.html en bepaalt wie de
      // tegel überhaupt ziet.
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const body0 = await request.clone().json().catch(() => ({}));
      const wie = String(body0.door || "").toLowerCase();
      if (!BANK_BOEKERS.has(wie)) {
        return reply(403, { ok: false, error: "niet-gemachtigd-om-te-boeken", wie });
      }
      const body = await request.json().catch(() => ({}));
      return reply(200, await bankBoeken(env, body).catch(e => ({ ok: false, error: String(e.message || e) })));
    }

    // Grootboekrekeningen + de btw-code van 0%, voor de memoriaalregels.
    if (url.pathname === "/bank/grootboeken" && request.method === "GET") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      return reply(200, await bankGrootboeken(env).catch(e => ({ ok: false, error: String(e.message || e) })));
    }

    // Een bankregel die niet bij één order hoort als memoriaal wegschrijven.
    if (url.pathname === "/bank/memoriaal" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const b0 = await request.clone().json().catch(() => ({}));
      if (!BANK_BOEKERS.has(String(b0.door || "").toLowerCase())) {
        return reply(403, { ok: false, error: "niet-gemachtigd-om-te-boeken" });
      }
      const b = await request.json().catch(() => ({}));
      return reply(200, await bankMemoriaal(env, b).catch(e => ({ ok: false, error: String(e.message || e) })));
    }

    // De dagboeken uit Logic4, zodat de tegel kan laten kiezen in welk dagboek
    // een betaling landt in plaats van dat er een nummer geraden wordt.
    if (url.pathname === "/bank/dagboeken" && request.method === "GET") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      try {
        const token = await l4Token(env);
        const r = await fetch("https://api.logic4server.nl/v3/Financial/GetFinancialBooks", {
          method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
          body: "{}",
        });
        const tekst = await r.text();
        let j = null; try { j = JSON.parse(tekst); } catch {}
        if (!r.ok) return reply(200, { ok: false, error: "HTTP " + r.status, antwoord: tekst.slice(0, 300) });
        const lijst = Array.isArray(j) ? j : (j && (j.Value || j.Records || j.FinancialBooks)) || [];
        return reply(200, { ok: true, dagboeken: (lijst || []).map(x => ({
          id: x.Id != null ? x.Id : (x.BookingId != null ? x.BookingId : null),
          naam: x.Name || x.Description || x.Code || "",
        })).filter(x => x.id != null) });
      } catch (e) { return reply(200, { ok: false, error: String(e.message || e) }); }
    }

    // Prijslijsten van fabrikanten en leveranciers (Gretha) — de bestanden
    // zelf. Het overzicht eromheen loopt via bucket 'prijslijsten'.
    if (url.pathname === "/prijslijst/bestand" && request.method === "PUT") return plZetBestand(request, env, url);
    if (url.pathname === "/prijslijst/bestand" && request.method === "GET") return plGeefBestand(request, env, url);
    if (url.pathname === "/prijslijst/verwijder" && request.method === "POST") return plWisBestand(request, env);

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
    // NIET benaderbaar met de team-sleutel — die staat na het inloggen op de
    // computer van elke medewerker. Daarvoor geldt de smallere beheersleutel
    // DP_ADMIN_KEY; zie de toelichting bij dpIsAdmin.
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
      // genoeg voor onze schaal van enkele tientallen records).
      // Uitzonderingen, elk met een reden:
      //   geldgoederen/gg-bevindingen — per controle honderden bevindingsregels
      //     plus een historie van de totalen; bewust één momentopname.
      //   specsheets — de foto's zitten als base64 in de sheet zelf. Eén sheet
      //     met een productfoto en een technische tekening is al gauw een halve
      //     MB, dus met een handvol modellen liep Gretha tegen de grens (3 aug
      //     2026). Het scherm zei "bewaard tot 20 MB", de worker weigerde vanaf
      //     1 MB. Die twee staan nu op hetzelfde getal.
      //   specsheet-<id> — één losse sheet met zijn foto's. 8 MB is ruim voor
      //     een productfoto, een technische tekening en de icoontjes.
      //   prijslijsten — alleen de mappenboom en de gegevens per bestand (de
      //     bestanden zelf staan apart). Een paar honderd regels past ruim in
      //     1 MB, maar met 4 loopt Gretha ook bij honderden lijsten met een
      //     lange versiehistorie nergens tegenaan.
      const RUIM = { geldgoederen: 8, "gg-bevindingen": 8, specsheets: 20, prijslijsten: 4, "bank-openstaand": 4, "bank-geboekt": 4 };
      const perSheet = /^specsheet-/.test(bucket) ? 8 : 0;
      const limiet = (perSheet || RUIM[bucket] || 1) * 1024 * 1024;
      if (body.length > limiet) {
        return reply(413, `Payload too large (max ${limiet / 1024 / 1024} MB)`);
      }
      await env.FONTEYN_DATA.put(bucket, body);
      return reply(200, { ok: true, bytes: body.length });
    }

    return reply(405, "Method not allowed");
  },
};
