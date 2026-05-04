// Cloudflare Worker — proxy voor AirBnB iCal-feeds
//
// Doel: AirBnB stuurt geen Access-Control-Allow-Origin header op
// /calendar/ical/* endpoints. Daardoor kan eikensingel.html het iCal-bestand
// niet rechtstreeks vanuit de browser ophalen. Deze worker draait op
// Cloudflare's edge (= geen browser, dus geen CORS), fetcht de iCal en
// stuurt 'm terug mét de juiste CORS-header zodat de browser hem wel mag
// lezen.
//
// Beveiliging: alleen www.airbnb.nl en www.airbnb.com zijn whitelisted, en
// alleen het /calendar/ical/* path. Daarmee kan deze worker NIET als open
// proxy gebruikt worden voor andere URLs.

const ALLOWED_HOSTS = new Set(["www.airbnb.nl", "www.airbnb.com"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function reply(status, body, extraHeaders = {}) {
  return new Response(body, { status, headers: { ...corsHeaders, ...extraHeaders } });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return reply(204, null);
    if (request.method !== "GET")     return reply(405, "Method not allowed");

    const url = new URL(request.url);
    const target = url.searchParams.get("url");
    if (!target) return reply(400, "Missing 'url' query param");

    let parsed;
    try { parsed = new URL(target); }
    catch { return reply(400, "Invalid URL"); }

    if (parsed.protocol !== "https:")           return reply(400, "Only https targets allowed");
    if (!ALLOWED_HOSTS.has(parsed.hostname))    return reply(403, `Host '${parsed.hostname}' not whitelisted`);
    if (!parsed.pathname.startsWith("/calendar/ical/")) return reply(403, "Path must start with /calendar/ical/");

    let upstream;
    try {
      upstream = await fetch(parsed.toString(), {
        method: "GET",
        // AirBnB blokkeert sommige user-agents; netjes en herkenbaar:
        headers: { "User-Agent": "fonteyn-airbnb-proxy/1.0 (+https://github.com/gerritgmulder/douanepapieren-data)" },
        cf: { cacheTtl: 60, cacheEverything: true }, // 1 min edge-cache, scheelt duplicate fetches
      });
    } catch (e) {
      return reply(502, `Upstream fetch failed: ${e.message}`);
    }

    const text = await upstream.text();
    return reply(upstream.status, text, {
      "Content-Type": upstream.headers.get("Content-Type") || "text/calendar; charset=utf-8",
    });
  },
};
