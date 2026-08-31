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
      ".fp-kop-wie b{font-weight:700}";
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
    var terug = kop.querySelector('a[href="dashboard.html"]');
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
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
  else start();

  global.fpKop = { vul: vul };

})(typeof window !== "undefined" ? window : globalThis);
