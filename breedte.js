/* ═══════════════════════════════════════════════════════════════════════════
   BREEDTE - nergens in het Dashboard opzij kunnen slepen
   ═══════════════════════════════════════════════════════════════════════════

   Gerrit (9 sep 2026, en niet voor het eerst): "ik wil dat er niet meer
   horizontaal gescrolld wordt op het Dashboard. Nergens niet. Dat werkt niet
   fijn en het mag niet."

   Waarom een eigen bestand en niet dertig keer dezelfde CSS: precies dezelfde
   reden als bij kop.js en tegels.js. Het stond op dertig plekken en liep uit
   elkaar - in zestien tegels zat een tabel die opzij liep, in elke tegel net
   anders. En waarom niet binnen kop.js: zes pagina's laden die niet
   (dashboard, de twee mobiele schermen, bezorging en de douanetool), en juist
   op een telefoon is opzij slepen het vervelendst.

   OTA: dit bestand staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";
  var doc = global.document;
  if (!doc) return;

  /* ── NERGENS OPZIJ SLEPEN ──────────────────────────────────────────────
     Gerrit (9 sep 2026, en niet voor het eerst): "ik wil dat er niet meer
     horizontaal gescrolld wordt op het Dashboard. Nergens niet. Dat werkt
     niet fijn en het mag niet."

     Waarom dit hier staat en niet dertig keer apart: precies dezelfde reden
     als de kop zelf. Het stond op dertig plekken en liep uit elkaar; in
     zestien tegels zat een tabel die opzij liep en in elke tegel net anders.

     Wat deze regels doen, en wat ze bewust NIET doen:

       - Een tabel mag nooit breder worden dan zijn kaart. Was dat wel zo,
         dan schoof de halve tabel buiten beeld.
       - Een cel breekt af in plaats van de tabel op te rekken. Op een
         spatie; alleen als één woord echt breder is dan de kolom, binnen het
         woord. Een kolomkop of een knop breekt nooit binnen een woord.
       - white-space:nowrap dat met de hand in een cel is gezet wordt
         overruled. Dat staat in zestien tegels en is precies wat de tabel
         breed hield. Buiten tabellen blijft nowrap gewoon werken, want de
         knoppen in de kop moeten wél op één regel blijven.
       - min-width op een cel telt niet meer mee. Vier kolommen van 280px
         passen samen niet op een laptop.
       - Een .tablewrap scrollt alleen nog verticaal.

     NIET: overflow-x:hidden op de body. Dat haalt de schuifbalk weg maar
     verstopt de gegevens, en dan is het erger dan wat Gerrit aanwees: je ziet
     niet meer dát er iets mist. Past er iets echt niet, dan hoort dat gemeld
     te worden en opgelost in die tegel zelf - zie de melding onderaan. */
  function stijl() {
    if (doc.getElementById("fpBreedteStijl")) return;
    var st = doc.createElement("style");
    st.id = "fpBreedteStijl";
    /* Gerrit (10 sep 2026), een dag later: "Doordat je het horizontaal
       scrollen hebt verholpen, is de look and feel van alles slordig
       geworden." Klopt, en het kwam door één woord: overflow-wrap:anywhere.
       Dat mag een woord op elke letter afbreken, dus een kolomkop werd
       "BEDR IJF" en "AANBETALI NG", en een knop in een cel "blokkee r" -
       overflow-wrap erft namelijk door naar alles wat in de cel staat.

       Nu: een cel breekt alleen op een spatie, en pas als één woord echt
       breder is dan de kolom binnen dat woord (break-word in plaats van
       anywhere). Een kolomkop en een knop breken nooit binnen een woord.
       En de tegels mogen breder: het venster is 1400 breed en op een groot
       scherm zet iemand het op volledig, maar de inhoud bleef op 1100 tot
       1400 hangen. Dat is waarom de kolommen elkaar verdrongen terwijl er
       rechts een halve meter wit stond. */
    var dashboard = !!doc.getElementById("dashView");   // het dashboard zelf houdt zijn eigen maat
    st.textContent =
      "html,body{max-width:100%}" +
      (dashboard ? "" : "main{max-width:1800px}") +
      "table{width:100%;max-width:100%}" +
      "table td,table th{white-space:normal;overflow-wrap:break-word;min-width:0}" +
      "table th{overflow-wrap:normal;word-break:keep-all;hyphens:none}" +
      "table td button,table td .btn,table td .pill,table td a,table td label,table td select{overflow-wrap:normal;word-break:keep-all;white-space:nowrap}" +
      "table td[style*=nowrap]{white-space:normal!important}" +
      "table td[style*=min-width],table th[style*=min-width]{min-width:0!important}" +
      ".tablewrap{overflow-x:hidden;overflow-y:auto}";
    doc.head.appendChild(st);
  }

  /* Blijft er tóch iets te breed, dan zeggen we dat in de console met de naam
     van het element erbij. Zo hoeft niemand te gokken welke tabel het is, en
     zie ik het meteen als er ergens een nieuwe bijkomt. Voor de gebruiker
     verandert er niets. */
  function meldTeBreed() {
    var el = doc.body;
    if (!el) return;
    var ruim = doc.documentElement.clientWidth + 1;
    var raak = [];
    var alles = doc.querySelectorAll("body *");
    for (var i = 0; i < alles.length && raak.length < 8; i++) {
      var e = alles[i];
      if (e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0) {
        raak.push((e.tagName || "").toLowerCase() + (e.className ? "." + String(e.className).split(" ")[0] : "") +
                  " (" + e.scrollWidth + " in " + e.clientWidth + ")");
      } else if (e.getBoundingClientRect().width > ruim) {
        raak.push((e.tagName || "").toLowerCase() + (e.className ? "." + String(e.className).split(" ")[0] : "") + " (te breed)");
      }
    }
    if (raak.length) console.warn("[breedte] loopt opzij: " + raak.join(" | "));
  }

  function start() {
    stijl();
    // Na het opbouwen kijken of er nog iets opzij loopt; zie meldTeBreed.
    setTimeout(meldTeBreed, 1200);
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
  else start();
  stijl();   // de stijl mag meteen, die hoeft niet op de DOM te wachten

  global.fpBreedte = { stijl: stijl, meld: meldTeBreed };

})(typeof window !== "undefined" ? window : globalThis);
