/* ═══════════════════════════════════════════════════════════════════════
   Proforma invoice → inkooporder in Logic4 — GEDEELD door voorraad.html
   (Nederland) en amerika.html (Warehouse Texas).

   Twee stappen, bewust gescheiden: eerst een voorstel dat een mens controleert,
   pas daarna het echte wegschrijven. De tegel roept fpProforma.start(opts) aan
   met de dingen die per tegel verschillen.

   Vereist in de pagina: XLSX, spa-codes.js, en elementen met de ids
   ikoFile, ikoRef, ikoEta, ikoStatus en ikoVoorstel.
   ═══════════════════════════════════════════════════════════════════════ */
(function(){
var WORKER="https://fonteyn-data-store.g-mulder.workers.dev";
var IKO_VOORSTEL_URL=WORKER+"/voorraad/inkooporder/voorstel";
var IKO_AANMAAK_URL=WORKER+"/voorraad/inkooporder/aanmaken";
var C={teamKey:function(){return ""},adminKey:function(){return ""},magWijzigen:false,email:"",bestemming:null,log:function(){}};
function el(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];}); }
// ===== Proforma invoice → inkooporder (Chantal & Manon, 29 jul) ===========
// Zelfde soort werkboek als de commercial invoice, maar dan vóóraf: wat er bij
// de fabriek besteld wordt. We lezen de regels uit, laten ze controleren en
// schrijven pas na akkoord een inkooporder in Logic4.
var ikoLaatst=null;
function ikoStatus(soort,tekst){
  const e=document.getElementById("ikoStatus"); if(!e) return;
  if(!tekst){ e.classList.add("hidden"); return; }
  e.className="status-msg "+soort; e.textContent=tekst; e.classList.remove("hidden");
}
// Per regel uitlezen (niet opgeteld zoals bij de commercial invoice): de
// inkooporder heeft juist elke afzonderlijke regel nodig.
// Het echte proforma staat op het tabblad 'PI'. Het tabblad 'customer request'
// is Chantals eigen bestelmail aan de fabriek (zonder prijzen, met kale codes
// als 888G2); dat gebruiken we alleen als er geen PI is. De kolommen worden uit
// de kopregel gehaald en niet vastgepind, zodat een verschoven kolom in het
// template van de fabriek de uitlezing niet meteen sloopt.
function parseProforma(wb){
  const naam=wb.SheetNames.find(n=>/^pi$/i.test(String(n).trim()))
          || wb.SheetNames.find(n=>/proforma/i.test(n))
          || wb.SheetNames[0];
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[naam],{header:1,defval:null,blankrows:false});

  let leverancier=null, referentie=null;
  for(const r of rows.slice(0,20)) for(const c of (r||[])){
    const s=String(c==null?"":c).trim();
    if(!leverancier&&/^seller\s*:/i.test(s)) leverancier=s.replace(/^seller\s*:\s*/i,"").trim();
    if(!referentie&&/order\s*no\.?\s*:/i.test(s)) referentie=s.replace(/.*order\s*no\.?\s*:\s*/i,"").trim();
  }

  let kop=-1,kMod=0,kKleur=1,kSkirt=-1,kAantal=-1,kPrijs=-1;
  for(let i=0;i<Math.min(rows.length,30);i++){
    const r=(rows[i]||[]).map(x=>String(x==null?"":x).trim().toUpperCase());
    if(r.indexOf("MODEL")>=0&&r.some(x=>/QUANT/.test(x))){
      kop=i; kMod=r.indexOf("MODEL");
      const kl=r.findIndex(x=>/COLOU?R/.test(x)); if(kl>=0) kKleur=kl;
      kSkirt=r.findIndex(x=>/^SKIRT/.test(x));
      kAantal=r.findIndex(x=>/QUANT/.test(x));
      kPrijs=r.findIndex(x=>/^RATE|PRICE|UNIT/.test(x));
      break;
    }
  }
  if(kop<0) return {fout:"kopregel met MODEL en QUANTITY niet gevonden op tabblad '"+naam+"'",regels:[]};

  const regels=[];
  for(const r of rows.slice(kop+1)){
    const eerste=String((r&&r[kMod])==null?"":r[kMod]).split("\n")[0].trim();
    if(!eerste) continue;                       // o.a. de GRAND TOTAL-regel
    const aantal=Number(r&&r[kAantal]);
    if(!isFinite(aantal)||aantal<=0) continue;
    // Elke fabriekscode bevat cijfers en begint met hooguit een paar letters:
    // SKT888G-2 en PP01 (Jazzi/Devine), JY8805 (Kasdaly), ZR7011 (Huantong),
    // EX-180, ET-165, S-1501 (New Normal), WS-PC05ST (Mexda).
    //
    // Hier stond eerder /^((?:SKT|PP)[\w.-]*|[0-9][\w.-]*)/, en dat sloeg élke
    // regel van de drie nieuwe fabrieken over: JY, ZR, EX, ET, S- en WS-codes
    // beginnen niet met SKT, PP of een cijfer. Een proforma van Kasdaly leverde
    // daardoor een leeg voorstel op zonder dat er iets misging (4 aug 2026).
    const m=eerste.match(/^([A-Z]{0,3}[-.]?\d[\w.\-]*|(?:SKT|PP|WS)[\w.\-]*)/i);
    if(!m) continue;
    let code=m[1].toUpperCase().replace(/\s+/g,"");
    // Alleen Jazzi's eigen bestelmail zet de code kaal neer (888G2 in plaats van
    // SKT888G-2). Een code die al met letters begint hoort ongemoeid te blijven,
    // anders wordt JY8805 stilletjes SKTJY8805 en vindt niemand hem meer.
    if(/^\d/.test(code)) code="SKT"+code;
    const kleurTekst=String((r&&r[kKleur])==null?"":r[kKleur]);
    // Kleur kan het model bepalen: SKT888-G2 is een Mallorca Superior, maar in
    // het zwart heet hij Blackpool (Chantal, 4 aug 2026). Daarom niet spaModel
    // maar spaModelMetKleur, precies zoals de commercial invoice het doet.
    const mo=(typeof spaModelMetKleur==="function")?spaModelMetKleur(code,kleurTekst):spaModel(code);
    const prijs=kPrijs>=0?Number(r[kPrijs]):NaN;
    regels.push({
      code,
      model:(mo&&mo!=="(onbekend SKT-model)")?mo:null,
      kleur:String((r&&r[kKleur])==null?"":r[kKleur]).replace(/\bjazzi\s*colou?r\b/ig,"").replace(/[,\s]+$/,"").trim()||null,
      // De omkasting bepaalt of het "GREY/oak trim" of "OAK/grey trim" wordt.
      // Zonder die kolom leveren twee regels met dezelfde kleur dezelfde
      // artikelcode op, terwijl het verschillende artikelen zijn (Chantal).
      skirt:kSkirt>=0?(String((r&&r[kSkirt])==null?"":r[kSkirt]).replace(/\s+/g," ").trim()||null):null,
      aantal, prijs:(isFinite(prijs)&&prijs>0)?prijs:null,
    });
  }
  return {tabblad:naam,leverancier,referentie,regels};
}
function renderIkoVoorstel(v){
  const box=document.getElementById("ikoVoorstel"); if(!box) return;
  const w=(v.waarschuwingen||[]);
  box.innerHTML=
    (w.length?"<div class='status-msg warn'><b>Controleer dit eerst:</b><ul style='margin:6px 0 0;padding-left:18px'>"+
      w.map(x=>"<li>"+esc(x)+"</li>").join("")+"</ul></div>":"")+
    "<div class='actions' style='gap:10px;align-items:center;margin:0 0 10px;flex-wrap:wrap'>"+
      "<label style='font-size:12px;color:var(--muted)'>Leverancier</label>"+
      "<select id='ikoCred' style='min-width:260px;padding:8px'>"+
        "<option value=''>— kies leverancier —</option>"+
        (v.leveranciers||[]).map(c=>"<option value='"+c.id+"'"+((v.crediteur&&v.crediteur.id===c.id)?" selected":"")+">"+esc(c.naam)+"</option>").join("")+
      "</select>"+
      "<span style='font-size:12px;color:var(--muted)'>"+(v.regels||[]).length+" regel(s) · "+v.totaalStuks+" spa's</span>"+
    "</div>"+
    "<div class='tablewrap'><table class='grid'><thead><tr><th>Fabriekscode</th><th>Spa</th><th>Kleur</th><th>Omkasting</th><th>Aantal</th><th>Artikelcode Logic4</th><th>Omschrijving</th><th>Niet meebestellen</th></tr></thead><tbody>"+
    (v.regels||[]).map((r,i)=>"<tr data-rij='"+i+"'"+(r.artikelcode?(r.zeker?"":" style='background:#fef3c7'"):" style='background:#fee2e2'")+">"+
      "<td>"+esc(r.code||"—")+"</td><td><b>"+esc(r.model||"onbekend")+"</b></td><td>"+esc(r.kleur||"—")+"</td>"+
      "<td style='font-size:11.5px'>"+esc(r.skirt||"—")+"</td>"+
      "<td>"+r.aantal+"</td><td>"+esc(r.artikelcode||"— niet gevonden —")+"</td>"+
      "<td style='font-size:11.5px;color:var(--muted)'>"+esc(r.omschrijving||"")+"</td>"+
      "<td style='text-align:center'>"+(r.artikelcode?"":"<input type='checkbox' class='ikoSkip' data-rij='"+i+"' title='deze regel niet meebestellen'>")+"</td>"+
      "</tr>").join("")+
    "</tbody></table></div>"+
    "<div class='actions' style='margin-top:12px'>"+
      "<button class='btn solid' id='ikoAanmaken' type='button'"+(C.magWijzigen?"":" disabled")+">Inkooporder aanmaken in Logic4</button>"+
      "<button class='btn' id='ikoWissen' type='button'>Opnieuw beginnen</button>"+
      "<span id='ikoTelling' style='font-size:11.5px;color:var(--muted)'></span>"+
    "</div>"+
    "<p class='lead' style='font-size:11.5px;margin-top:6px'>Geel = de kleur is niet zeker herkend, controleer de artikelcode. Rood = er is in Logic4 geen artikel voor dit model in deze kleur; los dat daar op óf vink <b>Niet meebestellen</b> aan. Aanmaken zet een inkooporder in Logic4 — er gaat niets naar de fabriek.</p>";
  document.getElementById("ikoAanmaken").addEventListener("click",ikoAanmaken);
  // Een geüploade proforma wordt nergens bewaard — hij staat alleen op het
  // scherm. 'Opnieuw beginnen' maakt dat zichtbaar, zodat duidelijk is dat er
  // niets terug te draaien valt zolang je niet op aanmaken hebt geklikt.
  document.getElementById("ikoWissen").addEventListener("click",function(){
    ikoLaatst=null;
    el("ikoVoorstel").innerHTML="";
    el("ikoRef").value=""; el("ikoEta").value="";
    ikoStatus("ok","Leeggemaakt. Er is niets opgeslagen — je kunt de proforma opnieuw uploaden.");
  });
  document.querySelectorAll(".ikoSkip").forEach(cb=>cb.addEventListener("change",ikoTel));
  ikoTel();
}
// Welke regels gaan er daadwerkelijk mee, en hoeveel laat je bewust liggen.
function ikoMeeTeBestellen(){
  const over=new Set([...document.querySelectorAll(".ikoSkip")].filter(c=>c.checked).map(c=>Number(c.dataset.rij)));
  const alle=(ikoLaatst&&ikoLaatst.regels)||[];
  return {mee:alle.filter((r,i)=>r.artikelcode&&!over.has(i)),
          overgeslagen:alle.filter((r,i)=>!r.artikelcode&&over.has(i)),
          blokkeert:alle.filter((r,i)=>!r.artikelcode&&!over.has(i))};
}
function ikoTel(){
  const t=document.getElementById("ikoTelling"); if(!t) return;
  const s=ikoMeeTeBestellen();
  const stuks=s.mee.reduce((n,r)=>n+r.aantal,0);
  t.innerHTML=s.blokkeert.length
    ? "<span style='color:#b91c1c'>"+s.blokkeert.length+" regel(s) zonder artikelcode — los op of vink 'niet meebestellen' aan.</span>"
    : s.mee.length+" regel(s) · "+stuks+" spa's"+(s.overgeslagen.length?(" · <b style='color:#c2410c'>"+s.overgeslagen.length+" regel(s) worden NIET meebesteld</b>"):"");
}
async function ikoAanmaken(){
  const knop=document.getElementById("ikoAanmaken");
  const cred=Number((document.getElementById("ikoCred")||{}).value||0);
  if(!cred){ ikoStatus("bad","Kies eerst de leverancier."); return; }
  const s=ikoMeeTeBestellen();
  if(s.blokkeert.length){ ikoStatus("bad",s.blokkeert.length+" regel(s) hebben geen artikelcode — los dat op of vink 'niet meebestellen' aan."); return; }
  if(!s.mee.length){ ikoStatus("bad","Er blijft geen enkele regel over om te bestellen."); return; }
  const ref=(document.getElementById("ikoRef").value||"").trim();
  const aantal=s.mee.reduce((n,r)=>n+r.aantal,0);
  if(!confirm("Inkooporder aanmaken in Logic4?\n\n"+s.mee.length+" regels · "+aantal+" spa's"+(ref?("\nProforma: "+ref):"")+
    (s.overgeslagen.length?("\n\nLET OP: "+s.overgeslagen.length+" regel(s) gaan NIET mee ("+
      s.overgeslagen.map(r=>r.aantal+"x "+(r.model||r.code)).join(", ")+"). Die moet je zelf bestellen."):"")+
    "\n\nDit maakt een inkooporder aan in Logic4. Er gaat niets naar de fabriek.")) return;
  knop.disabled=true; knop.textContent="Bezig…";
  try{
    const r=await fetch(IKO_AANMAAK_URL,{method:"POST",
      headers:{"Content-Type":"application/json","X-DP-Admin":C.adminKey()},
      body:JSON.stringify({crediteurId:cred,regels:s.mee,referentie:ref,bestemming:C.bestemming,
        overgeslagen:s.overgeslagen.map(r=>r.aantal+"x "+(r.model||r.code)),
        eta:(document.getElementById("ikoEta").value||null),door:(C.email)})});
    const j=await r.json().catch(()=>({}));
    if(j.dubbel){ ikoStatus("warn",j.error); knop.disabled=false; knop.textContent="Inkooporder aanmaken in Logic4"; return; }
    if(!j.ok&&!j.buyOrderId) throw new Error(j.error||("HTTP "+r.status));
    if(j.mislukt&&j.mislukt.length){
      ikoStatus("warn","Inkooporder "+j.buyOrderId+" aangemaakt met "+j.toegevoegd+" regel(s), maar "+j.mislukt.length+" regel(s) niet: "+
        j.mislukt.map(m=>m.artikelcode+" ("+m.fout+")").join("; ")+" — vul die handmatig aan in Logic4.");
    }else{
      ikoStatus("ok","Inkooporder "+j.buyOrderId+" aangemaakt in Logic4 met "+j.toegevoegd+" regel(s).");
      knop.textContent="Aangemaakt ✓";
    }
    try{ if(C.log) C.log("inkooporder-aangemaakt","Logic4 inkooporder "+j.buyOrderId+" · "+j.toegevoegd+" regels"+(ref?(" · proforma "+ref):"")); }catch(e){}
  }catch(e){ ikoStatus("bad","Aanmaken faalde: "+e.message); knop.disabled=false; knop.textContent="Inkooporder aanmaken in Logic4"; }
}
function koppelBestandsveld(){ var inp=el("ikoFile"); if(!inp) return; inp.addEventListener("change",async function(ev){
  const f=(ev.target.files||[])[0]; if(!f) return;
  ikoStatus("","");
  document.getElementById("ikoVoorstel").innerHTML="";
  ikoStatus("info","Inlezen…");
  try{
    const wb=XLSX.read(await f.arrayBuffer(),{type:"array"});
    const p=parseProforma(wb);
    if(p.fout) throw new Error(p.fout+". Tabbladen in dit bestand: "+wb.SheetNames.join(", "));
    if(!p.regels.length) throw new Error("op tabblad '"+p.tabblad+"' staan geen spa-regels. Tabbladen in dit bestand: "+wb.SheetNames.join(", "));
    // Referentie uit het document zelf ("Order No.: RZ2009DF3352 to Rotterdam"),
    // want dat is waarop we later herkennen of een proforma al besteld is.
    if(!document.getElementById("ikoRef").value)
      document.getElementById("ikoRef").value=(p.referentie||f.name.replace(/\.[a-z]+$/i,"")).slice(0,60);
    const r=await fetch(IKO_VOORSTEL_URL,{method:"POST",
      headers:{"Content-Type":"application/json","X-Fonteyn-Auth":C.teamKey()},
      body:JSON.stringify({leverancier:p.leverancier,regels:p.regels})});
    const v=await r.json().catch(function(){ return {}; });
    // Zeg wát er misging. "voorstel maken faalde" liet iemand met lege handen
    // staan; met de status erbij is meteen duidelijk of het aan de inlog ligt.
    if(!r.ok||!v.ok){
      if(r.status===401) throw new Error("het dashboard is niet ontgrendeld op deze computer. Log opnieuw in via het dashboard, dan wordt de sleutel opgehaald.");
      throw new Error((v.error||("de server antwoordde met HTTP "+r.status))+" — het bestand zelf is wel goed uitgelezen ("+p.regels.length+" regels).");
    }
    ikoLaatst=v; renderIkoVoorstel(v);
    ikoStatus("ok","Uitgelezen van tabblad '"+p.tabblad+"': "+v.regels.length+" regel(s), "+v.totaalStuks+" spa's"+
      (p.leverancier?(" · "+p.leverancier):"")+". Controleer hieronder en klik pas daarna op aanmaken.");
  }catch(e){ ikoStatus("bad","Kon niet inlezen: "+e.message); }
  ev.target.value="";
  });
}

window.fpProforma={
  start:function(opts){
    C=Object.assign(C,opts||{});
    koppelBestandsveld();
  }
};
})();
