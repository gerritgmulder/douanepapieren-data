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
  "Access-Control-Allow-Headers": "Content-Type, X-Fonteyn-Auth",
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

// ─── SMS-verificatie (Twilio) — voor de UK sign-in kiosk ────────────
// Secrets (via `wrangler secret put <NAAM>`):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
// Zonder die secrets antwoordt /sms/send met sms-not-configured en
// slaat de kiosk de verificatie-stap gracieus over.
async function sendSms(env, to, body) {
  const sid = env.TWILIO_ACCOUNT_SID, tok = env.TWILIO_AUTH_TOKEN, from = env.TWILIO_FROM;
  if (!sid || !tok || !from) return { ok: false, error: "sms-not-configured" };
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(sid + ":" + tok),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: "twilio-error: " + t.slice(0, 200) };
  }
  return { ok: true };
}

function randomCode() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000)); // 6 cijfers, nooit leading zero
}

async function handleSms(request, env, url) {
  // Zelfde auth als /data/* — de kiosk-HTML heeft het shared secret.
  const authHeader = request.headers.get("X-Fonteyn-Auth") || "";
  if (!env.SHARED_SECRET || authHeader !== env.SHARED_SECRET) {
    return reply(401, "Unauthorized");
  }
  if (request.method !== "POST") return reply(405, "Method not allowed");
  let body;
  try { body = await request.json(); } catch { return reply(400, { ok: false, error: "invalid-json" }); }
  const phone = String(body.phone || "").trim();
  if (!/^\+\d{8,15}$/.test(phone)) {
    return reply(400, { ok: false, error: "invalid-phone" });
  }

  if (url.pathname === "/sms/send") {
    // Rate-limit: max 3 sends per nummer per 10 minuten
    const rlKey = "smsrl-" + phone;
    const count = parseInt(await env.FONTEYN_DATA.get(rlKey) || "0", 10);
    if (count >= 3) return reply(429, { ok: false, error: "too-many-requests" });
    await env.FONTEYN_DATA.put(rlKey, String(count + 1), { expirationTtl: 600 });

    const code = randomCode();
    await env.FONTEYN_DATA.put("smscode-" + phone, JSON.stringify({ code, attempts: 0 }), { expirationTtl: 600 });
    const name = String(body.name || "").slice(0, 40);
    const sent = await sendSms(env, phone,
      `Fonteyn: Hi ${name || "there"}, your sign-in verification code is ${code}. It expires in 10 minutes.`);
    if (!sent.ok) return reply(200, sent); // sms-not-configured of twilio-error → client beslist
    return reply(200, { ok: true });
  }

  if (url.pathname === "/sms/check") {
    const rec = await env.FONTEYN_DATA.get("smscode-" + phone, { type: "json" });
    if (!rec) return reply(200, { ok: false, error: "code-expired" });
    if (rec.attempts >= 5) {
      await env.FONTEYN_DATA.delete("smscode-" + phone);
      return reply(200, { ok: false, error: "too-many-attempts" });
    }
    if (String(body.code || "").trim() !== rec.code) {
      rec.attempts++;
      await env.FONTEYN_DATA.put("smscode-" + phone, JSON.stringify(rec), { expirationTtl: 600 });
      return reply(200, { ok: false, error: "wrong-code", attemptsLeft: 5 - rec.attempts });
    }
    await env.FONTEYN_DATA.delete("smscode-" + phone);
    return reply(200, { ok: true, verified: true });
  }

  return reply(404, "Not found");
}

