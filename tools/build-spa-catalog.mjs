#!/usr/bin/env node
// Bouwt de spa-catalogus: model → varianten (artikelcode, kleur, productId)
// uit Logic4, op basis van de SPA_BY_CODE-tabel in voorraad.html, en zet hem
// in KV-bucket 'spa-catalog' (leest beheersleutel uit ~/Documents).
// Draaien: node tools/build-spa-catalog.mjs [--dry]

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(join(ROOT, "server/.env"), "utf8").trim().split("\n").map(l => l.split("=")));
const src = readFileSync(join(ROOT, "main.js"), "utf8");
const g = n => src.match(new RegExp('LOGIC4_' + n + '\\s*=\\s*"([^"]+)"'))[1];
const enc = s => String(s).replace(/_/g, "__").replace(/ /g, "_");

const html = readFileSync(join(ROOT, "voorraad.html"), "utf8");
const byCode = JSON.parse(html.match(/const SPA_BY_CODE = (\{.*?\});/s)[1]);
const codes = Object.keys(byCode);
console.log(codes.length + " artikelcodes in SPA_BY_CODE");

const body = new URLSearchParams();
body.set("client_id", enc(g("PUBLICKEY")) + " " + enc(g("COMPANYKEY")) + " " + enc(env.LOGIC4_USERNAME));
body.set("client_secret", enc(g("SECRETKEY")) + " " + enc(env.LOGIC4_PASSWORD));
body.set("scope", "api administration.1");
body.set("grant_type", "client_credentials");
const t = await (await fetch("https://idp.logic4server.nl/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).json();

// Logic4's ProductCodes-filter is onbetrouwbaar (bekend uit de douane-tool):
// dus de HELE catalogus pagineren en client-side filteren.
async function getPage(skip) {
  const r = await fetch("https://api.logic4server.nl/v3/Products/GetProducts", {
    method: "POST",
    headers: { Authorization: "Bearer " + t.access_token, "Content-Type": "application/json" },
    body: JSON.stringify({ TakeRecords: 500, SkipRecords: skip }),
  });
  if (!r.ok) throw new Error("GetProducts HTTP " + r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : (j.Records || j.Products || []);
}

const wanted = new Set(codes);
const catalog = {};   // model → [{code, productId, desc}]
let found = 0, scanned = 0;
for (let page = 0; page < 200; page++) {
  const prods = await getPage(page * 500);
  if (!prods.length) break;
  scanned += prods.length;
  for (const p of prods) {
    const code = String(p.ProductCode || "");
    if (!wanted.has(code)) continue;
    found++;
    (catalog[byCode[code]] = catalog[byCode[code]] || []).push({
      code,
      productId: p.Id || p.ProductId || null,
      desc: p.ProductName1 || p.Description || "",
    });
  }
  process.stderr.write(`\r  ${scanned} producten gescand, ${found} spa-varianten gevonden`);
  if (prods.length < 500) break;
}
console.error();
const models = Object.keys(catalog).sort();
console.log(models.length + " modellen, " + found + " varianten met Logic4-product");

if (process.argv.includes("--dry")) {
  console.log("voorbeeld Soulmate:", JSON.stringify((catalog["Soulmate"] || []).slice(0, 4), null, 1));
  process.exit(0);
}

const teamKey = readFileSync(join(homedir(), "Documents/fonteyn-teamsleutel-dashboard.txt"), "utf8").match(/[A-Za-z0-9_-]{20,}/)[0];
const put = await fetch("https://fonteyn-data-store.g-mulder.workers.dev/data/spa-catalog", {
  method: "PUT",
  headers: { "X-Fonteyn-Auth": teamKey, "Content-Type": "application/json" },
  body: JSON.stringify({ updated: new Date().toISOString(), models: catalog }),
});
console.log(put.ok ? "✓ spa-catalog opgeslagen in KV" : "✗ opslaan faalde: HTTP " + put.status);
