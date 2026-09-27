/* ═══════════════════════════════════════════════════════════════════════════
   ZOEKEN - Ctrl+F (Cmd+F op de Mac) op elke tegel
   ═══════════════════════════════════════════════════════════════════════════

   Osman (27 sep 2026): "Kun jij een sneltoets ctrl+F invoegen in je
   dashboard, zodat ik sneller kan zoeken op nummers?" In de app deed Ctrl+F
   niets: een Electron-venster heeft geen zoekbalk van zichzelf.

   Hoe het werkt
   -------------
   Ctrl+F of Cmd+F opent rechtsboven een zoekvak. Alles wat past licht geel
   op, de huidige treffer oranje, en het scherm schuift ernaartoe.
   - Enter: volgende, Shift+Enter: vorige, Esc: dicht.
   - Nummers vinden elkaar ook met een punt, komma of spatie ertussen:
     "36325" vindt ook "36.325" en "$ 36,325.00", "3522169" ook "3 522 169".
   - Ook wat er in invulvakjes staat telt mee (bijvoorbeeld een
     factuurnummer in een batch); daar springt de cursor dan naartoe.
   - Staat de treffer in een ingeklapt blok (zoals de Historie), dan klapt
     dat blok open zodra je erheen gaat.
   - Tekent de tegel zichzelf opnieuw terwijl het vak open staat, dan zoekt
     hij vanzelf opnieuw.

   Geladen door kop.js, en door dashboard.html zelf.
   OTA: dit bestand staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.__fpZoeken) return;
  window.__fpZoeken = true;

  var kanLicht = !!(window.CSS && CSS.highlights && window.Highlight);
  var balk = null, vak = null, teller = null;
  var treffers = [];      // { range } of { invoer, van, tot }
  var nu = -1;
  var waker = null, wacht = null, bezig = false;

  var stijl = document.createElement("style");
  stijl.textContent =
    "::highlight(fp-zoek){background:#fde68a;color:inherit}" +
    "::highlight(fp-zoek-nu){background:#fb923c;color:#111}" +
    ".fp-zoek-invoer{outline:2px solid #fde68a!important;outline-offset:1px}" +
    ".fp-zoek-invoer-nu{outline:2px solid #fb923c!important;outline-offset:1px}" +
    ".fp-zoekbalk{position:fixed;top:10px;right:16px;z-index:2147483000;display:flex;align-items:center;gap:6px;" +
    "background:#fff;border:1px solid #cfd8d3;border-radius:10px;padding:6px 8px;box-shadow:0 8px 24px rgba(0,0,0,.16);" +
    "font:500 13px Montserrat,system-ui,sans-serif;color:#144734;max-width:calc(100% - 32px)}" +
    ".fp-zoekbalk input{border:1px solid #cfd8d3;border-radius:7px;padding:6px 9px;font:inherit;width:220px;max-width:46vw;outline:none;color:#111}" +
    ".fp-zoekbalk input:focus{border-color:#8bc53f;box-shadow:0 0 0 2px rgba(139,197,63,.25)}" +
    ".fp-zoekbalk .fp-zt{min-width:64px;text-align:center;color:#55655d;white-space:nowrap;font-size:12px}" +
    ".fp-zoekbalk button{border:1px solid #cfd8d3;background:#f6f8f7;border-radius:7px;width:28px;height:28px;cursor:pointer;font:inherit;color:#144734;padding:0;line-height:1}" +
    ".fp-zoekbalk button:hover{background:#e8f3da}";
  (document.head || document.documentElement).appendChild(stijl);

  /* Van wat je typt een zoekpatroon maken. Tussen twee cijfers mag een
     punt, komma of (harde) spatie staan, zodat bedragen en ordernummers
     elkaar vinden hoe ze ook geschreven zijn. */
  function patroon(q) {
    q = String(q || "").trim();
    if (!q) return null;
    var cijfersAlleen = /^[\d\s.,]+$/.test(q);
    if (cijfersAlleen) q = q.replace(/[\s.,]/g, "");
    var uit = "";
    for (var i = 0; i < q.length; i++) {
      var c = q.charAt(i);
      uit += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (/\d/.test(c) && i + 1 < q.length && /\d/.test(q.charAt(i + 1))) uit += "[.,\\s\\u00a0]?";
    }
    try { return new RegExp(uit, "gi"); } catch (e) { return null; }
  }

  function zichtbaar(el) {
    if (!el) return false;
    if (el.getClientRects().length > 0) return true;
    return !!(el.closest && el.closest("details:not([open])"));
  }

  function wis() {
    if (kanLicht) { CSS.highlights.delete("fp-zoek"); CSS.highlights.delete("fp-zoek-nu"); }
    document.querySelectorAll(".fp-zoek-invoer,.fp-zoek-invoer-nu").forEach(function (x) {
      x.classList.remove("fp-zoek-invoer"); x.classList.remove("fp-zoek-invoer-nu");
    });
    treffers = [];
  }

  function zoek(houdPlek) {
    if (!balk) return;
    bezig = true;
    var oudeNu = nu;
    wis();
    var re = patroon(vak.value);
    if (re) {
      var loper = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          var p = n.parentElement;
          if (!p || !n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (p.closest(".fp-zoekbalk,script,style,noscript,template")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var n, m;
      while ((n = loper.nextNode())) {
        re.lastIndex = 0;
        if (!re.test(n.nodeValue) || !zichtbaar(n.parentElement)) continue;
        re.lastIndex = 0;
        while ((m = re.exec(n.nodeValue))) {
          if (!m[0].length) { re.lastIndex++; continue; }
          var r = document.createRange();
          r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
          treffers.push({ range: r });
        }
      }
      // Wat er in invulvakjes staat
      document.querySelectorAll("input:not([type]),input[type=text],input[type=search],input[type=number],input[type=email],input[type=tel],textarea").forEach(function (inp) {
        if (inp === vak || !zichtbaar(inp)) return;
        var v = String(inp.value || "");
        re.lastIndex = 0;
        var mm = re.exec(v);
        if (mm && mm[0].length) { inp.classList.add("fp-zoek-invoer"); treffers.push({ invoer: inp, van: mm.index, tot: mm.index + mm[0].length }); }
      });
      // In de volgorde waarin ze op het scherm staan
      treffers.sort(function (a, b) {
        var na = a.range ? a.range.startContainer : a.invoer, nb = b.range ? b.range.startContainer : b.invoer;
        if (na === nb) return a.range && b.range ? a.range.startOffset - b.range.startOffset : 0;
        return na.compareDocumentPosition(nb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
      if (kanLicht) {
        var h = new Highlight();
        treffers.forEach(function (t) { if (t.range) h.add(t.range); });
        CSS.highlights.set("fp-zoek", h);
      }
    }
    nu = treffers.length ? (houdPlek && oudeNu >= 0 ? Math.min(oudeNu, treffers.length - 1) : 0) : -1;
    toon(!houdPlek);
    setTimeout(function () { bezig = false; }, 0);
  }

  function toon(schuif) {
    teller.textContent = treffers.length ? (nu + 1) + " van " + treffers.length : (vak.value.trim() ? "0 gevonden" : "");
    if (kanLicht) CSS.highlights.delete("fp-zoek-nu");
    document.querySelectorAll(".fp-zoek-invoer-nu").forEach(function (x) { x.classList.remove("fp-zoek-invoer-nu"); });
    var t = treffers[nu];
    if (!t) return;
    var el = t.range ? t.range.startContainer.parentElement : t.invoer;
    var dicht = el && el.closest && el.closest("details:not([open])");
    while (dicht) { dicht.open = true; dicht = dicht.parentElement && dicht.parentElement.closest("details:not([open])"); }
    if (t.range) {
      if (kanLicht) CSS.highlights.set("fp-zoek-nu", new Highlight(t.range));
    } else {
      t.invoer.classList.add("fp-zoek-invoer-nu");
    }
    if (schuif !== false && el) {
      var rect = t.range ? t.range.getBoundingClientRect() : el.getBoundingClientRect();
      if (rect.top < 60 || rect.bottom > innerHeight - 20 || rect.left < 0 || rect.right > innerWidth)
        el.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }

  function stap(richting) {
    if (!treffers.length) return;
    nu = (nu + richting + treffers.length) % treffers.length;
    toon(true);
  }

  function open() {
    if (!balk) {
      balk = document.createElement("div");
      balk.className = "fp-zoekbalk";
      balk.setAttribute("role", "search");
      balk.innerHTML = "<input type='search' placeholder='Zoeken op deze pagina' aria-label='Zoeken op deze pagina'>" +
        "<span class='fp-zt'></span>" +
        "<button type='button' data-r='-1' title='Vorige (Shift+Enter)'>&#8593;</button>" +
        "<button type='button' data-r='1' title='Volgende (Enter)'>&#8595;</button>" +
        "<button type='button' data-dicht='1' title='Sluiten (Esc)'>&#10005;</button>";
      document.body.appendChild(balk);
      vak = balk.querySelector("input");
      teller = balk.querySelector(".fp-zt");
      vak.addEventListener("input", function () { clearTimeout(wacht); wacht = setTimeout(function () { zoek(false); }, 120); });
      vak.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); clearTimeout(wacht); if (!treffers.length) zoek(false); else stap(e.shiftKey ? -1 : 1); }
        else if (e.key === "Escape") { e.preventDefault(); dicht(); }
      });
      balk.addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b) return;
        if (b.dataset.dicht) dicht(); else { stap(Number(b.dataset.r)); vak.focus(); }
      });
      /* Tekent de tegel iets opnieuw, dan kloppen de treffers niet meer. */
      waker = new MutationObserver(function (lijst) {
        if (bezig || !balk || !vak.value.trim()) return;
        if (lijst.every(function (x) { return balk.contains(x.target); })) return;
        clearTimeout(wacht); wacht = setTimeout(function () { zoek(true); }, 300);
      });
    }
    balk.style.display = "flex";
    waker.observe(document.body, { childList: true, subtree: true, characterData: true });
    var gekozen = String(window.getSelection ? window.getSelection() : "").trim();
    if (gekozen && gekozen.length < 60 && gekozen.indexOf("\n") < 0) vak.value = gekozen;
    vak.focus(); vak.select();
    if (vak.value.trim()) zoek(false);
  }

  function dicht() {
    if (!balk) return;
    if (waker) waker.disconnect();
    var t = treffers[nu];
    wis();
    balk.style.display = "none";
    nu = -1;
    // Stond je op een invulvakje, dan daar verder
    if (t && t.invoer) { try { t.invoer.focus(); t.invoer.setSelectionRange(t.van, t.tot); } catch (e) {} }
  }

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "f" || e.key === "F")) {
      e.preventDefault(); e.stopPropagation();
      open();
    } else if (e.key === "Escape" && balk && balk.style.display !== "none" && document.activeElement !== vak) {
      dicht();
    } else if (e.key === "F3" && balk && balk.style.display !== "none") {
      e.preventDefault(); stap(e.shiftKey ? -1 : 1);
    }
  }, true);

  window.fpZoeken = { open: open, dicht: dicht };
})();
