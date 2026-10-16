/* ═══════════════════════════════════════════════════════════════════════════
   MELDING - direct een seintje als een chauffeur iets meldt
   ═══════════════════════════════════════════════════════════════════════════

   Gerrit (16 okt 2026): "Melding bij Manon/Nomi (direct) zodra er een
   opmerking wordt toegevoegd." Een opmerking van een bakwagenchauffeur
   ("er mist een kussen") wordt een bericht in het Dashboard. Dat bericht zag
   je pas als je het startscherm opende; dit script kijkt elke minuut of er
   een nieuwe is en laat hem meteen zien:
   - een kaartje rechtsboven in elke tegel en op het startscherm, met een
     korte toon;
   - een melding van de pc of telefoon zelf, ook als het Dashboard achter een
     ander venster staat.

   Alleen voor wie Bakwagenroute plant (groep bakwagen-planning). Geladen door
   kop.js, en los door het startscherm.

   OTA: dit bestand staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";
  var doc = global.document;
  if (!doc || global.__fpMelding) return;
  global.__fpMelding = true;
  var W = "https://fonteyn-data-store.g-mulder.workers.dev";
  var SOORTEN = ["bakwagen-opm"];
  function ik() { try { return (localStorage.getItem("fp.email") || "").toLowerCase(); } catch (e) { return ""; } }
  function sleutel() { try { return localStorage.getItem("fp.teamkey") || ""; } catch (e) { return ""; } }
  function mag() { return !!(global.fpToegang && global.fpToegang.mag && global.fpToegang.mag("bakwagen-planning", ik())); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function gezien() { try { return JSON.parse(localStorage.getItem("fp.melding.gezien") || "[]"); } catch (e) { return []; } }
  function zetGezien(id) { var g = gezien(); if (g.indexOf(id) < 0) g.push(id); try { localStorage.setItem("fp.melding.gezien", JSON.stringify(g.slice(-300))); } catch (e) {} }

  function stijl() {
    if (doc.getElementById("fpMeldingStijl")) return;
    var st = doc.createElement("style"); st.id = "fpMeldingStijl";
    st.textContent =
      ".fp-meldingen{position:fixed;top:12px;right:12px;z-index:2147482000;display:flex;flex-direction:column;gap:8px;max-width:min(380px,calc(100vw - 24px))}" +
      ".fp-melding{background:#fff;border:2px solid #c8102e;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.22);padding:12px 14px;font:14px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1f2937}" +
      ".fp-melding b{display:block;color:#c8102e;margin-bottom:4px}" +
      ".fp-melding .r{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}" +
      ".fp-melding a,.fp-melding button{font:inherit;font-size:13px;font-weight:600;border-radius:8px;padding:6px 12px;cursor:pointer;text-decoration:none}" +
      ".fp-melding a{background:#144734;color:#fff;border:1px solid #144734}" +
      ".fp-melding button{background:#fff;color:#144734;border:1px solid #c7d2cc}";
    (doc.head || doc.documentElement).appendChild(st);
  }
  function bak() {
    var b = doc.querySelector(".fp-meldingen");
    if (!b) { b = doc.createElement("div"); b.className = "fp-meldingen"; (doc.body || doc.documentElement).appendChild(b); }
    return b;
  }
  function toon(m) {
    stijl();
    var ref = m.ref || {};
    var naar = "bakwagen.html?zoek=" + encodeURIComponent(ref.order || "");
    var k = doc.createElement("div"); k.className = "fp-melding"; k.setAttribute("role", "alert"); k.setAttribute("data-id", m.id);
    k.innerHTML = "<b>" + esc(m.titel || "Nieuwe melding") + "</b>" + esc(m.tekst || "") +
      "<div class='r'><a href='" + esc(naar) + "'>Bekijken</a><button type='button'>Gezien</button></div>";
    k.querySelector("button").addEventListener("click", function () { zetGezien(m.id); k.remove(); });
    k.querySelector("a").addEventListener("click", function () { zetGezien(m.id); });
    bak().appendChild(k);
    piep();
    try {
      if ("Notification" in global && Notification.permission === "granted") {
        var n = new Notification(m.titel || "Melding", { body: m.tekst || "", tag: m.id });
        n.onclick = function () { try { global.focus(); } catch (e) {} n.close(); };
      }
    } catch (e) {}
  }
  function piep() {
    try {
      var a = new (global.AudioContext || global.webkitAudioContext)();
      [0, 0.18].forEach(function (t) { var o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.value = 0.06; o.connect(g); g.connect(a.destination); o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.12); });
    } catch (e) {}
  }
  var bezig = false;
  async function kijk() {
    if (bezig || !sleutel() || !mag()) return;
    bezig = true;
    try {
      var r = await fetch(W + "/berichten", { headers: { "X-Fonteyn-Auth": sleutel(), "X-Fonteyn-User": ik() } });
      var j = await r.json();
      var g = gezien();
      (j && j.items || []).filter(function (m) { return !m.af && SOORTEN.indexOf(m.soort) >= 0 && g.indexOf(m.id) < 0; })
        .forEach(function (m) { if (!doc.querySelector('.fp-melding[data-id="' + m.id + '"]')) toon(m); });
    } catch (e) {}
    bezig = false;
  }
  function start() {
    if (!mag()) return;
    // Toestemming voor meldingen van de pc of telefoon: één keer vragen, bij de eerste klik.
    try {
      if ("Notification" in global && Notification.permission === "default")
        doc.addEventListener("click", function vraag() { doc.removeEventListener("click", vraag, true); try { Notification.requestPermission(); } catch (e) {} }, true);
    } catch (e) {}
    setTimeout(kijk, 2500);
    setInterval(function () { kijk(); }, 60000);
    doc.addEventListener("visibilitychange", function () { if (!doc.hidden) kijk(); });
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else start();
})(typeof window !== "undefined" ? window : globalThis);
