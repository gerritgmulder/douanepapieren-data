/* ═══════════════════════════════════════════════════════════════════════════
   TOEGANG — wie mag welke tegel zien
   ═══════════════════════════════════════════════════════════════════════════

   Waarom dit bestand bestaat
   --------------------------
   Tot 12 aug 2026 stond elke lijst met namen twee keer: één keer in
   dashboard.html (bepaalt of je de tegel ziet) en één keer boven in de tegel
   zelf (bepaalt of je er in mag). Die tweede controle is nodig — met de
   terug-knop kom je anders op een pagina die iemand anders had openstaan —
   maar twee lijsten lopen uit elkaar.

   En dat gebeurde ook. Nomi kreeg toegang tot drie tegels, zag ze niet, en na
   de reparatie nog steeds niet: de tegels noemden hun lijst niet allemaal
   hetzelfde (TOEGANG in de ene, ALLOWED in de andere), dus de controle op
   "staat ze overal in?" liep er langs. Twee rondes voor één naam.

   Nu staat het hier, één keer. Iemand toegang geven is één naam bijschrijven
   in de juiste groep hieronder.

   Hoe een naam werkt
   ------------------
   Iemand kan op drie manieren ingelogd zijn, afhankelijk van hoe Logic4 het
   account kent: "nomi@fonteyn.nl", "nomi" of "fonteyn.nomi". Die drie worden
   hieronder vanzelf gemaakt — je schrijft alleen "nomi". Wie een afwijkende
   inlognaam heeft staat in AFWIJKEND.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  /* Accounts die niet het gewone patroon volgen. Wie hier staat krijgt
     precies deze schrijfwijzen en geen andere.

     Patrick logt nog in onder zijn oude accountnaam. Bart van den Brink heet
     in Logic4 'Bart.vdB'; "bart" en "bart@fonteyn.nl" zijn daar ZZ-OUD én van
     een ándere Bart, en horen dus nergens bij. */
  var AFWIJKEND = {
    "fonteynbot": ["fonteynbot@fonteyn.nl", "fonteynbot", "fonteyn.bot"],
    "patrick":    ["fonteyn.maartens"],
  };

  function varianten(naam) {
    if (AFWIJKEND[naam]) return AFWIJKEND[naam].slice();
    return [naam + "@fonteyn.nl", naam, "fonteyn." + naam];
  }

  /* De groepen. Eén regel per tegel of groep tegels; de namen zijn de
     voornamen zoals ze in Logic4 staan. Alfabetisch, zodat je ziet of iemand
     er al in staat zonder de hele regel te lezen. */
  var GROEPEN = {
    // Activiteitenlogboek
    "activiteit": [
      "dolf", "fonteynbot", "gerrit",
    ],
    // Amerika (Houston)
    "amerika": [
      "chantal", "dolf", "fonteynbot", "gerrit", "osman",
    ],
    // Bankkoppeling maken
    "bankkoppeling": [
      "arno", "dolf", "don", "fonteynbot", "gerrit", "osman",
      "reinier", "reinier.k", "rico", "rowan",
    ],
    /* Logic4-probe. Stond niet als groep maar als losse if in dashboard.html
       ("gerrit of fonteynbot"). Nu hier, zodat de telefoon en de pc dezelfde
       regel gebruiken en er niet één van beide achterloopt. */
    "probe": [
      "fonteynbot", "gerrit",
    ],
    /* Mijn mail. Bewust smal: wie hier bij komt moet ook door de
       Exchange-beheerder in de groep Dashboard Mailboxen worden gezet,
       anders ziet hij hier niets. Twee plaatsen dus, met opzet - het
       dashboard kan geen mailbox openzetten die de mailserver dichthoudt. */
    "mail": [
      "dolf", "gerrit",
    ],
    // Bol.com koppeling
    "bol": [
      "don", "fonteynbot", "gerrit", "osman", "reinier.k",
    ],
    // Container laden
    "containerladen": [
      "arno", "chantal", "dolf", "fonteynbot", "gerrit", "manon",
    ],
    // Dealerportaal-beheer
    "dealerportaal": [
      "arno", "chantal", "don", "fonteynbot", "gerrit",
    ],
    // Eikensingel
    "eikensingel": [
      "danique", "evelinde", "fabiola", "fonteynbot", "fransje", "gerrit",
      "julia", "karina", "rosalie",
    ],
    // Geld-goederenbeweging
    "geldgoederen": [
      "dolf", "fonteynbot", "gerrit", "osman",
    ],
    // Koeien
    "koeien": [
      "dolf", "fonteynbot", "gerrit",
    ],
    // Tuinmeubelen: de containers zonder spa's. Chantal en Manon houden ze
    // bij, Arno koopt ze in.
    "tuinmeubelen": [
      "arno", "chantal", "dolf", "fonteynbot", "gerrit", "manon",
    ],
    // Transport laden en Prijslijst maken
    "logistiek": [
      "arno", "dolf", "don", "fonteynbot", "gerrit", "manon",
    ],
    // Mollie
    "mollie": [
      "dolf", "fonteynbot", "gerrit", "osman", "reinier", "reinier.k",
      "rico", "rowan",
    ],
    // Orderstatus
    "orderstatus": [
      "arno", "dolf", "don", "fonteynbot", "gerrit", "osman",
    ],
    // Douanepapieren en Inkomende goederen
    "papieren": [
      "arno", "dolf", "don", "fonteynbot", "gerrit", "manon",
      "nomi",
    ],
    // Partneractiviteit
    "partneractiviteit": [
      "arno", "chantal", "dolf", "don", "fonteynbot", "gerrit",
      "gretha",
    ],
    // Partnerportaal meekijken
    "partnerportaal-kijk": [
      /* Gerrit en Fonteynbot stonden hier niet in, terwijl zij overal bij
         horen. Dat kwam niet door de omzetting naar tegels.js - de oude regel
         keek naar precies dezelfde groep - maar het viel toen wel pas op. */
      "dolf", "fonteynbot", "gerrit", "gretha", "manon",
    ],
    // Personeel
    "personeel": [
      "arno", "chantal", "dolf", "don", "fonteynbot", "gerrit",
      "manon",
    ],
    // Prijslijsten fabrikanten
    "prijslijsten": [
      "dolf", "fonteynbot", "gerrit", "gretha",
    ],
    // Rapportage
    "rapportage": [
      "arno", "dolf", "don", "fonteynbot", "gerrit", "osman",
    ],
    // Retouren
    "retouren": [
      "arno", "dolf", "don", "fonteynbot", "gerrit", "manon",
      "nomi",
    ],
    // Specsheets
    "specsheets": [
      "demi", "fonteynbot", "gerrit", "gretha",
    ],
    // Stuurcijfers
    "stuurcijfers": [
      "dolf", "fonteynbot", "osman",
    ],
    // Voorraadbeheer
    "voorraad": [
      "ahmed", "arno", "bart.vdb", "bert", "bertjan", "chantal",
      "dali", "dolf", "edwin", "fonteynbot", "gerrit", "gerwin",
      "kevin", "luis", "manon", "patrick", "yves",
    ],
  };

  // Alle schrijfwijzen van een groep, als Set. Voor code die zelf wil kijken.
  function set(groep) {
    var uit = new Set();
    (GROEPEN[groep] || []).forEach(function (naam) {
      varianten(naam).forEach(function (s) { uit.add(s); });
    });
    return uit;
  }

  // De vraag die iedereen stelt: mag deze ingelogde gebruiker hier bij?
  function mag(groep, wie) {
    return set(groep).has(String(wie || "").toLowerCase().trim());
  }

  /* In welke groepen zit iemand? Handig om te controleren of een naam
     inderdaad overal terechtkomt waar hij hoort. */
  function groepenVan(wie) {
    var w = String(wie || "").toLowerCase().trim();
    return Object.keys(GROEPEN).filter(function (g) { return set(g).has(w); });
  }

  global.fpToegang = {
    mag: mag, set: set, varianten: varianten,
    groepen: GROEPEN, groepenVan: groepenVan,
  };

})(typeof window !== "undefined" ? window : globalThis);
