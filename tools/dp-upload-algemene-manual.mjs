#!/usr/bin/env node
/* Zet de algemene Passion Spas-handleiding in het partnerportaal.
 *
 * Gerrit (3 sep 2026): "Bij elke spa + swimspa moet bij Manuals 1 algemene
 * handleiding voor alle spa's + swimspa's worden toegevoegd."
 *
 * Het is één pdf in vier talen (EN/FR/DE/US). Hij komt in de bibliotheek onder
 * een eigen map en krijgt een vast id dat op 'spas/algemeen/' begint; het
 * portaal hangt elk bestand met dat voorvoegsel onder Manuals bij ieder
 * spa-model, zonder dat er per model iets gekoppeld hoeft te worden.
 *
 * Draaien:  node tools/dp-upload-algemene-manual.mjs "/pad/naar/Manual.pdf"
 */
import { readFileSync, statSync } from "node:fs";
import { adminKey as readAdminKey } from "./keys.mjs";

const BASE = "https://fonteyn-data-store.g-mulder.workers.dev";
const pad = process.argv[2];
if (!pad) { console.error("Gebruik: node tools/dp-upload-algemene-manual.mjs <bestand.pdf>"); process.exit(1); }

const ID = "spas/algemeen/passion-spas-owners-manual.pdf";
const TITEL = "Owner's manual — all spas & swim spas (EN / FR / DE / US)";
const MAP = "General — all spas & swim spas";

const grootte = statSync(pad).size;
if (grootte > 24 * 1024 * 1024) { console.error("Te groot voor KV (max 24 MB): " + (grootte/1048576).toFixed(1) + " MB"); process.exit(1); }
console.log((grootte / 1048576).toFixed(1) + " MB → " + ID);

const adminKey = readAdminKey();
const up = await fetch(BASE + "/dealers/admin/file?id=" + encodeURIComponent(ID), {
  method: "PUT", headers: { "X-DP-Admin": adminKey, "Content-Type": "application/octet-stream" },
  body: readFileSync(pad),
});
if (!up.ok) { console.error("upload mislukt: HTTP " + up.status + " " + (await up.text()).slice(0, 200)); process.exit(1); }
console.log("bestand geüpload");

// De map in de bibliotheek bijwerken zonder de rest aan te raken.
const cur = await (await fetch(BASE + "/data/dealer-docs", { headers: { "X-DP-Admin": adminKey } })).json();
const cats = (cur.library && cur.library.categories) || [];
const spas = cats.find(c => c.key === "spas" || /spas/i.test(c.name || ""));
if (!spas) { console.error("categorie 'Spas & Swim Spas' niet gevonden — niets gewijzigd"); process.exit(1); }
spas.groups = spas.groups || [];
let map = spas.groups.find(g => g.name === MAP);
if (!map) { map = { name: MAP, files: [] }; spas.groups.unshift(map); }   // bovenaan: het geldt voor alles
map.files = [{ id: ID, title: TITEL, size: grootte }];
cur.library.updated = new Date().toISOString();

const pr = await fetch(BASE + "/data/dealer-docs", {
  method: "PUT", headers: { "X-DP-Admin": adminKey, "Content-Type": "application/json" },
  body: JSON.stringify(cur),
});
console.log(pr.ok ? "bibliotheek bijgewerkt: map '" + MAP + "'" : "bibliotheek opslaan faalde: HTTP " + pr.status);
