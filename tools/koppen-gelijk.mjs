#!/usr/bin/env node
/* Controleert dat elke tegelpagina dezelfde kop krijgt: terug naar het
   dashboard, wie er is ingelogd, de taalknop en uitloggen.
   Draaien: node tools/koppen-gelijk.mjs   (afsluitcode 1 bij een gebrek)

   Aanleiding (Gerrit, 31 aug 2026): "elke tegel moet dezelfde header
   structuur hebben". Bij het nalopen bleken vier tegels geen logo te hebben,
   vijf geen uitlogknop en drie geen taalknop. De kop wordt nu door kop.js
   aangevuld; dit script bewaakt dat elke pagina dat bestand ook laadt en dat
   er een <header> is om in te vullen. */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const lees = (f) => readFileSync(join(ROOT, f), "utf8");

global.window = global;
new Function(lees("toegang.js"))();
new Function(lees("tegels.js"))();

/* Alleen de gewone tegelpagina's. De telefoonvarianten (mobielBestand) doen
   bewust niet mee: daar betekent de pijl linksboven "terug naar het vorige
   subscherm" en pas bovenin "terug naar het telefoondashboard", en een kop met
   e-mailadres, taalknop en uitlogknop erbij vreet op 375 pixels het halve
   scherm op. Die schermen hebben hun eigen, kortere kop. */
const paginas = window.fpTegels.lijst.filter((t) => !t.extern).map((t) => t.bestand);

let fouten = 0, gekeken = 0;
for (const p of [...new Set(paginas)]) {
  if (!existsSync(join(ROOT, p))) { console.log(`ONTBREEKT  ${p} staat in tegels.js maar het bestand is er niet`); fouten++; continue; }
  const s = lees(p);
  gekeken++;
  const gebrek = [];
  if (!/<header[\s>]/i.test(s)) gebrek.push("geen <header> om in te vullen");
  if (!s.includes('src="kop.js"')) gebrek.push("laadt kop.js niet");
  if (!s.includes('src="taal.js"')) gebrek.push("laadt taal.js niet (geen NL/EN)");
  if (!/href="dashboard\.html"/.test(s)) gebrek.push("geen weg terug naar het dashboard");
  if (gebrek.length) { console.log(`FOUT  ${p}\n        ${gebrek.join("\n        ")}`); fouten += gebrek.length; }
}

if (fouten) { console.log(`\n${fouten} gebrek(en) in ${gekeken} pagina's.`); process.exit(1); }
console.log(`Goed: ${gekeken} tegelpagina's hebben dezelfde kop (terug, ingelogd, NL/EN, uitloggen).`);
