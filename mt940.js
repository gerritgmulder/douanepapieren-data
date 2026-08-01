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

    let iban = "", statementNr = "", openingBalance = null, closingBalance = null;
    const transactions = [];
    let pending = null;

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.tag === "25")  iban = b.body.trim();
      else if (b.tag === "28C") statementNr = b.body.trim();
      else if (b.tag === "60F" || b.tag === "60M") openingBalance = parseBalance(b.body);
      else if (b.tag === "62F" || b.tag === "62M") closingBalance = parseBalance(b.body);
      else if (b.tag === "61") {
        // Push de vorige transactie (zonder description) als die er was zonder :86:
        if (pending) transactions.push(pending);
        pending = parseTxLine(b.body);
      } else if (b.tag === "86") {
        if (pending) {
          pending.descRaw = b.body;
          pending.description = cleanDescription(b.body);
        }
      }
    }
    if (pending) transactions.push(pending);

    return { iban, statementNr, openingBalance, closingBalance, transactions };
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
    // Veel banken proppen sub-codes als /NAME/.../REMI/... in :86:. We strippen
    // ze niet; we plakken alleen multi-line samen tot één leesbare regel.
    return raw.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  }

  global.fpMT940 = {
    parse: parseMT940,
    parseBalance: parseBalance,
    parseTxLine: parseTxLine,
    cleanDescription: cleanDescription,
  };

})(typeof window !== "undefined" ? window : globalThis);
