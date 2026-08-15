/* ═══════════════════════════════════════════════════════════════════════════
   TEGELS — welke tegels er zijn, en wie ze mag zien
   ═══════════════════════════════════════════════════════════════════════════

   Waarom dit bestand bestaat
   --------------------------
   toegang.js zegt wie in welke groep zit. Dit bestand zegt welke tegel bij
   welke groep hoort. Dat stond tot nu toe alleen in dashboard.html, als
   vijfentwintig losse regels van het type

       el("tileBol").classList.toggle("hidden", !BOL_EMAILS.has(lc));

   en dat werkt prima zolang er één dashboard is. Nu is er ook een dashboard
   voor de telefoon, en twee lijsten lopen uit elkaar. Precies dat gebeurde
   eerder al met de toegangslijsten zelf (zie de kop van toegang.js) en het
   kostte twee rondes voor één naam.

   Gerrit, 14 aug 2026: "ik wil dat de rechten hetzelfde zijn als op de
   desktop (dat mag sowieso nooit verschillen)."

   Dus: één lijst. De telefoon bouwt zijn tegels hieruit op, en tools/
   tegels-gelijk.mjs controleert dat dashboard.html precies dezelfde koppeling
   tegel-naar-groep gebruikt. Wijkt er iets af, dan valt die controle om.

   Een tegel toevoegen
   -------------------
   Regel erbij met bestand, groep, naam en icoon. De groep moet in toegang.js
   bestaan. Zet mobiel op false als de tegel op een telefoon niets te zoeken
   heeft; hij blijft dan gewoon op de pc staan.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  /* mobiel:
       "goed"  - werkt nu al op een telefoon, staat gewoon in de lijst
       "krap"  - werkt, maar is breed; je moet schuiven of draaien
       "pc"    - alleen zinvol achter een bureau; op de telefoon met een
                 waarschuwing erbij, want verbergen zou betekenen dat de
                 telefoon andere rechten heeft dan de pc en dat mag niet.
     extern: opent buiten het dashboard (nieuw tabblad), niet uit de repo. */
  var TEGELS = [
    { bestand:"mail.html",           groep:"mail",             ic:"✉️",  naam:"Mijn mail",
      uit:"Postvak, concepten en verzenden",                       mobiel:"goed", tile:"tileMail" },
    { bestand:"tuinmeubelen.html",   groep:"tuinmeubelen",     ic:"🪑",  naam:"Tuinmeubelen",
      uit:"Containers, papieren en meldingen",                     mobiel:"goed", tile:"tileTuinmeubelen" },
    { bestand:"order-status.html",   groep:"orderstatus",      ic:"📊",  naam:"Orderstatus",
      uit:"Een order opzoeken en de status bijwerken",             mobiel:"goed", tile:"tileOrderStatus" },
    { bestand:"specsheets.html",     groep:"specsheets",       ic:"📄",  naam:"Specificatiesheets",
      uit:"Specsheets maken en opzoeken",                          mobiel:"krap", tile:"tileSpecsheets" },
    { bestand:"retouren.html",       groep:"retouren",         ic:"↩️",  naam:"Retouren",
      uit:"Retour-registratie per order",                          mobiel:"krap", tile:"tileRetouren" },
    { bestand:"container-laden.html",groep:"containerladen",   ic:"🚢",  naam:"Container laden",
      uit:"Wat er in welke container gaat",                        mobiel:"goed", tile:"tileContainerLaden" },
    { bestand:"mollie.html",         groep:"mollie",           ic:"🟣",  naam:"Mollie",
      uit:"Mollie-betalingen boeken",                              mobiel:"krap", tile:"tileMollie" },
    { bestand:"prijslijsten-fabrikanten.html", groep:"prijslijsten", ic:"🗂️", naam:"Prijslijsten fabrikanten",
      uit:"Inkoopprijslijsten van de fabrieken",                   mobiel:"krap", tile:"tilePrijslijstenFab" },
    { bestand:"partneractiviteit.html", groep:"partneractiviteit", ic:"📡", naam:"Partner-activiteit",
      uit:"Wat dealers in het portaal doen",                       mobiel:"krap", tile:"tilePartnerActiviteit" },
    { bestand:"koeien.html",         groep:"koeien",           ic:"🐄",  naam:"Koeien bij Dolf",
      uit:"De koeienadministratie",                                mobiel:"krap", tile:"tileKoeien" },
    { bestand:"eikensingel.html",    groep:"eikensingel",      ic:"🏡",  naam:"Eikensingel",
      uit:"Boekingen en agenda van de huizen",                     mobiel:"krap", tile:"tileEikensingel" },
    { bestand:"labels.html",         groep:"papieren",         ic:"🏷️",  naam:"Inkomende goederen",
      uit:"Labels maken uit een inkooporder",                      mobiel:"krap", tile:"tileLabels" },
    { bestand:"transport.html",      groep:"logistiek",        ic:"🚚",  naam:"Transport laden",
      uit:"Ritten en ladingen",                                    mobiel:"krap", tile:"tileTransport" },
    { bestand:"rapportage.html",     groep:"rapportage",       ic:"📈",  naam:"Rapportage",
      uit:"Cijfers per afdeling",                                  mobiel:"krap", tile:"tileRapportage" },
    { bestand:"activiteit.html",     groep:"activiteit",       ic:"📋",  naam:"Activiteitenlogboek",
      uit:"Wie wat heeft gedaan",                                  mobiel:"krap", tile:"tileActiviteit" },
    { bestand:"personeel.html",      groep:"personeel",        ic:"👥",  naam:"Personeel",
      uit:"Personeelsgegevens",                                    mobiel:"pc", tile:"tilePersoneel" },
    { bestand:"bankkoppeling.html",  groep:"bankkoppeling",    ic:"🏦",  naam:"Bankkoppeling maken",
      uit:"Bankafschrift inlezen en boeken",                       mobiel:"pc", tile:"tileBankkoppeling" },
    { bestand:"geldgoederen.html",   groep:"geldgoederen",     ic:"⛓️",  naam:"Geld-goederenbeweging",
      uit:"De financiële keten van inkoop tot omzet",              mobiel:"pc", tile:"tileGeldGoederen" },
    { bestand:"bol.html",            groep:"bol",              ic:"🛒",  naam:"Bol.com koppeling",
      uit:"Bol-orders en boekingen",                               mobiel:"pc", tile:"tileBol" },
    { bestand:"dealerportaal.html",  groep:"dealerportaal",    ic:"🤝",  naam:"Partnerportaal beheren",
      uit:"Dealers, documenten en aanvragen",                      mobiel:"pc", tile:"tileDealerportaal" },
    { bestand:"amerika.html",        groep:"amerika",          ic:"🇺🇸",  naam:"Amerika",
      uit:"Houston: facturen, voorraad en QuickBooks",             mobiel:"pc", tile:"tileAmerika" },
    { bestand:"douane.html",         groep:"papieren",         ic:"📄",  naam:"Douanepapieren",
      uit:"Douanedocumenten maken",                                mobiel:"pc", tile:"tileDouane" },
    { bestand:"voorraad.html",       groep:"voorraad",         ic:"📦",  naam:"Voorraadbeheer",
      uit:"Containers, reserveringen, ontvangst en inkoop",        mobiel:"pc", tile:"tileVoorraad" },
    { bestand:"probe-logic4.html",   groep:"probe",            ic:"🔬",  naam:"Logic4-probe",
      uit:"Rechtstreeks een Logic4-endpoint bevragen",             mobiel:"pc", tile:"tileProbe" },

    /* Twee buitenbeentjes. Stuurcijfers vraagt na het klikken een extra
       wachtwoord en zit daarom in dashboard.html aan een eigen scherm vast;
       Passion Partners is het dealerportaal zelf en opent buiten het
       dashboard. Allebei niet naar de telefoon. */
    { bestand:"stuurcijfers.html",   groep:"stuurcijfers",     ic:"📊",  naam:"Stuurcijfers",
      uit:"Financiële stuurcijfers", mobiel:"pc", extraWachtwoord:true,
      /* Deze tegel heeft in dashboard.html href="#" - er komt eerst een
         wachtwoordscherm. Op de bestandsnaam koppelen kan dus niet; de
         controle in tools/tegels-gelijk.mjs gebruikt deze id. */
      tile:"tileStuurcijfers" },
    { bestand:"https://fonteyn-data-store.g-mulder.workers.dev/dealers",
      groep:"partnerportaal-kijk", ic:"🌐", naam:"Passion Partners",
      uit:"Het portaal zoals een dealer het ziet", mobiel:"pc", tile:"tilePassionPartners", extern:true },
  ];

  /* Welke tegels mag deze persoon zien. Eén regel, en precies dezelfde regel
     op de pc als op de telefoon - dat is de hele bedoeling van dit bestand. */
  function voor(wie, opties) {
    var o = opties || {};
    var t = global.fpToegang;
    if (!t) return [];
    var lijst = TEGELS.filter(function (x) { return t.mag(x.groep, wie); });
    if (o.alleenMobiel) lijst = lijst.filter(function (x) { return !x.extern; });
    return lijst;
  }

  global.fpTegels = { lijst: TEGELS, voor: voor };

})(typeof window !== "undefined" ? window : globalThis);
