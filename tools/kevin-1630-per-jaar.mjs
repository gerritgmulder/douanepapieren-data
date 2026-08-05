// Kevin (De Jong & Laan, 5 aug 2026): "De vraag is hoe deze posten zich
// verdelen over de verschillende boekjaren en in hoeverre deze verdeling de
// opgenomen balanspositie ondersteunt."
//
// Een openstaande post = een inkooplevering waarvan de boekingen op grootboek
// 1630 per einddatum niet tegen elkaar wegvallen. Het boekjaar van die post is
// het jaar van de EERSTE boeking - dat is het moment waarop de verplichting
// ontstond, en dat is wat Kevin nodig heeft om te beoordelen of een post nog
// in de balans per ultimo 2025 thuishoort.
//
// Boekingen zonder leveringnummer (handmatige correcties, jaarafsluitingen)
// zijn geen openstaande post en worden apart geteld - juist die bepalen of
// 1630 debet of credit staat.
//
// Gebruik: node tools/kevin-1630-per-jaar.mjs [--tot 2025-12-31] [--csv pad.csv]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function parseEnvFile(p) {
  const out = {};
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = { ...parseEnvFile(join(ROOT, "server/.env")), ...process.env };
const src = readFileSync(join(ROOT, "main.js"), "utf8");
const grab = n => (src.match(new RegExp(`LOGIC4_${n}\\s*=\\s*"([^"]+)"`)) || [])[1];
const l4enc = s => String(s).replace(/_/g, "__").replace(/ /g, "_");

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args[a.slice(2)] = (process.argv[i + 1] || "").startsWith("--") ? true : process.argv[++i];
}
// Let op de tijd: DateTimeTo="2025-12-31" laat de boekingen van 31 december
// zélf weg, want die dragen een tijdstip. Dat scheelde bij de eerste run 18
// regels en 73.442,69 euro. De tegel gebruikt dezelfde afkap, zodat dit
// script en het Dashboard nooit een ander saldo kunnen geven.
const TOT = args.tot || "2025-12-31T23:59:59";

const body = new URLSearchParams();
body.set("client_id", `${l4enc(grab("PUBLICKEY"))} ${l4enc(grab("COMPANYKEY"))} ${l4enc(env.LOGIC4_USERNAME)}`);
body.set("client_secret", `${l4enc(grab("SECRETKEY"))} ${l4enc(env.LOGIC4_PASSWORD)}`);
body.set("scope", `api administration.${l4enc(grab("ADMINISTRATION") || "1")}`);
body.set("grant_type", "client_credentials");
const tr = await fetch("https://idp.logic4server.nl/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
if (!tr.ok) throw new Error("Logic4-login faalde: HTTP " + tr.status);
const token = (await tr.json()).access_token;

// Zelfde uitlezing als grootboek.js in de app, zodat de cijfers hier en in het
// Dashboard niet uit elkaar kunnen lopen.
function leveringUit(oms) {
  const s = String(oms || "");
  let m = s.match(/\(levering:\s*(\d+)\s*\)/i);           if (m) return m[1];
  m = s.match(/inkooplevering\s+(\d+)\s*$/i);             if (m) return m[1];
  m = s.match(/levering[:#\s]+(\d{4,9})/i);               return m ? m[1] : null;
}

const PER = 5000;
const groepen = new Map();      // leveringnr -> {som, aantal, eerste, laatste, oms}
const zonder = { aantal: 0, som: 0, perJaar: {} };
let gelezen = 0;

for (let p = 0; p < 400; p++) {
  const r = await fetch("https://api.logic4server.nl/v3/Financial/GetFinancialJournals", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ LedgerCode: 1630, DateTimeTo: TOT, TakeRecords: PER, SkipRecords: p * PER }),
  });
  if (!r.ok) throw new Error("GetFinancialJournals HTTP " + r.status);
  const j = await r.json();
  const lijst = Array.isArray(j) ? j : (j.Records || []);
  if (!lijst.length) break;
  for (const row of lijst) {
    const bedrag = (Number(row.AmountDebit) || 0) - (Number(row.AmountCredit) || 0);
    const datum = String(row.DateTime || "").slice(0, 10);
    const jaar = datum.slice(0, 4);
    const nr = leveringUit(row.Description);
    if (!nr) {
      zonder.aantal++; zonder.som += bedrag;
      const z = zonder.perJaar[jaar] || (zonder.perJaar[jaar] = { n: 0, b: 0 });
      z.n++; z.b += bedrag;
      continue;
    }
    let g = groepen.get(nr);
    if (!g) groepen.set(nr, g = { nr, som: 0, aantal: 0, eerste: datum, laatste: datum, oms: String(row.Description || "").slice(0, 120) });
    g.som += bedrag; g.aantal++;
    if (datum < g.eerste) g.eerste = datum;
    if (datum > g.laatste) g.laatste = datum;
  }
  gelezen += lijst.length;
  process.stderr.write(`\r  ${gelezen.toLocaleString("nl-NL")} regels gelezen…`);
  if (lijst.length < PER) break;
}
process.stderr.write("\n");

const CENT = 0.005;
const open = [...groepen.values()].filter(g => Math.abs(g.som) > CENT);
const dicht = groepen.size - open.length;

