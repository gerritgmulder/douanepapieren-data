// Waar bestaan de afboekingen op de voorraad uit?
//
// De geld-goederenbeweging over 2025 laat 40,3 miljoen aan afboekingen op de
// voorraadrekeningen zien, tegenover 17,4 miljoen kostprijs omzet. Kevin krijgt
// dat verschil van bijna 23 miljoen sowieso als eerste vraag terug, dus dit
// splitst die afboekingen uit.
//
// LET OP - waarom dit naar sóórt boeking splitst en niet naar tegenrekening:
// in dit Logic4-journaal is BookingId niet uniek per transactie maar per
// dagboek (een regel uit 2014 en een uit 2025 dragen allebei nummer 1), en
// GetFinancialBookingsWithMutations levert crediteurenmatching, geen
// grootboekregels. De tegenboeking is via de API dus niet te vinden. De
// omschrijving zegt wél wat er gebeurde ("Verkoop 1 stuks 100519 fact. 6568414"
// tegenover "Voorraad correctie -1 stuks lijst 12445 product 100634"), en dat
// is voor deze vraag het antwoord: welk deel is verkoop en welk deel niet.
//
// Gebruik: node tools/kevin-voorraad-afboekingen.mjs [--jaar 2025] [--csv pad.csv]

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
const JAAR = String(args.jaar || "2025");
const TOT = `${JAAR}-12-31T23:59:59`;

const body = new URLSearchParams();
body.set("client_id", `${l4enc(grab("PUBLICKEY"))} ${l4enc(grab("COMPANYKEY"))} ${l4enc(env.LOGIC4_USERNAME)}`);
body.set("client_secret", `${l4enc(grab("SECRETKEY"))} ${l4enc(env.LOGIC4_PASSWORD)}`);
body.set("scope", `api administration.${l4enc(grab("ADMINISTRATION") || "1")}`);
body.set("grant_type", "client_credentials");
const tr = await fetch("https://idp.logic4server.nl/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
const token = (await tr.json()).access_token;

const lr = await fetch("https://api.logic4server.nl/v3/Financial/GetLedgers", { headers: { Authorization: "Bearer " + token } });
const lj = await lr.json();
const voorraad = (Array.isArray(lj) ? lj : (lj.Records || []))
  .map(l => ({ code: Number(l.Code || l.LedgerCode), naam: String(l.Description || l.Name || "") }))
  .filter(l => isFinite(l.code) && (l.code === 3000 || (l.code >= 7000 && l.code <= 7999)));

// Volgorde telt: de eerste die past wint.
const SOORTEN = [
  { id: "Verkoop (hoort tegenover kostprijs omzet)", re: /^verkoop\b/i },
  { id: "Voorraad correctie (telling/lijst)",        re: /voorraad\s*correctie/i },
  { id: "Handmatige voorraadmutatie",                re: /handmatige\s+voorraad/i },
  { id: "Inkooplevering (retour of correctie)",      re: /inkooplevering/i },
  { id: "Dealermagazijn / monteur / klant",          re: /dealermagazijn|monteur/i },
  { id: "Voorraadaansluiting balans",                re: /voorraadaansluiting|aansluiting voorraad|terugdraaien/i },
  { id: "Herwaardering artikelwaarde",               re: /verandering waarde voorraad|herwaard/i },
  { id: "Retour",                                    re: /retour/i },
];
const soortVan = oms => (SOORTEN.find(s => s.re.test(String(oms || ""))) || { id: "Overig" }).id;

const per = {}, perRekening = {}, voorbeelden = {};
let totaal = 0, regels = 0;
const PER = 5000;
for (const l of voorraad) {
  process.stderr.write(`\r  ${l.code} ${l.naam.slice(0, 28)}…`.padEnd(56));
  for (let p = 0; p < 400; p++) {
    const r = await fetch("https://api.logic4server.nl/v3/Financial/GetFinancialJournals", {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ LedgerCode: l.code, DateTimeTo: TOT, TakeRecords: PER, SkipRecords: p * PER }),
    });
    if (!r.ok) throw new Error(`ledger ${l.code} HTTP ${r.status}`);
    const j = await r.json();
    const lijst = Array.isArray(j) ? j : (j.Records || []);
    if (!lijst.length) break;
    for (const row of lijst) {
      if (String(row.DateTime || "").slice(0, 4) !== JAAR) continue;
      const c = Number(row.AmountCredit) || 0;
      if (c <= 0) continue;
      const s = soortVan(row.Description);
      (per[s] = per[s] || { n: 0, b: 0 }).n++; per[s].b += c;
      (perRekening[l.code] = perRekening[l.code] || { naam: l.naam, soorten: {} });
      (perRekening[l.code].soorten[s] = perRekening[l.code].soorten[s] || 0);
      perRekening[l.code].soorten[s] += c;
      if (!voorbeelden[s]) voorbeelden[s] = String(row.Description || "").slice(0, 72);
      totaal += c; regels++;
    }
    if (lijst.length < PER) break;
  }
}
process.stderr.write("\r".padEnd(56) + "\r");

const eur = n => n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
console.log(`\nAFBOEKINGEN OP DE VOORRAAD ${JAAR} - waar bestaan ze uit`);
console.log(`${regels.toLocaleString("nl-NL")} creditregels op ${voorraad.length} voorraadrekeningen\n`);
console.log("soort".padEnd(44) + "regels".padStart(9) + "bedrag".padStart(18) + "  aandeel");
console.log("".padEnd(82, "-"));
const gesorteerd = Object.entries(per).sort((a, b) => b[1].b - a[1].b);
for (const [s, v] of gesorteerd)
  console.log(s.slice(0, 43).padEnd(44) + String(v.n).padStart(9) + eur(v.b).padStart(18) +
    ("  " + (v.b / totaal * 100).toFixed(1) + "%").padStart(9));
console.log("".padEnd(82, "-"));
console.log("totaal".padEnd(44) + String(regels).padStart(9) + eur(totaal).padStart(18));

const verkoop = (per["Verkoop (hoort tegenover kostprijs omzet)"] || { b: 0 }).b;
console.log(`\nWél verkoop:  ${eur(verkoop).padStart(16)}`);
console.log(`Geen verkoop: ${eur(totaal - verkoop).padStart(16)}   <- dit is wat niet op de kostprijs omzet aansluit`);
console.log("\nvoorbeeldomschrijving per soort:");
for (const [s] of gesorteerd) console.log("  " + s.slice(0, 42).padEnd(44) + voorbeelden[s]);

if (args.csv) {
  const uit = ["rekening;omschrijving rekening;soort;bedrag"];
  for (const [code, r] of Object.entries(perRekening))
    for (const [s, b] of Object.entries(r.soorten))
      uit.push([code, '"' + r.naam + '"', '"' + s + '"', b.toFixed(2).replace(".", ",")].join(";"));
  writeFileSync(args.csv, "﻿" + uit.join("\n"), "utf8");
  console.log(`\nCSV: ${args.csv}`);
}
