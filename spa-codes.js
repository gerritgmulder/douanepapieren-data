/* ═══════════════════════════════════════════════════════════════════════
   Spa-fabriekscodes — GEDEELD tussen de tegels.
   Stond eerder los in voorraad.html. Nu Amerika dezelfde proforma-uitlezing
   krijgt, zouden er twee codelijsten ontstaan die uit elkaar gaan lopen —
   precies wat eerder de Mallorca-verwisseling veroorzaakte. Daarom één bestand.
   Gebruikt door: voorraad.html, amerika.html en tools/import-ci.mjs.
   ═══════════════════════════════════════════════════════════════════════ */

/* ====== Spa-catalogus (Codes spas 2025.xlsx) — gesorteerd op codelengte
   zodat de langste prefix-match wint (bv. SKT339G13 vóór SKT339G). ====== */
const SPA_CODES = [
  ["SKT329E2","Repose"],       // toegevoegd 16 jul (Chantal)
  ["SKT888K-1","Sensation"],   // toegevoegd 16 jul (Chantal)
  ["SKT339C ECO","Aquatic 1 ECO"],
  ["SKT339DA-1","Dynamic Deep"],
  ["SKT888A-4S","Happy"],
  ["SKT339G13","Activity 1"],
  ["SKT888-G1","Mallorca Diamond"],
  ["SKT339G12","Activity 1 Deep"],
  ["SKT339G15","Activity 2"],
  ["SKT888-G2","Mallorca Superior"],   // let op: bij kleur "black" is dit een Blackpool — zie KLEUR_REGELS
  ["SKT339G14","Activity 2 Deep"],
  ["SKT339D-1","Aquatic 3 Deep"],
  ["SKT339E-1","Aquatic 5"],
  ["SKT339E-2","Aquatic 6"],
  ["SKT339G16","Balance"],
  ["SKT888I-1","Corsica Diamond"],
  ["SKT888I-2","Corsica Superior"],
  ["SKT339-G4","Energy"],
  ["SKT339-G5","Energy Deep"],
  ["SKT888M-1","Excite Mighty Wave"],
  ["SKT339G11","Vitality"],
  ["SKT339-G6","Fitness 1"],
  ["SKT339G10","Vitality Deep"],
  ["SKT339-G7","Fitness 1 Deep"],
  ["SKT339G17","Vital Ice"],
  ["SKT339-G2","Fitness 2"],
  ["SKT339-G3","Fitness 2 Deep"],
  ["SKT888X-1","Flame"],
  ["SKT338-E2","Florida"],
  ["SKT306-C","Malta"],
  ["SKT888CA","Pleasure"],
  ["SKT329E1","Repose"],
  ["SKT329FB","Refresh"],
  ["SKT888BA","Admire"],
  ["SKT329EA","Relax"],
  ["SKT335HA","Renew"],
  ["SKT888DA","Bliss"],
  ["SKT888D","Bliss"],   // fabriek schrijft de Bliss soms zonder de A (bevestigd door Chantal, 28-07-2026)
  // Zelfde patroon bij de Heart: op de proforma van 3352 staat SKT888E, terwijl
  // het tabblad 'customer request' in datzelfde bestand "2x Heart" met code
  // 888EA noemt. Blijkt dus uit het document zelf.
  ["SKT888E","Heart"],
  ["SKT329FA","Rewind"],
  ["SKT888K1","Sensation"],
  ["SKT338A3","Bright"],
  ["SKT333H1","Serene 3"],
  ["SKT333H3","Serene 5"],
  ["SKT335FA","Soulmate"],
  ["SKT888AA","Delight"],
  ["SKT888AB","Solace"],
  ["SKT888C1","Desire"],
  ["SKT888BC","Devotion"],
  ["SKT339DA","Dynamic"],
  ["SKT339G1","Spirit Deep"],
  ["SKT338A4","Sunny"],
  ["SKT888FA","Ecstatic Mighty Wave"],
  ["SKT888H1","Tenerife Diamond"],
  ["SKT888H2","Tenerife Luxury"],
  ["SKT888KA","Euphoria"],
  ["SKT888JA","Felicity Mighty Wave"],
  ["SKT888EA","Heart"],
  ["SKT888MA","Joy"],
  ["SKT888G","Mallorca Luxury"],
  ["SKT339C","Aquatic 1"],
  ["SKT306B","Natural"],
  ["SKT888T","Oasis"],
  ["SKT339B","Aquatic 2"],
  ["SKT335F","Oxford"],
  ["SKT339D","Aquatic 3"],
  ["SKT306D","Recharge"],
  ["SKT329A","Arizona"],
  ["SKT329F","Resort"],
  ["SKT888V","Breeze"],
  ["SKT333H","Serene 2"],
  ["SKT888I","Corsica Luxury"],
  ["SKT333A","Serene 6"],
  ["SKT335A","Coventry"],
  ["SKT888X","Spark"],
  ["SKT339G","Spirit"],
  ["SKT888Y","Summit"],
  ["SKT888F","Ecstatic"],
  ["SKT666A","Sydney"],
  ["SKT888H","Tenerife Superior"],
  ["SKT888Q","Spa Exhilarate Mighty Wave"],
  ["SKT339F","Theater"],
  ["SKT888U","Aurora"],
  ["SKT888P","Harmony"],
  ["SKT888S","Indulgence"],
  ["SKT888R","Lagoon"],
  // Passion Devine — de fabriek gebruikt hier een PP-code in plaats van SKT
  // (Chantal, 29-07-2026).
  ["PP01","Reflect"],
  ["PP02","Retreat"],
  ["PP03","Resettle"],
  /* ── Andere fabrieken dan Jazzi (Chantal, 4 aug 2026) ──────────────────
     Chantal heeft de codelijsten van vier fabrieken opgevraagd nadat een
     commercial invoice van Kasdaly niet ingelezen kon worden. Prijzen en
     contactpersonen staan in spa-fabrikanten.js, zodat zij ze kan nakijken. */
  // Guangdong Kasdaly Pool Spa Equipment — Grizzly Spas
  ["JY8805","Kenai"],
  ["JY8810","Kodiak"],
  ["JY8603","Calgary"],
  ["JY8602","Vancouver"],
  ["JY8601","Anchorage"],
  // Guangzhou Huantong Industry — Tropic Spas / Lovia spas
  ["ZR7011","Aruba"],
  ["ZR6005","Bermuda"],
  ["ZR6006","Jamaica"],
  ["ZR801","Montego"],
  ["ZR803","Key Largo"],
  ["ZR804","Bahamas"],
  // Guangzhou New Normal Bath Ware — Sea star spas
  ["EX-180","Spa Hope"],
  ["EX-155","Spa Believe"],
  ["ET-160","Spa Wonder"],
  ["S-1501","Spa Miracle"],
  ["S-2202","Spa Vision"],
  ["ET-165","Spa Praise"],   // code bevestigd door Chantal, 4 aug 2026
  // Foshan Gaoming Yuehua Sanitary (MEXDA) — Storm Spas
  ["WS-PC05ST","Turbine 5"],
  ["WS-PC06ST","Turbine 6"],
  ["WS-PC07ST","Turbine 7"],
  ["WS-S06","Aquatic 9"],
  ["WS-692","Monsoon"],
  ["WS-696","Cyclone"],
  ["WS-506M","Hurricane"],
];
// Alles wat geen letter of cijfer is gaat eruit. De fabrieken schrijven dezelfde
// code namelijk verschillend: wij hebben "SKT888-G1" in de codelijst staan, de
// fabriek zet het streepje ergens anders ("SKT888G-1") of laat het weg
// ("SKT888G1"). Zonder deze normalisatie viel "SKT888G-1" (Mallorca Diamond)
// terug op de kortere prefix "SKT888G" en werd het Mallorca Luxury genoemd.
function normCode(c){ return String(c==null?"":c).toUpperCase().replace(/[^A-Z0-9]/g,""); }
// Langste code eerst, zodat een specifiekere code altijd wint van een kortere
// die er toevallig het begin van is (SKT888G1 vóór SKT888G, SKT339G13 vóór
// SKT339G1). De volgorde in SPA_CODES doet er daardoor niet meer toe.
const SPA_CODES_LANG = SPA_CODES.slice().sort((a,b)=>normCode(b[0]).length-normCode(a[0]).length);
// Geeft modelnaam als de productcode een spa is, anders null. Fabriekscodes
// beginnen met SKT (Jazzi) of met PP (Passion Devine — PP01/PP02/PP03).
// LET OP: "(onbekend SKT-model)" is een vaste herkenningswaarde die op meerdere
// plekken vergeleken wordt; die tekst niet wijzigen.
const SPA_PREFIXEN = ["SKT","PP"];

