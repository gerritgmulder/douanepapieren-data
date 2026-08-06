// Wat doet de opschoningsregel van de accountant met 1630 en 1350?
//
// Tjitse van Rossum (Just Audit, 6 aug 2026): alle posten ouder dan Q2 2025
// verdwijnen van het saldo-overzicht per 31-12-2025, want die hebben dertien
// maanden de tijd gehad om af te letteren. Voor 1350 dezelfde systematiek.
//
// Dit script boekt niets. Het rekent alleen uit wat die regel raakt, zodat de
// gevolgen zichtbaar zijn voordat iemand iets vastlegt.
//
// WAAROM DIT IN TWEE HELFTEN WORDT GETOOND
// Een grootboek als 1630 bestaat uit twee soorten regels: boekingen die aan
// een inkooplevering hangen (de "lijst" waar de accountant het over heeft) en
// boekingen zonder leveringnummer, dus handmatige correcties en
// jaarafsluitingen. Die tweede groep staat niet op die lijst maar zit wél in
// het saldo. Schoon je alleen de lijst op, dan blijft de andere helft staan en
// komt de rekening op een stand uit die niets meer betekent. Daarom toont dit
// script per rekening beide kanten en het verschil tussen eenzijdig en
// tweezijdig opschonen.
//
// LET OP BIJ HET LEZEN VAN OUDERE UITDRAAIEN
// De eerste versies van dit script gaven een verkeerde verdeling, omdat de
// herkenning van leveringnummers de afkorting IKL miste en de orderherkenning
// de betaalregels ("Online betaling 3454477"). Op 1630 ging dat om 3,88
// miljoen, op 1350 om 2,5 miljoen. Het sáldo klopte in beide gevallen, wat het
// verraderlijk maakte: alles telde netjes op naar het goede eindbedrag, alleen
// stond het in de verkeerde kolom. Uitdraaien van vóór 6 aug 2026 zijn dus
// onbruikbaar, ook al zien ze er sluitend uit.
//
// Gebruik: node tools/kevin-opschoning-impact.mjs [--peil 2025-06-30] [--csv map]

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
const PEIL = args.peil || "2025-06-30";        // t/m deze datum = "oud"
const TOT = "2025-12-31T23:59:59";             // balansdatum

