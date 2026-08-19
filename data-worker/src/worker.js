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
  // Jazzi-bestellingen die écht zijn verwijderd, mét hun regels. Verwijderen
  // haalt ze uit voorraad-pipeline en dus overal weg; hier staat wat er weg
  // ging, door wie en wanneer, zodat een vergissing terug te draaien is.
  "voorraad-verwijderd",
  // Verizon Connect: welke bakwagens er zijn (voertuignummer + kenteken/naam),
  // het laatst opgehaalde positiebeeld en het toegangstoken. Dat token is maar
  // twintig minuten geldig en moet bewaard worden - elke keer een nieuwe halen
  // is zonde en Verizon houdt dat bij.
  "verizon-instellingen", "verizon-posities", "verizon-token",
  // Artikelen die de spa-catalogus niet kent, opgezocht in Logic4 op naam.
  // Ook een "niet gevonden" blijft staan: anders zoekt elk scherm opnieuw.
  "artikel-opzoek",
  // Welk mailadres hoort bij welke inlog. Staat los van Logic4 met opzet:
  // Dolf logt daar in als fonteyn.dolf en zijn mail is dolf@fonteyn.nl.
  // De persoonlijke mailsleutels staan hier NIET in - die krijgen een eigen
  // sleutel met vervaldatum en zijn daarmee via /data niet op te vragen.
  "mail-adressen",
  /* uren-codes en de maandbestanden staan hier NIET. In uren-codes zitten de
     afgeleiden van de persoonlijke codes, en in de maanden staat wie wanneer
     waar was; dat hoort niet met de teamsleutel op te vragen te zijn. Het gaat
     via /uren/, langs de persoonlijke sleutel. */
  "uren-instellingen",
  // Orderbevestigingen van de meubelfabrieken: wat er besteld is, per S/C
  // nummer. Alleen wat er in het document staat - geen prijzen.
  "bestellingen",
  // Omschrijving van de fabriek naar Logic4-artikel. Eén keer invullen, en
  // dan herkent het dashboard dezelfde sauna in elke volgende container.
  "artikel-koppeling",
  // Containers die eraan komen, met per container de colli uit de packing
  // list. Hier haalt Inkomende goederen de labels uit.
  "binnenkomend",
  // De bezorgingen waarvoor een klant een volglink heeft gekregen: code →
  // naam, adres, welke wagen en welke dag. Alleen de code opent de pagina, dus
  // die moet lang genoeg zijn om niet te raden te zijn.
  "bezorgingen",
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
  // Bankkoppeling: welk dagboek waarvoor. Bewust bij de worker en niet in de
  // browser: het memoriaal-dagboek en de tussenrekeningen zijn voor iedereen
  // hetzelfde, dus als Osman het één keer aanwijst hoeft niemand het daarna
  // nog een keer te doen - ook niet op een andere computer.
  "bank-instellingen",
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
  // De vorige versie van een sheet. Zie de toelichting bij het wegschrijven:
  // twee sheets van Demi zijn leeg geraakt en er was niets om op terug te
  // vallen. Nu is er dat wel.
  /^specsheet-[a-z0-9]{4,24}-vorige$/,
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
  /* Naast de teamsleutel een persoonlijke sleutel voor de mailtegel. Die
     hoort bij déze naam en bij niemand anders, want de teamsleutel is bij
     iedereen bekend en zou de mailbox van collega's openzetten. Dit gebeurt
     bij het gewone inloggen, dus niemand hoeft iets extra's te doen. Gaat
     het opslaan mis, dan gaat het inloggen gewoon door: zonder mailsleutel
     werkt alleen de mailtegel niet, de rest van het dashboard wel. */
  let mailsleutel = null;
  try {
    /* Het Logic4-token dat we net kregen gaat mee. Daarmee kan een tegel op
       een telefoon gegevens ophalen ónder de naam van deze gebruiker, met
       precies de rechten die hij in Logic4 heeft. De alternatieven waren
       slechter: het wachtwoord bewaren (nooit doen) of alles als fonteynbot
       doen (dan zou het dashboard de Logic4-rechten omzeilen). Het token
       vervalt na een uur; daarna staat er niets meer en zegt het dashboard
       dat er even opnieuw ingelogd moet worden. */
    mailsleutel = await mailSleutelGeef(env, username, {
      token: j.access_token,
      tot: Date.now() + (Number(j.expires_in) || 3600) * 1000,
    });
  }
  catch (e) { console.log("[teamkey] mailsleutel niet uitgegeven: " + (e.message || e)); }
  return reply(200, { ok: true, teamkey: env.SHARED_SECRET, mailsleutel });
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
  const weg = (await env.FONTEYN_DATA.get("voorraad-verwijderd", { type: "json" })) || { orders: {} };
  return {
    ok: true, crediteur: JAZZI_CREDITEUR, containers: containers,
    schepen: (schepen.ships || []).map(s => ({
      ref: s.ref, vessel: s.vessel, eta: s.eta, containers: s.containers,
      orders: [...spaOrdersUitSchip(s.ref)],
      // De papieren bij dit schip: de commercial invoice waarmee hij is
      // ingelezen, en wat er later bij is gezet (packing list en de rest).
      documenten: s.documenten || [],
    })),
    // Wat Chantal heeft verwijderd. Het scherm heeft dit nodig om niet meteen
    // te gaan roepen dat die order "wel op een schip staat maar niet in de
    // containerlijst" - dat is dan geen vergissing maar de bedoeling.
    verwijderd: Object.keys(weg.orders || {}),
    aliassen: aliassen
  };
}

/* ─── Een Jazzi-bestelling echt weghalen ───────────────────────────────────
   Wegklikken bestond al, maar dat haalt hem alleen van het scherm en telt
   overal gewoon door. Chantal vroeg om echt verwijderen: "Deze mag dan ook
   nergens meer meetellen. De inkooporder in Logic4 heb ik zelf al verwijderd"
   (12 aug 2026).

   Daarom gaat de bestelling uit voorraad-pipeline - dat is de bron waar de
   forecast, de reserveringen en het laden van containers ook uit lezen, dus
   daarmee is hij overal weg. Het briefje "hier is inkooporder 37830 van
   gemaakt" gaat mee: die inkooporder bestaat niet meer, en als dat blijft
   staan zou het scherm blijven beweren dat het in Logic4 geregeld is.

   Wat er weggaat wordt eerst apart weggeschreven, met wie en wanneer. Een
   bestelling van 480 spa's is te veel werk om per ongeluk kwijt te raken. */
async function spaMigratieVerwijderen(env, body) {
  const nr = String(body.nr || "").trim();
  if (!nr) return { ok: false, error: "geen ordernummer meegegeven" };

  const pipeline = (await env.FONTEYN_DATA.get("voorraad-pipeline", { type: "json" })) || {};
  const lijst = pipeline.containers || [];
  const c = lijst.find(x => String(x.nr || "").trim() === nr);
  if (!c) return { ok: false, error: "Jazzi-order " + nr + " staat niet (meer) in de containerlijst" };

  const gedaan = (await env.FONTEYN_DATA.get("voorraad-inkooporders", { type: "json" })) || { orders: {} };
  const ref = "Jazzi-order " + nr;
  const inkooporder = (gedaan.orders || {})[ref] || null;

  // Eerst bewaren, dan pas weghalen.
  const weg = (await env.FONTEYN_DATA.get("voorraad-verwijderd", { type: "json" })) || { orders: {} };
  weg.orders = weg.orders || {};
  weg.orders[nr] = { container: c, inkooporder: inkooporder,
                     ts: new Date().toISOString(), door: String(body.door || "").slice(0, 80) };
  await env.FONTEYN_DATA.put("voorraad-verwijderd", JSON.stringify(weg));

  pipeline.containers = lijst.filter(x => String(x.nr || "").trim() !== nr);
  await env.FONTEYN_DATA.put("voorraad-pipeline", JSON.stringify(pipeline));
  if (inkooporder) {
    delete gedaan.orders[ref];
    await env.FONTEYN_DATA.put("voorraad-inkooporders", JSON.stringify(gedaan));
  }

  /* De schepen blijven met rust. Daar staat de order in een tekstveld dat
     Chantal zelf bijhoudt ("RZ2009DF3332-7&3342-3 to Rotterdam"), en daar het
     mes in zetten zou een schipregel kunnen slopen die verder klopt. Ze krijgt
     wel te horen wélke schepen deze order nog noemen. */
  const schepen = (await env.FONTEYN_DATA.get("voorraad-schepen", { type: "json" })) || {};
  const opSchepen = (schepen.ships || [])
    .filter(s => [...spaOrdersUitSchip(s.ref)].indexOf(nr) >= 0)
    .map(s => ({ ref: s.ref, eta: s.eta || null }));

  const spas = (c.lines || []).reduce((t, l) => t + (Number(l.qty) || 0), 0);
  return { ok: true, nr: nr, spas: spas, regels: (c.lines || []).length,
           inkooporder: inkooporder ? inkooporder.buyOrderId : null, schepen: opSchepen };
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

/* ─── Wat de spa-catalogus niet kent, opzoeken in Logic4 zelf ──────────────
   Chantal (video, 13 aug 2026): "bij die Calgary staat 'artikel niet te
   herleiden uit model en kleur'. Dat vind ik raar, want de Calgary staat
   perfect in Logic4."

   Ze heeft gelijk, en de reden is niet dat het artikel ontbreekt maar dat de
   spa-catalogus alleen de spa-groepen bevat: spa's, zwemspa's en ijsbaden.
   De Calgary is een sauna. Die vaart in dezelfde container mee maar zit in
   een andere artikelgroep en komt dus nooit in die catalogus terecht.

   De groep erbij zetten zou de Calgary oplossen en de volgende weer niet - er
   komen tuinmeubelen aan, en die zitten in wéér een andere groep. Daarom
   andersom: wat de catalogus niet kent wordt in Logic4 opgezocht op naam.
   FastSearchText doorzoekt artikelcode, beide productnamen en de tags.

   Het antwoord blijft bewaard, ook een "niet gevonden". Anders zou elk
   scherm dat dit voorstel opent dezelfde vergeefse zoektocht opnieuw doen, en
   op de gratis laag mag een aanroep maar vijftig verzoeken doen. Om diezelfde
   reden maximaal acht nieuwe namen per keer; de rest volgt de ronde erna. */
const ARTIKEL_ZOEK_MAX = 8;
function artikelSleutel(model, kleur) {
  return String(model || "").trim().toLowerCase() +
         (kleur && kleur !== "(geen kleur)" ? "|" + String(kleur).trim().toLowerCase() : "");
}
async function ikoZoekBuitenCatalogus(env, gezocht) {
  const cache = (await env.FONTEYN_DATA.get("artikel-opzoek", { type: "json" })) || { namen: {} };
  cache.namen = cache.namen || {};
  const nieuw = gezocht.filter(g => !(artikelSleutel(g.model, g.kleur) in cache.namen))
                       .slice(0, ARTIKEL_ZOEK_MAX);
  if (!nieuw.length) return cache.namen;

  const token = await l4Token(env);
  for (const g of nieuw) {
    const sleutel = artikelSleutel(g.model, g.kleur);
    try {
      const r = await fetch("https://api.logic4server.nl/v3/Products/GetProducts", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ FastSearchText: String(g.model || "").trim(), TakeRecords: 25 }),
      });
      const j = await r.json().catch(() => null);
      const lijst = Array.isArray(j) ? j : ((j && (j.Records || j.Products)) || []);
      /* Op naam zoeken levert ook de accessoires op die het model in hun naam
         hebben ("Cover Calgary", "Onderhoudsset Calgary"). Daarom: de naam
         moet het model als heel woord bevatten, en van wat overblijft nemen we
         de kortste. Het model zelf heet nu eenmaal korter dan zijn toebehoren.

         Eerst eiste dit dat de naam mét het model begínt. Dat was te streng:
         bij Fonteyn staat er meestal een merk of soort voor ("Fonteyn | Sauna
         Calgary"), en dan viel het artikel af terwijl het er gewoon was. */
      const naam = String(g.model || "").trim().toLowerCase();
      const heelWoord = new RegExp("(^|[^a-z0-9])" + naam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)", "i");
      const passend = lijst
        .map(p => ({ code: String(p.ProductCode || ""), productId: p.ProductId,
                     desc: String(p.ProductName1 || p.Description || "") }))
        .filter(p => p.code && heelWoord.test(p.desc))
        .sort((a, b) => a.desc.length - b.desc.length);
      /* Alleen koppelen als er precies één artikel op de naam past. Bij de
         Calgary kwamen er vier terug, waaronder "Grizzly spa | Cover Calgary",
         en de kortste naam pakken leverde dus de hoes op in plaats van de
         sauna. Een verkeerd artikel op een inkooporder is erger dan geen
         artikel, dus bij twijfel koppelt hij niet en laat hij de keuze zien. */
      cache.namen[sleutel] = passend.length === 1
        ? { code: passend[0].code, productId: passend[0].productId, desc: passend[0].desc }
        : (passend.length
          ? { keuzes: passend.slice(0, 6).map(p => p.code + " " + p.desc) }
          : { geen: true });
    } catch (e) { cache.namen[sleutel] = { geen: true, fout: String(e.message || e).slice(0, 120) }; }
  }
  await env.FONTEYN_DATA.put("artikel-opzoek", JSON.stringify(cache));
  return cache.namen;
}

async function spaOntvangstVoorstel(env) {
  /* De koppelingen omschrijving-naar-artikel. Eén keer ophalen; ze gelden
     voor alle containers samen, want dezelfde sauna komt telkens terug. */
  const koppelingen = await artikelKoppelingen(env);
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

  /* Eerst inventariseren wat de catalogus niet kent, en dat in één ronde bij
     Logic4 opzoeken. Per regel zoeken zou tientallen verzoeken kosten. */
  const onbekend = [];
  for (const s of (schepen.ships || [])) {
    const kl = s.modelColors || {};
    for (const model of Object.keys(s.models || {})) {
      const perKleur = kl[model] && Object.keys(kl[model]).length ? kl[model] : { "": s.models[model] };
      for (const kleur of Object.keys(perKleur)) {
        if (!Number(perKleur[kleur])) continue;
        const a = ikoZoekArtikel(catalog, model, kleur, kleur, aliassen);
        if (!(a && a.code) && !onbekend.some(x => x.model === model)) onbekend.push({ model, kleur });
      }
    }
  }
  const buitenCatalogus = onbekend.length
    ? await ikoZoekBuitenCatalogus(env, onbekend).catch(() => ({}))
    : {};

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
        let art = ikoZoekArtikel(catalog, model, kleur, kleur, aliassen);
        // Niet in de spa-catalogus? Dan wat Logic4 zelf op die naam gaf. Een
        // sauna of een tuinset staat in een andere artikelgroep en komt daar
        // dus nooit in, terwijl het artikel gewoon bestaat.
        let buiten = null, buitenKeuzes = null;
        if (!(art && art.code)) {
          const gevonden = buitenCatalogus[artikelSleutel(model, kleur)];
          if (gevonden && gevonden.code) {
            buiten = gevonden;
            art = { code: gevonden.code, desc: gevonden.desc, zeker: true };
          } else if (gevonden && gevonden.keuzes) {
            buitenKeuzes = gevonden.keuzes;
          }
        }
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
                : (buitenKeuzes
                  ? "staat niet in de spa-catalogus; Logic4 heeft meerdere artikelen op deze naam - kies zelf welke: " + buitenKeuzes.join(" · ")
                  : "dit model staat niet in de spa-catalogus en Logic4 kent geen artikel met deze naam"))),
          // Buiten de spa-catalogus om gevonden: dat mag je zien, want de
          // koppeling berust dan op de naam en niet op de codelijst.
          buitenCatalogus: buiten ? true : undefined,
          buitenKeuzes: buitenKeuzes || undefined,
        });
      }
    }

    uit.push({
      ref: s.ref, vessel: s.vessel || "", eta: s.eta || null,
      containers: s.containers || null, bestand: s.file || "",
      /* De trackingreferentie en wat de vervoerder er het laatst over zei.
         Stonden op het tabblad Schepen; dat is opgegaan in dit scherm, dus ze
         horen nu per container hier te staan (Chantal, 13 aug 2026). */
      // Een container waarvan we alleen de papieren bewaren: tuinmeubelen,
      // sauna's. Zijn inhoud telt nergens mee (Chantal, 14 aug 2026).
      alleenDocumenten: !!s.alleenDocumenten,
      // Van de Bill of Lading: het zegel en het vrachtbriefnummer.
      zegel: s.zegel || null, blNo: s.blNo || null,
      trackRef: s.trackRef != null ? s.trackRef : (s.ref || ""),
      track: s.track || null,
      documenten: s.documenten || [],
      jazziOrders: hoortBij,
      // Welke van die orders bestaan al als inkooporder in Logic4?
      gekoppeld: hoortBij.filter(nr => !!orders[nr]),
      ontbreekt: hoortBij.filter(nr => !orders[nr]),
      spas: regels.reduce((t, r) => t + r.aantal, 0),
      raak: raak, mis: mis, regels: regels,
      /* Wat er wel op de factuur stond maar aan geen enkel artikel te koppelen
         was. Bij de zending van 28 aug 2026 zijn dat drie swimspa's, tien
         sauna's en zes onderdelen: die staan in de factuur met omschrijving,
         aantal en sectie, maar niet in de spa-catalogus, want daar zitten
         alleen spa's, zwemspa's en ijsbaden in.

         Die stonden daardoor in geen enkel scherm - het veld bestond, maar het
         enige dat het toonde filtert op regels met een ordernummer of een
         klantnaam en die hebben deze niet. Drieëntwintig stuks onzichtbaar.

         Ze tellen nog steeds niet mee als voorraad; dat kan pas als er een
         artikel aan hangt. Maar zichtbaar horen ze wel te zijn. */
      /* Twee soorten regels heten allebei "specials". De ene komt uit de
         xls-lezer en is een herkende spa met een bijzonderheid: die heeft een
         model en een qty, en telt hierboven al mee. De andere komt uit de
         pdf-lezer en is juist een regel die aan geen artikel te koppelen was:
         die heeft een omschrijving en een sectie.

         Alleen die tweede hoort hier. Op "omschrijving of model" filteren
         leverde bij de echte gegevens honderdzeventien regels op in plaats van
         drieëntwintig - elke spa er nog een keer bij. */
      ongekoppeld: (s.specials || [])
        .filter(x => x && !x.ordernr && !x.klant && x.omschrijving && !x.model)
        .map(x => {
          const oms = String(x.omschrijving).slice(0, 120);
          const k = koppelingen[koppelSleutel(oms)];
          return { omschrijving: oms,
                   aantal: Number(x.aantal) || 0,
                   sectie: String(x.sectie || "").slice(0, 40),
                   artikel: k ? { code: k.code, naam: k.naam || "" } : null };
        })
        .filter(x => x.aantal > 0),
    });
  }

  uit.sort((a, b) => String(a.eta || "9999").localeCompare(String(b.eta || "9999")));
  return { ok: true, schepen: uit, inkooporders: Object.keys(orders).length,
    /* Fabriekscodes uit een commercial invoice die aan geen model te koppelen
       waren. Die waarschuwing stond op het tabblad Schepen; dat is opgegaan in
       dit scherm, en zonder deze regel zou ze stil verdwijnen - terwijl het
       betekent dat er spa's in een container zitten die nergens meetellen. */
    unmapped: schepen.unmapped || {} };
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
/* ═══════════════════════════════════════════════════════════════════════════
   AANKOMST OPHALEN — één ingang, meerdere vervoerders
   ═══════════════════════════════════════════════════════════════════════════

   Chantal (video, 13 aug 2026): "let erop dat hij die ETA en die voortgang bij
   alle partijen waar we mee samenwerken ophaalt. Dus zowel van Merzario, DHL
   als Flexport."

   Elke vervoerder heeft zijn eigen manier van antwoorden. Om te voorkomen dat
   het scherm dat allemaal moet weten, gaat het hier langs één lijst: hij
   probeert ze op volgorde en geeft het eerste bruikbare antwoord terug, met
   erbij wie het gaf. Komt er een vervoerder bij, dan is dat één regel hier en
   verandert er niets aan het scherm.

   Merzario en Flexport draaien. DHL staat er al in maar heeft nog geen
   toegang: die aanvraag loopt. Zolang die er niet is meldt hij zichzelf netjes
   als 'nog niet aangesloten' in plaats van te doen alsof er niets is. MTO
   idem. */
