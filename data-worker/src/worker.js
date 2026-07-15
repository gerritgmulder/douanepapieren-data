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
  await dpSendEmail(env, email, "Your Fonteyn Partner Portal login link",
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">' +
    '<h2 style="color:#144734;">Fonteyn Partner Portal</h2>' +
    '<p>Hello ' + (dealer.company ? dealer.company : "") + ',</p>' +
    '<p>Click the button below to log in. This link is valid for 15 minutes.</p>' +
    '<p style="margin:26px 0;"><a href="' + link + '" ' +
    'style="background:#8bc53f;color:#144734;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:10px;display:inline-block;">Log in to the portal</a></p>' +
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

// Voorraad-status per container (zelfde regels als de interne pipeline-tab)
function dpContainerStatus(c, now) {
  const eta = c.eta ? new Date(c.eta) : null;
  const besteld = c.besteld ? new Date(c.besteld) : null;
  const W = 7 * 86400000;
  if (eta && !isNaN(eta)) {
    if (now >= eta) return "nl";
    if (now >= new Date(eta.getTime() - 5.5 * W)) return "ship";
    return "prod";
  }
  if (besteld && !isNaN(besteld)) {
    if (now >= new Date(besteld.getTime() + 13.5 * W)) return "nl";
    if (now >= new Date(besteld.getTime() + 8 * W)) return "ship";
    return "prod";
  }
  return "prod";
}

// Voorraad-aggregatie per model (dealer-veilig) — gedeeld door /stock en /myspas
async function dpStockModels(env) {
  const pipe = await env.FONTEYN_DATA.get("voorraad-pipeline", { type: "json" });
  const containers = (pipe && pipe.containers) || [];
  const now = new Date();
  const byModel = {};
  for (const c of containers) {
    const st = dpContainerStatus(c, now);
    const eta = c.eta || null;
    for (const l of (c.lines || [])) {
      if (!l.model) continue;
      const model = String(l.model).trim();
      const free = Math.max(0, (Number(l.qty) || 0) - (Number(l.reserved) || 0));
      if (!byModel[model]) byModel[model] = { model, available: 0, onTheWater: 0, inProduction: 0, nextEta: null };
      if (st === "nl") byModel[model].available += free;
      else if (st === "ship") byModel[model].onTheWater += free;
      else byModel[model].inProduction += free;
      if (free > 0 && st !== "nl" && eta) {
        if (!byModel[model].nextEta || eta < byModel[model].nextEta) byModel[model].nextEta = eta;
      }
    }
  }
  const models = Object.values(byModel).sort((a, b) =>
    (b.available - a.available) || String(a.model).localeCompare(String(b.model)));
  return { updated: (pipe && pipe.lastUpdated) || null, models };
}

// GET /dealers/api/stock — geaggregeerd per model, dealer-veilig, mét
// partnerprijs ($ + Freight Surcharge Warehouse Uddel) uit de prijslijst
async function dpHandleStock(env) {
  const agg = await dpStockModels(env);
  const priceData = (await env.FONTEYN_DATA.get("dealer-prices", { type: "json" })) || {};
  const prices = priceData.prices || {};
  for (const m of agg.models) {
    const p = prices[m.model];
    if (p && typeof p === "object" && Number(p.usd) > 0) {
      m.partnerUsd = Number(p.usd);
      m.surchargeUsd = Number(p.surcharge) || 0;
      m.retailEur = Number(p.retailEur) || null;
    }
  }
  return reply(200, { ok: true, updated: agg.updated, models: agg.models });
}

// GET /dealers/api/myspas — fase 2: de eigen reserveringen van deze dealer.
// Koppeling: debtorIds op het dealer-account (beheertegel) ↔ debtorId in de
// Voorraadbeheer-reserveringen (bucket 'voorraad'). Alleen eigen data.
async function dpHandleMySpas(env, sess) {
  const accounts = await dpGetAccounts(env);
  const dealer = dpFindDealer(accounts, sess.email);
  const debtorIds = new Set(((dealer && dealer.debtorIds) || []).map(String).filter(Boolean));
  if (!debtorIds.size) return reply(200, { ok: true, linked: false, spas: [] });
  const voorraad = await env.FONTEYN_DATA.get("voorraad", { type: "json" });
  const resv = (voorraad && voorraad.reserveringen) || {};
  const agg = await dpStockModels(env);
  const modelInfo = {};
  for (const m of agg.models) modelInfo[m.model] = m;
  const spas = [];
  for (const k in resv) {
    const r = resv[k];
    if (!r || !debtorIds.has(String(r.debtorId))) continue;
    const mi = modelInfo[String(r.model || "").trim()] || null;
    spas.push({
      ordernr: r.ordernr, date: r.datum, model: r.model,
      description: r.omschrijving, qty: r.aantal, advisor: r.adviseur || "",
      modelAvailable: mi ? mi.available : null,
      modelNextEta: mi ? mi.nextEta : null,
    });
  }
  spas.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return reply(200, { ok: true, linked: true, spas });
}

// ─── Voorraad claimen/vrijgeven bij reserveringen ────────────────────
// Claim gebeurt zodra de betaallink is aangemaakt (niet pas na betaling),
// zodat twee dealers nooit dezelfde spa kunnen reserveren. Verloopt of
// mislukt de betaling, dan geeft de webhook de claim automatisch weer vrij.
async function dpClaimStock(env, model, qty) {
  const pipe = await env.FONTEYN_DATA.get("voorraad-pipeline", { type: "json" });
  if (!pipe || !Array.isArray(pipe.containers)) return null;
  const now = new Date();
  const cand = [];
  for (const c of pipe.containers) for (const l of (c.lines || [])) {
    if (String(l.model || "").trim() !== model) continue;
    const free = Math.max(0, (Number(l.qty) || 0) - (Number(l.reserved) || 0));
    if (free > 0) cand.push({ c, l, free, st: dpContainerStatus(c, now) });
  }
  // Voorkeur: eerst voorraad in NL, dan onderweg, dan productie; binnen
  // gelijke status de vroegste ETA.
  const rank = { nl: 0, ship: 1, prod: 2 };
  cand.sort((a, b) => (rank[a.st] - rank[b.st]) || String(a.c.eta || "9999").localeCompare(String(b.c.eta || "9999")));
  let need = Number(qty) || 1;
  const lines = [];
  for (const x of cand) {
    if (need <= 0) break;
    const take = Math.min(need, x.free);
    x.l.reserved = (Number(x.l.reserved) || 0) + take;
    lines.push({ container: x.c.nr, take });
    need -= take;
  }
  if (!lines.length) return null;   // geen vrije voorraad — aanvraag gaat door, sales lost op
  pipe.lastUpdated = new Date().toISOString();
  await env.FONTEYN_DATA.put("voorraad-pipeline", JSON.stringify(pipe));
  return { model, requested: Number(qty) || 1, lines, partial: need > 0 };
}

async function dpReleaseStock(env, allocation) {
  if (!allocation || !Array.isArray(allocation.lines)) return;
  const pipe = await env.FONTEYN_DATA.get("voorraad-pipeline", { type: "json" });
  if (!pipe || !Array.isArray(pipe.containers)) return;
  for (const a of allocation.lines) {
    const c = pipe.containers.find(x => x.nr === a.container);
    const l = c && (c.lines || []).find(x => String(x.model || "").trim() === allocation.model);
    if (l) l.reserved = Math.max(0, (Number(l.reserved) || 0) - a.take);
  }
  pipe.lastUpdated = new Date().toISOString();
  await env.FONTEYN_DATA.put("voorraad-pipeline", JSON.stringify(pipe));
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
  if (!model) return reply(400, { ok: false, error: "model-required" });
  const data = (await env.FONTEYN_DATA.get("dealer-requests", { type: "json" })) || {};
  if (!Array.isArray(data.requests)) data.requests = [];
  const entry = {
    id: crypto.randomUUID(), ts: new Date().toISOString(),
    email: sess.email, company: sess.company || "",
    model, qty, note, status: "new",
  };
  // Fase 3: is Mollie geconfigureerd én is er een dealerprijs voor dit model?
  // → maak direct een 30%-aanbetalingslink (jouw flow: verkocht = 30% aanbetaald).
  let checkoutUrl = null;
  if (env.MOLLIE_API_KEY) {
    const priceData = (await env.FONTEYN_DATA.get("dealer-prices", { type: "json" })) || {};
    // Prijslijst 2026: {usd, surcharge (Freight Surcharge Warehouse Uddel), code?}
    // — aanbetaling ALTIJD op basis van de dollarprijs (afspraak Gerrit 15 jul).
    // Oude vormen ({price} in EUR of kaal getal) blijven werken als terugval.
    const pEntry = (priceData.prices || {})[model];
    let unit = 0, currency = "EUR";
    if (pEntry && typeof pEntry === "object") {
      if (Number(pEntry.usd) > 0) { unit = Number(pEntry.usd) + (Number(pEntry.surcharge) || 0); currency = "USD"; }
      else if (Number(pEntry.price) > 0) unit = Number(pEntry.price);
      if (pEntry.code) entry.productCode = String(pEntry.code);
    } else if (Number(pEntry) > 0) unit = Number(pEntry);
    if (unit > 0) {
      const deposit = Math.round(unit * qty * 0.30 * 100) / 100;
      entry.currency = currency;
      const pay = await dpCreateMolliePayment(env, deposit,
        "30% deposit — " + qty + "x " + model + " (" + (sess.company || sess.email) + ")",
        url.origin + "/dealers?paid=1",
        url.origin + "/dealers/webhook",
        { requestId: entry.id }, currency);
      if (pay.ok) {
        entry.deposit = deposit;
        entry.paymentId = pay.id;
        entry.paymentStatus = "open";
        checkoutUrl = pay.checkoutUrl;
        // Voorraad direct claimen zodat niemand anders dezelfde spa reserveert
        entry.allocation = await dpClaimStock(env, model, qty);
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
  return reply(200, { ok: true, checkoutUrl: checkoutUrl, deposit: entry.deposit || null, currency: entry.currency || null });
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
    OrderStatus: { Id: 25 },                         // 30% aanbetaald
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
      if (["expired", "canceled", "failed"].includes(p.status) && item.allocation && !item.allocationReleased) {
        await dpReleaseStock(env, item.allocation);
        item.allocationReleased = true;
      }
      // Aanbetaling binnen → automatisch verkooporder (status 25) in Logic4,
      // onder het debiteurnummer van de dealer. Idempotent: nooit dubbel.
      if (p.status === "paid" && !item.logic4OrderId) {
        try {
          const accounts = await dpGetAccounts(env);
          const dealer = dpFindDealer(accounts, item.email);
          const debtorId = dealer && (dealer.debtorIds || [])[0];
          if (!debtorId) {
            item.logic4Error = "geen debtorId gekoppeld aan dealer-account " + item.email;
          } else {
            const res = await dpCreateLogic4Order(env, {
              debtorId, qty: item.qty, productCode: item.productCode || null,
              reference: "DP-" + String(item.id).slice(0, 8),
              remarks: "Partnerportaal-reservering — 30% aanbetaald: " + (item.currency === "USD" ? "$" : "€") + " " + (item.deposit || 0).toFixed(2) + " (Mollie " + p.id + ")" + (item.note ? "\nNotitie dealer: " + item.note : ""),
              description: item.qty + "x " + item.model + " — partnerportaal (30% aanbetaald via Mollie)",
            });
            if (res.ok) { item.logic4OrderId = res.orderId; delete item.logic4Error; }
            else item.logic4Error = res.error;
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
    return reply(404, "Not found");
  }

  // Alles hieronder vereist een geldige dealer-sessie
  if (p.startsWith("/dealers/api/")) {
    const sess = await dpSession(env, request);
    if (!sess) return reply(401, { ok: false, error: "not-logged-in" });
    if (p === "/dealers/api/me" && request.method === "GET") {
      const accounts = await dpGetAccounts(env);
      const dealer = dpFindDealer(accounts, sess.email);
      return reply(200, { ok: true, email: sess.email, company: sess.company || "", hasPassword: !!(dealer && dealer.pw) });
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Team-sleutel voor medewerkers (Logic4-login als bewijs)
    if (url.pathname === "/internal/teamkey" && request.method === "POST") {
      return handleTeamKey(request, env);
    }

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
