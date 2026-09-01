/* ═══════════════════════════════════════════════════════════════════════════
   TAKENLADE — persoonlijke takenlijst, als uitschuiflade aan de zijkant
   ═══════════════════════════════════════════════════════════════════════════

   Gerrit, 31 aug 2026: "ik wil niet dat Takenlijst een tegel is, maar een
   soort popup aan de zijkant van het dashboard. Als je erop klikt schuift de
   takenlijst uit, als je er weer op klikt (een soort uitstulpje) schuift ie
   weer in naar de zijkant."

   Dit bestand ving eerst als losse pagina takenlijst.html aan. Een tegel was
   verkeerd: een takenlijst is niet iets waar je naartoe navigeert en weer
   vandaan komt, het is iets dat naast je werk open staat. Vandaar een lade die
   over het dashboard heen schuift en het dashboard zelf niet verstoort.

   Wie ziet wat
   ------------
   Elke taak heeft één eigenaar. Je ziet een taak alleen als je de eigenaar
   bent, óf als je bij de deelnemers staat. LET WEL: dit is een scheiding in
   het scherm, geen slot. Het dashboard werkt met één gedeelde sleutel die op
   elke werkplek staat; wie die pakt kan de opslag rechtstreeks lezen. Dat
   geldt voor elke tegel hier.

   Waarom één opslag en niet één per persoon
   -----------------------------------------
   Een uitnodiging heeft twee kanten die hetzelfde record moeten zien: hij moet
   hem kunnen aannemen of weigeren, en de uitnodiger moet dat meteen terugzien.
   Met een lijst per persoon zou elke actie twee schrijfacties zijn die half
   kunnen mislukken.

   Waarom read-modify-write bij elke wijziging
   -------------------------------------------
   De opslag kent alleen "vervang alles". Vier mensen met dit scherm open zou
   met een blinde PUT betekenen dat de laatste de rest wist. Dus: vóór élke
   opslag de verse stand ophalen, daarin één record aanpassen, terugschrijven.

   Alles staat in een eigen naamruimte en injecteert zijn eigen stijl, zodat
   het dashboard er niets van merkt.

   OTA: dit bestand staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var WORKER = "https://fonteyn-data-store.g-mulder.workers.dev";
  var BUCKET = WORKER + "/data/takenlijst";
  var GROEP  = "taken";

  var IK = "", IKNAAM = "", taken = {}, bezig = false, actief = "eigen", open_ = false;
  var gestart = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function kort(mail) {
    return String(mail || "").toLowerCase().trim().split("@")[0].replace(/^fonteyn\./, "");
  }
  function teamkey() { return localStorage.getItem("fp.teamkey") || ""; }

  /* ─── Weken ─────────────────────────────────────────────────────────────
     Een taak hoort bij een week, niet bij een dag: "wat moet er deze week
     gebeuren". ISO-weeknummer, maandag tot en met zondag. */
  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    var jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return t.getUTCFullYear() + "-W" + String(Math.ceil((((t - jan1) / 86400000) + 1) / 7)).padStart(2, "0");
  }
  function maandagVan(d) {
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    t.setDate(t.getDate() - ((t.getDay() || 7) - 1));
    return t;
  }
  var DEZE = isoWeek(new Date());
  function weekOpties() {
    var uit = [];
    for (var i = -1; i <= 5; i++) {
      var m = maandagVan(new Date()); m.setDate(m.getDate() + i * 7);
      uit.push({ code: isoWeek(m), maandag: m });
    }
    return uit;
  }
  function weekLabel(code) {
    var nr = String(code).split("-W")[1] || "?";
    if (code === DEZE) return "Deze week";
    var o = weekOpties(), i = -1;
    for (var k = 0; k < o.length; k++) if (o[k].code === code) i = k;
    if (i === 0) return "Vorige week (week " + nr + ")";
    if (i === 2) return "Volgende week (week " + nr + ")";
    if (code < DEZE) return "Blijven staan (week " + nr + ")";
    return "Week " + nr;
  }
  function datumNL(iso) {
    if (!iso) return "";
    var d = new Date(iso); if (isNaN(d)) return "";
    return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) + " " +
           d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  }

  /* ─── Terugkerende taken ────────────────────────────────────────────────
     Manon (1 sep 2026): "kun je zorgen dat er dagelijks en wekelijks
     terugkerende taken ingevuld kunnen worden? Bijv. dagelijks Bol.com
     verwerken, wekelijks bepalen waar de geloste containers ingeruimd
     worden."

     Een ritme is een sjabloon, geen taak. Bij het openen van de lade wordt
     gekeken of er voor vandaag (dagelijks) of voor deze week (wekelijks) al
     een taak uit dat sjabloon bestaat; zo niet, dan komt hij er. Daardoor
     staat "Bol.com verwerken" elke ochtend gewoon op je lijst, ook als die
     van gisteren nooit is afgevinkt.

     De id van zo'n taak is met opzet voorspelbaar (r:<ritme>:<periode>):
     doen twee mensen dit tegelijk, dan schrijven ze dezelfde sleutel en
     ontstaat er geen dubbele taak. */
  function vandaagISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function periodeVan(ritme) { return ritme === "dag" ? vandaagISO() : DEZE; }

  /* Wie kun je uitnodigen: alleen mensen die de lade zelf ook hebben. Nodig je
     iemand anders uit, dan krijgt hij nooit een scherm om te accepteren en zou
     de taak stilletjes nergens landen. */
  function uitnodigbaar() {
    var t = global.fpToegang;
    var g = (t && t.groepen && t.groepen[GROEP]) || [];
    return g.filter(function (n) { return n !== IKNAAM; }).slice().sort();
  }

  /* ─── Opslag ──────────────────────────────────────────────────────────── */
  function haal() {
    return fetch(BUCKET, { headers: { "X-Fonteyn-Auth": teamkey() } }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      return (j && typeof j.taken === "object" && j.taken) ? j.taken : {};
    });
  }
  var ritmes = {};
  function haalAlles() {
    return fetch(BUCKET, { headers: { "X-Fonteyn-Auth": teamkey() } }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function laad() {
    return haalAlles().then(function (j) {
      taken = (j && typeof j.taken === "object" && j.taken) ? j.taken : {};
      ritmes = (j && typeof j.ritmes === "object" && j.ritmes) ? j.ritmes : {};
      stand(""); teken(); telBij();
      return zorgVoorRitmetaken();
    }).catch(function (e) { stand("Lijst niet opgehaald (" + e.message + "). Je ziet de laatst geladen stand.", true); });
  }

  /* Voor elk eigen ritme: staat de taak van deze periode er al? Zo niet, maak
     hem. Alles in één schrijfactie, zodat vijf ritmes geen vijf rondjes naar
     de opslag kosten. */
  function zorgVoorRitmetaken() {
    var missend = [];
    for (var id in ritmes) if (Object.prototype.hasOwnProperty.call(ritmes, id)) {
      var rt = ritmes[id];
      if (!rt || rt.eigenaar !== IKNAAM) continue;
      var sleutel = "r:" + id + ":" + periodeVan(rt.ritme);
      if (!taken[sleutel]) missend.push({ sleutel: sleutel, rt: rt });
    }
    if (!missend.length) return Promise.resolve(false);
    return schrijf(function (v) {
      missend.forEach(function (m) {
        if (v[m.sleutel]) return;
        v[m.sleutel] = {
          id: m.sleutel, eigenaar: IKNAAM, lijst: m.rt.lijst || "eigen",
          tekst: m.rt.tekst, wie: m.rt.wie || "", week: DEZE,
          dag: m.rt.ritme === "dag" ? vandaagISO() : null,
          uitRitme: m.rt.id, ritme: m.rt.ritme,
          door: IK, op: new Date().toISOString(),
          klaar: false, klaarDoor: "", klaarOp: "", deelnemers: {},
        };
      });
    });
  }
  /* wijzig() past de verse takenlijst aan, wijzigRitmes() de verse ritmes.
     Allebei op de VERSE stand, want tussendoor kan een ander iets hebben
     toegevoegd. Deed ik dat niet en werkte ik met de kopie in het geheugen,
     dan zou het toevoegen of stoppen van een herhaling meteen worden
     teruggedraaid door de verse stand die er overheen komt. */
  function schrijf(wijzig, wijzigRitmes) {
    if (bezig) return Promise.resolve(false);
    bezig = true; stand("Bezig met opslaan…");
    return haalAlles().then(function (j) {
      var vers = (j && typeof j.taken === "object" && j.taken) ? j.taken : {};
      var versRitmes = (j && typeof j.ritmes === "object" && j.ritmes) ? j.ritmes : {};
      if (wijzig) wijzig(vers);
      if (wijzigRitmes) wijzigRitmes(versRitmes);
      ritmes = versRitmes;
      return fetch(BUCKET, { method: "PUT",
        headers: { "Content-Type": "application/json", "X-Fonteyn-Auth": teamkey() },
        body: JSON.stringify({ taken: vers, ritmes: versRitmes, bijgewerkt: new Date().toISOString(), door: IK })
      }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        taken = vers; teken(); telBij();
        stand("Opgeslagen om " + new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }));
        return true;
      });
    }).catch(function (e) {
      stand("Niet opgeslagen: " + e.message + ". Probeer het nog een keer.", true);
      return false;
    }).then(function (r) { bezig = false; return r; });
  }
  function stand(tekst, fout) {
    var e = $("tlStand"); if (!e) return;
    e.textContent = tekst || "";
    e.style.color = fout ? "#b3261e" : "#6b7280";
  }
  function melding(tekst, soort) {
    var e = $("tlMelding"); if (!e) return;
    e.innerHTML = tekst ? "<div class='tl-mel tl-" + (soort || "bad") + "'>" + esc(tekst) + "</div>" : "";
  }

  /* ─── Welke taken zie ik ──────────────────────────────────────────────── */
  function vanMij(t) { return t.eigenaar === IKNAAM; }
  function mijnDeel(t) { return (t.deelnemers || {})[IKNAAM] || null; }
  function alleZichtbaar() {
    var uit = [];
    for (var k in taken) if (Object.prototype.hasOwnProperty.call(taken, k)) {
      var t = taken[k];
      if (t && (vanMij(t) || mijnDeel(t))) uit.push(t);
    }
    return uit;
  }
  function lijstEigen() {
    return alleZichtbaar().filter(function (t) {
      if (t.klaar) return false;
      if (vanMij(t)) return t.lijst === "eigen";
      var d = mijnDeel(t); return d && d.status === "ja";
    });
  }
  function lijstDelegeren() {
    return alleZichtbaar().filter(function (t) { return !t.klaar && vanMij(t) && t.lijst === "delegeren"; });
  }
  function lijstUitnodiging() {
    return alleZichtbaar().filter(function (t) {
      if (t.klaar || vanMij(t)) return false;
      var d = mijnDeel(t); return d && d.status === "open";
    });
  }
  function lijstAfgerond() {
    return alleZichtbaar().filter(function (t) {
      if (!t.klaar) return false;
      if (vanMij(t)) return true;
      var d = mijnDeel(t); return d && d.status === "ja";
    });
  }

  /* Het aantal op het uitstulpje: openstaande uitnodigingen wegen het zwaarst,
     want daar wacht iemand anders op. Anders het aantal open taken. */
  function telBij() {
    var u = lijstUitnodiging().length, o = lijstEigen().length + lijstDelegeren().length;
    var bol = $("tlBadge"); if (!bol) return;
    if (u) { bol.textContent = u; bol.className = "tl-badge tl-let"; bol.style.display = ""; }
    else if (o) { bol.textContent = o; bol.className = "tl-badge"; bol.style.display = ""; }
    else { bol.style.display = "none"; }
    var t = $("tlTabU");
    if (t) { t.style.display = u ? "" : "none"; t.textContent = "Uitnodigingen (" + u + ")"; }
    var e = $("tlTabE"), d = $("tlTabD"), a = $("tlTabA");
    if (e) e.textContent = "Eigen (" + lijstEigen().length + ")";
    if (d) d.textContent = "Delegeren (" + lijstDelegeren().length + ")";
    if (a) a.textContent = "Afgerond (" + lijstAfgerond().length + ")";
    if (!u && actief === "uitnodiging") { actief = "eigen"; teken(); }
  }

  /* ─── Tekenen ─────────────────────────────────────────────────────────── */
  function deelPillen(t) {
    var d = t.deelnemers || {}, namen = Object.keys(d);
    if (!namen.length) return "";
    return "<div class='tl-deelrij'>" + namen.map(function (n) {
      var s = d[n].status;
      var woord = s === "ja" ? "doet mee" : (s === "nee" ? "geweigerd" : "nog geen antwoord");
      return "<span class='tl-deel tl-" + (s === "ja" ? "ja" : s === "nee" ? "nee" : "open") + "'>" +
        esc(n) + " · " + woord + "</span>";
    }).join("") + "</div>";
  }
  function uitnodigVak(t) {
    var kan = uitnodigbaar().filter(function (n) { return !(t.deelnemers || {})[n]; });
    if (!kan.length) return "";
    return "<select class='tl-mini' data-nodig='" + esc(t.id) + "'>" +
      "<option value=''>+ iemand uitnodigen…</option>" +
      kan.map(function (n) { return "<option value='" + esc(n) + "'>" + esc(n) + "</option>"; }).join("") +
      "</select>";
  }
  function weekKeuze(t) {
    var o = weekOpties(), heeft = false;
    var opts = o.map(function (x) {
      if (x.code === t.week) heeft = true;
      return "<option value='" + x.code + "'" + (x.code === t.week ? " selected" : "") + ">wk " + x.code.split("-W")[1] + "</option>";
    }).join("");
    if (!heeft) opts += "<option value='" + esc(t.week) + "' selected>wk " + esc(String(t.week).split("-W")[1]) + "</option>";
    return "<select class='tl-mini' data-week='" + esc(t.id) + "' title='Naar een andere week'>" + opts + "</select>";
  }
  function regel(t, o) {
    o = o || {};
    var mij = vanMij(t);
    /* Alleen zolang de herhaling nog loopt. Is hij gestopt, dan blijft de taak
       van vandaag staan maar hoort er geen 'elke dag' meer bij - en ook geen
       stopknop die niets meer doet. */
    var loopt = !!(t.uitRitme && ritmes[t.uitRitme]);
    var herhaal = (t.ritme && loopt)
      ? "<span class='tl-pil tl-ritme'>" + (t.ritme === "dag" ? "elke dag" : "elke week") + "</span>"
      : "";
    var van = mij ? "" : "<span class='tl-pil tl-van'>van " + esc(t.eigenaar) + "</span>";
    var voor = (t.lijst === "delegeren" && t.wie) ? "<span class='tl-pil tl-voor'>" + esc(t.wie) + "</span>" : "";
    return "<div class='tl-taak" + (o.af ? " tl-af" : "") + "'>" +
      (o.geenVink ? "" : "<input type='checkbox'" + (o.af ? " checked" : "") +
        " data-" + (o.af ? "terug" : "klaar") + "='" + esc(t.id) + "'>") +
      "<div class='tl-mid'>" +
        "<div class='tl-tekst'" + (mij && !o.af ? " data-bewerk='" + esc(t.id) + "' title='Klik om aan te passen'" : "") + ">" +
          van + voor + herhaal + esc(t.tekst) + "</div>" +
        "<div class='tl-meta'>" + esc(o.meta || (t.dag
            ? ("voor " + new Date(t.dag).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" }))
            : ("gezet door " + kort(t.door) + " op " + datumNL(t.op)))) + "</div>" +
        (mij ? deelPillen(t) : "") +
        (o.knoppen || "") +
        "<div class='tl-onder'>" + (mij && !o.af
            ? (t.dag ? "" : weekKeuze(t)) + uitnodigVak(t) +
              /* Zonder deze knop komt een terugkerende taak eeuwig terug en is
                 er geen weg terug. De taak van vandaag blijft staan; alleen de
                 herhaling stopt. */
              (loopt ? "<button class='tl-mini' data-stop='" + esc(t.uitRitme) + "' " +
                 "title='Deze taak niet meer laten terugkomen'>herhaling stoppen</button>" : "")
            : "") + "</div>" +
      "</div></div>";
  }
  function perWeek(rijen) {
    var g = {};
    rijen.forEach(function (t) { (g[t.week] = g[t.week] || []).push(t); });
    return Object.keys(g).sort().map(function (w) {
      var r = g[w].sort(function (a, b) { return String(a.op).localeCompare(String(b.op)); });
      return "<div class='tl-weekkop" + (w < DEZE ? " tl-laat" : "") + "'>" + esc(weekLabel(w)) + " · " + r.length + "</div>" +
        r.map(function (t) { return regel(t); }).join("");
    }).join("");
  }

  function teken() {
    var box = $("tlLijst"); if (!box) return;
    document.querySelectorAll(".tl-tab").forEach(function (b) {
      b.classList.toggle("tl-actief", b.dataset.tab === actief);
    });
    var invoer = $("tlInvoer");
    if (invoer) invoer.style.display = (actief === "eigen" || actief === "delegeren") ? "" : "none";
    var wie = $("tlWie");
    if (wie) wie.style.display = actief === "delegeren" ? "" : "none";

    if (actief === "uitnodiging") {
      var u = lijstUitnodiging();
      box.innerHTML = !u.length ? "<p class='tl-leeg'>Geen openstaande uitnodigingen.</p>" :
        "<p class='tl-uitleg'>Iemand wil deze taak bij jou neerleggen. Neem je hem aan, dan staat hij bij <b>Eigen</b>. Weiger je, dan verdwijnt hij van jouw lijst en ziet de uitnodiger dat je hebt geweigerd.</p>" +
        u.map(function (t) {
          return regel(t, { geenVink: true,
            meta: "uitgenodigd door " + kort(t.door) + " op " + datumNL((t.deelnemers[IKNAAM] || {}).op || t.op) +
                  " · week " + (String(t.week).split("-W")[1] || "?"),
            knoppen: "<div class='tl-knoprij'><button class='tl-knop tl-vol' data-ja='" + esc(t.id) + "'>Aannemen</button>" +
                     "<button class='tl-knop tl-rood' data-nee='" + esc(t.id) + "'>Weigeren</button></div>" });
        }).join("");
    } else if (actief === "afgerond") {
      var af = lijstAfgerond().sort(function (a, b) { return String(b.klaarOp).localeCompare(String(a.klaarOp)); });
      box.innerHTML = !af.length ? "<p class='tl-leeg'>Nog niets afgevinkt. Wat je afvinkt verdwijnt uit de lijst en komt hier te staan.</p>" :
        af.map(function (t) {
          return regel(t, { af: true,
            meta: (t.lijst === "delegeren" ? "Delegeren" : "Eigen taak") + " · week " + (String(t.week).split("-W")[1] || "?") +
                  " · afgevinkt door " + kort(t.klaarDoor) + " op " + datumNL(t.klaarOp),
            knoppen: "<div class='tl-knoprij'><button class='tl-knop' data-terug2='" + esc(t.id) + "'>Terughalen</button></div>" });
        }).join("");
    } else {
      var rijen = actief === "eigen" ? lijstEigen() : lijstDelegeren();
      box.innerHTML = !rijen.length
        ? "<p class='tl-leeg'>" + (actief === "delegeren"
            ? "Niets uitstaan bij iemand anders. Zet hierboven een klus neer en vul in voor wie."
            : "Geen openstaande taken. Zet hierboven neer wat er deze week moet gebeuren.") + "</p>"
        : perWeek(rijen);
    }
    koppelRegels(box);
  }

  function koppelRegels(box) {
    box.querySelectorAll("[data-klaar]").forEach(function (c) {
      c.addEventListener("change", function () {
        var id = c.dataset.klaar; c.disabled = true;
        schrijf(function (v) {
          if (v[id]) { v[id].klaar = true; v[id].klaarDoor = IK; v[id].klaarOp = new Date().toISOString(); }
        }).then(function (ok) { if (!ok) { c.checked = false; c.disabled = false; } });
        if (global.fpLog) global.fpLog("taak-afgevinkt", id);
      });
    });
    function terug(id, el) {
      if (el) el.disabled = true;
      schrijf(function (v) {
        if (v[id]) { v[id].klaar = false; v[id].klaarDoor = ""; v[id].klaarOp = ""; }
      }).then(function (ok) { if (!ok && el) el.disabled = false; });
    }
    box.querySelectorAll("[data-terug]").forEach(function (c) {
      c.addEventListener("change", function () { terug(c.dataset.terug, c); });
    });
    box.querySelectorAll("[data-terug2]").forEach(function (b) {
      b.addEventListener("click", function () { terug(b.dataset.terug2, b); });
    });
    box.querySelectorAll("[data-stop]").forEach(function (b) {
      b.addEventListener("click", function () {
        var rid = b.dataset.stop, rt = ritmes[rid];
        if (!rt) return;
        if (!confirm("\u201c" + rt.tekst + "\u201d niet meer laten terugkomen?\n\nDe taak van nu blijft gewoon staan; alleen de herhaling stopt.")) return;
        b.disabled = true;
        var bewaar = rt;
        schrijf(null, function (rs) { delete rs[rid]; }).then(function (ok) {
          if (!ok) { b.disabled = false; return; }
          if (global.fpLog) global.fpLog("taak-ritme-gestopt", bewaar.tekst.slice(0, 60));
          teken();
        });
      });
    });
    box.querySelectorAll("[data-week]").forEach(function (s) {
      s.addEventListener("change", function () {
        var id = s.dataset.week, w = s.value;
        schrijf(function (v) { if (v[id]) v[id].week = w; });
      });
    });
    box.querySelectorAll("[data-nodig]").forEach(function (s) {
      s.addEventListener("change", function () {
        var id = s.dataset.nodig, naam = s.value;
        if (!naam) return;
        s.disabled = true;
        schrijf(function (v) {
          if (!v[id]) return;
          v[id].deelnemers = v[id].deelnemers || {};
          v[id].deelnemers[naam] = { status: "open", op: new Date().toISOString(), door: IKNAAM };
        });
        if (global.fpLog) global.fpLog("taak-uitgenodigd", naam + " voor " + id);
      });
    });
    function antwoord(id, status, el) {
      if (el) el.disabled = true;
      schrijf(function (v) {
        if (!v[id] || !v[id].deelnemers || !v[id].deelnemers[IKNAAM]) return;
        v[id].deelnemers[IKNAAM].status = status;
        v[id].deelnemers[IKNAAM].beantwoord = new Date().toISOString();
      }).then(function (ok) { if (!ok && el) el.disabled = false; });
      if (global.fpLog) global.fpLog(status === "ja" ? "taak-aangenomen" : "taak-geweigerd", id);
    }
    box.querySelectorAll("[data-ja]").forEach(function (b) {
      b.addEventListener("click", function () { antwoord(b.dataset.ja, "ja", b); });
    });
    box.querySelectorAll("[data-nee]").forEach(function (b) {
      b.addEventListener("click", function () { antwoord(b.dataset.nee, "nee", b); });
    });
    box.querySelectorAll("[data-bewerk]").forEach(function (d) {
      d.addEventListener("click", function () {
        var id = d.dataset.bewerk, t = taken[id]; if (!t) return;
        var inp = document.createElement("input");
        inp.type = "text"; inp.value = t.tekst; inp.className = "tl-bewerk";
        d.replaceWith(inp); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
        var af = false;
        function klaar() {
          if (af) return; af = true;
          var nieuw = inp.value.trim();
          if (nieuw && nieuw !== t.tekst) schrijf(function (v) { if (v[id]) v[id].tekst = nieuw; });
          else teken();
        }
        inp.addEventListener("blur", klaar);
        inp.addEventListener("keydown", function (e) {
          if (e.key === "Enter") klaar();
          if (e.key === "Escape") { af = true; teken(); }
        });
      });
    });
  }

  function voegToe() {
    var tekst = ($("tlTekst").value || "").trim();
    if (!tekst) return melding("Vul eerst in wat er moet gebeuren.");
    var wie = ($("tlWie").value || "").trim();
    if (actief === "delegeren" && !wie) return melding("Vul in voor wie deze taak is.");

    /* Terugkerend? Dan leggen we een sjabloon vast en niet één taak. De taak
       van vandaag/deze week maakt zorgVoorRitmetaken er meteen bij, en morgen
       staat hij er vanzelf weer. */
    var ritme = ($("tlRitme") || {}).value || "";
    if (ritme) {
      var rid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      var nieuwRitme = { id: rid, eigenaar: IKNAAM, tekst: tekst, ritme: ritme,
                         lijst: actief, wie: actief === "delegeren" ? wie : "",
                         door: IK, op: new Date().toISOString() };
      schrijf(null, function (rs) { rs[rid] = nieuwRitme; }).then(function (ok) {
        if (!ok) return;
        $("tlTekst").value = ""; $("tlWie").value = ""; melding("");
        if ($("tlRitme")) $("tlRitme").value = "";
        if (global.fpLog) global.fpLog("taak-ritme-toegevoegd", ritme + ": " + tekst.slice(0, 60));
        return zorgVoorRitmetaken();
      });
      return;
    }
    var taak = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      eigenaar: IKNAAM, lijst: actief, tekst: tekst, wie: actief === "delegeren" ? wie : "",
      week: $("tlWeek").value, door: IK, op: new Date().toISOString(),
      klaar: false, klaarDoor: "", klaarOp: "", deelnemers: {}
    };
    schrijf(function (v) { v[taak.id] = taak; }).then(function (ok) {
      if (!ok) return;
      $("tlTekst").value = ""; $("tlWie").value = ""; melding("");
      $("tlTekst").focus();
      if (global.fpLog) global.fpLog("taak-toegevoegd", actief + ": " + tekst.slice(0, 60));
    });
  }

  /* ─── De lade zelf ────────────────────────────────────────────────────── */
  function schuif(naar) {
    open_ = (naar === undefined) ? !open_ : !!naar;
    var l = $("tlLade"), s = $("tlStulp");
    if (!l) return;
    l.classList.toggle("tl-uit", open_);
    if (s) s.setAttribute("aria-expanded", open_ ? "true" : "false");
    try { localStorage.setItem("fp.takenlade", open_ ? "1" : "0"); } catch (e) {}
    if (open_) { laad(); setTimeout(function () { var t = $("tlTekst"); if (t) t.focus(); }, 260); }
  }

  function bouw() {
    var stijl = document.createElement("style");
    stijl.textContent = [
      "#tlStulp{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:9998;",
      "  background:#144734;color:#fff;border:0;border-radius:10px 0 0 10px;padding:16px 9px;",
      "  font:600 12px/1.2 Montserrat,system-ui,sans-serif;cursor:pointer;writing-mode:vertical-rl;",
      "  box-shadow:-2px 0 10px rgba(0,0,0,.16);letter-spacing:.04em;display:flex;align-items:center;gap:8px}",
      "#tlStulp:hover{background:#0d3325}",
      ".tl-badge{writing-mode:horizontal-tb;background:#8bc53f;color:#123;border-radius:999px;",
      "  padding:1px 7px;font-size:11px;font-weight:700}",
      ".tl-badge.tl-let{background:#f59e0b;color:#3b2600}",
      "#tlLade{position:fixed;top:0;right:0;height:100%;width:400px;max-width:92vw;z-index:9999;",
      "  background:#f7f7f4;border-left:1px solid #e5e7eb;box-shadow:-6px 0 24px rgba(0,0,0,.18);",
      "  transform:translateX(100%);transition:transform .24s ease;display:flex;flex-direction:column;",
      "  font:14px/1.45 Montserrat,system-ui,sans-serif;color:#111827}",
      "#tlLade.tl-uit{transform:translateX(0)}",
      "#tlKop{background:#144734;color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px;flex:none}",
      "#tlKop b{font-size:15px}",
      "#tlDicht{margin-left:auto;background:transparent;border:1px solid rgba(255,255,255,.4);color:#fff;",
      "  border-radius:7px;padding:4px 11px;font:inherit;font-size:12px;cursor:pointer}",
      "#tlTabs{display:flex;gap:5px;padding:9px 12px 0;flex-wrap:wrap;flex:none}",
      ".tl-tab{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:5px 10px;",
      "  font:600 11.5px Montserrat,system-ui,sans-serif;color:#6b7280;cursor:pointer}",
      ".tl-tab.tl-actief{background:#144734;border-color:#144734;color:#fff}",
      "#tlTabU{border-color:#b45309;color:#b45309}",
      "#tlTabU.tl-actief{background:#b45309;border-color:#b45309;color:#fff}",
      "#tlInvoer{padding:10px 12px 0;flex:none}",
      "#tlInvoer input,#tlInvoer select{width:100%;border:1px solid #e5e7eb;border-radius:8px;",
      "  padding:7px 9px;font:inherit;font-size:13px;background:#fff;margin-bottom:6px}",
      "#tlToevoegen{width:100%;background:#144734;color:#fff;border:0;border-radius:8px;padding:8px;",
      "  font:600 12.5px Montserrat,system-ui,sans-serif;cursor:pointer}",
      "#tlLijst{flex:1;overflow-y:auto;padding:8px 12px 14px}",
      ".tl-weekkop{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;",
      "  font-weight:700;margin:12px 0 4px;padding-bottom:4px;border-bottom:1px solid #e5e7eb}",
      ".tl-weekkop.tl-laat{color:#b45309;border-color:#b45309}",
      ".tl-taak{display:flex;gap:9px;padding:8px 0;border-bottom:1px solid #ececec}",
      ".tl-taak input[type=checkbox]{width:17px;height:17px;margin-top:2px;flex:none;cursor:pointer;accent-color:#144734}",
      ".tl-mid{flex:1;min-width:0}",
      ".tl-tekst{font-size:13px;word-break:break-word}",
      ".tl-tekst[data-bewerk]{cursor:text}.tl-tekst[data-bewerk]:hover{background:#fff;border-radius:4px}",
      ".tl-meta{font-size:10.5px;color:#6b7280;margin-top:2px}",
      ".tl-af .tl-tekst{text-decoration:line-through;color:#6b7280}",
      ".tl-pil{display:inline-block;font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:999px;margin-right:5px}",
      ".tl-pil.tl-voor{background:#eef7e3;color:#3f6212}.tl-pil.tl-van{background:#e0e7ff;color:#3730a3}",
      ".tl-pil.tl-ritme{background:#e0f2fe;color:#075985}",
      ".tl-dag{font-size:10.5px;color:#6b7280}",
      ".tl-deelrij{margin-top:3px}",
      ".tl-deel{display:inline-block;font-size:10.5px;font-weight:600;padding:1px 7px;border-radius:999px;margin:2px 4px 0 0}",
      ".tl-deel.tl-open{background:#f3f4f6;color:#6b7280}",
      ".tl-deel.tl-ja{background:#e8f5ee;color:#15803d}",
      ".tl-deel.tl-nee{background:#fdecea;color:#b3261e}",
      ".tl-onder{margin-top:5px;display:flex;gap:5px;flex-wrap:wrap}",
      ".tl-mini{border:1px solid #e5e7eb;border-radius:7px;padding:2px 5px;font:inherit;font-size:11px;background:#fff}",
      ".tl-knoprij{margin-top:6px;display:flex;gap:6px}",
      ".tl-knop{background:#fff;border:1px solid #144734;color:#144734;border-radius:7px;padding:4px 10px;",
      "  font:600 11.5px Montserrat,system-ui,sans-serif;cursor:pointer}",
      ".tl-knop.tl-vol{background:#144734;color:#fff}",
      ".tl-knop.tl-rood{border-color:#b3261e;color:#b3261e}",
      ".tl-bewerk{width:100%;border:1px solid #144734;border-radius:6px;padding:4px 6px;font:inherit;font-size:13px}",
      ".tl-leeg{color:#6b7280;font-size:12.5px;padding:14px 2px}",
      ".tl-uitleg{color:#6b7280;font-size:11.5px;line-height:1.5;margin:0 0 8px}",
      ".tl-mel{padding:6px 10px;border-radius:7px;font-size:11.5px;margin:4px 0}",
      ".tl-mel.tl-bad{background:#fdecea;color:#b3261e}",
      "#tlVoet{flex:none;padding:6px 12px 10px;font-size:10.5px;color:#6b7280;min-height:18px}",
      "@media(max-width:520px){#tlLade{width:100%}}"
    ].join("\n");
    document.head.appendChild(stijl);

    var stulp = document.createElement("button");
    stulp.id = "tlStulp"; stulp.type = "button";
    stulp.setAttribute("aria-expanded", "false");
    stulp.title = "Takenlijst openen en sluiten";
    stulp.innerHTML = "<span>Takenlijst</span><span class='tl-badge' id='tlBadge' style='display:none'>0</span>";
    document.body.appendChild(stulp);

    var lade = document.createElement("aside");
    lade.id = "tlLade";
    lade.innerHTML =
      "<div id='tlKop'><b>Takenlijst</b><button id='tlDicht' type='button'>Sluiten →</button></div>" +
      "<div id='tlTabs'>" +
        "<button class='tl-tab tl-actief' id='tlTabE' data-tab='eigen' type='button'>Eigen (0)</button>" +
        "<button class='tl-tab' id='tlTabD' data-tab='delegeren' type='button'>Delegeren (0)</button>" +
        "<button class='tl-tab' id='tlTabU' data-tab='uitnodiging' type='button' style='display:none'>Uitnodigingen (0)</button>" +
        "<button class='tl-tab' id='tlTabA' data-tab='afgerond' type='button'>Afgerond (0)</button>" +
      "</div>" +
      "<div id='tlInvoer'>" +
        "<input type='text' id='tlTekst' placeholder='Wat moet er gebeuren?' autocomplete='off'>" +
        "<input type='text' id='tlWie' placeholder='Voor wie? (bijv. de jongens)' autocomplete='off' style='display:none'>" +
        "<select id='tlWeek'></select>" +
        "<select id='tlRitme'>" +
          "<option value=''>eenmalig</option>" +
          "<option value='dag'>elke dag</option>" +
          "<option value='week'>elke week</option>" +
        "</select>" +
        "<button id='tlToevoegen' type='button'>Toevoegen</button>" +
        "<div id='tlMelding'></div>" +
      "</div>" +
      "<div id='tlLijst'></div>" +
      "<div id='tlVoet'><span id='tlStand'></span></div>";
    document.body.appendChild(lade);

    $("tlWeek").innerHTML = weekOpties().map(function (o) {
      var nr = o.code.split("-W")[1];
      var tekst = o.code === DEZE ? ("Deze week (" + nr + ")")
        : ("Week " + nr + " — vanaf " + o.maandag.toLocaleDateString("nl-NL", { day: "numeric", month: "short" }));
      return "<option value='" + o.code + "'" + (o.code === DEZE ? " selected" : "") + ">" + esc(tekst) + "</option>";
    }).join("");

    stulp.addEventListener("click", function () { schuif(); });
    $("tlDicht").addEventListener("click", function () { schuif(false); });
    $("tlToevoegen").addEventListener("click", voegToe);
    $("tlTekst").addEventListener("keydown", function (e) { if (e.key === "Enter") voegToe(); });
    $("tlWie").addEventListener("keydown", function (e) { if (e.key === "Enter") voegToe(); });
    document.querySelectorAll(".tl-tab").forEach(function (b) {
      b.addEventListener("click", function () { actief = b.dataset.tab; melding(""); teken(); });
    });
    // Escape sluit de lade; dat verwacht iedereen bij zoiets.
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && open_) schuif(false); });
  }

  /* ─── Starten ─────────────────────────────────────────────────────────── */
  function start(email) {
    if (gestart) return;
    IK = String(email || "").toLowerCase();
    IKNAAM = kort(IK);
    var t = global.fpToegang;
    if (!t || !t.mag || !t.mag(GROEP, IK)) return;   // geen lade, geen uitstulpje
    gestart = true;
    bouw();
    laad().then(function () {
      /* Stond hij vorige keer open, dan weer open - maar alleen op een breed
         scherm. Op een telefoon is de lade schermvullend, en dan zou je bij
         het openen van het dashboard eerst je takenlijst over je tegels heen
         krijgen zonder erom te vragen. Daar begin je met de tegels. */
      var wil = false;
      try { wil = localStorage.getItem("fp.takenlade") === "1"; } catch (e) {}
      if (wil && global.innerWidth >= 640) schuif(true);
    });
    setInterval(function () { if (!document.hidden && !bezig) laad(); }, 120000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && !bezig && gestart) laad();
    });
  }

  /* Openstaande uitnodigingen, voor het blok bovenaan het dashboard (taken.js).
     Leest dezelfde opslag; geeft [] terug als er niets is of iets misgaat. */
  function uitnodigingenVoor(email) {
    var naam = kort(email);
    return fetch(BUCKET, { headers: { "X-Fonteyn-Auth": teamkey() } })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) {
        var alle = (j && j.taken) || {}, uit = [];
        for (var k in alle) if (Object.prototype.hasOwnProperty.call(alle, k)) {
          var t = alle[k];
          if (!t || t.klaar) continue;
          var d = (t.deelnemers || {})[naam];
          if (d && d.status === "open") uit.push(t);
        }
        return uit;
      }).catch(function () { return []; });
  }

  global.fpTakenlade = {
    start: start,
    open: function () { schuif(true); },
    /* Vanaf het blok bovenaan het dashboard: lade open én meteen op het
       tabblad waar het antwoord gegeven moet worden. */
    openUitnodigingen: function () { actief = "uitnodiging"; schuif(true); teken(); },
    uitnodigingen: uitnodigingenVoor
  };

})(typeof window !== "undefined" ? window : globalThis);
