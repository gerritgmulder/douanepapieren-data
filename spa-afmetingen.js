/* ═══════════════════════════════════════════════════════════════════════════
   SPA-AFMETINGEN - hoe groot is een model, en waar komt dat vandaan
   ═══════════════════════════════════════════════════════════════════════════

   Waarom
   ------
   De maten van de spa's staan op vier plekken, en tot 10 aug 2026 gebruikte
   elke tegel er maar één van:

   0. Wat Chantal zelf heeft ingevuld (bucket 'spa-maten' bij de worker). Die
      gaat vóór alles. De drie bestanden hieronder zijn wat leveranciers ooit
      hebben aangeleverd; dit is wat er volgens de persoon die de containers
      boekt echt klopt. Zij kan elke maat overschrijven, ook een die er al is,
      en met één klik weer terug naar automatisch.
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
  var hand = null;    // null = de handmatige maten zijn nog niet geladen

  var WORKER = "https://fonteyn-data-store.g-mulder.workers.dev";
  var BUCKET = WORKER + "/data/spa-maten";
  function teamSleutel() {
    try { return localStorage.getItem("fp.teamkey") || ""; } catch (e) { return ""; }
  }

  /* De sleutel waaronder een handmatige maat wordt bewaard.

     De modelnaam, want dat is het enige dat alle tegels gemeen hebben: de
     Amerika-tegel kent alleen een naam en geen fabriekscode. Heeft een regel
     geen modelnaam (twee Jazzi-regels hebben dat niet), dan de code. */
  function handSleutel(model, code) {
    return sleutel(model) || ("code:" + sleutel(code));
  }

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
    if (index && pakket && hand) return Promise.resolve(aantal());
    if (typeof fetch !== "function") {
      index = index || {}; pakket = pakket || {}; hand = hand || {};
      return Promise.resolve(0);
    }
    return Promise.all([
      index  ? aantal() : haal("/spec-database.json", zet, function () { index = {}; return 0; }),
      pakket ? 0        : haal("/packaging-database.json", zetPakket, function () { pakket = {}; return 0; }),
      hand   ? 0        : laadHand(),
    ]).then(function () { return aantal(); });
  }

  // De handmatige maten bij de worker. Lukt het niet, dan werkt alles door op
  // de bestanden; er verdwijnt dus nooit een maat door een storing.
  function laadHand() {
    return fetch(BUCKET + "?t=" + (typeof performance !== "undefined" ? Math.round(performance.now()) : ""), {
      headers: { "X-Fonteyn-Auth": teamSleutel() },
    })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { hand = (j && j.maten) || {}; return Object.keys(hand).length; })
      .catch(function (e) { console.warn("handmatige maten laden faalde:", e.message); hand = {}; return 0; });
  }

  /* Eén maat vastleggen. maat = {l,b,h} in centimeters, of null om hem weer
     op automatisch te zetten. Er wordt bijgehouden wie het invulde en wanneer,
     want een maat die niet klopt moet navraagbaar zijn. */
  function bewaarMaat(model, code, maat, door) {
    if (!hand) hand = {};
    var k = handSleutel(model, code);
    if (!k) return Promise.reject(new Error("Dit model heeft geen naam en geen code."));
    if (maat) {
      hand[k] = {
        l: Number(maat.l), b: Number(maat.b), h: Number(maat.h),
        kg: maat.kg != null && maat.kg !== "" ? Number(maat.kg) : null,
        model: model || "", code: code || "",
        door: door || "", op: new Date().toISOString(),
      };
    } else {
      delete hand[k];
    }
    return fetch(BUCKET, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": teamSleutel() },
      body: JSON.stringify({ maten: hand, updated: new Date().toISOString() }),
    }).then(function (r) {
      if (!r.ok) throw new Error("opslaan faalde (HTTP " + r.status + ")");
      return hand[k] || null;
    });
  }

  function handmatigVan(model, code) {
    if (!hand) return null;
    var h = hand[handSleutel(model, code)];
    if (!h || !(h.l > 0 && h.b > 0 && h.h > 0)) return null;
    return { l: h.l, b: h.b, h: h.h, kg: h.kg || null, bron: "handmatig", sheet: null, door: h.door, op: h.op };
  }
  function handmatigAantal() { return hand ? Object.keys(hand).length : 0; }

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
     millimeters). Volgorde: wat Chantal zelf invulde, dan de prijslijst, dan
     de kistmaat uit de verpakkingslijst, dan de specsheet. De kistmaat staat
     vóór de specsheet omdat je een kist in een container zet en geen product. */
  function maatVan(model, afmetingMm, code) {
    var eigen = handmatigVan(model, code);
    if (eigen) return eigen;
    var p = String(afmetingMm || "").split("x").map(Number);
    if (p.length === 3 && p[0] > 0 && p[1] > 0 && p[2] > 0) {
      return { l: p[0] / 10, b: p[1] / 10, h: p[2] / 10, bron: "prijslijst", sheet: null };
    }
    return uitVerpakking(model) || uitSpecsheet(model);
  }

  // Wat de maat zou zijn zonder de handmatige invulling. Nodig in het scherm:
  // je moet kunnen zien wat je overschrijft voor je het overschrijft.
  function automatischVan(model, afmetingMm) {
    var p = String(afmetingMm || "").split("x").map(Number);
    if (p.length === 3 && p[0] > 0 && p[1] > 0 && p[2] > 0) {
      return { l: p[0] / 10, b: p[1] / 10, h: p[2] / 10, bron: "prijslijst", sheet: null };
    }
    return uitVerpakking(model) || uitSpecsheet(model);
  }

  function m3Van(model, afmetingMm, code) {
    var m = maatVan(model, afmetingMm, code);
    return m ? (m.l / 100) * (m.b / 100) * (m.h / 100) : null;
  }

  var API = {
    laad: laad, zet: zet, zetPakket: zetPakket, geladen: geladen, aantal: aantal,
    maatVan: maatVan, m3Van: m3Van, sleutel: sleutel,
    automatischVan: automatischVan, bewaarMaat: bewaarMaat,
    handmatigVan: handmatigVan, handmatigAantal: handmatigAantal,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.fpAfmetingen = API;

})(typeof window !== "undefined" ? window : globalThis);
