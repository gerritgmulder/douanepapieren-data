/* ═══════════════════════════════════════════════════════════════════════════
   BANKAANSLUITING — sluit wat Logic4 als ontvangen registreert aan op de bank?
   ═══════════════════════════════════════════════════════════════════════════

   Waarom
   ------
   Accountant Kevin vroeg het scherp: zijn de betalingen vergeleken met het
   bankboek of met bankafschriften? Het eerlijke antwoord was: geen van beide —
   de analyses tot nu toe gebruiken de betaalregistratie op de factuur in
   Logic4. Dat zegt wat er als betaald is geboekt, niet dat het geld ook
   werkelijk binnenkwam. Dit blok legt die laatste stap.

   Hoe
   ---
   Links de bankafschriften (MT940), rechts de betaalregels uit Logic4 die op
   een bankrekening zijn geboekt. Drie controles:

     1. Sluit elk afschrift op zichzelf?  beginsaldo + mutaties = eindsaldo.
        Klopt dat niet, dan mist er een afschrift en heeft vergelijken geen zin.
     2. Sluit het per maand aan?  wat er binnenkwam tegenover wat Logic4 als
        ontvangst registreerde.
     3. Wat blijft er over?  bankontvangsten zonder registratie in Logic4, en
        registraties zonder bijschrijving op de bank.

   De grootboekrekeningen komen uit Logic4 zelf (GetLedgers), zodat een nieuwe
   bankrekening niet in een lijstje hier hoeft te worden bijgehouden.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var BASIS = "https://fonteyn-data-store.g-mulder.workers.dev";
  var BUCKET = BASIS + "/data/gg-bank";
  var GELIJK = 5, PER = 500;

  var cfg = null, uitkomst = null, doel = null, bezig = false, bestanden = [];

  function el(t, k, x) { var e = document.createElement(t); if (k) e.className = k; if (x != null) e.textContent = x; return e; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function euro(n) { return "€ " + Math.round(num(n)).toLocaleString("nl-NL"); }
  function euro2(n) { return num(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function nl(d) {
    if (!d) return "—";
    var s = String(d).slice(0, 10).split("-");
    return s.length === 3 ? s[2] + "-" + s[1] + "-" + s[0] : String(d);
  }
  function maand(d) { return String(d || "").slice(0, 7); }

  /* ═══════════ welke grootboekrekeningen zijn 'geld binnen' ═══════════
     Uit Logic4 zelf, zodat een nieuwe rekening niet hier hoeft te worden
     bijgehouden. Banken, betaaldienstverleners en kassa's tellen mee; de
     tussenrekeningen en debiteuren niet — daar staat het geld nog niet. */

  async function bankRekeningen() {
    var led = await cfg.logic4("/v3/Financial/GetLedgers", null, "GET");
    var lijst = Array.isArray(led) ? led : (led && led.Records) || [];
    var uit = {};
    for (var i = 0; i < lijst.length; i++) {
      var code = Number(lijst[i].Code), oms = String(lijst[i].Description || "");
      if (!(code >= 1000 && code < 1200)) continue;
      // 1185 is een tussenrekening: geld onderweg, nog niet op de bank.
      if (/tussenrekening/i.test(oms)) continue;
      if (/spaarrekening/i.test(oms)) continue;
      uit[String(code)] = oms;
    }
    return uit;
  }

  /* ═══════════ de bankkant ═══════════ */

  function leesAfschriften(lijst, melden) {
    return Promise.all(lijst.map(function (f) {
      return new Promise(function (klaar, mis) {
        var r = new FileReader();
        r.onerror = function () { mis(new Error("kon " + f.name + " niet lezen")); };
        r.onload = function (e) {
          try {
            var p = global.fpMT940.parse(String(e.target.result));
            var som = (p.transactions || []).reduce(function (t, x) { return t + num(x.amount); }, 0);
            var begin = p.openingBalance ? num(p.openingBalance.amount) : null;
            var eind = p.closingBalance ? num(p.closingBalance.amount) : null;
            klaar({
              bestand: f.name, iban: p.iban || "", afschrift: p.statementNr || "",
              begin: begin, eind: eind, mutaties: som,
              // Controle 1: het afschrift moet op zichzelf kloppen.
              sluit: (begin === null || eind === null) ? null : Math.abs(begin + som - eind) < 0.02,
              verschil: (begin === null || eind === null) ? null : Math.round((begin + som - eind) * 100) / 100,
              transacties: (p.transactions || []).map(function (x) {
                return { datum: x.date, bedrag: num(x.amount), oms: String(x.description || "").slice(0, 160) };
              }),
            });
          } catch (fout) { mis(fout); }
        };
        r.readAsText(f);
      });
    }));
  }

  /* ═══════════ de Logic4-kant ═══════════ */

  async function logic4Ontvangsten(vanaf, tot, rekeningen, melden) {
    // Logic4 filtert orders op aanmaakdatum, niet op betaaldatum. Een betaling
    // in juni kan best op een order uit maart vorig jaar staan; zouden we pas
    // vanaf de afschriftdatum ophalen, dan misten we die en leek er geld op de
    // bank te staan dat niet geregistreerd was. Daarom twee jaar terug beginnen
    // en daarna strikt op de betaaldatum filteren.
    var start = new Date(new Date(vanaf).getTime() - 730 * 86400000).toISOString().slice(0, 10);
    var orders = [], skip = 0, klaar = false, ronde = 0;
    while (!klaar && ronde < 200) {
      var verzoeken = [];
      for (var i = 0; i < GELIJK; i++) {
        verzoeken.push(cfg.logic4("/v3/Orders/GetOrders", {
          TakeRecords: PER, SkipRecords: skip + i * PER,
          CreationDateFrom: start, LoadPayments: true
        }).catch(function () { return []; }));
      }
      var uit = await Promise.all(verzoeken);
      for (var j = 0; j < uit.length; j++) {
        var lijst = Array.isArray(uit[j]) ? uit[j] : (uit[j] && uit[j].Records) || [];
        orders.push.apply(orders, lijst);
        if (lijst.length < PER) klaar = true;
      }
      skip += GELIJK * PER; ronde++;
      melden("Betalingen uit Logic4 ophalen… " + orders.length.toLocaleString("nl-NL") + " orders", Math.min(70, 20 + orders.length / 4000));
    }
    var betalingen = [];
    for (var o = 0; o < orders.length; o++) {
      var ord = orders[o];
      var p = ord.Payments || [];
      for (var b = 0; b < p.length; b++) {
        var code = String(p[b].LedgerCode || "");
        if (!rekeningen[code]) continue;
        var d = String(p[b].DateTime || "").slice(0, 10);
        if (!d || d < vanaf || d > tot) continue;
        betalingen.push({
          order: ord.Id, datum: d, bedrag: num(p[b].AmountIncl),
          rekening: code, oms: String(p[b].Description || "").slice(0, 120),
        });
      }
    }
    return betalingen;
  }

  /* ═══════════ de aansluiting ═══════════ */

  async function bouw(lijst, melden) {
    melden("Bankafschriften inlezen…", 6);
    var afschriften = await leesAfschriften(lijst, melden);
    var alleTx = [];
    afschriften.forEach(function (a) {
      a.transacties.forEach(function (t) { alleTx.push(Object.assign({ iban: a.iban }, t)); });
    });
    if (!alleTx.length) throw new Error("Geen transacties in deze bestanden gevonden.");

    var datums = alleTx.map(function (t) { return t.datum; }).filter(Boolean).sort();
    var vanaf = datums[0], tot = datums[datums.length - 1];

    melden("Grootboekrekeningen ophalen…", 14);
    var rekeningen = await bankRekeningen();

    var betalingen = await logic4Ontvangsten(vanaf, tot, rekeningen, melden);

    melden("Vergelijken…", 78);

    // Controle 2 — per maand, alleen wat binnenkomt (credit).
    var perMaand = {};
    alleTx.forEach(function (t) {
      if (t.bedrag <= 0) return;
      var m = maand(t.datum);
      perMaand[m] = perMaand[m] || { bank: 0, bankN: 0, logic4: 0, logic4N: 0 };
      perMaand[m].bank += t.bedrag; perMaand[m].bankN++;
    });
    betalingen.forEach(function (p) {
      if (p.bedrag <= 0) return;
      var m = maand(p.datum);
      perMaand[m] = perMaand[m] || { bank: 0, bankN: 0, logic4: 0, logic4N: 0 };
      perMaand[m].logic4 += p.bedrag; perMaand[m].logic4N++;
    });

    // Controle 3 — koppelen op bedrag en datum. Een bankbijschrijving en de
    // registratie in Logic4 hoeven niet op dezelfde dag te staan; vijf dagen
    // speling vangt weekenden en verwerkingstijd.
    var open = betalingen.filter(function (p) { return p.bedrag > 0; }).map(function (p, i) { return { i: i, p: p, raak: false }; });
    var perBedrag = {};
    open.forEach(function (x) {
      var k = Math.round(x.p.bedrag * 100);
      (perBedrag[k] = perBedrag[k] || []).push(x);
    });
    var bankLos = [];
    alleTx.filter(function (t) { return t.bedrag > 0; }).forEach(function (t) {
      var k = Math.round(t.bedrag * 100);
      var kand = perBedrag[k] || [];
      var hit = null;
      for (var i = 0; i < kand.length; i++) {
        if (kand[i].raak) continue;
        var dagen = Math.abs((new Date(t.datum) - new Date(kand[i].p.datum)) / 86400000);
        if (dagen <= 5) { hit = kand[i]; break; }
      }
      if (hit) hit.raak = true; else bankLos.push(t);
    });
    var logic4Los = open.filter(function (x) { return !x.raak; }).map(function (x) { return x.p; });

    var bankIn = alleTx.filter(function (t) { return t.bedrag > 0; }).reduce(function (a, t) { return a + t.bedrag; }, 0);
    var l4In = betalingen.filter(function (p) { return p.bedrag > 0; }).reduce(function (a, p) { return a + p.bedrag; }, 0);

    melden("Klaar", 100);
    return {
      gemaakt: new Date().toISOString(), door: cfg.email || null,
      vanaf: vanaf, tot: tot,
      afschriften: afschriften.map(function (a) {
        return { bestand: a.bestand, iban: a.iban, afschrift: a.afschrift, begin: a.begin, eind: a.eind, mutaties: Math.round(a.mutaties * 100) / 100, sluit: a.sluit, verschil: a.verschil, aantal: a.transacties.length };
      }),
      rekeningen: rekeningen,
      bank: { aantal: alleTx.filter(function (t) { return t.bedrag > 0; }).length, bedrag: bankIn },
      logic4: { aantal: betalingen.filter(function (p) { return p.bedrag > 0; }).length, bedrag: l4In },
      verschil: bankIn - l4In,
      perMaand: perMaand,
      bankLos: { aantal: bankLos.length, bedrag: bankLos.reduce(function (a, t) { return a + t.bedrag; }, 0), lijst: bankLos.slice(0, 300) },
      logic4Los: { aantal: logic4Los.length, bedrag: logic4Los.reduce(function (a, p) { return a + p.bedrag; }, 0), lijst: logic4Los.slice(0, 300) },
    };
  }

  /* ═══════════ opslaan ═══════════ */

  async function bewaar(u) {
    try {
      var oud = await (await fetch(BUCKET, { headers: { "X-Fonteyn-Auth": cfg.teamKey } })).json().catch(function () { return null; });
      var historie = (oud && oud.historie) || [];
      historie.unshift({ gemaakt: u.gemaakt, door: u.door, vanaf: u.vanaf, tot: u.tot, bank: u.bank.bedrag, logic4: u.logic4.bedrag, verschil: u.verschil });
      await fetch(BUCKET, {
        method: "PUT", headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
        body: JSON.stringify({ laatste: u, historie: historie.slice(0, 36) })
      });
    } catch (e) { console.warn("[bank] bewaren mislukt:", e); }
  }
  async function laadLaatste() {
    try {
      var r = await fetch(BUCKET, { headers: { "X-Fonteyn-Auth": cfg.teamKey } });
      if (!r.ok) return null;
      var j = await r.json();
      return j && j.laatste ? j : null;
    } catch (e) { return null; }
  }

  /* ═══════════ tekenen ═══════════ */

  function teken(bewaard) {
    if (!doel) return;
    doel.innerHTML = "";
    var u = uitkomst || (bewaard && bewaard.laatste) || null;

    var kop = el("div", "ba-uitleg");
    kop.appendChild(el("h3", null, "Bankaansluiting — kwam het geld ook echt binnen?"));
    kop.appendChild(el("p", null,
      "De andere controles gebruiken de betaalregistratie in Logic4. Die zegt wat er als betaald is geboekt, " +
      "niet dat het geld op de rekening staat. Hier zetten we de bankafschriften ernaast."));
    doel.appendChild(kop);

    var vak = el("div", "ba-invoer");
    var lab = el("label", null, "Bankafschriften (MT940 — meerdere tegelijk mag)");
    var inp = el("input"); inp.type = "file"; inp.multiple = true;
    inp.accept = ".sta,.940,.txt,.mt940";
    inp.addEventListener("change", function () { bestanden = Array.prototype.slice.call(inp.files || []); });
    var knop = el("button", "ba-knop", "Aansluiten");
    knop.type = "button";
    knop.addEventListener("click", function () { start(knop); });
    vak.appendChild(lab); vak.appendChild(inp); vak.appendChild(knop);
    if (!cfg.magWijzigen) { inp.disabled = knop.disabled = true; }
    doel.appendChild(vak);

    if (!u) {
      doel.appendChild(el("p", "uitleg",
        "Nog geen aansluiting gemaakt. Laad de MT940-bestanden van de periode die je wilt controleren; " +
        "de bijbehorende betalingen uit Logic4 haal ik er zelf bij."));
      return;
    }

    // afschriften die niet op zichzelf sluiten
    var kapot = (u.afschriften || []).filter(function (a) { return a.sluit === false; });
    if (kapot.length) {
      var w = el("div", "ba-let");
      w.appendChild(el("strong", null, "Let op: " + kapot.length + " afschrift(en) sluiten niet op zichzelf. "));
      w.appendChild(document.createTextNode(
        "Beginsaldo plus mutaties komt niet uit op het eindsaldo. Dan mist er een afschrift of is er een " +
        "regel weggevallen, en heeft vergelijken met Logic4 pas zin nadat dat is opgelost."));
      doel.appendChild(w);
    }

    var c = el("div", "ba-cijfers");
    function blok(t, g, k, klas) {
      var d = el("div", "ba-blok" + (klas ? " " + klas : ""));
      d.appendChild(el("div", "t", t)); d.appendChild(el("div", "g", g)); d.appendChild(el("div", "k", k));
      return d;
    }
    c.appendChild(blok("Binnengekomen op de bank", euro(u.bank.bedrag), u.bank.aantal + " bijschrijvingen"));
    c.appendChild(blok("Geregistreerd in Logic4", euro(u.logic4.bedrag), u.logic4.aantal + " betalingen"));
    c.appendChild(blok("Verschil", euro(u.verschil), Math.abs(u.verschil) < 1 ? "sluit aan" : "uitzoeken",
      Math.abs(u.verschil) < 1 ? "" : "let"));
    doel.appendChild(c);

    doel.appendChild(el("p", "uitleg",
      "Periode " + nl(u.vanaf) + " tot en met " + nl(u.tot) + ", " + (u.afschriften || []).length +
      " afschrift(en). Gemaakt op " + nl(u.gemaakt) + (u.door ? " door " + u.door : "") + "."));

    var kn = el("div", "ba-knoppen");
    var ex = el("button", "ba-knop licht", "Exporteren voor de accountant"); ex.type = "button";
    ex.addEventListener("click", function () { exporteer(u); });
    kn.appendChild(ex);
    doel.appendChild(kn);

    // per maand
    doel.appendChild(el("h4", "ba-kop", "Per maand"));
    var w1 = el("div", "ba-tabelwrap");
    var t1 = el("table", "ba-tabel");
    var th1 = el("thead"), hr1 = el("tr");
    ["Maand", "Bank", "Logic4", "Verschil"].forEach(function (h) { hr1.appendChild(el("th", null, h)); });
    th1.appendChild(hr1); t1.appendChild(th1);
    var tb1 = el("tbody");
    Object.keys(u.perMaand).sort().forEach(function (m) {
      var v = u.perMaand[m], d = v.bank - v.logic4;
      var tr = el("tr", Math.abs(d) > 1 ? "let" : "");
      tr.appendChild(el("td", null, m));
      tr.appendChild(el("td", "r", euro2(v.bank) + "  (" + v.bankN + ")"));
      tr.appendChild(el("td", "r", euro2(v.logic4) + "  (" + v.logic4N + ")"));
      tr.appendChild(el("td", "r", euro2(d)));
      tb1.appendChild(tr);
    });
    t1.appendChild(tb1); w1.appendChild(t1); doel.appendChild(w1);

    // wat niet koppelt
    doel.appendChild(el("h4", "ba-kop", "Wat niet aan elkaar te koppelen is"));
    var g = el("div", "ba-cijfers");
    g.appendChild(blok("Op de bank, niet in Logic4", euro(u.bankLos.bedrag), u.bankLos.aantal + " bijschrijvingen", u.bankLos.aantal ? "let" : ""));
    g.appendChild(blok("In Logic4, niet op de bank", euro(u.logic4Los.bedrag), u.logic4Los.aantal + " betalingen", u.logic4Los.aantal ? "let" : ""));
    doel.appendChild(g);
    doel.appendChild(el("p", "uitleg",
      "Gekoppeld op bedrag met vijf dagen speling. Wat overblijft is niet meteen fout: betaaldiensten als " +
      "Mollie en Multisafepay schrijven per dag één verzamelbedrag over terwijl Logic4 elke klantbetaling apart " +
      "registreert, en kasontvangsten staan helemaal niet op een afschrift. Neem dus eerst de grote posten door."));

    if (u.bankLos.lijst && u.bankLos.lijst.length) {
      var w2 = el("div", "ba-tabelwrap");
      var t2 = el("table", "ba-tabel klein");
      var th2 = el("thead"), hr2 = el("tr");
      ["Datum", "Bedrag", "Omschrijving op het afschrift"].forEach(function (h) { hr2.appendChild(el("th", null, h)); });
      th2.appendChild(hr2); t2.appendChild(th2);
      var tb2 = el("tbody");
      u.bankLos.lijst.slice(0, 25).forEach(function (t) {
        var tr = el("tr");
        tr.appendChild(el("td", null, nl(t.datum)));
        tr.appendChild(el("td", "r", euro2(t.bedrag)));
        tr.appendChild(el("td", null, String(t.oms).slice(0, 90)));
        tb2.appendChild(tr);
      });
      t2.appendChild(tb2); w2.appendChild(t2); doel.appendChild(w2);
    }
  }

  /* ═══════════ export ═══════════ */

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
  function exporteer(u) {
    var d = String(u.gemaakt).slice(0, 10).split("-").reverse().join("");
    var r = [["Bankaansluiting", nl(u.vanaf) + " t/m " + nl(u.tot)], [],
    ["", "Aantal", "Bedrag EUR"],
    ["Binnengekomen op de bank", u.bank.aantal, u.bank.bedrag],
    ["Geregistreerd in Logic4", u.logic4.aantal, u.logic4.bedrag],
    ["Verschil", "", u.verschil], [],
    ["Op de bank, niet in Logic4", u.bankLos.aantal, u.bankLos.bedrag],
    ["In Logic4, niet op de bank", u.logic4Los.aantal, u.logic4Los.bedrag], [],
    ["AFSCHRIFTEN"], ["Bestand", "IBAN", "Nr", "Beginsaldo", "Mutaties", "Eindsaldo", "Sluit", "Verschil", "Transacties"]];
    (u.afschriften || []).forEach(function (a) {
      r.push([a.bestand, a.iban, a.afschrift, a.begin, a.mutaties, a.eind, a.sluit === null ? "?" : (a.sluit ? "ja" : "NEE"), a.verschil, a.aantal]);
    });
    r.push([], ["PER MAAND"], ["Maand", "Bank EUR", "Logic4 EUR", "Verschil EUR"]);
    Object.keys(u.perMaand).sort().forEach(function (m) {
      var v = u.perMaand[m]; r.push([m, v.bank, v.logic4, v.bank - v.logic4]);
    });
    download("bankaansluiting-" + d + ".csv", r);
    var r2 = [["Kant", "Datum", "Bedrag EUR", "Order", "Rekening", "Omschrijving"]];
    (u.bankLos.lijst || []).forEach(function (t) { r2.push(["bank, niet in Logic4", t.datum, t.bedrag, "", t.iban || "", t.oms]); });
    (u.logic4Los.lijst || []).forEach(function (p) { r2.push(["Logic4, niet op de bank", p.datum, p.bedrag, p.order, p.rekening, p.oms]); });
    download("bankaansluiting-verschillen-" + d + ".csv", r2);
    if (cfg.log) cfg.log("geldgoederen", "bankaansluiting-export", nl(u.vanaf) + " t/m " + nl(u.tot));
  }

  /* ═══════════ starten ═══════════ */

  async function start(knop) {
    if (bezig) return;
    if (!global.fpMT940) { alert("De bankafschrift-lezer is niet geladen. Sluit de app af en start hem opnieuw."); return; }
    if (!bestanden.length) { alert("Kies eerst één of meer MT940-bestanden."); return; }
    bezig = true; knop.disabled = true; knop.textContent = "Bezig…";
    var melden = cfg.melden || function () {};
    try {
      uitkomst = await bouw(bestanden, melden);
      await bewaar(uitkomst);
      if (cfg.log) cfg.log("geldgoederen", "bankaansluiting",
        uitkomst.vanaf + " t/m " + uitkomst.tot + ", verschil " + Math.round(uitkomst.verschil));
      teken(await laadLaatste());
    } catch (e) {
      alert("Niet gelukt: " + (e.message || e));
    }
    bezig = false;
    if (knop) { knop.disabled = false; knop.textContent = "Aansluiten"; }
  }

  async function init(opties) {
    cfg = opties || {};
    doel = document.getElementById(cfg.doelId || "bankaansluiting");
    if (!doel || !cfg.teamKey) return;
    teken(await laadLaatste());
  }

  global.fpBank = { init: init, bouw: bouw };

})(typeof window !== "undefined" ? window : globalThis);
