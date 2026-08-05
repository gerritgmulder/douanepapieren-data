// CLI: haal de Logic4-gebruikers op (naam + inlognaam + e-mail).
// Nodig omdat de rechten in het Dashboard op inlognaam/e-mail werken en die
// namen niet uit een voornaam te raden zijn: 'Bart.vdB' is Bart van den Brink,
// en er is ook een Bert van de Berg. Gokken zou de verkeerde persoon toegang
// geven. Gebruik: node tools/l4-users.mjs
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
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

const body = new URLSearchParams();
body.set("client_id", `${l4enc(grab("PUBLICKEY"))} ${l4enc(grab("COMPANYKEY"))} ${l4enc(env.LOGIC4_USERNAME)}`);
body.set("client_secret", `${l4enc(grab("SECRETKEY"))} ${l4enc(env.LOGIC4_PASSWORD)}`);
body.set("scope", `api administration.${l4enc(grab("ADMINISTRATION") || "1")}`);
body.set("grant_type", "client_credentials");
const tr = await fetch("https://idp.logic4server.nl/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
if (!tr.ok) throw new Error("login faalde: HTTP " + tr.status);
const token = (await tr.json()).access_token;

async function call(path, methode = "POST", payload = {}) {
  const opt = { headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, method: methode };
  if (methode === "POST") opt.body = JSON.stringify(payload);
  const r = await fetch("https://api.logic4server.nl" + path, opt);
  if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 120));
  return r.json();
}

// Logic4 heeft geen vast gedocumenteerd pad hiervoor; probeer de kandidaten.
const PADEN = [
  ["/v3/User/GetAllUsers", "GET"], ["/v3/User/GetAllUsers", "POST"],
  ["/v3/Users/GetUserData", "GET"], ["/v3/Administration/GetUsers", "GET"],
  ["/v3/Globalization/GetUsers", "GET"], ["/v3/Companies/GetUsers", "GET"],
];
for (const [pad, m] of PADEN) {
  try {
    const r = await call(pad, m);
    const lijst = Array.isArray(r) ? r : (r.Records || r.Users || []);
    console.log(`OK  ${m} ${pad} -> ${lijst.length} records`);
    if (lijst.length) { const q=/bart|maarten|patrick|bert/i; lijst.filter(u=>q.test(u.FullName+" "+u.Username)).sort((a,b)=>String(a.FullName).localeCompare(b.FullName)).forEach(u=>console.log(String(u.FullName).padEnd(30)+String(u.Username).padEnd(30)+u.UserId)); process.exit(0); }
  } catch (e) { console.log(`--  ${m} ${pad}: ${String(e.message).slice(0, 90)}`); }
}
console.log("Geen bruikbaar gebruikers-endpoint gevonden.");
