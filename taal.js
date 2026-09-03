/* ═══════════════════════════════════════════════════════════════════════════
   TAAL - het dashboard in het Nederlands of het Engels
   ═══════════════════════════════════════════════════════════════════════════

   Waarom zo
   ---------
   Het dashboard bestaat uit vierentwintig losse tegels met de teksten gewoon
   in de HTML. Die allemaal ombouwen naar tekstsleutels zou betekenen dat elke
   toekomstige wijziging op twee plekken moet, en dan lopen ze binnen een maand
   uit elkaar.

   Daarom gaat het andersom: de Nederlandse tekst blijft staan waar hij staat,
   en deze laag vervangt hem bij het openen door de Engelse als die bekend is.
   Precies zoals de twee andere dashboard-brede stukjes die in elke tegel
   staan (de datumnotatie en de nette uploadknoppen).

   Wat er wel en niet vertaald wordt
   ---------------------------------
   Alleen tekst die letterlijk in de woordenlijst staat, of die op een van de
   patronen past. Dat is geen beperking maar de hele veiligheid: klantnamen,
   modelnamen, ordernummers en bedragen staan er niet in en blijven dus met
   zekerheid onaangeraakt. Een zin die nog geen vertaling heeft blijft
   Nederlands - lelijk, maar nooit fout.

   Wat er nog niet in zit
   ----------------------
   - Getallen en datums blijven Nederlands genoteerd (1.234,56 en 28.07.2026).
     Dat zit in elke tegel apart in toLocaleString("nl-NL") en hoort in één
     keer omgezet te worden, niet half.
   - De langere uitlegteksten die een tegel zelf in elkaar zet met getallen
     erin. Die zijn per stuk om te bouwen; de knoppen, kolomkoppen en labels
     gaan voor.

   Aanvullen
   ---------
   Open een tegel, tik in de console fpTaalOntbreekt() en je krijgt precies de
   zinnen die nog geen vertaling hebben, al als regel opgemaakt om hieronder te
   plakken. Vertaal alleen wat vaste tekst is; wat uit Logic4 of uit een lijst
   komt hoort er niet in.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var SLEUTEL = "fp.taal";
  var doc = global.document;
  if (!doc) return;

  function huidig() {
    try { return localStorage.getItem(SLEUTEL) === "en" ? "en" : "nl"; }
    catch (e) { return "nl"; }
  }
  function zet(t) {
    try { localStorage.setItem(SLEUTEL, t === "en" ? "en" : "nl"); } catch (e) {}
    // Terugvertalen is een bron van fouten: dan moet je van elk stukje tekst
    // onthouden wat het was. Opnieuw laden is eenvoudiger en niet merkbaar,
    // want alle tegels komen uit de cache op deze computer.
    location.reload();
  }

  /* ─── De woordenlijst ───────────────────────────────────────────────────
     Sleutel = de Nederlandse tekst zoals hij op het scherm staat. Regeleindes
     en dubbele spaties worden bij het zoeken weggehaald, dus je mag alles op
     één regel zetten ook als het in de HTML over drie regels loopt.

     Alleen hele stukken tekst. Losse woorden vervangen binnen een zin geeft
     kromme Engelse zinnen, en erger: het raakt ook gegevens. */
  var EN = {
    // ── Overal: knoppen, kolommen en woorden die in elke tegel terugkomen ──
    "← Dashboard": "← Dashboard",
    "Uitloggen": "Log out",
    "Inloggen": "Log in",
    "Wachtwoord": "Password",
    "Openen": "Open",
    "Bewaren": "Save",
    "Opslaan": "Save",
    "Annuleren": "Cancel",
    "Verwijderen": "Delete",
    "Dupliceren": "Duplicate",
    "+ Nieuw": "+ New",
    "Zoeken": "Search",
    "Sluiten": "Close",
    "Vernieuwen": "Refresh",
    "Bestand kiezen": "Choose file",
    "Bestanden kiezen": "Choose files",
    "Nog geen bestand gekozen": "No file chosen",
    "Model": "Model",
    "Modellen": "Models",
    "Code": "Code",
    "Fabriek": "Factory",
    "Aantal": "Quantity",
    "Datum": "Date",
    "Klant": "Customer",
    "Status": "Status",
    "Totaal": "Total",
    "Gewicht": "Weight",
    "Volume": "Volume",
    "Opmerking": "Note",
    "Ingelogd als": "Signed in as",
    "Niets gevonden.": "Nothing found.",
    "Geen model gevonden.": "No model found.",
    "Geen toegang tot deze tegel.": "You do not have access to this tile.",

    // ── Dashboard: inloggen ───────────────────────────────────────────────
    "Dashboard": "Dashboard",
    "Logic4-gebruikersnaam": "Logic4 username",
    "bv. fonteyn.don of jij@fonteyn.nl": "e.g. fonteyn.don or you@fonteyn.nl",
    "Blijf ingelogd op deze computer": "Stay signed in on this computer",
    "Helper-server checken…": "Checking helper server…",
    "Voer het wachtwoord in om verder te gaan.": "Enter the password to continue.",
    "Welkom": "Welcome",
    "Kies een tool om mee aan de slag te gaan.": "Pick a tool to get started.",

    // ── Dashboard: groepen ────────────────────────────────────────────────
    "Logistiek": "Logistics",
    "Spa's": "Spas",
    "Marketing": "Marketing",
    "Financiën": "Finance",
    "Overig": "Other",
    "Goederenstroom: papieren, binnenkomst, transport en retouren.":
      "Goods flow: paperwork, inbound, transport and returns.",
    "Alles rond Passion Spas: voorraad, partners en de Amerikaanse vestiging.":
      "Everything to do with Passion Spas: stock, partners and the US branch.",
    "Documenten en drukwerk in de huisstijl.": "Documents and print work in the house style.",
    "Betalingen, facturen en cijfers.": "Payments, invoices and figures.",
    "Verkoop, personeel, park en beheer.": "Sales, staff, park and administration.",

    // ── Dashboard: de tegels ──────────────────────────────────────────────
    "Douanepapieren": "Customs documents",
    "Genereer douanepapieren voor Fonteyn en Passion Spa's op basis van een Logic4-order.":
      "Generate customs documents for Fonteyn and Passion Spas from a Logic4 order.",
    "Inkomende goederen": "Inbound goods",
    "Upload een inkooporder en print in één keer alle A6-labels voor binnenkomende dozen.":
      "Upload a purchase order and print all A6 labels for inbound boxes in one go.",
    "Transport laden": "Loading transport",
    "Slim inlaadplan voor eigen vervoer of pakketdienst — bin-packing in de bakwagen + routeplanning per dag.":
      "Smart loading plan for own transport or parcel service - bin packing in the box truck plus daily route planning.",
    "Retouren": "Returns",
    "Welke retouren komen er binnen en waarom — op te halen retouren uit Logic4, reden + locatie registreren, en cijfers per dag/week/maand/jaar met cirkeldiagram.":
      "Which returns are coming in and why - returns to collect from Logic4, register reason and location, and figures per day, week, month and year with a pie chart.",
    "Prijslijst maken": "Create price list",
    "Upload een leveranciers-invoice of -catalogus en genereer in één klik een prijslijst in Fonteyn- of Passion-huisstijl.":
      "Upload a supplier invoice or catalogue and generate a price list in Fonteyn or Passion house style in one click.",

    "Voorraadbeheer": "Stock management",
    "Verkochte spa-orders van een dag ophalen uit Logic4, splitsen naar Dealer/Particulier en reserveringen bijhouden — met filteren op elke kolom.":
      "Fetch a day's sold spa orders from Logic4, split them into dealer and private, and track reservations - with filtering on every column.",
    "Amerika": "United States",
    "Passion Spas USA (Houston, Texas) — bestellingen, reserveringen en containers van de Amerikaanse vestiging. Draait op QuickBooks; los van Nederland/Logic4.":
      "Passion Spas USA (Houston, Texas) - orders, reservations and containers of the US branch. Runs on QuickBooks, separate from the Netherlands and Logic4.",
    "Container laden": "Container loading",
    "Klik de modellen aan die mee moeten en zie meteen hoeveel spa's er in een container passen - inclusief de indeling in 3D.":
      "Select the models to ship and see straight away how many spas fit in a container - including the 3D layout.",
    "Passion Partners Beheer": "Passion Partners admin",
    "Beheer het partner-webportaal: welke partners kunnen inloggen, welke specsheets ze zien, en waar hun vragen binnenkomen.":
      "Manage the partner web portal: which partners can sign in, which spec sheets they see, and where their questions arrive.",
    "Passion Partners": "Passion Partners",
    "Open het portaal zoals de dealers het zien — voorraad, documenten en reserveringen. Opent in je browser.":
      "Open the portal the way dealers see it - stock, documents and reservations. Opens in your browser.",
    "Partner-activiteit": "Partner activity",
    "Wat doen dealers op Passion Partners? Wie logt wanneer in, welke reserveringen, documenten en vragen. Zo zie je hoe het portaal leeft.":
      "What are dealers doing on Passion Partners? Who signs in when, which reservations, documents and questions. It shows how the portal is being used.",

    "Specificatiesheets": "Specification sheets",
    "Maak en bewerk de specificatiesheets van de spa's — vul de velden in, upload foto's en sla op als PDF. Geen InDesign meer nodig.":
      "Create and edit the spa specification sheets - fill in the fields, upload photos and save as PDF. No more InDesign.",
    "Prijslijsten fabrikanten": "Manufacturer price lists",
    "Alle prijsafspraken met leveranciers en fabrieken op één plek. Per leverancier een map, met de prijslijst erin — en de oude versies blijven bewaard.":
      "All price agreements with suppliers and factories in one place. A folder per supplier with the price list in it - and older versions are kept.",

    "Bankkoppeling maken": "Bank reconciliation",
    "Upload een MT940-bankafschrift en koppel binnenkomende betalingen automatisch aan de juiste Logic4-orders.":
      "Upload an MT940 bank statement and match incoming payments to the right Logic4 orders automatically.",
    "Bol.com koppeling": "Bol.com link",
    "Upload de maandelijkse Bol-factuur en genereer in één klik een memoriaal-voorstel voor in Logic4 — credit-regels per klant + verkoopprovisie + overschrijving.":
      "Upload the monthly Bol invoice and generate a journal entry proposal for Logic4 in one click - credit lines per customer, sales commission and the transfer.",
    "Geld-goederenbeweging": "Cash and goods flow",
    "Controleert of de keten inkoop → voorraad → verkoop → factuur → bank echt sluit, en laat precies zien welke orders, artikelen en facturen hem breken.":
      "Checks whether the chain purchase → stock → sales → invoice → bank really reconciles, and shows exactly which orders, items and invoices break it.",
    "Stuurcijfers": "Management figures",
    "Financiële stuurcijfers en analyses op basis van het Logic4-grootboek — direct inzicht in waar je op moet sturen.":
      "Financial management figures and analyses from the Logic4 general ledger - immediate insight into what needs steering.",

    "Orderstatus": "Order status",
    "Controleer en update de status van betaalde orders in Logic4.":
      "Check and update the status of paid orders in Logic4.",
    "Rapportage": "Reporting",
    "Omzet, jaartarget, aantallen en vergelijking met vorig jaar. Plus reviews per adviseur (Google, Trustpilot, Klantenvertellen) met toewijzing-workflow.":
      "Revenue, annual target, volumes and comparison with last year. Plus reviews per advisor (Google, Trustpilot, Klantenvertellen) with an assignment workflow.",
    "Personeel": "Staff",
    "Buitenlandse medewerkers — gegevens, kamerverdeling Eikensingel en woensdag-vluchten in één overzicht.":
      "Foreign staff - details, room allocation at Eikensingel and Wednesday flights in one overview.",
    "Eikensingel": "Eikensingel",
    "Bovenaanzicht van de 10 bungalows op het vakantiepark — boekingen, schoonmaak en betaling in één oogopslag.":
      "Top view of the 10 bungalows at the holiday park - bookings, cleaning and payment at a glance.",
    "Activiteitenlogboek": "Activity log",
    "Wie logt wanneer in en welke tegels worden gebruikt. Controleer of iedereen zijn dagelijkse werk in het dashboard doet.":
      "Who signs in when and which tiles are used. Check that everyone does their daily work in the dashboard.",
    "Koeien bij Dolf": "Dolf's cattle",
    "Interactief overzicht van Dolfs koeien — status, stamboom en aantekeningen, centraal opgeslagen voor Dolf en Gerrit.":
      "Interactive overview of Dolf's cattle - status, pedigree and notes, stored centrally for Dolf and Gerrit.",
    "Logic4-probe": "Logic4 probe",
    "Diagnose-pagina: test welke Logic4 API-endpoints toegankelijk zijn. Alleen voor admin-gebruik.":
      "Diagnostics page: tests which Logic4 API endpoints are reachable. Admin use only.",

    // ── Container laden ───────────────────────────────────────────────────
    "🚢 Container laden": "🚢 Container loading",
    "Klik de modellen aan die mee moeten en zie meteen hoeveel spa's er in een container passen. De maten komen uit de prijslijsten, de kistmaten en de specificatiesheets - en wat je hier zelf invult gaat daar overheen en geldt meteen in elke tegel die met maten rekent.":
      "Select the models to ship and see straight away how many spas fit in a container. The sizes come from the price lists, the crate sizes and the specification sheets - and whatever you enter here overrides those and applies immediately in every tile that works with sizes.",
    "Container": "Container",
    "Ruimte ernaast (cm)": "Clearance beside (cm)",
    "Alleen naast en achter de spa. Bovenop niet: spa's staan op elkaar.":
      "Beside and behind the spa only. Not on top: spas stack directly on each other.",
    "Spa's mogen op hun kant": "Spas may go on their side",
    "Covers meeladen": "Include covers",
    "Elke spa gaat met zijn cover mee. Die is dubbelgevouwen en neemt ook plek in.":
      "Every spa ships with its cover. It is folded double and takes up space too.",
    "Alles weghalen": "Clear all",
    "🖨 Printen / PDF": "🖨 Print / PDF",
    "Zoek op modelnaam of fabriekscode…": "Search by model name or factory code…",
    "Achter elk model staat hoeveel er van dát model alleen in de gekozen container gaan. Klik op de regel om er één toe te voegen. Klopt een maat niet? Met ✏ pas je hem aan; dat geldt dan overal, ook in de voorraadwaardering van Amerika.":
      "Behind each model is how many of that model alone fit in the selected container. Click the row to add one. Is a size wrong? Change it with ✏ - that applies everywhere, including the stock valuation for the United States.",
    "per container": "per container",
    "eentje minder": "one less",
    "eentje erbij": "one more",
    "Maat aanpassen": "Change size",
    "Maat invullen": "Enter size",
    "spa's": "spas",
    "covers": "covers",
    "gevuld": "filled",
    "model(len)": "model(s)",
    "Wat er in staat": "What is inside",
    "spa's gekozen": "spas selected",
    "container": "container",
    "containers": "containers",
    "volume van de spa's": "volume of the spas",
    "volume, spa's en covers": "volume, spas and covers",
    "gevuld, eerste container": "filled, first container",
    "geen cover": "no cover",
    "Dit model heeft geen cover": "This model has no cover",
    "zelf ingevuld": "entered manually",
    "specsheet": "spec sheet",
    "kistmaat": "crate size",
    "Maat van de specificatiesheet, niet van de prijslijst":
      "Size from the specification sheet, not from the price list",
    "Maat van de kist zoals hij vervoerd wordt, uit Maten + gewichten":
      "Size of the crate as it ships, from Maten + gewichten",
    "Hier zelf ingevuld; gaat voor alle lijsten": "Entered here; overrides every list",
    "Van alle modellen is de maat bekend": "The size of every model is known",
    "Er staat niets meer open.": "Nothing is outstanding.",
    "Van deze modellen staat geen maat op de prijslijst, de verpakkingslijst of een specificatiesheet. Weet je de maat, vul hem dan in: hij wordt centraal bewaard en geldt meteen voor iedereen, ook in de voorraadwaardering van Amerika.":
      "For these models there is no size on the price list, the packing list or a specification sheet. If you know the size, enter it: it is stored centrally and applies to everyone straight away, including the stock valuation for the United States.",
    "Ontbrekende maten opzoeken in Logic4": "Look up missing sizes in Logic4",
    "De maten hierboven komen uit de prijslijsten, de verpakkingslijst en de specificatiesheets. Wat daar niet in staat, staat misschien wel in Logic4 bij het artikel zelf. Deze knop zoekt dat op onder jouw eigen Logic4-login en laat zien wát hij vindt - er wordt niets automatisch overgenomen, want een maat die nergens op slaat is erger dan geen maat.":
      "The sizes above come from the price lists, the packing list and the specification sheets. Anything not in those may still be on the item in Logic4. This button looks that up under your own Logic4 login and shows what it finds - nothing is taken over automatically, because a size that makes no sense is worse than no size at all.",
    "🔎 Zoeken in Logic4": "🔎 Search in Logic4",
    "Lengte (cm)": "Length (cm)",
    "Breedte (cm)": "Width (cm)",
    "Hoogte (cm)": "Height (cm)",
    "Cover lengte (cm)": "Cover length (cm)",
    "Cover breedte (cm)": "Cover width (cm)",
    "De maat van de spa zoals hij in de container gaat, in hele centimeters. De ruimte om hem heen regelt het dashboard zelf.":
      "The size of the spa as it goes into the container, in whole centimetres. The dashboard handles the clearance around it.",
    "Terug naar automatisch": "Back to automatic",
    "zonder naam": "no name",
    "Vul alle drie de maten in, in centimeters.": "Fill in all three sizes, in centimetres.",
    "Deze tegel is voor inkoop en logistiek.": "This tile is for purchasing and logistics.",
  };

  /* ─── Patronen ──────────────────────────────────────────────────────────
     Voor tekst die een tegel zelf in elkaar zet met getallen erin. Bewust een
     korte lijst: elk patroon is een uitzondering die je zelf hebt bedacht, en
     niet een net waar van alles in blijft hangen. */
  var PATRONEN = [
    [/^Dubbelgevouwen cover, (.+) open, zelf ingevuld$/, "Folded cover, $1 open, entered manually"],
    [/^Dubbelgevouwen cover, (.+) open$/, "Folded cover, $1 open"],
    [/^cover (.+)$/, "cover $1"],
    [/^🚢 Container (\d+) · (.+)$/, "🚢 Container $1 · $2"],
    [/^Container (\d+)$/, "Container $1"],
    [/^\+ (\d+) covers?$/, "+ $1 covers"],
    [/^(\d+) ft standaard · (.+)$/, "$1 ft standard · $2"],
    [/^(\d+) modellen zonder afmeting - vul ze hier in$/, "$1 models without a size - enter them here"],
    [/^(\d+) van de (\d+) regels$/, "$1 of $2 rows"],
  ];

  var ontbreekt = {};   // wat er nog geen vertaling heeft, voor het aanvullen

  function viaPatroon(kern) {
    for (var i = 0; i < PATRONEN.length; i++) {
      if (PATRONEN[i][0].test(kern)) return kern.replace(PATRONEN[i][0], PATRONEN[i][1]);
    }
    return null;
  }

  function vertaalTekst(s) {
    var kaal = String(s == null ? "" : s);
    var kern = kaal.trim().replace(/\s+/g, " ");
    if (!kern) return null;
    // Zonder letters valt er niets te vertalen: getallen, bedragen, leestekens.
    if (!/[a-zA-Z]/.test(kern)) return null;
    var naar = Object.prototype.hasOwnProperty.call(EN, kern) ? EN[kern] : viaPatroon(kern);
    if (naar == null) { ontbreekt[kern] = (ontbreekt[kern] || 0) + 1; return null; }
    // De spatie vóór en ná behouden, anders plakken woorden aan elkaar.
    return kaal.match(/^\s*/)[0] + naar + kaal.match(/\s*$/)[0];
  }

  // Waar we van afblijven. Scripts en stijlen spreken voor zich; invoervelden
  // houden hun waarde omdat daar getypte gegevens in staan, en een element met
  // class="geen-vertaling" is met opzet met rust gelaten.
  var OVERSLAAN = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1 };
  function magNiet(node) {
    for (var el = node.parentNode; el && el.nodeType === 1; el = el.parentNode) {
      if (OVERSLAAN[el.tagName]) return true;
      if (el.classList && el.classList.contains("geen-vertaling")) return true;
    }
    return false;
  }

  var ATTRIBUTEN = ["placeholder", "title", "aria-label"];

  function loop(wortel) {
    if (!wortel || wortel.nodeType !== 1) return;

    var w = doc.createTreeWalker(wortel, NodeFilter.SHOW_TEXT, null);
    var raak = [], n;
    while ((n = w.nextNode())) if (!magNiet(n)) raak.push(n);
    for (var i = 0; i < raak.length; i++) {
      var uit = vertaalTekst(raak[i].nodeValue);
      if (uit != null) raak[i].nodeValue = uit;
    }

    var alles = wortel.querySelectorAll("*");
    for (var j = -1; j < alles.length; j++) {
      var e = j < 0 ? wortel : alles[j];
      if (!e.hasAttribute) continue;
      if (e.classList && e.classList.contains("geen-vertaling")) continue;
      for (var a = 0; a < ATTRIBUTEN.length; a++) {
        if (!e.hasAttribute(ATTRIBUTEN[a])) continue;
        var v = vertaalTekst(e.getAttribute(ATTRIBUTEN[a]));
        if (v != null) e.setAttribute(ATTRIBUTEN[a], v);
      }
      // De opschriften ván knoppen, niet de inhoud van invoervelden.
      if (e.tagName === "INPUT" && /^(button|submit|reset)$/i.test(e.type || "") && e.value) {
        var bv = vertaalTekst(e.value);
        if (bv != null) e.value = bv;
      }
    }
  }

  /* ─── De knop ────────────────────────────────────────────────────────────
     Komt in de kop van elke tegel te staan, links van Uitloggen. Zichzelf
     toevoegen betekent dat er geen enkele tegel vergeten kan worden. */
  function knop() {
    var kop = doc.querySelector("header");
    if (!kop || doc.getElementById("fpTaalKnop")) return;
    var st = doc.createElement("style");
    st.textContent =
      "#fpTaalKnop{background:transparent;border:1px solid rgba(255,255,255,.4);border-radius:7px;" +
        "padding:4px 3px;font:inherit;font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;gap:2px;line-height:1}" +
      "#fpTaalKnop span{padding:3px 6px;border-radius:5px;color:#fff;opacity:.55}" +
      "#fpTaalKnop span.aan{background:#fff;color:#111;opacity:1}" +
      "#fpTaalKnop:hover{background:rgba(255,255,255,.15)}";
    doc.head.appendChild(st);

    var b = doc.createElement("button");
    b.id = "fpTaalKnop";
    b.type = "button";
    b.className = "geen-vertaling";
    b.title = huidig() === "en" ? "Switch to Dutch" : "Schakel over naar Engels";
    b.innerHTML = "<span class='" + (huidig() === "nl" ? "aan" : "") + "'>NL</span>" +
                  "<span class='" + (huidig() === "en" ? "aan" : "") + "'>EN</span>";
    b.addEventListener("click", function () {
      var naar = huidig() === "en" ? "nl" : "en";
      try { if (global.fpLog) global.fpLog("taal-gewisseld", naar); } catch (e) {}
      zet(naar);
    });

    var uit = kop.querySelector("button.logout");
    if (uit && uit.parentNode === kop) kop.insertBefore(b, uit);
    else kop.appendChild(b);
  }

  function start() {
    knop();
    if (huidig() !== "en") return;
    doc.documentElement.setAttribute("lang", "en");
    loop(doc.body);
    // De tegels bouwen hun tabellen en vensters pas na het laden op, dus wat
    // erbij komt moet ook langs de woordenlijst.
    var gepland = false;
    new MutationObserver(function () {
      if (gepland) return;
      gepland = true;
      requestAnimationFrame(function () { gepland = false; loop(doc.body); });
    }).observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
  else start();

  // Voor het aanvullen van de woordenlijst: geeft terug wat er nog geen
  // vertaling heeft, meest voorkomend eerst, al opgemaakt als regel.
  global.fpTaalOntbreekt = function () {
    return Object.keys(ontbreekt)
      .sort(function (a, b) { return ontbreekt[b] - ontbreekt[a]; })
      .map(function (k) { return JSON.stringify(k) + ": " + JSON.stringify(k) + ","; });
  };
  global.fpTaal = { huidig: huidig, zet: zet, woorden: EN, patronen: PATRONEN };

})(typeof window !== "undefined" ? window : globalThis);
