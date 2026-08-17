/* ═══════════════════════════════════════════════════════════════════════════
   GOEDERENBEWEGING — beginvoorraad + inkopen − verkopen ± correcties
   ═══════════════════════════════════════════════════════════════════════════

   Waarvoor
   --------
   Just Audit vraagt een goederenbeweging vanaf 1-1-2025 tot heden, aansluitend
   op grootboek 7000 t/m 7999, uitgesplitst naar magazijn, artikelgroep,
   artikel en grootboekcategorie. Deze module bouwt die op uit het datamodel
   van de accountant: de grootboektransacties met per regel een artikelcode en
   een artikelgroep.

   Wat er bij het eerste doorrekenen uitkwam
   -----------------------------------------
   Op 31-12-2025 staat één boeking van 2.189.356,58 met de omschrijving
   "Voorraadaansluiting Artikelbestand balans", verdeeld over zestien
   voorraadrekeningen met de tegenboeking op tussenrekening 2010. En op
   15-01-2025 staat er een van 451.263,90 die de aansluitboeking van eind 2024
   terugdraait.

   Samen 2.640.620,48 in 53 regels. Boekhoudkundig sluit het - de
   tussenrekening is daarna weer glad - maar het betekent dat de
   administratieve voorraad met de hand op het artikelbestand is gezet. Zonder
   die boekingen loopt de voorraad geen 173 duizend maar 2,8 miljoen uit de pas.

   Daarom staan ze hier op een eigen regel en niet tussen de gewone mutaties.
   Een goederenbeweging waarin zo'n post meeloopt als "correctie" sluit altijd,
   en dan is de vraag waar het verschil vandaan komt niet beantwoord maar
   weggemoffeld. Dat is precies wat deze audit onderzoekt.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var VOORRAAD_VAN = 7000, VOORRAAD_TOT = 7998;
  var VOORZIENING = 7999;

  /* De soorten mutatie, herkend aan de omschrijving die Logic4 meegeeft. De
     volgorde is die van de goederenbeweging zelf: eerst erin, dan eruit, dan
     wat er is bijgesteld. */
  var SOORTEN = [
    { sleutel: "inkoop",      naam: "Inkopen (goederenontvangst)",     test: /^inkooplevering/i },
    { sleutel: "verkoop",     naam: "Verkopen",                        test: /^verkoop\b/i },
    { sleutel: "systeem",     naam: "Voorraadcorrecties (systeem)",    test: /^voorraad correctie/i },
    { sleutel: "telling",     naam: "Handmatige mutaties uit telling", test: /handmatige voorraad mutatie.*telling/i },
    { sleutel: "handmatig",   naam: "Handmatige mutaties overig",      test: /handmatige voorraad mutatie/i },
    { sleutel: "waarde",      naam: "Waardeaanpassingen",              test: /verandering waarde|aanpassing vvp/i },
    { sleutel: "prijs",       naam: "Prijsverschillen",                test: /^prijsverschil/i },
    /* Deze twee als laatste, want ze moeten vóór "overig" vallen maar ná de
       herkenbare soorten - en ze zijn het hele punt van dit overzicht. */
    { sleutel: "aansluiting", naam: "Handmatige aansluitboekingen",
      test: /voorraadaansluiting|terugdraaien:\s*aansluiting voorraad/i, apart: true },
  ];
  var OVERIG = { sleutel: "overig", naam: "Overig / niet geclassificeerd" };

  function soortVan(omschrijving) {
    var o = String(omschrijving || "");
    /* De aansluitboekingen eerst: hun tekst bevat soms ook het woord
       "voorraad", en dan zouden ze anders bij de systeemcorrecties belanden. */
    for (var i = SOORTEN.length - 1; i >= 0; i--)
      if (SOORTEN[i].apart && SOORTEN[i].test.test(o)) return SOORTEN[i];
    for (var j = 0; j < SOORTEN.length; j++)
      if (!SOORTEN[j].apart && SOORTEN[j].test.test(o)) return SOORTEN[j];
    return OVERIG;
  }

  function getal(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var s = String(v == null ? "" : v).replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }
  function rekening(v) {
    var n = parseInt(String(v == null ? "" : v).trim(), 10);
    return isFinite(n) ? n : null;
  }
  function jaarVan(v) {
    if (!v) return null;
    if (v instanceof Date) return v.getFullYear();
    var m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return Number(m[1]);
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d.getFullYear();
  }
  function datumVan(v) {
    if (!v) return "";
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    var m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    var d = new Date(v);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }

  /* Welke kolom is wat. De accountant levert het datamodel aan en die kan van
     jaar tot jaar iets anders heten; vastpinnen op kolomnummers gaat een keer
     mis en dan klopt de hele beweging niet meer. */
  function kolommen(kop) {
    var k = {};
    (kop || []).forEach(function (naam, i) {
      var n = String(naam || "").toLowerCase().trim();
      if (/^gb\.?\s*code$|grootboek\s*code|rekening/.test(n)) k.rekening = i;
      else if (/grootboek\s*omschrijving/.test(n)) k.rekeningNaam = i;
      else if (/^datum$/.test(n)) k.datum = i;
      else if (/^bedrag$/.test(n)) k.bedrag = i;
      else if (/^omschrijving$/.test(n)) k.omschrijving = i;
      else if (/^artikelcode$/.test(n)) k.artikel = i;
      else if (/^artikelgroep$/.test(n) && k.groep === undefined) k.groep = i;
      else if (/^kostenplaats$/.test(n)) k.kostenplaats = i;
      else if (/^factuurnummer$/.test(n)) k.factuur = i;
    });
    return (k.rekening !== undefined && k.bedrag !== undefined) ? k : null;
  }

  /* ── De beweging opbouwen ──────────────────────────────────────────── */

  function nieuweTelling() {
    return { perSoort: {}, aantalPerSoort: {}, totaal: 0, regels: 0 };
  }
  function tel(t, soort, bedrag) {
    t.perSoort[soort] = (t.perSoort[soort] || 0) + bedrag;
    t.aantalPerSoort[soort] = (t.aantalPerSoort[soort] || 0) + 1;
    t.totaal += bedrag;
    t.regels += 1;
  }

  /* rijen: array of arrays, eerste rij is de kopregel.
     beginbalans: { rekeningnummer: saldo } per 1-1 van het jaar.
     jaar: alleen regels uit dat jaar meenemen (null = alles). */
  function bouw(rijen, beginbalans, opties) {
    opties = opties || {};
    var k = kolommen(rijen[0]);
    if (!k) return { ok: false, error: "kolommen-niet-herkend",
                     uitleg: "In de kopregel ontbreekt een grootboekcode of een bedrag." };

    var totaal = nieuweTelling();
    var perRekening = {}, perGroep = {}, perArtikel = {};
    var aansluitregels = [];
    var overigVormen = {};
    var jaarFilter = opties.jaar || null;
    var genegeerd = 0;

    for (var r = 1; r < rijen.length; r++) {
      var rij = rijen[r];
      if (!rij) continue;
      var nr = rekening(rij[k.rekening]);
      if (nr === null) continue;
      var isVoorraad = nr >= VOORRAAD_VAN && nr <= VOORRAAD_TOT;
      var isVoorziening = nr === VOORZIENING;
      if (!isVoorraad && !isVoorziening) continue;

      if (jaarFilter) {
        var jr = jaarVan(rij[k.datum]);
        if (jr !== null && jr !== jaarFilter) { genegeerd++; continue; }
      }

      var bedrag = getal(rij[k.bedrag]);
      var oms = k.omschrijving !== undefined ? String(rij[k.omschrijving] || "") : "";
      var s = soortVan(oms);

      /* De voorziening incourant is geen goederenbeweging maar een
         waardering. Die telt apart en niet mee in de stroom van goederen. */
      var doel = isVoorziening ? (perRekening[VOORZIENING] = perRekening[VOORZIENING] || nieuweTelling())
                               : totaal;
      if (isVoorziening) { tel(doel, s.sleutel, bedrag); continue; }

      tel(totaal, s.sleutel, bedrag);

      perRekening[nr] = perRekening[nr] || nieuweTelling();
      perRekening[nr].naam = k.rekeningNaam !== undefined ? String(rij[k.rekeningNaam] || "") : "";
      tel(perRekening[nr], s.sleutel, bedrag);

      if (k.groep !== undefined) {
        var g = String(rij[k.groep] || "(geen groep)");
        perGroep[g] = perGroep[g] || nieuweTelling();
        tel(perGroep[g], s.sleutel, bedrag);
      }
      if (k.artikel !== undefined) {
        var a = String(rij[k.artikel] || "").trim();
        if (a) {
          perArtikel[a] = perArtikel[a] || nieuweTelling();
          tel(perArtikel[a], s.sleutel, bedrag);
        }
      }

      if (s.sleutel === "aansluiting") {
        aansluitregels.push({
          datum: datumVan(rij[k.datum]), rekening: nr,
          rekeningNaam: k.rekeningNaam !== undefined ? String(rij[k.rekeningNaam] || "") : "",
          bedrag: bedrag, omschrijving: oms.slice(0, 120),
          artikelgroep: k.groep !== undefined ? String(rij[k.groep] || "") : "",
        });
      }
      if (s.sleutel === "overig") {
        var vorm = oms.replace(/\d+/g, "#").slice(0, 60) || "(leeg)";
        overigVormen[vorm] = overigVormen[vorm] || { aantal: 0, bedrag: 0 };
        overigVormen[vorm].aantal++;
        overigVormen[vorm].bedrag += bedrag;
      }
    }

    /* De beginvoorraad uit de beginbalans, en daarmee de eindstand. */
    var bb = beginbalans || {};
    var beginVoorraad = 0, beginVoorziening = 0;
    Object.keys(bb).forEach(function (n) {
      var nr2 = rekening(n);
      if (nr2 === null) return;
      if (nr2 >= VOORRAAD_VAN && nr2 <= VOORRAAD_TOT) beginVoorraad += getal(bb[n]);
      else if (nr2 === VOORZIENING) beginVoorziening += getal(bb[n]);
    });

    var aansluitTotaal = totaal.perSoort.aansluiting || 0;
    var voorzieningMut = perRekening[VOORZIENING] ? perRekening[VOORZIENING].totaal : 0;

    return {
      ok: true,
      jaar: jaarFilter,
      genegeerdAnderJaar: genegeerd,
      begin: beginVoorraad,
      mutaties: totaal.totaal,
      eind: beginVoorraad + totaal.totaal,
      /* Wat de eindstand zou zijn zonder de handmatige aansluiting. Het
         verschil met de telling is dan de echte, onverklaarde afwijking. */
      eindZonderAansluiting: beginVoorraad + totaal.totaal - aansluitTotaal,
      aansluitTotaal: aansluitTotaal,
      voorziening: { begin: beginVoorziening, mutatie: voorzieningMut,
                     eind: beginVoorziening + voorzieningMut },
      soorten: SOORTEN.map(function (s) {
        return { sleutel: s.sleutel, naam: s.naam, apart: !!s.apart,
                 bedrag: totaal.perSoort[s.sleutel] || 0,
                 regels: totaal.aantalPerSoort[s.sleutel] || 0 };
      }).concat([{ sleutel: OVERIG.sleutel, naam: OVERIG.naam,
                   bedrag: totaal.perSoort.overig || 0,
                   regels: totaal.aantalPerSoort.overig || 0 }]),
      perRekening: perRekening,
      perGroep: perGroep,
      perArtikel: perArtikel,
      aansluitregels: aansluitregels.sort(function (a, b) {
        return String(a.datum).localeCompare(String(b.datum)) || Math.abs(b.bedrag) - Math.abs(a.bedrag);
      }),
      overigVormen: overigVormen,
      regels: totaal.regels,
      meldingen: meldingen(k, perArtikel, totaal),
    };
  }

  /* Wat de gebruiker moet weten voordat hij dit doorstuurt naar de accountant.
     Liever hier een melding dan een overzicht dat volledig lijkt maar het niet
     is. */
  function meldingen(k, perArtikel, totaal) {
    var m = [];
    if (k.artikel === undefined) {
      m.push("Er is geen kolom Artikelcode gevonden. De uitsplitsing per artikel ontbreekt.");
    } else if (!Object.keys(perArtikel).length) {
      /* Dit is het geval bij het datamodel van december 2025: de artikelcode
         staat wél op de omzet- en kostprijsrekeningen, maar op geen enkele van
         de 108.993 voorraadregels. Nagelopen 17 aug 2026. */
      m.push("Op de voorraadregels staat geen artikelcode ingevuld, alleen op de omzet- en " +
             "kostprijsrekeningen. De goederenbeweging is daarom op te bouwen per grootboekrekening " +
             "en per artikelgroep, maar niet per artikel. Voor artikelniveau zijn de voorraadmutaties " +
             "uit Logic4 nodig.");
    }
    if (totaal.perSoort.aansluiting) {
      m.push("Er staan handmatige aansluitboekingen in van " +
             Math.round(totaal.perSoort.aansluiting).toLocaleString("nl-NL") +
             ". Die staan apart geteld: een goederenbeweging waarin zo'n post als gewone correctie " +
             "meeloopt sluit altijd, en dan is de vraag waar het verschil vandaan komt niet " +
             "beantwoord maar weggeboekt.");
    }
    if (totaal.perSoort.overig && Math.abs(totaal.perSoort.overig) > 100000) {
      m.push("Voor " + Math.round(totaal.perSoort.overig).toLocaleString("nl-NL") +
             " aan mutaties is uit de omschrijving niet af te leiden wat voor soort boeking het is.");
    }
    return m;
  }

  /* De aansluiting met de telling. Hier komt het antwoord uit dat de
     accountant wil zien: klopt de administratie met wat er ligt, en zo niet,
     hoeveel daarvan is met de hand rechtgezet. */
  function aansluiting(beweging, tellingWaarde) {
    var t = getal(tellingWaarde);
    return {
      telling: t,
      administratie: beweging.eind,
      verschil: t - beweging.eind,
      administratieZonderAansluiting: beweging.eindZonderAansluiting,
      verschilZonderAansluiting: t - beweging.eindZonderAansluiting,
      handmatigRechtgezet: beweging.aansluitTotaal,
    };
  }

  global.fpGoederenbeweging = {
    bouw: bouw,
    aansluiting: aansluiting,
    _intern: { soortVan: soortVan, kolommen: kolommen, getal: getal,
               rekening: rekening, jaarVan: jaarVan, datumVan: datumVan,
               SOORTEN: SOORTEN, OVERIG: OVERIG },
  };

})(typeof window !== "undefined" ? window : globalThis);
