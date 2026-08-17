/* ═══════════════════════════════════════════════════════════════════════════
   SALES CONFIRMATION — de orderbevestiging van een meubelfabriek
   ═══════════════════════════════════════════════════════════════════════════

   Chantal (17 aug 2026): "Het dashboard ook dit bestand laten lezen. Fabriek /
   S/C NO = referentienummer / Item NO = artikelnummer, als je deze niet in
   Logic kan vinden dan graag afstemmen met Gretha / Color = kleur /
   Quanity = aantal."

   Dit is een andere bladzijde dan de twee die we al lazen. Een commercial
   invoice gaat over wat er vaart, een proforma over wat er besteld gaat
   worden; een sales confirmation is de bevestiging van de fabriek dát het
   besteld is. Vandaar een eigen lezer.

   Twee dingen maken het lastiger dan het eruitziet:

   1. In één cel onder "Item no" staan meerdere artikelnummers onder elkaar:
      eerst de code van de set, daarna de onderdelen met hun maat en hoeveel
      er per set in gaan. Vijf codes in één cel dus.

   2. Die cel is samengevoegd over meerdere regels. Onder één artikelblok
      staan twee kleuren met elk hun eigen aantal, en alleen de bovenste rij
      draagt het artikelnummer. Bij een samengevoegde cel geeft de
      spreadsheet-lezer de waarde alleen in de eerste rij en verder leeg, dus
      wie dat niet opvangt raakt de helft van de bestelling kwijt.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  function schoon(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }
  function cel(rijen, r, k) {
    return rijen[r] && rijen[r][k] != null ? String(rijen[r][k]) : "";
  }

  /* Een artikelnummer van deze fabrieken: letters, dan een cijfer, dan nog
     wat letters, cijfers en streepjes. GCV16031V-5C, GT16032V-C, GCV1442V-C.
     De dubbele punt erachter hoort bij de opmaak en gaat eraf. */
  var ARTIKEL = /^([A-Z]{1,4}\d[A-Z0-9\-]{1,14})\s*:?\s*$/i;

  /* Een maatregel onder een artikelnummer: "180x80x85cm, 1pc" of
     "40x40x40cm, 2pcs". Het aantal achteraan is hoeveel er per set in gaan. */
  var MAAT = /^([\d.,]+\s*[x×]\s*[\d.,]+(?:\s*[x×]\s*[\d.,]+)?\s*(?:cm|mm)?)\s*(?:,\s*(\d+)\s*pcs?)?\s*$/i;

  /* Splits de cel onder "Item no" in de set en zijn onderdelen. De eerste code
     is de set; wat daarna komt zijn de onderdelen, elk eventueel gevolgd door
     een maat met het aantal per set. Staat er maar één code, dan is dat gewoon
     het artikel en zijn er geen onderdelen. */
  function leesArtikelcel(waarde) {
    var regels = String(waarde || "").split(/[\r\n]+/).map(schoon).filter(Boolean);
    var codes = [], laatste = null;
    for (var i = 0; i < regels.length; i++) {
      var m = regels[i].match(ARTIKEL);
      if (m) {
        laatste = { code: m[1].toUpperCase(), maat: "", perSet: 1 };
        codes.push(laatste);
        continue;
      }
      var mm = regels[i].match(MAAT);
      if (mm && laatste) {
        laatste.maat = schoon(mm[1]);
        if (mm[2]) laatste.perSet = Number(mm[2]);
      }
    }
    if (!codes.length) return null;
    return { set: codes[0].code, onderdelen: codes.slice(1), alle: codes };
  }

  /* De kleurcel bevat vaak meer dan een kleur: "Wicker:C24-S Charcoal" met op
     de volgende regel "Fabric: DS". Alles blijft staan - wie het naleest wil
     precies weten wat er is afgesproken - maar op één regel achter elkaar. */
  function leesKleur(waarde) {
    return String(waarde || "").split(/[\r\n]+/).map(schoon).filter(Boolean).join(" · ");
  }

  /* Waar staat de kopregel, en in welke kolom staat wat. Niet vastpinnen op
     kolomletters: deze fabrieken schuiven met opzet nog weleens een kolom. */
  function kolommen(rijen) {
    for (var r = 0; r < Math.min(rijen.length, 25); r++) {
      var k = { rij: r };
      for (var c = 0; c < (rijen[r] || []).length; c++) {
        var v = schoon(cel(rijen, r, c)).toLowerCase();
        if (/^item\s*no/.test(v)) k.artikel = c;
        else if (/^colou?r$/.test(v)) k.kleur = c;
        else if (/^quan?[it]?ity$/.test(v) || /^qty$/.test(v)) k.aantal = c;
        else if (/^description/.test(v)) k.omschrijving = c;
      }
      if (k.artikel !== undefined && k.aantal !== undefined) return k;
    }
    return null;
  }

  /* Is dit zo'n bevestiging? De kop moet het zeggen én er moet een tabel met
     artikelnummers en aantallen in staan. Alleen op de kop afgaan zou een
     bestelmail met dezelfde woorden ook binnenlaten. */
  function isSalesConfirmation(rijen) {
    var kop = (rijen || []).slice(0, 12).map(function (r) {
      return (r || []).join(" ");
    }).join(" ").toLowerCase();
    if (!/sales\s*confirmation/.test(kop) && !/s\/c\s*no/.test(kop)) return false;
    return !!kolommen(rijen);
  }

  function lees(rijen) {
    var uit = {
      soort: "sales-confirmation",
      fabriek: null, referentie: null, datum: null,
      regels: [], meldingen: [],
    };
    var k = kolommen(rijen);
    if (!k) { uit.meldingen.push("Geen tabel met artikelnummers en aantallen gevonden."); return uit; }

    /* De fabrieksnaam staat bovenaan, meestal in de eerste gevulde cel en met
       een rechtsvorm erachter. Zonder die rechtsvorm pakken we gewoon de
       eerste regel - beter een naam met een adres eraan vast dan geen naam. */
    for (var r = 0; r < Math.min(rijen.length, 6) && !uit.fabriek; r++) {
      var tekst = schoon((rijen[r] || []).join(" "));
      if (!tekst) continue;
      var m = tekst.match(/^(.{3,70}?(?:CO\.,?\s*LTD|B\.?V\.?|LIMITED|INC\.?|GMBH))\b/i);
      uit.fabriek = m ? schoon(m[1]) : schoon(tekst.split(/\s{3,}/)[0]).slice(0, 70);
    }

    /* S/C NO. en de datum: het label en de waarde staan in aparte cellen, en
       niet altijd naast elkaar. Zoek het label en neem de eerstvolgende
       gevulde cel op dezelfde rij. */
    function naastLabel(patroon) {
      for (var r = 0; r < Math.min(rijen.length, 14); r++) {
        for (var c = 0; c < (rijen[r] || []).length; c++) {
          if (patroon.test(schoon(cel(rijen, r, c)))) {
            for (var d = c + 1; d < (rijen[r] || []).length; d++) {
              var v = schoon(cel(rijen, r, d));
              if (v) return v;
            }
          }
        }
      }
      return null;
    }
    uit.referentie = naastLabel(/^s\/c\s*no\.?:?$/i);
    var datum = naastLabel(/^date:?$/i);
    if (datum) {
      var d = datum.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
      uit.datum = d ? d[1] + "-" + ("0" + d[2]).slice(-2) + "-" + ("0" + d[3]).slice(-2) : datum;
    }

    /* De regels. Een samengevoegde artikelcel geeft alleen in de bovenste rij
       een waarde; de rijen eronder horen bij hetzelfde artikel en krijgen dus
       de laatst geziene. Zonder dat zou hier van vierenveertig sets maar
       veertien overblijven. */
    var laatsteArtikel = null, laatsteOms = "";
    for (var i = k.rij + 1; i < rijen.length; i++) {
      /* Een aantal is een getal en niets anders. Alle cijfers uit een cel
         plukken gaat mis op de regel eronder: van "30% deposit: US$6903.6"
         maakt dat 306903,6 stuks, en die telt dan gewoon mee in het totaal.
         Een cel telt dus alleen als hij niets anders bevat dan het getal. */
      var ruwAantal = schoon(cel(rijen, i, k.aantal));
      var aantal = /^\d+(?:[.,]\d+)?$/.test(ruwAantal)
        ? Number(ruwAantal.replace(",", ".")) : NaN;

      var artikelCel = schoon(cel(rijen, i, k.artikel));
      if (artikelCel) {
        var gelezen = leesArtikelcel(cel(rijen, i, k.artikel));
        if (gelezen) laatsteArtikel = gelezen;
      }
      if (k.omschrijving !== undefined && schoon(cel(rijen, i, k.omschrijving)))
        laatsteOms = schoon(cel(rijen, i, k.omschrijving));

      if (!aantal || !isFinite(aantal) || aantal <= 0) continue;
      /* De totaalregel onderaan telt de kolom op; die is geen bestelregel.
         Herkenbaar aan het woord total ergens links ervan. */
      var linkerkant = (rijen[i] || []).slice(0, k.aantal).join(" ").toLowerCase();
      if (/\btotal\b|\btotaal\b|合计|总计/.test(linkerkant)) continue;
      if (!laatsteArtikel) continue;

      uit.regels.push({
        set: laatsteArtikel.set,
        onderdelen: laatsteArtikel.onderdelen,
        omschrijving: laatsteOms,
        kleur: leesKleur(cel(rijen, i, k.kleur)),
        aantal: aantal,
      });
    }

    if (!uit.regels.length) uit.meldingen.push("Geen bestelregels met een aantal gevonden.");
    if (!uit.referentie) uit.meldingen.push("Geen S/C nummer gevonden.");
    uit.totaal = uit.regels.reduce(function (n, r) { return n + r.aantal; }, 0);

    /* Alle artikelnummers die in dit document voorkomen, met hoeveel stuks er
       van elk besteld zijn. Bij een set is dat het aantal sets maal het aantal
       per set - dat is wat er straks in de container ligt en wat in Logic4
       terug moet te vinden zijn. */
    var perCode = {};
    uit.regels.forEach(function (r) {
      (r.onderdelen.length ? r.onderdelen : [{ code: r.set, perSet: 1 }]).forEach(function (o) {
        perCode[o.code] = (perCode[o.code] || 0) + r.aantal * (o.perSet || 1);
      });
      if (r.onderdelen.length) perCode[r.set] = (perCode[r.set] || 0) + r.aantal;
    });
    uit.artikelen = Object.keys(perCode).sort().map(function (c) {
      return { code: c, aantal: perCode[c] };
    });

    return uit;
  }

  global.fpSalesConfirmation = {
    lees: lees,
    isSalesConfirmation: isSalesConfirmation,
    leesArtikelcel: leesArtikelcel,
    kolommen: kolommen,
  };

})(typeof window !== "undefined" ? window : globalThis);
