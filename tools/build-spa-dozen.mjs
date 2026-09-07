#!/usr/bin/env node
/* Bouwt de bucket 'spa-dozen': per spa-model de doos zoals hij de container
 * in gaat, plus de doos van zijn (dubbelgevouwen) cover.
 *
 * Waarom dit bestand er is
 * ------------------------
 * Gerrit (7 sep 2026): "Dat kiezen voor een container moet in Passion Partners
 * staan. Dus in mijn basket wil ik de mogelijkheid om te kiezen voor CONTAINER.
 * Dan wil ik Container Laden eraan koppelen, zodat je direct kunt zien hoe de
 * door jou gekozen producten in een container gaan passen."
 *
 * Het partnerportaal kan die maten niet zelf ophalen. Het staat onder een
 * strak Content-Security-Policy (script-src 'unsafe-inline', verder niets),
 * dus spa-afmetingen.js meeladen kan niet, en de drie bronbestanden
 * (spa-fabrikanten.js, packaging-database.json, spec-database.json) zijn samen
 * 165 kB en horen bovendien niet bij een partner thuis: daar staan
 * inkoopprijzen en leveranciersnamen in.
 *
 * Daarom wordt de rekenkant hier één keer gedraaid, op precies dezelfde manier
 * als de tegel Container laden dat doet - via spa-afmetingen.js zelf, zodat de
 * vouwregel op één plek staat - en gaat alléén het resultaat naar KV: per
 * model zes getallen. Geen prijs, geen fabriek, geen leverancier.
 *
 * De vouwregel (Gerrit, 3 sep 2026): het eerste getal van een covermaat wordt
 * gevouwen. Een cover van 590 x 277 wordt 295 x 277, een van 200 x 100 wordt
 * 100 x 100. Die regel staat in spa-afmetingen.js in de functie vouw(), en
 * nergens anders - dit gereedschap neemt hem daar vandaan over.
 *
 * Draaien:  node tools/build-spa-dozen.mjs
 * Opnieuw draaien zodra een prijslijst of een specsheet een andere maat geeft,
 * of als Chantal in Container laden een maat met de hand overschrijft.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { teamKey as readTeamKey, adminKey as readAdminKey } from "./keys.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://fonteyn-data-store.g-mulder.workers.dev";
const teamKey = readTeamKey();
// dealer-prices begint met "dealer-": daar geldt de beheersleutel.
const adminKey = readAdminKey();

/* spa-afmetingen.js en spa-fabrikanten.js zijn browserbestanden: ze hangen
   zichzelf aan een global. Node heeft geen window, dus die maken we hier even,
   met de fetch erin die de twee json-bestanden en de handmatige maten levert.
   Zo draait exact dezelfde code als in de tegel - en niet een kopie ervan die
   later uit de pas gaat lopen. */
const window = { localStorage: { getItem: () => teamKey } };
globalThis.window = window;
globalThis.localStorage = window.localStorage;

const echteFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("/")) {
    const tekst = readFileSync(join(ROOT, u.slice(1)), "utf8");
    return { ok: true, json: async () => JSON.parse(tekst) };
  }
  return echteFetch(url, opts);
};

for (const bestand of ["spa-afmetingen.js", "spa-fabrikanten.js"]) {
  const code = readFileSync(join(ROOT, bestand), "utf8");
  new Function("window", "globalThis", "localStorage", "fetch", code)(
    window, globalThis, globalThis.localStorage, globalThis.fetch);
}

const A = window.fpAfmetingen;
const F = window.fpFabrikanten;
if (!A || !F) { console.error("spa-afmetingen.js of spa-fabrikanten.js laadde niet"); process.exit(1); }

await A.laad();

/* Dezelfde opbouw als bouwModellen() in container-laden.html: over de
   prijslijsten van de fabrieken heen, en per model de maat opvragen. Modellen
   zonder maat gaan er niet in - een doos zonder maat is geen doos. */
