/* ═══════════════════════════════════════════════════════════════════════════
   MIJN TAKEN — persoonlijk werkblok bovenaan het dashboard
   ═══════════════════════════════════════════════════════════════════════════

   Waarom dit er is
   ----------------
   Bij Fonteyn zit de dagelijkse routine grotendeels in hoofden. Valt iemand
   weg, dan valt zijn afdeling stil. Dit blok draait dat om: bij het inloggen
   ziet iedereen wat er vandaag van hém of háár wordt verwacht.

   Vier bronnen, in deze volgorde:

     0. NIEUW VOOR JOU  — wat er aan JOUW tegels veranderd is sinds je hier
                          voor het laatst keek, en welke tegel je erbij hebt
                          gekregen. Zie nieuws.js. Staat bovenaan omdat het
                          eenmalig is: je leest het, je klikt het weg.

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

   Meekijken
   ---------
   Dolf, Gerrit en Fonteynbot kunnen dit blok ook voor iedereen tegelijk
   opvragen (fpTaken.overzicht), zodat er iemand is die weet wat er bij de
   rest openstaat. Dat scherm zit in activiteit.html. De rekenregels staan
   hier één keer; een tweede kopie zou binnen een maand uit de pas lopen.

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

  var GEZIEN = "dashboard-gezien"; // bucket: wie welke berichten al gelezen heeft

  var cfg = null;                 // {email, teamKey, sessie, logic4Call, log}
  var sleutel = "";               // teamsleutel; ook het overzichtsscherm zet deze
  var mijnTaken = [];             // eigen taken van deze gebruiker
  var ritmes = [];                // terugkerende momenten (gedeeld)
  var afgevinkt = {};             // ritme-id → laatste afvinkdatum, van mij
  var signalen = [];              // afgeleid uit Logic4
  var signalenBezig = false;
  var nieuwsRegels = [];          // berichten die ik nog niet heb weggeklikt
  var nieuweTegels = [];          // tegels die ik erbij heb gekregen

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
      var r = await fetch(BASIS + "/data/" + bucket, { headers: { "X-Fonteyn-Auth": sleutel } });
      if (!r.ok) return {};
      return await r.json() || {};
    } catch (e) { return {}; }
  }
  async function kvSchrijf(bucket, waarde) {
    try {
      await fetch(BASIS + "/data/" + bucket, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": sleutel },
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

  var afgevinktAlles = {};   // email → {ritme-id: datum}. Het overzichtsscherm
                             // heeft ze allemaal nodig, ik alleen de mijne.

  async function laadRitmes() {
    var opgeslagen = await kvLees("taken-ritme");
    ritmes = (opgeslagen && opgeslagen.ritmes) || STANDAARD_RITMES;
    afgevinktAlles = (opgeslagen && opgeslagen.afgevinkt) || {};
    afgevinkt = afgevinktAlles[cfg.email] || {};
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
  function openstaandeRitmes(email, vinkjes) {
    var wie = String(email == null ? cfg.email : email).toLowerCase();
    var vink = vinkjes || afgevinkt;
    var uit = [];
    for (var i = 0; i < ritmes.length; i++) {
      var r = ritmes[i];
      var voorHem = !r.wie || r.wie.length === 0 ||
        r.wie.indexOf("iedereen") >= 0 ||
        r.wie.some(function (w) { return String(w).toLowerCase() === wie; });
      if (!voorHem) continue;
      var laatst = vink[r.id];
      var over = laatst ? (num(r.elke) - Math.abs(num(dagenTot(laatst)))) : 0;
      if (!laatst || over <= 0) uit.push({ ritme: r, laatst: laatst });
    }
    return uit;
  }

  /* ═══════════════ 0. NIEUW VOOR JOU ═══════════════
     Twee dingen die iemand anders nooit te horen krijgt:

       a) Wat er aan de eigen tegels veranderd is. Die berichten staan met
          de hand in nieuws.js, want "Passion Partners: uitlijning, groen,
          dikkere collectielijn" is een zin voor mij en niet voor Gretha.

       b) Welke tegel erbij is gekomen. Dat schrijft niemand op: we bewaren
          welke tegels er de vorige keer waren en vergelijken dat met nu.
          Krijgt Chantal er Vertalen bij, dan ziet zij dat vanzelf bij de
          eerstvolgende login.

     Beide staan in de bucket 'dashboard-gezien', per e-mailadres:
         { "chantal@fonteyn.nl": { gezien: "2026-08-21T09:12:00Z",
                                   tegels: ["voorraad.html", ...] } }

     'gezien' is de datum waarop er op "gelezen" is geklikt; alles wat daarna
     live ging komt in beeld. Is die leeg, dan kijkt nieuws.js veertien dagen
     terug in plaats van tot het begin - anders krijgt iemand bij de eerste
     login de hele lijst voor zijn kiezen.

     De tegelstand schrijven we wél meteen weg, ook zonder klik. Zonder die
     nulmeting zou iedereen de complete tegelrij als "nieuw" gepresenteerd
     krijgen, en dat is precies het bericht dat niemand meer leest. */

  var mijnGezien = { gezien: "", tegels: [] };

  async function laadGezien() {
    var alles = await kvLees(GEZIEN);
    if (!alles || typeof alles !== "object") alles = {};
    var eigen = alles[cfg.email];
    mijnGezien = {
      gezien: (eigen && eigen.gezien) || "",
      tegels: (eigen && eigen.tegels) || [],
    };
    var eersteKeer = !eigen;

    var n = global.fpNieuws;
    var bij = n ? n.samenstellen(cfg.email, eigen ? mijnGezien : null) : { nieuws: [], tegels: [] };
    nieuwsRegels = bij.nieuws;
    nieuweTegels = bij.tegels;

    // Nulmeting: nu vastleggen welke tegels er zijn, zodat de vólgende
    // wijziging wél opvalt. Dit zet 'gezien' bewust niet.
    if (eersteKeer && n) {
      mijnGezien.tegels = n.tegelStand(cfg.email);
      await bewaarGezien(false);
    }
  }

  /* Opnieuw inlezen vlak voor het schrijven, want het is één bestand voor
     alle collega's. Dat maakt het venster klein maar niet nul: klikken twee
     mensen in dezelfde seconde op "gelezen", dan kan er één verloren gaan en
     ziet die persoon de berichten de volgende keer opnieuw. Hinderlijk, meer
     niet - en het is dezelfde afweging als bij de taken zelf. Een bestand per
     persoon zou dit oplossen maar levert dertig losse leesacties op voor het
     meekijkscherm, en dat is de ruil niet waard. */
  async function bewaarGezien(ookDatum) {
    var alles = await kvLees(GEZIEN);
    if (!alles || typeof alles !== "object") alles = {};
    if (ookDatum) mijnGezien.gezien = new Date().toISOString();
    alles[cfg.email] = { gezien: mijnGezien.gezien, tegels: mijnGezien.tegels };
    await kvSchrijf(GEZIEN, alles);
  }

  async function nieuwsWegklikken() {
    var n = global.fpNieuws;
    if (n) mijnGezien.tegels = n.tegelStand(cfg.email);
    nieuwsRegels = [];
    nieuweTegels = [];
    teken();
    await bewaarGezien(true);
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

  // Het icoon van de tegel waar een bericht over gaat. Gaat het over het
  // dashboard zelf, dan een huisje.
  function ikoonVan(n) {
    if (n.iedereen || !global.fpTegels) return "🏠";
    var t = global.fpTegels.lijst.filter(function (x) {
      return (n.bestand && x.bestand === n.bestand) || (n.groep && x.groep === n.groep);
    })[0];
    return (t && t.ic) || "🏠";
  }
  function merkTekst(soort) {
    return soort === "nieuw" ? "nieuw" : soort === "hersteld" ? "opgelost" : "vernieuwd";
  }
  function merkKlasse(soort) {
    return soort === "nieuw" ? "nw" : soort === "hersteld" ? "hs" : "vb";
  }

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

    // ── nieuw voor jou ──
    // Boven het invoerveld, want het is het enige wat je vandaag nog niet
    // gezien had. Eén keer lezen, wegklikken, weg.
    if (nieuwsRegels.length || nieuweTegels.length) {
      var nb = eltje("div", "nieuwblok");

      var nkop = eltje("div", "nieuw-kop");
      var aantal = nieuwsRegels.length + nieuweTegels.length;
      nkop.appendChild(eltje("strong", null,
        aantal === 1 ? "Nieuw voor jou" : "Nieuw voor jou  ·  " + aantal + " berichten"));
      var weg = eltje("button", "nieuw-weg", "Gelezen");
      weg.type = "button";
      weg.title = "Wegklikken. Je krijgt ze niet nog een keer.";
      weg.addEventListener("click", function () {
        nieuwsWegklikken();
        if (cfg.log) cfg.log("dashboard", "nieuwsberichten gelezen", aantal + " berichten");
      });
      nkop.appendChild(weg);
      nb.appendChild(nkop);

      // Eerst de tegels die erbij zijn gekomen: dat is het grootste nieuws
      // dat iemand kan hebben, en het staat nergens opgeschreven.
      nieuweTegels.forEach(function (t) {
        var rij = eltje("div", "nieuw-regel");
        var ic = eltje("div", "nieuw-ic", t.ic);
        rij.appendChild(ic);
        var mid = eltje("div", "nieuw-mid");
        var kopje = eltje("div", "nieuw-titel");
        kopje.appendChild(eltje("span", "taak-merk nw", "tegel erbij"));
        kopje.appendChild(document.createTextNode(" " + t.naam));
        mid.appendChild(kopje);
        mid.appendChild(eltje("div", "nieuw-wat",
          t.uit + ". Deze tegel is nieuw voor jou - hij staat hieronder tussen de andere."));
        rij.appendChild(mid);
        if (!t.extern) {
          var ga = eltje("a", "taak-ga", "Openen");
          ga.href = t.bestand;
          rij.appendChild(ga);
        }
        nb.appendChild(rij);
      });

      // En dan wat er aan bestaande tegels veranderd is.
      nieuwsRegels.forEach(function (n) {
        var rij = eltje("div", "nieuw-regel");
        rij.appendChild(eltje("div", "nieuw-ic", ikoonVan(n)));
        var mid = eltje("div", "nieuw-mid");
        var kopje = eltje("div", "nieuw-titel");
        kopje.appendChild(eltje("span", "taak-merk " + merkKlasse(n.soort), merkTekst(n.soort)));
        kopje.appendChild(document.createTextNode(" " + n.titel));
        mid.appendChild(kopje);
        mid.appendChild(eltje("div", "nieuw-wat", n.wat));
        mid.appendChild(eltje("div", "nieuw-datum", nlDatum(n.datum)));
        rij.appendChild(mid);
        if (n.bestand && !/^https?:/i.test(n.bestand)) {
          var ga2 = eltje("a", "taak-ga", "Bekijken");
          ga2.href = n.bestand;
          rij.appendChild(ga2);
        }
        nb.appendChild(rij);
      });

      kaart.appendChild(nb);
    }

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
    sleutel = cfg.teamKey;

    await laadTaken();
    await laadRitmes();
    // De berichten hangen aan de tegellijst en die staat er al; dit is één
    // extra aanroep en geen wachttijd waard om over te slaan.
    try { await laadGezien(); } catch (e) { /* dan gewoon geen berichten */ }
    teken();
    // Signalen daarna, zodat het dashboard nooit op Logic4 hoeft te wachten.
    laadSignalen();
  }

  /* ═══════════════ MEEKIJKEN ═══════════════
     Hetzelfde blok, maar dan voor iedereen tegelijk. Draait in
     activiteit.html, dat al achter de beheerlaag zit.

     Wat hier NIET gebeurt: de signalen uit Logic4 ophalen. Dat is per persoon
     een rondje langs zijn orders en dat vraag je niet dertig keer achter
     elkaar bij het openen van een scherm. Wie ze wil ziet ze met een knop;
     signalenPerPersoon hieronder haalt ze dan in één keer voor iedereen op.

     Eén persoon kan onder drie namen inloggen ("dolf@fonteyn.nl", "dolf",
     "fonteyn.dolf") en de taken staan dus onder de naam waarmee die dag is
     ingelogd. Daarom geef je hier een persoon mee met al zijn schrijfwijzen,
     en niet één adres; we tellen ze op tot één rij.

       await fpTaken.overzicht({ teamKey: "...", personen: [
         { naam: "dolf", adressen: fpToegang.varianten("dolf") } ]})
         → [{ naam, adressen, taken, ritmes, nieuws, nieuweTegels,
              gezien, tegels, nooitGeopend }]  */

  async function overzicht(opties) {
    var o = opties || {};
    sleutel = o.teamKey || sleutel;
    if (!sleutel) return [];

    var takenAlles = await kvLees("taken");
    if (!takenAlles || typeof takenAlles !== "object") takenAlles = {};
    var ritmeOpslag = await kvLees("taken-ritme");
    ritmes = (ritmeOpslag && ritmeOpslag.ritmes) || STANDAARD_RITMES;
    var vinkjes = (ritmeOpslag && ritmeOpslag.afgevinkt) || {};
    var gezienAlles = await kvLees(GEZIEN);
    if (!gezienAlles || typeof gezienAlles !== "object") gezienAlles = {};

    var n = global.fpNieuws;

    return (o.personen || []).map(function (persoon) {
      var adressen = (persoon.adressen || []).map(function (a) { return String(a).toLowerCase(); });

      var taken = [], ritmesOpen = [], vinkSamen = {}, g = null;
      adressen.forEach(function (adres) {
        (takenAlles[adres] || []).forEach(function (t) { if (!t.klaar) taken.push(t); });
        var v = vinkjes[adres] || {};
        // De laatste afvinkdatum wint: onder welke naam er is ingelogd doet
        // er voor een terugkerend moment niet toe.
        Object.keys(v).forEach(function (id) {
          if (!vinkSamen[id] || vinkSamen[id] < v[id]) vinkSamen[id] = v[id];
        });
        var eigen = gezienAlles[adres];
        if (eigen && (!g || String(eigen.gezien || "") > String(g.gezien || ""))) g = eigen;
      });

      // Voor "wat mag hij zien" maakt de schrijfwijze niet uit; toegang.js
      // kent alle drie. We nemen de eerste die bestaat.
      var wie = adressen[0] || "";
      ritmesOpen = openstaandeRitmes(wie, vinkSamen);
      var bij = n ? n.samenstellen(wie, g) : { nieuws: [], tegels: [] };

      return {
        naam: persoon.naam || wie,
        adressen: adressen,
        taken: taken,
        ritmes: ritmesOpen,
        nieuws: bij.nieuws,
        nieuweTegels: bij.tegels,
        gezien: (g && g.gezien) || "",
        tegels: (g && g.tegels) || [],
        nooitGeopend: !g,
      };
    });
  }

  /* De signalen voor iedereen tegelijk. Eén keer de orders van de afgelopen
     weken ophalen en op Logic4-gebruiker uitsorteren, plus de bevindingen uit
     de laatste controle. Dat is precies wat elke medewerker afzonderlijk bij
     het inloggen doet, maar dan één keer in plaats van dertig keer.

       await fpTaken.signalenPerPersoon(logic4Call)  →  { email: [signaal] }  */

  async function signalenPerPersoon(logic4Call) {
    var uit = {};
    if (typeof logic4Call !== "function") return uit;

    // Logic4-gebruikersnummer → inlognaam, zodat we een signaal bij een
    // persoon kunnen leggen.
    var naamVan = {};
    try {
      var users = await logic4Call("/v3/User/GetAllUsers", null, "GET");
      var lijst = Array.isArray(users) ? users : (users && users.Records) || [];
      lijst.forEach(function (u) {
        var naam = String(u.Username || "").toLowerCase();
        if (naam) naamVan[num(u.UserId)] = naam;
      });
    } catch (e) { return uit; }

    function leg(uid, signaal) {
      var naam = naamVan[uid];
      if (!naam) return;
      (uit[naam] = uit[naam] || []).push(signaal);
    }

    // (a) uit de laatste controle geld-goederenbeweging
    var opslag = await kvLees("geldgoederen");
    var m = opslag && opslag.laatste;
    var status = await kvLees("gg-bevindingen");
    if (m && m.controles) {
      m.controles.forEach(function (c) {
        (c.regels || []).forEach(function (r) {
          var st = status[r.sleutel];
          if (st && (st.status === "opgelost" || st.status === "akkoord")) return;
          leg(num(r.door), {
            bron: "controle", titel: c.naam, actie: c.actie, verwijzing: r.verwijzing,
            detail: r.detail, bedrag: num(r.bedrag), eenheid: c.eenheid,
            datum: r.datum, tegel: "geldgoederen.html",
          });
        });
      });
    }

    // (b) verse eigen orders - dezelfde twee regels als in het blok zelf
    var van = new Date(Date.now() - VERS_DAGEN * 86400000).toISOString().slice(0, 10);
    var orders = [], skip = 0;
    try {
      for (var p = 0; p < 12; p++) {
        var r2 = await logic4Call("/v3/Orders/GetOrders", {
          TakeRecords: 500, SkipRecords: skip, CreationDateFrom: van, LoadPayments: true
        });
        var deel = Array.isArray(r2) ? r2 : (r2 && r2.Records) || [];
        if (!deel.length) break;
        orders = orders.concat(deel);
        if (deel.length < 500) break;
        skip += 500;
      }
    } catch (e) { /* Logic4 niet bereikbaar: dan alleen de controle */ }

    orders.forEach(function (o) {
      var uid = num(o.UserId);
      var toestand = (o.OrderStatus && o.OrderStatus.Value) || "";
      (o.OrderRows || []).forEach(function (row) {
        var np = num(row.NettPrice), bp = num(row.BuyPrice), qty = num(row.Qty);
        if (qty > 0 && np > 0 && bp <= 0 && /maatwerk|op maat/i.test(String(row.Description || ""))) {
          leg(uid, {
            bron: "vers", titel: "Maatwerk zonder inkoopprijs",
            actie: "Vul de inkoopprijs in op de orderregel.",
            verwijzing: "Order " + o.Id, detail: String(row.Description || "").slice(0, 60),
            bedrag: qty * np, eenheid: "eur", datum: o.CreationDate, tegel: "",
          });
        }
      });
      if (/^offerte$/i.test(toestand)) {
        var oud = Math.abs(num(dagenTot(String(o.CreationDate).slice(0, 10))));
        if (oud >= 14) leg(uid, {
          bron: "vers", titel: "Offerte ligt er " + oud + " dagen",
          actie: "Bel de klant na of sluit de offerte.",
          verwijzing: "Order " + o.Id, detail: String(o.Description || "").slice(0, 60),
          bedrag: num((o.Totals || {}).AmountIncl), eenheid: "eur", datum: o.CreationDate, tegel: "",
        });
      }
    });

    Object.keys(uit).forEach(function (k) {
      uit[k].sort(function (a, b) { return b.bedrag - a.bedrag; });
      uit[k] = uit[k].slice(0, 22);
    });
    return uit;
  }

  global.fpTaken = {
    start: start,
    overzicht: overzicht,
    signalenPerPersoon: signalenPerPersoon,
  };

})(typeof window !== "undefined" ? window : globalThis);
