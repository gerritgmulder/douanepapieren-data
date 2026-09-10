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

  /* De echte containernummers staan op de packing list.
     ═══════════════════════════════════════════════════════════════════════
     Chantal (9 sep 2026) kreeg bij LS6J323 de melding "er staan 2 containers
     op deze invoice maar 1 verschillend(e) containernummer(s)". Dat klopte
     voor de invoice: in de kolom Marks & Nos staat bij allebei de blokken
     HPCU4872476. Op de packing list ernaast staan ze wél goed, elk boven zijn
     eigen blok: "Container No.: /Seal No.:BSIU8223754/HLK6030351" en
     "Container No.: /Seal No.: HPCU4872476/HLK6179279".

     Die worden nu overgenomen. Alleen als de packing list er precies evenveel
     noemt als er blokken zijn, want anders is niet te zeggen welke bij welk
     blok hoort en is doorvragen beter dan gokken. */
  function containersUitPacking(rijen) {
    var uit = [];
    for (var i = 0; i < (rijen || []).length; i++) {
      var regel = (rijen[i] || []).map(schoon).join(" ");
      if (!/container\s*no/i.test(regel)) continue;
      var m = regel.match(CONTAINER);
      if (m && uit.indexOf(m[1]) < 0) uit.push(m[1]);
    }
    return uit;
  }

  function lees(rijen, packingRijen) {
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
      // Eerst kijken of de packing list ze wél goed noemt.
      var uitPak = containersUitPacking(packingRijen);
      if (uitPak.length === uit.containers.length) {
        for (var q = 0; q < uit.containers.length; q++) uit.containers[q].container = uitPak[q];
        nrs = uitPak;
      } else {
        uit.meldingen.push("Er staan " + uit.containers.length + " containers op deze invoice maar " +
          (new Set(nrs).size || "geen") + " verschillend(e) containernummer(s). Vul het ontbrekende nummer zelf aan.");
      }
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

  /* ─── De Bill of Lading ─────────────────────────────────────────────────
     De vervoerder zet er de containers met hun zegel, gewicht en inhoud in.
     Dat is de enige plek waar ze allemaal bij naam staan: bij Lodestone noemt
     de invoice twee containers maar herhaalt hij één nummer.

     Het blok ziet er zo uit:
        Container   Seals        Type      Weight     Tare    Gross   Volume   Packages
        BSIU8223754 HLK6030351   40HC   3683.55 KG  3770 KG  ...    67.75 M3   111 CTN */
  function leesBillOfLading(regels) {
    var uit = { blNo: null, containers: [] };
    var alles = regels.join("\n");
    var m = alles.match(/B\/L\s*No\.?\s*:?\s*([A-Z0-9\-]{4,30})/i);
    if (m) uit.blNo = m[1];
    var gezien = {};
    for (var i = 0; i < regels.length; i++) {
      var r = schoon(regels[i]);
      var c = r.match(/^([A-Z]{4}\d{6,7})\s+([A-Z0-9]{4,20})?\s*(\d{2}[A-Z]{2})?/);
      if (!c || gezien[c[1]]) continue;
      gezien[c[1]] = 1;
      var kg = r.match(/([\d.,]+)\s*KG/gi) || [];
      var m3 = r.match(/([\d.,]+)\s*M3/i);
      var ctn = r.match(/([\d.,]+)\s*CTN/i);
      uit.containers.push({
        container: c[1], seal: c[2] || null, type: c[3] || null,
        nettoKg: kg[0] ? getal(kg[0]) : null,
        brutoKg: kg[2] ? getal(kg[2]) : (kg[1] ? getal(kg[1]) : null),
        cbm: m3 ? getal(m3[1]) : null,
        dozen: ctn ? getal(ctn[1]) : null,
      });
    }
    return uit;
  }

  /* De containers van de Bill of Lading aan de blokken van de invoice hangen.

     Op naam gaat niet: de invoice herhaalt hetzelfde nummer. Wat wél sluit is
     het aantal dozen en de kubieke meters uit de pakbon - die staan per blok
     en komen exact terug op de Bill of Lading. Alleen koppelen als het echt
     past; bij twijfel blijft het nummer leeg en zegt hij dat. */
  function koppelContainers(blokken, bl) {
    var uit = [], meldingen = [];
    var vrij = (bl.containers || []).slice();
    blokken.forEach(function (b) {
      var raak = null;
      for (var i = 0; i < vrij.length; i++) {
        var k = vrij[i];
        var dozenGelijk = b.dozen != null && k.dozen != null && Math.abs(b.dozen - k.dozen) < 0.5;
        var cbmGelijk = b.cbm != null && k.cbm != null && Math.abs(b.cbm - k.cbm) < 0.5;
        if (dozenGelijk && cbmGelijk) { raak = k; vrij.splice(i, 1); break; }
      }
      if (raak) {
        if (b.container && b.container !== raak.container) {
          meldingen.push("De invoice noemt " + b.container + " bij dit blok, maar volgens de Bill of Lading " +
            "is het " + raak.container + " (" + raak.dozen + " dozen, " + raak.cbm + " m3). De Bill of Lading is aangehouden.");
        }
        uit.push({ blok: b, container: raak.container, seal: raak.seal, viaBl: true });
      } else {
        uit.push({ blok: b, container: b.container || null, seal: null, viaBl: false });
        meldingen.push("Voor een blok met " + (b.dozen || "?") + " dozen is op de Bill of Lading geen passende container gevonden.");
      }
    });
    return { koppelingen: uit, meldingen: meldingen };
  }

  /* ── EUROFAR INTERNATIONAL: een proforma als PDF ─────────────────────────
     ═══════════════════════════════════════════════════════════════════════
     Chantal (10 sep 2026) wil alle commercial invoices van tuinmeubelen
     gelezen hebben. Eurofar is de eerste die als pdf binnenkomt, en het is
     geen fabriek maar een Nederlandse agent in Tilburg die voor ons in China
     inkoopt (Linhai, Qingdao).

     Waarom dit op x-posities werkt en niet op tekstregels
     ----------------------------------------------------
     Op deze bladzijde staat een echte tabel: No, Article No, Description,
     Qnt, Price in USD, Total in USD. Wie de regel plat maakt tot tekst raakt
     de kolomgrenzen kwijt, en juist die zijn hier het antwoord op de twee
     dingen die hieronder misgaan. Daarom krijgt deze lezer de rijen mét
     x-posities (uitPdfKolommen), niet de platte regels.

     Twee vallen, allebei gevonden door de echte bestanden te lezen en niet
     door naar de eerste regel te kijken
     -----------------------------------------------------------------------
     1. HET ARTIKELNUMMER BREEKT OVER TWEE REGELS. In 754221CN staat artikel 2
        als "COBDB000002" met op de regel eronder een losse "8". Samen is dat
        COBDB0000028. In 754231CN gebeurt het twee keer: COM0B000001 + "1" en
        CONKB000001 + "1". Wie per regel leest houdt een half artikelnummer
        over en dat nummer bestaat niet - het is dus niet "bijna goed" maar
        onvindbaar in Logic4. Dat losse stukje is te herkennen doordat het in
        de kolom Article No staat en niet in Description, en dat is precies
        wat je op een platte tekstregel niet meer kunt zien.

     2. EEN TWEEDE BLADZIJDE IS GEEN TWEEDE CONTAINER. 754231CN loopt door op
        een volgende bladzijde, met de koprij én de totaalregel er nog een
        keer boven en onder. Die totaalregel is niet het totaal van die
        bladzijde maar van het hele document: allebei de keren staat er 185 /
        24.590,75, en dat is 80 + 80 + 25. Wie per koprij een blok begint
        krijgt twee containers waar er één is, en wie de totalen optelt komt
        op het dubbele uit. Eén proforma is hier dus één zending.

     Bedragen staan in EUROPESE notatie (369,95 en 11.098,50). Dat is anders
     dan bij Guangxi Mibin, waar $1,892.00 staat. Die twee mogen nooit door
     dezelfde functie: de Europese lezer maakt van 1,892.00 het getal 1,892.
     Vandaar een eigen eurofarGetal() naast de bestaande getal(). */

  function eurofarGetal(t) {
    var s = String(t == null ? "" : t).replace(/[^\d.,-]/g, "");
    if (!s) return null;
    // Punt als duizendscheiding eruit, komma wordt het decimaalteken.
    s = s.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }
  // De stukjes tekst van een rij, leeg weggelaten, met hun x erbij.
  function eurofarStukken(rij) {
    return (rij && rij.items ? rij.items : []).map(function (i) {
      return { x: Number(i.x) || 0, s: schoon(i.str) };
    }).filter(function (i) { return i.s; });
  }
  function eurofarTekst(rij) {
    return eurofarStukken(rij).map(function (i) { return i.s; }).join(" ");
  }
  function eurofarBand(rij, van, tot) {
    return eurofarStukken(rij).filter(function (i) { return i.x >= van && i.x < tot; });
  }
  /* Herkennen. Bewust op twee dingen tegelijk: de naam van de agent én dat het
     een proforma is. Alleen op "Eurofar" zou ook een begeleidende brief of een
     pakbon van dezelfde afzender inpikken. */
  function isEurofar(regels) {
    var t = (regels || []).slice(0, 40).join(" ");
    return /Eurofar\s+International/i.test(t) && /Proforma\s+Invoice/i.test(t);
  }
  // Is dit de koprij van de artikeltabel?
  function eurofarIsKop(rij) {
    var t = eurofarTekst(rij);
    return /\bArticle\s*No\b/i.test(t) && /\bDescription\b/i.test(t) && /\bQnt\b/i.test(t);
  }
  var EUROFAR_OPTIE = /^(ALU\b|C_|SEAT\s*:|BACK\s*:|PACKAGING\s+METHOD\s*:)/i;

  function leesEurofar(rijen) {
    var uit = { fabriek: "Eurofar International B.V.", invoiceNo: null, datum: null,
                referentie: null, lds: null, laadhaven: null, containerSoort: null,
                containers: [], meldingen: [] };
    if (!rijen || !rijen.length) return uit;

    /* De kop. Die staat op elke bladzijde opnieuw, dus de eerste die we
       tegenkomen telt en de rest wordt overgeslagen. */
    for (var i = 0; i < rijen.length && i < 40; i++) {
      var t = eurofarTekst(rijen[i]), m;
      if (!uit.invoiceNo && (m = t.match(/Proforma\s+Invoice\s*:\s*([A-Za-z0-9\-\/]{3,30})/i))) uit.invoiceNo = m[1];
      if (!uit.datum && (m = t.match(/\bDate\s*:\s*(\d{2}-\d{2}-\d{4})/i))) uit.datum = m[1];
      if (!uit.lds && (m = t.match(/\bLDS\s+(\d{2}-\d{2}-\d{4})/i))) uit.lds = m[1];
      if (!uit.containerSoort && (m = t.match(/\bContainers\s+(\d+\s*x\s*\d+\s*[A-Z]{2,4})/i))) uit.containerSoort = schoon(m[1]);
      if (!uit.laadhaven && (m = t.match(/Port\s+of\s+Loading\s+(.+)$/i))) uit.laadhaven = schoon(m[1]);
      /* De referentie kan doorlopen: bij 754231CN staat er "ORDER QINGDAO,"
         met "CHINA" eronder. Alleen niet op de regel er direct onder - daar
         staat aan de andere kant van de bladzijde nog "Proforma Invoice". Dus
         een paar regels vooruit kijken, en alleen een regel meenemen die
         helemaal in dezelfde kolom staat. Zo pikken we de tekst rechts op de
         bladzijde niet mee. */
      if (!uit.referentie) {
        var stuk = eurofarStukken(rijen[i]);
        for (var v = 0; v < stuk.length; v++) {
          if (!/Your\s+reference\s*:/i.test(stuk[v].s)) continue;
          var waarde = stuk.slice(v + 1).map(function (s) { return s.s; }).join(" ");
          var xWaarde = stuk[v + 1] ? stuk[v + 1].x : null;
          for (var n2 = 1; n2 <= 3 && xWaarde != null; n2++) {
            var volgend = eurofarStukken(rijen[i + n2] || null);
            if (!volgend.length || eurofarIsKop(rijen[i + n2])) break;
            var zelfdeKolom = volgend.every(function (s) { return Math.abs(s.x - xWaarde) < 15; });
            if (!zelfdeKolom) continue;
            waarde += " " + volgend.map(function (s) { return s.s; }).join(" ");
            break;
          }
          uit.referentie = schoon(waarde) || null;
          break;
        }
      }
    }

    /* Eén proforma is één zending, ook als hij over twee bladzijden loopt.
       Zie de toelichting hierboven. */
    var blok = { container: null, containerSoort: uit.containerSoort, regels: [] };
    var vorige = null, vorigeIndex = -1, totaalStuksOpInvoice = null, totaalUsd = null;

    for (var k = 0; k < rijen.length; k++) {
      if (!eurofarIsKop(rijen[k])) continue;

      // Waar de kolommen beginnen. Uit de koprij zelf, want die benoemt zich.
      var xNo = null, xArt = null, xOms = null, xQnt = null;
      eurofarStukken(rijen[k]).forEach(function (s) {
        if (/^No$/i.test(s.s)) xNo = s.x;
        else if (/^Article\s*No$/i.test(s.s)) xArt = s.x;
        else if (/^Description$/i.test(s.s)) xOms = s.x;
        else if (/^Qnt$/i.test(s.s)) xQnt = s.x;
      });
      if (xNo == null || xArt == null || xOms == null || xQnt == null) {
        uit.meldingen.push("Op een van de bladzijden is de koprij van de tabel niet te lezen.");
        continue;
      }
      var grensNo = xArt - 6, grensArt = xOms - 6, grensGetal = xQnt - 24;

      for (var j = k + 1; j < rijen.length; j++) {
        var rij = rijen[j], tekst = eurofarTekst(rij);
        if (/Total\s*qnt/i.test(tekst)) {           // einde van de tabel
          var w = eurofarStukken(rijen[j + 1] || null);
          if (w.length >= 2) {
            var stuks = eurofarGetal(w[0].s), bedrag = eurofarGetal(w[w.length - 1].s);
            /* Deze regel staat op élke bladzijde en noemt elke keer het totaal
               van het hele document. Verschilt hij tussen twee bladzijden, dan
               klopt er iets niet en zeggen we dat in plaats van er één te
               kiezen. */
            if (totaalStuksOpInvoice != null && stuks != null && totaalStuksOpInvoice !== stuks)
              uit.meldingen.push("De totaalregel noemt op de ene bladzijde " + totaalStuksOpInvoice +
                                 " stuks en op de andere " + stuks + ".");
            if (stuks != null) totaalStuksOpInvoice = stuks;
            if (bedrag != null) totaalUsd = bedrag;
          }
          k = j;                                     // verder zoeken na dit blok
          break;
        }
        if (eurofarIsKop(rij)) { k = j - 1; break; }  // volgende bladzijde

        var noC = eurofarBand(rij, xNo - 6, grensNo).map(function (s) { return s.s; }).join("");
        var artC = eurofarBand(rij, xArt - 6, grensArt).map(function (s) { return s.s; }).join("");
        var omsC = eurofarBand(rij, xOms - 6, grensGetal).map(function (s) { return s.s; }).join(" ");
        var getallen = eurofarStukken(rij).filter(function (s) { return s.x >= grensGetal; });

        // Een nieuwe artikelregel: volgnummer, artikelnummer én drie getallen.
        if (noC && artC && getallen.length >= 3) {
          var aantal = eurofarGetal(getallen[0].s);
          var prijs = eurofarGetal(getallen[1].s);
          var bedragR = eurofarGetal(getallen[getallen.length - 1].s);
          /* Zelfde controle als bij de xlsx-lezer: bedrag gedeeld door
             stuksprijs hoort het aantal te zijn. Klopt dat niet, dan zeggen we
             het in plaats van er stilletjes één te kiezen. */
          var berekend = (prijs && bedragR) ? Math.round((bedragR / prijs) * 100) / 100 : null;
          var regel = { artNo: artC, omschrijving: omsC || null, aantal: aantal,
                        aantalOpInvoice: aantal, prijsUsd: prijs, bedragUsd: bedragR,
                        uitvoering: [], onderdelen: [] };
          if (berekend != null && aantal != null && Math.abs(berekend - aantal) > 0.01) {
            regel.afwijking = "de invoice noemt " + aantal + ", maar bedrag gedeeld door stuksprijs geeft " + berekend;
            uit.meldingen.push("Artikel " + artC + ": " + regel.afwijking + ".");
          }
          blok.regels.push(regel);
          vorige = regel; vorigeIndex = j;
          continue;
        }
        if (!vorige) continue;

        /* Een stukje in de kolom Article No op de regel direct onder een
           artikel is de staart van het artikelnummer. Zie val 1 hierboven.
           Alleen die ene regel eronder, anders zou een los teken verderop in
           het blok er ook nog aan geplakt worden. */
        if (artC && j === vorigeIndex + 1) vorige.artNo += artC;

        if (omsC) {
          if (EUROFAR_OPTIE.test(omsC)) { vorige.optiesBegonnen = true; vorige.uitvoering.push(omsC); }
          else if (!vorige.optiesBegonnen) {
            // De naam van het artikel loopt door op de tweede regel.
            vorige.omschrijving = (vorige.omschrijving ? vorige.omschrijving + " " : "") + omsC;
          } else vorige.uitvoering.push(omsC);
        }
      }
    }

    blok.regels.forEach(function (r) { delete r.optiesBegonnen; });
    blok.totaalUsd = totaalUsd;
    uit.containers.push(blok);
    uit.totaalStuks = blok.regels.reduce(function (n, r) { return n + (Number(r.aantal) || 0); }, 0);
    uit.totaalUsd = totaalUsd;

    /* Wat wij geteld hebben tegen wat de invoice zelf zegt. Loopt dat uiteen,
       dan is er een regel gemist of dubbel gelezen, en dat hoort iemand te
       zien voordat het de voorraad in gaat. */
    if (totaalStuksOpInvoice != null && uit.totaalStuks !== totaalStuksOpInvoice)
      uit.meldingen.push("De invoice noemt " + totaalStuksOpInvoice + " stuks in totaal, maar over de " +
        blok.regels.length + " artikelregels geteld zijn het er " + uit.totaalStuks + ".");
    if (!blok.regels.length) uit.meldingen.push("Er is geen enkele artikelregel gevonden op deze proforma.");
    uit.totaalStuksOpInvoice = totaalStuksOpInvoice;
    return uit;
  }


  /* ── RE-BORN (Jepara, Indonesië) en Hangzhou Lodestone ──────────────────
     Twee proforma's in Excel, allebei met een kolomkop die zichzelf benoemt.
     Daarom één lezer met een kolomzoeker ervoor: welke kolom het artikelnummer
     is en welke het aantal, wordt uit de kop gehaald en niet geteld.

     Wat ze onderscheidt van de PDF-vormen (Eurofar en Mibin): hier staat elke
     regel netjes in zijn eigen cel, dus er breekt geen artikelnummer over twee
     regels en er hoeft niets aan x-posities te worden opgehangen.

     Wat ze mét die twee gemeen hebben: hun eigen totaal onderaan. Dat wordt
     ernaast gelegd. Klopt ons aantal daar niet mee, dan komt er een melding -
     bij RE-BORN gebeurt dat ook echt, zie hieronder. */
  /* Een bedrag in Amerikaanse notatie: $60,504.00. De komma is duizendtal en
     de punt is de komma. De bestaande getal() hierboven doet het omgekeerde -
     die is Europees - en maakte van $60,504.00 het getal 60,50. Dat is precies
     het soort fout dat pas bij de jaarrekening opvalt, dus die twee blijven
     gescheiden. Eurofar rekent Europees, RE-BORN en Lodestone Amerikaans. */
  function getalUS(x) {
    var t = String(x == null ? "" : x).replace(/[^0-9.,-]/g, "");
    if (!t) return null;
    t = t.replace(/,/g, "");
    var n = parseFloat(t);
    return isFinite(n) ? n : null;
  }

  var MEUBEL_KOPPEN = {
    art:    /^(article\s*no|item\s*code|art\.?\s*no)$/i,
    aantal: /^(qty\s*\/\s*pcs|order\s*quantity|quantity|qty)$/i,
    oms:    /^(items|description|omschrijving)$/i,
    prijs:  /^(price|usd\s*\/\s*set)$/i,
    bedrag: /^(total|usd\s*\/\s*total|amount)$/i,
    colli:  /^(number\s+of\s+package|packages|ctns)$/i,
  };
  /* De koprij zoeken: de rij waar zowel het artikelnummer als het aantal in
     staat. Bij Lodestone staan de subkoppen (Frame, Cushion, USD/SET) op de
     regel eronder; die telt dus niet mee als koprij en dat gaat vanzelf goed
     omdat daar geen artikelkolom in staat. */
  function meubelKop(rijen) {
    for (var r = 0; r < Math.min(rijen.length, 60); r++) {
      var rij = rijen[r] || [], kol = {};
      for (var c = 0; c < rij.length; c++) {
        var t = schoon(rij[c]);
        if (!t) continue;
        if (kol.art == null    && MEUBEL_KOPPEN.art.test(t))    kol.art = c;
        if (kol.aantal == null && MEUBEL_KOPPEN.aantal.test(t)) kol.aantal = c;
        if (kol.oms == null    && MEUBEL_KOPPEN.oms.test(t))    kol.oms = c;
        if (kol.prijs == null  && MEUBEL_KOPPEN.prijs.test(t))  kol.prijs = c;
        if (kol.bedrag == null && MEUBEL_KOPPEN.bedrag.test(t)) kol.bedrag = c;
        if (kol.colli == null  && MEUBEL_KOPPEN.colli.test(t))  kol.colli = c;
      }
      if (kol.art != null && kol.aantal != null) {
        /* Lodestone zet de subkoppen op de regel eronder: onder FOB staan
           USD/SET en USD/TOTAL, onder Material staan Frame en Cushion. Die
           regel dus meenemen, anders blijven prijs en bedrag leeg. */
        var sub = rijen[r + 1] || [];
        for (var c2 = 0; c2 < sub.length; c2++) {
          var t2 = schoon(sub[c2]);
          if (!t2) continue;
          if (kol.prijs == null  && MEUBEL_KOPPEN.prijs.test(t2))  kol.prijs = c2;
          if (kol.bedrag == null && MEUBEL_KOPPEN.bedrag.test(t2)) kol.bedrag = c2;
        }
        kol.rij = r + (sub.some(function (c3) { return schoon(c3); }) && kol.prijs != null ? 1 : 0);
        return kol;
      }
    }
    return null;
  }
  function isMeubelProformaXlsx(rijen) { return !!meubelKop(rijen); }

  function leesMeubelProformaXlsx(rijen, bestandsnaam) {
    var uit = { fabriek: null, invoiceNo: null, datum: null, referentie: null,
                lds: null, laadhaven: null, containerSoort: null,
                containers: [], meldingen: [] };
    var kol = meubelKop(rijen);
    if (!kol) { uit.meldingen.push("Geen kolomkop met een artikelnummer en een aantal gevonden."); return uit; }

    /* De kop. Alles boven de kolomkop, als één lap tekst - dan maakt het niet
       uit in welke cel iets staat. */
    var kop = rijen.slice(0, kol.rij).map(function (r) { return r.map(schoon).filter(Boolean).join(" "); }).join("\n");
    var m;
    if ((m = kop.match(/^([^\n]*(?:CO\.,?\s*LTD|CV\.\s*[A-Z-]+|LIMITED|IMPORT[^\n]*EXPORT)[^\n]*)$/im))) {
      /* Lodestone zet naam, adres en telefoon in één cel. Alles vanaf ADD: of
         T: hoort niet bij de naam; zonder deze knip staat er een fabrieksnaam
         van tweehonderd tekens in het overzicht. */
      uit.fabriek = schoon(String(m[1]).split(/\s+(?:ADD:|T:|TEL:|Tel:)/)[0]);
    }
    if ((m = kop.match(/\b(?:P\/I|PI)\s*(?:NO|No)\.?\s*[:.]?\s*([A-Za-z0-9\-\/]{3,40})/))) uit.invoiceNo = schoon(m[1]);
    if (!uit.invoiceNo && (m = kop.match(/\bNo\.\s*(PI-[A-Za-z0-9\-\/]{3,40})/i))) uit.invoiceNo = schoon(m[1]);
    if ((m = kop.match(/\b(?:Date|Order date)\s*[:.]?\s*([0-9]{1,4}[-\/][0-9]{1,2}[-\/][0-9]{1,4}|\d{1,2}\s+\w+\s+\d{4})/i))) uit.datum = schoon(m[1]);
    /* Het containerformaat staat bij RE-BORN als "Size of container : 2x40HC"
       en bij Lodestone onderaan als "Total volume: 2x 40HQ". Beide pakken. */
    /* Het containerformaat en de leveringsvoorwaarden staan niet altijd bóven
       de tabel: RE-BORN zet ze in de kop, Lodestone eronder ("Total volume:
       2x 40HQ", "Terms of delivery: FOB Ningbo"). Daarom het hele blad
       afzoeken en niet alleen de kop. */
    var alles = rijen.map(function (r) { return r.map(schoon).filter(Boolean).join(" "); }).join("\n");
    if ((m = alles.match(/(?:Size\s+of\s+container|Total\s+volume)\s*:?\s*([0-9]+\s*x\s*[0-9]+\s*[A-Z]{2,4})/i))) uit.containerSoort = schoon(m[1]);
    if ((m = alles.match(/Terms\s+of\s+delivery\s*:?\s*([^\n]{2,60})/i))) uit.laadhaven = schoon(m[1]);

    var blok = { container: null, containerSoort: uit.containerSoort, regels: [], totaalUsd: null };
    var eigenBedrag = null, eigenColli = null;
    for (var r = kol.rij + 1; r < rijen.length; r++) {
      var rij = rijen[r] || [];
      var eerste = schoon(rij[0] || "");
      var code = schoon(rij[kol.art] || "");
      var aantal = getal(rij[kol.aantal]);

      /* De totaalregel van de fabriek zelf. Die stopt het lezen niet meteen -
         bij Lodestone staan er daarna nog leveringsvoorwaarden - maar we
         onthouden hem om ons eigen aantal ernaast te leggen. */
      /* De totaalregel van de fabriek: "Total" kan in élke kolom staan, bij
         RE-BORN staat hij niet vooraan. Dus de hele rij aftasten. */
      var isTotaal = rij.some(function (c) { return /^(total|grand\s*total|totaal)\b/i.test(schoon(c)); });
      if (isTotaal) {
        /* Let op wélk getal daar staat. Bij RE-BORN is het totaal onder de
           tabel 196, en dat zijn COLLI en geen stuks - de kolom Number of
           Package. Wie dat naast zijn eigen stukstelling van 252 legt denkt dat
           het niet klopt, terwijl allebei kloppen. Het bedrag is het enige dat
           met zekerheid over hetzelfde gaat, dus daar wordt op vergeleken. */
        if (kol.bedrag != null) {
          var b = getalUS(rij[kol.bedrag]);
          if (b && (eigenBedrag == null || b > eigenBedrag)) eigenBedrag = b;
        }
        if (kol.colli != null) {
          var cc = getalUS(rij[kol.colli]);
          if (cc && (eigenColli == null || cc > eigenColli)) eigenColli = cc;
        }
        continue;
      }
      if (!code || aantal == null || !(aantal > 0)) continue;
      // Een code moet op zijn minst een letter en een cijfer hebben.
      if (!/[A-Za-z]/.test(code) || !/\d/.test(code)) continue;

      blok.regels.push({
        artNo: code,
        omschrijving: schoon(rij[kol.oms] || "") || null,
        aantal: aantal, aantalOpInvoice: aantal,
        colli: kol.colli != null ? getal(rij[kol.colli]) : null,
        prijsUsd: kol.prijs != null ? getalUS(rij[kol.prijs]) : null,
        bedragUsd: kol.bedrag != null ? getalUS(rij[kol.bedrag]) : null,
        uitvoering: [], onderdelen: [],
      });
    }
    if (!blok.regels.length) uit.meldingen.push("Er is geen enkele artikelregel gevonden op deze proforma.");
    uit.containers.push(blok);

    /* Ons aantal tegen dat van de fabriek. Bij RE-BORN loopt dat uiteen omdat
       dezelfde meubels er twee keer in staan, een keer met codes als K24130 en
       een keer met K24130-FTN-CRM-01. Die vraag ligt bij Don; zolang die niet
       beantwoord is moet het verschil zichtbaar blijven en niet stilletjes
       worden weggerekend. */
    var onsTotaal  = blok.regels.reduce(function (n, x) { return n + (x.aantal || 0); }, 0);
    var onsBedrag  = blok.regels.reduce(function (n, x) { return n + (x.bedragUsd || 0); }, 0);
    var onsColli   = blok.regels.reduce(function (n, x) { return n + (x.colli || 0); }, 0);
    uit.totaalStuks = onsTotaal;
    uit.totaalColli = onsColli || null;
    uit.totaalUsd = Math.round(onsBedrag * 100) / 100;
    blok.totaalUsd = uit.totaalUsd;
    uit.bedragOpInvoice = eigenBedrag;
    uit.colliOpInvoice = eigenColli;
    /* Op het bedrag vergelijken, niet op de aantallen: dat is het enige getal
       waarvan zeker is dat het over hetzelfde gaat. */
    if (eigenBedrag != null && onsBedrag > 0 && Math.abs(eigenBedrag - onsBedrag) > 0.5) {
      uit.meldingen.push("Wij tellen " + uit.totaalUsd.toFixed(2) + " dollar, de proforma noemt " +
                         eigenBedrag.toFixed(2) + ". Controleer de regels voordat dit als voorraad meetelt.");
    }
    if (!uit.invoiceNo && bestandsnaam) uit.invoiceNo = String(bestandsnaam).replace(/\.[a-z]+$/i, "").slice(0, 40);
    return uit;
  }

  global.fpMeubelInvoice = { lees: lees, isMeubelInvoice: isMeubelInvoice, kolommen: kolommen,
                             leesEurofar: leesEurofar, isEurofar: isEurofar,
                             isMeubelProformaXlsx: isMeubelProformaXlsx,
                             leesMeubelProformaXlsx: leesMeubelProformaXlsx,
                             containersUitPacking: containersUitPacking,
                             leesBillOfLading: leesBillOfLading, koppelContainers: koppelContainers };

})(typeof window !== "undefined" ? window : globalThis);
