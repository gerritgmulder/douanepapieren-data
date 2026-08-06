// Debiteuren met een factuurdatum vóór 2025 die nog steeds openstaan.
//
// Tjitse van Rossum (Just Audit, 6 aug 2026): van het debiteurensaldo hoort
// 115,7k bij facturen van vóór 01-01-2025, "effectief 19 factuurregels".
// Voorstel: nagaan of die al betaald zijn, en zo niet, afboeken.
//
// Dit script boekt niets; het zoekt op wélke facturen dat zijn.
//
// EERSTE POGING WAS FOUT - waarom dit nu anders werkt
// Ik reconstrueerde dit eerst uit grootboek 1300, door per factuurnummer de
// boekingen op te tellen. Dat grootboek heeft ~2,7 miljoen regels en mijn
// paginalus stopte na 500 pagina's, dus na 2,5 miljoen. De ontbrekende staart
// bevatte juist de betalingen, waardoor élke oude factuur onbetaald leek en
// het saldo credit uitkwam in plaats van debet. Het ergste was dat het script
// gewoon een uitkomst gaf: een limiet die stilletjes afkapt is erger dan een
// foutmelding. Vandaar dat de lus hieronder hard stopt als hij de limiet
// raakt, en dat we sowieso de openstaande-postenlijst van Logic4 gebruiken -
// die is gezaghebbend, kost één aanroep en kan niet half zijn.
//
// LET OP BIJ DE UITKOMST: dit is de stand van vandaag, niet die per
// 31-12-2025. Voor de vraag "is deze factuur inmiddels betaald" is dat juist
// de goede peildatum, maar het is niet hetzelfde getal als op de balans.
//
// Gebruik: node tools/kevin-debiteuren-oud.mjs [--grens 2025-01-01] [--csv pad.csv]

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
const GRENS = args.grens || "2025-01-01";

const body = new URLSearchParams();
body.set("client_id", `${l4enc(grab("PUBLICKEY"))} ${l4enc(grab("COMPANYKEY"))} ${l4enc(env.LOGIC4_USERNAME)}`);
body.set("client_secret", `${l4enc(grab("SECRETKEY"))} ${l4enc(env.LOGIC4_PASSWORD)}`);
body.set("scope", `api administration.${l4enc(grab("ADMINISTRATION") || "1")}`);
body.set("grant_type", "client_credentials");
const token = (await (await fetch("https://idp.logic4server.nl/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).json()).access_token;

const call = async (pad, payload) => {
  const r = await fetch("https://api.logic4server.nl" + pad, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`${pad} HTTP ${r.status}`);
  return r.json();
};

const rf = await call("/v3/Orders/GetOpenPaymentInvoices", {});
const facturen = Array.isArray(rf) ? rf : (rf.Records || []);
if (!facturen.length) throw new Error("geen openstaande facturen terug - controleer de rechten");

// Debiteurnamen: bij een beoordeling per post wil je een naam zien, geen nummer.
const namen = {};
const MAX_PAGINAS = 400;
for (let p = 0; p < MAX_PAGINAS; p++) {
  let l;
  try {
    const r = await call("/v3/Debtors/GetDebtors", { TakeRecords: 500, SkipRecords: p * 500 });
    l = Array.isArray(r) ? r : (r.Records || []);
  } catch { break; }
  if (!l.length) break;
  for (const d of l) namen[d.Id ?? d.DebtorId] = d.CompanyName || d.Name || d.Description || "";
  if (l.length < 500) break;
  if (p === MAX_PAGINAS - 1) throw new Error("debiteurenlijst raakt de paginalimiet - verhoog MAX_PAGINAS");
}

const num = v => Number(v) || 0;
const oud = facturen
  .filter(f => String(f.InvoiceDate || "").slice(0, 10) < GRENS && num(f.AmountOutstanding) > 0)
  .sort((a, b) => num(b.AmountOutstanding) - num(a.AmountOutstanding));

const eur = n => n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const totOpen = facturen.reduce((t, f) => t + num(f.AmountOutstanding), 0);
const totOud = oud.reduce((t, f) => t + num(f.AmountOutstanding), 0);
const deelsBetaald = oud.filter(f => num(f.TotalAmountPayed) > 0);

console.log(`\nDEBITEUREN MET EEN FACTUUR VAN VÓÓR ${GRENS} DIE NOG OPENSTAAN`);
console.log(`stand van vandaag volgens Logic4, niet die per 31-12-2025\n`);
console.log(`openstaande facturen totaal            ${String(facturen.length).padStart(6)}   ${eur(totOpen).padStart(15)}`);
console.log(`waarvan factuurdatum vóór ${GRENS}   ${String(oud.length).padStart(6)}   ${eur(totOud).padStart(15)}`);
console.log(`daarvan al deels betaald               ${String(deelsBetaald.length).padStart(6)}   ${eur(deelsBetaald.reduce((t, f) => t + num(f.TotalAmountPayed), 0)).padStart(15)}\n`);

console.log("factuur     factuurdatum   dagen over   factuurbedrag      al betaald     openstaand   debiteur");
console.log("".padEnd(122, "-"));
for (const f of oud)
  console.log(String(f.InvoiceId).padEnd(12) +
    String(f.InvoiceDate || "").slice(0, 10).padEnd(15) +
    String(f.DaysPastDueDate ?? "").padStart(9) + "   " +
    eur(num(f.TotalAmount)).padStart(14) + eur(num(f.TotalAmountPayed)).padStart(16) + eur(num(f.AmountOutstanding)).padStart(15) +
    "   " + String(namen[f.DebtorId] || ("debiteur " + f.DebtorId)).slice(0, 32));
console.log("".padEnd(122, "-"));
console.log("totaal".padEnd(70) + eur(totOud).padStart(15));

const perJaar = {};
for (const f of oud) {
  const j = String(f.InvoiceDate || "").slice(0, 4);
  (perJaar[j] = perJaar[j] || { n: 0, b: 0 }); perJaar[j].n++; perJaar[j].b += num(f.AmountOutstanding);
}
console.log(`\nPer factuurjaar:`);
for (const j of Object.keys(perJaar).sort())
  console.log("  " + j + "   " + String(perJaar[j].n).padStart(4) + " facturen   " + eur(perJaar[j].b).padStart(14));

if (args.csv) {
  const uit = ["factuurnummer;factuurdatum;vervaldatum;dagen over vervaldatum;factuurbedrag;al betaald;openstaand;debiteurnummer;debiteur"];
  for (const f of oud) uit.push([f.InvoiceId, String(f.InvoiceDate || "").slice(0, 10), String(f.DueDate || "").slice(0, 10),
    f.DaysPastDueDate ?? "", num(f.TotalAmount).toFixed(2).replace(".", ","), num(f.TotalAmountPayed).toFixed(2).replace(".", ","),
    num(f.AmountOutstanding).toFixed(2).replace(".", ","), f.DebtorId, '"' + (namen[f.DebtorId] || "") + '"'].join(";"));
  writeFileSync(args.csv, "﻿" + uit.join("\n"), "utf8");
  console.log(`\nCSV: ${args.csv}`);
}
