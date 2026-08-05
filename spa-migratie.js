/* ═══════════════════════════════════════════════════════════════════════════
   SPA-INKOOP NAAR LOGIC4 — bedienkant
   ═══════════════════════════════════════════════════════════════════════════

   Waarom
   ------
   De spa-inkoop liep buiten Logic4 om omdat Jazzi niet in Logic4 kan. Chantal
   hield de bestellingen daarom in het dashboard bij. Dat is een tweede
   administratie geworden: de grootste productgroep van het bedrijf ontbreekt in
   de geld-goederenbeweging, en de accountant kan de keten daardoor niet sluiten.

   Dit scherm zet die lijst om in echte inkooporders bij Jazzi. Eén inkooporder
   per containernummer (= één Jazzi-order), met de artikelcodes erbij en de ETA
   van het schip dat eraan hangt.

   Twee dingen bewust anders dan "gewoon alles omzetten"
   ----------------------------------------------------
   1. Alleen wat nog loopt. Een bestelling van twee jaar geleden alsnog als
      openstaande inkooporder aanmaken zou de administratie juist vervuilen —
      precies de fout die de accountant aanwijst (goederen die volgens de
      boeken nog moeten komen maar er allang zijn). Oude containers staan er
      wel bij, maar uitgevinkt en met de reden erbij.
   2. Niets gokken. Een regel waarvan het model of de kleur niet met zekerheid
      te herleiden is, gaat niet mee. Je koppelt hem één keer met de hand en
      die keuze wordt onthouden — daarna geldt hij overal, ook bij de
      proforma-koppeling.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var BASIS = "https://fonteyn-data-store.g-mulder.workers.dev";
  var cfg = null;            // {teamKey, adminKey, magWijzigen, email, log}
  var voorstel = null;
  var doel = null;
  var bezig = false;
  var open = {};             // containernummer → uitgeklapt
  var kies = {};             // containernummer → aangevinkt

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

  async function haalVoorstel() {
    var r = await fetch(BASIS + "/voorraad/spa-migratie/voorstel", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
      body: "{}"
    });
    var j = await r.json();
    if (!j.ok) throw new Error(j.error || "voorstel ophalen mislukt");
    return j;
  }

  async function maakInkooporder(nr, ookNakijken) {
    var r = await fetch(BASIS + "/voorraad/spa-migratie/uitvoeren", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DP-Admin": cfg.adminKey },
      body: JSON.stringify({ nr: nr, ookNakijken: !!ookNakijken, door: cfg.email })
    });
    return await r.json();
  }

  async function bewaarAlias(van, naar) {
    var r = await fetch(BASIS + "/voorraad/spa-migratie/alias", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DP-Admin": cfg.adminKey },
      body: JSON.stringify({ van: van, naar: naar })
    });
    return await r.json();
  }

  /* ═══════════════ tekenen ═══════════════ */

  function teken() {
    if (!doel) return;
    doel.innerHTML = "";

    if (!voorstel) {
      doel.appendChild(el("p", "status-msg", bezig ? "Bezig met het opbouwen van het voorstel…" : "Nog niet geladen."));
      return;
    }

    var actueel = voorstel.containers.filter(function (c) { return c.actueel; });
    var historieAlles = voorstel.containers.filter(function (c) { return !c.actueel; });
    var historie = historieAlles.filter(function (c) { return !verborgen[String(c.nr)]; });
    var weggeklikt = historieAlles.filter(function (c) { return verborgen[String(c.nr)]; });

    // ── uitleg ──
    var uitleg = el("div", "sm-uitleg");
    uitleg.appendChild(el("h3", null, "Van eigen lijst naar echte inkooporders"));
    var p = el("p", null,
      "Elke container hieronder is één bestelling bij Jazzi. Hiervan maken we een echte inkooporder in Logic4, " +
      "zodat de spa-inkoop meetelt in de administratie in plaats van alleen in dit dashboard te staan. " +
      "Een inkooporder aanmaken stuurt niets naar de fabriek — Jazzi zit niet in Logic4.");
    uitleg.appendChild(p);
    doel.appendChild(uitleg);

    // ── schip zonder container ──
    var bekend = {};
    voorstel.containers.forEach(function (c) { bekend[c.nr] = 1; });
    var wees = [];
    (voorstel.schepen || []).forEach(function (s) {
      (s.orders || []).forEach(function (o) { if (!bekend[o] && wees.indexOf(o) < 0) wees.push(o); });
    });
    if (wees.length) {
      var w = el("div", "sm-waarschuwing");
      w.appendChild(el("strong", null, "Let op: "));
      w.appendChild(document.createTextNode(
        "Jazzi-order " + wees.join(", ") + " vaart wel mee op een schip, maar staat niet in de containerlijst. " +
        "Voeg die bestelling toe bij Schepen/Pipeline, anders ontbreekt hij straks ook in Logic4."));
      doel.appendChild(w);
    }

    doel.appendChild(kop("Nog lopend", actueel.length + " bestellingen · " +
      actueel.reduce(function (t, c) { return t + c.spas; }, 0) + " spa's"));
    actueel.forEach(function (c) { doel.appendChild(kaart(c)); });

    doel.appendChild(kop("Historie", historie.length + " bestellingen die vrijwel zeker al geleverd zijn"));
    var h = el("p", "sm-sub",
      "Deze staan er alleen ter controle. Ze alsnog als openstaande inkooporder aanmaken zou de administratie " +
      "vervuilen met goederen die volgens de boeken nog moeten komen maar er allang zijn.");
    doel.appendChild(h);
    historie.forEach(function (c) { doel.appendChild(kaart(c)); });

    if (weggeklikt.length) {
      var terug = el("p", "sm-sub");
      terug.appendChild(document.createTextNode(weggeklikt.length + " bestelling(en) weggeklikt: " +
        weggeklikt.map(function (c) { return c.nr; }).join(", ") + ". "));
      var link = el("a", null, "Alles weer tonen");
      link.href = "#"; link.style.textDecoration = "underline"; link.style.cursor = "pointer";
      link.addEventListener("click", function (e) {
        e.preventDefault();
        weggeklikt.forEach(function (c) { verberg(c.nr, false); });
      });
      terug.appendChild(link);
      doel.appendChild(terug);
    }
  }

  function kop(titel, sub) {
    var d = el("div", "sm-kop");
    d.appendChild(el("h4", null, titel));
    d.appendChild(el("span", null, sub));
    return d;
  }

  /* Chantal wil oude bestellingen uit de historie kunnen wegklikken, zodat het
     scherm niet vervuilt met dingen die allang geleverd zijn (4 aug 2026).
     Echt verwijderen kan niet: dit voorstel wordt telkens opnieuw uit de
     Jazzi-gegevens opgebouwd, dus dan staan ze er de volgende keer weer. We
     onthouden daarom wát verborgen is, door wie en wanneer. */
  var verborgen = {};
  async function laadVerborgen() {
    try {
      var r = await fetch(BASIS + "/data/spa-verborgen", { headers: { "X-Fonteyn-Auth": cfg.teamKey } });
      if (r.ok) { var j = await r.json(); verborgen = (j && j.ids) || {}; }
    } catch (e) { console.warn("[spa] verborgen laden faalde:", e); }
  }
  async function verberg(nr, aan) {
    try {
      var r = await fetch(BASIS + "/voorraad/verberg", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
        body: JSON.stringify({ id: String(nr), verborgen: aan !== false, user: cfg.email || "" })
      });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || "opslaan mislukt");
      if (aan === false) delete verborgen[String(nr)];
      else verborgen[String(nr)] = { ts: new Date().toISOString(), user: cfg.email || "" };
      if (cfg.log) cfg.log("voorraad", "jazzi-order-" + (aan === false ? "teruggehaald" : "verborgen"), String(nr));
      teken();
    } catch (e) { alert("Kon niet opslaan: " + e.message); }
  }

  function kaart(c) {
    var d = el("div", "sm-kaart" + (c.actueel ? " actueel" : "") + (c.alGedaan ? " gedaan" : ""));

    var rij = el("div", "sm-rij");
    var links = el("div", "sm-links");
    var t = el("div", "sm-titel");
    t.appendChild(el("strong", null, "Jazzi-order " + (c.nr || "(zonder nummer)")));
    if (c.alGedaan) t.appendChild(el("span", "sm-badge ok", "inkooporder " + c.alGedaan));
    links.appendChild(t);
    links.appendChild(el("div", "sm-meta",
      "besteld " + nlDatum(c.besteld) + "  ·  ETA " + nlDatum(c.eta) + "  ·  " + c.spas + " spa's  ·  " + c.regels.length + " regels"));
    links.appendChild(el("div", "sm-meta klein", c.reden));
    // Wie heeft de inkooporder aangemaakt en wanneer. Zonder deze regel is aan
    // een bestaande inkooporder niet te zien of een mens hem heeft gemaakt.
    if (c.alGedaan) {
      links.appendChild(el("div", "sm-meta klein",
        "inkooporder " + c.alGedaan + " aangemaakt" +
        (c.gedaanDoor ? " door " + c.gedaanDoor : "") +
        (c.gedaanOp ? " op " + nlDatum(c.gedaanOp) : "")));
    }
    // Waar komt deze bestelling vandaan? Zonder dit moest Chantal het vragen.
    if (c.import && c.import.bestand) {
      links.appendChild(el("div", "sm-meta klein",
        "ingelezen uit " + c.import.bestand +
        (c.import.ingelezen ? " op " + nlDatum(String(c.import.ingelezen).slice(0, 10)) : "") +
        (c.import.door ? " door " + String(c.import.door).split("@")[0] : "")));
    }
    rij.appendChild(links);
    if (!c.actueel && cfg.magWijzigen) {
      var weg = el("button", "sm-verberg", "🗑");
      weg.type = "button";
      weg.title = "Uit beeld halen. De bestelling zelf blijft bestaan; dit haalt hem alleen van je scherm.";
      weg.addEventListener("click", function (e) {
        e.stopPropagation();
        if (confirm("Jazzi-order " + c.nr + " uit de historie halen?\n\nHij verdwijnt van je scherm. De bestelling blijft gewoon bestaan — dit is alleen om het overzicht schoon te houden.")) verberg(c.nr, true);
      });
      rij.appendChild(weg);
    }

    var rechts = el("div", "sm-rechts");
    var telling = el("div", "sm-telling");
    telling.appendChild(el("span", "sm-pil zeker", c.zeker + " zeker"));
    if (c.nakijken) telling.appendChild(el("span", "sm-pil nakijk", c.nakijken + " nakijken"));
    if (c.onmogelijk) telling.appendChild(el("span", "sm-pil fout", c.onmogelijk + " onbekend"));
    rechts.appendChild(telling);

    var knoppen = el("div", "sm-knoppen");
    var toon = el("button", "sm-knop licht", open[c.nr] ? "Regels verbergen" : "Regels tonen");
    toon.type = "button";
    toon.addEventListener("click", function () { open[c.nr] = !open[c.nr]; teken(); });
    knoppen.appendChild(toon);

    if (cfg.magWijzigen && !c.alGedaan && c.zeker > 0) {
      var maak = el("button", "sm-knop" + (c.actueel ? "" : " licht"), "Inkooporder aanmaken");
      maak.type = "button";
      maak.addEventListener("click", function () { aanmaken(c, maak); });
      knoppen.appendChild(maak);
    }
    rechts.appendChild(knoppen);
    rij.appendChild(rechts);
    d.appendChild(rij);

    if (open[c.nr]) d.appendChild(regeltabel(c));
    return d;
  }

  function regeltabel(c) {
    var wrap = el("div", "sm-tabelwrap");
    var tb = el("table", "sm-tabel");
    var thead = el("thead");
    var hr = el("tr");
    ["Model", "Kleur", "Aantal", "Artikel in Logic4", "Status"].forEach(function (h) { hr.appendChild(el("th", null, h)); });
    thead.appendChild(hr); tb.appendChild(thead);
    var tbody = el("tbody");
    c.regels.forEach(function (r) {
      var tr = el("tr", r.staat);
      tr.appendChild(el("td", null, r.model));
      tr.appendChild(el("td", null, r.kleur));
      tr.appendChild(el("td", "num", String(r.aantal)));
      var td = el("td");
      if (r.artikelcode) {
        td.appendChild(el("code", null, r.artikelcode));
        td.appendChild(document.createTextNode(" " + (r.artikelnaam || "")));
      } else td.appendChild(el("span", "sm-leeg", "—"));
      tr.appendChild(td);
      var st = el("td");
      st.appendChild(el("span", "sm-pil " + (r.staat === "zeker" ? "zeker" : r.staat === "nakijken" ? "nakijk" : "fout"),
        r.staat === "zeker" ? "zeker" : r.staat === "nakijken" ? "nakijken" : "onbekend"));
      if (r.uitleg) st.appendChild(el("div", "sm-uitlegregel", r.uitleg));
      // Onbekend model? Dan kun je hem hier één keer koppelen.
      if (cfg.magWijzigen && r.staat === "onmogelijk" && /model onbekend/.test(r.uitleg || "")) {
        st.appendChild(aliasKnop(r.model));
      }
      tr.appendChild(st);
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody); wrap.appendChild(tb);
    return wrap;
  }

  function aliasKnop(model) {
    var knop = el("button", "sm-knop mini", "Koppel \"" + model + "\"");
    knop.type = "button";
    knop.addEventListener("click", async function () {
      var naar = prompt("Hoe heet \"" + model + "\" in Logic4?\n\n" +
        "Typ de modelnaam precies zoals hij in de spa-catalogus staat.\n" +
        "Deze koppeling wordt onthouden en geldt daarna overal.");
      if (!naar) return;
      knop.disabled = true; knop.textContent = "bezig…";
      var j = await bewaarAlias(model, naar.trim());
      if (!j.ok) { alert("Niet gelukt: " + (j.error || "onbekende fout")); knop.disabled = false; return; }
      if (cfg.log) cfg.log("voorraad", "spa-alias vastgelegd", model + " → " + naar.trim());
      await herlaad();
    });
    return knop;
  }

  async function aanmaken(c, knop) {
    var extra = c.nakijken
      ? "\n\nLet op: " + c.nakijken + " regel(s) staan op 'nakijken'. Die gaan NIET mee tenzij je ze eerst controleert."
      : "";
    var mis = c.onmogelijk ? "\n" + c.onmogelijk + " regel(s) zijn niet te koppelen en gaan niet mee (staan wel in de opmerking van de order)." : "";
    if (!confirm("Inkooporder aanmaken bij Jazzi voor order " + c.nr + "?\n\n" +
      c.zeker + " regels gaan mee." + extra + mis +
      "\n\nEr gaat niets naar de fabriek — dit zet de bestelling alleen in Logic4.")) return;
    knop.disabled = true; knop.textContent = "bezig…";
    try {
      var j = await maakInkooporder(c.nr, false);
      if (j.dubbel) { alert(j.error); }
      else if (!j.ok && !j.buyOrderId) { alert("Niet gelukt: " + (j.error || "onbekende fout")); }
      else {
        var melding = "Inkooporder " + j.buyOrderId + " aangemaakt met " + j.toegevoegd + " regels.";
        if (j.mislukt && j.mislukt.length) melding += "\n\n" + j.mislukt.length + " regel(s) mislukten:\n" +
          j.mislukt.map(function (m) { return "· " + m.artikelcode + ": " + m.fout; }).join("\n");
        alert(melding);
        if (cfg.log) cfg.log("voorraad", "spa-inkooporder aangemaakt",
          "Jazzi-order " + c.nr + " → inkooporder " + j.buyOrderId + " (" + j.toegevoegd + " regels)");
      }
    } catch (e) {
      alert("Niet gelukt: " + (e.message || e));
    }
    await herlaad();
  }

  async function herlaad() {
    bezig = true; teken();
    try { voorstel = await haalVoorstel(); }
    catch (e) { doel.innerHTML = ""; doel.appendChild(el("p", "status-msg", "Voorstel ophalen mislukt: " + (e.message || e))); bezig = false; return; }
    bezig = false; teken();
  }

  async function start(opties) {
    cfg = opties || {};
    doel = document.getElementById(cfg.doelId || "tab-spainkoop");
    if (!doel || !cfg.teamKey) return;
    await laadVerborgen();
    if (voorstel) { teken(); return; }     // al geladen: niet opnieuw ophalen
    await herlaad();
  }

  global.fpSpaMigratie = { start: start };

})(typeof window !== "undefined" ? window : globalThis);
