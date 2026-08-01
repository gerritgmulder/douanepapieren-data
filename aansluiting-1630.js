/* ═══════════════════════════════════════════════════════════════════════════
   AANSLUITING GROOTBOEK 1630 — Te ontvangen facturen
   ═══════════════════════════════════════════════════════════════════════════

   Waarom
   ------
   1630 is de tussenrekening tussen magazijn en boekhouding. De ontvangst boekt
   credit ("we hebben goederen, de factuur komt nog"), de inkoopfactuur boekt
   debet. Sluiten die op elkaar aan, dan is het saldo per inkooplevering nul.

   Accountant Kevin (De Jong & Laan) kon deze rekening niet specificeren. Bij de
   eerste analyse bleek waarom: het saldo van 1,48 miljoen is niet een stapel
   openstaande ontvangsten, maar het netto resultaat van 5,8 miljoen aan echte
   leveringen die niet aflopen én 7,3 miljoen aan handmatige correcties die
   geen leveringnummer dragen. Er is jarenlang bijgeboekt om het saldo kloppend
   te krijgen zonder de onderliggende posten af te wikkelen.

   Deze module maakt die aansluiting elke maand opnieuw, zodat het niet meer
   ongemerkt volloopt.

   Waar de gegevens vandaan komen
   ------------------------------
   De grootboekmutaties kunnen we (nog) niet via de API lezen: de API-gebruiker
   krijgt een 403 op /v3/Financial/GetFinancialBookingsWithMutations. Zolang dat
   zo is, sleept iemand de export uit Logic4 hierin. Zodra die rechten er zijn
   hoeft alleen leesGrootboek() te veranderen — de rest blijft.

   De inkoopleveringen komen wél live uit Logic4, zodat elke openstaande post
   meteen een inkooporder, leverancier en ontvangstdatum krijgt.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var BASIS = "https://fonteyn-data-store.g-mulder.workers.dev";
  var BUCKET = BASIS + "/data/gg-1630";
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
  // Excel bewaart datums als dagnummer sinds 30-12-1899.
  function excelDatum(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return null;
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }

  /* ═══════════ het grootboek inlezen ═══════════ */

  // Eén plek waar de bron zit. Komt de API-toegang er, dan haalt deze functie
  // de mutaties rechtstreeks op en verandert er verder niets.
  function leesGrootboek(bestand, melden) {
    return new Promise(function (klaar, mis) {
      if (!global.XLSX) return mis(new Error("De Excel-lezer is niet geladen. Sluit de app af en start hem opnieuw."));
      var lezer = new FileReader();
      lezer.onerror = function () { mis(new Error("Bestand kon niet gelezen worden.")); };
      lezer.onload = function (e) {
        try {
          melden("Bestand ontleden (dit duurt bij een groot grootboek even)…", 20);
          var wb = global.XLSX.read(new Uint8Array(e.target.result), { type: "array", dense: true, cellDates: false, cellStyles: false });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var rijen = global.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          klaar(rijen);
        } catch (fout) { mis(fout); }
      };
      lezer.readAsArrayBuffer(bestand);
    });
  }

  // De export is gegroepeerd op "Inkooplevering nr. : <nummer>". Alles onder
  // zo'n kop hoort bij die levering; regels zonder nummer zijn de correcties.
  function groepeer(rijen) {
    var K = { gb: 1, datum: 3, cred: 5, bedrag: 6, omschr: 8, kpl: 11, dagboek: 12, boeking: 13 };
    var groepen = {}, huidig = "", n = 0;
    for (var i = 0; i < rijen.length; i++) {
      var r = rijen[i];
      var m = String(r[0] || "").match(/Inkooplevering nr\.\s*:\s*(\d*)/i);
      if (m) { huidig = m[1] || ""; if (!groepen[huidig]) groepen[huidig] = { nr: huidig, som: 0, regels: [] }; continue; }
      if (String(r[K.gb]) !== "1630") continue;
      if (!groepen[huidig]) groepen[huidig] = { nr: huidig, som: 0, regels: [] };
      var rec = {
        datum: excelDatum(r[K.datum]), cred: String(r[K.cred] || ""), bedrag: num(r[K.bedrag]),
        omschr: String(r[K.omschr] || "").slice(0, 150), dagboek: String(r[K.dagboek] || ""),
        boeking: String(r[K.boeking] || ""), kpl: String(r[K.kpl] || "")
      };
      groepen[huidig].regels.push(rec);
      groepen[huidig].som += rec.bedrag;
      n++;
    }
    return { groepen: groepen, regels: n };
  }

  /* ═══════════ inkoopleveringen uit Logic4 ═══════════ */

  async function haalLeveringen(melden) {
    var uit = {}, skip = 0;
    for (var p = 0; p < 400; p++) {
      var r = await cfg.logic4("/v3/BuyOrderDeliveries/GetBuyOrderDeliveries", { Take: 500, Skip: skip });
      var lijst = Array.isArray(r) ? r : (r && r.Records) || [];
      if (!lijst.length) break;
      for (var i = 0; i < lijst.length; i++) {
        var d = lijst[i];
        uit[String(d.BuyOrderDeliveryId)] = {
          bo: d.BuyOrderId, sup: d.SupplierId, st: d.StatusId,
          dt: d.DateTimeCreated, proc: d.DateTimeProcessed,
          rows: (d.Rows || []).length,
          stuks: (d.Rows || []).reduce(function (t, x) { return t + num(x.Qty_Delivered); }, 0),
          waarde: (d.Rows || []).reduce(function (t, x) { return t + num(x.Qty_Delivered) * num(x.BuyPrice); }, 0)
        };
      }
      melden("Inkoopleveringen ophalen uit Logic4… " + Object.keys(uit).length.toLocaleString("nl-NL"), 55 + Math.min(20, Object.keys(uit).length / 2700));
      if (lijst.length < 500) break;
      skip += 500;
    }
    return uit;
  }

  /* ═══════════ de aansluiting ═══════════ */

  async function bouw(bestand, saldoBalans, melden) {
    melden("Grootboek inlezen…", 5);
    var rijen = await leesGrootboek(bestand, melden);
    melden("Boekingen groeperen per inkooplevering…", 45);
    var g = groepeer(rijen);
    if (!g.regels) throw new Error("Geen enkele regel op grootboekrekening 1630 gevonden. Klopt het bestand?");

    var leveringen = await haalLeveringen(melden);
    melden("Aansluiting opstellen…", 80);

    var GRENS = 0.005;
    var correcties = g.groepen[""] || { nr: "", som: 0, regels: [] };
    var open = [], dichtN = 0, dichtSom = 0;
    for (var k in g.groepen) {
      if (k === "") continue;
      var grp = g.groepen[k];
      if (Math.abs(grp.som) < GRENS) { dichtN++; dichtSom += grp.som; }
      else open.push(grp);
    }
    open.sort(function (a, b) { return Math.abs(b.som) - Math.abs(a.som); });

    var A = open.filter(function (x) { return x.som < 0; });   // ontvangen, niet gefactureerd
    var B = open.filter(function (x) { return x.som > 0; });   // gefactureerd, geen ontvangst
    var somA = A.reduce(function (t, x) { return t + x.som; }, 0);
    var somB = B.reduce(function (t, x) { return t + x.som; }, 0);
    var totaal = somA + somB + correcties.som + dichtSom;

    // Verrijken en de posten die nergens meer op slaan apart zetten.
    var zonderLevering = [];
    var regels = open.map(function (grp) {
      var d = leveringen[grp.nr] || null;
      var dt = grp.regels.map(function (x) { return x.datum; }).filter(Boolean).sort();
      if (!d) zonderLevering.push(grp.nr);
      return {
        nr: grp.nr, som: grp.som, soort: grp.som < 0 ? "A" : "B",
        eerste: dt[0] || null, laatste: dt[dt.length - 1] || null, boekingen: grp.regels.length,
        bo: d ? d.bo : null, sup: d ? d.sup : null, ontvangen: d ? String(d.dt || "").slice(0, 10) : null,
        stuks: d ? d.stuks : null, waarde: d ? d.waarde : null, bestaat: !!d,
        omschr: grp.regels[0] ? grp.regels[0].omschr : ""
      };
    });

    // Ouderdom — waar zit het in de tijd?
    var vakken = [["2025 Q4", "2025-10-01", "9999"], ["2025 Q1-Q3", "2025-01-01", "2025-10-01"],
    ["2024", "2024-01-01", "2025-01-01"], ["2023", "2023-01-01", "2024-01-01"], ["2022 en ouder", "0000", "2023-01-01"]];
    var ouderdom = vakken.map(function (v) {
      var sel = regels.filter(function (x) { var d = x.eerste || "0000"; return d >= v[1] && d < v[2]; });
      return {
        naam: v[0], aantal: sel.length,
        a: sel.filter(function (x) { return x.som < 0; }).reduce(function (t, x) { return t + x.som; }, 0),
        b: sel.filter(function (x) { return x.som > 0; }).reduce(function (t, x) { return t + x.som; }, 0)
      };
    });

    // Correcties: wie boekt er, in welk dagboek, welk jaar?
    var perJaar = {}, perDagboek = {};
    correcties.regels.forEach(function (r) {
      var j = (r.datum || "????").slice(0, 4);
      perJaar[j] = (perJaar[j] || 0) + r.bedrag;
      var d = r.dagboek || "(leeg)";
      perDagboek[d] = (perDagboek[d] || 0) + r.bedrag;
    });

    return {
      gemaakt: new Date().toISOString(), door: cfg.email || null,
      bestand: bestand.name || "", saldoBalans: num(saldoBalans),
      boekingsregels: g.regels, leveringenTotaal: Object.keys(leveringen).length,
      A: { aantal: A.length, bedrag: somA },
      B: { aantal: B.length, bedrag: somB },
      correcties: { aantal: correcties.regels.length, bedrag: correcties.som, perJaar: perJaar, perDagboek: perDagboek },
      afgewikkeld: { aantal: dichtN, bedrag: dichtSom },
      totaal: totaal, verschil: num(saldoBalans) - totaal,
      zonderLevering: zonderLevering.length,
      // Alles bewaren zou de momentopname loodzwaar maken; de grootste 600
      // dragen samen vrijwel het hele saldo.
      regels: regels.slice(0, 600), regelsTotaal: regels.length,
      grootsteCorrecties: correcties.regels.slice().sort(function (a, b) { return Math.abs(b.bedrag) - Math.abs(a.bedrag); }).slice(0, 40)
    };
  }

  /* ═══════════ opslaan en tonen ═══════════ */

  async function bewaar(u) {
    try {
      var oud = await (await fetch(BUCKET, { headers: { "X-Fonteyn-Auth": cfg.teamKey } })).json().catch(function () { return null; });
      var historie = (oud && oud.historie) || [];
      historie.unshift({
        gemaakt: u.gemaakt, door: u.door, totaal: u.totaal, saldoBalans: u.saldoBalans,
        verschil: u.verschil, a: u.A.bedrag, b: u.B.bedrag, correcties: u.correcties.bedrag, open: u.regelsTotaal
      });
      await fetch(BUCKET, {
        method: "PUT", headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
        body: JSON.stringify({ laatste: u, historie: historie.slice(0, 36) })
      });
    } catch (e) { console.warn("[1630] bewaren mislukt:", e); }
  }

  async function laadLaatste() {
    try {
      var r = await fetch(BUCKET, { headers: { "X-Fonteyn-Auth": cfg.teamKey } });
      if (!r.ok) return null;
      var j = await r.json();
      return j && j.laatste ? j : null;
    } catch (e) { return null; }
  }

  function teken(bewaard) {
    if (!doel) return;
    doel.innerHTML = "";
    var u = uitkomst || (bewaard && bewaard.laatste) || null;

    var kop = el("div", "zes-uitleg");
    kop.appendChild(el("h3", null, "Aansluiting grootboek 1630 — Te ontvangen facturen"));
    kop.appendChild(el("p", null,
      "1630 is de tussenrekening tussen magazijn en boekhouding: de ontvangst boekt credit, de inkoopfactuur debet. " +
      "Lopen ze op elkaar af, dan is het saldo per inkooplevering nul. Wat blijft staan, staat hieronder."));
    doel.appendChild(kop);

    // invoer
    var vak = el("div", "zes-invoer");
    var lab = el("label", null, "Grootboekexport 1630 uit Logic4 (.xlsx)");
    var bestand = el("input"); bestand.type = "file"; bestand.accept = ".xlsx,.xls";
    var lab2 = el("label", null, "Saldo volgens de balans");
    var saldo = el("input"); saldo.type = "text"; saldo.placeholder = "bijv. 1484432"; saldo.value = u ? String(Math.round(u.saldoBalans || 0)) : "";
    var knop = el("button", "zes-knop", "Aansluiting opstellen");
    knop.type = "button";
    knop.addEventListener("click", function () { start(bestand.files && bestand.files[0], saldo.value, knop); });
    vak.appendChild(lab); vak.appendChild(bestand);
    vak.appendChild(lab2); vak.appendChild(saldo);
    vak.appendChild(knop);
    if (!cfg.magWijzigen) { bestand.disabled = saldo.disabled = knop.disabled = true; knop.title = "Alleen-lezen"; }
    doel.appendChild(vak);

    if (!u) {
      doel.appendChild(el("p", "uitleg", "Nog geen aansluiting opgesteld. Exporteer in Logic4 het grootboek van rekening 1630, gegroepeerd op inkooplevering, en laad hem hier."));
      return;
    }

    // ── de aansluiting ──
    var t = el("table", "zes-tabel");
    var tb = el("tbody");
    function rij(l, aantal, bedrag, klas) {
      var tr = el("tr", klas || "");
      tr.appendChild(el("td", null, l));
      tr.appendChild(el("td", "r", aantal == null ? "" : String(aantal)));
      tr.appendChild(el("td", "r", bedrag == null ? "" : euro2(bedrag)));
      tb.appendChild(tr);
    }
    rij("A  Ontvangen, nog niet gefactureerd", u.A.aantal, u.A.bedrag);
    rij("B  Gefactureerd, geen ontvangst geboekt", u.B.aantal, u.B.bedrag);
    rij("Subtotaal openstaande inkoopleveringen", u.A.aantal + u.B.aantal, u.A.bedrag + u.B.bedrag, "sub");
    rij("C  Handmatige correcties zonder leveringnummer", u.correcties.aantal, u.correcties.bedrag);
    rij("D  Afrondingsresidu op afgewikkelde leveringen", u.afgewikkeld.aantal, u.afgewikkeld.bedrag);
    rij("Saldo 1630 volgens deze specificatie", null, u.totaal, "tot");
    rij("Saldo 1630 volgens de balans", null, u.saldoBalans);
    rij("Onverklaard verschil", null, u.verschil, Math.abs(u.verschil) > 1 ? "let" : "goed");
    t.appendChild(tb);
    var wrap = el("div", "zes-tabelwrap"); wrap.appendChild(t);
    doel.appendChild(wrap);

    doel.appendChild(el("p", "uitleg",
      "Opgesteld op " + nl(u.gemaakt) + (u.door ? " door " + u.door : "") + " uit " + (u.bestand || "een export") +
      " — " + Number(u.boekingsregels).toLocaleString("nl-NL") + " boekingsregels, gekoppeld aan " +
      Number(u.leveringenTotaal).toLocaleString("nl-NL") + " inkoopleveringen uit Logic4."));

    // ── wat opvalt ──
    var punten = [];
    if (Math.abs(u.verschil) > 1) punten.push("De specificatie sluit niet aan op de balans: er blijft " + euro(Math.abs(u.verschil)) +
      " onverklaard. Dat is geen afronding — of de export mist boekingen, of de balans bevat iets wat niet op 1630 staat.");
    if (u.correcties.bedrag && Math.abs(u.correcties.bedrag) > Math.abs(u.A.bedrag + u.B.bedrag) / 4)
      punten.push("Het saldo wordt voor een groot deel bepaald door " + u.correcties.aantal +
        " handmatige correcties (" + euro(u.correcties.bedrag) + ") die geen leveringnummer dragen. Zolang die er zijn, is de rekening niet te specificeren.");
    if (u.zonderLevering) punten.push(u.zonderLevering + " openstaande posten verwijzen naar een inkoopleveringnummer dat niet meer in Logic4 bestaat. Die kunnen nooit aflopen.");
    if (punten.length) {
      var w = el("div", "zes-let");
      var ul = el("ul");
      punten.forEach(function (p) { ul.appendChild(el("li", null, p)); });
      w.appendChild(el("strong", null, "Wat opvalt"));
      w.appendChild(ul);
      doel.appendChild(w);
    }

    // ── knoppen ──
    var kn = el("div", "zes-knoppen");
    var ex = el("button", "zes-knop licht", "Exporteren voor de accountant"); ex.type = "button";
    ex.addEventListener("click", function () { exporteer(u); });
    kn.appendChild(ex);
    doel.appendChild(kn);

    // ── grootste openstaande posten ──
    doel.appendChild(el("h4", "zes-kop", "Grootste openstaande posten (" + Number(u.regelsTotaal).toLocaleString("nl-NL") + " in totaal)"));
    var w2 = el("div", "zes-tabelwrap");
    var t2 = el("table", "zes-tabel klein");
    var th = el("thead"), hr = el("tr");
    ["Levering", "Saldo", "Soort", "Eerste boeking", "Inkooporder", "Leverancier", "Omschrijving"].forEach(function (h) { hr.appendChild(el("th", null, h)); });
    th.appendChild(hr); t2.appendChild(th);
    var tb2 = el("tbody");
    (u.regels || []).slice(0, 30).forEach(function (r) {
      var tr = el("tr", r.bestaat ? "" : "weg");
      tr.appendChild(el("td", null, r.nr));
      tr.appendChild(el("td", "r", euro2(r.som)));
      tr.appendChild(el("td", null, r.soort === "A" ? "ontvangen, niet gefactureerd" : "gefactureerd, geen ontvangst"));
      tr.appendChild(el("td", null, nl(r.eerste)));
      tr.appendChild(el("td", null, r.bo || (r.bestaat ? "—" : "levering bestaat niet meer")));
      tr.appendChild(el("td", null, r.sup || "—"));
      tr.appendChild(el("td", null, String(r.omschr || "").slice(0, 60)));
      tb2.appendChild(tr);
    });
    t2.appendChild(tb2); w2.appendChild(t2);
    doel.appendChild(w2);

    // ── verloop over de metingen ──
    var hist = (bewaard && bewaard.historie) || [];
    if (hist.length > 1) {
      doel.appendChild(el("h4", "zes-kop", "Verloop"));
      var w3 = el("div", "zes-tabelwrap");
      var t3 = el("table", "zes-tabel klein");
      var th3 = el("thead"), hr3 = el("tr");
      ["Meting", "Saldo", "Openstaande posten", "Correcties", "Onverklaard"].forEach(function (h) { hr3.appendChild(el("th", null, h)); });
      th3.appendChild(hr3); t3.appendChild(th3);
      var tb3 = el("tbody");
      hist.slice(0, 12).forEach(function (h) {
        var tr = el("tr");
        tr.appendChild(el("td", null, nl(h.gemaakt)));
        tr.appendChild(el("td", "r", euro2(h.totaal)));
        tr.appendChild(el("td", "r", String(h.open)));
        tr.appendChild(el("td", "r", euro2(h.correcties)));
        tr.appendChild(el("td", "r", euro2(h.verschil)));
        tb3.appendChild(tr);
      });
      t3.appendChild(tb3); w3.appendChild(t3);
      doel.appendChild(w3);
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
    download("1630-aansluiting-" + d + ".csv", [
      ["Aansluiting grootboekrekening 1630 - Te ontvangen facturen"],
      ["Opgesteld", nl(u.gemaakt), u.door || ""],
      [], ["", "Aantal", "Bedrag EUR"],
      ["A  Ontvangen, nog niet gefactureerd", u.A.aantal, u.A.bedrag],
      ["B  Gefactureerd, geen ontvangst geboekt", u.B.aantal, u.B.bedrag],
      ["Subtotaal openstaande inkoopleveringen", u.A.aantal + u.B.aantal, u.A.bedrag + u.B.bedrag],
      ["C  Handmatige correcties zonder leveringnummer", u.correcties.aantal, u.correcties.bedrag],
      ["D  Afrondingsresidu op afgewikkelde leveringen", u.afgewikkeld.aantal, u.afgewikkeld.bedrag],
      ["Saldo volgens deze specificatie", "", u.totaal],
      ["Saldo volgens de balans", "", u.saldoBalans],
      ["Onverklaard verschil", "", u.verschil],
      ["Posten zonder bestaande levering in Logic4", u.zonderLevering, ""],
    ]);
    var r2 = [["Levering", "Saldo EUR", "Soort", "Eerste boeking", "Laatste boeking", "Boekingen",
      "Inkooporder", "Leverancier", "Ontvangen op", "Stuks", "Waarde ontvangst EUR", "Bestaat in Logic4", "Omschrijving"]];
    (u.regels || []).forEach(function (r) {
      r2.push([r.nr, r.som, r.soort === "A" ? "A ontvangen niet gefactureerd" : "B gefactureerd geen ontvangst",
      r.eerste || "", r.laatste || "", r.boekingen, r.bo || "", r.sup || "", r.ontvangen || "",
      r.stuks == null ? "" : r.stuks, r.waarde == null ? "" : Math.round(r.waarde), r.bestaat ? "ja" : "nee", r.omschr]);
    });
    download("1630-openstaand-" + d + ".csv", r2);
    var r3 = [["Datum", "Crediteur", "Bedrag EUR", "Dagboek", "Boeking", "Omschrijving"]];
    (u.grootsteCorrecties || []).forEach(function (r) { r3.push([r.datum || "", r.cred, r.bedrag, r.dagboek, r.boeking, r.omschr]); });
    download("1630-correcties-" + d + ".csv", r3);
    if (cfg.log) cfg.log("geldgoederen", "1630-export", "aansluiting " + nl(u.gemaakt));
  }

  /* ═══════════ starten ═══════════ */

  async function start(bestand, saldo, knop) {
    if (bezig) return;
    if (!bestand) { alert("Kies eerst de grootboekexport van rekening 1630."); return; }
    var s = Number(String(saldo).replace(/[^\d,-]/g, "").replace(/\./g, "").replace(",", "."));
    if (!isFinite(s) || !s) { alert("Vul het saldo volgens de balans in, dan kan ik het verschil berekenen."); return; }
    bezig = true; knop.disabled = true; knop.textContent = "Bezig…";
    var melden = cfg.melden || function () {};
    try {
      uitkomst = await bouw(bestand, s, melden);
      await bewaar(uitkomst);
      if (cfg.log) cfg.log("geldgoederen", "1630-aansluiting",
        "saldo " + Math.round(uitkomst.totaal) + ", onverklaard " + Math.round(uitkomst.verschil) + ", " + uitkomst.regelsTotaal + " open posten");
      melden("Klaar", 100);
      var bewaard = await laadLaatste();
      teken(bewaard);
    } catch (e) {
      alert("Niet gelukt: " + (e.message || e));
    }
    bezig = false;
    if (knop) { knop.disabled = false; knop.textContent = "Aansluiting opstellen"; }
  }

  async function init(opties) {
    cfg = opties || {};
    doel = document.getElementById(cfg.doelId || "aansluiting1630");
    if (!doel || !cfg.teamKey) return;
    teken(await laadLaatste());
  }

  // bouw() staat los van het scherm, net als de scan in gg-engine.js. Zo is de
  // berekening apart te testen zonder browser — en dat is bij een aansluiting
  // die een accountant gebruikt geen luxe.
  global.fp1630 = { init: init, bouw: bouw, groepeer: groepeer };

})(typeof window !== "undefined" ? window : globalThis);
