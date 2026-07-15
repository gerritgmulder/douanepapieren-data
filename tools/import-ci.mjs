#!/usr/bin/env node
// Leest commercial-invoice-xlsx'en (Jazzi/Fonteyn) en zet de scheepslading als
// schip-voorraad in KV-bucket 'voorraad-schepen'. Per schip: ref, vessel/voyage,
// containers, en aantal per spa-model. SKT-fabriekscode → model via de
// SPA_CODES-prefixtabel in voorraad.html.
// Draaien: node tools/import-ci.mjs "<map-met-xlsx>" [--eta YYYY-MM-DD:ref ...] [--dry]

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://fonteyn-data-store.g-mulder.workers.dev";
const require = createRequire(import.meta.url);
let XLSX;
try { XLSX = require(join(ROOT, "node_modules/xlsx")); }
catch { console.error("xlsx-module ontbreekt. Installeer met: npm i xlsx"); process.exit(1); }

const dir = process.argv[2];
if (!dir) { console.error('Gebruik: node tools/import-ci.mjs "<map met CI-xlsx>" [--dry]'); process.exit(1); }
const dry = process.argv.includes("--dry");

// SKT-prefix → model
const html = readFileSync(join(ROOT, "voorraad.html"), "utf8");
const pairs = [...html.match(/const SPA_CODES = \[(.*?)\];/s)[1].matchAll(/\["([^"]+)","([^"]+)"\]/g)]
  .map(m => [m[1], m[2]]).sort((a, b) => b[0].length - a[0].length);
const norm = c => String(c).toUpperCase().replace(/\s+/g, "");
const sktToModel = code => {
  const n = norm(code);
  for (const [c, m] of pairs) if (n.indexOf(norm(c)) === 0) return m;
  return null;
};

const ships = [];
const unmapped = {};
for (const file of readdirSync(dir).filter(f => f.endsWith(".xlsx") && !f.startsWith("~"))) {
  const wb = XLSX.readFile(join(dir, file));
  const ws = wb.Sheets["COMMERCIAL INVOICE"];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  let ref = null, vessel = null;
  for (const r of rows.slice(0, 20)) for (const c of r) {
    const s = String(c || "");
    if (s.startsWith("RZ")) ref = ref || s.trim();
    // Schip/reis: "NAAM / voyage" — reis eindigt meestal op cijfers(+E/W)
    if (!vessel && /\s\/\s\S*\d/.test(s) && !/FOB|ROTTERDAM,|YANTIAN/i.test(s)) vessel = s.trim();
  }
  // Regels: kolom0 = SKT-code (evt. met klantref op regel2), kolom5 = qty
  const perModel = {};
  for (const r of rows) {
    const c0 = String(r[0] || "").split("\n")[0].trim();
    const m = c0.match(/^(SKT[\w.-]+)/);
    const qty = Number(r[5]);
    if (!m || !Number.isFinite(qty) || qty <= 0) continue;
    const model = sktToModel(m[1]);
    if (!model) { unmapped[m[1]] = (unmapped[m[1]] || 0) + qty; continue; }
    perModel[model] = (perModel[model] || 0) + qty;
  }
  const containers = wb.SheetNames.filter(n => n !== "COMMERCIAL INVOICE").length;
  ships.push({ file: basename(file), ref, vessel, containers, models: perModel,
    total: Object.values(perModel).reduce((a, b) => a + b, 0) });
}

console.log(ships.length + " schepen ingelezen:");
for (const s of ships) console.log("  " + (s.vessel || "?") + " | " + s.total + " spa's | " + s.containers + " containers | ref " + (s.ref || "?"));
if (Object.keys(unmapped).length) {
  console.log("\n⚠ Niet-gemapte SKT-codes (aan Chantal vragen welk model):");
  for (const [c, q] of Object.entries(unmapped)) console.log("  " + c + " → " + q + " stuks");
}

if (dry) process.exit(0);
const teamKey = readFileSync(join(homedir(), "Documents/fonteyn-teamsleutel-dashboard.txt"), "utf8").match(/[A-Za-z0-9_-]{20,}/)[0];
const put = await fetch(BASE + "/data/voorraad-schepen", {
  method: "PUT",
  headers: { "X-Fonteyn-Auth": teamKey, "Content-Type": "application/json" },
  body: JSON.stringify({ updated: new Date().toISOString(), ships, unmapped }),
});
console.log(put.ok ? "\n✓ voorraad-schepen opgeslagen in KV" : "\n✗ opslaan faalde: HTTP " + put.status);
