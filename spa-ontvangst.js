/* ═══════════════════════════════════════════════════════════════════════════
   DOCUMENTENKETEN JAZZI — bedienkant
   ═══════════════════════════════════════════════════════════════════════════

   Elk schip dat Jazzi meldt via een commercial invoice hoort bij één of twee
   Jazzi-orders, en die staan sinds kort als echte inkooporder in Logic4. Dit
   scherm legt de verbinding en biedt twee handelingen aan:

     VERSCHEEPT  De goederen varen. Alleen de verwachte leverdatum op de
                 inkooporderregels bijwerken. Voorraad blijft ongemoeid.
     ONTVANGEN   De container staat in Uddel. Nu pas een inkooplevering
                 boeken, want dát verhoogt de voorraad.

   Die volgorde is het hele punt. Boeken op het moment dat de factuur binnenkomt
   zou honderden spa's in de voorraad zetten die nog weken op zee liggen.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var BASIS = "https://fonteyn-data-store.g-mulder.workers.dev";
  var cfg = null, voorstel = null, doel = null, bezig = false;
  var open = {};

  function el(tag, klas, tekst) {
    var e = document.createElement(tag);
    if (klas) e.className = klas;
    if (tekst != null) e.textContent = tekst;
    return e;
  }
  function nlDatum(s) {
    if (!s) return "—";
    var d = new Date(s);
    if (isNaN(d)) return "—";
    return String(d.getDate()).padStart(2, "0") + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + d.getFullYear();
  }
  function dagenTot(s) {
    if (!s) return null;
    var d = new Date(String(s).slice(0, 10) + "T00:00:00").getTime();
    if (!isFinite(d)) return null;
    return Math.round((d - Date.now()) / 86400000);
  }

  async function haal() {
    var r = await fetch(BASIS + "/voorraad/spa-ontvangst/voorstel", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
      body: "{}"
    });
    var j = await r.json();
    if (!j.ok) throw new Error(j.error || "voorstel ophalen mislukt");
    return j;
  }
  async function stuur(pad, body) {
    var r = await fetch(BASIS + pad, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DP-Admin": cfg.adminKey },
      body: JSON.stringify(body)
    });
    return await r.json();
  }

  /* ═══════════ tekenen ═══════════ */

  function teken() {
    if (!doel) return;
    doel.innerHTML = "";
    if (!voorstel) {
      doel.appendChild(el("p", "status-msg", bezig ? "Bezig met opbouwen…" : "Nog niet geladen."));
      return;
    }

    var uitleg = el("div", "so-uitleg");
    uitleg.appendChild(el("h3", null, "Van commercial invoice naar de inkooporder"));
    uitleg.appendChild(el("p", null,
      "Elk schip hieronder hoort bij één of twee Jazzi-orders. Zolang de goederen varen zetten we alleen de " +
      "verwachte aankomst op de inkooporder. Pas als de container in Uddel staat boeken we de ontvangst — dán " +
      "gaat de voorraad omhoog. Andersom zou je spa's op voorraad zetten die nog op zee liggen."));
    doel.appendChild(uitleg);

    // Ontbrekende inkooporders zijn de blokkade: zonder die orders valt er niets te koppelen.
    var mist = {};
    voorstel.schepen.forEach(function (s) { (s.ontbreekt || []).forEach(function (nr) { mist[nr] = 1; }); });
    var mistLijst = Object.keys(mist);
    if (mistLijst.length) {
      var w = el("div", "so-waarschuwing");
      w.appendChild(el("strong", null, "Nog geen inkooporder voor Jazzi-order " + mistLijst.join(", ") + ". "));
      w.appendChild(document.createTextNode(
        "Zolang die niet in Logic4 staat, is er niets om de lading aan te koppelen. " +
        "Maak ze aan op het tabblad “Inkoop naar Logic4”."));
      doel.appendChild(w);
    }

    voorstel.schepen.forEach(function (s) { doel.appendChild(kaart(s)); });

    // Wat de expediteur zelf weet, naast onze eigen schepenlijst.
    doel.appendChild(flexportBlok());
  }

  function kaart(s) {
    var dagen = dagenTot(s.eta);
    var binnen = dagen !== null && dagen <= 0;
    var d = el("div", "so-kaart" + (binnen ? " binnen" : ""));

    var rij = el("div", "so-rij");
    var links = el("div", "so-links");
    var t = el("div", "so-titel");
    t.appendChild(el("strong", null, s.vessel || s.ref));
    if (s.jazziOrders && s.jazziOrders.length)
      t.appendChild(el("span", "so-badge", "Jazzi-order " + s.jazziOrders.join(" + ")));
    links.appendChild(t);
    links.appendChild(el("div", "so-meta",
      "aankomst " + nlDatum(s.eta) +
      (dagen === null ? "" : (binnen ? "  ·  zou binnen moeten zijn" : "  ·  over " + dagen + " dagen")) +
      "  ·  " + s.spas + " spa's" + (s.containers ? ("  ·  " + s.containers + " containers") : "")));
    links.appendChild(el("div", "so-meta klein", s.ref));
    rij.appendChild(links);

    var rechts = el("div", "so-rechts");
    var pillen = el("div", "so-pillen");
    pillen.appendChild(el("span", "so-pil zeker", s.raak + " gekoppeld"));
    if (s.mis) pillen.appendChild(el("span", "so-pil fout", s.mis + " niet"));
    rechts.appendChild(pillen);

    var knoppen = el("div", "so-knoppen");
    var toon = el("button", "so-knop licht", open[s.ref] ? "Lading verbergen" : "Lading tonen");
    toon.type = "button";
    toon.addEventListener("click", function () { open[s.ref] = !open[s.ref]; teken(); });
    knoppen.appendChild(toon);

    if (cfg.magWijzigen && s.raak > 0) {
      var eta = el("button", "so-knop licht", "Aankomst bijwerken");
      eta.type = "button";
      eta.title = "Zet de verwachte leverdatum op de inkooporderregels. Verandert niets aan de voorraad.";
      eta.addEventListener("click", function () { doeEta(s, eta); });
      knoppen.appendChild(eta);

      var ont = el("button", "so-knop", "Container is binnen");
      ont.type = "button";
      ont.title = "Boekt de ontvangst in Logic4 — dit verhoogt de voorraad.";
      ont.addEventListener("click", function () { doeOntvangst(s, ont); });
      knoppen.appendChild(ont);
    }
    rechts.appendChild(knoppen);
    rij.appendChild(rechts);
    d.appendChild(rij);

    if (open[s.ref]) d.appendChild(tabel(s));
    return d;
  }

  function tabel(s) {
    var wrap = el("div", "so-tabelwrap");
    var tb = el("table", "so-tabel");
    var thead = el("thead"), hr = el("tr");
    ["Model", "Kleur", "Aantal", "Artikel", "Inkooporder", "Nog te leveren", "Huidige aankomst", "Status"]
      .forEach(function (h) { hr.appendChild(el("th", null, h)); });
    thead.appendChild(hr); tb.appendChild(thead);
    var tbody = el("tbody");
    s.regels.forEach(function (r) {
      var tr = el("tr", r.buyOrderRowId ? (r.viaModel ? "opmodel" : "") : "los");
      tr.appendChild(el("td", null, r.model));
      tr.appendChild(el("td", null, r.kleur || "—"));
      tr.appendChild(el("td", "num", String(r.aantal)));
      var td = el("td");
      if (r.artikelcode) {
        td.appendChild(el("code", null, r.artikelcode));
        if (r.artikelnaam) td.appendChild(document.createTextNode(" " + String(r.artikelnaam).slice(0, 40)));
      } else td.appendChild(el("span", "so-leeg", "—"));
      tr.appendChild(td);
      tr.appendChild(el("td", null, r.buyOrderId ? String(r.buyOrderId) : "—"));
      tr.appendChild(el("td", "num", r.nogTeLeveren == null ? "—" : String(r.nogTeLeveren)));
      tr.appendChild(el("td", null, r.huidigeEta ? nlDatum(r.huidigeEta) : "—"));
      var st = el("td");
      if (r.buyOrderRowId) {
        st.appendChild(el("span", "so-pil " + (r.viaModel ? "nakijk" : "zeker"), r.viaModel ? "op model" : "gekoppeld"));
      } else {
        st.appendChild(el("span", "so-pil fout", "los"));
      }
      if (r.reden) st.appendChild(el("div", "so-reden", r.reden));
      tr.appendChild(st);
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody); wrap.appendChild(tb);
    return wrap;
  }

  /* ═══════════ handelingen ═══════════ */

  async function doeEta(s, knop) {
    var datum = prompt("Verwachte aankomst zetten op de inkooporderregels van " + (s.vessel || s.ref) +
      ".\n\nDatum (jjjj-mm-dd):", String(s.eta || "").slice(0, 10));
    if (!datum) return;
    knop.disabled = true; knop.textContent = "bezig…";
    var j = await stuur("/voorraad/spa-ontvangst/eta", { ref: s.ref, eta: datum.trim(), door: cfg.email });
    if (!j.ok && !j.bijgewerkt) alert("Niet gelukt: " + (j.error || "onbekende fout"));
    else {
      alert(j.bijgewerkt + " inkooporderregels staan nu op " + j.eta + "." +
        (j.mislukt && j.mislukt.length ? ("\n\n" + j.mislukt.length + " regel(s) mislukten.") : ""));
      if (cfg.log) cfg.log("voorraad", "aankomst bijgewerkt", s.ref + " → " + j.eta + " (" + j.bijgewerkt + " regels)");
    }
    await herlaad();
  }

  async function doeOntvangst(s, knop) {
    var los = s.regels.filter(function (r) { return !r.buyOrderRowId; });
    var mee = s.regels.filter(function (r) { return r.buyOrderRowId; })
      .reduce(function (t, r) { return t + r.aantal; }, 0);
    if (!confirm("Ontvangst boeken voor " + (s.vessel || s.ref) + "?\n\n" +
      mee + " spa's worden als ontvangen geboekt in Logic4. Dit verhoogt de voorraad." +
      (los.length ? ("\n\n" + los.length + " regel(s) zijn niet gekoppeld en gaan NIET mee.") : "") +
      "\n\nDoe dit alleen als de container fysiek in Uddel staat.")) return;
    knop.disabled = true; knop.textContent = "bezig…";
    var j = await stuur("/voorraad/spa-ontvangst/boeken", { ref: s.ref, door: cfg.email });
    if (!j.ok && !(j.gemaakt && j.gemaakt.length)) alert("Niet gelukt: " + (j.error || "onbekende fout"));
    else {
      var m = (j.gemaakt || []).map(function (g) {
        return "inkooporder " + g.buyOrderId + " → levering " + (g.levering || "(zonder nummer)") + ", " + g.regels + " regels";
      }).join("\n");
      alert("Ontvangst geboekt:\n" + m +
        (j.mislukt && j.mislukt.length ? ("\n\nMislukt: " + j.mislukt.map(function (x) { return x.buyOrderId + ": " + x.fout; }).join("; ")) : ""));
      if (cfg.log) cfg.log("voorraad", "container ontvangen geboekt", s.ref + " — " + m.replace(/\n/g, " | "));
    }
    await herlaad();
  }

  /* ═══════════ Flexport — wat de expediteur weet ═══════════

     Chantals schepenlijst komt uit de commercial invoices van Jazzi. Flexport
     vervoert het en weet dus zelf waar de containers zijn. Dit blok zet die
     twee naast elkaar: wat Flexport heeft, en of wij daar een inkooporder bij
     hebben. Wat aan één kant ontbreekt, valt zo meteen op. */

  var flexport = null, flexportBezig = false;

  async function haalFlexport(vers) {
    var r = await fetch(BASIS + "/voorraad/flexport/overzicht", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
      body: JSON.stringify({ vers: !!vers })
    });
    var j = await r.json();
    if (!j.ok) throw new Error(j.error || "Flexport-overzicht ophalen mislukt");
    return j;
  }

  function flexportBlok() {
    var d = el("div", "so-flexport");
    var kop = el("div", "so-fkop");
    var t = el("div");
    t.appendChild(el("h3", null, "Volgens Flexport"));
    t.appendChild(el("p", null, flexport
      ? ("Bijgewerkt " + nlDatum(flexport.opgehaald) + (flexport.uitCache ? " (uit de opslag)" : " (net opgehaald)") +
        " — " + flexport.zendingen.length + " zendingen, " + flexport.aantalContainers + " containers.")
      : "De expediteur weet zelf waar de containers zijn en wanneer ze aankomen."));
    kop.appendChild(t);
    var knop = el("button", "so-knop licht", flexportBezig ? "bezig…" : (flexport ? "Verversen" : "Ophalen"));
    knop.type = "button";
    knop.disabled = flexportBezig;
    knop.title = "Een verse ronde bij Flexport duurt ruim twee minuten.";
    knop.addEventListener("click", async function () {
      flexportBezig = true; teken();
      try { flexport = await haalFlexport(!!flexport); }
      catch (e) { alert("Niet gelukt: " + (e.message || e)); }
      flexportBezig = false; teken();
    });
    kop.appendChild(knop);
    d.appendChild(kop);
    if (!flexport) return d;

    // Welke Jazzi-orders hebben wij als inkooporder in Logic4?
    var onze = {};
    (voorstel && voorstel.schepen || []).forEach(function (s) {
      (s.gekoppeld || []).forEach(function (nr) { onze[nr] = 1; });
    });

    var metOrder = flexport.zendingen.filter(function (z) { return z.jazziOrders.length; });
    var zonderOrder = flexport.zendingen.filter(function (z) { return !z.jazziOrders.length; });
    var onbekend = [];
    metOrder.forEach(function (z) {
      z.jazziOrders.forEach(function (nr) { if (!onze[nr] && onbekend.indexOf(nr) < 0) onbekend.push(nr); });
    });

    if (onbekend.length) {
      var w = el("div", "so-waarschuwing");
      w.appendChild(el("strong", null, "Verscheept, maar geen inkooporder: Jazzi-order " + onbekend.join(", ") + ". "));
      w.appendChild(document.createTextNode(
        "Flexport heeft deze containers vervoerd, maar er staat bij ons geen bestelling tegenover. " +
        "Dat betekent goederen binnen zonder inkoop — precies wat de accountant zoekt."));
      d.appendChild(w);
    }

    var wrap = el("div", "so-tabelwrap");
    var tb = el("table", "so-tabel");
    var th = el("thead"), hr = el("tr");
    ["Zending", "Jazzi-order", "Containers", "Aankomst", "Werkelijk binnen", "Status"]
      .forEach(function (h) { hr.appendChild(el("th", null, h)); });
    th.appendChild(hr); tb.appendChild(th);
    var body = el("tbody");
    flexport.zendingen.slice(0, 40).forEach(function (z) {
      var los = z.jazziOrders.length && z.jazziOrders.every(function (nr) { return !onze[nr]; });
      var tr = el("tr", los ? "los" : "");
      tr.appendChild(el("td", null, String(z.naam || "").slice(0, 42) || "—"));
      tr.appendChild(el("td", null, z.jazziOrders.length ? z.jazziOrders.join(" + ") : "—"));
      tr.appendChild(el("td", "num", String(z.containers.length)));
      tr.appendChild(el("td", null, nlDatum(z.eta)));
      tr.appendChild(el("td", null, z.aangekomen ? nlDatum(z.aangekomen) : "—"));
      tr.appendChild(el("td", null, String(z.status || "").replace(/_/g, " ")));
      body.appendChild(tr);
    });
    tb.appendChild(body); wrap.appendChild(tb);
    d.appendChild(wrap);
    d.appendChild(el("p", "so-meta klein",
      metOrder.length + " zendingen met een herkend ordernummer, " + zonderOrder.length +
      " zonder — dat laatste is meestal geen spa-lading maar tuinmeubelen of onderdelen." +
      (flexport.zendingen.length > 40 ? "  De veertig recentste staan hierboven." : "")));
    return d;
  }

  async function herlaad() {
    bezig = true; teken();
    try { voorstel = await haal(); }
    catch (e) {
      doel.innerHTML = "";
      doel.appendChild(el("p", "status-msg", "Voorstel ophalen mislukt: " + (e.message || e)));
      bezig = false; return;
    }
    bezig = false; teken();
  }

  async function start(opties) {
    cfg = opties || {};
    doel = document.getElementById(cfg.doelId || "tab-ontvangst");
    if (!doel || !cfg.teamKey) return;
    if (voorstel) { teken(); return; }
    await herlaad();
  }

  global.fpSpaOntvangst = { start: start };

})(typeof window !== "undefined" ? window : globalThis);
