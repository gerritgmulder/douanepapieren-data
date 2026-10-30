/* ═════════════════════════════════════════════════════════════════
   VOORSTEL MAKEN - eerst de klant laten bevestigen, dan pas verkopen
   ═════════════════════════════════════════════════════════════════
   Gerrit (30 okt 2026): "Het is voor het bedrijf en de privacy van gegevens
   belangrijk dat de adviseur GEEN regels kan toevoegen, want we willen eerst
   zeker zijn dat de gegevens kloppen." Logic4 kent geen slot op regels
   toevoegen, dus maakt niemand nog een offerte in Logic4 (Marcel sluit dat
   af) en loopt alles via de tegel 'Voorstel maken'.

   Zo loopt het:
   1. De adviseur vult de klantgegevens in (of zoekt een bestaande debiteur
      en vult aan).
   2. Knop "Bevestig je gegevens": de klant krijgt een mail met een link naar
      een pagina van Fonteyn. Daar ziet hij zijn gegevens.
   3. "Klopt": bevestigd. "Klopt niet": hij past ze zelf aan, en de adviseur
      krijgt een bericht in zijn Dashboard met wat er anders is.
   4. Pas na de bevestiging maakt het Dashboard de debiteur (of werkt hem bij)
      en de offerte (status 4) in Logic4 aan. Vanaf dat moment kan de
      adviseur in de tegel regels toevoegen en alles invullen wat het
      offertescherm van Logic4 ook heeft.

   Wat Logic4 via de koppeling NIET kan, en hoe het hier gaat:
   - Een regel weghalen: daar is geen eindpunt voor. Een weggehaalde regel
     krijgt aantal 0 en de tekst "(vervallen)"; dan telt hij niet mee.
   - Namen van de vrije keuzevelden (Type 1-4): geen lijst in de API. De
     nummers staan in VS_TYPES; namen die we kennen staan erbij.
   - Vervaldatum van de offerte: geen veld in de API. Die bewaart het
     Dashboard zelf.

   Opslag in D1 (tabel voorstel), niet in KV: elke klik is een schrijfbeurt.
   Mail: eerst via de eigen Exchange vanuit de mailbox van de adviseur, en
   lukt dat niet, via Resend met de adviseur als antwoordadres.
   ═════════════════════════════════════════════════════════════════ */

const VS_LOGO = "https://raw.githubusercontent.com/gerritgmulder/douanepapieren-data/main/fonteyn-logo.png";
const VS_OFFERTE = 4;            // Logic4-status 'Offerte'
const VS_GESLOTEN = 19;          // Logic4-status 'Offerte gesloten'
/* Het voorstel echt naar de klant mailen gaat pas aan na het akkoord van
   Gerrit op de opmaak (zie memory mails-eerst-laten-zien). Tot die tijd
   werken het voorbeeld en printen wel. */
const VS_STUUR_AAN = true;   // Gerrit akkoord op de opmaak, 31 okt 2026
const VS_PARTICULIER = 1;        // RelationTypeId
const VS_ZAKELIJK = 3;
const VS_ACTIEF = 2;             // StatusId debiteur
/* Vrije keuzevelden op de order. Alleen deze namen zijn bekend (zie de
   uitleg bij DP_ORDERBRON_DEALER in worker.js). */
const VS_TYPES = {
  1: { naam: "Orderbron", bekend: { 16: "Bestaande Dealer" } },
  2: { naam: "Type 2", bekend: {} },
  3: { naam: "Type 3", bekend: {} },
  4: { naam: "Magazijntype", bekend: { 1: "Magazijn", 2: "Spa Service Magazijn" } },
};

let _vsTabel = false;
async function vsDb(env) {
  const db = env.ACTIVITEIT;
  if (!_vsTabel) {
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS voorstel (id TEXT PRIMARY KEY, token TEXT, status TEXT, adviseur TEXT, debiteur INTEGER, orderid INTEGER, json TEXT, aangemaakt INTEGER, gewijzigd INTEGER)"),
      db.prepare("CREATE INDEX IF NOT EXISTS voorstel_token ON voorstel (token)"),
      db.prepare("CREATE INDEX IF NOT EXISTS voorstel_adviseur ON voorstel (adviseur, gewijzigd)"),
      db.prepare("CREATE INDEX IF NOT EXISTS voorstel_gewijzigd ON voorstel (gewijzigd)"),
      db.prepare("CREATE TABLE IF NOT EXISTS voorstel_cache (k TEXT PRIMARY KEY, v TEXT, ts INTEGER)"),
      /* Per debiteur de gegevens zoals de klant ze het laatst bevestigde.
         Gerrit (30 okt 2026): eenmaal bevestigd is genoeg, zolang er niets
         aan veranderd is. */
      // Links naar het voorstel: t = verstuurd aan de klant, p = printen. Eigen tabel, zodat zoeken één rij leest.
      db.prepare("CREATE TABLE IF NOT EXISTS voorstel_link (token TEXT PRIMARY KEY, id TEXT, soort TEXT, ts INTEGER)"),
      db.prepare("CREATE TABLE IF NOT EXISTS voorstel_bevestigd (debiteur INTEGER PRIMARY KEY, klant TEXT, ts INTEGER, voorstel TEXT)"),
    ]);
    _vsTabel = true;
  }
  return db;
}

function vsEsc(x) { return String(x == null ? "" : x).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function vsJson(t, d) { try { return JSON.parse(t); } catch (e) { return d; } }
function vsCode(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join(""); }
function vsS(x, max) { return String(x == null ? "" : x).trim().slice(0, max || 120); }

/* ── Klantgegevens: altijd dezelfde vorm, van de adviseur én van de klant ── */
const VS_KLANT_VELDEN = ["aanhef", "voornaam", "tussenvoegsel", "achternaam", "bedrijf", "btw",
  "straat", "huisnummer", "toevoeging", "postcode", "plaats", "land", "email", "telefoon", "mobiel"];
const VS_AFL_VELDEN = ["naam", "straat", "huisnummer", "toevoeging", "postcode", "plaats", "land"];
function vsKlantSchoon(k) {
  k = k || {};
  const u = {};
  for (const v of VS_KLANT_VELDEN) u[v] = vsS(k[v], v === "email" ? 120 : 80);
  u.aanhef = ["1", "2"].includes(String(k.aanhef)) ? String(k.aanhef) : "";
  u.land = (u.land || "NL").toUpperCase().slice(0, 2);
  u.email = u.email.toLowerCase();
  u.postcode = u.postcode.toUpperCase();
  const a = k.aflevering || {};
  u.afwijkend = k.afwijkend === true;
  u.aflevering = {};
  for (const v of VS_AFL_VELDEN) u.aflevering[v] = vsS(a[v], 80);
  u.aflevering.land = (u.aflevering.land || u.land).toUpperCase().slice(0, 2);
  return u;
}
function vsKlantMist(k) {
  const mist = [];
  if (!k.achternaam && !k.bedrijf) mist.push("achternaam");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k.email)) mist.push("e-mailadres");
  if (!k.straat) mist.push("straat");
  if (!k.huisnummer) mist.push("huisnummer");
  if (!k.postcode) mist.push("postcode");
  if (!k.plaats) mist.push("plaats");
  if (!k.telefoon && !k.mobiel) mist.push("telefoon of mobiel");
  if (k.afwijkend && (!k.aflevering.straat || !k.aflevering.huisnummer || !k.aflevering.plaats)) mist.push("afleveradres");
  return mist;
}
function vsNaam(k) {
  return [k.voornaam, k.tussenvoegsel, k.achternaam].filter(Boolean).join(" ") || k.bedrijf || "";
}
/* Wat is er anders tussen twee versies, in gewone woorden. */
const VS_LABEL = { aanhef: "Aanhef", voornaam: "Voornaam", tussenvoegsel: "Tussenvoegsel", achternaam: "Achternaam",
  bedrijf: "Bedrijfsnaam", btw: "Btw-nummer", straat: "Straat", huisnummer: "Huisnummer", toevoeging: "Toevoeging",
  postcode: "Postcode", plaats: "Plaats", land: "Land", email: "E-mailadres", telefoon: "Telefoon", mobiel: "Mobiel" };
function vsVerschil(oud, nieuw) {
  const uit = [];
  for (const v of VS_KLANT_VELDEN) if (String(oud[v] || "") !== String(nieuw[v] || "")) uit.push({ veld: VS_LABEL[v], was: oud[v] || "", wordt: nieuw[v] || "" });
  if (!!oud.afwijkend !== !!nieuw.afwijkend) uit.push({ veld: "Ander afleveradres", was: oud.afwijkend ? "ja" : "nee", wordt: nieuw.afwijkend ? "ja" : "nee" });
  if (nieuw.afwijkend) for (const v of VS_AFL_VELDEN) {
    const a = (oud.aflevering || {})[v] || "", b = (nieuw.aflevering || {})[v] || "";
    if (a !== b) uit.push({ veld: "Aflevering: " + v, was: a, wordt: b });
  }
  return uit;
}

