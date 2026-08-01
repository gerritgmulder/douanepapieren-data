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
const SPA_GROEPEN = new Set([
  39,   // Spa's
  92,   // Zwemspa's
  72,   // Spa's Gebruikt
  73,   // Spa's Gebruikt Garantie
  87,   // Spa's Samengesteld
  89,   // Ice Baths
  90,   // Ice Baths Samengesteld
]);
const catalog = {};   // model → [{code, productId, desc}]
let found = 0, scanned = 0;
for (let page = 0; page < 200; page++) {
  const prods = await getPage(page * 500);
  if (!prods.length) break;
  scanned += prods.length;
  for (const p of prods) {
    const code = String(p.ProductCode || "");
    const naam = p.ProductName1 || p.Description || "";
    let model = wanted.has(code) ? byCode[code] : null;
    // De handmatige SPA_BY_CODE-lijst liep achter op Logic4: 286 spa-artikelen
    // ontbraken erin, waaronder hele modellen (Dynamic, Fitness, Activity) en
    // de Sydney. Daardoor vond de proforma-koppeling geen artikelcode terwijl
    // het artikel gewoon bestond. Staat een artikel niet in de lijst, dan
    // leiden we het model af uit de productnaam van Logic4 zelf.
    // "swimspa |" eiste dat het woord pál voor het streepje stond. Bij
    // "Aquatic 1 Swimspa ECO | Sterling White…" staat ECO ertussen, waardoor
    // alle ECO-uitvoeringen buiten de catalogus vielen. Nu mag er tekst tussen
    // staan (Chantal wees op hetzelfde soort gat bij de ice baths, 31 jul).
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
    if (/\bECO\b/i.test(naam) && !/ECO/i.test(model)) model += " ECO";
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
const models = Object.keys(catalog).sort();
console.log(models.length + " modellen, " + found + " varianten met Logic4-product");

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
