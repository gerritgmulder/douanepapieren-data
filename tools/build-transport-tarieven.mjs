#!/usr/bin/env node
/* Bouwt de bucket 'transport-tarieven' uit de twee prijslijsten van de
 * vervoerders.
 *
 * Waarom dit bestand er is
 * ------------------------
 * Gerrit (7 sep 2026): "Als een spa of sauna bij ons op voorraad komt dan kan
 * de dealer meteen kiezen of hij hem wil afhalen of laten bezorgen. Laten
 * bezorgen wordt dan direct op de beurs samen bekeken met de bijlagen in dit
 * bericht."
 *
 * Twee vervoerders:
 *   Van Heugten  - alle landen. Dit is wat de dealer betaalt, altijd.
 *   Van Doesburg - Duitsland en België. Wij rijden daar mét Doesburg omdat die
 *                  goedkoper is, maar rekenen de klant Van Heugten. Gerrit:
 *                  "zodat we op leveringen naar Duitsland en België ook nog
 *                  iets meer verdienen."
 * Doesburg staat er dus in om de marge te kunnen zien, niet om te tonen.
 *
 * Hoe de tarieven werken
 * ----------------------
 * Allebei rekenen ze op laadmeters, met een minimum per gewicht: 1 laadmeter
 * is 1.750 kg, een europallet 700 kg en een blokpallet 875 kg. Er wordt
 * afgerekend over de laadmeters tenzij het echte gewicht hoger uitvalt.
 *
 * Van Heugten: per land een tabblad, daarin postcode (eerste twee cijfers) →
 * zone, en per zone een kolom met een prijs per laadmeterband. Plus een
 * dieseltoeslag in procenten en een kooiaaptoeslag per land.
 *
 * Van Doesburg: één tabel voor de hele Benelux met vijf kolommen, gekozen op
 * het postcodegebied van het losadres. Kooiaap 75 euro per lossing.
 *
 * Draaien:
 *   node tools/build-transport-tarieven.mjs <van-heugten.xlsx>
 * De Doesburg-tarieven staan hieronder in de code: het is één tabel uit een
 * pdf en die is met de hand overgenomen en nagerekend.
 */
import XLSX from "xlsx";
import { teamKey as readTeamKey } from "./keys.mjs";

const BASE = "https://fonteyn-data-store.g-mulder.workers.dev";
const teamKey = readTeamKey();
const bestand = process.argv[2];
if (!bestand) { console.error("Gebruik: node tools/build-transport-tarieven.mjs <Tarieven Calculator ....xlsx>"); process.exit(1); }

/* ── Van Doesburg ────────────────────────────────────────────────────────
   Overgenomen uit "Fonteyn distributie Benelux 2026.pdf" (november 2025,
   geldig tot 30-06-2026). Per rij: laadmeters, kilo's, en dan de vijf
   kolommen uit de pdf. */