/* ── Opslaan en lezen ───────────────────────────────────────────────────── */
async function vsLees(db, id) {
  const r = await db.prepare("SELECT * FROM voorstel WHERE id = ?1").bind(String(id)).first();
  return r ? vsUit(r) : null;
}
function vsUit(r) {
  const j = vsJson(r.json, {});
  return Object.assign(j, { id: r.id, token: r.token, status: r.status, adviseur: r.adviseur,
    debiteur: r.debiteur || null, orderid: r.orderid || null, aangemaakt: r.aangemaakt, gewijzigd: r.gewijzigd });
}
async function vsSchrijf(db, v) {
  v.gewijzigd = Date.now();
  const { id, token, status, adviseur, debiteur, orderid, aangemaakt, gewijzigd, ...rest } = v;
  await db.prepare("INSERT OR REPLACE INTO voorstel (id, token, status, adviseur, debiteur, orderid, json, aangemaakt, gewijzigd) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
    .bind(id, token, status, adviseur, debiteur || null, orderid || null, JSON.stringify(rest), aangemaakt || gewijzigd, gewijzigd).run();
}
function vsLog(v, wie, wat) {
  v.log = (v.log || []).concat([{ ts: Date.now(), wie: wie || "het Dashboard", wat: String(wat).slice(0, 300) }]).slice(-80);
}
/* Wat de tegel te zien krijgt: nooit het token (dat is de sleutel van de klant). */
function vsVoorTegel(v) {
  const { token, ...rest } = v;
  rest.mist = vsKlantMist(rest.klant || {});
  return rest;
}

/* ── Logic4 ─────────────────────────────────────────────────────────────── */
async function vsL4(env, H, pad, body, methode) {
  const token = await H.l4Token(env);
  const r = await fetch("https://api.logic4server.nl" + pad, {
    method: methode || (body === undefined ? "GET" : "POST"),
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await r.text();
  let j = null; try { j = JSON.parse(tekst); } catch (e) {}
  if (!r.ok) throw new Error(pad.split("/").pop() + " gaf " + r.status + ": " + ((j && (j.detail || j.title || j.Message)) || tekst).toString().slice(0, 200));
  return j && j.Records !== undefined ? j.Records : j;
}

/* De debiteur in Logic4 zetten met de bevestigde gegevens. Bestaat hij al
   (de adviseur koos een debiteur), dan alleen bijwerken. Twee stappen bij
   een nieuwe: AddCustomer geeft een leeg nummer, UpdateCustomer (PATCH) vult
   het. Zie relAanmaken in worker.js. */
async function vsDebiteur(env, H, v) {
  const k = v.klant;
  const velden = {
    CompanyName: k.bedrijf || "", FirstName: k.voornaam, Preposition: k.tussenvoegsel, LastName: k.achternaam,
    EmailAddress: k.email, TelephoneNumber: k.telefoon, MobileNumber: k.mobiel,
    Street: k.straat, HouseNumber: k.huisnummer, HouseNumberAddition: k.toevoeging,
    Zipcode: k.postcode, City: k.plaats, CountryCode: k.land, IsoCode: k.land,
    ...(k.btw ? { VatNumber: k.btw } : {}),
    ...(k.aanhef ? { GenderId: Number(k.aanhef) } : {}),
  };
  let id = Number(v.debiteur) || 0;
  if (!id) {
    velden.RelationTypeId = k.bedrijf ? VS_ZAKELIJK : VS_PARTICULIER;
    velden.StatusId = VS_ACTIEF;
    const nieuw = await vsL4(env, H, "/v3/Relations/AddCustomer", {});
    id = Number(typeof nieuw === "number" ? nieuw : (nieuw && (nieuw.Id || nieuw.CustomerId)));
    if (!id) throw new Error("Logic4 gaf een leeg debiteurnummer terug");
  }
  await vsL4(env, H, "/v3/Relations/UpdateCustomer", { Id: id, ...velden }, "PATCH");
  return id;
}

function vsAdres(k, afl) {
  const a = afl && k.afwijkend ? k.aflevering : k;
  return {
    CompanyName: k.bedrijf || "", ContactName: afl && k.afwijkend ? (k.aflevering.naam || vsNaam(k)) : vsNaam(k),
    Street: a.straat, HouseNumber: a.huisnummer, HouseNumberAddition: a.toevoeging,
    PostalCode: a.postcode, City: a.plaats, CountryCode: a.land || k.land || "NL",
    Email: k.email, TelephoneNumber: k.mobiel || k.telefoon,
  };
}

/* De kop van de offerte: alles uit het bovenste deel van het offertescherm. */
function vsKopNaarL4(kop) {
  kop = kop || {};
  const u = {};
  if (kop.referentie !== undefined) u.Reference = vsS(kop.referentie, 100);
  if (kop.omschrijving !== undefined) u.Description = vsS(kop.omschrijving, 200);
  if (kop.memo !== undefined) u.Notes = String(kop.memo || "").slice(0, 4000);
  if (Number(kop.filiaal)) u.BranchId = Number(kop.filiaal);
  if (Number(kop.medewerker)) u.UserId = Number(kop.medewerker);
  if (Number(kop.transporteur)) u.ShippingMethod = { Id: Number(kop.transporteur) };
  if (Number(kop.betaalmethode)) u.PaymentMethod = { Id: Number(kop.betaalmethode) };
  if (kop.leverdatum) u.DeliveryDate = String(kop.leverdatum).slice(0, 10) + "T00:00:00";
  if (kop.verzendkosten !== undefined && kop.verzendkosten !== "") u.Totals = { ShippingCost: Math.round(Number(kop.verzendkosten) * 100) / 100 || 0 };
  for (const n of [1, 2, 3, 4]) if (Number(kop["type" + n])) u["OrderType" + n + "Id"] = Number(kop["type" + n]);
  return u;
}

function vsKopStandaard(kop, keuzes, adviseur) {
  kop = Object.assign({}, kop || {});
  if (!Number(kop.medewerker)) kop.medewerker = vsMedewerkerVan(keuzes || {}, adviseur) || "";
  if (!Number(kop.type4)) kop.type4 = 1;          // Magazijn
  return kop;
}

/* Heeft deze klant precies deze gegevens al eens bevestigd? */
async function vsEerder(db, v) {
  if (!Number(v.debiteur) || !v.klant) return null;
  const r = await db.prepare("SELECT klant, ts FROM voorstel_bevestigd WHERE debiteur = ?1").bind(Number(v.debiteur)).first();
  if (!r) return null;
  const gelijk = JSON.stringify(vsKlantSchoon(vsJson(r.klant, {}))) === JSON.stringify(vsKlantSchoon(v.klant));
  return gelijk ? { ts: r.ts } : { ts: r.ts, anders: true };
}

/* De offerte aanmaken in Logic4. Alleen na de bevestiging van de klant. */
async function vsNaarLogic4(env, H, db, v, wie) {
  if (!["bevestigd", "in-logic4"].includes(v.status)) return { ok: false, error: "Eerst bevestigt de klant zijn gegevens." };
  if (!v.debiteur) {
    v.debiteur = await vsDebiteur(env, H, v);
    vsLog(v, wie, "Debiteur " + v.debiteur + " in Logic4 gezet");
    await vsSchrijf(db, v);
  } else if (!v.debiteurBijgewerkt) {
    await vsDebiteur(env, H, v);
    v.debiteurBijgewerkt = Date.now();
    vsLog(v, wie, "Debiteur " + v.debiteur + " bijgewerkt met de bevestigde gegevens");
    await vsSchrijf(db, v);
  }
  if (v.bevestigd && !v.bevestigd.eerder) {
    await db.prepare("INSERT OR REPLACE INTO voorstel_bevestigd (debiteur, klant, ts, voorstel) VALUES (?1, ?2, ?3, ?4)")
      .bind(Number(v.debiteur), JSON.stringify(v.klant), v.bevestigd.ts || Date.now(), v.id).run();
  }
  if (v.orderid) return { ok: true, orderid: v.orderid };
  /* Marcel (MGS, 30 okt 2026): "bij het aanmaken van een offerte moet je
     altijd een Medewerker kiezen en je moet bij Type 4 'Magazijn'
     selecteren." Leeg = de adviseur zelf en Magazijn. */
  const kop = vsKopStandaard(v.kop, await vsKeuzes(env, H, db), v.adviseur);
  if (!Number(kop.medewerker)) return { ok: false, error: "Kies eerst een medewerker bij de gegevens van het voorstel." };
  v.kop = kop;
  const payload = Object.assign({
    OrderStatus: { Id: VS_OFFERTE },
    DebtorId: Number(v.debiteur),
    CreationDate: new Date().toISOString().slice(0, 19),     // verplicht, anders 500
    InvoiceAddress: vsAdres(v.klant, false),
    DeliveryAddress: vsAdres(v.klant, true),
    OrderRows: [],
  }, vsKopNaarL4(kop));
  const j = await vsL4(env, H, "/v3/Orders/AddUpdateOrder", payload);
  const orderid = (typeof j === "number" && j) || (j && (j.Id || (j.Value && j.Value.Id))) || null;
  if (!orderid) throw new Error("Logic4 gaf een leeg nummer terug voor het voorstel");
  v.orderid = Number(orderid);
  v.status = "in-logic4";
  vsLog(v, wie, "Voorstel " + v.orderid + " staat in Logic4");
  await vsSchrijf(db, v);
  return { ok: true, orderid: v.orderid };
}

/* De offerte zoals Logic4 hem nu heeft: kop, regels en totalen. De tegel
   laat altijd dít zien, zodat er nooit iets anders op het scherm staat dan
   in Logic4. */
async function vsOrderLees(env, H, orderid) {
  const r = await vsL4(env, H, "/v3/Orders/GetOrders", { Id: Number(orderid), TakeRecords: 1 });
  const o = (Array.isArray(r) ? r : [])[0];
  if (!o) return null;
  let regels = Array.isArray(o.OrderRows) ? o.OrderRows : [];
  if (!regels.length) {
    const rr = await vsL4(env, H, "/v3/Orders/GetOfferRows", { OrderId: Number(orderid) }).catch(() => null);
    if (Array.isArray(rr)) regels = rr;
  }
  const t = o.Totals || {};
  return {
    id: o.Id, status: (o.OrderStatus && (o.OrderStatus.Description || o.OrderStatus.Id)) || "",
    statusId: o.OrderStatus && o.OrderStatus.Id,
    kop: {
      referentie: o.Reference || "", omschrijving: o.Description || "", memo: o.Notes || "",
      filiaal: o.BranchId || "", medewerker: o.UserId || "",
      transporteur: (o.ShippingMethod && o.ShippingMethod.Id) || "", betaalmethode: (o.PaymentMethod && o.PaymentMethod.Id) || "",
      leverdatum: o.DeliveryDate ? String(o.DeliveryDate).slice(0, 10) : "",
      type1: o.OrderType1Id || "", type2: o.OrderType2Id || "", type3: o.OrderType3Id || "", type4: o.OrderType4Id || "",
      verzendkosten: t.ShippingCost != null ? t.ShippingCost : "",
    },
    regels: regels.map(x => ({
      id: x.Id, code: x.ProductCode || "", oms: x.Description || "", oms2: x.Description2 || "",
      aantal: Number(x.Qty) || 0, bruto: Number(x.GrossPrice) || 0, netto: Number(x.NettPrice) || 0,
      korting: Number(x.DiscountPercent) || 0, btw: Number(x.VATPercentage) || 0, incl: Number(x.InclPrice) || 0,
      magazijn: x.WarehouseId || "", notitie: x.Notes || "", vervallen: (Number(x.Qty) || 0) === 0,
    })),
    totaal: {
      /* AmountEx is zonder verzendkosten, AmountIncl mét (proef 30 okt). */
      ex: Math.round(((Number(t.AmountEx) || 0) + (Number(t.ShippingCost) || 0)) * 100) / 100, incl: Number(t.AmountIncl) || 0,
      btw: Math.round(((Number(t.AmountIncl) || 0) - (Number(t.AmountEx) || 0) - (Number(t.ShippingCost) || 0)) * 100) / 100,
      verzend: Number(t.ShippingCost) || 0,
    },
    betaald: Number(o.Calc_TotalPayed || 0) || 0,
  };
}

/* Eén regel toevoegen of aanpassen. AddUpdateOrderRow VERVANGT een regel:
   bij aanpassen gaat dus altijd de hele regel mee (zie qbHandlePrijzenBijwerken). */
async function vsRegel(env, H, v, r, oud) {
  const code = vsS(r.code || (oud && oud.code), 40);
  if (!code) throw new Error("Kies eerst een artikel.");
  const aantal = Number(r.aantal);
  const regel = {
    OrderId: Number(v.orderid), DebtorId: Number(v.debiteur), ProductCode: code,
    Qty: isFinite(aantal) ? aantal : 1,
  };
  if (oud && oud.id) regel.Id = Number(oud.id);
  const oms = r.oms !== undefined ? r.oms : (oud && oud.oms);
  if (oms) regel.Description = vsS(oms, 250);
  const oms2 = r.oms2 !== undefined ? r.oms2 : (oud && oud.oms2);
  if (oms2) regel.Description2 = vsS(oms2, 250);
  const notitie = r.notitie !== undefined ? r.notitie : (oud && oud.notitie);
  if (notitie) regel.Notes = String(notitie).slice(0, 1000);
  const btw = Number((v.kop || {}).btwcode);
  if (btw) regel.VatCodeIdOverrule = btw;
  const mag = Number(r.magazijn || (oud && oud.magazijn));
  if (mag) regel.WarehouseId = mag;
  /* Prijs: met de hand gezet, of een korting op de brutoprijs. Niets
     ingevuld = Logic4 zet zelf de prijs uit de prijslijst van de klant. */
  const bruto = Number(r.bruto != null && r.bruto !== "" ? r.bruto : (oud && oud.bruto)) || 0;
  if (r.netto != null && r.netto !== "") {
    regel.NettPrice = Math.round(Number(r.netto) * 10000) / 10000;
    regel.GrossPrice = bruto || regel.NettPrice;
  } else if (r.korting != null && r.korting !== "" && bruto) {
    regel.GrossPrice = bruto;
    regel.NettPrice = Math.round(bruto * (1 - Number(r.korting) / 100) * 10000) / 10000;
  } else if (oud && oud.id && (oud.bruto || oud.netto)) {
    // Aanpassen zonder nieuwe prijs: de bestaande prijs blijft staan.
    regel.GrossPrice = oud.bruto; regel.NettPrice = oud.netto;
  } else {
    /* Logic4 zet via de koppeling zelf géén prijs op een regel (proef 30 okt:
       prijs 0). Dus de verkoopprijs voor deze klant ophalen, net als de
       werkbon van de servicemonteur doet. Met korting erop als die er is. */
    const p = await vsPrijs(env, H, code, v.debiteur, regel.Qty);
    if (p) {
      regel.GrossPrice = p;
      regel.NettPrice = r.korting != null && r.korting !== "" ? Math.round(p * (1 - Number(r.korting) / 100) * 10000) / 10000 : p;
    }
  }
  return vsL4(env, H, "/v3/Orders/AddUpdateOrderRow", regel);
}

async function vsPrijs(env, H, code, debiteur, aantal) {
  const j = await vsL4(env, H, "/v3/Products/GetPriceInformationForProduct", { ProductCode: String(code), DebtorId: Number(debiteur) || null }).catch(() => null);
  const st = (j && Array.isArray(j.ShiftPrices) ? j.ShiftPrices : []).filter(x => Number(x.Qty || 1) <= Math.max(1, Number(aantal) || 1)).sort((a, b) => Number(b.Qty || 1) - Number(a.Qty || 1));
  const p = st[0] || (j && j.ShiftPrices && j.ShiftPrices[0]);
  const excl = p ? Number(p.SellPriceExcl || p.SellPriceGrossExcl || 0) : 0;
  return excl > 0 ? Math.round(excl * 10000) / 10000 : null;
}

/* ── Keuzelijsten voor de kop (een keer per dag vers) ────────────────────── */
async function vsKeuzes(env, H, db) {
  const c = await db.prepare("SELECT v, ts FROM voorstel_cache WHERE k = 'keuzes'").first();
  if (c && Date.now() - c.ts < 86400000) return vsJson(c.v, {});
  const naam = (x) => x.Description || x.Name || x.Naam || x.FullName || [x.FirstName, x.LastName].filter(Boolean).join(" ") || String(x.Id);
  const lijst = async (pad, body) => { try { const r = await vsL4(env, H, pad, body); return (Array.isArray(r) ? r : []).map(x => ({ id: x.Id, naam: naam(x) })).filter(x => x.id); } catch (e) { return []; } };
  /* Logic4 houdt oude keuzes in de lijst met "ZZ", "NIET GEBRUIKEN" of een
     lege naam ervoor. Die laten we weg; de rest op naam. */
  const oud = (n) => !String(n).trim() || /^z+[\s-]*(oud|niet)|niet (meer )?gebruiken|^test$|^hfhhf$/i.test(String(n).trim());
  const netjes = (l) => l.map(x => ({ id: x.id, naam: String(x.naam).split(/\r?\n/)[0].trim() })).filter(x => !oud(x.naam)).sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
  let medewerkers = [];
  try {
    const r = await vsL4(env, H, "/v3/User/GetAllUsers");
    const arr = Array.isArray(r) ? r : ((r && (r.Users || r.Records || r.Items)) || []);
    medewerkers = arr.map(u => ({ id: u.UserId != null ? u.UserId : u.Id, naam: String(u.FullName || u.Username || "").trim(), login: String(u.Username || "").toLowerCase() }))
      .filter(u => u.id != null && u.naam && !/^zz[\s-]*oud\b/i.test(u.naam)).sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
  } catch (e) {}
  const k = {
    filialen: netjes(await lijst("/v3/Company/GetBranches")),
    medewerkers,
    transporteurs: netjes(await lijst("/v3/Shippers/GetShippingMethods")),
    betaalmethoden: netjes(await lijst("/v3/Financial/GetPaymentMethods")),
    btwcodes: netjes(await lijst("/v3/Financial/GetVatCodes")).filter(x => !/inkopen/i.test(x.naam)),
    types: {},
  };
  /* De vrije keuzevelden: welke nummers komen voor op de orders van de
     laatste maanden. Namen zover bekend. */
  try {
    const van = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 19);
    const tel = { 1: {}, 2: {}, 3: {}, 4: {} };
    for (let skip = 0; skip < 1500; skip += 500) {
      const r = await vsL4(env, H, "/v3/Orders/GetOrders", { CreationDateFrom: van, TakeRecords: 500, SkipRecords: skip });
      if (!Array.isArray(r) || !r.length) break;
      for (const o of r) for (const n of [1, 2, 3, 4]) { const x = o["OrderType" + n + "Id"]; if (x) tel[n][x] = (tel[n][x] || 0) + 1; }
      if (r.length < 500) break;
    }
    for (const n of [1, 2, 3, 4]) {
      k.types[n] = { naam: VS_TYPES[n].naam, keuzes: Object.entries(tel[n]).sort((a, b) => b[1] - a[1])
        .map(([id, aantal]) => ({ id: Number(id), naam: VS_TYPES[n].bekend[id] || ("Keuze " + id), aantal })) };
    }
  } catch (e) {}
  await db.prepare("INSERT OR REPLACE INTO voorstel_cache (k, v, ts) VALUES ('keuzes', ?1, ?2)").bind(JSON.stringify(k), Date.now()).run();
  return k;
}

/* De Logic4-gebruiker van de adviseur, voor het veld Medewerker. */
function vsMedewerkerVan(keuzes, wie) {
  const kort = String(wie || "").toLowerCase().replace(/@.*$/, "").replace(/^fonteyn\./, "").replace(/[._-]+/g, " ").trim();
  if (!kort) return null;
  const mail = String(wie || "").toLowerCase();
  const m = (keuzes.medewerkers || []).find(x => x.login && (x.login === mail || x.login === kort || x.login.replace(/@.*$/, "") === kort))
    || (keuzes.medewerkers || []).find(x => String(x.naam).toLowerCase() === kort)
    || (keuzes.medewerkers || []).find(x => String(x.naam).toLowerCase().split(/\s+/)[0] === kort.split(" ")[0]);
  return m ? m.id : null;
}

/* ── Klant zoeken in Logic4 ─────────────────────────────────────────────── */
function vsKlantUitL4(c) {
  return {
    debiteur: c.Id,
    klant: vsKlantSchoon({
      aanhef: c.GenderId || (c.Gender && c.Gender.Id) || "", voornaam: c.FirstName, tussenvoegsel: c.Preposition, achternaam: c.LastName,
      bedrijf: c.CompanyName, btw: c.VatNumber, straat: c.Street, huisnummer: c.HouseNumber, toevoeging: c.HouseNumberAddition,
      postcode: c.Zipcode, plaats: c.City, land: c.IsoCode || c.CountryCode || "NL", email: c.EmailAddress,
      telefoon: c.TelephoneNumber, mobiel: c.MobileNumber,
    }),
    soort: (c.Type && c.Type.Description) || "",
  };
}
async function vsKlantZoek(env, H, q) {
  q = String(q || "").trim();
  if (q.length < 3) return { ok: true, treffers: [] };
  let r = [];
  if (/^\d{1,12}$/.test(q)) r = await vsL4(env, H, "/v3/Relations/GetCustomers", { Id: Number(q), TakeRecords: 1 });
  else if (q.includes("@")) r = await vsL4(env, H, "/v3/Relations/GetCustomers", { EmailAddress: q, TakeRecords: 10 });
  else return { ok: true, treffers: [], uitleg: "Zoek op e-mailadres of debiteurnummer." };
  return { ok: true, treffers: (Array.isArray(r) ? r : []).filter(c => !/^\d+$/.test(q) || c.Id === Number(q)).map(vsKlantUitL4) };
}

/* ── Artikelen zoeken, met de prijs voor deze klant ─────────────────────── */
async function vsArtikel(env, H, q, debiteur) {
  q = String(q || "").trim();
  if (q.length < 2) return { ok: true, artikelen: [] };
  const r = await vsL4(env, H, "/v3/Products/GetProducts", { FastSearchText: q, TakeRecords: 25 });
  const l = (Array.isArray(r) ? r : []).filter(x => Number(x.StatusId) !== 10).slice(0, 15);
  return { ok: true, artikelen: l.map(x => ({
    code: String(x.ProductCode || ""), oms: String(x.ProductName1 || x.Description || ""),
    prijs: Number(x.SellPriceExcl || x.SellPrice || 0) || null,
  })).filter(x => x.code) };
}

/* ── Mail "Bevestig je gegevens" ────────────────────────────────────────── */
function vsLink(env, token) { return (env.SVC_LINK_BASIS || "https://fonteyn-data-store.g-mulder.workers.dev") + "/bevestig?t=" + encodeURIComponent(token); }
function vsAdviseurMail(wie) {
  wie = String(wie || "").toLowerCase();
  if (wie.includes("@")) return wie;
  const kort = wie.replace(/^fonteyn\./, "");
  return kort ? kort + "@fonteyn.nl" : "";
}
/* DE TEKST IS EEN VOORLOPIGE. Gerrit (30 okt 2026): de tekst van de mail
   komt van Marcel; tot die er is staat hier een korte versie. */
function vsMailHtml(v, link) {
  const k = v.klant || {};
  /* Klanten spreken we altijd aan met je (Gerrit, 31 okt 2026). */
  const aanhef = "Beste " + (k.voornaam || vsNaam(k) || "klant");
  return "<div style='font-family:Arial,Helvetica,sans-serif;background:#f5f4ef;padding:20px'><div style='max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden'>" +
    "<div style='background:#144734;padding:16px 20px'><img src='" + VS_LOGO + "' alt='Fonteyn' style='height:44px;display:block'></div>" +
    "<div style='padding:22px'><p style='font-size:15px;line-height:1.55'>" + vsEsc(aanhef) + ",</p>" +
    "<p style='font-size:15px;line-height:1.55'>Fijn dat je bij ons langs bent geweest. Voordat we je voorstel maken, vragen we je even je gegevens na te kijken. Zo weten we zeker dat alles klopt.</p>" +
    "<p style='margin:22px 0'><a href='" + vsEsc(link) + "' style='background:#15803d;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:bold;font-size:16px;display:inline-block'>Bevestig je gegevens</a></p>" +
    "<p style='font-size:13px;color:#6b7280;line-height:1.5'>Lukt het klikken op de knop? Kopieer anders deze link naar je browser:<br>" + vsEsc(link) + "</p>" +
    "<p style='font-size:15px;line-height:1.55'>Met vriendelijke groet,<br>Fonteyn</p></div></div></div>";
}
async function vsMailStuur(env, H, v, wie, onderwerp, html) {
  const naar = v.klant && v.klant.email;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(naar || "")) return { ok: false, error: "Vul eerst een geldig e-mailadres van de klant in." };
  onderwerp = onderwerp || "Bevestig je gegevens";
  html = html || vsMailHtml(v, vsLink(env, v.token));
  const adviseur = vsAdviseurMail(v.adviseur || wie);
  // Proef: alles naar één adres zolang de tegel in aanbouw is.
  const aan = env.VS_PROEF_AAN ? [env.VS_PROEF_AAN] : [naar];
  if (H.ewsVerstuur && env.EWS_GEBRUIKER && env.EWS_WACHTWOORD && adviseur) {
    const e = await H.ewsVerstuur(env, adviseur, aan, onderwerp, html).catch(x => ({ ok: false, error: String(x && x.message || x) }));
    if (e && e.ok) return { ok: true, via: adviseur, naar: aan.join(", ") };
  }
  if (!env.RESEND_API_KEY || !(env.MAIL_FROM_FONTEYN || env.MAIL_FROM)) return { ok: false, error: "Het mailen is in de worker nog in te richten." };
  const bron = env.MAIL_FROM_FONTEYN || env.MAIL_FROM;
  const adres = (String(bron).match(/<([^>]+)>/) || [])[1] || String(bron);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Fonteyn <" + adres + ">", to: aan, ...(adviseur ? { reply_to: [adviseur] } : {}), subject: onderwerp, html }),
  });
  if (!r.ok) return { ok: false, error: "Versturen lukte nog niet (" + r.status + ")." };
  return { ok: true, via: "Fonteyn", naar: aan.join(", ") };
}

