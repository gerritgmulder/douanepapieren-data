/* ═══════════════════════════════════════════════════════════════════════════
   BANKKOPPELING — een afschriftregel aan een openstaande factuur koppelen
   ═══════════════════════════════════════════════════════════════════════════

   Waarom dit apart staat
   ----------------------
   De tegel deed één ding: een 7-cijferig ordernummer uit de afschriftregel
   vissen en dat order opzoeken. Stond er geen nummer in, dan was het "geen
   match" en verder niets. Dat is de meeste regels, want klanten typen zelf
   wat ze willen in de omschrijving.

   Hier zit de hele afweging bij elkaar, los van het scherm, zodat hij op
   echte afschriften te testen is voordat er iets geboekt wordt.

   Waarop wordt gekoppeld
   ----------------------
   Vier signalen, in volgorde van hoe hard ze zijn:

     1. FACTUURNUMMER in de omschrijving. Hardst. Factuurnummers zijn
        7-cijferig en beginnen met een 6 (6.400.000-6.700.000); ordernummers
        beginnen met een 3. Dat onderscheid maakt dat we niet hoeven raden
        welk van beide er staat.
     2. ORDERNUMMER in de omschrijving. Bijna net zo hard, maar het vergt een
        extra opzoekactie: van order naar factuur.
     3. BEDRAG tegen de openstaande posten. Van de ~2.500 openstaande posten
        heeft 39% een bedrag dat maar één keer voorkomt; bij die 39% wijst het
        bedrag dus één factuur aan. Bij de rest niet, en dan is het bedrag
        alleen een manier om kandidaten te vinden - geen bewijs.
     4. NAAM van de tegenpartij. Nooit een koppeling op zichzelf, wél de
        bevestiging bij een bedrag-treffer. Logic4 bewaart geen IBAN bij de
        debiteur (alle 37 velden nagelopen), dus het rekeningnummer uit het
        afschrift helpt ons niet - de naam is wat overblijft.

   Een deelbetaling is normaal: 30% aanbetaling, later de rest. Daarom wordt
   niet alleen op het openstaande bedrag vergeleken maar ook op een
   aanbetaling of een restant van een openstaande post.

   Wat hier NIET gebeurt
   ---------------------
   Boeken. Dit onderdeel stelt alleen vast wat waarschijnlijk bij elkaar
   hoort en hoe zeker dat is. Wat daarmee gebeurt, beslist een mens.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var CENT = 0.02;                  // afrondingsmarge bij bedragen vergelijken
  var AANBETALING = [0.3, 0.5, 0.7];// gangbare termijnen bij Fonteyn

  // ─── Tegenpartij uit de :86:-regel ──────────────────────────────────
  // Elke bank propt dit er anders in. ING en Rabo gebruiken /NAME/ en /IBAN/
  // (of /NAAM/ en /REMI/), ABN zet de naam gewoon vooraan. We proberen de
  // gestructureerde velden eerst en vallen daarna terug op de platte tekst.
  function tegenpartij(regel) {
    var s = String(regel || "");
    var uit = { naam: "", iban: "", omschrijving: "" };

    var iban = s.match(/\/(?:IBAN|CNTP)\/\s*([A-Z]{2}\d{2}[A-Z0-9]{4}\d{7,10})/i)
            || s.match(/\b([A-Z]{2}\d{2}[A-Z0-9]{4}\d{7,10})\b/);
    if (iban) uit.iban = iban[1].toUpperCase();

    var naam = s.match(/\/(?:NAME|NAAM)\/([^\/]{2,70})/i);
    if (naam) uit.naam = naam[1].trim();
    if (!uit.naam) {
      // ABN-stijl: "SEPA OVERBOEKING       IBAN: NL.. BIC: .. NAAM: Jansen"
      var n2 = s.match(/NAAM:\s*([^\n]{2,70}?)(?:\s{2,}|OMSCHRIJVING:|KENMERK:|$)/i);
      if (n2) uit.naam = n2[1].trim();
    }
    var remi = s.match(/\/(?:REMI|EREF)\/([^\/]{2,140})/i)
            || s.match(/OMSCHRIJVING:\s*([^\n]{2,140})/i);
    uit.omschrijving = remi ? remi[1].trim() : s;
    return uit;
  }

  // ─── Nummers uit de omschrijving ────────────────────────────────────
  // Een factuurnummer en een ordernummer zijn allebei 7-cijferig; het eerste
  // cijfer scheidt ze. Alles wat daar niet aan voldoet laten we liggen -
  // klantnummers, postcodes en jaartallen leverden anders schijnkandidaten op.
  function nummers(tekst) {
    var s = String(tekst || "");
    var facturen = [], orders = [], gezien = {};
    var re = /\b(\d{7})\b/g, m;
    while ((m = re.exec(s)) !== null) {
      var n = m[1];
      if (gezien[n]) continue;
      gezien[n] = 1;
      if (n.charAt(0) === "6") facturen.push(n);
      else if (n.charAt(0) === "3") orders.push(n);
    }
    return { facturen: facturen, orders: orders };
  }

  // ─── Namen vergelijken ──────────────────────────────────────────────
  // "Jansen Beheer B.V." en "JANSEN BEHEER BV" horen hetzelfde te zijn.
  // Rechtsvormen en leestekens eruit, dan de woorden vergelijken.
  var RUIS = /\b(bv|b\.?v|nv|n\.?v|vof|v\.?o\.?f|cv|holding|beheer|de|het|een|van|der|den|te|and|en)\b/g;
  function naamSleutel(s) {
    return String(s || "").toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(RUIS, " ")
      .replace(/\s+/g, " ").trim();
  }
  // 0 = niets gemeen, 1 = gelijk. Gedeelde woorden gedeeld door het kortste
  // van de twee: "Jansen" hoort te matchen met "Jansen Tuinmeubelen".
  function naamGelijkenis(a, b) {
    var wa = naamSleutel(a).split(" ").filter(Boolean);
    var wb = naamSleutel(b).split(" ").filter(Boolean);
    if (!wa.length || !wb.length) return 0;
    var setB = {}; wb.forEach(function (w) { setB[w] = 1; });
    var raak = wa.filter(function (w) { return setB[w]; }).length;
    return raak / Math.min(wa.length, wb.length);
  }

  // ─── Bedragen ───────────────────────────────────────────────────────
  function gelijk(a, b) { return Math.abs(Number(a) - Number(b)) < CENT; }

  // Waarom past dit bedrag bij deze post? Het antwoord is de uitleg die de
  // gebruiker te zien krijgt, dus geen code maar een zin.
  function bedragRol(bedrag, post) {
    var open = Number(post.AmountOutstanding) || 0;
    var totaal = Number(post.TotalAmount) || 0;
    if (gelijk(bedrag, open)) return { rol: "volledig", tekst: "voldoet de post helemaal", hard: true };
    if (gelijk(bedrag, totaal)) return { rol: "totaal", tekst: "gelijk aan het factuurtotaal", hard: true };
    for (var i = 0; i < AANBETALING.length; i++) {
      var p = AANBETALING[i];
      if (gelijk(bedrag, Math.round(totaal * p * 100) / 100)) {
        return { rol: "termijn", tekst: Math.round(p * 100) + "% van het factuurtotaal", hard: false };
      }
    }
    if (bedrag > 0 && bedrag < open) return { rol: "deel", tekst: "deelbetaling, er blijft " + (Math.round((open - bedrag) * 100) / 100) + " open", hard: false };
    return { rol: "afwijkend", tekst: "bedrag wijkt af", hard: false };
  }

  // ─── Index op bedrag ────────────────────────────────────────────────
  // Eén keer opbouwen per afschrift; daarna is opzoeken op bedrag gratis.
  function bouwIndex(posten) {
    var perFactuur = {}, perBedrag = {}, perOrder = {};
    for (var i = 0; i < posten.length; i++) {
      var p = posten[i];
      if (!p || !p.InvoiceId) continue;
      perFactuur[String(p.InvoiceId)] = p;
      if (p.OrderNumber) (perOrder[String(p.OrderNumber)] = perOrder[String(p.OrderNumber)] || []).push(p);
      var c = Math.round((Number(p.AmountOutstanding) || 0) * 100);
      if (c > 0) (perBedrag[c] = perBedrag[c] || []).push(p);
    }
    return { posten: posten, perFactuur: perFactuur, perBedrag: perBedrag, perOrder: perOrder };
  }

  // ─── De koppeling zelf ──────────────────────────────────────────────
  // Statussen, van hard naar zacht:
  //   zeker       - factuurnummer genoemd én het bedrag past
  //   controleren - er is een aanwijzing, maar iets klopt niet helemaal
  //   kandidaten  - alleen op bedrag gevonden; een mens moet kiezen
  //   geen        - niets gevonden
  function koppel(tx, index) {
    var tp = tegenpartij(tx.descRaw || tx.description || "");
    var tekst = (tx.description || "") + " " + (tx.descRaw || "");
    var nrs = nummers(tekst);
    var bedrag = Number(tx.amount) || 0;
    var basis = { tegenpartij: tp, nummers: nrs, kandidaten: [] };

    // 1. Factuurnummer
    for (var i = 0; i < nrs.facturen.length; i++) {
      var post = index.perFactuur[nrs.facturen[i]];
      if (!post) continue;
      var rol = bedragRol(bedrag, post);
      return Object.assign(basis, {
        status: rol.hard ? "zeker" : "controleren",
        beste: post,
        kandidaten: [post],
        reden: "factuurnummer " + nrs.facturen[i] + " staat in de omschrijving en " + rol.tekst,
        bedragRol: rol.rol,
      });
    }
    // Een genoemd factuurnummer dat niet openstaat is geen fout van de klant -
    // meestal is de factuur al voldaan. Dat moet je zien, niet wegfilteren.
    if (nrs.facturen.length) {
      return Object.assign(basis, {
        status: "controleren", beste: null,
        reden: "factuur " + nrs.facturen[0] + " genoemd, maar die staat niet open (mogelijk al betaald)",
      });
    }

    // 2. Ordernummer — pas bruikbaar als de openstaande posten hun ordernummer
    //    kennen. Zo niet, dan wordt het in een tweede stap opgezocht.
    for (var j = 0; j < nrs.orders.length; j++) {
      var viaOrder = index.perOrder[nrs.orders[j]];
      if (viaOrder && viaOrder.length) {
        var beste = viaOrder.find(function (p) { return gelijk(bedrag, p.AmountOutstanding); }) || viaOrder[0];
        var rol2 = bedragRol(bedrag, beste);
        return Object.assign(basis, {
          status: rol2.hard && viaOrder.length === 1 ? "zeker" : "controleren",
          beste: beste, kandidaten: viaOrder,
          reden: "ordernummer " + nrs.orders[j] + " en " + rol2.tekst,
          bedragRol: rol2.rol,
        });
      }
    }
    if (nrs.orders.length) {
      return Object.assign(basis, {
        status: "opzoeken", beste: null, orderNr: nrs.orders[0],
        reden: "ordernummer " + nrs.orders[0] + " genoemd — factuur erbij zoeken",
      });
    }

    // 3. Bedrag
    var cent = Math.round(bedrag * 100);
    var opBedrag = (index.perBedrag[cent] || []).slice(0, 25);
    if (opBedrag.length === 1) {
      return Object.assign(basis, {
        status: "kandidaten", beste: opBedrag[0], kandidaten: opBedrag,
        reden: "geen nummer in de omschrijving; dit bedrag hoort bij precies één openstaande post",
        bedragRol: "volledig", uniekOpBedrag: true,
      });
    }
    if (opBedrag.length > 1) {
      return Object.assign(basis, {
        status: "kandidaten", beste: null, kandidaten: opBedrag,
        reden: "geen nummer in de omschrijving; " + opBedrag.length + " openstaande posten met dit bedrag",
      });
    }
    return Object.assign(basis, {
      status: "geen", beste: null,
      reden: "geen factuur- of ordernummer in de omschrijving en geen openstaande post met dit bedrag",
    });
  }

  // ─── Bevestigen met de naam ─────────────────────────────────────────
  // Wordt gedraaid nádat de debiteurnamen van de kandidaten zijn opgehaald.
  // De naam maakt een bedrag-treffer hard, of haalt hem juist onderuit.
  // namen = { debiteurId: "naam zoals in Logic4" }
  function bevestig(match, namen) {
    if (!match || !match.kandidaten || !match.kandidaten.length) return match;
    var tegen = match.tegenpartij && match.tegenpartij.naam;
    if (!tegen) return match;

    var beoordeeld = match.kandidaten.map(function (p) {
      var naam = namen[String(p.DebtorId)] || "";
      return { post: p, naam: naam, score: naam ? naamGelijkenis(tegen, naam) : 0 };
    }).sort(function (a, b) { return b.score - a.score; });

    match.naamOordeel = beoordeeld;
    var top = beoordeeld[0];
    if (!top || !top.naam) return match;

    if (top.score >= 0.6) {
      var tweede = beoordeeld[1];
      // Twee kandidaten die allebei op de naam lijken lossen niets op.
      if (!tweede || tweede.score < 0.6) {
        match.beste = top.post;
        match.naamBevestigd = true;
        if (match.status === "kandidaten") {
          match.status = match.uniekOpBedrag ? "zeker" : "controleren";
          match.reden += "; de naam op het afschrift komt overeen met " + top.naam;
        } else if (match.status === "controleren" && match.bedragRol === "volledig") {
          match.status = "zeker";
          match.reden += "; ook de naam komt overeen";
        }
        return match;
      }
    }
    if (match.status === "zeker" && top.score < 0.2) {
      // Nummer én bedrag klopten, maar de naam hoort bij iemand anders. Dat is
      // precies het geval waarin blind boeken fout gaat.
      match.status = "controleren";
      match.naamBotst = true;
      match.reden += "; let op: de naam op het afschrift ('" + tegen + "') lijkt niet op '" + top.naam + "'";
    }
    return match;
  }

  global.fpBankMatch = {
    tegenpartij: tegenpartij,
    nummers: nummers,
    naamSleutel: naamSleutel,
    naamGelijkenis: naamGelijkenis,
    bedragRol: bedragRol,
    bouwIndex: bouwIndex,
    koppel: koppel,
    bevestig: bevestig,
  };

})(typeof window !== "undefined" ? window : globalThis);
