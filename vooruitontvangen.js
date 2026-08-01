/* ═══════════════════════════════════════════════════════════════════════════
   VOORUITONTVANGEN BEDRAGEN (grootboek 1350)
   ═══════════════════════════════════════════════════════════════════════════

   Wat het is
   ----------
   Betaalt een klant vooruit, dan boekt Logic4 dat credit op 1350: wij hebben
   geld en moeten nog leveren. Zodra de order wordt gefactureerd loopt de post
   debet weer af. Sluit dat op elkaar aan, dan is het saldo per order nul.

   Waarom dit een eigen blok is
   ----------------------------
   Accountant Kevin vroeg om vijf dingen: bestaat de order, is de aanbetaling
   ontvangen, sluiten orderwaarde en levering aan, loopt de post ná balansdatum
   af, en sluit het grootboek aan op de orderadministratie. Die vragen zijn
   allemaal te beantwoorden — en anders dan bij 1630 kan het volledig uit
   Logic4 zelf: de betaalregels op een order dragen de grootboekcode mee. Er is
   dus geen export nodig en dit kan zo vaak als je wilt.

   Waar het echt om gaat
   ---------------------
   Niet het saldo, maar de posten die er niet meer horen te staan. Een order met
   status Afgehandeld of Geannuleerd waar nog een aanbetaling op staat, is geld
   van een klant dat óf terug moet, óf alsnog gefactureerd. Bij de eerste meting
   ging dat over ruim negenhonderd orders.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var BASIS = "https://fonteyn-data-store.g-mulder.workers.dev";
  var BUCKET = BASIS + "/data/gg-1350";
  var GELIJK = 5;          // pagina's tegelijk ophalen
  var PER = 500;
  var LEDGER = "1350";

  var cfg = null, uitkomst = null, doel = null, bezig = false;

  function el(t, k, x) { var e = document.createElement(t); if (k) e.className = k; if (x != null) e.textContent = x; return e; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function euro(n) { return "€ " + Math.round(num(n)).toLocaleString("nl-NL"); }
  function euro2(n) { return num(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function nl(d) {
    if (!d) return "—";
    var s = String(d).slice(0, 10).split("-");
    return s.length === 3 ? s[2] + "-" + s[1] + "-" + s[0] : String(d);
  }

  /* ═══════════ doorrekenen ═══════════ */

  async function bouw(vanaf, melden) {
    var orders = [], skip = 0, klaar = false, ronde = 0;
    while (!klaar && ronde < 200) {
      var verzoeken = [];
      for (var i = 0; i < GELIJK; i++) {
        verzoeken.push(cfg.logic4("/v3/Orders/GetOrders", {
          TakeRecords: PER, SkipRecords: skip + i * PER,
          CreationDateFrom: vanaf, LoadPayments: true
        }).catch(function () { return []; }));
      }
      var uit = await Promise.all(verzoeken);
      for (var j = 0; j < uit.length; j++) {
        var lijst = Array.isArray(uit[j]) ? uit[j] : (uit[j] && uit[j].Records) || [];
        orders.push.apply(orders, lijst);
        if (lijst.length < PER) klaar = true;
      }
      skip += GELIJK * PER; ronde++;
      melden("Orders doorrekenen… " + orders.length.toLocaleString("nl-NL"), Math.min(88, 5 + orders.length / 2000));
    }

    melden("Vooruitontvangen posten bepalen…", 90);
    var open = [], teveel = [], zonderRegel = 0;
    var afgewikkeld = 0;
    for (var o = 0; o < orders.length; o++) {
      var ord = orders[o];
      var regels = (ord.Payments || []).filter(function (b) { return String(b.LedgerCode) === LEDGER; });
      if (!regels.length) { zonderRegel++; continue; }
      var saldo = regels.reduce(function (t, b) { return t + num(b.AmountIncl); }, 0);
      if (Math.abs(saldo) < 0.005) { afgewikkeld++; continue; }

      var rows = ord.OrderRows || [];
      var totaal = ord.Totals || {};
      var berekend = rows.reduce(function (t, r) { return t + num(r.Qty) * num(r.InclPrice); }, 0);
      var incl = num(totaal.AmountIncl);
      var geleverd = rows.length > 0 && rows.every(function (r) { return num(r.QtyDeliverd) >= num(r.Qty); });
      var adr = ord.AccountAddress || ord.InvoiceAddress || {};
      var datums = regels.map(function (b) { return String(b.DateTime || "").slice(0, 10); }).filter(Boolean).sort();

      var post = {
        order: ord.Id, saldo: Math.round(saldo * 100) / 100,
        status: (ord.OrderStatus && ord.OrderStatus.Value) || "",
        datum: String(ord.CreationDate || "").slice(0, 10),
        klant: (String(adr.CompanyName || "").trim() || String(adr.ContactName || "").trim() || ""),
        debiteur: ord.DebtorId, incl: Math.round(incl * 100) / 100,
        berekend: Math.round(berekend * 100) / 100,
        // Wijkt de orderwaarde af van prijs maal hoeveelheid, dan klopt er iets
        // niet in de orderregels — dat is een van Kevins controlepunten.
        prijsWijktAf: incl > 0 && Math.abs(berekend - incl) > Math.max(1, incl * 0.02),
        geleverd: geleverd, regels: regels.length,
        eerste: datums[0] || null, laatste: datums[datums.length - 1] || null,
      };
      if (saldo < 0) open.push(post); else teveel.push(post);
    }

    open.sort(function (a, b) { return a.saldo - b.saldo; });
    teveel.sort(function (a, b) { return b.saldo - a.saldo; });

    var somOpen = open.reduce(function (t, p) { return t + p.saldo; }, 0);
    var somTeveel = teveel.reduce(function (t, p) { return t + p.saldo; }, 0);

    // Waar het om gaat: een aanbetaling op een order die niet meer loopt.
    var dood = open.filter(function (p) { return /afgehandeld|geannuleerd/i.test(p.status); });
    var nietGeleverd = open.filter(function (p) { return !p.geleverd && !/geannuleerd/i.test(p.status); });
    var scheef = open.filter(function (p) { return p.prijsWijktAf; });

    var perStatus = {};
    open.forEach(function (p) {
      var s = p.status || "(zonder status)";
      perStatus[s] = perStatus[s] || { n: 0, b: 0 };
      perStatus[s].n++; perStatus[s].b += p.saldo;
    });
    var perJaar = {};
    open.forEach(function (p) {
      var j = (p.eerste || p.datum || "????").slice(0, 4);
      perJaar[j] = perJaar[j] || { n: 0, b: 0 };
      perJaar[j].n++; perJaar[j].b += p.saldo;
    });

    melden("Klaar", 100);
    return {
      gemaakt: new Date().toISOString(), door: cfg.email || null, vanaf: vanaf,
      ordersBekeken: orders.length, zonderRegel: zonderRegel, afgewikkeld: afgewikkeld,
      open: { aantal: open.length, bedrag: somOpen },
      teveel: { aantal: teveel.length, bedrag: somTeveel },
      saldo: somOpen + somTeveel,
      dood: { aantal: dood.length, bedrag: dood.reduce(function (t, p) { return t + p.saldo; }, 0) },
      nietGeleverd: { aantal: nietGeleverd.length, bedrag: nietGeleverd.reduce(function (t, p) { return t + p.saldo; }, 0) },
      scheef: { aantal: scheef.length },
      perStatus: perStatus, perJaar: perJaar,
      // De zwaarste posten dragen het saldo; alles bewaren maakt de
      // momentopname onnodig groot.
      posten: open.slice(0, 500), postenTotaal: open.length,
      teveelPosten: teveel.slice(0, 200),
    };
  }

  /* ═══════════ opslaan ═══════════ */

  async function bewaar(u) {
    try {
      var oud = await (await fetch(BUCKET, { headers: { "X-Fonteyn-Auth": cfg.teamKey } })).json().catch(function () { return null; });
      var historie = (oud && oud.historie) || [];
      historie.unshift({
        gemaakt: u.gemaakt, door: u.door, saldo: u.saldo,
        open: u.open.bedrag, openN: u.open.aantal,
        dood: u.dood.bedrag, doodN: u.dood.aantal,
      });
      await fetch(BUCKET, {
        method: "PUT", headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
        body: JSON.stringify({ laatste: u, historie: historie.slice(0, 36) })
      });
    } catch (e) { console.warn("[1350] bewaren mislukt:", e); }
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

    var kop = el("div", "vo-uitleg");
    kop.appendChild(el("h3", null, "Vooruitontvangen bedragen — grootboek 1350"));
    kop.appendChild(el("p", null,
      "Betaalt een klant vooruit, dan staat dat als schuld op 1350 tot er is gefactureerd. " +
      "Dit blok rekent alle orders door en laat zien welke aanbetalingen nog openstaan — en vooral " +
      "welke daar niet meer horen te staan."));
    doel.appendChild(kop);

    var vak = el("div", "vo-invoer");
    var lab = el("label", null, "Orders vanaf");
    var jaar = el("input"); jaar.type = "text"; jaar.value = (u && u.vanaf) || "2020-01-01"; jaar.size = 12;
    var knop = el("button", "vo-knop", "Doorrekenen");
    knop.type = "button";
    knop.title = "Haalt alle orders vanaf die datum op. Duurt ongeveer twee minuten.";
    knop.addEventListener("click", function () { start(jaar.value, knop); });
    vak.appendChild(lab); vak.appendChild(jaar); vak.appendChild(knop);
    if (!cfg.magWijzigen) { jaar.disabled = knop.disabled = true; }
    doel.appendChild(vak);

    if (!u) {
      doel.appendChild(el("p", "uitleg", "Nog niet doorgerekend. Duurt ongeveer twee minuten; daarna staat het bewaard."));
      return;
    }

    var c = el("div", "vo-cijfers");
    function blok(t, g, k, klas) {
      var d = el("div", "vo-blok" + (klas ? " " + klas : ""));
      d.appendChild(el("div", "t", t));
      d.appendChild(el("div", "g", g));
      d.appendChild(el("div", "k", k));
      return d;
    }
    c.appendChild(blok("Openstaande aanbetalingen", euro(-u.open.bedrag), u.open.aantal + " orders"));
    c.appendChild(blok("Te veel afgeboekt", euro(u.teveel.bedrag), u.teveel.aantal + " orders"));
    c.appendChild(blok("Saldo 1350", euro(u.saldo), "credit = schuld aan klanten"));
    c.appendChild(blok("Order loopt niet meer", euro(-u.dood.bedrag), u.dood.aantal + " orders", "let"));
    doel.appendChild(c);

    var w = el("div", "vo-let");
    w.appendChild(el("strong", null, "Waar het om gaat: "));
    w.appendChild(document.createTextNode(
      u.dood.aantal + " orders met status Afgehandeld of Geannuleerd hebben nog een aanbetaling van samen " +
      euro(-u.dood.bedrag) + ". Bij een order die niet meer loopt hoort geen vooruitontvangen bedrag: " +
      "dat geld moet terug naar de klant of alsnog gefactureerd worden. " +
      "Daarnaast staat er " + euro(-u.nietGeleverd.bedrag) + " aan aanbetalingen op " + u.nietGeleverd.aantal +
      " orders die nog niet (volledig) geleverd zijn — dat is de normale situatie, maar wel de post die op de balans hoort."));
    doel.appendChild(w);

    doel.appendChild(el("p", "uitleg",
      "Doorgerekend op " + nl(u.gemaakt) + (u.door ? " door " + u.door : "") + " over " +
      Number(u.ordersBekeken).toLocaleString("nl-NL") + " orders vanaf " + nl(u.vanaf) + ". " +
      Number(u.afgewikkeld).toLocaleString("nl-NL") + " orders zijn netjes afgelopen." +
      (u.scheef.aantal ? ("  Bij " + u.scheef.aantal + " orders wijkt de orderwaarde meer dan 2% af van prijs maal hoeveelheid.") : "")));

    var kn = el("div", "vo-knoppen");
    var ex = el("button", "vo-knop licht", "Exporteren voor de accountant"); ex.type = "button";
    ex.addEventListener("click", function () { exporteer(u); });
    kn.appendChild(ex);
    doel.appendChild(kn);

    // per status
    doel.appendChild(el("h4", "vo-kop", "Openstaande aanbetalingen per orderstatus"));
    var w1 = el("div", "vo-tabelwrap");
    var t1 = el("table", "vo-tabel klein");
    var th1 = el("thead"), hr1 = el("tr");
    ["Orderstatus", "Orders", "Bedrag"].forEach(function (h) { hr1.appendChild(el("th", null, h)); });
    th1.appendChild(hr1); t1.appendChild(th1);
    var tb1 = el("tbody");
    Object.keys(u.perStatus).map(function (s) { return [s, u.perStatus[s]]; })
      .sort(function (a, b) { return a[1].b - b[1].b; })
      .forEach(function (x) {
        var tr = el("tr", /afgehandeld|geannuleerd/i.test(x[0]) ? "let" : "");
        tr.appendChild(el("td", null, x[0]));
        tr.appendChild(el("td", "r", String(x[1].n)));
        tr.appendChild(el("td", "r", euro2(-x[1].b)));
        tb1.appendChild(tr);
      });
    t1.appendChild(tb1); w1.appendChild(t1); doel.appendChild(w1);

    // grootste posten
    doel.appendChild(el("h4", "vo-kop", "Grootste openstaande aanbetalingen (" + Number(u.postenTotaal).toLocaleString("nl-NL") + " in totaal)"));
    var w2 = el("div", "vo-tabelwrap");
    var t2 = el("table", "vo-tabel klein");
    var th2 = el("thead"), hr2 = el("tr");
    ["Order", "Klant", "Aanbetaald", "Orderbedrag", "Status", "Geleverd", "Eerste betaling"]
      .forEach(function (h) { hr2.appendChild(el("th", null, h)); });
    th2.appendChild(hr2); t2.appendChild(th2);
    var tb2 = el("tbody");
    (u.posten || []).slice(0, 30).forEach(function (p) {
      var tr = el("tr", /afgehandeld|geannuleerd/i.test(p.status) ? "let" : "");
      tr.appendChild(el("td", null, String(p.order)));
      tr.appendChild(el("td", null, String(p.klant || p.debiteur || "").slice(0, 34)));
      tr.appendChild(el("td", "r", euro2(-p.saldo)));
      tr.appendChild(el("td", "r", euro2(p.incl)));
      tr.appendChild(el("td", null, p.status));
      tr.appendChild(el("td", null, p.geleverd ? "ja" : "nee"));
      tr.appendChild(el("td", null, nl(p.eerste)));
      tb2.appendChild(tr);
    });
    t2.appendChild(tb2); w2.appendChild(t2); doel.appendChild(w2);

    var hist = (bewaard && bewaard.historie) || [];
    if (hist.length > 1) {
      doel.appendChild(el("h4", "vo-kop", "Verloop"));
      var w3 = el("div", "vo-tabelwrap");
      var t3 = el("table", "vo-tabel klein");
      var th3 = el("thead"), hr3 = el("tr");
      ["Meting", "Saldo", "Openstaand", "Orders", "Loopt niet meer"].forEach(function (h) { hr3.appendChild(el("th", null, h)); });
      th3.appendChild(hr3); t3.appendChild(th3);
      var tb3 = el("tbody");
      hist.slice(0, 12).forEach(function (h) {
        var tr = el("tr");
        tr.appendChild(el("td", null, nl(h.gemaakt)));
        tr.appendChild(el("td", "r", euro2(h.saldo)));
        tr.appendChild(el("td", "r", euro2(-h.open)));
        tr.appendChild(el("td", "r", String(h.openN)));
        tr.appendChild(el("td", "r", euro2(-h.dood) + " (" + h.doodN + ")"));
        tb3.appendChild(tr);
      });
      t3.appendChild(tb3); w3.appendChild(t3); doel.appendChild(w3);
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
    download("1350-aansluiting-" + d + ".csv", [
      ["Vooruitontvangen bedragen — grootboek 1350"],
      ["Doorgerekend", nl(u.gemaakt), u.door || ""],
      ["Orders vanaf", nl(u.vanaf), Number(u.ordersBekeken) + " orders bekeken"],
      [], ["", "Orders", "Bedrag EUR"],
      ["Openstaande aanbetalingen (credit)", u.open.aantal, u.open.bedrag],
      ["Te veel afgeboekt (debet)", u.teveel.aantal, u.teveel.bedrag],
      ["Saldo 1350", "", u.saldo],
      ["Volledig afgelopen orders", u.afgewikkeld, 0],
      [],
      ["Aanbetaling op een order die niet meer loopt", u.dood.aantal, u.dood.bedrag],
      ["Aanbetaling op een order die nog niet geleverd is", u.nietGeleverd.aantal, u.nietGeleverd.bedrag],
      ["Orderwaarde wijkt >2% af van prijs x hoeveelheid", u.scheef.aantal, ""],
    ]);
    var r = [["Order", "Klant", "Debiteur", "Orderdatum", "Aanbetaald EUR", "Orderbedrag incl EUR",
      "Prijs x hoeveelheid EUR", "Status", "Volledig geleverd", "Betaalregels", "Eerste betaling", "Laatste betaling"]];
    (u.posten || []).forEach(function (p) {
      r.push([p.order, p.klant, p.debiteur, p.datum, -p.saldo, p.incl, p.berekend, p.status,
      p.geleverd ? "ja" : "nee", p.regels, p.eerste || "", p.laatste || ""]);
    });
    download("1350-openstaande-aanbetalingen-" + d + ".csv", r);
    if (cfg.log) cfg.log("geldgoederen", "1350-export", "vooruitontvangen " + nl(u.gemaakt));
  }

  /* ═══════════ starten ═══════════ */

  async function start(vanaf, knop) {
    if (bezig) return;
    var v = String(vanaf || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { alert("Vul een datum in als 2020-01-01."); return; }
    if (!confirm("Alle orders vanaf " + nl(v) + " doorrekenen?\n\nDat duurt ongeveer twee minuten.")) return;
    bezig = true; knop.disabled = true; knop.textContent = "Bezig…";
    var melden = cfg.melden || function () {};
    try {
      uitkomst = await bouw(v, melden);
      await bewaar(uitkomst);
      if (cfg.log) cfg.log("geldgoederen", "1350-doorgerekend",
        uitkomst.ordersBekeken + " orders, saldo " + Math.round(uitkomst.saldo) + ", " +
        uitkomst.dood.aantal + " op een order die niet meer loopt");
      teken(await laadLaatste());
    } catch (e) {
      alert("Niet gelukt: " + (e.message || e));
    }
    bezig = false;
    if (knop) { knop.disabled = false; knop.textContent = "Doorrekenen"; }
  }

  async function init(opties) {
    cfg = opties || {};
    doel = document.getElementById(cfg.doelId || "vooruitontvangen");
    if (!doel || !cfg.teamKey) return;
    teken(await laadLaatste());
  }

  global.fp1350 = { init: init, bouw: bouw };

})(typeof window !== "undefined" ? window : globalThis);
