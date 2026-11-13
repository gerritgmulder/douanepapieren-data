/* ═════════════════════════════════════════════════════════════════
   INKOOP - de hele straat van leverancier tot website in één tegel
   ═════════════════════════════════════════════════════════════════
   Gerrit (11 nov 2026): "We willen nu het inkoopproces volledig makkelijker
   gaan maken door automatiseringen toe te passen ... deze hele straat
   zorgvuldig maken in het Dashboard zodat elke stap rekening houdt met de
   volgende." De stappen:

   1. Leverancier: alles wat Logic4 bij de crediteur weet, plus onze eigen
      afspraken (tegel Leveranciersinformatie, bucket prijslijsten).
   2. Artikelen van die leverancier, met inkoopprijs, voorraad, minimum,
      wat er al besteld is, locatie in Uddel, en het inkoopadvies.
   3. Inkooporder maken uit die artikelen (Logic4 CreateBuyOrder). Alleen
      als de afspraken met de leverancier compleet zijn.
   4. De leverancier krijgt de order met een eigen uploadlink. Daar zet hij
      de proforma, de Bill of Lading en de packing list neer. Het Dashboard
      leest ze (zelfde lezer als de tegel Proforma's) en vergelijkt ze met
      de inkooporder. Verschil = bericht aan de inkoper.
   5. Betalingen (aanbetaling, rest) en de fases: in productie, op zee.
   6. Binnen: Manon streept de packing list af tegen de inkooporder en maakt
      met één knop de inkooplevering in Logic4. Verschil = bericht aan de
      inkoper. Daarna een bericht aan marketing: op de website zetten.
   7. Locaties: waar ligt wat in het magazijn in Uddel.

   Logic4 kan artikelen niet per leverancier opvragen. Daarom houdt het
   Dashboard een eigen lijst bij (D1 straat_art): artikel, leverancier,
   inkoopprijs, minimum, voorraad en locaties in Uddel. Die wordt in
   stapjes ververst vanuit de tegel (elk verzoek mag hooguit 50 aanroepen
   doen), nooit in de cron, zodat de andere rondes er geen last van hebben.

   Opslag: D1 (straat_*), bestanden in het Archief (inkoopfile:straat/...).
   ═════════════════════════════════════════════════════════════════ */

const IS_WH_UDDEL = 21;                 // magazijn Fonteyn
const IS_LOGO = "https://raw.githubusercontent.com/gerritgmulder/douanepapieren-data/main/fonteyn-logo.png";
const IS_LINK = "https://fonteyn-data-store.g-mulder.workers.dev";
const IS_MAX_BESTAND = 24 * 1024 * 1024;
/* De mail aan de leverancier gaat pas echt de deur uit na het akkoord van
   Gerrit op de tekst (memory mails-eerst-laten-zien). Voorbeeld werkt al. */
const IS_MAIL_AAN = true;   // Gerrit akkoord op de tekst, 13 nov 2026
const IS_DOC_SOORT = { proforma: "Proforma invoice", bl: "Bill of Lading", packinglist: "Packing list", overig: "Other document" };

let _isTabel = false;
async function isDb(env) {
  const db = env.ACTIVITEIT;
  if (!_isTabel) {
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS straat_art (pid INTEGER PRIMARY KEY, code TEXT, naam TEXT, creditor INTEGER, levcode TEXT, prijs REAL, actief INTEGER, minimum REAL, voorraad REAL, vrij REAL, locaties TEXT, ts INTEGER)"),
      db.prepare("CREATE INDEX IF NOT EXISTS straat_art_cred ON straat_art (creditor)"),
      db.prepare("CREATE INDEX IF NOT EXISTS straat_art_code ON straat_art (code)"),
      db.prepare("CREATE TABLE IF NOT EXISTS straat_order (id INTEGER PRIMARY KEY, creditor INTEGER, json TEXT, ts INTEGER)"),
      db.prepare("CREATE INDEX IF NOT EXISTS straat_order_cred ON straat_order (creditor)"),
      db.prepare("CREATE TABLE IF NOT EXISTS straat_doc (id TEXT PRIMARY KEY, iko INTEGER, soort TEXT, naam TEXT, grootte INTEGER, door TEXT, ts INTEGER, json TEXT)"),
      db.prepare("CREATE INDEX IF NOT EXISTS straat_doc_iko ON straat_doc (iko)"),
      db.prepare("CREATE TABLE IF NOT EXISTS straat_token (token TEXT PRIMARY KEY, iko INTEGER, ts INTEGER)"),
      db.prepare("CREATE TABLE IF NOT EXISTS straat_lev (creditor INTEGER PRIMARY KEY, json TEXT, ts INTEGER)"),
      db.prepare("CREATE TABLE IF NOT EXISTS straat_cache (k TEXT PRIMARY KEY, v TEXT, ts INTEGER)"),
    ]);
    _isTabel = true;
  }
  return db;
}

