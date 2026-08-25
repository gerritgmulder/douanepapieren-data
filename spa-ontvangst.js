/* ═══════════════════════════════════════════════════════════════════════════
   DOCUMENTENKETEN JAZZI — bedienkant
   ═══════════════════════════════════════════════════════════════════════════

   Elk schip dat Jazzi meldt via een commercial invoice hoort bij één of twee
   Jazzi-orders, en die staan sinds kort als echte inkooporder in Logic4. Dit
   scherm legt de verbinding en biedt twee handelingen aan:

     VERSCHEEPT  De goederen varen. Alleen de verwachte leverdatum op de
                 inkooporderregels bijwerken. Voorraad blijft ongemoeid.
     ONTVANGEN   De container staat in Uddel. Nu pas een inkooplevering
                 boeken, want dát verhoogt de voorraad.

   Die volgorde is het hele punt. Boeken op het moment dat de factuur binnenkomt
   zou honderden spa's in de voorraad zetten die nog weken op zee liggen.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var BASIS = "https://fonteyn-data-store.g-mulder.workers.dev";
  var cfg = null, voorstel = null, doel = null, bezig = false;
  var open = {};
  var docsOpen = {};   // per schip: staat het documentenblok open
  var actief = null;   // welk schip staat open (ref); leeg = het eerstvolgende
  var zoek = "";       // zoekterm in "Onderweg naar Uddel"; blijft staan bij hertekenen

  /* De naam waarmee een zending wordt aangeduid. Chantal (video, 24 aug
     2026): "geen bootnaam, ik wil daar het referentienummer hebben staan -
     wat in het overzicht staat, wil ik ook bij Schepen en ontvangst."
     Dus dezelfde regel als het overzicht: eerst de korte referentie
     (3332-7&3342-3), anders de volledige, en pas als die er allebei niet
     zijn de bootnaam. De bootnaam blijft als klein regeltje zichtbaar. */
  function zendingNaam(s) {
    return s.trackRef || s.ref || s.vessel || "(zonder referentie)";
  }

  function el(tag, klas, tekst) {
    var e = document.createElement(tag);
    if (klas) e.className = klas;
    if (tekst != null) e.textContent = tekst;
    return e;
  }
  function nlDatum(s) {
    if (!s) return "—";
    var d = new Date(s);
    if (isNaN(d)) return "—";
    return String(d.getDate()).padStart(2, "0") + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + d.getFullYear();
  }
  function dagenTot(s) {
    if (!s) return null;
    var d = new Date(String(s).slice(0, 10) + "T00:00:00").getTime();
    if (!isFinite(d)) return null;
    return Math.round((d - Date.now()) / 86400000);
  }

  async function haal() {
    var r = await fetch(BASIS + "/voorraad/spa-ontvangst/voorstel", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
      body: "{}"
    });
    var j = await r.json();
    if (!j.ok) throw new Error(j.error || "voorstel ophalen mislukt");
    return j;
  }
  async function stuur(pad, body) {
    var r = await fetch(BASIS + pad, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DP-Admin": cfg.adminKey },
      body: JSON.stringify(body)
    });
    return await r.json();
  }

  /* ═══════════ tekenen ═══════════ */

  function teken() {
    if (!doel) return;
    doel.innerHTML = "";
    if (!voorstel) {
      doel.appendChild(el("p", "status-msg", bezig ? "Bezig met opbouwen…" : "Nog niet geladen."));
      return;
    }

    var uitleg = el("div", "so-uitleg");
    uitleg.appendChild(el("h3", null, "Van commercial invoice naar de inkooporder"));
    uitleg.appendChild(el("p", null,
      "Elk schip hieronder hoort bij één of twee Jazzi-orders. Zolang de goederen varen zetten we alleen de " +
      "verwachte aankomst op de inkooporder. Pas als de container in Uddel staat boeken we de ontvangst — dán " +
      "gaat de voorraad omhoog. Andersom zou je spa's op voorraad zetten die nog op zee liggen."));
    doel.appendChild(uitleg);

    // Ontbrekende inkooporders zijn de blokkade: zonder die orders valt er niets te koppelen.
    var mist = {};
    voorstel.schepen.forEach(function (s) { (s.ontbreekt || []).forEach(function (nr) { mist[nr] = 1; }); });
    var mistLijst = Object.keys(mist);
    if (mistLijst.length) {
      var w = el("div", "so-waarschuwing");
      w.appendChild(el("strong", null, "Nog geen inkooporder voor Jazzi-order " + mistLijst.join(", ") + ". "));
      w.appendChild(document.createTextNode(
        "Zolang die niet in Logic4 staat, is er niets om de lading aan te koppelen. " +
        "Maak ze aan op het tabblad “Inkoop naar Logic4”."));
      doel.appendChild(w);
    }

    /* Op volgorde van aankomst. Chantal (video, 13 aug 2026): "de eerste, de
       beste container die binnenkomt staat vooraan, die over twee weken
       daarnaast, die over drie weken daarnaast." Schepen zonder ETA weten we
       niet te plaatsen en gaan achteraan. */
    var opVolgorde = voorstel.schepen.slice().sort(function (a, b) {
      if (!a.eta && !b.eta) return 0;
      if (!a.eta) return 1;
      if (!b.eta) return -1;
      return String(a.eta).localeCompare(String(b.eta));
    });

    /* Fabriekscodes uit een commercial invoice die aan geen model te koppelen
       waren. Die spa's zitten wél in de container maar tellen nergens mee, dus
       dit hoort niet stil te blijven. Deze waarschuwing stond op het tabblad
       Schepen en verdween mee toen dat opging in dit scherm. */
    var onbekend = Object.keys(voorstel.unmapped || {});
    if (onbekend.length) {
      var u = el("div", "so-waarschuwing");
      u.appendChild(el("strong", null, onbekend.length + " fabriekscode(s) zijn aan geen model gekoppeld. "));
      u.appendChild(document.createTextNode(
        "Die spa's staan wel op de invoice maar tellen nergens mee. Het gaat om: " +
        onbekend.map(function (k) { return k + " (" + voorstel.unmapped[k] + "×)"; }).join(", ") +
        ". Geef door welk model daarbij hoort, dan lees ik ze alsnog in."));
      doel.appendChild(u);
    }

    doel.appendChild(onderwegBlok(opVolgorde));
    var kb = koppelBlok(opVolgorde);
    if (kb) doel.appendChild(kb);

    /* De zendingen als tabbladen in plaats van als lijst onder elkaar.
       Chantal (video, 13 aug 2026): "deze tegels wil ik daaronder hebben staan
       als zijnde de tabbladen, net zoals we dat hebben bij de
       partnerreserveringen. En op die tabbladen wil ik het ordernummer en de
       omschrijving van de fabriek hebben staan, dat is het referentienummer."

       Op volgorde van aankomst, dus het eerstvolgende schip staat vooraan en
       is meteen open. */
    if (opVolgorde.length) {
      if (!opVolgorde.some(function (s) { return s.ref === actief; })) actief = opVolgorde[0].ref;
      var strip = el("div", "so-tabs");
      opVolgorde.forEach(function (s) {
        var t = el("button", "so-tab" + (s.ref === actief ? " aan" : ""));
        t.type = "button";
        var orders = (s.jazziOrders && s.jazziOrders.length) ? s.jazziOrders.join(" + ") : "geen order";
        t.appendChild(el("span", "so-tab-order", orders));
        t.appendChild(el("span", "so-tab-ref", zendingNaam(s)));
        var dg = dagenTot(s.eta);
        t.appendChild(el("span", "so-tab-eta",
          s.eta ? (nlDatum(s.eta) + (dg !== null && dg > 0 ? "  ·  " + dg + "d" : "")) : "geen aankomst"));
        t.addEventListener("click", function () { actief = s.ref; teken(); });
        strip.appendChild(t);
      });
      doel.appendChild(strip);

      var nu = opVolgorde.find(function (s) { return s.ref === actief; }) || opVolgorde[0];
      doel.appendChild(kaart(nu));
    }

    // Wat de expediteur zelf weet, naast onze eigen schepenlijst.
    doel.appendChild(flexportBlok());
  }

  /* ═══════════ Wat is er onderweg ═══════════
     Chantal (video, 13 aug 2026): "ik wil in één oogopslag weten welke
     containers er onderweg zijn met spabaden en wat de inhoud ervan is. Ik
     moet niks hoeven aanklikken, niks hoeven vegen, niks hoeven selecteren."

     Dus geen tabel om doorheen te scrollen maar één blok, op volgorde van
     aankomst, met per container wat erin zit. En niet alleen Jazzi: elke
     fabriek waarvan er spa's varen staat erin. */
  /* Dezelfde kleur komt uit verschillende invoices net anders binnen:
     "Sterling Silver #30" en "Sterling Silver, #30". Dat zouden twee pillen
     worden terwijl het één kleur is. Alleen voor de weergave gladstrijken; wat
     er in de gegevens staat blijft ongemoeid. */
  /* ── De naam van de spa in plaats van de fabriekscode ──────────────────
     Chantal (video, 19 aug 2026): "bij de Jazzi containers zie ik echt de
     inhoud als een Relax staan met de kleur erbij, helemaal perfect. Bij de
     volgende spa-containers zie ik alleen maar de productcode staan. Dit is
     een Turbine 8. Alle namen van de artikelcodes staan in Logic, dus graag
     deze toevoegen."

     Bij Jazzi is de fabriekscode aan een modelnaam gekoppeld en staat die
     naam er dus al. Bij de andere fabrieken is dat niet zo, en dan viel de
     kale code in beeld. De naam die Logic4 aan het artikel geeft staat
     intussen wel in de regel (artikelnaam), alleen werd hij hier niet
     gebruikt.

     Van die naam blijft het merk weg: Logic4 noemt hem "Passion Spa |
     Turbine 8 | Sterling White", en zij wil "Turbine 8" zien - net zo kort
     als bij de Jazzi's, met de kleur apart ernaast. */
  function lijktOpCode(t) {
    var v = String(t == null ? "" : t).trim();
    if (!v || v.length > 16 || /\s/.test(v)) return false;
    return /\d/.test(v) && /^[A-Za-z0-9][A-Za-z0-9.\-\/]*$/.test(v);
  }
  function uitLogic4Naam(naam) {
    var delen = String(naam == null ? "" : naam).split("|").map(function (d) { return d.trim(); })
      .filter(Boolean);
    if (!delen.length) return "";
    /* "Passion Spa | Turbine 8 | Sterling White with Grey" geeft "Turbine 8".
       Staat er maar één deel, dan is dat de hele naam. */
    if (delen.length === 1) return delen[0];
    return delen[1];
  }
  function toonNaam(x) {
    var model = String(x.model == null ? "" : x.model).trim();
    if (model && !lijktOpCode(model)) return model;
    var uitL4 = uitLogic4Naam(x.artikelnaam);
    if (uitL4 && !lijktOpCode(uitL4)) return uitL4;
    return model || String(x.artikelcode || "") || "onbekend";
  }

  /* De klant-bijzonderheden van dit schip die bij een model+kleur horen:
     "Veldkamp · 3507548". De fabriek zet ze onder de SKT-code op de invoice;
     Chantal wil ze bij de spa-regel geschreven zien (video, 25 aug 2026). */
  function klantLabels(s, model, kleur) {
    var m = String(model || "").trim().toLowerCase();
    var k = String(kleur || "").trim().toLowerCase();
    return (s.klanten || []).filter(function (x) {
      if (String(x.model || "").trim().toLowerCase() !== m) return false;
      var xk = String(x.kleur || "").trim().toLowerCase();
      return !xk || !k || xk === k;
    }).map(function (x) {
      return [x.klant, x.ordernr].filter(Boolean).join(" · ") +
             (x.notities ? " (" + x.notities + ")" : "");
    });
  }

  function kleurNet(k) {
    var t = String(k == null ? "" : k).trim();
    if (!t || t === "(geen kleur)") return "";
    return t.replace(/\s*,\s*#/g, " #").replace(/\s+/g, " ").replace(/[,;]+$/, "").trim();
  }


  /* ── Nog aan een artikel te koppelen ──────────────────────────────────
     Op de factuur van een sauna- of swimspafabriek staat geen artikelnummer
     maar een omschrijving. Wie weet wat het is zoekt er één keer het
     Logic4-artikel bij; daarna herkent het dashboard het vanzelf, ook in de
     volgende container.

     Eén lijst voor alle containers samen en niet per container, want dezelfde
     sauna komt telkens terug - anders moet iemand hetzelfde drie keer doen. */
  function koppelBlok(schepen) {
    var per = {};
    schepen.forEach(function (s) {
      (s.ongekoppeld || []).forEach(function (x) {
        var sleutel = String(x.omschrijving || "").toLowerCase().trim();
        if (!sleutel) return;
        if (!per[sleutel]) per[sleutel] = { omschrijving: x.omschrijving, sectie: x.sectie,
                                            aantal: 0, waar: [], artikel: x.artikel || null };
        per[sleutel].aantal += x.aantal || 0;
        if (per[sleutel].waar.indexOf(s.ref) < 0) per[sleutel].waar.push(s.ref);
        if (x.artikel) per[sleutel].artikel = x.artikel;
      });
    });
    var lijst = Object.keys(per).map(function (k) { return per[k]; })
      .sort(function (a, b) {
        // Wat nog gekoppeld moet worden bovenaan; dat is het werk.
        if (!a.artikel !== !b.artikel) return a.artikel ? 1 : -1;
        return b.aantal - a.aantal;
      });
    if (!lijst.length) return null;

    var open = lijst.filter(function (x) { return !x.artikel; }).length;
    var d = el("div", "so-koppel");
    var kop = el("div", "so-onderweg-kop");
    kop.appendChild(el("h3", null, "Nog aan een artikel te koppelen"));
    kop.appendChild(el("span", null, open
      ? open + " van de " + lijst.length + " omschrijvingen"
      : "alles gekoppeld"));
    d.appendChild(kop);
    d.appendChild(el("p", "so-meta klein",
      "Deze regels staan wel op de factuur maar horen nog bij geen artikel in Logic4. " +
      "Vul de artikelcode in en het dashboard herkent ze voortaan zelf, ook in de volgende container. " +
      "Weet je het niet zeker, vraag het dan aan Gretha."));

    lijst.forEach(function (x) {
      var r = el("div", "so-koppel-rij" + (x.artikel ? " klaar" : ""));

      var links = el("div", "so-koppel-wat");
      links.appendChild(el("strong", null, x.omschrijving));
      links.appendChild(el("span", "so-meta klein",
        x.aantal + " stuks" + (x.sectie ? "  ·  " + x.sectie.toLowerCase() : "") +
        "  ·  " + x.waar.join(", ")));
      r.appendChild(links);

      var rechts = el("div", "so-koppel-doen");
      if (x.artikel) {
        var pil = el("span", "so-koppel-code");
        pil.appendChild(el("b", null, x.artikel.code));
        if (x.artikel.naam) pil.appendChild(el("span", null, " " + x.artikel.naam));
        rechts.appendChild(pil);
        var los = el("button", "so-knop klein", "losmaken");
        los.onclick = function () { koppelZet(x.omschrijving, null, true, r); };
        rechts.appendChild(los);
      } else {
        var invoer = el("input");
        invoer.type = "text";
        invoer.placeholder = "artikelcode";
        invoer.className = "so-koppel-invoer";
        var kn = el("button", "so-knop klein", "koppelen");
        kn.onclick = function () {
          var code = String(invoer.value || "").trim();
          if (!code) { invoer.focus(); return; }
          koppelZet(x.omschrijving, code, false, r);
        };
        invoer.onkeydown = function (e) { if (e.key === "Enter") kn.click(); };
        rechts.appendChild(invoer);
        rechts.appendChild(kn);
      }
      r.appendChild(rechts);
      d.appendChild(r);
    });
    return d;
  }

  async function koppelZet(omschrijving, code, los, rij) {
    var melding = rij.querySelector(".so-koppel-fout");
    if (melding) melding.remove();
    try {
      var r = await fetch(BASIS + "/voorraad/koppeling", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
        body: JSON.stringify({ omschrijving: omschrijving, code: code, los: !!los,
                               door: (localStorage.getItem("fp.email") || "") }),
      });
      var j = await r.json();
      if (!j.ok) {
        var f = el("div", "so-koppel-fout", j.uitleg || j.error || "koppelen mislukt");
        rij.appendChild(f);
        return;
      }
      if (cfg.log) cfg.log("voorraad", los ? "artikel losgemaakt" : "artikel gekoppeld",
                           omschrijving + (code ? " → " + code : ""));
      await herlaad();
    } catch (e) {
      rij.appendChild(el("div", "so-koppel-fout", "koppelen mislukt: " + (e.message || e)));
    }
  }

  function onderwegBlok(schepen) {
    var d = el("div", "so-onderweg");
    var varend = schepen.filter(function (s) {
      // Containers waarvan we alleen de papieren bewaren horen niet in een
      // overzicht van wat er aan spa's onderweg is.
      if (s.alleenDocumenten) return false;
      /* Aangevinkt als binnen? Dan is hij niet meer onderweg. Chantal wil dat
         wat binnen is meetelt als binnen en niet als varend. */
      if (s.binnenGemeld) return false;
      var dg = dagenTot(s.eta);
      return dg === null || dg > 0;   // zonder ETA weten we het niet: laten staan
    });
    var totaal = varend.reduce(function (n, s) { return n + (Number(s.spas) || 0); }, 0);
    var los = varend.reduce(function (n, s) {
      return n + (s.ongekoppeld || []).reduce(function (m, x) { return m + (x.aantal || 0); }, 0);
    }, 0);
    var conts = varend.reduce(function (n, s) { return n + (Number(s.containers) || 0); }, 0);

    var kop = el("div", "so-onderweg-kop");
    kop.appendChild(el("h3", null, "Onderweg naar Uddel"));
    kop.appendChild(el("span", null,
      varend.length + " zending" + (varend.length === 1 ? "" : "en") +
      (conts ? "  ·  " + conts + " containers" : "") +
      "  ·  " + totaal + " spa's" +
      (los ? "  ·  " + los + " nog niet gekoppeld" : "")));
    d.appendChild(kop);

    if (!varend.length) {
      d.appendChild(el("p", "so-meta klein", "Er vaart op dit moment niets. Zodra een commercial invoice is ingelezen verschijnt de zending hier."));
      return d;
    }

    /* Zoeken binnen wat er vaart. Chantal (video, 17 aug 2026): "kan je een
       zoekbalk bij Schepen en ontvangst dat ik hier op spa kan zoeken. En op
       het moment dat ik dan bijvoorbeeld zeg, ik ben op zoek naar een Relax en
       die zit bijvoorbeeld in meerdere containers, dat die dan groen oplicht."

       Dus niet filteren maar oplichten: de containers blijven op volgorde van
       aankomst staan, zodat ze meteen ziet welke van de treffers het eerst
       binnenkomt. Wat niet meedoet vervaagt, maar blijft leesbaar. */
    var balk = el("div", "so-zoekbalk");
    var veld = document.createElement("input");
    veld.type = "search";
    veld.className = "so-zoekveld";
    veld.placeholder = "zoek een spa, kleur, schip of container…";
    veld.value = zoek;
    var teller = el("span", "so-zoek-tel");
    balk.appendChild(veld);
    balk.appendChild(teller);
    d.appendChild(balk);
    /* Alleen de klassen bijwerken, niet opnieuw tekenen: anders springt de
       cursor uit het veld bij elke aanslag. */
    veld.addEventListener("input", function () { zoek = veld.value; zoekToepassen(d); });

    varend.forEach(function (s) {
      var r = el("div", "so-onderweg-rij");
      r.dataset.zoek = [s.vessel, s.ref, s.trackRef, (s.jazziOrders || []).join(" ")]
        .filter(Boolean).join(" ").toLowerCase();

      var links = el("div", "so-onderweg-wie");
      links.appendChild(el("strong", null, zendingNaam(s)));
      var dg = dagenTot(s.eta);
      links.appendChild(el("span", "so-meta klein",
        nlDatum(s.eta) + (dg === null ? "  ·  aankomst onbekend" : "  ·  over " + dg + " dagen") +
        (s.vessel && s.vessel !== zendingNaam(s) ? "  ·  " + s.vessel : "")));
      if (s.jazziOrders && s.jazziOrders.length)
        links.appendChild(el("span", "so-meta klein", "order " + s.jazziOrders.join(" + ")));
      r.appendChild(links);

      /* De inhoud zelf: model en aantal, grootste eerst. Dat is waar ze naar
         kijkt - niet naar artikelcodes maar naar wat er in de container zit. */
      /* Model én kleur. Chantal (video, 14 aug 2026): "ik zie hier per
         container de inhoud, maar nu alleen de namen van de spa's - graag daar
         ook de kleuren bij." Dus één pil per combinatie, want twee Renews in
         verschillende kleuren zijn twee verschillende dingen om te lossen. */
      var inhoud = el("div", "so-onderweg-inhoud");
      var per = {};
      (s.regels || []).forEach(function (x) {
        var m = toonNaam(x);
        var k = kleurNet(x.kleur);
        var sleutel = m + "|" + k;
        if (!per[sleutel]) per[sleutel] = { model: m, kleur: k, aantal: 0 };
        per[sleutel].aantal += Number(x.aantal) || 0;
      });
      var lijst = Object.keys(per).map(function (k) { return per[k]; })
        .filter(function (x) { return x.aantal > 0; })
        .sort(function (a, b) {
          // Grootste aantal eerst; bij gelijk aantal op naam, zodat dezelfde
          // container er twee keer achter elkaar hetzelfde uitziet.
          return b.aantal - a.aantal || a.model.localeCompare(b.model) || a.kleur.localeCompare(b.kleur);
        });
      lijst.forEach(function (x) {
        var p = el("span", "so-inhoud-pil");
        var labels = klantLabels(s, x.model, x.kleur);
        p.dataset.zoek = (x.model + " " + x.kleur + " " + labels.join(" ")).toLowerCase();
        p.dataset.aantal = String(x.aantal);
        p.appendChild(el("b", null, String(x.aantal)));
        p.appendChild(document.createTextNode(" " + x.model));
        if (x.kleur) p.appendChild(el("span", "so-inhoud-kleur", x.kleur));
        // De klant en het ordernummer van de fabriek erbij, zodat meteen te
        // zien is dat deze spa al een eigenaar heeft.
        labels.forEach(function (t) {
          p.appendChild(el("span", "so-inhoud-klant", "👤 " + t));
        });
        inhoud.appendChild(p);
      });

      /* Wat er op de factuur stond maar aan geen artikel te koppelen was:
         sauna's, swimspa's, onderdelen. Die zaten in de gegevens maar kwamen
         nergens in beeld, en dan lijkt een volle container leeg. Ze tellen
         niet mee in het aantal spa's - dat kan pas als er een artikel aan
         hangt - maar je ziet nu wel wat eraan komt. */
      (s.ongekoppeld || []).forEach(function (x) {
        var p = el("span", "so-inhoud-pil los");
        p.dataset.zoek = (x.omschrijving + " " + (x.sectie || "")).toLowerCase();
        p.dataset.aantal = String(x.aantal);
        p.appendChild(el("b", null, String(x.aantal)));
        p.appendChild(document.createTextNode(" " + x.omschrijving));
        if (x.sectie) p.appendChild(el("span", "so-inhoud-kleur", x.sectie.toLowerCase()));
        inhoud.appendChild(p);
      });

      if (!lijst.length && !(s.ongekoppeld || []).length)
        inhoud.appendChild(el("span", "so-meta klein", "inhoud nog niet ingelezen"));
      r.appendChild(inhoud);
      d.appendChild(r);
    });
    zoekToepassen(d);
    return d;
  }

  /* Zoekterm op het al getekende blok leggen. Meerdere woorden moeten allemaal
     voorkomen, zodat "relax zilver" scherper is dan "relax". */
  function zoekToepassen(blok) {
    var q = String(zoek || "").trim().toLowerCase();
    var teller = blok.querySelector(".so-zoek-tel");
    var rijen = blok.querySelectorAll(".so-onderweg-rij");
    if (!q) {
      Array.prototype.forEach.call(rijen, function (r) {
        r.classList.remove("raak", "dim");
        Array.prototype.forEach.call(r.querySelectorAll(".so-inhoud-pil"),
          function (p) { p.classList.remove("raak"); });
      });
      if (teller) teller.textContent = "";
      return;
    }
    var woorden = q.split(/\s+/).filter(Boolean);
    function past(tekst) {
      return woorden.every(function (w) { return String(tekst || "").indexOf(w) >= 0; });
    }
    var nContainers = 0, nStuks = 0;
    Array.prototype.forEach.call(rijen, function (r) {
      var stuks = 0, treffers = 0;
      Array.prototype.forEach.call(r.querySelectorAll(".so-inhoud-pil"), function (p) {
        var hit = past(p.dataset.zoek);
        p.classList.toggle("raak", hit);
        if (hit) { treffers++; stuks += Number(p.dataset.aantal) || 0; }
      });
      // Op de scheepsnaam of het ordernummer licht de hele regel op, ook al
      // hoort er geen enkele pil bij de zoekterm.
      var raak = treffers > 0 || past(r.dataset.zoek);
      r.classList.toggle("raak", raak);
      r.classList.toggle("dim", !raak);
      if (raak) { nContainers++; nStuks += stuks; }
    });
    if (teller) {
      teller.textContent = nContainers
        ? (nContainers + " zending" + (nContainers === 1 ? "" : "en") +
           (nStuks ? "  ·  " + nStuks + " stuks" : ""))
        : "niets gevonden";
      teller.classList.toggle("leeg", !nContainers);
    }
  }

  function kaart(s) {
    var dagen = dagenTot(s.eta);
    var binnen = !!s.binnenGemeld || (dagen !== null && dagen <= 0);
    var d = el("div", "so-kaart" + (binnen ? " binnen" : ""));

    var rij = el("div", "so-rij");
    var links = el("div", "so-links");
    var t = el("div", "so-titel");
    t.appendChild(el("strong", null, zendingNaam(s)));
    if (s.jazziOrders && s.jazziOrders.length)
      t.appendChild(el("span", "so-badge", "Jazzi-order " + s.jazziOrders.join(" + ")));
    links.appendChild(t);
    links.appendChild(el("div", "so-meta",
      "aankomst " + nlDatum(s.eta) +
      (s.binnenGemeld
        ? "  ·  binnen gemeld op " + nlDatum(s.binnenGemeld.op) +
          (s.binnenGemeld.door ? " door " + String(s.binnenGemeld.door).split("@")[0] : "")
        : (dagen === null ? "" : (binnen ? "  ·  zou binnen moeten zijn" : "  ·  over " + dagen + " dagen"))) +
      "  ·  " + s.spas + " spa's" + (s.containers ? ("  ·  " + s.containers + " containers") : "")));
    links.appendChild(el("div", "so-meta klein",
      [s.vessel, s.ref !== zendingNaam(s) ? s.ref : ""].filter(Boolean).join("  ·  ")));
    // Wat de Bill of Lading erover zegt. Handig bij de douane en bij het
    // uitzoeken welke container waar is.
    if (s.zegel || s.blNo) {
      links.appendChild(el("div", "so-meta klein",
        (s.zegel ? "zegel " + s.zegel : "") +
        (s.zegel && s.blNo ? "  ·  " : "") +
        (s.blNo ? "vrachtbrief " + s.blNo : "")));
    }
    /* Duidelijk maken dat hier bewust geen voorraad achter zit. Zonder dit
       lijkt het op een spa-container waarvan het inlezen is mislukt. */
    if (s.alleenDocumenten) {
      links.appendChild(el("div", "so-meta klein",
        "Alleen de papieren. Geen spa's herkend op deze invoice - tuinmeubelen en sauna's " +
        "tellen hier bewust niet mee als voorraad."));
    }

    /* De trackingreferentie stond op het tabblad Schepen, in een tabel waar je
       hem moest opzoeken. Nu staat hij bij de container zelf, met daarnaast
       wat de vervoerder er het laatst over zei. */
    if (cfg.magWijzigen) {
      var tr = el("div", "so-trackrij");
      tr.appendChild(el("label", "so-meta klein", "Trackingreferentie"));
      var veld = el("input", "so-trackveld");
      veld.type = "text";
      veld.value = s.trackRef || "";
      veld.placeholder = "containernummer of orderreferentie";
      veld.title = "Waarmee de vervoerder deze zending kent. Leeg = de referentie hierboven wordt gebruikt.";
      veld.addEventListener("change", function () { bewaarSchip(s, { trackRef: veld.value }, veld); });
      tr.appendChild(veld);

      /* De aankomst met de hand kunnen zetten. Niet elke vervoerder geeft een
         datum, en zonder datum valt de zending uit de volgorde en uit het blok
         met wat er onderweg is. Stond op het tabblad Schepen. */
      tr.appendChild(el("label", "so-meta klein", "Aankomst"));
      var dat = el("input", "so-trackveld so-datumveld");
      dat.type = "date";
      dat.value = (s.eta || "").slice(0, 10);
      dat.title = "De verwachte aankomst in Nederland. Telt mee in de volgorde en in het Partnerportaal.";
      dat.addEventListener("change", function () { bewaarSchip(s, { eta: dat.value }, dat); });
      tr.appendChild(dat);
      links.appendChild(tr);
    }
    /* Wat de vervoerder er het laatst over zei. Twee vormen: wat hierlangs is
       opgehaald (vervoerder + status) en wat er al lag uit de oude
       schepenlijst - het kale antwoord van Merzario, met een voortgang in
       procenten en de laatste gebeurtenis. Allebei laten zien wat ze hebben. */
    if (s.track) {
      var t = s.track;
      var stukjes = [];
      if (t.progress != null) stukjes.push(t.progress + "% van de reis");
      var wat = t.status || t.lastEvent;
      if (wat) stukjes.push(String(wat).length > 90 ? String(wat).slice(0, 88) + "…" : wat);
      if (!stukjes.length && t.eta) stukjes.push("aankomst " + nlDatum(t.eta));
      if (t.vessel && t.vessel !== (s.vessel || "")) stukjes.push(t.vessel);
      if (t.opgehaald) stukjes.push("opgehaald " + nlDatum(t.opgehaald));
      links.appendChild(el("div", "so-meta klein",
        "volgens " + (t.vervoerder || "de vervoerder") + ": " +
        (stukjes.join("  ·  ") || "geen bijzonderheden")));
    }
    rij.appendChild(links);

    var rechts = el("div", "so-rechts");
    var pillen = el("div", "so-pillen");
    pillen.appendChild(el("span", "so-pil zeker", s.raak + " gekoppeld"));
    if (s.mis) pillen.appendChild(el("span", "so-pil fout", s.mis + " niet"));
    rechts.appendChild(pillen);

    var knoppen = el("div", "so-knoppen");
    var toon = el("button", "so-knop licht", open[s.ref] ? "Lading verbergen" : "Lading tonen");
    toon.type = "button";
    toon.addEventListener("click", function () { open[s.ref] = !open[s.ref]; teken(); });
    knoppen.appendChild(toon);

    /* De papieren bij dit schip. Chantal, video 12 aug 2026: "naast Lading
       tonen wil ik een tegel met documenten, dan is de commercial invoice en
       de packing list die we eerder via Schepen hebben geüpload zichtbaar."
       Toevoegen gebeurt bij Schepen; hier zijn ze alleen te lezen. */
    var docs = s.documenten || [];
    var docKnop = el("button", "so-knop licht",
      "Documenten" + (docs.length ? " (" + docs.length + ")" : ""));
    docKnop.type = "button";
    docKnop.title = docs.length
      ? "De commercial invoice en packing list van dit schip."
      : "Nog geen papieren bij dit schip. Voeg ze toe bij Schepen.";
    docKnop.addEventListener("click", function () { docsOpen[s.ref] = !docsOpen[s.ref]; teken(); });
    knoppen.appendChild(docKnop);

    /* De aankomst ophalen bij de vervoerder. Welke dat is hoeft niemand te
       weten: de worker probeert Merzario, Flexport, DHL en MTO op volgorde en
       meldt terug wie antwoord gaf. Chantal wilde dit per container hier
       hebben in plaats van op een apart tabblad (video, 13 aug 2026). */
    if (cfg.magWijzigen) {
      var haalEta = el("button", "so-knop licht", "Aankomst ophalen");
      haalEta.type = "button";
      haalEta.title = "Vraagt de vervoerder naar de actuele aankomstdatum en status.";
      haalEta.addEventListener("click", function () { haalAankomst(s, haalEta); });
      knoppen.appendChild(haalEta);
    }

    if (cfg.magWijzigen && s.raak > 0) {
      var eta = el("button", "so-knop licht", "Aankomst bijwerken");
      eta.type = "button";
      eta.title = "Zet de verwachte leverdatum op de inkooporderregels. Verandert niets aan de voorraad.";
      eta.addEventListener("click", function () { doeEta(s, eta); });
      knoppen.appendChild(eta);

      /* Twee verschillende dingen, en dat was precies de verwarring.
         Chantal (video, 19 aug 2026): "container binnen moeten we gewoon
         kunnen aanklikken, alleen moet het geen consequentie hebben in Logic
         maar alleen in het dashboard. Alles wat binnenkomt moet dan wel in
         het dashboard meegeteld worden bij het overzicht als zijnde op
         voorraad of binnen. Het mag alleen absoluut geen consequentie of
         actie doen in Logic."

         Daarom staat "Container is binnen" nu los van het boeken. Het eerste
         is een vinkje van haar, het tweede raakt de voorraad in Logic4 en
         blijft een aparte, bewuste handeling. */
      var binnenAan = !!s.binnenGemeld;
      var mld = el("button", "so-knop" + (binnenAan ? " licht" : ""),
        binnenAan ? "Toch niet binnen" : "Container is binnen");
      mld.type = "button";
      mld.title = binnenAan
        ? "Haalt het vinkje weg. Verandert niets in Logic4."
        : "Zet in het dashboard dat deze container binnen is. Verandert niets in Logic4.";
      mld.addEventListener("click", function () { meldBinnen(s, mld, !binnenAan); });
      knoppen.appendChild(mld);

      var ont = el("button", "so-knop licht", "Ontvangst boeken in Logic4");
      ont.type = "button";
      ont.title = "Boekt de ontvangst in Logic4 - dit verhoogt de voorraad daar.";
      ont.addEventListener("click", function () { doeOntvangst(s, ont); });
      knoppen.appendChild(ont);
    }
    if (cfg.magWijzigen) {
      var weg = el("button", "so-knop licht gevaar", "Verwijderen");
      weg.type = "button";
      weg.title = "Haalt deze zending weg. De lading telt daarna niet meer mee als voorraad onderweg.";
      weg.addEventListener("click", function () { verwijderSchip(s, weg); });
      knoppen.appendChild(weg);
    }
    rechts.appendChild(knoppen);
    rij.appendChild(rechts);
    d.appendChild(rij);

    if (open[s.ref]) d.appendChild(tabel(s));
    if (docsOpen[s.ref]) d.appendChild(documentenLijst(s));
    return d;
  }

  /* De papieren onder de kaart. Openen gaat via de worker met de teamsleutel
     in een kop - een gewone link zou een 401 opleveren - dus ophalen en als
     blob in een nieuw tabblad. */
  var BESTAND_URL = BASIS + "/voorraad/schip/bestand";
  var SOORT_NAAM = { "commercial-invoice": "Commercial invoice", "packing-list": "Packing list", "document": "Document" };
  function documentenLijst(s) {
    var wrap = el("div", "so-docs");
    var docs = s.documenten || [];
    if (!docs.length) {
      wrap.appendChild(el("p", "so-meta klein",
        "Nog geen papieren bij deze container. Zet ze hier neer met “+ document”; de commercial " +
        "invoice die je bovenaan uploadt komt er vanzelf bij te staan."));
    }
    /* Een document erbij zetten. Chantal (video, 13 aug 2026): "documenten
       uploaden, die mogelijkheid per container - ik kan hier gewoon die
       commercial invoice dan uploaden." De packing list en de commercial
       invoice horen bij de container, dus je zet ze hier neer en niet ergens
       anders. De soort wordt uit de bestandsnaam afgeleid. */
    if (cfg.magWijzigen) {
      var knop = el("label", "so-knop licht so-doc-upload", "+ document");
      var invoer = el("input");
      invoer.type = "file";
      invoer.accept = ".pdf,.xls,.xlsx,.docx,.csv,.txt,.jpg,.jpeg,.png";
      invoer.style.display = "none";
      invoer.addEventListener("change", function () { zetDocument(s, invoer, knop); });
      knop.appendChild(invoer);
      wrap.appendChild(knop);
    }

    docs.forEach(function (doc) {
      var r = el("div", "so-doc");
      var a = el("a", null, doc.naam);
      a.href = "#";
      a.addEventListener("click", function (e) { e.preventDefault(); opendoc(a, doc); });
      r.appendChild(a);
      r.appendChild(el("span", "so-meta klein",
        (SOORT_NAAM[doc.soort] || "Document") +
        (doc.grootte ? "  ·  " + Math.max(1, Math.round(doc.grootte / 1024)) + " KB" : "") +
        (doc.ts ? "  ·  " + nlDatum(doc.ts) : "") +
        (doc.door ? "  ·  " + String(doc.door).split("@")[0] : "")));
      wrap.appendChild(r);
    });
    return wrap;
  }
  /* Het bestand gaat eerst naar de opslag, daarna komt de verwijzing bij de
     container te staan. In die volgorde: een verwijzing naar een bestand dat
     er niet is levert een dode link op. */
  async function zetDocument(s, invoer, knop) {
    var f = invoer.files && invoer.files[0];
    if (!f) return;
    var oud = knop.firstChild.nodeValue;
    knop.firstChild.nodeValue = "bezig…";
    try {
      var schoon = function (x) {
        return String(x || "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      };
      var ext = (f.name.split(".").pop() || "dat").toLowerCase().replace(/[^a-z0-9]/g, "");
      var id = "schepen/" + schoon(s.ref) + "/" + schoon(f.name.replace(/\.[^.]*$/, "")) + "." + ext;

      var r1 = await fetch(BESTAND_URL + "?id=" + encodeURIComponent(id), {
        method: "PUT", headers: { "X-Fonteyn-Auth": cfg.teamKey }, body: await f.arrayBuffer() });
      var j1 = await r1.json();
      if (!j1.ok) throw new Error(j1.error || ("HTTP " + r1.status));

      var soort = /pack/i.test(f.name) ? "packing-list"
                : (/invoice|^ci/i.test(f.name) ? "commercial-invoice" : "document");
      var r2 = await fetch(BASIS + "/voorraad/schip/document", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
        body: JSON.stringify({ ref: s.ref, doc: { id: id, naam: f.name, soort: soort,
                                                  grootte: f.size, door: cfg.email || "" } }) });
      var j2 = await r2.json();
      if (!j2.ok) throw new Error(j2.error || "koppelen mislukt");
      s.documenten = j2.documenten;
      if (cfg.log) cfg.log("voorraad", "schip-document-toegevoegd", s.ref + ": " + f.name);
      teken();
      return;
    } catch (e) {
      alert("Uploaden mislukt: " + (e.message || e));
    }
    knop.firstChild.nodeValue = oud;
    invoer.value = "";
  }

  /* Een opgeslagen bestand openen. Chantal (video, 19 aug 2026): "op het moment
     dat ik die aanklik krijg ik dit in beeld. Kan je ervoor zorgen dat we dat
     bestand kunnen openen?"
  
     Hier stond window.open op een blob-adres. In de app blokkeert Electron dat:
     je krijgt een leeg venster of helemaal niets. Daarom nu eerst proberen te
     openen, en lukt dat niet, dan het bestand aanbieden zodat het in het eigen
     programma van de computer opent - Acrobat voor een pdf, Excel voor een xls.
     Het adres wordt daarna opgeruimd, anders blijft elk geopend document in het
     geheugen staan. */
  function bestandTonen(blob, naam) {
    var url = URL.createObjectURL(blob);
    var venster = null;
    try { venster = window.open(url, "_blank"); } catch (e) { venster = null; }
    if (!venster) {
      var link = document.createElement("a");
      link.href = url;
      link.download = naam || "document";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
  }

  /* Alleen het vinkje in het dashboard. Er gaat geen enkel verzoek naar
     Logic4 vanuit deze knop; dat is het hele punt. */
  async function meldBinnen(s, knop, aan) {
    var oud = knop.textContent;
    knop.textContent = "bezig…"; knop.disabled = true;
    try {
      var r = await fetch(BASIS + "/voorraad/schip/binnen", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
        body: JSON.stringify({ ref: s.ref, binnen: !!aan, door: cfg.email || "" }),
      });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || ("HTTP " + r.status));
      s.binnenGemeld = j.binnenGemeld;
      if (cfg.log) cfg.log("voorraad", aan ? "container-binnen-gemeld" : "container-binnen-teruggedraaid", s.ref);
      teken();
      return;
    } catch (e) {
      alert("Kon het niet opslaan: " + (e.message || e));
    }
    knop.textContent = oud; knop.disabled = false;
  }

  async function opendoc(a, doc) {
    var oud = a.textContent; a.textContent = "bezig…";
    try {
      var r = await fetch(BESTAND_URL + "?id=" + encodeURIComponent(doc.id),
        { headers: { "X-Fonteyn-Auth": cfg.teamKey } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      bestandTonen(await r.blob(), doc.naam);
    } catch (e) { alert("Kon het document niet openen: " + (e.message || e)); }
    a.textContent = oud;
  }

  function tabel(s) {
    var wrap = el("div", "so-tabelwrap");
    var tb = el("table", "so-tabel");
    var thead = el("thead"), hr = el("tr");
    ["Model", "Kleur", "Aantal", "Artikel", "Inkooporder", "Nog te leveren", "Huidige aankomst", "Status"]
      .forEach(function (h) { hr.appendChild(el("th", null, h)); });
    thead.appendChild(hr); tb.appendChild(thead);
    var tbody = el("tbody");
    s.regels.forEach(function (r) {
      var tr = el("tr", r.buyOrderRowId ? (r.viaModel ? "opmodel" : "") : "los");
      var tdModel = el("td", null, r.model);
      klantLabels(s, r.model, r.kleur).forEach(function (t) {
        tdModel.appendChild(el("div", "so-klantlabel", "👤 " + t));
      });
      tr.appendChild(tdModel);
      tr.appendChild(el("td", null, r.kleur || "—"));
      tr.appendChild(el("td", "num", String(r.aantal)));
      var td = el("td");
      if (r.artikelcode) {
        td.appendChild(el("code", null, r.artikelcode));
        if (r.artikelnaam) td.appendChild(document.createTextNode(" " + String(r.artikelnaam).slice(0, 40)));
      } else td.appendChild(el("span", "so-leeg", "—"));
      tr.appendChild(td);
      tr.appendChild(el("td", null, r.buyOrderId ? String(r.buyOrderId) : "—"));
      tr.appendChild(el("td", "num", r.nogTeLeveren == null ? "—" : String(r.nogTeLeveren)));
      tr.appendChild(el("td", null, r.huidigeEta ? nlDatum(r.huidigeEta) : "—"));
      var st = el("td");
      if (r.buyOrderRowId) {
        st.appendChild(el("span", "so-pil " + (r.viaModel ? "nakijk" : "zeker"), r.viaModel ? "op model" : "gekoppeld"));
      } else {
        st.appendChild(el("span", "so-pil fout", "los"));
      }
      if (r.reden) st.appendChild(el("div", "so-reden", r.reden));
      tr.appendChild(st);
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody); wrap.appendChild(tb);
    return wrap;
  }

  /* ═══════════ handelingen ═══════════ */

  // window.prompt() bestaat niet in de app (Electron kent het niet): deze knop
  // deed daardoor helemaal niets. voorraad.html heeft een eigen invoervenster
  // (askText); dat gebruiken we hier.
  function vraagTekst(vraag, waarde) {
    if (typeof window.askText === "function") return window.askText(vraag, waarde);
    return Promise.resolve(null);
  }

  async function doeEta(s, knop) {
    var datum = await vraagTekst("Verwachte aankomst zetten op de inkooporderregels van " + zendingNaam(s) +
      " — datum (jjjj-mm-dd):", String(s.eta || "").slice(0, 10));
    if (!datum) return;
    knop.disabled = true; knop.textContent = "bezig…";
    var j = await stuur("/voorraad/spa-ontvangst/eta", { ref: s.ref, eta: datum.trim(), door: cfg.email });
    if (!j.ok && !j.bijgewerkt) alert("Niet gelukt: " + (j.error || "onbekende fout"));
    else {
      alert(j.bijgewerkt + " inkooporderregels staan nu op " + j.eta + "." +
        (j.mislukt && j.mislukt.length ? ("\n\n" + j.mislukt.length + " regel(s) mislukten.") : ""));
      if (cfg.log) cfg.log("voorraad", "aankomst bijgewerkt", s.ref + " → " + j.eta + " (" + j.bijgewerkt + " regels)");
    }
    await herlaad();
  }

  async function doeOntvangst(s, knop) {
    var los = s.regels.filter(function (r) { return !r.buyOrderRowId; });
    var mee = s.regels.filter(function (r) { return r.buyOrderRowId; })
      .reduce(function (t, r) { return t + r.aantal; }, 0);
    if (!confirm("Ontvangst boeken voor " + zendingNaam(s) + "?\n\n" +
      mee + " spa's worden als ontvangen geboekt in Logic4. Dit verhoogt de voorraad." +
      (los.length ? ("\n\n" + los.length + " regel(s) zijn niet gekoppeld en gaan NIET mee.") : "") +
      "\n\nDoe dit alleen als de container fysiek in Uddel staat.")) return;
    knop.disabled = true; knop.textContent = "bezig…";
    var j = await stuur("/voorraad/spa-ontvangst/boeken", { ref: s.ref, door: cfg.email });
    if (!j.ok && !(j.gemaakt && j.gemaakt.length)) alert("Niet gelukt: " + (j.error || "onbekende fout"));
    else {
      var m = (j.gemaakt || []).map(function (g) {
        return "inkooporder " + g.buyOrderId + " → levering " + (g.levering || "(zonder nummer)") + ", " + g.regels + " regels";
      }).join("\n");
      alert("Ontvangst geboekt:\n" + m +
        (j.mislukt && j.mislukt.length ? ("\n\nMislukt: " + j.mislukt.map(function (x) { return x.buyOrderId + ": " + x.fout; }).join("; ")) : ""));
      if (cfg.log) cfg.log("voorraad", "container ontvangen geboekt", s.ref + " — " + m.replace(/\n/g, " | "));
    }
    await herlaad();
  }

  /* ═══════════ Flexport — wat de expediteur weet ═══════════

     Chantals schepenlijst komt uit de commercial invoices van Jazzi. Flexport
     vervoert het en weet dus zelf waar de containers zijn. Dit blok zet die
     twee naast elkaar: wat Flexport heeft, en of wij daar een inkooporder bij
     hebben. Wat aan één kant ontbreekt, valt zo meteen op. */

  var flexport = null, flexportBezig = false;

  async function haalFlexport(vers) {
    var r = await fetch(BASIS + "/voorraad/flexport/overzicht", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
      body: JSON.stringify({ vers: !!vers })
    });
    var j = await r.json();
    if (!j.ok) throw new Error(j.error || "Flexport-overzicht ophalen mislukt");
    return j;
  }

  function flexportBlok() {
    var d = el("div", "so-flexport");
    var kop = el("div", "so-fkop");
    var t = el("div");
    t.appendChild(el("h3", null, "Volgens Flexport"));
    t.appendChild(el("p", null, flexport
      ? ("Bijgewerkt " + nlDatum(flexport.opgehaald) + (flexport.uitCache ? " (uit de opslag)" : " (net opgehaald)") +
        " — " + flexport.zendingen.length + " zendingen, " + flexport.aantalContainers + " containers.")
      : "De expediteur weet zelf waar de containers zijn en wanneer ze aankomen."));
    kop.appendChild(t);
    var knop = el("button", "so-knop licht", flexportBezig ? "bezig…" : (flexport ? "Verversen" : "Ophalen"));
    knop.type = "button";
    knop.disabled = flexportBezig;
    knop.title = "Een verse ronde bij Flexport duurt ruim twee minuten.";
    knop.addEventListener("click", async function () {
      flexportBezig = true; teken();
      try { flexport = await haalFlexport(!!flexport); }
      catch (e) { alert("Niet gelukt: " + (e.message || e)); }
      flexportBezig = false; teken();
    });
    kop.appendChild(knop);
    d.appendChild(kop);
    if (!flexport) return d;

    // Welke Jazzi-orders hebben wij als inkooporder in Logic4?
    var onze = {};
    (voorstel && voorstel.schepen || []).forEach(function (s) {
      (s.gekoppeld || []).forEach(function (nr) { onze[nr] = 1; });
    });

    var metOrder = flexport.zendingen.filter(function (z) { return z.jazziOrders.length; });
    var zonderOrder = flexport.zendingen.filter(function (z) { return !z.jazziOrders.length; });
    var onbekend = [];
    metOrder.forEach(function (z) {
      z.jazziOrders.forEach(function (nr) { if (!onze[nr] && onbekend.indexOf(nr) < 0) onbekend.push(nr); });
    });

    if (onbekend.length) {
      var w = el("div", "so-waarschuwing");
      w.appendChild(el("strong", null, "Verscheept, maar geen inkooporder: Jazzi-order " + onbekend.join(", ") + ". "));
      w.appendChild(document.createTextNode(
        "Flexport heeft deze containers vervoerd, maar er staat bij ons geen bestelling tegenover. " +
        "Dat betekent goederen binnen zonder inkoop — precies wat de accountant zoekt."));
      d.appendChild(w);
    }

    var wrap = el("div", "so-tabelwrap");
    var tb = el("table", "so-tabel");
    var th = el("thead"), hr = el("tr");
    ["Zending", "Jazzi-order", "Containers", "Aankomst", "Werkelijk binnen", "Status"]
      .forEach(function (h) { hr.appendChild(el("th", null, h)); });
    th.appendChild(hr); tb.appendChild(th);
    var body = el("tbody");
    flexport.zendingen.slice(0, 40).forEach(function (z) {
      var los = z.jazziOrders.length && z.jazziOrders.every(function (nr) { return !onze[nr]; });
      var tr = el("tr", los ? "los" : "");
      tr.appendChild(el("td", null, String(z.naam || "").slice(0, 42) || "—"));
      tr.appendChild(el("td", null, z.jazziOrders.length ? z.jazziOrders.join(" + ") : "—"));
      tr.appendChild(el("td", "num", String(z.containers.length)));
      tr.appendChild(el("td", null, nlDatum(z.eta)));
      tr.appendChild(el("td", null, z.aangekomen ? nlDatum(z.aangekomen) : "—"));
      tr.appendChild(el("td", null, String(z.status || "").replace(/_/g, " ")));
      body.appendChild(tr);
    });
    tb.appendChild(body); wrap.appendChild(tb);
    d.appendChild(wrap);
    d.appendChild(el("p", "so-meta klein",
      metOrder.length + " zendingen met een herkend ordernummer, " + zonderOrder.length +
      " zonder — dat laatste is meestal geen spa-lading maar tuinmeubelen of onderdelen." +
      (flexport.zendingen.length > 40 ? "  De veertig recentste staan hierboven." : "")));
    return d;
  }

  /* De actuele aankomst opvragen bij wie deze container ook vervoert. Het
     antwoord komt van de eerste vervoerder die de referentie kent; die naam
     wordt erbij gemeld, zodat te zien is waar het vandaan komt. Kent niemand
     hem, dan zegt hij dat - en welke vervoerders er nog niet aangesloten zijn,
     want dan is dat de verklaring en geen fout. */
  // Een veld van de zending bewaren: de trackingreferentie of de aankomst.
  async function bewaarSchip(s, velden, invoer) {
    var was = invoer.value;
    try {
      var r = await fetch(BASIS + "/voorraad/schip/referentie", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
        body: JSON.stringify(Object.assign({ ref: s.ref }, velden)),
      });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || "opslaan mislukt");
      if (velden.trackRef !== undefined) s.trackRef = j.trackRef;
      if (velden.eta !== undefined) { s.eta = j.eta; teken(); }   // volgorde kan wijzigen
      if (cfg.log) cfg.log("voorraad", "schip-gewijzigd", s.ref + ": " + JSON.stringify(velden));
    } catch (e) {
      alert("Kon het niet opslaan: " + (e.message || e));
      invoer.value = was;
    }
  }

  /* Een zending verwijderen. Dat haalt de lading ook uit wat er als voorraad
     onderweg meetelt, dus de vraag vooraf noemt hoeveel spa's dat zijn. Wat
     weggaat wordt bewaard, dus een vergissing is terug te draaien. */
  async function verwijderSchip(s, knop) {
    if (!confirm("Zending " + (s.vessel || s.ref) + " verwijderen?\n\n" +
      s.spas + " spa's tellen daarna niet meer mee als voorraad onderweg.\n\n" +
      "Wat weggaat wordt bewaard, dus een vergissing is terug te draaien.")) return;
    knop.disabled = true; knop.textContent = "bezig…";
    try {
      var r = await fetch(BASIS + "/voorraad/schip/verwijder", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
        body: JSON.stringify({ ref: s.ref, door: cfg.email || "" }),
      });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || "verwijderen mislukt");
      if (cfg.log) cfg.log("voorraad", "schip-verwijderd", (s.vessel || s.ref) + " (" + s.spas + " spa's)");
      actief = null;
      await herlaad();
    } catch (e) {
      alert("Verwijderen mislukt: " + (e.message || e));
      knop.disabled = false; knop.textContent = "Verwijderen";
    }
  }

  async function haalAankomst(s, knop) {
    var oud = knop.textContent;
    knop.disabled = true; knop.textContent = "bezig…";
    try {
      var r = await fetch(BASIS + "/voorraad/aankomst", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": cfg.teamKey },
        body: JSON.stringify({ ref: s.trackRef || s.ref, schip: s.ref }),
      });
      var j = await r.json();
      if (!j.ok) {
        alert("Geen aankomst gevonden voor " + s.ref + ".\n\n" + (j.error || "") +
          (j.nietAangesloten && j.nietAangesloten.length
            ? "\n\nNog niet aangesloten: " + j.nietAangesloten.join(", ") + "."
            : ""));
      } else {
        alert("Volgens " + j.vervoerder + ":\n\n" +
          "Aankomst: " + (j.eta ? nlDatum(j.eta) : "onbekend") + "\n" +
          (j.vessel ? "Schip: " + j.vessel + "\n" : "") +
          (j.status ? "Status: " + j.status + "\n" : "") +
          "\nDeze datum wordt niet vanzelf overgenomen; gebruik “Aankomst bijwerken” om hem op de inkooporder te zetten.");
        if (cfg.log) cfg.log("voorraad", "aankomst-opgehaald", s.ref + " via " + j.vervoerder + ": " + (j.eta || "geen datum"));
        if (j.bewaard) { await herlaad(); return; }
      }
    } catch (e) {
      alert("Opvragen mislukt: " + (e.message || e));
    }
    knop.disabled = false; knop.textContent = oud;
  }

  async function herlaad() {
    bezig = true; teken();
    try { voorstel = await haal(); }
    catch (e) {
      doel.innerHTML = "";
      doel.appendChild(el("p", "status-msg", "Voorstel ophalen mislukt: " + (e.message || e)));
      bezig = false; return;
    }
    bezig = false; teken();
  }

  async function start(opties) {
    cfg = opties || {};
    doel = document.getElementById(cfg.doelId || "tab-ontvangst");
    if (!doel || !cfg.teamKey) return;
    if (voorstel) { teken(); return; }
    await herlaad();
  }

  /* Ook opnieuw te laden van buitenaf. De commercial-invoice-upload staat nu
     boven dit scherm; na een upload moet de nieuwe zending er meteen bij
     staan, anders lijkt het of er niets gebeurd is. */
  global.fpSpaOntvangst = {
    start: start,
    ververs: function () { if (doel && cfg) return herlaad(); },
  };

})(typeof window !== "undefined" ? window : globalThis);
