// De grote losse afboekingen op de voorraad van dichtbij.
//
// Uit de uitsplitsing naar soort bleven een paar categorieën over die veel geld
// op weinig regels zijn, en die zijn met de hand gemaakt: de dealermagazijn-
// correcties, de voorraadaansluitingen en een enkele boeking met de
// omschrijving "VJP 34". Bij een controle zijn dat precies de posten waar naar
// gevraagd wordt, dus die horen per stuk verklaard te zijn.
//
// Dit script haalt elke afzonderlijke regel op met datum, rekening, bedrag,
// wie hem boekte en de volledige omschrijving. Waar mogelijk zoekt het er ook
// de tegenhanger bij: een debetboeking op een andere voorraadrekening op
// dezelfde dag met hetzelfde bedrag. Dat is geen bewijs van een tegenboeking -
// de API geeft die niet - maar het laat wel zien of een afboeking ergens
// anders weer opduikt, en dat scheelt zoeken.
//
// Gebruik: node tools/kevin-grote-posten.mjs [--jaar 2025] [--drempel 50000]

import { readFileSync, existsSync } from "node:fs";
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
const DREMPEL = Number(args.drempel || 50000);

const body = new URLSearchParams();
body.set("client_id", `${l4enc(grab("PUBLICKEY"))} ${l4enc(grab("COMPANYKEY"))} ${l4enc(env.LOGIC4_USERNAME)}`);
body.set("client_secret", `${l4enc(grab("SECRETKEY"))} ${l4enc(env.LOGIC4_PASSWORD)}`);
body.set("scope", `api administration.${l4enc(grab("ADMINISTRATION") || "1")}`);
body.set("grant_type", "client_credentials");
const token = (await (await fetch("https://idp.logic4server.nl/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).json()).access_token;

const users = Object.fromEntries(
  (await (await fetch("https://api.logic4server.nl/v3/User/GetAllUsers",
    { headers: { Authorization: "Bearer " + token } })).json())
    .map(u => [u.UserId, u.FullName || u.Username]));

const lj = await (await fetch("https://api.logic4server.nl/v3/Financial/GetLedgers",
  { headers: { Authorization: "Bearer " + token } })).json();
const voorraad = (Array.isArray(lj) ? lj : (lj.Records || []))
  .map(l => ({ code: Number(l.Code || l.LedgerCode), naam: String(l.Description || l.Name || "") }))
  .filter(l => isFinite(l.code) && (l.code === 3000 || (l.code >= 7000 && l.code <= 7999)));
const naamVan = Object.fromEntries(voorraad.map(l => [l.code, l.naam]));

// Alle regels van het boekjaar in het geheugen: 32 rekeningen is behapbaar en
// we hebben zowel de credit- als de debetkant nodig om tegenhangers te zoeken.
const alles = [];
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
      alles.push({
        code: l.code, datum: String(row.DateTime).slice(0, 10),
        debet: Number(row.AmountDebit) || 0, credit: Number(row.AmountCredit) || 0,
        oms: String(row.Description || ""), user: row.UserId,
      });
    }
    if (lijst.length < PER) break;
  }
}
process.stderr.write("\r".padEnd(56) + "\r");

const eur = n => n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rond = n => Math.round(n * 100) / 100;

// Index op datum+bedrag om een mogelijke tegenhanger te vinden.
const debetIndex = new Map();
for (const r of alles) if (r.debet > 0) {
  const k = r.datum + "|" + rond(r.debet).toFixed(2);
  (debetIndex.get(k) || debetIndex.set(k, []).get(k)).push(r);
}

const GROEPEN = [
  { titel: 'Boekingen met de omschrijving "VJP"', re: /^vjp\b/i },
  { titel: "Dealermagazijn / leverancier monteur en klant", re: /dealermagazijn|monteur/i },
  { titel: "Voorraadaansluiting balans", re: /voorraadaansluiting|aansluiting voorraad|terugdraaien/i },
];
const gedekt = /^verkoop\b|voorraad\s*correctie|handmatige\s+voorraad|inkooplevering|verandering waarde voorraad|herwaard|retour/i;

for (const g of GROEPEN) {
  const rijen = alles.filter(r => r.credit > 0 && g.re.test(r.oms)).sort((a, b) => b.credit - a.credit);
  const som = rijen.reduce((t, r) => t + r.credit, 0);
  console.log(`\n\n${g.titel.toUpperCase()}`);
  console.log(`${rijen.length} regels, samen ${eur(som)}\n`);
  for (const r of rijen) {
    const tegen = debetIndex.get(r.datum + "|" + rond(r.credit).toFixed(2)) || [];
    console.log(`${r.datum}  ${String(r.code).padEnd(5)} ${eur(r.credit).padStart(14)}  ${(users[r.user] || ("user " + r.user)).padEnd(22)}`);
    console.log(`            ${naamVan[r.code]}`);
    console.log(`            ${r.oms.slice(0, 150)}`);
    if (tegen.length) console.log(`            tegenhanger zelfde dag/bedrag: ${tegen.map(t => t.code + " (" + naamVan[t.code] + ")").join(", ")}`);
    else console.log(`            geen debetboeking van hetzelfde bedrag op dezelfde dag op een voorraadrekening`);
    console.log();
  }
}

// Wat valt er buiten alle bekende soorten, en is het groot?
const rest = alles.filter(r => r.credit > 0 && !gedekt.test(r.oms) && !GROEPEN.some(g => g.re.test(r.oms)));
const restSom = rest.reduce((t, r) => t + r.credit, 0);
console.log(`\n\nOVERIGE NIET-INGEDEELDE AFBOEKINGEN`);
console.log(`${rest.length} regels, samen ${eur(restSom)}. Hieronder alles boven ${eur(DREMPEL)}:\n`);
for (const r of rest.filter(x => x.credit >= DREMPEL).sort((a, b) => b.credit - a.credit)) {
  console.log(`${r.datum}  ${String(r.code).padEnd(5)} ${eur(r.credit).padStart(14)}  ${(users[r.user] || ("user " + r.user)).padEnd(22)}  ${r.oms.slice(0, 90)}`);
}
const kleinSom = rest.filter(x => x.credit < DREMPEL).reduce((t, r) => t + r.credit, 0);
console.log(`\nrest onder de drempel: ${rest.filter(x => x.credit < DREMPEL).length} regels, samen ${eur(kleinSom)}`);

// Groeperen op de kern van de omschrijving, zodat een terugkerend patroon opvalt.
const kern = {};
for (const r of rest) {
  const k = r.oms.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 60) || "(lege omschrijving)";
  (kern[k] = kern[k] || { n: 0, b: 0 }).n++; kern[k].b += r.credit;
}
console.log(`\nnaar patroon:`);
for (const [k, v] of Object.entries(kern).sort((a, b) => b[1].b - a[1].b).slice(0, 12))
  console.log(`  ${String(v.n).padStart(5)}  ${eur(v.b).padStart(14)}   ${k}`);
