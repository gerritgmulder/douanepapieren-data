#!/usr/bin/env node
// Upload de documentbibliotheek naar het dealerportaal (worker/KV).
//
// Gebruik:
//   node tools/dp-upload-docs.mjs --src "/pad/naar/Spa documentatie/2024" [--dry]
//
// Leest de beheersleutel via tools/keys.mjs (zoekt in de bekende sleutelmappen)
// (NOOIT de sleutel in code of repo zetten). Verwachte bronstructuur:
//   <src>/<MARKT>/<Merk>/<Model>.pdf   (bv. 2024/EU/Passion Spas/Admire.pdf)
//
// Doet twee dingen:
//   1. PUT /dealers/admin/file?id=…  per bestand (KV dpfile:<id>)
//   2. library-boom mergen in bucket dealer-docs (categorieën → mappen → files)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { adminKey as readAdminKey } from "./keys.mjs";

const BASE = "https://fonteyn-data-store.g-mulder.workers.dev";
const ALLOWED = new Set([".pdf", ".docx", ".xlsx", ".jpg", ".jpeg", ".png", ".webp"]);

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
}
if (!args.src) { console.error("Gebruik: --src <map met MARKT/Merk/bestanden>"); process.exit(1); }

const adminKey = readAdminKey();

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");

// ── bron inlezen: MARKT/Merk/bestand ──
const groups = new Map();   // "Merk — MARKT" → [{id,title,size,path}]
const markets = readdirSync(args.src).filter(d => statSync(join(args.src, d)).isDirectory());
for (const market of markets.sort()) {
  const brands = readdirSync(join(args.src, market)).filter(d => statSync(join(args.src, market, d)).isDirectory());
  for (const brand of brands.sort()) {
    const dir = join(args.src, market, brand);
    for (const f of readdirSync(dir).sort()) {
      const ext = extname(f).toLowerCase();
      if (!ALLOWED.has(ext)) continue;
      const p = join(dir, f);
      const size = statSync(p).size;
      if (size > 24 * 1024 * 1024) { console.warn("⚠ overslaan (>24MB): " + p); continue; }
      const gname = brand + " — " + market.toUpperCase();
      const id = "spas/" + slug(market) + "/" + slug(brand) + "/" + slug(basename(f, ext)) + ext;
      if (!groups.has(gname)) groups.set(gname, []);
      groups.get(gname).push({ id, title: basename(f, ext), size, path: p });
    }
  }
}

const files = [...groups.values()].flat();
const totalMb = (files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1);
console.log(`${files.length} bestanden in ${groups.size} mappen (${totalMb} MB)`);
if (args.dry) { for (const [g, fs] of groups) console.log("  " + g + ": " + fs.length); process.exit(0); }

// ── uploaden (4 tegelijk) ──
let done = 0, failed = 0;
async function put(f) {
  const r = await fetch(BASE + "/dealers/admin/file?id=" + encodeURIComponent(f.id), {
    method: "PUT",
    headers: { "X-DP-Admin": adminKey, "Content-Type": "application/octet-stream" },
    body: readFileSync(f.path),
  });
  if (!r.ok) { failed++; console.error("\n✗ " + f.id + " → HTTP " + r.status); }
  done++;
  process.stdout.write(`\r  upload ${done}/${files.length}`);
}
for (let i = 0; i < files.length; i += 4) await Promise.all(files.slice(i, i + 4).map(put));
console.log(failed ? `\n${failed} MISLUKT — library niet bijgewerkt` : "\n✓ alle bestanden geüpload");
if (failed) process.exit(1);

// ── library-boom in dealer-docs mergen ──
const cur = await (await fetch(BASE + "/data/dealer-docs", { headers: { "X-DP-Admin": adminKey } })).json();
cur.library = {
  updated: new Date().toISOString(),
  categories: [
    { key: "spas", name: "Spas & Swim Spas", groups: [...groups.entries()].map(([name, fs]) => ({
        name, files: fs.map(f => ({ id: f.id, title: f.title, size: f.size })) })) },
    { key: "saunas", name: "Saunas", groups: [] },   // gevuld zodra de sauna-map bestanden heeft
  ],
};
const pr = await fetch(BASE + "/data/dealer-docs", {
  method: "PUT",
  headers: { "X-DP-Admin": adminKey, "Content-Type": "application/json" },
  body: JSON.stringify(cur),
});
console.log(pr.ok ? "✓ library-boom opgeslagen in dealer-docs" : "✗ library opslaan faalde: HTTP " + pr.status);
