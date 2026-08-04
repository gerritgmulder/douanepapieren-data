/* ═══════════════════════════════════════════════════════════════════════════
   SPA-FABRIKANTEN — wie maakt wat, onder welke code, voor welke prijs
   ═══════════════════════════════════════════════════════════════════════════

   Waarom
   ------
   Tot 4 aug 2026 kende het dashboard alleen de codes van Jazzi. Toen Chantal
   een commercial invoice van Guangdong Kasdaly uploadde gebeurde er niets: de
   codes JY8603 en JY8805 zeiden het systeem niets. Zij heeft daarop de
   codelijsten van vier fabrieken opgevraagd.

   De codes zelf staan in spa-codes.js, want die worden gebruikt om invoices te
   lezen. Hier staat de rest: van welke fabriek een model komt, onder welke
   merknaam, wie de contactpersoon is en wat de prijzen zijn. Dat hoort bij
   elkaar en Chantal moet het kunnen nakijken zonder in de code te duiken —
   vandaar dat de tegel het toont.

   De prijzen komen van de prijsbladen die Chantal per fabriek heeft
   gefotografeerd. Waar de foto niet leesbaar was staat het bedrag op null in
   plaats van op een gok.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var FABRIKANTEN = [
    {
      fabriek: "Guangdong Kasdaly Pool Spa Equipment",
      merk: "Grizzly Spas",
      contact: "Yuri Yu", email: "Vigor@joyspa.com",
      bron: "prijsblad Chantal, 4 aug 2026",
      modellen: [
        { model: "Kenai",     code: "JY8805", inkoopUsd: 2378, verkoopEur: 4490 },
        { model: "Kodiak",    code: "JY8810", inkoopUsd: 2846, verkoopEur: 6990 },
        { model: "Calgary",   code: "JY8603", inkoopUsd: 5422, verkoopEur: 14500 },
        { model: "Vancouver", code: "JY8602", inkoopUsd: 7324, verkoopEur: 17500 },
        { model: "Anchorage", code: "JY8601", inkoopUsd: 7724, verkoopEur: 18900 },
      ],
    },
    {
      fabriek: "Guangzhou Huantong Industry Co. LTD",
      merk: "Tropic Spas / Lovia spas",
      contact: "Joe", email: "yw18@ispas.cn",
      opmerking: "Kleur: Sterling White with Grey.",
      bron: "prijsblad Chantal, 4 aug 2026",
      modellen: [
        { model: "Aruba",     code: "ZR7011", inkoopUsd: 1710, verkoopEur: null },
        { model: "Bermuda",   code: "ZR6005", inkoopUsd: 2196, verkoopEur: null },
        { model: "Jamaica",   code: "ZR6006", inkoopUsd: 1800, verkoopEur: null },
        { model: "Montego",   code: "ZR801",  inkoopUsd: 2160, verkoopEur: null },
        { model: "Key Largo", code: "ZR803",  inkoopUsd: 2075, verkoopEur: null },
        { model: "Bahamas",   code: "ZR804",  inkoopUsd: 1980, verkoopEur: null },
      ],
    },
    {
      fabriek: "Guangzhou New Normal Bath Ware Co.",
      merk: "Sea star spas",
      contact: null, email: null,
      opmerking: "Twee reeksen: Luxury range en Superior range.",
      bron: "prijsblad Chantal, 4 aug 2026",
      modellen: [
        { model: "Spa Hope",    code: "EX-180", reeks: "Luxury",   inkoopUsd: 1522, verkoopEur: null },
        { model: "Spa Believe", code: "EX-155", reeks: "Luxury",   inkoopUsd: 1470, verkoopEur: null },
        { model: "Spa Wonder",  code: "ET-160", reeks: "Superior", inkoopUsd: 1948, verkoopEur: null },
        { model: "Spa Miracle", code: "S-1501", reeks: "Superior", inkoopUsd: 1942, verkoopEur: null },
        { model: "Spa Vision",  code: "S-2202", reeks: "Superior", inkoopUsd: 2073, verkoopEur: null },
        { model: "Spa Praise",  code: "ET-165", reeks: "Classic",  inkoopUsd: 1522, verkoopEur: null },
      ],
    },
    {
      fabriek: "Foshan Gaoming Yuehua Sanitary (MEXDA)",
      merk: "Storm Spas",
      contact: "Boey Deng", email: "angus4a@china-yuehua.com",
      opmerking: "Alle spa's solid white with grey. Op dit blad stonden geen prijzen.",
      bron: "codelijst Chantal, 4 aug 2026",
      modellen: [
        { model: "Turbine 5",  code: "WS-PC05ST", inkoopUsd: null, verkoopEur: null },
        { model: "Turbine 6",  code: "WS-PC06ST", inkoopUsd: null, verkoopEur: null },
        { model: "Turbine 7",  code: "WS-PC07ST", inkoopUsd: null, verkoopEur: null },
        { model: "Aquatic 9",  code: "WS-S06",    inkoopUsd: null, verkoopEur: null },
        { model: "Monsoon",    code: "WS-692",    inkoopUsd: null, verkoopEur: null },
        { model: "Cyclone",    code: "WS-696",    inkoopUsd: null, verkoopEur: null },
        { model: "Hurricane",  code: "WS-506M",   inkoopUsd: null, verkoopEur: null,
          let: "Met de hand bijgeschreven op het blad." },
      ],
    },
  ];

  // De met de hand bijgeschreven regel op het blad van Sea star spas las ik als
  // "tt165"; Chantal bevestigde dat het ET-165 is (4 aug 2026). Dat het bedrag
  // gelijk is aan dat van Spa Hope is dus toeval, geen dubbele aantekening.
  var ONDUIDELIJK = [];

  global.fpFabrikanten = { lijst: FABRIKANTEN, onduidelijk: ONDUIDELIJK };

})(typeof window !== "undefined" ? window : globalThis);
