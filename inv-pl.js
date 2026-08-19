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
  function kolomVan(rij, woorden) {
    for (var c = 0; c < (rij || []).length; c++) {
      var t = klein(rij[c]);
      if (!t) continue;
      for (var i = 0; i < woorden.length; i++) if (t.indexOf(woorden[i]) >= 0) return c;
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
    var kopR = zoekKop(rijen, ["packing", "gross weight", "measurement", "per packing"], 30);
    if (kopR < 0) { uit.meldingen.push("Geen koprij op de packing list gevonden."); return uit; }

    var kop = rijen[kopR];
    var c = {
      artikel:  kolomVan(kop, ["article", "品 名", "description"]),
      colli:    kolomVan(kop, ["packages", "件 数", "packing  ("]),
      perColli: kolomVan(kop, ["per packing", "每件台数", "pcs per"]),
      aantal:   kolomVan(kop, ["quantity", "数 量"]),
      bruto:    kolomVan(kop, ["total gross", "总毛"]),
      netto:    kolomVan(kop, ["total net", "总净"]),
      cbm:      kolomVan(kop, ["measurement", "尺 码", "cbm"]),
    };

    var container = null;   // op welke container slaan de volgende regels
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
      if (!naam) continue;
      if (/^total/i.test(naam)) {
        uit.totaal = {
          colli: getal(rr[c.colli]), aantal: getal(rr[c.aantal]),
          bruto: getal(rr[c.bruto]), netto: getal(rr[c.netto]), cbm: getal(rr[c.cbm]),
        };
        continue;
      }
      var colli = getal(rr[c.colli]);
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
  function isInvPl(bladen) {
    var heeftInv = false, heeftPak = false;
    for (var i = 0; i < bladen.length; i++) {
      if (isInvoiceBlad(bladen[i].rijen)) heeftInv = true;
      if (isPackingBlad(bladen[i].rijen)) heeftPak = true;
    }
    return heeftInv && heeftPak;
  }

  function lees(bladen) {
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
    lees: lees, isInvPl: isInvPl,
    leesInvoice: leesInvoice, leesPacking: leesPacking,
    bouwContainers: bouwContainers, containersUit: containersUit,
  };

})(typeof window !== "undefined" ? window : globalThis);
