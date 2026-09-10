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

  global.fpKop = { vul: vul };

})(typeof window !== "undefined" ? window : globalThis);
