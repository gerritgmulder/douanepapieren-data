#!/usr/bin/env node
/* Bouwt de onderdelen- en coverslijst voor Passion Partners.
 *
 * Bron is de Excel "Partner Price List.xlsx" van Gretha: één tabblad per
 * categorie (Covers, Jets, Pumps, ...), daarin kopregels zonder artikelcode en
 * daaronder de artikelen. Sommige artikelen staan er meerdere keren in met een
 * ander aantal: dat is een staffelprijs (1 stuk 140, vanaf 50 stuks 130).
 *
 * De prijzen komen NIET in de repo. Die is openbaar, en een complete
 * partnerprijslijst hoort daar niet in. Alles gaat rechtstreeks naar de
 * KV-bucket 'dealer-parts'. Die naam is met opzet: buckets die met 'dealer-'
 * beginnen vragen de bedrijfs-beheersleutel en niet de teamsleutel die op elke
 * werkplek staat. De worker geeft de lijst alleen aan ingelogde partners.
 *
 * Draaien:  node tools/build-partner-parts.mjs ["/pad/naar/Partner Price List.xlsx"] [--dry]
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { adminKey } from "./keys.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const BASE = "https://fonteyn-data-store.g-mulder.workers.dev";
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const bestand = args.find(a => !a.startsWith("--")) || join(homedir(), "Downloads", "Partner Price List.xlsx");

// ── Logic4-login (zelfde weg als de andere tools) ────────────────────
const ROOT = join(new URL(".", import.meta.url).pathname, "..");
const env = Object.fromEntries(readFileSync(join(ROOT, "server/.env"), "utf8").trim().split("\n").map(l => l.split("=")));
const src = readFileSync(join(ROOT, "main.js"), "utf8");
const g = n => src.match(new RegExp('LOGIC4_' + n + '\\s*=\\s*"([^"]+)"'))[1];
const enc = s => String(s).replace(/_/g, "__").replace(/ /g, "_");
const tokenBody = new URLSearchParams();
tokenBody.set("client_id", enc(g("PUBLICKEY")) + " " + enc(g("COMPANYKEY")) + " " + enc(env.LOGIC4_USERNAME));
tokenBody.set("client_secret", enc(g("SECRETKEY")) + " " + enc(env.LOGIC4_PASSWORD));
tokenBody.set("scope", "api administration.1");
tokenBody.set("grant_type", "client_credentials");

/* Verschrijvingen in de Excel, met de code die Logic4 wél kent.
   ═══════════════════════════════════════════════════════════════════════
   Elke code uit de prijslijst is naast de artikelnaam van Logic4 gelegd. Zes
   klopten niet, en twee daarvan waren gevaarlijk: de code bestond wél, maar
   hoorde bij een heel ander artikel. Wie "Click Trim, Oak" bestelde kreeg een
   45-gradenbocht, en wie een "Skimmer Ring Mystic Mountain" bestelde kreeg een
   skimmermandje. Dat valt niet op in een orderregel - de omschrijving die de
   partner ziet is die van de prijslijst, en de code eronder is een andere.

   De vier Cabinet-codes staan er allemaal 200 naast (152559 hoort 152359 te
   zijn); dat is één keer verkeerd overgetypt en daarna doorgekopieerd.

   Deze tabel wordt gecontroleerd toegepast: klopt de naam bij de nieuwe code
   niet meer met de Excel, dan slaat de tool alarm in plaats van hem stil te
   vervangen. */
const CODE_CORRECTIE = {
  "152559": "152359",   // Exchangeable Slat, Light grey
  "152560": "152360",   // Exchangeable Slat, Oak
  "152561": "152361",   // Click Trim, Light Grey
  "152562": "152362",   // Click Trim, Oak — 152562 is in Logic4 een 45° Ell
  "152044": "152342",   // Skimmer Ring S 4CH-949, Mystic Mountain — 152044 is een Skimmer Basket
  "163061": "152370",   // Heat Pump Control Board
};

/* Woorden vergelijken om te zien of een code bij de omschrijving hoort. Merk
   en leestekens tellen niet mee; het gaat om de artikelwoorden zelf. */
function kernwoorden(s) {
  return String(s || "").toLowerCase()
    .replace(/passion|fonteyn|spas?\b/g, " ").replace(/[^a-z0-9]+/g, " ")
    .trim().split(/\s+/).filter(w => w.length > 2);
}
function naamOverlap(excel, logic4) {
  const B = new Set(kernwoorden(logic4));
  const A = kernwoorden(excel);
  if (!A.length) return 1;
  return A.filter(w => B.has(w)).length / A.length;
}

/* Artikelcodes staan in de Excel soms als getal ("152009.0") en soms als tekst
   ("151920"). Logic4 kent alleen de tekstvorm zonder decimalen. Codes met een
   achtervoegsel ("151537-one-piece") blijven zoals ze zijn. */
function normCode(v) {
  if (v == null) return "";
  let s = String(v).trim();
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  return s;
}
const num = v => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

// ── De Excel uitlezen ────────────────────────────────────────────────
const wb = XLSX.readFile(bestand);
const perSleutel = new Map();     // categorie|code|omschrijving -> artikel
const categorieen = [];
let rijen = 0;