const dozen = {};
let zonder = 0;
for (const f of (F.lijst || [])) {
  for (const m of (f.modellen || [])) {
    if (!m.model) continue;
    const maat = A.maatVan(m.model, m.afmeting, m.code);
    if (!maat) { zonder++; continue; }
    const cover = A.coverVan(m.model, m.code, maat, f.fabriek);
    const rond = n => Math.round(Number(n) * 10) / 10;
    // Eerste vulling wint: staat een model bij twee fabrieken, dan houden we
    // de maat die er als eerste in stond, net als bouwIndex dat doet.
    if (dozen[m.model]) continue;
    dozen[m.model] = {
      spa: { l: rond(maat.l), b: rond(maat.b), h: rond(maat.h) },
      bron: maat.bron || null,
      cover: cover ? { l: rond(cover.l), b: rond(cover.b), h: rond(cover.h),
                       delen: Number(cover.delen) || 1 } : null,
    };
  }
}

/* Tweede ronde: de namen zoals ze op de partnerprijslijst staan.

   De eerste ronde loopt over de prijslijsten van de fabrieken, en die noemen
   een model soms net anders dan de Passion-prijslijst. Een Turbine heet daar
   "Turbine 8 Grand" en bij de fabriek "Turbine 8"; de Fitness en de Vitality
   staan er alleen bij de fabriek in. Zonder deze ronde bleef bij 31 van de 85
   verkoopbare modellen de doosmaat leeg, en dan kan de winkelwagen ze niet
   meenemen in de containerpassing.

   maatVan() kent zelf de verpakkingslijst en de specsheets en normaliseert de
   naam (hoofdletters, streepjes, merk ervoor). Hem hier nog een keer vragen
   met alléén de naam pakt dus precies die gevallen op. Wat de eerste ronde al
   heeft, blijft staan: die maat komt van de fabriek zelf. */
const prijsR = await echteFetch(BASE + "/data/dealer-prices", { headers: { "X-DP-Admin": adminKey } });
if (prijsR.ok) {
  const prijzen = ((await prijsR.json()) || {}).prices || {};
  let erbij = 0;
  for (const naam of Object.keys(prijzen)) {
    if (dozen[naam]) continue;
    const maat = A.maatVan(naam, null, null);
    if (!maat) continue;
    const cover = A.coverVan(naam, null, maat, "");
    const rond = n => Math.round(Number(n) * 10) / 10;
    dozen[naam] = {
      spa: { l: rond(maat.l), b: rond(maat.b), h: rond(maat.h) },
      bron: maat.bron || null,
      cover: cover ? { l: rond(cover.l), b: rond(cover.b), h: rond(cover.h),
                       delen: Number(cover.delen) || 1 } : null,
    };
    erbij++;
  }
  console.log(erbij + " modellen er via de partnerprijslijst bij gevonden");
  const rest = Object.keys(prijzen).filter(n => !dozen[n]);
  if (rest.length) console.log("nog zonder maat (" + rest.length + "): " + rest.join(", "));
} else {
  console.log("partnerprijslijst niet op te halen (HTTP " + prijsR.status + ") - tweede ronde overgeslagen");
}

const aantal = Object.keys(dozen).length;
console.log(aantal + " modellen met een doosmaat, " + zonder + " zonder");
const metCover = Object.values(dozen).filter(d => d.cover).length;
console.log(metCover + " daarvan hebben een cover");
for (const naam of Object.keys(dozen).slice(0, 5)) {
  const d = dozen[naam];
  console.log("   " + naam + ": spa " + d.spa.l + "x" + d.spa.b + "x" + d.spa.h +
    (d.cover ? ", cover " + d.cover.l + "x" + d.cover.b + "x" + d.cover.h +
      (d.cover.delen > 1 ? " (" + d.cover.delen + " delen)" : "") : ", geen cover"));
}

const r = await echteFetch(BASE + "/data/spa-dozen", {
  method: "PUT",
  headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": teamKey },
  body: JSON.stringify({ updated: new Date().toISOString(), dozen }),
});
if (!r.ok) { console.error("opslaan faalde: HTTP " + r.status + " " + (await r.text()).slice(0, 200)); process.exit(1); }
console.log("doosmaten opgeslagen in bucket spa-dozen");
