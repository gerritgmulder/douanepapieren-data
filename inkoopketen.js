/* ═══════════════════════════════════════════════════════════════════════════
   INKOOPKETEN — inkooporder, goederenontvangst en inkoopfactuur aan elkaar
   ═══════════════════════════════════════════════════════════════════════════

   Waarvoor
   --------
   Just Audit controleert het werk van De Jong & Laan bij Fonteyn. De
   jaarrekening 2024 is nooit getekend omdat te veel gegevens onduidelijk of
   incompleet zijn. Kevin heeft opgeschreven wat hij nodig heeft om grootboek
   1630 (te ontvangen facturen) te onderbouwen: zes overzichten, allemaal in
   hetzelfde kolommenformat.

   Zijn uitgangspunt, en dat bepaalt de hele opzet: het aanmaken van een
   inkooporder raakt 1630 niet. Pas een goederenontvangst of een ontvangen
   factuur doet dat. De vraag is dus telkens waar die drie uit elkaar lopen.

   De zes overzichten
   ------------------
     1  Inkooporders mét factuur, per peildatum nog niet volledig geleverd
     2  Inkoopfacturen zónder inkooporder, met openstaande leveringsplicht
     3  Wat uit 1 en 2 per vandaag nog steeds niet is afgewikkeld
     4  Alle openstaande inkooporders per vandaag
     5  Goederenontvangsten zonder order én zonder factuur
     6  Overige boekingen op 1630

   Wat hier niet vandaan komt
   --------------------------
   Overzicht 6 kan niet. De Logic4-API geeft bij een financiële boeking wel
   het bedrag, de crediteur en de koppelingen, maar niet de grootboekrekening
   per regel (GetFinancialBookingsWithMutations, nagelopen 17 aug 2026). Zonder
   rekeningnummer valt niet te zeggen welke boekingen op 1630 staan. Dat
   overzicht moet uit een grootboekexport komen; deze module accepteert die
   regels als ze worden meegegeven en laat het anders leeg met een melding.

   Waar dit draait
   ---------------
   In de browser, via de lokale helper op poort 3737. Een volledige opbouw is
   honderden aanroepen en dat past niet in de gratis Cloudflare-worker.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  /* Logic4 geeft maximaal een paar honderd records per aanroep terug. Alles
     wat een lijst ophaalt gaat daarom door deze lus, met een harde grens: bij
     een fout in het filter zou hij anders eindeloos doordraaien. */
  var PER_KEER = 500;
  var MAX_RONDEN = 200;

  function tekst(v) { return v == null ? "" : String(v); }
  function getal(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* Datums uit Logic4 komen als ISO met tijd; voor vergelijken met een
     peildatum is alleen de dag van belang. */
  function dag(v) {
    if (!v) return "";
    var s = String(v);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + "-" + m[2] + "-" + m[3];
    var d = new Date(s);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  function voorOfOp(datum, peil) {
    var d = dag(datum);
    return d !== "" && d <= peil;
  }

  async function alles(logic4, pad, body, veldSkip, veldTake, meld) {
    var uit = [], skip = 0;
    for (var ronde = 0; ronde < MAX_RONDEN; ronde++) {
      var vraag = Object.assign({}, body);
      vraag[veldSkip] = skip;
      vraag[veldTake] = PER_KEER;
      var deel = await logic4(pad, vraag);
      if (!Array.isArray(deel)) deel = deel ? [deel] : [];
      uit = uit.concat(deel);
      if (meld && ronde % 4 === 0) meld(uit.length);
      if (deel.length < PER_KEER) break;
      skip += PER_KEER;
    }
    return uit;
  }

  /* ── De brongegevens ───────────────────────────────────────────────── */

  async function haalAlles(cfg) {
    var logic4 = cfg.logic4;
    var meld = cfg.meld || function () {};
    var bron = {};

    meld("Dagboeken ophalen…");
    bron.dagboeken = await logic4("/v3/Financial/GetFinancialBooks", {}, "GET") || [];

    /* Welk dagboek is het inkoopboek. Logic4 kent daar een type voor, maar de
       nummering verschilt per administratie; daarom eerst op type en anders op
       naam. Wordt het niet gevonden, dan blijven de facturen leeg en zegt de
       melding waarom - beter dan het verkeerde dagboek leeglezen. */
    var inkoop = (bron.dagboeken || []).filter(function (b) {
      var naam = tekst(b.Name || b.Description).toLowerCase();
      return Number(b.TypeId) === 1 || /inkoop|purchase|crediteur/.test(naam);
    });
    bron.inkoopboeken = inkoop;

    meld("Inkooporders ophalen…");
    bron.orders = await alles(logic4, "/v3/BuyOrders/GetBuyOrders",
      { BuyOrderDateTo: cfg.vandaag }, "SkipRecords", "TakeRecords",
      function (n) { meld("Inkooporders ophalen… " + n); });

    meld("Orderregels ophalen…");
    bron.orderregels = await alles(logic4, "/v3/BuyOrders/GetBuyOrderRowsByFilter",
      {}, "SkipRecords", "TakeRecords",
      function (n) { meld("Orderregels ophalen… " + n); });

    meld("Goederenontvangsten ophalen…");
    bron.leveringen = await alles(logic4, "/v3/BuyOrderDeliveries/GetBuyOrderDeliveries",
      {}, "Skip", "Take",
      function (n) { meld("Goederenontvangsten ophalen… " + n); });

    meld("Inkoopfacturen ophalen…");
    bron.facturen = [];
    for (var i = 0; i < inkoop.length; i++) {
      var boek = inkoop[i];
      var deel = await alles(logic4, "/v3/Financial/GetFinancialBookingsWithMutations",
        { FinancialBookId: boek.Id != null ? boek.Id : boek.FinancialBookId,
          BookingDateTimeTo: cfg.vandaag + "T23:59:59" },
        "SkipRecords", "TakeRecords",
        function (n) { meld("Inkoopfacturen ophalen… " + n); });
      bron.facturen = bron.facturen.concat(deel);
    }

    meld("Openstaande crediteurenposten ophalen…");
    bron.credOpenPeil = await logic4("/v3/Relations/GetCreditorOutstandingPosts",
      { Date: cfg.peildatum }) || [];
    bron.credOpenNu = await logic4("/v3/Relations/GetCreditorOutstandingPosts",
      { Date: cfg.vandaag }) || [];

    return bron;
  }

  /* ── Alles op ordernummer bij elkaar ───────────────────────────────── */

  function bouwIndex(bron) {
    var perOrder = {};

    (bron.orders || []).forEach(function (o) {
      var id = tekst(o.Id != null ? o.Id : o.BuyOrderId);
      if (!id) return;
      perOrder[id] = {
        buyOrderId: id,
        ordernummer: tekst(o.OrderId || o.Id),
        crediteurId: tekst(o.CreditorId),
        leverancier: tekst(o.CreditorCompanyName),
        datum: dag(o.CreatedAt),
        gesloten: !!o.BuyOrderClosed,
        opmerking: tekst(o.Remarks),
        regels: [], leveringen: [], facturen: [],
      };
    });

    /* Per orderregel: hoeveel besteld en hoeveel daarvan nog te leveren.
       QtyToOrder is het bestelde aantal, QtyToDeliver wat er nog moet komen.
       Het verschil is dus wat er binnen is - Logic4 houdt geen apart
       "geleverd"-veld bij op de regel. */
    (bron.orderregels || []).forEach(function (r) {
      var id = tekst(r.BuyOrderId);
      var o = perOrder[id];
      if (!o) return;
      var besteld = getal(r.QtyToOrder);
      var teLeveren = getal(r.QtyToDeliver);
      o.regels.push({
        rowId: tekst(r.BuyOrderRowId),
        artikel: tekst(r.ProductCode),
        omschrijving: tekst(r.Description || r.ProductDesc1),
        besteld: besteld,
        teLeveren: teLeveren,
        geleverd: besteld - teLeveren,
        prijs: getal(r.Price),
        verwacht: dag(r.ExpectedDeliveryDate),
      });
    });

    (bron.leveringen || []).forEach(function (l) {
      var id = tekst(l.BuyOrderId);
      var rec = {
        leveringId: tekst(l.BuyOrderDeliveryId),
        datum: dag(l.DateTimeProcessed || l.DateTimeCreated),
        aangemaakt: dag(l.DateTimeCreated),
        crediteurId: tekst(l.SupplierId),
        regels: (l.Rows || []).map(function (r) {
          return { rowId: tekst(r.BuyOrderRowId), productId: tekst(r.ProductId),
                   aantal: getal(r.Qty_Delivered), prijs: getal(r.BuyPrice) };
        }),
        buyOrderId: id,
      };
      if (perOrder[id]) perOrder[id].leveringen.push(rec);
      else (bron.leveringenZonderOrder = bron.leveringenZonderOrder || []).push(rec);
    });

    /* De inkoopfacturen. Het ordernummer staat niet als veld in de boeking;
       Logic4 zet het in de referentie of de omschrijving. Daar zoeken we het
       uit, want zonder die koppeling valt elke factuur in overzicht 2 en dat
       is niet waar. */
    (bron.facturen || []).forEach(function (f) {
      var som = (f.Mutations || []).reduce(function (n, m) { return n + getal(m.AmountIncl); }, 0);
      var credId = "";
      (f.Mutations || []).some(function (m) {
        if (m.CreditorId) { credId = tekst(m.CreditorId); return true; }
        return false;
      });
      var rec = {
        boekingId: tekst(f.BookingId),
        factuurnummer: tekst(f.Reference || f.BookingNumberByUser),
        datum: dag(f.BookingDateTime),
        omschrijving: tekst(f.Description),
        bedrag: som,
        crediteurId: credId,
        dagboek: tekst(f.FinancialBookId),
      };
      var tref = zoekOrdernummer(rec, perOrder);
      if (tref) { rec.buyOrderId = tref; perOrder[tref].facturen.push(rec); }
      else (bron.facturenZonderOrder = bron.facturenZonderOrder || []).push(rec);
    });

    return perOrder;
  }

  /* Het ordernummer uit de tekst van een boeking vissen. Op woordgrens en
     minstens vier cijfers: anders slaat "2025" of een huisnummer aan en hangt
     een factuur ineens aan een order die er niets mee te maken heeft. */
  function zoekOrdernummer(factuur, perOrder) {
    var hooi = (factuur.factuurnummer + " " + factuur.omschrijving);
    var nummers = hooi.match(/\d{4,}/g) || [];
    for (var i = 0; i < nummers.length; i++) {
      var n = nummers[i];
      for (var id in perOrder) {
        if (perOrder[id].ordernummer === n || id === n) {
          /* Alleen als de crediteur ook klopt, of als die onbekend is. Een
             getal dat toevallig een ordernummer is bij een heel andere
             leverancier is geen koppeling. */
          if (!factuur.crediteurId || !perOrder[id].crediteurId ||
              factuur.crediteurId === perOrder[id].crediteurId) return id;
        }
      }
    }
    return null;
  }

  /* ── De zes overzichten ────────────────────────────────────────────── */

  /* Het vaste kolommenformat van Kevin. Elk overzicht levert deze velden,
     leeg waar ze niet van toepassing zijn. */
  function regel(o, levering, factuur) {
    return {
      datum: (factuur && factuur.datum) || (levering && levering.datum) || (o && o.datum) || "",
      leverancier: (o && o.leverancier) || "",
      crediteurnummer: (o && o.crediteurId) || (factuur && factuur.crediteurId) || "",
      inkoopordernummer: (o && o.ordernummer) || "",
      inkoopleveringsnummer: (levering && levering.leveringId) || "",
      inkoopfactuurnummer: (factuur && factuur.factuurnummer) || "",
      factuurdatum: (factuur && factuur.datum) || "",
      factuurbedrag: factuur ? factuur.bedrag : "",
    };
  }

  /* Is deze order op de peildatum volledig geleverd? Alleen regels die op of
     vóór de peildatum besteld zijn tellen mee, en van de leveringen alleen
     die van vóór de peildatum - anders zou een levering van maart 2026 een
     order per 31-12-2025 als afgehandeld laten zien. */
  function geleverdPer(o, peil) {
    var besteld = 0, geleverd = 0;
    o.regels.forEach(function (r) { besteld += r.besteld; });
    o.leveringen.forEach(function (l) {
      if (!voorOfOp(l.datum, peil)) return;
      l.regels.forEach(function (r) { geleverd += r.aantal; });
    });
    return { besteld: besteld, geleverd: geleverd, volledig: besteld > 0 && geleverd >= besteld };
  }

  function bouwOverzichten(perOrder, bron, cfg) {
    var peil = cfg.peildatum, nu = cfg.vandaag;
    var t = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

    var inPeil = [];
    Object.keys(perOrder).forEach(function (id) {
      var o = perOrder[id];
      if (!voorOfOp(o.datum, peil)) return;
      var st = geleverdPer(o, peil);
      var factuurVoorPeil = o.facturen.filter(function (f) { return voorOfOp(f.datum, peil); });
      if (factuurVoorPeil.length && !st.volledig) {
        inPeil.push({ o: o, facturen: factuurVoorPeil, stand: st });
        factuurVoorPeil.forEach(function (f) {
          var r = regel(o, o.leveringen[0], f);
          r.besteld = st.besteld; r.geleverdPerPeildatum = st.geleverd;
          r.nogTeLeveren = st.besteld - st.geleverd;
          t[1].push(r);
        });
      }
    });

    /* 2 - facturen zonder order. Alleen die van vóór de peildatum, en alleen
       zolang er nog een leveringsverplichting is: een factuur zonder order
       waarvan de goederen al binnen zijn hoort hier niet. Dat laatste is niet
       uit de gegevens af te leiden zonder order, dus die beoordeling komt bij
       de accountant te liggen en dat staat er ook bij. */
    (bron.facturenZonderOrder || []).forEach(function (f) {
      if (!voorOfOp(f.datum, peil)) return;
      var r = regel(null, null, f);
      r.leverancier = leverancierNaam(bron, f.crediteurId);
      r.crediteurnummer = f.crediteurId;
      r.omschrijving = f.omschrijving;
      r.teBeoordelen = "geen order gevonden - leveringsplicht handmatig vaststellen";
      t[2].push(r);
    });

    /* 3 - wat daarvan per vandaag nog openstaat. */
    inPeil.forEach(function (x) {
      var nuSt = geleverdPer(x.o, nu);
      if (nuSt.volledig) return;
      x.facturen.forEach(function (f) {
        var r = regel(x.o, x.o.leveringen[0], f);
        r.besteld = nuSt.besteld; r.geleverdNu = nuSt.geleverd;
        r.nogTeLeveren = nuSt.besteld - nuSt.geleverd;
        t[3].push(r);
      });
    });
    (bron.facturenZonderOrder || []).forEach(function (f) {
      if (!voorOfOp(f.datum, peil)) return;
      var nogOpen = (bron.credOpenNu || []).some(function (p) {
        return tekst(p.Reference) === f.factuurnummer ||
               tekst(p.Id) === f.boekingId;
      });
      if (!nogOpen) return;
      var r = regel(null, null, f);
      r.leverancier = leverancierNaam(bron, f.crediteurId);
      r.crediteurnummer = f.crediteurId;
      t[3].push(r);
    });

    /* 4 - alle openstaande inkooporders per vandaag. */
    Object.keys(perOrder).forEach(function (id) {
      var o = perOrder[id];
      var st = geleverdPer(o, nu);
      if (o.gesloten || st.volledig) return;
      var f = o.facturen[0] || null;
      var r = regel(o, o.leveringen[0] || null, f);
      r.besteld = st.besteld; r.geleverd = st.geleverd;
      r.nogTeLeveren = st.besteld - st.geleverd;
      r.ouderdomDagen = dagenTussen(o.datum, nu);
      t[4].push(r);
    });

    /* 5 - goederenontvangsten zonder order én zonder factuur. */
    (bron.leveringenZonderOrder || []).forEach(function (l) {
      var r = regel(null, l, null);
      r.leverancier = leverancierNaam(bron, l.crediteurId);
      r.crediteurnummer = l.crediteurId;
      r.aantal = l.regels.reduce(function (n, x) { return n + x.aantal; }, 0);
      t[5].push(r);
    });

    /* 6 - overige boekingen op 1630. Alleen te maken met een grootboekexport;
       de API geeft geen rekeningnummer per boekingsregel. */
    if (cfg.grootboek1630 && cfg.grootboek1630.length) {
      var bekend = {};
      Object.keys(perOrder).forEach(function (id) {
        perOrder[id].facturen.forEach(function (f) { bekend[f.factuurnummer] = true; });
      });
      cfg.grootboek1630.forEach(function (g) {
        var ref = tekst(g.factuurnummer || g.Factuurnummer || g.omschrijving || g.Omschrijving);
        if (bekend[ref]) return;
        t[6].push({
          datum: dag(g.datum || g.Datum),
          dagboek: tekst(g.dagboek || g.Dagboek),
          boekingsnummer: tekst(g.boekingsnummer || g.Boekingsnummer),
          omschrijving: tekst(g.omschrijving || g.Omschrijving),
          boekingsbedrag: getal(g.bedrag != null ? g.bedrag : g.Bedrag),
        });
      });
    }

    return t;
  }

  function leverancierNaam(bron, credId) {
    if (!credId) return "";
    var p = (bron.credOpenNu || []).concat(bron.credOpenPeil || [])
      .find(function (x) { return tekst(x.CreditorId) === tekst(credId); });
    return p ? tekst(p.CompanyName) : "";
  }

  function dagenTussen(van, tot) {
    if (!van || !tot) return "";
    var a = new Date(van + "T00:00:00").getTime();
    var b = new Date(tot + "T00:00:00").getTime();
    if (!isFinite(a) || !isFinite(b)) return "";
    return Math.round((b - a) / 86400000);
  }

  /* ── De ingang ─────────────────────────────────────────────────────── */

  async function bouw(cfg) {
    if (!cfg || typeof cfg.logic4 !== "function") throw new Error("logic4-functie ontbreekt");
    var opties = {
      logic4: cfg.logic4,
      peildatum: cfg.peildatum || "2025-12-31",
      vandaag: cfg.vandaag || new Date().toISOString().slice(0, 10),
      meld: cfg.meld || function () {},
      grootboek1630: cfg.grootboek1630 || null,
    };
    var t0 = Date.now();
    var bron = await haalAlles(opties);
    opties.meld("Koppelen…");
    var perOrder = bouwIndex(bron);
    var overzichten = bouwOverzichten(perOrder, bron, opties);

    var meldingen = [];
    if (!bron.inkoopboeken.length)
      meldingen.push("Geen inkoopdagboek herkend. De inkoopfacturen konden niet worden opgehaald, " +
                     "dus overzicht 1, 2 en 3 zijn onvolledig.");
    if (!opties.grootboek1630)
      meldingen.push("Overzicht 6 is leeg. De Logic4-API geeft bij een boeking geen grootboekrekening " +
                     "per regel, dus welke boekingen op 1630 staan is er niet uit af te leiden. " +
                     "Lever een grootboekexport van 1630 aan en dit vult zichzelf.");
    if ((bron.facturenZonderOrder || []).length > (bron.facturen || []).length * 0.5)
      meldingen.push("Meer dan de helft van de inkoopfacturen is niet aan een order te koppelen. " +
                     "Mogelijk staat het ordernummer bij deze leverancier ergens anders dan in de " +
                     "referentie of de omschrijving.");

    return {
      peildatum: opties.peildatum, vandaag: opties.vandaag,
      seconden: Math.round((Date.now() - t0) / 1000),
      aantallen: {
        orders: (bron.orders || []).length,
        orderregels: (bron.orderregels || []).length,
        leveringen: (bron.leveringen || []).length,
        facturen: (bron.facturen || []).length,
        facturenZonderOrder: (bron.facturenZonderOrder || []).length,
        leveringenZonderOrder: (bron.leveringenZonderOrder || []).length,
      },
      overzichten: overzichten,
      meldingen: meldingen,
    };
  }

  global.fpInkoopketen = {
    bouw: bouw,
    /* Los te testen, want hier zit de logica die het meest kan schuiven. */
    _intern: { dag: dag, voorOfOp: voorOfOp, geleverdPer: geleverdPer,
               zoekOrdernummer: zoekOrdernummer, bouwIndex: bouwIndex,
               bouwOverzichten: bouwOverzichten, dagenTussen: dagenTussen },
  };

})(typeof window !== "undefined" ? window : globalThis);
