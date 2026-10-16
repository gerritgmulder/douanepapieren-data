/* ═══════════════════════════════════════════════════════════════════════════
   ORDER PICKEN - offline-helper (service worker)
   ═══════════════════════════════════════════════════════════════════════════

   Gerrit (16 okt 2026): in het magazijn is weinig tot geen bereik, dus de
   tegel Order picken moet ook zonder verbinding openen en werken. Deze helper
   bewaart de pagina en zijn scripts op de telefoon. Hij geldt alleen voor
   orderpicken.html (scope ./orderpicken), niet voor de andere tegels.

   Altijd eerst het netwerk, zodat een nieuwe versie meteen binnenkomt; pas
   als dat mislukt de bewaarde versie. De gegevens zelf (picklijsten, scans)
   bewaart de tegel in de opslag van de telefoon en stuurt ze door zodra er
   weer verbinding is; die lopen hier niet langs.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */
var BAK = "fp-orderpicken-v1";
var MAP = self.location.pathname.replace(/[^/]*$/, "");   // /m/ op de telefoon, / op de pc

self.addEventListener("install", function (e) { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

function bewaren(url) {
  if (url.origin === self.location.origin) return url.pathname.indexOf(MAP) === 0;
  return /(^|\.)cdn\.jsdelivr\.net$|^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
}
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (!bewaren(url)) return;
  // De pagina vraagt zichzelf soms op met ?t=...; bewaar en zoek zonder.
  var sleutel = url.origin + url.pathname;
  e.respondWith(
    fetch(req).then(function (r) {
      if (r && (r.ok || r.type === "opaque")) {
        var kopie = r.clone();
        caches.open(BAK).then(function (c) { c.put(sleutel, kopie); });
      }
      return r;
    }).catch(function () {
      return caches.open(BAK).then(function (c) { return c.match(sleutel); }).then(function (x) {
        return x || new Response("Zonder verbinding en nog niet bewaard.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      });
    })
  );
});
