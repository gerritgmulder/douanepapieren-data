/* ═══════════════════════════════════════════════════════════════════════════
   GELD-GOEDERENBEWEGING — controle-engine
   ═══════════════════════════════════════════════════════════════════════════

   Achtergrond
   -----------
   Accountant Kevin (De Jong & Laan) kan de geld-goederenbeweging van Fonteyn
   niet opbouwen. Zijn keten is:

        INKOOP → VOORRAAD → VERKOOP → FACTUUR → BANK

   en hij controleert of die aansluit:
     • inkopen sluiten aan op leveranciersfacturen en ontvangen goederen
     • begin- en eindvoorraad sluiten aan op de administratie en de telling
     • verkopen leiden tot afname van de voorraad
     • geleverde goederen zijn gefactureerd
     • facturen leiden tot debiteuren en uiteindelijk tot bankontvangsten
     • kostprijs, omzet en brutomarge hangen logisch samen

   Deze engine draait die controles automatisch op de LIVE Logic4-data en geeft
   per controle exact de regels terug die de keten breken. Niet als rapport
   achteraf, maar als werklijst: elke bevinding krijgt een eigenaar en een
   status, en blijft staan tot hij is opgelost of bewust is geaccepteerd.

   Waarom in de browser en niet in de worker
   -----------------------------------------
   Een volledige scan is ~150 API-aanroepen. De Cloudflare-worker zit op het
   gratis plan (max 50 subrequests per aanroep) — dat past niet en betalen doen
   we niet. De tegel draait de scan daarom via de lokale helper (poort 3737) op
   de pc van degene die hem start, en zet alleen het RESULTAAT in KV. Zo ziet
   iedereen dezelfde momentopname zonder zelf te hoeven scannen.

   Alles hieronder is OTA: dit bestand staat in manifest.json, dus een herstart
   van de app is genoeg. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  /* ═══════════════════════════════════════════════════════════════════
     1. HOE LOGIC4 BIJ FONTEYN IS INGERICHT
     ═══════════════════════════════════════════════════════════════════ */

  // Magazijnen, ingedeeld naar wat ze in het echt betekenen. Deze indeling is
  // de kern van de voorraadcontroles: de accountant markeerde in zijn Excel
  // juist de magazijnen rood waar goederen fysiek NOOIT liggen, maar waar wel
  // voorraad geregistreerd staat.
  var MAGAZIJNEN = {
    // Hier liggen goederen echt. Voorraad is normaal.
    21: { naam: "Fonteyn (hallen Uddel)",  soort: "fysiek" },
    25: { naam: "Showroommodel",           soort: "fysiek" },
    26: { naam: "Outlet",                  soort: "fysiek" },
    50: { naam: "Warehouse Texas USA",     soort: "fysiek" },
    52: { naam: "Retouren",                soort: "fysiek" },
    29: { naam: "Werkplaats",              soort: "fysiek" },

    // Goederen komen hier NOOIT binnen in Uddel. Voorraad hoort hier 0 te zijn.
    27: { naam: "Dealer magazijn",                       soort: "virtueel" },
    34: { naam: "Leverancier rechtstreeks naar monteur", soort: "virtueel" },
    35: { naam: "Leverancier rechtstreeks naar klant",   soort: "virtueel" },

    // Tussenstations. Mag even gevuld zijn, maar niet blijven hangen.
    19: { naam: "Geen",         soort: "doorstroom" },
    51: { naam: "Transporteur", soort: "doorstroom" },

    // Afgeschreven.
    49: { naam: "Derving", soort: "derving" },

    // Bestelbussen van de monteurs.
    33: { naam: "VZ-901-V", soort: "bus" },

    // Niet meer in gebruik. Hier hoort helemaal niets meer te staan.
    20: { naam: "OUD Kelder",    soort: "vervallen" },
    22: { naam: "OUD VT-675-J",  soort: "vervallen" },
    23: { naam: "OUD VT-676-J",  soort: "vervallen" },
    24: { naam: "OUD VT-674-J",  soort: "vervallen" },
    28: { naam: "OUD Uitleen",   soort: "vervallen" }
  };
  for (var b = 36; b <= 48; b++) MAGAZIJNEN[b] = { naam: "Auto " + (b - 35 < 10 ? "0" : "") + (b - 35), soort: "bus" };

  function magazijn(id) { return MAGAZIJNEN[id] || { naam: "Magazijn " + id, soort: "onbekend" }; }
  function magazijnenVanSoort(soort) {
    var uit = []; for (var k in MAGAZIJNEN) if (MAGAZIJNEN[k].soort === soort) uit.push(Number(k));
    return uit;
  }

  // Logic4 deelt productgroepen zelf al in via ProductGroupTypeId. Dat is
  // betrouwbaarder dan een eigen lijstje, want het volgt de inrichting mee.
  //   1 = echte goederen  → MOETEN een kostprijs en voorraadbeweging hebben
  //   4 = samengesteld    → kostprijs zit op de onderdelen, niet op het geheel
  //   5 = kosten/diensten → transport, montage, korting, garantie: kostprijs 0
  //                         is hier volstrekt normaal
  var GOED = 1, SAMENGESTELD = 4, DIENST = 5;

  // Verzamelartikelen: kassa-artikelen zonder echte productbetekenis
  // ("Decoratie BTW Hoog", "Service: kussen/schroeven/..."). Ze staan als goed
  // geregistreerd maar hebben nooit een kostprijs. Ze apart tellen voorkomt
  // dat ze de echte bevindingen ondersneeuwen.
  //
  // Het patroon is bewust smal: 9999 gevolgd door 2 of 3 cijfers. Dat raakt
  // 999992 t/m 999999 en 9999999, maar NIET 99999 (Bloemen), 99910-99941
  // (biologische aardappels en bier) en niet 9995102180248 (Passion-onderdeel).
  // Die hebben allemaal een code die met 999 begint maar zijn echte artikelen.
  function isVerzamelartikel(code) { return /^9999\d{2,3}$/.test(String(code || "")); }

  // Orderstatussen die geen verkoop zijn.
  function isGeenVerkoop(order) {
    var s = (order.OrderStatus && order.OrderStatus.Value) || "";
    return /offerte|geannuleerd/i.test(s);
  }

  /* ═══════════════════════════════════════════════════════════════════
     2. DE CONTROLES
     ═══════════════════════════════════════════════════════════════════
     Elke controle heeft:
       id       — vaste sleutel, verandert nooit (bevindingen hangen eraan)
       schakel  — welke stap in de keten van de accountant
       naam     — korte titel
       vraag    — wat er in gewone taal wordt gecontroleerd
       waarom   — waarom dit de geld-goederenbeweging breekt
       actie    — wat er moet gebeuren om het op te lossen
       eigenaar — welke afdeling het oplost
       ernst    — hoog / midden / laag
       eenheid  — eur / stuks / aantal
  */
  var CONTROLES = [
    /* ── SCHAKEL 1: INKOOP → VOORRAAD ───────────────────────────────── */
    {
      id: "1.1", schakel: "inkoop", ernst: "midden", eenheid: "aantal", eigenaar: "Inkoop",
      naam: "Inkooporder volledig ontvangen maar niet afgesloten",
      vraag: "Staan er inkooporders open waarvan alles allang binnen is?",
      waarom: "Een open inkooporder zegt tegen de administratie dat er nog goederen onderweg zijn. Zolang die niet wordt afgesloten, klopt de verplichting aan de leverancier niet.",
      actie: "Inkooporder in Logic4 afsluiten."
    },
    {
      id: "1.2", schakel: "inkoop", ernst: "hoog", eenheid: "eur", eigenaar: "Inkoop",
      naam: "Inkooporder al lang open met goederen die nooit kwamen",
      vraag: "Staan er inkooporders langer dan een half jaar open met nog te ontvangen goederen?",
      waarom: "Dit bedrag staat in de administratie als 'komt nog binnen'. Als het er nooit komt, is de inkoop en daarmee de voorraad structureel te hoog ingeschat.",
      actie: "Per order bepalen: alsnog ontvangen boeken, of de order annuleren en afsluiten."
    },
    {
      id: "1.3", schakel: "inkoop", ernst: "hoog", eenheid: "eur", eigenaar: "Magazijn", zwaar: true,
      naam: "Voorraad handmatig verhoogd zonder inkooporder",
      vraag: "Zijn er goederen bijgeboekt zonder dat er een inkoop tegenover staat?",
      waarom: "Voorraad die uit het niets ontstaat, heeft geen inkoopfactuur. Precies de aansluiting die de accountant niet kan leggen.",
      actie: "Per correctie de reden vastleggen, of alsnog aan een inkooporder koppelen."
    },

    /* ── SCHAKEL 2: VOORRAAD ────────────────────────────────────────── */
    {
      id: "2.1", schakel: "voorraad", ernst: "hoog", eenheid: "stuks", eigenaar: "Magazijn",
      naam: "Negatieve voorraad",
      vraag: "Staan er artikelen op een negatief aantal?",
      waarom: "Minder dan nul stuks kan fysiek niet. Er is dus meer verkocht dan ingekocht, of een ontvangst is nooit geboekt.",
      actie: "Ontbrekende ontvangst opsporen en alsnog boeken, daarna tellen."
    },
    {
      id: "2.2", schakel: "voorraad", ernst: "hoog", eenheid: "stuks", eigenaar: "Magazijn",
      naam: "Voorraad op een magazijn waar niets ligt",
      vraag: "Staat er voorraad op Dealer magazijn of op 'leverancier rechtstreeks naar klant/monteur'?",
      waarom: "Deze goederen komen nooit in Uddel binnen. Voorraad hier is per definitie een registratiefout — dit is wat de accountant in zijn Excel rood heeft gemarkeerd.",
      actie: "Uitboeken naar de juiste bestemming, en de route zo inrichten dat er niets blijft staan."
    },
    {
      id: "2.3", schakel: "voorraad", ernst: "midden", eenheid: "stuks", eigenaar: "Magazijn",
      naam: "Voorraad blijft hangen op een tussenstation",
      vraag: "Staat er voorraad op 'Geen', 'Transporteur' of op een vervallen magazijn?",
      waarom: "Tussenstations horen leeg te zijn. Wat blijft staan, is onderweg kwijtgeraakt in de administratie.",
      actie: "Doorboeken naar de eindbestemming."
    },
    {
      id: "2.4", schakel: "voorraad", ernst: "midden", eenheid: "stuks", eigenaar: "Inkoop",
      naam: "Voorraad zonder kostprijs",
      vraag: "Liggen er goederen op voorraad waarvan de kostprijs 0 is?",
      waarom: "De voorraadwaarde op de balans telt deze artikelen voor niets mee. De eindvoorraad is dan te laag.",
      actie: "Kostprijs invullen op het artikel."
    },

    /* ── SCHAKEL 3: VOORRAAD → VERKOOP ──────────────────────────────── */
    {
      id: "3.1", schakel: "verkoop", ernst: "hoog", eenheid: "eur", eigenaar: "Inkoop",
      naam: "Rechtstreeks geleverd zonder gekoppelde inkooporder",
      vraag: "Welke orders gingen rechtstreeks van de leverancier naar de klant zonder dat er een inkooporder aan hangt?",
      waarom: "Bij een rechtstreekse levering komt het goed nooit in Uddel, dus de enige vastlegging dat het is ingekocht is de inkooporder. Ontbreekt die koppeling, dan staat er omzet tegenover een inkoop die nergens te vinden is.",
      actie: "Inkooporder alsnog aan de verkooporder koppelen, of vastleggen waarom er geen inkoop tegenover staat."
    },
    {
      id: "3.2", schakel: "verkoop", ernst: "midden", eenheid: "eur", eigenaar: "Magazijn", zwaar: true,
      naam: "Voorraad handmatig afgeboekt zonder order",
      vraag: "Zijn er goederen afgeboekt zonder verkoop of derving erachter?",
      waarom: "Goederen die verdwijnen zonder verkoop leveren geen omzet op, maar wel een lagere voorraad. Dat verstoort de brutomarge.",
      actie: "Reden vastleggen: derving, breuk, showroom of eigen gebruik."
    },

    /* ── SCHAKEL 4: VERKOOP → FACTUUR ───────────────────────────────── */
    {
      id: "4.1", schakel: "factuur", ernst: "hoog", eenheid: "eur", eigenaar: "Administratie",
      naam: "Geleverd maar niet gefactureerd",
      vraag: "Zijn er goederen de deur uit die nooit op een factuur zijn beland?",
      waarom: "Dit is omzet die je bent misgelopen én de directe reden dat de volledigheid van de omzet niet vast te stellen is.",
      actie: "Alsnog factureren, of onderbouwen waarom niet (garantie, coulance, showroom)."
    },
    {
      id: "4.2", schakel: "factuur", ernst: "midden", eenheid: "eur", eigenaar: "Verkoop",
      naam: "Order afgehandeld terwijl er niets geleverd is",
      vraag: "Staan er orders op 'Afgehandeld' waarvan de regels nooit zijn afgeleverd?",
      waarom: "Afgehandeld zonder levering betekent dat de voorraad niet is afgeboekt terwijl de order wel uit beeld is.",
      actie: "Levering alsnog boeken, of de order terugzetten."
    },

    /* ── SCHAKEL 5: FACTUUR → BANK ──────────────────────────────────── */
    {
      id: "5.1", schakel: "bank", ernst: "hoog", eenheid: "eur", eigenaar: "Administratie",
      naam: "Factuur staat te lang open",
      vraag: "Welke facturen zijn meer dan 90 dagen over de vervaldatum?",
      waarom: "De debiteurenstand loopt vol met posten die nooit binnenkomen. De schakel factuur → bank sluit dan niet.",
      actie: "Innen, een regeling treffen, of afboeken met reden."
    },
    {
      id: "5.2", schakel: "bank", ernst: "midden", eenheid: "eur", eigenaar: "Administratie",
      naam: "Meer ontvangen dan de order groot is",
      vraag: "Zijn er orders waarop meer betaald is dan het factuurbedrag?",
      waarom: "Het verschil staat als schuld aan de klant en hoort terug of verrekend te worden.",
      actie: "Terugbetalen of verrekenen met een volgende order."
    },
    {
      id: "5.3", schakel: "bank", ernst: "midden", eenheid: "eur", eigenaar: "Verkoop",
      naam: "Aanbetaling ontvangen, order blijft liggen",
      vraag: "Staan er orders waarop meer dan 120 dagen geleden is aanbetaald zonder levering?",
      waarom: "Het geld is binnen, de goederen niet geleverd. Dat is een verplichting aan de klant die op de balans hoort.",
      actie: "Uitleveren, of met de klant afstemmen en de order sluiten."
    },

    /* ── DOORSNIJDEND: KOSTPRIJS EN MARGE ───────────────────────────── */
    {
      id: "6.1", schakel: "marge", ernst: "hoog", eenheid: "eur", eigenaar: "Inkoop",
      naam: "Goed verkocht zonder kostprijs",
      vraag: "Welke echte goederen zijn geleverd terwijl de inkoopprijs op de orderregel 0 is?",
      waarom: "Zonder kostprijs is de brutomarge op deze omzet niet te berekenen. Dit is de grootste reden dat kostprijs, omzet en marge niet samenhangen.",
      actie: "Inkoopprijs op de orderregel invullen — vooral bij maatwerk, waar de prijs per order wordt afgesproken."
    },
    {
      id: "6.2", schakel: "marge", ernst: "midden", eenheid: "eur", eigenaar: "Verkoop",
      naam: "Verkocht onder de kostprijs",
      vraag: "Welke geleverde goederen brachten minder op dan ze kostten?",
      waarom: "Soms terecht (actie, showroommodel), maar meestal staat de kostprijs verkeerd of is de omzet op een andere regel geboekt.",
      actie: "Per regel nakijken: klopt de kostprijs, of hoort de omzet ergens anders?"
    }
  ];

  var SCHAKELS = [
    { id: "inkoop",   naam: "Inkoop",   pijl: "→ Voorraad" },
    { id: "voorraad", naam: "Voorraad", pijl: "→ Verkoop" },
    { id: "verkoop",  naam: "Verkoop",  pijl: "→ Factuur" },
    { id: "factuur",  naam: "Factuur",  pijl: "→ Bank" },
    { id: "bank",     naam: "Bank",     pijl: "" },
    { id: "marge",    naam: "Kostprijs & marge", pijl: "" }
  ];

  /* ═══════════════════════════════════════════════════════════════════
     3. HULP
     ═══════════════════════════════════════════════════════════════════ */

  var DAG = 86400000;

  // Hoeveel bevindingsregels er per controle in de momentopname worden
  // bewaard. De momentopname gaat naar KV (limiet 8 MB voor deze bucket) en
  // wordt bij elke keer openen opgehaald, dus hij mag niet onbeperkt groeien.
  // Bij 3.000 past praktisch elke controle er volledig in en blijft het
  // bestand rond de 2 MB. De tellingen (aantal en bedrag) gaan altijd over
  // ALLE regels, ook als de lijst is afgekapt.
  var MAX_REGELS = 3000;
  function dagenGeleden(d) {
    if (!d) return null;
    var t = new Date(d).getTime();
    if (!isFinite(t)) return null;
    return Math.round((Date.now() - t) / DAG);
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  function wacht(ms) { return new Promise(function (k) { setTimeout(k, ms); }); }

  // Een volledige scan is ruim 400 aanroepen naar Logic4. Eén hapering
  // onderweg mag niet het hele resultaat kosten, dus elke aanroep krijgt drie
  // pogingen met oplopende pauze. Logic4 knijpt bij druk af; even wachten is
  // dan precies wat helpt.
  async function metHerkansing(l4, pad, body, melden) {
    var laatste = null;
    for (var poging = 1; poging <= 3; poging++) {
      try { return await l4(pad, body); }
      catch (e) {
        laatste = e;
        if (poging === 3) break;
        if (melden) melden("Logic4 antwoordde niet, poging " + (poging + 1) + " van 3…");
        await wacht(poging * 4000);
      }
    }
    throw laatste;
  }

  // Haal alle pagina's van een Logic4-endpoint op. Logic4 stopt zelf niet:
  // je moet blijven vragen tot je minder terugkrijgt dan je vroeg.
  async function alles(l4, pad, basis, opties) {
    opties = opties || {};
    var per = opties.per || 1000;
    var maxPag = opties.maxPag || 500;
    var skipVeld = opties.skipVeld || "SkipRecords";
    var takeVeld = opties.takeVeld || "TakeRecords";
    var uit = [], skip = 0;
    for (var p = 0; p < maxPag; p++) {
      var body = Object.assign({}, basis);
      body[takeVeld] = per; body[skipVeld] = skip;
      var r = await metHerkansing(l4, pad, body, opties.waarschuwen);
      if (!r || !r.length) break;
      if (opties.perPagina) opties.perPagina(r);
      else uit.push.apply(uit, r);
      if (opties.melden) opties.melden(skip + r.length);
      if (r.length < per) break;
      skip += per;
    }
    return uit;
  }

  /* ═══════════════════════════════════════════════════════════════════
     4. DE SCAN
     ═══════════════════════════════════════════════════════════════════
     opt = {
       l4(pad, body)      → Logic4-aanroep (POST), levert de records
       artikelIndex       → { code: {g,t,k,n} } uit de cache, of null
       vanaf, tot         → periode voor de verkoop-controles (ISO-datum)
       zwaar              → ook de mutatiecontroles (1.3 / 3.2) draaien
       stap(tekst, pct)   → voortgangsmelding
     }
  */
  async function scan(opt) {
    var l4 = opt.l4;
    var melden = opt.stap || function () {};
    var vanaf = opt.vanaf || (new Date().getFullYear() + "-01-01");
    var tot = opt.tot || (new Date().getFullYear() + 1) + "-01-01";
    var resultaat = {};
    var toelichting = {};   // per controle: nuance die de tegel erbij zet
    var gemist = [];        // controles die niet konden draaien, met reden

    // Magazijn-indeling als opzoektabel. Staat hier bovenaan omdat zowel de
    // voorraadcontroles als verwerkOrder() hem gebruiken, en verwerkOrder al
    // draait tijdens het ophalen van de orders.
    var virtueel = {}; magazijnenVanSoort("virtueel").forEach(function (x) { virtueel[x] = 1; });
    var tussen = {}; magazijnenVanSoort("doorstroom").concat(magazijnenVanSoort("vervallen")).forEach(function (x) { tussen[x] = 1; });

    function zet(id, regels, bedrag, extra) {
      resultaat[id] = { regels: regels, bedrag: bedrag };
      if (extra) toelichting[id] = extra;
    }
    function sla(id, reden) { gemist.push({ id: id, reden: reden }); }

    /* ── 4a. Artikel-index ──────────────────────────────────────────── */
    var idx = opt.artikelIndex;
    if (!idx) {
      melden("Artikelbestand ophalen uit Logic4…", 3);
      idx = {};
      var prod = await alles(l4, "/v3/Products/GetProducts", {}, {
        per: 1000, waarschuwen: function (t) { melden(t, 3); }, melden: function (n) { melden("Artikelbestand ophalen… " + n.toLocaleString("nl-NL") + " artikelen", 3 + Math.min(12, n / 5000)); }
      });
      for (var i = 0; i < prod.length; i++) {
        var p = prod[i];
        idx[String(p.ProductCode)] = {
          g: p.ProductGroupId1,
          t: p.ProductGroup1ProductGroupTypeId,
          k: num(p.CostPrice),
          n: String(p.ProductName1 || "").slice(0, 70)
        };
      }
    }
    function artikel(code) { return idx[String(code)] || null; }

    /* ── 4b. Voorraad ───────────────────────────────────────────────────
       In één stroom over alle magazijnen. Per magazijn opvragen zou ruim 500
       aanroepen kosten, zo zijn het er ~190. Logic4 geeft ook alle nul-regels
       terug (bijna 200.000); die gooien we meteen weg zodat er niets onnodig
       in het geheugen blijft staan. */
    melden("Voorraad ophalen…", 18);
    var voorraad = [];   // {code, mag, qty, res}
    await alles(l4, "/v3/Stock/GetStockForWarehouses", {}, {
      per: 1000,
      waarschuwen: function (t) { melden(t, 18); },
      perPagina: function (rijen) {
        for (var q = 0; q < rijen.length; q++) {
          var v = rijen[q];
          if (num(v.Qty) === 0 && num(v.QtyReserved) === 0) continue;
          voorraad.push({ code: String(v.ProductCode), mag: num(v.WarehouseId), qty: num(v.Qty), res: num(v.QtyReserved) });
        }
      },
      melden: function (n) { melden("Voorraad ophalen… " + n.toLocaleString("nl-NL") + " regels doorlopen", 18 + Math.min(14, n / 14000)); }
    });

    /* ── 4c. Inkoop ─────────────────────────────────────────────────────
       Inkoop gaat vóór verkoop, want controle 3.1 moet bij elke verkooporder
       weten of er een inkooporder aan hangt.

       Let op de opzet hieronder: de inkooporderregels (ruim 140.000) en de
       verkooporders (bijna 30.000 mét al hun regels) worden NIET als lijst
       bewaard. Samen is dat bijna 200 MB aan gegevens, en als objecten in het
       geheugen een veelvoud daarvan — genoeg om de tegel op een gewone
       werk-pc te laten klappen. Elke pagina wordt daarom meteen verwerkt en
       daarna losgelaten; alleen de bevindingen blijven staan. */
    melden("Inkooporders ophalen…", 34);
    var inkoop = await alles(l4, "/v3/BuyOrders/GetBuyOrders", { BuyOrderIsClosed: false }, { per: 500, waarschuwen: function (t) { melden(t, 34); } });
    var openIds = {}; for (var a = 0; a < inkoop.length; a++) openIds[inkoop[a].Id] = inkoop[a];
    var perInkoop = {};    // per open inkooporder: nog te leveren + waarde
    var heeftInkoop = {};  // verkoopordernummer → er hangt een inkooporder aan
    var inkoopRegelAantal = 0;

    melden("Inkooporderregels ophalen…", 38);
    if (opt.inkoopRegels) {
      for (var vr = 0; vr < opt.inkoopRegels.length; vr++) verwerkInkoopRegel(opt.inkoopRegels[vr]);
      inkoopRegelAantal = opt.inkoopRegels.length;
    } else {
      await alles(l4, "/v3/BuyOrders/GetBuyOrderRowsByFilter", {}, {
        per: 1000, waarschuwen: function (t) { melden(t, 38); },
        perPagina: function (rijen) { for (var i = 0; i < rijen.length; i++) { verwerkInkoopRegel(rijen[i]); inkoopRegelAantal++; } },
        melden: function (n) { melden("Inkooporderregels ophalen… " + n.toLocaleString("nl-NL"), 38 + Math.min(14, n / 10000)); }
      });
    }

    /* ── 4d. Verkooporders in de periode ────────────────────────────── */
    // Verzamelbakken voor de controles die op orders slaan. Ze staan hier
    // omdat verwerkOrder() ze al vult tijdens het ophalen.
    var c31 = [], c41 = [], c42 = [], c52 = [], c53 = [], c61 = [], c62 = [];
    var verzamel61 = { aantal: 0, bedrag: 0 };   // kassa-artikelen apart houden
    var dienst61 = { aantal: 0, bedrag: 0 };     // transport/montage: normaal
    var samen61 = { aantal: 0, bedrag: 0 };      // samengesteld: kostprijs op de delen

    melden("Verkooporders ophalen…", 54);
    var orderAantal = 0;
    await alles(l4, "/v3/Orders/GetOrders",
      { CreationDateFrom: vanaf, CreationDateTo: tot, LoadPayments: true },
      { per: 500, waarschuwen: function (t) { melden(t, 54); },
        perPagina: function (rijen) { for (var i = 0; i < rijen.length; i++) { verwerkOrder(rijen[i]); orderAantal++; } },
        melden: function (n) { melden("Verkooporders ophalen… " + n.toLocaleString("nl-NL"), 54 + Math.min(22, n / 1400)); } });

    /* ── 4e. Openstaande facturen ───────────────────────────────────── */
    melden("Openstaande facturen ophalen…", 78);
    var openFacturen = [];
    try { openFacturen = await metHerkansing(l4, "/v3/Orders/GetOpenPaymentInvoices", {}, function (t) { melden(t, 78); }) || []; }
    catch (e) { sla("5.1", "openstaande facturen niet op te halen: " + e.message); }

    /* ── 4f. Voorraadmutaties (alleen bij een diepe scan) ───────────── */
    var mutaties = null;
    if (opt.zwaar) {
      melden("Voorraadmutaties ophalen (dit duurt even)…", 82);
      mutaties = await alles(l4, "/v3/Stock/GetProductStockMutations", { DateFrom: vanaf, DateTo: tot }, {
        per: 1000, maxPag: 900, waarschuwen: function (t) { melden(t, 82); },
        melden: function (n) { melden("Voorraadmutaties ophalen… " + n.toLocaleString("nl-NL"), 82 + Math.min(8, n / 60000)); }
      });
    } else {
      sla("1.3", "handmatige correcties zijn niet meegescand (zet 'diepe controle' aan)");
      sla("3.2", "handmatige correcties zijn niet meegescand (zet 'diepe controle' aan)");
    }

    melden("Controles uitvoeren…", 92);

    /* ═══════════════ SCHAKEL 1: INKOOP ═══════════════ */

    // Wordt tijdens het ophalen per regel aangeroepen (zie 4c). Twee dingen
    // worden onthouden: wat er per open inkooporder nog moet komen, en welke
    // verkooporders überhaupt een inkooporder achter zich hebben. Logic4 zet
    // het verkoopordernummer op de inkooporderregel (OrderId); dat is de enige
    // harde koppeling tussen inkoop en verkoop die er is.
    function verwerkInkoopRegel(ir) {
      if (ir.OrderId) heeftInkoop[Number(ir.OrderId)] = 1;
      if (!openIds[ir.BuyOrderId]) return;
      var pot = perInkoop[ir.BuyOrderId] || (perInkoop[ir.BuyOrderId] = { teLeveren: 0, waarde: 0, regels: 0, eerste: "" });
      pot.regels++;
      pot.teLeveren += num(ir.QtyToDeliver);
      pot.waarde += num(ir.QtyToDeliver) * num(ir.Price);
      if (!pot.eerste) pot.eerste = String(ir.ProductDesc1 || ir.Description || "");
    }

    var c11 = [], c12 = [];
    for (var o1 = 0; o1 < inkoop.length; o1++) {
      var bo = inkoop[o1];
      var pot2 = perInkoop[bo.Id] || { teLeveren: 0, waarde: 0, regels: 0, eerste: "" };
      var oud = dagenGeleden(bo.CreatedAt);
      if (pot2.teLeveren <= 0) {
        // Alles binnen, order staat nog open. Pas melden na 90 dagen, anders
        // krijg je elke week alle verse orders in de lijst.
        if (oud !== null && oud > 90) c11.push({
          sleutel: "1.1|" + bo.Id, verwijzing: "Inkooporder " + bo.Id,
          wie: bo.CreditorCompanyName || "", datum: bo.CreatedAt,
          omschrijving: pot2.eerste || bo.Remarks || "", aantal: oud, bedrag: 0,
          detail: oud + " dagen open, alles is ontvangen"
        });
      } else if (oud !== null && oud > 180) {
        c12.push({
          sleutel: "1.2|" + bo.Id, verwijzing: "Inkooporder " + bo.Id,
          wie: bo.CreditorCompanyName || "", datum: bo.CreatedAt,
          omschrijving: pot2.eerste || bo.Remarks || "", aantal: pot2.teLeveren, bedrag: pot2.waarde,
          detail: oud + " dagen open, nog " + pot2.teLeveren + " stuks te ontvangen"
        });
      }
    }
    zet("1.1", c11, c11.length);
    zet("1.2", c12, c12.reduce(function (s, x) { return s + x.bedrag; }, 0));

    if (mutaties) {
      var c13 = [], c32 = [];
      for (var mm = 0; mm < mutaties.length; mm++) {
        var mu = mutaties[mm];
        var soortId = num(mu.StockMutationTypeId);
        if (soortId !== 9 && soortId !== 7) continue;          // 9 = bijboeking overig, 7 = afboeking overig
        var art = artikel(mu.ProductCode);
        var waarde = Math.abs(num(mu.Amount) * (num(mu.BuyPrice) || (art ? art.k : 0)));
        var regel = {
          sleutel: (soortId === 9 ? "1.3|" : "3.2|") + mu.ProductCode + "|" + String(mu.MutationDateTime).slice(0, 19),
          verwijzing: "Artikel " + mu.ProductCode,
          wie: "", datum: mu.MutationDateTime,
          omschrijving: art ? art.n : "", aantal: num(mu.Amount), bedrag: waarde,
          detail: mu.StockMutationType + (mu.Remarks ? " — " + mu.Remarks : "")
        };
        if (soortId === 9) { if (!mu.BuyOrderId) c13.push(regel); }
        else c32.push(regel);
      }
      zet("1.3", c13, c13.reduce(function (s, x) { return s + x.bedrag; }, 0),
        "Alleen correcties zonder inkooporder erachter. Logic4 levert bij deze mutaties geen gebruikersnaam mee — wie het deed staat wel in Logic4 zelf.");
      zet("3.2", c32, c32.reduce(function (s, x) { return s + x.bedrag; }, 0));
    }

    /* ═══════════════ SCHAKEL 2: VOORRAAD ═══════════════ */

    var c21 = [], c22 = [], c23 = [], c24 = [];
    for (var vv = 0; vv < voorraad.length; vv++) {
      var s = voorraad[vv];
      var art2 = artikel(s.code);
      var naam = art2 ? art2.n : "";
      var mg = magazijn(s.mag);
      var basis = {
        sleutel: s.code + "|" + s.mag, verwijzing: "Artikel " + s.code,
        wie: mg.naam, datum: null, omschrijving: naam, aantal: s.qty, bedrag: 0
      };
      if (s.qty < 0) {
        c21.push(Object.assign({}, basis, { sleutel: "2.1|" + basis.sleutel, bedrag: Math.abs(s.qty) * (art2 ? art2.k : 0), detail: s.qty + " stuks in " + mg.naam }));
      }
      if (s.qty > 0 && virtueel[s.mag]) {
        c22.push(Object.assign({}, basis, { sleutel: "2.2|" + basis.sleutel, bedrag: s.qty * (art2 ? art2.k : 0), detail: s.qty + " stuks staan in " + mg.naam + ", waar niets ligt" }));
      }
      if (s.qty > 0 && tussen[s.mag]) {
        c23.push(Object.assign({}, basis, { sleutel: "2.3|" + basis.sleutel, bedrag: s.qty * (art2 ? art2.k : 0), detail: s.qty + " stuks blijven staan in " + mg.naam }));
      }
      if (s.qty > 0 && mg.soort === "fysiek" && art2 && art2.t === GOED && !art2.k && !isVerzamelartikel(s.code)) {
        c24.push(Object.assign({}, basis, { sleutel: "2.4|" + basis.sleutel, bedrag: 0, detail: s.qty + " stuks in " + mg.naam + " tellen voor 0 euro mee" }));
      }
    }
    zet("2.1", c21, c21.reduce(function (t, x) { return t + Math.abs(x.aantal); }, 0));
    zet("2.2", c22, c22.reduce(function (t, x) { return t + x.aantal; }, 0));
    zet("2.3", c23, c23.reduce(function (t, x) { return t + x.aantal; }, 0));
    zet("2.4", c24, c24.reduce(function (t, x) { return t + x.aantal; }, 0));

    /* ═══════════════ SCHAKEL 3–6: ORDERS ═══════════════ */

    // Wordt tijdens het ophalen per order aangeroepen (zie 4d), zodat de order
    // daarna weer uit het geheugen mag verdwijnen.
    function verwerkOrder(ord) {
      if (isGeenVerkoop(ord)) return;
      var status = (ord.OrderStatus && ord.OrderStatus.Value) || "";
      var rows = ord.OrderRows || [];
      var totaal = ord.Totals || {};
      var incl = num(totaal.AmountIncl), betaald = num(totaal.Calc_TotalPayed);
      var ouderdom = dagenGeleden(ord.CreationDate);

      // 5.2 — meer ontvangen dan de order groot is.
      // Alleen bij een positief orderbedrag. Creditorders hebben een negatief
      // bedrag en 0 betaald; die zouden hier anders allemaal als "te veel
      // ontvangen" binnenkomen terwijl Logic4 ze als afgewikkeld beschouwt
      // (IsPaid staat op waar — de terugbetaling loopt via de bank, niet via
      // een betaalregel op de order).
      if (incl > 0 && betaald - incl > 1) c52.push({
        sleutel: "5.2|" + ord.Id, verwijzing: "Order " + ord.Id, wie: String(ord.DebtorId || ""),
        datum: ord.CreationDate, omschrijving: ord.Description || "", aantal: 1, bedrag: betaald - incl,
        detail: "order " + incl.toFixed(2) + ", ontvangen " + betaald.toFixed(2)
      });

      var ietsGeleverd = false, allesGeleverd = rows.length > 0;
      var rechtstreeksWaarde = 0, rechtstreeksMag = "", rechtstreeksWat = "";
      for (var rr = 0; rr < rows.length; rr++) {
        var row = rows[rr];
        var qd = num(row.QtyDeliverd), qty = num(row.Qty);
        var np = num(row.NettPrice), bp = num(row.BuyPrice);
        var code = String(row.ProductCode || "");
        var art3 = artikel(code);
        var soortArt = art3 ? art3.t : 0;
        if (qd > 0) ietsGeleverd = true;
        if (qd < qty) allesGeleverd = false;

        var regelBasis = {
          verwijzing: "Order " + ord.Id, wie: String(ord.DebtorId || ""), datum: ord.CreationDate,
          omschrijving: (row.Description || (art3 ? art3.n : "")) + (code ? "  [" + code + "]" : "")
        };

        // 4.1 — geleverd maar niet gefactureerd
        var nietGef = num(row.QtyDeliverd_NotInvoiced);
        if (nietGef > 0) c41.push(Object.assign({}, regelBasis, {
          sleutel: "4.1|" + ord.Id + "|" + row.Id, aantal: nietGef, bedrag: nietGef * np,
          detail: nietGef + " stuks geleverd, niet op een factuur"
        }));

        // 3.1 — rechtstreekse levering: optellen, de beoordeling volgt na de
        // regels want de koppeling met de inkooporder ligt op ORDER-niveau.
        if (qd > 0 && virtueel[num(row.WarehouseId)]) {
          rechtstreeksWaarde += qd * np;
          if (!rechtstreeksMag) rechtstreeksMag = magazijn(num(row.WarehouseId)).naam;
          if (!rechtstreeksWat) rechtstreeksWat = String(row.Description || "");
        }

        if (qd <= 0 || np <= 0) continue;

        // 6.1 — echt goed geleverd zonder kostprijs
        if (bp <= 0) {
          if (soortArt === DIENST) { dienst61.aantal++; dienst61.bedrag += qd * np; }
          else if (soortArt === SAMENGESTELD) { samen61.aantal++; samen61.bedrag += qd * np; }
          else if (isVerzamelartikel(code)) { verzamel61.aantal++; verzamel61.bedrag += qd * np; }
          else if (soortArt === GOED) c61.push(Object.assign({}, regelBasis, {
            sleutel: "6.1|" + ord.Id + "|" + row.Id, aantal: qd, bedrag: qd * np,
            detail: "omzet " + (qd * np).toFixed(2) + " zonder inkoopprijs"
          }));
        }
        // 6.2 — onder de kostprijs verkocht
        else if (np < bp && (soortArt === GOED || soortArt === SAMENGESTELD)) c62.push(Object.assign({}, regelBasis, {
          sleutel: "6.2|" + ord.Id + "|" + row.Id, aantal: qd, bedrag: qd * (bp - np),
          detail: "inkoop " + bp.toFixed(2) + " tegen verkoop " + np.toFixed(2)
        }));
      }

      // 3.1 — rechtstreeks geleverd, maar nergens een inkooporder die naar
      // deze verkooporder verwijst.
      if (rechtstreeksWaarde > 0 && !heeftInkoop[Number(ord.Id)]) c31.push({
        sleutel: "3.1|" + ord.Id, verwijzing: "Order " + ord.Id, wie: String(ord.DebtorId || ""),
        datum: ord.CreationDate, omschrijving: rechtstreeksWat || ord.Description || "",
        aantal: 1, bedrag: rechtstreeksWaarde,
        detail: "geleverd via " + rechtstreeksMag + ", geen inkooporder gekoppeld"
      });

      // 4.2 — afgehandeld terwijl er niets geleverd is
      if (/afgehandeld/i.test(status) && rows.length && !ietsGeleverd && incl > 0) c42.push({
        sleutel: "4.2|" + ord.Id, verwijzing: "Order " + ord.Id, wie: String(ord.DebtorId || ""),
        datum: ord.CreationDate, omschrijving: ord.Description || "", aantal: rows.length, bedrag: incl,
        detail: "status Afgehandeld, geen enkele regel geleverd"
      });

      // 5.3 — aanbetaling binnen, order blijft liggen
      if (betaald > 1 && !allesGeleverd && !/afgehandeld|geannuleerd/i.test(status) && ouderdom !== null && ouderdom > 120) c53.push({
        sleutel: "5.3|" + ord.Id, verwijzing: "Order " + ord.Id, wie: String(ord.DebtorId || ""),
        datum: ord.CreationDate, omschrijving: ord.Description || "", aantal: ouderdom, bedrag: betaald,
        detail: ouderdom + " dagen geleden aanbetaald, nog niet volledig geleverd (" + status + ")"
      });
    }

    zet("3.1", c31, c31.reduce(function (t, x) { return t + x.bedrag; }, 0));
    zet("4.1", c41, c41.reduce(function (t, x) { return t + x.bedrag; }, 0));
    zet("4.2", c42, c42.reduce(function (t, x) { return t + x.bedrag; }, 0));
    zet("5.2", c52, c52.reduce(function (t, x) { return t + x.bedrag; }, 0));
    zet("5.3", c53, c53.reduce(function (t, x) { return t + x.bedrag; }, 0));
    zet("6.1", c61, c61.reduce(function (t, x) { return t + x.bedrag; }, 0),
      "Buiten deze lijst gehouden omdat kostprijs 0 daar normaal is: " +
      dienst61.aantal + " regels transport/montage/korting (" + Math.round(dienst61.bedrag).toLocaleString("nl-NL") + " euro), " +
      samen61.aantal + " samengestelde artikelen (" + Math.round(samen61.bedrag).toLocaleString("nl-NL") + " euro) en " +
      verzamel61.aantal + " kassa-verzamelartikelen (" + Math.round(verzamel61.bedrag).toLocaleString("nl-NL") + " euro).");
    zet("6.2", c62, c62.reduce(function (t, x) { return t + x.bedrag; }, 0));

    /* ═══════════════ SCHAKEL 5: OPENSTAANDE FACTUREN ═══════════════ */

    if (openFacturen.length) {
      var c51 = [];
      for (var f = 0; f < openFacturen.length; f++) {
        var fac = openFacturen[f];
        var telaat = num(fac.DaysPastDueDate);
        if (telaat <= 90) continue;
        c51.push({
          sleutel: "5.1|" + fac.InvoiceId, verwijzing: "Factuur " + fac.InvoiceId,
          wie: String(fac.DebtorId || ""), datum: fac.InvoiceDate,
          omschrijving: "", aantal: telaat, bedrag: num(fac.AmountOutstanding),
          detail: telaat + " dagen over de vervaldatum, open " + num(fac.AmountOutstanding).toFixed(2)
        });
      }
      var totOpen = openFacturen.reduce(function (t, x) { return t + num(x.AmountOutstanding); }, 0);
      zet("5.1", c51, c51.reduce(function (t, x) { return t + x.bedrag; }, 0),
        "In totaal staat er " + Math.round(totOpen).toLocaleString("nl-NL") + " euro open over " + openFacturen.length + " facturen; hierboven staan alleen de posten van meer dan 90 dagen te laat.");
    }

    melden("Klaar", 100);

    /* ═══════════════ SAMENVATTEN ═══════════════ */

    var uitkomst = { gemaakt: new Date().toISOString(), vanaf: vanaf, tot: tot, zwaar: !!opt.zwaar, controles: [], gemist: gemist,
      omvang: { orders: orderAantal, voorraadregels: voorraad.length, inkooporders: inkoop.length,
                inkoopregels: inkoopRegelAantal, artikelen: Object.keys(idx).length,
                mutaties: mutaties ? mutaties.length : 0, openFacturen: openFacturen.length } };

    for (var c = 0; c < CONTROLES.length; c++) {
      var def = CONTROLES[c];
      var uit = resultaat[def.id];
      var overgeslagen = gemist.filter(function (x) { return x.id === def.id; })[0];
      var regels = uit ? uit.regels : [];
      // De momentopname gaat naar KV; alles bewaren maakt hem onnodig zwaar.
      // De zwaarste regels eerst, zodat afkappen nooit het belangrijkste raakt.
      var gesorteerd = regels.slice().sort(function (x, y) { return (y.bedrag || 0) - (x.bedrag || 0) || (y.aantal || 0) - (x.aantal || 0); });
      uitkomst.controles.push({
        id: def.id, schakel: def.schakel, naam: def.naam, vraag: def.vraag, waarom: def.waarom,
        actie: def.actie, eigenaar: def.eigenaar, ernst: def.ernst, eenheid: def.eenheid,
        gedraaid: !overgeslagen, reden: overgeslagen ? overgeslagen.reden : "",
        aantal: regels.length, bedrag: uit ? uit.bedrag : 0,
        toelichting: toelichting[def.id] || "",
        regels: gesorteerd.slice(0, MAX_REGELS),
        afgekapt: gesorteerd.length > MAX_REGELS
      });
    }
    // LET OP: de momentopname (uitkomst) gaat naar KV en moet klein blijven.
    // De artikel-index is enkele MB's en gaat bewust NIET mee, maar komt wel
    // apart terug zodat een volgende scan hem kan hergebruiken.
    return { momentopname: uitkomst, hergebruik: { artikelIndex: idx } };
  }

  global.ggEngine = {
    scan: scan,
    CONTROLES: CONTROLES,
    SCHAKELS: SCHAKELS,
    MAGAZIJNEN: MAGAZIJNEN,
    magazijn: magazijn,
    alles: alles
  };

})(typeof window !== "undefined" ? window : globalThis);
