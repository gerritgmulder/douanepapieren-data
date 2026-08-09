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

  // Welk soort bladzijde is dit? De keuze mag niet op de bestandsnaam
  // berusten; die zegt bij deze fabrieken niets.
  function soortVan(regels) {
    var t = regels.join(" ");
    if (/PROFORMA\s*INVOICE/i.test(t) && /Item\s*Name/i.test(t)) return "proforma";
    return "commercial";
  }
  function leesAuto(regels) {
    return soortVan(regels) === "proforma" ? leesProforma(regels) : lees(regels);
  }

  global.fpCiPdf = { lees: lees, leesProforma: leesProforma, leesAuto: leesAuto, soortVan: soortVan,
                     uitPdf: uitPdf, kop: kop, tabel: tabel, getallen: getallen };

})(typeof window !== "undefined" ? window : globalThis);