// ─── Kiosk-pagina serveren — UK heeft geen Logic4/Electron ──────────
// GET /signin?key=<KIOSK_KEY> haalt signin.html van GitHub main en
// serveert 'm als HTML. De UK-tablet opent deze URL in een gewone
// browser (bookmark incl. key). Push naar main = binnen ~1 min live.
async function handleKioskPage(request, env, url) {
  const key = url.searchParams.get("key") || "";
  if (!env.KIOSK_KEY || key !== env.KIOSK_KEY) {
    return new Response("<h1>403</h1><p>Missing or wrong kiosk key.</p>",
      { status: 403, headers: { "Content-Type": "text/html" } });
  }
  // Tijd-gebaseerde cache-bust (verandert elke 10s) zodat de kiosk altijd
  // automatisch de nieuwste signin.html krijgt — de bezoeker/gebruiker
  // hoeft NIETS aan de URL toe te voegen. Zonder dit blijft GitHub's CDN
  // een oude versie serveren.
  const cb = Math.floor(Date.now() / 10000);
  const src = await fetch(
    "https://raw.githubusercontent.com/gerritgmulder/douanepapieren-data/main/signin.html?cb=" + cb,
    { cf: { cacheTtl: 10, cacheEverything: true } }
  );
  if (!src.ok) {
    return new Response("<h1>502</h1><p>Could not load page from GitHub.</p>",
      { status: 502, headers: { "Content-Type": "text/html" } });
  }
  const html = await src.text();
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// ─── Visit-tracking endpoint (QR-scan) ─────────────────────────────
// GET /v?id=<visitId>&m=<signin-YYYY-MM>
// Geen auth (publiek; door de bezoeker z'n telefoon geopend). Legt
// IP/UA/geo/tijd vast bij de sign-in en redirect naar de Fonteyn-site.
// Open-redirect-veilig: de bestemming staat server-side vast (env of
// default), niet in de URL.
async function handleVisitTrack(request, env, url) {
  const id = url.searchParams.get("id") || "";
  const m = (url.searchParams.get("m") || "").toLowerCase();

  // Bestemming: env.KIOSK_REDIRECT_URL of een veilige default.
  const dest = env.KIOSK_REDIRECT_URL || "https://www.fonteyn.co.uk/";
  let redirect;
  try { redirect = new URL(dest); } catch { redirect = new URL("https://www.fonteyn.co.uk/"); }
  redirect.searchParams.set("utm_source", "showroom");
  redirect.searchParams.set("utm_medium", "qr");
  redirect.searchParams.set("utm_campaign", "signin");
  if (id) redirect.searchParams.set("fv", id);

  // Bezoek vastleggen bij de sign-in (best-effort; faalt het, dan nog redirect).
  if (id && /^signin-\d{4}-\d{2}$/.test(m)) {
    try {
      const data = await env.FONTEYN_DATA.get(m, { type: "json" });
      if (data && Array.isArray(data.entries)) {
        const entry = data.entries.find(e => e.id === id);
        if (entry) {
          const cf = request.cf || {};
          const prev = entry.track || {};
          entry.track = {
            ip: request.headers.get("CF-Connecting-IP") || "",
            ua: (request.headers.get("User-Agent") || "").slice(0, 300),
            country: cf.country || "",
            region: cf.region || "",
            city: cf.city || "",
            ts: new Date().toISOString(),
            scans: (prev.scans || 0) + 1,
          };
          await env.FONTEYN_DATA.put(m, JSON.stringify(data));
        }
      }
    } catch (e) {
      // stil — bezoeker krijgt sowieso de redirect
    }
  }
  return Response.redirect(redirect.toString(), 302);
}

// ─── E-mailverificatie ─────────────────────────────────────────────
// POST /email/send  body { id, m, email, name }  (auth via X-Fonteyn-Auth)
//   → maakt een verify-token, slaat 't op bij de sign-in en mailt een
//     verificatielink via Resend. Zonder RESEND_API_KEY → email-not-configured.
// GET  /verify?id=..&m=..&t=..  (door de bezoeker geopend vanuit de mail)
//   → token checken, sign-in markeren als geverifieerd, IP/device/locatie/
//     tijd vastleggen, doorsturen naar de Fonteyn-site.
function randToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (a[i] + 256).toString(16).slice(1);
  return s;
}

async function sendEmail(env, to, subject, html) {
  const key = env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "email-not-configured" };
  const from = env.MAIL_FROM || "Fonteyn <onboarding@resend.dev>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: from, to: [to], subject: subject, html: html }),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: "mail-error: " + t.slice(0, 200) };
  }
  return { ok: true };
}

async function handleEmailSend(request, env) {
  const authHeader = request.headers.get("X-Fonteyn-Auth") || "";
  if (!env.SHARED_SECRET || authHeader !== env.SHARED_SECRET) return reply(401, "Unauthorized");
  if (request.method !== "POST") return reply(405, "Method not allowed");
  let body;
  try { body = await request.json(); } catch { return reply(400, { ok: false, error: "invalid-json" }); }
  const id = String(body.id || "");
  const m = String(body.m || "").toLowerCase();
  const email = String(body.email || "").trim();
  const name = String(body.name || "").slice(0, 60);
  if (!email || email.indexOf("@") < 1) return reply(400, { ok: false, error: "invalid-email" });
  if (!id || !/^signin-\d{4}-\d{2}$/.test(m)) return reply(400, { ok: false, error: "invalid-ref" });

  const token = randToken();
  try {
    const data = await env.FONTEYN_DATA.get(m, { type: "json" });
    if (data && Array.isArray(data.entries)) {
      const entry = data.entries.filter(function (e) { return e.id === id; })[0];
      if (entry) {
        entry.verifyToken = token;
        entry.emailSentAt = new Date().toISOString();
        await env.FONTEYN_DATA.put(m, JSON.stringify(data));
      }
    }
  } catch (e) { /* doorgaan; mail kan nog steeds */ }

  const base = new URL(request.url).origin;
  const link = base + "/verify?id=" + encodeURIComponent(id) + "&m=" + encodeURIComponent(m) + "&t=" + token;
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">' +
    '<h2 style="color:#144734;">Welcome to Fonteyn' + (name ? ", " + name.replace(/[<>]/g, "") : "") + '!</h2>' +
    '<p>Thanks for visiting our showroom. Please confirm your email address by clicking the button below.</p>' +
    '<p style="text-align:center;margin:28px 0;"><a href="' + link + '" ' +
    'style="background:#8bc53f;color:#144734;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:10px;display:inline-block;">Confirm my visit</a></p>' +
    '<p style="font-size:12px;color:#888;">If the button doesn\'t work, copy this link:<br>' + link + '</p>' +
    '</div>';
  const sent = await sendEmail(env, email, "Please confirm your visit to Fonteyn", html);
  return reply(200, sent);
}

