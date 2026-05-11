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
  // Toekomstige modules toevoegen aan deze whitelist
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const m = url.pathname.match(/^\/data\/([a-z0-9_-]{2,40})\/?$/i);
    if (!m) return reply(404, "Not found");
    const bucket = m[1].toLowerCase();
    if (!ALLOWED_BUCKETS.has(bucket)) {
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
