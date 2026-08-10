/* ═══════════════════════════════════════════════════════════════════════════
   SPA-AFMETINGEN - hoe groot is een model, en waar komt dat vandaan
   ═══════════════════════════════════════════════════════════════════════════

   Waarom
   ------
   De maten van de spa's staan op twee plekken, en tot 10 aug 2026 gebruikte
   elke tegel er maar één van:

   1. De prijslijsten van de fabrieken (spa-fabrikanten.js, veld 'afmeting',
      in millimeters). Die maat is leidend: de fabriek laadt de container en
      rekent met zijn eigen getal.
   2. De specificatiesheets (spec-database.json, veld 'dims', in centimeters).
      Daar staan de modellen die niet op een prijslijst staan - de ijsbaden,
      de Grizzly Spas, de Devine Spas en de Storm Spas.

   Met alleen bron 1 was van 69 van de 149 modellen de maat onbekend. Met
   allebei zijn het er nog 31. Dat verschil is niet cosmetisch: zonder maat
   telt een spa niet mee in het containervolume, en dan wordt de schatting van
   het aantal containers te laag.

   Waarom de prijslijst wint bij een verschil
   ------------------------------------------
   Bij zestien modellen die in allebei staan schelen de maten een paar
   centimeter (Euphoria 228x228x86 tegen 230x230x91, Heart 202x169x78 tegen
   210x170x78). Die verschillen worden niet gladgestreken: de prijslijst gaat
   voor, en wie het navraagt kan zien welke bron gebruikt is.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  // De specsheets noemen de modellen met hun merk ervoor ("Grizzly Spas
  // Kenai", "Wim Hof's Ice Barrel"). Die aanloop gaat eraf zodat de kale naam
  // overblijft en op de prijslijst-naam past.
  var VOORVOEGSEL = /^(spec ?sheets? |grizzly spas |devine spas |storm spas |eden spas |tropical spas sheets |wim hof.?s ice |the |spa )/i;

  function sleutel(s) {
    var t = String(s || "").toLowerCase().trim().replace(/\s*spec ?sheets?\s*$/, "");
    for (var i = 0; i < 4; i++) {
      var n = t.replace(VOORVOEGSEL, "");
      if (n === t) break;
      t = n;
    }
    return t.replace(/[^a-z0-9]/g, "");
  }

  /* Namen die niet vanzelf op elkaar vallen. Elke regel is een vaststelling en
     geen gok:
     - de vijf Revive-kleuren zijn hetzelfde bad in een andere kleur;
     - Elevate en Vital Ice staan onder twee namen omdat ze via twee
       leveranciers binnenkomen (Jazzi in dollars, Innerfire in euro's). */
  var HANDMATIG = {
    wimhofbarrel:      "Wim Hof's Ice Barrel",
    breezeicebath:     "Wim Hof's Ice Breeze",
    elevateicebath:    "Wim Hof's Ice Elevate",
    vitaliceicebath:   "Team Ice Vital Ice",
    revivemossstone:   "Wim Hof's Ice Revive",
    reviveearthgrey:   "Wim Hof's Ice Revive",
    revivegranitegrey: "Wim Hof's Ice Revive",
    reviveiceblue:     "Wim Hof's Ice Revive",
    reviveblackmarble: "Wim Hof's Ice Revive",
  };

  var index = null;   // null = de specsheets zijn nog niet geladen

  function bouwIndex(db) {
    var uit = {};
    for (var k in (db || {})) {
      if (!Object.prototype.hasOwnProperty.call(db, k)) continue;
      var d = db[k] && db[k].dims;
      if (!d) continue;
      var p = (String(d).match(/[\d.]+/g) || []).map(Number);
      if (p.length !== 3) continue;
      var goed = true;
      for (var i = 0; i < 3; i++) if (!(p[i] > 0)) goed = false;
      if (!goed) continue;
      var n = sleutel(k);
      if (!uit[n]) uit[n] = { l: p[0], b: p[1], h: p[2], sheet: k };
    }
    return uit;
  }

  function zet(db) { index = bouwIndex(db); return aantal(); }
  function aantal() { return index ? Object.keys(index).length : 0; }
  function geladen() { return index !== null; }

  // De specsheets ophalen. Faalt dat, dan blijft de index leeg en werkt alles
  // gewoon door op alleen de prijslijsten - er gaat dus nooit iets stuk.
  function laad() {
    if (index) return Promise.resolve(aantal());
    if (typeof fetch !== "function") { index = {}; return Promise.resolve(0); }
    return fetch("/spec-database.json")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { return zet(j); })
      .catch(function (e) {
        console.warn("specificatiesheets laden faalde:", e.message);
        index = {};
        return 0;
      });
  }

  function uitSpecsheet(model) {
    if (!index) return null;
    var n = sleutel(model);
    var via = HANDMATIG[n];
    var hit = via ? index[sleutel(via)] : index[n];
    return hit ? { l: hit.l, b: hit.b, h: hit.h, bron: "specsheet", sheet: hit.sheet } : null;
  }

  /* De maat van één model, in CENTIMETERS.
     afmetingMm is het veld 'afmeting' van de prijslijst ("3940x2260x1260",
     millimeters). Staat die er, dan wint hij. Anders de specsheet. */
  function maatVan(model, afmetingMm) {
    var p = String(afmetingMm || "").split("x").map(Number);
    if (p.length === 3 && p[0] > 0 && p[1] > 0 && p[2] > 0) {
      return { l: p[0] / 10, b: p[1] / 10, h: p[2] / 10, bron: "prijslijst", sheet: null };
    }
    return uitSpecsheet(model);
  }

  function m3Van(model, afmetingMm) {
    var m = maatVan(model, afmetingMm);
    return m ? (m.l / 100) * (m.b / 100) * (m.h / 100) : null;
  }

  var API = {
    laad: laad, zet: zet, geladen: geladen, aantal: aantal,
    maatVan: maatVan, m3Van: m3Van, sleutel: sleutel,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.fpAfmetingen = API;

})(typeof window !== "undefined" ? window : globalThis);
