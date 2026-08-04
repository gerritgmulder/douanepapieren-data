#!/usr/bin/env node
// Zet de sauna-documentatie in het partnerportaal.
//
// Gebruik:
//   node tools/dp-upload-saunas.mjs --src "/pad/naar/Sauna documentatie" [--dry] [--prijslijsten]
//
// Waarom een eigen tool naast dp-upload-docs.mjs
// ----------------------------------------------
// Die tool verwacht een mappenboom MARKT/Merk/bestand en schrijft de hele
// library-boom opnieuw weg, inclusief een lege categorie "Saunas". De
// sauna-map is plat: 33 bestanden zonder submappen. En belangrijker: die tool
// zou bij elke draai de spa-categorie overschrijven. Deze tool raakt alleen de
// sauna-categorie aan en laat de rest staan.
//
// Wat er NIET meegaat
// -------------------
// De twee prijslijsten. Daar staan partnerprijs, dealerprijs en consumentprijs
// naast elkaar in. Elke dealer die inlogt zou dan de volledige margestructuur
// zien, ook die van een ander. Dat is een commerciële beslissing en geen
// technische, dus ze blijven eruit tenzij je --prijslijsten meegeeft.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { adminKey as readAdminKey } from "./keys.mjs";

const BASE = "https://fonteyn-data-store.g-mulder.workers.dev";
const ALLOWED = new Set([".pdf", ".docx", ".xlsx"]);

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
}
if (!args.src) { console.error("Gebruik: --src <map met de sauna-pdf's>"); process.exit(1); }

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");

// De map is plat, dus de indeling komt uit de bestandsnaam. Volgorde telt:
// de eerste die past wint.
const INDELING = [
  [/^user manual barrel|^barrel|^barrelsauna/i, "Barrel Sauna's"],
  [/^cube/i, "Cube Sauna's"],
  [/^mirror/i, "Mirror Sauna's"],
  [/^sauna house/i, "Sauna House"],
];
const GROEP_VOLGORDE = ["Barrel Sauna's", "Cube Sauna's", "Mirror Sauna's", "Sauna House", "Algemeen"];

const groups = new Map();
const overgeslagen = [];
for (const f of readdirSync(args.src).sort()) {
  const ext = extname(f).toLowerCase();
  const naam = basename(f, extname(f));
  if (!ALLOWED.has(ext)) { overgeslagen.push([f, "geen document"]); continue; }
  if (/price list|prijslijst/i.test(naam) && !args.prijslijsten) {
    overgeslagen.push([f, "prijslijst — bevat partner-, dealer- én consumentprijs"]);
    continue;
  }
  const p = join(args.src, f);
  const size = statSync(p).size;
  if (size > 24 * 1024 * 1024) { overgeslagen.push([f, "groter dan 24 MB"]); continue; }

  const groep = (INDELING.find(([re]) => re.test(naam)) || [null, "Algemeen"])[1];
  const id = "saunas/" + slug(groep) + "/" + slug(naam) + ext;
  if (!groups.has(groep)) groups.set(groep, []);
  groups.get(groep).push({ id, title: naam, size, path: p });
}

const files = [...groups.values()].flat();
console.log(files.length + " bestanden in " + groups.size + " groepen (" +
  (files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1) + " MB)");
for (const g of GROEP_VOLGORDE) {
  if (!groups.has(g)) continue;
  console.log("\n  " + g);
  groups.get(g).forEach(f => console.log("    " + f.title.padEnd(38) + (f.size / 1024).toFixed(0).padStart(6) + " kB   " + f.id));
}
if (overgeslagen.length) {
  console.log("\n  NIET meegenomen:");
  overgeslagen.forEach(([f, r]) => console.log("    " + f.padEnd(38) + r));
}
if (args.dry) process.exit(0);

const adminKey = readAdminKey();

let done = 0, failed = 0;
async function put(f) {
  const r = await fetch(BASE + "/dealers/admin/file?id=" + encodeURIComponent(f.id), {
    method: "PUT",
    headers: { "X-DP-Admin": adminKey, "Content-Type": "application/octet-stream" },
    body: readFileSync(f.path),
  });
  if (!r.ok) { failed++; console.error("\n✗ " + f.id + " → HTTP " + r.status + " " + (await r.text()).slice(0, 120)); }
  done++;
  process.stdout.write("\r  upload " + done + "/" + files.length);
}
for (let i = 0; i < files.length; i += 4) await Promise.all(files.slice(i, i + 4).map(put));
console.log(failed ? "\n" + failed + " MISLUKT — library niet bijgewerkt" : "\n✓ alle bestanden geüpload");
if (failed) process.exit(1);

// ── alleen de sauna-categorie bijwerken, de rest ongemoeid laten ──
const cur = await (await fetch(BASE + "/data/dealer-docs", { headers: { "X-DP-Admin": adminKey } })).json();
cur.library = cur.library || { categories: [] };
cur.library.categories = cur.library.categories || [];
const nieuweGroepen = GROEP_VOLGORDE.filter(g => groups.has(g)).map(g => ({
  name: g, files: groups.get(g).map(f => ({ id: f.id, title: f.title, size: f.size })),
}));
const idx = cur.library.categories.findIndex(c => c.key === "saunas");
const cat = { key: "saunas", name: "Saunas", groups: nieuweGroepen };
if (idx >= 0) cur.library.categories[idx] = cat; else cur.library.categories.push(cat);
cur.library.updated = new Date().toISOString();

const anders = cur.library.categories.filter(c => c.key !== "saunas")
  .reduce((t, c) => t + c.groups.reduce((s, g) => s + g.files.length, 0), 0);
console.log("andere categorieën blijven staan: " + anders + " bestanden");

const pr = await fetch(BASE + "/data/dealer-docs", {
  method: "PUT",
  headers: { "X-DP-Admin": adminKey, "Content-Type": "application/json" },
  body: JSON.stringify(cur),
});
console.log(pr.ok ? "✓ library bijgewerkt" : "✗ library opslaan faalde: HTTP " + pr.status);
