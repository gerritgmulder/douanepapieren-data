/* ═══════════════════════════════════════════════════════════════════════════
   SPA-AFMETINGEN - hoe groot is een model, en waar komt dat vandaan
   ═══════════════════════════════════════════════════════════════════════════

   Waarom
   ------
   De maten van de spa's staan op drie plekken, en tot 10 aug 2026 gebruikte
   elke tegel er maar één van:

   1. De prijslijsten van de fabrieken (spa-fabrikanten.js, veld 'afmeting',
      in millimeters). Die maat is leidend: de fabriek laadt de container en
      rekent met zijn eigen getal.
   2. De verpakkingslijst (packaging-database.json, uit 'Maten + gewichten.xlsx').
      Dat is de maat van de kist zoals hij vervoerd wordt, inclusief gewicht -
      voor laden eigenlijk het eerlijkste getal. Hier staan onder andere de
      vier barrelsauna's van Fonteyn in, die nergens anders een maat hebben.
   3. De specificatiesheets (spec-database.json, veld 'dims', in centimeters).
      Daar staan de modellen die niet op een prijslijst staan - de ijsbaden,
      de Grizzly Spas, de Devine Spas en de Storm Spas.

   Met alleen bron 1 was van 69 van de 149 modellen de maat onbekend. Met alle
   drie zijn het er nog 27. Dat verschil is niet cosmetisch: zonder maat telt
   een spa niet mee in het containervolume, en dan wordt de schatting van het
   aantal containers te laag.

   Een product in de verpakkingslijst met méér dan één kist wordt overgeslagen.
   Zo'n product gaat als losse kisten de container in en niet als één blok; die
   voor het gemak optellen zou een maat opleveren die nergens bestaat.

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

  /* De verpakkingslijst noemt de barrelsauna's korter dan de prijslijst.
     Handmatig gekoppeld; de maten en gewichten komen overeen met wat er op de
     pakbon staat, dus dit is een vaststelling en geen gok. */
  var PAKKET_HANDMATIG = {
    barrelsauna4ft:     "Barrel 4ft",
    barrelsauna6ft:     "Barrel 6 ft",
    barrelsauna8ft:     "Barrel 8 ft",
    barrelsauna71combi: "Barrel 7+1 ft",
  };

  var index = null;   // null = de specsheets zijn nog niet geladen
  var pakket = null;  // null = de verpakkingslijst is nog niet geladen

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

  function bouwPakket(db) {
    var uit = {};
    var cats = (db && db.categories) || [];
    for (var i = 0; i < cats.length; i++) {
      var pr = cats[i].products || [];
      for (var j = 0; j < pr.length; j++) {
        var dozen = (pr[j].boxes || []).filter(function (b) { return b && b.dims; });
        // Meer dan één kist: dat is geen enkele maat, dus overslaan.
        if (dozen.length !== 1) continue;
        var d = dozen[0].dims;
        if (!(d.l > 0 && d.w > 0 && d.h > 0)) continue;
        var n = sleutel(pr[j].name);
        if (!uit[n]) uit[n] = { l: d.l, b: d.w, h: d.h, kg: dozen[0].weight || null, naam: pr[j].name };
      }
    }
    return uit;
  }

  function zet(db) { index = bouwIndex(db); return aantal(); }
  function zetPakket(db) { pakket = bouwPakket(db); return Object.keys(pakket).length; }
  function aantal() { return index ? Object.keys(index).length : 0; }
  function geladen() { return index !== null; }

  // De twee bestanden ophalen. Faalt er een, dan blijft die bron leeg en werkt
  // alles gewoon door op wat er wél is - er gaat dus nooit iets stuk.
  function haal(pad, klaar, leeg) {
    return fetch(pad)
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(klaar)
      .catch(function (e) { console.warn(pad + " laden faalde:", e.message); return leeg(); });
  }
  function laad() {
    if (index && pakket) return Promise.resolve(aantal());
    if (typeof fetch !== "function") { index = index || {}; pakket = pakket || {}; return Promise.resolve(0); }
    return Promise.all([
      index  ? aantal() : haal("/spec-database.json", zet, function () { index = {}; return 0; }),
      pakket ? 0        : haal("/packaging-database.json", zetPakket, function () { pakket = {}; return 0; }),
    ]).then(function () { return aantal(); });
  }

  function uitSpecsheet(model) {
    if (!index) return null;
    var n = sleutel(model);
    var via = HANDMATIG[n];
    var hit = via ? index[sleutel(via)] : index[n];
    return hit ? { l: hit.l, b: hit.b, h: hit.h, bron: "specsheet", sheet: hit.sheet } : null;
  }

  function uitVerpakking(model) {
    if (!pakket) return null;
    var n = sleutel(model);
    var via = PAKKET_HANDMATIG[n];
    var hit = via ? pakket[sleutel(via)] : pakket[n];
    return hit ? { l: hit.l, b: hit.b, h: hit.h, kg: hit.kg, bron: "verpakkingslijst", sheet: hit.naam } : null;
  }

  /* De maat van één model, in CENTIMETERS.
     afmetingMm is het veld 'afmeting' van de prijslijst ("3940x2260x1260",
     millimeters). Volgorde: prijslijst, dan de kistmaat uit de
     verpakkingslijst, dan de specsheet. De kistmaat staat vóór de specsheet
     omdat je een kist in een container zet en geen product. */
  function maatVan(model, afmetingMm) {
    var p = String(afmetingMm || "").split("x").map(Number);
    if (p.length === 3 && p[0] > 0 && p[1] > 0 && p[2] > 0) {
      return { l: p[0] / 10, b: p[1] / 10, h: p[2] / 10, bron: "prijslijst", sheet: null };
    }
    return uitVerpakking(model) || uitSpecsheet(model);
  }

  function m3Van(model, afmetingMm) {
    var m = maatVan(model, afmetingMm);
    return m ? (m.l / 100) * (m.b / 100) * (m.h / 100) : null;
  }

  var API = {
    laad: laad, zet: zet, zetPakket: zetPakket, geladen: geladen, aantal: aantal,
    maatVan: maatVan, m3Van: m3Van, sleutel: sleutel,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.fpAfmetingen = API;

})(typeof window !== "undefined" ? window : globalThis);
