/* Controleert dat de telefoon en de pc precies dezelfde rechten hanteren.
 *
 * De telefoon bouwt zijn tegels op uit tegels.js. De pc doet het nog met
 * vijfentwintig losse regels in dashboard.html. Zolang dat zo is, kan er een
 * verschil insluipen - en dat is precies wat niet mag: iemand die op de pc
 * een tegel niet ziet, hoort hem op zijn telefoon ook niet te zien.
 *
 * Dit script leest beide kanten uit en vergelijkt per tegel wie hem mag zien,
 * naam voor naam. Niet de groepsnaam maar de uitkomst, want twee groepen met
 * verschillende namen kunnen dezelfde mensen bevatten en andersom.
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

/* Kant van de pc: welke set hoort bij welke tegel.
   Eerst de naam-naar-groep-koppeling (const X_EMAILS = fpToegang.set("y")),
   dan per tegel welke set of welke directe mag()-aanroep gebruikt wordt. */
const setNaarGroep = new Map();
for (const m of dash.matchAll(/const\s+([A-Z_]+)\s*=\s*fpToegang\.set\("([a-z-]+)"\)/g)) {
  setNaarGroep.set(m[1], m[2]);
}
// Afgeleide vlaggen die dashboard.html zelf maakt.
for (const m of dash.matchAll(/const\s+(\w+)\s*=\s*([A-Z_]+)\.has\(lc\)/g)) {
  if (setNaarGroep.has(m[2])) setNaarGroep.set(m[1], setNaarGroep.get(m[2]));
}
for (const m of dash.matchAll(/const\s+(\w+)\s*=\s*fpToegang\.mag\("([a-z-]+)",\s*lc\)/g)) {
  setNaarGroep.set(m[1], m[2]);
}

// tile-id → bestand, uit de tegel-blokken zelf.
const tileNaarBestand = new Map();
for (const m of dash.matchAll(/<a\s+href="([^"]+)"[^>]*id="(tile[A-Za-z]+)"/g)) {
  tileNaarBestand.set(m[2], m[1]);
}

// tile-id → groep, uit de zichtbaarheidsregels.
let fouten = 0;
const pcTegels = new Map();
/* Tot de afsluitende ");" van de regel, niet tot het eerste haakje - anders
   valt ".has(lc)" halverwege af en herkent de controle bijna geen enkele
   tegel. Dat was hier eerst wel zo, en dan meldt dit script vrolijk dat alles
   klopt terwijl het nauwelijks iets heeft nagekeken. */
const onbekend = [];
for (const m of dash.matchAll(/el\("(tile[A-Za-z]+)"\)\.classList\.toggle\("hidden",\s*!(.+?)\);/g)) {
  const tile = m[1];
  const expr = m[2].trim();
  let groep = null;
  const viaSet = expr.match(/^([A-Z_]+)\.has\(lc\)$/);
  const viaMag = expr.match(/^fpToegang\.mag\("([a-z-]+)",\s*lc\)$/);
  const viaVlag = expr.match(/^(\w+)$/);
  if (viaSet) groep = setNaarGroep.get(viaSet[1]);
  else if (viaMag) groep = viaMag[1];
  else if (viaVlag) groep = setNaarGroep.get(viaVlag[1]);
  if (groep) pcTegels.set(tile, groep);
  else onbekend.push(`${tile}: ${expr}`);
}
if (onbekend.length) {
  console.log("Niet te herleiden zichtbaarheidsregels in dashboard.html:");
  for (const r of onbekend) console.log("           " + r);
  fouten += onbekend.length;
}

/* Iedereen die ergens in een groep voorkomt. Wie nergens in staat kan ook
   nergens verschil opleveren, dus die hoeft niet mee. */
const iedereen = new Set();
for (const groep of Object.keys(toegang.groepen)) {
  for (const wie of toegang.set(groep)) iedereen.add(wie);
}

let gecontroleerd = 0;

// Per tegel: dezelfde mensen op beide kanten?
for (const [tile, groepPc] of pcTegels) {
  const bestand = tileNaarBestand.get(tile);
  // Eerst op tile-id (nodig voor tegels met href="#", zoals Stuurcijfers),
  // anders op bestandsnaam.
  const mobiel =
    tegels.lijst.find((t) => t.tile === tile) ??
    (bestand && bestand !== "#" ? tegels.lijst.find((t) => t.bestand === bestand) : null);
  if (!mobiel) {
    console.log(`ONTBREEKT  ${bestand || tile} staat wel op de pc maar niet in tegels.js`);
    fouten++;
    continue;
  }
  gecontroleerd++;
  const verschil = [...iedereen].filter(
    (wie) => toegang.mag(groepPc, wie) !== toegang.mag(mobiel.groep, wie)
  );
  if (verschil.length) {
    console.log(`VERSCHIL   ${bestand}: pc gebruikt "${groepPc}", telefoon "${mobiel.groep}"`);
    console.log(`           anders voor: ${verschil.join(", ")}`);
    fouten++;
  }
}

// En andersom: staat er iets in tegels.js dat de pc niet kent?
for (const t of tegels.lijst) {
  if (t.extern) continue;
  if (t.tile && pcTegels.has(t.tile)) continue;
  if (![...tileNaarBestand.values()].includes(t.bestand)) {
    console.log(`ONBEKEND   ${t.bestand} staat in tegels.js maar nergens in dashboard.html`);
    fouten++;
  }
}

// Bestaat elke genoemde groep?
for (const t of tegels.lijst) {
  if (!toegang.groepen[t.groep]) {
    console.log(`GEEN GROEP ${t.bestand} verwijst naar "${t.groep}", die niet in toegang.js staat`);
    fouten++;
  }
}

console.log(
  fouten === 0
    ? `\nGoed: ${gecontroleerd} tegels, op de pc en op de telefoon precies dezelfde mensen (${iedereen.size} inlognamen nagelopen).`
    : `\n${fouten} verschil${fouten === 1 ? "" : "len"} gevonden.`
);
process.exit(fouten === 0 ? 0 : 1);