/* ── Het voorstel zelf: om te printen en om naar de klant te sturen ──────── */
/* Gerrit (31 okt 2026): "Ga door met voorstel naar de klant sturen en
   printen." Logic4 maakt zijn offerte-pdf alleen in het programma zelf, niet
   via de koppeling. Dus tekent het Dashboard het voorstel als pagina: de
   adviseur print die (of slaat hem op als pdf), en de klant krijgt een mail
   met een link ernaartoe. Wat de klant ziet is de stand op het moment van
   versturen; latere wijzigingen gaan pas mee bij opnieuw versturen. */
function vsDocLink(env, v) { return (env.SVC_LINK_BASIS || "https://fonteyn-data-store.g-mulder.workers.dev") + "/voorstel/bekijk?t=" + encodeURIComponent(v.bekijkToken); }
function vsGeld(x) { return "\u20ac " + (Math.round((Number(x) || 0) * 100) / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function vsDatum(t) { const d = t ? new Date(t) : null; return d && !isNaN(d) ? d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }) : ""; }
/* Alles wat op het papier komt, in één keer bij elkaar. */
async function vsDocGegevens(env, H, db, v) {
  const o = await vsOrderLees(env, H, v.orderid);
  if (!o) throw new Error("Logic4 gaf dit voorstel even terug zonder inhoud. Probeer het zo nog eens.");
  const k = await vsKeuzes(env, H, db);
  const naamVan = (lijst, id) => ((k[lijst] || []).find(x => String(x.id) === String(id)) || {}).naam || "";
  const mw = (k.medewerkers || []).find(x => String(x.id) === String(o.kop.medewerker)) || {};
  const adviseurMail = /@/.test(mw.login || "") ? mw.login : vsAdviseurMail(v.adviseur);
  return {
    nummer: o.id, datum: Date.now(), geldigTot: v.vervaldatum || "",
    klant: v.klant, zakelijk: !!(v.klant && (v.klant.bedrijf || v.klant.btw)),
    referentie: o.kop.referentie, omschrijving: o.kop.omschrijving,
    betaalmethode: naamVan("betaalmethoden", o.kop.betaalmethode), transporteur: naamVan("transporteurs", o.kop.transporteur),
    leverdatum: o.kop.leverdatum && o.kop.leverdatum < "2099" ? o.kop.leverdatum : "",
    adviseur: { naam: mw.naam || String(v.adviseur || "").replace(/@.*/, ""), mail: adviseurMail },
    regels: o.regels.filter(r => !r.vervallen && r.aantal).map(r => ({ code: r.code, oms: r.oms, oms2: r.oms2, aantal: r.aantal,
      stukEx: r.netto, stukIncl: Math.round(r.netto * (1 + r.btw / 100) * 100) / 100, btw: r.btw,
      bruto: r.bruto, korting: r.bruto && r.netto < r.bruto ? Math.round((1 - r.netto / r.bruto) * 1000) / 10 : 0 })),
    totaal: o.totaal,
  };
}
function vsDocHtml(d, opties) {
  opties = opties || {};
  const k = d.klant || {}, a = k.aflevering || {};
  const regel = (l, w) => w ? "<tr><td>" + vsEsc(l) + "</td><td>" + vsEsc(w) + "</td></tr>" : "";
  const adres = [[k.straat, [k.huisnummer, k.toevoeging].filter(Boolean).join(" ")].filter(Boolean).join(" "), [k.postcode, k.plaats].filter(Boolean).join(" "), k.land && k.land !== "NL" ? k.land : ""].filter(Boolean);
  const incl = !d.zakelijk;   // particulier: prijzen met btw; zakelijk: zonder
  const rij = r => "<tr><td>" + vsEsc(r.oms) + (r.oms2 && r.oms2.trim() !== String(r.oms).trim() ? "<div class='klein'>" + vsEsc(r.oms2) + "</div>" : "") + "<div class='klein'>Artikel " + vsEsc(r.code) + (r.korting ? " &middot; " + vsEsc(String(r.korting).replace(".", ",")) + "% korting" : "") + "</div></td>" +
    "<td class='g'>" + vsEsc(String(r.aantal).replace(".", ",")) + "</td><td class='g'>" + vsGeld(incl ? r.stukIncl : r.stukEx) + "</td><td class='g'>" + vsGeld((incl ? r.stukIncl : r.stukEx) * r.aantal) + "</td></tr>";
  const t = d.totaal || {};
  return "<!doctype html><html lang='nl'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>" +
    "<title>Voorstel " + vsEsc(d.nummer) + " - Fonteyn</title><meta name='robots' content='noindex'><style>" +
    "body{margin:0;background:#f5f4ef;font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:14px}" +
    ".vel{max-width:800px;margin:20px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}" +
    ".kop{background:#144734;padding:18px 26px;display:flex;align-items:center;gap:16px}.kop img{height:52px;display:block}.kop .t{margin-left:auto;color:#fff;text-align:right}.kop .t b{display:block;font-size:20px}" +
    ".in{padding:24px 26px 28px}.twee{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:18px}@media(max-width:600px){.twee{grid-template-columns:1fr}.in{padding:18px 14px}}" +
    "h3{margin:0 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#144734}p{margin:0;line-height:1.5}" +
    "table.geg{border-collapse:collapse}table.geg td{padding:2px 12px 2px 0;vertical-align:top}table.geg td:first-child{color:#6b7280}" +
    "table.r{width:100%;border-collapse:collapse;margin-top:6px}table.r th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;border-bottom:2px solid #144734;padding:7px 6px}" +
    "table.r td{padding:9px 6px;border-bottom:1px solid #eee;vertical-align:top}.g{text-align:right;white-space:nowrap}table.r th.g{text-align:right}.klein{font-size:12px;color:#6b7280;margin-top:2px}" +
    ".tot{margin:14px 0 0 auto;border-collapse:collapse}.tot td{padding:4px 6px}.tot td:last-child{text-align:right;min-width:110px}.tot .groot td{font-weight:bold;font-size:16px;border-top:2px solid #144734;padding-top:8px}" +
    ".knop{display:inline-block;background:#144734;color:#fff;border:0;border-radius:10px;padding:12px 18px;font-size:15px;font-weight:bold;cursor:pointer;font-family:inherit}" +
    ".balk{max-width:800px;margin:16px auto 0;text-align:right}" +
    "@media print{body{background:#fff}.balk{display:none}.vel{border:0;margin:0;max-width:none;border-radius:0}.kop{-webkit-print-color-adjust:exact;print-color-adjust:exact}}" +
    "</style></head><body>" +
    "<div class='balk'><button class='knop' onclick='window.print()' title='Print dit voorstel of sla het op als pdf'>Printen of opslaan als pdf</button></div>" +
    "<div class='vel'><div class='kop'><img src='" + VS_LOGO + "' alt='Fonteyn'><div class='t'><b>Voorstel " + vsEsc(d.nummer) + "</b>" + vsEsc(vsDatum(d.datum)) + "</div></div><div class='in'>" +
    "<div class='twee'><div><h3>Voor</h3><p><b>" + vsEsc(k.bedrijf || vsNaam(k)) + "</b>" + (k.bedrijf ? "<br>t.a.v. " + vsEsc(vsNaam(k)) : "") + "<br>" + adres.map(vsEsc).join("<br>") + "</p>" +
      (k.afwijkend ? "<h3 style='margin-top:12px'>Afleveradres</h3><p>" + [a.naam, [a.straat, [a.huisnummer, a.toevoeging].filter(Boolean).join(" ")].join(" "), [a.postcode, a.plaats].filter(Boolean).join(" ")].filter(x => String(x).trim()).map(vsEsc).join("<br>") + "</p>" : "") + "</div>" +
    "<div><h3>Gegevens</h3><table class='geg'>" + regel("Voorstel", d.nummer) + regel("Datum", vsDatum(d.datum)) + regel("Geldig tot", d.geldigTot ? vsDatum(d.geldigTot) : "") +
      regel("Je referentie", d.referentie) + regel("Betaling", d.betaalmethode) + regel("Levering", d.transporteur) + regel("Gewenste leverdatum", d.leverdatum ? vsDatum(d.leverdatum) : "") +
      regel("Je adviseur", d.adviseur.naam) + regel("E-mail", d.adviseur.mail) + "</table></div></div>" +
    (d.omschrijving ? "<p style='margin-bottom:12px'><b>" + vsEsc(d.omschrijving) + "</b></p>" : "") +
    "<table class='r'><thead><tr><th>Omschrijving</th><th class='g'>Aantal</th><th class='g'>Prijs per stuk" + (incl ? " incl. btw" : " excl. btw") + "</th><th class='g'>Totaal</th></tr></thead><tbody>" + d.regels.map(rij).join("") + "</tbody></table>" +
    "<table class='tot'>" + (t.verzend ? "<tr><td>Verzendkosten excl. btw</td><td>" + vsGeld(t.verzend) + "</td></tr>" : "") +
      "<tr><td>Totaal excl. btw</td><td>" + vsGeld(t.ex) + "</td></tr><tr><td>Btw</td><td>" + vsGeld(t.btw) + "</td></tr><tr class='groot'><td>Totaal incl. btw</td><td>" + vsGeld(t.incl) + "</td></tr></table>" +
    "<p class='klein' style='margin-top:24px'>Vragen over dit voorstel? Mail of bel je adviseur" + (d.adviseur.naam ? ", " + vsEsc(d.adviseur.naam) : "") + ". We helpen je graag verder.</p>" +
    "</div></div>" + (opties.voet || "") + "</body></html>";
}
function vsVoorstelMailHtml(v, d, link, tekst) {
  const k = v.klant || {};
  /* Klanten spreken we altijd aan met je (Gerrit, 31 okt 2026). */
  const aanhef = "Beste " + (k.voornaam || vsNaam(k) || "klant");
  const alinea = String(tekst || "Hierbij ontvang je ons voorstel. Je bekijkt het via de knop hieronder; daar kun je het ook printen of opslaan als pdf.")
    .split(/\n{2,}/).map(x => "<p style='font-size:15px;line-height:1.55'>" + vsEsc(x).replace(/\n/g, "<br>") + "</p>").join("");
  return "<div style='font-family:Arial,Helvetica,sans-serif;background:#f5f4ef;padding:20px'><div style='max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden'>" +
    "<div style='background:#144734;padding:16px 20px'><img src='" + VS_LOGO + "' alt='Fonteyn' style='height:44px;display:block'></div>" +
    "<div style='padding:22px'><p style='font-size:15px;line-height:1.55'>" + vsEsc(aanhef) + ",</p>" + alinea +
    "<table style='border-collapse:collapse;margin:16px 0;font-size:14px'><tr><td style='color:#6b7280;padding:3px 14px 3px 0'>Voorstel</td><td><b>" + vsEsc(d.nummer) + "</b></td></tr>" +
    "<tr><td style='color:#6b7280;padding:3px 14px 3px 0'>Totaal incl. btw</td><td><b>" + vsGeld(d.totaal.incl) + "</b></td></tr>" +
    (d.geldigTot ? "<tr><td style='color:#6b7280;padding:3px 14px 3px 0'>Geldig tot</td><td>" + vsEsc(vsDatum(d.geldigTot)) + "</td></tr>" : "") + "</table>" +
    "<p style='margin:22px 0'><a href='" + vsEsc(link) + "' style='background:#15803d;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:bold;font-size:16px;display:inline-block'>Bekijk je voorstel</a></p>" +
    "<p style='font-size:15px;line-height:1.55'>Met vriendelijke groet,<br>" + vsEsc(d.adviseur.naam || "Fonteyn") + "<br><span style='color:#6b7280'>Fonteyn" + (d.adviseur.mail ? " &middot; " + vsEsc(d.adviseur.mail) : "") + "</span></p></div></div></div>";
}

