/* ═══════════════════════════════════════════════════════════════════════════
   OPLEVERBON - de vragen van de checklist, op één plek
   ═══════════════════════════════════════════════════════════════════════════

   Kevin (video's, 17 sep 2026) legde de papieren "Checklist Fonteyn
   Bezorgservice" naast de telefoon: dit zijn de vragen die de monteur bij de
   klant langsloopt. Kevin: "Aardlek getest en Handrail mogen eruit; erbij:
   klopt de stroomvoorziening van de klant." Per vraag Ja, Nee of n.v.t.; bij
   Nee of n.v.t. hoort een reden.

   Mijn route (telefoon) en Planning (kantoor, overzicht en mail) lezen
   allebei deze lijst, zodat een vraag maar op één plek hoeft te veranderen.
   De sleutel (k) is wat er wordt opgeslagen; de tekst (t) mag veranderen.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";
  global.OPLEVERBON_VRAGEN = [
    { k: "stroom",       t: "Klopt de stroomvoorziening van de klant?" },
    { k: "blower",       t: "Blower aangesloten?" },
    { k: "coverlocks",   t: "Coverlocks gemonteerd?" },
    { k: "diverters",    t: "Diverters in het midden?" },
    { k: "drain",        t: "Drain gecontroleerd / uitgelegd?" },
    { k: "filter",       t: "Fabrieksfilter geleverd?" },
    { k: "handleiding",  t: "Handleiding overhandigd?" },
    { k: "jets",         t: "Jets opengezet?" },
    { k: "kussens",      t: "Kussens vastgemaakt?" },
    { k: "lifter",       t: "Lifter geïnstalleerd?" },
    { k: "omkasting",    t: "Randen / omkasting schadevrij?" },
    { k: "sluisjes",     t: "Sluisjes open?" },
    { k: "schoon",       t: "Spa schoongemaakt?" },
    { k: "trapje",       t: "Trapje geïnstalleerd?" },
    { k: "venturi",      t: "Venturi / diverter uitgelegd?" },
    { k: "wartels",      t: "Wartels aangedraaid?" },
    { k: "onderhoud",    t: "Wateronderhoud uitgelegd?" },
    { k: "werktBlower",  t: "Werkt de blower?" },
    { k: "circulatie",   t: "Werkt de circulatie?" },
    { k: "jetpompen",    t: "Werken de jetpompen?" },
    { k: "muziek",       t: "Werkt de muziek?" },
    { k: "verlichting",  t: "Werkt de verlichting?" },
    { k: "waterval",     t: "Werkt de waterval?" },
    { k: "wifi",         t: "Wifi getest?" }
  ];
  global.OPLEVERBON_ANTWOORD = { ja: "Ja", nee: "Nee", nvt: "n.v.t." };
  global.OPLEVERBON_STATUS = { concept: "nog bezig", klaar: "afgerond door monteur", akkoord: "akkoord kantoor", gemaild: "gemaild naar klant" };
})(window);
