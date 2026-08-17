/* ═══════════════════════════════════════════════════════════════════════════
   VOORUITONTVANGEN PER PEILDATUM — grootboek 1350
   ═══════════════════════════════════════════════════════════════════════════

   Wat de accountant vraagt
   ------------------------
   Een aansluiting van grootboek 1350 met de verkooporderadministratie, in vier
   overzichten:

     1  Stand per 31 december 2025
     2  Stand per 31 juli 2026
     3  Stand per 31 december 2024
     4  Verkooporders zonder enige afwikkeling, ouder dan een jaar

   Per order: debiteurnummer, debiteur, ordernummer, orderdatum, orderbedrag en
   de ontvangen aanbetaling.

   Waarom dit lastiger is dan het lijkt
   ------------------------------------
   Een stand "per 31 december 2025" is niet de stand van vandaag. Logic4 geeft
   bij een order de huidige situatie: wat er nu betaald is, wat er nu geleverd
   is. Wie dat overneemt krijgt een lijst die klopt voor vandaag en niet voor
   de balansdatum - en juist dat verschil is waar deze controle over gaat.

   Daarom wordt alles teruggerekend:

     • de aanbetaling is de som van de betalingen tot en met de peildatum, niet
       het totaal dat er nu op staat;
     • of er geleverd was, komt uit de leveringen met een datum tot en met de
       peildatum, niet uit het huidige aantal geleverd;
     • een order die ná de peildatum is aangemaakt telt niet mee, hoe open hij
       nu ook is.

   Een order hoort op de lijst zolang er geld is ontvangen waar nog een
   levering tegenover staat. Is er op de peildatum al geleverd én gefactureerd,
   dan is de verplichting afgelopen en hoort hij er niet meer bij.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var PER_KEER = 500;
  var MAX_RONDEN = 400;

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
  function tot(datum, peil) {
    var d = dag(datum);
    return d !== "" && d <= peil;
  }
  function dagenTussen(van, tot2) {
    if (!van || !tot2) return "";
    var a = new Date(van + "T00:00:00").getTime(), b = new Date(tot2 + "T00:00:00").getTime();
    return (isFinite(a) && isFinite(b)) ? Math.round((b - a) / 86400000) : "";
  }

  async function alles(logic4, pad, body, meld) {
    var uit = [], skip = 0;
    for (var i = 0; i < MAX_RONDEN; i++) {
      var vraag = Object.assign({}, body, { SkipRecords: skip, TakeRecords: PER_KEER });
      var deel = await logic4(pad, vraag);
      if (!Array.isArray(deel)) deel = deel ? [deel] : [];
      uit = uit.concat(deel);
      if (meld && i % 4 === 0) meld(uit.length);
      if (deel.length < PER_KEER) break;
      skip += PER_KEER;
    }
    return uit;
  }

  /* ── Ophalen ───────────────────────────────────────────────────────── */

  async function haal(cfg) {
    var meld = cfg.meld || function () {};
    var bron = {};

    /* Alle orders vanaf de vroegste peildatum. LoadPayments zorgt dat de
       betalingen met hun datum meekomen; zonder dat is terugrekenen naar een
       peildatum onmogelijk. */
    meld("Verkooporders ophalen…");
    bron.orders = await alles(cfg.logic4, "/v3/Orders/GetOrders",
      { CreationDateFrom: cfg.vanaf, CreationDateTo: cfg.vandaag, LoadPayments: true },
      function (n) { meld("Verkooporders ophalen… " + n); });

    meld("Leveringen ophalen…");
    bron.leveringen = await alles(cfg.logic4, "/v3/Delivery/GetDeliveries",
      { DateTimeFrom: cfg.vanaf, DateTimeTo: cfg.vandaag },
      function (n) { meld("Leveringen ophalen… " + n); });

    meld("Facturen ophalen…");
    bron.facturen = await alles(cfg.logic4, "/v3/Orders/GetInvoices",
      { CreationDateFrom: cfg.vanaf, CreationDateTo: cfg.vandaag },
      function (n) { meld("Facturen ophalen… " + n); });

    return bron;
  }

  /* ── Per order alles bij elkaar ────────────────────────────────────── */

  function bouwIndex(bron) {
    var per = {};
    (bron.orders || []).forEach(function (o) {
      var id = tekst(o.Id);
      if (!id) return;
      var adres = o.InvoiceAddress || o.AccountAddress || o.DeliveryAddress || {};
      per[id] = {
        orderId: id,
        debiteurId: tekst(o.DebtorId),
        debiteur: tekst(adres.CompanyName || adres.ContactName || o.Description),
        datum: dag(o.CreationDate),
        bedrag: getal(o.Totals && o.Totals.AmountIncl),
        status: tekst(o.OrderStatus && o.OrderStatus.Value),
        statusId: tekst(o.OrderStatus && o.OrderStatus.Id),
        betalingen: (o.Payments || []).map(function (b) {
          return { datum: dag(b.DateTime), bedrag: getal(b.AmountIncl),
                   omschrijving: tekst(b.Description), grootboek: tekst(b.LedgerCode) };
        }),
        regels: (o.OrderRows || []).map(function (r) {
          return { aantal: getal(r.Qty), geleverdNu: getal(r.QtyDeliverd),
                   nietGefactureerd: getal(r.QtyDeliverd_NotInvoiced) };
        }),
        leveringen: [], facturen: [],
      };
    });

    (bron.leveringen || []).forEach(function (l) {
      var o = per[tekst(l.OrderId)];
      if (o) o.leveringen.push({ datum: dag(l.DeliveryDate), id: tekst(l.DeliveryId) });
    });
    (bron.facturen || []).forEach(function (f) {
      var id = tekst(f.InvoiceBelongsToOrderNumber || f.OrderId || f.Id);
      var o = per[id];
      if (o) o.facturen.push({ datum: dag(f.CreationDate), id: tekst(f.Id),
                               bedrag: getal(f.Totals && f.Totals.AmountIncl) });
    });
    return per;
  }

  /* De stand van één order op een peildatum. Alles wat later is gebeurd telt
     niet mee - dat is het hele punt van een balanspositie. */
  function standOp(o, peil) {
    var betaald = 0;
    o.betalingen.forEach(function (b) { if (tot(b.datum, peil)) betaald += b.bedrag; });
    var geleverd = o.leveringen.filter(function (l) { return tot(l.datum, peil); }).length;
    var gefactureerd = o.facturen.filter(function (f) { return tot(f.datum, peil); });
    var gefactureerdBedrag = gefactureerd.reduce(function (n, f) { return n + f.bedrag; }, 0);
    return {
      bestond: tot(o.datum, peil),
      aanbetaling: betaald,
      leveringen: geleverd,
      facturen: gefactureerd.length,
      gefactureerd: gefactureerdBedrag,
      /* Nog een leveringsverplichting: er is geld binnen en er is op die datum
         nog niet volledig afgewikkeld. Volledig afgewikkeld betekent hier: er
         is gefactureerd voor minstens het orderbedrag. Deelfacturen laten de
         verplichting dus staan, en dat hoort ook. */
      openstaand: betaald > 0 && gefactureerdBedrag < o.bedrag - 0.005,
    };
  }

  /* ── De vier overzichten ───────────────────────────────────────────── */

  function regel(o, s) {
    return {
      debiteurnummer: o.debiteurId,
      debiteur: o.debiteur,
      verkoopordernummer: o.orderId,
      orderdatum: o.datum,
      orderbedrag: o.bedrag,
      ontvangenAanbetaling: s.aanbetaling,
      gefactureerdPerPeildatum: s.gefactureerd,
      nogTeFactureren: Math.round((o.bedrag - s.gefactureerd) * 100) / 100,
      leveringenTotPeildatum: s.leveringen,
      status: o.status,
    };
  }

  function overzichten(per, cfg) {
    var uit = { peildata: {}, zonderAfwikkeling: [] };

    (cfg.peildata || []).forEach(function (peil) {
      var lijst = [];
      Object.keys(per).forEach(function (id) {
        var o = per[id];
        var s = standOp(o, peil);
        if (!s.bestond || !s.openstaand) return;
        lijst.push(regel(o, s));
      });
      lijst.sort(function (a, b) { return b.ontvangenAanbetaling - a.ontvangenAanbetaling; });
      uit.peildata[peil] = {
        regels: lijst,
        totaalAanbetaling: lijst.reduce(function (n, r) { return n + r.ontvangenAanbetaling; }, 0),
        totaalOrderbedrag: lijst.reduce(function (n, r) { return n + r.orderbedrag; }, 0),
      };
    });

    /* Overzicht 4: orders die er nog steeds zijn maar waar niets mee gebeurd
       is. Geen aanbetaling, geen levering, geen factuur, en ouder dan een
       jaar. Dat is een andere vraag dan de drie standen hierboven: die gaan
       over geld dat binnen is, deze over orders die blijven hangen. */
    var grens = cfg.ouderDan || "2025-06-30";
    Object.keys(per).forEach(function (id) {
      var o = per[id];
      if (!o.datum || o.datum > grens) return;
      var nu = standOp(o, cfg.vandaag);
      if (nu.aanbetaling > 0 || nu.leveringen > 0 || nu.facturen > 0) return;
      uit.zonderAfwikkeling.push({
        debiteurnummer: o.debiteurId,
        debiteur: o.debiteur,
        verkoopordernummer: o.orderId,
        orderdatum: o.datum,
        orderwaarde: o.bedrag,
        status: o.status,
        ouderdomDagen: dagenTussen(o.datum, cfg.vandaag),
        /* Deze twee kan het dashboard niet weten. Ze staan er leeg in zodat de
           kolom bestaat en iemand hem kan invullen; ze verzinnen zou erger
           zijn dan ze openlaten. */
        toelichting: "",
        verwachteAfwikkeling: "",
      });
    });
    uit.zonderAfwikkeling.sort(function (a, b) { return b.ouderdomDagen - a.ouderdomDagen; });

    return uit;
  }

  async function bouw(cfg) {
    if (!cfg || typeof cfg.logic4 !== "function") throw new Error("logic4-functie ontbreekt");
    var opties = {
      logic4: cfg.logic4,
      peildata: cfg.peildata || ["2024-12-31", "2025-12-31", "2026-07-31"],
      vandaag: cfg.vandaag || new Date().toISOString().slice(0, 10),
      vanaf: cfg.vanaf || "2020-01-01",
      ouderDan: cfg.ouderDan || "2025-06-30",
      meld: cfg.meld || function () {},
    };
    var t0 = Date.now();
    var bron = await haal(opties);
    opties.meld("Standen per peildatum berekenen…");
    var per = bouwIndex(bron);
    var uit = overzichten(per, opties);

    var meldingen = [];
    var zonderBetaaldatum = 0;
    Object.keys(per).forEach(function (id) {
      per[id].betalingen.forEach(function (b) { if (!b.datum) zonderBetaaldatum++; });
    });
    if (zonderBetaaldatum)
      meldingen.push(zonderBetaaldatum + " betaling(en) hebben geen datum. Die tellen bij geen enkele " +
                     "peildatum mee, waardoor de aanbetaling daar te laag uitkomt.");
    if (!(bron.leveringen || []).length)
      meldingen.push("Er kwamen geen leveringen terug. De kolom 'leveringen tot peildatum' blijft dan leeg.");

    return {
      vandaag: opties.vandaag,
      seconden: Math.round((Date.now() - t0) / 1000),
      aantallen: {
        orders: (bron.orders || []).length,
        leveringen: (bron.leveringen || []).length,
        facturen: (bron.facturen || []).length,
      },
      peildata: opties.peildata,
      overzichten: uit,
      meldingen: meldingen,
    };
  }

  global.fpVooruitPeil = {
    bouw: bouw,
    _intern: { standOp: standOp, bouwIndex: bouwIndex, overzichten: overzichten,
               dag: dag, tot: tot, dagenTussen: dagenTussen },
  };

})(typeof window !== "undefined" ? window : globalThis);
