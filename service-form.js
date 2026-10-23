/* ═══════════════════════════════════════════════════════════════════════════
   SERVICE - gedeeld voor In te plannen meldingen en Planning Service
   ═══════════════════════════════════════════════════════════════════════════
   Het invulvenster van een ITS-melding (Kevin, document "Service planning",
   23 okt 2026): ITS-nummer ophalen uit Logic4, de verwachte duur (verplicht),
   voorkeursdagen ma-vr, inplannen vanaf en een periode waarin de klant weg
   is. Met "meteen inplannen" plant hij de melding direct en mailt de klant
   (Planning Service: "een ITS-melding invoeren en dat die deze gelijk ergens
   inplant").

   Ook de kleine hulpjes die beide tegels nodig hebben: svc.api, svc.venster,
   datums en de dagdelen. Geen confirm() of alert(): in de app op Windows
   blokkeert daarna het typen; alles gaat in een venster in de pagina.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";
  var W = "https://fonteyn-data-store.g-mulder.workers.dev";
  var ik = (localStorage.getItem("fp.email") || "").toLowerCase();
  function teamKey() { return localStorage.getItem("fp.teamkey") || ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  async function api(pad, body) {
    var o = { headers: { "X-Fonteyn-Auth": teamKey(), "X-Fonteyn-User": ik, "Content-Type": "application/json" } };
    if (body !== undefined) { o.method = "POST"; o.body = JSON.stringify(body); }
    var r = await fetch(W + pad, o);
    var j = await r.json().catch(function () { return null; });
    if (!r.ok && !(j && j.error)) throw new Error("De verbinding lukte nog niet (" + r.status + ").");
    return j || {};
  }
  var DAG = ["zo", "ma", "di", "wo", "do", "vr", "za"];
  var DAGLANG = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
  var DAGDEEL = { 1: "ochtend", 2: "eind ochtend / begin middag", 3: "middag" };
  function datumNL(iso) { if (!iso) return ""; var s = String(iso).slice(0, 10).split("-"); return s.length === 3 ? s[2] + "-" + s[1] + "-" + s[0] : iso; }
  function datumLang(iso) { var d = new Date(iso + "T12:00:00"); return DAGLANG[d.getDay()] + " " + d.getDate() + "-" + (d.getMonth() + 1); }
  function duurTekst(min) { min = Number(min) || 0; var u = Math.floor(min / 60), m = min % 60; return (u ? u + " u" : "") + (u && m ? " " : "") + (m ? m + " min" : "") || "0 min"; }

  /* Een venster in de pagina. Geeft { el, dicht() } terug. */
  function venster(html, opties) {
    opties = opties || {};
    var laag = document.createElement("div");
    laag.className = "svc-laag";
    laag.innerHTML = '<div class="svc-venster' + (opties.breed ? " breed" : "") + '" role="dialog">' + html + "</div>";
    document.body.appendChild(laag);
    function dicht() { if (laag.parentNode) laag.parentNode.removeChild(laag); document.removeEventListener("keydown", toets); }
    function toets(e) { if (e.key === "Escape" && !opties.vast) dicht(); }
    document.addEventListener("keydown", toets);
    laag.addEventListener("mousedown", function (e) { if (e.target === laag && !opties.vast) dicht(); });
    return { el: laag.firstChild, dicht: dicht };
  }
  /* Een vraag met twee knoppen, in plaats van confirm(). */
  function vraag(tekst, jaTekst, neeTekst) {
    return new Promise(function (klaar) {
      var v = venster('<p style="margin:0 0 16px;font-size:14px;line-height:1.5">' + tekst + '</p><div class="svc-knoppen"><button type="button" class="svc-knop wit" data-k="nee">' + esc(neeTekst || "Terug") + '</button><button type="button" class="svc-knop" data-k="ja">' + esc(jaTekst || "Ja") + "</button></div>");
      v.el.querySelectorAll("[data-k]").forEach(function (b) { b.addEventListener("click", function () { v.dicht(); klaar(b.dataset.k === "ja"); }); });
    });
  }

  var CSS = '.svc-laag{position:fixed;inset:0;background:rgba(0,0,0,.38);display:flex;align-items:flex-start;justify-content:center;z-index:60;padding:5vh 12px;overflow:auto}' +
    '.svc-venster{background:#fff;border-radius:14px;max-width:640px;width:100%;padding:20px 22px;box-shadow:0 20px 50px rgba(0,0,0,.25);font-family:Montserrat,system-ui,sans-serif;color:#1f2937}' +
    '.svc-venster.breed{max-width:760px}' +
    '.svc-venster h3{margin:0 0 12px;color:#144734;font-size:17px}' +
    '.svc-velden{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 12px}' +
    '.svc-velden label{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:700;color:#6b7280}' +
    '.svc-velden label.breed{grid-column:1/-1}' +
    '.svc-venster input,.svc-venster select,.svc-venster textarea{font:inherit;font-size:13.5px;border:1px solid #e0e0d8;border-radius:8px;padding:8px 9px;background:#fff;color:#1f2937;min-width:0}' +
    '.svc-venster textarea{min-height:56px;resize:vertical}' +
    '.svc-dagen{display:flex;gap:6px;flex-wrap:wrap}' +
    '.svc-dag{border:1px solid #e0e0d8;background:#fff;border-radius:9px;padding:8px 13px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;color:#1f2937}' +
    '.svc-dag.aan{background:#144734;color:#fff;border-color:#144734}' +
    '.svc-duren{display:flex;gap:6px;flex-wrap:wrap;align-items:center}' +
    '.svc-knoppen{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px}' +
    '.svc-knop{background:#8bc53f;color:#144734;border:0;border-radius:9px;padding:9px 16px;font:inherit;font-weight:700;font-size:13.5px;cursor:pointer;white-space:nowrap}' +
    '.svc-knop:hover{background:#72a531;color:#fff}' +
    '.svc-knop.groen{background:#144734;color:#fff}.svc-knop.groen:hover{background:#0d3325}' +
    '.svc-knop.wit{background:#fff;color:#144734;border:1px solid #e0e0d8;font-weight:600}' +
    '.svc-knop:disabled{opacity:.55;cursor:default}' +
    '.svc-melding{font-size:13px;font-weight:600;margin-top:10px;min-height:1em}.svc-melding.fout{color:#b91c1c}.svc-melding.goed{color:#15803d}' +
    '.svc-its{background:#f7f7f2;border:1px solid #ecebe4;border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.5;margin-bottom:12px;max-height:150px;overflow:auto;white-space:pre-wrap;overflow-wrap:break-word}' +
    '.svc-pil{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#eef2e6;color:#144734;white-space:nowrap}' +
    '.svc-pil.oranje{background:#ffedd5;color:#c2410c}.svc-pil.rood{background:#fee2e2;color:#b91c1c}.svc-pil.groen{background:#dcfce7;color:#14532d}.svc-pil.grijs{background:#f3f4f6;color:#6b7280}' +
    '.svc-uitslag{list-style:none;margin:8px 0 0;padding:0;font-size:13px}.svc-uitslag li{padding:6px 0;border-bottom:1px solid #f0efe8}' +
    '.svc-kop2{font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin:14px 0 4px}';
  var stijl = document.createElement("style"); stijl.textContent = CSS; document.head.appendChild(stijl);

  /* De uitslag van Plannen in leesbare taal. */
  function uitslagHtml(j) {
    if (!j.ok) return '<p class="svc-melding fout">' + esc(j.error || "Plannen lukte nog niet.") + "</p>";
    var h = "";
    if (j.gepland && j.gepland.length) {
      h += '<div class="svc-kop2">' + (j.voorbeeld ? "Zo komt het te staan" : "Ingepland") + " (" + j.gepland.length + ")</div><ul class=\"svc-uitslag\">" +
        j.gepland.map(function (g) { return "<li><b>" + esc(g.naam || ("ITS " + g.its)) + "</b> " + esc(g.plaats || "") + "<br><span style=\"color:#6b7280\">" + esc(datumLang(g.datum)) + " · route " + g.nr + " · " + esc(g.monteur) + " · " + esc(DAGDEEL[g.dagdeel]) + "</span></li>"; }).join("") + "</ul>";
    } else h += '<p style="font-size:13.5px">' + (j.voorbeeld ? "Er is nu niets om in te plannen." : "Er is niets bijgekomen.") + "</p>";
    if (j.over && j.over.length) {
      h += '<div class="svc-kop2">Nog zonder plek (' + j.over.length + ")</div><ul class=\"svc-uitslag\">" +
        j.over.map(function (g) { return "<li><b>" + esc(g.naam || ("ITS " + g.its)) + "</b> <span style=\"color:#6b7280\">ITS " + esc(g.its) + "</span><br><span style=\"color:#c2410c\">" + esc(g.reden) + "</span></li>"; }).join("") + "</ul>";
    }
    if (!j.voorbeeld && (j.gemaild || j.mailWacht || j.mailFout)) {
      h += '<p style="font-size:13px;margin-top:12px">' +
        (j.gemaild ? "<b>" + j.gemaild + "</b> klant(en) gemaild. " : "") +
        (j.mailWacht ? "<b>" + j.mailWacht + "</b> mail(s) staan klaar en gaan mee zodra het mailen aan staat of de dagteller weer ruimte heeft. " : "") +
        (j.mailFout ? "<b>" + j.mailFout + "</b> klant(en) zonder bruikbaar mailadres: vul dat aan bij de melding." : "") + "</p>";
    }
    if (j.waarschuwing) h += '<p class="svc-melding fout">' + esc(j.waarschuwing) + "</p>";
    return h;
  }

  /* Het invulvenster. opties: { its, melding, direct, opgeslagen(j) } */
  function formulier(opties) {
    opties = opties || {};
    var m = opties.melding ? JSON.parse(JSON.stringify(opties.melding)) : null;
    var v = venster('<h3>' + (m ? "Melding ITS " + esc(m.its) : opties.direct ? "Direct inplannen" : "Melding toevoegen") + '</h3><div id="svcFormRomp"></div>', { breed: true, vast: true });
    var romp = v.el.querySelector("#svcFormRomp");
    function stap1() {
      romp.innerHTML = '<div class="svc-velden"><label class="breed">ITS-nummer<input id="svcIts" inputmode="numeric" autocomplete="off" placeholder="bijvoorbeeld 48211" value="' + esc(opties.its || "") + '"></label></div>' +
        '<div class="svc-melding" id="svcMeld"></div><div class="svc-knoppen"><button type="button" class="svc-knop wit" id="svcTerug">Terug</button><button type="button" class="svc-knop" id="svcHaal">Ophalen uit Logic4</button></div>';
      var inp = romp.querySelector("#svcIts");
      setTimeout(function () { inp.focus(); }, 30);
      romp.querySelector("#svcTerug").onclick = v.dicht;
      async function haal() {
        var its = inp.value.replace(/\D/g, "");
        if (!its) { meld("Vul een ITS-nummer in.", "fout"); return; }
        var b = romp.querySelector("#svcHaal"); b.disabled = true; b.textContent = "Bezig…";
        try {
          var j = await api("/service/melding/zoek", { its: its });
          if (!j.ok) { meld(j.error || "Ophalen lukte nog niet.", "fout"); b.disabled = false; b.textContent = "Ophalen uit Logic4"; return; }
          m = Object.assign({ duur: null, voorkeur: [], vanaf: null, nietVan: null, nietTot: null, opmerking: "" }, j.melding);
          stap2(true);
        } catch (e) { meld(e.message, "fout"); b.disabled = false; b.textContent = "Ophalen uit Logic4"; }
      }
      romp.querySelector("#svcHaal").onclick = haal;
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") haal(); });
    }
    function meld(t, soort) { var x = romp.querySelector("#svcMeld"); if (x) { x.textContent = t || ""; x.className = "svc-melding " + (soort || ""); } }
    function stap2(nieuw) {
      var k = m.klant || {};
      var duren = [30, 45, 60, 90, 120, 180];
      var voork = (m.voorkeur || []).map(Number);
      romp.innerHTML =
        ((m.titel || m.tekst || m.omschrijving) ? '<div class="svc-its"><b>' + esc(m.titel || "") + "</b>" + (m.garantie ? ' <span class="svc-pil' + (/^ja/i.test(m.garantie) ? " groen" : " grijs") + '">garantie: ' + esc(m.garantie) + "</span>" : "") + "\n" + esc(m.tekst || m.omschrijving || "") + "</div>" : "") +
        '<div class="svc-velden">' +
          '<label>Naam klant<input id="fNaam" value="' + esc(k.naam) + '"></label>' +
          '<label>Telefoon<input id="fTel" value="' + esc(k.tel) + '"></label>' +
          '<label class="breed">Adres<input id="fAdres" value="' + esc(k.adres) + '" placeholder="straat en huisnummer, postcode plaats"></label>' +
          '<label class="breed">Mailadres (voor het voorstel; meerdere mag, met een komma)<input id="fMail" value="' + esc(k.mail) + '"></label>' +
          '<label class="breed">Verwachte duur van de afspraak (verplicht)<div class="svc-duren">' +
            duren.map(function (d) { return '<button type="button" class="svc-dag' + (Number(m.duur) === d ? " aan" : "") + '" data-duur="' + d + '">' + duurTekst(d) + "</button>"; }).join("") +
            '<input id="fDuur" type="number" min="5" max="600" step="5" style="width:96px" placeholder="minuten" value="' + esc(m.duur || "") + '"> <span style="font-weight:500">minuten</span></div></label>' +
          '<label class="breed">Voorkeursdagen van de klant<div class="svc-dagen">' +
            [1, 2, 3, 4, 5].map(function (d) { return '<button type="button" class="svc-dag' + (voork.indexOf(d) >= 0 ? " aan" : "") + '" data-dag="' + d + '">' + DAGLANG[d] + "</button>"; }).join("") +
            '</div><span style="font-weight:500">Niets aangetikt = elke werkdag.</span></label>' +
          '<label>Inplannen vanaf<input id="fVanaf" type="date" value="' + esc(m.vanaf || "") + '"></label>' +
          '<label>Klant is weg: van<input id="fNietVan" type="date" value="' + esc(m.nietVan || "") + '"></label>' +
          '<label>tot en met<input id="fNietTot" type="date" value="' + esc(m.nietTot || "") + '"></label>' +
          '<label class="breed">Opmerking voor de planning<textarea id="fOpm">' + esc(m.opmerking || "") + "</textarea></label>" +
        "</div>" +
        '<div class="svc-melding" id="svcMeld"></div>' +
        '<div class="svc-knoppen"><button type="button" class="svc-knop wit" id="svcTerug">Terug</button>' +
          (opties.direct ? '<button type="button" class="svc-knop groen" id="svcDirect">Opslaan en meteen inplannen</button>'
                         : '<button type="button" class="svc-knop" id="svcBewaar">' + (nieuw ? "In de lijst zetten" : "Opslaan") + "</button>") +
        "</div>";
      romp.querySelectorAll("[data-duur]").forEach(function (b) { b.onclick = function () { romp.querySelector("#fDuur").value = b.dataset.duur; romp.querySelectorAll("[data-duur]").forEach(function (x) { x.classList.toggle("aan", x === b); }); }; });
      romp.querySelector("#fDuur").oninput = function () { var w = Number(this.value); romp.querySelectorAll("[data-duur]").forEach(function (x) { x.classList.toggle("aan", Number(x.dataset.duur) === w); }); };
      romp.querySelectorAll("[data-dag]").forEach(function (b) { b.onclick = function () { b.classList.toggle("aan"); }; });
      romp.querySelector("#svcTerug").onclick = v.dicht;
      async function bewaar(direct) {
        var duur = Number(romp.querySelector("#fDuur").value) || 0;
        if (!duur) { meld("Vul de verwachte duur in; die is nodig om de route te vullen.", "fout"); romp.querySelector("#fDuur").focus(); return; }
        var body = {
          its: m.its, titel: m.titel, omschrijving: m.omschrijving, tekst: m.tekst, garantie: m.garantie, gemeld: m.gemeld, order: m.order,
          klant: { debiteur: (m.klant || {}).debiteur || null, naam: romp.querySelector("#fNaam").value, tel: romp.querySelector("#fTel").value,
                   adres: romp.querySelector("#fAdres").value, plaats: (m.klant || {}).plaats || "", mail: romp.querySelector("#fMail").value },
          duur: duur,
          voorkeur: Array.prototype.map.call(romp.querySelectorAll("[data-dag].aan"), function (b) { return Number(b.dataset.dag); }),
          vanaf: romp.querySelector("#fVanaf").value || null, nietVan: romp.querySelector("#fNietVan").value || null, nietTot: romp.querySelector("#fNietTot").value || null,
          opmerking: romp.querySelector("#fOpm").value, heropen: !!opties.heropen,
        };
        if ((body.nietVan && !body.nietTot) || (!body.nietVan && body.nietTot)) { meld("Vul bij 'klant is weg' allebei de datums in.", "fout"); return; }
        var knop = romp.querySelector(direct ? "#svcDirect" : "#svcBewaar"); knop.disabled = true; knop.textContent = "Bezig…";
        try {
          var j = await api("/service/melding", body);
          if (!j.ok) { meld(j.error, "fout"); knop.disabled = false; knop.textContent = direct ? "Opslaan en meteen inplannen" : "Opslaan"; return; }
          try { if (global.fpLog) global.fpLog(direct ? "service-direct" : "service-melding", "ITS " + m.its + ", " + duur + " min"); } catch (e) {}
          if (!direct) { v.dicht(); if (opties.opgeslagen) opties.opgeslagen(j); return; }
          var p = await api("/service/plannen", { its: [m.its] });
          romp.innerHTML = uitslagHtml(p) + '<div class="svc-knoppen"><button type="button" class="svc-knop" id="svcOk">Klaar</button></div>';
          romp.querySelector("#svcOk").onclick = function () { v.dicht(); if (opties.opgeslagen) opties.opgeslagen(p); };
        } catch (e) { meld(e.message, "fout"); knop.disabled = false; knop.textContent = "Opnieuw proberen"; }
      }
      var bk = romp.querySelector("#svcBewaar"), dk = romp.querySelector("#svcDirect");
      if (bk) bk.onclick = function () { bewaar(false); };
      if (dk) dk.onclick = function () { bewaar(true); };
      if (!romp.querySelector("#fAdres").value) meld("Het adres ontbreekt nog in Logic4: vul het hier in.", "fout");
      else if (!romp.querySelector("#fMail").value) meld("Er staat nog geen mailadres in Logic4. Vul het in, dan kan het voorstel gemaild worden.", "fout");
    }
    if (m) stap2(false); else stap1();
    if (!m && opties.its) setTimeout(function () { var b = romp.querySelector("#svcHaal"); if (b) b.click(); }, 50);
  }

  /* Voorbeeld van de klantmail, zoals de klant hem krijgt. */
  async function mailVoorbeeld() {
    var v = venster('<h3>Voorbeeld van de klantmail</h3><div class="svc-dagen" id="vbSoort"><button type="button" class="svc-dag aan" data-s="voorstel">Voorstel</button><button type="button" class="svc-dag" data-s="herinnering">Herinnering</button><button type="button" class="svc-dag" data-s="ziek">Monteur ziek</button></div><p id="vbOnderwerp" style="font-size:13px;margin:12px 0 8px"></p><iframe id="vbFrame" title="Voorbeeld" style="width:100%;height:60vh;border:1px solid #e0e0d8;border-radius:10px"></iframe><div class="svc-knoppen"><button type="button" class="svc-knop" id="vbDicht">Sluiten</button></div>', { breed: true });
    v.el.querySelector("#vbDicht").onclick = v.dicht;
    async function laad(soort) {
      v.el.querySelectorAll("[data-s]").forEach(function (b) { b.classList.toggle("aan", b.dataset.s === soort); });
      var j = await api("/service/mail/voorbeeld?soort=" + soort).catch(function (e) { return { ok: false, error: e.message }; });
      v.el.querySelector("#vbOnderwerp").innerHTML = j.ok ? "<b>Onderwerp:</b> " + esc(j.onderwerp) : esc(j.error || "");
      v.el.querySelector("#vbFrame").srcdoc = j.ok ? '<body style="margin:12px;background:#f5f4ef">' + j.html + "</body>" : "";
    }
    v.el.querySelectorAll("[data-s]").forEach(function (b) { b.onclick = function () { laad(b.dataset.s); }; });
    laad("voorstel");
  }

  global.svc = { api: api, esc: esc, venster: venster, vraag: vraag, formulier: formulier, uitslagHtml: uitslagHtml, mailVoorbeeld: mailVoorbeeld,
    datumNL: datumNL, datumLang: datumLang, duurTekst: duurTekst, DAG: DAG, DAGLANG: DAGLANG, DAGDEEL: DAGDEEL, ik: ik };
})(window);
