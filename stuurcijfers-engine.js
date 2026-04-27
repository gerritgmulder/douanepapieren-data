// Stuurcijfers — formule-engine.
//
// Vervangt de Excel-formules in de OUT_-tabbladen door directe JS-berekening.
// Wordt vanuit stuurcijfers.html aangeroepen na een Excel-import en na elke
// edit op een input-tabel.
//
// Filosofie:
// - Geen generieke Excel-parser. Per OUT_-tabblad is de structuur (welke rij
//   = welke rubriek, welke kolom = welk filter) handmatig overgenomen uit het
//   datamodel. Daarmee blijft de logica leesbaar en eenvoudig te debuggen.
// - Engine werkt op de JSON-tabellen zoals stuurcijfers.html ze kent: array
//   van rijen, eerste rij = column-headers via een aparte `columns`-array.
// - Tekenconventies volgen de Excel: activa positief uit grootboek, passiva
//   en omzet negatief (boekhoudkundig credit).

(function (global) {
  "use strict";

  // ════════════════════════════════════════════════════════════════
  // Generieke helpers
  // ════════════════════════════════════════════════════════════════

  // Vind kolom-index op basis van header-naam (case-insensitive, trim).
  function colIdx(table, name) {
    if (!table || !table.columns) return -1;
    const target = String(name).trim().toLowerCase();
    for (let i = 0; i < table.columns.length; i++) {
      if (String(table.columns[i] || "").trim().toLowerCase() === target) return i;
    }
    return -1;
  }

  // Bouw een bucket-index: per unieke key in keyCol → som van valueCol.
  // Stuk efficiënter dan SUMIF herhalen als je veel verschillende keys hebt.
  function bucketSum(table, keyColIdx, valueColIdx) {
    const buckets = new Map();
    if (!table || !table.rows || keyColIdx < 0 || valueColIdx < 0) return buckets;
    for (const row of table.rows) {
      const key = row[keyColIdx];
      if (key == null || key === "") continue;
      const v = row[valueColIdx];
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      const k = String(key).trim();
      buckets.set(k, (buckets.get(k) || 0) + n);
    }
    return buckets;
  }

  // SUMIF — match key tegen 1 kolom, som value-kolom.
  function sumIf(buckets, key) {
    if (!buckets || key == null || key === "") return 0;
    return buckets.get(String(key).trim()) || 0;
  }

  // SUMIFS met 2 criteria — voor periodebalans (rubriek + maand).
  function bucketSum2(table, key1Col, key2Col, valueCol) {
    const buckets = new Map(); // "key1||key2" → sum
    if (!table || !table.rows) return buckets;
    for (const row of table.rows) {
      const k1 = row[key1Col]; const k2 = row[key2Col];
      if (k1 == null || k2 == null) continue;
      const v = row[valueCol];
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      const key = String(k1).trim() + "||" + String(k2).trim();
      buckets.set(key, (buckets.get(key) || 0) + n);
    }
    return buckets;
  }
  function sumIfs2(buckets, key1, key2) {
    if (key1 == null || key2 == null) return 0;
    return buckets.get(String(key1).trim() + "||" + String(key2).trim()) || 0;
  }

  // ════════════════════════════════════════════════════════════════
  // OUT_Balans — definitie
  // ════════════════════════════════════════════════════════════════
  // Drie secties:
  //   1) Balans (activa + passiva)            rijen 3..92
  //   2) Winst- & verliesrekening cumulatief  rijen 96..130
  //   3) Kasstroomoverzicht                   rijen 133+ (later — minder kritiek)
  //
  // Per rij: { label, type, sign?, ref? }
  //   type 'header'    = sectie-koptekst (geen waarden)
  //   type 'item'      = SUMIF op rubriek = label
  //                       sign +1 (activa/kosten) of -1 (passiva/omzet)
  //                       'beginCol': in B-kolom een SUMIF op Beginbalans;
  //                                   in D-kolom een SUMIF op Grootboek + B-cel
  //                       'wvOnly': geen B (begin), alleen D (cumulatief grootboek)
  //   type 'subtotal'  = SUM van een gemarkeerde range — refs zijn andere row-keys
  //   type 'compute'   = aangepaste formule via callback (bijv. EBITDA)
  //
  // Elke 'item'-rij krijgt een unieke key (default = label, optioneel via 'key:' override).
  const OUT_BALANS_DEF = [
    // ─── BALANS ───────────────────────────────────────────────
    { type: "section", label: "BALANS", colHeaders: ["", "1-1 (€)", "Mutaties (€)", "Nu (€)"] },
    { type: "header",  label: "ACTIVA" },
    { type: "header",  label: "VASTE ACTIVA" },

    { type: "item",    label: "Immateriële vaste activa",          rubriek: "Immateriële vaste activa",          sign: +1, key: "immat" },
    { type: "blank" },
    { type: "item",    label: "Materiële vaste activa",            rubriek: "Materiële vaste activa",            sign: +1, key: "mat" },
    { type: "blank" },
    { type: "header",  label: "Financiële vaste activa" },
    { type: "item",    label: "Waarborgsommen Jazzi",              rubriek: "Waarborgsommen Jazzi",              sign: +1, key: "wbJazzi" },
    { type: "item",    label: "Overige financiële vaste activa",   rubriek: "Overige financiële vaste activa",   sign: +1, key: "ovFinAct" },
    { type: "subtotal", label: "",                                  refs: ["wbJazzi", "ovFinAct"], key: "stFinAct" },
    { type: "blank" },
    { type: "subtotal", label: "TOTAAL VASTE ACTIVA",               refs: ["immat", "mat", "stFinAct"], key: "totVasteAct", bold: true },
    { type: "blank" },

    { type: "header",  label: "VLOTTENDE ACTIVA" },
    { type: "header",  label: "Voorraden" },
    { type: "item",    label: "Emballage",                          rubriek: "Emballage",                          sign: +1, key: "emballage" },
    { type: "item",    label: "Vooruitbetaald op voorraden",        rubriek: "Vooruitbetaald op voorraden",        sign: +1, key: "vbVoor" },
    { type: "item",    label: "Vooruitbetaald op voorraden Jazzi",  rubriek: "Vooruitbetaald op voorraden Jazzi",  sign: +1, key: "vbVoorJazzi" },
    { type: "item",    label: "Voorraad",                           rubriek: "Voorraad",                           sign: +1, key: "voorraad" },
    { type: "subtotal", label: "",                                  refs: ["emballage", "vbVoor", "vbVoorJazzi", "voorraad"], key: "stVoorraden" },
    { type: "blank" },

    { type: "header",  label: "Vorderingen" },
    { type: "item",    label: "Debiteuren",                         rubriek: "Debiteuren",                         sign: +1, key: "debiteuren" },
    { type: "item",    label: "Rekening-courant Fonteyn UK Ltd",    rubriek: "Rekening-courant Fonteyn UK Ltd",    sign: +1, key: "rcFonteynUK" },
    { type: "item",    label: "Rekening-courant Passion Spas USA",  rubriek: "Rekening-courant Passion Spas USA",  sign: +1, key: "rcPassionUSA" },
    { type: "item",    label: "Vooruitbetaalde bedragen",           rubriek: "Vooruitbetaalde bedragen",           sign: +1, key: "vbBedragen" },
    { type: "item",    label: "Nog te ontvangen bedragen",          rubriek: "Nog te ontvangen bedragen",          sign: +1, key: "ntoBedragen" },
    { type: "item",    label: "Overige vorderingen",                rubriek: "Overige vorderingen",                sign: +1, key: "ovVorderingen" },
    { type: "subtotal", label: "",                                  refs: ["debiteuren", "rcFonteynUK", "rcPassionUSA", "vbBedragen", "ntoBedragen", "ovVorderingen"], key: "stVorderingen" },
    { type: "blank" },

    { type: "header",  label: "Tussenrekeningen" },
    { type: "item",    label: "Tussenrekeningen",                   rubriek: "Tussenrekeningen",                   sign: +1, key: "tussenrek" },
    { type: "item",    label: "Vraagposten",                        rubriek: "Vraagposten",                        sign: +1, key: "vraagposten" },
    { type: "item",    label: "Dubbel betaalde facturen",           rubriek: "Dubbel betaalde facturen",           sign: +1, key: "dubbel" },
    { type: "item",    label: "Tussenrekening balans",              rubriek: "Tussenrekening balans",              sign: +1, key: "tussenBal" },
    { type: "item",    label: "Kruisposten",                        rubriek: "Kruisposten",                        sign: +1, key: "kruisposten" },
    { type: "subtotal", label: "",                                  refs: ["tussenrek", "vraagposten", "dubbel", "tussenBal", "kruisposten"], key: "stTussen" },
    { type: "blank" },

    { type: "header",  label: "Liquide middelen" },
    { type: "item",    label: "Bankrekeningen",                     rubriek: "Bankrekeningen",                     sign: +1, key: "banken" },
    { type: "item",    label: "Kas",                                rubriek: "Kas",                                sign: +1, key: "kas" },
    { type: "subtotal", label: "",                                  refs: ["banken", "kas"], key: "stLiquide" },
    { type: "blank" },

    { type: "subtotal", label: "TOTAAL VLOTTENDE ACTIVA",            refs: ["stVoorraden", "stVorderingen", "stTussen", "stLiquide"], key: "totVlotAct", bold: true },
    { type: "blank" },
    { type: "subtotal", label: "TOTAAL ACTIVA",                       refs: ["totVasteAct", "totVlotAct"], key: "totActiva", bold: true, double: true },
    { type: "blank" },

    // ─── PASSIVA ──────────────────────────────────────────────
    { type: "header",  label: "PASSIVA" },
    { type: "header",  label: "Eigen vermogen" },
    { type: "item",    label: "Aandelenkapitaal",                   rubriek: "Aandelenkapitaal",                   sign: -1, key: "aandelen" },
    { type: "item",    label: "Overige reserves",                   rubriek: "Overige reserves",                   sign: -1, key: "ovReserves" },
    { type: "subtotal", label: "",                                  refs: ["aandelen", "ovReserves"], key: "stEV" },
    { type: "blank" },

    { type: "header",  label: "Voorzieningen" },
    { type: "item",    label: "Garantievoorziening",                rubriek: "Garantievoorziening",                sign: -1, key: "garVoor" },
    { type: "item",    label: "Overige voorzieningen",              rubriek: "Overige voorzieningen",              sign: -1, key: "ovVoor" },
    { type: "subtotal", label: "",                                  refs: ["garVoor", "ovVoor"], key: "stVoorzieningen" },
    { type: "blank" },

    { type: "header",  label: "Langlopende schulden" },
    { type: "item",    label: "Langlopende belastingschuld",        rubriek: "Langlopende belastingschuld",        sign: -1, key: "llBelasting" },
    { type: "item",    label: "ING Bank Rentevastlening 80.04.82.360", rubriek: "ING Bank Rentevastlening 80.04.82.360", sign: -1, key: "ingLening" },
    { type: "subtotal", label: "",                                  refs: ["llBelasting", "ingLening"], key: "stLangSchulden" },
    { type: "blank" },

    { type: "subtotal", label: "TOTAAL LANGLOPENDE PASSIVA",         refs: ["stEV", "stVoorzieningen", "stLangSchulden"], key: "totLangPassiva", bold: true },
    { type: "blank" },

    { type: "header",  label: "KORTLOPENDE PASSIVA" },
    { type: "header",  label: "Belastingen" },
    { type: "item",    label: "Omzetbelasting",                     rubriek: "Omzetbelasting",                     sign: -1, key: "omzetBel" },
    { type: "item",    label: "Loonheffing",                        rubriek: "Loonheffing",                        sign: -1, key: "loonh" },
    { type: "item",    label: "Vennootschapsbelasting",             rubriek: "Vennootschapsbelasting",             sign: -1, key: "vpb" },
    { type: "item",    label: "Pensioenpremie",                     rubriek: "Pensioenpremie",                     sign: -1, key: "pensioen" },
    { type: "subtotal", label: "",                                  refs: ["omzetBel", "loonh", "vpb", "pensioen"], key: "stBelasting" },
    { type: "blank" },

    { type: "header",  label: "Kortlopende schulden" },
    { type: "item",    label: "Crediteuren",                        rubriek: "Crediteuren",                        sign: -1, key: "crediteuren" },
    { type: "item",    label: "Rekening-courant Nieland Vastgoed B.V.", rubriek: "Rekening-courant Nieland Vastgoed B.V.", sign: -1, key: "rcNieland" },
    { type: "item",    label: "Ontvangen aanbetalingen",            rubriek: "Ontvangen aanbetalingen",            sign: -1, key: "ontvAanb" },
    { type: "item",    label: "Tussenrekening termijnen",           rubriek: "Tussenrekening termijnen",           sign: -1, key: "tussenTerm" },
    { type: "item",    label: "Te ontvangen facturen",              rubriek: "Te ontvangen facturen",              sign: -1, key: "teOntvFact" },
    { type: "item",    label: "Nog te betalen kosten",              rubriek: "Nog te betalen kosten",              sign: -1, key: "ntbKosten" },
    { type: "item",    label: "Nog te betalen nettoloon",           rubriek: "Nog te betalen nettoloon",           sign: -1, key: "ntbNetto" },
    { type: "item",    label: "Reservering vakantiegeld",           rubriek: "Reservering vakantiegeld",           sign: -1, key: "resVak" },
    { type: "item",    label: "Overige schulden",                   rubriek: "Overige schulden",                   sign: -1, key: "ovSchulden" },
    { type: "subtotal", label: "",                                  refs: ["crediteuren", "rcNieland", "ontvAanb", "tussenTerm", "teOntvFact", "ntbKosten", "ntbNetto", "resVak", "ovSchulden"], key: "stKortSchulden" },
    { type: "blank" },

    { type: "subtotal", label: "TOTAAL KORTLOPENDE PASSIVA",         refs: ["stBelasting", "stKortSchulden"], key: "totKortPassiva", bold: true },
    { type: "blank" },
    { type: "subtotal", label: "TOTAAL PASSIVA",                      refs: ["totLangPassiva", "totKortPassiva"], key: "totPassiva", bold: true, double: true },

    // ─── WINST- & VERLIESREKENING (cumulatief) ────────────────
    { type: "blank" },
    { type: "section", label: "WINST- EN VERLIESREKENING (cumulatief)", colHeaders: ["", "", "", "Cumulatief (€)"] },

    { type: "item",    label: "Omzet",                              rubriek: "Omzet",                              sign: -1, key: "wvOmzet",       wvOnly: true },
    { type: "item",    label: "Kortingen",                          rubriek: "Kortingen",                          sign: -1, key: "wvKortingen",   wvOnly: true },
    { type: "item",    label: "Garanties",                          rubriek: "Garanties",                          sign: -1, key: "wvGaranties",   wvOnly: true },
    { type: "subtotal", label: "Netto-omzet",                       refs: ["wvOmzet", "wvKortingen", "wvGaranties"], key: "wvNettoOmzet", bold: true },
    { type: "blank" },

    { type: "item",    label: "Kostprijs omzet",                    rubriek: "Kostprijs omzet",                    sign: -1, key: "wvKostprijs",  wvOnly: true },
    { type: "item",    label: "Prijsverschillen",                   rubriek: "Prijsverschillen",                   sign: -1, key: "wvPrijsv",     wvOnly: true },
    { type: "item",    label: "Voorraadmutatie",                    rubriek: "Voorraadmutatie",                    sign: -1, key: "wvVoormut",    wvOnly: true },
    { type: "item",    label: "Montage",                            rubriek: "Montage",                            sign: -1, key: "wvMontage",    wvOnly: true },
    { type: "item",    label: "Inkomende transport- en vrachtkosten", rubriek: "Inkomende transport- en vrachtkosten", sign: -1, key: "wvVracht",     wvOnly: true },
    { type: "subtotal", label: "Totaal kostprijs",                  refs: ["wvKostprijs", "wvPrijsv", "wvVoormut", "wvMontage", "wvVracht"], key: "wvTotKostprijs" },
    { type: "blank" },

    { type: "compute", label: "Brutomarge (€)",                     key: "wvBrutomarge",
                       fn: (g) => g.wvNettoOmzet + g.wvTotKostprijs, bold: true },
    { type: "compute", label: "Brutomarge (%)",                     key: "wvBrutomargePct",
                       fn: (g) => g.wvNettoOmzet ? g.wvBrutomarge / g.wvNettoOmzet : 0, format: "pct" },
    { type: "blank" },

    { type: "header",  label: "Overige bedrijfskosten" },
    { type: "item",    label: "Personeelskosten",                   rubriek: "Personeelskosten",                   sign: +1, key: "wvPers",      wvOnly: true },
    { type: "item",    label: "Afschrijvingskosten",                rubriek: "Afschrijvingskosten",                sign: +1, key: "wvAfschr",    wvOnly: true },
    { type: "item",    label: "Huisvestingskosten",                 rubriek: "Huisvestingskosten",                 sign: +1, key: "wvHuis",      wvOnly: true },
    { type: "item",    label: "Verkoopkosten",                      rubriek: "Verkoopkosten",                      sign: +1, key: "wvVerkoop",   wvOnly: true },
    { type: "item",    label: "Autokosten",                         rubriek: "Autokosten",                         sign: +1, key: "wvAuto",      wvOnly: true },
    { type: "item",    label: "Magazijnkosten",                     rubriek: "Magazijnkosten",                     sign: +1, key: "wvMag",       wvOnly: true },
    { type: "item",    label: "Kantoorkosten",                      rubriek: "Kantoorkosten",                      sign: +1, key: "wvKantoor",   wvOnly: true },
    { type: "item",    label: "Algemene kosten",                    rubriek: "Algemene kosten",                    sign: +1, key: "wvAlg",       wvOnly: true },
    { type: "subtotal", label: "Totaal bedrijfskosten",              refs: ["wvPers", "wvAfschr", "wvHuis", "wvVerkoop", "wvAuto", "wvMag", "wvKantoor", "wvAlg"], key: "wvTotBedr" },
    { type: "blank" },

    { type: "compute", label: "EBIT (€)",                            key: "wvEbit",
                       fn: (g) => g.wvBrutomarge - g.wvTotBedr, bold: true },
    { type: "compute", label: "EBIT (%)",                            key: "wvEbitPct",
                       fn: (g) => g.wvNettoOmzet ? g.wvEbit / g.wvNettoOmzet : 0, format: "pct" },
    { type: "blank" },

    { type: "item",    label: "Financiële baten en lasten",          rubriek: "Financiële baten en lasten",         sign: -1, key: "wvFin", wvOnly: true },

    { type: "compute", label: "RESULTAAT VOOR BELASTING",            key: "wvResultaat",
                       fn: (g) => g.wvEbit + g.wvFin, bold: true, double: true },
    { type: "blank" },

    { type: "compute", label: "EBITDA (€)",                          key: "wvEbitda",
                       fn: (g) => g.wvEbit + g.wvAfschr },
    { type: "compute", label: "EBITDA (%)",                          key: "wvEbitdaPct",
                       fn: (g) => g.wvNettoOmzet ? g.wvEbitda / g.wvNettoOmzet : 0, format: "pct" },
  ];

  // ════════════════════════════════════════════════════════════════
  // OUT_Balans calculator
  // ════════════════════════════════════════════════════════════════
  function calcOutBalans(tables) {
    const beginbalans = tables.beginbalans;
    const grootboek   = tables.grootboektransacties;

    // Vereisten
    if (!beginbalans?.rows?.length || !grootboek?.rows?.length) {
      return {
        columns: ["Omschrijving", "1-1 (€)", "Mutaties (€)", "Nu (€)"],
        rows: [["⚠ Beginbalans en/of Grootboektransacties nog niet geïmporteerd.", "", "", ""]]
      };
    }

    // Bouw bucket-indexen één keer
    const bbRubCol = colIdx(beginbalans, "Rubriek");
    const bbValCol = colIdx(beginbalans, "Saldo");
    const gtRubCol = colIdx(grootboek, "Rubriek");
    const gtValCol = colIdx(grootboek, "Bedrag");
    const bbBuckets = bucketSum(beginbalans, bbRubCol, bbValCol);
    const gtBuckets = bucketSum(grootboek, gtRubCol, gtValCol);

    // Eerste pass: per item-rij → bereken B (begin), Mut (mutaties), D (eind)
    // Tweede pass: subtotalen + computes — kunnen dan terugkijken naar eerdere keys.
    const values = {}; // key → {b, mut, d}
    const out = [];

    function pushRow(label, b, mut, d, opts = {}) {
      const fmt = (v) => {
        if (opts.format === "pct") return Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "";
        if (v === undefined || v === null) return "";
        if (v === 0) return 0;
        return v;
      };
      // Subtotalen krijgen UPPER-LABEL als markeer; verdere styling kan later
      // op basis van label-conventies in de UI.
      out.push([label, fmt(b), fmt(mut), fmt(d)]);
    }

    for (const def of OUT_BALANS_DEF) {
      if (def.type === "section") {
        out.push([def.label.toUpperCase(), "", "", ""]);
      } else if (def.type === "header") {
        out.push([def.label, "", "", ""]);
      } else if (def.type === "blank") {
        out.push(["", "", "", ""]);
      } else if (def.type === "item") {
        const sign = def.sign;
        const begin = def.wvOnly ? null : sign * sumIf(bbBuckets, def.rubriek);
        const mut   = sign * sumIf(gtBuckets, def.rubriek);
        const end   = def.wvOnly ? mut : (begin + mut);
        if (def.key) values[def.key] = { b: begin, mut, d: end };
        pushRow(def.label, begin, mut, end, { wv: def.wvOnly });
      } else if (def.type === "subtotal") {
        let b = 0, m = 0, d = 0;
        let anyB = false, anyM = false, anyD = false;
        for (const ref of def.refs || []) {
          const v = values[ref]; if (!v) continue;
          if (v.b !== null && v.b !== undefined) { b += v.b; anyB = true; }
          if (v.mut !== null && v.mut !== undefined) { m += v.mut; anyM = true; }
          if (v.d !== null && v.d !== undefined) { d += v.d; anyD = true; }
        }
        if (def.key) values[def.key] = { b: anyB ? b : null, mut: anyM ? m : null, d: anyD ? d : null };
        pushRow(def.label, anyB ? b : null, anyM ? m : null, anyD ? d : null, def);
      } else if (def.type === "compute") {
        const g = {};
        for (const k of Object.keys(values)) g[k] = values[k]?.d ?? 0;
        const d = def.fn(g);
        if (def.key) values[def.key] = { b: null, mut: null, d };
        pushRow(def.label, null, null, d, def);
      }
    }

    return {
      columns: ["Omschrijving", "Beginstand 1-1 (€)", "Mutaties (€)", "Eindstand (€)"],
      rows: out,
      meta: { values } // voor eventuele debug-inspectie
    };
  }

  // ════════════════════════════════════════════════════════════════
  // Hoofdfunctie — bereken alle OUT_-tabellen vanuit een set inputs.
  // ════════════════════════════════════════════════════════════════
  // input: { beginbalans, grootboektransacties, ... } — zoals stuurcijfers.html ze laadt
  // output: { out_balans: {columns,rows}, out_periodebalans: ..., ... }
  function recalculateAll(tables) {
    const result = {};
    try { result.out_balans = calcOutBalans(tables); }
    catch (e) { result.out_balans = errorTable("OUT_Balans", e); }
    // OUT_Periodebalans, OUT_Resultaten per artikelgroep, OUT_Resultaten SAMGEVAT volgen.
    return result;
  }

  function errorTable(name, e) {
    return {
      columns: ["Fout"],
      rows: [[`Kon ${name} niet berekenen: ${e.message}`]]
    };
  }

  // ════════════════════════════════════════════════════════════════
  // Export
  // ════════════════════════════════════════════════════════════════
  global.StuurcijfersEngine = {
    recalculateAll,
    calcOutBalans,
    // Helpers voor tests / dev console
    _internals: { colIdx, bucketSum, sumIf, bucketSum2, sumIfs2 }
  };
})(typeof window !== "undefined" ? window : globalThis);