const DOESBURG_KOLOMMEN = ["nl", "nl45_be2039", "be", "be5089", "lu"];
const DOESBURG = [
  [0.2, 350, 45.98, 73.15, 101.37, 109.73, 137.94],
  [0.4, 700, 49.12, 81.51, 111.82, 119.13, 153.62],
  [0.5, 875, 51.21, 101.37, 120.18, 128.54, 174.52],
  [0.6, 1050, 65.84, 114.95, 132.72, 150.48, 192.28],
  [0.8, 1400, 88.83, 130.63, 169.29, 187.06, 209.00],
  [1.0, 1750, 97.19, 157.80, 174.52, 189.15, 238.26],
  [1.2, 2100, 111.82, 191.24, 206.91, 218.41, 263.34],
  [1.5, 2625, 130.63, 199.60, 215.27, 230.95, 298.87],
  [1.6, 2800, 135.85, 217.36, 233.04, 249.76, 311.41],
  [2.0, 3500, 167.20, 225.72, 243.49, 261.25, 359.48],
  [2.4, 4200, 204.82, 272.75, 294.69, 315.59, 413.82],
  [2.5, 4375, 207.96, 289.47, 312.46, 333.36, 422.18],
  [2.8, 4900, 225.72, 298.87, 321.86, 343.81, 449.35],
  [3.0, 5250, 231.99, 309.32, 329.18, 352.17, 465.03],
  [3.2, 5600, 246.62, 315.59, 339.63, 362.62, 488.02],
  [3.5, 6125, 249.76, 320.82, 346.94, 370.98, 520.41],
  [3.6, 6300, 259.16, 326.04, 351.12, 375.16, 530.86],
  [4.0, 7000, 272.75, 342.76, 369.93, 393.97, 571.62],
  [4.4, 7700, 282.15, 349.03, 377.25, 403.37, 589.38],
  [4.5, 7875, 287.38, 351.12, 378.29, 405.46, 592.52],
  [4.8, 8400, 294.69, 352.17, 381.43, 407.55, 602.97],
  [5.0, 8750, 298.87, 355.30, 384.56, 411.73, 610.28],
  [5.2, 9100, 315.59, 365.75, 389.79, 416.96, 617.60],
  [5.5, 9625, 329.18, 399.19, 405.46, 435.77, 627.00],
  [5.6, 9800, 333.36, 408.60, 409.64, 439.95, 630.14],
  [6.0, 10500, 345.90, 422.18, 425.32, 448.31, 658.35],
  [6.4, 11200, 357.39, 439.95, 445.17, 462.94, 672.98],
  [6.5, 11375, 370.98, 446.22, 462.94, 470.25, 676.12],
  [6.8, 11900, 377.25, 462.94, 467.12, 480.70, 688.66],
  [7.0, 12250, 382.47, 467.12, 480.70, 493.24, 695.97],
  [7.2, 12600, 390.83, 474.43, 482.79, 502.65, 703.29],
  [7.5, 13125, 393.97, 483.84, 489.06, 513.10, 714.78],
  [7.6, 13300, 402.33, 488.02, 498.47, 523.55, 718.96],
  [8.0, 14000, 408.60, 495.33, 509.96, 535.04, 731.50],
  [8.4, 14700, 411.73, 497.42, 519.37, 544.45, 738.82],
  [8.5, 14875, 419.05, 498.47, 530.86, 554.90, 739.86],
  [8.8, 15400, 421.14, 505.78, 541.31, 566.39, 746.13],
  [9.0, 15750, 422.18, 509.96, 551.76, 576.84, 750.31],
  [9.2, 16100, 426.36, 512.05, 561.17, 587.29, 754.49],
  [9.5, 16625, 430.54, 517.28, 571.62, 599.83, 762.85],
  [9.6, 16800, 432.63, 519.37, 583.11, 610.28, 767.03],
  [10.0, 17500, 434.72, 526.68, 592.52, 618.64, 777.48],
  [10.4, 18200, 437.86, 527.73, 599.83, 628.05, 784.80],
  [10.5, 18375, 442.04, 529.82, 600.88, 630.14, 786.89],
  [10.8, 18900, 443.08, 530.86, 607.15, 635.36, 792.11],
  [11.0, 19250, 446.22, 534.00, 611.33, 642.68, 795.25],
  [11.2, 19600, 447.26, 538.18, 615.51, 646.86, 799.43],
  [11.5, 20125, 450.40, 541.31, 621.78, 649.99, 806.74],
  [11.6, 20300, 451.44, 553.85, 624.91, 654.17, 808.83],
  [12.0, 21000, 474.43, 593.56, 652.08, 685.52, 834.96],
  [12.4, 21700, 474.43, 593.56, 652.08, 685.52, 834.96],
  [12.5, 21875, 474.43, 593.56, 652.08, 685.52, 834.96],
  [12.8, 22400, 474.43, 593.56, 652.08, 685.52, 834.96],
  [13.6, 24000, 474.43, 593.56, 652.08, 685.52, 834.96],
];

