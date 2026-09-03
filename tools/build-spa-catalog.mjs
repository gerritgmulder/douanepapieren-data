#!/usr/bin/env node
// Bouwt de spa-catalogus: model → varianten (artikelcode, kleur, productId)
// uit Logic4, op basis van de SPA_BY_CODE-tabel in voorraad.html, en zet hem
// in KV-bucket 'spa-catalog' (leest beheersleutel uit ~/Documents).
// Draaien: node tools/build-spa-catalog.mjs [--dry]

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { teamKey as readTeamKey } from "./keys.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(join(ROOT, "server/.env"), "utf8").trim().split("\n").map(l => l.split("=")));
const src = readFileSync(join(ROOT, "main.js"), "utf8");
const g = n => src.match(new RegExp('LOGIC4_' + n + '\\s*=\\s*"([^"]+)"'))[1];
const enc = s => String(s).replace(/_/g, "__").replace(/ /g, "_");

const html = readFileSync(join(ROOT, "voorraad.html"), "utf8");
const byCode = JSON.parse(html.match(/const SPA_BY_CODE = (\{.*?\});/s)[1]);
const codes = Object.keys(byCode);
console.log(codes.length + " artikelcodes in SPA_BY_CODE");

const body = new URLSearchParams();
body.set("client_id", enc(g("PUBLICKEY")) + " " + enc(g("COMPANYKEY")) + " " + enc(env.LOGIC4_USERNAME));
body.set("client_secret", enc(g("SECRETKEY")) + " " + enc(env.LOGIC4_PASSWORD));
body.set("scope", "api administration.1");
body.set("grant_type", "client_credentials");
const t = await (await fetch("https://idp.logic4server.nl/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).json();

// Logic4's ProductCodes-filter is onbetrouwbaar (bekend uit de douane-tool):
// dus de HELE catalogus pagineren en client-side filteren.
async function getPage(skip) {
  const r = await fetch("https://api.logic4server.nl/v3/Products/GetProducts", {
    method: "POST",
    headers: { Authorization: "Bearer " + t.access_token, "Content-Type": "application/json" },
    body: JSON.stringify({ TakeRecords: 500, SkipRecords: skip }),
  });
  if (!r.ok) throw new Error("GetProducts HTTP " + r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : (j.Records || j.Products || []);
}

const wanted = new Set(codes);

// Alleen deze productgroepen zijn écht spa's. Op de naam afgaan is niet genoeg:
// "Passion Spas | ElegantFit Spa Furniture" is tuinmeubilair (groep 48) en
// "Bestway | Lay-Z Spa Vegas" een opblaasbadje (groep 47). Die hoorden niet in
// de spa-catalogus, en met alleen een naamfilter kwamen ze er wel in.
const VERVALLEN = 10;   // Logic4-status 'Vervallen'
const SPA_GROEPEN = new Set([
  39,   // Spa's
  92,   // Zwemspa's
  72,   // Spa's Gebruikt
  73,   // Spa's Gebruikt Garantie
  87,   // Spa's Samengesteld
  89,   // Ice Baths
  90,   // Ice Baths Samengesteld
]);
/* Modellen die de naamherkenning hierboven niet vindt.
   ═══════════════════════════════════════════════════════════════════════
   Twintig modellen op de partnerprijslijst hadden helemaal geen artikelcode,
   en dan komt er bij een bestelling een orderregel ZONDER artikel in Logic4
   terecht (met het model in de opmerking, dat sales met de hand moet
   aanvullen). Dat gebeurde bij alle ice baths, alle Turbines, de Infinity en
   de warmtepompen. De reden is telkens de naam: in Logic4 heet een Turbine
   "Storm Spas | Turbine 5 Swimspa" en een barrel "Passion Ice Baths | The
   Iceman's Barrel", en daar past het patroon "<model> Spa |" niet op.

   Waar Logic4 een SAMENGESTELD artikel heeft dat het complete pakket is,
   staat dat hier - niet het losse bad. Gerrit (3 sep 2026): "een Wim Hof
   Barrel XL heeft direct de steps toegevoegd in de order." Artikel 800031
   (Iceman's Barrel XL Compleet) bevat precies dat: het vat, twee steps, twee
   pluggen en de chiller. Logic4 klapt dat bij het aanmaken van de orderregel
   zelf uit.

   Nog open (staan er dus nog steeds niet in): Team Ice Vital-ICE 2 en 4.
   Logic4 kent maar één artikel "Vital-ICE Ice Bath" (800029) en de prijslijst
   twee maten. Welke code bij welke maat hoort is een vraag voor Gretha. */
const HANDMATIG = {
  "Serene 6 Fire Pit":            ["100632"],
  "Turbine 5 Luxury":             ["100639"],
  "Turbine 6 Luxury":             ["100640"],
  "Turbine 7 Luxury":             ["100641"],
  "Turbine 12 Luxury":            ["131441"],
  "Turbine 6 Grand":              ["131445"],
  "Turbine 7 Grand":              ["131443"],
  "Turbine 8 Grand":              ["131444"],
  "Turbine 12 Grand (The Beast)": ["131442"],
  "Infinity":                     ["131467"],
  "Passion HeatMaster 16kW":      ["101240"],
  "Passion HeatMaster 21kW":      ["101241"],
  "Passion Xtreme Green Heat Pump": ["152526"],
  // Ice baths: telkens het Compleet-pakket waar dat bestaat.
  "Wim Hof's Ice Barrel":  ["800063", "800031"],
  "Wim Hof's Ice Revive":  ["800004", "800017", "800019", "800021", "800024", "800026"],
  "Wim Hof's Ice Breeze":  ["800028", "800036", "800037", "800047"],
  "Wim Hof's Ice Faith":   ["800003"],
  "Wim Hof's Ice Elevate": ["101008"],
};
const handmatigeCodes = new Map();      // code → model
for (const [m, cs] of Object.entries(HANDMATIG)) for (const c of cs) handmatigeCodes.set(c, m);

const catalog = {};   // model → [{code, productId, desc, samengesteld, bevat}]
const alleProducten = new Map();   // code → Logic4-product, voor de samenstellingen
let found = 0, scanned = 0;
for (let page = 0; page < 200; page++) {
  const prods = await getPage(page * 500);
  if (!prods.length) break;
  scanned += prods.length;
  for (const p of prods) {
    const code = String(p.ProductCode || "");
    const naam = p.ProductName1 || p.Description || "";
    alleProducten.set(code, p);
    let model = handmatigeCodes.get(code) || (wanted.has(code) ? byCode[code] : null);
    // De handmatige SPA_BY_CODE-lijst liep achter op Logic4: 286 spa-artikelen
    // ontbraken erin, waaronder hele modellen (Dynamic, Fitness, Activity) en
    // de Sydney. Daardoor vond de proforma-koppeling geen artikelcode terwijl
    // het artikel gewoon bestond. Staat een artikel niet in de lijst, dan
    // leiden we het model af uit de productnaam van Logic4 zelf.
    // "swimspa |" eiste dat het woord pál voor het streepje stond. Bij
    // "Aquatic 1 Swimspa ECO | Sterling White…" staat ECO ertussen, waardoor
    // alle ECO-uitvoeringen buiten de catalogus vielen. Nu mag er tekst tussen
    // staan (Chantal wees op hetzelfde soort gat bij de ice baths, 31 jul).
    // Vervallen artikelen horen niet in de catalogus. Ze zijn niet meer te
    // bestellen — Logic4 weigert ze op een inkooporder — en ze kapen de
    // zoekopdracht: het vervallen "Felicity" (100232fr) verdrong het actuele
    // "Felicity Mighty Wave", waardoor een bestaande kleur onvindbaar leek.
    if (Number(p.StatusId) === VERVALLEN) continue;
    const spaGroep = SPA_GROEPEN.has(Number(p.ProductGroupId1));
    if (!model && spaGroep && /\b(swimspa|spa)\b[^|]*\|/i.test(naam)
        && !/cover|filter|kussen|hoes|trap|onderhoud|prijskaart|cabinet|jet\b/i.test(naam)) {
      model = naam.split("|")[0].replace(/\bswimspa\b/ig, " ").replace(/\bspa\b/ig, " ")
                  .replace(/\s+/g, " ").trim() || null;
    }
    // Ice baths heten anders: "Passion Ice Baths | Breeze Ice Bath | Sterling
    // White with Oak". Daar staat geen "spa |" in, dus ze vielen buiten de
    // catalogus — en dan lijkt het alsof ze niet in Logic4 bestaan. Chantal wees
    // er terecht op dat de Breeze er gewoon in staat (31 jul). Het model is hier
    // het tweede deel van de naam.
    if (!model && spaGroep && /ice baths? \|/i.test(naam)
        && !/cover|filter|kussen|hoes|trap|onderhoud|prijskaart|cabinet|jet\b/i.test(naam)) {
      const delen = naam.split("|").map(s => s.trim());
      if (delen.length >= 3 && delen[1]) model = delen[1].replace(/\s+/g, " ").trim();
    }
    if (!model) continue;
    // ECO is een ánder model dan de gewone uitvoering (Chantal) — apart houden.
    // Bij een handmatig gekoppelde code niet: die staat al onder de naam die
    // de prijslijst gebruikt, en daar hoort geen achtervoegsel bij.
    if (!handmatigeCodes.has(code) && /\bECO\b/i.test(naam) && !/ECO/i.test(model)) model += " ECO";
    found++;
    (catalog[model] = catalog[model] || []).push({
      code,
      productId: p.Id || p.ProductId || null,
      desc: naam,
    });
  }
  process.stderr.write(`\r  ${scanned} producten gescand, ${found} spa-varianten gevonden`);
  if (prods.length < 500) break;
}
console.error();

/* Van elke samengestelde variant ophalen wát erin zit. Het portaal laat dat
   zien ("includes: 2x step, 1x chiller"), zodat een partner weet wat hij
   bestelt, en de worker hoeft er bij het bestellen niets mee te doen: Logic4
   klapt de samenstelling zelf uit zodra de orderregel wordt aangemaakt. */
let samengesteld = 0;
for (const [model, vs] of Object.entries(catalog)) {
  for (const v of vs) {
    const p = alleProducten.get(v.code);
    if (!p || !p.IsComposedProduct) continue;
    v.samengesteld = true;
    const r = await fetch("https://api.logic4server.nl/v3/Products/GetComposedProductComposition", {
      method: "POST",
      headers: { Authorization: "Bearer " + t.access_token, "Content-Type": "application/json" },
      body: JSON.stringify(p.ProductId ?? p.Id),
    });
    if (!r.ok) continue;
    const delen = await r.json().catch(() => []);
    v.bevat = (Array.isArray(delen) ? delen : []).map(d => ({
      code: String(d.ProductCode || ""), qty: Number(d.Qty) || 1,
      naam: (alleProducten.get(String(d.ProductCode)) || {}).ProductName1 || "",
    }));
    samengesteld++;
  }
}

const models = Object.keys(catalog).sort();
console.log(models.length + " modellen, " + found + " varianten met Logic4-product, " +
            samengesteld + " daarvan samengesteld");

if (process.argv.includes("--dry")) {
  console.log("voorbeeld Soulmate:", JSON.stringify((catalog["Soulmate"] || []).slice(0, 4), null, 1));
  process.exit(0);
}

const teamKey = readTeamKey();
const put = await fetch("https://fonteyn-data-store.g-mulder.workers.dev/data/spa-catalog", {
  method: "PUT",
  headers: { "X-Fonteyn-Auth": teamKey, "Content-Type": "application/json" },
  body: JSON.stringify({ updated: new Date().toISOString(), models: catalog }),
});
console.log(put.ok ? "✓ spa-catalog opgeslagen in KV" : "✗ opslaan faalde: HTTP " + put.status);