function isEsc(x) { return String(x == null ? "" : x).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function isJson(t, d) { try { return JSON.parse(t); } catch (e) { return d; } }
function isCode(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join(""); }
function isS(x, max) { return String(x == null ? "" : x).trim().slice(0, max || 200); }
function isGetal(x) { const n = Number(String(x == null ? "" : x).replace(",", ".")); return isFinite(n) ? n : 0; }
function isNorm(x) { return String(x || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
async function isCacheLees(db, k, maxMs) {
  const r = await db.prepare("SELECT v, ts FROM straat_cache WHERE k = ?1").bind(k).first();
  return r && (!maxMs || Date.now() - r.ts < maxMs) ? isJson(r.v, null) : null;
}
async function isCacheZet(db, k, v) { await db.prepare("INSERT OR REPLACE INTO straat_cache (k, v, ts) VALUES (?1, ?2, ?3)").bind(k, JSON.stringify(v), Date.now()).run(); }

/* ── Logic4 ─────────────────────────────────────────────────────────────── */
async function isL4(env, H, pad, body, methode) {
  const token = await H.l4Token(env);
  const r = await fetch("https://api.logic4server.nl" + pad, {
    method: methode || (body === undefined ? "GET" : "POST"),
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await r.text();
  let j = null; try { j = JSON.parse(tekst); } catch (e) {}
  if (!r.ok) throw new Error(pad.split("/").pop() + " gaf " + r.status + ": " + String((j && (j.detail || j.title || j.Message)) || tekst).slice(0, 200));
  return j && j.Records !== undefined ? j.Records : j;
}
const isLijst = (x) => Array.isArray(x) ? x : ((x && (x.Records || x.Items)) || []);

/* ── Leveranciers ───────────────────────────────────────────────────────── */
async function isCrediteuren(env, H, db, vers) {
  const c = vers ? null : await isCacheLees(db, "crediteuren", 12 * 3600000);
  if (c) return c;
  const uit = [];
  for (let skip = 0; skip < 10000; skip += 500) {
    const r = isLijst(await isL4(env, H, "/v3/Relations/GetCreditors", { SkipRecords: skip, TakeRecords: 500 }));
    for (const x of r) uit.push({
      id: x.Id, naam: String(x.CompanyName || [x.FirstName, x.LastName].filter(Boolean).join(" ") || ("Crediteur " + x.Id)).trim(),
      plaats: x.City || "", email: x.EmailAddress || "", soort: (x.CreditorType && (x.CreditorType.Description || x.CreditorType.Name)) || x.CreditorType || "",
    });
    if (r.length < 500) break;
  }
  await isCacheZet(db, "crediteuren", uit);
  return uit;
}
async function isCrediteur(env, H, id) {
  const r = isLijst(await isL4(env, H, "/v3/Relations/GetCreditors", { Id: Number(id), TakeRecords: 1 }));
  return r.find(x => Number(x.Id) === Number(id)) || null;
}

/* Onze eigen afspraken staan in de bucket prijslijsten, per map (de naam die
   Gretha/Chantal eraan gaf), niet per crediteurnummer. De koppeling map <->
   crediteur bewaren we hier (straat_lev); zonder koppeling raden we op naam. */
async function isAfsprakenBucket(env) {
  return (await env.FONTEYN_DATA.get("prijslijsten", { type: "json" })) || { mappen: [], afspraken: {} };
}
function isRaadMap(bucket, naam) {
  const n = isNorm(naam).replace(/(coltd|co|ltd|limited|bv|gmbh|company|industrial|industry|trading)$/g, "");
  if (!n) return "";
  const mappen = Object.keys(bucket.afspraken || {}).concat((bucket.mappen || []).map(m => typeof m === "string" ? m : (m && m.naam) || ""));
  let best = "", score = 0;
  for (const m of [...new Set(mappen.filter(Boolean))]) {
    const a = bucket.afspraken && bucket.afspraken[m] || {};
    for (const kand of [m, a.fabriekExtern, a.fabriekIntern]) {
      const k = isNorm(kand);
      if (!k || k.length < 3) continue;
      const s = n.includes(k) || k.includes(n.slice(0, Math.max(4, Math.min(n.length, 8)))) ? Math.min(k.length, n.length) : 0;
      if (s > score) { score = s; best = m; }
    }
  }
  return score >= 4 ? best : "";
}
/* Dezelfde regel als ontbreekt() in de tegel Leveranciersinformatie:
   zolang dit niet compleet is, geen inkooporder. */
function isOntbreekt(a, artikelen) {
  a = a || {};
  const m = [];
  if (!isS(a.contact)) m.push("contactpersoon");
  if (!isS(a.fabriekIntern)) m.push("fabriek (intern)");
  if (!isS(a.fabriekExtern)) m.push("fabriek (extern)");
  if (!isS(a.betaling)) m.push("betalingsvoorwaarden");
  if (!["ja", "nee"].includes(a.magazijnNL)) m.push("magazijn in Nederland");
  const inkoop = a.inkoop || {};
  if (!["magazijn", "bezorgd", "ft40", "ft20"].some(k => isS((inkoop[k] || {}).lt))) m.push("productietijd");
  if (!isS(a.startmoment)) m.push("startmoment productietijd");
  if (!isS(a.boete)) m.push("boeteclausule");
  if (artikelen !== undefined && !(artikelen || []).some(x => x && x.codeIntern && x.prijs)) m.push("minstens één artikel met code en prijs");
  return m;
}
async function isLevKoppeling(db, creditor) {
  const r = await db.prepare("SELECT json FROM straat_lev WHERE creditor = ?1").bind(Number(creditor)).first();
  return r ? isJson(r.json, {}) : {};
}

/* "Fonteyn - Plein Devine -   -  " wordt "Plein Devine": lege stukken en de
   naam van het magazijn eraf, want alles hier is Uddel. */
function isLocNaam(x) {
  const d = String(x || "").split(/\s+-\s+|\s+-$|^-\s+/).map(t => t.trim()).filter(t => t && t !== "-");
  if (d.length > 1 && /^fonteyn$/i.test(d[0])) d.shift();
  return d.join(" - ");
}

/* ── De artikellijst: artikel -> leverancier, prijs, voorraad, locatie ─── */
async function isLocatiesUddel(env, H, db) {
  const c = await isCacheLees(db, "locaties", 24 * 3600000);
  if (c) return c;
  const r = isLijst(await isL4(env, H, "/v3/Stock/GetWarehousesStockLocationsForAdministration", 1));
  const uit = {};
  for (const x of r) uit[x.Id] = { naam: x.LocationName || x.Name || String(x.Id), wh: x.WarehouseId, whNaam: x.WarehouseName || "", rij: x.RowName || "", kolom: x.ColumnName || "" };
  await isCacheZet(db, "locaties", uit);
  return uit;
}
/* Eén stap: hooguit 8 pagina's van 500 artikelen (4 aanroepen per pagina).
   De tegel roept dit herhaald aan tot klaar = true. */
async function isIndexStap(env, H, db) {
  let st = (await isCacheLees(db, "index-stand")) || {};
  if (!st.bezig) st = { bezig: true, skip: 0, gestart: Date.now(), n: 0 };
  const loc = await isLocatiesUddel(env, H, db);
  for (let pagina = 0; pagina < 7; pagina++) {
    const prod = isLijst(await isL4(env, H, "/v3/Products/GetProducts", { SkipRecords: st.skip, TakeRecords: 500 }));
    if (!prod.length) { st.bezig = false; break; }
    const ids = prod.map(p => Number(p.ProductId)).filter(Boolean);
    const [lev, mins, locs, voor] = await Promise.all([
      isL4(env, H, "/v3/Products/GetSuppliersForProducts", { ProductIds: ids, TakeRecords: 5000 }).catch(() => []),
      isL4(env, H, "/v3/Stock/GetMinimalStockNumbersForProducts", ids).catch(() => []),
      isL4(env, H, "/v3/Stock/GetStockLocationsForProducts", { ProductIds: ids }).catch(() => []),
      /* Voorraad en vrije voorraad per magazijn. De locaties geven bij
         "vrij" 0 terug (Aquacheck: 294 op voorraad, 292 vrij, locaties 0),
         dus die tellen we hier niet op. */
      isL4(env, H, "/v3/Stock/GetStockInformationForProduct", { ProductIds: ids }).catch(() => []),
    ]);
    const stockVan = {};
    for (const x of isLijst(voor)) {
      const wh = (x.StockInformation || []).find(w => Number(w.WarehouseId) === IS_WH_UDDEL);
      stockVan[Number(x.ProductId)] = { qty: wh ? Number(wh.ActualStock) || 0 : 0, vrij: wh ? Number(wh.FreeStock) || 0 : 0 };
    }
    const levVan = {}, minVan = {}, locVan = {};
    for (const l of isLijst(lev)) {
      const k = Number(l.ProductId);
      // De actieve leverancier wint; anders de eerste.
      if (!levVan[k] || l.IsActive) levVan[k] = l;
    }
    for (const m of isLijst(mins)) {
      const wh = (m.MinimalStockWarehouses || []).find(w => Number(w.WarehouseId || w.Key) === IS_WH_UDDEL);
      minVan[Number(m.ProductId)] = Number(wh ? (wh.MinimalStock || wh.Value || 0) : 0) || Number(m.MinimalStockProductLevel || 0) || Number(m.MinimalStockForAdministrationLevel || 0) || 0;
    }
    for (const l of isLijst(locs)) {
      const k = Number(l.ProductId), info = loc[l.LocationId] || {};
      if (info.wh && Number(info.wh) !== IS_WH_UDDEL) continue;     // alleen Uddel
      (locVan[k] = locVan[k] || []).push({ id: l.LocationId, naam: isLocNaam(l.Location || info.naam || ""), qty: Number(l.Qty) || 0, vrij: Number(l.FreeStock) || 0 });
    }
    const rijen = [];
    for (const p of prod) {
      const k = Number(p.ProductId);
      if (!k || Number(p.StatusId) === 10) continue;               // vervallen artikelen niet
      const l = levVan[k], lc = locVan[k] || [];
      const sv = stockVan[k] || { qty: lc.reduce((n, x) => n + x.qty, 0), vrij: 0 };
      const voorraad = sv.qty, vrij = sv.vrij;
      if (!l && !voorraad) continue;                              // niets mee te doen
      const prijzen = l && l.CreditorBuyPrices;
      const prijs = Array.isArray(prijzen) ? Number((prijzen[0] || {}).Value || 0) : prijzen && typeof prijzen === "object" ? Number(Object.values(prijzen)[0] || 0) : Number(p.BuyPrice || 0);
      rijen.push(db.prepare("INSERT OR REPLACE INTO straat_art (pid, code, naam, creditor, levcode, prijs, actief, minimum, voorraad, vrij, locaties, ts) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)")
        .bind(k, String(p.ProductCode || ""), String(p.ProductName1 || "").slice(0, 200), l ? Number(l.CreditorId) : null, l ? String(l.CreditorProductCode || "") : "",
              prijs || Number(p.BuyPrice || 0) || 0, l && l.IsActive ? 1 : 0, minVan[k] || 0, voorraad, vrij, JSON.stringify(lc.slice(0, 12)), Date.now()));
    }
    for (let i = 0; i < rijen.length; i += 80) await db.batch(rijen.slice(i, i + 80));
    st.n += rijen.length;
    st.skip += prod.length;
    if (prod.length < 500) { st.bezig = false; break; }
  }
  if (!st.bezig) { st.klaar = Date.now(); st.skip = 0; }
  await isCacheZet(db, "index-stand", st);
  return { ok: true, klaar: !st.bezig, verwerkt: st.skip, artikelen: st.n, laatsteKeer: st.klaar || null };
}

/* Open inkooporders van een leverancier, met per artikel wat nog komt. */
async function isOpenOrders(env, H, creditor) {
  const orders = isLijst(await isL4(env, H, "/v3/BuyOrders/GetBuyOrders", { SupplierId: Number(creditor), BuyOrderIsClosed: false, TakeRecords: 200 }));
  const besteld = {}, uit = [];
  const lijst = orders.slice(0, 25), rowsVan = {};
  for (let i = 0; i < lijst.length; i += 6) {
    const deel = lijst.slice(i, i + 6);
    const res = await Promise.all(deel.map(o => isL4(env, H, "/v3/BuyOrders/GetBuyOrderRowsByFilter", { BuyOrderId: Number(o.Id), TakeRecords: 1000 }).catch(() => [])));
    deel.forEach((o, j) => { rowsVan[o.Id] = isLijst(res[j]); });
  }
  for (const o of lijst) {
    const rows = rowsVan[o.Id] || [];
    let open = 0;
    for (const r of rows) {
      const q = Number(r.QtyToDeliver != null ? r.QtyToDeliver : r.QtyToOrder) || 0;
      if (q > 0) { besteld[Number(r.ProductId)] = (besteld[Number(r.ProductId)] || 0) + q; open += q; }
    }
    uit.push({ id: o.Id, datum: o.CreatedAt, opmerking: o.Remarks || "", regels: rows.length, open });
  }
  return { orders: uit, besteld };
}

/* ── Inkooporders en hun straat ─────────────────────────────────────────── */
async function isOrderLees(db, id) {
  const r = await db.prepare("SELECT * FROM straat_order WHERE id = ?1").bind(Number(id)).first();
  return r ? Object.assign(isJson(r.json, {}), { id: r.id, creditor: r.creditor }) : null;
}
async function isOrderSchrijf(db, o) {
  const { id, creditor, ...rest } = o;
  await db.prepare("INSERT OR REPLACE INTO straat_order (id, creditor, json, ts) VALUES (?1, ?2, ?3, ?4)").bind(Number(id), Number(creditor) || null, JSON.stringify(rest), Date.now()).run();
}
function isLog(o, wie, wat) { o.log = (o.log || []).concat([{ ts: Date.now(), wie: wie || "het Dashboard", wat: String(wat).slice(0, 300) }]).slice(-120); }

async function isOrderRegels(env, H, db, iko) {
  const rows = isLijst(await isL4(env, H, "/v3/BuyOrders/GetBuyOrderRowsByFilter", { BuyOrderId: Number(iko), TakeRecords: 1000 }));
  const pids = rows.map(r => Number(r.ProductId)).filter(Boolean);
  const art = {};
  for (let i = 0; i < pids.length; i += 90) {
    const deel = pids.slice(i, i + 90);
    const rs = await db.prepare("SELECT pid, locaties FROM straat_art WHERE pid IN (" + deel.map((_, j) => "?" + (j + 1)).join(",") + ")").bind(...deel).all();
    for (const x of rs.results || []) art[x.pid] = isJson(x.locaties, []);
  }
  return rows.map(r => ({
    rij: r.BuyOrderRowId, pid: Number(r.ProductId), code: r.ProductCode || "", levcode: r.CreditorProductCode || "",
    oms: r.Description || r.ProductDesc1 || "", besteld: Number(r.QtyToOrder) || 0, teLeveren: Number(r.QtyToDeliver != null ? r.QtyToDeliver : r.QtyToOrder) || 0,
    prijs: Number(r.Price) || 0, klant: r.DebtorName || "", order: r.OrderId || null, verwacht: r.ExpectedDeliveryDate || "",
    locatie: (art[Number(r.ProductId)] || []).map(l => isLocNaam(l.naam)).filter(Boolean).slice(0, 3).join(", "),
  }));
}

/* Een document (proforma, BL, packing list) naast de inkooporder leggen.
   Koppelen op de code van de leverancier, dan onze eigen code, dan op
   woorden in de omschrijving. */
function isVergelijk(regels, doc) {
  const docR = (doc.regels || []).map((r, i) => Object.assign({ i, gebruikt: false }, r));
  const woorden = (s) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2));
  const uit = [];
  for (const r of regels) {
    let m = docR.find(d => !d.gebruikt && d.code && (isNorm(d.code) === isNorm(r.levcode) || isNorm(d.code) === isNorm(r.code)));
    if (!m) {
      const a = woorden(r.oms + " " + r.levcode);
      let best = null, s = 0;
      for (const d of docR) {
        if (d.gebruikt) continue;
        const b = woorden(d.omschrijving + " " + d.kleur + " " + d.code);
        const gedeeld = [...a].filter(w => b.has(w)).length / Math.max(1, Math.min(a.size, b.size));
        if (gedeeld > s) { s = gedeeld; best = d; }
      }
      if (best && s >= 0.5) m = best;
    }
    if (m) m.gebruikt = true;
    const docAantal = m ? Number(m.aantal) || 0 : 0;
    const prijsAnders = m && m.prijs && r.prijs && Math.abs(m.prijs - r.prijs) > Math.max(0.5, r.prijs * 0.01);
    uit.push({ code: r.code, oms: r.oms, besteld: r.besteld, doc: docAantal, docOms: m ? (m.omschrijving || m.code) : "", verschil: Math.round((docAantal - r.besteld) * 100) / 100,
      prijs: r.prijs, docPrijs: m ? m.prijs : null, prijsAnders: !!prijsAnders, gevonden: !!m });
  }
  const extra = docR.filter(d => !d.gebruikt).map(d => ({ code: d.code, oms: d.omschrijving, aantal: d.aantal }));
  const afwijkingen = uit.filter(x => x.verschil !== 0 || x.prijsAnders).length + extra.length;
  return { regels: uit, extra, afwijkingen };
}

/* ── Berichten ──────────────────────────────────────────────────────────── */
async function isAanVoor(env, H, namen) {
  const uit = [];
  for (const n of namen) { const k = String(n).toLowerCase(); if (k.includes("@")) uit.push(k); else uit.push(k + "@fonteyn.nl", k, "fonteyn." + k); }
  return [...new Set(uit)];
}
async function isBericht(env, H, id, aanNamen, titel, tekst, ref, soort) {
  if (!H.berichtenLees || !aanNamen.length) return;
  const d = await H.berichtenLees(env);
  H.berichtErbij(d, { id, aan: await isAanVoor(env, H, aanNamen), soort: soort || "inkoop", titel, tekst, ref });
  await env.FONTEYN_DATA.put("berichten", JSON.stringify(d));
}
/* Gerrit (11 nov 2026): "inkopers bij Fonteyn zijn Dolf en Don. 'Bestellers'
   zijn Rosalie, Don, Lisette, Gretha, Chantal, Joppe, Arno." Een verschil
   gaat naar de inkopers (groep inkopers) en naar wie de order maakte. */
async function isInkopersVan(env, H, o) {
  const namen = H.groepLeden ? await H.groepLeden(env, "inkopers") : [];
  if (o && o.besteller) namen.push(o.besteller);
  return [...new Set(namen.length ? namen : ["dolf", "don"])];
}

/* ── Documenten ─────────────────────────────────────────────────────────── */
async function isDocBewaar(env, H, db, iko, soort, naam, buf, tekst, door) {
  if (!IS_DOC_SOORT[soort]) throw new Error("Onbekende soort document.");
  if (!buf || !buf.byteLength) throw new Error("Het bestand is leeg.");
  if (buf.byteLength > IS_MAX_BESTAND) throw new Error("Het bestand is groter dan 24 MB.");
  const id = isCode(14);
  // In een lokale proefdraai (DEV_OPEN) doet het archief niet mee; live wel.
  try { await H.bestandZet(env, "inkoopfile:straat/" + id, buf); } catch (e) { if (!env.DEV_OPEN) throw e; }
  let gelezen = null, fout = null;
  if (tekst && String(tekst).trim().length > 40 && soort !== "overig") {
    try { gelezen = await H.proformaLees(env, tekst, naam); } catch (e) { fout = String(e.message || e).slice(0, 200); }
  }
  const json = { gelezen, leesFout: fout };
  await db.prepare("INSERT INTO straat_doc (id, iko, soort, naam, grootte, door, ts, json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")
    .bind(id, Number(iko), soort, isS(naam, 160), buf.byteLength, isS(door, 80), Date.now(), JSON.stringify(json)).run();
  // Vergelijken met de inkooporder en zo nodig de inkoper seinen.
  const o = (await isOrderLees(db, iko)) || { id: Number(iko), creditor: null };
  let vgl = null;
  if (gelezen && Array.isArray(gelezen.regels) && gelezen.regels.length) {
    const regels = await isOrderRegels(env, H, db, iko);
    vgl = isVergelijk(regels, gelezen);
    json.vergelijk = vgl;
    await db.prepare("UPDATE straat_doc SET json = ?2 WHERE id = ?1").bind(id, JSON.stringify(json)).run();
  }
  if (soort === "proforma" && !o.proformaOp) o.proformaOp = Date.now();
  if (soort === "bl") { o.blOp = o.blOp || Date.now(); if (!o.opZee) o.opZee = Date.now(); }
  if (soort === "packinglist") o.packinglistOp = o.packinglistOp || Date.now();
  isLog(o, door, IS_DOC_SOORT[soort] + " ontvangen: " + naam + (vgl ? (vgl.afwijkingen ? " (" + vgl.afwijkingen + " verschil" + (vgl.afwijkingen > 1 ? "len" : "") + ")" : " (klopt met de inkooporder)") : ""));
  await isOrderSchrijf(db, o);
  const inkoper = await isInkopersVan(env, H, o);
  const link = "inkoopstraat.html?iko=" + encodeURIComponent(iko);
  if (vgl && vgl.afwijkingen) {
    await isBericht(env, H, "is-vgl-" + id, inkoper, "Verschil op inkooporder " + iko + ": " + IS_DOC_SOORT[soort],
      vgl.afwijkingen + " regel(s) wijken af van de inkooporder. Bekijk ze en maak zo nodig een afspraak met de leverancier.", { iko, link }).catch(() => {});
  } else {
    await isBericht(env, H, "is-doc-" + id, inkoper, IS_DOC_SOORT[soort] + " ontvangen voor inkooporder " + iko, naam, { iko, link }).catch(() => {});
  }
  // De packing list is voor Manon: zij maakt er de inkooplevering mee.
  if (soort === "packinglist") {
    await isBericht(env, H, "is-pl-" + id, ["manon"], "Packing list voor inkooporder " + iko,
      "De leverancier heeft de packing list gestuurd. Als de container binnen is, streep je hem af in de tegel Inkoop en maak je de inkooplevering.", { iko, link }).catch(() => {});
  }
  return { id, gelezen: !!gelezen, leesFout: fout, vergelijk: vgl };
}

/* ── De uploadpagina voor de leverancier (Engels) ───────────────────────── */
function isUploadPagina(titel, inhoud) {
  return new Response("<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>" +
    "<title>" + isEsc(titel) + " - Fonteyn</title><meta name='robots' content='noindex'>" +
    "<style>body{margin:0;background:#f5f4ef;font-family:Arial,Helvetica,sans-serif;color:#1f2937}.kop{background:#144734;padding:16px 20px}.kop img{height:48px;display:block}" +
    ".blok{max-width:640px;margin:22px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:22px}@media(max-width:680px){.blok{margin:12px;padding:16px}}" +
    "h1{color:#144734;font-size:21px;margin:0 0 8px}p{font-size:15px;line-height:1.55;margin:0 0 12px}.klein{font-size:13px;color:#6b7280}" +
    ".vak{border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:12px 0}.vak h3{margin:0 0 6px;font-size:15px;color:#144734}" +
    "input[type=file]{font:inherit;font-size:14px;max-width:100%}button{background:#15803d;color:#fff;border:0;border-radius:9px;padding:10px 16px;font-size:15px;font-weight:bold;cursor:pointer;margin-top:8px;font-family:inherit}" +
    "button:disabled{opacity:.5}ul{margin:6px 0 0;padding-left:18px;font-size:14px}.ok{color:#15803d}.fout{color:#b91c1c}</style></head><body>" +
    "<div class='kop'><img src='" + IS_LOGO + "' alt='Fonteyn'></div><div class='blok'>" + inhoud + "</div></body></html>",
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
async function isUploadGet(env, url) {
  const db = await isDb(env);
  const t = String(url.searchParams.get("t") || "");
  const tk = t ? await db.prepare("SELECT iko FROM straat_token WHERE token = ?1").bind(t).first() : null;
  if (!tk) return isUploadPagina("Upload", "<h1>This link has expired</h1><p>Please ask your contact at Fonteyn for a new link.</p>");
  const docs = (await db.prepare("SELECT soort, naam, ts FROM straat_doc WHERE iko = ?1 ORDER BY ts").bind(tk.iko).all()).results || [];
  const vak = (soort, uitleg) => "<div class='vak'><h3>" + IS_DOC_SOORT[soort] + "</h3><p class='klein'>" + uitleg + "</p>" +
    "<ul>" + docs.filter(d => d.soort === soort).map(d => "<li class='ok'>&#10003; " + isEsc(d.naam) + "</li>").join("") + "</ul>" +
    "<input type='file' id='f_" + soort + "' accept='.pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png'><br><button type='button' data-soort='" + soort + "'>Upload</button> <span id='m_" + soort + "' class='klein'></span></div>";
  return isUploadPagina("Upload documents",
    "<h1>Purchase order " + isEsc(tk.iko) + "</h1><p>Please upload the documents for this purchase order here. You can come back to this page with the same link at any time.</p>" +
    vak("proforma", "Upload your proforma invoice as soon as you have received our purchase order.") +
    vak("bl", "Upload the Bill of Lading as soon as the container has been shipped.") +
    vak("packinglist", "Upload the packing list together with the Bill of Lading.") +
    vak("overig", "Anything else we should know, for example a commercial invoice or photos.") +
    "<p class='klein'>Questions? Reply to the e-mail you received from us.</p>" +
    "<script src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'></script>" +
    "<script src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'></script><script>" +
    "var T=" + JSON.stringify(t) + ";" +
    "async function tekstVan(f){try{var n=f.name.toLowerCase();if(n.endsWith('.pdf')&&window.pdfjsLib){pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';" +
    "var d=await pdfjsLib.getDocument({data:await f.arrayBuffer()}).promise,u='';for(var i=1;i<=Math.min(d.numPages,15);i++){var p=await d.getPage(i),c=await p.getTextContent();u+=c.items.map(function(x){return x.str}).join(' ')+'\\n';}return u;}" +
    "if(/\\.(xlsx|xls|csv)$/.test(n)&&window.XLSX){var w=XLSX.read(await f.arrayBuffer());return w.SheetNames.map(function(s){return XLSX.utils.sheet_to_csv(w.Sheets[s])}).join('\\n');}}catch(e){}return '';}" +
    "document.querySelectorAll('button[data-soort]').forEach(function(b){b.onclick=async function(){var s=b.dataset.soort,f=document.getElementById('f_'+s).files[0],m=document.getElementById('m_'+s);" +
    "if(!f){m.textContent='Choose a file first.';return;}if(f.size>24*1024*1024){m.textContent='The file is larger than 24 MB.';return;}b.disabled=true;m.textContent='Uploading...';" +
    "var fd=new FormData();fd.append('t',T);fd.append('soort',s);fd.append('bestand',f);fd.append('tekst',(await tekstVan(f)).slice(0,60000));" +
    "try{var r=await fetch('/levering-upload',{method:'POST',body:fd});var j=await r.json();if(!j.ok)throw new Error(j.error||'Upload failed');m.className='ok';m.textContent='Thank you, received.';setTimeout(function(){location.reload()},1200);}" +
    "catch(e){m.className='fout';m.textContent=e.message;b.disabled=false;}};});</script>");
}
async function isUploadPost(env, request, H) {
  const db = await isDb(env);
  const f = await request.formData().catch(() => null);
  if (!f) return H.reply(400, { ok: false, error: "No file received." });
  const t = String(f.get("t") || "");
  const tk = t ? await db.prepare("SELECT iko FROM straat_token WHERE token = ?1").bind(t).first() : null;
  if (!tk) return H.reply(403, { ok: false, error: "This link has expired." });
  const bestand = f.get("bestand");
  if (!bestand || typeof bestand === "string") return H.reply(400, { ok: false, error: "No file received." });
  try {
    const r = await isDocBewaar(env, H, db, tk.iko, String(f.get("soort") || ""), bestand.name || "document", await bestand.arrayBuffer(), String(f.get("tekst") || ""), "de leverancier");
    return H.reply(200, { ok: true, id: r.id });
  } catch (e) { return H.reply(400, { ok: false, error: String(e.message || e) }); }
}

/* ── De mail met de inkooporder aan de leverancier (Engels) ─────────────── */
function isMailHtml(o, contact, regels, link, tekst, afzender) {
  const naam = isS(contact, 80);
  const alinea = String(tekst || ("Please find our purchase order " + o.id + " below. Could you send us your proforma invoice for this order? You can upload it, and later the Bill of Lading and the packing list, with the button below.")).split(/\n{2,}/)
    .map(x => "<p style='font-size:15px;line-height:1.55'>" + isEsc(x).replace(/\n/g, "<br>") + "</p>").join("");
  return "<div style='font-family:Arial,Helvetica,sans-serif;background:#f5f4ef;padding:20px'><div style='max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden'>" +
    "<div style='background:#144734;padding:16px 20px'><img src='" + IS_LOGO + "' alt='Fonteyn' style='height:44px;display:block'></div><div style='padding:22px'>" +
    "<p style='font-size:15px;line-height:1.55'>Dear " + isEsc(naam || "Sir or Madam") + ",</p>" + alinea +
    "<table style='width:100%;border-collapse:collapse;font-size:13px;margin:14px 0'><tr><th style='text-align:left;border-bottom:2px solid #144734;padding:6px'>Your item code</th><th style='text-align:left;border-bottom:2px solid #144734;padding:6px'>Description</th><th style='text-align:right;border-bottom:2px solid #144734;padding:6px'>Qty</th></tr>" +
    regels.map(r => "<tr><td style='padding:6px;border-bottom:1px solid #eee'>" + isEsc(r.levcode || r.code) + "</td><td style='padding:6px;border-bottom:1px solid #eee'>" + isEsc(r.oms) + "</td><td style='padding:6px;border-bottom:1px solid #eee;text-align:right'>" + isEsc(r.besteld) + "</td></tr>").join("") + "</table>" +
    "<p style='margin:22px 0'><a href='" + isEsc(link) + "' style='background:#15803d;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:bold;font-size:16px;display:inline-block'>Upload documents</a></p>" +
    "<p style='font-size:15px;line-height:1.55'>Kind regards,<br>" + isEsc(afzender || "Fonteyn") + "<br><span style='color:#6b7280'>Fonteyn, Uddel, the Netherlands</span></p></div></div></div>";
}
async function isMailStuur(env, H, van, aan, onderwerp, html) {
  if (H.ewsVerstuur && env.EWS_GEBRUIKER && env.EWS_WACHTWOORD && van) {
    const e = await H.ewsVerstuur(env, van, aan, onderwerp, html).catch(x => ({ ok: false, error: String(x && x.message || x) }));
    if (e && e.ok) return { ok: true, via: van };
  }
  if (!env.RESEND_API_KEY || !(env.MAIL_FROM_FONTEYN || env.MAIL_FROM)) return { ok: false, error: "Het mailen is in de worker nog in te richten." };
  const bron = env.MAIL_FROM_FONTEYN || env.MAIL_FROM;
  const adres = (String(bron).match(/<([^>]+)>/) || [])[1] || String(bron);
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Fonteyn <" + adres + ">", to: aan, ...(van ? { reply_to: [van] } : {}), subject: onderwerp, html }) });
  return r.ok ? { ok: true, via: "Fonteyn" } : { ok: false, error: "Versturen volgt zo, probeer het nog eens (" + r.status + ")." };
}
function isMailVan(wie) { wie = String(wie || "").toLowerCase(); return wie.includes("@") ? wie : (wie.replace(/^fonteyn\./, "") + "@fonteyn.nl"); }

/* ── De fase van een inkooporder, uit wat er bekend is ──────────────────── */
function isFase(o, leveringen, allesBinnen) {
  const f = [
    { k: "besteld", naam: "Besteld", klaar: true },
    { k: "link", naam: "Naar leverancier", klaar: !!(o.mails && o.mails.length) || !!o.linkOp },
    { k: "proforma", naam: "Proforma", klaar: !!o.proformaOp },
    { k: "aanbetaald", naam: "Aanbetaald", klaar: !!(o.betaling && o.betaling.aanbetaling && o.betaling.aanbetaling.op) },
    { k: "opzee", naam: "Op zee", klaar: !!o.opZee },
    { k: "rest", naam: "Restbetaling", klaar: !!(o.betaling && o.betaling.rest && o.betaling.rest.op) },
    { k: "binnen", naam: (leveringen || []).length && !allesBinnen && !o.binnenOp ? "Deels binnen" : "Binnen", klaar: !!allesBinnen || !!o.binnenOp },
    { k: "website", naam: "Op de website", klaar: !!(o.website && o.website.op) },
  ];
  const nu = f.find(x => !x.klaar);
  return { stappen: f, nu: nu ? nu.k : "klaar" };
}

/* ── De ingang vanuit worker.js ─────────────────────────────────────────── */
export async function isHandle(request, env, url, H) {
  const p = url.pathname;
  if (p === "/levering-upload") {
    if (request.method === "GET") return isUploadGet(env, url);
    if (request.method === "POST") return isUploadPost(env, request, H);
    return H.reply(405, { ok: false });
  }
  // DEV_OPEN bestaat alleen bij een lokale proefdraai, nooit in de uitrol.
  if (!env.DEV_OPEN && (!env.SHARED_SECRET || (request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET))
    return H.reply(401, { ok: false, error: "Ga één keer terug naar het Dashboard en open de tegel opnieuw." });
  const wie = String(request.headers.get("X-Fonteyn-User") || "").toLowerCase().slice(0, 80);
  if (!(await H.toegangMag(env, "inkoopstraat", wie))) return H.reply(403, { ok: false, error: "Deze tegel is voor inkoop en het magazijn." });
  /* Gerrit (11 nov 2026): "Alle inkopers mogen de tegel Inkoop gebruiken."
     Wie in de groep zit, mag dus ook inkooporders en leveringen maken. */
  /* Manon zit in de tegel voor het afstrepen bij binnenkomst (Gerrit,
     13 nov 2026). Inkooporders maken blijft voor de bestellers en inkopers
     (groep inkoopstraat-bestellen); een inkooplevering mag iedereen hier. */
  const magBestellen = await H.toegangMag(env, "inkoopstraat-bestellen", wie);
  const db = await isDb(env);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const q = (k) => url.searchParams.get(k);
  try {
    /* Leveranciers */
    if (p === "/straat/leveranciers" && request.method === "GET") {
      const cred = await isCrediteuren(env, H, db, q("vers") === "1");
      const tel = ((await db.prepare("SELECT creditor, COUNT(*) AS n FROM straat_art WHERE creditor IS NOT NULL GROUP BY creditor").all()).results || []);
      const n = {}; for (const t of tel) n[t.creditor] = t.n;
      const open = {};
      try { for (const o of isLijst(await isL4(env, H, "/v3/BuyOrders/GetBuyOrders", { BuyOrderIsClosed: false, TakeRecords: 1000 }))) open[o.CreditorId] = (open[o.CreditorId] || 0) + 1; } catch (e) {}
      const stand = (await isCacheLees(db, "index-stand")) || {};
      /* Per leverancier: zijn de afspraken compleet, dus kan er besteld worden? */
      const bucket = await isAfsprakenBucket(env);
      const kop = {}; for (const r of ((await db.prepare("SELECT creditor, json FROM straat_lev").all()).results || [])) kop[r.creditor] = isJson(r.json, {});
      const klaar = (c) => { const m = (kop[c.id] || {}).map || isRaadMap(bucket, c.naam); return !!m && !isOntbreekt((bucket.afspraken || {})[m]).length; };
      return H.reply(200, { ok: true, index: { klaar: stand.klaar || null, bezig: !!stand.bezig },
        leveranciers: cred.filter(c => n[c.id] || open[c.id] || q("alle") === "1").map(c => Object.assign(c, { artikelen: n[c.id] || 0, open: open[c.id] || 0, klaar: klaar(c) })) });
    }
    if (p === "/straat/leverancier" && request.method === "GET") {
      const id = Number(q("id"));
      const cred = await isCrediteur(env, H, id);
      if (!cred) return H.reply(404, { ok: false, error: "Deze leverancier is onbekend in Logic4." });
      const kop = await isLevKoppeling(db, id);
      const bucket = await isAfsprakenBucket(env);
      const map = kop.map || isRaadMap(bucket, cred.CompanyName);
      // De betaalvoorwaarde staat als nummer bij de crediteur; de naam komt uit de lijst betaalmethoden.
      let betaalNaam = (cred.PaymentCondition && (cred.PaymentCondition.Description || cred.PaymentCondition.Name)) || "";
      if (!betaalNaam && cred.PaymentCondition && cred.PaymentCondition.Id) {
        let bm = await isCacheLees(db, "betaalmethoden", 7 * 86400000);
        if (!bm) { bm = {}; for (const x of isLijst(await isL4(env, H, "/v3/Financial/GetPaymentMethods").catch(() => []))) bm[x.Id] = x.Description || x.Name || ""; await isCacheZet(db, "betaalmethoden", bm); }
        betaalNaam = bm[cred.PaymentCondition.Id] || ("nummer " + cred.PaymentCondition.Id);
      }
      const afspraak = map ? (bucket.afspraken || {})[map] || null : null;
      const arts = ((await db.prepare("SELECT * FROM straat_art WHERE creditor = ?1 ORDER BY code LIMIT 3000").bind(id).all()).results || []);
      const { orders, besteld } = await isOpenOrders(env, H, id);
      const artikelen = arts.map(a => {
        const b = besteld[a.pid] || 0;
        const advies = a.minimum > 0 ? Math.max(0, Math.ceil(a.minimum - (a.vrij + b))) : 0;
        return { pid: a.pid, code: a.code, naam: a.naam, levcode: a.levcode, prijs: a.prijs, actief: !!a.actief, minimum: a.minimum, voorraad: a.voorraad, vrij: a.vrij, besteld: b, advies,
          locatie: isJson(a.locaties, []).map(l => isLocNaam(l.naam)).filter(Boolean).slice(0, 3).join(", ") };
      });
      return H.reply(200, { ok: true, magBestellen,
        leverancier: { id, naam: cred.CompanyName || "", contact: [cred.FirstName, cred.LastName].filter(Boolean).join(" "), email: cred.EmailAddress || "", telefoon: cred.TelephoneNumber || cred.MobileNumber || "",
          adres: [cred.Address1, cred.Address2, [cred.PostalCode, cred.City].filter(Boolean).join(" ")].filter(Boolean).join(", "), btw: cred.VatNumber || "", kvk: cred.KvkNumber || "",
          betaling: betaalNaam, bank: cred.BankAccount || "", notities: cred.Notes || "", soort: (cred.CreditorType && cred.CreditorType.Description) || "" },
        koppeling: { map, geraden: !kop.map && !!map }, magAfspraken: await H.toegangMag(env, "inkopers", wie),
        mappen: Object.keys(bucket.afspraken || {}).sort(),
        afspraak, ontbreekt: afspraak ? isOntbreekt(afspraak) : ["afspraken in Leveranciersinformatie"],
        artikelen, orders });
    }
    if (p === "/straat/leverancier/koppel" && request.method === "POST") {
      if (!(await H.toegangMag(env, "inkopers", wie))) return H.reply(403, { ok: false, error: "De afspraken met leveranciers zijn voor de inkopers." });
      const id = Number(body.creditor);
      const kop = await isLevKoppeling(db, id);
      if (body.map !== undefined) kop.map = isS(body.map, 120);
      await db.prepare("INSERT OR REPLACE INTO straat_lev (creditor, json, ts) VALUES (?1, ?2, ?3)").bind(id, JSON.stringify(kop), Date.now()).run();
      return H.reply(200, { ok: true, koppeling: kop });
    }
    /* De artikellijst bijwerken, in stapjes */
    if (p === "/straat/index" && request.method === "GET") return H.reply(200, { ok: true, stand: (await isCacheLees(db, "index-stand")) || {} });
    if (p === "/straat/index/stap" && request.method === "POST") return H.reply(200, await isIndexStap(env, H, db));
    /* Locaties in Uddel */
    if (p === "/straat/locaties" && request.method === "GET") {
      const zoek = String(q("q") || "").trim();
      let rs;
      if (zoek.length >= 2) {
        const like = "%" + zoek.replace(/[%_]/g, "") + "%";
        rs = await db.prepare("SELECT pid, code, naam, voorraad, vrij, locaties FROM straat_art WHERE (code LIKE ?1 OR naam LIKE ?1 OR locaties LIKE ?1) AND voorraad > 0 ORDER BY code LIMIT 300").bind(like).all();
      } else {
        rs = await db.prepare("SELECT pid, code, naam, voorraad, vrij, locaties FROM straat_art WHERE voorraad > 0 ORDER BY locaties LIMIT 300").all();
      }
      const tot = await db.prepare("SELECT COUNT(*) AS n FROM straat_art WHERE voorraad > 0").first();
      return H.reply(200, { ok: true, totaal: tot ? tot.n : 0, artikelen: (rs.results || []).map(a => ({ code: a.code, naam: a.naam, voorraad: a.voorraad, vrij: a.vrij, locaties: isJson(a.locaties, []).map(l => Object.assign(l, { naam: isLocNaam(l.naam) })) })) });
    }
    /* Inkooporder maken */
    if (p === "/straat/order/maak" && request.method === "POST") {
      if (!magBestellen) return H.reply(403, { ok: false, error: "Inkooporders maken is voor de bestellers en de inkopers." });
      const id = Number(body.creditor);
      const bucket = await isAfsprakenBucket(env);
      const kop = await isLevKoppeling(db, id);
      const cred = await isCrediteur(env, H, id);
      const map = kop.map || isRaadMap(bucket, cred && cred.CompanyName);
      const mist = map ? isOntbreekt((bucket.afspraken || {})[map]) : ["afspraken in Leveranciersinformatie"];
      if (mist.length) return H.reply(409, { ok: false, error: "Vul eerst de afspraken met deze leverancier aan: " + mist.join(", ") + "." });
      const regels = (body.regels || []).map(r => ({ pid: Number(r.pid), aantal: isGetal(r.aantal), prijs: isGetal(r.prijs) })).filter(r => r.pid && r.aantal > 0);
      if (!regels.length) return H.reply(400, { ok: false, error: "Zet bij minstens één artikel een aantal." });
      if (body.bevestigd !== true) return H.reply(200, { ok: true, proef: true, regels: regels.length, totaal: Math.round(regels.reduce((n, r) => n + r.aantal * r.prijs, 0) * 100) / 100 });
      const nieuw = await isL4(env, H, "/v3/BuyOrders/CreateBuyOrder", { CreditorId: id, CreatedAt: new Date().toISOString().slice(0, 19), Remarks: isS(body.opmerking, 400) || ("Via het Dashboard door " + wie), BuyOrderRows: [] });
      const iko = Number((nieuw && (nieuw.Id || (nieuw.Value && nieuw.Value.Id))) || nieuw);
      if (!iko) throw new Error("Logic4 gaf een leeg inkoopordernummer terug.");
      const mislukt = [];
      for (const r of regels.slice(0, 40)) {
        try { await isL4(env, H, "/v3/BuyOrders/AddBuyOrderRow", { BuyOrderId: iko, ProductId: r.pid, QtyToOrder: r.aantal, Price: r.prijs, OrderedOnDateByDistributor: new Date().toISOString().slice(0, 19) }); }
        catch (e) { mislukt.push(r.pid); }
      }
      const o = { id: iko, creditor: id, besteller: wie.replace(/@.*$/, "").replace(/^fonteyn\./, ""), gemaakt: Date.now() };
      isLog(o, wie, "Inkooporder gemaakt met " + (regels.length - mislukt.length) + " regels" + (mislukt.length ? " (" + mislukt.length + " volgen nog)" : ""));
      await isOrderSchrijf(db, o);
      return H.reply(200, { ok: true, iko, mislukt: mislukt.length, teVeel: Math.max(0, regels.length - 40) });
    }
    /* Alle open inkooporders, met waar ze in de straat staan */
    if (p === "/straat/orders" && request.method === "GET") {
      /* Logic4 heeft honderden inkooporders die nooit gesloten zijn. Standaard
         alleen de laatste zes maanden; "alle" laat alles zien wat open staat. */
      const filter = { BuyOrderIsClosed: false, TakeRecords: 1000 };
      if (q("alle") !== "1") filter.BuyOrderDateFrom = new Date(Date.now() - 183 * 86400000).toISOString().slice(0, 19);
      const orders = isLijst(await isL4(env, H, "/v3/BuyOrders/GetBuyOrders", filter));
      const ids = orders.map(o => Number(o.Id));
      const eigen = {};
      for (let i = 0; i < ids.length; i += 90) {
        const deel = ids.slice(i, i + 90);
        const rs = await db.prepare("SELECT id, json FROM straat_order WHERE id IN (" + deel.map((_, j) => "?" + (j + 1)).join(",") + ")").bind(...deel).all();
        for (const r of rs.results || []) eigen[r.id] = isJson(r.json, {});
      }
      const docs = {};
      for (let i = 0; i < ids.length; i += 90) {
        const deel = ids.slice(i, i + 90);
        const rs = await db.prepare("SELECT iko, soort, json FROM straat_doc WHERE iko IN (" + deel.map((_, j) => "?" + (j + 1)).join(",") + ")").bind(...deel).all();
        for (const r of rs.results || []) { const d = (docs[r.iko] = docs[r.iko] || { n: 0, afw: 0 }); d.n++; const v = (isJson(r.json, {}).vergelijk || {}); d.afw += v.afwijkingen || 0; }
      }
      return H.reply(200, { ok: true, orders: orders.sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt))).map(o => {
        const e = eigen[o.Id];
        const f = e ? isFase(e, [], !!e.binnenOp) : { nu: "eerder", stappen: [{ k: "eerder", naam: "Gemaakt in Logic4" }] };
        return { id: o.Id, eigen: !!e, leverancier: o.CreditorCompanyName || "", creditor: o.CreditorId, datum: o.CreatedAt, regels: o.AmountOfRows, opmerking: o.Remarks || "",
          fase: f.nu, faseNaam: (f.stappen.find(x => x.k === f.nu) || { naam: "Klaar" }).naam, docs: (docs[o.Id] || {}).n || 0, afwijkingen: (docs[o.Id] || {}).afw || 0, besteller: (e && (e.besteller || e.inkoper)) || "" };
      }) });
    }
    if (p === "/straat/order" && request.method === "GET") {
      const iko = Number(q("id"));
      const kop = isLijst(await isL4(env, H, "/v3/BuyOrders/GetBuyOrders", { BuyOrderId: iko, TakeRecords: 1 }))[0];
      if (!kop) return H.reply(404, { ok: false, error: "Deze inkooporder is onbekend in Logic4." });
      const o = (await isOrderLees(db, iko)) || { id: iko, creditor: kop.CreditorId };
      if (!o.creditor) o.creditor = kop.CreditorId;
      const regels = await isOrderRegels(env, H, db, iko);
      const lev = isLijst(await isL4(env, H, "/v3/BuyOrderDeliveries/GetBuyOrderDeliveries", { BuyOrderId: iko, Take: 50 }).catch(() => []));
      let levStatus = await isCacheLees(db, "levering-statussen", 7 * 86400000);
      if (!levStatus) { levStatus = {}; for (const x of isLijst(await isL4(env, H, "/v3/BuyOrderDeliveries/GetBuyOrderDeliveryStatusses").catch(() => []))) levStatus[x.Id] = x.Name || ""; await isCacheZet(db, "levering-statussen", levStatus); }
      const docs = ((await db.prepare("SELECT id, soort, naam, grootte, door, ts, json FROM straat_doc WHERE iko = ?1 ORDER BY ts").bind(iko).all()).results || [])
        .map(d => { const j = isJson(d.json, {}); return { id: d.id, soort: d.soort, soortNaam: IS_DOC_SOORT[d.soort], naam: d.naam, grootte: d.grootte, door: d.door, ts: d.ts, gelezen: !!j.gelezen, leesFout: j.leesFout || null, vergelijk: j.vergelijk || null, documentnummer: j.gelezen && j.gelezen.documentnummer || "", containers: j.gelezen && j.gelezen.containers || [] }; });
      const cred = await isCrediteur(env, H, o.creditor).catch(() => null);
      const tk = await db.prepare("SELECT token FROM straat_token WHERE iko = ?1").bind(iko).first();
      return H.reply(200, { ok: true, magBestellen, order: Object.assign({}, o, {
        leverancier: kop.CreditorCompanyName || "", datum: kop.CreatedAt, opmerking: kop.Remarks || "", gesloten: !!kop.BuyOrderClosed,
        leverancierMail: (cred && cred.EmailAddress) || "", uploadLink: tk ? IS_LINK + "/levering-upload?t=" + tk.token : "",
        leveringen: lev.map(l => ({ id: l.BuyOrderDeliveryId || l.Id, datum: l.DateTimeCreated || "", status: levStatus[l.StatusId] || ("status " + l.StatusId), omschrijving: l.Description || "" })),
        fase: isFase(o, lev, regels.length > 0 && regels.every(r => r.teLeveren <= 0)) }), regels, docs });
    }
    if (p === "/straat/order/zet" && request.method === "POST") {
      const iko = Number(body.id);
      const o = (await isOrderLees(db, iko)) || { id: iko, creditor: Number(body.creditor) || null };
      const b = body.zet || {};
      o.betaling = o.betaling || {};
      const wasBetaald = !!(o.betaling.aanbetaling && o.betaling.aanbetaling.op);
      if (b.aanbetaling) { o.betaling.aanbetaling = { bedrag: isGetal(b.aanbetaling.bedrag), valuta: isS(b.aanbetaling.valuta, 3) || "USD", op: b.aanbetaling.op ? isS(b.aanbetaling.op, 10) : null }; isLog(o, wie, "Aanbetaling: " + (b.aanbetaling.op ? "betaald op " + b.aanbetaling.op : "bedrag gezet")); }
      if (b.rest) { o.betaling.rest = { bedrag: isGetal(b.rest.bedrag), valuta: isS(b.rest.valuta, 3) || "USD", moment: isS(b.rest.moment, 30), op: b.rest.op ? isS(b.rest.op, 10) : null }; isLog(o, wie, "Restbetaling: " + (b.rest.op ? "betaald op " + b.rest.op : "afgesproken " + (b.rest.moment || ""))); }
      /* Gerrit (11 nov 2026): het seintje aan marketing (Gretha) komt na het
         betalen van de proforma, zodat de artikelen op de website staan
         voordat de container binnen is. Eén keer per inkooporder. */
      if (!wasBetaald && o.betaling.aanbetaling && o.betaling.aanbetaling.op && !o.marketingGemeld) {
        const kopM = isLijst(await isL4(env, H, "/v3/BuyOrders/GetBuyOrders", { BuyOrderId: iko, TakeRecords: 1 }).catch(() => []))[0] || {};
        const regelsM = await isOrderRegels(env, H, db, iko).catch(() => []);
        const mk = H.groepLeden ? await H.groepLeden(env, "marketing") : [];
        await isBericht(env, H, "is-mk-" + iko, mk, "Zet klaar voor de website: inkooporder " + iko,
          "De proforma van " + (kopM.CreditorCompanyName || "de leverancier") + " is betaald en de productie start. Zet deze " + regelsM.length + " artikel(en) alvast klaar voor de website: " +
          regelsM.slice(0, 8).map(r => r.code + " " + r.oms).join("; ") + (regelsM.length > 8 ? " en meer." : "."), { iko, link: "inkoopstraat.html?iko=" + iko }, "inkoop-website").catch(() => {});
        o.marketingGemeld = Date.now();
        isLog(o, "het Dashboard", "Marketing gemeld: artikelen klaarzetten voor de website");
      }
      if (b.opZee !== undefined) { o.opZee = b.opZee ? Date.parse(b.opZee) || Date.now() : null; isLog(o, wie, b.opZee ? "Op zee vanaf " + b.opZee : "Op zee weggehaald"); }
      if (b.website === true) { o.website = { op: Date.now(), door: wie }; isLog(o, wie, "Staat op de website"); }
      await isOrderSchrijf(db, o);
      return H.reply(200, { ok: true });
    }
    if (p === "/straat/order/link" && request.method === "POST") {
      const iko = Number(body.id);
      let tk = await db.prepare("SELECT token FROM straat_token WHERE iko = ?1").bind(iko).first();
      if (!tk) { tk = { token: isCode(32) }; await db.prepare("INSERT INTO straat_token (token, iko, ts) VALUES (?1, ?2, ?3)").bind(tk.token, iko, Date.now()).run(); }
      const o = (await isOrderLees(db, iko)) || { id: iko, creditor: Number(body.creditor) || null };
      if (!o.linkOp) { o.linkOp = Date.now(); isLog(o, wie, "Uploadlink gemaakt"); await isOrderSchrijf(db, o); }
      return H.reply(200, { ok: true, url: IS_LINK + "/levering-upload?t=" + tk.token });
    }
    if (p === "/straat/order/mail" && request.method === "POST") {
      const iko = Number(body.id);
      const kop = isLijst(await isL4(env, H, "/v3/BuyOrders/GetBuyOrders", { BuyOrderId: iko, TakeRecords: 1 }))[0];
      if (!kop) return H.reply(404, { ok: false, error: "Deze inkooporder is onbekend in Logic4." });
      const o = (await isOrderLees(db, iko)) || { id: iko, creditor: kop.CreditorId };
      const cred = await isCrediteur(env, H, kop.CreditorId);
      const regels = await isOrderRegels(env, H, db, iko);
      let tk = await db.prepare("SELECT token FROM straat_token WHERE iko = ?1").bind(iko).first();
      if (!tk) { tk = { token: isCode(32) }; await db.prepare("INSERT INTO straat_token (token, iko, ts) VALUES (?1, ?2, ?3)").bind(tk.token, iko, Date.now()).run(); }
      const link = IS_LINK + "/levering-upload?t=" + tk.token;
      const aan = isS(body.aan, 200) || (cred && cred.EmailAddress) || "";
      const onderwerp = isS(body.onderwerp, 150) || ("Purchase order " + iko + " from Fonteyn");
      /* Geen prijzen in de mail: Logic4 heeft ze in euro's, de fabriek rekent
         vaak in dollars. De prijs komt van de leverancier op de proforma, en
         die vergelijkt het Dashboard met de inkooporder. Aanhef: de
         contactpersoon uit onze afspraken, anders die van Logic4. */
      const bucket = await isAfsprakenBucket(env), kopL = await isLevKoppeling(db, kop.CreditorId);
      const mapL = kopL.map || isRaadMap(bucket, cred && cred.CompanyName);
      const contact = ((bucket.afspraken || {})[mapL] || {}).contact || (cred && [cred.FirstName, cred.LastName].filter(Boolean).join(" ")) || "";
      const html = isMailHtml(o, contact, regels.filter(r => r.teLeveren > 0 || r.besteld > 0), link, body.tekst, (wie || "").replace(/@.*$/, "").replace(/^fonteyn\./, "").replace(/^./, c => c.toUpperCase()));
      if (body.stuur !== true) return H.reply(200, { ok: true, voorbeeld: true, aan, onderwerp, html });
      if (!IS_MAIL_AAN && !env.DEV_OPEN) return H.reply(409, { ok: false, error: "Versturen gaat aan zodra de tekst van de mail is goedgekeurd. Je kunt de uploadlink al kopiëren en zelf doorsturen." });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(aan)) return H.reply(400, { ok: false, error: "Vul een geldig mailadres van de leverancier in." });
      const m = await isMailStuur(env, H, isMailVan(wie), aan.split(/[;,\s]+/).filter(Boolean), onderwerp, html);
      if (!m.ok) return H.reply(502, m);
      o.mails = (o.mails || []).concat([{ ts: Date.now(), aan, door: wie }]).slice(-20);
      isLog(o, wie, "Inkooporder gemaild naar " + aan);
      await isOrderSchrijf(db, o);
      return H.reply(200, { ok: true });
    }
    /* Documenten: de inkoper kan ze ook zelf neerzetten (base64). */
    if (p === "/straat/doc" && request.method === "POST") {
      const bin = Uint8Array.from(atob(String(body.base64 || "")), c => c.charCodeAt(0));
      const r = await isDocBewaar(env, H, db, Number(body.id), String(body.soort || ""), isS(body.naam, 160) || "document", bin.buffer, String(body.tekst || ""), wie);
      return H.reply(200, Object.assign({ ok: true }, r));
    }
    if (p === "/straat/doc" && request.method === "GET") {
      const d = await db.prepare("SELECT naam FROM straat_doc WHERE id = ?1").bind(String(q("doc"))).first();
      const buf = d ? await H.bestandLees(env, "inkoopfile:straat/" + q("doc")) : null;
      if (!buf) return H.reply(404, { ok: false, error: "Dit document is al opgeruimd." });
      const naam = d.naam || "document";
      const soort = /\.pdf$/i.test(naam) ? "application/pdf" : /\.png$/i.test(naam) ? "image/png" : /\.jpe?g$/i.test(naam) ? "image/jpeg" : "application/octet-stream";
      return new Response(buf, { headers: { "Content-Type": soort, "Content-Disposition": "inline; filename=\"" + naam.replace(/"/g, "") + "\"", "Access-Control-Allow-Origin": "*" } });
    }
    /* Binnen: Manon streept de packing list af en maakt de inkooplevering */
    if (p === "/straat/levering/maak" && request.method === "POST") {
      const iko = Number(body.id);
      const kop = isLijst(await isL4(env, H, "/v3/BuyOrders/GetBuyOrders", { BuyOrderId: iko, TakeRecords: 1 }))[0];
      if (!kop) return H.reply(404, { ok: false, error: "Deze inkooporder is onbekend in Logic4." });
      const regels = await isOrderRegels(env, H, db, iko);
      const binnen = {}; for (const r of body.regels || []) binnen[String(r.rij)] = { qty: isGetal(r.qty), loc: Number(r.locatie) || undefined };
      const rows = regels.filter(r => binnen[String(r.rij)] && binnen[String(r.rij)].qty > 0).map(r => ({
        BuyOrderRowId: r.rij, ProductId: r.pid, Qty_Delivered: binnen[String(r.rij)].qty, BuyPrice: r.prijs || undefined,
        StockLocationId: binnen[String(r.rij)].loc, Remarks: ("Afgestreept door " + wie).slice(0, 100) }));
      const verschillen = regels.map(r => ({ code: r.code, oms: r.oms, verwacht: r.teLeveren, binnen: (binnen[String(r.rij)] || {}).qty || 0 }))
        .filter(x => Math.abs(x.binnen - x.verwacht) > 0.001);
      if (body.bevestigd !== true) return H.reply(200, { ok: true, proef: true, regels: rows.length, verschillen });
      if (!rows.length) return H.reply(400, { ok: false, error: "Vul bij minstens één regel in hoeveel er binnen is." });
      const r = await isL4(env, H, "/v3/BuyOrderDeliveries/CreateBuyOrderDelivery", {
        BuyOrderId: iko, SupplierId: Number(kop.CreditorId), Status: "CreatedByAPI",
        Description: isS(body.omschrijving, 100) || ("Inkooporder " + iko), Remarks: ("Afgestreept in het Dashboard door " + wie).slice(0, 400),
        PickingListNumber: isS(body.pakbon, 60) || undefined, ProcessMutationButDoNotCreatePickbon: true, Rows: rows });
      const levering = (r && (r.Id || r.BuyOrderDeliveryId || r.Value)) || r || null;
      const o = (await isOrderLees(db, iko)) || { id: iko, creditor: kop.CreditorId };
      o.binnenOp = Date.now();
      o.leveringen = (o.leveringen || []).concat([{ ts: Date.now(), door: wie, levering, regels: rows.length, verschillen }]).slice(-20);
      isLog(o, wie, "Inkooplevering " + (levering || "") + " gemaakt" + (verschillen.length ? " met " + verschillen.length + " verschil(len)" : ", alles klopt"));
      await isOrderSchrijf(db, o);
      const link = "inkoopstraat.html?iko=" + iko;
      if (verschillen.length) {
        await isBericht(env, H, "is-lev-" + iko + "-" + Date.now(), await isInkopersVan(env, H, o), "Verschil bij binnenkomst inkooporder " + iko,
          verschillen.slice(0, 8).map(v => v.code + ": verwacht " + v.verwacht + ", binnen " + v.binnen).join("; ") + (verschillen.length > 8 ? " en meer." : "."), { iko, link }).catch(() => {});
      }
      return H.reply(200, { ok: true, levering, verschillen });
    }
    return H.reply(404, { ok: false, error: "onbekend" });
  } catch (e) {
    return H.reply(e.code || 502, { ok: false, error: String(e.message || e) });
  }
}
