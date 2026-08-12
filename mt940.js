/* ═══════════════════════════════════════════════════════════════════════════
   MT940 — bankafschriften lezen
   ═══════════════════════════════════════════════════════════════════════════

   Deze lezer zat in bankkoppeling.html. Nu de bankaansluiting voor de
   accountant dezelfde bestanden moet lezen, staat hij hier: één lezer, niet
   twee die uit elkaar gaan lopen.

   De code is ongewijzigd overgenomen — bankkoppeling.html draait er al een jaar
   op en dat wil je niet stilletjes veranderen.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  // ─── MT940 parser (SWIFT MT940-standaard) ───────────────────────────
  //
  // Format-skelet:
  //   :20:<reference>
  //   :25:<account/IBAN>
  //   :28C:<statement-nr>
  //   :60F:<C|D><YYMMDD><currency><amount>      ← opening balance
  //   herhaald per transactie:
  //     :61:<value-date YYMMDD>[<entry-date MMDD>][R]<C|D><amount>N<type><ref>
  //     :86:<description, mag multi-line>
  //   :62F:<C|D><YYMMDD><currency><amount>      ← closing balance
  //
  // :86: is bank-specifiek qua sub-formaat (ING/Rabo/ABN doen 't elk net iets
  // anders) maar we lezen het simpelweg als platte tekst — voor matching
  // hoeft alleen het ordernummer + de naam erin gevonden te worden.

  function parseMT940(text) {
    // Normaliseer line endings + verwijder lege regels die geen onderdeel
    // zijn van een :86: continuation.
    const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = raw.split("\n");

    // Groepeer regels per :tag: — een :86:-blok kan over meerdere regels lopen.
    // Een nieuwe tag begint altijd met ":<digits-or-letter>:".
    const blocks = [];
    let cur = null;
    for (const ln of lines) {
      const m = ln.match(/^:(\d+[A-Z]?):(.*)$/);
      if (m) {
        if (cur) blocks.push(cur);
        cur = { tag: m[1], body: m[2] };
      } else if (cur && ln.length) {
        // Continuatie van vorige tag
        cur.body += "\n" + ln;
      }
    }
    if (cur) blocks.push(cur);

    let iban = "", statementNr = "", openingBalance = null, closingBalance = null, telling = null;
    const transactions = [];
    let pending = null, geslotenNa = false;

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.tag === "25")  iban = b.body.trim();
      else if (b.tag === "28C") statementNr = b.body.trim();
      else if (b.tag === "60F" || b.tag === "60M") openingBalance = parseBalance(b.body);
      else if (b.tag === "62F" || b.tag === "62M") {
        closingBalance = parseBalance(b.body);
        /* Hier eindigt de lijst met transacties, en dat moet hier gezegd
           worden. Ná het eindsaldo zet ING nog een :86: neer met de telling
           van het afschrift:

             :62F:C260811EUR175630,63
             :64:C260811EUR175630,63
             :86:D000003C000023D33800,03C67838,80

           Dat is geen omschrijving maar een samenvatting: 3 afboekingen,
           23 bijboekingen, samen 33.800,03 af en 67.838,80 bij. De lezer
           plakte hem aan de laatste transactie en overschreef daarmee de
           echte omschrijving. Osman zag daardoor bij de betaling van J.
           Wenting van 986,40 "D000003C000023D33800,03C67838,80" staan in
           plaats van "aanbetaling bestelling: 3519824", en dus geen match
           (11 aug 2026). */
        if (pending) { transactions.push(pending); pending = null; }
        geslotenNa = true;
      }
      else if (b.tag === "61") {
        // Push de vorige transactie (zonder description) als die er was zonder :86:
        if (pending) transactions.push(pending);
        pending = parseTxLine(b.body);
      } else if (b.tag === "86") {
        if (geslotenNa) { telling = telling || parseTelling(b.body); }
        else if (pending) {
          pending.descRaw = b.body;
          pending.description = cleanDescription(b.body);
        }
      }
    }
    if (pending) transactions.push(pending);

    return { iban, statementNr, openingBalance, closingBalance, transactions, telling };
  }

  function parseBalance(body) {
    // Format: <C|D><YYMMDD><currency 3 chars><amount with comma>
    const m = body.match(/^([CD])(\d{6})([A-Z]{3})([\d,\.]+)/);
    if (!m) return null;
    const sign = m[1] === "C" ? 1 : -1;
    const dateStr = "20" + m[2].slice(0, 2) + "-" + m[2].slice(2, 4) + "-" + m[2].slice(4, 6);
    const amount = sign * parseFloat(m[4].replace(/\./g, "").replace(",", "."));
    return { date: dateStr, currency: m[3], amount };
  }

  function parseTxLine(body) {
    // :61: format kort:
    //   YYMMDD[MMDD][R]<C|D|RC|RD>[<funds-code>]<amount>N<type 3>[<ref…>]
    // We pakken: value-date, sign, amount.
    const m = body.match(/^(\d{6})(\d{4})?(R?[CD])([A-Z])?([\d,\.]+)/);
    if (!m) {
      return { date: null, amount: 0, currency: "EUR", description: "", descRaw: body };
    }
    const yy = parseInt(m[1].slice(0, 2), 10);
    const yyyy = (yy < 70 ? 2000 + yy : 1900 + yy);
    const date = `${yyyy}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}`;
    const dc = m[3];
    const sign = (dc === "C" || dc === "RD") ? 1 : -1; // RD = "Reversal Debit" wordt feitelijk een credit, RC andersom
    // Conventie: gewone C = inkomend (+), gewone D = uitgaand (−).
    const positive = dc.endsWith("C") && !dc.startsWith("R") ? 1
                    : dc === "RD" ? 1
                    : -1;
    const amount = positive * parseFloat(m[5].replace(/\./g, "").replace(",", "."));
    return { date, amount, currency: "EUR", description: "", descRaw: "" };
  }

  function cleanDescription(raw) {
    /* Veel banken proppen sub-codes als /NAME/.../REMI/... in :86:. We strippen
       ze niet; we plakken alleen de vervolgregels aan elkaar.

       Zonder spatie ertussen. Een :86: wordt hard afgekapt op 65 tekens, dwars
       door een woord of een getal heen:

           /REMI/USTD//aanbeta
           ling bestelling: 3519824/

       Met een spatie ertussen werd dat "aanbeta ling bestelling", en valt een
       ordernummer dat net op de knip staat in tweeën. De koppellogica plakte
       ze daarom al zonder spatie aan elkaar; het scherm deed het anders en
       liet dus iets anders zien dan waar op gematcht werd. */
    return raw.replace(/\r?\n/g, "").replace(/[ \t]+/g, " ").trim();
  }

  /* De telling die de bank onderaan het afschrift zet:

       :86:D000003C000023D33800,03C67838,80

     Drie afboekingen, drieëntwintig bijboekingen, samen 33.800,03 af en
     67.838,80 bij. Dat is de eigen controlesom van de bank, en daarmee is na
     te gaan of er niets is gemist bij het inlezen. */
  function parseTelling(body) {
    // Achter de telling staat nog "-XXX", het einde-berichtteken van MT940.
    var m = String(body || "").replace(/\s+/g, "").replace(/-X*$/i, "")
      .match(/^D(\d+)C(\d+)D([\d.,]+)C([\d.,]+)$/i);
    if (!m) return null;
    var getal = function (s) { return parseFloat(s.replace(/\./g, "").replace(",", ".")); };
    return { afboekingen: parseInt(m[1], 10), bijboekingen: parseInt(m[2], 10),
             afTotaal: getal(m[3]), bijTotaal: getal(m[4]) };
  }

  global.fpMT940 = {
    parse: parseMT940,
    parseBalance: parseBalance,
    parseTxLine: parseTxLine,
    cleanDescription: cleanDescription,
    parseTelling: parseTelling,
  };

})(typeof window !== "undefined" ? window : globalThis);
