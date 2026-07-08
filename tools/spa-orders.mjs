#!/usr/bin/env node
// CLI: lees actuele spa-verkooporders uit Logic4 (zelfde logica als voorraad.html).
//
// Gebruik:
//   node tools/spa-orders.mjs --from 2026-05-01 [--to 2026-07-08] [--json pad.json]
//
// Vereist server/.env met (NIET committen — staat in .gitignore):
//   LOGIC4_USERNAME=...
//   LOGIC4_PASSWORD=...
// App-level keys (publickey etc.) worden uit main.js gelezen, net als in de app.
//
// Herkenning van spa's wordt runtime uit voorraad.html geparsed (SPA_BY_CODE,
// SPA_CODES, SPA_MODELS_EXTRA) zodat dit script nooit uit de pas loopt met de tegel.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- config ----------
function parseEnvFile(p) {
  const out = {};
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = { ...parseEnvFile(join(ROOT, "server/.env")), ...process.env };

function appKeysFromMainJs() {
  const src = readFileSync(join(ROOT, "main.js"), "utf8");
  const grab = (name) => (src.match(new RegExp(`LOGIC4_${name}\\s*=\\s*"([^"]+)"`)) || [])[1];
  return {
    pub: grab("PUBLICKEY"), sec: grab("SECRETKEY"),
    comp: grab("COMPANYKEY"), admin: grab("ADMINISTRATION") || "1"
  };
}

// ---------- spa-herkenning: geparsed uit voorraad.html ----------
function loadSpaDetection() {
  const html = readFileSync(join(ROOT, "voorraad.html"), "utf8");
  const grabJson = (re, label) => {
    const m = html.match(re);
    if (!m) throw new Error(label + " niet gevonden in voorraad.html — is de tegel verbouwd?");
    return JSON.parse(m[1]);
  };
  const byCode = grabJson(/const SPA_BY_CODE = (\{.*?\});/s, "SPA_BY_CODE");
  const sktBlock = html.match(/const SPA_CODES = \[(.*?)\];/s);
  if (!sktBlock) throw new Error("SPA_CODES niet gevonden in voorraad.html — is de tegel verbouwd?");
  const sktPairs = [...sktBlock[1].matchAll(/\["([^"]+)","([^"]+)"\]/g)].map(m => [m[1], m[2]]);
  const extraM = html.match(/const SPA_MODELS_EXTRA = \[(.*?)\];/s);
  const extra = extraM ? [...extraM[1].matchAll(/"([^"]+)"/g)].map(m => m[1]) : [];

  const modelsByLen = sktPairs.map(p => p[1]).concat(extra).sort((a, b) => b.length - a.length);
  const norm = c => String(c == null ? "" : c).toUpperCase().replace(/\s+/g, "");

  const spaByCode = code => {
    const k = String(code == null ? "" : code).trim();
    return Object.prototype.hasOwnProperty.call(byCode, k) ? byCode[k] : null;
  };
  const sktModel = code => {
    const n = norm(code);
    if (n.indexOf("SKT") !== 0) return null;
    for (const [c, name] of sktPairs) if (n.indexOf(norm(c)) === 0) return name;
    return null; // "(onbekend SKT-model)" laten we hier weg — alleen zekere matches
  };
  const modelFromText = text => {
    const t = " " + String(text == null ? "" : text).toLowerCase() + " ";
    for (const name of modelsByLen) {
      const ml = name.toLowerCase();
      const idx = t.indexOf(ml);
      if (idx !== -1) {
        const before = t.charAt(idx - 1), after = t.charAt(idx + ml.length);
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return name;
      }
    }
    return null;
  };
  return { spaByCode, sktModel, modelFromText };
}

// ---------- Logic4 ----------
const l4enc = s => String(s).replace(/_/g, "__").replace(/ /g, "_");

async function getToken() {
  const { pub, sec, comp, admin } = appKeysFromMainJs();
  const user = env.LOGIC4_USERNAME, pass = env.LOGIC4_PASSWORD;
  if (!user || !pass) {
    console.error("✗ Geen LOGIC4_USERNAME/LOGIC4_PASSWORD gevonden in server/.env");
    console.error("  Maak server/.env aan (gitignored) met die twee regels en probeer opnieuw.");
    process.exit(1);
  }
  const body = new URLSearchParams();
  body.set("client_id", `${l4enc(pub)} ${l4enc(comp)} ${l4enc(user)}`);
  body.set("client_secret", `${l4enc(sec)} ${l4enc(pass)}`);
  body.set("scope", `api administration.${l4enc(admin)}`);
  body.set("grant_type", "client_credentials");
  const r = await fetch("https://idp.logic4server.nl/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!r.ok) throw new Error(`Logic4-login faalde: HTTP ${r.status} — ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  if (!j.access_token) throw new Error("Geen access_token in token-response");
  return j.access_token;
}

async function l4call(token, path, body) {
  const r = await fetch("https://api.logic4server.nl" + path, {
    method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Logic4 ${path} faalde: HTTP ${r.status} — ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// ---------- main ----------
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
}
const today = new Date().toISOString().slice(0, 10);
const from = args.from || new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
const to = args.to || today;

const STATUS_LABEL = { 1: "Verkooporder", 25: "30% aanbetaald" };
const SPA_STATUSSEN = [1, 25];

const det = loadSpaDetection();
const token = await getToken();
console.error(`✓ Ingelogd. Orders ophalen ${from} t/m ${to}…`);

const fromMs = new Date(from + "T00:00:00").getTime();
const toMs = new Date(to + "T23:59:59").getTime();
const PAGE = 500, MAX_PAGES = 80;
const orders = [];
for (let p = 0; p < MAX_PAGES; p++) {
  const data = await l4call(token, "/v3/Orders/GetOrders", {
    CreationDateFrom: from + "T00:00:00", CreationDateTo: to + "T23:59:59",
    TakeRecords: PAGE, SkipRecords: p * PAGE
  });
  const arr = Array.isArray(data) ? data : ((data && data.Orders) || []);
  if (!arr.length) break;
  orders.push(...arr);
  process.stderr.write(`  pagina ${p + 1}: ${orders.length} orders\r`);
  if (arr.length < PAGE) break;
}
console.error(`\n✓ ${orders.length} orders opgehaald.`);

// Zelfde guards als de tegel: harde datum-check + alleen status 1/25
const inRange = orders.filter(o => { const c = new Date(o.CreationDate).getTime(); return c >= fromMs && c <= toMs; });
const verkocht = inRange.filter(o => SPA_STATUSSEN.includes(o.OrderStatus && o.OrderStatus.Id));

const klantNaam = o =>
  (o.InvoiceAddress && (o.InvoiceAddress.CompanyName || o.InvoiceAddress.ContactName)) ||
  (o.AccountAddress && (o.AccountAddress.CompanyName || o.AccountAddress.ContactName)) ||
  (o.DebtorId != null ? "Debiteur " + o.DebtorId : "—");

const lines = [];
for (const o of verkocht) {
  for (const r of (o.OrderRows || [])) {
    let model = det.spaByCode(r.ProductCode) || det.modelFromText(r.Description) || det.sktModel(r.ProductCode);
    if (!model) continue;
    const aantal = Number(r.Qty) || 0;
    if (aantal <= 0) continue;
    lines.push({
      ordernr: o.Id, datum: String(o.CreationDate).slice(0, 10), naam: klantNaam(o),
      statusId: o.OrderStatus && o.OrderStatus.Id,
      status: STATUS_LABEL[o.OrderStatus && o.OrderStatus.Id] || "",
      model, code: String(r.ProductCode || ""),
      omschrijving: String(r.Description || ""), aantal, debtorId: o.DebtorId
    });
  }
}

// Samenvatting
const perModel = {};
for (const l of lines) perModel[l.model] = (perModel[l.model] || 0) + l.aantal;
const perStatus = {};
for (const l of lines) perStatus[l.status] = (perStatus[l.status] || 0) + l.aantal;

console.log(`\n=== Spa's in bestelling (${from} t/m ${to}) ===`);
console.log(`${verkocht.length} orders met status Verkooporder/30% aanbetaald, ${lines.length} spa-regels.\n`);
console.log("Per status:", perStatus);
console.log("\nPer model:");
for (const [m, n] of Object.entries(perModel).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)} × ${m}`);
console.log("\nRegels:");
for (const l of lines.sort((a, b) => a.datum < b.datum ? -1 : 1)) {
  console.log(`  ${l.datum}  #${l.ordernr}  ${l.status.padEnd(15)} ${String(l.aantal).padStart(2)}× ${l.model.padEnd(24)} ${l.naam}`);
}

if (args.json) {
  writeFileSync(args.json, JSON.stringify({ from, to, generatedAt: new Date().toISOString(), lines }, null, 2));
  console.error(`\n✓ JSON weggeschreven naar ${args.json}`);
}
