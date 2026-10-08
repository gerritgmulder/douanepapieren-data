/* ═══════════════════════════════════════════════════════════════════════════
   VOORRAAD-REKEN - één rekenwijze voor Voorraadbeheer > Overzicht
   ═══════════════════════════════════════════════════════════════════════════

   Gerrit (8 okt 2026): de telefoon zei bij Refresh 119 tekort, de pc zei
   gedekt, en uitgeklapt stond er weer 4 tekort. Drie rekenwijzen naast elkaar.
   Dit bestand is de enige: voorraad.html (pc, ingeklapt en uitgeklapt) en
   voorraad-mobiel.html (telefoon) rekenen allebei hiermee. De worker
   (Voorraadbepaling, vbMetOverzicht) heeft een letterlijke kopie van
   fpOverzichtModel; wie hier iets verandert, verandert het daar ook.

   Per model:
     gereserveerd  orders van Fonteyn die nog geleverd moeten worden, zonder de
                   partnercontainers (die gaan rechtstreeks naar de dealer)
     op voorraad   vrij in Uddel
     op zee        schepen die nog onderweg zijn (niet binnengemeld, geen
                   dealercontainer, ETA niet ouder dan 30 dagen)
     in productie  open inkooporders bij de fabriek, zonder Houston, min wat
                   van dezelfde proforma al op zee is
     tekort        PER KLEUR: wat in een kleur gereserveerd is en in die kleur
                   niet ligt, vaart of gemaakt wordt. Een reservering zonder
                   kleurvoorkeur mag elke kleur hebben die over is. Wat er op
                   zee is zonder open inkooporder (kleur onbekend) gaat er nog
                   af. Zo is het tekort van het model precies de optelling van
                   de kleuren, ingeklapt en uitgeklapt hetzelfde getal.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  /* Kleurnamen op één vorm, zodat reservering, voorraad en inkooporder
     dezelfde kleur ook als dezelfde zien. */
  function fpKleurSleutel(k) {
    var s = String(k == null ? "" : k).toLowerCase()
      .replace(/\|.*$/, "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\*+/g, " ")
      .replace(/\bmet\b.*$/, "")
      .replace(/\boutlet\b/g, " ")
      .replace(/\b(spa|swimspa)\b/g, " ")
      .replace(/trim\b/g, " trim ")
      .replace(/[\/]+/g, " / ")
      .replace(/[^a-z0-9À-ɏ\/ ]+/g, " ")
      .replace(/\s+/g, " ").trim();
    return s || "(geen kleur)";
  }
  // De catalogus schrijft "Bliss Spa | Sterling White with GREY/oak trim".
  function fpCodeKleur(cat) {
    var uit = {};
    Object.keys((cat && cat.models) || {}).forEach(function (m) {
      (cat.models[m] || []).forEach(function (v) {
        if (!v || !v.code) return;
        var s = String(v.desc || ""), i = s.indexOf("|");
        uit[String(v.code)] = i < 0 ? null : s.slice(i + 1);
      });
    });
    return uit;
  }
  function fpProformaNummers(t) {
    var uit = [], re = /\b(\d{4})\b/g, m;
    while ((m = re.exec(String(t || "")))) uit.push(m[1]);
    return uit;
  }
  var AMERIKA = /texas|houston|\busa\b|amerika|america/i;
  function fpSchipOnderweg(s, vandaag) {
    if (!s || s.binnenGemeld || s.dealerContainer || s.alleenDocumenten) return false;
    var eta = String(s.etaHand || s.eta || (s.track && s.track.eta) || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(eta)) {
      var grens = new Date(Date.parse(vandaag + "T00:00:00Z") - 30 * 86400000).toISOString().slice(0, 10);
      if (eta < grens) return false;
    }
    return true;
  }

  /* Eén model doorrekenen.
     reserveringen: regels uit reserveringen-live.byModel[m] ({qty, kleur, container})
     hal:          voorraad-hallen.models[m] ({available, variants{code:vrij}})
     prodRegels:   voorraad-productie.models[m] ({qty, kleur, ref})
     zeeTotaal:    stuks van dit model op schepen die onderweg zijn
     zeePf:        {proforma: stuks van dit model op zee}
     codeKleur:    artikelcode -> kleur (fpCodeKleur) */
  function fpOverzichtModel(reserveringen, hal, prodRegels, zeeTotaal, zeePf, codeKleur) {
    var fon = (reserveringen || []).filter(function (r) { return !r.container; });
    var con = (reserveringen || []).filter(function (r) { return r.container; });
    var res = fon.reduce(function (n, r) { return n + (Number(r.qty) || 0); }, 0);
    var conQty = con.reduce(function (n, r) { return n + (Number(r.qty) || 0); }, 0);
    var voorraad = Number((hal || {}).available) || 0;
    var prod = (prodRegels || []).filter(function (x) { return !AMERIKA.test(String(x.ref || "")); });
    // Productie per proforma, en wat daarvan al vaart.
    var perPf = {};
    prod.forEach(function (x) { var nr = fpProformaNummers(x.ref)[0] || ""; perPf[nr] = (perPf[nr] || 0) + (Number(x.qty) || 0); });
    var zeeInIko = 0;
    Object.keys(perPf).forEach(function (nr) { if (nr) zeeInIko += Math.min(perPf[nr], Number((zeePf || {})[nr]) || 0); });
    var prodRuw = prod.reduce(function (n, x) { return n + (Number(x.qty) || 0); }, 0);
    var zee = Number(zeeTotaal) || 0;
    var prodNet = Math.max(0, prodRuw - zeeInIko);       // nog bij de fabriek
    var zeeZonderKleur = Math.max(0, zee - zeeInIko);     // vaart, maar de kleur is onbekend

    // Per kleur: gereserveerd, op voorraad, en wat er komt (op zee of in productie).
    var per = {};
    function zet(k, veld, n) {
      if (!per[k]) per[k] = { kleur: k, gereserveerd: 0, voorraad: 0, komt: 0 };
      per[k][veld] += n;
    }
    fon.forEach(function (r) { zet(fpKleurSleutel(r.kleur), "gereserveerd", Number(r.qty) || 0); });
    var vs = (hal && hal.variants) || {};
    Object.keys(vs).forEach(function (code) { zet(fpKleurSleutel((codeKleur || {})[code]), "voorraad", Number(vs[code]) || 0); });
    prod.forEach(function (x) { zet(fpKleurSleutel(x.kleur), "komt", Number(x.qty) || 0); });
    var kleuren = Object.keys(per).map(function (k) { return per[k]; });
    var geen = per["(geen kleur)"] || { gereserveerd: 0 };
    var over = 0;
    kleuren.forEach(function (x) {
      if (x.kleur === "(geen kleur)") return;
      x.open = Math.max(0, x.gereserveerd - x.voorraad - x.komt);
      over += Math.max(0, x.voorraad + x.komt - x.gereserveerd);
    });
    // Zonder kleurvoorkeur: elke kleur die over is, telt.
    if (per["(geen kleur)"]) {
      var g = per["(geen kleur)"];
      g.open = Math.max(0, g.gereserveerd - g.voorraad - g.komt - over);
    }
    var openKleuren = kleuren.reduce(function (n, x) { return n + (x.open || 0); }, 0);
    var vanZee = Math.min(openKleuren, zeeZonderKleur);
    var tekort = openKleuren - vanZee;
    kleuren.sort(function (a, b) { return (b.open - a.open) || (b.gereserveerd - a.gereserveerd) || a.kleur.localeCompare(b.kleur, "nl"); });
    return {
      gereserveerd: res, partnercontainers: conQty, voorraad: voorraad, zee: zee, productie: prodNet,
      kleuren: kleuren.filter(function (x) { return x.gereserveerd || x.voorraad || x.komt; }),
      zeeZonderKleur: zeeZonderKleur, vanZee: vanZee, tekort: tekort,
      gedekt: res > 0 ? tekort === 0 : null
    };
  }

  /* Alle modellen in één keer, uit de vier KV-bakken plus de catalogus. */
  function fpOverzicht(resv, hallen, schepen, productie, cat, vandaag) {
    vandaag = vandaag || new Date().toISOString().slice(0, 10);
    var byModel = (resv && resv.byModel) || {}, halM = (hallen && hallen.models) || {}, prodM = (productie && productie.models) || {};
    var zeeM = {}, zeePf = {};
    ((schepen && schepen.ships) || []).forEach(function (s) {
      if (!fpSchipOnderweg(s, vandaag)) return;
      var nrs = fpProformaNummers(s.ref || s.trackRef || s.file);
      Object.keys(s.models || {}).forEach(function (m) {
        var q = Number(s.models[m]) || 0;
        zeeM[m] = (zeeM[m] || 0) + q;
        nrs.forEach(function (nr) { zeePf[m] = zeePf[m] || {}; zeePf[m][nr] = (zeePf[m][nr] || 0) + q; });
      });
    });
    var codeKleur = fpCodeKleur(cat);
    var namen = {};
    [byModel, halM, prodM, zeeM].forEach(function (o) { Object.keys(o).forEach(function (m) { namen[m] = 1; }); });
    var uit = {};
    Object.keys(namen).forEach(function (m) {
      var r = fpOverzichtModel(byModel[m], halM[m], prodM[m], zeeM[m], zeePf[m], codeKleur);
      if (r.gereserveerd || r.partnercontainers || r.voorraad || r.zee || r.productie) uit[m] = r;
    });
    return uit;
  }

  global.fpVoorraadReken = { overzicht: fpOverzicht, model: fpOverzichtModel, kleurSleutel: fpKleurSleutel,
                             schipOnderweg: fpSchipOnderweg, codeKleur: fpCodeKleur };
})(typeof window !== "undefined" ? window : globalThis);
