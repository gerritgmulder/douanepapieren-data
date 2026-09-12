/* ═══════════════════════════════════════════════════════════════════════════
   ROUTE PRINTEN - voorblad plus de orderbevestigingen
   ═══════════════════════════════════════════════════════════════════════════

   Gerrit (10 sep 2026): "Als Gerwin of Kevin van Planning een route bedenken
   voor de servicemonteurs of bezorgers, dan krijgen ze een uitgeprint stel
   papieren mee. Voorblad met de belangrijkste informatie en daarna de orders
   die ze in de juiste volgorde bezoeken."

   Het papier dat ze nu meekrijgen is met de hand ingevuld. Deze bouwt hetzelfde
   stel na, met de gegevens die al in Logic4 staan:

     bladzijde 1  het voorblad: dag en datum, welke route en wie er rijdt, en
                  een tabel met per stop de tijd, de naam en de woonplaats
     daarna       per stop de orderbevestiging, in bezoekvolgorde

   Wat met opzet leeg blijft: de kolommen Akkoord en Gemaild. Gerrit: "Leeg om
   af te tekenen idd." Dat zet de monteur bij de klant aan de deur, en dat is
   iets anders dan wat het Dashboard weet.

   Het routenummer staat waar op het papieren voorblad "Monteur + Auto" stond.
   Dat bleek niet het autonummer maar het routenummer: "2 staat voor route 2.
   Ze doen vaak 3 routes op een dag, dus ze noemen ze gewoon 1, 2 en 3."

   OTA: dit bestand staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var DAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function euro(n) {
    if (n == null || !isFinite(n)) return "";
    return "€ " + Number(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function datumNL(iso) {
    var d = String(iso || "").slice(0, 10).split("-");
    return d.length === 3 ? d[2] + "-" + d[1] + "-" + d[0] : "";
  }
  function dagNaam(iso) {
    var d = new Date(String(iso || "").slice(0, 10) + "T12:00:00");
    return isNaN(d) ? "" : DAGEN[d.getDay()];
  }

  /* Het adresblok zoals het op de bevestiging staat: naam, straat, postcode en
     plaats, en daaronder telefoon en mail. Wat leeg is slaan we over in plaats
     van een lege regel te laten staan. */
  function adresBlok(a) {
    if (!a) return "";
    return [a.naam, a.straat, a.straat2,
            [a.postcode, a.plaats].filter(Boolean).join("  "),
            a.telefoon, a.mail]
      .filter(Boolean).map(function (r) { return esc(r) + "<br>"; }).join("");
  }

  /* ── Het voorblad ────────────────────────────────────────────────────── */
  function voorblad(opts) {
    var rijen = opts.stops.map(function (s) {
      return "<tr><td class='tijd'>" + esc(s.tijd || "") + "</td>" +
        "<td>" + esc(s.klant || "") + "</td>" +
        "<td>" + esc(s.plaats || "") + "</td>" +
        "<td class='vink'></td><td class='vink'></td></tr>";
    }).join("");
    // Altijd een paar lege regels erbij: er komt op de dag zelf nog weleens
    // een adres bij, en dan schrijven ze dat er met de pen onder.
    for (var i = opts.stops.length; i < Math.max(6, opts.stops.length + 2); i++) {
      rijen += "<tr><td class='tijd'>&nbsp;</td><td></td><td></td><td class='vink'></td><td class='vink'></td></tr>";
    }
    return "<section class='blad voorblad'>" +
      "<div class='veld'><span class='kop'>Dag + Datum:</span>" +
        "<div class='lijn'>" + esc(dagNaam(opts.datum)) + " " + esc(datumNL(opts.datum)) + "</div>" +
        "<div class='lijn'></div></div>" +
      "<div class='veld'><span class='kop'>Monteur + Auto:</span>" +
        "<div class='lijn'>" + esc(String(opts.routeNr)) + (opts.wie ? "&nbsp;&nbsp;&nbsp;" + esc(opts.wie) : "") + "</div>" +
        "<div class='lijn'></div></div>" +
      "<table class='stoptabel'><thead><tr>" +
        "<th class='tijd'>Tijd:</th><th>Naam:</th><th>Woonplaats:</th>" +
        "<th class='vink'>Akkoord</th><th class='vink'>Gemaild</th>" +
      "</tr></thead><tbody>" + rijen + "</tbody></table>" +
      "<div class='veld opm'><span class='kop'>Opmerking:</span>" +
        "<div class='lijn'></div><div class='lijn'></div><div class='lijn'></div>" +
        "<div class='lijn'></div><div class='lijn'></div></div>" +
      "<div class='slot'>BUS NETJES ACHTERLATEN<br>SLEUTELS RETOUR IN HET BAKJE!</div>" +
    "</section>";
  }

  /* ── Eén orderbevestiging ────────────────────────────────────────────── */
  /* Een servicemelding of een losse afspraak op een eigen blad.
     ═══════════════════════════════════════════════════════════════════
     Gerrit (12 sep 2026): "Als ik een route print waar een levering en
     service op staat dan zie ik alleen het voorblad en de order die hoort
     bij de levering. Ik wil van de service ook de order zien of de
     bijbehorende its-melding, want anders staat er niks in die route."
     Dus elke stop krijgt een blad: een order zijn bevestiging, een
     servicemelding dit blad met de melding en de klant, en een stop zonder
     beide een blad met wat er in de afspraak staat. Onderaan ruimte om te
     schrijven wat er is gedaan. */
  function briefkop(logo) {
    return "<div class='briefkop'>" +
      "<div class='afzender'>Meervelderweg 52<br>3888 NK Uddel<br>Nederland<br>Telefoon: +31 (0)577 456040</div>" +
      (logo ? "<img class='logo' src='" + esc(logo) + "' alt='Fonteyn'>" : "<div class='logo-tekst'>Fonteyn</div>") +
      "<div class='bedrijf'>E-mail: ishop@fonteyn.nl<br>Internet: www.fonteyn.nl<br>" +
        "IBAN: NL34INGB0679207473<br>BIC: INGBNL2A<br>KvK: 08053333<br>BTW nr. NL815219180B01</div>" +
    "</div>";
  }
  function schrijfregels(n) {
    var uit = "";
    for (var i = 0; i < n; i++) uit += "<div class='lijn'>&nbsp;</div>";
    return uit;
  }
  function meldingBlad(m, logo) {
    var k = m.klant || {};
    return "<section class='blad bevestiging'>" + briefkop(logo) +
      "<h2>Servicemelding" + (m.id ? " " + esc(m.id) : "") + "</h2>" +
      "<div class='blokken'>" +
        "<div><span class='kop'>Klant:</span><div class='adres'>" +
          esc(k.naam || m.naam || "") + (k.adres ? "<br>" + esc(k.adres) : "") +
          (k.telefoon ? "<br>Telefoon: " + esc(k.telefoon) : "") + (k.email ? "<br>" + esc(k.email) : "") +
        "</div></div>" +
        "<div><span class='kop'>Afspraak:</span><div class='adres'>" +
          esc(datumNL(m.datum)) + (m.tijd ? " om " + esc(m.tijd) : "") + (m.wie ? "<br>" + esc(m.wie) : "") +
        "</div></div>" +
        "<div class='gegevens'>" +
          rij("Melding:", m.id) +
          rij("Gemeld op:", datumNL(m.gemeld)) +
          rij("Uiterlijk:", datumNL(m.uiterlijk)) +
          rij("Type:", m.type) +
          rij("Groep:", m.groep) +
          rij("Verantwoordelijke:", m.verantwoordelijke) +
          rij("Debiteuren nr:", m.debiteur) +
        "</div>" +
      "</div>" +
      "<h3 class='kopje'>Omschrijving van de melding</h3>" +
      "<div class='tekstblok'>" + esc(m.omschrijving || "(geen omschrijving in Logic4)") + "</div>" +
      (m.wat ? "<h3 class='kopje'>Uit de planning</h3><div class='tekstblok'>" + esc(m.wat) + "</div>" : "") +
      "<h3 class='kopje'>Uitgevoerd / opmerkingen monteur</h3>" + schrijfregels(8) +
    "</section>";
  }
  function afspraakBlad(a, logo) {
    return "<section class='blad bevestiging'>" + briefkop(logo) +
      "<h2>Afspraak</h2>" +
      "<div class='blokken'>" +
        "<div><span class='kop'>Klant:</span><div class='adres'>" +
          esc(a.klant || "") + (a.plaats ? "<br>" + esc(a.plaats) : "") +
          (a.telefoon ? "<br>Telefoon: " + esc(a.telefoon) : "") +
        "</div></div>" +
        "<div><span class='kop'>Wanneer:</span><div class='adres'>" +
          esc(datumNL(a.datum)) + (a.tijd ? " om " + esc(a.tijd) : "") + (a.wie ? "<br>" + esc(a.wie) : "") +
        "</div></div>" +
        "<div class='gegevens'>" + rij("Soort:", a.soortNaam) + "</div>" +
      "</div>" +
      (a.wat ? "<h3 class='kopje'>Wat er moet gebeuren</h3><div class='tekstblok'>" + esc(a.wat) + "</div>" : "") +
      "<h3 class='kopje'>Uitgevoerd / opmerkingen monteur</h3>" + schrijfregels(8) +
    "</section>";
  }
  function bevestiging(o, logo) {
    if (!o || !o.ok) {
      return "<section class='blad'><h2>Order " + esc(o && o.nr) + "</h2>" +
        "<p class='fout'>Deze order kon niet uit Logic4 worden opgehaald: " +
        esc((o && o.error) || "onbekende reden") + ". Print hem met de hand mee.</p></section>";
    }
    var regels = (o.regels || []).map(function (r) {
      return "<tr><td class='aantal'>" + esc(r.aantal) + "</td>" +
        "<td class='code'>" + esc(r.code) + "</td>" +
        "<td>" + esc(r.omschrijving) + "</td>" +
        "<td class='geld'>" + esc(euro(r.stukprijs)) + "</td>" +
        "<td class='geld'>" + esc(euro(r.totaal)) + "</td></tr>";
    }).join("");
    return "<section class='blad bevestiging'>" +
      "<div class='briefkop'>" +
        "<div class='afzender'>Meervelderweg 52<br>3888 NK Uddel<br>Nederland<br>Telefoon: +31 (0)577 456040</div>" +
        (logo ? "<img class='logo' src='" + esc(logo) + "' alt='Fonteyn'>" : "<div class='logo-tekst'>Fonteyn</div>") +
        "<div class='bedrijf'>E-mail: ishop@fonteyn.nl<br>Internet: www.fonteyn.nl<br>" +
          "IBAN: NL34INGB0679207473<br>BIC: INGBNL2A<br>KvK: 08053333<br>BTW nr. NL815219180B01</div>" +
      "</div>" +
      "<h2>Orderbevestiging</h2>" +
      "<div class='blokken'>" +
        "<div><span class='kop'>Besteld door:</span><div class='adres'>" + adresBlok(o.besteldDoor) + "</div>" +
          (o.adviseur ? "<div class='adviseur'><span class='kop'>Adviseur:</span> " + esc(o.adviseur) +
            (o.adviseurMail ? "<br>" + esc(o.adviseurMail) : "") + "</div>" : "") +
        "</div>" +
        "<div><span class='kop'>Leveren aan:</span><div class='adres'>" + adresBlok(o.leverenAan) + "</div></div>" +
        "<div class='gegevens'>" +
          rij("Ind. leverdatum:", datumNL(o.leverdatum)) +
          rij("Order nummer:", o.nr) +
          rij("Bestel datum:", datumNL(o.besteldatum)) +
          rij("Debiteuren nr:", o.debiteur) +
          rij("Leveringswijze:", o.leveringswijze) +
          rij("Betalingsconditie:", o.betaalconditie) +
        "</div>" +
      "</div>" +
      "<table class='regels'><thead><tr>" +
        "<th class='aantal'>Aantal</th><th class='code'>Productcode</th><th>Omschrijving</th>" +
        "<th class='geld'>Stukprijs</th><th class='geld'>Totaal</th>" +
      "</tr></thead><tbody>" + regels + "</tbody></table>" +
      (o.totaal != null ? "<div class='totaalregel'>Totaal: " + esc(euro(o.totaal)) + "</div>" : "") +
      "<div class='voet'>Op het moment dat de aanbetaling wordt uitgevoerd gaat De Fonteyn BV ervan uit dat de klant " +
        "de bestelling en de algemene voorwaarden heeft gecontroleerd en het hiermee eens is.<br><br>" +
        "Op alle aanbiedingen van, leveringen door en overeenkomsten met ons gesloten zijn toepasselijk onze Algemene " +
        "Verkoop- en leveringsvoorwaarden, gedeponeerd bij de Kamer van Koophandel onder het nummer: 08053333.</div>" +
    "</section>";
  }
  function rij(k, v) {
    return "<div class='gr'><span>" + esc(k) + "</span><b>" + esc(v || "") + "</b></div>";
  }

  var STIJL =
    "@page{size:A4;margin:14mm}" +
    "*{box-sizing:border-box}" +
    "body{font:12px/1.45 Arial,Helvetica,sans-serif;color:#111;margin:0}" +
    ".blad{page-break-after:always;padding:0 0 8mm}" +
    ".blad:last-child{page-break-after:auto}" +
    /* voorblad */
    ".voorblad .veld{margin:0 0 14px}" +
    ".voorblad .kop{font-weight:700;text-decoration:underline;display:block;margin-bottom:4px}" +
    ".voorblad .lijn{border-bottom:1px solid #111;height:22px;line-height:22px;font-size:15px}" +
    ".stoptabel{width:100%;border-collapse:collapse;margin:14px 0 18px}" +
    ".stoptabel th,.stoptabel td{border:1px solid #111;padding:7px 6px;text-align:left;height:30px}" +
    ".stoptabel th{font-weight:700}" +
    ".stoptabel .tijd{width:64px}.stoptabel .vink{width:62px;text-align:center;font-size:10px}" +
    ".voorblad .opm .lijn{height:20px}" +
    ".slot{margin-top:26px;text-align:center;color:#c00000;font-weight:700;font-size:17px;line-height:1.5}" +
    /* bevestiging */
    ".briefkop{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;font-size:10.5px;line-height:1.4}" +
    ".briefkop .logo{max-height:52px}" +
    ".briefkop .logo-tekst{font-size:20px;font-weight:700}" +
    ".briefkop .bedrijf{text-align:right}" +
    ".bevestiging h2{text-align:center;font-size:17px;margin:4px 0 14px}" +
    ".blokken{display:flex;gap:14px;font-size:11.5px;margin-bottom:14px}" +
    ".blokken>div{flex:1 1 0;min-width:0}" +
    ".blokken .kop{font-weight:700}" +
    ".blokken .adres{margin-top:2px}" +
    ".blokken .adviseur{margin-top:10px}" +
    ".gegevens .gr{display:flex;gap:6px;margin-bottom:1px}" +
    ".gegevens .gr>span{flex:0 0 96px;color:#111}" +
    ".gegevens .gr>b{flex:1 1 auto;font-weight:700;overflow-wrap:anywhere}" +
    ".regels{width:100%;border-collapse:collapse;margin-top:6px;font-size:11.5px}" +
    ".regels th{border-bottom:1.5px solid #111;padding:5px 4px;text-align:left;font-weight:700}" +
    ".regels td{padding:6px 4px;vertical-align:top}" +
    ".regels .aantal{width:46px}.regels .code{width:84px}" +
    ".regels .geld{width:88px;text-align:right;white-space:nowrap}" +
    ".totaalregel{text-align:right;font-weight:700;border-top:1.5px solid #111;padding-top:6px;margin-top:2px}" +
    ".voet{margin-top:22px;font-size:9.5px;line-height:1.5;border-top:1px solid #999;padding-top:8px}" +
    ".fout{color:#b91c1c;font-weight:700}";

  /* Het hele stel papieren in een eigen venster, en meteen het printvenster
     erbij. Een eigen venster en geen @media print op de tegel zelf: dan zou de
     hele planning mee in de printopmaak moeten en dat loopt bij de eerste
     wijziging aan het bord alweer uit de pas. */
  /* Eerst kijken, dan printen.
     ═══════════════════════════════════════════════════════════════════
     Gerrit (12 sep 2026): "Ik wil een afdrukvoorbeeld zien voordat de
     'print route' knop echt gaat printen. Want nu weet ik niet wat ie gaat
     printen." Dus geen los venster (dat vangt de app af, en dan komt er
     niets), maar een laag over de pagina met het hele document erin: het
     voorblad en daaronder de orderbevestigingen, precies zoals het op papier
     komt. Bovenin twee knoppen: Printen en Sluiten. Printen gebeurt vanuit
     dat kader zelf, zodat wat je ziet ook is wat eruit komt. */
  function print(opts) {
    var titel = "Route " + esc(opts.routeNr) + " - " + esc(datumNL(opts.datum));
    var html = "<!doctype html><html lang='nl'><head><meta charset='utf-8'>" +
      "<title>" + titel + "</title>" +
      "<style>" + STIJL + "</style>" +
      /* Alleen op het scherm: het document als een vel van A4-breedte op een
         grijze achtergrond, zodat het voorbeeld eruitziet als het papier.
         Bij het printen zelf doet deze regel niets. */
      "<style>@media screen{html{background:#cfd4d9}body{max-width:210mm;margin:14px auto;background:#fff;" +
      "box-shadow:0 4px 24px rgba(0,0,0,.3);padding:12mm;box-sizing:border-box}}</style></head><body>" +
      voorblad(opts) +
      (opts.stukken
        ? opts.stukken.map(function (st) {
            if (st.soort === "melding") return meldingBlad(st.data, opts.logo);
            if (st.soort === "afspraak") return afspraakBlad(st.data, opts.logo);
            return bevestiging(st.data, opts.logo);
          }).join("")
        : (opts.orders || []).map(function (o) { return bevestiging(o, opts.logo); }).join("")) +
      "</body></html>";
    var oud = document.getElementById("fpPrintLaag");
    if (oud) oud.remove();

    var laag = document.createElement("div");
    laag.id = "fpPrintLaag";
    laag.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(17,24,39,.72);display:flex;flex-direction:column;" +
      "font-family:Montserrat,system-ui,sans-serif";
    var balk = document.createElement("div");
    balk.style.cssText = "flex:none;background:#144734;color:#fff;padding:10px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap";
    var kop = document.createElement("b");
    kop.style.cssText = "flex:1;font-size:14px;min-width:0";
    var st = opts.stukken || (opts.orders || []).map(function (o) { return { soort: "order", data: o }; });
    var tel = { order: 0, melding: 0, afspraak: 0 };
    st.forEach(function (x) { tel[x.soort] = (tel[x.soort] || 0) + 1; });
    var delen = [];
    if (tel.order) delen.push(tel.order + " orderbevestiging" + (tel.order === 1 ? "" : "en"));
    if (tel.melding) delen.push(tel.melding + " servicemelding" + (tel.melding === 1 ? "" : "en"));
    if (tel.afspraak) delen.push(tel.afspraak + " losse afspra" + (tel.afspraak === 1 ? "ak" : "ken"));
    kop.textContent = "Afdrukvoorbeeld: " + titel.replace(/&amp;/g, "&") + "  \u00b7  voorblad" +
      (delen.length ? " + " + delen.join(" + ") : "");
    var knopPrint = document.createElement("button");
    knopPrint.type = "button"; knopPrint.textContent = "Printen";
    knopPrint.style.cssText = "background:#8bc53f;color:#102b1e;border:0;border-radius:8px;padding:8px 18px;font:inherit;font-size:13px;font-weight:700;cursor:pointer";
    var knopDicht = document.createElement("button");
    knopDicht.type = "button"; knopDicht.textContent = "Sluiten";
    knopDicht.style.cssText = "background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:8px;padding:8px 14px;font:inherit;font-size:13px;cursor:pointer";
    balk.appendChild(kop); balk.appendChild(knopPrint); balk.appendChild(knopDicht);
    laag.appendChild(balk);

    var kader = document.createElement("iframe");
    kader.id = "fpPrintKader";
    kader.title = "Afdrukvoorbeeld";
    kader.style.cssText = "flex:1;width:100%;border:0;background:#fff";
    laag.appendChild(kader);
    document.body.appendChild(laag);
    var d = kader.contentDocument || kader.contentWindow.document;
    d.open(); d.write(html); d.close();

    function dicht() { try { laag.remove(); } catch (e) {} document.removeEventListener("keydown", opEsc); }
    function opEsc(e) { if (e.key === "Escape") dicht(); }
    document.addEventListener("keydown", opEsc);
    knopDicht.addEventListener("click", dicht);
    laag.addEventListener("click", function (e) { if (e.target === laag) dicht(); });
    knopPrint.addEventListener("click", function () {
      try { kader.contentWindow.focus(); kader.contentWindow.print(); }
      catch (e) { alert("Printen lukte niet: " + (e.message || e)); }
    });
  }

  STIJL += ".kopje{font-size:12px;margin:14px 0 4px;text-transform:uppercase;letter-spacing:.04em}" +
    ".tekstblok{border:1px solid #d1d5db;border-radius:4px;padding:8px 10px;font-size:12px;line-height:1.5;white-space:pre-wrap}" +
    ".lijn{border-bottom:1px solid #9ca3af;height:22px}";
  global.fpRoutePrint = { print: print, voorblad: voorblad, bevestiging: bevestiging };

})(typeof window !== "undefined" ? window : globalThis);
