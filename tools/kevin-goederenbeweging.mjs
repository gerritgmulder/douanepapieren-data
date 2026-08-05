// Kevin (De Jong & Laan, 5 aug 2026): "Had jij daarnaast nog de mogelijkheid
// om een geld-goederenbeweging op te stellen, inclusief een aansluiting op de
// voorraadwaarde per 31 december 2025?"
//
// Wat dit doet: per voorraadrekening de beginstand per 1-1-2025, de bij- en
// afboekingen in 2025 en de eindstand per 31-12-2025, met daarnaast de
// kostprijs omzet over 2025. Dat laatste is de tegenhanger van de afboekingen:
// gaan goederen de deur uit, dan hoort de voorraad af te nemen en de kostprijs
// toe te nemen. Loopt dat uiteen, dan zit daar de verklaring van de
// voorraadontwikkeling die hij zoekt.
//
// Alles komt uit het grootboek zelf (GetFinancialJournals), niet uit een
// export. Zo is elk bedrag herleidbaar tot de boekingen eronder en kan het
// dossier als controleonderbouwing mee.
//
// Gebruik: node tools/kevin-goederenbeweging.mjs [--jaar 2025] [--csv pad.csv]

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
// Zelfde afkap als de 1630-aansluiting: zonder tijd vallen de boekingen van
// 31 december zelf weg.
const TOT = `${JAAR}-12-31T23:59:59`;

const body = new URLSearchParams();
body.set("client_id", `${l4enc(grab("PUBLICKEY"))} ${l4enc(grab("COMPANYKEY"))} ${l4enc(env.LOGIC4_USERNAME)}`);
body.set("client_secret", `${l4enc(grab("SECRETKEY"))} ${l4enc(env.LOGIC4_PASSWORD)}`);
body.set("scope", `api administration.${l4enc(grab("ADMINISTRATION") || "1")}`);
body.set("grant_type", "client_credentials");
const tr = await fetch("https://idp.logic4server.nl/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
if (!tr.ok) throw new Error("Logic4-login faalde: HTTP " + tr.status);
const token = (await tr.json()).access_token;

const lr = await fetch("https://api.logic4server.nl/v3/Financial/GetLedgers", {
  headers: { Authorization: "Bearer " + token } });   // GetLedgers is GET-only
if (!lr.ok) throw new Error("GetLedgers HTTP " + lr.status);
const lj = await lr.json();
const alle = (Array.isArray(lj) ? lj : (lj.Records || [])).map(l => ({
  code: Number(l.Code || l.LedgerCode), naam: String(l.Description || l.Name || "") }))
  .filter(l => isFinite(l.code));

// Voorraad = de balansrekeningen waar goederen op staan. 3000 hoort erbij, net
// als de 7000-reeks. De werkrekeningen 5910/5920/5930 (her-, af- en bijboeken)
// zijn resultaat en horen NIET in de voorraadstand, maar wel in de verklaring
// van het verloop - die staan daarom apart.
const isVoorraad = l => l.code === 3000 || (l.code >= 7000 && l.code <= 7999);
const isKostprijs = l => l.code >= 8000 && l.code < 8500 && /kostprijs/i.test(l.naam);
const isMutatie = l => [5910, 5920, 5930].includes(l.code);

const PER = 5000;
async function leesLedger(code) {
  const uit = { begin: 0, debet: 0, credit: 0, regels: 0 };
  for (let p = 0; p < 400; p++) {
    const r = await fetch("https://api.logic4server.nl/v3/Financial/GetFinancialJournals", {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ LedgerCode: code, DateTimeTo: TOT, TakeRecords: PER, SkipRecords: p * PER }),
    });
    if (!r.ok) throw new Error(`GetFinancialJournals ${code} HTTP ${r.status}`);
    const j = await r.json();
    const lijst = Array.isArray(j) ? j : (j.Records || []);
    if (!lijst.length) break;
    for (const row of lijst) {
      const d = Number(row.AmountDebit) || 0, c = Number(row.AmountCredit) || 0;
      const jaar = String(row.DateTime || "").slice(0, 4);
      uit.regels++;
      if (jaar < JAAR) uit.begin += d - c;          // alles vóór dit boekjaar = beginstand
      else { uit.debet += d; uit.credit += c; }
    }
    if (lijst.length < PER) break;
  }
  uit.eind = uit.begin + uit.debet - uit.credit;
  return uit;
}

