/* ═══════════════════════════════════════════════════════════════════════════
   ROLL-BACK — van de voorraad van vandaag terug naar een peildatum
   ═══════════════════════════════════════════════════════════════════════════

   Wat de accountant vraagt
   ------------------------
   "Opstellen van een roll-back analyse, waarbij vanuit de huidige
   voorraadpositie wordt teruggerekend naar de tellijsten en vervolgens naar de
   voorraadpositie per 31-12-2025, rekening houdend met inkopen, verkopen,
   goederenontvangsten, goederenleveringen, magazijnmutaties, voorraadcorrecties
   en derving."

   Dit is de kern van de audittrail. De redenering is simpel en juist daarom
   controleerbaar:

       voorraad nu  −  alle mutaties sinds de peildatum  =  voorraad toen

   Elke stap ertussen moet verklaard zijn door een mutatie. Waar dat niet lukt
   staat de post op de verschillenlijst, met bedrag en met de reden waarom het
   niet sluit. Dat is eerlijker dan een sluitend overzicht waarin het verschil
   ergens is ondergebracht.

   Waarom dit per artikel moet
   ---------------------------
   Op totaalniveau sluit bijna alles wel; de vraag is juist wáár het misgaat.
   Logic4 geeft de voorraadmutaties per artikel met datum, aantal, magazijn en
   soort (GetProductStockMutations), en de voorraad per magazijn van vandaag
   (GetStockForWarehouses). Daarmee is per artikel terug te rekenen.

   Het datamodel van de accountant kan dit niet leveren: op de voorraadregels
   daarin staat geen artikelcode, alleen op de omzet- en kostprijsrekeningen.
   Nagelopen op alle 108.993 voorraadregels van 2025.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var PER_KEER = 500;
  var MAX_RONDEN = 600;

  function tekst(v) { return v == null ? "" : String(v); }
  function getal(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function dag(v) {
    if (!v) return "";
    var s = String(v);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    var d = new Date(s);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  /* Een mutatie telt mee in de terugrekening als hij ná de peildatum ligt.
     Precies op de peildatum hoort er nog bij: die dag is onderdeel van het
     jaar dat wordt afgesloten. */
  function na(datum, peil) {
    var d = dag(datum);
    return d !== "" && d > peil;
  }

  async function alles(logic4, pad, body, meld) {
    var uit = [], skip = 0;
    for (var i = 0; i < MAX_RONDEN; i++) {
      var vraag = Object.assign({}, body, { SkipRecords: skip, TakeRecords: PER_KEER });
      var deel = await logic4(pad, vraag);
      if (!Array.isArray(deel)) deel = deel ? [deel] : [];
      uit = uit.concat(deel);
      if (meld && i % 5 === 0) meld(uit.length);
      if (deel.length < PER_KEER) break;
      skip += PER_KEER;
    }
    return uit;
  }

  /* Welke soorten mutatie er zijn. De namen komen uit Logic4 zelf
     (GetProductStockMutationTypes); wat hier staat is de indeling die de
     accountant wil zien. Wat niet herkend wordt komt onder "overig" en blijft
     zichtbaar in plaats van stilletjes bij een andere hoop te belanden. */
  var GROEPEN = [
    { sleutel: "inkoop",    naam: "Goederenontvangsten", test: /inkoop|ontvangst|levering.*leverancier|purchase/i },
    { sleutel: "verkoop",   naam: "Goederenleveringen",  test: /verkoop|uitlevering|pickbon|sale/i },
    { sleutel: "magazijn",  naam: "Magazijnmutaties",    test: /magazijn|verplaats|locatie|warehouse|transfer/i },
    { sleutel: "correctie", naam: "Voorraadcorrecties",  test: /correctie|telling|inventar/i },
    { sleutel: "derving",   naam: "Derving",             test: /derv|breuk|afschrijv|schade|vermist/i },
  ];
  function groepVan(naam) {
    var n = tekst(naam);
    for (var i = 0; i < GROEPEN.length; i++) if (GROEPEN[i].test.test(n)) return GROEPEN[i].sleutel;
    return "overig";
  }

  async function haal(cfg) {
    var meld = cfg.meld || function () {};
    var bron = {};

    meld("Huidige voorraad per magazijn ophalen…");
    bron.voorraadNu = await alles(cfg.logic4, "/v3/Stock/GetStockForWarehouses",
      cfg.magazijn ? { WareHouseId: cfg.magazijn } : {},
      function (n) { meld("Huidige voorraad ophalen… " + n); });

    /* Alle mutaties vanaf de dag ná de peildatum tot vandaag. Dat is precies
       wat er tussen de twee standen is gebeurd. */
    meld("Voorraadmutaties sinds de peildatum ophalen…");
    var vanaf = new Date(cfg.peildatum + "T00:00:00");
    vanaf.setDate(vanaf.getDate() + 1);
    bron.mutaties = await alles(cfg.logic4, "/v3/Stock/GetProductStockMutations",
      { DateFrom: vanaf.toISOString().slice(0, 10), DateTo: cfg.vandaag },
      function (n) { meld("Voorraadmutaties ophalen… " + n); });

    meld("Soorten mutatie ophalen…");
    bron.soorten = await cfg.logic4("/v3/Stock/GetProductStockMutationTypes", {}) || [];

    return bron;
  }

  function bouwTerug(bron, cfg) {
    var soortNaam = {};
    (bron.soorten || []).forEach(function (s) {
      soortNaam[tekst(s.Id != null ? s.Id : s.StockMutationTypeId)] = tekst(s.Value || s.Name || s.Description);
    });

    /* De stand van vandaag per artikel. */
    var perArtikel = {};
    (bron.voorraadNu || []).forEach(function (v) {
      var code = tekst(v.ProductCode || v.ProductId);
      if (!code) return;
      var a = perArtikel[code] = perArtikel[code] || nieuw(code);
      a.nu += getal(v.Stock != null ? v.Stock : (v.StockAmount != null ? v.StockAmount : v.Qty));
      a.omschrijving = a.omschrijving || tekst(v.ProductDescription || v.Description);
      var mag = tekst(v.WareHouseId || v.WarehouseId);
      if (mag) a.magazijnen[mag] = (a.magazijnen[mag] || 0) +
        getal(v.Stock != null ? v.Stock : (v.StockAmount != null ? v.StockAmount : v.Qty));
    });

    /* En eraf: alles wat ná de peildatum is gebeurd. */
    var buitenBereik = 0;
    (bron.mutaties || []).forEach(function (m) {
      var code = tekst(m.ProductCode || m.ProductId);
      if (!code) return;
      if (!na(m.MutationDateTime, cfg.peildatum)) { buitenBereik++; return; }
      var a = perArtikel[code] = perArtikel[code] || nieuw(code);
      var aantal = getal(m.Amount);
      var soort = tekst(m.StockMutationType) || soortNaam[tekst(m.StockMutationTypeId)] || "";
      var g = groepVan(soort);
      a.mutaties += aantal;
      a.perGroep[g] = (a.perGroep[g] || 0) + aantal;
      a.regels += 1;
      a.prijs = a.prijs || getal(m.BuyPrice);
    });

    /* De terugrekening zelf. */
    var lijst = Object.keys(perArtikel).map(function (code) {
      var a = perArtikel[code];
      a.toen = a.nu - a.mutaties;
      a.waardeToen = a.toen * a.prijs;
      return a;
    });

    var totaal = { nu: 0, mutaties: 0, toen: 0, perGroep: {}, regels: 0 };
    lijst.forEach(function (a) {
      totaal.nu += a.nu; totaal.mutaties += a.mutaties; totaal.toen += a.toen;
      totaal.regels += a.regels;
      Object.keys(a.perGroep).forEach(function (g) {
        totaal.perGroep[g] = (totaal.perGroep[g] || 0) + a.perGroep[g];
      });
    });

    return { perArtikel: lijst, totaal: totaal, buitenBereik: buitenBereik };
  }

  function nieuw(code) {
    return { artikel: code, omschrijving: "", nu: 0, mutaties: 0, toen: 0,
             prijs: 0, waardeToen: 0, perGroep: {}, magazijnen: {}, regels: 0 };
  }

  /* De vergelijking met de telling. Hier komt het antwoord uit: per artikel
     wat de terugrekening zegt en wat er geteld is, en waar dat uiteenloopt. */
  function vergelijk(terug, telling) {
    var geteld = {};
    (telling || []).forEach(function (t) {
      var code = tekst(t.artikel || t.Artikelcode || t.ProductCode || t.code);
      if (!code) return;
      geteld[code] = { aantal: getal(t.aantal != null ? t.aantal : t.Aantal),
                       waarde: getal(t.waarde != null ? t.waarde : t.Waarde) };
    });

    var regels = [], sluit = 0, wijktAf = 0, alleenTerug = 0, alleenTelling = 0;
    terug.perArtikel.forEach(function (a) {
      var t = geteld[a.artikel];
      if (!t) {
        alleenTerug++;
        if (Math.round(a.toen * 1000) !== 0)
          regels.push({ artikel: a.artikel, omschrijving: a.omschrijving,
                        berekend: a.toen, geteld: null, verschil: a.toen,
                        reden: "wel in de terugrekening, niet in de telling" });
        return;
      }
      var v = a.toen - t.aantal;
      if (Math.abs(v) < 0.0005) { sluit++; return; }
      wijktAf++;
      regels.push({ artikel: a.artikel, omschrijving: a.omschrijving,
                    berekend: a.toen, geteld: t.aantal, verschil: v,
                    waardeVerschil: v * a.prijs,
                    reden: "aantal wijkt af" });
    });
    Object.keys(geteld).forEach(function (code) {
      if (terug.perArtikel.some(function (a) { return a.artikel === code; })) return;
      alleenTelling++;
      regels.push({ artikel: code, omschrijving: "", berekend: null,
                    geteld: geteld[code].aantal, verschil: -geteld[code].aantal,
                    reden: "wel geteld, niet in de terugrekening" });
    });

    regels.sort(function (a, b) {
      return Math.abs(b.waardeVerschil || 0) - Math.abs(a.waardeVerschil || 0) ||
             Math.abs(b.verschil) - Math.abs(a.verschil);
    });
    return {
      sluit: sluit, wijktAf: wijktAf,
      alleenTerugrekening: alleenTerug, alleenTelling: alleenTelling,
      regels: regels,
      verschilWaarde: regels.reduce(function (n, r) { return n + (r.waardeVerschil || 0); }, 0),
    };
  }

  async function bouw(cfg) {
    if (!cfg || typeof cfg.logic4 !== "function") throw new Error("logic4-functie ontbreekt");
    var opties = {
      logic4: cfg.logic4,
      peildatum: cfg.peildatum || "2025-12-31",
      vandaag: cfg.vandaag || new Date().toISOString().slice(0, 10),
      magazijn: cfg.magazijn || null,
      meld: cfg.meld || function () {},
    };
    var t0 = Date.now();
    var bron = await haal(opties);
    opties.meld("Terugrekenen…");
    var terug = bouwTerug(bron, opties);
    var vgl = cfg.telling ? vergelijk(terug, cfg.telling) : null;

    var meldingen = [];
    if (!(bron.mutaties || []).length)
      meldingen.push("Er kwamen geen voorraadmutaties terug over deze periode. De terugrekening is dan " +
                     "gelijk aan de huidige stand, en dat klopt vrijwel zeker niet.");
    if (terug.totaal.perGroep.overig)
      meldingen.push("Voor " + Math.round(terug.totaal.perGroep.overig) + " stuks is de soort mutatie niet " +
                     "in te delen bij inkoop, verkoop, magazijn, correctie of derving.");
    if (!cfg.telling)
      meldingen.push("Zonder tellijst is er niets om de terugrekening mee te vergelijken. Lever de telling " +
                     "aan met per regel een artikelcode en een aantal.");

    return {
      peildatum: opties.peildatum, vandaag: opties.vandaag,
      seconden: Math.round((Date.now() - t0) / 1000),
      aantallen: {
        artikelen: terug.perArtikel.length,
        mutaties: (bron.mutaties || []).length,
        buitenBereik: terug.buitenBereik,
      },
      totaal: terug.totaal,
      perArtikel: terug.perArtikel,
      vergelijking: vgl,
      meldingen: meldingen,
    };
  }

  global.fpRollback = {
    bouw: bouw,
    vergelijk: vergelijk,
    _intern: { bouwTerug: bouwTerug, groepVan: groepVan, na: na, dag: dag, GROEPEN: GROEPEN },
  };

})(typeof window !== "undefined" ? window : globalThis);
