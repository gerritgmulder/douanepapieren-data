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

// POST /dealers/login  { email }
async function dpHandleLogin(request, env, url) {
  let body = {};
  try { body = await request.json(); } catch {}
  const email = String(body.email || "").trim().toLowerCase();
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
  await dpSendEmail(env, email, "Your Fonteyn Dealer Portal login link",
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">' +
    '<h2 style="color:#144734;">Fonteyn Dealer Portal</h2>' +
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
  const sess = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
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

// GET /dealers/api/stock — geaggregeerd per model, dealer-veilig
async function dpHandleStock(env) {
  const agg = await dpStockModels(env);
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
    const price = Number((priceData.prices || {})[model]);
    if (price > 0) {
      const deposit = Math.round(price * qty * 0.30 * 100) / 100;
      const pay = await dpCreateMolliePayment(env, deposit,
        "30% deposit — " + qty + "x " + model + " (" + (sess.company || sess.email) + ")",
        url.origin + "/dealers?paid=1",
        url.origin + "/dealers/webhook",
        { requestId: entry.id });
      if (pay.ok) {
        entry.deposit = deposit;
        entry.paymentId = pay.id;
        entry.paymentStatus = "open";
        checkoutUrl = pay.checkoutUrl;
      }
    }
  }
  data.requests.push(entry);
  await env.FONTEYN_DATA.put("dealer-requests", JSON.stringify(data));
  const accounts = await dpGetAccounts(env);
  const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  await dpSendEmail(env, accounts.contactEmail || "gerrit@fonteyn.nl",
    "[Dealerportaal] Reservering: " + qty + "x " + model + " — " + (sess.company || sess.email),
    '<div style="font-family:Arial,sans-serif;">' +
    '<p><b>Nieuwe reserveringsaanvraag via het dealerportaal</b></p>' +
    '<p><b>Dealer:</b> ' + esc(sess.company || "") + ' &lt;' + esc(sess.email) + '&gt;<br>' +
    '<b>Model:</b> ' + esc(model) + '<br><b>Aantal:</b> ' + qty +
    (entry.deposit ? '<br><b>Aanbetaling (30%):</b> € ' + entry.deposit.toFixed(2) + ' — Mollie-link naar dealer gestuurd' : '') + '</p>' +
    (note ? '<p style="white-space:pre-wrap;border-left:3px solid #8bc53f;padding-left:12px;">' + esc(note) + '</p>' : '') +
    '<p style="color:#888;font-size:12px;">Ook zichtbaar in de beheertegel Dealerportaal. Reply gaat direct naar de dealer.</p></div>',
    sess.email);
  return reply(200, { ok: true, checkoutUrl: checkoutUrl, deposit: entry.deposit || null });
}

// Fase 3 — Mollie-betaallink (wacht op MOLLIE_API_KEY als worker-secret).
// Zodra de key er is: aanroepen vanuit de reserve-flow met het aanbetalings-
// bedrag, checkoutUrl teruggeven aan het portaal, en een /dealers/webhook
// route toevoegen voor de betaalstatus.
async function dpCreateMolliePayment(env, amountEur, description, redirectUrl, webhookUrl, metadata) {
  if (!env.MOLLIE_API_KEY) return { ok: false, error: "mollie-not-configured" };
  const payload = {
    amount: { currency: "EUR", value: Number(amountEur).toFixed(2) },
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
    "[Dealerportaal] " + subject + " — " + (sess.company || sess.email),
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
    return reply(404, "Not found");
  }

  // Alles hieronder vereist een geldige dealer-sessie
  if (p.startsWith("/dealers/api/")) {
    const sess = await dpSession(env, request);
    if (!sess) return reply(401, { ok: false, error: "not-logged-in" });
    if (p === "/dealers/api/me" && request.method === "GET") return reply(200, { ok: true, email: sess.email, company: sess.company || "" });
    if (p === "/dealers/api/logout" && request.method === "POST") {
      // Sessie ook server-side weggooien — localStorage wissen alleen liet
      // het token 30 dagen bruikbaar in KV staan.
      const tok = request.headers.get("X-Dealer-Session") || "";
      if (tok) await env.FONTEYN_DATA.delete("dp-sess:" + tok);
      return reply(200, { ok: true });
    }
    if (p === "/dealers/api/stock" && request.method === "GET") return dpHandleStock(env);
    if (p === "/dealers/api/myspas" && request.method === "GET") return dpHandleMySpas(env, sess);
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
