/* ═══════════════════════════════════════════════════════════════════════════
   COMMERCIAL INVOICE + PACKING LIST IN ÉÉN WERKMAP
   ═══════════════════════════════════════════════════════════════════════════

   Gerrit (19 aug 2026): "Op een commercial invoice staat hoeveel containers er
   binnen gaan komen. Zodra die wordt uitgelezen, wil ik dat er bij
   Binnenkomende goederen die containers zichtbaar komen, dat automatisch de
   packing list wordt uitgelezen en de labels om te printen per container
   klaar komen te staan. Vaak is het een excel-document waarbij op tabblad 1
   een commercial invoice staat en op tabblad 2 de packinglist."

   Wat er in zo'n bestand staat
   ----------------------------
   Blad INVOICE:  leverancier, invoicenummer, vaardatum, de artikelregels met
                  aantal en bedrag, en - dit is het belangrijkste - ergens op
                  de kopregel van de tabel het aantal containers in de vorm
                  "1X20GP", "2X40HQ" of "3 X 40HC".

   Blad PACKING:  per artikel het aantal colli, hoeveel stuks er in een collo
                  zitten, gewichten en afmetingen. Dat zijn de gegevens die op
                  een label moeten.

   Wat er lastig aan is
   --------------------
   1. Het aantal containers staat niet in een eigen kolom maar ergens in een
      cel op de koprij, tussen de rest. Daarom wordt elke cel van het hele blad
      afgezocht op het patroon <getal> X <maat>.

   2. De koprijen staan niet op een vaste rij. Er zitten vier tot dertien
      regels briefhoofd boven. De koprij wordt dus gezocht op zijn inhoud.

   3. Een packing list splitst lang niet altijd per container. In het
      voorbeeld van januari 2026 staat er één container en 35 colli zonder
      containerindeling. Zit er wél een indeling in - een regel met een
      containernummer - dan wordt daarop gesplitst. Zo niet, dan komt alles
      in de eerste container en kan iemand het zelf verdelen. Een collo aan
      de verkeerde container hangen is erger dan het openlaten.

   4. Containernummers staan er vaak nog niet in. De fabriek maakt de papieren
      voordat de rederij een container toewijst. Er staat dan alleen
      "Container No.:,seal No.:" zonder waarde. Dan krijgt de container een
      volgnummer en kan het echte nummer later van de Bill of Lading komen.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  function tekst(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  }
  function klein(v) { return tekst(v).toLowerCase(); }
  function getal(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var t = tekst(v).replace(/[^\d.,-]/g, "");
    if (!t) return 0;
    /* 1.234,56 en 1,234.56 komen allebei voor. De laatste scheider is de
       decimale; wat daarvoor staat is duizendtalscheiding. */
    var laatstePunt = t.lastIndexOf("."), laatsteKomma = t.lastIndexOf(",");
    if (laatstePunt >= 0 && laatsteKomma >= 0) {
      t = laatsteKomma > laatstePunt
        ? t.replace(/\./g, "").replace(",", ".")
        : t.replace(/,/g, "");
    } else if (laatsteKomma >= 0) {
      t = (t.split(",")[1] || "").length === 3 && t.split(",").length === 2 && !/^\d{1,2},/.test(t)
        ? t.replace(",", "") : t.replace(",", ".");
    }
    var n = parseFloat(t);
    return isFinite(n) ? n : 0;
  }
  function rijTekst(rij) { return (rij || []).map(tekst).join(" | "); }

  /* ── Hoeveel containers, en van welk soort ────────────────────────────
     "1X20GP", "2 x 40HQ", "3X40'HC". Ook los geschreven met spaties. */
  var CONTAINER_RE = /(\d{1,2})\s*[xX×]\s*(\d{2})\s*'?\s*(GP|HQ|HC|RF|OT|FR|DV)?\b/;

  function containersUit(rijen) {
    for (var r = 0; r < rijen.length; r++) {
      for (var c = 0; c < (rijen[r] || []).length; c++) {
        var t = tekst(rijen[r][c]);
        if (!t || t.length > 40) continue;
        var m = t.match(CONTAINER_RE);
        if (!m) continue;
        /* Alleen als het echt over containers gaat: 20, 40 of 45 voet.
           Anders vangt hij ook "2 x 30 stuks" op. */
        if (["20", "40", "45"].indexOf(m[2]) < 0) continue;
        return {
          aantal: Math.max(1, parseInt(m[1], 10) || 1),
          maat: m[2] + (m[3] ? m[3].toUpperCase() : "GP"),
          gevondenIn: t,
        };
      }
    }
    return null;
  }

  /* ── Blad herkennen ──────────────────────────────────────────────── */
  function isInvoiceBlad(rijen) {
    var kop = rijen.slice(0, 20).map(rijTekst).join(" ").toLowerCase();
    return kop.indexOf("commercial invoice") >= 0 || kop.indexOf("invoice") >= 0;
  }
  function isPackingBlad(rijen) {
    var kop = rijen.slice(0, 20).map(rijTekst).join(" ").toLowerCase();
    return kop.indexOf("packing list") >= 0 || kop.indexOf("packing") >= 0;
  }

  /* ── De koprij van een tabel zoeken op zijn inhoud ────────────────── */
  function zoekKop(rijen, woorden, tot) {
    tot = Math.min(tot || 25, rijen.length);
    for (var r = 0; r < tot; r++) {
      var t = klein(rijTekst(rijen[r]));
      var raak = 0;
      for (var i = 0; i < woorden.length; i++) if (t.indexOf(woorden[i]) >= 0) raak++;
      if (raak >= 2) return r;
    }
    return -1;
  }
  /* Eerst het meest specifieke woord over alle kolommen, dan het volgende.
     Zo wint "total cbm" van "cbm" als ze allebei op de regel staan; de kolom
     CBM is per doos en Total CBM is voor de hele regel. Stond hier eerst
     andersom (per kolom alle woorden), en dan bepaalde de volgorde van de
     kolommen wat je kreeg in plaats van wat je bedoelde. */
  function kolomVan(rij, woorden) {
    for (var i = 0; i < woorden.length; i++) {
      for (var c = 0; c < (rij || []).length; c++) {
        var t = klein(rij[c]);
        if (t && t.indexOf(woorden[i]) >= 0) return c;
      }
    }
    return -1;
  }

  /* ── Het INVOICE-blad ────────────────────────────────────────────── */
  function leesInvoice(rijen) {
    var uit = { leverancier: "", nummer: "", vaart: "", regels: [], containers: null, meldingen: [] };

    /* De leverancier is de eerste regel die niet uit Chinese tekens bestaat.
       Het briefhoofd staat tweetalig boven elkaar. */
    for (var r = 0; r < Math.min(6, rijen.length); r++) {
      var t = tekst((rijen[r] || [])[0]);
      if (t && /[A-Za-z]{4}/.test(t) && !/^add[.:]/i.test(t) && !/^tel[.:]/i.test(t)) { uit.leverancier = t; break; }
    }

    /* Invoicenummer en vaardatum staan als "label: waarde" ergens in het
       briefhoofd, soms in dezelfde cel en soms in de cel ernaast. */
    for (var r2 = 0; r2 < Math.min(20, rijen.length); r2++) {
      var rij = rijen[r2] || [];
      for (var c = 0; c < rij.length; c++) {
        var t2 = klein(rij[c]);
        if (!uit.nummer && /invoice\s*(no|№|nr|number)/.test(t2)) {
          uit.nummer = tekst(rij[c + 1]) || tekst(rij[c + 2]) || "";
        }
        if (!uit.vaart && /sailing/.test(t2)) {
          uit.vaart = tekst(rij[c]).replace(/^.*sailing[^:]*:?/i, "").trim() || tekst(rij[c + 1]);
        }
      }
    }

    uit.containers = containersUit(rijen);
    if (!uit.containers) uit.meldingen.push(
      "Op de invoice staat niet hoeveel containers het zijn. Er wordt van één container uitgegaan.");

    /* De artikeltabel: koprij met "article" en "quantity". */
    var kopR = zoekKop(rijen, ["article", "quantity", "unit price", "amount"], 30);
    if (kopR >= 0) {
      var kop = rijen[kopR];
      var cArt = kolomVan(kop, ["article", "description", "品 名"]);
      var cAantal = kolomVan(kop, ["quantity", "数 量"]);
      for (var r3 = kopR + 1; r3 < rijen.length; r3++) {
        var rr = rijen[r3] || [];
        var naam = tekst(rr[cArt >= 0 ? cArt : 1]);
        if (!naam) continue;
        if (/^total/i.test(naam)) break;
        var aantal = getal(rr[cAantal >= 0 ? cAantal : 2]);
        if (!aantal) continue;
        uit.regels.push({ omschrijving: naam, aantal: aantal });
      }
    }
    return uit;
  }

  /* ── Het PACKING-blad ────────────────────────────────────────────── */
  function leesPacking(rijen) {
    var uit = { colli: [], totaal: null, meldingen: [] };
    /* De koprij herkennen. De afkortingen erbij, want niet elke fabriek
       schrijft het voluit: Lodestone zet er "QTY (PCS) | CTNS | N.W(KGS) |
       G.W(KGS) | Total CBM" boven en dan werd de tabel helemaal niet gevonden
       (Chantal, 9 sep 2026, bestand LS6J323). */
    var kopR = zoekKop(rijen, ["packing", "gross weight", "measurement", "per packing",
                               "ctns", "g.w", "n.w", "qty (pcs)", "total cbm"], 30);
    if (kopR < 0) { uit.meldingen.push("Geen koprij op de packing list gevonden."); return uit; }

    /* De kop kan over twee regels lopen. Bij Lodestone staan de aantallen en
       gewichten op de ene regel en "ART. NO" en "Description of Goods" op de
       regel eronder. Wie alleen naar één regel kijkt vindt de artikelkolom
       niet, houdt een lege naam over en slaat elke regel over - dan komt er
       nul uit een packing list die gewoon gevuld is. */
    function kolomUitKop(woorden) {
      for (var d = 0; d < 3 && kopR + d < rijen.length; d++) {
        var k = kolomVan(rijen[kopR + d] || [], woorden);
        if (k >= 0) return k;
      }
      return -1;
    }
    var kop = rijen[kopR];
    var c = {
      artikel:  kolomUitKop(["art. no", "art.no", "artikel", "article", "品 名", "description of goods", "description"]),
      colli:    kolomUitKop(["packages", "件 数", "packing  (", "ctns"]),
      perColli: kolomUitKop(["per packing", "每件台数", "pcs per"]),
      aantal:   kolomUitKop(["quantity", "数 量", "qty"]),
      bruto:    kolomUitKop(["total gross", "总毛", "total g.w"]),
      netto:    kolomUitKop(["total net", "总净", "total n.w"]),
      cbm:      kolomUitKop(["total cbm", "measurement", "尺 码", "cbm"]),
    };

    var container = null;   // op welke container slaan de volgende regels
    var vorigArtikel = null;
    for (var r = kopR + 1; r < rijen.length; r++) {
      var rr = rijen[r] || [];
      var regel = rijTekst(rr);
      if (!regel.replace(/\|/g, "").trim()) continue;

      /* Een regel die een container aankondigt. Staat er een echt nummer bij
         - vier letters en zeven cijfers, de ISO-vorm - dan nemen we dat over. */
      if (/container\s*no/i.test(regel)) {
        var nr = regel.match(/\b([A-Z]{4}\s?\d{7})\b/);
        container = { nummer: nr ? nr[1].replace(/\s/g, "") : "", zegel: (regel.match(/seal\s*no\.?\s*:?\s*([A-Z0-9]{4,})/i) || [])[1] || "" };
        continue;
      }

      var naam = tekst(rr[c.artikel >= 0 ? c.artikel : 1]);
      if (/^total/i.test(naam) || /^total/i.test(tekst(rr[0]))) {
        uit.totaal = {
          colli: getal(rr[c.colli]), aantal: getal(rr[c.aantal]),
          bruto: getal(rr[c.bruto]), netto: getal(rr[c.netto]), cbm: getal(rr[c.cbm]),
        };
        vorigArtikel = null;
        continue;
      }
      var colli = getal(rr[c.colli]);
      /* Eén artikel over meerdere regels.
         ═══════════════════════════════════════════════════════════════════
         Bij Lodestone staat het artikelnummer alleen op de eerste regel van
         een set; de dozen eronder hebben wel een omschrijving en een aantal
         maar geen nummer meer. Zo'n regel overslaan kostte 66 van de 180
         dozen: van GL9120-2 werden er 22 geteld terwijl er 88 in de container
         zitten. Het nummer van de regel erboven telt dus door, zolang er een
         aantal dozen op staat. */
      var heeftTekst = rr.some(function (x) { return /[a-z]/i.test(tekst(x)); });
      if (!naam && colli && vorigArtikel && heeftTekst) naam = vorigArtikel;
      /* Een regel zonder enige tekst maar met aantallen is de subtotaalregel
         van dit containerblok. Die telt niet als doos - anders staat het
         aantal er twee keer in (222 in plaats van 111). */
      if (!naam && colli && !heeftTekst) {
        uit.totaal = {
          colli: getal(rr[c.colli]), aantal: getal(rr[c.aantal]),
          bruto: getal(rr[c.bruto]), netto: getal(rr[c.netto]), cbm: getal(rr[c.cbm]),
        };
        vorigArtikel = null;
        continue;
      }
      if (!naam) continue;
      if (c.artikel >= 0 && tekst(rr[c.artikel])) vorigArtikel = tekst(rr[c.artikel]);
      if (!colli) continue;
      uit.colli.push({
        artikel: naam,
        colli: colli,
        perColli: getal(rr[c.perColli]),
        aantal: getal(rr[c.aantal]),
        bruto: getal(rr[c.bruto]),
        netto: getal(rr[c.netto]),
        cbm: getal(rr[c.cbm]),
        container: container && container.nummer ? container.nummer : "",
      });
    }
    /* Wel een koprij maar geen enkele doos: dan staan de kolommen anders dan
       verwacht. Dat hoort te worden gezegd, anders komt er stilletjes een
       container zonder labels uit en denkt iedereen dat het gelukt is. */
    if (!uit.colli.length)
      uit.meldingen.push("De koprij van de packing list is gevonden, maar er zijn geen dozen uit te lezen. " +
        "De kolommen staan anders dan verwacht; stuur dit bestand door.");
    return uit;
  }

  /* ── De twee bladen samenvoegen tot containers met labels ─────────── */
  function bouwContainers(inv, pak) {
    var aantal = inv.containers ? inv.containers.aantal : 1;
    var maat = inv.containers ? inv.containers.maat : "";
    var meldingen = [];

    /* Splitst de packing list zelf per container? Dan die indeling volgen. */
    var genoemd = {};
    for (var i = 0; i < pak.colli.length; i++) if (pak.colli[i].container) genoemd[pak.colli[i].container] = 1;
    var nummers = Object.keys(genoemd);

    var containers = [];
    if (nummers.length) {
      for (var n = 0; n < nummers.length; n++) {
        containers.push({ nummer: nummers[n], volgnummer: n + 1, maat: maat, colli: [] });
      }
      for (var j = 0; j < pak.colli.length; j++) {
        var doel = containers.filter(function (x) { return x.nummer === pak.colli[j].container; })[0];
        (doel || containers[0]).colli.push(pak.colli[j]);
      }
      if (nummers.length !== aantal) meldingen.push(
        "De invoice noemt " + aantal + " container(s), de packing list " + nummers.length + ". " +
        "De indeling van de packing list is aangehouden.");
    } else {
      for (var k = 0; k < aantal; k++) containers.push({ nummer: "", volgnummer: k + 1, maat: maat, colli: [] });
      containers[0].colli = pak.colli.slice();
      if (aantal > 1) meldingen.push(
        "De packing list splitst niet per container. Alles staat voorlopig bij container 1; " +
        "verdeel het zelf zodra bekend is wat waarin gaat.");
    }

    /* Per container de labels: één label per collo, doorgenummerd. */
    for (var t = 0; t < containers.length; t++) {
      var cont = containers[t];
      var labels = [];
      var totaalColli = cont.colli.reduce(function (s, x) { return s + (x.colli || 0); }, 0);
      var teller = 0;
      for (var q = 0; q < cont.colli.length; q++) {
        var c2 = cont.colli[q];
        for (var w = 0; w < c2.colli; w++) {
          teller++;
          labels.push({
            artikel: c2.artikel,
            stuks: c2.perColli || (c2.colli ? Math.round(c2.aantal / c2.colli) : 0),
            collo: teller,
            vanTotaal: totaalColli,
            brutoPerColli: c2.colli ? +(c2.bruto / c2.colli).toFixed(1) : 0,
            container: cont.nummer || ("container " + cont.volgnummer),
          });
        }
      }
      cont.labels = labels;
      cont.totaalColli = totaalColli;
      cont.totaalStuks = cont.colli.reduce(function (s, x) { return s + (x.aantal || 0); }, 0);
      cont.bruto = +cont.colli.reduce(function (s, x) { return s + (x.bruto || 0); }, 0).toFixed(1);
      cont.cbm = +cont.colli.reduce(function (s, x) { return s + (x.cbm || 0); }, 0).toFixed(3);
    }
    return { containers: containers, meldingen: meldingen };
  }

  /* ── Het geheel ──────────────────────────────────────────────────── */
  /* ── Een tabblad dat zélf één container is ──────────────────────────
     Manon (8 sep 2026): "Ik wil per container de labels kunnen printen. Dus
     niet per Commercial Invoice, maar per packing list per container. Eerste
     tabblad is de CI, de andere tabbladen zijn de PL per container."

     Zo levert Jazzi het ook aan: één tabblad per container, met het
     containernummer als naam van het tabblad. Nergens staat het woord
     "packing list", en daar liep de herkenning op stuk - er werd niets
     bewaard en de labeltegel bleef leeg.

     Een blad telt als container als de naam een containernummer is (vier
     letters, zeven cijfers) of als er een regel "CONTAINER NUMBER" in staat,
     én er een koprij met de spa-regels op staat. */
  var CONTAINERNR = /\b([A-Z]{4}\s?\d{7})\b/;
  function containerVanBlad(blad) {
    var uitNaam = String(blad.naam || "").toUpperCase().match(/^([A-Z]{4}\d{7})$/);
    if (uitNaam) return uitNaam[1];
    var kop = (blad.rijen || []).slice(0, 20).map(rijTekst).join(" ");
    if (!/container\s*number/i.test(kop)) return null;
    var m = kop.toUpperCase().match(CONTAINERNR);
    return m ? m[1].replace(/\s/g, "") : null;
  }
  function isContainerBlad(blad) {
    if (!containerVanBlad(blad)) return false;
    return zoekKop(blad.rijen || [], ["spa code", "shell color", "product description", "qty"], 30) >= 0;
  }

  /* De spa-regels van zo'n containerblad. Eén regel per soort bad, met het
     trackingnummer erbij: dat staat op het label en waarmee zoekt Manon. */
  function leesContainerBlad(blad) {
    var rijen = blad.rijen || [];
    var nummer = containerVanBlad(blad);
    var kopR = zoekKop(rijen, ["spa code", "shell color", "product description", "qty"], 30);
    if (kopR < 0) return null;
    var kop = rijen[kopR];
    var c = {
      tracking: kolomVan(kop, ["tracking"]),
      code:     kolomVan(kop, ["spa code", "jazzi spa"]),
      shell:    kolomVan(kop, ["shell color", "shell colour"]),
      kast:     kolomVan(kop, ["cabinet", "cover color", "cover colour"]),
      naam:     kolomVan(kop, ["product description", "description"]),
      aantal:   kolomVan(kop, ["qty", "quantity"]),
      colli:    kolomVan(kop, ["ctn"]),
      maat:     kolomVan(kop, ["dimension"]),
      netto:    kolomVan(kop, ["n.w"]),
      bruto:    kolomVan(kop, ["g.w"]),
    };
    var zegel = "";
    for (var z = 0; z < Math.min(rijen.length, 25); z++) {
      var t = rijTekst(rijen[z]);
      var ms = t.match(/\b(HL[A-Z0-9]{6,})\b/);
      if (/seal/i.test(rijTekst(rijen[Math.max(0, z - 1)])) && ms) { zegel = ms[1]; break; }
    }
    var colli = [], laatsteTracking = "", overig = 0;
    for (var r = kopR + 1; r < rijen.length; r++) {
      var rr = rijen[r] || [];
      var naam = tekst(rr[c.naam]);
      var aantal = getal(rr[c.aantal]);
      if (!naam || !aantal) continue;
      if (/^total/i.test(naam)) continue;
      /* Het trackingnummer staat alleen op de eerste regel van een bad; de
         cover eronder hoort bij hetzelfde nummer. */
      var tr = tekst(rr[c.tracking]); if (tr) laatsteTracking = tr;
      /* Alleen de baden. Een cover hoort bij het bad erboven en krijgt geen
         eigen label. Onder de baden staan bovendien losse onderdelen zonder
         spa-code ("100 Relax" 28x, "JASK50" 100x, waterfalls); die telden mee
         en dan kwamen er 176 baden in één container te staan, wat niet kan.
         Een bad heeft altijd een spa-code én een omschrijving die zegt dat
         het een bad is. */
      if (/cover/i.test(naam)) continue;
      /* De fabriek zet er soms de modelnaam boven in dezelfde cel: "HAPPY"
         met op de regel eronder "SKT888A-4S". Het eerste stuk pakken levert
         dan "HAPPY" op en daar hoort geen artikel bij. Neem daarom het deel
         dat op een fabriekscode lijkt, en anders het eerste. */
      // Let op: tekst() haalt de regeleinden er al uit, dus hier op de ruwe
      // celwaarde splitsen en pas daarna opschonen.
      var codeDelen = String(rr[c.code] == null ? "" : rr[c.code])
        .split(/[\r\n]+/).map(function (z) { return z.replace(/\s+/g, " ").trim(); }).filter(Boolean);
      var spaCode = "";
      for (var q = 0; q < codeDelen.length; q++) {
        if (/^[A-Z]{1,4}[-.]?\d[\w.\-]*$/i.test(codeDelen[q])) { spaCode = codeDelen[q]; break; }
      }
      if (!spaCode) spaCode = codeDelen[0] || "";
      if (!spaCode) { overig += aantal; continue; }
      if (!/bathtub|bath tub|spa\b|swim/i.test(naam)) { overig += aantal; continue; }
      colli.push({
        tracking: laatsteTracking,
        artikel: spaCode,
        omschrijving: naam,
        kleur: tekst(rr[c.shell]),
        kast: tekst(rr[c.kast]),
        aantal: aantal,
        colli: getal(rr[c.colli]) || aantal,
        maat: tekst(rr[c.maat]),
        netto: getal(rr[c.netto]),
        bruto: getal(rr[c.bruto]),
        container: nummer,
      });
    }
    if (!colli.length) return null;
    return { nummer: nummer, zegel: zegel, colli: colli, overig: overig,
             stuks: colli.reduce(function (n, x) { return n + (Number(x.aantal) || 0); }, 0) };
  }

  function isInvPl(bladen) {
    var heeftInv = false, heeftPak = false;
    for (var i = 0; i < bladen.length; i++) {
      if (isInvoiceBlad(bladen[i].rijen)) heeftInv = true;
      if (isPackingBlad(bladen[i].rijen)) heeftPak = true;
      // Een tabblad per container telt óók als packing list; zie hierboven.
      if (isContainerBlad(bladen[i])) heeftPak = true;
    }
    return heeftInv && heeftPak;
  }

  function lees(bladen) {
    /* Levert de fabriek een tabblad per container, dan is dat de indeling die
       we volgen: dat is precies wat Manon nodig heeft om per container te
       printen. De gewone weg (één invoice + één packing list) blijft eronder
       staan voor de fabrieken die het zo aanleveren. */
    var perContainer = [];
    for (var q = 0; q < bladen.length; q++) {
      if (!isContainerBlad(bladen[q])) continue;
      var cc = leesContainerBlad(bladen[q]);
      if (cc) perContainer.push(cc);
    }
    if (perContainer.length) {
      var invB = null;
      for (var w = 0; w < bladen.length; w++) if (isInvoiceBlad(bladen[w].rijen)) { invB = bladen[w]; break; }
      var inv0 = invB ? leesInvoice(invB.rijen) : { leverancier: "", nummer: "", vaart: "", meldingen: [] };
      /* Het factuurnummer en de leverancier staan óók op elk containerblad, en
         daar netjes gelabeld: "EXPORTER'S REFERENCE NO" met eronder
         RZ2009DF3332-6&3342-1, en de SHIPPER-regel met de fabrieksnaam. Het
         CI-blad van Jazzi geeft ze niet prijs, en zonder nummer krijgt elke
         container de sleutel "?#1" en vallen ze in de opslag op elkaar. */
      var kopBlad = perContainer.length ? bladen.filter(isContainerBlad)[0] : null;
      if (kopBlad) {
        var kr = kopBlad.rijen || [];
        for (var y = 0; y < Math.min(kr.length, 14); y++) {
          var hier = rijTekst(kr[y]), vorige = y ? rijTekst(kr[y - 1]) : "";
          /* Let op de kolom: op de labelrij staan DATE en EXPORTER'S REFERENCE
             NO naast elkaar, en op de rij eronder de datum en het nummer. Wie
             de rij plat leest pakt de datum. */
          if (!inv0.nummer && /exporter.?s\s*reference|contract\s*no/i.test(vorige)) {
            var kolom = kolomVan(kr[y - 1], ["exporter", "contract no"]);
            var mm = kolom >= 0 ? tekst((kr[y] || [])[kolom]) : "";
            if (mm) inv0.nummer = mm.replace(/\s+/g, " ").slice(0, 60);
          }
          if ((!inv0.leverancier || /commercial\s*invoice/i.test(inv0.leverancier))
              && /shipper/i.test(vorige)) {
            var ln = hier.split("|")[0].trim();
            if (ln) inv0.leverancier = ln.replace(/\s+/g, " ").slice(0, 80);
          }
          if (!inv0.vaart && /name of the voyage/i.test(vorige)) {
            var vv = hier.split("|")[0].trim();
            if (vv) inv0.vaart = vv.replace(/\s+/g, " ").slice(0, 60);
          }
        }
      }
      return { ok: true, leverancier: inv0.leverancier, nummer: inv0.nummer, vaart: inv0.vaart,
               perContainerBladen: true,
               containers: perContainer.map(function (c, i) {
                 /* Het volgnummer hoort erbij: de opslag bewaart een container
                    onder "factuurnummer#volgnummer", en zonder dat vallen alle
                    containers van dezelfde factuur op elkaar. */
                 return { nummer: c.nummer, volgnummer: i + 1, zegel: c.zegel,
                          stuks: c.stuks, overig: c.overig, colli: c.colli,
                          totaalStuks: c.stuks,
                          totaalColli: c.colli.reduce(function (n, x) { return n + (Number(x.colli) || 0); }, 0),
                          labels: c.colli.map(function (x) {
                            return { tracking: x.tracking, artikel: x.artikel, omschrijving: x.omschrijving,
                                     kleur: x.kleur, kast: x.kast, aantal: x.aantal, colli: x.colli,
                                     container: c.nummer, maat: x.maat, bruto: x.bruto };
                          }) };
               }),
               meldingen: inv0.meldingen || [] };
    }
    var invBlad = null, pakBlad = null;
    for (var i = 0; i < bladen.length; i++) {
      if (!invBlad && isInvoiceBlad(bladen[i].rijen)) invBlad = bladen[i];
      else if (!pakBlad && isPackingBlad(bladen[i].rijen)) pakBlad = bladen[i];
    }
    if (!invBlad) return { ok: false, error: "geen-invoice" };
    var inv = leesInvoice(invBlad.rijen);
    var pak = pakBlad ? leesPacking(pakBlad.rijen) : { colli: [], totaal: null, meldingen: ["Geen packing list in dit bestand."] };
    var samen = bouwContainers(inv, pak);
    return {
      ok: true,
      leverancier: inv.leverancier,
      nummer: inv.nummer,
      vaart: inv.vaart,
      containersOpInvoice: inv.containers,
      regels: inv.regels,
      containers: samen.containers,
      totaal: pak.totaal,
      meldingen: inv.meldingen.concat(pak.meldingen, samen.meldingen),
    };
  }

  global.fpInvPl = {
    lees: lees, isInvPl: isInvPl, isContainerBlad: isContainerBlad, leesContainerBlad: leesContainerBlad,
    leesInvoice: leesInvoice, leesPacking: leesPacking,
    bouwContainers: bouwContainers, containersUit: containersUit,
  };

})(typeof window !== "undefined" ? window : globalThis);
