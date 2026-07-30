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
  ["SKT888-G2","Blackpool"],
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
function spaModel(code){
  const n = normCode(code);
  if (!SPA_PREFIXEN.some(p => n.indexOf(p) === 0)) return null;
  for (let i=0;i<SPA_CODES_LANG.length;i++){
    if (n.indexOf(normCode(SPA_CODES_LANG[i][0])) === 0) return SPA_CODES_LANG[i][1];
  }
  return "(onbekend SKT-model)";
}
