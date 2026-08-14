/* ═══════════════════════════════════════════════════════════════════════════
   COMMERCIAL INVOICE VAN EEN MEUBELFABRIEK LEZEN
   ═══════════════════════════════════════════════════════════════════════════

   Waarom apart
   ------------
   Chantal en Manon houden in het dashboard álle containers bij, dus ook die
   met tuinmeubelen en sauna's. De inhoud daarvan mag alleen niet als voorraad
   meetellen; daar komt een aparte tegel voor (Chantal, 14 aug 2026). De lezer
   hieronder haalt de regels er wél uit, zodat straks zichtbaar is wat er in
   zo'n container zit zonder dat het bij de spa's belandt.

   Chantal vroeg om vijf dingen: de fabriek, het invoicenummer, de
   omschrijving van de goederen, het artikelnummer en het aantal.

   Wat er aan deze bladzijde lastig is
   ----------------------------------
   1. Eén bestand kan twee containers bevatten. Elk blok heeft zijn eigen
      koprij en zijn eigen totaalregel.

   2. Een artikelregel loopt door over meerdere rijen. Alleen de eerste rij
      heeft een artikelnummer; de rijen eronder noemen de onderdelen van de
      set ("Garden Sofa 22", "garden table 44") en horen bij de regel erboven.

   3. De kolom "Quantity (pcs)" betekent niet overal hetzelfde. Bij GL9122
      staat 23 en dat zijn sets (23 × $354 = $8142). Bij GL9036 staat 48
      terwijl er 24 sets besteld zijn (24 × $525 = $12600); daar telt de
      kolom stuks. Het enige getal dat altijd klopt is bedrag ÷ stuksprijs.
      Daarom wordt dat uitgerekend en vergeleken, en bij verschil zegt hij het
      in plaats van er stilletjes één te kiezen.

   4. Het containernummer staat maar één keer in het bestand, terwijl er
      "TWO Containers" boven staat. Het tweede blok herhaalt hetzelfde nummer.
      Dat wordt gemeld en niet verzonnen: een container een nummer geven dat
      niet van hem is, is erger dan geen nummer.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  function schoon(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function getal(x) {
    var n = parseFloat(String(x == null ? "" : x).replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    return isFinite(n) ? n : null;
  }

  // De koprij herkennen. Die staat boven elk containerblok opnieuw.
  function isKoprij(rij) {
    var t = rij.map(schoon).join(" ").toUpperCase();
    return /ART\.?\s*NO/.test(t) && /DESCRIPTION/.test(t) && /QUANT/.test(t);
  }
  // Welke kolom is wat? Uit de koprij, want die benoemt zichzelf.
  function kolommen(rij) {
    var k = {};
    rij.forEach(function (c, i) {
      var t = schoon(c).toUpperCase();
      if (/^ART\.?\s*NO/.test(t)) k.art = i;
      else if (/DESCRIPTION\s+OF\s+GOODS/.test(t)) k.oms = i;
      else if (/FACTORY\s+DESCRIPTION/.test(t)) k.fabrieksOms = i;
      else if (/QUANT/.test(t)) k.aantal = i;
      else if (/UNIT\s*PRICE/.test(t)) k.prijs = i;
      else if (/SUB.?TOTAL/.test(t)) k.bedrag = i;
      else if (/MARKS/.test(t)) k.marks = i;
    });
    return k;
  }

  var CONTAINER = /\b([A-Z]{4}\d{6,7})\b/;
  /* Een artikelnummer heeft een vorm: letters, dan een cijfer, kort. Zonder
     die eis werden de bankgegevens onder aan het blad als artikelregels
     gelezen - de naam van de fabriek stond ineens als artikel in de lijst. */
  var ARTNO = /^[A-Z]{1,4}\d[A-Z0-9.\-\/]{0,12}$/i;

  function lees(rijen) {
    var uit = { fabriek: null, invoiceNo: null, datum: null, containers: [], meldingen: [] };

    // De kop: fabriek, invoicenummer, datum. Staan in de eerste tien rijen.
    var kop = rijen.slice(0, 12).map(function (r) { return r.map(schoon).join(" "); }).join("\n");
    var m;
    if ((m = kop.match(/^([^\n]*(?:CO\.,?\s*LTD|LIMITED|IMPORT[^\n]*EXPORT)[^\n]*)$/im))) uit.fabriek = schoon(m[1]);
    if ((m = kop.match(/INVOICE\s*NO\.?\s*:?\s*([A-Za-z0-9\-\/]{3,30})/i))) uit.invoiceNo = m[1];
    if ((m = kop.match(/DATE\s*:?\s*([A-Za-z]+\.?\s*\d{1,2}(?:th|st|nd|rd)?[, ]+\d{4})/i))) uit.datum = schoon(m[1]);

    var blok = null, k = null, vorige = null;
    for (var i = 0; i < rijen.length; i++) {
      var r = rijen[i];
      var eerste = schoon(r[0]);

      if (isKoprij(r)) {                       // nieuw containerblok
        if (blok) uit.containers.push(blok);
        k = kolommen(r);
        blok = { container: null, regels: [] };
        vorige = null;
        continue;
      }
      if (!blok || !k) continue;

      // De totaalregel sluit het blok af.
      if (/^TOTAL\s+AMOUNT/i.test(eerste)) {
        blok.totaalUsd = getal(r[k.bedrag != null ? k.bedrag : r.length - 1]);
        continue;
      }
      if (/^(TWO|THREE|\d+)\s+CONTAINERS?\s+TOTAL/i.test(eerste) ||
          /^(ALREADY\s+PAID|BALANCE)/i.test(eerste)) continue;

      // Het containernummer staat in de tweede kolom van de eerste regel.
      var hele = r.map(schoon).join(" ");
      var cm = hele.match(CONTAINER);
      if (cm && !blok.container) blok.container = cm[1];

      var art = schoon(r[k.art]);
      var oms = schoon(r[k.oms]);
      var aantal = getal(r[k.aantal]);

      if (art && !ARTNO.test(art)) continue;   // geen artikelnummer maar tekst
      if (art) {                               // nieuwe artikelregel
        var prijs = getal(r[k.prijs]), bedrag = getal(r[k.bedrag]);
        /* Het aantal uit de kolom is niet betrouwbaar - soms sets, soms
           stuks. Bedrag gedeeld door stuksprijs klopt altijd. */
        var berekend = (prijs && bedrag) ? Math.round((bedrag / prijs) * 100) / 100 : null;
        var regel = {
          artNo: art, omschrijving: oms || null,
          fabrieksOmschrijving: schoon(r[k.fabrieksOms]) || null,
          aantal: berekend != null ? berekend : aantal,
          aantalOpInvoice: aantal, prijsUsd: prijs, bedragUsd: bedrag,
          onderdelen: [],
        };
        if (berekend != null && aantal != null && Math.abs(berekend - aantal) > 0.01) {
          regel.afwijking = "de invoice noemt " + aantal + ", maar bedrag gedeeld door stuksprijs geeft " + berekend;
          uit.meldingen.push("Artikel " + art + ": " + regel.afwijking + ".");
        }
        blok.regels.push(regel);
        vorige = regel;
        continue;
      }
      /* Geen artikelnummer maar wel een omschrijving en een aantal: dit is een
         onderdeel van de set op de regel erboven. */
      if (oms && aantal != null && vorige) {
        vorige.onderdelen.push({ omschrijving: oms, aantal: aantal });
      }
    }
    if (blok) uit.containers.push(blok);

    // Twee blokken met hetzelfde containernummer: dat kan niet kloppen.
    var nrs = uit.containers.map(function (c) { return c.container; }).filter(Boolean);
    if (uit.containers.length > 1 && new Set(nrs).size < uit.containers.length) {
      uit.meldingen.push("Er staan " + uit.containers.length + " containers op deze invoice maar " +
        (new Set(nrs).size || "geen") + " verschillend(e) containernummer(s). Vul het ontbrekende nummer zelf aan.");
    }
    uit.totaalStuks = uit.containers.reduce(function (n, c) {
      return n + c.regels.reduce(function (m2, r2) { return m2 + (Number(r2.aantal) || 0); }, 0);
    }, 0);
    return uit;
  }

  /* Herkennen of dit een meubelinvoice is. Bewust smal: hij mag nooit een
     spa-invoice inpikken, want die hoort door de gewone lezer te gaan. */
  function isMeubelInvoice(rijen) {
    var t = rijen.slice(0, 30).map(function (r) { return r.map(schoon).join(" "); }).join(" ").toUpperCase();
    return /COMMERCIAL\s+INVOICE/.test(t) && /ART\.?\s*NO/.test(t) && /DESCRIPTION\s+OF\s+GOODS/.test(t);
  }

  global.fpMeubelInvoice = { lees: lees, isMeubelInvoice: isMeubelInvoice, kolommen: kolommen };

})(typeof window !== "undefined" ? window : globalThis);
