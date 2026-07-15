#!/usr/bin/env node
// Berekent de ECHTE hal-voorraad per spa-model uit Logic4 (warehouse "Fonteyn")
// en schrijft die naar KV-bucket 'voorraad-hallen'. Definitie Arno/Chantal:
// alleen fysieke voorraad in de Fonteyn-hallen telt (= warehouse 21 "Fonteyn";
// Showroom/Texas/Retouren/Dealer-magazijn/Outlet tellen NIET).
// Draaien: node tools/build-stock.mjs [--dry]

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://fonteyn-data-store.g-mulder.workers.dev";
const env = Object.fromEntries(readFileSync(join(ROOT, "server/.env"), "utf8").trim().split("\n").map(l => l.split("=")));
const src = readFileSync(join(ROOT, "main.js"), "utf8");
const g = n => src.match(new RegExp('LOGIC4_' + n + '\\s*=\\s*"([^"]+)"'))[1];
const enc = s => String(s).replace(/_/g, "__").replace(/ /g, "_");
const teamKey = readFileSync(join(homedir(), "Documents/fonteyn-teamsleutel-dashboard.txt"), "utf8").match(/[A-Za-z0-9_-]{20,}/)[0];

// code → model uit de KV-catalogus (door build-spa-catalog.mjs gevuld)
const catalog = await (await fetch(BASE + "/data/spa-catalog", { headers: { "X-Fonteyn-Auth": teamKey } })).json();
const codeToModel = {};
for (const [model, variants] of Object.entries(catalog.models || {}))
  for (const v of variants) codeToModel[v.code] = model;
console.log(Object.keys(codeToModel).length + " artikelcodes in catalogus");

const body = new URLSearchParams();
body.set("client_id", enc(g("PUBLICKEY")) + " " + enc(g("COMPANYKEY")) + " " + enc(env.LOGIC4_USERNAME));
body.set("client_secret", enc(g("SECRETKEY")) + " " + enc(env.LOGIC4_PASSWORD));
body.set("scope", "api administration.1");
body.set("grant_type", "client_credentials");
const t = await (await fetch("https://idp.logic4server.nl/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).json();

const HAL_WAREHOUSE = 21;   // "Fonteyn" — de hallen (F/K)
async function stockPage(skip) {
  const r = await fetch("https://api.logic4server.nl/v3/Stock/GetStockForWarehouses", {
    method: "POST",
    headers: { Authorization: "Bearer " + t.access_token, "Content-Type": "application/json" },
    body: JSON.stringify({ WareHouseId: HAL_WAREHOUSE, TakeRecords: 500, SkipRecords: skip }),
  });
  if (!r.ok) throw new Error("GetStockForWarehouses HTTP " + r.status);
  return r.json();
}

const perModel = {};    // model → { hal, variants: {code: qty} }
const perVariant = {};  // code → qty (alleen spa-codes, alleen >0 bewaren)
let scanned = 0;
for (let page = 0; page < 200; page++) {
  const rows = await stockPage(page * 500);
  if (!rows.length) break;
  scanned += rows.length;
  for (const row of rows) {
    const code = String(row.ProductCode || "");
    const model = codeToModel[code];
    if (!model) continue;
    const qty = Number(row.Qty) || 0;   // fysiek in de hallen
    if (!perModel[model]) perModel[model] = { hal: 0, variants: {} };
    perModel[model].hal += qty;
    if (qty !== 0) perModel[model].variants[code] = qty;
    if (qty !== 0) perVariant[code] = qty;
  }
  process.stderr.write(`\r  ${scanned} voorraadregels gescand`);
  if (rows.length < 500) break;
}
console.error();

const models = Object.entries(perModel).map(([m, v]) => ({ model: m, hal: v.hal, variants: v.variants }))
  .sort((a, b) => b.hal - a.hal);
console.log(models.length + " modellen met hal-voorraad. Top 8:");
for (const m of models.slice(0, 8)) console.log("  " + String(m.hal).padStart(4) + "  " + m.model);

if (process.argv.includes("--dry")) process.exit(0);

const put = await fetch(BASE + "/data/voorraad-hallen", {
  method: "PUT",
  headers: { "X-Fonteyn-Auth": teamKey, "Content-Type": "application/json" },
  body: JSON.stringify({ updated: new Date().toISOString(), warehouse: "Fonteyn (hallen F/K)", models: perModel }),
});
console.log(put.ok ? "✓ voorraad-hallen opgeslagen in KV" : "✗ opslaan faalde: HTTP " + put.status);
