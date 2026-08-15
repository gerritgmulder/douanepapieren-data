/* ═══════════════════════════════════════════════════════════════════════════
   BRUG — de tegels laten werken zonder het hulpprogramma van de pc
   ═══════════════════════════════════════════════════════════════════════════

   Op een pc draait naast het dashboard een klein hulpprogramma op poort 3737.
   De tegels vragen dat om de sessie, om artikelgegevens en om alles wat via
   Logic4 loopt. Buiten die pc bestaat het niet.

   Wat er dan gebeurde: een tegel vroeg /api/me, kreeg geen antwoord, en
   concludeerde dat de gebruiker niet meer ingelogd was. Vervolgens wíste hij
   de sessie en stuurde terug naar het dashboard. Daar was je nog wel ingelogd
   geweest, maar dat was net gewist - dus stond je weer op het inlogscherm.
   Opnieuw inloggen, tegel openen, en het begon van voren af aan.

   Deze brug vangt die aanroepen op voordat ze de deur uit gaan:

     /api/me      wordt beantwoord uit wat er bij het inloggen is bewaard.
                  Dat is precies wat de tegel wil weten en het staat er al.
     /api/health  zegt dat alles goed is; tegels gebruiken dit om te kijken
                  of het hulpprogramma leeft.
     /api/logout  laat de tegel gewoon uitloggen, dat is een lokale handeling.

   Al het andere achter /api/ krijgt netjes een 503 met uitleg. Dat is eerlijk:
   die gegevens zijn er op een telefoon niet. Maar het is géén 401, want dan
   zou een tegel opnieuw kunnen besluiten dat je uitgelogd bent, en dat is
   precies de lus die we hier weghalen.

   Wordt alleen ingeladen door de worker bij pagina's onder /m/. Op de pc komt
   dit bestand niet langs en verandert er niets.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";
  if (window.fpBrug) return;
  window.fpBrug = true;

  var echt = window.fetch.bind(window);
  var WORKER = "https://fonteyn-data-store.g-mulder.workers.dev";

  function antwoord(data, status) {
    return new Response(JSON.stringify(data), {
      status: status || 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  function pad(invoer) {
    try {
      var u = new URL(typeof invoer === "string" ? invoer : invoer.url, location.href);
      if (u.origin !== location.origin) return null;      // niet van ons, niet aankomen
      return u.pathname;
    } catch (e) { return null; }
  }

  window.fetch = function (invoer, opties) {
    var p = pad(invoer);
    if (!p || p.indexOf("/api/") !== 0) return echt(invoer, opties);

    if (p === "/api/me") {
      var email = "";
      try { email = localStorage.getItem("fp.email") || ""; } catch (e) {}
      if (!email) return antwoord({ ok: false, error: "niet-ingelogd" }, 401);
      return Promise.resolve(antwoord({ ok: true, user: { email: email } }));
    }

    if (p === "/api/health") {
      return Promise.resolve(antwoord({ ok: true, server: "mobiel-brug", version: "1" }));
    }

    if (p === "/api/logout") {
      return Promise.resolve(antwoord({ ok: true }));
    }

    /* Het doorgeefluik naar Logic4. Dit is verreweg de meest gebruikte
       aanroep - twintig plekken over alle tegels - en daarom de enige die
       hier niet wordt afgewezen maar doorgestuurd. De worker doet hem met
       het Logic4-token van deze gebruiker, dus met precies zijn eigen
       rechten, en laat alleen opvragen toe. Boeken en wijzigen blijft op de
       werkplek. */
    if (p === "/api/logic4-call") {
      var sleutel = "";
      try { sleutel = localStorage.getItem("fp.mailkey") || ""; } catch (e) {}
      if (!sleutel) {
        return Promise.resolve(antwoord({
          ok: false, error: "opnieuw-inloggen",
          message: "Log opnieuw in, dan kan het dashboard de gegevens weer ophalen.",
        }, 503));
      }
      return echt(WORKER + "/logic4/lees", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Fonteyn-Mail": sleutel },
        body: (opties && opties.body) || "{}",
      }).then(function (r) {
        /* Een 401 van de worker betekent hier "je Logic4-verbinding is
           verlopen", niet "je bent uitgelogd". Als 401 doorgegeven zou
           worden, gooit een tegel je sessie weg en sta je weer op het
           inlogscherm - precies wat deze brug moet voorkomen. */
        if (r.status === 401 || r.status === 403) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            return antwoord({ ok: false, error: j.error || "niet-beschikbaar",
                              message: j.uitleg || "" }, 503);
          });
        }
        return r;
      }).catch(function () {
        return antwoord({ ok: false, error: "geen-verbinding" }, 503);
      });
    }

    /* De rest bestaat hier echt niet. 503 en geen 401: bij een 401 besluit een
       tegel dat je bent uitgelogd en gooit hij je sessie weg. */
    return Promise.resolve(antwoord({
      ok: false,
      error: "niet-op-telefoon",
      message: "Dit onderdeel haalt zijn gegevens op bij het programma dat op de pc draait. " +
               "Op de telefoon is dat er niet.",
    }, 503));
  };
})();