const VERVOERDERS = [
  { naam: "Merzario", zoek: aankomstMerzario },
  { naam: "Flexport", zoek: aankomstFlexport },
  { naam: "DHL",      zoek: aankomstDHL },
  { naam: "MTO",      zoek: aankomstMTO },
];

async function aankomstMerzario(env, ref) {
  const res = await merzarioTrack(env, [ref], {});
  delete res.__error;
  const rec = res[ref] || Object.values(res)[0];
  if (!rec) return null;
  return {
    eta: rec.eta || rec.ETA || null,
    vessel: rec.vessel || rec.vesselName || null,
    status: rec.status || rec.lastStatus || null,
  };
}

async function aankomstFlexport(env, ref) {
  // Flexport wordt niet per referentie bevraagd - het hele overzicht staat al
  // in de opslag omdat een verse ronde ruim twee minuten duurt. Dus zoeken we
  // erin in plaats van erom te vragen.
  const bewaard = await env.FONTEYN_DATA.get("flexport-zendingen", { type: "json" });
  if (!bewaard || !Array.isArray(bewaard.zendingen)) return null;
  const zoek = String(ref).toUpperCase().replace(/\s+/g, "");
  const raak = bewaard.zendingen.find(z =>
    [z.ref, z.naam, z.containerNr, ...(z.containers || [])]
      .filter(Boolean).some(x => String(x).toUpperCase().replace(/\s+/g, "").includes(zoek)));
  if (!raak) return null;
  return { eta: raak.eta || null, vessel: raak.vessel || null, status: raak.status || null };
}

/* DHL Global Forwarding. De aanvraag voor API-toegang loopt: er zijn een App
   ID en REST-inloggegevens nodig, en die geeft DHL alleen uit na goedkeuring
   per API. Zodra ze er zijn hoeft hier alleen de aanroep ingevuld te worden;
   de rest van de keten staat al klaar. */
async function aankomstDHL(env, ref) {
  if (!env.DHL_API_KEY) return { nogNiet: true, reden: "DHL is nog niet aangesloten; de API-aanvraag loopt" };
  return null;
}
// MTO: nog geen afspraak over een koppeling.
async function aankomstMTO(env, ref) {
  if (!env.MTO_API_KEY) return { nogNiet: true, reden: "MTO is nog niet aangesloten" };
  return null;
}

async function aankomstZoek(env, ref) {
  const schoon = String(ref || "").trim();
  if (!schoon) return { ok: false, error: "geen referentie meegegeven" };
  const nietAangesloten = [];
  for (const v of VERVOERDERS) {
    try {
      const uit = await v.zoek(env, schoon);
      if (!uit) continue;
      if (uit.nogNiet) { nietAangesloten.push(v.naam); continue; }
      if (uit.eta || uit.status || uit.vessel)
        return { ok: true, vervoerder: v.naam, eta: uit.eta || null,
                 vessel: uit.vessel || null, status: uit.status || null, nietAangesloten };
    } catch (e) { /* een vervoerder die stukloopt mag de rest niet blokkeren */ }
  }
  return { ok: false, error: "geen van de vervoerders kent deze referentie", nietAangesloten };
}

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
  // Reinier K. - eigen account, met punt in de naam (Logic4: Reinier.K).
  "reinier.k@fonteyn.nl", "reinier.k", "fonteyn.reinier.k",
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

/* De openstaande crediteurfacturen. Gerrit (19 aug 2026): "Op een MT940 staan
   inkomsten en uitgaven. De uitgaven moeten op dezelfde manier worden geboekt
   aan crediteurenfacturen zoals inkomsten op debiteurenfacturen."

   Anders dan aan de debiteurenkant staat hier de naam van de leverancier al
   in de post, dus die hoeft niet apart opgehaald te worden. */
