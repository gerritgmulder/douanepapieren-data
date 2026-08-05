// Waar gaan de afboekingen op de voorraad naartoe? Nu écht naar tegenrekening.
//
// Eerdere aanname, die fout was: de Logic4-API zou geen tegenboeking geven,
// omdat BookingId niet uniek leek (een regel uit 2014 en een uit 2025 dragen
// allebei nummer 1). Dat klopt, maar BookingId is wél uniek binnen een datum.
// Alle regels van boeking 401 op 31-12-2025 samen sluiten tot op de cent op
// nul, over negen rekeningen. De tegenboeking is dus gewoon te vinden door
// dezelfde dag en hetzelfde boekingnummer op de andere rekeningen te zoeken.
//
// Werkwijze:
//   1. lees de voorraadrekeningen en onthoud welke (datum, boeking) een
//      afboeking bevatten
//   2. lees álle grootboekrekeningen van het jaar, maar bewaar alleen regels
//      die bij zo'n boeking horen
//   3. wijs per afboeking de tegenrekening toe
//
// Toewijzing gebeurt in twee stappen, en het verschil wordt gerapporteerd:
//   EXACT       - binnen de boeking staat precies één debetregel op een
//                 niet-voorraadrekening met hetzelfde bedrag. Dat is hem dan.
//   VERDEELD    - anders naar rato over de debetregels van die boeking. Bij
//                 een jaarafsluiting met 287 regels is dat een benadering, en
//                 dat hoort de lezer te weten.
//
// Gebruik: node tools/kevin-tegenrekeningen.mjs [--jaar 2025] [--csv pad.csv]

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
const VAN = `${JAAR}-01-01`, TOT = `${JAAR}-12-31T23:59:59`;

