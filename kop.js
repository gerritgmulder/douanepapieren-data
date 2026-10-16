/* ═══════════════════════════════════════════════════════════════════════════
   KOP — dezelfde header boven elke tegel
   ═══════════════════════════════════════════════════════════════════════════

   Gerrit, 31 aug 2026: "elke tegel moet dezelfde header structuur hebben (om
   terug te gaan naar het Dashboard, taal wisselen, etc.)"

   Wat er hoort te staan, in deze volgorde:

       ← Dashboard   Ingelogd als <naam>   [NL|EN]   Uitloggen

   Waarom een script en niet dertig keer dezelfde HTML
   ---------------------------------------------------
   Omdat het al dertig keer dezelfde HTML wás, en daardoor uit elkaar liep.
   Bij het nalopen op 31 aug 2026: vier tegels hadden geen logo, vijf geen
   uitlogknop, zes lieten niet zien wie er is ingelogd, en drie laadden de
   taalknop niet. Elk voor zich een klein gebrek, samen dertig pagina's die
   zich net anders gedragen. Dat is precies hetzelfde patroon als bij de
   tegellijst (zie de kop van tegels.js): staat iets op twee plekken
   beschreven, dan lopen die twee vroeg of laat uit de pas.

   Dit bestand herschrijft geen enkele bestaande kop. Het vult aan wat
   ontbreekt en laat staan wat er al is - dus geen enkele tegel verandert van
   uiterlijk zolang hij compleet was. De taalknop plaatst taal.js zelf, vlak
   vóór de uitlogknop; dat is de reden dat de uitlogknop hier een direct kind
   van <header> wordt en de klasse 'logout' krijgt.

   OTA: dit bestand staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var doc = global.document;
  if (!doc) return;

  function tekstVan(el) { return String((el && el.textContent) || "").replace(/\s+/g, " ").trim(); }

  /* Staat er al een uitlogknop? Elke tegel noemt hem anders: .logout,
     #logoutBtn, #uitKnop, of gewoon een knop met 'Uitloggen' erop. */
  function bestaandeUitlog(kop) {
    return kop.querySelector("button.logout, #logoutBtn, #uitKnop") ||
      Array.prototype.filter.call(kop.querySelectorAll("button, a"), function (b) {
        return /^uitloggen$/i.test(tekstVan(b));
      })[0] || null;
  }
  /* Staat er al iets dat laat zien wie is ingelogd? */
  function bestaandeWie(kop) {
    return kop.querySelector("#userEmail, #wie, #gebruiker, .user-chip, .user") ||
      (/ingelogd als/i.test(tekstVan(kop)) ? kop : null);
  }

  function stijl() {
    if (doc.getElementById("fpKopStijl")) return;
    var st = doc.createElement("style");
    st.id = "fpKopStijl";
    /* Kleuren van de kop overnemen (currentColor), zodat dit zowel op een
       donkergroene als op een lichte kop leesbaar is. */
    st.textContent =
      ".fp-kop-knop{color:inherit;text-decoration:none;border:1px solid currentColor;border-radius:7px;" +
        "padding:5px 12px;font:inherit;font-size:12px;background:transparent;cursor:pointer;opacity:.92;white-space:nowrap}" +
      ".fp-kop-knop:hover{opacity:1;background:rgba(255,255,255,.14)}" +
      ".fp-kop-wie{font-size:12px;opacity:.92;white-space:nowrap}" +
      ".fp-kop-wie b{font-weight:700}" +
      /* Op een telefoon paste de kop niet: de knop Uitloggen viel buiten
         beeld en de groene balk hield op waar het scherm ophield (Gerrit,
         12 sep 2026). De kop mag daar over twee regels, de titel krijgt
         puntjes in plaats van ruimte, en "Ingelogd als" verdwijnt: dat staat
         al op het telefoondashboard. */
      "@media (max-width:600px){" +
        "header{flex-wrap:wrap;gap:6px 8px;padding-left:12px;padding-right:12px;box-sizing:border-box;max-width:100vw}" +
        "header h1{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}" +
        "header .fp-kop-wie,header .user-chip,header #wie,header #gebruiker{display:none}" +
        "header .fp-kop-knop{padding:5px 9px;font-size:11.5px}" +
      "}";
    doc.head.appendChild(st);
  }

  function email() {
    return String(localStorage.getItem("fp.email") || "").toLowerCase();
  }

  function vul() {
    var kop = doc.querySelector("header");
    if (!kop) return;
    stijl();

    /* 1. Terug naar het dashboard. Bestaat de link al, dan blijft hij staan;
          alleen een kale pijl krijgt er het woord bij, want "←" alleen zegt
          niet waar je heen gaat. */
    /* Op de telefoon herschrijft de server "dashboard.html" naar "./", dus
       daar heet dezelfde link anders. Zonder deze regel kwam er een tweede
       knop Dashboard bij (Gerrit, 12 sep 2026). */
    var terug = kop.querySelector('a[href="dashboard.html"],a[href="./"],a.back');
    if (!terug) {
      terug = doc.createElement("a");
      terug.href = "dashboard.html";
      terug.className = "fp-kop-knop";
      terug.textContent = "← Dashboard";
      kop.insertBefore(terug, kop.firstChild);
    } else if (/^[←←\s]*$/.test(tekstVan(terug))) {
      terug.textContent = "← Dashboard";
    }

    /* 2. Wie is er ingelogd. */
    var wie = bestaandeWie(kop);
    if (!wie) {
      var sp = doc.createElement("span");
      sp.className = "fp-kop-wie geen-vertaling";
      sp.innerHTML = "Ingelogd als <b id='userEmail'></b>";
      kop.appendChild(sp);
      wie = sp;
    }
    /* Het adres invullen als de tegel dat zelf niet al doet. Bestaande tegels
       zetten hem in hun eigen opstartcode; die laten we met rust. */
    var doelEl = doc.getElementById("userEmail");
    if (doelEl && !tekstVan(doelEl)) doelEl.textContent = email() || "—";
    /* Sommige tegels hebben hun eigen vakje voor de gebruiker (#wie,
       #gebruiker) maar vullen dat pas na het inloggen, of helemaal niet. Is
       het leeg, dan zetten we er dezelfde zin in als overal elders - anders
       staat er op de ene tegel "Ingelogd als jan@..." en op de andere kaal
       "jan@...". */
    ["wie", "gebruiker"].forEach(function (id) {
      var el = doc.getElementById(id);
      if (el && !tekstVan(el) && email()) {
        el.innerHTML = "Ingelogd als <b>" + email().replace(/[&<>"]/g, "") + "</b>";
        el.classList.add("fp-kop-wie");
      }
    });

    /* 3. Uitloggen. Direct kind van <header> en met klasse 'logout', want
          taal.js zet de NL/EN-knop er vlak vóór - dat geeft precies de
          volgorde: terug, ingelogd als, taal, uitloggen. */
    var uit = bestaandeUitlog(kop);
    if (!uit) {
      uit = doc.createElement("button");
      uit.type = "button";
      uit.className = "fp-kop-knop logout";
      uit.id = uit.id || "fpKopUitloggen";
      uit.textContent = "Uitloggen";
      uit.addEventListener("click", function () {
        try { if (global.fpLog) global.fpLog("logout", ""); } catch (e) {}
        localStorage.removeItem("fp.session");
        location.href = "dashboard.html";
      });
      kop.appendChild(uit);
    } else if (!uit.classList.contains("logout")) {
      uit.classList.add("logout");
    }
    /* Als de uitlogknop dieper in de kop zit (bijvoorbeeld in een <span
       class="rechts">), verhuist hij naar het einde van de kop zelf. Anders
       plakt taal.js de taalknop erachteraan in plaats van ervoor en staat
       NL/EN op elke tegel net ergens anders. */
    if (uit.parentNode !== kop) kop.appendChild(uit);
  }

  /* ── NIEUWE VERSIE BINNEN? ────────────────────────────────────────────
     Gerrit (10 sep 2026): "ik heb net Kevin en Gerwin gevraagd even te
     herstarten maar de nieuwe versie van Planning komt bij hen niet
     tevoorschijn (...) ik heb ze drie keer laten herstarten."

     Dat komt hier vandaan. Sinds 7 september wacht het venster niet meer op
     de update - dat was de reparatie van de 28 seconden opstarttijd. De app
     opent dus meteen op de bestanden die er al staan en haalt de nieuwe op de
     achtergrond binnen. Dat werkt, maar er stond nergens dat het gebeurde, en
     drie keer snel herstarten is juist het slechtste wat je kunt doen: elke
     herstart breekt de download af die net bezig was.

     Vandaar deze melding. De tegel onthoudt bij het openen welke versie er in
     de live-map staat en kijkt daarna nog een paar keer. Verandert dat
     nummer, dan is de download klaar en staat de nieuwe tegel al op schijf -
     één keer vernieuwen is genoeg, herstarten hoeft niet.

     main.js stuurt hier ook een seintje over ('ota-klaar'), maar daar kan
     niets naar luisteren: dat zou in preload.js moeten en dat bestand zit in
     het installatiebestand en wordt nooit bijgewerkt. Deze weg loopt volledig
     via bestanden die wél met de update meekomen. */
  /* Waar we op letten is de tegel zélf, niet het versienummer in het
     manifest. Dat nummer wordt namelijk lang niet bij elke wijziging
     opgehoogd - het stond op 10 september vier commits lang op 0.34.1 - dus
     daar zou deze melding nooit van afgaan. De pagina haalt daarom zijn eigen
     bestand nog eens op en kijkt of het veranderd is. Dat is precies het
     bestand dat opnieuw geladen moet worden, dus nauwkeuriger kan niet. */
  function eigenBestand(cb) {
    try {
      var pad = global.location.pathname.split("/").pop() || "index.html";
      fetch(pad + "?t=" + Date.now(), { cache: "no-store" })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (t) { cb(t ? (t.length + ":" + kortHash(t)) : null); })
        .catch(function () { cb(null); });
    } catch (e) { cb(null); }
  }
  // Genoeg om een wijziging te zien; dit hoeft niets te beveiligen.
  function kortHash(t) {
    var h = 0;
    for (var i = 0; i < t.length; i++) { h = ((h << 5) - h + t.charCodeAt(i)) | 0; }
    return String(h);
  }
  var stempelBijStart = null;
  function toonVernieuwen() {
    if (doc.getElementById("fpNieuweVersie")) return;
    var balk = doc.createElement("div");
    balk.id = "fpNieuweVersie";
    balk.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#144734;color:#fff;" +
      "padding:10px 16px;display:flex;align-items:center;gap:12px;justify-content:center;" +
      "font:inherit;font-size:13px;box-shadow:0 -2px 12px rgba(0,0,0,.18)";
    balk.innerHTML = "<span>Er is een nieuwe versie van deze tegel binnengehaald.</span>";
    var knop = doc.createElement("button");
    knop.type = "button";
    knop.textContent = "Vernieuwen";
    knop.style.cssText = "background:#8bc53f;color:#102b1e;border:0;border-radius:8px;padding:6px 14px;" +
      "font:inherit;font-size:13px;font-weight:700;cursor:pointer";
    knop.onclick = function () { global.location.reload(); };
    var later = doc.createElement("button");
    later.type = "button";
    later.textContent = "Later";
    later.style.cssText = "background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);" +
      "border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;cursor:pointer";
    /* Wegklikken mag. Iemand die midden in een order zit moet niet gedwongen
       worden te vernieuwen; bij de volgende keer openen staat het er toch. */
    later.onclick = function () { balk.remove(); };
    balk.appendChild(knop); balk.appendChild(later);
    doc.body.appendChild(balk);
  }
  function letOpVersie() {
    eigenBestand(function (v) {
      stempelBijStart = v;
      if (!v) return;                     // niet op te halen: laten rusten
      var keer = 0;
      var tik = global.setInterval(function () {
        keer++;
        eigenBestand(function (nu) {
          if (nu && stempelBijStart && nu !== stempelBijStart) {
            global.clearInterval(tik);
            toonVernieuwen();
          } else if (keer >= 9) {         // na drie minuten stoppen met kijken
            global.clearInterval(tik);
          }
        });
      }, 20000);
    });
  }

  function start() {
    vul();
    /* taal.js draait ook op DOMContentLoaded en plaatst zijn knop vóór
       button.logout. Wie er als eerste is, weten we niet; daarom na afloop
       nog één keer kijken of de taalknop op zijn plek staat. */
    setTimeout(function () {
      var kop = doc.querySelector("header");
      var t = doc.getElementById("fpTaalKnop");
      var uit = kop && kop.querySelector("button.logout");
      if (kop && t && uit && uit.parentNode === kop && t.nextSibling !== uit) kop.insertBefore(t, uit);
    }, 0);
    letOpVersie();
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
  else start();

  /* Bestanden kunnen slepen naar elke uploadplek (Chantal, 24 sep 2026).
     Het werk staat in slepen.js; kop.js laadt het mee omdat elke tegel met
     een upload ook deze kop heeft. Zelfde map als dit bestand. */
  try {
    var hier = doc.currentScript && doc.currentScript.src;
    if (hier && !global.__fpSlepen) {
      var sl = doc.createElement("script");
      sl.src = hier.replace(/kop\.js(\?.*)?$/, "slepen.js");
      (doc.head || doc.documentElement).appendChild(sl);
    }
    /* Op de telefoon een eigen weergave: tabbladen als menu, tabellen als
       kaartjes (Gerrit, 8 okt 2026). Zie telefoon.js. */
    if (hier && !global.__fpTelefoon) {
      var tf = doc.createElement("script");
      tf.src = hier.replace(/kop\.js(\?.*)?$/, "telefoon.js");
      (doc.head || doc.documentElement).appendChild(tf);
    }
    /* Ctrl+F / Cmd+F op elke tegel (Osman, 27 sep 2026). */
    if (hier && !global.__fpZoeken) {
      var zk = doc.createElement("script");
      zk.src = hier.replace(/kop\.js(\?.*)?$/, "zoeken.js");
      (doc.head || doc.documentElement).appendChild(zk);
    }
  } catch (e) {}

  global.fpKop = { vul: vul };

  /* ── VENSTER IN DE PAGINA: vragen, bevestigen, melden ───────────────────
     window.prompt() bestaat niet in de app (Electron): de knop deed dan
     helemaal niets (Gerrit, 16 okt 2026, Werkplaats: "Je kunt erop klikken
     tot je een ons weegt"). En na alert() of confirm() blokkeert op Windows
     het typen. Daarom één eigen venster voor elke tegel:

       var nr = await fpVraag("Welk ordernummer?", "", { knop: "Toevoegen" });
                 -> de ingetypte tekst, of null bij Annuleren / Esc
       var k  = await fpVraag("Zien als:", "", { keuzes: [{ waarde: "a", label: "A" }] });
                 -> de waarde van de gekozen knop, of null
       if (!(await fpBevestig("Doorgaan?", { knop: "Boeken" }))) return;
       await fpMelding("Gelukt.");

     type: "text" (standaard), "date" of "number". Enter = bevestigen. */
  function vensterStijl() {
    if (doc.getElementById("fpVensterStijl")) return;
    var st = doc.createElement("style"); st.id = "fpVensterStijl";
    st.textContent =
      ".fp-venster{position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px}" +
      ".fp-venster .fpv-kaart{background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.25);width:100%;max-width:440px;padding:18px 18px 14px;font:14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1f2937}" +
      ".fp-venster .fpv-tekst{white-space:pre-line;margin:0 0 12px}" +
      ".fp-venster input{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:9px;padding:9px 11px;font:inherit;font-size:15px;margin-bottom:12px}" +
      ".fp-venster .fpv-keuzes{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}" +
      ".fp-venster .fpv-keuzes button{text-align:left;border:1px solid #cbd5e1;background:#f8fafc;border-radius:9px;padding:9px 11px;font:inherit;cursor:pointer}" +
      ".fp-venster .fpv-keuzes button:hover{border-color:#1f5d3a;background:#eef6f0}" +
      ".fp-venster .fpv-knoppen{display:flex;justify-content:flex-end;gap:8px}" +
      ".fp-venster .fpv-knoppen button{border-radius:9px;padding:8px 16px;font:inherit;font-weight:600;cursor:pointer;border:1px solid #cbd5e1;background:#fff;color:#1f2937}" +
      ".fp-venster .fpv-knoppen .fpv-ok{background:#1f5d3a;border-color:#1f5d3a;color:#fff}";
    (doc.head || doc.documentElement).appendChild(st);
  }
  function venster(tekst, opt) {
    opt = opt || {};
    vensterStijl();
    return new Promise(function (klaar) {
      var vorige = doc.activeElement;
      var bak = doc.createElement("div"); bak.className = "fp-venster"; bak.setAttribute("role", "dialog"); bak.setAttribute("aria-modal", "true");
      var kaart = doc.createElement("div"); kaart.className = "fpv-kaart"; bak.appendChild(kaart);
      var p = doc.createElement("p"); p.className = "fpv-tekst"; p.textContent = String(tekst || ""); kaart.appendChild(p);
      var veld = null;
      if (opt.vraag && !opt.keuzes) {
        // Een nummer als gewoon tekstveld met cijfertoetsenbord: zonder de pijltjes van type=number.
        veld = doc.createElement("input"); veld.type = opt.type === "number" ? "text" : (opt.type || "text");
        if (opt.type === "number") veld.inputMode = "numeric";
        veld.value = opt.standaard == null ? "" : String(opt.standaard);
        kaart.appendChild(veld);
      }
      var sluit = function (waarde) {
        doc.removeEventListener("keydown", toets, true);
        if (bak.parentNode) bak.parentNode.removeChild(bak);
        try { if (vorige && vorige.focus) vorige.focus(); } catch (e) {}
        klaar(waarde);
      };
      if (opt.keuzes) {
        var lijst = doc.createElement("div"); lijst.className = "fpv-keuzes";
        opt.keuzes.forEach(function (k) {
          var b = doc.createElement("button"); b.type = "button"; b.textContent = k.label || k.waarde;
          b.addEventListener("click", function () { sluit(k.waarde); });
          lijst.appendChild(b);
        });
        kaart.appendChild(lijst);
      }
      var rij = doc.createElement("div"); rij.className = "fpv-knoppen";
      var nee = null;
      if (!opt.melding) {
        nee = doc.createElement("button"); nee.type = "button"; nee.textContent = opt.annuleer || "Annuleren";
        nee.addEventListener("click", function () { sluit(opt.vraag ? null : false); });
        rij.appendChild(nee);
      }
      var ok = null;
      if (!opt.keuzes) {
        ok = doc.createElement("button"); ok.type = "button"; ok.className = "fpv-ok"; ok.textContent = opt.knop || "OK";
        ok.addEventListener("click", function () { sluit(opt.vraag ? (veld ? veld.value : "") : true); });
        rij.appendChild(ok);
      }
      kaart.appendChild(rij);
      var toets = function (e) {
        if (e.key === "Escape") { e.preventDefault(); sluit(opt.melding ? undefined : (opt.vraag ? null : false)); }
        else if (e.key === "Enter" && ok && (!veld || doc.activeElement === veld || doc.activeElement === ok)) { e.preventDefault(); ok.click(); }
      };
      doc.addEventListener("keydown", toets, true);
      bak.addEventListener("mousedown", function (e) { if (e.target === bak && !opt.melding) sluit(opt.vraag ? null : false); });
      (doc.body || doc.documentElement).appendChild(bak);
      setTimeout(function () { try { (veld || ok || kaart.querySelector("button")).focus(); if (veld) veld.select(); } catch (e) {} }, 0);
    });
  }
  global.fpVraag = function (tekst, standaard, opt) { opt = Object.assign({}, opt || {}, { vraag: true, standaard: standaard }); return venster(tekst, opt); };
  global.fpBevestig = function (tekst, opt) { return venster(tekst, Object.assign({}, opt || {})); };
  global.fpMelding = function (tekst, opt) { return venster(tekst, Object.assign({ knop: "OK" }, opt || {}, { melding: true })); };

})(typeof window !== "undefined" ? window : globalThis);