const eur = n => n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const groepen = [
  { titel: "VOORRAAD (balans)", rekeningen: alle.filter(isVoorraad) },
  { titel: "KOSTPRIJS OMZET (resultaat)", rekeningen: alle.filter(isKostprijs) },
  { titel: "VOORRAADMUTATIES (resultaat)", rekeningen: alle.filter(isMutatie) },
];

const csv = ["groep;rekening;omschrijving;beginstand;bij;af;eindstand"];
const totalen = {};
for (const g of groepen) {
  console.log(`\n${g.titel}`);
  console.log("rek   omschrijving".padEnd(42) + "beginstand".padStart(16) + "bij".padStart(16) + "af".padStart(16) + "eindstand".padStart(16));
  console.log("".padEnd(106, "-"));
  const t = { begin: 0, debet: 0, credit: 0, eind: 0 };
  for (const l of g.rekeningen) {
    process.stderr.write(`\r  ${l.code} ${l.naam.slice(0, 30)}…`.padEnd(60));
    const v = await leesLedger(l.code);
    if (!v.regels) continue;
    t.begin += v.begin; t.debet += v.debet; t.credit += v.credit; t.eind += v.eind;
    console.log((String(l.code) + "  " + l.naam).slice(0, 40).padEnd(42) +
      eur(v.begin).padStart(16) + eur(v.debet).padStart(16) + eur(v.credit).padStart(16) + eur(v.eind).padStart(16));
    csv.push([g.titel, l.code, '"' + l.naam + '"', v.begin.toFixed(2).replace(".", ","),
      v.debet.toFixed(2).replace(".", ","), v.credit.toFixed(2).replace(".", ","),
      v.eind.toFixed(2).replace(".", ",")].join(";"));
  }
  process.stderr.write("\r".padEnd(60) + "\r");
  console.log("".padEnd(106, "-"));
  console.log("totaal".padEnd(42) + eur(t.begin).padStart(16) + eur(t.debet).padStart(16) + eur(t.credit).padStart(16) + eur(t.eind).padStart(16));
  totalen[g.titel] = t;
}

const V = totalen["VOORRAAD (balans)"];
const K = totalen["KOSTPRIJS OMZET (resultaat)"];
const M = totalen["VOORRAADMUTATIES (resultaat)"];
console.log(`\n\nGELD-GOEDERENBEWEGING ${JAAR}`);
console.log("".padEnd(64, "="));
console.log("Voorraad per 1-1-".padEnd(44) + JAAR + eur(V.begin).padStart(16));
console.log("Bij: inkopen en overige bijboekingen".padEnd(48) + eur(V.debet).padStart(16));
console.log("Af:  uitleveringen en overige afboekingen".padEnd(48) + "-" + eur(V.credit).padStart(15));
console.log("".padEnd(64, "-"));
console.log(`Voorraad per 31-12-${JAAR}`.padEnd(48) + eur(V.eind).padStart(16));
console.log("".padEnd(64, "="));
console.log("\nAansluiting op het resultaat:");
console.log("Afboekingen voorraad".padEnd(48) + eur(V.credit).padStart(16));
console.log("Kostprijs omzet".padEnd(48) + eur(K.debet - K.credit).padStart(16));
const gat = V.credit - (K.debet - K.credit);
console.log("".padEnd(64, "-"));
console.log("Verschil".padEnd(48) + eur(gat).padStart(16));
console.log("\nHerwaardering, af- en bijboeken voorraad (5910/5920/5930):".padEnd(48) + eur(M.debet - M.credit).padStart(16));
console.log("Verschil na die mutaties".padEnd(48) + eur(gat - (M.debet - M.credit)).padStart(16));

if (args.csv) { writeFileSync(args.csv, "﻿" + csv.join("\n"), "utf8"); console.log(`\nCSV: ${args.csv}`); }