/* Welke kolom bij welk postcodegebied hoort. De pdf zet het per land:
   NL zonder postcode 45 en de eilanden, NL 45 samen met BE 20 t/m 39 en 91,
   de rest van BE in twee groepen, en Luxemburg apart. */
function doesburgKolom(land, postcode) {
  const pc = parseInt(String(postcode || "").replace(/\D/g, "").slice(0, 2), 10);
  const L = String(land || "").toUpperCase();
  if (L === "LU") return "lu";
  if (L === "NL") return pc === 45 ? "nl45_be2039" : "nl";
  if (L !== "BE") return null;                       // Doesburg rijdt alleen de Benelux
  if ((pc >= 20 && pc <= 39) || pc === 91) return "nl45_be2039";
  if (pc >= 50 && pc <= 89) return "be5089";
  return "be";
}

/* ── Van Heugten ─────────────────────────────────────────────────────── */
const wb = XLSX.readFile(bestand);
const landen = {};
let overgeslagen = [];

for (const naam of wb.SheetNames) {
  // Alleen de export-tabbladen; import is inkomend vervoer en niet van ons.
  // De "(O)" tabbladen zijn dezelfde landen met een andere service; die laten
  // we voor nu staan - het gewone tabblad is wat er wordt gebruikt.
  const m = naam.match(/^([A-Z]{2})-Exp$/);
  if (!m) continue;
  const land = m[1];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[naam], { header: 1, defval: null, blankrows: false });
  /* De kopregel opzoeken in plaats van aannemen dat hij bovenaan staat.
     Bij de meeste landen is dat de eerste regel, maar het Engelse tabblad
     heeft er een extra boven (daar staan de plaatsnamen los, omdat Britse
     postcodes met letters beginnen). Zonder dit viel UK-Exp helemaal weg. */
  const kopIndex = rows.findIndex(r => (r || []).some(c => String(c || "").trim().toLowerCase() === "laadmeters"));
  if (kopIndex < 0) { overgeslagen.push(naam + " (geen kopregel)"); continue; }
  const kop = rows[kopIndex] || [];

  // Kolom 15 en verder: één kolom per zone, met het zonenummer in de kopregel.
  const zoneKol = {};
  kop.forEach((c, i) => { if (i >= 15 && c != null && isFinite(Number(c))) zoneKol[String(Number(c))] = i; });

  // Kolom 0 = postcode (eerste cijfers), kolom 1 = zone.
  const postcodes = {};
  for (const r of rows.slice(kopIndex + 1)) {
    if (!r) continue;
    const pc = r[0], zone = r[1];
    if (pc == null || zone == null) continue;
    // Britse postcodes zijn letters ("AL", "AB"), de rest cijfers.
    postcodes[String(pc).trim().toUpperCase()] = String(Number(zone));
  }

  // Kolom 13 = laadmeters, 14 = gewicht. Per band de prijs uit elke zonekolom.
  const banden = [];
  for (const r of rows.slice(kopIndex + 1)) {
    if (!r) continue;
    const ldm = Number(r[13]), kg = Number(r[14]);
    if (!(ldm > 0)) continue;
    const prijzen = {};
    for (const [zone, kol] of Object.entries(zoneKol)) {
      const p = Number(r[kol]);
      if (isFinite(p) && p > 0) prijzen[zone] = Math.round(p * 100) / 100;
    }
    if (Object.keys(prijzen).length) banden.push({ ldm, kg, prijzen });
  }

  if (!banden.length || !Object.keys(postcodes).length) { overgeslagen.push(naam); continue; }
  banden.sort((a, b) => a.ldm - b.ldm);
  landen[land] = { zones: Object.keys(zoneKol).length, postcodes, banden };
}

/* Toeslagen per land: de kooiaap (die heb je bij een spa altijd nodig) en de
   kleptoeslag. De dieseltoeslag is een percentage over het tarief en staat op
   een eigen tabblad; die verandert per maand, dus die komt er als staffel in
   en niet als één getal. */
