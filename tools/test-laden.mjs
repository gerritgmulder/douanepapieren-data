#!/usr/bin/env node
/* Vaste controle: een verversing mag NOOIT het scherm leegmaken.
   Aanleiding (27 aug 2026): Chantal zag een leeg tabblad Gepland terwijl er
   88 vinkjes in de opslag stonden. Oorzaak was loadNotities(), die bij een
   antwoord zonder 'regels' terugviel op een lege lijst. Deze test speelt de
   drie manieren na waarop het ophalen mis kan gaan en eist dat de bestaande
   stand blijft staan. Draaien: node tools/test-laden.mjs   */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "voorraad.html"), "utf8");

function pak(naam) {
  const m = src.match(new RegExp("async function " + naam + "\\(\\)\\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error(naam + " niet gevonden in voorraad.html");
  return m[0];
}
const scenario = [
  ["leeg antwoord",  async () => ({ ok: true, json: async () => ({}) })],
  ["lege lijst",     async () => ({ ok: true, json: async () => ({ regels: {}, byModel: {} }) })],
  ["HTTP-fout",      async () => ({ ok: false, status: 500 })],
  ["netwerkfout",    async () => { throw new Error("offline"); }],
];
let fout = 0;
for (const [naam, nep] of scenario) {
  const omgeving = {
    NOTITIE_URL: "/n", RESV_URL: "/r", DATA_STORE_AUTH: "x",
    notities: { a: { gepland: true }, b: {} },
    resvData: { byModel: { Spa: [{}] }, byModelUSA: {} },
    notitiesVuil: new Set(), window: {}, console,
  };
  const code = pak("loadNotities") + "\n" + pak("loadReserveringen").split("await loadNotities")[0] + "}\n" +
    "return (async()=>{ await loadNotities(); await loadReserveringen(); " +
    "return [Object.keys(notities).length, Object.keys(resvData.byModel).length]; })();";
  const f = new Function(...Object.keys(omgeving), "fetch", code);
  const [aantekeningen, modellen] = await f(...Object.values(omgeving), nep);
  const goed = aantekeningen === 2 && modellen === 1;
  if (!goed) fout++;
  console.log((goed ? "  ok  " : "  FOUT") + "  na " + naam.padEnd(14) +
    " -> " + aantekeningen + " aantekeningen, " + modellen + " modellen (verwacht 2 en 1)");
}
if (fout) { console.error("\n" + fout + " scenario('s) maken het scherm leeg - NIET pushen."); process.exit(1); }
console.log("\nGoed: geen enkele mislukte verversing maakt het scherm leeg.");
