#!/usr/bin/env node
/* Bouwt de zoeklijst waarmee het dealerbeheer op bedrijfsnaam zoekt.
 *
 * Waarom dit een tool is en geen knop in de worker: Logic4 kan niet op
 * bedrijfsnaam filteren (GetCustomers kent alleen Id, LoginName, telefoon,
 * e-mail en ChangedAfter). Zoeken op naam moet dus uit een eigen lijst komen,
 * en die lijst opbouwen kost 600 aanvragen van 500 klanten - er staan er
 * 300.000 in Logic4. Een worker mag er maar een handvol per verzoek doen, dus
 * die eerste opbouw liep altijd stuk en de lijst is nooit gemaakt. Gerrit
 * (7 sep 2026): "bij het aanmaken van een dealer werkt het nog niet om een
 * bedrijfsnaam te zoeken, de foutmelding is dat die zoekmethode nog niet
 * gebouwd is."
 *
 * Dus: hier één keer helemaal opbouwen. Daarna houdt de worker hem zelf bij
 * met ChangedAfter, en dat kost per uur maar een paar aanvragen.
 *
 * Draaien:  node tools/build-relatie-index.mjs [--dry]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminKey } from "./keys.mjs";

const BASE = "https://fonteyn-data-store.g-mulder.workers.dev";
const dry = process.argv.includes("--dry");
const ROOT = join(new URL(".", import.meta.url).pathname, "..");
const env = Object.fromEntries(readFileSync(join(ROOT, "server/.env"), "utf8").trim().split("\n").map(l => l.split("=")));
const src = readFileSync(join(ROOT, "main.js"), "utf8");
const g = n => src.match(new RegExp('LOGIC4_' + n + '\\s*=\\s*"([^"]+)"'))[1];
const enc = s => String(s).replace(/_/g, "__").replace(/ /g, "_");
const body = new URLSearchParams();
body.set("client_id", enc(g("PUBLICKEY")) + " " + enc(g("COMPANYKEY")) + " " + enc(env.LOGIC4_USERNAME));
body.set("client_secret", enc(g("SECRETKEY")) + " " + enc(env.LOGIC4_PASSWORD));
body.set("scope", "api administration.1");
body.set("grant_type", "client_credentials");
const t = await (await fetch("https://idp.logic4server.nl/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).json();

/* Precies dezelfde velden als relKort() in de worker. Wijkt dit af, dan zoekt
   het scherm op iets dat er niet in staat. */
const kort = (c) => ({
  i: c.Id,
  n: [c.FirstName, c.Preposition, c.LastName].map(x => String(x || "").trim()).filter(Boolean).join(" "),
  b: c.CompanyName || "",
  e: c.EmailAddress || "",
  p: c.City || "",
  l: c.IsoCode || "",
  s: (c.Type && c.Type.Description) || "",
  a: (c.Status && c.Status.Description) || "",
});

const rijen = [];
let gezien = 0;
for (let skip = 0; ; skip += 500) {
  const r = await fetch("https://api.logic4server.nl/v3/Relations/GetCustomers", {
    method: "POST",
    headers: { Authorization: "Bearer " + t.access_token, "Content-Type": "application/json" },
    body: JSON.stringify({ TakeRecords: 500, SkipRecords: skip }),
  });
  if (!r.ok) throw new Error("GetCustomers HTTP " + r.status);
  const j = await r.json();
  const lijst = Array.isArray(j) ? j : (j.Records || []);
  if (!lijst.length) break;
  gezien += lijst.length;
  for (const c of lijst) {
    // Particulieren horen er niet in: dit scherm koppelt dealers en partners.
    const soort = (c.Type && c.Type.Description) || "";
    if (soort && soort !== "Particulier") rijen.push(kort(c));
  }
  process.stderr.write(`\r  ${gezien} klanten bekeken, ${rijen.length} zakelijk`);
  if (lijst.length < 500) break;
}
process.stderr.write("\n");

const data = { gebouwd: new Date().toISOString(), rijen };
const mb = (JSON.stringify(data).length / 1048576).toFixed(2);
console.log(`${rijen.length} zakelijke relaties uit ${gezien} klanten (${mb} MB)`);
if (dry) { console.log("--dry: niet weggeschreven"); process.exit(0); }

const put = await fetch(BASE + "/data/dealer-zoekindex", {
  method: "PUT", headers: { "Content-Type": "application/json", "X-DP-Admin": adminKey() },
  body: JSON.stringify(data),
});
console.log(put.ok ? "zoeklijst opgeslagen" : "opslaan MISLUKT: HTTP " + put.status + " " + (await put.text()).slice(0, 200));
