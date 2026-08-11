/* ═══════════════════════════════════════════════════════════════════════════
   SPECSHEETS - Europese eenheden omzetten naar Amerikaanse
   ═══════════════════════════════════════════════════════════════════════════

   Waarom
   ------
   Gretha vult de specsheets in centimeters, kilo's en liters in. Voor de
   Amerikaanse markt moet dezelfde sheet in voet en inches, ponden en gallons staan
   (Gretha, 10 en 11 aug 2026). Twee keer invullen is vragen om twee sheets die uit elkaar
   lopen, dus er is maar één sheet: de invoer blijft Europees en de omzetting
   gebeurt bij het tekenen.

   Daarom staat hier alleen rekenwerk en geen scherm: het is te testen zonder
   browser, en zowel de preview als de PDF gebruiken exact dezelfde uitkomst.

   Wat er NIET wordt omgezet
   -------------------------
   Volt, ampère, watt, kilowatt en hertz. Dat zijn geen omrekenbare eenheden
   maar een andere machine: een Amerikaanse spa loopt op 110/240 V en 60 Hz,
   niet op 230 V en 50 Hz. Automatisch omrekenen zou een getal opleveren dat
   nergens op slaat. Wie de Amerikaanse waarde weet, typt hem per regel zelf
   in (het veld 'US-waarde' in specsheets.html); die gaat altijd voor.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  /* ─── Omrekenfactoren ────────────────────────────────────────────────────
     'rond' is het aantal decimalen. "slim" = boven de 10 hele getallen, daar
     onder één decimaal.

     Lengtes gaan naar voet en inches en niet naar kale inches: dat is wat ze
     in de VS gewend zijn (Gretha, 11 aug 2026). Een spa van 208 cm wordt dus
     6'10" en niet 82 inch. De factor rekent naar inches; het opmaken tot voet
     en inches gebeurt daarna in voetInch(). Onder de voet blijft het inches,
     want 4 cm als 0'2" schrijven leest niemand.

     'Lbs' en 'US Gallons' met hoofdletters, zoals Gretha ze op de sheets
     hanteert. */
  var EENHEDEN = [
    { van: /^(centimeters?|cm)$/i,                 naar: "",            f: 0.3937007874,   vorm: "voetinch" },
    { van: /^(millimeters?|mm)$/i,                 naar: "",            f: 0.03937007874,  vorm: "voetinch" },
    { van: /^(meters?|m)$/i,                       naar: "",            f: 39.3700787,     vorm: "voetinch" },
    { van: /^(kilograms?|kilogram|kilo|kg)$/i,     naar: "Lbs",         f: 2.2046226218,   rond: 0 },
    { van: /^(liters?|litres?|ltr|l)$/i,           naar: "US Gallons",  f: 0.2641720524,   rond: 0 },
    { van: /^(bar)$/i,                             naar: "psi",         f: 14.5037738,     rond: 0 },
    { van: /^(°\s*c|graden)$/i,                    naar: "°F",          f: 1.8, plus: 32,  rond: 0 },
  ];

  /* Inches opmaken als voet en inches: 82 wordt 6'10", 36 wordt 3'0".
     Een ronde voet krijgt dus altijd 0" erachter (Gretha, 11 aug 2026) - in een
     rij maten leest 7'7" x 7'7" x 3'0" rustiger dan 7'7" x 7'7" x 3'.
     Onder de twaalf inch blijft het inches met hoogstens één decimaal. */
  function voetInch(inch) {
    if (Math.abs(inch) < 12) {
      var klein = inch.toFixed(1);
      if (klein.indexOf(".") >= 0) klein = klein.replace(/0+$/, "").replace(/\.$/, "");
      return klein + '"';
    }
    var totaal = Math.round(inch);
    return Math.floor(totaal / 12) + "'" + (totaal % 12) + '"';
  }

  // De eenheden zoals ze in een tekst kunnen staan. Lange vormen eerst, anders
  // pakt "l" de eerste letter van "liter". De losse letters m en l staan
  // bewust achteraan en krijgen een woordgrens mee, zodat "kW" en "LED" niet
  // per ongeluk als meter of liter worden gelezen.
  var TOKENS = "°\\s*C|centimeters?|millimeters?|kilograms?|kilogram|liters?|litres?|meters?|graden|kilo|ltr|bar|cm|mm|kg|m|l";
  var GETAL = "\\d[\\d.,]*";

  function vind(eenheid) {
    var e = String(eenheid || "").trim();
    for (var i = 0; i < EENHEDEN.length; i++) if (EENHEDEN[i].van.test(e)) return EENHEDEN[i];
    return null;
  }

  /* ─── Getallen lezen en schrijven ────────────────────────────────────────
     Op de sheets staat "2,2" (Nederlands) en soms "1.050". Amerikanen lezen
     de punt als decimaalteken, dus wat eruit komt moet altijd Amerikaans
     genoteerd zijn. */
  function lees(tekst) {
    var s = String(tekst || "").trim();
    if (!s) return NaN;
    var punt = s.lastIndexOf("."), komma = s.lastIndexOf(",");
    if (punt >= 0 && komma >= 0) {
      // Allebei aanwezig: de laatste is het decimaalteken, de andere scheidt
      // duizendtallen. "1.234,5" en "1,234.5" komen dus allebei goed uit.
      if (komma > punt) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (komma >= 0) {
      // Alleen een komma. Precies drie cijfers erachter en niets ervoor dat op
      // een decimaal wijst = duizendtal ("1,050"); anders decimaalteken.
      s = /,\d{3}(\D|$)/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
    } else if (punt >= 0) {
      // Alleen een punt. Op deze sheets wordt Nederlands ingevuld, dus
      // "1.050" is duizend vijftig en niet één komma nul vijf. Herkenbaar aan
      // groepjes van precies drie cijfers; "2.5" blijft gewoon 2,5.
      if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    }
    var n = parseFloat(s);
    return isNaN(n) ? NaN : n;
  }

  // Eén omgerekend getal opschrijven, in de vorm die bij de eenheid hoort.
  function schrijfMet(n, e) {
    return e.vorm === "voetinch" ? voetInch(n) : schrijf(n, e.rond);
  }
  function schrijf(n, rond) {
    var d = rond === "slim" ? (Math.abs(n) >= 10 ? 0 : 1) : (rond || 0);
    var s = n.toFixed(d);
    // "18.0 ft" leest als een afronding die niet klopt; dat hoort 18 ft te zijn.
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    // Duizendtallen met een komma, zoals Amerikanen ze schrijven: 2,315 lbs.
    var stuk = s.split(".");
    stuk[0] = stuk[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return stuk.join(".");
  }

  function reken(n, e) {
    return e.plus != null ? n * e.f + e.plus : n * e.f;
  }

  /* ─── Eén waarde omzetten ────────────────────────────────────────────────
     Drie vormen komen voor:
       "208 x 155 x 83 cm"  → alle drie de maten, eenheid staat achteraan
       "850"                → kaal getal, de eenheid staat in de omschrijving
       "koud water 4 °C"    → eenheid ergens in een zin
     De eerste twee zijn verreweg het meest; de derde is het vangnet. */
  function waarde(tekst, eenheidUitLabel) {
    var v = String(tekst == null ? "" : tekst);
    if (!v.trim()) return v;

    // 1. Reeks getallen met de eenheid erachter: "208 x 155 x 83 cm".
    var reeks = new RegExp("^\\s*(" + GETAL + "(?:\\s*[x×\\-–/]\\s*" + GETAL + ")*)\\s*(" + TOKENS + ")\\b\\s*(.*)$", "i");
    var m = v.match(reeks);
    if (m) {
      var e = vind(m[2]);
      if (e) {
        var om = m[1].replace(new RegExp(GETAL, "g"), function (g) {
          var n = lees(g);
          return isNaN(n) ? g : schrijfMet(reken(n, e), e);
        });
        return (om + (e.naar ? " " + e.naar : "") + (m[3] ? " " + m[3] : "")).trim();
      }
    }

    // 2. Kaal getal (of reeks) zonder eenheid: die haalt hij uit de
    //    omschrijving links, bijvoorbeeld "Capacity in Liter".
    if (eenheidUitLabel && /^[\d.,\s x×\-–/]+$/i.test(v)) {
      var e2 = vind(eenheidUitLabel);
      if (e2) {
        return v.replace(new RegExp(GETAL, "g"), function (g) {
          var n = lees(g);
          return isNaN(n) ? g : schrijfMet(reken(n, e2), e2);
        });
      }
    }

    // 3. Losse eenheden midden in een zin.
    var los = new RegExp("(" + GETAL + ")\\s*(" + TOKENS + ")\\b", "gi");
    var geraakt = false;
    var uit = v.replace(los, function (heel, g, eh) {
      var e3 = vind(eh);
      var n = lees(g);
      if (!e3 || isNaN(n)) return heel;
      geraakt = true;
      return schrijfMet(reken(n, e3), e3) + (e3.naar ? " " + e3.naar : "");
    });
    if (geraakt) return uit;

    // 4. Niets omgerekend: dan alleen de schrijfwijze van het getal
    //    Amerikaans maken, zodat "2,2 kW" niet als 2 kW gelezen wordt.
    return amerikaanseNotatie(uit);
  }

  // 1.234,5 → 1,234.5 en 2,2 → 2.2. Alleen daar waar het écht om een getal
  // met decimalen gaat; artikelnummers en codes blijven ongemoeid.
  function amerikaanseNotatie(tekst) {
    return String(tekst == null ? "" : tekst)
      .replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/g, function (g) {
        return g.replace(/\./g, "|").replace(",", ".").replace(/\|/g, ",");
      })
      .replace(/(\d),(\d{1,2})\b/g, "$1.$2");
  }

  /* ─── De omschrijving links ──────────────────────────────────────────────
     "Dry Weight in kg" moet "Dry Weight in lbs" worden. De eenheid staat er
     op twee manieren in: als "in kg" of tussen haakjes als "(kg)". */
  var LABEL_IN = new RegExp("\\b(in|per)\\s+(" + TOKENS + ")\\b", "i");
  var LABEL_HAAK = new RegExp("\\((" + TOKENS + ")\\)", "i");

  function eenheidVanLabel(label) {
    var s = String(label || "");
    var m = s.match(LABEL_IN);
    if (m && vind(m[2])) return m[2];
    var h = s.match(LABEL_HAAK);
    if (h && vind(h[1])) return h[1];
    return null;
  }

  function label(tekst) {
    var s = String(tekst == null ? "" : tekst);
    var m = s.match(LABEL_IN);
    if (m) {
      var e = vind(m[2]);
      if (e) return s.replace(LABEL_IN, m[1] + " " + amerikaansLabel(e));
    }
    var h = s.match(LABEL_HAAK);
    if (h) {
      var e2 = vind(h[1]);
      if (e2) return s.replace(LABEL_HAAK, "(" + amerikaansLabel(e2) + ")");
    }
    return s;
  }

  // In een omschrijving staat het voluit: "Capacity in US Gallons" leest
  // prettiger dan "Capacity in US gal".
  function amerikaansLabel(e) {
    // Een lengte staat in de waarde al als voet en inches, dus de omschrijving
    // noemt de eenheid als ft/in in plaats van cm.
    if (e.vorm === "voetinch") return "ft/in";
    return e.naar;
  }

  /* ─── Eén regel van de sheet ─────────────────────────────────────────────
     r = { l: omschrijving, v: waarde, us: eigen Amerikaanse waarde }.
     Staat er een eigen US-waarde, dan gaat die altijd voor het rekenwerk -
     dat is de weg voor volt, ampère en alles waar Amerika gewoon iets anders
     heeft staan. */
  function regel(r) {
    if (!r) return { l: "", v: "" };
    var eh = eenheidVanLabel(r.l);
    var us = (r.us == null ? "" : String(r.us)).trim();
    return {
      l: label(r.l),
      v: us ? us : waarde(r.v, eh),
    };
  }

  // Of er op deze regel iets te rekenen valt. Wordt gebruikt om in het
  // formulier te laten zien welke regels ongemoeid blijven (de elektrische),
  // zodat je weet waar je zelf naar moet kijken.
  function omrekenbaar(r) {
    if (!r) return false;
    var eh = eenheidVanLabel(r.l);
    if (eh) return true;
    var los = new RegExp("(" + GETAL + ")\\s*(" + TOKENS + ")\\b", "i");
    var m = String(r.v || "").match(los);
    return !!(m && vind(m[2]));
  }

  // Eenheden waar Amerika een ander apparaat heeft in plaats van een ander
  // getal. Alleen om te waarschuwen; er wordt niets mee omgerekend.
  var ELEKTRISCH = /(\d[\d.,]*\s*(kw|w|v|a|hz)\b)|\b(volt|ampere|amperage|voltage|hertz|watt)\b/i;
  function elektrisch(r) {
    if (!r) return false;
    return ELEKTRISCH.test(String(r.l || "") + " " + String(r.v || ""));
  }

  var API = {
    regel: regel,
    label: label,
    waarde: waarde,
    eenheidVanLabel: eenheidVanLabel,
    omrekenbaar: omrekenbaar,
    elektrisch: elektrisch,
    amerikaanseNotatie: amerikaanseNotatie,
    lees: lees,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.fpEenheden = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