const body = new URLSearchParams();
body.set("client_id", `${l4enc(grab("PUBLICKEY"))} ${l4enc(grab("COMPANYKEY"))} ${l4enc(env.LOGIC4_USERNAME)}`);
body.set("client_secret", `${l4enc(grab("SECRETKEY"))} ${l4enc(env.LOGIC4_PASSWORD)}`);
body.set("scope", `api administration.${l4enc(grab("ADMINISTRATION") || "1")}`);
body.set("grant_type", "client_credentials");
const token = (await (await fetch("https://idp.logic4server.nl/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).json()).access_token;

const lj = await (await fetch("https://api.logic4server.nl/v3/Financial/GetLedgers",
  { headers: { Authorization: "Bearer " + token } })).json();
const ledgers = (Array.isArray(lj) ? lj : (lj.Records || []))
  .map(l => ({ code: Number(l.Code || l.LedgerCode), naam: String(l.Description || l.Name || "") }))
  .filter(l => isFinite(l.code));
const naamVan = Object.fromEntries(ledgers.map(l => [l.code, l.naam]));
const isVoorraad = c => c === 3000 || (c >= 7000 && c <= 7999);

const PER = 5000;
async function lees(code, perRij) {
  for (let p = 0; p < 400; p++) {
    const r = await fetch("https://api.logic4server.nl/v3/Financial/GetFinancialJournals", {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ LedgerCode: code, DateTimeFrom: VAN, DateTimeTo: TOT, TakeRecords: PER, SkipRecords: p * PER }),
    });
    if (!r.ok) throw new Error(`ledger ${code} HTTP ${r.status}`);
    const j = await r.json();
    const lijst = Array.isArray(j) ? j : (j.Records || []);
    if (!lijst.length) return;
    for (const row of lijst) perRij(row);
    if (lijst.length < PER) return;
  }
}

// ── 1. de afboekingen zelf ────────────────────────────────────────────────
const afboekingen = [];      // {code, datum, boeking, bedrag, oms}
const sleutels = new Set();
for (const l of ledgers.filter(l => isVoorraad(l.code))) {
  process.stderr.write(`\r  voorraad ${l.code}…`.padEnd(40));
  await lees(l.code, row => {
    const c = Number(row.AmountCredit) || 0;
    if (c <= 0) return;
    const datum = String(row.DateTime || "").slice(0, 10);
    const k = datum + "|" + row.BookingId;
    afboekingen.push({ code: l.code, datum, boeking: row.BookingId, bedrag: c, oms: String(row.Description || "").slice(0, 90), sleutel: k });
    sleutels.add(k);
  });
}
process.stderr.write(`\r  ${afboekingen.length} afboekingen in ${sleutels.size} boekingen`.padEnd(50) + "\n");

// ── 2. alle rekeningen, maar alleen de regels van díe boekingen ───────────
const perBoeking = new Map();   // sleutel -> {debet:[{code,bedrag}], credit:[...]}
let n = 0;
for (const l of ledgers) {
  process.stderr.write(`\r  scan ${++n}/${ledgers.length}`.padEnd(40));
  await lees(l.code, row => {
    const k = String(row.DateTime || "").slice(0, 10) + "|" + row.BookingId;
    if (!sleutels.has(k)) return;
    let b = perBoeking.get(k);
    if (!b) perBoeking.set(k, b = { debet: [], credit: [] });
    const d = Number(row.AmountDebit) || 0, c = Number(row.AmountCredit) || 0;
    if (d > 0) b.debet.push({ code: l.code, bedrag: d });
    if (c > 0) b.credit.push({ code: l.code, bedrag: c });
  });
}
process.stderr.write("\r".padEnd(40) + "\r");

// ── 3. toewijzen ──────────────────────────────────────────────────────────
const naar = {};       // tegenrekening -> {exact, verdeeld}
let exactSom = 0, verdeeldSom = 0, ongekoppeld = 0;
const rond = x => Math.round(x * 100) / 100;
for (const a of afboekingen) {
  const b = perBoeking.get(a.sleutel);
  const kandidaten = (b ? b.debet : []).filter(x => !isVoorraad(x.code));
  if (!kandidaten.length) { ongekoppeld += a.bedrag; continue; }
  const exact = kandidaten.filter(x => Math.abs(x.bedrag - a.bedrag) < 0.005);
  if (exact.length === 1) {
    const t = naar[exact[0].code] || (naar[exact[0].code] = { exact: 0, verdeeld: 0 });
    t.exact += a.bedrag; exactSom += a.bedrag;
  } else {
    const totaal = kandidaten.reduce((t, x) => t + x.bedrag, 0);
    for (const k of kandidaten) {
      const deel = a.bedrag * (k.bedrag / totaal);
      const t = naar[k.code] || (naar[k.code] = { exact: 0, verdeeld: 0 });
      t.verdeeld += deel;
    }
    verdeeldSom += a.bedrag;
  }
}

const eur = x => x.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const totaalAf = afboekingen.reduce((t, a) => t + a.bedrag, 0);
console.log(`\nAFBOEKINGEN OP DE VOORRAAD ${JAAR} NAAR TEGENREKENING`);
console.log(`${afboekingen.length.toLocaleString("nl-NL")} afboekingen, samen ${eur(totaalAf)}`);
console.log(`waarvan ${eur(exactSom)} exact toegewezen, ${eur(verdeeldSom)} naar rato verdeeld, ${eur(ongekoppeld)} zonder tegenregel\n`);
console.log("rek   omschrijving".padEnd(46) + "exact".padStart(17) + "naar rato".padStart(17) + "samen".padStart(17));
console.log("".padEnd(97, "-"));
const rijen = Object.entries(naar).map(([c, v]) => ({ code: Number(c), ...v, som: v.exact + v.verdeeld }))
  .sort((a, b) => b.som - a.som);
for (const r of rijen.filter(r => r.som >= 1000))
  console.log((String(r.code) + "  " + (naamVan[r.code] || "")).slice(0, 44).padEnd(46) +
    eur(r.exact).padStart(17) + eur(r.verdeeld).padStart(17) + eur(r.som).padStart(17));
const klein = rijen.filter(r => r.som < 1000).reduce((t, r) => t + r.som, 0);
console.log("".padEnd(97, "-"));
console.log(`overige rekeningen onder 1.000: ${rijen.filter(r => r.som < 1000).length}, samen ${eur(klein)}`);
console.log("totaal".padEnd(46) + eur(rijen.reduce((t, r) => t + r.som, 0)).padStart(51));

if (args.csv) {
  const uit = ["tegenrekening;omschrijving;exact toegewezen;naar rato verdeeld;samen"];
  for (const r of rijen) uit.push([r.code, '"' + (naamVan[r.code] || "") + '"',
    r.exact.toFixed(2).replace(".", ","), r.verdeeld.toFixed(2).replace(".", ","), r.som.toFixed(2).replace(".", ",")].join(";"));
  writeFileSync(args.csv, "﻿" + uit.join("\n"), "utf8");
  console.log(`\nCSV: ${args.csv}`);
}
