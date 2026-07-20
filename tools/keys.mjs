// Sleutel-lookup voor de lokale tools.
//
// De sleutelbestanden stonden vroeger in ~/Documents/. Sinds de mapreorganisatie
// (17 jul 2026) staan ze in ~/Documents/Documenten - MacBook Air van G. - 1/.
// Eén hard pad brak daardoor elke tool. Deze helper zoekt de sleutel op alle
// bekende plekken, zodat een volgende verhuizing niets sloopt.
//
// Override altijd mogelijk via omgevingsvariabele, bv:
//   FONTEYN_KEYS_DIR="/pad/naar/map" node tools/build-stock.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const KEY_RE = /[A-Za-z0-9_-]{20,}/;

function candidateDirs() {
  const home = homedir();
  const dirs = [];
  if (process.env.FONTEYN_KEYS_DIR) dirs.push(process.env.FONTEYN_KEYS_DIR);
  dirs.push(join(home, "Documents", "Documenten - MacBook Air van G. - 1"));
  dirs.push(join(home, "Documents"));
  // Vangnet: elke map direct onder ~/Documents die met "Documenten" begint,
  // zodat een hernoemde hoofdmap de tools niet breekt.
  try {
    for (const name of readdirSync(join(home, "Documents"))) {
      if (name.startsWith("Documenten")) dirs.push(join(home, "Documents", name));
    }
  } catch {}
  return [...new Set(dirs)];
}

/** Leest een sleutelbestand (bv. "fonteyn-teamsleutel-dashboard.txt") en geeft de sleutel terug. */
export function readKey(filename) {
  const tried = [];
  for (const dir of candidateDirs()) {
    const p = join(dir, filename);
    tried.push(p);
    if (!existsSync(p)) continue;
    const key = readFileSync(p, "utf8").match(KEY_RE)?.[0];
    if (key) return key;
    throw new Error(`Sleutelbestand gevonden maar leeg/ongeldig: ${p}`);
  }
  throw new Error(
    `Sleutel "${filename}" niet gevonden. Gezocht in:\n  ${tried.join("\n  ")}\n` +
    `Zet FONTEYN_KEYS_DIR naar de map waar de fonteyn-*.txt bestanden staan.`
  );
}

export const teamKey  = () => readKey("fonteyn-teamsleutel-dashboard.txt");
export const adminKey = () => readKey("fonteyn-beheersleutel-dealerportaal.txt");
