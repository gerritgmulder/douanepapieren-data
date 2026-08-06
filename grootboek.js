/* ═══════════════════════════════════════════════════════════════════════════
   GROOTBOEK — de boekingsregels van één rekening rechtstreeks uit Logic4
   ═══════════════════════════════════════════════════════════════════════════

   Waarom dit er nu pas is
   -----------------------
   /v3/Financial/GetFinancialJournals gaf maandenlang 403. Alle aansluitingen
   moesten het daarom doen met wat via de orders zichtbaar was, en dat is niet
   hetzelfde als het grootboek: boekingen zonder ordernummer — handmatige
   correcties, jaarafsluitingen, overboekingen — bleven onzichtbaar. Bij 1350
   ging dat over 187 regels van samen ruim 774.000 euro, en bij 1630 over
   miljoenen. Sinds 4 aug 2026 staan de rechten aan.

   Wat het oplevert
   ----------------
   Het grootboeksaldo klopt nu met dat van de accountant: 1630 kwam uit op
   1.484.432,10 tegen zijn 1.484.431,03, en 1350 op -3.716.764,36 tegen
   -3.717.538,56. Geen exportbestand meer nodig.

   Waarom streamen
   ---------------
   1350 heeft 676.267 regels en 1630 er 316.861. Die allemaal vasthouden in de
   app is zonde van het geheugen, terwijl we bijna altijd alleen optellingen
   nodig hebben. Daarom krijgt de aanroeper elke pagina binnen en beslist die
   zelf wat hij bewaart.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var PER = 5000;          // Logic4 levert dit in ~0,2s per pagina
  // 2 miljoen regels. Hier stond "ver voorbij wat er is", en dat was op
  // 6 aug 2026 aantoonbaar onwaar: grootboek 1300 (debiteuren) en 2050
  // (automatische Logic4 boekingen) zitten er allebei boven. 1630 en 1350,
  // de enige die de tegels nu lezen, blijven onder het miljoen.
  //
  // Het gevaar zit niet in de limiet maar in wat er gebeurde als hij werd
  // geraakt: de lus stopte gewoon en gaf een uitkomst terug alsof die
  // compleet was. Bij 1300 leverde dat een saldo op dat credit stond in
  // plaats van debet, omdat juist de betalingen in de niet-gelezen staart
  // zaten. Een half antwoord is gevaarlijker dan geen antwoord, dus nu
  // stopt hij met een foutmelding.
  var MAX_PAGINAS = 400;

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* Loop de boekingsregels van één grootboekrekening af tot en met een datum.
     `perPagina(regels, totaalTotNu)` wordt per pagina aangeroepen; wat je niet
     bewaart is meteen weer weg. Geeft het aantal gelezen regels terug. */
  async function lees(cfg, code, tot, perPagina, melden) {
    var gelezen = 0;
    for (var p = 0; p < MAX_PAGINAS; p++) {
      var r = await cfg.logic4("/v3/Financial/GetFinancialJournals", {
        LedgerCode: Number(code),
        DateTimeTo: tot,
        TakeRecords: PER,
        SkipRecords: p * PER,
      });
      var lijst = Array.isArray(r) ? r : (r && r.Records) || [];
      // Let op: return en geen break. Bij een grootboek waarvan het aantal
      // regels precies deelbaar is door PER is de volgende pagina leeg, en
      // dat is een nette afsluiting - geen afkapping. Met een break zou hij
      // hieronder alsnog de foutmelding geven.
      if (!lijst.length) return gelezen;
      gelezen += lijst.length;
      if (perPagina) perPagina(lijst, gelezen);
      if (melden) melden("Grootboek " + code + " lezen… " + gelezen.toLocaleString("nl-NL") + " regels",
        Math.min(60, 5 + gelezen / 15000));
      if (lijst.length < PER) return gelezen;   // laatste pagina: klaar
    }
    // Hier komen we alleen als de laatste pagina nog vol was, en dan is er
    // méér. Doorgaan met wat we hebben zou een saldo opleveren dat nergens
    // op slaat, dus liever hard stoppen dan stilletjes de helft tonen.
    throw new Error("Grootboek " + code + " heeft meer dan " +
      (MAX_PAGINAS * PER).toLocaleString("nl-NL") + " regels. De uitlezing is niet compleet " +
      "en het saldo zou dus niet kloppen. Verhoog MAX_PAGINAS in grootboek.js.");
  }

  /* Het ordernummer staat niet in een eigen veld maar in de omschrijving
     ("Betaling voor order 3488620", "Afboeking order 3500792 naar factuur …").
     Zonder nummer is het een handmatige boeking — juist die willen we zien. */
  function orderUit(oms) {
    var s = String(oms || "");
    var m = s.match(/\border\s*[:#]?\s*(\d{6,8})/i);
    if (m) return m[1];
    // De betaalregels noemen het ordernummer zónder het woord "order":
    // "Online betaling 3454477 (2522354478X36069)", "Shopify betaling 3485998".
    // Die vielen allemaal buiten de herkenning, en dat waren er nogal wat: van
    // de 2.409 regels zonder nummer bleven er na deze regel 121 over, en de
    // verdeling tussen openstaande posten en correcties schoof 2,5 miljoen op.
    //
    // Let op de uitzondering voor facturen. "Betaling factuur 6437205" en
    // "Betaling voor factuur 6444194" noemen een factuurnummer, geen order.
    // Die twee door elkaar halen zou betalingen aan de verkeerde post hangen,
    // en dan klopt er per saldo niets meer van de aansluiting.
    // Het streepje in "Betaling voor  - 3447863" hoort er ook doorheen te
    // kunnen; "factuur" mag er niet tussen staan, want dan is het geen order.
    m = s.match(/\bbetaling\s+(?:voor\s+)?[-\s]*(\d{6,8})\b/i);
    return m ? m[1] : null;
  }

  /* De inkooplevering bij 1630 zit ook in de tekst, in twee vormen:
       "Inkooplevering 34 stuks artikel 200049 (levering: 37)"
       "Inkoopfactuur Jazzi / FSE123 van inkooplevering 41288"
     Let op de eerste: daar staat een aantal áchter het woord "Inkooplevering".
     Een losse zoektocht naar cijfers na "levering" pakt dat aantal op in plaats
     van het leveringnummer. Daarom eerst de expliciete vorm tussen haakjes, dan
     het nummer aan het eind. Een minimum van vier cijfers eisen werkt niet: de
     oudste leveringen heten gewoon 36 en 37. */
  function leveringUit(oms) {
    var s = String(oms || "");
    var m = s.match(/\(levering:\s*(\d+)\s*\)/i);
    if (m) return m[1];
    m = s.match(/inkooplevering\s+(\d+)\s*$/i);
    if (m) return m[1];
    // IKL is de afkorting die de administratie gebruikt voor inkooplevering.
    // Die stond hier niet in, en dat kostte 3,88 miljoen aan verkeerde
    // indeling: "Corr. IKL 14830" (517 regels, 2,52 mln) en "correctie
    // boeking artikel 78775 ikl 20711" (1,32 mln) werden geteld als
    // handmatige correctie zonder herkomst, terwijl ze gewoon naar een
    // inkooplevering verwijzen. Het saldo van 1630 bleef daardoor kloppen,
    // maar de verdeling tussen "openstaande posten" en "correcties" niet -
    // en juist die verdeling bepaalt wat er opgeschoond mag worden.
    m = s.match(/\bikl[.\s:#]*(\d{3,9})/i);
    if (m) return m[1];
    // Leveranciers schrijven het leveringnummer op alle mogelijke manieren:
    // "Lev.nr: 49509", "LEV: 50471", "Levering nr: 48985", en zelfs zonder
    // scheidingsteken als "levering47732".
    m = s.match(/\blev(?:ering)?\.?\s*(?:nr)?[.\s:#]*(\d{4,9})/i);
    if (m) return m[1];
    m = s.match(/levering[:#\s]+(\d{4,9})/i);
    return m ? m[1] : null;
  }

  /* Standaardoptelling: saldo, per jaar, en de boekingen zonder herkomst.
     `sleutelUit` bepaalt waar een regel bij hoort (order, levering, …). */
  function verzamelaar(sleutelUit, bewaarMax) {
    var max = bewaarMax || 400;
    return {
      regels: 0, debet: 0, credit: 0,
      perJaar: {}, perSleutel: {},
      // Kevin vroeg om de impact per jaar (4 aug 2026): "graag een berekening
      // van de impact per jaar, zodat wij een afweging kunnen maken". Het gaat
      // hem om de boekingen zónder herkomst, niet om de hele rekening.
      zonder: { aantal: 0, bedrag: 0, lijst: [], perJaar: {} },
      neem: function (lijst) {
        for (var i = 0; i < lijst.length; i++) {
          var r = lijst[i];
          var d = num(r.AmountDebit), c = num(r.AmountCredit), bedrag = d - c;
          this.regels++; this.debet += d; this.credit += c;
          var jaar = String(r.DateTime || "").slice(0, 4);
          if (!this.perJaar[jaar]) this.perJaar[jaar] = { n: 0, b: 0 };
          this.perJaar[jaar].n++; this.perJaar[jaar].b += bedrag;

          var sleutel = sleutelUit(r.Description);
          if (sleutel) {
            if (!this.perSleutel[sleutel]) this.perSleutel[sleutel] = { n: 0, b: 0 };
            this.perSleutel[sleutel].n++; this.perSleutel[sleutel].b += bedrag;
          } else {
            this.zonder.aantal++; this.zonder.bedrag += bedrag;
            if (!this.zonder.perJaar[jaar]) this.zonder.perJaar[jaar] = { n: 0, b: 0 };
            this.zonder.perJaar[jaar].n++; this.zonder.perJaar[jaar].b += bedrag;
            // Alleen de zwaarste bewaren; dit zijn de posten waar het over gaat.
            if (this.zonder.lijst.length < max * 4) {
              this.zonder.lijst.push({
                datum: String(r.DateTime || "").slice(0, 10),
                bedrag: Math.round(bedrag * 100) / 100,
                boeking: r.BookingId, gebruiker: r.UserId,
                oms: String(r.Description || "").slice(0, 140),
              });
            }
          }
        }
      },
      afronden: function () {
        this.saldo = Math.round((this.debet - this.credit) * 100) / 100;
        this.debet = Math.round(this.debet * 100) / 100;
        this.credit = Math.round(this.credit * 100) / 100;
        this.zonder.bedrag = Math.round(this.zonder.bedrag * 100) / 100;
        for (var j in this.zonder.perJaar) this.zonder.perJaar[j].b = Math.round(this.zonder.perJaar[j].b * 100) / 100;
        this.zonder.lijst.sort(function (a, b) { return Math.abs(b.bedrag) - Math.abs(a.bedrag); });
        this.zonder.lijst = this.zonder.lijst.slice(0, max);
        return this;
      },
    };
  }

  global.fpGrootboek = { lees: lees, orderUit: orderUit, leveringUit: leveringUit, verzamelaar: verzamelaar };

})(typeof window !== "undefined" ? window : globalThis);
