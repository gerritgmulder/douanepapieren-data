/* ═══════════════════════════════════════════════════════════════════════════
   MOLLIE - een settlement-afschrift naast de orders in Logic4 leggen
   ═══════════════════════════════════════════════════════════════════════════

   Waarom apart van bank-matching.js
   ---------------------------------
   Een gewoon bankafschrift bevat betalingen van klanten aan Fonteyn. Een
   settlement van Mollie bevat drie soorten regels door elkaar, en die door
   dezelfde molen halen levert onzin op:

     betaling       een klant heeft betaald            (EREF tr_)
     terugbetaling  geld is teruggegaan naar de klant  (EREF re_, afboeking)
     kosten         de fee die Mollie inhoudt          (REMI "Withheld fees")

   Alleen de eerste soort hoort op een order. Een terugbetaling als betaling
   boeken is het bedrag twee keer de verkeerde kant op zetten, en de fee hoort
   op een kostenrekening. Ze onder "geen match" zetten zou net zo fout zijn:
   dan lijkt het of er iets mislukt is terwijl er niets aan de hand is.

   Hoe een betaling gekoppeld wordt
   --------------------------------
   Twee wegen, precies zoals Gerrit ze beschrijft (12 aug 2026):

   1. Betaallink. Dan staat het ordernummer in /REMI/, soms met het
      debiteurnummer ervoor: "878909985 3500815" of "130347 - 3518946 - Spa -
      Arno". Een ordernummer is zeven cijfers en begint met een 3; dat
      onderscheid zit al in bank-matching.js.
   2. Internetbestelling. Dan staat er alleen een sleutel van Mollie zelf
      ("rAC4dFaqCSmPfH5K1sw9duD4i") en moet het op naam en bedrag.

   Let op bij die tweede weg: /NAME/ is de naam van de betaler zoals zijn bank
   die doorgeeft, en dat is niet altijd de klant. In het testbestand staat er
   bij een betaling van 5.285,59 gewoon "ralfhuebner". Op naam alleen mag dus
   nooit "zeker" volgen - alleen naam én bedrag samen, en dan nog blijft het
   iets om na te kijken zodra de naam niet echt lijkt.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var BM = function () { return global.fpBankMatch; };

  function tekstVan(tx) {
    return String((tx && (tx.descRaw || tx.description)) || "").replace(/\r?\n/g, "");
  }

  // De EREF van Mollie zegt wat voor regel het is. tr_ is een betaling,
  // re_ een terugbetaling, chb_ een chargeback.
  function eref(tx) {
    var m = tekstVan(tx).match(/\/EREF\/([A-Za-z0-9_]+)/);
    return m ? m[1] : "";
  }

  function soortVan(tx) {
    var t = tekstVan(tx);
    var e = eref(tx);
    if (/withheld\s+fees|\bfee[s]?\b.*MOL-|invoice\s+MOL-/i.test(t)) return "kosten";
    if (/^re_/i.test(e)) return "terugbetaling";
    if (/^chb_/i.test(e)) return "chargeback";
    // Zonder tr_ maar wél negatief: geen betaling van een klant.
    if (Number(tx && tx.amount) < 0) return "terugbetaling";
    return "betaling";
  }

  var SOORT_UITLEG = {
    kosten: "De fee die Mollie inhoudt op deze uitbetaling. Hoort op een kostenrekening en niet op een order.",
    terugbetaling: "Geld dat is teruggegaan naar de klant. Dit is geen betaling en mag niet als betaling op een order.",
    chargeback: "Een teruggeboekte betaling (chargeback). Zoek eerst uit welke order dit was voordat er iets mee gebeurt.",
  };

  /* Eén regel beoordelen.
       index  = uitkomst van fpBankMatch.bouwIndex(openstaande posten)
       orders = { ordernummer: {orderNr, naam, totaal, betaald, open} } of leeg
     Terug komt: { soort, status, reden, order, kandidaten, tegenpartij } */
  function koppel(tx, index, orders) {
    var soort = soortVan(tx);
    var tp = BM().tegenpartij(tekstVan(tx));
    var basis = { soort: soort, tegenpartij: tp, kandidaten: [], order: null };

    if (soort !== "betaling") {
      return Object.assign(basis, { status: "grootboek", reden: SOORT_UITLEG[soort] || "Geen betaling van een klant." });
    }

    var bedrag = Number(tx.amount) || 0;
    var nrs = BM().nummers(tekstVan(tx));

    // ── 1. Betaallink: het ordernummer staat erbij ────────────────────
    for (var i = 0; i < nrs.orders.length; i++) {
      var nr = nrs.orders[i];
      var o = orders && orders[String(nr)];
      if (!o) {
        // Het nummer staat er wel maar de order is niet opgehaald of bestaat
        // niet. Dat is iets anders dan "geen match" en moet dat ook zeggen.
        return Object.assign(basis, {
          status: "controleren", ordernummer: nr,
          reden: "ordernummer " + nr + " staat in de omschrijving, maar die order is niet gevonden in Logic4",
        });
      }
      var open = Number(o.open);
      var klopt = Math.abs(open - bedrag) < 0.005;
      return Object.assign(basis, {
        status: klopt ? "zeker" : "controleren",
        order: o, ordernummer: nr,
        reden: klopt
          ? "ordernummer " + nr + " staat in de omschrijving en het bedrag komt overeen met wat er openstaat"
          : "ordernummer " + nr + " staat in de omschrijving, maar er staat " +
            open.toFixed(2) + " open en er is " + bedrag.toFixed(2) + " betaald",
      });
    }

    // ── 2. Internetbestelling: op naam en bedrag ──────────────────────
    // Het zoeken op bedrag zit al in bank-matching.js en is daar getest; hier
    // wordt alleen het oordeel aangescherpt, want een naam uit Mollie is
    // minder betrouwbaar dan een naam van de bank.
    var m = BM().koppel(tx, index);
    m.soort = "betaling";
    m.order = null;
    if (m.status === "zeker") {
      // Op alleen een bedrag mag hier niets hard staan: twee klanten kunnen
      // hetzelfde bedrag betalen, en zonder ordernummer wijst niets één order
      // aan. Het wordt pas weer "zeker" als de naam het bevestigt, en dat
      // gebeurt in bevestig() hieronder.
      m.status = "controleren";
      m.reden = m.reden + " — zonder ordernummer telt dit pas als de naam klopt";
    }
    return m;
  }

  /* Nadat de namen uit Logic4 erbij zijn gehaald: een naam die echt lijkt maakt
     een bedrag-treffer alsnog hard. De drempel daarvoor staat in
     bank-matching.js en is daar op echte afschriften afgeregeld; hier wordt hij
     niet overruled, alleen aangevuld voor het geval er één kandidaat is met een
     naam die vrijwel gelijk is.

     Dit is precies de regel die Gerrit beschrijft: naam én bedrag samen komen
     bij een internetbestelling vrijwel altijd overeen met de order. Komt de
     naam níet overeen, dan blijft het staan op controleren - en dat gebeurt,
     want /NAME/ is de naam van de betaler bij zijn bank en dat is niet altijd
     de klant ("ralfhuebner" bij een order van 5.285,59). */
  function bevestig(match, namen) {
    if (!match || match.soort !== "betaling") return match;
    var uit = BM().bevestig(match, namen);
    var top = uit && uit.naamOordeel && uit.naamOordeel[0];
    if (uit.status === "controleren" && uit.kandidaten && uit.kandidaten.length === 1 &&
        top && top.score >= 0.8) {
      uit.status = "zeker";
      uit.reden = "bedrag en naam komen allebei overeen met " + top.naam;
    }
    return uit;
  }

  // Voor het overzicht bovenaan de tegel.
  function tel(regels) {
    var t = { zeker: 0, controleren: 0, geen: 0, grootboek: 0 };
    (regels || []).forEach(function (r) {
      var s = (r && r.match && r.match.status) || "geen";
      if (s === "kandidaten" || s === "opzoeken") s = "controleren";
      if (t[s] == null) s = "geen";
      t[s]++;
    });
    return t;
  }

  var API = { soortVan: soortVan, eref: eref, koppel: koppel, bevestig: bevestig, tel: tel,
              SOORT_UITLEG: SOORT_UITLEG };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.fpMollieMatch = API;

})(typeof window !== "undefined" ? window : globalThis);