/* ══ Waar de kleur het model bepaalt ══════════════════════════════════════
   SKT888-G2 is officieel een Mallorca Superior. Staat er "black" bij de kleur,
   dan noemt Logic4 hem Blackpool — dezelfde spa, andere naam (Chantal,
   4 aug 2026). Tot nu toe stond SKT888-G2 hard op Blackpool, waardoor élke
   Mallorca Superior in sterling white, pearl shadow of ABS white als Blackpool
   werd ingelezen.

   Dit is geen uitzondering die je in een parser wilt verstoppen: het is een
   afspraak van de inkoop die nergens anders vastligt. Vandaar hier, met de
   reden erbij. */
const KLEUR_REGELS = [
  { code: "SKT888-G2", standaard: "Mallorca Superior",
    uitzonderingen: [{ kleur: /\bblack\b/i, model: "Blackpool" }] },
];

/* Zelfde als spaModel(), maar met de kleur erbij. Gebruik deze overal waar de
   kleur bekend is — op een commercial invoice staat hij in een eigen kolom. */
function spaModelMetKleur(code, kleur){
  const basis = spaModel(code);
  if (!basis) return basis;
  const n = normCode(code);
  for (const regel of KLEUR_REGELS){
    if (n.indexOf(normCode(regel.code)) !== 0) continue;
    for (const u of regel.uitzonderingen){
      if (u.kleur.test(String(kleur == null ? "" : kleur))) return u.model;
    }
    return regel.standaard;
  }
  return basis;
}
function spaModel(code){
  const n = normCode(code);
  if (!n) return null;
  // Eerst de codelijst zelf. Sinds er ook fabrieken bij zitten die JY, ZR, EX,
  // ET, S- of WS-codes gebruiken, kan er niet meer op een prefix worden
  // voorgeselecteerd: dan zou "S-1501" nooit gevonden worden.
  for (let i=0;i<SPA_CODES_LANG.length;i++){
    if (n.indexOf(normCode(SPA_CODES_LANG[i][0])) === 0) return SPA_CODES_LANG[i][1];
  }
  // Staat hij er niet in maar begint hij wél als een bekende fabriekscode, dan
  // is het een spa waarvan wij het model nog niet weten. Dat is iets anders dan
  // "geen spa" en moet dus gemeld worden.
  if (SPA_PREFIXEN.some(p => n.indexOf(p) === 0)) return "(onbekend SKT-model)";
  return null;
}
