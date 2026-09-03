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
let onbekend = 0, vervallen = 0;
for (const a of parts) {
  const p = byCode.get(a.code);
  if (!p) { a.logic4 = false; onbekend++; continue; }
  a.logic4 = true;
  a.vrij = Math.max(0, Number(p.FreeStock) || 0);
  a.btw = Number(p.VatPercent) || 21;
  if (Number(p.StatusId) === VERVALLEN) { a.vervallen = true; vervallen++; }
  // De naam van Logic4 is leidend als de Excel afgekapt is.
  if (p.ProductName1 && p.ProductName1.length > a.desc.length) a.descL4 = p.ProductName1;
}
console.log(`Logic4: ${parts.length - onbekend} gevonden, ${onbekend} onbekende codes, ${vervallen} vervallen`);
if (onbekend) console.log("  onbekend: " + parts.filter(a => !a.logic4).map(a => a.code).slice(0, 25).join(", "));

// ── Wegschrijven ────────────────────────────────────────────────────
const uit = { updated: new Date().toISOString(), bron: bestand.split("/").pop(),
              categories: categorieen, parts };
if (dry) { console.log("\n--dry: niet weggeschreven"); process.exit(0); }
const put = await fetch(BASE + "/data/dealer-parts", {
  method: "PUT", headers: { "Content-Type": "application/json", "X-DP-Admin": adminKey() },
  body: JSON.stringify(uit),
});
console.log(put.ok ? "\ndealer-parts bijgewerkt" : "\nwegschrijven MISLUKT: HTTP " + put.status + " " + (await put.text()).slice(0, 200));