async function handleVerify(request, env, url) {
  const id = url.searchParams.get("id") || "";
  const m = (url.searchParams.get("m") || "").toLowerCase();
  const t = url.searchParams.get("t") || "";

  const dest = env.KIOSK_REDIRECT_URL || "https://www.fonteyn.co.uk/";
  let redirect;
  try { redirect = new URL(dest); } catch (e) { redirect = new URL("https://www.fonteyn.co.uk/"); }
  redirect.searchParams.set("utm_source", "showroom");
  redirect.searchParams.set("utm_medium", "email");
  redirect.searchParams.set("utm_campaign", "signin");
  if (id) redirect.searchParams.set("fv", id);

  let okVerified = false;
  if (id && t && /^signin-\d{4}-\d{2}$/.test(m)) {
    try {
      const data = await env.FONTEYN_DATA.get(m, { type: "json" });
      if (data && Array.isArray(data.entries)) {
        const entry = data.entries.filter(function (e) { return e.id === id; })[0];
        if (entry && entry.verifyToken && entry.verifyToken === t) {
          const cf = request.cf || {};
          entry.emailVerified = true;
          entry.track = {
            ip: request.headers.get("CF-Connecting-IP") || "",
            ua: (request.headers.get("User-Agent") || "").slice(0, 300),
            country: cf.country || "", region: cf.region || "", city: cf.city || "",
            ts: new Date().toISOString(),
            via: "email",
          };
          entry.verifyToken = "";   // eenmalig
          await env.FONTEYN_DATA.put(m, JSON.stringify(data));
          okVerified = true;
        }
      }
    } catch (e) { /* val terug op een nette pagina */ }
  }

  // Eenvoudige bevestigingspagina (geen kale redirect — voelt betrouwbaarder
  // voor de bezoeker), met automatische doorklik naar de Fonteyn-site.
  const msg = okVerified
    ? "Your email is confirmed — thank you!"
    : "This link is invalid or has already been used.";
  const page =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="refresh" content="2;url=' + redirect.toString() + '">' +
    '<title>Fonteyn</title></head>' +
    '<body style="font-family:Arial,sans-serif;text-align:center;padding:48px 20px;color:#144734;">' +
    '<div style="font-size:48px;">' + (okVerified ? "&#9989;" : "&#9888;&#65039;") + '</div>' +
    '<h2>' + msg + '</h2>' +
    '<p style="color:#666;">Taking you to fonteyn.co.uk…</p>' +
    '<p><a href="' + redirect.toString() + '" style="color:#72a531;">Continue</a></p>' +
    '</body></html>';
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Kiosk-pagina (UK showroom, geen Logic4 nodig)
    if (url.pathname === "/signin") {
      return handleKioskPage(request, env, url);
    }

    // E-mailverificatie: mail versturen + verify-link (legt IP vast)
    if (url.pathname === "/email/send") {
      return handleEmailSend(request, env);
    }
    if (url.pathname === "/verify") {
      return handleVerify(request, env, url);
    }

    // SMS-verificatie endpoints (legacy — vervangen door QR /v, blijft werken)
    if (url.pathname === "/sms/send" || url.pathname === "/sms/check") {
      return handleSms(request, env, url);
    }

    // Visit-tracking: bezoeker scant de QR op de kiosk → opent dit op z'n
    // eigen telefoon. We leggen IP/device/locatie/tijd vast bij de sign-in
    // en sturen door naar de Fonteyn-site (UTM + fv-id) zodat web-analytics
    // het showroom-bezoek aan het surfgedrag koppelt.
    if (url.pathname === "/v") {
      return handleVisitTrack(request, env, url);
    }

    const m = url.pathname.match(/^\/data\/([a-z0-9_-]{2,40})\/?$/i);
    if (!m) return reply(404, "Not found");
    const bucket = m[1].toLowerCase();
    if (!ALLOWED_BUCKETS.has(bucket) && !ALLOWED_BUCKET_PATTERNS.some(re => re.test(bucket))) {
      return reply(403, `Bucket '${bucket}' not whitelisted`);
    }

    // Auth check via shared secret in header
    const authHeader = request.headers.get("X-Fonteyn-Auth") || "";
    const expected = env.SHARED_SECRET || "";
    if (!expected || authHeader !== expected) {
      return reply(401, "Unauthorized");
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