async function bankOpenstaandCrediteuren(env, vers) {
  const bewaard = await env.FONTEYN_DATA.get("bank-openstaand-cred", { type: "json" });
  if (!vers && bewaard && bewaard.updated && (Date.now() - Date.parse(bewaard.updated)) < BANK_CACHE_TTL) {
    return { ok: true, uitCache: true, updated: bewaard.updated, posten: bewaard.posten || [] };
  }
  const token = await l4Token(env);
  const r = await fetch("https://api.logic4server.nl/v3/Relations/GetCreditorOutstandingPosts", {
    method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error("Logic4 gaf HTTP " + r.status + " op de openstaande crediteuren");
  const lijst = await r.json();
  /* Alleen wat de koppeling nodig heeft. Een post zonder openstaand bedrag is
     afgehandeld; een creditnota (negatief) blijft er wél in, want die telt mee
     als een betaling meerdere facturen tegelijk voldoet. */
  const posten = (Array.isArray(lijst) ? lijst : [])
    .filter(p => p && p.CreditorId != null && Number(p.AmountOpen))
    .map(p => ({
      Id: p.Id, CreditorId: p.CreditorId,
      CompanyName: p.CompanyName || "",
      Reference: p.Reference || "",
      AmountOpen: Number(p.AmountOpen) || 0,
      AmountPaid: Number(p.AmountPaid) || 0,
      Date: p.Date || null, PayBefore: p.PayBefore || null,
      Description: p.Description || "",
    }));
  const opslag = { updated: new Date().toISOString(), posten };
  await env.FONTEYN_DATA.put("bank-openstaand-cred", JSON.stringify(opslag));
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
    const orderNr = Number(r.orderNr) || 0;
    /* Een betaling mag ook rechtstreeks op een factuur. AddPayment kent naast
       OrderId ook InvoiceId, en dat is precies wat er nodig is als de order
       al is afgehandeld maar de factuur nog openstaat - het geval van
       Fennema Elektro (Gerrit, 19 aug 2026). */
    const factuurNr = Number(r.invoiceId || r.factuurNr) || 0;
    const bedrag = Number(r.bedrag);
    if (!orderNr && !factuurNr) { uit.push({ ...r, ok: false, error: "geen ordernummer en geen factuurnummer" }); continue; }
    if (!(bedrag > 0)) { uit.push({ ...r, ok: false, error: "bedrag ontbreekt of is niet positief" }); continue; }
    // De omschrijving is wat Osman later in Logic4 terugziet. Datum en
    // afschrift erin, zodat een boeking naar de bankregel terug te leiden is.
    const omschrijving = String(r.omschrijving || "").slice(0, 200) || "Bankbetaling";
    /* De datum van de bankregel, niet de dag waarop iemand zit te boeken.
       Gerrit (19 aug 2026): "ook al doe ik de boeking op 10 augustus, ik wil
       dat die betaling van 5 augustus komt in het bankdagboek van 5 augustus."

       Hier stond een terugval op vandaag als de datum ontbrak. Dat is precies
       hoe een boeking op de verkeerde dag ontstaat zonder dat iemand het ziet.
       Nu wordt de regel geweigerd in plaats van op een verzonnen dag geboekt,
       en gaat de gebruikte datum mee terug zodat hij te controleren is. */
    const datum = String(r.datum || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
      uit.push({ ...r, ok: false,
        error: "deze regel heeft geen leesbare datum, en er wordt geen datum verzonnen. " +
               "Een betaling hoort in het dagboek van de dag waarop hij binnenkwam." });
      continue;
    }
    try {
      const resp = await fetch("https://api.logic4server.nl/v3/Orders/AddPayment", {
        method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(orderNr ? { OrderId: orderNr } : { InvoiceId: factuurNr }),
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
        uit.push({ ...r, ok: true, geboekt: bedrag, datumGebruikt: datum,
                   op: orderNr ? ("order " + orderNr) : ("factuur " + factuurNr) });
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
  /* GetLedgers en GetVatCodes zijn GET, niet POST. Logic4 doet dat niet
     overal hetzelfde: GetFinancialBooks is wél POST. Met POST komt er een
     405 terug ("Method Not Allowed"), en dat is precies waar Osman op stuitte
     bij de eerste memoriaalpoging (12 aug 2026). Staat in de openapi-
     beschrijving van Logic4; ik was ervan uitgegaan dat alles POST was. */
  const haal = async (pad, methode) => {
    const r = await fetch("https://api.logic4server.nl" + pad, methode === "GET"
      ? { method: "GET", headers: { "Authorization": "Bearer " + token } }
      : { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: "{}" });
    const tekst = await r.text();
    let j = null; try { j = JSON.parse(tekst); } catch {}
    if (!r.ok) throw new Error(pad + " gaf HTTP " + r.status + " — " + tekst.slice(0, 200));
    return Array.isArray(j) ? j : ((j && (j.Value || j.Records)) || []);
  };
  const [ledgers, btw] = await Promise.all([
    haal("/v3/Financial/GetLedgers", "GET"),
    haal("/v3/Financial/GetVatCodes", "GET"),
  ]);
  /* Welke btw-code hoort bij een boeking op een tussenrekening?

     Hier stond "de eerste met 0 procent", en dat was fout. Logic4 heeft er
     meerdere, en de eerste bleek "0% BTW Verlegd NL". Verlegd is geen nul
     maar een verlegging naar de afnemer, en dat hoort in de aangifte thuis;
     een pinafrekening is gewoon vrijgesteld. Reinier boekte handmatig op BTW
     Vrij, het dashboard zette er Verlegd onder, en dat verschil zag Osman
     meteen (14 aug 2026).

     Dus: eerst een code die zich vrij of vrijgesteld noemt, en pas als die er
     niet is een andere nulcode. Verlegd wordt bewust nooit als eerste keus
     genomen. */
  /* Twee codes heten letterlijk "NIET GEBRUIKEN!!! 0% leveringen Duitsland".
     Die horen nergens in een automatische keuze thuis, dus ze doen niet mee. */
  var nullen = (btw || []).filter(v => Number(v.Percent) === 0 &&
                                       !/niet\s*gebruiken/i.test(String(v.Name || "")));
  var vrij = nullen.find(v => /vrij|vrijgesteld|geen\s*btw/i.test(String(v.Name || "")) &&
                              !/verlegd/i.test(String(v.Name || "")));
  var nul = vrij || nullen.find(v => !/verlegd/i.test(String(v.Name || ""))) || nullen[0];
  return {
    ok: true,
    grootboeken: (ledgers || []).map(l => ({ id: l.Id, code: l.Code, naam: l.Description || "" })),
    btwNul: nul ? { id: nul.Id, naam: nul.Name || "", percent: nul.Percent } : null,
    // Alle nulcodes erbij, zodat te zien is waaruit gekozen is.
    btwOpties: nullen.map(v => ({ id: v.Id, naam: v.Name || "", percent: v.Percent })),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   VERIZON CONNECT — waar rijdt de bakwagen
   ═══════════════════════════════════════════════════════════════════════════

   Gerrit wil klanten op de bezorgdag een pagina kunnen geven waarop staat waar
   hun bakwagen is. De trackers zitten er al in; Verizon Connect Reveal heeft
   er een API voor.

   Hoe het werkt
   -------------
   Twee stappen. Eerst een token halen met de REST-inloggegevens; dat token is
   ongeveer twintig minuten geldig. Daarna elke aanroep met dat token én een
   App ID in dezelfde kop:

       Authorization: Atmosphere atmosphere_app_id=<app id>, Bearer <token>

   Het mooie van deze API: POST /vehicles/locations neemt een lijst
   voertuignummers en geeft ze állemaal in één aanroep terug. Dat scheelt: op
   de gratis laag van Cloudflare mag een aanroep maar 50 verzoeken doen, dus
   per wagen pollen zou niet uit kunnen.

   Verizon zegt zelf: niet vaker dan eens per drie tot vijf minuten. Daarom
   wordt het antwoord vier minuten bewaard; wie sneller ververst krijgt wat er
   al lag.

   Zonder sleutels
   ---------------
   Zolang de inloggegevens er niet zijn, geeft dit verzonnen posities terug op
   een route van Uddel naar het westen. Zo is de pagina eromheen te bouwen en
   te bekijken zonder dat er iets echt hoeft te werken. In het antwoord staat
   dan `demo: true`; dat hoort ook op het scherm te komen, want een verzonnen
   positie mag nooit voor een echte doorgaan.

   Europees, niet Amerikaans. De Amerikaanse omgeving kent onze wagens niet.
   ═══════════════════════════════════════════════════════════════════════════ */
const VERIZON_API = "https://fim.api.eu.fleetmatics.com";
const VERIZON_CACHE_MS = 4 * 60 * 1000;

async function verizonToken(env) {
  const bewaard = await env.FONTEYN_DATA.get("verizon-token", { type: "json" });
  if (bewaard && bewaard.token && Date.now() < bewaard.verlooptOp - 60000) return bewaard.token;
  const basis = btoa(env.VERIZON_USER + ":" + env.VERIZON_PASS);
  const r = await fetch(VERIZON_API + "/token", { headers: { "Authorization": "Basic " + basis } });
  const tekst = await r.text();
  if (!r.ok) throw new Error("Verizon-token: HTTP " + r.status + " " + tekst.slice(0, 200));
  let j = null; try { j = JSON.parse(tekst); } catch {}
  const token = (j && (j.access_token || j.token)) || tekst.trim().replace(/^"|"$/g, "");
  if (!token) throw new Error("Verizon gaf geen token terug");
  // Twintig minuten, met een marge omdat een verlopen token midden in een
  // ronde vervelender is dan één token te veel ophalen.
  await env.FONTEYN_DATA.put("verizon-token",
    JSON.stringify({ token, verlooptOp: Date.now() + 18 * 60 * 1000 }));
  return token;
}

/* Verzonnen posities: een wagen die van Uddel richting Amersfoort rijdt en
   een die stilstaat. Genoeg om de pagina op te bouwen. */
function verizonDemo(voertuigen) {
  const route = [
    { lat: 52.2456, lon: 5.7712, plaats: "Uddel",      straat: "Meervelderweg 52",   snelheid: 0 },
    { lat: 52.2131, lon: 5.6402, plaats: "Garderen",   straat: "Putterweg",          snelheid: 62 },
    { lat: 52.1875, lon: 5.5219, plaats: "Voorthuizen", straat: "Hoofdstraat",       snelheid: 48 },
    { lat: 52.1561, lon: 5.3878, plaats: "Amersfoort", straat: "Outputweg",          snelheid: 31 },
  ];
  const nu = new Date().toISOString();
  return (voertuigen.length ? voertuigen : ["BAKWAGEN-1", "BAKWAGEN-2"]).map((nr, i) => {
    const p = route[i % route.length];
    return {
      voertuig: nr, breedtegraad: p.lat, lengtegraad: p.lon,
      adres: { straat: p.straat, postcode: null, plaats: p.plaats, land: "NL" },
      snelheid: p.snelheid, richting: p.snelheid ? "W" : null,
      staat: p.snelheid ? "rijdt" : "staat stil",
      gemetenOp: nu, prive: false,
    };
  });
}

// Het antwoord van Verizon omzetten naar onze eigen velden, zodat de tegel
// niet met Engelse veldnamen hoeft te werken en een wijziging aan hun kant
// hier ophoudt en niet in vier schermen.
function verizonRegel(nr, v) {
  const a = (v && v.Address) || {};
  return {
    voertuig: nr,
    breedtegraad: v && v.Latitude != null ? Number(v.Latitude) : null,
    lengtegraad: v && v.Longitude != null ? Number(v.Longitude) : null,
    adres: {
      straat: [a.AddressLine1, a.AddressLine2].filter(Boolean).join(" ") || null,
      postcode: a.PostalCode || null, plaats: a.Locality || null, land: a.Country || null,
    },
    snelheid: v && v.Speed != null ? Number(v.Speed) : null,
    richting: (v && v.Heading) || null,
    staat: (v && v.DisplayState) || null,
    gemetenOp: (v && v.UpdateUTC) || null,
    // Een rit die als privé staat gemarkeerd hoort niet op een klantpagina.
    prive: !!(v && v.IsPrivate),
  };
}

async function verizonPosities(env, opties) {
  const inst = (await env.FONTEYN_DATA.get("verizon-instellingen", { type: "json" })) || {};
  const voertuigen = (opties && opties.voertuigen) || inst.voertuigen || [];
  const demo = !env.VERIZON_APP_ID || !env.VERIZON_USER || !env.VERIZON_PASS;

  if (!(opties && opties.vers)) {
    const bewaard = await env.FONTEYN_DATA.get("verizon-posities", { type: "json" });
    if (bewaard && bewaard.opgehaald && (Date.now() - Date.parse(bewaard.opgehaald)) < VERIZON_CACHE_MS)
      return { ...bewaard, uitCache: true };
  }
  if (demo) {
    const uit = { ok: true, demo: true, opgehaald: new Date().toISOString(), posities: verizonDemo(voertuigen),
                  uitleg: "Verzonnen posities: de inloggegevens van Verizon staan nog niet ingesteld." };
    await env.FONTEYN_DATA.put("verizon-posities", JSON.stringify(uit));
    return uit;
  }
  if (!voertuigen.length) return { ok: false, error: "er zijn nog geen voertuignummers ingesteld" };

  const token = await verizonToken(env);
  const r = await fetch(VERIZON_API + "/rad/v1/vehicles/locations", {
    method: "POST",
    headers: {
      "Authorization": "Atmosphere atmosphere_app_id=" + env.VERIZON_APP_ID + ", Bearer " + token,
      "Content-Type": "application/json", "Accept": "application/json",
    },
    body: JSON.stringify(voertuigen),
  });
  const tekst = await r.text();
  if (!r.ok) return { ok: false, error: "Verizon gaf HTTP " + r.status, antwoord: tekst.slice(0, 300) };
  let j = null; try { j = JSON.parse(tekst); } catch {}
  const lijst = Array.isArray(j) ? j : [];
  const uit = {
    ok: true, demo: false, opgehaald: new Date().toISOString(),
    posities: lijst.map(x => verizonRegel(x.VehicleNumber || x.vehicleNumber || "", x.Content || x.content || x)),
  };
  await env.FONTEYN_DATA.put("verizon-posities", JSON.stringify(uit));
  return uit;
}

/* ─── De volgpagina voor de klant ──────────────────────────────────────────
   Eén bezorging, één code, één pagina. De klant krijgt een link met een code
   erin; die code is het enige dat de pagina opent, dus hij moet lang genoeg
   zijn om niet te raden te zijn.

   Wat er bewust NIET op komt: de naam van de chauffeur, waar de wagen daarvoor
   was, en waar hij daarna heen gaat. Een klant hoort te zien waar zijn eigen
   spa is en verder niets. Staat de rit als privé gemarkeerd, dan komt er geen
   positie op het scherm.

   En hij werkt alleen op de bezorgdag zelf. Buiten die dag is er niets te
   volgen en zou een live positie alleen maar meekijken zijn. */
function bezorgingVandaag(datum) {
  if (!datum) return false;
  const vandaag = new Date().toISOString().slice(0, 10);
  return String(datum).slice(0, 10) === vandaag;
}
async function bezorgingStatus(env, url) {
  const code = String(url.searchParams.get("code") || "").trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) return reply(400, { ok: false, error: "ongeldige code" });
  const alle = (await env.FONTEYN_DATA.get("bezorgingen", { type: "json" })) || {};
  const b = (alle.codes || {})[code];
  if (!b) return reply(404, { ok: false, error: "onbekend" });

  const basis = {
    ok: true, klant: b.klant || null, adres: b.adres || null,
    plaats: b.plaats || null, datum: b.datum || null,
    bestelling: b.omschrijving || null, venster: b.venster || null,
  };
  if (!bezorgingVandaag(b.datum))
    return reply(200, { ...basis, volgbaar: false,
      reden: "De wagen is te volgen op de dag van bezorging zelf." });

  const pos = await verizonPosities(env, {}).catch(() => null);
  const p = pos && (pos.posities || []).find(x => String(x.voertuig) === String(b.voertuig));
  if (!p || p.prive || p.breedtegraad == null)
    return reply(200, { ...basis, volgbaar: true, positie: null,
      reden: "De wagen is nu niet te volgen. Probeer het straks nog eens." });

  return reply(200, { ...basis, volgbaar: true, demo: !!(pos && pos.demo),
    positie: {
      breedtegraad: p.breedtegraad, lengtegraad: p.lengtegraad,
      plaats: (p.adres && p.adres.plaats) || null,
      staat: p.staat, snelheid: p.snelheid, gemetenOp: p.gemetenOp,
    },
    // Waar moet het heen. Zonder dit punt is de afstand niet te tekenen.
    bestemming: (b.lat != null && b.lon != null) ? { breedtegraad: b.lat, lengtegraad: b.lon } : null,
  });
}

/* ─── Scheepsdocumenten ────────────────────────────────────────────────────
   Chantal (video, 12 aug 2026): "bij Schepen en Ontvangst wil ik naast Lading
   tonen een tegel hebben met documenten, dan is de commercial invoice en de
   packing list die we eerder via Schepen hebben geüpload zichtbaar."

   Tot nu toe werd zo'n bestand alleen uitgelezen en daarna weggegooid - de
   regels bleven, het papier niet. Om het te kunnen laten zien moet het bewaard
   worden, en dat gebeurt hier: het bestand als losse sleutel, de verwijzing
   ernaar bij het schip in voorraad-schepen.

   Zelfde grens als bij het partnerportaal: 24 MB, want een sleutel in KV mag
   er 25 en je wilt niet op de rand zitten. */
const SCHIP_TYPES = {
  pdf: "application/pdf",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  csv: "text/csv", txt: "text/plain",
};
function schipBestandId(url) {
  const id = (url.searchParams.get("id") || "").toLowerCase();
  return /^[a-z0-9/_.\- ()&]{3,200}$/.test(id) && !id.includes("..") ? id : null;
}
async function schipZetBestand(request, env, url) {
  const id = schipBestandId(url);
  if (!id) return reply(400, { ok: false, error: "ongeldige bestandsnaam" });
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return reply(400, { ok: false, error: "leeg bestand" });
  if (buf.byteLength > 24 * 1024 * 1024) return reply(413, { ok: false, error: "groter dan 24 MB" });
  await env.FONTEYN_DATA.put("schipfile:" + id, buf);
  return reply(200, { ok: true, id, bytes: buf.byteLength });
}
async function schipGeefBestand(env, url) {
  const id = schipBestandId(url);
  if (!id) return reply(400, { ok: false, error: "ongeldige bestandsnaam" });
  const buf = await env.FONTEYN_DATA.get("schipfile:" + id, { type: "arrayBuffer" });
  if (!buf) return reply(404, { ok: false, error: "bestand niet gevonden" });
  const ext = String(id.split(".").pop() || "").toLowerCase();
  const naam = id.split("/").pop();
  return new Response(buf, { status: 200, headers: {
    "Content-Type": SCHIP_TYPES[ext] || "application/octet-stream",
    "Content-Disposition": 'inline; filename="' + naam.replace(/"/g, "") + '"',
    "Access-Control-Allow-Origin": "*",
  } });
}

/* ─── De dagboeken uit Logic4 ──────────────────────────────────────────────
   Stond eerst alleen in de route. Nu heeft ook de memoriaalboeking hem nodig
   - die moet zelf kunnen zien welk dagboek een memoriaal is - dus staat hij
   hier als functie. */
async function bankDagboeken(env) {
  const token = await l4Token(env);
  const r = await fetch("https://api.logic4server.nl/v3/Financial/GetFinancialBooks", {
    method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: "{}",
  });
  const tekst = await r.text();
  let j = null; try { j = JSON.parse(tekst); } catch {}
  if (!r.ok) return { ok: false, error: "HTTP " + r.status, antwoord: tekst.slice(0, 300), dagboeken: [] };
  const lijst = Array.isArray(j) ? j : (j && (j.Value || j.Records || j.FinancialBooks)) || [];
  return { ok: true, dagboeken: (lijst || []).map(x => ({
    id: x.Id != null ? x.Id : (x.BookingId != null ? x.BookingId : null),
    naam: x.Name || x.Description || x.Code || "",
    // Het type bepaalt wat er in mag: een betaling op een order kan alleen in
    // een bankdagboek, een losse regel alleen in een memoriaal. En de
    // grootboekrekening van het dagboek is nodig om een memoriaal in evenwicht
    // te krijgen.
    type: x.FinancialBookType != null ? Number(x.FinancialBookType) : null,
    ledgerId: x.LedgerId != null ? x.LedgerId : null,
  })).filter(x => x.id != null) };
}

/* ─── Welk dagboek is het memoriaal? ───────────────────────────────────────
   Osman kreeg "het meegegeven financieel dagboek 17 is een Bank boek" omdat
   het scherm hém liet kiezen uit álle dagboeken, en 17 is de bankrekening
   (12 aug 2026). Dat hoort het dashboard zelf te weten, aldus Gerrit, en
   terecht: wie de dagboeken niet uit zijn hoofd kent kan hier niet anders dan
   gokken.

   Logic4 zet in FinancialBookType een nummer, maar zegt nergens in de
   API-beschrijving welk nummer welk soort is. Raden op dat nummer zou een
   boeking in een wíllekeurig dagboek kunnen zetten, en dat is erger dan een
   foutmelding. Daarom drie signalen die wél te vertrouwen zijn:

     1. Wat de vorige keer werkte (staat in KV). Een dagboek dat een
        memoriaalboeking heeft geaccepteerd ís een memoriaal.
     2. De naam - "Memoriaal", "Memo", "Diversen", "Journaalposten".
     3. Nooit een dagboek van hetzelfde type als de bankrekening: dat is per
        definitie ook een bankboek.

   Levert dat niets op, dan gaat er niets weg en vraagt het scherm het één
   keer. Die keuze wordt daarna bij de worker bewaard, dus het blijft eenmalig
   voor iedereen samen. */
const MEM_NAAM_EXACT = /^(memoriaal|memoriaalboek|memo)$/i;
const MEM_NAAM = /memoriaal|(^|[^a-z])memo([^a-z]|$)|diversen|journaalpost/i;
function memoriaalKandidaten(lijst, opts) {
  const bank = lijst.find(d => String(d.id) === String(opts.bankBookingId || ""));
  const bankType = bank && bank.type != null ? bank.type : null;
  const geenBank = (d) => bankType == null || d.type !== bankType;
  const uit = [];
  const voegToe = (d) => { if (d && geenBank(d) && !uit.some(x => x.id === d.id)) uit.push(d); };

  /* 1. Wat eerder écht heeft gewerkt: een dagboek dat een memoriaalboeking
        heeft geaccepteerd ís een memoriaal. Harder bewijs is er niet.

        Let op het verschil met een keuze uit het scherm. Die stond hier eerst
        ook, en dat ging mis: Osman had ooit "Tussenrekening PIN 1" aangewezen,
        dat werd bewaard, en daarmee won een nooit-geslaagde keuze het van het
        dagboek dat gewoon "Memoriaal" heet (13 aug 2026). Een handmatige
        keuze telt nu pas ná de naam mee. */
  voegToe(lijst.find(d => String(d.id) === String(opts.bewezen || "")));
  /* 2. Op naam. Dit staat bewust vóór wat iemand in het scherm heeft
        aangewezen: Osman had "Tussenrekening PIN 1" gekozen terwijl er
        gewoon een dagboek "Memoriaal" in de lijst stond (12 aug 2026). Van
        een lijst met twintig dagboeken is niet te verwachten dat iemand er
        de goede uit haalt, en het dashboard kan het zelf zien. */
  lijst.filter(d => MEM_NAAM_EXACT.test(String(d.naam).trim())).forEach(voegToe);
  lijst.filter(d => MEM_NAAM.test(String(d.naam))).forEach(voegToe);
  // 3. Pas daarna wat er met de hand is aangewezen: eerst de keuze die in het
  //    scherm bewaard is, dan wat er bij deze boeking is meegestuurd.
  voegToe(lijst.find(d => String(d.id) === String(opts.keuze || "")));
  voegToe(lijst.find(d => String(d.id) === String(opts.gevraagd || "")));
  // 4. Alles van hetzelfde type als een dagboek dat op naam een memoriaal is:
  //    zo komt een tweede memoriaal ("Memoriaal 2026") ook mee, ook al staat
  //    het jaartal in de weg bij de naamtest.
  const memTypes = new Set(uit.map(d => d.type).filter(t => t != null));
  if (memTypes.size) lijst.filter(d => memTypes.has(d.type)).forEach(voegToe);
  return uit;
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
  /* Het dagboek moet er één van het type Memoriaal zijn.

     Eerst ging hier het bankdagboek in, hetzelfde als bij de betalingen op
     orders. Logic4 weigerde dat: "Dit eindpunt kan alleen boeken van type
     Memoriaal toevoegen, maar het meegegeven financieel dagboek 17 is een
     Bank boek" (Osman, 12 aug 2026).

     Er is geen weg omheen. De hele API kent maar drie soorten boekingen die
     je kunt toevoegen - inkoop, verkoop en memoriaal - en in een bankdagboek
     kun je alleen via AddPayment iets kwijt, en dat wil een order. Een regel
     die niet bij een order hoort kan dus alleen in een memoriaaldagboek.

     Daarom twee mutaties in plaats van één: de tussenrekening én de
     grootboekrekening van de bank. In een bankdagboek zit die bankkant in het
     dagboek zelf, in een memoriaal moet je hem er zelf bij zetten, anders
     staat de boeking niet in evenwicht. */
  const bankLedgerId = Number(body.bankLedgerId) || null;
  if (!bankLedgerId) return { ok: false, error: "de grootboekrekening van de bank is niet bekend; kies het bankdagboek opnieuw" };

  // Het memoriaal-dagboek zoekt hij zelf op. Zie memoriaalKandidaten hierboven.
  const dg = await bankDagboeken(env).catch(e => ({ ok: false, error: String(e.message || e), dagboeken: [] }));
  if (!dg.ok) return { ok: false, error: "dagboeken ophalen faalde: " + (dg.error || "") };
  const instellingen = (await env.FONTEYN_DATA.get("bank-instellingen", { type: "json" })) || {};
  const kandidaten = memoriaalKandidaten(dg.dagboeken, {
    bankBookingId: body.bankBookingId || null,
    gevraagd: body.bookingId || null,
    bewezen: instellingen.memBookingId || null,   // heeft ooit echt gewerkt
    keuze: instellingen.memKeuze || null,         // met de hand aangewezen
  });
  if (!kandidaten.length) {
    return { ok: false, kiesDagboek: true,
      dagboeken: dg.dagboeken.filter(d => String(d.id) !== String(body.bankBookingId || "")),
      error: "Geen memoriaal-dagboek gevonden in Logic4. Een regel die niet bij één order hoort kan alleen in een " +
             "memoriaal, en welk dagboek dat is valt uit de namen niet op te maken. Wijs hem één keer aan; " +
             "daarna weet het dashboard het voorgoed. Er is niets geboekt." };
  }
  let kandidaatNr = 0;
  const bookingIdNu = () => kandidaten[kandidaatNr].id;

  let lijsten;
  try { lijsten = await bankGrootboeken(env); }
  catch (e) { return { ok: false, error: "grootboekrekeningen ophalen faalde: " + (e.message || e) }; }
  if (!lijsten.btwNul) return { ok: false, error: "geen btw-code van 0% gevonden in Logic4. Zonder btw-code weigert Logic4 de mutatie." };
  const perCode = {}, perId = {};
  lijsten.grootboeken.forEach(g => { perCode[String(g.code)] = g; perId[String(g.id)] = g; });

  /* Logic4 klaagt in interne id's: "Grootboek(en) met id 150 zijn geblokkeerd"
     (Osman, 12 aug 2026). Niemand weet uit zijn hoofd welke rekening id 150 is,
     en zonder dat kun je er niets mee. Daarom wordt elk id in de foutmelding
     vertaald naar het rekeningnummer en de naam die er in Logic4 bij staan. */
  function metNamen(tekst) {
    return String(tekst || "").replace(/\bid\s+(\d+(?:\s*,\s*\d+)*)/gi, (heel, ids) =>
      heel + " (" + ids.split(/\s*,\s*/).map(id => {
        const g = perId[id];
        return g ? ("rekening " + g.code + (g.naam ? " " + g.naam : "")) : ("id " + id + " onbekend");
      }).join(", ") + ")");
  }

  /* De tegenrekening van de boeking. Standaard de grootboekrekening van het
     bankdagboek, want dat is wat er echt gebeurt: geld komt binnen op de bank.
     Maar veel administraties zetten juist die rekening op slot, zodat er niet
     buiten het bankdagboek om op geboekt kan worden - en dan loopt dit vast.
     Daarom is hij te overrulen met een eigen tegenrekening. */
  let tegen = { id: bankLedgerId, code: (perId[String(bankLedgerId)] || {}).code || "?",
                naam: (perId[String(bankLedgerId)] || {}).naam || "grootboek van het bankdagboek" };
  const eigenTegen = String(instellingen.tegenrekeningCode || "").trim();
  if (eigenTegen) {
    const g = perCode[eigenTegen];
    if (!g) return { ok: false, error: "de ingestelde tegenrekening " + eigenTegen + " bestaat niet in Logic4" };
    tegen = { id: g.id, code: g.code, naam: g.naam };
  }

  const token = await l4Token(env);
  const uit = [];
  for (const r of regels) {
    const bedrag = Number(r.bedrag);
    const rek = String(r.rekening || "").trim();
    const gb = perCode[rek];
    if (!gb) { uit.push({ ...r, ok: false, error: "grootboekrekening " + (rek || "(leeg)") + " bestaat niet in Logic4" }); continue; }
    if (!(bedrag > 0)) { uit.push({ ...r, ok: false, error: "bedrag ontbreekt" }); continue; }
    const datum = /^\d{4}-\d{2}-\d{2}$/.test(String(r.datum || "")) ? r.datum : new Date().toISOString().slice(0, 10);
    /* Blijkt de gekozen kandidaat toch geen memoriaal, dan zegt Logic4 dat met
       zoveel woorden en schuift hij door naar de volgende. Zo'n weigering is
       een 400: er staat niets in de administratie, dus opnieuw proberen kan
       geen dubbele boeking geven. */
    try {
      let gedaan = false;
      while (!gedaan) {
        const resp = await fetch("https://api.logic4server.nl/v3/Financial/AddFinancialGeneralBookingWithMutations", {
          method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({
            Reference: String(r.referentie || "Bankafschrift").slice(0, 60),
            BookingDateTime: datum + "T12:00:00",
            FinancialBookId: bookingIdNu(),
            Mutations: [
              // De tegenrekening erbij, anders staat de boeking niet in evenwicht.
              { LedgerId: tegen.id, VatCode: lijsten.btwNul.id, AmountIncl: bedrag,
                Description: String(r.omschrijving || "").slice(0, 200) || "Bankafschrift" },
              { LedgerId: gb.id, VatCode: lijsten.btwNul.id, AmountIncl: -bedrag,
                Description: String(r.omschrijving || "").slice(0, 200) || "Bankafschrift" },
            ],
          }),
        });
        const tekst = await resp.text();
        let j = null; try { j = JSON.parse(tekst); } catch {}
        const verkeerdSoort = !resp.ok && /type Memoriaal|is een (Bank|Kas|Inkoop|Verkoop)/i.test(tekst);
        if (verkeerdSoort && kandidaatNr + 1 < kandidaten.length) { kandidaatNr++; continue; }
        if (!resp.ok) {
          const rauw = (j && (j.detail || j.title)) || ("HTTP " + resp.status);
          /* Een geblokkeerde rekening is geen storing maar een instelling in
             Logic4, en er is precies één ding dat helpt: die rekening
             deblokkeren, of een andere tegenrekening kiezen. Dat hoort erbij
             te staan, anders blijft het "probeer het nog eens". */
          const opSlot = /geblokkeerd/i.test(rauw);
          uit.push({ ...r, ok: false, dagboek: kandidaten[kandidaatNr].naam,
            geblokkeerd: opSlot || undefined,
            tegenrekening: opSlot ? (tegen.code + (tegen.naam ? " " + tegen.naam : "")) : undefined,
            error: metNamen(rauw) + (opSlot
              ? ". Deze boeking zet rekening " + r.rekening + " tegenover " + tegen.code + " (" + tegen.naam +
                "). Er is niets geboekt. Onderaan het scherm staat wat je hieraan kunt doen."
              : ""),
            antwoord: tekst.slice(0, 300) });
        } else {
          uit.push({ ...r, ok: true, geboekt: bedrag, rekeningNaam: gb.naam, dagboek: kandidaten[kandidaatNr].naam });
        }
        gedaan = true;
      }
    } catch (e) { uit.push({ ...r, ok: false, error: String(e.message || e) }); }
  }
  /* Werkte het? Dan is nu bekend welk dagboek het memoriaal is, en hoeft er
     nooit meer gezocht te worden - ook niet op een andere computer. */
  const gelukteRegel = uit.find(x => x.ok);
  if (gelukteRegel && String(instellingen.memBookingId || "") !== String(bookingIdNu())) {
    instellingen.memBookingId = bookingIdNu();
    instellingen.memNaam = kandidaten[kandidaatNr].naam;
    await env.FONTEYN_DATA.put("bank-instellingen", JSON.stringify(instellingen));
  }
  const gelukt = uit.filter(x => x.ok).length;
  const logboek = (await env.FONTEYN_DATA.get("bank-geboekt", { type: "json" })) || { boekingen: [] };
  logboek.boekingen = (logboek.boekingen || []).slice(-4000);
  logboek.boekingen.push({ ts: new Date().toISOString(), door: String(body.door || "").slice(0, 80),
    soort: "memoriaal", aantal: gelukt,
    totaal: uit.filter(x => x.ok).reduce((n, x) => n + Number(x.geboekt || 0), 0),
    regels: uit.map(x => ({ rekening: x.rekening, bedrag: x.bedrag, ok: x.ok, error: x.error || null })) });
  await env.FONTEYN_DATA.put("bank-geboekt", JSON.stringify(logboek));
  return { ok: true, gelukt, mislukt: uit.length - gelukt, resultaten: uit,
           dagboek: { id: bookingIdNu(), naam: kandidaten[kandidaatNr].naam },
           tegenrekening: { code: tegen.code, naam: tegen.naam },
           // Zat er een rekening op slot? Dan mag de tegel daar iets mee doen
           // in plaats van alleen de tekst laten zien.
           geblokkeerd: uit.some(x => x.geblokkeerd) || undefined };
}

/* ══════════════════════════════════════════════════════════════════════
   Mail — de koppeling met de Exchange van Fonteyn
   ══════════════════════════════════════════════════════════════════════

   Fonteyn draait een eigen Exchange 2016 op portal.fonteyn.nl, geen
   Microsoft 365. Dat bepaalt alles wat hieronder staat: Graph bestaat hier
   niet, IMAP en SMTP zijn van buiten dicht, en wat overblijft is EWS - een
   SOAP-dienst op poort 443. Die kan lezen, een concept in de map Concepten
   zetten en verzenden, alle drie langs dezelfde deur.

   Het dashboard logt in als één serviceaccount (dashboard@fonteyn.nl) en
   zegt er per verzoek bij namens wie het werkt. De Exchange-beheerder heeft
   dat account rechten gegeven op precies de mailboxen die in de groep
   "Dashboard Mailboxen" zitten, en op geen enkele andere.

   Wie wie is, staat los van Logic4. Dolf logt in Logic4 in als fonteyn.dolf
   maar zijn mail is dolf@fonteyn.nl; die twee mogen nooit door elkaar lopen.
   Daarom een eigen lijst: mailAdresVan().                                */

/* Welke bestanden de telefoon mag ophalen: die uit manifest.json. Dat is
   dezelfde lijst die de app op de pc bij elke start binnenhaalt, dus hier
   komt niets langs dat niet toch al op elke werkplek staat.

   Eén minuut in het geheugen van deze worker-instantie. Langer is onhandig
   bij een nieuwe tegel, korter is zonde van de aanroep naar GitHub. */
let _mobielLijst = null;
let _mobielTot = 0;

async function mobielToegestaan(env) {
  const nu = Date.now();
  if (_mobielLijst && nu < _mobielTot) return _mobielLijst;
  const r = await fetch("https://raw.githubusercontent.com/gerritgmulder/douanepapieren-data/main/manifest.json?cb=" +
                        Math.floor(nu / 60000), { cf: { cacheTtl: 60 } });
  if (!r.ok) return _mobielLijst || new Set();     // liever de oude lijst dan niets
  const j = await r.json().catch(() => null);
  if (!j || !Array.isArray(j.files)) return _mobielLijst || new Set();
  _mobielLijst = new Set(j.files.map(f => String(f.name || "")).filter(Boolean));
  _mobielTot = nu + 60000;
  return _mobielLijst;
}

const EWS_HOST = "portal.fonteyn.nl";
const EWS_URL  = "https://" + EWS_HOST + "/EWS/Exchange.asmx";

/* Exchange 2016 spreekt het schema van 2013 SP1. Hoger vragen laat hem
   klagen, lager vragen kost velden die we willen hebben. */
const EWS_SCHEMA = "Exchange2013_SP1";

function xmlUit(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function xmlIn(s) {
  return String(s == null ? "" : s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");   // als laatste, anders ontstaat &lt; uit &amp;lt;
}

/* Er is geen XML-parser in een Worker (DOMParser bestaat hier niet). Voor
   antwoorden van EWS is dat geen bezwaar: de vorm ligt vast, dus één veld
   uit één blok halen kan met een uitdrukking. Wel altijd het prefix vrij
   laten - Exchange stuurt t:Subject, maar dat is niet gegarandeerd. */
function xVeld(blok, naam) {
  const m = blok.match(new RegExp("<(?:\\w+:)?" + naam + "(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?" + naam + ">"));
  return m ? xmlIn(m[1]) : "";
}

function xBlokken(xml, naam) {
  const re = new RegExp("<(?:\\w+:)?" + naam + "(?:\\s[^>]*)?>[\\s\\S]*?</(?:\\w+:)?" + naam + ">", "g");
  return xml.match(re) || [];
}

/* Een ItemId staat als leeg element met twee attributen in het antwoord.
   Beide zijn nodig: zonder ChangeKey weigert Exchange elke wijziging. */
function xItemId(blok) {
  const m = blok.match(/<(?:\w+:)?ItemId\s+Id="([^"]+)"(?:\s+ChangeKey="([^"]*)")?/);
  return m ? { id: xmlIn(m[1]), sleutel: xmlIn(m[2] || "") } : null;
}

function xMailbox(blok, naam) {
  const b = blok.match(new RegExp("<(?:\\w+:)?" + naam + ">([\\s\\S]*?)</(?:\\w+:)?" + naam + ">"));
  if (!b) return null;
  return { naam: xVeld(b[1], "Name"), adres: xVeld(b[1], "EmailAddress") };
}

function xMailboxen(blok, naam) {
  const b = blok.match(new RegExp("<(?:\\w+:)?" + naam + ">([\\s\\S]*?)</(?:\\w+:)?" + naam + ">"));
  if (!b) return [];
  return xBlokken(b[1], "Mailbox").map(m => ({ naam: xVeld(m, "Name"), adres: xVeld(m, "EmailAddress") }));
}

/* Eén verzoek aan Exchange. De impersonatie-kop is het hele verschil tussen
   "de mailbox van het serviceaccount" en "de mailbox van Dolf". Staat hij er
   niet, dan kijkt Exchange in de lege mailbox van het serviceaccount zelf -
   geen foutmelding, gewoon niets. Vandaar dat namens altijd verplicht is. */
/* ── Twee manieren om bij andermans mailbox te komen ──────────────────
   Exchange kent er twee, en welke werkt hangt af van wat de beheerder heeft
   uitgedeeld:

   impersonatie   Het serviceaccount doet zich voor als Dolf. Vraagt de
                  RBAC-rol ApplicationImpersonation.
   gedelegeerd    Het serviceaccount blijft zichzelf en noemt per map de
                  mailbox van Dolf. Vraagt Full Access of mapmachtigingen.

   André (18 aug 2026) schreef: "Dit account mag verzenden als en namens
   Dolf." Send As en Send on Behalf zijn geen van beide impersonatie, dus het
   kan zijn dat alleen de gedelegeerde weg openstaat. In plaats van dat vooraf
   uit te zoeken probeert de worker het gewoon: lukt de ene niet, dan de
   andere, en welke werkte wordt onthouden zodat het daarna één verzoek is. */
const MAIL_MODI = ["impersonatie", "gedelegeerd"];
let mailModusCache = null;

async function mailModus(env) {
  if (mailModusCache) return mailModusCache;
  const bewaard = await env.FONTEYN_DATA.get("mail-modus");
  mailModusCache = MAIL_MODI.indexOf(bewaard) >= 0 ? bewaard : "impersonatie";
  return mailModusCache;
}
async function mailModusZet(env, modus) {
  mailModusCache = modus;
  await env.FONTEYN_DATA.put("mail-modus", modus);
}

/* Een verwijzing naar een standaardmap. Bij impersonatie is Exchange al in de
   juiste mailbox; gedelegeerd moet erbij staan wiens map je bedoelt. */
function mapVerwijzing(map, adres, modus) {
  if (modus === "gedelegeerd") {
    return '<t:DistinguishedFolderId Id="' + map + '"><t:Mailbox><t:EmailAddress>' +
           xmlUit(adres) + "</t:EmailAddress></t:Mailbox></t:DistinguishedFolderId>";
  }
  return '<t:DistinguishedFolderId Id="' + map + '"/>';
}

/* Wie staat er als afzender op? Bij impersonatie is dat vanzelf de mailbox
   waarin we zitten. Gedelegeerd zou de mail van dashboard@fonteyn.nl komen,
   en dat is niet de bedoeling: André gaf dit account uitdrukkelijk het recht
   om als en namens Dolf te verzenden, dus zetten we de afzender er zelf op.
   Volgens het EWS-schema hoort From ná de ontvangers. */
function afzender(adres, modus) {
  if (modus !== "gedelegeerd") return "";
  return "<t:From><t:Mailbox><t:EmailAddress>" + xmlUit(adres) +
         "</t:EmailAddress></t:Mailbox></t:From>";
}

/* Een opdracht uitvoeren, desnoods langs de andere weg. maakBody krijgt de
   modus mee, want alleen de mapverwijzingen verschillen. */
async function ewsDoe(env, actie, maakBody, namens) {
  const modus = await mailModus(env);
  const eerste = await ewsRoep(env, actie, maakBody(modus), namens, modus);
  if (eerste.ok || eerste.error !== "geen-toegang-tot-mailbox") return eerste;

  const ander = modus === "impersonatie" ? "gedelegeerd" : "impersonatie";
  const tweede = await ewsRoep(env, actie, maakBody(ander), namens, ander);
  if (tweede.ok) { await mailModusZet(env, ander); return tweede; }
  /* Allebei dicht. Dan is de eerste melding de nuttigste, met erbij dat het
     ook langs de andere weg niet gaat - dat scheelt de beheerder zoekwerk. */
  return { ...eerste, ookGeprobeerd: ander, tweedeUitleg: tweede.uitleg || tweede.error };
}

async function ewsRoep(env, actie, body, namens, modus) {
  if (!env.EWS_GEBRUIKER || !env.EWS_WACHTWOORD) {
    return { ok: false, error: "mail-niet-ingesteld",
             uitleg: "Het serviceaccount is nog niet ingesteld. Zet EWS_GEBRUIKER en EWS_WACHTWOORD als worker-secret." };
  }
  if (!namens) return { ok: false, error: "geen-mailbox" };

  const kop = modus === "gedelegeerd" ? "" :
    "<t:ExchangeImpersonation><t:ConnectingSID><t:SmtpAddress>" + xmlUit(namens) +
    "</t:SmtpAddress></t:ConnectingSID></t:ExchangeImpersonation>";

  const env_xml =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"' +
    ' xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"' +
    ' xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">' +
    "<soap:Header>" +
    '<t:RequestServerVersion Version="' + EWS_SCHEMA + '"/>' + kop +
    "</soap:Header><soap:Body>" + body + "</soap:Body></soap:Envelope>";

  const auth = "Basic " + btoa(env.EWS_GEBRUIKER + ":" + env.EWS_WACHTWOORD);
  let r;
  try {
    r = await fetch(EWS_URL, {
      method: "POST",
      headers: {
        "Content-Type": 'text/xml; charset=utf-8',
        "Authorization": auth,
        "SOAPAction": '"http://schemas.microsoft.com/exchange/services/2006/messages/' + actie + '"',
      },
      body: env_xml,
    });
  } catch (e) {
    return { ok: false, error: "mailserver-onbereikbaar", uitleg: String(e.message || e) };
  }

  const tekst = await r.text();
  if (r.status === 401) {
    return { ok: false, error: "inloggen-mislukt",
             uitleg: "Exchange wees het serviceaccount af. Wachtwoord verlopen of gewijzigd?" };
  }
  if (!r.ok) {
    return { ok: false, error: "mailserver-fout-" + r.status, uitleg: tekst.slice(0, 400) };
  }

  /* EWS antwoordt met HTTP 200 óók als de opdracht mislukte. Het echte
     oordeel staat in ResponseClass en MessageText. Dat komt regelmatig voor
     (verlopen ChangeKey, item intussen verplaatst), dus het moet netjes
     terugkomen en niet als geslaagd worden weggeschreven. */
  const fout = tekst.match(/ResponseClass="(Error|Warning)"/);
  if (fout) {
    const code = xVeld(tekst, "ResponseCode");
    const uitleg = xVeld(tekst, "MessageText");
    /* Impersonatie weigert met ErrorImpersonate*, de gedelegeerde weg met
       ErrorAccessDenied of ErrorNonExistentMailbox. Alle vier betekenen
       hetzelfde: langs deze weg komen we niet in die mailbox. */
    const dicht = ["ErrorImpersonateUserDenied", "ErrorImpersonationDenied",
                   "ErrorAccessDenied", "ErrorNonExistentMailbox",
                   "ErrorFolderNotFound"];
    if (dicht.indexOf(code) >= 0) {
      return { ok: false, error: "geen-toegang-tot-mailbox", modus: modus, code: code,
               uitleg: "Het serviceaccount mag " + (modus === "gedelegeerd"
                 ? "de mailbox van " + namens + " niet openen (Full Access ontbreekt)."
                 : "zich niet voordoen als " + namens + " (ApplicationImpersonation ontbreekt).") };
    }
    return { ok: false, error: code || "mailserver-weigert", uitleg };
  }
  return { ok: true, xml: tekst };
}

/* Welk mailadres hoort bij wie er is ingelogd. Bewust een eigen lijst en
   niet afgeleid van de Logic4-naam: Dolf heet daar fonteyn.dolf en zijn mail
   is dolf@fonteyn.nl. Wie er niet in staat krijgt geen mailbox te zien -
   raden is hier gevaarlijker dan weigeren. */
async function mailAdresVan(env, wie) {
  const lijst = (await env.FONTEYN_DATA.get("mail-adressen", { type: "json" })) || {};
  const sleutel = String(wie || "").trim().toLowerCase();
  if (!sleutel) return "";
  if (lijst[sleutel]) return String(lijst[sleutel]);
  /* Staat iemand er niet in maar logt hij in met zijn eigen mailadres, dan is
     dat adres het antwoord. Alleen voor @fonteyn.nl, en alleen als de rest
     van de keten hem toch al binnenliet. */
  if (/^[a-z0-9._-]+@fonteyn\.nl$/.test(sleutel)) return sleutel;
  return "";
}

/* De persoonlijke sleutel. De teamsleutel is bij iedereen bekend die het
   dashboard mag gebruiken, en die is hier dus niet genoeg: daarmee zou de
   een de mailbox van de ander kunnen opvragen door een andere naam mee te
   sturen. Deze sleutel wordt uitgegeven op vertoon van een geldige
   Logic4-login en is aan díe naam gebonden. Twaalf uur geldig, daarna vraagt
   het dashboard hem stil opnieuw op bij het inloggen.

   Dertig dagen, niet een halve dag. Wie op zijn telefoon "ingelogd blijven"
   aanvinkt bedoelt dat ook, en een mailtegel die elke ochtend om een
   wachtwoord vraagt gebruikt niemand. De sleutel staat op het toestel en is
   zonder dat toestel niets waard. */
async function mailSleutelGeef(env, wie, logic4) {
  const sleutel = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await env.FONTEYN_DATA.put("mailsleutel:" + sleutel,
    JSON.stringify({
      wie: String(wie).toLowerCase(),
      sinds: new Date().toISOString(),
      /* Het Logic4-token van déze gebruiker, met zijn eigen rechten. Leeft een
         uur; de sleutel zelf dertig dagen. Daarna werkt de mailtegel nog wel
         (die gaat langs Exchange) maar het opvragen van Logic4-gegevens niet
         meer, en dat is precies de bedoeling. */
      l4token: logic4 && logic4.token ? logic4.token : null,
      l4tot: logic4 && logic4.tot ? logic4.tot : 0,
    }),
    { expirationTtl: 2592000 });
  return sleutel;
}

async function mailSleutelLees(env, request) {
  const sleutel = String(request.headers.get("X-Fonteyn-Mail") || "").trim();
  if (!sleutel || sleutel.length > 100) return null;
  return await env.FONTEYN_DATA.get("mailsleutel:" + sleutel, { type: "json" });
}

async function mailSleutelWie(env, request) {
  const j = await mailSleutelLees(env, request);
  return j && j.wie ? j.wie : "";
}

/* Gegevens ophalen uit Logic4 zonder het hulpprogramma van de pc.
   Op een werkplek loopt dit langs poort 3737, met het Logic4-token van de
   ingelogde gebruiker. Op een telefoon bestaat dat niet, dus doet de worker
   het - met hetzelfde token, dat bij het inloggen is bewaard.

   Alleen lezen. Het pad moet er precies uitzien als /v3/Iets/GetIets: een
   vaste vorm in plaats van een lijst endpoints, want zo'n lijst raakt
   achterop en dan staat er ineens iets open dat er niet hoort. Boeken,
   wijzigen en verwijderen gaan hier dus niet langs; dat blijft op de pc, waar
   iemand achter zijn bureau zit. */
const LOGIC4_LEES = /^\/v(?:1|1\.1|2|3)\/[A-Za-z0-9]+\/Get[A-Za-z0-9]+$/;

async function logic4Lees(env, request, body) {
  const sessie = await mailSleutelLees(env, request);
  if (!sessie || !sessie.wie) {
    return reply(401, { ok: false, error: "opnieuw-inloggen",
                        uitleg: "De sleutel ontbreekt of is verlopen." });
  }
  const pad = String(body.path || "");
  if (!LOGIC4_LEES.test(pad)) {
    return reply(403, { ok: false, error: "alleen-opvragen",
                        uitleg: "Buiten de werkplek kan het dashboard gegevens opvragen maar niets wijzigen." });
  }
  if (!sessie.l4token || Date.now() > Number(sessie.l4tot || 0)) {
    return reply(401, { ok: false, error: "logic4-verlopen",
                        uitleg: "Je verbinding met Logic4 is verlopen. Log opnieuw in, dan werkt het weer." });
  }

  /* Sommige leesendpoints van Logic4 zijn GET en niet POST, bijvoorbeeld
     /v3/User/GetAllUsers dat de tegel Retouren gebruikt om de adviseur bij
     een order te vinden. Op de pc laat het hulpprogramma de methode al door;
     hier deed de worker altijd POST, en dan komt er niets terug. Alleen GET
     en POST, want dit pad is en blijft alleen-lezen. */
  const methode = String(body.method || "POST").toUpperCase() === "GET" ? "GET" : "POST";
  const r = await fetch("https://api.logic4server.nl" + pad, {
    method: methode,
    headers: { Authorization: "Bearer " + sessie.l4token, "Content-Type": "application/json" },
    ...(methode === "GET" ? {} : { body: JSON.stringify(body.body === undefined ? {} : body.body) }),
  }).catch(e => null);
  if (!r) return reply(502, { ok: false, error: "logic4-onbereikbaar" });

  const tekst = await r.text();
  let data = null;
  try { data = JSON.parse(tekst); } catch (e) { data = tekst; }
  /* Dezelfde vorm als het hulpprogramma teruggeeft, zodat de tegels niets
     hoeven te merken van welke kant het antwoord komt. */
  return reply(200, { ok: r.ok, status: r.status, data });
}

/* Postvak in, of een andere vaste map. Alleen de mappen die Exchange bij
   naam kent - een vrije mapnaam meegeven zou betekenen dat de tegel overal
   in de mailbox kan grasduinen, en daar is nu geen reden voor. */
const MAIL_MAPPEN = {
  inbox: "inbox", concepten: "drafts", verzonden: "sentitems",
  prullenbak: "deleteditems", ongewenst: "junkemail",
};

async function mailLijst(env, adres, opt) {
  const map = MAIL_MAPPEN[String(opt.map || "inbox")] || "inbox";
  const aantal = Math.min(Math.max(Number(opt.aantal) || 25, 1), 100);
  const vanaf = Math.max(Number(opt.vanaf) || 0, 0);

  const body =
    '<m:FindItem Traversal="Shallow"><m:ItemShape>' +
    "<t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>" +
    '<t:FieldURI FieldURI="item:Subject"/>' +
    '<t:FieldURI FieldURI="item:DateTimeReceived"/>' +
    '<t:FieldURI FieldURI="item:HasAttachments"/>' +
    '<t:FieldURI FieldURI="item:Importance"/>' +
    '<t:FieldURI FieldURI="message:From"/>' +
    '<t:FieldURI FieldURI="message:IsRead"/>' +
    "</t:AdditionalProperties></m:ItemShape>" +
    '<m:IndexedPageItemView MaxEntriesReturned="' + aantal + '" Offset="' + vanaf + '" BasePoint="Beginning"/>' +
    '<m:SortOrder><t:FieldOrder Order="Descending">' +
    '<t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder>' +
    "<!--MAP-->" +
    "</m:FindItem>";

  const r = await ewsDoe(env, "FindItem",
    modus => body.replace("<!--MAP-->",
      "<m:ParentFolderIds>" + mapVerwijzing(map, adres, modus) + "</m:ParentFolderIds>"),
    adres);
  if (!r.ok) return r;

  const berichten = xBlokken(r.xml, "Message").map(b => {
    const id = xItemId(b);
    const van = xMailbox(b, "From");
    return {
      id: id ? id.id : "", sleutel: id ? id.sleutel : "",
      onderwerp: xVeld(b, "Subject"),
      van: van ? (van.naam || van.adres) : "",
      vanAdres: van ? van.adres : "",
      ontvangen: xVeld(b, "DateTimeReceived"),
      gelezen: xVeld(b, "IsRead") === "true",
      bijlagen: xVeld(b, "HasAttachments") === "true",
      belangrijk: xVeld(b, "Importance") === "High",
    };
  }).filter(x => x.id);

  const meer = /IncludesLastItemInRange="false"/.test(r.xml);
  return { ok: true, map: opt.map || "inbox", berichten, meer, totaal: berichten.length };
}

async function mailBericht(env, adres, id, sleutel) {
  /* Platte tekst en niet de HTML-versie. Dat leest op een telefoon prettiger,
     en het scheelt dat er opmaak uit een vreemde mail in onze eigen pagina
     terechtkomt. */
  const body =
    "<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape>" +
    "<t:BodyType>Text</t:BodyType><t:AdditionalProperties>" +
    '<t:FieldURI FieldURI="item:Subject"/>' +
    '<t:FieldURI FieldURI="item:DateTimeReceived"/>' +
    '<t:FieldURI FieldURI="item:Body"/>' +
    '<t:FieldURI FieldURI="item:HasAttachments"/>' +
    '<t:FieldURI FieldURI="item:Attachments"/>' +
    '<t:FieldURI FieldURI="message:From"/>' +
    '<t:FieldURI FieldURI="message:ToRecipients"/>' +
    '<t:FieldURI FieldURI="message:CcRecipients"/>' +
    '<t:FieldURI FieldURI="message:InternetMessageId"/>' +
    "</t:AdditionalProperties></m:ItemShape><m:ItemIds><t:ItemId Id=\"" + xmlUit(id) + '"' +
    (sleutel ? ' ChangeKey="' + xmlUit(sleutel) + '"' : "") + "/></m:ItemIds></m:GetItem>";

  const r = await ewsDoe(env, "GetItem", modus => body
    .replace("<!--DRAFTS-->", mapVerwijzing("drafts", adres, modus))
    .replace("<!--SENT-->", mapVerwijzing("sentitems", adres, modus)), adres);
  if (!r.ok) return r;
  const blok = xBlokken(r.xml, "Message")[0];
  if (!blok) return { ok: false, error: "bericht-niet-gevonden" };
  const eigen = xItemId(blok);
  const van = xMailbox(blok, "From");
  return { ok: true, bericht: {
    id: eigen ? eigen.id : id, sleutel: eigen ? eigen.sleutel : (sleutel || ""),
    onderwerp: xVeld(blok, "Subject"),
    van: van ? (van.naam || van.adres) : "", vanAdres: van ? van.adres : "",
    aan: xMailboxen(blok, "ToRecipients"), cc: xMailboxen(blok, "CcRecipients"),
    ontvangen: xVeld(blok, "DateTimeReceived"),
    tekst: xVeld(blok, "Body"),
    bijlagen: xBlokken(blok, "FileAttachment").map(a => ({
      naam: xVeld(a, "Name"), grootte: Number(xVeld(a, "Size")) || 0,
      soort: xVeld(a, "ContentType"),
    })),
  } };
}

function mailOntvangers(lijst, tag) {
  const adressen = (Array.isArray(lijst) ? lijst : String(lijst || "").split(/[;,]/))
    .map(x => String(typeof x === "string" ? x : (x && x.adres) || "").trim())
    .filter(x => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(x));
  if (!adressen.length) return "";
  return "<t:" + tag + ">" + adressen.map(a =>
    "<t:Mailbox><t:EmailAddress>" + xmlUit(a) + "</t:EmailAddress></t:Mailbox>").join("") + "</t:" + tag + ">";
}

/* Een concept klaarzetten. Dit is de kern van waar de tegel voor bedoeld is:
   wat het dashboard opstelt komt in de map Concepten terecht en staat dus
   ook gewoon in Outlook. Verzenden gebeurt niet hier - dat is een aparte
   handeling, met een aparte knop, door een mens. */
async function mailConcept(env, adres, c) {
  const onderwerp = String(c.onderwerp || "").slice(0, 255);
  const tekst = String(c.tekst || "");
  if (!onderwerp && !tekst) return { ok: false, error: "leeg-concept" };

  const body =
    '<m:CreateItem MessageDisposition="SaveOnly">' +
    "<m:SavedItemFolderId><!--DRAFTS--></m:SavedItemFolderId>" +
    "<m:Items><t:Message>" +
    "<t:Subject>" + xmlUit(onderwerp) + "</t:Subject>" +
    '<t:Body BodyType="Text">' + xmlUit(tekst) + "</t:Body>" +
    mailOntvangers(c.aan, "ToRecipients") +
    mailOntvangers(c.cc, "CcRecipients") +
    "<!--VAN-->" +
    "</t:Message></m:Items></m:CreateItem>";

  const r = await ewsDoe(env, "CreateItem", modus => body
    .replace("<!--DRAFTS-->", mapVerwijzing("drafts", adres, modus))
    .replace("<!--SENT-->", mapVerwijzing("sentitems", adres, modus))
    .replace("<!--VAN-->", afzender(adres, modus)), adres);
  if (!r.ok) return r;
  const id = xItemId(r.xml);
  if (!id) return { ok: false, error: "concept-zonder-id" };
  return { ok: true, id: id.id, sleutel: id.sleutel };
}

/* Verzenden. Alleen op een uitdrukkelijke handeling van de gebruiker; deze
   route wordt nergens automatisch aangeroepen. Wat verstuurd wordt is het
   concept zoals het op dat moment in de mailbox staat, dus wat de gebruiker
   in Outlook of in de tegel voor zich zag. */
async function mailVerzend(env, adres, id, sleutel) {
  const body =
    '<m:SendItem SaveItemToFolder="true"><m:ItemIds><t:ItemId Id="' + xmlUit(id) + '"' +
    (sleutel ? ' ChangeKey="' + xmlUit(sleutel) + '"' : "") + "/></m:ItemIds>" +
    "<m:SavedItemFolderId><!--SENT--></m:SavedItemFolderId>" +
    "</m:SendItem>";
  const r = await ewsDoe(env, "SendItem", modus => body
    .replace("<!--DRAFTS-->", mapVerwijzing("drafts", adres, modus))
    .replace("<!--SENT-->", mapVerwijzing("sentitems", adres, modus)), adres);
  if (!r.ok) return r;
  return { ok: true };
}

async function mailGelezen(env, adres, id, sleutel, ja) {
  const body =
    '<m:UpdateItem MessageDisposition="SaveOnly" ConflictResolution="AutoResolve">' +
    '<m:ItemChanges><t:ItemChange><t:ItemId Id="' + xmlUit(id) + '"' +
    (sleutel ? ' ChangeKey="' + xmlUit(sleutel) + '"' : "") + "/>" +
    "<t:Updates><t:SetItemField>" +
    '<t:FieldURI FieldURI="message:IsRead"/>' +
    "<t:Message><t:IsRead>" + (ja ? "true" : "false") + "</t:IsRead></t:Message>" +
    "</t:SetItemField></t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>";
  const r = await ewsDoe(env, "UpdateItem", modus => body
    .replace("<!--DRAFTS-->", mapVerwijzing("drafts", adres, modus))
    .replace("<!--SENT-->", mapVerwijzing("sentitems", adres, modus)), adres);
  if (!r.ok) return r;
  const id2 = xItemId(r.xml);
  return { ok: true, sleutel: id2 ? id2.sleutel : "" };
}

/* Naar de prullenbak, niet weg. Wat hier verdwijnt moet terug te halen zijn;
   definitief wissen doet een mens zelf maar in Outlook. */
async function mailNaarPrullenbak(env, adres, id, sleutel) {
  const body =
    '<m:DeleteItem DeleteType="MoveToDeletedItems"><m:ItemIds><t:ItemId Id="' + xmlUit(id) + '"' +
    (sleutel ? ' ChangeKey="' + xmlUit(sleutel) + '"' : "") + "/></m:ItemIds></m:DeleteItem>";
  return await ewsDoe(env, "DeleteItem", modus => body
    .replace("<!--DRAFTS-->", mapVerwijzing("drafts", adres, modus))
    .replace("<!--SENT-->", mapVerwijzing("sentitems", adres, modus)), adres).then(r => r.ok ? { ok: true } : r);
}

/* Werkt de hele keten? Vraagt de mailbox één regel op en zegt wat er misgaat
   als dat niet lukt. Bedoeld voor het moment waarop het serviceaccount net
   is aangemaakt en we willen weten of de rechten goed staan. */
async function mailProef(env, adres) {
  const t0 = Date.now();
  const r = await mailLijst(env, adres, { map: "inbox", aantal: 1 });
  return r.ok
    ? { ok: true, mailbox: adres, ms: Date.now() - t0,
        gevonden: r.berichten.length, nieuwste: r.berichten[0] ? r.berichten[0].ontvangen : null }
    : { ...r, mailbox: adres, ms: Date.now() - t0 };
}

/* ══════════════════════════════════════════════════════════════════════
   Bestellingen — de orderbevestiging van een meubelfabriek
   ══════════════════════════════════════════════════════════════════════

   Chantal stuurt de sales confirmation die de fabriek terugstuurt. Het lezen
   ervan gebeurt in de pagina (sales-confirmation.js); hier wordt het bewaard
   en worden de artikelnummers in Logic4 nagekeken.

   Dat laatste is haar eigenlijke vraag: "als je deze niet in Logic kan
   vinden, dan graag afstemmen met Gretha". Dus moet er per artikelnummer
   uitkomen of het bestaat, en zo niet, dat het langs Gretha moet.

   De antwoorden blijven bewaard, ook een "niet gevonden". Anders zoekt elk
   scherm dat de bestelling opent dezelfde nummers opnieuw op, en op de gratis
   laag mag één aanroep maar vijftig verzoeken naar buiten doen.            */

/* ── Omschrijving aan een artikel koppelen ────────────────────────────
   Op de factuur van een sauna- of swimspafabriek staat geen artikelnummer
   maar een omschrijving: "WS - 1103A Red cedar+ salt stone". Iemand die weet
   wat dat is - Chantal of Gretha - zoekt er één keer het Logic4-artikel bij,
   en vanaf dan herkent het dashboard het zelf. Ook in de volgende container,
   want dezelfde sauna komt telkens terug.

   De sleutel is de omschrijving zonder hoofdletters en dubbele spaties. Niet
   scherper: dan zou "Red cedar+ salt stone" en "Red cedar + salt stone" twee
   verschillende dingen worden en moet iemand het twee keer doen. */

function koppelSleutel(omschrijving) {
  return String(omschrijving || "")
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/\s*\+\s*/g, "+")
    .replace(/\s*-\s*/g, "-")
    .trim();
}

async function artikelKoppelingen(env) {
  return (await env.FONTEYN_DATA.get("artikel-koppeling", { type: "json" })) || {};
}

async function artikelKoppel(env, body) {
  const omschrijving = String(body.omschrijving || "").trim();
  if (!omschrijving) return { ok: false, error: "geen-omschrijving" };
  const sleutel = koppelSleutel(omschrijving);
  const alles = await artikelKoppelingen(env);

  if (body.los) {
    delete alles[sleutel];
    await env.FONTEYN_DATA.put("artikel-koppeling", JSON.stringify(alles));
    return { ok: true, losgemaakt: true };
  }

  const code = String(body.code || "").trim().toUpperCase();
  if (!code) return { ok: false, error: "geen-code" };

  /* Eerst nakijken of dat artikel bestaat. Een typefout in een artikelcode
     levert anders een koppeling op die er goed uitziet en nergens heen wijst,
     en dat merkt niemand tot de ontvangst misgaat. */
  const check = await artikelBestaat(env, [code]);
  const st = check && check.codes && check.codes[code];
  if (!st || st.gevonden !== true) {
    return { ok: false, error: "artikel-onbekend",
             uitleg: "Artikel " + code + " staat niet in Logic4. Klopt de code?" };
  }

  alles[sleutel] = {
    omschrijving, code, naam: st.naam || "",
    door: String(body.door || "").slice(0, 60),
    ts: new Date().toISOString(),
  };
  await env.FONTEYN_DATA.put("artikel-koppeling", JSON.stringify(alles));
  return { ok: true, koppeling: alles[sleutel] };
}

async function artikelBestaat(env, codes) {
  const cache = (await env.FONTEYN_DATA.get("artikel-codes-check", { type: "json" })) || {};
  const nu = Date.now();
  const uit = {};
  const teZoeken = [];

  for (const ruw of codes) {
    const code = String(ruw || "").trim().toUpperCase();
    if (!code) continue;
    const c = cache[code];
    /* Een maand houdbaar. Een artikel dat vandaag niet bestaat kan volgende
       week door Gretha zijn aangemaakt, en dan moet het antwoord meebewegen. */
    if (c && nu - (c.ts || 0) < 30 * 86400000) uit[code] = { gevonden: c.gevonden, naam: c.naam || "" };
    else teZoeken.push(code);
  }
  if (!teZoeken.length) return { ok: true, codes: uit };

  let token = null;
  try { token = await l4Token(env); } catch (e) {
    /* Zonder Logic4 geen oordeel. Dan liever niets zeggen dan alles als
       onbekend markeren en Chantal voor niets naar Gretha sturen. */
    return { ok: true, codes: uit, onbekend: teZoeken, waarschuwing: "logic4-niet-bereikbaar" };
  }

  for (const code of teZoeken.slice(0, 20)) {
    try {
      const r = await fetch("https://api.logic4server.nl/v3/Products/GetProducts", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ FastSearchText: code, TakeRecords: 10 }),
      });
      const j = await r.json().catch(() => null);
      const lijst = (j && (j.Products || j)) || [];
      /* Alleen een treffer op precies dit artikelnummer telt. FastSearchText
         geeft ook halve treffers terug, en "lijkt erop" is hier niet goed
         genoeg: dan zou een verkeerd nummer als bestaand doorgaan. */
      const raak = (Array.isArray(lijst) ? lijst : []).find(p =>
        String(p.ProductCode || "").trim().toUpperCase() === code);
      const res = { gevonden: !!raak, naam: raak ? String(raak.ProductName1 || "").slice(0, 80) : "" };
      uit[code] = res;
      cache[code] = { ...res, ts: nu };
    } catch (e) {
      uit[code] = { gevonden: null, naam: "" };
    }
  }
  await env.FONTEYN_DATA.put("artikel-codes-check", JSON.stringify(cache));
  return { ok: true, codes: uit };
}

/* Een bestelling aan een zending hangen. Eén bestelling kan over meerdere
   containers komen - deze gaat over vierenveertig sets in twee containers -
   dus het is een lijst en geen enkel veld.

   Automatisch koppelen kan alleen als de fabriek het S/C-nummer op de
   commercial invoice herhaalt, en dat doet niet elke fabriek. Daarom kan het
   ook met de hand; zodra iemand dat één keer doet blijft het staan. */
function noemtReferentie(schip, ref) {
  const naald = String(ref || "").trim().toLowerCase();
  if (naald.length < 4) return false;
  const hooi = [schip.ref, schip.file, schip.vessel,
                schip.meubel && schip.meubel.invoiceNo,
                schip.meubel && schip.meubel.fabriek]
    .filter(Boolean).join(" ").toLowerCase();
  /* Op woordgrens, niet zomaar als deel van een langere reeks: "R26039" mag
     niet aanslaan op "AR260391". */
  return new RegExp("(^|[^a-z0-9])" + naald.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                    "([^a-z0-9]|$)").test(hooi);
}

/* ══════════════════════════════════════════════════════════════════════
   Binnenkomende containers
   ══════════════════════════════════════════════════════════════════════

   Gerrit (19 aug 2026): "Op een commercial invoice staat hoeveel containers
   er binnen gaan komen. Zodra die wordt uitgelezen, wil ik dat er bij
   Binnenkomende goederen die containers zichtbaar komen, dat automatisch de
   packing list wordt uitgelezen en de labels om te printen per container
   klaar komen te staan. Als Manon dan een container binnenkrijgt, kan ze
   gemakkelijk op de container klikken die binnenkomt en direct labels
   printen kiezen."

   Het lezen gebeurt in de pagina (inv-pl.js); hier wordt bewaard wat eruit
   kwam. De sleutel is het invoicenummer plus het volgnummer van de container,
   want een containernummer is er vaak nog niet als de fabriek de papieren
   maakt.

   Wat hier NIET gebeurt is opnieuw uitrekenen. Wat de lezer ervan maakte is
   wat Manon in het scherm zag toen ze het inlas; dat later stilletjes anders
   berekenen zou betekenen dat er andere labels uitrollen dan ze verwachtte. */

function binnenkomendSleutel(invoice, volgnummer) {
  return String(invoice || "?").trim() + "#" + Number(volgnummer || 1);
}

async function binnenkomendBewaren(env, door, doc) {
  if (!doc || !Array.isArray(doc.containers) || !doc.containers.length) {
    return { ok: false, error: "geen-containers" };
  }
  const alles = (await env.FONTEYN_DATA.get("binnenkomend", { type: "json" })) || { lijst: [] };
  const nu = new Date().toISOString();
  let nieuw = 0, bijgewerkt = 0;

  for (const c of doc.containers) {
    const sleutel = binnenkomendSleutel(doc.nummer, c.volgnummer);
    const regel = {
      sleutel,
      invoice: String(doc.nummer || ""),
      leverancier: String(doc.leverancier || ""),
      vaart: String(doc.vaart || ""),
      nummer: String(c.nummer || ""),
      volgnummer: Number(c.volgnummer || 1),
      maat: String(c.maat || ""),
      colli: Array.isArray(c.colli) ? c.colli : [],
      totaalColli: Number(c.totaalColli || 0),
      totaalStuks: Number(c.totaalStuks || 0),
      bruto: Number(c.bruto || 0),
      cbm: Number(c.cbm || 0),
      bestand: String(doc.bestand || ""),
      door: door,
      bewaard: nu,
    };
    const i = (alles.lijst || []).findIndex(x => x.sleutel === sleutel);
    if (i >= 0) {
      /* Opnieuw inlezen mag, maar wat iemand zelf heeft bijgezet blijft:
         het containernummer dat later van de Bill of Lading kwam, en of hij
         al binnen is. */
      const oud = alles.lijst[i];
      regel.nummer = regel.nummer || oud.nummer || "";
      regel.binnen = oud.binnen || null;
      regel.gedrukt = oud.gedrukt || null;
      alles.lijst[i] = regel;
      bijgewerkt++;
    } else {
      alles.lijst.push(regel);
      nieuw++;
    }
  }
  /* Nieuwste bovenaan, en niet eindeloos laten groeien. */
  alles.lijst.sort((a, b) => String(b.bewaard).localeCompare(String(a.bewaard)));
  if (alles.lijst.length > 400) alles.lijst = alles.lijst.slice(0, 400);
  await env.FONTEYN_DATA.put("binnenkomend", JSON.stringify(alles));
  return { ok: true, nieuw, bijgewerkt, containers: doc.containers.length };
}

/* Een container bijwerken: het echte containernummer erbij, aanvinken dat
   hij binnen is, of vastleggen dat de labels gedrukt zijn. */
async function binnenkomendZet(env, door, body) {
  const sleutel = String(body.sleutel || "").trim();
  if (!sleutel) return { ok: false, error: "sleutel-nodig" };
  const alles = (await env.FONTEYN_DATA.get("binnenkomend", { type: "json" })) || { lijst: [] };
  const c = (alles.lijst || []).find(x => x.sleutel === sleutel);
  if (!c) return { ok: false, error: "container-niet-gevonden" };

  if (typeof body.nummer === "string") c.nummer = body.nummer.trim().toUpperCase().slice(0, 20);
  if (body.binnen === true) c.binnen = { door, op: new Date().toISOString() };
  if (body.binnen === false) c.binnen = null;
  if (body.gedrukt) c.gedrukt = { door, op: new Date().toISOString(), aantal: Number(body.aantal || 0) };
  await env.FONTEYN_DATA.put("binnenkomend", JSON.stringify(alles));
  return { ok: true, container: c };
}

async function bestellingKoppel(env, body) {
  const ref = String(body.referentie || "").trim();
  const zending = String(body.zending || "").trim();
  if (!ref || !zending) return { ok: false, error: "referentie-en-zending-nodig" };

  const alles = (await env.FONTEYN_DATA.get("bestellingen", { type: "json" })) || { lijst: [] };
  const b = (alles.lijst || []).find(x => x.referentie === ref);
  if (!b) return { ok: false, error: "bestelling-niet-gevonden" };

  b.zendingen = (b.zendingen || []).filter(z => z !== zending);
  if (!body.los) b.zendingen.push(zending);
  await env.FONTEYN_DATA.put("bestellingen", JSON.stringify(alles));
  return { ok: true, referentie: ref, zendingen: b.zendingen };
}

/* De bestellingen met hun zendingen erbij. Wat er automatisch te vinden is
   wordt hier gezocht en niet bewaard: de schepenlijst verandert, en een
   koppeling die ooit klopte moet niet blijven hangen als het schip weg is.
   Wat met de hand is gekoppeld blijft wél staan - dat is een besluit van een
   mens en geen gok van een machine. */
async function bestellingen(env) {
  const alles = (await env.FONTEYN_DATA.get("bestellingen", { type: "json" })) || { lijst: [] };
  const schepen = (await env.FONTEYN_DATA.get("voorraad-schepen", { type: "json" })) || {};
  const vloot = schepen.ships || [];

  const lijst = (alles.lijst || []).map(b => {
    const handmatig = (b.zendingen || []);
    const gevonden = vloot.filter(s => s.ref && noemtReferentie(s, b.referentie))
                          .map(s => s.ref)
                          .filter(r => handmatig.indexOf(r) < 0);
    const alle = handmatig.concat(gevonden);
    return {
      ...b,
      zendingen: handmatig,
      gevonden,
      /* Wat er van deze bestelling in beeld is. Zolang er geen zending aan
         hangt staat er niets onderweg, en dat is precies wat je wilt zien. */
      koppelingen: alle.map(r => {
        const s = vloot.find(x => x.ref === r);
        return { ref: r, eta: s ? (s.eta || "") : "", bestand: s ? (s.file || "") : "",
                 bekend: !!s, vanzelf: gevonden.indexOf(r) >= 0 };
      }),
    };
  }).sort((a, b) => String(b.datum || "").localeCompare(String(a.datum || "")));

  /* De zendingen waar nog geen bestelling aan hangt, zodat er iets te kiezen
     valt zonder dat iemand containernummers uit zijn hoofd moet kennen. */
  const gekoppeld = new Set(lijst.flatMap(b => b.koppelingen.map(k => k.ref)));
  const vrij = vloot.filter(s => s.ref && !gekoppeld.has(s.ref))
                    .map(s => ({ ref: s.ref, eta: s.eta || "", bestand: s.file || "",
                                 alleenDocumenten: !!s.alleenDocumenten }));
  return { ok: true, lijst, vrij };
}

async function bestellingBewaren(env, wie, doc) {
  if (!doc || !doc.referentie) return { ok: false, error: "geen-referentie" };
  const alles = (await env.FONTEYN_DATA.get("bestellingen", { type: "json" })) || { lijst: [] };
  const rec = {
    referentie: String(doc.referentie).slice(0, 40),
    fabriek: String(doc.fabriek || "").slice(0, 100),
    datum: String(doc.datum || "").slice(0, 10),
    regels: (doc.regels || []).slice(0, 200),
    artikelen: (doc.artikelen || []).slice(0, 200),
    totaal: Number(doc.totaal) || 0,
    bestand: String(doc.bestand || "").slice(0, 120),
    door: wie, ts: new Date().toISOString(),
  };
  const i = (alles.lijst || []).findIndex(x => x.referentie === rec.referentie);
  if (i >= 0) alles.lijst[i] = rec; else alles.lijst.push(rec);
  alles.lijst = alles.lijst.slice(-300);
  await env.FONTEYN_DATA.put("bestellingen", JSON.stringify(alles));
  return { ok: true, referentie: rec.referentie, vervangen: i >= 0 };
}

/* ══════════════════════════════════════════════════════════════════════
   Uren — starten, stoppen en achteraf bijstellen
   ══════════════════════════════════════════════════════════════════════

   Logic4 heeft hier niets voor. Alle 289 endpoints nagelopen: er is geen
   enkele urenregistratie in de API. Dus houden we het zelf bij.

   Twee soorten opslag:

     uren-JJJJ-MM   de afgeronde regels van die maand, met een wie erbij
     urenloopt:wie  wie er op dit moment aan het werk is

   Die tweede staat bewust in de opslag en niet op het toestel. Je klokt in
   op je telefoon in de loods en klokt af achter je bureau; dat moet gewoon
   werken. Bovendien overleeft het een lege batterij.

   Wie welke uren ziet bepaalt de worker, niet de pagina: alles gaat langs de
   persoonlijke sleutel en die ligt vast aan één naam. Een andere naam
   meesturen levert niets op.                                            */

/* ── Persoonlijke code ────────────────────────────────────────────────
   Om voor een collega te kunnen klokken. Nomi geeft haar code aan Manon,
   Manon klokt haar in, en beide namen komen in de regel te staan.

   De code wordt niet bewaard, alleen een afgeleide ervan met een eigen zout
   en honderdduizend rondes. Wie bij de opslag kan - en dat is niemand behalve
   de beheerder - kan er dus nog steeds niet mee klokken. Dat is geen luxe:
   zonder die stap zou één blik in de opslag genoeg zijn om voor iedereen in
   te klokken, en dan is het hele systeem een formaliteit. */

async function codeAfgeleide(code, zoutHex) {
  const enc = new TextEncoder();
  const zout = Uint8Array.from(zoutHex.match(/../g).map(h => parseInt(h, 16)));
  const sleutel = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: zout, iterations: 100000, hash: "SHA-256" }, sleutel, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function nieuwZout() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

async function urenCodes(env) {
  return (await env.FONTEYN_DATA.get("uren-codes", { type: "json" })) || {};
}

/* Een code instellen of wijzigen. Wie er al een heeft moet de oude kennen -
   anders zou wie even bij een openstaand scherm komt de code van een ander
   kunnen omzetten en daarna vrij spel hebben. Kwijt? Dan zet Dolf of Gerrit
   hem terug op nul. */
async function urenCodeZetten(env, wie, oud, nieuw) {
  const code = String(nieuw || "").trim();
  if (!/^\d{4,8}$/.test(code)) {
    return { ok: false, error: "code-vorm",
             uitleg: "Een code is vier tot acht cijfers." };
  }
  if (/^(\d)\1+$/.test(code) || "0123456789".includes(code) || "9876543210".includes(code)) {
    return { ok: false, error: "code-te-simpel",
             uitleg: "Kies iets anders dan alleen dezelfde cijfers of een rijtje." };
  }
  const alles = await urenCodes(env);
  const bestaand = alles[wie];
  if (bestaand) {
    if (!oud) return { ok: false, error: "oude-code-nodig" };
    const proef = await codeAfgeleide(String(oud), bestaand.zout);
    if (proef !== bestaand.hash) return { ok: false, error: "oude-code-klopt-niet" };
  }
  const zout = nieuwZout();
  alles[wie] = { zout, hash: await codeAfgeleide(code, zout), gezet: new Date().toISOString() };
  await env.FONTEYN_DATA.put("uren-codes", JSON.stringify(alles));
  return { ok: true };
}

async function urenCodeKlopt(env, wie, code) {
  const alles = await urenCodes(env);
  const r = alles[wie];
  if (!r) return false;
  return (await codeAfgeleide(String(code || ""), r.zout)) === r.hash;
}

/* Voor wie kun je klokken: iedereen die een code heeft ingesteld. Zonder
   code kan het niet, dus die lijst is precies de goede. Er gaan geen codes
   of afgeleiden mee terug, alleen namen. */
async function urenCollegas(env, ik) {
  const alles = await urenCodes(env);
  return { ok: true, namen: Object.keys(alles).filter(n => n !== ik).sort() };
}

/* ── Waar iemand was ──────────────────────────────────────────────────
   De browser vraagt zelf toestemming voordat hij een locatie afgeeft, dus
   dit kan niet buiten iemand om. Geeft iemand geen toestemming, dan wordt de
   regel gewoon opgeslagen met de vermelding dat er geen locatie was; dat is
   eerlijker dan het klokken weigeren.

   Naast de coördinaten gaat de afstand tot de vestiging mee. Dat is meestal
   het enige waar iemand naar kijkt - was je op de zaak of niet - en het is te
   lezen zonder een kaart erbij te halen. */

function afstandMeter(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function urenVestiging(env) {
  const i = (await env.FONTEYN_DATA.get("uren-instellingen", { type: "json" })) || {};
  return i.vestiging || null;   // { lat, lon, naam, straal }
}

async function urenPlaats(env, loc) {
  if (!loc || typeof loc.lat !== "number" || typeof loc.lon !== "number") {
    return { gegeven: false, reden: (loc && String(loc.reden || "").slice(0, 40)) || "niet gedeeld" };
  }
  const plek = {
    gegeven: true,
    lat: Math.round(loc.lat * 1e5) / 1e5,
    lon: Math.round(loc.lon * 1e5) / 1e5,
    nauwkeurig: Math.round(Number(loc.nauwkeurig) || 0),
  };
  const v = await urenVestiging(env);
  if (v) {
    plek.afstand = afstandMeter(plek.lat, plek.lon, v.lat, v.lon);
    /* De meetfout telt mee. Staat iemand op tweehonderd meter met een
       nauwkeurigheid van driehonderd, dan is "niet op de zaak" een conclusie
       die de meting niet draagt. */
    plek.opZaak = plek.afstand - plek.nauwkeurig <= (v.straal || 300);
    plek.vestiging = v.naam || "";
  }
  return plek;
}

function urenMaand(d) {
  const dt = d ? new Date(d) : new Date();
  return "uren-" + dt.getUTCFullYear() + "-" + String(dt.getUTCMonth() + 1).padStart(2, "0");
}

async function urenLees(env, maand) {
  return (await env.FONTEYN_DATA.get(maand, { type: "json" })) || { regels: [] };
}

async function urenLopend(env, wie) {
  return await env.FONTEYN_DATA.get("urenloopt:" + wie, { type: "json" });
}

/* Voor wie wordt er geklokt, en mag dat? Zonder namens is het gewoon jezelf.
   Klok je voor een collega, dan moet je diens code kennen én laat je je eigen
   naam achter in de regel. Frauderen kan dus niet alleen: er staan altijd twee
   namen onder. */
async function urenWieVoor(env, request, ik, body) {
  const namens = String(body.namens || "").trim().toLowerCase();
  if (!namens || namens === ik) return { ok: true, voor: ik, door: null };

  if (await rateLimited(env, request, "urencode", 10, 600)) {
    return { ok: false, error: "te-veel-pogingen",
             uitleg: "Te veel pogingen met een code. Probeer het over tien minuten opnieuw." };
  }
  const codes = await urenCodes(env);
  if (!codes[namens]) {
    return { ok: false, error: "geen-code-ingesteld",
             uitleg: namens + " heeft nog geen eigen code ingesteld en kan dus niet door een ander geklokt worden." };
  }
  if (!(await urenCodeKlopt(env, namens, body.code))) {
    console.log("[uren] verkeerde code: " + ik + " probeerde te klokken voor " + namens);
    return { ok: false, error: "code-klopt-niet", uitleg: "Die code klopt niet." };
  }
  return { ok: true, voor: namens, door: ik };
}

/* Beginnen. Loopt er al iets, dan is dat geen fout maar een vergissing van
   gisteren: we geven terug wat er loopt en laten de gebruiker beslissen. */
async function urenStart(env, request, ik, body) {
  const w = await urenWieVoor(env, request, ik, body);
  if (!w.ok) return w;

  const bezig = await urenLopend(env, w.voor);
  if (bezig) return { ok: false, error: "loopt-al", bezig, voor: w.voor };

  const regel = {
    start: new Date().toISOString(),
    omschrijving: String(body.omschrijving || "").slice(0, 200),
    plaats: await urenPlaats(env, body.locatie),
  };
  if (w.door) regel.startDoor = w.door;
  await env.FONTEYN_DATA.put("urenloopt:" + w.voor, JSON.stringify(regel));
  return { ok: true, bezig: regel, voor: w.voor };
}

/* Stoppen. De regel gaat naar de maand waarin hij begón - een dienst die
   over middernacht heen loopt hoort bij de dag dat je bent begonnen, anders
   valt hij in het overzicht van de verkeerde maand. */
async function urenStop(env, request, ik, body) {
  const w = await urenWieVoor(env, request, ik, body);
  if (!w.ok) return w;

  const bezig = await urenLopend(env, w.voor);
  if (!bezig) return { ok: false, error: "niets-gestart", voor: w.voor };

  const eind = new Date().toISOString();
  const maand = urenMaand(bezig.start);
  const data = await urenLees(env, maand);
  const regel = {
    id: crypto.randomUUID(),
    wie: w.voor,
    start: bezig.start,
    eind,
    minuten: Math.max(0, Math.round((new Date(eind) - new Date(bezig.start)) / 60000)),
    omschrijving: String(body.omschrijving !== undefined ? body.omschrijving : bezig.omschrijving || "").slice(0, 200),
    /* Waar er is aan- en afgeklokt, en door wie als dat niet de persoon zelf
       was. Allebei apart: iemand kan door een collega worden ingeklokt en
       zichzelf afklokken, en dan hoort dat er ook zo te staan. */
    begonnen: bezig.plaats || { gegeven: false, reden: "onbekend" },
    geeindigd: await urenPlaats(env, body.locatie),
  };
  if (bezig.startDoor) regel.startDoor = bezig.startDoor;
  if (w.door) regel.stopDoor = w.door;

  data.regels = (data.regels || []).concat([regel]);
  await env.FONTEYN_DATA.put(maand, JSON.stringify(data));
  await env.FONTEYN_DATA.delete("urenloopt:" + w.voor);
  return { ok: true, regel, voor: w.voor };
}

/* De eigen regels van een maand. Alleen die van deze persoon: het filter
   staat hier en niet in de pagina, want anders zou wie de teamsleutel heeft
   in andermans uren kunnen kijken. */
async function urenLijst(env, wie, maandParam) {
  const maand = /^uren-\d{4}-\d{2}$/.test(maandParam || "") ? maandParam : urenMaand();
  const data = await urenLees(env, maand);
  const mijn = (data.regels || []).filter(r => r.wie === wie)
                                  .sort((a, b) => String(b.start).localeCompare(String(a.start)));
  return { ok: true, maand, regels: mijn, bezig: await urenLopend(env, wie) };
}

/* Wie de uren van iedereen mag inzien. Dezelfde twee als in toegang.js, die
   bepaalt wie de knop ziet; hier staat het nog een keer, want een scherm mag
   zichzelf niet bewaken als het om de gegevens van collega's gaat. Wie hier
   niet in staat krijgt zijn eigen uren en verder niets - ook niet als hij de
   route rechtstreeks aanroept. */
const UREN_ALLEMAAL = new Set([
  "dolf@fonteyn.nl", "dolf", "fonteyn.dolf",
  "gerrit@fonteyn.nl", "gerrit", "fonteyn.gerrit",
  "fonteynbot@fonteyn.nl", "fonteynbot", "fonteyn.bot",
]);

/* Het overzicht van iedereen: per persoon een totaal, en de regels erbij.
   Bedoeld om te zien wie hoeveel heeft gewerkt, niet om te controleren waar
   iemand op welk moment was - vandaar totalen voorop en de regels eronder. */
async function urenIedereen(env, wie, maandParam) {
  if (!UREN_ALLEMAAL.has(String(wie).toLowerCase())) {
    return { ok: false, error: "niet-gemachtigd" };
  }
  const maand = /^uren-\d{4}-\d{2}$/.test(maandParam || "") ? maandParam : urenMaand();
  const data = await urenLees(env, maand);
  const regels = (data.regels || []).slice()
    .sort((a, b) => String(b.start).localeCompare(String(a.start)));

  const perPersoon = new Map();
  for (const r of regels) {
    const p = perPersoon.get(r.wie) || { wie: r.wie, minuten: 0, regels: [] };
    p.minuten += r.minuten || 0;
    p.regels.push(r);
    perPersoon.set(r.wie, p);
  }
  const mensen = [...perPersoon.values()].sort((a, b) => b.minuten - a.minuten);

  /* Wie er nu aan het werk is. Dat staat per persoon apart opgeslagen, dus
     even langs de sleutels die met urenloopt: beginnen. */
  const bezig = [];
  try {
    const lijst = await env.FONTEYN_DATA.list({ prefix: "urenloopt:" });
    for (const k of lijst.keys) {
      const j = await env.FONTEYN_DATA.get(k.name, { type: "json" });
      if (j) bezig.push({ wie: k.name.slice("urenloopt:".length), start: j.start,
                          omschrijving: j.omschrijving || "" });
    }
  } catch (e) { /* niet kunnen zien wie er loopt is geen reden om alles te weigeren */ }

  return { ok: true, maand, mensen, bezig,
           totaal: mensen.reduce((n, m) => n + m.minuten, 0) };
}

/* Een regel bijstellen of weghalen. Alleen je eigen regels, en de tijden
   moeten kloppen - een eind vóór het begin levert negatieve uren op en die
   sluipen anders zo een overzicht in. */
async function urenWijzig(env, wie, body) {
  const maand = /^uren-\d{4}-\d{2}$/.test(body.maand || "") ? body.maand : urenMaand();
  const data = await urenLees(env, maand);
  const i = (data.regels || []).findIndex(r => r.id === body.id && r.wie === wie);
  if (i < 0) return { ok: false, error: "regel-niet-gevonden" };

  if (body.verwijderen) {
    data.regels.splice(i, 1);
    await env.FONTEYN_DATA.put(maand, JSON.stringify(data));
    return { ok: true, verwijderd: true };
  }

  const r = data.regels[i];
  if (body.start) r.start = String(body.start);
  if (body.eind) r.eind = String(body.eind);
  if (body.omschrijving !== undefined) r.omschrijving = String(body.omschrijving).slice(0, 200);
  const van = new Date(r.start), tot = new Date(r.eind);
  if (isNaN(van) || isNaN(tot)) return { ok: false, error: "ongeldige-tijd" };
  if (tot < van) return { ok: false, error: "eind-voor-begin",
                          uitleg: "De eindtijd ligt vóór de begintijd." };
  r.minuten = Math.round((tot - van) / 60000);
  await env.FONTEYN_DATA.put(maand, JSON.stringify(data));
  return { ok: true, regel: r };
}

/* Met de hand een regel toevoegen, voor wie is vergeten te klokken. */
async function urenToevoegen(env, wie, body) {
  const van = new Date(String(body.start || ""));
  const tot = new Date(String(body.eind || ""));
  if (isNaN(van) || isNaN(tot)) return { ok: false, error: "ongeldige-tijd" };
  if (tot < van) return { ok: false, error: "eind-voor-begin",
                          uitleg: "De eindtijd ligt vóór de begintijd." };
  const maand = urenMaand(van.toISOString());
  const data = await urenLees(env, maand);
  const regel = {
    id: crypto.randomUUID(), wie,
    start: van.toISOString(), eind: tot.toISOString(),
    minuten: Math.round((tot - van) / 60000),
    omschrijving: String(body.omschrijving || "").slice(0, 200),
    metDeHand: true,
  };
  data.regels = (data.regels || []).concat([regel]);
  await env.FONTEYN_DATA.put(maand, JSON.stringify(data));
  return { ok: true, regel };
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

    /* De trackingreferentie van één zending zetten. Stond op het tabblad
       Schepen, waar de hele lijst in één keer werd weggeschreven. Per zending
       is veiliger: twee mensen die tegelijk iets bijwerken overschrijven
       elkaars werk niet meer. */
    if (url.pathname === "/voorraad/schip/referentie" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const b = await request.json().catch(() => ({}));
      const ref = String(b.ref || "").trim();
      if (!ref) return reply(400, { ok: false, error: "geen schip meegegeven" });
      const data = (await env.FONTEYN_DATA.get("voorraad-schepen", { type: "json" })) || {};
      const schip = (data.ships || []).find(x => String(x.ref) === ref);
      if (!schip) return reply(404, { ok: false, error: "schip niet gevonden" });
      if (b.trackRef !== undefined) schip.trackRef = String(b.trackRef || "").trim();
      /* De aankomst met de hand kunnen zetten blijft nodig: niet elke
         vervoerder geeft een datum, en zonder datum valt een zending uit de
         volgorde en uit het blok met wat er onderweg is. */
      if (b.eta !== undefined) {
        const e = String(b.eta || "").trim();
        if (e && !/^\d{4}-\d{2}-\d{2}$/.test(e)) return reply(400, { ok: false, error: "datum moet jjjj-mm-dd zijn" });
        schip.eta = e;
      }
      data.updated = new Date().toISOString();
      await env.FONTEYN_DATA.put("voorraad-schepen", JSON.stringify(data));
      return reply(200, { ok: true, trackRef: schip.trackRef, eta: schip.eta || null });
    }

    /* Een document aan een zending hangen. Het bestand zelf gaat via
       /voorraad/schip/bestand; hier komt alleen de verwijzing erbij. Per
       zending in plaats van de hele lijst wegschrijven, om dezelfde reden als
       bij de referentie: twee mensen tegelijk mag geen werk kosten. */
    /* Aanvinken dat een container binnen is, zonder dat er iets in Logic4
       gebeurt. Chantal (video, 19 aug 2026): "dat moeten we ook gewoon kunnen
       aanklikken, alleen moet het geen consequentie hebben in Logic maar
       alleen in het dashboard. Alles wat binnenkomt moet dan wel in het
       dashboard meegeteld worden bij het overzicht als zijnde op voorraad of
       binnen. Het mag alleen absoluut geen consequentie of actie doen in
       Logic." Daarom staat dit hier los van het boeken van de ontvangst. */
    if (url.pathname === "/voorraad/schip/binnen" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const b = await request.json().catch(() => ({}));
      const ref = String(b.ref || "").trim();
      if (!ref) return reply(400, { ok: false, error: "schip ontbreekt" });
      const data = (await env.FONTEYN_DATA.get("voorraad-schepen", { type: "json" })) || {};
      const schip = (data.ships || []).find(x => String(x.ref) === ref);
      if (!schip) return reply(404, { ok: false, error: "schip niet gevonden" });
      schip.binnenGemeld = b.binnen
        ? { op: new Date().toISOString(), door: String(b.door || "").slice(0, 80) }
        : null;
      data.updated = new Date().toISOString();
      await env.FONTEYN_DATA.put("voorraad-schepen", JSON.stringify(data));
      return reply(200, { ok: true, binnenGemeld: schip.binnenGemeld });
    }

    if (url.pathname === "/voorraad/schip/document" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const b = await request.json().catch(() => ({}));
      const ref = String(b.ref || "").trim();
      const doc = b.doc || null;
      if (!ref || !doc || !doc.id) return reply(400, { ok: false, error: "schip en document zijn allebei nodig" });
      const data = (await env.FONTEYN_DATA.get("voorraad-schepen", { type: "json" })) || {};
      const schip = (data.ships || []).find(x => String(x.ref) === ref);
      if (!schip) return reply(404, { ok: false, error: "schip niet gevonden" });
      schip.documenten = (schip.documenten || []).filter(d => d.id !== doc.id);
      schip.documenten.push({
        id: String(doc.id), naam: String(doc.naam || doc.id).slice(0, 160),
        soort: String(doc.soort || "document").slice(0, 40),
        grootte: Number(doc.grootte) || 0,
        ts: new Date().toISOString(), door: String(doc.door || "").slice(0, 80),
      });
      data.updated = new Date().toISOString();
      await env.FONTEYN_DATA.put("voorraad-schepen", JSON.stringify(data));
      return reply(200, { ok: true, documenten: schip.documenten });
    }

    /* Een zending verwijderen. Dat haalt de lading ook uit wat er als
       voorraad onderweg meetelt, dus het is niet niks; wat weggaat wordt
       daarom eerst apart bewaard, net als bij de Jazzi-bestellingen. */
    if (url.pathname === "/voorraad/schip/verwijder" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const b = await request.json().catch(() => ({}));
      const ref = String(b.ref || "").trim();
      if (!ref) return reply(400, { ok: false, error: "geen schip meegegeven" });
      const data = (await env.FONTEYN_DATA.get("voorraad-schepen", { type: "json" })) || {};
      const schip = (data.ships || []).find(x => String(x.ref) === ref);
      if (!schip) return reply(404, { ok: false, error: "schip niet gevonden" });
      const weg = (await env.FONTEYN_DATA.get("voorraad-verwijderd", { type: "json" })) || { orders: {} };
      weg.schepen = weg.schepen || {};
      weg.schepen[ref] = { schip, ts: new Date().toISOString(), door: String(b.door || "").slice(0, 80) };
      await env.FONTEYN_DATA.put("voorraad-verwijderd", JSON.stringify(weg));
      data.ships = (data.ships || []).filter(x => String(x.ref) !== ref);
      data.updated = new Date().toISOString();
      await env.FONTEYN_DATA.put("voorraad-schepen", JSON.stringify(data));
      return reply(200, { ok: true, spas: Number(schip.total) || 0 });
    }

    /* De aankomst van één zending, bij welke vervoerder hij ook vaart. Het
       scherm hoeft niet te weten wie dat is. */
    if (url.pathname === "/voorraad/aankomst" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const b = await request.json().catch(() => ({}));
      const uit = await aankomstZoek(env, b.ref).catch(e => ({ ok: false, error: String(e.message || e) }));
      /* Wat de vervoerder zei bij het schip bewaren, zodat de voortgang er de
         volgende keer nog staat zonder opnieuw te hoeven vragen. De ETA zelf
         wordt alleen ingevuld als er nog geen stond - een datum die iemand met
         de hand heeft gezet mag niet stilletjes overschreven worden. */
      if (uit.ok && b.schip) {
        try {
          const data = (await env.FONTEYN_DATA.get("voorraad-schepen", { type: "json" })) || {};
          const schip = (data.ships || []).find(x => String(x.ref) === String(b.schip));
          if (schip) {
            schip.track = { vervoerder: uit.vervoerder, eta: uit.eta || null,
                            vessel: uit.vessel || null, status: uit.status || null,
                            opgehaald: new Date().toISOString() };
            if (!schip.eta && uit.eta) schip.eta = String(uit.eta).slice(0, 10);
            data.updated = new Date().toISOString();
            await env.FONTEYN_DATA.put("voorraad-schepen", JSON.stringify(data));
            uit.bewaard = true;
          }
        } catch (e) { /* bewaren mag het antwoord niet tegenhouden */ }
      }
      return reply(200, uit);
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
    /* Een Jazzi-bestelling echt verwijderen. Beheersleutel, net als het
       aanmaken: dit haalt een bestelling uit de bron waar de forecast en de
       reserveringen ook uit lezen. */
    if (url.pathname === "/voorraad/spa-migratie/verwijderen" && request.method === "POST") {
      if ((request.headers.get("X-DP-Admin") || "") !== env.DP_ADMIN_KEY) return reply(401, { ok: false, error: "beheersleutel vereist" });
      const body = await request.json().catch(() => ({}));
      return reply(200, await spaMigratieVerwijderen(env, body).catch(e => ({ ok: false, error: String(e.message || e) })));
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

    /* ── Het dashboard op de telefoon ────────────────────────────────
       Op een telefoon draait het hulpprogramma van de pc niet, en er valt
       ook niets te installeren. Dus serveert de worker de pagina's zelf,
       rechtstreeks uit de repo, net als de volgpagina voor klanten.

       Alleen de bestanden die hieronder staan. Zonder die lijst zou dit een
       open luik naar de hele repo zijn, en daar staat meer in dan hier hoort
       te komen. Wat je binnen ziet, zie je pas na inloggen bij Logic4; deze
       pagina's zelf bevatten geen gegevens.

       In de HTML gaat "dashboard.html" om naar "./": die pagina bestaat op
       de telefoon niet, en de terugknop van een tegel hoort hier terug te
       komen op het mobiele dashboard. */
    if (url.pathname === "/m" || url.pathname === "/m/" || url.pathname.startsWith("/m/")) {
      if (url.pathname === "/m") return Response.redirect(url.origin + "/m/", 302);
      const naam = url.pathname.slice(3) || "mobiel.html";

      /* Wat mag hier naar buiten: precies de bestanden uit manifest.json, en
         niets anders. Dat is dezelfde lijst die de app op de pc ophaalt, dus
         er komt hier nooit iets langs dat niet toch al bij iedere medewerker
         op de schijf staat. Een vaste lijst in deze code zou bij elke nieuwe
         tegel weer bijgewerkt moeten worden, en dan is het wachten tot iemand
         dat vergeet. */
      const bestand = (await mobielToegestaan(env)).has(naam) ? naam : null;
      if (!bestand) return reply(404, "Niet beschikbaar op de telefoon");

      /* Niet cachen. GitHub zet er zelf vijf minuten op en Cloudflare hield
         zich daaraan, ook met een korte cacheTtl erbij - een pas gepushte
         wijziging bleef minutenlang onzichtbaar. Dat is precies verkeerd om:
         iets aanpassen en het meteen op je toestel willen zien is de manier
         waarop hier gewerkt wordt. Het verkeer is een handvol verzoeken per
         dag, dus elke keer vers ophalen kost niets. */
      const r = await fetch("https://raw.githubusercontent.com/gerritgmulder/douanepapieren-data/main/" +
                            bestand + "?t=" + Date.now(),
                            { cf: { cacheTtl: 0, cacheEverything: false } });
      if (!r.ok) return reply(502, "Pagina niet beschikbaar");

      const soort = bestand.endsWith(".js") ? "application/javascript; charset=utf-8"
                  : bestand.endsWith(".png") ? "image/png"
                  : bestand.endsWith(".webmanifest") ? "application/manifest+json; charset=utf-8"
                  : bestand.endsWith(".json") ? "application/json; charset=utf-8"
                  : "text/html; charset=utf-8";
      const kop = { "Content-Type": soort, "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
      if (bestand.endsWith(".png") || bestand.endsWith(".jpg") || bestand.endsWith(".ico"))
        return new Response(await r.arrayBuffer(), { status: 200, headers: kop });
      let t = await r.text();
      if (bestand.endsWith(".html")) {
        t = t.replace(/"dashboard\.html"/g, '"./"');
        /* De brug moet vóór al het andere draaien: hij vangt de aanroepen op
           naar het hulpprogramma dat hier niet bestaat. Deed hij dat niet, dan
           wist een tegel de sessie zodra die aanroep mislukte en stond je weer
           op het inlogscherm - en na opnieuw inloggen meteen weer. */
        t = t.replace(/<head([^>]*)>/i, '<head$1><script src="mobiel-brug.js"></script>');
      }
      return new Response(t, { status: 200, headers: kop });
    }

    /* De volgpagina voor de klant. Publiek: de code in de link is de sleutel,
       en zonder geldige code komt er niets uit. */
    if (url.pathname === "/bezorging" && request.method === "GET") {
      const cb = Math.floor(Date.now() / 10000);
      const r = await fetch("https://raw.githubusercontent.com/gerritgmulder/douanepapieren-data/main/bezorging.html?cb=" + cb);
      if (!r.ok) return reply(502, "Pagina niet beschikbaar");
      return new Response(await r.text(), { status: 200, headers: {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      } });
    }
    if (url.pathname === "/bezorging/status" && request.method === "GET") {
      return bezorgingStatus(env, url);
    }

    /* Waar rijden de bakwagens. Zolang de sleutels van Verizon er niet zijn
       komen hier verzonnen posities uit, met demo:true erbij. */
    if (url.pathname === "/verizon/posities" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const body = await request.json().catch(() => ({}));
      return reply(200, await verizonPosities(env, body).catch(e => ({ ok: false, error: String(e.message || e) })));
    }

    /* Kan Cloudflare bij de mailserver van Fonteyn? Dit is de vraag waar de
       hele mailtegel op staat of valt: de Exchange staat in Uddel en de worker
       draait bij Cloudflare. Er gaan bewust geen inloggegevens mee - een 401
       met "Basic" erin is precies het antwoord dat we willen zien, want dat
       betekent: bereikbaar, en hij accepteert een gewone gebruikersnaam. */
    if (url.pathname === "/mail/bereikbaar" && request.method === "GET") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const host = url.searchParams.get("host") || "portal.fonteyn.nl";
      const uit = [];
      for (const pad of ["/EWS/Exchange.asmx", "/Autodiscover/Autodiscover.xml", "/Microsoft-Server-ActiveSync"]) {
        const t0 = Date.now();
        try {
          const r = await fetch("https://" + host + pad, { method: "GET" });
          const auth = [];
          r.headers.forEach((v, k) => { if (k.toLowerCase() === "www-authenticate") auth.push(v); });
          uit.push({ pad, status: r.status, ms: Date.now() - t0,
                     auth: auth.join(" | "), server: r.headers.get("x-feserver") || "" });
        } catch (e) {
          uit.push({ pad, fout: String(e.message || e), ms: Date.now() - t0 });
        }
      }
      return reply(200, { ok: true, host, uit });
    }

    /* Werkt het serviceaccount, en zo ja langs welke weg? Beide manieren los
       geprobeerd, zodat we de beheerder precies kunnen vertellen wat er nog
       ontbreekt in plaats van "het doet het niet". Achter het gedeelde
       geheim, want dit hoort bij het inrichten en niet bij het dagelijks
       gebruik. */
    if (url.pathname === "/mail/proefrit" && request.method === "GET") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const adres = url.searchParams.get("adres") || "";
      if (!adres) return reply(400, { ok: false, uitleg: "Geef ?adres=dolf@fonteyn.nl mee." });
      if (!env.EWS_GEBRUIKER || !env.EWS_WACHTWOORD) {
        return reply(200, { ok: false, error: "mail-niet-ingesteld",
          uitleg: "EWS_GEBRUIKER en EWS_WACHTWOORD staan nog niet als worker-secret." });
      }
      const proef = modus => '<m:FindItem Traversal="Shallow"><m:ItemShape>' +
        "<t:BaseShape>IdOnly</t:BaseShape></m:ItemShape>" +
        '<m:IndexedPageItemView MaxEntriesReturned="1" Offset="0" BasePoint="Beginning"/>' +
        "<m:ParentFolderIds>" + mapVerwijzing("inbox", adres, modus) + "</m:ParentFolderIds>" +
        "</m:FindItem>";
      const uit = {};
      for (const modus of MAIL_MODI) {
        const t0 = Date.now();
        const r = await ewsRoep(env, "FindItem", proef(modus), adres, modus);
        uit[modus] = r.ok
          ? { werkt: true, ms: Date.now() - t0 }
          : { werkt: false, ms: Date.now() - t0, error: r.error, code: r.code || "", uitleg: r.uitleg || "" };
      }
      const werkend = MAIL_MODI.filter(m => uit[m].werkt);
      if (werkend.length) await mailModusZet(env, werkend[0]);
      return reply(200, {
        ok: werkend.length > 0,
        mailbox: adres,
        werkt: werkend,
        gekozen: werkend[0] || null,
        detail: uit,
        advies: werkend.length ? "Klaar voor gebruik."
          : "Geen van beide wegen staat open. Vraag de beheerder om ApplicationImpersonation " +
            "of om Full Access op deze mailbox voor het serviceaccount.",
      });
    }

    /* ── Uren ────────────────────────────────────────────────────────
       Langs de persoonlijke sleutel, net als de mail. Wélke uren je ziet
       bepaalt de worker aan de hand van die sleutel; een naam meesturen
       helpt niet, en dat is met opzet. */
    if (url.pathname.startsWith("/uren/")) {
      const wie = await mailSleutelWie(env, request);
      if (!wie) return reply(401, { ok: false, error: "opnieuw-inloggen",
                                    uitleg: "De sleutel ontbreekt of is verlopen." });
      const b = request.method === "POST" ? await request.json().catch(() => ({})) : {};

      if (url.pathname === "/uren/lijst" && request.method === "GET")
        return reply(200, await urenLijst(env, wie, url.searchParams.get("maand")));
      if (url.pathname === "/uren/iedereen" && request.method === "GET") {
        const r = await urenIedereen(env, wie, url.searchParams.get("maand"));
        return reply(r.ok ? 200 : 403, r);
      }
      if (url.pathname === "/uren/start" && request.method === "POST")
        return reply(200, await urenStart(env, request, wie, b));
      if (url.pathname === "/uren/stop" && request.method === "POST")
        return reply(200, await urenStop(env, request, wie, b));
      if (url.pathname === "/uren/collegas" && request.method === "GET")
        return reply(200, await urenCollegas(env, wie));

      /* De vestiging vastleggen: ga op de zaak staan en druk op de knop. Dat
         is nauwkeuriger dan een adres opzoeken en het scheelt gedoe met
         coördinaten. Alleen voor wie het overzicht mag zien. */
      if (url.pathname === "/uren/vestiging" && request.method === "POST") {
        if (!UREN_ALLEMAAL.has(String(wie).toLowerCase()))
          return reply(403, { ok: false, error: "niet-gemachtigd" });
        const lat = Number(b.lat), lon = Number(b.lon);
        if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
          return reply(200, { ok: false, error: "geen-locatie",
                              uitleg: "Er kwam geen bruikbare locatie binnen." });
        const i = (await env.FONTEYN_DATA.get("uren-instellingen", { type: "json" })) || {};
        i.vestiging = { lat, lon, naam: String(b.naam || "de zaak").slice(0, 60),
                        straal: Math.min(Math.max(Number(b.straal) || 300, 50), 5000),
                        gezet: new Date().toISOString(), door: wie };
        await env.FONTEYN_DATA.put("uren-instellingen", JSON.stringify(i));
        return reply(200, { ok: true, vestiging: i.vestiging });
      }
      if (url.pathname === "/uren/vestiging" && request.method === "GET") {
        if (!UREN_ALLEMAAL.has(String(wie).toLowerCase()))
          return reply(403, { ok: false, error: "niet-gemachtigd" });
        return reply(200, { ok: true, vestiging: await urenVestiging(env) });
      }
      if (url.pathname === "/uren/code" && request.method === "POST")
        return reply(200, await urenCodeZetten(env, wie, b.oud, b.nieuw));
      if (url.pathname === "/uren/code" && request.method === "GET") {
        const codes = await urenCodes(env);
        return reply(200, { ok: true, heeftCode: !!codes[wie],
                            vestiging: !!(await urenVestiging(env)) });
      }
      if (url.pathname === "/uren/toevoegen" && request.method === "POST")
        return reply(200, await urenToevoegen(env, wie, b));
      if (url.pathname === "/uren/wijzig" && request.method === "POST")
        return reply(200, await urenWijzig(env, wie, b));
      return reply(404, { ok: false, error: "onbekende-urenroute" });
    }

    /* Gegevens opvragen uit Logic4 zonder het hulpprogramma van de pc.
       Zelfde vorm als /api/logic4-call daar, zodat de tegels niet hoeven te
       weten waar het antwoord vandaan komt - alleen opvragen, nooit wijzigen. */
    if (url.pathname === "/logic4/lees" && request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      return logic4Lees(env, request, b);
    }

    /* Artikelnummers nakijken in Logic4, en een orderbevestiging bewaren.
       Langs de teamsleutel: wie de tegel mag openen uploadt daar toch al
       documenten van de fabriek. */
    if (url.pathname === "/artikel/bestaat" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const b = await request.json().catch(() => ({}));
      const codes = Array.isArray(b.codes) ? b.codes.slice(0, 60) : [];
      return reply(200, await artikelBestaat(env, codes)
        .catch(e => ({ ok: false, error: String(e.message || e) })));
    }
    /* Een omschrijving van de fabriek aan een Logic4-artikel koppelen. */
    if (url.pathname === "/voorraad/koppeling" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const b = await request.json().catch(() => ({}));
      return reply(200, await artikelKoppel(env, b)
        .catch(e => ({ ok: false, error: String(e.message || e) })));
    }
    if (url.pathname === "/voorraad/koppeling" && request.method === "GET") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      return reply(200, { ok: true, koppelingen: await artikelKoppelingen(env) });
    }

    if (url.pathname === "/bestellingen" && request.method === "GET") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      return reply(200, await bestellingen(env)
        .catch(e => ({ ok: false, error: String(e.message || e) })));
    }
    if (url.pathname === "/bestelling/koppel" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const b = await request.json().catch(() => ({}));
      return reply(200, await bestellingKoppel(env, b)
        .catch(e => ({ ok: false, error: String(e.message || e) })));
    }
    if (url.pathname === "/binnenkomend" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const b = await request.json().catch(() => ({}));
      return reply(200, await binnenkomendBewaren(env, String(b.door || "").slice(0, 60), b.doc)
        .catch(e => ({ ok: false, error: String(e.message || e) })));
    }
    if (url.pathname === "/binnenkomend/zet" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const b = await request.json().catch(() => ({}));
      return reply(200, await binnenkomendZet(env, String(b.door || "").slice(0, 60), b)
        .catch(e => ({ ok: false, error: String(e.message || e) })));
    }

    if (url.pathname === "/bestelling" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const b = await request.json().catch(() => ({}));
      return reply(200, await bestellingBewaren(env, String(b.door || "").slice(0, 60), b.doc)
        .catch(e => ({ ok: false, error: String(e.message || e) })));
    }

    /* ── De mailtegel ────────────────────────────────────────────────
       Deze routes gaan niet langs de teamsleutel maar langs de
       persoonlijke sleutel uit X-Fonteyn-Mail. De teamsleutel heeft
       iedereen die het dashboard mag openen; daarmee zou de een de
       mailbox van de ander kunnen opvragen door een andere naam mee te
       sturen. De persoonlijke sleutel is bij het inloggen uitgegeven op
       vertoon van een geldige Logic4-login en ligt vast aan die persoon.
       Welke mailbox daarbij hoort bepaalt de worker, niet de client. */
    if (url.pathname.startsWith("/mail/") && url.pathname !== "/mail/bereikbaar") {
      const wie = await mailSleutelWie(env, request);
      if (!wie) return reply(401, { ok: false, error: "opnieuw-inloggen",
                                    uitleg: "De mailsleutel ontbreekt of is verlopen." });
      const adres = await mailAdresVan(env, wie);
      if (!adres) return reply(403, { ok: false, error: "geen-mailbox-bekend",
                                      uitleg: "Voor " + wie + " staat geen mailadres in de lijst." });
      const b = request.method === "POST" ? await request.json().catch(() => ({})) : {};

      if (url.pathname === "/mail/wie" && request.method === "GET")
        return reply(200, { ok: true, wie, mailbox: adres });

      if (url.pathname === "/mail/proef" && request.method === "GET")
        return reply(200, await mailProef(env, adres));

      if (url.pathname === "/mail/lijst" && request.method === "GET")
        return reply(200, await mailLijst(env, adres, {
          map: url.searchParams.get("map") || "inbox",
          aantal: url.searchParams.get("aantal"),
          vanaf: url.searchParams.get("vanaf"),
        }));

      if (url.pathname === "/mail/bericht" && request.method === "GET")
        return reply(200, await mailBericht(env, adres,
          url.searchParams.get("id") || "", url.searchParams.get("sleutel") || ""));

      if (url.pathname === "/mail/concept" && request.method === "POST")
        return reply(200, await mailConcept(env, adres, b));

      /* Verzenden staat bewust apart van concept maken. Een concept mag het
         dashboard uit zichzelf klaarzetten; op verzenden hoort altijd een
         mens te hebben geklikt. */
      if (url.pathname === "/mail/verzend" && request.method === "POST")
        return reply(200, await mailVerzend(env, adres, String(b.id || ""), String(b.sleutel || "")));

      if (url.pathname === "/mail/gelezen" && request.method === "POST")
        return reply(200, await mailGelezen(env, adres, String(b.id || ""), String(b.sleutel || ""), b.gelezen !== false));

      if (url.pathname === "/mail/prullenbak" && request.method === "POST")
        return reply(200, await mailNaarPrullenbak(env, adres, String(b.id || ""), String(b.sleutel || "")));

      return reply(404, { ok: false, error: "onbekende-mailroute" });
    }

    /* De commercial invoice en packing list van een schip. Opslaan mag met de
       teamsleutel: wie de tegel Voorraadbeheer mag openen, uploadt daar toch
       al commercial invoices. Ophalen gaat langs dezelfde sleutel. */
    if (url.pathname === "/voorraad/schip/bestand" && request.method === "PUT") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      return schipZetBestand(request, env, url);
    }
    if (url.pathname === "/voorraad/schip/bestand" && request.method === "GET") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      return schipGeefBestand(env, url);
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

    if (url.pathname === "/bank/openstaand-crediteuren" && request.method === "POST") {
      if ((request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return reply(401, { ok: false });
      const body = await request.json().catch(() => ({}));
      return reply(200, await bankOpenstaandCrediteuren(env, !!body.vers).catch(e => ({ ok: false, error: String(e.message || e) })));
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
        const dg = await bankDagboeken(env);
        // Het scherm mag ook weten wat er al is uitgezocht: welk dagboek het
        // memoriaal is, zodat het dat niet nog een keer hoeft te vragen.
        const inst = (await env.FONTEYN_DATA.get("bank-instellingen", { type: "json" })) || {};
        return reply(200, { ...dg, memBookingId: inst.memBookingId || null, memNaam: inst.memNaam || "",
                            memKeuze: inst.memKeuze || null,
                            tegenrekeningCode: inst.tegenrekeningCode || "" });
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
      /* Van een specificatiesheet blijft de vorige versie bewaard.

         Aanleiding: de sheets Pleasure en Desire van Demi bleken op 12 aug
         2026 leeg in de opslag te staan - een record van twee tekens. Er was
         geen enkele manier om terug te kijken wat erin stond, dus dat werk is
         weg. Een sheet is een halve dag werk aan foto's en specificaties; dan
         hoort er meer nodig te zijn dan één misser om hem kwijt te raken.

         Alleen voor de sheets zelf, niet voor de -vorige-sleutel (anders krijg
         je een keten), en alleen als er nu iets van betekenis staat: een lege
         of piepkleine inhoud overschrijft de vorige versie niet. Juist dán wil
         je er nog bij kunnen. */
      if (/^specsheet-[a-z0-9]{4,24}$/.test(bucket)) {
        try {
          const vorige = await env.FONTEYN_DATA.get(bucket, { type: "text" });
          if (vorige && vorige.length > 200) await env.FONTEYN_DATA.put(bucket + "-vorige", vorige);
        } catch (e) { /* backup mag het opslaan nooit tegenhouden */ }
      }
      await env.FONTEYN_DATA.put(bucket, body);
      return reply(200, { ok: true, bytes: body.length });
    }

    return reply(405, "Method not allowed");
  },
};