const body = new URLSearchParams();
body.set("client_id", `${l4enc(grab("PUBLICKEY"))} ${l4enc(grab("COMPANYKEY"))} ${l4enc(env.LOGIC4_USERNAME)}`);
body.set("client_secret", `${l4enc(grab("SECRETKEY"))} ${l4enc(env.LOGIC4_PASSWORD)}`);
body.set("scope", `api administration.${l4enc(grab("ADMINISTRATION") || "1")}`);
body.set("grant_type", "client_credentials");
const token = (await (await fetch("https://idp.logic4server.nl/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).json()).access_token;

// Zelfde herkenning als grootboek.js in de app, zodat de cijfers niet uiteen lopen.
function leveringUit(oms) {
    let s = String(oms || "");
    let m = s.match(/\(levering:\s*(\d+)\s*\)/i);
    if (m) return m[1];
    m = s.match(/inkooplevering\s+(\d+)\s*$/i);
    if (m) return m[1];
    // IKL is de afkorting die de administratie gebruikt voor inkooplevering.
    // Die stond hier niet in, en dat kostte 3,88 miljoen aan verkeerde
    // indeling: "Corr. IKL 14830" (517 regels, 2,52 mln) en "correctie
    // boeking artikel 78775 ikl 20711" (1,32 mln) werden geteld als
    // handmatige correctie zonder herkomst, terwijl ze gewoon naar een
    // inkooplevering verwijzen. Het saldo van 1630 bleef daardoor kloppen,
    // maar de verdeling tussen "openstaande posten" en "correcties" niet -
    // en juist die verdeling bepaalt wat er opgeschoond mag worden.
    m = s.match(/\bikl[.\s:#]*(\d{3,9})/i);
    if (m) return m[1];
    // Leveranciers schrijven het leveringnummer op alle mogelijke manieren:
    // "Lev.nr: 49509", "LEV: 50471", "Levering nr: 48985", en zelfs zonder
    // scheidingsteken als "levering47732".
    m = s.match(/\blev(?:ering)?\.?\s*(?:nr)?[.\s:#]*(\d{4,9})/i);
    if (m) return m[1];
    m = s.match(/levering[:#\s]+(\d{4,9})/i);
    return m ? m[1] : null;
  }
function orderUit(oms) {
    let s = String(oms || "");
    let m = s.match(/\border\s*[:#]?\s*(\d{6,8})/i);
    if (m) return m[1];
    // De betaalregels noemen het ordernummer zónder het woord "order":
    // "Online betaling 3454477 (2522354478X36069)", "Shopify betaling 3485998".
    // Die vielen allemaal buiten de herkenning, en dat waren er nogal wat: van
    // de 2.409 regels zonder nummer bleven er na deze regel 121 over, en de
    // verdeling tussen openstaande posten en correcties schoof 2,5 miljoen op.
    //
    // Let op de uitzondering voor facturen. "Betaling factuur 6437205" en
    // "Betaling voor factuur 6444194" noemen een factuurnummer, geen order.
    // Die twee door elkaar halen zou betalingen aan de verkeerde post hangen,
    // en dan klopt er per saldo niets meer van de aansluiting.
    // Het streepje in "Betaling voor  - 3447863" hoort er ook doorheen te
    // kunnen; "factuur" mag er niet tussen staan, want dan is het geen order.
    m = s.match(/\bbetaling\s+(?:voor\s+)?[-\s]*(\d{6,8})\b/i);
    return m ? m[1] : null;
  }

const PER = 5000;
async function analyseer(code, sleutelUit) {
  const groepen = new Map();
  const correcties = [];
  for (let p = 0; p < 400; p++) {
    const r = await fetch("https://api.logic4server.nl/v3/Financial/GetFinancialJournals", {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ LedgerCode: code, DateTimeTo: TOT, TakeRecords: PER, SkipRecords: p * PER }),
    });
    if (!r.ok) throw new Error(`ledger ${code} HTTP ${r.status}`);
    const j = await r.json();
    const lijst = Array.isArray(j) ? j : (j.Records || []);
    if (!lijst.length) break;
    for (const row of lijst) {
      const bedrag = (Number(row.AmountDebit) || 0) - (Number(row.AmountCredit) || 0);
      const datum = String(row.DateTime || "").slice(0, 10);
      const nr = sleutelUit(row.Description);
      if (!nr) { correcties.push({ datum, bedrag, oms: String(row.Description || "").slice(0, 100) }); continue; }
      let g = groepen.get(nr);
      if (!g) groepen.set(nr, g = { nr, som: 0, aantal: 0, eerste: datum, laatste: datum });
      g.som += bedrag; g.aantal++;
      if (datum < g.eerste) g.eerste = datum;
      if (datum > g.laatste) g.laatste = datum;
    }
    process.stderr.write(`\r  ${code}: ${(p + 1) * PER} regels…`);
    if (lijst.length < PER) break;
  }
  process.stderr.write("\r".padEnd(34) + "\r");
  const open = [...groepen.values()].filter(g => Math.abs(g.som) > 0.005);
  return { open, correcties };
}

const eur = n => n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const perJaarVan = rijen => {
  const y = {};
  for (const r of rijen) { const j = (r.eerste || r.datum).slice(0, 4); (y[j] = y[j] || { n: 0, b: 0 }); y[j].n++; y[j].b += (r.som != null ? r.som : r.bedrag); }
  return y;
};

for (const [code, naam, sleutelUit] of [
  [1630, "Te ontvangen facturen", leveringUit],
  [1350, "Vooruit ontvangen bedragen", orderUit],
]) {
  const { open, correcties } = await analyseer(code, sleutelUit);

  // "Oud" = laatste boeking op of vóór de peildatum. Het gaat de accountant om
  // posten waar sindsdien niets meer mee is gebeurd, niet om wanneer ze
  // ontstonden - een post die in november nog beweging had is niet vergeten.
  const oudOpen = open.filter(g => g.laatste <= PEIL);
  const nieuwOpen = open.filter(g => g.laatste > PEIL);
  const oudeCorr = correcties.filter(c => c.datum <= PEIL);
  const nieuweCorr = correcties.filter(c => c.datum > PEIL);

  const som = a => a.reduce((t, x) => t + (x.som != null ? x.som : x.bedrag), 0);
  const saldo = som(open) + som(correcties);

  console.log(`\n\n${"=".repeat(78)}`);
  console.log(`GROOTBOEK ${code} - ${naam}`);
  console.log(`saldo per 31-12-2025: ${eur(saldo)}   |   peildatum opschoning: ${PEIL}`);
  console.log("=".repeat(78));
  console.log(`\n${"".padEnd(46)}${"aantal".padStart(9)}${"bedrag".padStart(18)}`);
  console.log(`Openstaande posten t/m peildatum (de "lijst")`.padEnd(46) + String(oudOpen.length).padStart(9) + eur(som(oudOpen)).padStart(18));
  console.log("Openstaande posten na peildatum".padEnd(46) + String(nieuwOpen.length).padStart(9) + eur(som(nieuwOpen)).padStart(18));
  console.log("Correcties zonder nummer t/m peildatum".padEnd(46) + String(oudeCorr.length).padStart(9) + eur(som(oudeCorr)).padStart(18));
  console.log("Correcties zonder nummer na peildatum".padEnd(46) + String(nieuweCorr.length).padStart(9) + eur(som(nieuweCorr)).padStart(18));
  console.log("".padEnd(73, "-"));
  console.log("saldo".padEnd(46) + "".padStart(9) + eur(saldo).padStart(18));

  const eenzijdig = saldo - som(oudOpen);
  const tweezijdig = saldo - som(oudOpen) - som(oudeCorr);
  console.log(`\nWat de regel oplevert:`);
  console.log("  alleen de lijst opschonen  -> saldo wordt".padEnd(48) + eur(eenzijdig).padStart(18) +
    `   (resultaateffect ${eur(-som(oudOpen))})`);
  console.log("  beide kanten opschonen     -> saldo wordt".padEnd(48) + eur(tweezijdig).padStart(18) +
    `   (resultaateffect ${eur(-som(oudOpen) - som(oudeCorr))})`);
  console.log(`  verschil tussen die twee`.padEnd(48) + eur(Math.abs(som(oudeCorr))).padStart(18) + "   <- dit blijft anders zonder tegenhanger staan");

  console.log(`\nOpschoonbare posten per boekjaar van de eerste boeking:`);
  const oj = perJaarVan(oudOpen), cj = perJaarVan(oudeCorr);
  const jaren = [...new Set([...Object.keys(oj), ...Object.keys(cj)])].sort();
  console.log("  jaar   posten        bedrag lijst   correcties        bedrag correcties");
  for (const j of jaren) {
    const o = oj[j] || { n: 0, b: 0 }, c = cj[j] || { n: 0, b: 0 };
    console.log("  " + j.padEnd(7) + String(o.n).padStart(6) + eur(o.b).padStart(18) + String(c.n).padStart(13) + eur(c.b).padStart(25));
  }

  if (args.csv) {
    const pad = join(args.csv, `${code} opschoning per post (peil ${PEIL}).csv`);
    const uit = ["nummer;eerste boeking;laatste boeking;boekingen;saldo;valt onder opschoning"];
    for (const g of open.sort((a, b) => a.laatste.localeCompare(b.laatste)))
      uit.push([g.nr, g.eerste, g.laatste, g.aantal, g.som.toFixed(2).replace(".", ","), g.laatste <= PEIL ? "JA" : "nee"].join(";"));
    writeFileSync(pad, "﻿" + uit.join("\n"), "utf8");
    console.log(`\n  CSV: ${pad}`);
  }
}
