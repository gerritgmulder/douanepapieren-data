/* ═══════════════════════════════════════════════════════════════════════════
   TELEFOON - elke tegel prettig op een telefoon, zonder iets aan de werking
   ═══════════════════════════════════════════════════════════════════════════

   Gerrit (8 okt 2026): "Ik wil dat je voorraadbeheer wel echt
   gebruiksvriendelijker maakt voor mobiel. Die tabbladen moeten gewoon een
   drop down menu worden met mooie buttons en niet letterlijk dezelfde UI als
   desktop natuurlijk. Dus wel dezelfde werking maar een veel betere UI.
   Hetzelfde geldt voor de andere tegels die nu beschikbaar zijn voor
   telefoon."

   Dit bestand doet alleen iets op een smal scherm (tot 700 pixels) en
   verandert niets aan wat een knop doet:

     - Tabbladen: een rij met meer dan drie tabbladen wordt één grote knop met
       het onderdeel waar je bent. Tik erop en er schuift een menu met grote
       knoppen van onderen in. Kies je er een, dan wordt het échte tabblad
       aangeklikt; de tegel werkt dus precies zoals op de pc. Twee of drie
       tabbladen worden een schakelaar over de hele breedte.
     - Tabellen: elke rij wordt een kaartje met de kolomnaam bij elke waarde.
     - Invoervelden 16 pixels, zodat de iPhone niet inzoomt; knoppen groot
       genoeg voor een duim.
     - Lange uitlegteksten klappen in tot drie regels, met "meer" eronder.

   Geladen door kop.js, dus in elke tegel met de gewone kop. OTA via het
   manifest; nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";
  var doc = global.document;
  if (!doc || global.__fpTelefoon) return;
  global.__fpTelefoon = true;

  /* Zonder viewport tekent een telefoon de pagina 980 pixels breed en
     verkleint alles (Amerika had er geen). Dan zetten we hem er zelf in. */
  if (!doc.querySelector("meta[name=viewport]")) {
    var vp = doc.createElement("meta");
    vp.name = "viewport"; vp.content = "width=device-width, initial-scale=1";
    (doc.head || doc.documentElement).appendChild(vp);
  }
  var SMAL = global.matchMedia ? global.matchMedia("(max-width: 700px)") : { matches: false, addListener: function(){} };
  function zetStand() { doc.documentElement.classList.toggle("fp-tel", !!SMAL.matches); }
  zetStand();
  if (SMAL.addEventListener) SMAL.addEventListener("change", zetStand); else if (SMAL.addListener) SMAL.addListener(zetStand);

  var KLEUR = "var(--fonteyn-green,var(--groen,#144734))";
  var st = doc.createElement("style");
  st.id = "fpTelefoonStijl";
  st.textContent = [
    /* tabbladen: de grote knop en het menu */
    ".fp-tabkeus{display:none}",
    "html.fp-tel .fp-tabkeus{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;margin:6px 0 14px;padding:12px 16px;",
      "border:0;border-radius:14px;background:" + KLEUR + ";color:#fff;font:inherit;font-size:16px;font-weight:700;text-align:left;",
      "box-shadow:0 4px 14px rgba(20,71,52,.25);cursor:pointer;-webkit-tap-highlight-color:transparent}",
    "html.fp-tel .fp-tabkeus .fp-wat{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "html.fp-tel .fp-tabkeus .fp-klein{display:block;font-size:11px;font-weight:600;opacity:.75;letter-spacing:.04em;text-transform:uppercase;margin-bottom:1px}",
    "html.fp-tel .fp-tabkeus .fp-pijl{flex:0 0 auto;width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:14px}",
    "html.fp-tel .fp-tabs-weg{display:none!important}",
    ".fp-blad{position:fixed;inset:0;z-index:4000;background:rgba(17,24,39,.42);display:flex;align-items:flex-end;opacity:0;transition:opacity .18s ease}",
    ".fp-blad.open{opacity:1}",
    ".fp-blad .fp-paneel{width:100%;max-height:82vh;overflow:auto;background:#fff;border-radius:20px 20px 0 0;padding:10px 14px calc(18px + env(safe-area-inset-bottom));",
      "box-sizing:border-box;transform:translateY(100%);transition:transform .22s ease;box-shadow:0 -10px 30px rgba(0,0,0,.18)}",
    ".fp-blad.open .fp-paneel{transform:translateY(0)}",
    ".fp-blad .fp-greep{width:42px;height:5px;border-radius:3px;background:#d1d5db;margin:2px auto 12px}",
    ".fp-blad .fp-titel{font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin:0 4px 10px}",
    ".fp-blad .fp-optie{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;box-sizing:border-box;min-height:54px;margin:0 0 8px;",
      "padding:12px 16px;border:1px solid #e5e7eb;border-radius:14px;background:#f9fafb;color:#111827;font:inherit;font-size:16px;font-weight:600;text-align:left;cursor:pointer}",
    ".fp-blad .fp-optie.aan{background:" + KLEUR + ";border-color:transparent;color:#fff}",
    ".fp-blad .fp-optie .fp-vink{font-size:18px}",
    /* twee of drie tabbladen: een schakelaar */
    "html.fp-tel .fp-seg{display:flex!important;flex-wrap:nowrap!important;gap:4px!important;padding:4px!important;margin:6px 0 14px!important;background:#eef0ec!important;",
      "border-radius:14px!important;border:0!important;overflow:hidden}",
    "html.fp-tel .fp-seg{flex-wrap:wrap!important}",
    "html.fp-tel .fp-seg>:not(.tab):not(.tab-btn):not([role=tab]){flex:1 1 100%!important;order:9;background:#fff!important;border:1px solid #e5e7eb!important}",
    "html.fp-tel .fp-seg>:is(.tab,.tab-btn,[role=tab]){flex:1 1 0!important;min-width:0!important;margin:0!important;padding:10px 6px!important;border:0!important;border-radius:10px!important;",
      "background:transparent!important;font-size:14px!important;font-weight:600!important;text-align:center!important;white-space:normal!important;line-height:1.2!important}",
    "html.fp-tel .fp-seg>.active,html.fp-tel .fp-seg>.aan,html.fp-tel .fp-seg>.actief,html.fp-tel .fp-seg>[aria-selected=true]{background:#fff!important;color:" + KLEUR + "!important;box-shadow:0 1px 4px rgba(0,0,0,.12)!important}",
    "html.fp-tel .fp-seg>*::after{display:none!important}",
    /* tabellen als kaartjes */
    "html.fp-tel table.fp-kaart thead{display:none}",
    "html.fp-tel table.fp-kaart,html.fp-tel table.fp-kaart tbody,html.fp-tel table.fp-kaart tr{display:block;width:100%}",
    "html.fp-tel table.fp-kaart tr{border:1px solid #e5e7eb;border-radius:12px;margin:0 0 10px;padding:6px 2px;background:#fff;box-sizing:border-box}",
    "html.fp-tel table.fp-kaart td{display:flex;justify-content:space-between;align-items:baseline;gap:12px;border:0!important;padding:4px 10px!important;text-align:right;white-space:normal!important;max-width:none!important}",
    "html.fp-tel table.fp-kaart td,html.fp-tel table.fp-kaart th{width:auto!important;min-width:0!important;position:relative!important;left:auto!important}",
    "html.fp-tel table.fp-kaart td::before{content:attr(data-label);flex:0 0 auto;max-width:46%;text-align:left;color:#6b7280;font-size:12px;font-weight:600}",
    "html.fp-tel table.fp-kaart td:not([data-label])::before,html.fp-tel table.fp-kaart td[data-label='']::before{content:none}",
    "html.fp-tel table.fp-kaart td:not([data-label]),html.fp-tel table.fp-kaart td[data-label='']{justify-content:flex-start;text-align:left}",
    "html.fp-tel table.fp-kaart td[colspan]{display:block;text-align:left}",
    "html.fp-tel table.fp-kaart td[colspan]::before{content:none}",
    "html.fp-tel table.fp-kaart tfoot{display:block}",
    /* Een cel met een invoerveld: de kolomnaam erboven, het veld over de hele breedte. */
    "html.fp-tel table.fp-kaart td:has(input:not([type=checkbox]):not([type=radio])),html.fp-tel table.fp-kaart td:has(select),html.fp-tel table.fp-kaart td:has(textarea){display:block;text-align:left}",
    "html.fp-tel table.fp-kaart td:has(input:not([type=checkbox]):not([type=radio]))::before,html.fp-tel table.fp-kaart td:has(select)::before,html.fp-tel table.fp-kaart td:has(textarea)::before{display:block;max-width:none;margin:0 0 3px}",
    "html.fp-tel table.fp-kaart td input:not([type=checkbox]):not([type=radio]),html.fp-tel table.fp-kaart td select,html.fp-tel table.fp-kaart td textarea{width:100%!important;min-width:0!important;box-sizing:border-box}",
    "html.fp-tel table.fp-kaart td::before{white-space:normal;word-break:normal;overflow-wrap:normal}",
    "html.fp-tel table.fp-kaart td input:not([type=checkbox]):not([type=radio]),html.fp-tel table.fp-kaart td select,html.fp-tel table.fp-kaart td textarea{border:1px solid #d1d5db!important;border-radius:9px!important;padding:9px 11px!important;background:#fff!important;min-height:42px}",
    "html.fp-tel .tablewrap,html.fp-tel .table-wrap,html.fp-tel .tabelwrap{max-height:none!important;overflow:visible!important;border:0!important;box-shadow:none!important;background:transparent!important}",
    /* duimvriendelijk */
    "html.fp-tel input:not([type=checkbox]):not([type=radio]):not([type=range]),html.fp-tel select,html.fp-tel textarea{font-size:16px!important;max-width:100%}",
    "html.fp-tel .fp-hoofd button,html.fp-tel .fp-hoofd .btn,html.fp-tel .fp-hoofd a.btn{min-height:40px}",
    "html.fp-tel .fp-hoofd{padding-left:12px!important;padding-right:12px!important}",
    "html.fp-tel .card,html.fp-tel .kaart{padding:14px!important;border-radius:14px!important}",
    /* zoek- en filtervelden: even breed, en een knop ernaast als die past */
    "html.fp-tel .fp-hoofd :is(input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]),select,textarea):not(table *){width:100%;min-width:0!important;max-width:100%!important;box-sizing:border-box}",
    /* naast elkaar in een rij: velden delen de breedte, en blokken worden nooit breder dan het scherm */
    "html.fp-tel .fp-hoofd .fp-rijveld{flex:1 1 170px;width:auto}",
    "html.fp-tel .fp-hoofd .fp-rijblok{flex:1 1 140px;min-width:0}",
    "html.fp-tel .fp-hoofd div{max-width:100%;box-sizing:border-box}",
    /* rijen met knoppen en velden lopen door naar een volgende regel in plaats van van het scherm af */
    "html.fp-tel .fp-hoofd :is(div,section,form,nav,label,p,span):not(:has(> input[type=checkbox],> input[type=radio])):not(.fp-seg):not(.fp-tabkeus):not(.fp-wat-blok){flex-wrap:wrap!important}",
    "html.fp-tel .fp-hoofd{overflow-x:hidden}",
    /* de kop: e-mailadres, 'Ingelogd als' en de Demo-knop zijn op de telefoon ruis */
    "html.fp-tel .fp-tel-weg{display:none!important}",
    "html.fp-tel header{row-gap:6px!important}",
    /* lange uitleg inklappen */
    "html.fp-tel .fp-inklap:not(.fp-uit){display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}",
    ".fp-meer{display:none}",
    "html.fp-tel .fp-meer{display:inline-block;border:0;background:none;color:" + KLEUR + ";font:inherit;font-size:13px;font-weight:700;padding:0 0 10px;min-height:0!important;cursor:pointer}"
  ].join("");
  (doc.head || doc.documentElement).appendChild(st);

  function tekstVan(el) { return String((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim(); }
  function isActief(t) {
    return t.classList.contains("active") || t.classList.contains("aan") || t.classList.contains("actief") ||
           t.classList.contains("on") || t.getAttribute("aria-selected") === "true";
  }
  function zichtbaar(t) {
    if (t.hidden) return false;
    var s = global.getComputedStyle ? global.getComputedStyle(t) : null;
    return !(s && (s.display === "none" || s.visibility === "hidden"));
  }
  var TABKLASSE = ".tab,.tab-btn,[role=tab]";
  function tabsVan(balk) {
    return [].filter.call(balk.children, function (c) { return c.matches && c.matches(TABKLASSE) && !c.classList.contains("fp-tabkeus"); });
  }

  /* Het menu van onderen. */
  function openBlad(balk, keus) {
    var tabs = tabsVan(balk).filter(zichtbaar);
    var blad = doc.createElement("div");
    blad.className = "fp-blad";
    blad.innerHTML = "<div class='fp-paneel' role='dialog' aria-label='Kies een onderdeel'><div class='fp-greep'></div><div class='fp-titel'>Kies een onderdeel</div></div>";
    var paneel = blad.firstChild;
    tabs.forEach(function (t) {
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "fp-optie" + (isActief(t) ? " aan" : "");
      b.innerHTML = "<span></span><span class='fp-vink'>" + (isActief(t) ? "✓" : "›") + "</span>";
      b.firstChild.textContent = tekstVan(t);
      b.addEventListener("click", function () {
        sluit();
        t.click();
        setTimeout(function () { werkKeusBij(balk, keus); try { keus.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e) {} }, 60);
      });
      paneel.appendChild(b);
    });
    function sluit() { blad.classList.remove("open"); setTimeout(function () { blad.remove(); }, 220); }
    blad.addEventListener("click", function (e) { if (e.target === blad) sluit(); });
    doc.body.appendChild(blad);
    requestAnimationFrame(function () { blad.classList.add("open"); });
  }
  function werkKeusBij(balk, keus) {
    var tabs = tabsVan(balk);
    var actief = tabs.filter(isActief)[0] || tabs.filter(zichtbaar)[0];
    var wat = keus.querySelector(".fp-wat");
    var nieuw = actief ? tekstVan(actief) : "Kies een onderdeel";
    // Alleen schrijven als het anders is; anders start elke ronde de volgende.
    if (wat && wat.textContent !== nieuw) wat.textContent = nieuw;
  }
  function regelTabbalk(balk) {
    var tabs = tabsVan(balk);
    if (tabs.length < 2) return;
    var zicht = tabs.filter(zichtbaar).length;
    /* Twee of drie: een schakelaar. Meer: de grote knop met het menu. */
    if (zicht <= 3 && !balk.__fpKeus) { if (!balk.classList.contains("fp-seg")) balk.classList.add("fp-seg"); return; }
    if (balk.classList.contains("fp-seg")) balk.classList.remove("fp-seg");
    if (!balk.__fpKeus) {
      var keus = doc.createElement("button");
      keus.type = "button";
      keus.className = "fp-tabkeus";
      keus.innerHTML = "<span class='fp-wat-blok' style='flex:1 1 auto;min-width:0'><span class='fp-klein'>Onderdeel</span><span class='fp-wat'></span></span><span class='fp-pijl'>▾</span>";
      keus.querySelector(".fp-wat-blok").style.display = "block";
      keus.querySelector(".fp-wat").style.display = "block";
      keus.addEventListener("click", function () { openBlad(balk, keus); });
      balk.parentNode.insertBefore(keus, balk);
      balk.classList.add("fp-tabs-weg");
      balk.__fpKeus = keus;
      try { new MutationObserver(function () { werkKeusBij(balk, keus); }).observe(balk, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "aria-selected", "style"] }); } catch (e) {}
    }
    werkKeusBij(balk, balk.__fpKeus);
  }

  /* Tabellen: kolomnamen op elke cel. */
  function regelTabel(tab) {
    if (tab.closest(".fp-geen-kaart") || tab.classList.contains("fp-geen-kaart")) return;
    var kop = tab.tHead && tab.tHead.rows[0];
    if (!kop) return;
    var namen = [].map.call(kop.cells, function (c) { return tekstVan(c).replace(/[▲▼⇅]/g, "").trim(); });
    if (namen.length < 3) return;
    tab.classList.add("fp-kaart");
    [].forEach.call(tab.tBodies, function (tb) {
      [].forEach.call(tb.rows, function (tr) {
        var i = 0;
        [].forEach.call(tr.cells, function (td) {
          if (td.colSpan > 1) { i += td.colSpan; return; }
          if (!td.hasAttribute("data-label")) td.setAttribute("data-label", namen[i] || "");
          i++;
        });
      });
    });
  }

  /* De kop: wie er is ingelogd staat al op het telefoondashboard, en Demo is
     voor een presentatie op de pc. */
  function regelKop() {
    var kop = doc.querySelector("header");
    if (!kop) return;
    kop.querySelectorAll("#userEmail, .user-chip, .fp-kop-wie, #wie, #gebruiker").forEach(function (e) {
      var doel = e.id === "userEmail" && e.parentElement && e.parentElement !== kop && !e.parentElement.querySelector("button") ? e.parentElement : e;
      if (!doel.classList.contains("fp-tel-weg")) doel.classList.add("fp-tel-weg");
    });
    kop.querySelectorAll("button, a, span").forEach(function (e) {
      var tx = tekstVan(e);
      if ((/^(\S+\s)?demo$/i.test(tx) || /^ingelogd als/i.test(tx) || /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(tx)) && !e.classList.contains("fp-tel-weg")) e.classList.add("fp-tel-weg");
    });
  }

  /* Lange uitleg inklappen. */
  function regelUitleg(p) {
    if (p.__fpInklap || p.querySelector("input,select,textarea,button")) return;
    if (tekstVan(p).length < 220) return;
    p.__fpInklap = true;
    p.classList.add("fp-inklap");
    var meer = doc.createElement("button");
    meer.type = "button";
    meer.className = "fp-meer";
    meer.textContent = "meer ▾";
    meer.addEventListener("click", function () {
      var uit = p.classList.toggle("fp-uit");
      meer.textContent = uit ? "minder ▴" : "meer ▾";
    });
    p.parentNode.insertBefore(meer, p.nextSibling);
  }

  function ronde() {
    // Het hoofdvak van de tegel: meestal <main>, bij een paar oudere tegels een .wrap.
    var hoofd = doc.querySelector("main") || doc.getElementById("wrap") || doc.querySelector("body > .wrap, body > .container, body > .page");
    if (hoofd && !hoofd.classList.contains("fp-hoofd")) hoofd.classList.add("fp-hoofd");
    var balken = new Set();
    doc.querySelectorAll(TABKLASSE).forEach(function (t) { if (t.parentElement) balken.add(t.parentElement); });
    balken.forEach(function (b) { try { regelTabbalk(b); } catch (e) {} });
    doc.querySelectorAll(".fp-hoofd table, .card table, table.grid").forEach(function (t) { try { regelTabel(t); } catch (e) {} });
    doc.querySelectorAll(".fp-hoofd p.lead, .fp-hoofd .lead, .fp-hoofd .uitleg").forEach(function (p) { try { regelUitleg(p); } catch (e) {} });
    doc.querySelectorAll(".fp-hoofd .card > p, .fp-hoofd section > p, .fp-hoofd .kaart > p").forEach(function (p) { try { if (tekstVan(p).length > 300) regelUitleg(p); } catch (e) {} });
    regelKop();
    doc.querySelectorAll(".fp-hoofd input, .fp-hoofd select, .fp-hoofd textarea").forEach(function (v) {
      if (v.closest("table") || v.classList.contains("fp-rijveld") || /^(checkbox|radio|range|file|color|hidden)$/.test(v.type)) return;
      var ou = v.parentElement, c = ou && getComputedStyle(ou);
      if (c && /flex/.test(c.display) && !/column/.test(c.flexDirection)) { v.classList.add("fp-rijveld"); return; }
      // Veld met een eigen omhulsel (label + veld) in een rij: dan deelt het omhulsel de breedte.
      var opa = ou && ou.parentElement, c2 = opa && getComputedStyle(opa);
      if (c2 && /flex/.test(c2.display) && !/column/.test(c2.flexDirection) && !ou.classList.contains("fp-rijveld") && !ou.closest("header")) ou.classList.add("fp-rijveld", "fp-rijblok");
    });
  }
  var wacht = null;
  function straks() { clearTimeout(wacht); wacht = setTimeout(ronde, 120); }
  function start() {
    ronde();
    try { new MutationObserver(straks).observe(doc.body, { childList: true, subtree: true }); } catch (e) {}
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else start();
})(typeof window !== "undefined" ? window : globalThis);
