/* ═══════════════════════════════════════════════════════════════════════════
   SPA-AFMETINGEN - hoe groot is een model, en waar komt dat vandaan
   ═══════════════════════════════════════════════════════════════════════════

   Waarom
   ------
   De maten van de spa's staan op vier plekken, en tot 10 aug 2026 gebruikte
   elke tegel er maar één van:

   0. Wat Chantal zelf heeft ingevuld (bucket 'spa-maten' bij de worker). Die
      gaat vóór alles. De drie bestanden hieronder zijn wat leveranciers ooit
      hebben aangeleverd; dit is wat er volgens de persoon die de containers
      boekt echt klopt. Zij kan elke maat overschrijven, ook een die er al is,
      en met één klik weer terug naar automatisch.
   1. De prijslijsten van de fabrieken (spa-fabrikanten.js, veld 'afmeting',
      in millimeters). Die maat is leidend: de fabriek laadt de container en
      rekent met zijn eigen getal.
   2. De verpakkingslijst (packaging-database.json, uit 'Maten + gewichten.xlsx').
      Dat is de maat van de kist zoals hij vervoerd wordt, inclusief gewicht -
      voor laden eigenlijk het eerlijkste getal. Hier staan onder andere de
      vier barrelsauna's van Fonteyn in, die nergens anders een maat hebben.
   3. De specificatiesheets (spec-database.json, veld 'dims', in centimeters).
      Daar staan de modellen die niet op een prijslijst staan - de ijsbaden,
      de Grizzly Spas, de Devine Spas en de Storm Spas.

   Met alleen bron 1 was van 69 van de 149 modellen de maat onbekend. Met alle
   drie zijn het er nog 27. Dat verschil is niet cosmetisch: zonder maat telt
   een spa niet mee in het containervolume, en dan wordt de schatting van het
   aantal containers te laag.

   Een product in de verpakkingslijst met méér dan één kist wordt overgeslagen.
   Zo'n product gaat als losse kisten de container in en niet als één blok; die
   voor het gemak optellen zou een maat opleveren die nergens bestaat.

   Waarom de prijslijst wint bij een verschil
   ------------------------------------------
   Bij zestien modellen die in allebei staan schelen de maten een paar
   centimeter (Euphoria 228x228x86 tegen 230x230x91, Heart 202x169x78 tegen
   210x170x78). Die verschillen worden niet gladgestreken: de prijslijst gaat
   voor, en wie het navraagt kan zien welke bron gebruikt is.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  // De specsheets noemen de modellen met hun merk ervoor ("Grizzly Spas
  // Kenai", "Wim Hof's Ice Barrel"). Die aanloop gaat eraf zodat de kale naam
  // overblijft en op de prijslijst-naam past.
  var VOORVOEGSEL = /^(spec ?sheets? |grizzly spas |devine spas |storm spas |eden spas |tropical spas sheets |wim hof.?s ice |the |spa )/i;

  function sleutel(s) {
    var t = String(s || "").toLowerCase().trim().replace(/\s*spec ?sheets?\s*$/, "");
    for (var i = 0; i < 4; i++) {
      var n = t.replace(VOORVOEGSEL, "");
      if (n === t) break;
      t = n;
    }
    return t.replace(/[^a-z0-9]/g, "");
  }

  /* Namen die niet vanzelf op elkaar vallen. Elke regel is een vaststelling en
     geen gok:
     - de vijf Revive-kleuren zijn hetzelfde bad in een andere kleur;
     - Elevate en Vital Ice staan onder twee namen omdat ze via twee
       leveranciers binnenkomen (Jazzi in dollars, Innerfire in euro's). */
  var HANDMATIG = {
    wimhofbarrel:      "Wim Hof's Ice Barrel",
    breezeicebath:     "Wim Hof's Ice Breeze",
    elevateicebath:    "Wim Hof's Ice Elevate",
    vitaliceicebath:   "Team Ice Vital Ice",
    revivemossstone:   "Wim Hof's Ice Revive",
    reviveearthgrey:   "Wim Hof's Ice Revive",
    revivegranitegrey: "Wim Hof's Ice Revive",
    reviveiceblue:     "Wim Hof's Ice Revive",
    reviveblackmarble: "Wim Hof's Ice Revive",
    /* De Turbines heten sinds 26 aug 2026 voluit Luxury (de ST-codes) of Grand
       (de T-codes). De specsheets die wij hebben zijn ouder en voeren de kale
       naam - en dat zijn de Luxury: de tekening van de Turbine 6 Luxury geeft
       5880 x 2400 mm en de sheet "Storm Spas Turbine 6" 590 x 240 cm. De Grand
       is een andere spa (3000 mm breed) en wordt hier dus niet aan gekoppeld. */
    turbine5luxury:    "Turbine 5",
    turbine6luxury:    "Turbine 6",
    turbine7luxury:    "Turbine 7",
  };

  /* De verpakkingslijst noemt de barrelsauna's korter dan de prijslijst.
     Handmatig gekoppeld; de maten en gewichten komen overeen met wat er op de
     pakbon staat, dus dit is een vaststelling en geen gok. */
  var PAKKET_HANDMATIG = {
    barrelsauna4ft:     "Barrel 4ft",
    barrelsauna6ft:     "Barrel 6 ft",
    barrelsauna8ft:     "Barrel 8 ft",
    barrelsauna71combi: "Barrel 7+1 ft",
  };

  var index = null;   // null = de specsheets zijn nog niet geladen
  var pakket = null;  // null = de verpakkingslijst is nog niet geladen
  var hand = null;    // null = de handmatige maten zijn nog niet geladen

  var WORKER = "https://fonteyn-data-store.g-mulder.workers.dev";
  var BUCKET = WORKER + "/data/spa-maten";
  function teamSleutel() {
    try { return localStorage.getItem("fp.teamkey") || ""; } catch (e) { return ""; }
  }

  /* De sleutel waaronder een handmatige maat wordt bewaard.

     De modelnaam, want dat is het enige dat alle tegels gemeen hebben: de
     Amerika-tegel kent alleen een naam en geen fabriekscode. Heeft een regel
     geen modelnaam (twee Jazzi-regels hebben dat niet), dan de code. */
  function handSleutel(model, code) {
    return sleutel(model) || ("code:" + sleutel(code));
  }

  function bouwIndex(db) {
    var uit = {};
    for (var k in (db || {})) {
      if (!Object.prototype.hasOwnProperty.call(db, k)) continue;
      var d = db[k] && db[k].dims;
      if (!d) continue;
      var p = (String(d).match(/[\d.]+/g) || []).map(Number);
      if (p.length !== 3) continue;
      var goed = true;
      for (var i = 0; i < 3; i++) if (!(p[i] > 0)) goed = false;
      if (!goed) continue;
      var n = sleutel(k);
      if (!uit[n]) uit[n] = { l: p[0], b: p[1], h: p[2], sheet: k };
    }
    return uit;
  }

  function bouwPakket(db) {
    var uit = {};
    var cats = (db && db.categories) || [];
    for (var i = 0; i < cats.length; i++) {
      var pr = cats[i].products || [];
      for (var j = 0; j < pr.length; j++) {
        var dozen = (pr[j].boxes || []).filter(function (b) { return b && b.dims; });
        // Meer dan één kist: dat is geen enkele maat, dus overslaan.
        if (dozen.length !== 1) continue;
        var d = dozen[0].dims;
        if (!(d.l > 0 && d.w > 0 && d.h > 0)) continue;
        var n = sleutel(pr[j].name);
        if (!uit[n]) uit[n] = { l: d.l, b: d.w, h: d.h, kg: dozen[0].weight || null, naam: pr[j].name };
      }
    }
    return uit;
  }

  function zet(db) { index = bouwIndex(db); return aantal(); }
  function zetPakket(db) { pakket = bouwPakket(db); return Object.keys(pakket).length; }
  function aantal() { return index ? Object.keys(index).length : 0; }
  function geladen() { return index !== null; }

  // De twee bestanden ophalen. Faalt er een, dan blijft die bron leeg en werkt
  // alles gewoon door op wat er wél is - er gaat dus nooit iets stuk.
  function haal(pad, klaar, leeg) {
    return fetch(pad)
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(klaar)
      .catch(function (e) { console.warn(pad + " laden faalde:", e.message); return leeg(); });
  }
  function laad() {
    if (index && pakket && hand) return Promise.resolve(aantal());
    if (typeof fetch !== "function") {
      index = index || {}; pakket = pakket || {}; hand = hand || {};
      return Promise.resolve(0);
    }
    return Promise.all([
      index  ? aantal() : haal("/spec-database.json", zet, function () { index = {}; return 0; }),
      pakket ? 0        : haal("/packaging-database.json", zetPakket, function () { pakket = {}; return 0; }),
      hand   ? 0        : laadHand(),
    ]).then(function () { return aantal(); });
  }

  // De handmatige maten bij de worker. Lukt het niet, dan werkt alles door op
  // de bestanden; er verdwijnt dus nooit een maat door een storing.
  function laadHand() {
    return fetch(BUCKET + "?t=" + (typeof performance !== "undefined" ? Math.round(performance.now()) : ""), {
      headers: { "X-Fonteyn-Auth": teamSleutel() },
    })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { hand = (j && j.maten) || {}; return Object.keys(hand).length; })
      .catch(function (e) { console.warn("handmatige maten laden faalde:", e.message); hand = {}; return 0; });
  }

  /* Eén maat vastleggen. maat = {l,b,h} in centimeters, of null om hem weer
     op automatisch te zetten. Er wordt bijgehouden wie het invulde en wanneer,
     want een maat die niet klopt moet navraagbaar zijn. */
  function bewaarMaat(model, code, maat, door) {
    if (!hand) hand = {};
    var k = handSleutel(model, code);
    if (!k) return Promise.reject(new Error("Dit model heeft geen naam en geen code."));
    // Een bestaande covermaat blijft staan: die gaat over de cover en niet
    // over de spa, en anders raakt hij hem kwijt zodra iemand de spa aanpast.
    var rec = hand[k] || {};
    if (maat) {
      hand[k] = {
        l: Number(maat.l), b: Number(maat.b), h: Number(maat.h),
        kg: maat.kg != null && maat.kg !== "" ? Number(maat.kg) : null,
        cover: rec.cover,
        model: model || "", code: code || "",
        door: door || "", op: new Date().toISOString(),
      };
      if (hand[k].cover === undefined) delete hand[k].cover;
    } else if (rec.cover !== undefined) {
      hand[k] = { cover: rec.cover, model: model || "", code: code || "",
                  door: door || "", op: new Date().toISOString() };
    } else {
      delete hand[k];
    }
    return fetch(BUCKET, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": teamSleutel() },
      body: JSON.stringify({ maten: hand, updated: new Date().toISOString() }),
    }).then(function (r) {
      if (!r.ok) throw new Error("opslaan faalde (HTTP " + r.status + ")");
      return hand[k] || null;
    });
  }

  function handmatigVan(model, code) {
    if (!hand) return null;
    var h = hand[handSleutel(model, code)];
    if (!h || !(h.l > 0 && h.b > 0 && h.h > 0)) return null;
    return { l: h.l, b: h.b, h: h.h, kg: h.kg || null, bron: "handmatig", sheet: null, door: h.door, op: h.op };
  }
  function handmatigAantal() { return hand ? Object.keys(hand).length : 0; }

  function uitSpecsheet(model) {
    if (!index) return null;
    var n = sleutel(model);
    var via = HANDMATIG[n];
    var hit = via ? index[sleutel(via)] : index[n];
    return hit ? { l: hit.l, b: hit.b, h: hit.h, bron: "specsheet", sheet: hit.sheet } : null;
  }

  function uitVerpakking(model) {
    if (!pakket) return null;
    var n = sleutel(model);
    var via = PAKKET_HANDMATIG[n];
    var hit = via ? pakket[sleutel(via)] : pakket[n];
    return hit ? { l: hit.l, b: hit.b, h: hit.h, kg: hit.kg, bron: "verpakkingslijst", sheet: hit.naam } : null;
  }

  /* De maat van één model, in CENTIMETERS.
     afmetingMm is het veld 'afmeting' van de prijslijst ("3940x2260x1260",
     millimeters). Volgorde: wat Chantal zelf invulde, dan de prijslijst, dan
     de kistmaat uit de verpakkingslijst, dan de specsheet. De kistmaat staat
     vóór de specsheet omdat je een kist in een container zet en geen product. */
  function maatVan(model, afmetingMm, code) {
    var eigen = handmatigVan(model, code);
    if (eigen) return eigen;
    var p = String(afmetingMm || "").split("x").map(Number);
    if (p.length === 3 && p[0] > 0 && p[1] > 0 && p[2] > 0) {
      return { l: p[0] / 10, b: p[1] / 10, h: p[2] / 10, bron: "prijslijst", sheet: null };
    }
    return uitVerpakking(model) || uitSpecsheet(model);
  }

  // Wat de maat zou zijn zonder de handmatige invulling. Nodig in het scherm:
  // je moet kunnen zien wat je overschrijft voor je het overschrijft.
  function automatischVan(model, afmetingMm) {
    var p = String(afmetingMm || "").split("x").map(Number);
    if (p.length === 3 && p[0] > 0 && p[1] > 0 && p[2] > 0) {
      return { l: p[0] / 10, b: p[1] / 10, h: p[2] / 10, bron: "prijslijst", sheet: null };
    }
    return uitVerpakking(model) || uitSpecsheet(model);
  }

  function m3Van(model, afmetingMm, code) {
    var m = maatVan(model, afmetingMm, code);
    return m ? (m.l / 100) * (m.b / 100) * (m.h / 100) : null;
  }

  /* ─── Covers ──────────────────────────────────────────────────────────────
     Elke spa gaat met zijn cover mee de container in. Die telt dus mee, en tot
     10 aug 2026 deed hij dat niet.

     De maat volgt uit de spa zelf (Gerrit, 10 aug 2026):
     - De cover is een paar centimeter groter dan de spa: 200 x 200 wordt
       203 x 203.
     - Hij wordt dubbelgevouwen over de LÁNGSTE kant: de eerste maat gaat door
       de helft, de tweede blijft heel. Gerrit (3 sep 2026): "de regel is: het
       eerste getal is het getal wat gevouwen wordt. Een cover die 590 x 277
       heet wordt gevouwen over de 590-kant, dus door de helft is dat
       295 x 277."

       Hier stond het omgekeerde: de korte kant werd gehalveerd en de lange
       bleef staan. Een cover van 590 x 277 werd zo 590 x 138,5. Dat is bijna
       zes meter, en daarom paste een swimspa-cover naast twee spa's net niet
       meer in de container. Dat is nooit een ladingsprobleem geweest maar een
       rekenfout: in werkelijkheid is hij 295 lang. De opdeling in twee delen
       hieronder rekent nu dus met de goede lengte en komt veel minder vaak in
       actie.
     - Onopgevouwen is hij 10 cm dik aan de buitenranden en 12 cm bij de vouw
       in het midden. Dubbelgevouwen wordt dat 20 cm en 24 cm.

     Voor het stapelen rekenen we met die 24: dat is de dikste plek en daar
     moet hij doorheen. In werkelijkheid kun je twee covers om en om leggen
     zodat de vouwen elkaar niet raken en je gemiddeld op 22 uitkomt; dat
     scheelt pas iets bij een container vol losse covers.

     IJsbaden en sauna's hebben geen cover. */
  var COVER_MARGE = 3;    // cm groter dan de spa, per kant van de maat
  var COVER_RAND = 10;    // cm dik aan de buitenrand, onopgevouwen
  var COVER_VOUW = 12;    // cm dik bij de vouw, onopgevouwen
  /* Een lange cover komt niet als één stuk. Chantal (27 aug 2026): "komt in
     2 en soms 3 delen." Dat scheelt veel: de cover van een Aquatic 2 was
     dubbelgevouwen nog ruim 6 meter en paste dan naast twee spa's net niet
     meer in de container. In delen is elk deel de halve lengte. We rekenen
     met twee delen, niet met drie - dat is het ongunstigste geval van de
     twee die zij noemt, en dan valt het in de praktijk mee in plaats van
     tegen. Een gewone spa-cover blijft één deel; die haalt deze grens niet. */
  var COVER_DELEN_VANAF = 350;   // cm: is de dubbelgevouwen cover nóg langer, dan in 2 delen

  var GEEN_COVER = /(ice ?bath|ijsbad|wim hof|barrel|plunge|revive|chiller|shower|douche|sauna|vital[- ]?ice)/i;
  function heeftCover(model, fabriek) {
    return !GEEN_COVER.test(String(model || "") + " " + String(fabriek || ""));
  }

  /* De cover als doos zoals hij vervoerd wordt: dubbelgevouwen, dikste maat.
     De vouw gaat over de lángste kant - die gaat door de helft, de korte kant
     blijft heel. 590 x 277 wordt dus 295 x 277. */
  function vouw(l, b) {
    var lang = Math.max(l, b), kort = Math.min(l, b);
    return { l: lang / 2, b: kort, h: COVER_RAND * 2, hVouw: COVER_VOUW * 2 };
  }

  /* De cover opdelen als hij te lang is om als één stuk mee te gaan. Geeft
     de maat van ÉÉN deel terug plus het aantal delen; de container-tegel legt
     er dan dat aantal dozen in. */
  function inDelen(w, open, bron) {
    var delen = w.l > COVER_DELEN_VANAF ? 2 : 1;
    return { l: Math.round((w.l / delen) * 10) / 10, b: w.b, h: w.hVouw,
             delen: delen, open: open, bron: bron };
  }

  /* De cover van één model. Geeft null als hij er geen heeft.
     maat = de spa-afmeting in centimeters (uit maatVan). */
  function coverVan(model, code, maat, fabriek) {
    var eigen = hand ? hand[handSleutel(model, code)] : null;
    var c = eigen ? eigen.cover : undefined;
    // Uitdrukkelijk op 'geen cover' gezet.
    if (c === false) return null;
    // Zelf een covermaat ingevuld (onopgevouwen).
    if (c && c.l > 0 && c.b > 0) {
      var v = vouw(c.l, c.b);
      return inDelen(v, { l: c.l, b: c.b }, "handmatig");
    }
    if (!maat || !heeftCover(model, fabriek)) return null;
    var ol = maat.l + COVER_MARGE, ob = maat.b + COVER_MARGE;
    var w = vouw(ol, ob);
    return inDelen(w, { l: ol, b: ob }, "afgeleid");
  }

  /* De covermaat vastleggen. cover = {l,b} onopgevouwen, false voor 'geen
     cover', of null om weer op afgeleid te zetten. */
  function bewaarCover(model, code, cover, door) {
    if (!hand) hand = {};
    var k = handSleutel(model, code);
    if (!k) return Promise.reject(new Error("Dit model heeft geen naam en geen code."));
    var rec = hand[k] || { model: model || "", code: code || "" };
    if (cover === null) delete rec.cover;
    else if (cover === false) rec.cover = false;
    else rec.cover = { l: Number(cover.l), b: Number(cover.b) };
    rec.door = door || rec.door || "";
    rec.op = new Date().toISOString();
    // Een record dat alleen nog een covermaat had en die kwijtraakt, mag weg.
    if (rec.cover === undefined && !(rec.l > 0)) delete hand[k];
    else hand[k] = rec;
    return fetch(BUCKET, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": teamSleutel() },
      body: JSON.stringify({ maten: hand, updated: new Date().toISOString() }),
    }).then(function (r) {
      if (!r.ok) throw new Error("opslaan faalde (HTTP " + r.status + ")");
      return hand[k] || null;
    });
  }

  var API = {
    laad: laad, zet: zet, zetPakket: zetPakket, geladen: geladen, aantal: aantal,
    maatVan: maatVan, m3Van: m3Van, sleutel: sleutel,
    automatischVan: automatischVan, bewaarMaat: bewaarMaat,
    handmatigVan: handmatigVan, handmatigAantal: handmatigAantal,
    coverVan: coverVan, bewaarCover: bewaarCover, heeftCover: heeftCover,
    COVER_MARGE: COVER_MARGE, COVER_RAND: COVER_RAND, COVER_VOUW: COVER_VOUW,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.fpAfmetingen = API;

})(typeof window !== "undefined" ? window : globalThis);
