/* ═══════════════════════════════════════════════════════════════════════════
   DEBITEURENLIJST — openstaande posten per klant
   ═══════════════════════════════════════════════════════════════════════════

   Waarom dit er is
   ----------------
   Dolf wil één lijst: klanten van hoog naar laag op openstaand bedrag, met de
   afdeling erbij (Veranda's, Spa's, Tuinhuizen) en met de vraag beantwoord of
   er misschien gewoon een betaling verkeerd gekoppeld is. Dat laatste bleek zo
   te zijn: er staat voor honderdduizenden euro's aan geld binnen dat op de
   verkeerde factuur is geland, waardoor klanten worden aangemaand die allang
   betaald hebben.

   Waarom apart van de maandelijkse controle
   -----------------------------------------
   De keten-controle draait op orders. Voor deze lijst is per openstaande
   factuur de klantnaam én de productgroep nodig, en die zitten alleen in de
   factuur zelf. Dat is één aanroep per openstaande post — ruim tweeduizend
   stuks, acht tegelijk, ongeveer tweeënhalve minuut. Dat wil je niet elke keer
   meenemen in de maandcontrole, dus het zit achter een eigen knop.

   Wat er wordt bewaard
   --------------------
   De artikel→productgroep-kaart gaat naar KV (bucket 'gg-artikelgroepen'). Die
   opbouwen kost een minuut en verandert nauwelijks, dus hij wordt hergebruikt
   zolang hij jonger is dan dertig dagen. Verder wordt er niets bewaard: de
   lijst is een momentopname die je downloadt.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var BASIS = "https://fonteyn-data-store.g-mulder.workers.dev";
  var GELIJK = 8;              // hoeveel facturen tegelijk ophalen
  var KAART_DAGEN = 30;        // zo lang is de artikel-kaart bruikbaar

  // Groepen die niets zeggen over de afdeling waar de order thuishoort.
  var GEEN_AFDELING = /verzendkosten|montage|service|korting|garantie|kadobon|statiegeld|creditcard|bouwdepot/i;

  var cfg = null;              // {logic4, teamKey, email, melden, log}

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  async function kvLees(bucket) {
    try {
      var r = await fetch(BASIS + "/data/" + bucket, { headers: { "X-Fonteyn-Auth": cfg.teamKey } });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  async function kvSchrijf(bucket, waarde) {
    try {
      await fetch(BASIS + "/data/" + bucket, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
        body: JSON.stringify(waarde)
      });
    } catch (e) { /* lukt het niet, dan bouwen we hem volgende keer opnieuw */ }
  }

  /* ═══════════ artikel → afdeling ═══════════ */

  async function artikelKaart() {
    var opgeslagen = await kvLees("gg-artikelgroepen");
    if (opgeslagen && opgeslagen.gemaakt && opgeslagen.artikelen) {
      var oud = (Date.now() - new Date(opgeslagen.gemaakt).getTime()) / 86400000;
      if (oud < KAART_DAGEN) return opgeslagen;
    }
    cfg.melden("Artikelbestand indelen naar afdeling…", 4);

    var groepen = {};
    var pg = await cfg.logic4("/v3/ProductGroups/GetProductGroups", { TakeRecords: 500, SkipRecords: 0 });
    for (var i = 0; i < (pg || []).length; i++) groepen[pg[i].Id] = pg[i].Name;

    var artikelen = {}, skip = 0;
    for (var p = 0; p < 200; p++) {
      var r = await cfg.logic4("/v3/Products/GetProducts", { TakeRecords: 1000, SkipRecords: skip });
      if (!r || !r.length) break;
      for (var j = 0; j < r.length; j++) artikelen[String(r[j].ProductCode)] = r[j].ProductGroupId1;
      cfg.melden("Artikelbestand indelen naar afdeling… " + Object.keys(artikelen).length.toLocaleString("nl-NL"), 4 + Math.min(10, r.length / 100));
      if (r.length < 1000) break;
      skip += 1000;
    }
    var kaart = { gemaakt: new Date().toISOString(), groepen: groepen, artikelen: artikelen };
    await kvSchrijf("gg-artikelgroepen", kaart);
    return kaart;
  }

  // De afdeling van een factuur is de productgroep met het grootste bedrag
  // erop. Transport, montage en korting tellen daarbij niet mee, want die
  // staan op bijna elke factuur en zeggen niets over waar hij thuishoort.
  function afdelingVan(regels, kaart) {
    if (!regels || !regels.length) return "";
    var per = {};
    for (var i = 0; i < regels.length; i++) {
      var g = kaart.artikelen[String(regels[i].ProductCode)];
      if (!g) continue;
      var naam = kaart.groepen[g] || ("groep " + g);
      per[naam] = (per[naam] || 0) + Math.abs(num(regels[i].Qty) * num(regels[i].NettPrice));
    }
    var alles = Object.keys(per).map(function (n) { return [n, per[n]]; });
    var echt = alles.filter(function (x) { return !GEEN_AFDELING.test(x[0]); });
    var bron = echt.length ? echt : alles;
    bron.sort(function (a, b) { return b[1] - a[1]; });
    return bron.length ? bron[0][0] : "";
  }

  /* ═══════════ de lijst opbouwen ═══════════ */

  async function bouw() {
    cfg.melden("Openstaande posten ophalen…", 2);
    var open = await cfg.logic4("/v3/Orders/GetOpenPaymentInvoices", {}) || [];
    if (!open.length) throw new Error("Logic4 gaf geen openstaande posten terug.");

    var kaart = await artikelKaart();

    // Per openstaande factuur de naam en de regels ophalen. Acht tegelijk:
    // sneller kan de API niet aan zonder fouten te gaan geven.
    cfg.melden("Facturen ophalen (0 van " + open.length + ")…", 15);
    var detail = {};
    for (var i = 0; i < open.length; i += GELIJK) {
      var groep = open.slice(i, i + GELIJK);
      var uit = await Promise.all(groep.map(function (p) {
        return cfg.logic4("/v3/Orders/GetInvoices", { Id: p.InvoiceId, TakeRecords: 1, SkipRecords: 0 })
          .then(function (r) { return r && r.length ? r[0] : null; })
          .catch(function () { return null; });
      }));
      for (var u = 0; u < uit.length; u++) if (uit[u]) detail[groep[u].InvoiceId] = uit[u];
      cfg.melden("Facturen ophalen (" + Math.min(i + GELIJK, open.length) + " van " + open.length + ")…",
        15 + Math.round(75 * Math.min(i + GELIJK, open.length) / open.length));
    }

    cfg.melden("Lijst samenstellen…", 92);
    var klanten = {};
    for (var k = 0; k < open.length; k++) {
      var post = open[k];
      var deb = String(post.DebtorId || "");
      var bedrag = num(post.AmountOutstanding);
      var f = detail[post.InvoiceId];
      if (!klanten[deb]) klanten[deb] = {
        deb: deb, naam: "", plaats: "", mail: "",
        open: 0, teveel: 0, nOpen: 0, nTeveel: 0, telaat: 0,
        afdelingen: {}, posten: []
      };
      var kl = klanten[deb];
      if (f && !kl.naam) {
        var adr = f.AccountAddress || f.InvoiceAddress || {};
        kl.naam = String(adr.CompanyName || "").trim() || String(adr.ContactName || "").trim();
        kl.plaats = adr.City || "";
        kl.mail = adr.Email || "";
      }
      var afd = f ? afdelingVan(f.OrderRows, kaart) : "";
      if (bedrag < 0) { kl.teveel += -bedrag; kl.nTeveel++; }
      else {
        kl.open += bedrag; kl.nOpen++;
        kl.telaat = Math.max(kl.telaat, num(post.DaysPastDueDate));
        if (afd) kl.afdelingen[afd] = (kl.afdelingen[afd] || 0) + bedrag;
      }
      kl.posten.push({
        factuur: post.InvoiceId, datum: post.InvoiceDate, bedrag: bedrag,
        telaat: num(post.DaysPastDueDate), afdeling: afd,
        totaal: num(post.TotalAmount), betaald: num(post.TotalAmountPayed)
      });
    }

    var lijst = [];
    for (var d in klanten) {
      var c = klanten[d];
      if (c.open <= 0.5) continue;
      var a = Object.keys(c.afdelingen).map(function (n) { return [n, c.afdelingen[n]]; })
        .sort(function (x, y) { return y[1] - x[1]; });
      c.afdeling = a.length ? a[0][0] : "";
      c.ook = a.slice(1, 3).map(function (x) { return x[0]; }).join(", ");
      // Hoeveel van het openstaande bedrag staat bij deze klant al ergens
      // anders binnen? Nooit meer dan het laagste van de twee.
      c.mogelijkGekoppeld = Math.min(c.open, c.teveel);
      // Exacte tegenhangers zijn geen vermoeden meer.
      var plus = c.posten.filter(function (p) { return p.bedrag > 0; });
      var min = c.posten.filter(function (p) { return p.bedrag < 0; });
      var gebruikt = {}, exact = 0;
      for (var pi = 0; pi < plus.length; pi++) {
        for (var mi = 0; mi < min.length; mi++) {
          if (gebruikt[mi]) continue;
          if (Math.abs(Math.abs(min[mi].bedrag) - plus[pi].bedrag) < 1) { gebruikt[mi] = true; exact++; break; }
        }
      }
      c.exact = exact;
      lijst.push(c);
    }
    lijst.sort(function (a, b) { return b.open - a.open; });

    cfg.melden("Klaar", 100);
    return { gemaakt: new Date().toISOString(), klanten: lijst, aantalPosten: open.length };
  }

  /* ═══════════ downloaden ═══════════ */

  function csvVeld(v) {
    var s = String(v == null ? "" : v).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    return /[";]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function download(naam, rijen) {
    var tekst = "﻿" + rijen.map(function (r) { return r.map(csvVeld).join(";"); }).join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([tekst], { type: "text/csv;charset=utf-8" }));
    a.download = naam;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function downloadLijst(uitkomst) {
    var d = new Date(uitkomst.gemaakt);
    var stempel = String(d.getDate()).padStart(2, "0") + String(d.getMonth() + 1).padStart(2, "0") + d.getFullYear();

    var r1 = [["Klant", "Plaats", "Afdeling", "Ook", "Openstaand EUR", "Facturen",
      "Dagen te laat", "Te veel ontvangen EUR", "Mogelijk verkeerd gekoppeld EUR",
      "Exact gelijke bedragen", "Debiteurnr", "E-mail"]];
    uitkomst.klanten.forEach(function (k) {
      r1.push([k.naam || ("debiteur " + k.deb), k.plaats, k.afdeling, k.ook,
        Math.round(k.open), k.nOpen, k.telaat,
        k.teveel > 0.5 ? Math.round(k.teveel) : "",
        k.mogelijkGekoppeld > 0.5 ? Math.round(k.mogelijkGekoppeld) : "",
        k.exact || "", k.deb, k.mail]);
    });
    download("debiteuren-per-klant-" + stempel + ".csv", r1);

    // Tweede bestand: alle losse posten, zodat Osman per factuur kan werken.
    var r2 = [["Klant", "Debiteurnr", "Factuur", "Factuurdatum", "Afdeling",
      "Factuurbedrag EUR", "Betaald EUR", "Openstaand EUR", "Dagen te laat"]];
    uitkomst.klanten.forEach(function (k) {
      k.posten.slice().sort(function (a, b) { return b.bedrag - a.bedrag; }).forEach(function (p) {
        r2.push([k.naam || ("debiteur " + k.deb), k.deb, p.factuur,
          String(p.datum || "").slice(0, 10), p.afdeling,
          Math.round(p.totaal), Math.round(p.betaald), Math.round(p.bedrag), p.telaat]);
      });
    });
    download("debiteuren-per-factuur-" + stempel + ".csv", r2);
  }

  global.fpDebiteuren = {
    bouw: function (opties) { cfg = opties; return bouw(); },
    download: downloadLijst
  };

})(typeof window !== "undefined" ? window : globalThis);
