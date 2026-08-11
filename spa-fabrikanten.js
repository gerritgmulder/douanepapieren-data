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
      fabriek: "Jazzi Pool & Spa (Guangzhou)",
      merk: "Passion Spas",
      contact: null, email: null,
      bron: "prijslijst 'Updated Passion, Jazzi Confirmed Prices, European', 15-06-2026",
      opmerking: "Verreweg de grootste leverancier. Bedragen in USD - Jazzi factureert in dollars.",
      modellen: [
        { model: "Activity 1", code: "SKT339G13", inkoopUsd: 5315.66, verkoopEur: null, afmeting: "3940x2260x1260" },
        { model: "Activity 1 Deep", code: "SKT339G12", inkoopUsd: 6088.16, verkoopEur: null, afmeting: "3940x2260x1520" },
        { model: "Activity 2", code: "SKT339G15", inkoopUsd: 6396.5, verkoopEur: null, afmeting: "5490x2260x1260" },
        { model: "Activity 2 Deep", code: "SKT339G14", inkoopUsd: 7156.5, verkoopEur: null, afmeting: "5490x2260x1520" },
        { model: "Arizona", code: "SKT329A", inkoopUsd: 1921.71, verkoopEur: null, afmeting: "2000x2000x880" },
        { model: "Admire", code: "SKT888BA", inkoopUsd: 2990.51, verkoopEur: null, afmeting: "2300x2300x910" },
        { model: "Aquatic 1", code: "SKT339C", inkoopUsd: 5049.86, verkoopEur: null, afmeting: "4000x2280x1260" },
        { model: "Aquatic 1 ECO", code: "SKT339C SIMPLE PACK", inkoopUsd: 4982.91, verkoopEur: null, afmeting: "4000x2280x1260",
          let: "Zelfde kuip als de Aquatic 1, alleen andere jets - een update van hetzelfde model (Chantal, 10 aug 2026)." },
        { model: "Aquatic 2", code: "SKT339B", inkoopUsd: 6281.27, verkoopEur: null, afmeting: "6000x2230x1260" },
        { model: "Aquatic 3", code: "SKT339D", inkoopUsd: 7220.32, verkoopEur: null, afmeting: "5820x2240x1240" },
        { model: "Aquatic 3 Deep", code: "SKT339D1", inkoopUsd: 8169.98, verkoopEur: null, afmeting: "5820x2240x1560" },
        { model: "Aquatic 5", code: "SKT339E1", inkoopUsd: 8615.25, verkoopEur: null, afmeting: "5800x2280x1550" },
        { model: "Aquatic 6", code: "SKT339E2", inkoopUsd: 10742.14, verkoopEur: null, afmeting: "7800x2280x1550" },
        { model: "Brisbane", code: "SKT338H", inkoopUsd: 3047.5, verkoopEur: null },
        { model: "Bliss", code: "SKT888D", inkoopUsd: 1621.25, verkoopEur: null, afmeting: "2200x1000x790" },
        { model: "New Bliss", code: "SKT888DA", inkoopUsd: 1621.25, verkoopEur: null, afmeting: "2200x1000x790",
          let: "Zelfde kuip als de Bliss, alleen andere jets - een update van hetzelfde model (Chantal, 10 aug 2026)." },
        { model: "Bright", code: "SKT338A3 with TV", inkoopUsd: 3803.4, verkoopEur: null },
        { model: "Bright", code: "SKT338A3 without TV", inkoopUsd: 3230.84, verkoopEur: null },
        { model: "Brighton", code: "SKT333F", inkoopUsd: 2798.24, verkoopEur: null },
        { model: "Cardiff", code: "SKT306A", inkoopUsd: 3223.84, verkoopEur: null, afmeting: "2280x2280x940" },
        { model: "Coventry", code: "SKT335A", inkoopUsd: 1715.71, verkoopEur: null, afmeting: "1840x1240x750" },
        { model: "Delight", code: "SKT888AA", inkoopUsd: 2655.76, verkoopEur: null, afmeting: "2130x2130x910" },
        { model: "Desire", code: "SKT888C1", inkoopUsd: 3121.32, verkoopEur: null, afmeting: "2740x2280x910" },
        { model: "Devotion", code: "SKT888BC", inkoopUsd: 2990.51, verkoopEur: null, afmeting: "2300x2300x910" },
        { model: "Dream 7", code: "PP01 ROTO MOULD SPA", inkoopUsd: 1317.1, verkoopEur: null },
        { model: "Dynamic", code: "SKT339DA", inkoopUsd: 7333.62, verkoopEur: null, afmeting: "5900x2270x1260" },
        { model: "Dynamic Deep", code: "SKT339DA-1", inkoopUsd: 8283.28, verkoopEur: null, afmeting: "5900x2270x1550" },
        { model: "Ecstatic", code: "SKT888F", inkoopUsd: 3469.03, verkoopEur: null, afmeting: "3050x2280x910" },
        { model: "Ecstatic Wave", code: "SKT888FA", inkoopUsd: 4099.18, verkoopEur: null, afmeting: "3050x2280x910" },
        { model: "Edinborough", code: "SKT333D", inkoopUsd: 3003.21, verkoopEur: null },
        { model: "Euphoria", code: "SKT888K", inkoopUsd: 3221.96, verkoopEur: null, afmeting: "2280x2280x860" },
        { model: "New Euphoria wave", code: "SKT888KA", inkoopUsd: 3270.56, verkoopEur: null, afmeting: "2280x2280x860",
          let: "Zelfde kuip als de Euphoria, alleen andere jets - een update van hetzelfde model (Chantal, 10 aug 2026)." },
        { model: "Energy", code: "SKT339G4，7.1m normal", inkoopUsd: 10243, verkoopEur: null },
        { model: "Energy Deep", code: "SKT339G5，7.1m deep", inkoopUsd: 10965.26, verkoopEur: null },
        { model: "Excite", code: "SKT888M-1", inkoopUsd: 3157.98, verkoopEur: null, afmeting: "2240x2240x910" },
        { model: "Exercise", code: "SKT339G9", inkoopUsd: 3854.71, verkoopEur: null, afmeting: "2500x2260x1650" },
        { model: "Felicity", code: "SKT888J", inkoopUsd: 3179.92, verkoopEur: null, afmeting: "2130x2130x910" },
        { model: "New Felicity wave", code: "SKT888JA", inkoopUsd: 3155.92, verkoopEur: null, afmeting: "2130x2130x910",
          let: "Zelfde kuip als de Felicity, alleen andere jets - een update van hetzelfde model (Chantal, 10 aug 2026)." },
        { model: "Florida", code: "SKT338E2", inkoopUsd: 2179.21, verkoopEur: null, afmeting: "2290x2290x970" },
        { model: "Fitness 1", code: "SKT339G6", inkoopUsd: 5814.74, verkoopEur: null, afmeting: "4000x2280x1260" },
        { model: "Fitness 1 Deep", code: "SKT339G7", inkoopUsd: 6321.5, verkoopEur: null, afmeting: "4000x2280x1520" },
        { model: "Fitness 2", code: "SKT339G2，5m normal", inkoopUsd: 7260.83, verkoopEur: null },
        { model: "Fitness 2 Deep", code: "SKT339G3，5m deep", inkoopUsd: 7289.67, verkoopEur: null },
        { model: "Heart", code: "SKT888E", inkoopUsd: 1943.34, verkoopEur: null, afmeting: "2020x1690x780" },
        { model: "New Heart", code: "SKT888EA", inkoopUsd: 1947.12, verkoopEur: null, afmeting: "2020x1690x780",
          let: "Zelfde kuip als de Heart, alleen andere jets - een update van hetzelfde model (Chantal, 10 aug 2026)." },
        { model: "Happy", code: "SKT888A-4S", inkoopUsd: 2167.54, verkoopEur: null, afmeting: "2130x1750x830" },
        { model: "Joy", code: "SKT888M", inkoopUsd: 2749.83, verkoopEur: null, afmeting: "2250x2250x910" },
        { model: "New Joy", code: "SKT888MA", inkoopUsd: 2749.83, verkoopEur: null, afmeting: "2250x2250x910",
          let: "Zelfde kuip als de Joy, alleen andere jets - een update van hetzelfde model (Chantal, 10 aug 2026)." },
        { model: "Junior swimspa", code: "100383", inkoopUsd: 3106.21, verkoopEur: null },
        { model: "Melbourne", code: "SKT888B2", inkoopUsd: 2757.04, verkoopEur: null, afmeting: "2320x2300x910" },
        { model: "Natural", code: "SKT306B", inkoopUsd: 2520.35, verkoopEur: null, afmeting: "2000x2000x980" },
        { model: "Oxford", code: "SKT335F", inkoopUsd: 1943.34, verkoopEur: null, afmeting: "2050x1550x810" },
        { model: "Pleasure", code: "SKT888CA", inkoopUsd: 2573.7, verkoopEur: null, afmeting: "2150x2000x910" },
        { model: "New Pleasure", code: "SKT888CA-1", inkoopUsd: 2573.7, verkoopEur: null, afmeting: "2150x2000x910",
          let: "Zelfde kuip als de Pleasure, alleen andere jets - een update van hetzelfde model (Chantal, 10 aug 2026)." },
        { model: "Recharge", code: "SKT306D", inkoopUsd: 1838.49, verkoopEur: null, afmeting: "2000x2000x890" },
        { model: "Renew", code: "SKT335HA", inkoopUsd: 1814.07, verkoopEur: null, afmeting: "2080x1560x840" },
        { model: "Refresh", code: "SKT329FB", inkoopUsd: 1845.49, verkoopEur: null, afmeting: "2000x2000x850" },
        { model: "Resort", code: "SKT329F", inkoopUsd: 2138.01, verkoopEur: null, afmeting: "2000x2000x850" },
        { model: "Relax", code: "SKT329EA", inkoopUsd: 1845.49, verkoopEur: null, afmeting: "2000x2000x850" },
        { model: "Repose", code: "SKT329E1", inkoopUsd: 2436.71, verkoopEur: null, afmeting: "2540x2040x850" },
        { model: "New repose", code: "SKT329E2", inkoopUsd: 2436.71, verkoopEur: null, afmeting: "2540x2040x850",
          let: "Zelfde kuip als de Repose, alleen andere jets - een update van hetzelfde model (Chantal, 10 aug 2026)." },
        { model: "Rewind", code: "SKT329FA", inkoopUsd: 1845.49, verkoopEur: null, afmeting: "2000x2000x850" },
        { model: "Sensation", code: "SKT888K1 new mould", inkoopUsd: 2692.26, verkoopEur: null },
        { model: "Serene 1", code: "SKT333H2", inkoopUsd: 1474.69, verkoopEur: null, afmeting: "1860x900x740" },
        { model: "Serene 2", code: "SKT333H", inkoopUsd: 1811.5, verkoopEur: null, afmeting: "2100x1100x760" },
        { model: "Serene 3", code: "SKT333H1", inkoopUsd: 1966, verkoopEur: null, afmeting: "2100x1300x840" },
        { model: "Serene 5", code: "SKT333H3", inkoopUsd: 2481, verkoopEur: null, afmeting: "2100x1850x810" },
        { model: "Serene 6", code: "SKT333A", inkoopUsd: 3106.21, verkoopEur: null, afmeting: "2420x2240x940" },
        { model: "Solace", code: "SKT888AB", inkoopUsd: 2707.26, verkoopEur: null, afmeting: "2130x2130x910" },
        { model: "Soulmate", code: "SKT335FA", inkoopUsd: 2167.54, verkoopEur: null, afmeting: "2130x1650x840" },
        { model: "Reboot", code: "SKT335FA-1", inkoopUsd: 1894, verkoopEur: null, afmeting: "2130x1650x840" },
        { model: "Spirit", code: "SKT339G", inkoopUsd: 8428.82, verkoopEur: null, afmeting: "5400x2280x1280" },
        { model: "Spirit Deep", code: "SKT339G1", inkoopUsd: 9138.49, verkoopEur: null, afmeting: "5400x2280x1520" },
        { model: "Sunny", code: "SKT338A4", inkoopUsd: 3230.84, verkoopEur: null, afmeting: "2280x2280x930" },
        { model: "Sydney", code: "SKT666A", inkoopUsd: 5291.5, verkoopEur: null, afmeting: "3800x2280x1150" },
        { model: "Theater", code: "SKT339F with TV", inkoopUsd: 6698.48, verkoopEur: null, afmeting: "3800x2280x1160" },
        { model: "Theater", code: "SKT339F without TV", inkoopUsd: 5778.48, verkoopEur: null, afmeting: "3800x2280x1160",
          let: "De prijslijst noemt alleen het bedrag met tv. Chantal bevestigde 8 aug 2026 dat de uitvoering zonder tv USD 5.778 is, en dat is ook wat er op de commercial invoice staat. Net als bij de Bright dus twee uitvoeringen onder een code." },
        { model: "Vitality", code: "SKT339G11，7.1m normal", inkoopUsd: 10202.98, verkoopEur: null },
        { model: "Vitality Deep", code: "SKT339G10，7.1m deep", inkoopUsd: 10925.24, verkoopEur: null },
        { model: "Malta", code: "SKT306C", inkoopUsd: 1331.45, verkoopEur: null, afmeting: "1820x1820x750" },
        { model: "Mallorca Luxury", code: "SKT888G", inkoopUsd: 1413.5, verkoopEur: null, afmeting: "2000x2000x780", let: "Color Siver marble add $152" },
        { model: "Mallorca Diamond", code: "SKT888G1", inkoopUsd: 1461.2, verkoopEur: null, afmeting: "2000x2000x780" },
        { model: "Mallorca Superior", code: "SKT888G2", inkoopUsd: 1540.7, verkoopEur: null, afmeting: "2000x2000x780" },
        { model: "Corsica Luxury", code: "SKT888I", inkoopUsd: 1461.2, verkoopEur: null, afmeting: "2280x2280x860" },
        { model: "Corsica Diamond", code: "SKT888I-1", inkoopUsd: 1620.2, verkoopEur: null, afmeting: "2280x2280x860" },
        { model: "Corsica Superior", code: "SKT888I-2", inkoopUsd: 1832.2, verkoopEur: null, afmeting: "2280x2280x860" },
        { model: "Tenerife Luxury", code: "SKT888H2", inkoopUsd: 1518.97, verkoopEur: null, afmeting: "2140x1520x840" },
        { model: "Tenerife Diamond", code: "SKT888H1", inkoopUsd: 1431.52, verkoopEur: null, afmeting: "2140x1520x840" },
        { model: "Tenerife Superior", code: "SKT888H", inkoopUsd: 1618.08, verkoopEur: null, afmeting: "2140x1520x840" },
        { model: "Aurora", code: "SKT888U", inkoopUsd: 3459.98, verkoopEur: null, afmeting: "2280x2280x1100", let: "upgrade to TOUCH 3 panel" },
        { model: "Balance swim spa", code: "SKT339G16", inkoopUsd: 10010.5, verkoopEur: null, afmeting: "5900x2270x1250", let: "11587 Price for marble decorate 最新价格202410" },
        { model: "Elevate", code: "SKT888W Hot cold spa", inkoopUsd: 4445, verkoopEur: null },
        { model: "Indulgence", code: "SKT888S", inkoopUsd: 1712.78, verkoopEur: null, afmeting: "2130x1420x575" },
        { model: "Harmony", code: "SKT888P", inkoopUsd: 3732.78, verkoopEur: null, afmeting: "2695x2280x910" },
        { model: "Lagoon", code: "SKT888R", inkoopUsd: 3459.98, verkoopEur: null, afmeting: "2280x2280x910", let: "upgrade to TOUCH 3 panel" },
        { model: "Summit", code: "SKT888Y", inkoopUsd: 3459.98, verkoopEur: null, afmeting: "2130x2130x910" },
        { model: "Exhilarate wave", code: "SKT888Q", inkoopUsd: 3302.98, verkoopEur: null, afmeting: "2280x2280x910" },
        { model: "Team Vitallce", code: "SKT339G17", inkoopUsd: 5238.5, verkoopEur: null, afmeting: "3900x2280x1450" },
        { model: "Breeze Icebath", code: "SKT888V", inkoopUsd: 1152, verkoopEur: null, afmeting: "2000x900x750" },
        { model: "Spark", code: "SKT888X", inkoopUsd: 1209, verkoopEur: null, afmeting: "1700x1500x730" },
        { model: "Flame", code: "SKT888X-1", inkoopUsd: 1359, verkoopEur: null, afmeting: "1900x1900x760" , let: "De prijslijst van Jazzi schrijft \"Frame\"; dat is een typefout. Chantal bevestigde Flame (9 aug 2026)." },
        { model: "Oasis", code: "SKT888T", inkoopUsd: 6990, verkoopEur: null, afmeting: "3200x2350x1000", let: "upgrade to BP+TOUCH 最新20241105" },
        { model: "Cascade", code: "SKT888O", inkoopUsd: 3609, verkoopEur: null, afmeting: "2280x1880x1060", let: "upgrade to TOUCH 3 panel" },
        { model: "Reflect", code: "PP01", inkoopUsd: 2084, verkoopEur: null },
        { model: "Retreat", code: "PP02", inkoopUsd: 2084, verkoopEur: null },
        { model: "Resettle", code: "PP03", inkoopUsd: 2084, verkoopEur: null },
        { model: "", code: "SKT333J", inkoopUsd: 2309, verkoopEur: null },
        { model: "", code: "TM168F", inkoopUsd: 3230.84, verkoopEur: null },
      ],
    },
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
        { model: "Hurricane",  code: "WS-506M",   inkoopUsd: 9866, verkoopEur: null, afmeting: "5900x2200x1610",
          let: "Prijs en maat van de proforma Arnoswim20260810 (10 aug 2026), waar hij als WS-S06M op staat. De specsheet noemt hem Hurricane Deep en geeft 590x220x161 - tot op de millimeter gelijk. Met de hand bijgeschreven op het prijsblad." },
      ],
    },
    {
      fabriek: "Passion Ice Baths (Innerfire)",
      merk: "Passion Ice Baths",
      contact: null, email: null,
      bron: "artikelbestand Logic4, opgevraagd 08-08-2026",
      munt: "EUR",
      opmerking: "Bedragen in EURO - deze baden komen uit Nederland, niet uit China. In Houston worden de onderdelen los geteld (barrels apart van de koelers), dus de losse artikelprijzen zijn hier de juiste. Een 'Compleet'-artikel staat in Logic4 op nul: dat is een samenstelling van losse regels.",
      modellen: [
        { model: "Wim Hof Barrel", code: "800062", inkoopEur: 119.40, verkoopEur: null,
          let: "De 240 liter; bevestigd door Chantal, 8 aug 2026." },
        // Chantal noemt hem 360 liter, Logic4 kent hem als 350 liter. Er zijn
        // maar twee maten kuip (240 en 350) en de gewone barrel is de 240, dus
        // de XL is deze. Eerder stond hij op 'geen prijs' omdat ik naar het
        // artikel 'XL Compleet' keek - dat is een samenstelling en staat
        // daarom op nul, net als alle andere 'Compleet'-artikelen.
        { model: "Wim Hof Barrel XL", code: "800052", inkoopEur: 192.00, verkoopEur: null,
          let: "De grote kuip: Logic4 noemt hem 350 liter, Chantal 360. Losse kuip, zonder koeler - die staat apart in de telling." },
        // Per kleur, want ze schelen in prijs. Chantal gaf de verdeling van de
        // 32 stuks op 8 aug 2026: 2 Moss, 7 Earth Grey, 9 Granite, 10 Black
        // Marble, 4 Blue.
        { model: "Revive Moss Stone", code: "800053", inkoopEur: 251.41, verkoopEur: null },
        { model: "Revive Earth Grey", code: "800055", inkoopEur: 234.91, verkoopEur: null },
        { model: "Revive Granite Grey", code: "800058", inkoopEur: 230.41, verkoopEur: null },
        { model: "Revive Ice Blue", code: "800050", inkoopEur: 228.41, verkoopEur: null },
        { model: "Revive Black Marble", code: "800002", inkoopEur: 224.41, verkoopEur: null,
          let: "Black Marble staat niet in Logic4; de zeven kleuren die er wel staan lopen van EUR 224,41 (Solid Grey) tot EUR 251,41 (Moss Stone). Gerekend met de laagste, net als bij de andere onzekere regels. Het gaat om hooguit 27 euro per stuk." },
        { model: "Water chiller", code: "800015", inkoopEur: 325.89, verkoopEur: null,
          let: "De 110V/60Hz-uitvoering; in Logic4 staat er letterlijk bij dat die alleen voor de VS is. De 50Hz-versie (EUR 303,57) hoort in Europa." },
        { model: "Faith", code: "800049", inkoopEur: 1482.14, verkoopEur: null },
        { model: "Shower", code: "800030", inkoopEur: 455.36, verkoopEur: null,
          let: "The Therapist Shower Chiller 50 liter - het enige douche-artikel in deze reeks." },
        // Deze drie staan ook op de Jazzi-prijslijst in dollars. Die gaat voor:
        // daar wordt in dollars ingekocht. Hier alleen ter vergelijking.
        { model: "Breeze Ice Bath", code: "800033", inkoopEur: 1020.54, verkoopEur: null,
          let: "Alle kleuren hetzelfde bedrag. Staat ook op de Jazzi-lijst voor USD 1.152; die wordt gebruikt." },
        { model: "Elevate Ice Bath", code: "101008", inkoopEur: 4098.21, verkoopEur: null,
          let: "Staat ook op de Jazzi-lijst voor USD 4.445; die wordt gebruikt." },
        { model: "Vital-ICE Ice Bath", code: "800029", inkoopEur: 4642.86, verkoopEur: null,
          let: "Staat ook op de Jazzi-lijst voor USD 5.238,50; die wordt gebruikt." },
      ],
    },
    {
      fabriek: "Fonteyn barrelsauna's",
      merk: "Fonteyn",
      contact: null, email: null,
      bron: "artikelbestand Logic4, opgevraagd 08-08-2026",
      munt: "EUR",
      opmerking: "Bedragen in EURO. Elke maat bestaat in Clear en Rustic met een fors prijsverschil; Houston heeft de Rustic-uitvoering (Chantal, 8 aug 2026). Zij stuurt haar eigen prijslijst nog na, die kan afwijken van het artikelbestand.",
      modellen: [
        { model: "Barrel Sauna 4 ft", code: "454117", inkoopEur: 803.57, verkoopEur: null,
          let: "Rustic-uitvoering; bevestigd door Chantal, 8 aug 2026. Zij stuurt haar eigen prijslijst nog na." },
        { model: "Barrel Sauna 6 ft", code: "454119", inkoopEur: 1160.71, verkoopEur: null,
          let: "Rustic-uitvoering; bevestigd door Chantal, 8 aug 2026. Zij stuurt haar eigen prijslijst nog na." },
        { model: "Barrel Sauna 8 ft", code: "454123", inkoopEur: 1383.93, verkoopEur: null,
          let: "Rustic-uitvoering; bevestigd door Chantal, 8 aug 2026. Zij stuurt haar eigen prijslijst nog na." },
        { model: "Barrel Sauna 7+1 combi", code: "454115", inkoopEur: 1540.18, verkoopEur: null,
          let: "Bestaat alleen als Rustic - geen keuze, geen onzekerheid." },
      ],
    },
  ];

  // De met de hand bijgeschreven regel op het blad van Sea star spas las ik als
  // "tt165"; Chantal bevestigde dat het ET-165 is (4 aug 2026). Dat het bedrag
  // gelijk is aan dat van Spa Hope is dus toeval, geen dubbele aantekening.
  var ONDUIDELIJK = [];

  /* ─── Inkoopprijs opzoeken ───────────────────────────────────────────
     Eén plek waar een modelnaam of fabriekscode een dollarprijs wordt, zodat
     de voorraadtegel en de Amerika-tegel niet elk hun eigen antwoord geven.

     Zoeken gaat eerst op fabriekscode, want die is eenduidig; pas daarna op
     naam. Codes op de prijslijst dragen soms een toevoeging ("SKT339G4，7.1m
     normal", "SKT888K1 new mould") — daar wordt op de kale code na vergeleken.
     Uitzondering: SKT338A3 bestaat mét en zónder tv voor een ander bedrag en
     SKT339C heeft een SIMPLE PACK-variant. Die blijven op hun volledige code
     staan; een kale SKT338A3 levert daarom bewust niets op in plaats van de
     verkeerde helft van een keuze. */
  function sleutel(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function kaleCode(c) { return sleutel(String(c || "").split(/[，,\s]/)[0]); }

  // Namen die in de voorraadtelling anders staan dan op de prijslijst. Elke
  // regel is een menselijke vaststelling, geen automatische gok.
  var NAAMKOPPELING = {
    "breeze": "Breeze Icebath",
    "exhilarate": "Exhilarate wave",
    "balance": "Balance swim spa",
    "vitalice": "Team Vitallce",       // typefout van de fabriek voor Team Vital Ice
    "euphoriawave": "New Euphoria wave",
    "felicitywave": "New Felicity wave",
    // Modellen die van naam zijn veranderd. De voorraadtelling gebruikt nog de
    // oude naam, de prijslijst de nieuwe (Chantal, 8 aug 2026).
    "tradition": "Aurora",
    "mirage": "Cascade",
  };

  var DUBBELZINNIG = { "skt338a3": 1, "skt339c": 1, "skt339f": 1 };

  function prijsVan(model, code) {
    var perCode = {}, perNaam = {};
    for (var i = 0; i < FABRIKANTEN.length; i++) {
      var f = FABRIKANTEN[i];
      for (var j = 0; j < f.modellen.length; j++) {
        var m = f.modellen[j];
        // Niet elke leverancier factureert in dollars: Jazzi wel, de ijsbaden
        // en de barrelsauna's komen uit Nederland en staan in euro's. De munt
        // reist mee, want omrekenen mag hier niet gebeuren.
        if (m.inkoopUsd == null && m.inkoopEur == null) continue;
        var inUsd = m.inkoopUsd != null;
        var rec = {
          usd: inUsd ? m.inkoopUsd : null,
          eur: inUsd ? null : m.inkoopEur,
          bedrag: inUsd ? m.inkoopUsd : m.inkoopEur,
          munt: inUsd ? "USD" : "EUR",
          model: m.model, code: m.code, fabriek: f.fabriek, merk: f.merk, bron: f.bron, let: m.let || null,
        };
        var vol = sleutel(m.code), kaal = kaleCode(m.code);
        if (!perCode[vol]) perCode[vol] = rec;
        // Alleen de kale code registreren als hij niet dubbelzinnig is.
        if (kaal !== vol && !DUBBELZINNIG[kaal] && !perCode[kaal]) perCode[kaal] = rec;
        if (m.model && !perNaam[sleutel(m.model)]) perNaam[sleutel(m.model)] = rec;
      }
    }
    var c = sleutel(code);
    if (c && perCode[c]) return perCode[c];
    if (c && perCode[kaleCode(code)] && !DUBBELZINNIG[kaleCode(code)]) return perCode[kaleCode(code)];
    var n = sleutel(model);
    if (n && perNaam[n]) return perNaam[n];
    if (n && NAAMKOPPELING[n]) return perNaam[sleutel(NAAMKOPPELING[n])] || null;
    return null;
  }

  global.fpFabrikanten = { lijst: FABRIKANTEN, onduidelijk: ONDUIDELIJK, prijsVan: prijsVan };

})(typeof window !== "undefined" ? window : globalThis);
