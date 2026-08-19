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
  // Een :86:-blok wordt door de bank hard afgekapt op 65 tekens en op de
  // volgende regel voortgezet - middenin een woord of zelfs middenin een
  // veldnaam ("/R" op de ene regel, "EMI/" op de volgende). Aaneenplakken moet
  // dus ZONDER spatie, anders is /REMI/ onvindbaar en valt een ordernummer dat
  // over twee regels loopt uit elkaar. Dit kostte Osman zijn hele afschrift
  // (8 aug 2026): geen enkele naam en geen enkel nummer gevonden.
  function plak(regel) { return String(regel || "").replace(/\r?\n/g, ""); }

  function tegenpartij(regel) {
    var s = plak(regel);
    var uit = { naam: "", iban: "", omschrijving: "" };

    // ING-structured zet de tegenpartij in /CNTP/<iban>/<bic>/<naam>/.
    // Dat is het formaat dat Fonteyn binnenkrijgt.
    var cntp = s.match(/\/CNTP\/([A-Z0-9]*)\/([A-Z0-9]*)\/([^\/]{2,70})/i);
    if (cntp) {
      uit.iban = (cntp[1] || "").toUpperCase();
      // De bank herhaalt de naam soms ("Carma world of welness Carma world
      // of welness"). Eén keer is genoeg.
      var n = cntp[3].trim();
      var helft = n.slice(0, Math.floor(n.length / 2)).trim();
      if (helft.length > 3 && n.slice(-helft.length).trim() === helft) n = helft;
      uit.naam = n;
    }

    if (!uit.iban) {
      var iban = s.match(/\/IBAN\/\s*([A-Z]{2}\d{2}[A-Z0-9]{4}\d{7,10})/i)
              || s.match(/\b([A-Z]{2}\d{2}[A-Z0-9]{4}\d{7,10})\b/);
      if (iban) uit.iban = iban[1].toUpperCase();
    }

    if (!uit.naam) {
      var naam = s.match(/\/(?:NAME|NAAM)\/([^\/]{2,70})/i);
      if (naam) uit.naam = naam[1].trim();
    }
    if (!uit.naam) {
      // ABN-stijl: "SEPA OVERBOEKING       IBAN: NL.. BIC: .. NAAM: Jansen"
      var n2 = s.match(/NAAM:\s*([^\n]{2,70}?)(?:\s{2,}|OMSCHRIJVING:|KENMERK:|$)/i);
      if (n2) uit.naam = n2[1].trim();
    }
    // /REMI/ is de omschrijving die de betaler zelf heeft ingetypt. ING zet er
    // "USTD//" voor (unstructured); die kop hoort er niet bij.
    var remi = s.match(/\/REMI\/(?:USTD\/\/)?([^\/]{2,300})/i)
            || s.match(/OMSCHRIJVING:\s*([^\n]{2,140})/i);
    uit.omschrijving = remi ? remi[1].trim() : s;
    return uit;
  }

  // ─── Nummers uit de omschrijving ────────────────────────────────────
  // Een factuurnummer en een ordernummer zijn allebei 7-cijferig; het eerste
  // cijfer scheidt ze. Alles wat daar niet aan voldoet laten we liggen -
  // klantnummers, postcodes en jaartallen leverden anders schijnkandidaten op.
  function nummers(tekst) {
    var s = plak(tekst);
    var facturen = [], orders = [], debiteuren = [], gezien = {};
    var re = /\b(\d{7})\b/g, m;
    while ((m = re.exec(s)) !== null) {
      var n = m[1];
      if (gezien[n]) continue;
      gezien[n] = 1;
      if (n.charAt(0) === "6") facturen.push(n);
      else if (n.charAt(0) === "3") orders.push(n);
    }
    /* Het debiteurnummer erbij. Gerrit (19 aug 2026): "er is betaald op
       ordernummer maar de betaling moet gekoppeld worden aan een factuur.
       Wat je dan moet doen is dat je het debiteurennummer opzoekt en dan de
       openstaande facturen vindt en dan de factuur kiest die past bij het
       bedrag."

       In "139512 - 3512680" is het eerste het debiteurnummer. Dat zijn er
       vijf tot zeven cijfers, dus vlak bij een factuur- of ordernummer. Het
       onderscheid is: wat al als factuur of order is herkend telt niet meer
       mee, en een reeks binnen een IBAN evenmin - vandaar de woordgrenzen. */
    var re2 = /\b(\d{5,7})\b/g, m2;
    while ((m2 = re2.exec(s)) !== null) {
      var d = m2[1];
      if (gezien[d] && (facturen.indexOf(d) >= 0 || orders.indexOf(d) >= 0)) continue;
      if (debiteuren.indexOf(d) >= 0) continue;
      debiteuren.push(d);
    }
    return { facturen: facturen, orders: orders, debiteuren: debiteuren };
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
    var perFactuur = {}, perBedrag = {}, perOrder = {}, perDebiteur = {};
    for (var i = 0; i < posten.length; i++) {
      var p = posten[i];
      if (!p || !p.InvoiceId) continue;
      perFactuur[String(p.InvoiceId)] = p;
      if (p.OrderNumber) (perOrder[String(p.OrderNumber)] = perOrder[String(p.OrderNumber)] || []).push(p);
      if (p.DebtorId != null) (perDebiteur[String(p.DebtorId)] = perDebiteur[String(p.DebtorId)] || []).push(p);
      var c = Math.round((Number(p.AmountOutstanding) || 0) * 100);
      if (c > 0) (perBedrag[c] = perBedrag[c] || []).push(p);
    }
    return { posten: posten, perFactuur: perFactuur, perBedrag: perBedrag,
             perOrder: perOrder, perDebiteur: perDebiteur };
  }

  /* ─── Openstaande facturen van de genoemde debiteur ──────────────────
     Precies wat Osman met de hand deed: debiteurnummer opzoeken, zijn
     openstaande facturen erbij pakken, en die kiezen die op het bedrag past.
     Letterlijk hetzelfde bedrag, of met een klein koersverschil.

     Wat hier NIET gebeurt is kiezen. Er komt een lijstje uit dat Osman
     voorgelegd krijgt; het boeken blijft zijn beslissing. */
  var KOERS_MARGE = 0.02;   // 2%, ruim genoeg voor een koersverschil

  function viaDebiteur(nrs, index, bedrag) {
    if (!index || !index.perDebiteur) return [];
    var uit = [];
    var lijst = (nrs && nrs.debiteuren) || [];
    for (var i = 0; i < lijst.length; i++) {
      var posten = index.perDebiteur[lijst[i]];
      if (!posten || !posten.length) continue;
      for (var j = 0; j < posten.length; j++) {
        var p = posten[j];
        var open = Number(p.AmountOutstanding) || 0;
        var verschil = Math.abs(open - bedrag);
        if (verschil < 0.01) {
          uit.push({ post: p, debiteur: lijst[i], soort: "precies", verschil: 0 });
        } else if (open > 0 && verschil / Math.max(open, bedrag) <= KOERS_MARGE) {
          uit.push({ post: p, debiteur: lijst[i], soort: "koersverschil", verschil: verschil });
        }
      }
    }
    /* Het dichtstbijzijnde bedrag bovenaan. */
    uit.sort(function (a, b) { return a.verschil - b.verschil; });
    return uit;
  }

  // ─── De koppeling zelf ──────────────────────────────────────────────
  // Statussen, van hard naar zacht:
  //   zeker       - factuurnummer genoemd én het bedrag past
  //   controleren - er is een aanwijzing, maar iets klopt niet helemaal
  //   kandidaten  - alleen op bedrag gevonden; een mens moet kiezen
  //   geen        - niets gevonden
  function koppel(tx, index) {
    return metDebiteur(koppelKern(tx, index), tx, index);
  }

  /* De uitkomst aanvullen met de openstaande facturen van de genoemde
     debiteur. Dat gebeurt náást wat er al gevonden is en niet in plaats
     daarvan: bij een betaling op ordernummer blijft die order gewoon staan,
     er komt alleen een factuur als keuze bij. */
  function metDebiteur(match, tx, index) {
    if (!match || match.status === "zeker") return match;
    var bedrag = Number(tx.amount) || 0;
    var treffers = viaDebiteur(match.nummers, index, bedrag);
    if (!treffers.length) return match;

    var bestaand = {};
    (match.kandidaten || []).forEach(function (p) { bestaand[String(p.InvoiceId)] = 1; });
    var erbij = treffers.filter(function (t) { return !bestaand[String(t.post.InvoiceId)]; });
    if (!erbij.length) return match;

    match.kandidaten = (match.kandidaten || []).concat(erbij.map(function (t) { return t.post; }));
    match.viaDebiteur = erbij;
    if (match.status === "geen" || match.status === "opzoeken") match.status = "controleren";

    var e = erbij[0];
    match.reden = (match.reden ? match.reden + ". " : "") +
      "Op debiteur " + e.debiteur + " staat factuur " + e.post.InvoiceId + " open voor " +
      (Math.round(e.post.AmountOutstanding * 100) / 100) +
      (e.soort === "precies" ? " - precies dit bedrag" :
        " - dit bedrag op een koersverschil van " + (Math.round(e.verschil * 100) / 100) + " na") +
      (erbij.length > 1 ? " (en nog " + (erbij.length - 1) + " die past)" : "") +
      ". Kies zelf of die klopt.";
    return match;
  }

  function koppelKern(tx, index) {
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
        status: "opzoeken", beste: null, orderNr: nrs.orders[0], bedrag: bedrag,
        reden: "ordernummer " + nrs.orders[0] + " genoemd; order wordt opgehaald",
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

  // ─── Order erbij zoeken ─────────────────────────────────────────────
  // In de praktijk noemen klanten een ORDERnummer, geen factuurnummer: van de
  // 21 betalingen op het afschrift van 7 aug 2026 noemden er 12 een order en
  // maar 1 een factuur. De openstaande-postenlijst kent geen ordernummers, dus
  // zo'n regel bleef op "opzoeken" staan en werd nooit zeker. Daarom wordt het
  // order zelf opgehaald; daar staat wat het kost en wat er al op betaald is.
  //
  // Meegenomen voordeel: boeken gaat in Logic4 sowieso op een order, dus met
  // het ordernummer in de hand is er geen factuur meer nodig.
  //
  // orders = { ordernummer: {naam, totaal, betaald, open, status, debiteurId} }
  function bevestigOrder(match, orders) {
    if (!match || match.status !== "opzoeken" || !match.orderNr) return match;
    var o = orders[String(match.orderNr)];
    if (!o) {
      match.status = "geen";
      match.reden = "ordernummer " + match.orderNr + " genoemd, maar dat order bestaat niet in Logic4";
      return match;
    }
    var bedrag = Number(match.bedrag) || 0;
    var totaal = Number(o.totaal) || 0;
    var open = Math.round(((totaal - (Number(o.betaald) || 0))) * 100) / 100;
    match.order = o;
    match.beste = null;                     // dit loopt niet via een factuur
    match.kandidaten = [];

    var wie = o.naam ? " (" + o.naam + ")" : "";
    if (open > 0 && gelijk(bedrag, open)) {
      match.status = "zeker";
      match.reden = "order " + match.orderNr + wie + " staat nog open voor " + open.toFixed(2) + " en dat is precies dit bedrag";
    } else if (gelijk(bedrag, totaal)) {
      match.status = "zeker";
      match.reden = "order " + match.orderNr + wie + " kost " + totaal.toFixed(2) + " en dat is precies dit bedrag";
    } else if (open <= 0) {
      match.status = "controleren";
      match.reden = "order " + match.orderNr + wie + " staat al volledig betaald (" + totaal.toFixed(2) + "); controleer of dit een dubbele betaling is";
    } else {
      var termijn = null;
      for (var i = 0; i < AANBETALING.length; i++)
        if (gelijk(bedrag, Math.round(totaal * AANBETALING[i] * 100) / 100)) termijn = Math.round(AANBETALING[i] * 100);
      match.status = "controleren";
      match.reden = termijn
        ? "order " + match.orderNr + wie + " kost " + totaal.toFixed(2) + "; dit is " + termijn + "% daarvan"
        : "order " + match.orderNr + wie + " staat open voor " + open.toFixed(2) + "; er komt " + bedrag.toFixed(2) + " binnen, dus een deelbetaling";
    }
    // De naam op het afschrift moet wel bij de klant van dat order horen.
    var tegen = match.tegenpartij && match.tegenpartij.naam;
    if (tegen && o.naam) {
      var score = naamGelijkenis(tegen, o.naam);
      if (score >= 0.5) match.naamBevestigd = true;
      else if (match.status === "zeker" && score < 0.2) {
        match.status = "controleren";
        match.naamBotst = true;
        match.reden += "; let op: het geld komt van '" + tegen + "' en het order staat op '" + o.naam + "'";
      }
    }
    return match;
  }

  global.fpBankMatch = {
    viaDebiteur: viaDebiteur, metDebiteur: metDebiteur,
    tegenpartij: tegenpartij,
    nummers: nummers,
    naamSleutel: naamSleutel,
    naamGelijkenis: naamGelijkenis,
    bedragRol: bedragRol,
    bouwIndex: bouwIndex,
    koppel: koppel,
    bevestig: bevestig,
    bevestigOrder: bevestigOrder,
  };

})(typeof window !== "undefined" ? window : globalThis);
