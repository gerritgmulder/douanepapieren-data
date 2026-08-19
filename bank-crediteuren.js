/* ═══════════════════════════════════════════════════════════════════════════
   UITGAANDE BETALINGEN AAN OPENSTAANDE CREDITEURFACTUREN KOPPELEN
   ═══════════════════════════════════════════════════════════════════════════

   Gerrit (19 aug 2026): "Op een MT940 staan inkomsten en uitgaven. De
   inkomsten gaan nagenoeg perfect, maar de uitgaven worden niet eens gelezen.
   Die moeten op dezelfde manier worden geboekt aan crediteurenfacturen zoals
   inkomsten worden geboekt op debiteurenfacturen."

   Waarom dit een eigen bestand is
   -------------------------------
   De debiteurenkant koppelt op onze eigen nummers: een factuurnummer van
   zeven cijfers dat met een 6 begint, een ordernummer dat met een 3 begint.
   Aan de crediteurenkant is het nummer van de leverancier, en dat is van alles:
   "F739439", "VFG2502813", "20240729884", "B0627646". Er valt dus niets aan
   de vorm te herkennen. In plaats daarvan wordt de omschrijving afgezocht op
   de referenties die we écht hebben openstaan.

   Wat er anders is dan bij inkomsten
   ----------------------------------
   1. Eén betaling voldoet vaak méér dan één factuur. Een betaalbatch aan
      dezelfde leverancier is één regel op het afschrift. Daarom wordt ook
      gezocht naar een combinatie van openstaande facturen die samen op het
      bedrag uitkomt.

   2. Een creditnota staat er met een negatief bedrag in. Die hoort gewoon mee
      te tellen in zo'n combinatie, want zo betaalt de boekhouding ook.

   3. Het bedrag op het afschrift is negatief (er gaat geld uit), het
      openstaande bedrag bij de crediteur is positief. Er wordt hier met de
      absolute waarde gewerkt.

   Wat hier NIET gebeurt
   ---------------------
   Boeken. Er komt een voorstel uit dat een mens beoordeelt. Zie de tegel voor
   waarom dat aan de crediteurenkant nog niet automatisch gaat.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var CENT = 0.011;                 // afrondingsruimte van één cent
  var KOERS_MARGE = 0.02;           // 2%, voor een betaling in vreemde valuta
  var MAX_COMBI = 6;                // hoeveel facturen samen mag een betaling zijn

  function plak(s) { return String(s == null ? "" : s).replace(/\r?\n/g, " "); }
  function gelijk(a, b) { return Math.abs(Number(a) - Number(b)) < CENT; }

  /* Een referentie herkenbaar maken los van schrijfwijze: "VFG 25/02813" en
     "vfg2502813" zijn hetzelfde nummer. */
  function refSleutel(s) {
    return String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  /* Namen vergelijken, zelfde gedachte als aan de debiteurenkant. */
  var RUIS = /\b(bv|b\.?v|nv|n\.?v|gmbh|ltd|limited|co|inc|sarl|sa|vof|holding|beheer|de|het|een|van|der|den|the|and|en|nl|com|net|eu)\b/g;
  function naamSleutel(s) {
    return String(s || "").toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ").replace(RUIS, " ").replace(/\s+/g, " ").trim();
  }
  /* Losse letters die overblijven uit "B.V." of "N.V." zijn geen woord en
     zouden de teller alleen maar verwateren. */
  function woorden(naam) {
    return naamSleutel(naam).split(" ").filter(function (w) { return w.length > 1; });
  }
  /* Woorden vergelijken met een beginstuk erbij. De bank kort de naam van de
     tegenpartij af tot 24 tekens per regel: "Escential Healthcare Products
     B.V." komt binnen als "Escential Healthc Pr BV". Op hele woorden vergeleken
     is dat één treffer op drie en valt de leverancier af, terwijl een mens hem
     meteen herkent. Daarom telt het ook als het ene woord met het andere
     begint, vanaf drie letters. */
  function woordGelijk(a, b) {
    if (a === b) return true;
    var kort = a.length < b.length ? a : b;
    var lang = a.length < b.length ? b : a;
    return kort.length >= 3 && lang.indexOf(kort) === 0;
  }
  function naamGelijkenis(a, b) {
    var wa = woorden(a), wb = woorden(b);
    if (!wa.length || !wb.length) return 0;
    var gebruikt = {}, raak = 0;
    for (var i = 0; i < wa.length; i++) {
      for (var j = 0; j < wb.length; j++) {
        if (gebruikt[j]) continue;
        if (woordGelijk(wa[i], wb[j])) { gebruikt[j] = 1; raak++; break; }
      }
    }
    /* Delen door de kórtste naam. De bank knipt de naam af, dus de lange kant
       heeft bijna altijd woorden die op het afschrift niet meer staan; daarop
       delen zou elke afgekorte naam laten afvallen.

       Het gevaar daarvan is een naam van één gewoon woord die overal op past.
       Daarom telt een naam van één woord alleen mee als dat woord lang genoeg
       is om onderscheidend te zijn. */
    var kortste = Math.min(wa.length, wb.length);
    if (kortste === 1) {
      var enige = (wa.length === 1 ? wa : wb)[0];
      if (enige.length < 4) return 0;   // "Vink" mag, "ABC" niet
    }
    return raak / kortste;
  }

  /* ─── De index ─────────────────────────────────────────────────────── */
  function bouwIndex(posten) {
    var perRef = {}, perCrediteur = {}, perBedrag = {}, namen = {};
    var schoon = [];
    for (var i = 0; i < (posten || []).length; i++) {
      var p = posten[i];
      if (!p || p.CreditorId == null) continue;
      var open = Number(p.AmountOpen) || 0;
      if (!open) continue;                       // niets meer te betalen
      schoon.push(p);
      var r = refSleutel(p.Reference);
      if (r.length >= 4) (perRef[r] = perRef[r] || []).push(p);
      var c = String(p.CreditorId);
      (perCrediteur[c] = perCrediteur[c] || []).push(p);
      namen[c] = p.CompanyName || namen[c] || "";
      var cent = Math.round(Math.abs(open) * 100);
      if (cent > 0) (perBedrag[cent] = perBedrag[cent] || []).push(p);
    }
    return { posten: schoon, perRef: perRef, perCrediteur: perCrediteur,
             perBedrag: perBedrag, namen: namen };
  }

  /* ─── Referenties uit de omschrijving ──────────────────────────────
     Niet raden wat een factuurnummer is, maar kijken welke van onze eigen
     openstaande referenties erin voorkomen. Dat scheelt vals alarm op
     IBAN's, datums en bedragen. */
  function refsUit(tekst, index) {
    var s = refSleutel(plak(tekst));
    var gevonden = [], gezien = {};
    for (var ref in index.perRef) {
      if (ref.length < 5) continue;              // te kort om betekenis te hebben
      if (s.indexOf(ref) < 0) continue;
      if (gezien[ref]) continue;
      gezien[ref] = 1;
      gevonden.push(ref);
    }
    /* De langste eerst: die is het meest specifiek. */
    gevonden.sort(function (a, b) { return b.length - a.length; });
    return gevonden;
  }

  /* ─── Welke crediteur staat er op het afschrift ────────────────────── */
  function crediteurUitNaam(naam, index) {
    if (!naam) return [];
    var uit = [];
    for (var id in index.namen) {
      var score = naamGelijkenis(naam, index.namen[id]);
      if (score >= 0.6) uit.push({ id: id, naam: index.namen[id], score: score });
    }
    uit.sort(function (a, b) { return b.score - a.score; });
    return uit;
  }

  /* ─── Een combinatie die samen op het bedrag uitkomt ────────────────
     Eén betaalopdracht voldoet vaak meerdere facturen tegelijk. Zoeken tot
     MAX_COMBI stuks; daarboven wordt het gokwerk en is het beter om het aan
     een mens te laten. */
  function combinatie(posten, doel) {
    var lijst = posten.slice(0, 40);             // bovengrens, anders loopt het op
    var gevonden = null;
    function zoek(vanaf, gekozen, som) {
      if (gevonden) return;
      if (gelijk(som, doel) && gekozen.length) { gevonden = gekozen.slice(); return; }
      if (gekozen.length >= MAX_COMBI) return;
      for (var i = vanaf; i < lijst.length; i++) {
        gekozen.push(lijst[i]);
        zoek(i + 1, gekozen, som + (Number(lijst[i].AmountOpen) || 0));
        gekozen.pop();
        if (gevonden) return;
      }
    }
    zoek(0, [], 0);
    return gevonden;
  }

  /* ─── De koppeling ──────────────────────────────────────────────────
     Statussen zoals aan de debiteurenkant:
       zeker       - referentie genoemd én het bedrag klopt
       controleren - er is een aanwijzing, maar iets klopt niet helemaal
       kandidaten  - alleen op bedrag of naam gevonden; een mens moet kiezen
       geen        - niets gevonden                                        */
  function koppel(tx, index) {
    var tekst = plak((tx.description || "") + " " + (tx.descRaw || ""));
    var bedrag = Math.abs(Number(tx.amount) || 0);
    var naam = (tx.tegenpartij && tx.tegenpartij.naam) || tx.counterparty || "";
    var basis = { kandidaten: [], tegenpartijNaam: naam };

    // 1. Een referentie die we écht openstaan hebben
    var refs = refsUit(tekst, index);
    for (var i = 0; i < refs.length; i++) {
      var posten = index.perRef[refs[i]];
      var precies = posten.filter(function (p) { return gelijk(Math.abs(p.AmountOpen), bedrag); });
      if (precies.length === 1) {
        return Object.assign(basis, {
          status: "zeker", beste: precies[0], kandidaten: posten, referentie: refs[i],
          crediteur: precies[0].CreditorId,
          reden: "factuur " + precies[0].Reference + " van " + (precies[0].CompanyName || "deze leverancier") +
                 " staat open voor precies dit bedrag",
        });
      }
      return Object.assign(basis, {
        status: "controleren", beste: posten[0], kandidaten: posten, referentie: refs[i],
        crediteur: posten[0].CreditorId,
        reden: "factuur " + posten[0].Reference + " genoemd, maar die staat open voor " +
               (Math.round(Math.abs(posten[0].AmountOpen) * 100) / 100) + " en er is " +
               (Math.round(bedrag * 100) / 100) + " betaald",
      });
    }

    // 2. De naam van de leverancier
    var cred = crediteurUitNaam(naam, index);
    if (cred.length) {
      var vanHem = index.perCrediteur[cred[0].id] || [];
      var exact = vanHem.filter(function (p) { return gelijk(Math.abs(p.AmountOpen), bedrag); });
      if (exact.length === 1) {
        return Object.assign(basis, {
          status: "controleren", beste: exact[0], kandidaten: vanHem,
          crediteur: cred[0].id, crediteurNaam: cred[0].naam,
          reden: "betaling aan " + cred[0].naam + "; factuur " + exact[0].Reference +
                 " staat open voor precies dit bedrag",
        });
      }
      if (exact.length > 1) {
        return Object.assign(basis, {
          status: "kandidaten", beste: null, kandidaten: exact,
          crediteur: cred[0].id, crediteurNaam: cred[0].naam,
          reden: "betaling aan " + cred[0].naam + "; " + exact.length +
                 " openstaande facturen met precies dit bedrag",
        });
      }
      /* Meerdere facturen samen? Zo betaalt de boekhouding vaak: één
         opdracht voor de hele batch. */
      var combi = combinatie(vanHem, bedrag);
      if (combi) {
        return Object.assign(basis, {
          status: "controleren", beste: null, kandidaten: combi, combinatie: combi,
          crediteur: cred[0].id, crediteurNaam: cred[0].naam,
          reden: "betaling aan " + cred[0].naam + "; " + combi.length +
                 " openstaande facturen komen samen precies op dit bedrag uit (" +
                 combi.map(function (p) { return p.Reference; }).join(", ") + ")",
        });
      }
      /* Koersverschil op één factuur. */
      var dichtbij = vanHem.filter(function (p) {
        var o = Math.abs(Number(p.AmountOpen) || 0);
        return o > 0 && Math.abs(o - bedrag) / Math.max(o, bedrag) <= KOERS_MARGE;
      });
      if (dichtbij.length) {
        return Object.assign(basis, {
          status: "controleren", beste: dichtbij[0], kandidaten: dichtbij,
          crediteur: cred[0].id, crediteurNaam: cred[0].naam,
          reden: "betaling aan " + cred[0].naam + "; factuur " + dichtbij[0].Reference +
                 " staat open voor " + (Math.round(Math.abs(dichtbij[0].AmountOpen) * 100) / 100) +
                 ", dat scheelt " + (Math.round(Math.abs(Math.abs(dichtbij[0].AmountOpen) - bedrag) * 100) / 100) +
                 " - mogelijk een koersverschil",
        });
      }
      return Object.assign(basis, {
        status: "kandidaten", beste: null, kandidaten: vanHem.slice(0, 25),
        crediteur: cred[0].id, crediteurNaam: cred[0].naam,
        reden: "betaling aan " + cred[0].naam + "; geen factuur die op dit bedrag past. " +
               vanHem.length + " staan er open",
      });
    }

    // 3. Alleen het bedrag
    var opBedrag = (index.perBedrag[Math.round(bedrag * 100)] || []).slice(0, 25);
    if (opBedrag.length === 1) {
      return Object.assign(basis, {
        status: "controleren", beste: opBedrag[0], kandidaten: opBedrag,
        crediteur: opBedrag[0].CreditorId,
        reden: "geen leverancier of factuurnummer herkend; dit bedrag hoort bij precies één openstaande factuur (" +
               (opBedrag[0].CompanyName || "onbekend") + ")",
      });
    }
    if (opBedrag.length > 1) {
      return Object.assign(basis, {
        status: "kandidaten", beste: null, kandidaten: opBedrag,
        reden: "geen leverancier of factuurnummer herkend; " + opBedrag.length +
               " openstaande facturen met dit bedrag",
      });
    }
    return Object.assign(basis, {
      status: "geen", beste: null,
      reden: "geen factuurnummer, geen bekende leverancier en geen openstaande factuur met dit bedrag",
    });
  }

  global.fpBankCred = {
    naamGelijkenis: naamGelijkenis,
    bouwIndex: bouwIndex, koppel: koppel,
    refsUit: refsUit, crediteurUitNaam: crediteurUitNaam,
    combinatie: combinatie, refSleutel: refSleutel,
  };

})(typeof window !== "undefined" ? window : globalThis);