const toeslagRows = XLSX.utils.sheet_to_json(wb.Sheets["Toeslagen"], { header: 1, defval: null, blankrows: false });
const toeslagen = {};
for (const r of toeslagRows.slice(1)) {
  const code = String((r && r[0]) || "").match(/^([A-Z]{2})-Exp$/);
  const land = code ? code[1] : (String((r && r[1]) || "") === "Nederland" ? "NL" : null);
  if (!land) continue;
  toeslagen[land] = {
    kooiaap: Number(r[5]) || 0,
    klep: Number(r[3]) || 0,
    klepUitleg: String(r[4] || ""),
  };
}

const dieselRows = XLSX.utils.sheet_to_json(wb.Sheets["Dieseltoeslag"], { header: 1, defval: null, blankrows: false });
const diesel = [];
for (const r of dieselRows.slice(3)) {
  const tot = Number(r && r[1]), pct = Number(r && r[2]);
  if (!isFinite(tot) || !isFinite(pct)) continue;
  diesel.push({ tot: Math.round(tot * 1000) / 1000, pct });
}

const uit = {
  updated: new Date().toISOString(),
  bron: {
    heugten: bestand.split("/").pop(),
    doesburg: "Fonteyn distributie Benelux 2026.pdf (november 2025)",
    geldigTot: "2026-06-30",
  },
  /* Hoeveel kilo er in een laadmeter gaat. Bij allebei de vervoerders gelijk;
     staat hier zodat de rekenkant het niet nog eens hoeft te weten. */
  omrekening: { kgPerLaadmeter: 1750, kgPerEuropallet: 700, kgPerBlokpallet: 875, maxHoogteCm: 220 },
  /* De dieseltoeslag die deze week geldt, in procenten over het tarief.
     Gerrit (7 sep 2026): "Elke week sturen de transporteurs hun
     dieseltoeslagen. Voor deze week is dat: Doesburg 16% / Van Heugten 21%."

     Staat hier als los getal en niet in de staffel, want de staffel hangt aan
     de dieselprijs per liter en die krijgen wij niet - we krijgen het
     percentage. Bijwerken kan in Passion Partners Beheer; de datum erbij
     zodat je ziet of het nog van deze week is. */
  diesel: { doesburg: 16, heugten: 21, gezet: new Date().toISOString().slice(0, 10) },
  heugten: { landen, toeslagen, dieselStaffel: diesel },
  doesburg: { kolommen: DOESBURG_KOLOMMEN, banden: DOESBURG.map(r => ({
    ldm: r[0], kg: r[1],
    prijzen: Object.fromEntries(DOESBURG_KOLOMMEN.map((k, i) => [k, r[2 + i]])),
  })), kooiaap: 75, alleenLanden: ["NL", "BE", "LU"] },
};

console.log("Van Heugten: " + Object.keys(landen).length + " landen");
for (const [l, d] of Object.entries(landen))
  console.log("   " + l + ": " + d.zones + " zones, " + Object.keys(d.postcodes).length +
              " postcodegebieden, " + d.banden.length + " laadmeterbanden");
if (overgeslagen.length) console.log("overgeslagen tabbladen: " + overgeslagen.join(", "));
console.log("toeslagen voor " + Object.keys(toeslagen).length + " landen, dieselstaffel " + diesel.length + " treden");
console.log("Van Doesburg: " + uit.doesburg.banden.length + " laadmeterbanden, " + DOESBURG_KOLOMMEN.length + " gebieden");

const r = await fetch(BASE + "/data/transport-tarieven", {
  method: "PUT",
  headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": teamKey },
  body: JSON.stringify(uit),
});
if (!r.ok) { console.error("opslaan faalde: HTTP " + r.status + " " + (await r.text()).slice(0, 200)); process.exit(1); }
console.log("tarieven opgeslagen in bucket transport-tarieven");
