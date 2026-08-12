/* ═══════════════════════════════════════════════════════════════════════════
   COMMERCIAL INVOICE + PACKING LIST uit een PDF lezen
   ═══════════════════════════════════════════════════════════════════════════

   Waarom
   ------
   Fabrieken sturen hun commercial invoice net zo vaak als PDF als in Excel.
   De tegel weigerde een PDF met de boodschap "vraag om een Excel-bestand".
   Bij MEXDA (Foshan Gaoming Yuehua) is die Excel er simpelweg niet: zij
   sturen alleen PDF. Chantal kan daardoor drie containers niet inlezen
   (8 aug 2026).

   Hoe de bladzijde eruitziet
   -------------------------
   Een regel staat niet op één tekstregel. De code staat boven de getallen en
   de omschrijving eronder:

       WS-PC08T
                    1        21852       21852
       with roller shutter

   Daarom wordt er niet regel voor regel gelezen maar op getallenregels
   gezocht: een regel met alleen getallen is een tabelregel, en het label
   staat op de regel ervoor plus de regel erna. Dat werkt ook bij regels
   zonder code ("Control panel for" / "saunas").

   Aantal getallen zegt om welke tabel het gaat:
     3 getallen  = commercial invoice (aantal, stuksprijs, bedrag)
     5 getallen  = packing list (aantal, dozen, m3, netto, bruto)

   Wat er nog meer uit komt
   ------------------------
   De twee tabellen worden náást elkaar gelegd. Bij twee van de drie
   containers van 30 juli 2026 spraken ze elkaar tegen (factuur 4 sauna's,
   pakbon 2). Dat hoort niet stil te blijven: wie voorraad telt op basis van
   dit document moet dat eerst uitzoeken.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  // Fabriekscodes zoals ze op deze documenten staan: WS-PC08T, WA-1101B,
  // WS-1103A. Bewust smal gehouden; een losse "DYNAMIC" is een modelnaam in
  // een omschrijving en geen artikelcode.
  // Let op de staart: WS-PC07A-T is één code, niet WS-PC07A. Zonder het
  // tweede streepje leest het dashboard een ander model dan er staat.
  var CODE = /\b(W[SA]-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/i;

  function schoon(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

  // Getallen uit een regel. Duizendscheidingstekens komen op deze documenten
  // niet voor; decimalen wel (m3 = 0.01).
  function getallen(regel) {
    var m = schoon(regel).match(/-?\d+(?:[.,]\d+)?/g);
    return m ? m.map(function (x) { return parseFloat(x.replace(",", ".")); }) : [];
  }
  function alleenGetallen(regel) {
    var s = schoon(regel);
    if (!s) return false;
    return /^[\d\s.,]+$/.test(s) && getallen(s).length > 0;
  }

  // ─── Kopgegevens ────────────────────────────────────────────────────
  function kop(regels) {
    var alles = regels.join("\n");
    var uit = { leverancier: null, invoiceNo: null, datum: null, container: null, seal: null, incoterm: null };
    var m;
    if ((m = alles.match(/Invoice\s*No\.?\s*:?\s*([A-Za-z0-9\-\/]{3,40})/i))) uit.invoiceNo = m[1];
    if ((m = alles.match(/Date\s*:\s*(?:Date\s*:\s*)?(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/i)))
      uit.datum = m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
    if ((m = alles.match(/CONTAINER\s*NO\.?\s*:?\s*([A-Z]{4}\d{6,7})/i))) uit.container = m[1].toUpperCase();
    if ((m = alles.match(/SEAL\s*NO\.?\s*:?\s*([A-Z0-9]{4,20})/i))) uit.seal = m[1].toUpperCase();
    if ((m = alles.match(/\((FOB|CIF|EXW|DAP|DDP)\s+([A-Z ]{3,20})\)/i))) uit.incoterm = schoon(m[1] + " " + m[2]);
    // De afzender staat bovenaan, vóór het woord "COMMERCIAL INVOICE".
    for (var i = 0; i < Math.min(regels.length, 12); i++) {
      var r = schoon(regels[i]);
      if (/CO\.,?\s*LTD|B\.V\.|GMBH|LIMITED/i.test(r) && !/FONTEYN/i.test(r)) { uit.leverancier = r; break; }
    }
    return uit;
  }

  // ─── Tabelregels ────────────────────────────────────────────────────
  // Loopt de bladzijde door en pakt elke getallenregel op met het label
  // eromheen. `velden` bepaalt welke tabel we lezen.
  function tabel(regels, aantalGetallen) {
    var uit = [];
    var sectie = null;
    for (var i = 0; i < regels.length; i++) {
      var r = schoon(regels[i]);
      if (!r) continue;
      if (/^(OUTDOOR SPA|SAUNA ROOM|PARTS|ACCESSORIES)$/i.test(r)) { sectie = r.toUpperCase(); continue; }
      // De totaalregel telt niet mee als artikelregel.
      if (/^TOTAL\b/i.test(r)) continue;
      if (!alleenGetallen(r)) continue;
      var g = getallen(r);
      if (g.length !== aantalGetallen) continue;

      // Label: de regel ervoor en de regel erna, samen. Kopregels en de
      // sectienaam slaan we daarbij over.
      //
      // "FONTEYN SPAS" is de merktekst uit de linkerkolom en staat regelmatig
      // op dezelfde hoogte als de artikelcode ("FONTEYN SPAS   WS-1103A").
      // Die regel helemaal overslaan kostte de code; alleen de merktekst
      // wegpoetsen houdt hem heel.
      var voor = "", na = "";
      for (var v = i - 1; v >= 0 && v > i - 4; v--) {
        var s1 = schoon(String(regels[v]).replace(/FONTEYN\s+SPAS/ig, " "));
        if (!s1 || alleenGetallen(s1) || /^(OUTDOOR SPA|SAUNA ROOM|PARTS|ACCESSORIES)$/i.test(s1)) continue;
        if (/MARKS|DESCRIPTION|CONTAINER NO|SEAL NO|QTY\(|Invoice no/i.test(s1)) continue;
        voor = s1; break;
      }
      for (var w = i + 1; w < regels.length && w < i + 3; w++) {
        var s2 = schoon(String(regels[w]).replace(/FONTEYN\s+SPAS/ig, " "));
        if (!s2 || alleenGetallen(s2) || /^(OUTDOOR SPA|SAUNA ROOM|PARTS|ACCESSORIES)$/i.test(s2)) continue;
        if (/TOTAL|Authorized|Confirmed/i.test(s2)) continue;
        na = s2; break;
      }
      var label = schoon(voor + " " + na);
      var cm = label.match(CODE);
      uit.push({
        code: cm ? cm[1].toUpperCase() : null,
        omschrijving: label,
        sectie: sectie,
        getallen: g,
      });
    }
    return uit;
  }

  // ─── De bladzijde als geheel ────────────────────────────────────────
  // Het document bevat twee documenten onder elkaar: eerst de commercial
  // invoice, daarna de packing list. We knippen op het woord PACKING LIST.
  function lees(regels) {
    var knip = -1;
    for (var i = 0; i < regels.length; i++)
      if (/PACKING\s*LIST/i.test(regels[i])) { knip = i; break; }
    var deelCI = knip >= 0 ? regels.slice(0, knip) : regels;
    var deelPL = knip >= 0 ? regels.slice(knip) : [];

    var k = kop(regels);
    var ci = tabel(deelCI, 3).map(function (r) {
      return { code: r.code, omschrijving: r.omschrijving, sectie: r.sectie,
               aantal: r.getallen[0], prijsUsd: r.getallen[1], bedragUsd: r.getallen[2] };
    });
    var pl = tabel(deelPL, 5).map(function (r) {
      return { code: r.code, omschrijving: r.omschrijving, sectie: r.sectie,
               aantal: r.getallen[0], dozen: r.getallen[1], m3: r.getallen[2],
               nettoKg: r.getallen[3], brutoKg: r.getallen[4] };
    });

    // Factuur en pakbon naast elkaar. Een verschil is geen detail: wie hierop
    // voorraad telt, telt anders het verkeerde aantal.
    var verschillen = [];
    var perCode = {};
    ci.forEach(function (r) { if (r.code) perCode[r.code] = perCode[r.code] || {}; if (r.code) perCode[r.code].ci = r; });
    pl.forEach(function (r) { if (r.code) perCode[r.code] = perCode[r.code] || {}; if (r.code) perCode[r.code].pl = r; });
    Object.keys(perCode).forEach(function (code) {
      var p = perCode[code];
      if (p.ci && !p.pl) verschillen.push({ code: code, wat: "staat wel op de factuur maar niet op de pakbon", ci: p.ci.aantal, pl: null });
      else if (!p.ci && p.pl) verschillen.push({ code: code, wat: "staat wel op de pakbon maar niet op de factuur", ci: null, pl: p.pl.aantal });
      else if (p.ci && p.pl && Number(p.ci.aantal) !== Number(p.pl.aantal))
        verschillen.push({ code: code, wat: "factuur zegt " + p.ci.aantal + ", pakbon zegt " + p.pl.aantal, ci: p.ci.aantal, pl: p.pl.aantal });
    });

    return {
      leverancier: k.leverancier, invoiceNo: k.invoiceNo, datum: k.datum,
      container: k.container, seal: k.seal, incoterm: k.incoterm,
      regels: ci, packing: pl, verschillen: verschillen,
      totaalStuks: ci.reduce(function (n, r) { return n + (Number(r.aantal) || 0); }, 0),
      totaalUsd: Math.round(ci.reduce(function (n, r) { return n + (Number(r.bedragUsd) || 0); }, 0) * 100) / 100,
    };
  }

  // ─── PDF → regels ───────────────────────────────────────────────────
  // Zelfde aanpak als in de douanetegel: pdf.js geeft losse tekstblokjes met
  // een x/y, en alles wat op (ongeveer) dezelfde hoogte staat is één regel.
  async function uitPdf(bestand) {
    if (!global.pdfjsLib) throw new Error("de pdf-lezer is niet geladen");
    var buf = await bestand.arrayBuffer();
    var pdf = await global.pdfjsLib.getDocument({ data: buf }).promise;
    var regels = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var content = await page.getTextContent();
      var pts = [];
      for (var i = 0; i < content.items.length; i++) {
        var it = content.items[i];
        if (!it.str || !it.str.trim()) continue;
        pts.push({ y: it.transform[5], x: it.transform[4], str: it.str });
      }
      pts.sort(function (a, b) { return b.y - a.y; });
      var groepen = [];
      for (var j = 0; j < pts.length; j++) {
        var g = groepen[groepen.length - 1];
        if (g && Math.abs(g.y - pts[j].y) <= 3.0) { g.items.push(pts[j]); }
        else groepen.push({ y: pts[j].y, items: [pts[j]] });
      }
      for (var k2 = 0; k2 < groepen.length; k2++) {
        groepen[k2].items.sort(function (a, b) { return a.x - b.x; });
        regels.push(groepen[k2].items.map(function (x) { return x.str; }).join(" "));
      }
    }
    return regels;
  }

  /* Dezelfde bladzijde, maar mét de x-positie van elk stukje tekst. Nodig
     zodra een leverancier een echte tabel gebruikt en twee kolommen naast
     elkaar doorlopen - dan is een platte regel niet meer te ontleden. */
  async function uitPdfKolommen(bestand) {
    if (!global.pdfjsLib) throw new Error("de pdf-lezer is niet geladen");
    var buf = await bestand.arrayBuffer();
    var pdf = await global.pdfjsLib.getDocument({ data: buf }).promise;
    var rijen = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var content = await page.getTextContent();
      var pts = [];
      for (var i = 0; i < content.items.length; i++) {
        var it = content.items[i];
        if (!it.str || !it.str.trim()) continue;
        // De breedte erbij: nodig om te zien of twee stukjes tekst aan
        // elkaar vast zaten of dat er een spatie tussen hoort.
        pts.push({ y: it.transform[5], x: it.transform[4], breedte: it.width || 0, str: it.str });
      }
      pts.sort(function (a, b) { return b.y - a.y; });
      var groepen = [];
      for (var j = 0; j < pts.length; j++) {
        var g = groepen[groepen.length - 1];
        if (g && Math.abs(g.y - pts[j].y) <= 3.0) g.items.push(pts[j]);
        else groepen.push({ y: pts[j].y, items: [pts[j]] });
      }
      for (var k = 0; k < groepen.length; k++) {
        groepen[k].items.sort(function (a, b) { return a.x - b.x; });
        rijen.push({ bladzijde: p, y: groepen[k].y, items: groepen[k].items });
      }
    }
    return rijen;
  }

  /* Eén ingang voor een PDF-bestand: hij kijkt zelf welk soort het is en
     kiest de lezer. Zo hoeft geen enkele tegel te weten welke fabriek welk
     formaat stuurt. */
  async function leesBestand(bestand) {
    var rijen = await uitPdfKolommen(bestand);
    var regels = rijen.map(function (r) {
      return r.items.map(function (i) { return i.str; }).join(" ");
    });
    if (soortVan(regels) === "topia") return leesTopia(rijen);
    return leesAuto(regels);
  }

  // ─── Tweede soort: de proforma van Huantong ─────────────────────────
  // Heel andere bladzijde dan een commercial invoice. Per spa staat er een
  // blok van soms twintig regels: de standaarduitvoering, daaronder de
  // opties, en links ernaast de maat en de kleuren. Elk blok sluit af met
  // "Total Price", en dat is het enige betrouwbare scheidingsteken.
  //
  // Chantal heeft gezegd wat ze eruit nodig heeft (8 aug 2026): de Item Name,
  // de Shell Color uit de Picture-kolom, en de Quantity.
  //
  // Het aantal staat op élke optieregel opnieuw en is telkens hetzelfde - 21
  // spa's, 21 covers, 21 blowers. We nemen daarom het aantal dat het vaakst
  // voorkomt in het blok en niet het eerste of het hoogste; bij een blok waar
  // één optie op een afwijkend aantal staat blijft dat dan goed gaan.
  function leesProforma(regels) {
    var alles = regels.join("\n");
    var uit = { leverancier: null, invoiceNo: null, datum: null, regels: [], soort: "proforma" };
    var m;
    if ((m = alles.match(/PI\s*No\.?\s*:?\s*([A-Za-z0-9\- ]{3,40})/i))) uit.invoiceNo = schoon(m[1]);
    if ((m = alles.match(/Date\s*:?\s*(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/i)))
      uit.datum = m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
    if ((m = alles.match(/^\s*([A-Z][A-Z .,&\']{6,60}CO\.,?\s*LTD)/im))) uit.leverancier = schoon(m[1]);
    if ((m = alles.match(/Other\s*:\s*\((\d+)\s*Containers?\)/i))) uit.containers = Number(m[1]);

    // In blokken hakken op "Total Price".
    var blokken = [], huidig = [];
    for (var i = 0; i < regels.length; i++) {
      huidig.push(regels[i]);
      if (/Total\s*Price\s*:/i.test(regels[i])) { blokken.push(huidig); huidig = []; }
    }
    if (huidig.length) blokken.push(huidig);

    for (var b = 0; b < blokken.length; b++) {
      var blok = blokken[b];
      var naam = null, shell = null, skirt = null, maat = null;
      var tellingen = {}, prijzen = {}, bedragen = [];
      for (var j = 0; j < blok.length; j++) {
        var r = String(blok[j]);
        // De kolom "No. / Item Name": een klein nummer, dan witruimte, dan de naam.
        if (!naam) {
          var mn = r.match(/^\s{0,8}(\d{1,2})\s{2,}(\S[^\s].{0,40}?)(?:\s{2,}|$)/);
          if (mn && !/^\d/.test(mn[2])) naam = schoon(mn[2]);
        }
        if (!shell && (m = r.match(/Shell\s*Colou?r\s*:?\s*([^\n]{1,40}?)(?:\s{2,}|$)/i))) shell = schoon(m[1]);
        if (!skirt && (m = r.match(/Skirt\s*Colou?r\s*:?\s*([^\n]{1,40}?)(?:\s{2,}|$)/i))) skirt = schoon(m[1]);
        if (!maat && (m = r.match(/Size\s*:?\s*([\d]{3,4}\s*[*x×]\s*[\d]{3,4}\s*[*x×]\s*[\d]{3,4})\s*mm?/i))) maat = schoon(m[1]).replace(/\s/g, "");
        // Een regel met aantal, stuksprijs en bedrag aan het eind.
        var mq = r.match(/(\d{1,4})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/);
        if (mq && !/Total\s*Price/i.test(r)) {
          var q = Number(mq[1]);
          if (q > 0 && q < 5000) {
            tellingen[q] = (tellingen[q] || 0) + 1;
            if (!prijzen[q] || Number(mq[3]) > prijzen[q].bedrag) prijzen[q] = { prijs: Number(mq[2]), bedrag: Number(mq[3]) };
            bedragen.push(Number(mq[3]));
          }
        }
      }
      if (!naam || !Object.keys(tellingen).length) continue;
      // Het aantal dat het vaakst terugkomt is het aantal spa\'s.
      var beste = null;
      for (var q2 in tellingen) if (beste === null || tellingen[q2] > tellingen[beste] ||
          (tellingen[q2] === tellingen[beste] && Number(q2) > Number(beste))) beste = q2;
      var aantal = Number(beste);
      var hoofd = prijzen[aantal] || {};
      uit.regels.push({
        code: naam, omschrijving: naam, aantal: aantal,
        kleur: shell || null, skirt: skirt || null, afmeting: maat || null,
        prijsUsd: hoofd.prijs || null,
        // Alles wat op dit blok is gefactureerd, dus inclusief de opties.
        bedragUsd: Math.round(bedragen.reduce(function (n, x) { return n + x; }, 0) * 100) / 100,
      });
    }
    uit.totaalStuks = uit.regels.reduce(function (n, r) { return n + (Number(r.aantal) || 0); }, 0);
    uit.totaalUsd = Math.round(uit.regels.reduce(function (n, r) { return n + (Number(r.bedragUsd) || 0); }, 0) * 100) / 100;
    uit.packing = []; uit.verschillen = [];
    return uit;
  }

  /* ─── Streepjes rechtzetten ───────────────────────────────────────────────
     pdf.js knipt tekst op waar de letterafstand verspringt. Bij MEXDA en
     Kasdaly valt het streepje in een code daardoor los: "WS - S06M" in plaats
     van "WS-S06M", en "VIGOR20210805 - 0601". Zonder dit herkent geen enkele
     codelijst er nog iets in. */
  function koppel(s) {
    return schoon(s).replace(/([A-Za-z0-9])\s+-\s+([A-Za-z0-9])/g, "$1-$2");
  }
  // Woorden waaraan een uitvoering te herkennen is. Alleen om te kiezen welke
  // regel uit de omschrijving de kleur is; er wordt niets mee omgezet.
  var KLEURWOORD = /\b(white|black|grey|gray|silver|marble|sterling|blue|brown|beige|ivory|aspen|cedar|hemlock|stone|acrylic)\b/i;

  // "$11,169.4" en "22,044.6" -> 11169.4 en 22044.6
  function bedrag(s) {
    var n = parseFloat(String(s == null ? "" : s).replace(/[^\d.,-]/g, "").replace(/,/g, ""));
    return isFinite(n) ? n : null;
  }

  /* ─── Derde soort: de proforma van MEXDA ──────────────────────────────────
     Een echte tabel: MODEL | DESCRIPTIONS | QTY | UNIT PRICE | AMOUNT. De code
     en de getallen staan op dezelfde regel, met de maat op de regel erboven en
     de uitvoering eronder:

         Size: 2000*1700*2100mm
         DO-1102B          1      2038     2038
         Aspen + white stone (short panel)

     Dat er drie getallen achteraan staan is niet genoeg om zeker te zijn dat
     het een artikelregel is - een telefoonnummer of een bankrekening kan er
     ook zo uitzien. Daarom moet aantal x stuksprijs ook uitkomen op het
     bedrag; dan blijft er niets anders over dan een echte regel.

     De blokken PARTS en ACCESSORIES leveren geen artikelcode op. Daar staat
     "Grey side panel for WS-S06M" en dat is een paneel voor die spa, niet die
     spa - als code overnemen zou een spa bijbestellen die niemand besteld heeft. */
  function leesMexdaProforma(regels) {
    var L = regels.map(koppel);
    var alles = L.join("\n");
    var uit = { leverancier: null, invoiceNo: null, datum: null, regels: [], soort: "proforma" };
    var m;
    if ((m = alles.match(/INVOICE\s*NO\.?\s*:?\s*([A-Za-z0-9\-\/]{4,40})/i))) uit.invoiceNo = m[1];
    if ((m = alles.match(/DATE\s*:\s*(\d{1,2})\s*(?:th|st|nd|rd)?\s*,?\s*([A-Za-z]{3,9})\s*,?\s*(\d{4})/i)))
      uit.datum = schoon(m[1] + " " + m[2] + " " + m[3]);
    if ((m = alles.match(/SELLER\s*:\s*([^\n]{5,80})/i))) uit.leverancier = schoon(m[1]);

    var sectie = null, laatsteMaat = null;
    for (var i = 0; i < L.length; i++) {
      var r = L[i];
      if (!r) continue;
      if (/^(SWIMMING\s*POOL|SWIM\s*SPA|SPA|SAUNA|PARTS|ACCESSOR\w*)$/i.test(r)) { sectie = r.toUpperCase(); continue; }
      if ((m = r.match(/Size\s*:?\s*(\d{3,4}\s*[*x×]\s*\d{3,4}\s*[*x×]\s*\d{3,4})/i))) {
        laatsteMaat = m[1].replace(/\s/g, ""); continue;
      }
      if (/^TOTAL\b/i.test(r)) continue;
      var mr = r.match(/^(.+?)\s+(\d{1,4})\s+([\d.,]+)\s+([\d.,]+)$/);
      if (!mr) continue;
      var aantal = Number(mr[2]), prijs = bedrag(mr[3]), bed = bedrag(mr[4]);
      if (!(aantal > 0) || !(prijs > 0) || !(bed > 0)) continue;
      // Klopt aantal x stuksprijs met het bedrag? Zo niet, dan is dit geen
      // artikelregel maar een toevallige rij getallen.
      if (Math.abs(aantal * prijs - bed) > Math.max(1, bed * 0.02)) continue;

      var voorkant = schoon(mr[1]);
      var deel = sectie && /PART|ACCESSOR/i.test(sectie);
      var mc = deel ? null : voorkant.match(/^([A-Z]{1,3}-?[A-Z]?\d[\w-]*)/i);

      /* De uitvoering staat bij een sauna op de regel eronder ("Aspen + white
         stone"), maar bij een swimspa in de genummerde opsomming erboven
         ("1.Chinese white acrylic", "2.Grey side panel").

         Bij PARTS wordt de regel eronder alleen meegenomen als de voorkant
         kort is. "SIDE PANEL Grey side panel for WS-S06M" beschrijft zichzelf
         al; de regel eronder ("For WS-1102A") hoort bij de BACKREST daaronder
         en die stond er in de PDF alleen bóven omdat die rij hoger is. */
      var onder = "";
      if (!deel || voorkant.length < 20) {
        for (var w = i + 1; w < L.length && w < i + 3; w++) {
          var s2 = L[w];
          if (!s2 || /^Size\s*:/i.test(s2) || /^(TOTAL|PARTS|SAUNA|SWIMMING)/i.test(s2)) continue;
          if (/^(.+?)\s+\d{1,4}\s+[\d.,]+\s+[\d.,]+$/.test(s2)) break;   // volgende artikelregel
          onder = s2; break;
        }
      }
      var boven = [];
      for (var v2 = i - 1; v2 >= 0 && v2 > i - 9; v2--) {
        var s3 = L[v2];
        if (!s3) continue;
        if (/^(.+?)\s+\d{1,4}\s+[\d.,]+\s+[\d.,]+$/.test(s3)) break;      // vorige artikelregel
        if (/^(SWIMMING\s*POOL|SWIM\s*SPA|SPA|SAUNA|PARTS|ACCESSOR\w*)$/i.test(s3)) break;
        if (/^Size\s*:/i.test(s3)) continue;
        boven.unshift(schoon(s3.replace(/^\s*\d{1,2}\s*[.)]\s*/, "")));
      }
      /* De regel eronder gaat vóór de opsomming erboven. Twee sauna's van
         hetzelfde model verschillen alleen in hun uitvoering, en die staat
         eronder: bij de tweede stond anders de kleur van de eerste, want die
         regel ligt er nog net boven ("Aspen + white stone" bij de zwarte). */
      var kleur = null, skirtKleur = null;
      if (onder && KLEURWOORD.test(onder) && !/\+\s*USD/i.test(onder)) kleur = onder;
      for (var q = 0; q < boven.length; q++) {
        var mp = boven[q].match(/^(.*?)\s*side\s*panel/i);
        if (mp && !skirtKleur) { skirtKleur = schoon(mp[1]) || null; continue; }
        if (!kleur && KLEURWOORD.test(boven[q]) && !/\+\s*USD/i.test(boven[q])) kleur = boven[q];
      }
      if (!kleur && onder) kleur = onder;

      uit.regels.push({
        code: mc ? mc[1].toUpperCase() : null,
        omschrijving: schoon(voorkant + (kleur ? " · " + kleur : "")),
        sectie: sectie, aantal: aantal,
        kleur: kleur || null, skirt: skirtKleur,
        afmeting: deel ? null : laatsteMaat,
        prijsUsd: prijs, bedragUsd: bed,
      });
      if (!deel) laatsteMaat = null;   // een maat hoort bij één regel
    }
    uit.totaalStuks = uit.regels.reduce(function (n, r) { return n + (Number(r.aantal) || 0); }, 0);
    uit.totaalUsd = Math.round(uit.regels.reduce(function (n, r) { return n + (Number(r.bedragUsd) || 0); }, 0) * 100) / 100;
    uit.packing = []; uit.verschillen = [];
    return uit;
  }

  /* ─── Vierde soort: de proforma van Kasdaly (JOYSPA) ──────────────────────
     Geen tabel maar een specificatieblad per model. Elk blok begint met
     "Model: JY8603" en verderop in datzelfde blok staan de maat, de prijs en
     het aantal, elk aan het eind van een regel die verder over iets anders
     gaat - de linkerkolom loopt gewoon door:

         Model: JY8603                       Main components          Options
         Size:4180*2200*1430mm   FOB Shenzhen : $5087.2   ...
         Drainer                             Quantity needed(set)     2
         Stainless steel stand               Amount(USD)              $11,169.4

     Als stuksprijs wordt "Total price with options" genomen en niet de kale
     FOB-prijs: die eerste is wat er daadwerkelijk gefactureerd wordt, en
     aantal x die prijs komt precies uit op het bedrag.

     De kleur staat één keer onderaan voor de hele zending ("All spa color is
     Sterling White shell and grey cabinet"), niet per regel. */
  function leesJoyspa(regels) {
    var L = regels.map(koppel);
    var alles = L.join("\n");
    var uit = { leverancier: null, invoiceNo: null, datum: null, regels: [], soort: "proforma" };
    var m;
    if ((m = alles.match(/PI\s*NO\.?\s*:?\s*([A-Za-z0-9\-\/]{4,40})/i))) uit.invoiceNo = m[1];
    if ((m = alles.match(/Date\s*:\s*([\d]{1,2}\s*,?\s*[A-Za-z]{3,9}\.?\s*,?\s*\d{4})/i))) uit.datum = schoon(m[1]);
    for (var h = 0; h < Math.min(L.length, 6); h++)
      if (/CO\.,?\s*LTD/i.test(L[h]) && !/FONTEYN|PASSION/i.test(L[h])) { uit.leverancier = schoon(L[h]); break; }

    var shell = null, skirt = null;
    if ((m = alles.match(/All\s+spa\s+colou?r\s+is\s+([^\n.]+)/i))) {
      var kl = schoon(m[1]);
      var ms = kl.match(/^(.*?)\s*shell/i); if (ms) shell = schoon(ms[1]);
      var mk = kl.match(/and\s+(.*?)\s*cabinet/i); if (mk) skirt = schoon(mk[1]);
    }

    // Waar begint elk blok? Bij "Model: <code>".
    var starts = [];
    for (var i = 0; i < L.length; i++) if (/^Model\s*:\s*\S/i.test(L[i])) starts.push(i);
    for (var b = 0; b < starts.length; b++) {
      var van = starts[b], tot = (b + 1 < starts.length) ? starts[b + 1] : L.length;
      var blok = L.slice(van, tot).join("\n");
      var code = (blok.match(/^Model\s*:\s*([A-Za-z0-9\-]+)/i) || [])[1];
      if (!code) continue;
      var aantal = bedrag((blok.match(/Quantity\s+needed[^\n]*?\(set\)\s*([\d.,]+)/i) || [])[1]);
      if (!(aantal > 0)) continue;
      var metOpties = bedrag((blok.match(/Total\s+price\s+with\s+options\s*\$?\s*([\d.,]+)/i) || [])[1]);
      var fob = bedrag((blok.match(/FOB[^:\n]*:\s*\$?\s*([\d.,]+)/i) || [])[1]);
      var bed = bedrag((blok.match(/Amount\s*\(USD\)\s*\$?\s*([\d.,]+)/i) || [])[1]);
      var maat = (blok.match(/Size\s*:?\s*(\d{3,4}\s*\*\s*\d{3,4}\s*\*\s*\d{3,4})/i) || [])[1];
      uit.regels.push({
        code: code.toUpperCase(),
        omschrijving: code.toUpperCase() + (maat ? " · " + maat.replace(/\s/g, "") : ""),
        sectie: null, aantal: aantal,
        kleur: shell, skirt: skirt,
        afmeting: maat ? maat.replace(/\s/g, "") : null,
        prijsUsd: metOpties || fob || null,
        bedragUsd: bed || (metOpties ? Math.round(metOpties * aantal * 100) / 100 : null),
      });
    }
    uit.totaalStuks = uit.regels.reduce(function (n, r) { return n + (Number(r.aantal) || 0); }, 0);
    uit.totaalUsd = Math.round(uit.regels.reduce(function (n, r) { return n + (Number(r.bedragUsd) || 0); }, 0) * 100) / 100;
    uit.packing = []; uit.verschillen = [];
    return uit;
  }

  /* ─── Vijfde soort: het sales contract van TOPIA (tuinmeubelen) ──────────
     Geen spa's maar tuinsets, en de eerste leverancier die met een echte
     tabel werkt: Picture | Your Art. No. | Commodity | Description | Colour |
     Packing | QTY | Unit | Unit Price | Amount | Shipping Window.

     Dat maakt hem makkelijker én lastiger. Makkelijker omdat "Your Art. No."
     ons eigen artikelnummer is (151106.01) - er hoeft niets geraden te worden
     aan modelnamen. Lastiger omdat omschrijving en kleur naast elkaar staan
     en allebei over een stuk of tien regels doorlopen. Op één platte regel
     zijn die twee niet meer uit elkaar te houden:

         "1x 3-seater: W.240 x D.88 x H.55cm   flash, code: S-C127"

     Daarom leest deze niet de platte regels maar de x-posities: uit de
     koprij komt waar elke kolom begint, en elk stukje tekst gaat naar de
     kolom waar het onder valt.

     Chantal (12 aug 2026): Contract no = factuurnummer, Your art. = artikel,
     Colour = kleur, Qty = aantal. De kleur is bij deze fabriek geen woord
     maar een specificatie van drie regels (poedercoating, stof, touw), en die
     gaat op verzoek van Gerrit helemaal mee. */
  var TOPIA_KOLOMMEN = [
    { sleutel: "art",     test: /^Your\s*Art/i },
    { sleutel: "artikel", test: /^\(Our\s*Art/i },
    { sleutel: "naam",    test: /^Commodity$/i },
    { sleutel: "oms",     test: /^Description$/i },
    { sleutel: "kleur",   test: /^Colou?r$/i },
    { sleutel: "packing", test: /^Packing$/i },
    { sleutel: "aantal",  test: /^QTY$/i },
    { sleutel: "eenheid", test: /^Unit$/i },
    { sleutel: "prijs",   test: /^Unit\s*Price$/i },
    { sleutel: "bedrag",  test: /^Amount$/i },
    { sleutel: "venster", test: /^Shipping$/i },
  ];
  /* Waar begint welke kolom?

     Niet af te leiden uit de koppen. Die staan gecentreerd bóven hun kolom
     terwijl de inhoud links uitlijnt, en ze lopen over drie regels heen
     ("Your Art. No." staat een regel hoger dan "Commodity"). "Description"
     staat op x=298 terwijl de omschrijvingen zelf op x=230 beginnen - op de
     koppen afgaan zet de halve tabel in de verkeerde kolom.

     Wat wél klopt: de eerste artikelregel. Die heeft in elke kolom precies
     één waarde staan, dus daar zijn de linkerranden af te lezen. De koppen
     zeggen alleen nog wélke kolom wat is: op volgorde van links naar rechts.

     Voorwaarde is dat losse stukjes tekst eerst aan elkaar geplakt worden.
     pdf.js hakt "18" in "1" en "8" en "$1,452.00" in vijf stukjes; zonder
     plakken zou "8" in de kolom ernaast belanden. */
  function topiaTokens(items) {
    var uit = [];
    for (var i = 0; i < items.length; i++) {
      var vorige = uit[uit.length - 1];
      var breedte = items[i].breedte || items[i].str.length * 4.2;
      if (vorige && items[i].x - vorige.eind <= 2) {
        vorige.str += items[i].str; vorige.eind = items[i].x + breedte;
      } else {
        uit.push({ x: items[i].x, eind: items[i].x + breedte, str: items[i].str });
      }
    }
    return uit;
  }
  function topiaKolommen(rijen) {
    // 1. De koppen opzoeken, over een venster van drie regels.
    var koprij = -1, koppen = null;
    for (var i = 0; i < rijen.length && koprij < 0; i++) {
      var gevonden = {};
      for (var w = i; w < Math.min(i + 3, rijen.length); w++)
        for (var j = 0; j < rijen[w].items.length; j++)
          for (var k = 0; k < TOPIA_KOLOMMEN.length; k++)
            if (gevonden[TOPIA_KOLOMMEN[k].sleutel] == null &&
                TOPIA_KOLOMMEN[k].test.test(schoon(rijen[w].items[j].str)))
              gevonden[TOPIA_KOLOMMEN[k].sleutel] = rijen[w].items[j].x;
      if (gevonden.art != null && gevonden.kleur != null && gevonden.aantal != null) {
        koprij = i + 2; koppen = gevonden;
      }
    }
    if (koprij < 0) return null;
    // De kolom met het artikelnummer tussen haakjes staat onder de eerste en
    // is dezelfde kolom; die telt hier niet apart mee.
    delete koppen.artikel;
    var volgorde = Object.keys(koppen).sort(function (a, b) { return koppen[a] - koppen[b]; });

    // 2. De eerste artikelregel geeft de linkerranden.
    for (var r = koprij; r < rijen.length; r++) {
      var tk = topiaTokens(rijen[r].items);
      if (!tk.length || !TOPIA_ART.test(schoon(tk[0].str))) continue;
      if (tk.length !== volgorde.length) continue;
      return {
        koprij: r - 1,
        kolommen: tk.map(function (t, n) { return { x: t.x, sleutel: volgorde[n] }; }),
      };
    }
    return null;
  }
  /* Elk stukje tekst in de kolom waar het in valt. De randen komen uit de
     eerste artikelregel; een klein beetje speling omdat niet elke regel op
     de punt begint. */
  function topiaVerdeel(items, kolommen) {
    var vak = {}, tk = topiaTokens(items);
    for (var i = 0; i < tk.length; i++) {
      var kol = null;
      for (var k = 0; k < kolommen.length; k++) if (tk[i].x >= kolommen[k].x - 8) kol = kolommen[k];
      if (!kol || !kol.sleutel) continue;
      vak[kol.sleutel] = (vak[kol.sleutel] ? vak[kol.sleutel] + " " : "") + tk[i].str;
    }
    for (var s2 in vak) vak[s2] = schoon(vak[s2]);
    return vak;
  }
  function topiaOmschrijving(naam, oms) {
    var n = schoon(naam), o = schoon(oms);
    if (n && o && o.toLowerCase().indexOf(n.toLowerCase()) === 0) return o;
    return schoon(n + (o ? " · " + o : ""));
  }
  // Getallen uit de tabel: eerst alle spaties eruit die de PDF erin gooit.
  function topiaGetal(s) { return bedrag(String(s == null ? "" : s).replace(/\s+/g, "")); }
  var TOPIA_ART = /^\(?(\d{4,8}\.\d{2})\)?$/;
  /* Een nieuwe artikelregel begint met het nummer zónder haakjes. Met haakjes
     is het "(Our Art. No.)", het nummer van de fabriek zelf, en dat staat een
     regel lager in dezelfde kolom - dat is dus dezelfde regel en geen nieuwe. */
  var TOPIA_ART_NIEUW = /^(\d{4,8}\.\d{2})$/;
  // De kop en de voet van elke bladzijde horen niet in de tabel, en de
  // tabelkop staat op elke bladzijde opnieuw. Zonder dat laatste kreeg het
  // laatste artikel van een bladzijde "Commodity Description Colour" in zijn
  // omschrijving en "Shipping Window" in zijn leverweek.
  var TOPIA_OVERSLAAN = /SALES\s*CONTRACT|CONTRACT\s*NO|CUSTOMER\s*ORDER\s*NO|^DATE\s*:|PAGE\s*\d+\s*OF|The\s*Seller\s*agrees|\bCommodity\b|Your\s*Art\.?\s*No|\(Our\s*Art|^Shipping$|^Window$|^Picture$/i;
  var TOPIA_EINDE = /GENERAL\s*TERMS|Please\s*sign\s*and\s*return/i;
  function leesTopia(rijen) {
    var uit = { leverancier: null, invoiceNo: null, datum: null, regels: [], soort: "proforma" };
    var alles = rijen.map(function (r) {
      return r.items.map(function (i) { return i.str; }).join(" ");
    }).join("\n");
    var m;
    if ((m = alles.match(/CONTRACT\s*NO\.?\s*:?\s*([A-Za-z0-9\-\/]{3,40})/i))) uit.invoiceNo = m[1];
    if ((m = alles.match(/DATE\s*:?\s*(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})/i)))
      uit.datum = m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
    // De naam van de verkoper staat niet op de regel van "THE SELLER" maar
    // een of twee regels lager; op die eerste regel staat de betaalconditie.
    if ((m = alles.match(/^([^\n]*(?:CO\.,?\s*LTD|LIMITED|CO\.LTD)[^\n]*)$/im)))
      // Op die regel staat rechts ook nog het rekeningnummer-blok; dat hoort
      // niet bij de naam van de leverancier.
      uit.leverancier = schoon(String(m[1]).split(/BENEFICIARY|ADV\s*BANK|ROOM\s*\d/i)[0]);

    var kop2 = topiaKolommen(rijen);
    if (!kop2) return uit;

    var huidig = null;
    var duw = function () {
      if (!huidig) return;
      var aantal = Number(String(huidig.aantal || "").replace(/[^\d]/g, ""));
      // Een regel met aantal 0 staat er wel (een artikel dat deze keer niet
      // meegaat) maar hoort niet in een inkooporder.
      if (huidig.art && aantal > 0) {
        uit.regels.push({
          code: huidig.art,
          // De kolom Description begint met dezelfde naam als de kolom
          // Commodity; die hoeft er niet twee keer in te staan.
          omschrijving: topiaOmschrijving(huidig.naam, huidig.oms),
          sectie: null, aantal: aantal,
          kleur: huidig.kleur || null, skirt: null, afmeting: null,
          eenheid: huidig.eenheid || null,
          verpakking: huidig.packing || null,
          // De verticale streep is een tabelrand die als tekst meekomt.
          venster: schoon(String(huidig.venster || "").replace(/\|/g, " ")) || null,
          prijsUsd: topiaGetal(huidig.prijs), bedragUsd: topiaGetal(huidig.bedrag),
        });
      }
      huidig = null;
    };
    for (var r = kop2.koprij + 1; r < rijen.length; r++) {
      var plat = schoon(rijen[r].items.map(function (i2) { return i2.str; }).join(" "));
      if (TOPIA_EINDE.test(plat)) break;
      if (TOPIA_OVERSLAAN.test(plat)) continue;
      var vak = topiaVerdeel(rijen[r].items, kop2.kolommen);
      var artA = TOPIA_ART_NIEUW.exec(schoon(vak.art || ""));
      if (artA) {                       // nieuwe artikelregel
        duw();
        huidig = { art: artA[1], naam: vak.naam || "", oms: vak.oms || "", kleur: vak.kleur || "",
                   packing: vak.packing || "", aantal: vak.aantal || "", eenheid: vak.eenheid || "",
                   prijs: vak.prijs || "", bedrag: vak.bedrag || "", venster: vak.venster || "" };
        continue;
      }
      if (!huidig) continue;
      // Vervolgregels: de tekstkolommen lopen door.
      ["naam", "oms", "kleur", "venster"].forEach(function (s) {
        if (vak[s]) huidig[s] = (huidig[s] ? huidig[s] + " " : "") + vak[s];
      });
      /* De kolommen met één waarde per artikel worden alleen aangevuld als ze
         nog leeg zijn. Dat is nodig omdat zo'n waarde soms een paar pixels
         lager staat dan de rest van zijn regel en dan als losse rij binnenkomt:
         bij artikel 151103.01 stond het aantal 10 drie pixels onder de regel
         en viel het er anders helemaal uit. */
      ["packing", "aantal", "eenheid", "prijs", "bedrag"].forEach(function (s) {
        if (vak[s] && !huidig[s]) huidig[s] = vak[s];
      });
      // Het artikelnummer tussen haakjes staat een regel lager en is hetzelfde
      // nummer; dat hoeft niet in de omschrijving terecht te komen.
      if (vak.artikel && TOPIA_ART.test(schoon(vak.artikel))) continue;
    }
    duw();
    uit.totaalStuks = uit.regels.reduce(function (n, x) { return n + (Number(x.aantal) || 0); }, 0);
    uit.totaalUsd = Math.round(uit.regels.reduce(function (n, x) { return n + (Number(x.bedragUsd) || 0); }, 0) * 100) / 100;
    uit.packing = []; uit.verschillen = [];
    return uit;
  }

  // Welk soort bladzijde is dit? De keuze mag niet op de bestandsnaam
  // berusten; die zegt bij deze fabrieken niets.
  function soortVan(regels) {
    var t = regels.join(" ");
    if (/Main\s*components/i.test(t) && /Quantity\s+needed/i.test(t)) return "joyspa";
    if (/SALES\s*CONTRACT/i.test(t) && /Your\s*Art\.?\s*No/i.test(t)) return "topia";
    if (/PROFORMA\s*INVOICE/i.test(t) && /Item\s*Name/i.test(t)) return "proforma";
    if (/PROFORMA\s*INVOICE/i.test(t) && /DESCRIPTIONS?/i.test(t) && /QTY/i.test(t)) return "mexda-proforma";
    return "commercial";
  }
  function leesAuto(regels) {
    var s = soortVan(regels);
    if (s === "joyspa") return leesJoyspa(regels);
    if (s === "mexda-proforma") return leesMexdaProforma(regels);
    if (s === "proforma") return leesProforma(regels);
    return lees(regels);
  }

  global.fpCiPdf = { lees: lees, leesProforma: leesProforma, leesJoyspa: leesJoyspa,
                     leesMexdaProforma: leesMexdaProforma, leesTopia: leesTopia,
                     leesAuto: leesAuto, leesBestand: leesBestand, soortVan: soortVan,
                     uitPdf: uitPdf, uitPdfKolommen: uitPdfKolommen,
                     kop: kop, tabel: tabel, getallen: getallen, koppel: koppel };

})(typeof window !== "undefined" ? window : globalThis);
