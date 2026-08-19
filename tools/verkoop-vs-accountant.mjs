/* Verkoopaantallen 2025 per artikel uit Logic4, tegenover wat de accountant
   in "Berekening voorziening incourante voorraad 2025-1" als verkoop heeft
   staan.
   Aanleiding: Gerrit, 18 aug 2026 - "hoe kom jij erbij dat er van de Passion
   Spa Filter 151131 nul zijn verkocht? Die worden wel veel verkocht."
   Klopte: het grootboek laat 3.061 regels omzet zien op dat artikel in 2025.
   Dit script haalt de aantallen erbij, want het grootboek geeft alleen euro's.

   Gebruik:  node tools/verkoop-vs-accountant.mjs 151131 151140 151128 ...
             node tools/verkoop-vs-accountant.mjs --bestand codes.txt          */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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
const src = readFileSync(join(ROOT, "main.js"), "utf8");
const grab = n => (src.match(new RegExp(`LOGIC4_${n}\\s*=\\s*"([^"]+)"`)) || [])[1];
const l4enc = s => String(s).replace(/_/g, "__").replace(/ /g, "_");

const args = process.argv.slice(2);
let codes = args.filter(a => !a.startsWith("--"));
const bi = args.indexOf("--bestand");
if (bi >= 0) codes = readFileSync(args[bi + 1], "utf8").split(/\s+/).filter(Boolean);
if (!codes.length) { console.error("geef artikelcodes op"); process.exit(1); }

const VAN = "2025-01-01T00:00:00", TOT = "2025-12-31T23:59:59";

const body = new URLSearchParams();
body.set("client_id", `${l4enc(grab("PUBLICKEY"))} ${l4enc(grab("COMPANYKEY"))} ${l4enc(env.LOGIC4_USERNAME)}`);
body.set("client_secret", `${l4enc(grab("SECRETKEY"))} ${l4enc(env.LOGIC4_PASSWORD)}`);
body.set("scope", `api administration.${l4enc(grab("ADMINISTRATION") || "1")}`);
body.set("grant_type", "client_credentials");
const tr = await fetch("https://idp.logic4server.nl/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
const token = (await tr.json()).access_token;
if (!token) { console.error("geen token"); process.exit(1); }

async function mutaties(code) {
  const r = await fetch("https://api.logic4server.nl/v3/Stock/GetProductStockMutations", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ ProductCode: String(code), DateFrom: VAN, DateTo: TOT, TakeRecords: 100000 }),
  });
  const j = await r.json();
  return Array.isArray(j) ? j : (j.Records || j.Result || []);
}

console.log("artikel;soort;regels;aantal");
for (const code of codes) {
  let rijen = [];
  try { rijen = await mutaties(code); }
  catch (e) { console.error(code, "fout:", e.message); continue; }
  const per = {};
  for (const m of rijen) {
    const soort = String(m.StockMutationType || "onbekend").trim();
    const n = Number(m.Amount ?? 0);
    if (!per[soort]) per[soort] = { regels: 0, aantal: 0 };
    per[soort].regels++; per[soort].aantal += n;
  }
  if (!rijen.length) console.log(`${code};(geen mutaties);0;0`);
  for (const s of Object.keys(per).sort())
    console.log(`${code};${s};${per[s].regels};${per[s].aantal}`);
}