// Kevin splitst zijn posten in "herleid in Logic4" en "niet teruggevonden" en
// wil die verdeling per boekjaar zien. Niet teruggevonden = het leveringnummer
// uit de boekingsomschrijving bestaat niet meer als inkooplevering. Zulke
// posten kunnen per definitie nooit meer aflopen, dus voor de vraag of ze in
// de balans thuishoren is dit de scherpste scheidslijn.
const leveringen = new Set();
for (let skip = 0; ; skip += 500) {
  const r = await fetch("https://api.logic4server.nl/v3/BuyOrderDeliveries/GetBuyOrderDeliveries", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ Take: 500, Skip: skip }),
  });
  if (!r.ok) throw new Error("GetBuyOrderDeliveries HTTP " + r.status);
  const j = await r.json();
  const lijst = Array.isArray(j) ? j : (j.Records || []);
  if (!lijst.length) break;
  for (const d of lijst) leveringen.add(String(d.BuyOrderDeliveryId));
  process.stderr.write(`\r  ${leveringen.size.toLocaleString("nl-NL")} inkoopleveringen gelezen…`);
  if (lijst.length < 500) break;
}
process.stderr.write("\n");
for (const g of open) g.herleid = leveringen.has(String(g.nr));

const perJaar = {};
for (const g of open) {
  const jaar = g.eerste.slice(0, 4);
  const y = perJaar[jaar] || (perJaar[jaar] = { posten: 0, regels: 0, bedrag: 0, debet: 0, credit: 0, kwijt: 0, kwijtBedrag: 0 });
  y.posten++; y.regels += g.aantal; y.bedrag += g.som;
  if (g.som > 0) y.debet += g.som; else y.credit += g.som;
  if (!g.herleid) { y.kwijt++; y.kwijtBedrag += g.som; }
}

const eur = n => n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
console.log(`\nGROOTBOEK 1630 - openstaande posten per boekjaar, per ${TOT}`);
console.log(`${gelezen.toLocaleString("nl-NL")} boekingsregels gelezen\n`);
console.log("jaar    posten   herleid    kwijt             saldo   waarvan kwijt");
console.log("".padEnd(74, "-"));
let tp = 0, tb = 0, tk = 0, tkb = 0;
for (const jaar of Object.keys(perJaar).sort()) {
  const y = perJaar[jaar];
  tp += y.posten; tb += y.bedrag; tk += y.kwijt; tkb += y.kwijtBedrag;
  console.log(jaar.padEnd(8) + String(y.posten).padStart(6) + String(y.posten - y.kwijt).padStart(10) +
    String(y.kwijt).padStart(9) + eur(y.bedrag).padStart(18) + eur(y.kwijtBedrag).padStart(16));
}
console.log("".padEnd(74, "-"));
console.log("totaal".padEnd(8) + String(tp).padStart(6) + String(tp - tk).padStart(10) + String(tk).padStart(9) +
  eur(tb).padStart(18) + eur(tkb).padStart(16));

const voor2025 = Object.keys(perJaar).filter(j => j < "2025").reduce((a, j) => a + perJaar[j].bedrag, 0);
const in2025 = (perJaar["2025"] || { bedrag: 0 }).bedrag;
const voor2025n = Object.keys(perJaar).filter(j => j < "2025").reduce((a, j) => a + perJaar[j].posten, 0);

console.log(`\nAfgeloten leveringen (saldo nul, dus geen balanspost): ${dicht.toLocaleString("nl-NL")}`);
console.log(`Openstaande posten:                                    ${tp.toLocaleString("nl-NL")}`);
console.log(`  waarvan eerste boeking vóór 2025:  ${String(voor2025n).padStart(6)}  ${eur(voor2025).padStart(16)}`);
console.log(`  waarvan eerste boeking in 2025:    ${String((perJaar["2025"] || { posten: 0 }).posten).padStart(6)}  ${eur(in2025).padStart(16)}`);
console.log(`\nBoekingen zonder leveringnummer (correcties, afsluitingen): ${zonder.aantal.toLocaleString("nl-NL")} regels, ${eur(zonder.som)}`);
console.log("  per jaar:");
for (const jaar of Object.keys(zonder.perJaar).sort()) {
  const z = zonder.perJaar[jaar];
  if (Math.abs(z.b) < 1) continue;
  console.log("    " + jaar + "  " + String(z.n).padStart(6) + " regels  " + eur(z.b).padStart(16));
}
console.log(`\nSaldo 1630 = openstaande posten ${eur(tb)} + boekingen zonder levering ${eur(zonder.som)} = ${eur(tb + zonder.som)}`);

if (args.csv) {
  const uit = ["boekjaar;leveringnr;in Logic4;regels;eerste boeking;laatste boeking;saldo;omschrijving"];
  for (const g of open.sort((a, b) => a.eerste.localeCompare(b.eerste) || Math.abs(b.som) - Math.abs(a.som)))
    uit.push([g.eerste.slice(0, 4), g.nr, g.herleid ? "ja" : "NEE", g.aantal, g.eerste, g.laatste,
      g.som.toFixed(2).replace(".", ","), '"' + g.oms.replace(/"/g, "'") + '"'].join(";"));
  writeFileSync(args.csv, "﻿" + uit.join("\n"), "utf8");
  console.log(`\nCSV weggeschreven: ${args.csv} (${open.length} posten)`);
}