for (const tab of wb.SheetNames) {
  const blad = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: null });
  let sectie = "";
  let gevonden = 0;
  for (const rij of blad) {
    const code = normCode(rij[0]);
    const oms = rij[1] == null ? "" : String(rij[1]).trim();
    if (!oms) continue;
    if (oms.toLowerCase() === "descripton" || oms.toLowerCase() === "description") continue;   // koprij
    // Regel zonder artikelcode is een tussenkopje ("Coverclips", "Rollcovers").
    if (!code) { sectie = oms; continue; }
    const partner = num(rij[4]);
    if (!(partner > 0)) continue;                       // zonder prijs valt er niets te bestellen
    const sleutel = tab + "|" + code + "|" + oms;
    let a = perSleutel.get(sleutel);
    if (!a) {
      a = { code, desc: oms, brand: rij[2] ? String(rij[2]).trim() : "",
            cat: tab, sect: sectie, staffel: [], advies: num(rij[5]) || null };
      perSleutel.set(sleutel, a);
      gevonden++;
    }
    a.staffel.push({ vanaf: Math.max(1, Math.round(num(rij[3])) || 1), eur: Math.round(partner * 100) / 100 });
    rijen++;
  }
  if (gevonden) categorieen.push(tab);
  process.stderr.write(`  ${tab}: ${gevonden} artikelen\n`);
}

const parts = [...perSleutel.values()];
for (const a of parts) a.staffel.sort((x, y) => x.vanaf - y.vanaf);
console.log(`\n${parts.length} artikelen uit ${categorieen.length} categorieën (${rijen} prijsregels)`);

// ── Naast Logic4 leggen: bestaat de code, en wat ligt er vrij? ───────
const t = await (await fetch("https://idp.logic4server.nl/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: tokenBody })).json();
const byCode = new Map();
for (let skip = 0; ; skip += 500) {
  const r = await fetch("https://api.logic4server.nl/v3/Products/GetProducts", {
    method: "POST",
    headers: { Authorization: "Bearer " + t.access_token, "Content-Type": "application/json" },
    body: JSON.stringify({ TakeRecords: 500, SkipRecords: skip }),
  });
  if (!r.ok) throw new Error("GetProducts HTTP " + r.status);
  const j = await r.json();
  const lijst = Array.isArray(j) ? j : (j.Records || j.Products || []);
  if (!lijst.length) break;
  for (const p of lijst) byCode.set(String(p.ProductCode), p);
  process.stderr.write(`\r  ${byCode.size} producten uit Logic4`);
}
process.stderr.write("\n");

const VERVALLEN = 10;

/* Eerst de bekende verschrijvingen rechtzetten, maar alleen als de nieuwe code
   in Logic4 ook echt bij deze omschrijving hoort. Zo kan deze tabel niet stil
   verouderen: verandert er iets in Logic4, dan zegt de tool het. */
let hersteld = 0;
for (const a of parts) {
  const nieuw = CODE_CORRECTIE[a.code];
  if (!nieuw) continue;
  const p = byCode.get(nieuw);
  if (!p) { console.warn("LET OP: correctie " + a.code + " -> " + nieuw + " bestaat niet in Logic4; ongewijzigd gelaten"); continue; }
  const score = naamOverlap(a.desc, p.ProductName1 || "");
  if (score < 0.8) {
    /* Deze regel gebruikt dezelfde code voor een ánder artikel, en dan hoort de
       correctie er niet bij. Dat is precies waarom de tabel gecontroleerd wordt
       toegepast: 152562 staat in de Excel twee keer - bij Cabinet als Click
       Trim (fout) en bij Plumbing als 45° Ell (goed). Alleen de eerste hoort
       omgezet te worden. */
    console.log("  overgeslagen: " + a.code + " blijft staan voor \"" + a.desc + "\" (die code klopt daar wél)");
    continue;
  }
  a.codeExcel = a.code;
  a.code = nieuw;
  hersteld++;
}
if (hersteld) console.log(hersteld + " verschreven artikelcodes rechtgezet");

let onbekend = 0, vervallen = 0;
const verkeerd = [];
for (const a of parts) {
  const p = byCode.get(a.code);
  if (!p) { a.logic4 = false; onbekend++; continue; }
  /* Hoort de code bij de omschrijving? Een vervallen artikel heeft in Logic4
     geen naam meer ("-"), dus dat controleren we niet. */
  if ((p.ProductName1 || "").trim() !== "-" && naamOverlap(a.desc, p.ProductName1 || "") < 0.34)
    verkeerd.push({ code: a.code, excel: a.desc, l4: p.ProductName1 });
  a.logic4 = true;
  a.vrij = Math.max(0, Number(p.FreeStock) || 0);
  a.btw = Number(p.VatPercent) || 21;
  if (Number(p.StatusId) === VERVALLEN) { a.vervallen = true; vervallen++; }
  // De naam van Logic4 is leidend als de Excel afgekapt is.
  if (p.ProductName1 && p.ProductName1.length > a.desc.length) a.descL4 = p.ProductName1;
}
console.log(`Logic4: ${parts.length - onbekend} gevonden, ${onbekend} onbekende codes, ${vervallen} vervallen`);
if (onbekend) {
  console.log("  onbekend (geen bestelknop in het portaal):");
  for (const a of parts.filter(a => !a.logic4)) console.log("    " + a.code + "  " + a.cat + "  " + a.desc);
}
if (verkeerd.length) {
  console.log("\n  LET OP - deze codes bestaan wél maar horen bij een ander artikel:");
  for (const v of verkeerd) console.log("    " + v.code + "  prijslijst: " + v.excel + "\n              Logic4:     " + v.l4);
}

// ── Wegschrijven ────────────────────────────────────────────────────
const uit = { updated: new Date().toISOString(), bron: bestand.split("/").pop(),
              categories: categorieen, parts };
if (dry) { console.log("\n--dry: niet weggeschreven"); process.exit(0); }
const put = await fetch(BASE + "/data/dealer-parts", {
  method: "PUT", headers: { "Content-Type": "application/json", "X-DP-Admin": adminKey() },
  body: JSON.stringify(uit),
});
console.log(put.ok ? "\ndealer-parts bijgewerkt" : "\nwegschrijven MISLUKT: HTTP " + put.status + " " + (await put.text()).slice(0, 200));
