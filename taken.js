/* ═══════════════════════════════════════════════════════════════════════════
   MIJN TAKEN — persoonlijk werkblok bovenaan het dashboard
   ═══════════════════════════════════════════════════════════════════════════

   Waarom dit er is
   ----------------
   Bij Fonteyn zit de dagelijkse routine grotendeels in hoofden. Valt iemand
   weg, dan valt zijn afdeling stil. Dit blok draait dat om: bij het inloggen
   ziet iedereen wat er vandaag van hém of háár wordt verwacht.

   Drie bronnen, in deze volgorde:

     1. EIGEN TAKEN     — zelf toegevoegd, met een datum. Wat je anders op een
                          post-it zet.
     2. TERUGKERENDE    — vaste momenten (maandelijkse voorraadcontrole,
        MOMENTEN          kwartaalcontrole geld-goederenbeweging). Verschijnen
                          vanzelf zodra ze aan de beurt zijn en verdwijnen weer
                          zodra ze zijn afgevinkt — tot de volgende ronde.
     3. SIGNALEN        — afgeleid uit Logic4. Niet verzonnen: het zijn dingen
                          die JIJ hebt gedaan en die nog niet af zijn. Een
                          maatwerkorder zonder inkoopprijs, een offerte die
                          blijft liggen, een aanbetaling zonder levering.

   Waarom signalen bij de persoon en niet bij de afdeling
   -----------------------------------------------------
   Een maandelijkse foutenlijst voor "inkoop" wordt door niemand opgepakt.
   Dezelfde regel met "jij maakte gisteren order 3512345 en de inkoopprijs
   ontbreekt" kost twee minuten en is meteen op te lossen. Fouten repareren aan
   de voorkant is orden van grootte goedkoper dan een jaar later.

   Snelheid
   --------
   Het paneel toont eigen taken en terugkerende momenten meteen (die komen uit
   KV, één aanroep). De signalen worden pas dáárna opgehaald en zijn een paar
   seconden werk; ze staan een uur in de cache zodat je niet bij elke login
   opnieuw wacht. Het dashboard is dus nooit traag door dit blok.

   OTA: dit bestand staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var BASIS = "https://fonteyn-data-store.g-mulder.workers.dev";
  var CACHE_UUR = 1;              // signalen zo lang hergebruiken
  var VERS_DAGEN = 21;            // hoever terug we in eigen orders kijken

  var cfg = null;                 // {email, teamKey, sessie, logic4Call, log}
  var mijnTaken = [];             // eigen taken van deze gebruiker
  var ritmes = [];                // terugkerende momenten (gedeeld)
  var afgevinkt = {};             // ritme-id → laatste afvinkdatum, per persoon
  var signalen = [];              // afgeleid uit Logic4
  var signalenBezig = false;

  /* ═══════════════ hulpjes ═══════════════ */

  function eltje(tag, klas, tekst) {
    var e = document.createElement(tag);
    if (klas) e.className = klas;
    if (tekst != null) e.textContent = tekst;
    return e;
  }
  function vandaag() { var d = new Date(); return d.toISOString().slice(0, 10); }
  function nlDatum(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return String(d.getDate()).padStart(2, "0") + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + d.getFullYear();
  }
  function dagenTot(iso) {
    if (!iso) return null;
    var d = new Date(iso + "T00:00:00").getTime();
    if (!isFinite(d)) return null;
    var nu = new Date(vandaag() + "T00:00:00").getTime();
    return Math.round((d - nu) / 86400000);
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function euro(n) { return "€ " + Math.round(n).toLocaleString("nl-NL"); }

  async function kvLees(bucket) {
    try {
      var r = await fetch(BASIS + "/data/" + bucket, { headers: { "X-Fonteyn-Auth": cfg.teamKey } });
      if (!r.ok) return {};
      return await r.json() || {};
    } catch (e) { return {}; }
  }
  async function kvSchrijf(bucket, waarde) {
    try {
      await fetch(BASIS + "/data/" + bucket, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
        body: JSON.stringify(waarde)
      });
      return true;
    } catch (e) { return false; }
  }

  /* ═══════════════ 1. EIGEN TAKEN ═══════════════
     Alle taken staan in één bucket, gegroepeerd per e-mailadres. Dat is
     bewust: het zijn er weinig, en zo kan een leidinggevende later ook een
     taak bij iemand anders neerleggen zonder dat we de opzet moeten omgooien. */

  var alleTaken = {};   // email → [taak]

  async function laadTaken() {
    alleTaken = await kvLees("taken");
    if (!alleTaken || typeof alleTaken !== "object") alleTaken = {};
    mijnTaken = alleTaken[cfg.email] || [];
  }
  async function bewaarTaken() {
    alleTaken[cfg.email] = mijnTaken;
    await kvSchrijf("taken", alleTaken);
  }

  function nieuweTaak(tekst, datum) {
    mijnTaken.push({
      id: "t" + Date.now() + Math.random().toString(36).slice(2, 6),
      tekst: String(tekst).slice(0, 300),
      datum: datum || "",
      klaar: false,
      gemaakt: new Date().toISOString()
    });
  }

  /* ═══════════════ 2. TERUGKERENDE MOMENTEN ═══════════════
     Staan centraal in de bucket 'taken-ritme' zodat ze voor iedereen gelijk
     zijn. Elk ritme noemt zelf wie het aangaat (op e-mailadres of op 'iedereen'
     en een frequentie in dagen. Het afvinken is persoonlijk.

     Als de bucket nog leeg is, vallen we terug op deze basisset. Dat scheelt
     handmatig invullen en het is meteen duidelijk hoe het werkt. */

  var STANDAARD_RITMES = [
    {
      id: "voorraad-maandelijks", elke: 30,
      titel: "Voorraad nalopen",
      wat: "Loop de voorraadstanden na van de modellen waar jij over gaat: klopt de hal-voorraad met wat er werkelijk staat?",
      tegel: "voorraad.html",
      wie: ["chantal@fonteyn.nl", "arno@fonteyn.nl", "manon@fonteyn.nl"]
    },
    {
      id: "geldgoederen-kwartaal", elke: 91,
      titel: "Geld-goederenbeweging controleren",
      wat: "Draai de controle opnieuw en loop de bevindingen langs die op jouw afdeling staan. Kijk vooral of vorige keer echt is opgelost.",
      tegel: "geldgoederen.html",
      wie: ["gerrit@fonteyn.nl", "osman@fonteyn.nl", "dolf@fonteyn.nl"]
    },
    {
      id: "openstaand-maandelijks", elke: 30,
      titel: "Openstaande facturen nalopen",
      wat: "Bekijk de facturen die meer dan negentig dagen over de vervaldatum zijn en bepaal per post: innen, regeling of afboeken.",
      tegel: "geldgoederen.html",
      wie: ["osman@fonteyn.nl"]
    }
  ];

  async function laadRitmes() {
    var opgeslagen = await kvLees("taken-ritme");
    ritmes = (opgeslagen && opgeslagen.ritmes) || STANDAARD_RITMES;
    afgevinkt = (opgeslagen && opgeslagen.afgevinkt && opgeslagen.afgevinkt[cfg.email]) || {};
    return opgeslagen;
  }
  async function ritmeAfvinken(id) {
    var opgeslagen = await kvLees("taken-ritme");
    if (!opgeslagen.ritmes) opgeslagen.ritmes = ritmes;
    if (!opgeslagen.afgevinkt) opgeslagen.afgevinkt = {};
    if (!opgeslagen.afgevinkt[cfg.email]) opgeslagen.afgevinkt[cfg.email] = {};
    opgeslagen.afgevinkt[cfg.email][id] = vandaag();
    afgevinkt[id] = vandaag();
    await kvSchrijf("taken-ritme", opgeslagen);
  }

  // Welke ritmes staan er voor mij open? Een ritme is 'aan de beurt' zodra het
  // langer geleden is afgevinkt dan de frequentie. Nooit afgevinkt = meteen aan
  // de beurt, want dan is het nog nooit gedaan.
  function openstaandeRitmes() {
    var uit = [];
    for (var i = 0; i < ritmes.length; i++) {
      var r = ritmes[i];
      var voorMij = !r.wie || r.wie.length === 0 ||
        r.wie.indexOf("iedereen") >= 0 ||
        r.wie.some(function (w) { return String(w).toLowerCase() === cfg.email; });
      if (!voorMij) continue;
      var laatst = afgevinkt[r.id];
      var over = laatst ? (num(r.elke) - Math.abs(num(dagenTot(laatst)))) : 0;
      if (!laatst || over <= 0) uit.push({ ritme: r, laatst: laatst });
    }
    return uit;
  }

  /* ═══════════════ 3. SIGNALEN UIT LOGIC4 ═══════════════

     Twee bronnen:
       a) De laatste controle geld-goederenbeweging (staat al in KV). Daar zit
          per bevinding het Logic4-gebruikersnummer van wie de order maakte.
          Kost niets — het is één bestand dat er al ligt.
       b) Verse eigen orders van de afgelopen weken, rechtstreeks uit Logic4.
          Dit vangt wat vandaag misgaat, niet wat drie maanden geleden misging.

     Alles wordt gefilterd op JOUW Logic4-gebruikersnummer. Zonder koppeling
     tussen inlog en Logic4-gebruiker tonen we niets, in plaats van andermans
     werk te laten zien. */

  var mijnUserId = null;

  async function zoekMijnUserId() {
    if (mijnUserId !== null) return mijnUserId;
    try {
      var users = await cfg.logic4Call("/v3/User/GetAllUsers", null, "GET");
      var lijst = Array.isArray(users) ? users : (users && users.Records) || [];
      for (var i = 0; i < lijst.length; i++) {
        var u = String(lijst[i].Username || "").toLowerCase();
        if (u === cfg.email) { mijnUserId = num(lijst[i].UserId); return mijnUserId; }
      }
      // Logic4 kent zowel 'naam@fonteyn.nl' als 'fonteyn.naam'. Als het e-mail-
      // adres niet raak is, proberen we de korte vorm.
      var kort = cfg.email.split("@")[0];
      for (var j = 0; j < lijst.length; j++) {
        var u2 = String(lijst[j].Username || "").toLowerCase();
        if (u2 === "fonteyn." + kort || u2 === kort) { mijnUserId = num(lijst[j].UserId); return mijnUserId; }
      }
    } catch (e) { /* geen Logic4-scope: dan gewoon geen signalen */ }
    mijnUserId = 0;
    return 0;
  }

  // (a) bevindingen uit de laatste controle die op mijn naam staan
  async function signalenUitControle(uid) {
    var uit = [];
    if (!uid) return uit;
    var opslag = await kvLees("geldgoederen");
    var m = opslag && opslag.laatste;
    if (!m || !m.controles) return uit;
    var status = await kvLees("gg-bevindingen");
    for (var i = 0; i < m.controles.length; i++) {
      var c = m.controles[i];
      for (var j = 0; j < (c.regels || []).length; j++) {
        var r = c.regels[j];
        if (num(r.door) !== uid) continue;
        var st = status[r.sleutel];
        if (st && (st.status === "opgelost" || st.status === "akkoord")) continue;
        uit.push({
          bron: "controle", controle: c.id, titel: c.naam, actie: c.actie,
          verwijzing: r.verwijzing, detail: r.detail, bedrag: num(r.bedrag),
          eenheid: c.eenheid, datum: r.datum, tegel: "geldgoederen.html"
        });
      }
    }
    // De zwaarste eerst; niemand loopt honderd regels af.
    uit.sort(function (a, b) { return b.bedrag - a.bedrag; });
    return uit.slice(0, 12);
  }

  // (b) verse eigen orders — wat vandaag misgaat
  async function signalenUitVerseOrders(uid) {
    var uit = [];
    if (!uid) return uit;
    var van = new Date(Date.now() - VERS_DAGEN * 86400000).toISOString().slice(0, 10);
    var orders = [], skip = 0;
    for (var p = 0; p < 12; p++) {
      var r = await cfg.logic4Call("/v3/Orders/GetOrders", {
        TakeRecords: 500, SkipRecords: skip, CreationDateFrom: van, LoadPayments: true
      });
      var lijst = Array.isArray(r) ? r : (r && r.Records) || [];
      if (!lijst.length) break;
      orders = orders.concat(lijst);
      if (lijst.length < 500) break;
      skip += 500;
    }
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (num(o.UserId) !== uid) continue;
      var status = (o.OrderStatus && o.OrderStatus.Value) || "";
      var rows = o.OrderRows || [];

      // Maatwerk zonder inkoopprijs — dit is de duurste en makkelijkst te
      // voorkomen fout die er is. Nu nog op te lossen, over een jaar niet meer.
      for (var k = 0; k < rows.length; k++) {
        var row = rows[k];
        var np = num(row.NettPrice), bp = num(row.BuyPrice), qty = num(row.Qty);
        if (qty > 0 && np > 0 && bp <= 0 && /maatwerk|op maat/i.test(String(row.Description || ""))) {
          uit.push({
            bron: "vers", titel: "Maatwerk zonder inkoopprijs",
            actie: "Vul de inkoopprijs in op de orderregel — de offerte van de leverancier ligt er nu nog.",
            verwijzing: "Order " + o.Id, detail: String(row.Description || "").slice(0, 60),
            bedrag: qty * np, eenheid: "eur", datum: o.CreationDate, tegel: ""
          });
        }
      }

      // Offerte die blijft liggen
      if (/^offerte$/i.test(status)) {
        var oud = Math.abs(num(dagenTot(String(o.CreationDate).slice(0, 10))));
        if (oud >= 14) uit.push({
          bron: "vers", titel: "Offerte ligt er " + oud + " dagen",
          actie: "Bel de klant na of sluit de offerte.",
          verwijzing: "Order " + o.Id, detail: String(o.Description || "").slice(0, 60),
          bedrag: num((o.Totals || {}).AmountIncl), eenheid: "eur", datum: o.CreationDate, tegel: ""
        });
      }
    }
    uit.sort(function (a, b) { return b.bedrag - a.bedrag; });
    return uit.slice(0, 10);
  }

  async function laadSignalen() {
    // Uit de cache als die vers genoeg is — anders wacht je bij elke login.
    try {
      var rauw = localStorage.getItem("fp.signalen." + cfg.email);
      if (rauw) {
        var c = JSON.parse(rauw);
        if (c && c.tot && new Date(c.tot).getTime() > Date.now()) { signalen = c.lijst || []; return; }
      }
    } catch (e) {}
    signalenBezig = true; teken();
    var uid = await zoekMijnUserId();
    var uitControle = await signalenUitControle(uid);
    var uitVers = [];
    try { uitVers = await signalenUitVerseOrders(uid); } catch (e) { /* Logic4 niet bereikbaar */ }
    signalen = uitVers.concat(uitControle);
    signalenBezig = false;
    try {
      localStorage.setItem("fp.signalen." + cfg.email, JSON.stringify({
        tot: new Date(Date.now() + CACHE_UUR * 3600000).toISOString(), lijst: signalen
      }));
    } catch (e) {}
    teken();
  }

  /* ═══════════════ TEKENEN ═══════════════ */

  var doel = null;

  function teken() {
    if (!doel) return;
    doel.innerHTML = "";

    var open = mijnTaken.filter(function (t) { return !t.klaar; });
    var ritmesOpen = openstaandeRitmes();
    var totaal = open.length + ritmesOpen.length + signalen.length;

    var kaart = eltje("section", "takenblok");

    // ── kop ──
    var kop = eltje("div", "taken-kop");
    var titel = eltje("h3", null, "Wat staat er voor je klaar");
    kop.appendChild(titel);
    var telling = eltje("span", "taken-telling",
      totaal === 0 ? "niets open" : totaal + (totaal === 1 ? " punt" : " punten"));
    if (totaal === 0) telling.classList.add("leeg");
    kop.appendChild(telling);
    kaart.appendChild(kop);

    // ── nieuwe taak ──
    var invoer = eltje("form", "taken-invoer");
    var veld = eltje("input");
    veld.type = "text"; veld.placeholder = "Taak toevoegen…"; veld.maxLength = 300;
    var datumveld = eltje("input");
    datumveld.type = "date"; datumveld.title = "Uiterlijk (mag leeg)";
    var knop = eltje("button", "taken-plus", "Toevoegen");
    knop.type = "submit";
    invoer.appendChild(veld); invoer.appendChild(datumveld); invoer.appendChild(knop);
    invoer.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var t = veld.value.trim();
      if (!t) return;
      nieuweTaak(t, datumveld.value);
      veld.value = ""; datumveld.value = "";
      teken();
      await bewaarTaken();
      if (cfg.log) cfg.log("taken", "taak toegevoegd", t.slice(0, 80));
    });
    kaart.appendChild(invoer);

    var lijst = eltje("div", "taken-lijst");

    // ── eigen taken ──
    open.sort(function (a, b) {
      if (!a.datum && !b.datum) return 0;
      if (!a.datum) return 1;
      if (!b.datum) return -1;
      return a.datum < b.datum ? -1 : 1;
    });
    open.forEach(function (t) {
      var rij = eltje("div", "taak");
      var vink = eltje("input"); vink.type = "checkbox"; vink.className = "taak-vink";
      vink.addEventListener("change", async function () {
        t.klaar = true; t.klaarOp = new Date().toISOString();
        teken(); await bewaarTaken();
        if (cfg.log) cfg.log("taken", "taak afgevinkt", String(t.tekst).slice(0, 80));
      });
      rij.appendChild(vink);
      var mid = eltje("div", "taak-mid");
      mid.appendChild(eltje("div", "taak-tekst", t.tekst));
      if (t.datum) {
        var d = dagenTot(t.datum);
        var label = d === 0 ? "vandaag" : d === 1 ? "morgen" : d < 0 ? Math.abs(d) + " dagen te laat" : "over " + d + " dagen";
        var sub = eltje("div", "taak-sub " + (d < 0 ? "telaat" : d <= 1 ? "nu" : ""), nlDatum(t.datum) + " · " + label);
        mid.appendChild(sub);
      }
      rij.appendChild(mid);
      var weg = eltje("button", "taak-weg", "×");
      weg.title = "Verwijderen";
      weg.addEventListener("click", async function () {
        mijnTaken = mijnTaken.filter(function (x) { return x.id !== t.id; });
        teken(); await bewaarTaken();
      });
      rij.appendChild(weg);
      lijst.appendChild(rij);
    });

    // ── terugkerende momenten ──
    ritmesOpen.forEach(function (r) {
      var rij = eltje("div", "taak ritme");
      var vink = eltje("input"); vink.type = "checkbox"; vink.className = "taak-vink";
      vink.title = "Gedaan — komt over " + r.ritme.elke + " dagen terug";
      vink.addEventListener("change", async function () {
        await ritmeAfvinken(r.ritme.id);
        teken();
        if (cfg.log) cfg.log("taken", "terugkerend moment afgevinkt", r.ritme.titel);
      });
      rij.appendChild(vink);
      var mid = eltje("div", "taak-mid");
      var kopje = eltje("div", "taak-tekst");
      kopje.appendChild(eltje("span", "taak-merk", "terugkerend"));
      kopje.appendChild(document.createTextNode(" " + r.ritme.titel));
      mid.appendChild(kopje);
      mid.appendChild(eltje("div", "taak-sub", r.ritme.wat +
        (r.laatst ? "  ·  laatst gedaan op " + nlDatum(r.laatst) : "  ·  nog niet eerder gedaan")));
      rij.appendChild(mid);
      if (r.ritme.tegel) {
        var ga = eltje("a", "taak-ga", "Openen");
        ga.href = r.ritme.tegel;
        rij.appendChild(ga);
      }
      lijst.appendChild(rij);
    });

    // ── signalen ──
    if (signalenBezig) {
      var bezig = eltje("div", "taak signaal");
      bezig.appendChild(eltje("div", "taak-mid", "Bezig met kijken of er nog iets van jou openstaat in Logic4…"));
      lijst.appendChild(bezig);
    }
    signalen.forEach(function (s) {
      var rij = eltje("div", "taak signaal");
      rij.appendChild(eltje("div", "taak-punt"));
      var mid = eltje("div", "taak-mid");
      var kopje = eltje("div", "taak-tekst");
      kopje.appendChild(eltje("span", "taak-merk sig", s.bron === "vers" ? "uit Logic4" : "uit de controle"));
      kopje.appendChild(document.createTextNode(" " + s.titel));
      mid.appendChild(kopje);
      var regels = [s.verwijzing];
      if (s.detail) regels.push(s.detail);
      if (s.bedrag && s.eenheid === "eur") regels.push(euro(s.bedrag));
      mid.appendChild(eltje("div", "taak-sub", regels.join("  ·  ")));
      mid.appendChild(eltje("div", "taak-actie", s.actie));
      rij.appendChild(mid);
      if (s.tegel) {
        var ga2 = eltje("a", "taak-ga", "Bekijken");
        ga2.href = s.tegel;
        rij.appendChild(ga2);
      }
      lijst.appendChild(rij);
    });

    if (!lijst.children.length) {
      lijst.appendChild(eltje("div", "taken-leeg",
        "Er staat niets open. Zodra er iets uit Logic4 komt wat van jou is, verschijnt het hier vanzelf."));
    }

    kaart.appendChild(lijst);
    doel.appendChild(kaart);
  }

  /* ═══════════════ START ═══════════════ */

  async function start(opties) {
    cfg = opties || {};
    cfg.email = String(cfg.email || "").toLowerCase();
    doel = document.getElementById(cfg.doelId || "takenBlok");
    if (!doel || !cfg.email) return;
    if (!cfg.teamKey) return;          // zonder sleutel geen opslag: dan liever niets tonen

    await laadTaken();
    await laadRitmes();
    teken();
    // Signalen daarna, zodat het dashboard nooit op Logic4 hoeft te wachten.
    laadSignalen();
  }

  global.fpTaken = { start: start };

})(typeof window !== "undefined" ? window : globalThis);
