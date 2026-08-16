/* Controleert dat de tegellijst en de twee dashboards bij elkaar passen.
 *
 * Sinds 14 aug 2026 bouwen de pc en de telefoon hun tegels allebei uit
 * tegels.js, dus kunnen de rechten niet meer uit elkaar lopen - dat was de
 * hele reden voor dat bestand. Wat nog wél mis kan gaan is de aansluiting:
 * een tegel in de lijst waar geen blok in de HTML bij hoort (dan ziet niemand
 * hem), of een blok in de HTML dat niet in de lijst staat (dan staat hij bij
 * iedereen open, want er is niets dat hem verbergt). Dat laatste is het
 * gevaarlijke geval en precies wat hier wordt afgevangen.
 *
 *   node tools/tegels-gelijk.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hier = path.dirname(fileURLToPath(import.meta.url));
const wortel = path.join(hier, "..");
const lees = (f) => fs.readFileSync(path.join(wortel, f), "utf-8");

// toegang.js en tegels.js zijn geschreven voor een browser; ze hangen zich aan
// een global. Een leeg object volstaat als browser.
const nep = {};
new Function(lees("toegang.js")).call(nep);
new Function(lees("tegels.js")).call(nep);
const toegang = nep.fpToegang ?? globalThis.fpToegang;
const tegels = nep.fpTegels ?? globalThis.fpTegels;

const dash = lees("dashboard.html");
let fouten = 0;

// Alle tegel-blokken in de HTML, met hun id.
const inHtml = new Set();
for (const m of dash.matchAll(/id="(tile[A-Za-z]+)"/g)) inHtml.add(m[1]);

// 1. Staat elke tegel uit de lijst ook echt in de HTML?
for (const t of tegels.lijst) {
  if (!t.tile) {
    console.log(`GEEN ID    ${t.bestand} heeft geen tile in tegels.js`);
    fouten++;
  } else if (!inHtml.has(t.tile)) {
    console.log(`ONTBREEKT  ${t.tile} (${t.bestand}) staat in tegels.js maar niet in dashboard.html`);
    fouten++;
  }
}

// 2. En andersom - dit is het gevaarlijke geval. Een blok in de HTML dat niet
//    in de lijst staat, wordt door niemand verborgen en is dus voor iedereen
//    zichtbaar.
const inLijst = new Set(tegels.lijst.map((t) => t.tile));
for (const id of inHtml) {
  if (!inLijst.has(id)) {
    console.log(`ONBEWAAKT  ${id} staat in dashboard.html maar niet in tegels.js`);
    console.log(`           Niemand verbergt hem, dus iedereen ziet hem.`);
    fouten++;
  }
}

/* 3. Staat een groep twee keer in toegang.js? Dat is een stille val: in een
      object-literal wint de laatste sleutel, dus je kunt een naam bijschrijven
      in de bovenste en er verandert niets. Precies dat gebeurde op 14 aug 2026
      bij partnerportaal-kijk. */
const bron = lees("toegang.js");
const geteld = new Map();
for (const m of bron.matchAll(/^\s{4}"([a-z0-9-]+)":\s*\[/gm)) {
  geteld.set(m[1], (geteld.get(m[1]) ?? 0) + 1);
}
for (const [groep, aantal] of geteld) {
  if (aantal > 1) {
    console.log(`DUBBEL     "${groep}" staat ${aantal}x in toegang.js`);
    console.log(`           Alleen de laatste telt; namen in de eerste doen niets.`);
    fouten++;
  }
}

// 4. Verwijst elke tegel naar een groep die bestaat?
for (const t of tegels.lijst) {
  if (!toegang.groepen[t.groep]) {
    console.log(`GEEN GROEP ${t.bestand} verwijst naar "${t.groep}", die niet in toegang.js staat`);
    fouten++;
  }
}

// 5. Bouwen beide dashboards nog uit dezelfde lijst? Zodra een van de twee
//    weer eigen regels krijgt, is de garantie weg.
if (!/fpTegels\.voor\(/.test(dash)) {
  console.log("LOSGERAAKT dashboard.html bouwt zijn tegels niet meer uit tegels.js");
  fouten++;
}
if (!/fpTegels\.voor\(/.test(lees("mobiel.html"))) {
  console.log("LOSGERAAKT mobiel.html bouwt zijn tegels niet meer uit tegels.js");
  fouten++;
}

// Ter informatie: wie ziet wat. Handig om in één oogopslag te zien of een
// wijziging in de toegangslijsten doet wat je dacht.
if (!fouten) {
  const namen = ["fonteyn.dolf", "chantal", "fonteyn.don", "osman", "nomi", "reinier.k", "gretha"];
  console.log(`\nGoed: ${tegels.lijst.length} tegels, pc en telefoon bouwen uit dezelfde lijst.\n`);
  for (const wie of namen) {
    const l = tegels.voor(wie);
    console.log(`  ${wie.padEnd(14)} ${String(l.length).padStart(2)} tegels`);
  }
}

process.exit(fouten === 0 ? 0 : 1);
