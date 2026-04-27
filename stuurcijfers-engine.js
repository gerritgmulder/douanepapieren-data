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
    // Deze rijen worden ook hergebruikt in OUT_Periodebalans (W&V per maand).
    // Zie WV_DEF hieronder voor dezelfde structuur zonder de balans-prefix.
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
  // Drill-down metadata
  // ════════════════════════════════════════════════════════════════
  // Elke berekende cel krijgt een metadata-record dat beschrijft hoe het getal
  // tot stand is gekomen. De UI gebruikt dit om bij klik op een cel te tonen
  // welke transacties er onder liggen.
  //
  //   { kind: "filter", source, filters: [{col,value}], valueCol, sign,
  //     description }
  //   { kind: "compose", description, parts: [{label, value, refKey?, refRow?}] }
  //   null  — geen drill-down (header / blank / non-numeric)
  function metaFilter(source, filters, valueCol, sign, description) {
    return { kind: "filter", source, filters, valueCol, sign, description };
  }
  function metaCompose(description, parts) {
    return { kind: "compose", description, parts };
  }

  // ════════════════════════════════════════════════════════════════
  // OUT_Balans calculator
  // ════════════════════════════════════════════════════════════════
  function calcOutBalans(tables) {
    const beginbalans = tables.beginbalans;
    const grootboek   = tables.grootboektransacties;

    if (!beginbalans?.rows?.length || !grootboek?.rows?.length) {
      return {
        columns: ["Omschrijving", "1-1 (€)", "Mutaties (€)", "Nu (€)"],
        rows: [["⚠ Beginbalans en/of Grootboektransacties nog niet geïmporteerd.", "", "", ""]],
        meta: [[null, null, null, null]]
      };
    }

    const bbRubCol = colIdx(beginbalans, "Rubriek");
    const bbValCol = colIdx(beginbalans, "Saldo");
    const gtRubCol = colIdx(grootboek, "Rubriek");
    const gtValCol = colIdx(grootboek, "Bedrag");
    const bbBuckets = bucketSum(beginbalans, bbRubCol, bbValCol);
    const gtBuckets = bucketSum(grootboek, gtRubCol, gtValCol);

    const values = {}; // key → { b, mut, d, rowIdx }
    const out = [];
    const meta = []; // parallel met out — meta[r][c] of null

    function pushRow(label, b, mut, d, opts = {}, cellMeta = [null, null, null, null]) {
      const fmt = (v) => {
        if (opts.format === "pct") return Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "";
        if (v === undefined || v === null) return "";
        if (v === 0) return 0;
        return v;
      };
      out.push([label, fmt(b), fmt(mut), fmt(d)]);
      meta.push(cellMeta);
    }

    for (const def of OUT_BALANS_DEF) {
      if (def.type === "section") {
        out.push([def.label.toUpperCase(), "", "", ""]); meta.push([null, null, null, null]);
      } else if (def.type === "header") {
        out.push([def.label, "", "", ""]); meta.push([null, null, null, null]);
      } else if (def.type === "blank") {
        out.push(["", "", "", ""]); meta.push([null, null, null, null]);
      } else if (def.type === "item") {
        const sign = def.sign;
        const begin = def.wvOnly ? null : sign * sumIf(bbBuckets, def.rubriek);
        const mut   = sign * sumIf(gtBuckets, def.rubriek);
        const end   = def.wvOnly ? mut : (begin + mut);
        const rowIdx = out.length;
        if (def.key) values[def.key] = { b: begin, mut, d: end, rowIdx };

        const beginMeta = def.wvOnly ? null
          : metaFilter("beginbalans",
              [{ col: "Rubriek", value: def.rubriek }],
              "Saldo", sign,
              `Beginbalans — Rubriek "${def.rubriek}"`);
        const mutMeta = metaFilter("grootboektransacties",
              [{ col: "Rubriek", value: def.rubriek }],
              "Bedrag", sign,
              `Grootboek — Rubriek "${def.rubriek}"`);
        const endMeta = def.wvOnly ? mutMeta : metaCompose(
              `Beginstand + mutaties`,
              [
                { label: "Beginstand", value: begin, refKey: def.key, refCell: 1 },
                { label: "Mutaties",   value: mut,   refKey: def.key, refCell: 2 },
              ]);

        pushRow(def.label, begin, mut, end, { wv: def.wvOnly },
                [null, beginMeta, mutMeta, endMeta]);
      } else if (def.type === "subtotal") {
        let b = 0, m = 0, d = 0;
        let anyB = false, anyM = false, anyD = false;
        const parts = [];
        for (const ref of def.refs || []) {
          const v = values[ref]; if (!v) continue;
          if (v.b !== null && v.b !== undefined) { b += v.b; anyB = true; }
          if (v.mut !== null && v.mut !== undefined) { m += v.mut; anyM = true; }
          if (v.d !== null && v.d !== undefined) { d += v.d; anyD = true; }
          parts.push({ refKey: ref, value: v.d, refRow: v.rowIdx });
        }
        const rowIdx = out.length;
        if (def.key) values[def.key] = { b: anyB ? b : null, mut: anyM ? m : null, d: anyD ? d : null, rowIdx };

        const compose = metaCompose(
          `Subtotaal: ${parts.length} regel(s)`,
          parts.map(p => ({ label: p.refKey, value: p.value, refRow: p.refRow }))
        );
        pushRow(def.label, anyB ? b : null, anyM ? m : null, anyD ? d : null, def,
                [null,
                 anyB ? compose : null,
                 anyM ? compose : null,
                 anyD ? compose : null]);
      } else if (def.type === "compute") {
        const g = {};
        const partsForMeta = [];
        for (const k of Object.keys(values)) {
          g[k] = values[k]?.d ?? 0;
          if (values[k]?.rowIdx !== undefined) partsForMeta.push({ refKey: k, value: g[k], refRow: values[k].rowIdx });
        }
        const dVal = def.fn(g);
        const rowIdx = out.length;
        if (def.key) values[def.key] = { b: null, mut: null, d: dVal, rowIdx };
        const cm = metaCompose(
          `Berekening: ${def.label} (${def.fn.toString().replace(/\s+/g, " ").slice(0, 100)})`,
          partsForMeta.slice(0, 8) // kort houden
        );
        pushRow(def.label, null, null, dVal, def, [null, null, null, cm]);
      }
    }

    return {
      columns: ["Omschrijving", "Beginstand 1-1 (€)", "Mutaties (€)", "Eindstand (€)"],
      rows: out,
      meta
    };
  }

  // ════════════════════════════════════════════════════════════════
  // OUT_Periodebalans — W&V per maand (Jan..Dec + YTD)
  // ════════════════════════════════════════════════════════════════
  // Hergebruikt de W&V-rij-definities uit OUT_BALANS_DEF: alles vanaf de
  // "WINST- EN VERLIESREKENING"-section tot het einde. Subtotalen, computes
  // en items werken precies hetzelfde, alleen worden de bedragen per maand
  // berekend i.p.v. cumulatief.
  function getWvDef() {
    const out = [];
    let started = false;
    for (const def of OUT_BALANS_DEF) {
      if (def.type === "section" && def.label.toLowerCase().includes("winst")) {
        started = true;
        continue; // section header zelf overslaan — periodebalans heeft eigen header
      }
      if (started) out.push(def);
    }
    return out;
  }

  const MONTHS = ["Januari", "Februari", "Maart", "April", "Mei", "Juni",
                  "Juli", "Augustus", "September", "Oktober", "November", "December"];

  function calcOutPeriodebalans(tables) {
    const grootboek = tables.grootboektransacties;
    if (!grootboek?.rows?.length) {
      return {
        columns: ["Omschrijving", ...MONTHS, "Totaal"],
        rows: [["⚠ Grootboektransacties nog niet geïmporteerd.", ...MONTHS.map(() => ""), ""]]
      };
    }

    const gtRubCol  = colIdx(grootboek, "Rubriek");
    const gtMaCol   = colIdx(grootboek, "Maand");
    const gtBedrag  = colIdx(grootboek, "Bedrag");
    // Index op (Rubriek, Maand) — één scan, dan O(1) lookup per cel.
    const buckets = bucketSum2(grootboek, gtRubCol, gtMaCol, gtBedrag);

    const wvDef = getWvDef();
    const values = {}; // key → { months, total, rowIdx }
    const out = [];
    const meta = [];

    function pushRow(label, monthVals, total, cellMeta) {
      const row = [label];
      for (const v of monthVals) row.push(v == null ? "" : v);
      row.push(total == null ? "" : total);
      out.push(row);
      meta.push(cellMeta);
    }
    const BLANK_META = () => Array(MONTHS.length + 2).fill(null);

    for (const def of wvDef) {
      if (def.type === "header") {
        pushRow(def.label, MONTHS.map(() => ""), "", BLANK_META());
      } else if (def.type === "blank") {
        pushRow("", MONTHS.map(() => ""), "", BLANK_META());
      } else if (def.type === "item") {
        const sign = def.sign;
        const months = MONTHS.map((_, i) => sign * sumIfs2(buckets, def.rubriek, i + 1));
        for (let i = 0; i < 12; i++) {
          if (months[i] === 0) {
            const alt = sign * sumIfs2(buckets, def.rubriek, String(i + 1));
            if (alt !== 0) months[i] = alt;
          }
        }
        const total = months.reduce((s, v) => s + v, 0);
        const rowIdx = out.length;
        if (def.key) values[def.key] = { months, total, rowIdx };

        const cm = BLANK_META();
        for (let i = 0; i < 12; i++) {
          cm[i + 1] = metaFilter("grootboektransacties",
            [{ col: "Rubriek", value: def.rubriek },
             { col: "Maand", value: i + 1 }],
            "Bedrag", sign,
            `${def.label} — ${MONTHS[i]}`);
        }
        cm[MONTHS.length + 1] = metaFilter("grootboektransacties",
          [{ col: "Rubriek", value: def.rubriek }],
          "Bedrag", sign,
          `${def.label} — YTD`);
        pushRow(def.label, months, total, cm);
      } else if (def.type === "subtotal") {
        const months = MONTHS.map(() => 0);
        let total = 0; let any = false;
        const parts = [];
        for (const ref of def.refs || []) {
          const v = values[ref]; if (!v) continue;
          for (let i = 0; i < 12; i++) months[i] += v.months[i];
          total += v.total;
          any = true;
          parts.push({ label: ref, value: v.total, refRow: v.rowIdx });
        }
        const rowIdx = out.length;
        if (def.key) values[def.key] = { months, total, rowIdx };
        const cm = BLANK_META();
        if (any) {
          const compose = metaCompose(`Subtotaal van ${parts.length} regels`, parts);
          for (let i = 1; i <= MONTHS.length + 1; i++) cm[i] = compose;
        }
        pushRow(def.label, any ? months : MONTHS.map(() => null), any ? total : null, cm);
      } else if (def.type === "compute") {
        const monthVals = MONTHS.map((_, i) => {
          const g = {};
          for (const k of Object.keys(values)) g[k] = values[k]?.months?.[i] ?? 0;
          return def.fn(g);
        });
        const totalG = {};
        for (const k of Object.keys(values)) totalG[k] = values[k]?.total ?? 0;
        const total = def.fn(totalG);
        const rowIdx = out.length;
        if (def.key) values[def.key] = { months: monthVals, total, rowIdx };
        const cm = BLANK_META();
        const composeParts = Object.keys(values).slice(0, 8).map(k =>
          ({ label: k, value: values[k]?.total ?? 0, refRow: values[k]?.rowIdx }));
        const cmCompose = metaCompose(`Berekening: ${def.label}`, composeParts);
        for (let i = 1; i <= MONTHS.length + 1; i++) cm[i] = cmCompose;
        if (def.format === "pct") {
          const fmt = (v) => Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "";
          pushRow(def.label, monthVals.map(fmt), fmt(total), cm);
        } else {
          pushRow(def.label, monthVals, total, cm);
        }
      }
    }

    return {
      columns: ["Omschrijving", ...MONTHS, "YTD totaal"],
      rows: out,
      meta
    };
  }

  // ════════════════════════════════════════════════════════════════
  // OUT_Resultaten per artikelgroep
  // ════════════════════════════════════════════════════════════════
  // Zelfde W&V-rij-structuur als OUT_Periodebalans, maar de kolom-as is
  // "artikelgroep" i.p.v. "maand". Excel hardcodet de artikelgroepen in rij 6;
  // wij halen ze dynamisch uit Grootboektransacties zodat nieuwe artikelgroepen
  // niet handmatig hoeven worden toegevoegd.
  //
  // Volgorde uit het datamodel (Excel rij 6) — onbekende artikelgroepen
  // verschijnen alfabetisch achter deze lijst.
  const ARTIKELGROEP_VOLGORDE = [
    "Spa dealers / groothandel", "Spa Houston USA", "Spa particulieren", "Sauna's",
    "Zwembaden", "Tuinmeubelen", "All4Spa Onderdelen", "Spa Passion 4 Life",
    "Veranda's", "Bierbrouwerij", "Boerderij", "Buitenkeukens BBQ",
    "Bloemisterij - Decoratie", "Tuinhuizen", "Spa Passion Icebaths", "Overige",
    "Algemeen", "Groepsmaatschappijen",
  ];

  function getArtikelgroepen(grootboek, agCol) {
    const seen = new Set();
    for (const row of grootboek.rows) {
      const v = row[agCol];
      if (v != null && v !== "") seen.add(String(v).trim());
    }
    const known = ARTIKELGROEP_VOLGORDE.filter(g => seen.has(g));
    const extra = [...seen].filter(g => !ARTIKELGROEP_VOLGORDE.includes(g)).sort();
    return [...known, ...extra];
  }

  function calcOutResultatenPerArtikelgroep(tables) {
    const grootboek = tables.grootboektransacties;
    if (!grootboek?.rows?.length) {
      return {
        columns: ["Omschrijving", "—"],
        rows: [["⚠ Grootboektransacties nog niet geïmporteerd.", ""]]
      };
    }
    const gtRubCol = colIdx(grootboek, "Rubriek");
    const gtAgCol  = colIdx(grootboek, "Artikelgroep");
    const gtBedrag = colIdx(grootboek, "Bedrag");
    if (gtAgCol < 0) {
      return { columns: ["Fout"], rows: [["Kolom 'Artikelgroep' niet gevonden in Grootboektransacties."]] };
    }
    const buckets = bucketSum2(grootboek, gtRubCol, gtAgCol, gtBedrag);
    const groepen = getArtikelgroepen(grootboek, gtAgCol);

    const wvDef = getWvDef();
    const values = {};
    const out = [];
    const meta = [];

    function pushRow(label, perGroep, total, cellMeta) {
      out.push([label, ...perGroep.map(v => v == null ? "" : v), total == null ? "" : total]);
      meta.push(cellMeta);
    }
    const BLANK_META = () => Array(groepen.length + 2).fill(null);

    for (const def of wvDef) {
      if (def.type === "header") {
        pushRow(def.label, groepen.map(() => ""), "", BLANK_META());
      } else if (def.type === "blank") {
        pushRow("", groepen.map(() => ""), "", BLANK_META());
      } else if (def.type === "item") {
        const sign = def.sign;
        const perGroep = groepen.map(g => sign * sumIfs2(buckets, def.rubriek, g));
        const total = perGroep.reduce((s, v) => s + v, 0);
        const rowIdx = out.length;
        if (def.key) values[def.key] = { perGroep, total, rowIdx };

        const cm = BLANK_META();
        for (let i = 0; i < groepen.length; i++) {
          cm[i + 1] = metaFilter("grootboektransacties",
            [{ col: "Rubriek", value: def.rubriek },
             { col: "Artikelgroep", value: groepen[i] }],
            "Bedrag", sign,
            `${def.label} — ${groepen[i]}`);
        }
        cm[groepen.length + 1] = metaFilter("grootboektransacties",
          [{ col: "Rubriek", value: def.rubriek }],
          "Bedrag", sign,
          `${def.label} — alle artikelgroepen`);
        pushRow(def.label, perGroep, total, cm);
      } else if (def.type === "subtotal") {
        const perGroep = groepen.map(() => 0);
        let total = 0; let any = false;
        const parts = [];
        for (const ref of def.refs || []) {
          const v = values[ref]; if (!v) continue;
          for (let i = 0; i < groepen.length; i++) perGroep[i] += v.perGroep[i];
          total += v.total;
          any = true;
          parts.push({ label: ref, value: v.total, refRow: v.rowIdx });
        }
        const rowIdx = out.length;
        if (def.key) values[def.key] = { perGroep, total, rowIdx };
        const cm = BLANK_META();
        if (any) {
          const compose = metaCompose(`Subtotaal van ${parts.length} regels`, parts);
          for (let i = 1; i <= groepen.length + 1; i++) cm[i] = compose;
        }
        pushRow(def.label, any ? perGroep : groepen.map(() => null), any ? total : null, cm);
      } else if (def.type === "compute") {
        const perGroep = groepen.map((_, i) => {
          const g = {};
          for (const k of Object.keys(values)) g[k] = values[k]?.perGroep?.[i] ?? 0;
          return def.fn(g);
        });
        const totalG = {};
        for (const k of Object.keys(values)) totalG[k] = values[k]?.total ?? 0;
        const total = def.fn(totalG);
        const rowIdx = out.length;
        if (def.key) values[def.key] = { perGroep, total, rowIdx };
        const cm = BLANK_META();
        const composeParts = Object.keys(values).slice(0, 8).map(k =>
          ({ label: k, value: values[k]?.total ?? 0, refRow: values[k]?.rowIdx }));
        const cmCompose = metaCompose(`Berekening: ${def.label}`, composeParts);
        for (let i = 1; i <= groepen.length + 1; i++) cm[i] = cmCompose;
        if (def.format === "pct") {
          const fmt = (v) => Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "";
          pushRow(def.label, perGroep.map(fmt), fmt(total), cm);
        } else {
          pushRow(def.label, perGroep, total, cm);
        }
      }
    }

    return {
      columns: ["Omschrijving", ...groepen, "Totaal"],
      rows: out,
      meta,
      _values: values,
      _groepen: groepen,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // OUT_Resultaten SAMGEVAT — samenvatting bovenaan
  // ════════════════════════════════════════════════════════════════
  // De Excel toont een YTD-samenvatting met direct/indirect gesplitst:
  //   - Direct = som artikelgroepen exclusief Algemeen/Groepsmaatschappijen
  //   - Indirect = som artikelgroepen Algemeen + Groepsmaatschappijen
  //   - Totaal = direct + indirect
  // Plus de paar belangrijke regels: omzet, brutomarge, EBIT, EBITDA, Resultaat.
  function calcOutResultatenSamengevat(tables) {
    const perAg = calcOutResultatenPerArtikelgroep(tables);
    if (!perAg._values) return perAg; // foutmelding-pad
    const values = perAg._values;
    const groepen = perAg._groepen;

    const indirectGroepen = new Set(["Algemeen", "Groepsmaatschappijen"]);
    const idxIndirect = groepen.map((g, i) => indirectGroepen.has(g) ? i : -1).filter(i => i >= 0);
    const idxDirect = groepen.map((_, i) => i).filter(i => !idxIndirect.includes(i));

    function sumOver(perGroep, indices) {
      return indices.reduce((s, i) => s + (perGroep[i] || 0), 0);
    }

    // Gegevens-rijen + parallelle meta-array.
    const outRows = [];
    const outMeta = [];

    function metaForFilter(rubriek, indices, label) {
      // Geef voor klikbare cellen een filter-meta die op grootboek filtert
      // op rubriek + (set artikelgroepen).
      const groepenList = indices.map(i => groepen[i]).filter(Boolean);
      if (!groepenList.length) return null;
      return {
        kind: "filter-multi",
        source: "grootboektransacties",
        filters: [{ col: "Rubriek", value: rubriek }],
        artikelgroepen: groepenList,
        valueCol: "Bedrag",
        description: label,
      };
    }

    function pushItemRow(label, key, rubriek) {
      const v = values[key];
      if (!v) {
        outRows.push([label, "", "", "", ""]);
        outMeta.push([null, null, null, null, null]);
        return;
      }
      const direct   = sumOver(v.perGroep, idxDirect);
      const indirect = sumOver(v.perGroep, idxIndirect);
      const totaal   = direct + indirect;
      outRows.push([label, direct, indirect, totaal, ""]);
      outMeta.push([
        null,
        rubriek ? metaForFilter(rubriek, idxDirect, `${label} — direct`) : null,
        rubriek ? metaForFilter(rubriek, idxIndirect, `${label} — indirect`) : null,
        rubriek ? metaForFilter(rubriek, [...idxDirect, ...idxIndirect], `${label} — totaal`) : null,
        null,
      ]);
    }
    function pushSubtotalRow(label, key) {
      // Subtotaal verwijst naar onderliggende keys; voor de UI volstaat een
      // compose met de bedragen.
      pushItemRow(label, key, null);
    }
    function pushPctRow(label, baseKey, divKey) {
      const base = values[baseKey];
      const div  = values[divKey];
      if (!base || !div) { outRows.push([label, "", "", "", ""]); outMeta.push([null, null, null, null, null]); return; }
      const directBase   = sumOver(base.perGroep, idxDirect);
      const indirectBase = sumOver(base.perGroep, idxIndirect);
      const totaalBase   = directBase + indirectBase;
      const directDiv    = sumOver(div.perGroep, idxDirect);
      const indirectDiv  = sumOver(div.perGroep, idxIndirect);
      const totaalDiv    = directDiv + indirectDiv;
      const f = (n, d) => d ? (n / d * 100).toFixed(1) + "%" : "";
      outRows.push([label, f(directBase, directDiv), f(indirectBase, indirectDiv), f(totaalBase, totaalDiv), ""]);
      outMeta.push([null, null, null, null, null]);
    }
    function pushBlank() { outRows.push(["", "", "", "", ""]); outMeta.push([null, null, null, null, null]); }

    // Mapping key → rubriek-naam (voor drill-down). Komt overeen met de defs in OUT_BALANS_DEF.
    const KEY_TO_RUBRIEK = {
      wvOmzet: "Omzet", wvKortingen: "Kortingen", wvGaranties: "Garanties",
      wvKostprijs: "Kostprijs omzet", wvPrijsv: "Prijsverschillen", wvVoormut: "Voorraadmutatie",
      wvMontage: "Montage", wvVracht: "Inkomende transport- en vrachtkosten",
      wvPers: "Personeelskosten", wvAfschr: "Afschrijvingskosten", wvHuis: "Huisvestingskosten",
      wvVerkoop: "Verkoopkosten", wvAuto: "Autokosten", wvMag: "Magazijnkosten",
      wvKantoor: "Kantoorkosten", wvAlg: "Algemene kosten", wvFin: "Financiële baten en lasten",
    };

    pushItemRow("Omzet", "wvOmzet", KEY_TO_RUBRIEK.wvOmzet);
    pushItemRow("Kortingen", "wvKortingen", KEY_TO_RUBRIEK.wvKortingen);
    pushItemRow("Garanties", "wvGaranties", KEY_TO_RUBRIEK.wvGaranties);
    pushSubtotalRow("Netto-omzet", "wvNettoOmzet");
    pushBlank();
    pushItemRow("Kostprijs omzet", "wvKostprijs", KEY_TO_RUBRIEK.wvKostprijs);
    pushItemRow("Prijsverschillen", "wvPrijsv", KEY_TO_RUBRIEK.wvPrijsv);
    pushItemRow("Voorraadmutatie", "wvVoormut", KEY_TO_RUBRIEK.wvVoormut);
    pushItemRow("Montage", "wvMontage", KEY_TO_RUBRIEK.wvMontage);
    pushItemRow("Inkomende transport- en vrachtkosten", "wvVracht", KEY_TO_RUBRIEK.wvVracht);
    pushSubtotalRow("Totaal kostprijs", "wvTotKostprijs");
    pushBlank();
    pushSubtotalRow("Brutomarge (€)", "wvBrutomarge");
    pushPctRow("Brutomarge (%)", "wvBrutomarge", "wvNettoOmzet");
    pushBlank();
    pushItemRow("Personeelskosten", "wvPers", KEY_TO_RUBRIEK.wvPers);
    pushItemRow("Afschrijvingskosten", "wvAfschr", KEY_TO_RUBRIEK.wvAfschr);
    pushItemRow("Huisvestingskosten", "wvHuis", KEY_TO_RUBRIEK.wvHuis);
    pushItemRow("Verkoopkosten", "wvVerkoop", KEY_TO_RUBRIEK.wvVerkoop);
    pushItemRow("Autokosten", "wvAuto", KEY_TO_RUBRIEK.wvAuto);
    pushItemRow("Magazijnkosten", "wvMag", KEY_TO_RUBRIEK.wvMag);
    pushItemRow("Kantoorkosten", "wvKantoor", KEY_TO_RUBRIEK.wvKantoor);
    pushItemRow("Algemene kosten", "wvAlg", KEY_TO_RUBRIEK.wvAlg);
    pushSubtotalRow("Totaal bedrijfskosten", "wvTotBedr");
    pushBlank();
    pushSubtotalRow("EBIT (€)", "wvEbit");
    pushPctRow("EBIT (%)", "wvEbit", "wvNettoOmzet");
    pushItemRow("Financiële baten en lasten", "wvFin", KEY_TO_RUBRIEK.wvFin);
    pushSubtotalRow("Resultaat voor belasting", "wvResultaat");
    pushBlank();
    pushSubtotalRow("EBITDA (€)", "wvEbitda");
    pushPctRow("EBITDA (%)", "wvEbitda", "wvNettoOmzet");

    return {
      columns: ["Omschrijving", "Direct (€)", "Indirect (€)", "Totaal (€)", "Toelichting"],
      rows: outRows,
      meta: outMeta,
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
    try { result.out_periodebalans = calcOutPeriodebalans(tables); }
    catch (e) { result.out_periodebalans = errorTable("OUT_Periodebalans", e); }
    try { result.out_resultaten_artikelgroep = calcOutResultatenPerArtikelgroep(tables); }
    catch (e) { result.out_resultaten_artikelgroep = errorTable("OUT_Resultaten per artikelgroep", e); }
    try { result.out_resultaten_samengevat = calcOutResultatenSamengevat(tables); }
    catch (e) { result.out_resultaten_samengevat = errorTable("OUT_Resultaten SAMGEVAT", e); }
    return result;
  }

  function errorTable(name, e) {
    return {
      columns: ["Fout"],
      rows: [[`Kon ${name} niet berekenen: ${e.message}`]]
    };
  }

  // ════════════════════════════════════════════════════════════════
  // "Wat valt op?" — analyse op de berekende OUT_-data.
  // ════════════════════════════════════════════════════════════════
  // Output is een array Insight-objecten. Elke insight heeft:
  //   severity:    "good" | "warning" | "info"
  //   title:       korte kop (≤ ~60 chars)
  //   description: 1–2 zinnen met cijfers en duiding
  //   action?:     { table, label?, groep?, maand? }  — voor klik-door in UI
  //
  // De analyse is bewust conservatief: 3–6 insights, alleen significante
  // afwijkingen, zodat de overzichtspagina niet vol staat met ruis.
  function analyzeStuurcijfers(tables) {
    const insights = [];

    // Vereisten — zonder transacties kunnen we niets analyseren.
    const grootboek = tables.grootboektransacties;
    if (!grootboek?.rows?.length) return insights;

    const perAg = calcOutResultatenPerArtikelgroep(tables);
    const periode = calcOutPeriodebalans(tables);

    // ─── Signaal 1: brutomarge-uitschieters per artikelgroep ───
    if (perAg._values && perAg._groepen) {
      const v = perAg._values;
      const groepen = perAg._groepen;
      const bruto = v.wvBrutomarge?.perGroep || [];
      const omzet = v.wvNettoOmzet?.perGroep || [];

      const marges = groepen.map((g, i) => {
        const o = omzet[i];
        const b = bruto[i];
        // Negeer artikelgroepen met (te) weinig omzet — daar is %-vergelijking ruis
        if (!Number.isFinite(o) || Math.abs(o) < 50000) return null;
        return { groep: g, marge: b / o, omzet: o, bruto: b };
      }).filter(Boolean);

      if (marges.length >= 3) {
        // Gewogen gemiddelde brutomarge over alle artikelgroepen (op basis van omzet)
        const totOmzet = marges.reduce((s, m) => s + m.omzet, 0);
        const totBruto = marges.reduce((s, m) => s + m.bruto, 0);
        const avgMarge = totOmzet ? totBruto / totOmzet : 0;

        const sorted = marges.slice().sort((a, b) => a.marge - b.marge);
        const worst = sorted[0];
        const best  = sorted[sorted.length - 1];

        const SIGN_PCT = 0.05; // 5 ppt = significant
        if (worst && worst.marge < avgMarge - SIGN_PCT) {
          insights.push({
            severity: "warning",
            title: `${worst.groep}: brutomarge ${pct(worst.marge)}`,
            description: `${pp(avgMarge - worst.marge)} ppt onder het gemiddelde van ${pct(avgMarge)}. Omzet YTD ${euro(worst.omzet)}.`,
            action: { table: "out_resultaten_artikelgroep", groep: worst.groep, label: "Brutomarge (%)" }
          });
        }
        if (best && best.marge > avgMarge + SIGN_PCT) {
          insights.push({
            severity: "good",
            title: `${best.groep}: brutomarge ${pct(best.marge)}`,
            description: `${pp(best.marge - avgMarge)} ppt boven het gemiddelde van ${pct(avgMarge)}. Omzet YTD ${euro(best.omzet)}.`,
            action: { table: "out_resultaten_artikelgroep", groep: best.groep, label: "Brutomarge (%)" }
          });
        }
      }
    }

    // ─── Signaal 2: maand-trends in omzet en brutomarge ───
    if (periode && periode.rows) {
      // Vind de laatst gevulde maand (laatste kolom met non-zero omzet)
      const omzetRow = periode.rows.find(r => r[0] === "Omzet");
      if (omzetRow) {
        // Kolommen: 0 = label, 1..12 = Jan..Dec, 13 = YTD
        const filledMonths = [];
        for (let m = 1; m <= 12; m++) {
          const v = omzetRow[m];
          if (typeof v === "number" && Math.abs(v) > 1000) filledMonths.push(m);
        }
        if (filledMonths.length >= 2) {
          const lastM = filledMonths[filledMonths.length - 1];
          const prior = filledMonths.slice(0, -1);
          const lastOmzet = omzetRow[lastM];
          const avgOmzetPrior = prior.reduce((s, m) => s + omzetRow[m], 0) / prior.length;

          if (avgOmzetPrior > 0) {
            const delta = (lastOmzet - avgOmzetPrior) / avgOmzetPrior;
            const monthName = MONTHS[lastM - 1];
            if (Math.abs(delta) >= 0.20) {
              insights.push({
                severity: delta > 0 ? "good" : "warning",
                title: `Omzet ${monthName}: ${delta > 0 ? "+" : ""}${pct(delta)} t.o.v. gemiddelde`,
                description: `${euro(lastOmzet)} in ${monthName}, gemiddeld ${euro(avgOmzetPrior)} in ${prior.length} eerdere maanden.`,
                action: { table: "out_periodebalans", label: "Omzet" }
              });
            }
          }

          // Brutomarge-trend
          const bmRow = periode.rows.find(r => r[0] === "Brutomarge (%)");
          if (bmRow) {
            const parsePct = (v) => typeof v === "string" && v.endsWith("%")
              ? parseFloat(v.replace(",", ".")) / 100 : null;
            const lastBM = parsePct(bmRow[lastM]);
            const priorBM = prior.map(m => parsePct(bmRow[m])).filter(Number.isFinite);
            if (lastBM != null && priorBM.length) {
              const avgBM = priorBM.reduce((s, v) => s + v, 0) / priorBM.length;
              const dDelta = lastBM - avgBM;
              const monthName = MONTHS[lastM - 1];
              if (Math.abs(dDelta) >= 0.03) { // 3 ppt
                insights.push({
                  severity: dDelta > 0 ? "good" : "warning",
                  title: `Brutomarge ${monthName}: ${pct(lastBM)}`,
                  description: `${pp(Math.abs(dDelta))} ppt ${dDelta > 0 ? "boven" : "onder"} het gemiddelde van eerdere maanden (${pct(avgBM)}).`,
                  action: { table: "out_periodebalans", label: "Brutomarge (%)" }
                });
              }
            }
          }
        }
      }
    }

    // ─── Signaal 3: EBIT-status (positief/negatief jaar?) ───
    if (perAg._values?.wvEbit) {
      const ebitTotal = perAg._values.wvEbit.total;
      const omzetTotal = perAg._values.wvNettoOmzet?.total || 0;
      if (omzetTotal > 0) {
        const ebitPct = ebitTotal / omzetTotal;
        if (ebitTotal < 0) {
          insights.push({
            severity: "warning",
            title: `EBIT YTD: ${euro(ebitTotal)} (verlieslatend)`,
            description: `${pct(ebitPct)} van de netto-omzet. Bekijk welke kostenposten het grootst zijn t.o.v. de marge.`,
            action: { table: "out_resultaten_samengevat", label: "EBIT (€)" }
          });
        } else if (ebitPct < 0.03) {
          insights.push({
            severity: "info",
            title: `EBIT-marge YTD: ${pct(ebitPct)}`,
            description: `Krappe winstgevendheid (${euro(ebitTotal)} op ${euro(omzetTotal)} netto-omzet). Kleine kostenwijziging heeft groot effect.`,
            action: { table: "out_resultaten_samengevat", label: "EBIT (%)" }
          });
        }
      }
    }

    // ─── Signaal 4: hoogste indirecte kostenpost ───
    if (perAg._values && perAg._groepen) {
      const groepen = perAg._groepen;
      const idxIndirect = groepen.map((g, i) => ["Algemeen", "Groepsmaatschappijen"].includes(g) ? i : -1).filter(i => i >= 0);
      const KOSTEN_KEYS = [
        ["wvPers", "Personeelskosten"], ["wvAfschr", "Afschrijvingskosten"],
        ["wvHuis", "Huisvestingskosten"], ["wvVerkoop", "Verkoopkosten"],
        ["wvAuto", "Autokosten"], ["wvMag", "Magazijnkosten"],
        ["wvKantoor", "Kantoorkosten"], ["wvAlg", "Algemene kosten"],
      ];
      const indirectKosten = KOSTEN_KEYS.map(([k, label]) => {
        const v = perAg._values[k]; if (!v) return null;
        const total = idxIndirect.reduce((s, i) => s + (v.perGroep[i] || 0), 0);
        return { key: k, label, total };
      }).filter(Boolean).filter(x => x.total > 0);
      if (indirectKosten.length >= 2) {
        indirectKosten.sort((a, b) => b.total - a.total);
        const top = indirectKosten[0];
        const totaal = indirectKosten.reduce((s, k) => s + k.total, 0);
        const aandeel = top.total / totaal;
        if (aandeel >= 0.35) {
          insights.push({
            severity: "info",
            title: `${top.label}: grootste indirecte kostenpost`,
            description: `${euro(top.total)} (${pct(aandeel)} van alle indirecte kosten). Bekijk de onderliggende boekingen voor de grootste optimalisatie-kans.`,
            action: { table: "out_resultaten_samengevat", label: top.label }
          });
        }
      }
    }

    return insights;
  }

  // ─── Formatting helpers (alleen voor analyse, geen UI-locale) ───
  function pct(n) {
    if (!Number.isFinite(n)) return "—";
    return (n * 100).toFixed(1).replace(".", ",") + "%";
  }
  function pp(n) {
    return (Math.abs(n) * 100).toFixed(1).replace(".", ",");
  }
  function euro(n) {
    if (!Number.isFinite(n)) return "—";
    return "€ " + Math.round(n).toLocaleString("nl-NL");
  }

  // ════════════════════════════════════════════════════════════════
  // Export
  // ════════════════════════════════════════════════════════════════
  global.StuurcijfersEngine = {
    recalculateAll,
    calcOutBalans,
    calcOutPeriodebalans,
    calcOutResultatenPerArtikelgroep,
    calcOutResultatenSamengevat,
    analyzeStuurcijfers,
    // Helpers voor tests / dev console
    _internals: { colIdx, bucketSum, sumIf, bucketSum2, sumIfs2 }
  };
})(typeof window !== "undefined" ? window : globalThis);
