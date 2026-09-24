/* ═══════════════════════════════════════════════════════════════════════════
   SLEPEN - een bestand op elke uploadplek kunnen neerzetten
   ═══════════════════════════════════════════════════════════════════════════

   Chantal (24 sep 2026): bestanden slepen naar elke plek in het dashboard
   waar je iets uploadt. Een paar tegels hadden al een eigen sleepvak (Bank,
   Inkoop, Labels, Douane...), de rest alleen een knop "kies bestand".

   Hoe het werkt
   -------------
   Sleep je een bestand over een tegel, dan zoekt dit script de uploadknop
   die het dichtst bij de muis staat en licht dat vak op. Laat je los, dan
   krijgt die knop het bestand, precies alsof je het via "kies bestand" had
   gekozen. De tegel zelf merkt geen verschil.

   - Een tegel met een eigen sleepvak houdt dat: wat daar valt, handelt de
     tegel zelf af (die zet preventDefault) en dit script blijft eraf.
   - Alleen uploadknoppen die nu op het scherm staan tellen mee; een knop in
     een dicht tabblad of een gesloten venster niet.
   - Staat er "accept" op de knop (bijvoorbeeld .pdf,.xlsx), dan gaan alleen
     de bestanden mee die daarbij passen.
   - Een bestand dat ergens anders op de pagina valt, opent niet meer als
     losse pagina in het venster (dat deed Electron standaard, en dan was de
     tegel weg).

   Geladen door kop.js, dus elke tegel met de standaardkop heeft dit.
   OTA: dit bestand staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.__fpSlepen) return;
  window.__fpSlepen = true;

  var MAX_AFSTAND = 260;   // px: verder weg dan dit telt alleen als het de enige knop is
  var actief = null;       // het vak dat nu oplicht

  var stijl = document.createElement("style");
  stijl.textContent =
    ".fp-sleep-hier{outline:2px dashed #8bc53f!important;outline-offset:4px;background-color:rgba(139,197,63,.08)!important;border-radius:10px}" +
    ".fp-sleep-melding{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#144734;color:#fff;" +
    "font:500 13px Montserrat,system-ui,sans-serif;padding:10px 16px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.18);z-index:99999;max-width:calc(100% - 32px)}";
  (document.head || document.documentElement).appendChild(stijl);

  function heeftBestanden(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    return !!t && Array.prototype.indexOf.call(t, "Files") >= 0;
  }
  function staatOpScherm(el) { return !!el && el.getClientRects().length > 0; }

  /* Het vak dat bij een uploadknop hoort. De knop zelf is vaak onzichtbaar
     (display:none, met een gewone knop ernaast), dus dan nemen we het blok
     eromheen. Staat dat blok ook niet op het scherm, dan is het een dicht
     tabblad of venster en telt de knop niet mee. */
  function vakVan(inp) {
    if (inp.disabled) return null;
    var el = inp.parentElement;
    for (var i = 0; i < 2 && el && !staatOpScherm(el); i++) el = el.parentElement;
    if (!el || !staatOpScherm(el) || el === document.body) return null;
    /* Dan zo ver omhoog als kan: het hele blok (de kaart, het tabblad) waar
       alleen deze ene uploadknop in zit. Dat is het vak dat oplicht, en waar
       je het bestand overal in mag laten vallen. */
    while (el.parentElement && el.parentElement !== document.body &&
           !/^(MAIN|HTML)$/.test(el.parentElement.tagName) &&
           el.parentElement.querySelectorAll('input[type="file"]').length === 1 &&
           el.parentElement.getBoundingClientRect().height < 520) el = el.parentElement;
    return el;
  }

  function afstand(rect, x, y) {
    var dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    var dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function doelBij(e) {
    var kandidaten = [];
    var knoppen = document.querySelectorAll('input[type="file"]');
    for (var i = 0; i < knoppen.length; i++) {
      var vak = vakVan(knoppen[i]);
      if (vak) kandidaten.push({ inp: knoppen[i], vak: vak });
    }
    if (!kandidaten.length) return null;
    // Valt het bestand ín een vak, dan is dat het. Liggen er vakken in
    // elkaar, dan het kleinste.
    var binnen = kandidaten.filter(function (k) { return k.vak.contains(e.target); });
    if (binnen.length) {
      binnen.sort(function (a, b) { return a.vak.offsetWidth * a.vak.offsetHeight - b.vak.offsetWidth * b.vak.offsetHeight; });
      return binnen[0];
    }
    kandidaten.forEach(function (k) { k.afstand = afstand(k.vak.getBoundingClientRect(), e.clientX, e.clientY); });
    kandidaten.sort(function (a, b) { return a.afstand - b.afstand; });
    if (kandidaten.length === 1 || kandidaten[0].afstand <= MAX_AFSTAND) return kandidaten[0];
    return null;
  }

  function licht(vak) {
    if (actief === vak) return;
    if (actief) actief.classList.remove("fp-sleep-hier");
    actief = vak;
    if (actief) actief.classList.add("fp-sleep-hier");
  }

  function past(bestand, accept) {
    if (!accept) return true;
    var naam = (bestand.name || "").toLowerCase(), type = (bestand.type || "").toLowerCase();
    return accept.split(",").some(function (a) {
      a = a.trim().toLowerCase();
      if (!a) return false;
      if (a.charAt(0) === ".") return naam.slice(-a.length) === a;
      if (/\/\*$/.test(a)) return type.indexOf(a.slice(0, -1)) === 0;
      return type === a;
    });
  }

  var meldTimer = null;
  function meld(tekst) {
    var m = document.querySelector(".fp-sleep-melding");
    if (!m) { m = document.createElement("div"); m.className = "fp-sleep-melding"; document.body.appendChild(m); }
    m.textContent = tekst;
    clearTimeout(meldTimer);
    meldTimer = setTimeout(function () { if (m.parentNode) m.parentNode.removeChild(m); }, 4000);
  }

  document.addEventListener("dragover", function (e) {
    if (!heeftBestanden(e)) return;
    if (e.defaultPrevented) { licht(null); return; }   // een eigen sleepvak van de tegel
    e.preventDefault();
    var doel = doelBij(e);
    e.dataTransfer.dropEffect = doel ? "copy" : "none";
    licht(doel ? doel.vak : null);
  });
  document.addEventListener("dragleave", function (e) {
    // Alleen als de muis het venster echt verlaat.
    if (!e.relatedTarget && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight)) licht(null);
  });
  document.addEventListener("drop", function (e) {
    if (!heeftBestanden(e)) return;
    licht(null);
    if (e.defaultPrevented) return;
    e.preventDefault();
    var doel = doelBij(e);
    if (!doel) { meld("Sleep het bestand op het vak waar het in hoort."); return; }
    var accept = doel.inp.getAttribute("accept") || "";
    var alle = Array.prototype.slice.call(e.dataTransfer.files || []);
    var goed = alle.filter(function (f) { return past(f, accept); });
    if (!goed.length) { meld("Hier kan een bestand van deze soort in: " + accept.replace(/,/g, ", ")); return; }
    if (!doel.inp.multiple) goed = goed.slice(0, 1);
    var dt = new DataTransfer();
    goed.forEach(function (f) { dt.items.add(f); });
    doel.inp.files = dt.files;
    doel.inp.dispatchEvent(new Event("input", { bubbles: true }));
    doel.inp.dispatchEvent(new Event("change", { bubbles: true }));
    if (goed.length < alle.length)
      meld(doel.inp.multiple ? (alle.length - goed.length) + " bestand(en) overgeslagen; hier past: " + accept.replace(/,/g, ", ")
                             : "Hier past één bestand; de eerste is genomen.");
  });
})();