/* ── De pagina voor de klant ────────────────────────────────────────────── */
function vsPagina(titel, inhoud) {
  return new Response("<!doctype html><html lang='nl'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>" +
    "<title>" + vsEsc(titel) + " - Fonteyn</title><meta name='robots' content='noindex'>" +
    "<style>body{margin:0;background:#f5f4ef;font-family:Arial,Helvetica,sans-serif;color:#1f2937}" +
    ".kop{background:#144734;padding:16px 20px}.kop img{height:48px;display:block}" +
    ".blok{max-width:560px;margin:22px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:22px 22px 26px}" +
    "@media(max-width:600px){.blok{margin:12px 12px;padding:18px 16px 22px}}" +
    "h1{color:#144734;font-size:21px;margin:0 0 10px}p{font-size:15px;line-height:1.55;margin:0 0 12px}" +
    "table.geg{width:100%;border-collapse:collapse;font-size:15px;margin:6px 0 14px}table.geg td{padding:7px 4px;border-bottom:1px solid #f0f0ea;vertical-align:top}table.geg td:first-child{color:#6b7280;width:40%}" +
    ".knop{display:block;width:100%;box-sizing:border-box;border:0;border-radius:10px;padding:15px 18px;font-size:16px;font-weight:bold;cursor:pointer;color:#fff;margin-top:10px;text-align:center;text-decoration:none;font-family:inherit}" +
    ".groen{background:#15803d}.grijs{background:#fff;color:#144734;border:1px solid #d1d5db}" +
    ".rij{display:grid;grid-template-columns:1fr 1fr;gap:10px}.rij3{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px}@media(max-width:480px){.rij,.rij3{grid-template-columns:1fr}}" +
    "label{display:block;font-size:13px;color:#374151;margin:10px 0 4px}input,select{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:10px;border:1px solid #d1d5db;border-radius:8px;background:#fff}" +
    ".vink{display:flex;align-items:center;gap:8px;margin:14px 0 4px;font-size:15px}.vink input{width:auto}" +
    ".klein{font-size:13px;color:#6b7280}</style></head><body>" +
    "<div class='kop'><img src='" + VS_LOGO + "' alt='Fonteyn'></div><div class='blok'>" + inhoud + "</div></body></html>",
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
function vsGegevensTabel(k) {
  const aanhef = k.aanhef === "1" ? "De heer" : k.aanhef === "2" ? "Mevrouw" : "";
  const rij = (l, w) => w ? "<tr><td>" + vsEsc(l) + "</td><td>" + vsEsc(w) + "</td></tr>" : "";
  const adres = [k.straat, [k.huisnummer, k.toevoeging].filter(Boolean).join(" ")].filter(Boolean).join(" ");
  const a = k.aflevering || {};
  return "<table class='geg'>" + rij("Naam", [aanhef, vsNaam(k)].filter(Boolean).join(" ")) + rij("Bedrijf", k.bedrijf) + rij("Btw-nummer", k.btw) +
    rij("Adres", adres) + rij("Postcode en plaats", [k.postcode, k.plaats].filter(Boolean).join(" ")) + rij("Land", k.land) +
    rij("E-mailadres", k.email) + rij("Telefoon", k.telefoon) + rij("Mobiel", k.mobiel) +
    (k.afwijkend ? rij("Afleveren op", [a.naam, [a.straat, [a.huisnummer, a.toevoeging].filter(Boolean).join(" ")].join(" "), [a.postcode, a.plaats].filter(Boolean).join(" ")].filter(Boolean).join(", ")) : "") +
    "</table>";
}
function vsVeld(naam, label, waarde, extra) {
  return "<div><label for='" + naam + "'>" + vsEsc(label) + "</label><input id='" + naam + "' name='" + naam + "' value='" + vsEsc(waarde) + "'" + (extra || "") + "></div>";
}
function vsFormulier(token, k) {
  const a = k.aflevering || {};
  return "<form method='post' action='/bevestig'><input type='hidden' name='t' value='" + vsEsc(token) + "'><input type='hidden' name='soort' value='aangepast'>" +
    "<label for='aanhef'>Aanhef</label><select id='aanhef' name='aanhef'><option value=''></option><option value='1'" + (k.aanhef === "1" ? " selected" : "") + ">De heer</option><option value='2'" + (k.aanhef === "2" ? " selected" : "") + ">Mevrouw</option></select>" +
    "<div class='rij3'>" + vsVeld("voornaam", "Voornaam", k.voornaam) + vsVeld("tussenvoegsel", "Tussenvoegsel", k.tussenvoegsel) + vsVeld("achternaam", "Achternaam", k.achternaam, " required") + "</div>" +
    (k.bedrijf || k.btw ? "<div class='rij'>" + vsVeld("bedrijf", "Bedrijfsnaam", k.bedrijf) + vsVeld("btw", "Btw-nummer", k.btw) + "</div>" : "") +
    "<div class='rij3'>" + vsVeld("straat", "Straat", k.straat, " required") + vsVeld("huisnummer", "Huisnummer", k.huisnummer, " required") + vsVeld("toevoeging", "Toevoeging", k.toevoeging) + "</div>" +
    "<div class='rij3'>" + vsVeld("plaats", "Plaats", k.plaats, " required") + vsVeld("postcode", "Postcode", k.postcode, " required") + vsVeld("land", "Land", k.land, " maxlength='2'") + "</div>" +
    vsVeld("email", "E-mailadres", k.email, " type='email' required") +
    "<div class='rij'>" + vsVeld("telefoon", "Telefoon", k.telefoon, " type='tel'") + vsVeld("mobiel", "Mobiel", k.mobiel, " type='tel'") + "</div>" +
    "<label class='vink'><input type='checkbox' name='afwijkend' value='1'" + (k.afwijkend ? " checked" : "") + " onchange=\"document.getElementById('afl').style.display=this.checked?'block':'none'\"> Afleveren op een ander adres</label>" +
    "<div id='afl' style='display:" + (k.afwijkend ? "block" : "none") + "'>" + vsVeld("a_naam", "Naam", a.naam) +
    "<div class='rij3'>" + vsVeld("a_straat", "Straat", a.straat) + vsVeld("a_huisnummer", "Huisnummer", a.huisnummer) + vsVeld("a_toevoeging", "Toevoeging", a.toevoeging) + "</div>" +
    "<div class='rij3'>" + vsVeld("a_plaats", "Plaats", a.plaats) + vsVeld("a_postcode", "Postcode", a.postcode) + vsVeld("a_land", "Land", a.land, " maxlength='2'") + "</div></div>" +
    "<button class='knop groen' type='submit'>Opslaan, zo klopt het</button></form>";
}
async function vsBevestigGet(env, url) {
  const db = await vsDb(env);
  const token = String(url.searchParams.get("t") || "");
  const r = token ? await db.prepare("SELECT * FROM voorstel WHERE token = ?1").bind(token).first() : null;
  if (!r) return vsPagina("Bevestig je gegevens", "<h1>Deze link is verlopen</h1><p>Vraag je adviseur gerust om een nieuwe link.</p>");
  const v = vsUit(r);
  if (v.status !== "wacht") {
    return vsPagina("Bevestig je gegevens", "<h1>Bedankt, je gegevens zijn bevestigd</h1><p>Je adviseur maakt nu je voorstel. Je hoort snel van ons.</p>" + vsGegevensTabel(v.klant || {}));
  }
  if (url.searchParams.get("aanpassen") === "1") {
    return vsPagina("Gegevens aanpassen", "<h1>Pas je gegevens aan</h1><p>Verander wat er anders moet en klik daarna op opslaan.</p>" + vsFormulier(token, v.klant || {}));
  }
  return vsPagina("Bevestig je gegevens",
    "<h1>Kloppen je gegevens?</h1><p>Kijk ze even na. Daarna maakt je adviseur je voorstel.</p>" + vsGegevensTabel(v.klant || {}) +
    "<form method='post' action='/bevestig'><input type='hidden' name='t' value='" + vsEsc(token) + "'><input type='hidden' name='soort' value='klopt'><button class='knop groen' type='submit'>Klopt</button></form>" +
    "<a class='knop grijs' href='/bevestig?t=" + encodeURIComponent(token) + "&aanpassen=1'>Klopt niet, ik pas het aan</a>");
}
async function vsBevestigPost(env, request, H) {
  const f = await request.formData().catch(() => null);
  if (!f) return vsPagina("Bevestig je gegevens", "<h1>Dat lukte nog niet</h1><p>Probeer het nog eens via de link in de mail.</p>");
  const db = await vsDb(env);
  const token = String(f.get("t") || "");
  const r = token ? await db.prepare("SELECT * FROM voorstel WHERE token = ?1").bind(token).first() : null;
  if (!r) return vsPagina("Bevestig je gegevens", "<h1>Deze link is verlopen</h1><p>Vraag je adviseur gerust om een nieuwe link.</p>");
  const v = vsUit(r);
  if (v.status !== "wacht") return vsPagina("Bevestig je gegevens", "<h1>Bedankt, je gegevens zijn bevestigd</h1><p>Je adviseur maakt nu je voorstel.</p>");
  let verschil = [];
  if (String(f.get("soort")) === "aangepast") {
    const g = (n) => f.get(n);
    const nieuw = vsKlantSchoon({
      aanhef: g("aanhef"), voornaam: g("voornaam"), tussenvoegsel: g("tussenvoegsel"), achternaam: g("achternaam"),
      bedrijf: g("bedrijf") != null ? g("bedrijf") : v.klant.bedrijf, btw: g("btw") != null ? g("btw") : v.klant.btw,
      straat: g("straat"), huisnummer: g("huisnummer"), toevoeging: g("toevoeging"), postcode: g("postcode"), plaats: g("plaats"),
      land: g("land"), email: g("email"), telefoon: g("telefoon"), mobiel: g("mobiel"), afwijkend: g("afwijkend") === "1",
      aflevering: { naam: g("a_naam"), straat: g("a_straat"), huisnummer: g("a_huisnummer"), toevoeging: g("a_toevoeging"), postcode: g("a_postcode"), plaats: g("a_plaats"), land: g("a_land") },
    });
    const mist = vsKlantMist(nieuw);
    if (mist.length) return vsPagina("Gegevens aanpassen", "<h1>Bijna klaar</h1><p>Vul nog in: " + vsEsc(mist.join(", ")) + ".</p>" + vsFormulier(token, nieuw));
    verschil = vsVerschil(v.klant, nieuw);
    v.klantAdviseur = v.klant;
    v.klant = nieuw;
  }
  v.status = "bevestigd";
  v.bevestigd = { ts: Date.now(), aangepast: verschil.length > 0, verschil };
  vsLog(v, "de klant", verschil.length ? "Gegevens aangepast en bevestigd (" + verschil.map(x => x.veld).join(", ") + ")" : "Gegevens bevestigd");
  await vsSchrijf(db, v);
  // Meteen de debiteur en de offerte in Logic4, zodat de adviseur verder kan.
  try { await vsNaarLogic4(env, H, db, v, "het Dashboard"); }
  catch (e) { v.logic4Fout = String(e.message || e).slice(0, 300); vsLog(v, "het Dashboard", "Logic4 lukte nog niet: " + v.logic4Fout); await vsSchrijf(db, v); }
  await vsBericht(env, H, v, verschil).catch(() => {});
  return vsPagina("Bedankt", "<h1>Bedankt, je gegevens zijn bevestigd</h1><p>Je adviseur maakt nu je voorstel. Je hoort snel van ons.</p>" + vsGegevensTabel(v.klant));
}
/* Bericht in het Dashboard van de adviseur. Bij "klopt niet" met wat er
   anders is; bij "klopt" kort dat hij verder kan. */
async function vsBericht(env, H, v, verschil) {
  if (!H.berichtenLees || !H.berichtErbij) return;
  const d = await H.berichtenLees(env);
  const naam = vsNaam(v.klant);
  const tekst = verschil.length
    ? naam + " heeft de gegevens aangepast en bevestigd. Anders: " + verschil.map(x => x.veld + " " + (x.was ? "'" + x.was + "'" : "(leeg)") + " wordt '" + x.wordt + "'").join("; ") + "."
    : naam + " heeft de gegevens bevestigd. Je kunt nu regels toevoegen.";
  H.berichtErbij(d, { id: "vs-" + v.id + "-" + (v.bevestigd && v.bevestigd.ts), aan: [v.adviseur], soort: "voorstel",
    titel: verschil.length ? "Klant paste gegevens aan: " + naam : "Klant bevestigde: " + naam, tekst,
    ref: { voorstel: v.id, link: "voorstel-maken.html?id=" + encodeURIComponent(v.id) } });
  await env.FONTEYN_DATA.put("berichten", JSON.stringify(d));
}

/* ── De ingang vanuit worker.js ─────────────────────────────────────────── */
export async function vsHandle(request, env, url, H) {
  const p = url.pathname;
  // De klantpagina: zonder sleutel, het token in de link is de sleutel.
  /* Het voorstel bekijken: ?t= is de link uit de mail aan de klant (de
     versie van het versturen), ?p= de printlink van de adviseur (live). */
  if (p === "/voorstel/bekijk" && request.method === "GET") {
    const db = await vsDb(env);
    const t = String(url.searchParams.get("t") || ""), pr = String(url.searchParams.get("p") || "");
    const l = (t || pr) ? await db.prepare("SELECT id FROM voorstel_link WHERE token = ?1 AND soort = ?2").bind(t || pr, t ? "t" : "p").first() : null;
    const v = l ? await vsLees(db, l.id) : null;
    if (!v || (t && !v.verstuurdeVersie) || v.status === "gesloten")
      return vsPagina("Voorstel", "<h1>Dit voorstel is verlopen</h1><p>Vraag je adviseur gerust om een nieuwe link.</p>");
    try {
      const d = t ? v.verstuurdeVersie : await vsDocGegevens(env, H, db, v);
      return new Response(vsDocHtml(d), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
    } catch (e) { return vsPagina("Voorstel", "<h1>Even geduld</h1><p>" + vsEsc(e.message) + "</p>"); }
  }
  if (p === "/bevestig") {
    if (request.method === "GET") return vsBevestigGet(env, url);
    if (request.method === "POST") return vsBevestigPost(env, request, H);
    return H.reply(405, { ok: false });
  }
  // DEV_OPEN bestaat alleen bij een lokale proefdraai (wrangler dev --var), nooit in de uitrol.
  if (!env.DEV_OPEN && (!env.SHARED_SECRET || (request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET)) return H.reply(401, { ok: false, error: "geen teamsleutel: ga één keer terug naar het Dashboard en open de tegel opnieuw" });
  const wie = String(request.headers.get("X-Fonteyn-User") || "").toLowerCase().slice(0, 80);
  if (!(await H.toegangMag(env, "voorstel-maken", wie))) return H.reply(403, { ok: false, error: "Deze tegel is voor de adviseurs." });
  const beheer = await H.toegangMag(env, "voorstel-beheer", wie);
  const db = await vsDb(env);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const eigen = async (id) => {
    const v = await vsLees(db, id);
    if (!v) throw Object.assign(new Error("Dit voorstel is onbekend of al opgeruimd."), { code: 404 });
    if (v.adviseur !== wie && !beheer) throw Object.assign(new Error("Dit voorstel is van een andere adviseur."), { code: 403 });
    return v;
  };
  try {
    if (p === "/voorstel/lijst" && request.method === "GET") {
      const alle = beheer && url.searchParams.get("alle") === "1";
      const rs = alle
        ? await db.prepare("SELECT * FROM voorstel ORDER BY gewijzigd DESC LIMIT 200").all()
        : await db.prepare("SELECT * FROM voorstel WHERE adviseur = ?1 ORDER BY gewijzigd DESC LIMIT 200").bind(wie).all();
      return H.reply(200, { ok: true, beheer, voorstellen: (rs.results || []).map(vsUit).map(v => ({
        id: v.id, status: v.status, klant: vsNaam(v.klant || {}), plaats: (v.klant || {}).plaats || "", email: (v.klant || {}).email || "",
        debiteur: v.debiteur, orderid: v.orderid, adviseur: v.adviseur, gewijzigd: v.gewijzigd, aangepast: !!(v.bevestigd && v.bevestigd.aangepast) })) });
    }
    if (p === "/voorstel/keuzes" && request.method === "GET") {
      const k = await vsKeuzes(env, H, db);
      return H.reply(200, { ok: true, keuzes: k, ikMedewerker: vsMedewerkerVan(k, wie) });
    }
    if (p === "/voorstel/klant-zoek" && request.method === "GET") return H.reply(200, await vsKlantZoek(env, H, url.searchParams.get("q")));
    if (p === "/voorstel/artikel" && request.method === "GET") return H.reply(200, await vsArtikel(env, H, url.searchParams.get("q"), url.searchParams.get("debiteur")));
    if (p === "/voorstel" && request.method === "GET") {
      const v = await eigen(url.searchParams.get("id"));
      let order = null;
      if (v.orderid) order = await vsOrderLees(env, H, v.orderid).catch(e => ({ fout: String(e.message || e) }));
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v), order, eerder: await vsEerder(db, v) });
    }
    /* Nieuw, of de klantgegevens bijwerken. Na het versturen van de mail
       kan de adviseur de gegevens alleen nog veranderen door opnieuw te
       versturen: wat de klant bevestigt is dan weer de nieuwe versie. */
    if (p === "/voorstel/klant" && request.method === "POST") {
      const klant = vsKlantSchoon(body.klant);
      let v;
      if (body.id) {
        v = await eigen(body.id);
        if (["bevestigd", "in-logic4"].includes(v.status)) return H.reply(409, { ok: false, error: "De klant heeft deze gegevens al bevestigd. Een wijziging gaat via een nieuw voorstel." });
        if (v.status === "wacht" && JSON.stringify(v.klant) !== JSON.stringify(klant)) { v.status = "concept"; vsLog(v, wie, "Gegevens aangepast na het versturen; de mail moet opnieuw"); }
      } else {
        v = { id: vsCode(10), token: vsCode(32), status: "concept", adviseur: wie, aangemaakt: Date.now(), kop: {} };
        vsLog(v, wie, "Voorstel begonnen");
      }
      v.klant = klant;
      if (body.debiteur !== undefined) v.debiteur = Number(body.debiteur) || null;
      await vsSchrijf(db, v);
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v), eerder: await vsEerder(db, v) });
    }
    /* Al eerder bevestigd, met precies dezelfde gegevens: zonder mail verder. */
    if (p === "/voorstel/eerder" && request.method === "POST") {
      const v = await eigen(body.id);
      if (!["concept", "wacht"].includes(v.status)) return H.reply(409, { ok: false, error: "Dit voorstel is al verder." });
      const e = await vsEerder(db, v);
      if (!e || e.anders) return H.reply(409, { ok: false, error: "De gegevens zijn anders dan wat de klant bevestigde. Stuur de mail Bevestig je gegevens." });
      v.status = "bevestigd";
      v.bevestigd = { ts: Date.now(), eerder: e.ts, aangepast: false, verschil: [] };
      vsLog(v, wie, "Klant had deze gegevens al bevestigd op " + new Date(e.ts).toISOString().slice(0, 10) + "; verder zonder mail");
      await vsSchrijf(db, v);
      let fout = null;
      try { await vsNaarLogic4(env, H, db, v, wie); } catch (x) { fout = String(x.message || x).slice(0, 300); v.logic4Fout = fout; await vsSchrijf(db, v); }
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v), fout });
    }
    if (p === "/voorstel/verstuur" && request.method === "POST") {
      const v = await eigen(body.id);
      if (["bevestigd", "in-logic4"].includes(v.status)) return H.reply(409, { ok: false, error: "De klant heeft zijn gegevens al bevestigd." });
      const mist = vsKlantMist(v.klant || {});
      if (mist.length) return H.reply(400, { ok: false, error: "Vul nog in: " + mist.join(", ") + "." });
      if (v.status === "wacht" && body.opnieuw !== true) return H.reply(409, { ok: false, error: "De mail is al verstuurd." });
      v.token = vsCode(32);   // een nieuwe link: een oude mail werkt dan niet meer
      const m = await vsMailStuur(env, H, v, wie);
      if (!m.ok) return H.reply(502, m);
      v.status = "wacht";
      v.verstuurd = { ts: Date.now(), naar: m.naar, via: m.via };
      vsLog(v, wie, "Mail 'Bevestig je gegevens' verstuurd naar " + m.naar);
      await vsSchrijf(db, v);
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v) });
    }
    /* Opnieuw proberen als Logic4 bij de bevestiging even niet wilde. */
    if (p === "/voorstel/logic4" && request.method === "POST") {
      const v = await eigen(body.id);
      const r = await vsNaarLogic4(env, H, db, v, wie);
      if (r.ok) { delete v.logic4Fout; await vsSchrijf(db, v); }
      return H.reply(r.ok ? 200 : 409, r);
    }
    if (p === "/voorstel/kop" && request.method === "POST") {
      const v = await eigen(body.id);
      // Gerrit (31 okt 2026): de gegevens van het voorstel pas invullen na de bevestiging.
      if (v.status !== "in-logic4") return H.reply(409, { ok: false, error: "Invullen kan zodra de klant zijn gegevens heeft bevestigd." });
      const kop = Object.assign({}, v.kop || {}, body.kop || {});
      v.kop = kop;
      if (body.kop && body.kop.vervaldatum !== undefined) v.vervaldatum = vsS(body.kop.vervaldatum, 10);
      if (v.status === "gesloten") return H.reply(409, { ok: false, error: "Dit voorstel is gesloten." });
      if (v.orderid) {
        /* De status die Logic4 nu heeft gaat ongewijzigd mee terug. Stond
           hier vast 4, dan zette elke kopwijziging een gesloten voorstel of
           een order die intussen betaald is terug op Offerte (proef 31 okt). */
        const nu = await vsOrderLees(env, H, v.orderid);
        if (nu && Number(nu.statusId) !== VS_OFFERTE) return H.reply(409, { ok: false, error: "Dit voorstel is in Logic4 al verder (status " + nu.status + "); de kop blijft zoals hij is." });
        await vsL4(env, H, "/v3/Orders/AddUpdateOrder", Object.assign({ Id: Number(v.orderid), DebtorId: Number(v.debiteur),
          OrderStatus: { Id: VS_OFFERTE }, CreationDate: new Date(v.aangemaakt || Date.now()).toISOString().slice(0, 19) }, vsKopNaarL4(kop)));
      }
      vsLog(v, wie, "Kop aangepast: " + Object.keys(body.kop || {}).join(", "));
      await vsSchrijf(db, v);
      const order = v.orderid ? await vsOrderLees(env, H, v.orderid).catch(() => null) : null;
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v), order });
    }
    /* Het voorstel als pagina, om te printen (live uit Logic4). Geeft een
       link terug die de tegel in een nieuw venster opent. */
    if (p === "/voorstel/print" && request.method === "POST") {
      const v = await eigen(body.id);
      if (!v.orderid) return H.reply(409, { ok: false, error: "Printen kan zodra het voorstel in Logic4 staat." });
      if (!v.printToken) {
        v.printToken = vsCode(32); await vsSchrijf(db, v);
        await db.prepare("INSERT OR REPLACE INTO voorstel_link (token, id, soort, ts) VALUES (?1, ?2, 'p', ?3)").bind(v.printToken, v.id, Date.now()).run();
      }
      return H.reply(200, { ok: true, url: (env.SVC_LINK_BASIS || "https://fonteyn-data-store.g-mulder.workers.dev") + "/voorstel/bekijk?p=" + encodeURIComponent(v.printToken) });
    }
    /* Versturen aan de klant. Zonder 'stuur:true' komt alleen het voorbeeld
       terug (mail en voorstel), zodat de adviseur eerst ziet wat er gaat. */
    if (p === "/voorstel/stuur" && request.method === "POST") {
      const v = await eigen(body.id);
      if (!v.orderid || v.status !== "in-logic4") return H.reply(409, { ok: false, error: "Versturen kan zodra het voorstel in Logic4 staat." });
      const d = await vsDocGegevens(env, H, db, v);
      if (!d.regels.length) return H.reply(400, { ok: false, error: "Zet eerst minstens één regel op het voorstel." });
      const onderwerp = vsS(body.onderwerp, 150) || ("Je voorstel " + d.nummer + " van Fonteyn");
      const tekst = String(body.tekst || "").slice(0, 3000);
      if (body.stuur !== true) {
        return H.reply(200, { ok: true, voorbeeld: true, naar: v.klant.email, onderwerp,
          mail: vsVoorstelMailHtml(v, d, "#", tekst), voorstel: vsDocHtml(d) });
      }
      if (!VS_STUUR_AAN && !env.DEV_OPEN) return H.reply(409, { ok: false, error: "Versturen gaat aan zodra de opmaak van de mail is goedgekeurd. Printen en het voorbeeld werken al." });
      if (!v.bekijkToken) {
        v.bekijkToken = vsCode(32);
        await db.prepare("INSERT OR REPLACE INTO voorstel_link (token, id, soort, ts) VALUES (?1, ?2, 't', ?3)").bind(v.bekijkToken, v.id, Date.now()).run();
      }
      v.verstuurdeVersie = d;
      const m = await vsMailStuur(env, H, v, wie, onderwerp, vsVoorstelMailHtml(v, d, vsDocLink(env, v), tekst));
      if (!m.ok) return H.reply(502, m);
      v.voorstelVerstuurd = (v.voorstelVerstuurd || []).concat([{ ts: Date.now(), naar: m.naar, via: m.via, totaal: d.totaal.incl }]).slice(-20);
      vsLog(v, wie, "Voorstel verstuurd naar " + m.naar + " (" + vsGeld(d.totaal.incl) + ")");
      await vsSchrijf(db, v);
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v) });
    }
    /* Sluiten: in Logic4 naar 'Offerte gesloten' (19). Weggooien kan via de
       koppeling niet; gesloten telt nergens meer mee. */
    if (p === "/voorstel/sluiten" && request.method === "POST") {
      const v = await eigen(body.id);
      if (v.orderid) {
        const o = await vsOrderLees(env, H, v.orderid).catch(() => null);
        if (o && Number(o.statusId) !== VS_OFFERTE && Number(o.statusId) !== VS_GESLOTEN)
          return H.reply(409, { ok: false, error: "Dit voorstel is in Logic4 al een order geworden." });
        await vsL4(env, H, "/v3/Orders/UpdateOrderStatus", { OrderId: Number(v.orderid), StatusId: VS_GESLOTEN });
      }
      v.status = "gesloten";
      vsLog(v, wie, "Voorstel gesloten" + (body.reden ? ": " + vsS(body.reden, 200) : ""));
      await vsSchrijf(db, v);
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v) });
    }
    if (p === "/voorstel/regel" && request.method === "POST") {
      const v = await eigen(body.id);
      if (!v.orderid || v.status !== "in-logic4") return H.reply(409, { ok: false, error: "Regels toevoegen kan pas als de klant zijn gegevens heeft bevestigd." });
      const order = await vsOrderLees(env, H, v.orderid);
      const r = body.regel || {};
      const oud = r.id ? (order.regels || []).find(x => String(x.id) === String(r.id)) : null;
      if (r.id && !oud) return H.reply(404, { ok: false, error: "Deze regel is al van het voorstel af." });
      if (body.weg === true) {
        if (!oud) return H.reply(400, { ok: false, error: "Welke regel?" });
        await vsRegel(env, H, v, { aantal: 0, oms: /\(vervallen\)$/.test(oud.oms) ? oud.oms : (oud.oms + " (vervallen)") }, oud);
        vsLog(v, wie, "Regel " + oud.code + " vervallen");
      } else {
        await vsRegel(env, H, v, r, oud);
        vsLog(v, wie, (oud ? "Regel aangepast: " : "Regel erbij: ") + (r.code || oud.code) + " x " + (r.aantal != null ? r.aantal : oud.aantal));
      }
      await vsSchrijf(db, v);
      return H.reply(200, { ok: true, order: await vsOrderLees(env, H, v.orderid) });
    }
    return H.reply(404, { ok: false, error: "onbekend" });
  } catch (e) {
    return H.reply(e.code || 502, { ok: false, error: String(e.message || e) });
  }
}
