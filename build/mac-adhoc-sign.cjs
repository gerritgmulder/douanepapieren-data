/* Ad-hoc ondertekenen met een eis die bouwsessies overleeft.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Waarom dit bestand bestaat
 * --------------------------
 * Gerrit (7 sep 2026): "Het is trouwens wel gewoon mogelijk dat mijn Mac
 * automatisch update, hoewel jij zegt van niet. Ik wil ook gewoon automatische
 * updates, zonder betaling aan Apple."
 *
 * Hij heeft gelijk, en het klopt ook dat het gratis kan. Wat er misging:
 *
 * macOS werkt zijn apps bij via Squirrel.Mac. Die kijkt of de binnengekomen
 * versie voldoet aan de "designated requirement" van de versie die nu draait.
 * electron-builder ondertekent onze universal-app ad-hoc (dat moet, anders
 * start hij niet op een Apple Silicon-Mac), en bij een kale ad-hoc handtekening
 * is die eis vastgezet op de bouwhash van dát ene bestand:
 *
 *     designated => cdhash H"fb01c410...."
 *
 * Elke nieuwe build heeft een andere hash, dus voldoet nooit, dus weigert
 * Squirrel elke update. Dat is de echte reden dat de Mac zichzelf niet
 * bijwerkte - niet dat het onmogelijk is zonder Apple-account.
 *
 * De oplossing is één regel: teken ad-hoc, maar geef de app een eis die naar
 * de identifier kijkt in plaats van naar de hash:
 *
 *     designated => identifier "com.fonteyn.dashboard"
 *
 * Nagemeten op 7 sep 2026 met twee losse bouwsels met verschillende hash:
 *   - kale ad-hoc handtekening: de nieuwe build voldoet NIET aan de eis van de
 *     oude, dus de update wordt geweigerd;
 *   - met de eis hieronder: de nieuwe build voldoet WEL.
 * `codesign -s -` is ad-hoc en kost niets; er komt geen Apple Developer-account
 * aan te pas.
 *
 * Wat dit NIET doet: het maakt de app niet notarized. Bij de eerste installatie
 * moet iemand hem nog steeds via rechtermuisknop > Openen starten. Dat is
 * eenmalig; de updates daarna gaan vanzelf.
 */
"use strict";
const { execFileSync } = require("node:child_process");
const { existsSync, readdirSync } = require("node:fs");
const path = require("node:path");

exports.default = async function (context) {
  if (context.electronPlatformName !== "darwin") return;

  /* Alleen de uiteindelijke universal-app ondertekenen, niet de twee losse
     bouwsels die daarvoor worden gemaakt.

     Een universal-app wordt gebouwd door een x64- en een arm64-versie samen te
     voegen, en de samenvoeger eist dat alle niet-binaire bestanden in allebei
     exact gelijk zijn. Tekenden we hier ook die twee, dan kregen ze elk een
     ander _CodeSignature/CodeResources en klapte de build eruit met
     "Expected all non-binary files to have identical SHAs". Die twee mappen
     eindigen op -temp; de echte heet dist/mac-universal. */
  if (/-temp\/?$/.test(context.appOutDir)) return;

  const naam = context.packager.appInfo.productFilename;
  const app = path.join(context.appOutDir, `${naam}.app`);
  const id = context.packager.appInfo.id || "com.fonteyn.dashboard";
  const eis = `=designated => identifier "${id}"`;

  /* Van binnen naar buiten ondertekenen, in deze volgorde.
     ═══════════════════════════════════════════════════════════════════════
     Met identity:null tekent electron-builder helemaal niets, ook niet de
     onderdelen. codesign weigert dan de buitenste bundel met "code object is
     not signed at all - In subcomponent: Mantle.framework". Alles moet dus
     zelf, en de volgorde ligt vast: wat het diepst zit als eerste.

     Twee dingen die niet vanzelf spreken:
       - een .framework onderteken je op Versions/A, niet op de map zelf;
       - de Electron-framework heeft er zelf weer losse bibliotheken en een
         crash-handler in zitten, en die moeten vóór de framework.

     Wat hier eerst stond en niet werkte: --deep. Die tekent van buiten naar
     binnen, en dan meldt `codesign --verify --strict` daarna "nested code is
     modified or invalid". Apple raadt --deep zelf ook af.

     Nagemeten op 7 sep 2026: na deze volgorde zegt codesign "valid on disk"
     en "satisfies its Designated Requirement". */
  const teken = (doel, extra) =>
    execFileSync("codesign", ["--sign", "-", "--force"].concat(extra || []).concat([doel]),
                 { stdio: "inherit" });

  const frameworks = path.join(app, "Contents", "Frameworks");
  const inMap = existsSync(frameworks) ? readdirSync(frameworks) : [];

  // 1. Wat er ín de Electron-framework zit: de bibliotheken en de crash-handler.
  const ef = path.join(frameworks, "Electron Framework.framework", "Versions", "A");
  for (const sub of ["Libraries", "Helpers"]) {
    const map = path.join(ef, sub);
    if (!existsSync(map)) continue;
    for (const n of readdirSync(map)) teken(path.join(map, n));
  }

  // 2. De frameworks zelf, op hun versiemap.
  for (const n of inMap.filter(x => x.endsWith(".framework"))) {
    const v = path.join(frameworks, n, "Versions", "A");
    teken(existsSync(v) ? v : path.join(frameworks, n));
  }

  // 3. De helper-apps.
  for (const n of inMap.filter(x => x.endsWith(".app"))) teken(path.join(frameworks, n));

  // 4. En als laatste de app zelf, met de eis die de updates mogelijk maakt.
  teken(app, ["--requirements", eis]);

  /* Controleren dat het echt klopt. Gaat dit mis, dan stopt de build hier -
     liever geen installatiebestand dan een app die bij iemand anders niet
     meer opstart. */
  execFileSync("codesign", ["--verify", "--strict", "--verbose=1", app], { stdio: "inherit" });

  const gelezen = execFileSync("codesign", ["-d", "-r-", app], { encoding: "utf8" })
    .split("\n").find(r => r.startsWith("designated =>")) || "(niet te lezen)";
  console.log(`  • ad-hoc ondertekend met een vaste eis: ${gelezen.trim()}`);
};
