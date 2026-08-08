/* ═══════════════════════════════════════════════════════════════════════════
   TRANSPORTKOSTEN CHINA → WAREHOUSE HOUSTON
   ═══════════════════════════════════════════════════════════════════════════

   Waarvoor
   --------
   Voor het gesprek met Daan moet er één bedrag op tafel: wat de voorraad in
   Houston waard is, inclusief wat het heeft gekost om hem daar te krijgen.

   De reis van een container, en waar die kosten op de factuur staan:

     fabriek → haven China ................ ORIGIN LOCAL CHARGES
     haven China → haven Houston .......... OCEAN FREIGHT
     papierwerk aan de grens .............. ISF FILING, US LOCAL CHARGES,
                                            CHASSIS RENTAL, ADMINISTRATION
     douane-aangifte ...................... CUSTOMS ENTRY FEE AND SERVICES
     invoerrechten ........................ CUSTOMS DUTIES
     haven Houston → warehouse ............ CONTAINER DRAYAGE
     truck uitladen ....................... staat NIET op de factuur, USD 400

   Waarom een gemiddelde van drie
   ------------------------------
   De vrachtprijs beweegt hard. Chantal heeft daarom drie facturen gestuurd:
   een recente, een van een half jaar terug en een oudere. Het gemiddelde
   daarvan is eerlijker dan de laatste factuur, die toevallig hoog of laag
   kan zijn.

   Let op bij het lezen: twee van de drie facturen gaan over TWEE containers.
   Het factuurtotaal is dus niet de prijs van één container. Er wordt per
   factuur eerst door het aantal containers gedeeld en pas daarna gemiddeld.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  // Wat de expediteur niet factureert: het uitladen van de truck bij het
  // warehouse. Vast bedrag per container (Gerrit, 8 aug 2026).
  var UITLADEN_USD = 400;

  // Inventaris in het warehouse. Vast bedrag zolang er geen telling is.
  var INVENTARIS_USD = 10000;

  // De drie facturen die Chantal heeft aangeleverd, letterlijk overgenomen.
  // 'containers' is bepaald op het veld CNTR. NO. van de factuur zelf.
  var FACTUREN = [
    {
      nummer: "IV-12670", datum: "2025-04-29", expediteur: "Lever Logistics LLC",
      containers: 1, containerNrs: ["GAOU6614877"], schip: "EVER SUPERB 108E",
      route: "Yantian 29-03-2025 → Houston 04-05-2025",
      regels: [
        { wat: "Ocean freight", usd: 3050.00 },
        { wat: "Container drayage", usd: 950.00 },
        { wat: "Chassis rental", usd: 150.00 },
        { wat: "ISF filing", usd: 45.00 },
        { wat: "Customs entry fee", usd: 95.00 },
        { wat: "US local charges", usd: 437.00 },
        { wat: "Customs duties", usd: 3771.47 },
        { wat: "Origin local charges", usd: 1025.00 },
        { wat: "Administratie", usd: 50.00 },
      ],
    },
    {
      nummer: "IV-40026", datum: "2026-03-09", expediteur: "MTO Freight LLC",
      containers: 2, containerNrs: ["ONEU1593355", "TCLU6341738"], schip: "CORNEILLE 011E",
      route: "Yantian 03-02-2026 → Houston 11-03-2026",
      regels: [
        { wat: "Ocean freight", usd: 7500.00 },
        { wat: "Container drayage", usd: 1900.00 },
        { wat: "Chassis rental", usd: 300.00 },
        { wat: "ISF filing", usd: 45.00 },
        { wat: "Customs entry fee", usd: 125.00 },
        { wat: "US local charges", usd: 874.00 },
        { wat: "Customs duties", usd: 2587.80 },
        { wat: "Origin local charges", usd: 2050.00 },
        { wat: "Administratie", usd: 75.00 },
      ],
    },
    {
      nummer: "IV-40044", datum: "2026-06-23", expediteur: "MTO Freight LLC",
      containers: 2, containerNrs: ["MSMU4785496", "MSMU6352582"], schip: "TIANJIN 61E",
      route: "Yantian 15-05-2026 → Houston 30-06-2026",
      regels: [
        { wat: "Ocean freight", usd: 10500.00 },
        { wat: "Container drayage", usd: 2100.00 },
        { wat: "Chassis rental", usd: 300.00 },
        { wat: "ISF filing", usd: 45.00 },
        { wat: "Customs entry fee", usd: 125.00 },
        { wat: "US local charges", usd: 874.00 },
        { wat: "Customs duties", usd: 2814.19 },
        { wat: "Origin local charges", usd: 2050.00 },
        { wat: "Administratie", usd: 200.00 },
      ],
    },
  ];

  // ─── Hoeveel containers zijn er voor deze voorraad gevaren? ─────────
  // Geijkt op echte zendingen, niet op een vuistregel. In het dashboard staan
  // acht commercial invoices naar Rotterdam: samen 66 containers met 715
  // spa's. Van 527 daarvan staat de afmeting op de Jazzi-prijslijst; die zijn
  // samen 2.466,6 m3, dus gemiddeld 4,68 m3 per spa. Opgeschaald naar alle
  // 715 komt dat neer op 50,7 m3 lading per container - ongeveer 75% van een
  // 40ft high cube, en dat klopt met wat je mag verwachten: spa's zijn stijve
  // dozen die niet in elkaar passen.
  //
  // Waarom niet simpelweg "10,8 spa's per container", wat diezelfde 66
  // containers ook opleveren: de spa's in Houston zijn gemiddeld 6,25 m3 en
  // dus een derde groter dan die in de Rotterdam-zendingen. Op stuks tellen
  // geeft daardoor te weinig containers. Op volume rekenen houdt rekening met
  // welke modellen er werkelijk staan.
  var M3_PER_CONTAINER = 50.7;

  // Een ijsbad is geen spa: kleiner, en de afmeting staat nergens vast. Voor
  // de ijsbaden die uit China komen (Breeze, Elevate, Vital Ice, Balance)
  // wordt met een voorzichtige 2,5 m3 gerekend. Het gaat om een handvol
  // stuks, dus het verschuift het eindgetal nauwelijks.
  var M3_IJSBAD = 2.5;

  function containersUitVolume(m3) {
    var n = Number(m3) / M3_PER_CONTAINER;
    return { exact: Math.round(n * 10) / 10, afgerond: Math.ceil(n),
             m3PerContainer: M3_PER_CONTAINER };
  }

  function rond(n) { return Math.round(Number(n) * 100) / 100; }

  // Per factuur: totaal, en wat dat per container betekent.
  function perFactuur() {
    return FACTUREN.map(function (f) {
      var totaal = f.regels.reduce(function (n, r) { return n + r.usd; }, 0);
      var duties = (f.regels.find(function (r) { return r.wat === "Customs duties"; }) || {}).usd || 0;
      return {
        nummer: f.nummer, datum: f.datum, expediteur: f.expediteur,
        containers: f.containers, containerNrs: f.containerNrs, schip: f.schip, route: f.route,
        regels: f.regels,
        totaalFactuur: rond(totaal),
        perContainer: rond(totaal / f.containers),
        // Het uitladen komt er per container bij; dat staat op geen factuur.
        perContainerMetUitladen: rond(totaal / f.containers + UITLADEN_USD),
        dutiesPerContainer: rond(duties / f.containers),
      };
    });
  }

  // Het gemiddelde over de drie facturen. Elke factuur telt even zwaar: ze
  // zijn juist gekozen om drie momenten in de tijd te dekken, niet om een
  // gewogen gemiddelde over containers te maken.
  function gemiddelde() {
    var lijst = perFactuur();
    var som = lijst.reduce(function (n, f) { return n + f.perContainer; }, 0);
    var somDuties = lijst.reduce(function (n, f) { return n + f.dutiesPerContainer; }, 0);
    var vracht = rond(som / lijst.length);
    return {
      facturen: lijst,
      vrachtPerContainer: vracht,
      uitladenPerContainer: UITLADEN_USD,
      perContainer: rond(vracht + UITLADEN_USD),
      dutiesPerContainer: rond(somDuties / lijst.length),
      laagste: rond(Math.min.apply(null, lijst.map(function (f) { return f.perContainerMetUitladen; }))),
      hoogste: rond(Math.max.apply(null, lijst.map(function (f) { return f.perContainerMetUitladen; }))),
    };
  }

  // De hele som voor Daan. `voorraadUsd` is de inkoopwaarde die al in dollars
  // staat, `voorraadEur` het deel dat in euro's is ingekocht; dat laatste
  // wordt hier omgerekend omdat het eindbedrag in dollars moet.
  function totaal(opties) {
    var o = opties || {};
    var koers = Number(o.koers) > 0 ? Number(o.koers) : 1.11;   // EUR → USD
    var eurInUsd = rond((Number(o.voorraadEur) || 0) * koers);
    var voorraad = rond((Number(o.voorraadUsd) || 0) + eurInUsd);
    var g = gemiddelde();
    var containers = Number(o.containers) || 0;
    var transport = rond(containers * g.perContainer);
    var inventaris = o.inventarisUsd == null ? INVENTARIS_USD : Number(o.inventarisUsd);
    return {
      koers: koers,
      voorraadUsd: rond(Number(o.voorraadUsd) || 0),
      voorraadEur: rond(Number(o.voorraadEur) || 0),
      voorraadEurInUsd: eurInUsd,
      voorraadTotaalUsd: voorraad,
      transportPerContainer: g.perContainer,
      containers: containers,
      transportUsd: transport,
      inventarisUsd: inventaris,
      totaalUsd: rond(voorraad + transport + inventaris),
      gemiddelde: g,
    };
  }

  global.fpTransportHouston = {
    facturen: FACTUREN,
    M3_PER_CONTAINER: M3_PER_CONTAINER,
    M3_IJSBAD: M3_IJSBAD,
    containersUitVolume: containersUitVolume,
    perFactuur: perFactuur,
    gemiddelde: gemiddelde,
    totaal: totaal,
    UITLADEN_USD: UITLADEN_USD,
    INVENTARIS_USD: INVENTARIS_USD,
  };

})(typeof window !== "undefined" ? window : globalThis);
