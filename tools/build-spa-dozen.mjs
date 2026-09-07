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
      /* Het gewicht van de kist, als de verpakkingslijst dat weet. Nodig voor
         de vrachtprijs: een vervoerder rekent over de laadmeters tenzij het
         werkelijke gewicht hoger uitvalt (1 laadmeter = 1.750 kg). Zonder
         gewicht wordt er alleen op laadmeters gerekend, en dan kan de prijs
         te laag uitkomen bij een zware spa. */
      kg: maat.kg > 0 ? Math.round(Number(maat.kg)) : null,
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
      kg: maat.kg > 0 ? Math.round(Number(maat.kg)) : null,
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

/* Derde ronde: gewichten uit de douane-specs.

   De verpakkingslijst kent maar van vier modellen het kistgewicht. De
   douanetegel houdt per artikelcode een bruto- en nettogewicht bij (voor de
   commercial invoice) en die zijn wél ingevuld: 137 artikelen. Via de
   spa-catalogus hoort bij elk model een handvol kleurvarianten met hun
   artikelcode, en daar hangt het gewicht aan.

   Let op waar dit wél en niet voor telt. Voor de vrachtprijs maakt het niets
   uit: elke tariefband is precies 1750 kg per laadmeter, en het zwaarste dat
   we kennen haalt 500 kg per laadmeter (29% daarvan). Een spa is een holle
   kuip; die wordt nooit op gewicht afgerekend. Het gewicht staat er dus voor
   de volledigheid en voor wie het voor iets anders nodig heeft, niet omdat de
   prijs erop wacht. */
const getal = (n) => Number(String(n == null ? "" : n).replace(",", ".")) || 0;
try {
  const [specR, catR] = await Promise.all([
    echteFetch(BASE + "/data/douane-specs", { headers: { "X-Fonteyn-Auth": teamKey } }),
    echteFetch(BASE + "/data/spa-catalog", { headers: { "X-Fonteyn-Auth": teamKey } }),
  ]);
  const spec = specR.ok ? await specR.json() : {};
  const cat = catR.ok ? ((await catR.json()) || {}).models || {} : {};
  let erbij = 0;
  for (const model of Object.keys(dozen)) {
    if (getal(dozen[model].kg) > 0) continue;
    const gewichten = [...new Set((cat[model] || []).map(v => getal(spec[v.code] && spec[v.code].gw)).filter(g => g > 0))];
    if (!gewichten.length) continue;
    // Twee varianten van hetzelfde model kunnen verschillen (de Activity 2
    // staat op 1500 en 1600); dan het zwaarste, want te licht rekenen kost geld.
    dozen[model].kg = Math.round(Math.max(...gewichten));
    dozen[model].bronKg = "douane-specs";
    erbij++;
  }
  console.log(erbij + " modellen kregen een gewicht uit de douane-specs");

  /* En andersom: modellen waar we helemáál geen maat van hebben. Die vallen nu
     uit de vrachtberekening, en dan ziet de dealer een prijs waar zijn spa
     niet in zit. De douanetegel geeft de kist zoals die is aangegeven ("708 x
     227 x 155 CM"), dus die maat kunnen we gebruiken. Zo komen de Vitality
     Deep, de Xtreme Green-warmtepomp en Wim Hof's Ice Barrel XL er alsnog in. */
  let maten = 0;
  for (const model of Object.keys(cat)) {
    if (dozen[model]) continue;
    for (const v of (cat[model] || [])) {
      const d = String((spec[v.code] || {}).dims || "").match(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/i);
      if (!d) continue;
      const l = getal(d[1]), b = getal(d[2]), h = getal(d[3]);
      // Alleen de lege plaatshouders van 1x1x1 cm weren; een warmtepomp van
      // 100 x 50 cm is een echte maat.
      if (!(l >= 20 && b >= 20)) continue;
      const gw = getal((spec[v.code] || {}).gw);
      dozen[model] = { spa: { l, b, h }, kg: gw > 0 ? Math.round(gw) : null,
                       bron: "douane-specs", bronKg: gw > 0 ? "douane-specs" : null, cover: null };
      maten++;
      break;
    }
  }
  if (maten) console.log(maten + " modellen kregen hun kistmaat uit de douane-specs");
} catch (e) {
  console.log("douane-specs niet op te halen (" + e.message + ") - gewichten overgeslagen");
}

const aantal = Object.keys(dozen).length;
console.log(aantal + " modellen met een doosmaat, " + zonder + " zonder");
console.log(Object.values(dozen).filter(d => getal(d.kg) > 0).length + " daarvan hebben een gewicht");
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
