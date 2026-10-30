/* ═══════════════════════════════════════════════════════════════════════════
   SERVICE PLANNING - meldingen inplannen, routes vullen, de klant laten kiezen
   ═══════════════════════════════════════════════════════════════════════════
   Kevin (document "Service planning", via Gerrit op 23 okt 2026) wil vier
   tegels voor de afdeling Service. Dit bestand is de motor onder de eerste
   twee: In te plannen meldingen (service-meldingen.html) en Planning Service
   (planning-service.html).

   Zo loopt het:
   1. Een ITS-melding gaat in de lijst, met een verplichte verwachte duur en
      eventueel voorkeursdagen (ma-vr), "inplannen vanaf" en "niet inplannen
      tussen" (vakantie).
   2. De afdeling zet routes klaar door een monteur bij een lege route te
      zetten. Alleen routes met een naam zijn beschikbaar. Per route kan de
      monteur later beginnen of eerder terug moeten zijn.
   3. De knop Plannen zet elke open melding op de beste plek: eerst in een
      route waar al afspraken in staan, pas daarna in een lege route. Een
      afspraak die al bij een klant is voorgesteld schuift nooit naar een
      ander dagdeel.
   4. De klant krijgt een mail met Akkoord (groen) en Andere datum kiezen.
      Akkoord is meteen zichtbaar in de planning. Andere datum: de klant geeft
      voorkeursdagen, een eerste datum, een vakantie op, of zegt dat de
      afspraak mag vervallen; de melding komt dan vanzelf terug in de lijst
      (of verdwijnt, als hij mag vervallen).
   5. Geen reactie: elke twee dagen een herinnering.
   6. Monteur ziek: de route wordt zo snel mogelijk over andere routes
      verdeeld en de klanten krijgen de ziekmail met de nieuwe datum.

   Tijden: monteurs vertrekken om 6:00 uit Uddel en zijn rond 16:00 terug
   (Kevin). De rijtijd tussen twee adressen is een schatting hemelsbreed
   (x 1,3 voor de weg, 75 km/u, plus 5 minuten om te parkeren); dat is
   genoeg om het dagdeel te bepalen en de route niet te vol te zetten, en
   kost geen enkele aanroep naar buiten. Dagdelen zoals in de mail:
   voor 10:00, 10:00-13:00 en na 13:00.

   Opslag in D1 (fonteyn-activiteit), niet in KV: elke klik van een klant
   is een schrijfbeurt, en KV heeft een daglimiet die het hele Dashboard
   deelt. Elke kolom waarop gezocht wordt heeft een index.

   Mail: via Resend, afzender "Fonteyn Spa planning", antwoorden naar
   spaplanning@fonteyn.nl. Resend geeft 100 mails per dag voor het hele
   Dashboard en Passion Partners samen; Service neemt er hooguit 40. Wat
   daarboven komt wacht tot de volgende ronde. Klantmails gaan pas echt
   de deur uit als de beheerlaag dat aanzet (instellingen.mailAan); tot dan
   staat alles klaar en is er alleen een voorbeeld.

   De hulpfuncties uit worker.js komen binnen via H (reply, l4Token,
   toegangMag, RIJ_START, rijNorm), zodat dit bestand los te lezen is.
   ═══════════════════════════════════════════════════════════════════════════ */

const SVC_START = 6 * 60 + 15;     // 6:15 (Kevin, 29 okt 2026; was 6:00)
const SVC_EIND = 15 * 60;          // 15:00 (Kevin, 29 okt 2026; was 16:00)
/* De planner (Kevin, WhatsApp 30 okt 2026: "de 2e klant is 2,5 uur
   omrijden"; de jongens moeten 4 tot 5 klanten per dag halen). Tot nu toe
   ging een bestaande route altijd voor een lege, hoe ver het omrijden ook
   was. Nu telt het omrijden: tot SVC_MAX_OMRIJ minuten extra rijden past
   een klant gewoon in een route die al klanten heeft; daarboven telt elke
   minuut vier keer zo zwaar, en een lege route kost SVC_LEEG_KOST. Een klant
   ver weg begint dan liever een eigen route, waar later klanten uit de buurt
   bij komen. Elke dag later kost 3 minuten. */
const SVC_MAX_OMRIJ = 40;
const SVC_BUREN_KM = 60;
const SVC_LEEG_KOST = 60;
const SVC_MAIL_MAX = 40;           // per dag, van de 100 die Resend geeft
const SVC_ANTWOORD = "spaplanning@fonteyn.nl";
const SVC_INSTEL = "service-instellingen";
const SVC_DAGDEEL = {
  1: "in de ochtend",
  2: "aan het eind van de ochtend of het begin van de middag",
  3: "in de middag",
};
const SVC_DAGDEEL_KORT = { 1: "ochtend", 2: "eind ochtend / begin middag", 3: "middag" };
/* Duitse klanten krijgen hun mails in het Duits (Gerrit, 30 okt 2026). De
   taal volgt het land van de klant in Logic4 (DE, AT); zonder land kijkt
   het Dashboard naar de postcode in het adres. Aan of uit met
   service-instellingen.duits (eerst het voorbeeld aan Gerrit). */
const SVC_DAGDEEL_DE = { 1: "am Vormittag", 2: "am späten Vormittag oder am frühen Nachmittag", 3: "am Nachmittag" };
const SVC_WEEKDAG_DE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const SVC_MAAND_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
function svcTaalVan(m) {
  const k = (m && m.klant) || {};
  if (k.land) return ["DE", "AT"].includes(String(k.land).toUpperCase()) ? "de" : "nl";
  const adres = String(k.adres || "");
  if (/\b\d{4}\s?[A-Z]{2}\b/i.test(adres)) return "nl";
  return /\b\d{5}\b/.test(adres) ? "de" : "nl";
}
const SVC_WEEKDAG = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const SVC_MAAND = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const SVC_MONTEURS = ["Thieme", "Patrick", "Hans", "Bart", "Bertjan", "Kevin"];   // Bart, Bertjan en Kevin erbij (Kevin, 27 okt 2026)
const SVC_UDDEL = [52.2449, 5.7797];   // als Uddel nog niet in geo_cache staat
/* De hulpfuncties uit worker.js voor deze aanroep (zie svcHandle/svcRonde). */
let _svcH = null;
const SVC_LOGO = "https://raw.githubusercontent.com/gerritgmulder/douanepapieren-data/main/fonteyn-logo.png";

/* ── Opslag ─────────────────────────────────────────────────────────────── */
let _svcTabellen = false;
async function svcDb(env) {
  const db = env.ACTIVITEIT;
  if (!_svcTabellen) {
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS svc_melding (its TEXT PRIMARY KEY, status TEXT, json TEXT, ts INTEGER)"),
      db.prepare("CREATE INDEX IF NOT EXISTS svc_melding_status ON svc_melding (status)"),
      db.prepare("CREATE TABLE IF NOT EXISTS svc_route (datum TEXT, nr INTEGER, monteur TEXT, start INTEGER, eind INTEGER, ziek INTEGER DEFAULT 0, ts INTEGER, PRIMARY KEY (datum, nr))"),
      db.prepare("CREATE TABLE IF NOT EXISTS svc_afspraak (id TEXT PRIMARY KEY, its TEXT, datum TEXT, nr INTEGER, volg INTEGER, dagdeel INTEGER, status TEXT, token TEXT, json TEXT, ts INTEGER)"),
      db.prepare("CREATE INDEX IF NOT EXISTS svc_afspraak_datum ON svc_afspraak (datum)"),
      db.prepare("CREATE INDEX IF NOT EXISTS svc_afspraak_its ON svc_afspraak (its)"),
      db.prepare("CREATE INDEX IF NOT EXISTS svc_afspraak_token ON svc_afspraak (token)"),
      db.prepare("CREATE INDEX IF NOT EXISTS svc_afspraak_status ON svc_afspraak (status)"),
      db.prepare("CREATE TABLE IF NOT EXISTS svc_mail (dag TEXT PRIMARY KEY, n INTEGER)"),
      db.prepare("CREATE TABLE IF NOT EXISTS svc_log (id INTEGER PRIMARY KEY AUTOINCREMENT, its TEXT, ts INTEGER, wie TEXT, wat TEXT)"),
      db.prepare("CREATE INDEX IF NOT EXISTS svc_log_its ON svc_log (its)"),
    ]);
    _svcTabellen = true;
  }
  return db;
}
function svcJson(s, standaard) { try { return s ? JSON.parse(s) : standaard; } catch (e) { return standaard; } }
function svcIso(d) { return d.toISOString().slice(0, 10); }
/* Datums in Nederlandse tijd: om 0:30 's nachts is het hier al morgen. */
function svcVandaag() {
  const d = new Date(Date.now() + 2 * 3600000);
  return svcIso(d);
}
function svcPlus(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return svcIso(d); }
function svcDatumTekst(iso, taal) {
  const d = new Date(iso + "T12:00:00Z");
  if (taal === "de") return SVC_WEEKDAG_DE[d.getUTCDay()] + ", " + d.getUTCDate() + ". " + SVC_MAAND_DE[d.getUTCMonth()] + " " + d.getUTCFullYear();
  return SVC_WEEKDAG[d.getUTCDay()] + " " + d.getUTCDate() + " " + SVC_MAAND[d.getUTCMonth()] + " " + d.getUTCFullYear();
}
function svcToken() {
  const b = new Uint8Array(18); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function svcEsc(x) { return String(x == null ? "" : x).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
async function svcLog(db, its, wie, wat) {
  await db.prepare("INSERT INTO svc_log (its, ts, wie, wat) VALUES (?1, ?2, ?3, ?4)").bind(String(its), Date.now(), String(wie || "").slice(0, 80), String(wat).slice(0, 400)).run();
}

/* ── Rekenen aan een route ──────────────────────────────────────────────── */
function svcKm(a, b) {
  const r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
/* Rijminuten van a naar b. Onbekend adres: drie kwartier, ruim genoeg voor
   het midden van het land; het scherm laat zien dat het adres onbekend is. */
function svcRij(a, b) {
  if (!a || !b) return 45;
  return Math.round(svcKm(a, b) * 1.3 / 75 * 60) + 5;
}
function svcDagdeel(min) { return min < 600 ? 1 : min < 780 ? 2 : 3; }
/* Aankomst bij elke stop en de tijd van terugkomst in Uddel. */
function svcTijden(route, stops, thuis) {
  let t = route.start, vorige = thuis;
  const aankomst = [];
  for (const s of stops) { t += svcRij(vorige, s.geo); aankomst.push(t); t += s.duur; vorige = s.geo; }
  if (stops.length) t += svcRij(vorige, thuis);
  return { aankomst, terug: t };
}
function svcDatumMag(m, datum, zonderVoorkeur) {
  const wd = new Date(datum + "T12:00:00Z").getUTCDay();
  if (wd === 0 || wd === 6) return false;
  // Een al afgesproken datum (klant overgezet uit Logic4) gaat voor alles.
  if (m.vast) return datum === m.vast;
  if (!zonderVoorkeur && Array.isArray(m.voorkeur) && m.voorkeur.length && !m.voorkeur.includes(wd)) return false;
  if (m.vanaf && datum < m.vanaf) return false;
  if (m.nietVan && m.nietTot && datum >= m.nietVan && datum <= m.nietTot) return false;
  return true;
}
/* De beste plek voor één melding. Volgorde van voorkeur (Kevin): eerst de
   routes die al afspraken hebben, daarna pas een lege route. Binnen de
   gevulde routes de plek die de minste extra rijtijd kost, met een kleine
   voorkeur voor eerder; bij een lege route de eerste dag. Bij een zieke
   monteur (zoSnelMogelijk) gaat de vroegste dag boven alles. */
/* Kevin (27 okt 2026): lukt het niet op een voorkeursdag, dan op een andere
   werkdag; "inplannen vanaf" en "klant is weg" blijven altijd gelden. En
   komt de klant terug, dan liefst dezelfde monteur als de vorige keer, als
   dat hooguit een week later uitkomt. */
function svcBestePlek(m, routes, stopsPer, thuis, vandaag, zoSnelMogelijk) {
  let p = svcBestePlek1(m, routes, stopsPer, thuis, vandaag, zoSnelMogelijk, false);
  if (p.geen && !m.vast && Array.isArray(m.voorkeur) && m.voorkeur.length) {
    const q = svcBestePlek1(m, routes, stopsPer, thuis, vandaag, zoSnelMogelijk, true);
    if (!q.geen) { q.buitenVoorkeur = true; p = q; }
  }
  if (!p.geen && m.vorigeMonteur && !svcMonteurGelijk(p.R.monteur, m.vorigeMonteur)) {
    const eigen = routes.filter(R => svcMonteurGelijk(R.monteur, m.vorigeMonteur));
    let q = svcBestePlek1(m, eigen, stopsPer, thuis, vandaag, zoSnelMogelijk, !!p.buitenVoorkeur);
    if (!q.geen && (Date.parse(q.R.datum) - Date.parse(p.R.datum)) / 864e5 <= 7) { q.buitenVoorkeur = p.buitenVoorkeur; q.zelfdeMonteur = true; p = q; }
  } else if (!p.geen && m.vorigeMonteur) p.zelfdeMonteur = true;
  return p;
}
function svcBestePlek1(m, routes, stopsPer, thuis, vandaag, zoSnelMogelijk, zonderVoorkeur) {
  let beste = null, redenDatum = 0, redenVol = 0;
  for (const R of routes) {
    if (!svcDatumMag(m, R.datum, zonderVoorkeur)) { redenDatum++; continue; }
    const stops = stopsPer[R.datum + "|" + R.nr] || [];
    const oud = svcTijden(R, stops, thuis).terug;
    const dagen = Math.round((Date.parse(R.datum) - Date.parse(vandaag)) / 864e5);
    let gevonden = false;
    for (let p = 0; p <= stops.length; p++) {
      const nieuw = stops.slice(); nieuw.splice(p, 0, { its: m.its, geo: m.geo, duur: m.duur, dagdeel: null });
      const t = svcTijden(R, nieuw, thuis);
      if (t.terug > R.eind) continue;
      let past = true;
      for (let i = 0; i < nieuw.length; i++) {
        if (nieuw[i].dagdeel && svcDagdeel(t.aankomst[i]) !== nieuw[i].dagdeel) { past = false; break; }
      }
      if (!past) continue;
      gevonden = true;
      const kand = { R, p, leeg: stops.length === 0, extra: t.terug - oud - m.duur, dagen, aankomst: t.aankomst[p] };
      const kost = (k) => k.leeg ? SVC_LEEG_KOST + k.dagen * 3 : k.extra + k.dagen * 3 + Math.max(0, k.extra - SVC_MAX_OMRIJ) * 4;
      const sleutel = (k) => zoSnelMogelijk ? [k.dagen, k.leeg ? 1 : 0, k.extra] : [kost(k), k.R.nr];
      if (!beste) { beste = kand; continue; }
      const a = sleutel(kand), b = sleutel(beste);
      for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) { beste = kand; break; } if (a[i] > b[i]) break; }
    }
    if (!gevonden) redenVol++;
  }
  if (beste) return beste;
  return { geen: true, reden: !routes.length ? "Er staan geen routes klaar."
    : m.vast && !redenVol ? "Op de afgesproken datum (" + m.vast.split("-").reverse().join("-") + ") staat nog geen route met een monteur."
    : redenVol ? "De routes die passen bij de wensen van de klant zitten vol."
    : "Er is nog geen route op een dag die past bij de wensen van de klant." };
}

/* ── Adres naar plek (zelfde cache als de rijtijd in Planning) ──────────── */
async function svcGeo(env, H, adres) {
  const db = env.ACTIVITEIT;
  const k = H.rijNorm(adres);
  if (!k) return null;
  const x = await db.prepare("SELECT lat, lon FROM geo_cache WHERE adres = ?1").bind(k).first();
  if (x) return x.lat == null ? null : [x.lat, x.lon];
  const delen = String(adres).split(",").map(s => s.trim()).filter(Boolean);
  const pogingen = [adres, delen.slice(1).join(", "), delen[delen.length - 1]].filter((q, i, a) => q && a.indexOf(q) === i);
  let p = null, n = 0;
  for (const q of pogingen) {
    if (n++) await new Promise(r => setTimeout(r, 1100));   // Nominatim: één vraag per seconde
    const r = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=nl,be,de,lu,fr&q=" + encodeURIComponent(q),
      { headers: { "User-Agent": "Fonteyn-Dashboard/1.0 (service planning)" } }).catch(() => null);
    const l = r && r.ok ? await r.json().catch(() => []) : [];
    if (Array.isArray(l) && l[0]) { p = [Number(l[0].lat), Number(l[0].lon)]; break; }
  }
  await db.prepare("INSERT OR REPLACE INTO geo_cache (adres, lat, lon, ts) VALUES (?1, ?2, ?3, ?4)").bind(k, p ? p[0] : null, p ? p[1] : null, Date.now()).run();
  return p;
}
async function svcThuis(env, H) {
  return (await svcGeo(env, H, H.RIJ_START).catch(() => null)) || SVC_UDDEL;
}

/* ── Een ITS-melding opzoeken in Logic4 ─────────────────────────────────── */
async function svcItsZoek(env, H, its) {
  const id = Number(String(its || "").replace(/\D/g, ""));
  if (!id) return { ok: false, error: "Vul een ITS-nummer in." };
  let m = null;
  const c = await env.FONTEYN_DATA.get("planning-its-cache", { type: "json" }).catch(() => null);
  const uitCache = ((c && c.meldingen) || []).find(x => Number(x.id) === id);
  const token = await H.l4Token(env);
  if (uitCache) m = uitCache;
  else {
    const r = await fetch("https://api.logic4server.nl/v3/ITS/GetIssues", {
      method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ Id: id, SkipRecords: 0, TakeRecords: 1 }),
    });
    const j = r.ok ? await r.json().catch(() => null) : null;
    const x = ((j && (j.Records || j)) || []).find(y => Number(y.id) === id);
    if (!x) return { ok: false, error: "ITS " + id + " is in Logic4 onbekend. Kijk het nummer even na." };
    m = {
      id: x.id, naam: x.Name || "", status: (x.Status && x.Status.Name) || "",
      omschrijving: H.itsTekst(x.Description).replace(/\s+/g, " ").slice(0, 300), tekst: H.itsTekst(x.Description).slice(0, 4000),
      garantie: (x.FreeValueType1 && x.FreeValueType1.Name) || null,
      gemeld: String(x.DateTimeReported || x.DateTimeCreatedOn || "").slice(0, 10),
      debiteur: x.ReportedByDebtorId || null, order: x.OrderId || null,
    };
  }
  let klant = { debiteur: m.debiteur || null, naam: m.naam || "", adres: "", plaats: "", tel: "", mail: "" };
  if (m.debiteur) {
    const r = await fetch("https://api.logic4server.nl/v3/Relations/GetCustomers", {
      method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ Id: Number(m.debiteur), TakeRecords: 2 }),
    });
    const j = r.ok ? await r.json().catch(() => null) : null;
    const k = ((Array.isArray(j) ? j : (j && j.Records)) || []).find(x => Number(x.Id) === Number(m.debiteur));
    if (k) {
      const naam = [k.FirstName, k.Preposition, k.LastName].map(x => String(x || "").trim()).filter(Boolean).join(" ");
      klant = {
        debiteur: Number(m.debiteur), naam: k.CompanyName || naam || m.naam || "",
        adres: [[k.Street, k.HouseNumber, k.HouseNumberAddition].map(x => String(x || "").trim()).filter(Boolean).join(" "),
                [k.Zipcode, k.City].map(x => String(x || "").trim()).filter(Boolean).join(" ")].filter(Boolean).join(", "),
        plaats: k.City || "", land: String(k.CountryCode || "").toUpperCase() || null, tel: String(k.MobileNumber || k.TelephoneNumber || "").trim(),
        // Beide nummers uit de klantenkaart (Kevin, 29 okt 2026); dubbel = één.
        tel2: (String(k.TelephoneNumber || "").trim() && String(k.TelephoneNumber).replace(/\D/g, "") !== String(k.MobileNumber || "").replace(/\D/g, "")) && k.MobileNumber ? String(k.TelephoneNumber).trim() : "",
        mail: String(k.EmailAddress || "").trim().toLowerCase(),
      };
    }
  }
  return { ok: true, melding: {
    its: String(m.id), titel: m.naam || "", omschrijving: m.omschrijving || "", tekst: m.tekst || "",
    garantie: m.garantie || null, gemeld: m.gemeld || null, order: m.order || null, klant,
  } };
}

/* ── Meldingen opslaan ──────────────────────────────────────────────────── */
function svcSchoonMelding(b, oud) {
  const m = Object.assign({}, oud || {});
  const tekst = (x, n) => String(x == null ? "" : x).trim().slice(0, n || 200);
  const datum = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || "")) ? String(x) : null;
  m.its = String(b.its || m.its || "").replace(/\D/g, "");
  if (b.titel != null) m.titel = tekst(b.titel, 200);
  if (b.omschrijving != null) m.omschrijving = tekst(b.omschrijving, 300);
  if (b.tekst != null) m.tekst = tekst(b.tekst, 4000);
  if (b.garantie !== undefined) m.garantie = b.garantie ? tekst(b.garantie, 20) : null;
  if (b.gemeld !== undefined) m.gemeld = datum(b.gemeld);
  if (b.order !== undefined) m.order = b.order ? String(b.order).replace(/\D/g, "").slice(0, 12) : null;
  if (b.klant) {
    const k = b.klant;
    m.klant = { debiteur: k.debiteur ? Number(k.debiteur) || null : null, naam: tekst(k.naam, 120), adres: tekst(k.adres, 200),
                plaats: tekst(k.plaats, 80), tel: tekst(k.tel, 40), tel2: tekst(k.tel2, 40),
                land: k.land ? String(k.land).toUpperCase().slice(0, 2) : (oud && oud.klant && oud.klant.land !== undefined ? oud.klant.land : undefined),
                mail: [...new Set(String(k.mail || "").toLowerCase().split(/[;,\s]+/).filter(Boolean))].join(", ").slice(0, 200) };
  }
  if (b.duur !== undefined) m.duur = Math.max(0, Math.min(600, Math.round(Number(b.duur) || 0)));
  if (b.voorkeur !== undefined) m.voorkeur = [...new Set((Array.isArray(b.voorkeur) ? b.voorkeur : []).map(Number).filter(x => x >= 1 && x <= 5))].sort();
  if (b.vanaf !== undefined) m.vanaf = datum(b.vanaf);
  if (b.nietVan !== undefined) m.nietVan = datum(b.nietVan);
  if (b.nietTot !== undefined) m.nietTot = datum(b.nietTot);
  if (m.nietVan && m.nietTot && m.nietTot < m.nietVan) { const x = m.nietVan; m.nietVan = m.nietTot; m.nietTot = x; }
  if (b.opmerking !== undefined) m.opmerking = tekst(b.opmerking, 600);
  // Kevin (27 okt 2026): klanten overzetten uit Logic4 zonder mail, eventueel op een al afgesproken datum.
  if (b.geenMail !== undefined) m.geenMail = !!b.geenMail;
  if (b.vast !== undefined) m.vast = datum(b.vast);
  return m;
}
async function svcMeldingBewaar(env, H, wie, b) {
  const db = await svcDb(env);
  const its = String(b.its || "").replace(/\D/g, "");
  if (!its) return { ok: false, error: "Vul een ITS-nummer in." };
  const rij = await db.prepare("SELECT status, json FROM svc_melding WHERE its = ?1").bind(its).first();
  const oud = rij ? svcJson(rij.json, {}) : null;
  const m = svcSchoonMelding(b, oud);
  if (!m.duur) return { ok: false, error: "Vul de verwachte duur van de afspraak in." };
  if (!m.klant || !m.klant.adres) return { ok: false, error: "Het adres van de klant ontbreekt nog." };
  const adresWas = oud && oud.klant ? oud.klant.adres : null;
  if (!oud || adresWas !== m.klant.adres || m.geo === undefined) m.geo = await svcGeo(env, H, m.klant.adres).catch(() => null);
  let status = rij ? rij.status : "open";
  if (!rij) { m.door = wie; m.gemaakt = new Date().toISOString(); }
  /* Weer in de lijst zetten wat er ooit uit ging (vervallen of klaar), en
     ook wat al eens gepland stond: een melding moet altijd opnieuw in de
     lijst kunnen (Kevin, 27 okt 2026). Een afspraak die nog staat blijft
     staan; Plannen maakt er dan een tweede bij. */
  if (b.heropen) status = "open";
  m.gewijzigdDoor = wie; m.gewijzigd = new Date().toISOString();
  await db.prepare("INSERT OR REPLACE INTO svc_melding (its, status, json, ts) VALUES (?1, ?2, ?3, ?4)").bind(its, status, JSON.stringify(m), Date.now()).run();
  await svcLog(db, its, wie, rij ? "melding aangepast" : "melding toegevoegd (" + m.duur + " min)");
  return { ok: true, melding: Object.assign({ status }, m) };
}

/* ── Instellingen en de mailteller ──────────────────────────────────────── */
async function svcInstellingen(env) {
  return Object.assign({ mailAan: false, proefAdres: "" }, (await env.FONTEYN_DATA.get(SVC_INSTEL, { type: "json" }).catch(() => null)) || {});
}
async function svcMailTeller(db) {
  const x = await db.prepare("SELECT n FROM svc_mail WHERE dag = ?1").bind(svcVandaag()).first();
  return x ? Number(x.n) || 0 : 0;
}

/* ── De mails aan de klant ──────────────────────────────────────────────── */
/* De tekst is die van Kevin, met twee aanpassingen voor de positieve toon van
   het Dashboard (Gerrit, 23 okt 2026: "Positief!"): de rode knop heet
   "Andere datum kiezen" en de zin over kosten zegt wat de klant wél moet
   doen. */
function svcMailHtml(soort, d, link, metLogo) {
  if (d.taal === "de") return svcMailHtmlDe(soort, d, link, metLogo);
  const e = svcEsc;
  const p = (t) => "<p style='font-size:14px;line-height:1.55;margin:0 0 12px'>" + t + "</p>";
  const knoppen = link
    ? "<table role='presentation' cellspacing='0' cellpadding='0' style='margin:18px 0 20px'><tr>" +
      "<td style='background:#15803d;border-radius:8px'><a href='" + e(link + "&k=akkoord") + "' style='display:inline-block;padding:13px 26px;color:#ffffff;font-weight:bold;font-size:15px;text-decoration:none;font-family:Arial,sans-serif'>Akkoord</a></td>" +
      "<td style='width:14px'></td>" +
      "<td style='background:#b91c1c;border-radius:8px'><a href='" + e(link + "&k=anders") + "' style='display:inline-block;padding:13px 26px;color:#ffffff;font-weight:bold;font-size:15px;text-decoration:none;font-family:Arial,sans-serif'>Andere datum kiezen</a></td>" +
      "</tr></table>" : "";
  const kop = "<div style='background:#144734;padding:18px 22px'>" + (metLogo ? "<img src='" + SVC_LOGO + "' alt='Fonteyn' height='56' style='display:block;height:56px'>" : "<span style='color:#fff;font-size:20px;font-weight:bold'>Fonteyn</span>") + "</div>";
  const datum = "<b>" + e(svcDatumTekst(d.datum)) + "</b>", dagdeel = "<b>" + e(SVC_DAGDEEL[d.dagdeel] || "") + "</b>";
  let romp = "";
  if (soort === "ziek") {
    romp = p("Beste " + e(d.naam) + ",") +
      (d.oudeDatum === d.datum
        /* Een collega neemt het dezelfde dag over: dan blijft de datum staan. */
        ? p("Helaas moeten we melden dat de monteur die op <b>" + e(svcDatumTekst(d.oudeDatum)) + "</b> naar u toe zou komen, zich ziek heeft gemeld. Een collega neemt de afspraak over en komt op dezelfde dag, " + dagdeel + ".")
        : p("Helaas moeten we melden dat de monteur die op <b>" + e(svcDatumTekst(d.oudeDatum)) + "</b> naar u toe zou komen, zich ziek heeft gemeld. Daarom vervalt deze datum. De nieuwe afspraak is op " + datum + ", " + dagdeel + ".")) +
      p("Graag vernemen we van u of dit akkoord is.") + knoppen +
      p("Met vriendelijke groet,<br>Spa planning");
  } else {
    romp = (soort === "herinnering" ? "<p style='font-size:13px;color:#b45309;font-weight:bold;margin:0 0 12px'>Herinnering: wij ontvangen graag uw reactie op onderstaande afspraak.</p>" : "") +
      p("Beste " + e(d.naam) + ",") +
      p("Wij hebben een reactie op deze mail nodig of u op de desbetreffende datum ingepland kan worden voor de serviceafspraak.") +
      p("Wij hebben op onze serviceafdeling een melding ontvangen van u en deze hebben wij voor u ingepland. Daarom willen wij graag bij u langs komen op " + datum + ".<br>De verwachting is dat de monteur bij u langs zal komen " + dagdeel + ".") +
      knoppen +
      p("De monteur neemt op de dag zelf anoniem telefonisch contact met u op, op het moment dat hij een tijdsindicatie heeft.") +
      p("Als uw spa ingebouwd is, is het uw eigen verantwoordelijkheid om deze aan alle kanten minimaal 50 centimeter vrij te houden. Staat de spa verlaagd in de grond of is er een vlonder omheen gebouwd, dan moet deze eruit gehaald worden.") +
      p("Bij een serviceafspraak moet het bad te allen tijde gevuld zijn, tenzij er anders is afgesproken. Dit geldt ook voor een lekkage.") +
      p("Aan de bovenstaande voorwaarden dient voldaan te zijn op het moment dat de monteur bij u arriveert.") +
      p("Graag ontvangen wij als antwoord op deze e-mail of u akkoord gaat met de afspraak. Indien wij uiterlijk zes werkdagen voor de afspraak nog geen reactie hebben ontvangen, behouden wij ons het recht voor de afspraak eenzijdig te annuleren.") +
      p("Heeft u akkoord gegeven op een afspraak en wilt u deze toch annuleren? Geef dit dan aan als reactie op deze mail.") +
      p("Geeft u akkoord, zorg dan dat er op de dag zelf iemand aanwezig is en dat aan de voorwaarden hierboven is voldaan. Anders brengen wij kosten in rekening.") +
      p("Hartelijk dank voor uw medewerking.") +
      p("Met vriendelijke groet,<br>Spa planning");
  }
  return "<div style='font-family:Arial,sans-serif;color:#1f2937;max-width:640px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden'>" +
    kop + "<div style='padding:20px 22px'>" + romp +
    "<p style='font-size:12px;color:#6b7280;margin:18px 0 0'>ITS " + e(d.its) + "</p></div></div>";
}
function svcMailHtmlDe(soort, d, link, metLogo) {
  const e = svcEsc;
  const p = (t) => "<p style='font-size:14px;line-height:1.55;margin:0 0 12px'>" + t + "</p>";
  const knop = (k, kleur, t) => "<td style='background:" + kleur + ";border-radius:8px'><a href='" + e(link + "&k=" + k) + "' style='display:inline-block;padding:13px 26px;color:#ffffff;font-weight:bold;font-size:15px;text-decoration:none;font-family:Arial,sans-serif'>" + t + "</a></td>";
  const knoppen = link ? "<table role='presentation' cellspacing='0' cellpadding='0' style='margin:18px 0 20px'><tr>" + knop("akkoord", "#15803d", "Einverstanden") + "<td style='width:14px'></td>" + knop("anders", "#b91c1c", "Anderen Termin wählen") + "</tr></table>" : "";
  const kop = "<div style='background:#144734;padding:18px 22px'>" + (metLogo ? "<img src='" + SVC_LOGO + "' alt='Fonteyn' height='56' style='display:block;height:56px'>" : "<span style='color:#fff;font-size:20px;font-weight:bold'>Fonteyn</span>") + "</div>";
  const datum = "<b>" + e(svcDatumTekst(d.datum, "de")) + "</b>", dagdeel = "<b>" + e(SVC_DAGDEEL_DE[d.dagdeel] || "") + "</b>";
  let romp = "";
  if (soort === "ziek") {
    romp = p("Guten Tag " + e(d.naam) + ",") +
      (d.oudeDatum === d.datum
        ? p("leider müssen wir Ihnen mitteilen, dass sich der Techniker, der am <b>" + e(svcDatumTekst(d.oudeDatum, "de")) + "</b> zu Ihnen kommen sollte, krankgemeldet hat. Ein Kollege übernimmt den Termin und kommt am selben Tag, " + dagdeel + ".")
        : p("leider müssen wir Ihnen mitteilen, dass sich der Techniker, der am <b>" + e(svcDatumTekst(d.oudeDatum, "de")) + "</b> zu Ihnen kommen sollte, krankgemeldet hat. Dieser Termin entfällt deshalb. Der neue Termin ist am " + datum + ", " + dagdeel + ".")) +
      p("Bitte teilen Sie uns mit, ob dieser Termin für Sie passt.") + knoppen +
      p("Mit freundlichen Grüßen<br>Spa-Planung Fonteyn");
  } else {
    romp = (soort === "herinnering" ? "<p style='font-size:13px;color:#b45309;font-weight:bold;margin:0 0 12px'>Erinnerung: Wir freuen uns auf Ihre Rückmeldung zu dem unten genannten Termin.</p>" : "") +
      p("Guten Tag " + e(d.naam) + ",") +
      p("bitte teilen Sie uns mit, ob der unten genannte Termin für den Servicebesuch für Sie passt.") +
      p("Ihre Meldung ist bei unserer Serviceabteilung eingegangen, und wir haben einen Termin für Sie eingeplant. Wir möchten Sie gerne am " + datum + " besuchen.<br>Der Techniker kommt voraussichtlich " + dagdeel + ".") +
      knoppen +
      p("Der Techniker ruft Sie am Tag selbst mit unterdrückter Nummer an, sobald er eine genauere Uhrzeit nennen kann.") +
      p("Ist Ihr Spa eingebaut, sind Sie selbst dafür verantwortlich, dass er an allen Seiten mindestens 50 Zentimeter frei zugänglich ist. Steht der Spa vertieft im Boden oder ist eine Terrasse um ihn herum gebaut, muss diese entfernt werden.") +
      p("Bei einem Servicetermin muss der Spa immer gefüllt sein, es sei denn, es wurde etwas anderes vereinbart. Das gilt auch bei einem Leck.") +
      p("Diese Bedingungen müssen erfüllt sein, wenn der Techniker bei Ihnen ankommt.") +
      p("Bitte bestätigen Sie den Termin als Antwort auf diese E-Mail. Haben wir spätestens sechs Werktage vor dem Termin keine Rückmeldung erhalten, behalten wir uns vor, den Termin einseitig abzusagen.") +
      p("Sie haben dem Termin zugestimmt und möchten ihn doch absagen? Antworten Sie dann einfach auf diese E-Mail.") +
      p("Wenn Sie zustimmen, sorgen Sie bitte dafür, dass am Tag selbst jemand anwesend ist und die oben genannten Bedingungen erfüllt sind. Andernfalls stellen wir die Kosten in Rechnung.") +
      p("Vielen Dank für Ihre Mitarbeit.") +
      p("Mit freundlichen Grüßen<br>Spa-Planung Fonteyn");
  }
  return "<div style='font-family:Arial,sans-serif;color:#1f2937;max-width:640px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden'>" +
    kop + "<div style='padding:20px 22px'>" + romp +
    "<p style='font-size:12px;color:#6b7280;margin:18px 0 0'>ITS " + e(d.its) + "</p></div></div>";
}
function svcOnderwerp(soort, d) {
  if (d.taal === "de") {
    if (soort === "ziek") return d.oudeDatum === d.datum ? "Ihr Servicetermin am " + svcDatumTekst(d.datum, "de") + ": ein Kollege kommt" : "Neuer Termin für Ihren Servicebesuch: " + svcDatumTekst(d.datum, "de");
    return (soort === "herinnering" ? "Erinnerung: " : "") + "Ihr Servicetermin am " + svcDatumTekst(d.datum, "de");
  }
  if (soort === "ziek") return d.oudeDatum === d.datum ? "Uw serviceafspraak op " + svcDatumTekst(d.datum) + ": een collega komt" : "Nieuwe datum voor uw serviceafspraak: " + svcDatumTekst(d.datum);
  return (soort === "herinnering" ? "Herinnering: " : "") + "Uw serviceafspraak op " + svcDatumTekst(d.datum);
}
function svcLinkBasis(env) { return (env.SVC_LINK_BASIS || "https://fonteyn-data-store.g-mulder.workers.dev") + "/service/antwoord?t="; }

/* Eén mail sturen, of klaarzetten als mailen nog uit staat of de dagteller
   vol is. Werkt het afspraak-json bij (mails, mailWacht, mailFout); de
   aanroeper schrijft hem weg. */
async function svcMailStuur(env, db, a, m, soort, extra) {
  const inst = await svcInstellingen(env);
  a.json = a.json || {};
  // Handmatig overgezet zonder mail: nooit mailen, ook geen herinnering.
  if (m && m.geenMail) { a.json.geenMail = true; delete a.json.mailWacht; delete a.json.mailFout; return { ok: true, geenMail: true }; }
  const naarKlant = String((m.klant && m.klant.mail) || "").toLowerCase().split(/[;,\s]+/).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  if (!naarKlant.length) { a.json.mailFout = "Er staat nog geen mailadres bij de klant."; a.json.mailWacht = soort; return { ok: false, error: a.json.mailFout }; }
  if (!inst.mailAan) { a.json.mailWacht = soort; if (extra && extra.oudeDatum) a.json.oudeDatum = extra.oudeDatum; return { ok: true, wacht: "mailen staat nog uit" }; }
  const naar = inst.proefAdres ? [inst.proefAdres] : naarKlant;
  // De taal: het land van de klant (eenmalig uit Logic4), alleen als Duits aan staat.
  if (inst.duits && m.klant && m.klant.debiteur && m.klant.land === undefined && _svcH) await svcKlantVers(env, db, a.its, m).catch(() => {});
  const taal = inst.duits ? svcTaalVan(m) : "nl";
  a.json.taal = taal;
  const d0 = { naam: (m.klant && m.klant.naam) || (taal === "de" ? "Kunde" : "klant"), datum: a.datum, dagdeel: a.dagdeel, its: a.its, oudeDatum: (extra && extra.oudeDatum) || a.json.oudeDatum || null, taal };
  /* Eerst via de eigen mailserver van Fonteyn, vanuit spaplanning@ (Gerrit,
     23 okt 2026). Daar geldt geen grens per dag. Lukt dat (nog) niet, dan via
     Resend, met de grens van 40 per dag. */
  if (_svcH && _svcH.ewsVerstuur && env.EWS_GEBRUIKER && env.EWS_WACHTWOORD) {
    const e = await _svcH.ewsVerstuur(env, SVC_ANTWOORD, naar, svcOnderwerp(soort, d0), svcMailHtml(soort, d0, svcLinkBasis(env) + encodeURIComponent(a.token), true)).catch(x => ({ ok: false, error: String(x && x.message || x) }));
    if (e.ok) {
      await db.prepare("INSERT INTO svc_mail (dag, n) VALUES (?1, 1) ON CONFLICT(dag) DO UPDATE SET n = n + 1").bind(svcVandaag()).run();
      a.json.mails = (a.json.mails || []).concat([{ ts: Date.now(), soort, naar: naar.join(", "), proef: !!inst.proefAdres, via: "fonteyn" }]).slice(-20);
      delete a.json.mailWacht; delete a.json.mailFout; delete a.json.ewsFout;
      return { ok: true };
    }
    a.json.ewsFout = String(e.uitleg || e.error || "").slice(0, 200);
  }
  if ((await svcMailTeller(db)) >= SVC_MAIL_MAX) { a.json.mailWacht = soort; if (extra && extra.oudeDatum) a.json.oudeDatum = extra.oudeDatum; return { ok: true, wacht: "dagteller vol" }; }
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return { ok: false, error: "het mailen is in de worker nog in te richten" };
  const bron = env.MAIL_FROM_FONTEYN || env.MAIL_FROM;
  const adres = (String(bron).match(/<([^>]+)>/) || [])[1] || String(bron);
  const d = d0;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Fonteyn Spa planning <" + adres + ">", to: naar, reply_to: [SVC_ANTWOORD],
      subject: svcOnderwerp(soort, d), html: svcMailHtml(soort, d, svcLinkBasis(env) + encodeURIComponent(a.token), true) }),
  });
  const tekst = await r.text();
  if (!r.ok) { a.json.mailFout = "Versturen lukte nog niet (" + r.status + ")"; a.json.mailWacht = soort; return { ok: false, error: a.json.mailFout + " " + tekst.slice(0, 120) }; }
  await db.prepare("INSERT INTO svc_mail (dag, n) VALUES (?1, 1) ON CONFLICT(dag) DO UPDATE SET n = n + 1").bind(svcVandaag()).run();
  a.json.mails = (a.json.mails || []).concat([{ ts: Date.now(), soort, naar: naar.join(", "), proef: !!inst.proefAdres }]).slice(-20);
  delete a.json.mailWacht; delete a.json.mailFout;
  return { ok: true };
}
async function svcAfspraakSchrijf(db, a) {
  await db.prepare("INSERT OR REPLACE INTO svc_afspraak (id, its, datum, nr, volg, dagdeel, status, token, json, ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
    .bind(a.id, String(a.its), a.datum, a.nr, a.volg, a.dagdeel, a.status, a.token, JSON.stringify(a.json || {}), Date.now()).run();
}
/* Na een verschuiving met de hand: de dagdelen van een route opnieuw
   uitrekenen. Is de klant nog niet gemaild, dan krijgt de stop het nieuwe
   dagdeel. Is hij al gemaild, dan blijft het gemailde dagdeel staan en
   krijgt de stop dagdeelNu, zodat de planning ziet dat het verschuift. */
async function svcHerreken(env, H, db, datum, nr) {
  const route = await db.prepare("SELECT * FROM svc_route WHERE datum = ?1 AND nr = ?2").bind(datum, nr).first();
  if (!route) return;
  const lijst = ((await db.prepare("SELECT * FROM svc_afspraak WHERE datum = ?1 AND nr = ?2 AND status IN ('voorstel','akkoord') ORDER BY volg").bind(datum, nr).all()).results || []).map(svcAfspraakUit);
  if (!lijst.length) return;
  const its = lijst.map(a => a.its);
  const ms = (await db.prepare("SELECT its, json FROM svc_melding WHERE its IN (" + its.map((_, i) => "?" + (i + 1)).join(",") + ")").bind(...its).all()).results || [];
  const meld = {}; for (const r of ms) meld[r.its] = svcJson(r.json, {});
  const R = { start: Number(route.start) || SVC_START, eind: Number(route.eind) || SVC_EIND };
  const t = svcTijden(R, lijst.map(a => ({ geo: (meld[a.its] || {}).geo || null, duur: Number((meld[a.its] || {}).duur) || 60 })), await svcThuis(env, H));
  for (let i = 0; i < lijst.length; i++) {
    const a = lijst[i], nu = svcDagdeel(t.aankomst[i]);
    const gemaild = (a.json.mails || []).length > 0;
    let anders = false;
    if (!gemaild && a.dagdeel !== nu) { a.dagdeel = nu; anders = true; }
    if (gemaild) { const was = a.json.dagdeelNu || null, wordt = nu !== a.dagdeel ? nu : null; if (was !== wordt) { if (wordt) a.json.dagdeelNu = wordt; else delete a.json.dagdeelNu; anders = true; } }
    if (a.volg !== i + 1) { a.volg = i + 1; anders = true; }
    if (anders) await svcAfspraakSchrijf(db, a);
  }
}
function svcAfspraakUit(rij) { return { id: rij.id, its: rij.its, datum: rij.datum, nr: rij.nr, volg: rij.volg, dagdeel: rij.dagdeel, status: rij.status, token: rij.token, json: svcJson(rij.json, {}) }; }

/* ── Plannen ────────────────────────────────────────────────────────────── */
/* opts.its: alleen deze meldingen (direct inplannen); opts.voorbeeld: alleen
   laten zien waar ze zouden komen, niets bewaren of mailen. */
async function svcPlannen(env, H, wie, opts) {
  opts = opts || {};
  const db = await svcDb(env);
  const vandaag = svcVandaag(), morgen = svcPlus(vandaag, 1);
  const routes = ((await db.prepare("SELECT datum, nr, monteur, start, eind FROM svc_route WHERE datum >= ?1 AND ziek = 0 AND monteur != '' ORDER BY datum, nr").bind(morgen).all()).results || [])
    .map(r => ({ datum: r.datum, nr: Number(r.nr), monteur: r.monteur, start: Number(r.start) || SVC_START, eind: Number(r.eind) || SVC_EIND }));
  if (!routes.length) return { ok: false, geenRoutes: true, error: "Er staan geen open routes klaar. Zet in Planning Service eerst de naam van een monteur bij een lege route." };
  const meldRijen = (await db.prepare("SELECT its, status, json FROM svc_melding WHERE status IN ('open','gepland')").all()).results || [];
  const meld = {};
  for (const r of meldRijen) meld[r.its] = Object.assign(svcJson(r.json, {}), { its: r.its, status: r.status });
  const afs = ((await db.prepare("SELECT * FROM svc_afspraak WHERE datum >= ?1 AND status IN ('voorstel','akkoord') ORDER BY datum, nr, volg").bind(morgen).all()).results || []).map(svcAfspraakUit);
  const thuis = await svcThuis(env, H);
  const stopsPer = {};
  for (const a of afs) {
    const m = meld[a.its] || {};
    (stopsPer[a.datum + "|" + a.nr] = stopsPer[a.datum + "|" + a.nr] || []).push({ its: a.its, geo: m.geo || null, duur: Number(m.duur) || 60, dagdeel: a.dagdeel, id: a.id });
  }
  let lijst = Object.values(meld).filter(m => m.status === "open");
  if (Array.isArray(opts.its)) lijst = lijst.filter(m => opts.its.map(String).includes(String(m.its)));
  // Wie ging er de vorige keer naar deze klant? Uit de werkbonnen (zelfde ITS of zelfde debiteur).
  if (lijst.length) {
    const vorig = {};
    for (const r of ((await db.prepare("SELECT its, monteur, datum, json FROM svc_bon WHERE monteur != '' ORDER BY datum").all().catch(() => ({ results: [] }))).results || [])) {
      const k = svcJson(r.json, {}).klant || {};
      vorig["its:" + r.its] = r.monteur;
      if (k.debiteur) vorig["deb:" + k.debiteur] = r.monteur;
    }
    for (const m of lijst) m.vorigeMonteur = vorig["its:" + m.its] || ((m.klant || {}).debiteur ? vorig["deb:" + m.klant.debiteur] : null) || null;
  }
  // Wie het langst wacht eerst.
  lijst.sort((a, b) => String(a.gemeld || a.gemaakt || "").localeCompare(String(b.gemeld || b.gemaakt || "")));
  const gepland = [], over = [], klaarIts = new Set();
  const zet = (m, plek) => {
    const k = plek.R.datum + "|" + plek.R.nr;
    const stops = stopsPer[k] = stopsPer[k] || [];
    const stop = { its: m.its, geo: m.geo || null, duur: m.duur, dagdeel: svcDagdeel(plek.aankomst), nieuw: true };
    stops.splice(plek.p, 0, stop);
    klaarIts.add(m.its);
    gepland.push({ its: m.its, naam: (m.klant || {}).naam || "", plaats: (m.klant || {}).plaats || "", datum: plek.R.datum, nr: plek.R.nr, monteur: plek.R.monteur, dagdeel: stop.dagdeel, leeg: plek.leeg,
      buitenVoorkeur: !!plek.buitenVoorkeur, zelfdeMonteur: !!plek.zelfdeMonteur, geenMail: !!m.geenMail });
  };
  for (const m of lijst) {
    if (klaarIts.has(m.its)) continue;
    if (!m.duur) { over.push({ its: m.its, naam: (m.klant || {}).naam || "", reden: "De verwachte duur ontbreekt nog." }); continue; }
    const plek = svcBestePlek(m, routes, stopsPer, thuis, vandaag, false);
    if (plek.geen) { over.push({ its: m.its, naam: (m.klant || {}).naam || "", reden: plek.reden }); continue; }
    zet(m, plek);
    /* De buren meteen erbij (Kevin, 30 okt 2026): wie binnen 60 km woont en met
       weinig omrijden in dezelfde route past, gaat mee. Zo komen klanten uit
       één streek op één dag, en halen de jongens 4 tot 5 klanten. Doorgerekend
       op de planning van november: 260 naar 179 uur rijden, 53 naar 46 routes. */
    if (!m.geo) continue;
    const buren = lijst.filter(x => !klaarIts.has(x.its) && x.geo && x.duur && svcKm(m.geo, x.geo) <= SVC_BUREN_KM)
      .sort((a, b) => svcKm(m.geo, a.geo) - svcKm(m.geo, b.geo));
    for (const b of buren) {
      const q = svcBestePlek1(b, [plek.R], stopsPer, thuis, vandaag, false, false);
      if (!q.geen && q.extra <= SVC_MAX_OMRIJ) zet(b, q);
    }
  }
  const vrijeRoutes = routes.filter(R => !(stopsPer[R.datum + "|" + R.nr] || []).length).length;
  if (opts.voorbeeld) return { ok: true, voorbeeld: true, gepland, over, vrijeRoutes };
  // Bewaren: nieuwe afspraken, en de volgorde van elke route die veranderde.
  const nu = new Date().toISOString();
  const gemaild = [], wacht = [], fout = [];
  for (const [k, stops] of Object.entries(stopsPer)) {
    if (!stops.some(s => s.nieuw)) continue;
    const [datum, nr] = k.split("|");
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      if (!s.nieuw) { await db.prepare("UPDATE svc_afspraak SET volg = ?1 WHERE id = ?2").bind(i + 1, s.id).run(); continue; }
      const a = { id: "sa" + s.its + "-" + Date.now().toString(36), its: s.its, datum, nr: Number(nr), volg: i + 1, dagdeel: s.dagdeel,
                  status: "voorstel", token: svcToken(), json: { door: wie, gemaakt: nu } };
      const m = meld[s.its];
      const mr = await svcMailStuur(env, db, a, m, "voorstel");
      // Zonder mail kan de klant niet zelf akkoord geven: dan staat hij meteen op akkoord.
      if (mr.geenMail) { a.status = "akkoord"; a.json.akkoordDoor = wie; a.json.akkoordTs = Date.now(); a.json.akkoordZonderMail = true; }
      else (mr.ok && !mr.wacht ? gemaild : mr.ok ? wacht : fout).push(s.its);
      await svcAfspraakSchrijf(db, a);
      await db.prepare("UPDATE svc_melding SET status = 'gepland', ts = ?2 WHERE its = ?1").bind(s.its, Date.now()).run();
      await svcLog(db, s.its, wie, "ingepland op " + datum + " route " + nr + " (" + SVC_DAGDEEL_KORT[s.dagdeel] + ")" + (mr.geenMail ? ", zonder mail, meteen akkoord" : mr.ok && !mr.wacht ? ", klant gemaild" : mr.wacht ? ", mail wacht: " + mr.wacht : ", " + (mr.error || "mail lukte nog niet")));
    }
  }
  return { ok: true, gepland, over, vrijeRoutes, gemaild: gemaild.length, mailWacht: wacht.length, mailFout: fout.length,
    waarschuwing: vrijeRoutes === 0 ? "Alle routes zijn nu in gebruik. Zet een monteur bij een nieuwe route als er meer ingepland moet worden." : null };
}

/* ── Monteur ziek ───────────────────────────────────────────────────────── */
async function svcZiek(env, H, wie, b) {
  const db = await svcDb(env);
  const datum = String(b.datum || ""), nr = Number(b.nr);
  const route = await db.prepare("SELECT * FROM svc_route WHERE datum = ?1 AND nr = ?2").bind(datum, nr).first();
  if (!route) return { ok: false, error: "Deze route is intussen weg." };
  const vandaag = svcVandaag();
  await db.prepare("UPDATE svc_route SET ziek = 1, ts = ?3 WHERE datum = ?1 AND nr = ?2").bind(datum, nr, Date.now()).run();
  const getroffen = ((await db.prepare("SELECT * FROM svc_afspraak WHERE datum = ?1 AND nr = ?2 AND status IN ('voorstel','akkoord') ORDER BY volg").bind(datum, nr).all()).results || []).map(svcAfspraakUit);
  if (!getroffen.length) return { ok: true, verplaatst: [], over: [] };
  for (const a of getroffen) { a.status = "vervallen"; a.json.reden = "monteur ziek"; await svcAfspraakSchrijf(db, a); }
  const routes = ((await db.prepare("SELECT datum, nr, monteur, start, eind FROM svc_route WHERE datum >= ?1 AND ziek = 0 AND monteur != '' ORDER BY datum, nr").bind(datum < vandaag ? vandaag : datum).all()).results || [])
    .map(r => ({ datum: r.datum, nr: Number(r.nr), monteur: r.monteur, start: Number(r.start) || SVC_START, eind: Number(r.eind) || SVC_EIND }));
  const meldRijen = (await db.prepare("SELECT its, status, json FROM svc_melding WHERE status IN ('open','gepland')").all()).results || [];
  const meld = {};
  for (const r of meldRijen) meld[r.its] = Object.assign(svcJson(r.json, {}), { its: r.its, status: r.status });
  const afs = ((await db.prepare("SELECT * FROM svc_afspraak WHERE datum >= ?1 AND status IN ('voorstel','akkoord') ORDER BY datum, nr, volg").bind(datum).all()).results || []).map(svcAfspraakUit);
  const thuis = await svcThuis(env, H);
  const stopsPer = {};
  for (const a of afs) {
    const m = meld[a.its] || {};
    (stopsPer[a.datum + "|" + a.nr] = stopsPer[a.datum + "|" + a.nr] || []).push({ its: a.its, geo: m.geo || null, duur: Number(m.duur) || 60, dagdeel: a.dagdeel, id: a.id });
  }
  /* Zo snel mogelijk (Kevin): de vroegste dag wint, ook de dag zelf als een
     andere route daar nog ruimte heeft. svcBestePlek houdt de dagdelen van
     de klanten die al in die routes staan gelijk. Wat nergens past gaat
     terug in de lijst, gemarkeerd, zodat de planner de klant belt. */
  const verplaatst = [], over = [];
  for (const oud of getroffen) {
    const m = meld[oud.its];
    if (!m) continue;
    const plek = svcBestePlek(Object.assign({}, m, { vanaf: null }), routes, stopsPer, thuis, vandaag, true);
    if (plek.geen) {
      m.ziekVan = datum;
      await db.prepare("UPDATE svc_melding SET status = 'open', json = ?2, ts = ?3 WHERE its = ?1").bind(oud.its, JSON.stringify(Object.assign({}, m, { status: undefined })), Date.now()).run();
      await svcLog(db, oud.its, wie, "monteur ziek op " + datum + "; nog geen nieuwe plek, terug in de lijst");
      over.push({ its: oud.its, naam: (m.klant || {}).naam || "", reden: plek.reden });
      continue;
    }
    const k = plek.R.datum + "|" + plek.R.nr;
    const stops = stopsPer[k] = stopsPer[k] || [];
    const stop = { its: oud.its, geo: m.geo || null, duur: m.duur, dagdeel: svcDagdeel(plek.aankomst), nieuw: true };
    stops.splice(plek.p, 0, stop);
    const a = { id: "sa" + oud.its + "-" + Date.now().toString(36), its: oud.its, datum: plek.R.datum, nr: plek.R.nr, volg: plek.p + 1, dagdeel: stop.dagdeel,
                status: "voorstel", token: svcToken(), json: { door: wie, gemaakt: new Date().toISOString(), oudeDatum: datum, ziek: true } };
    stop.id = a.id;
    const mr = await svcMailStuur(env, db, a, m, "ziek", { oudeDatum: datum });
    await svcAfspraakSchrijf(db, a);
    await svcLog(db, oud.its, wie, "monteur ziek op " + datum + "; nieuw: " + plek.R.datum + " route " + plek.R.nr + (mr.ok && !mr.wacht ? ", klant gemaild" : mr.wacht ? ", mail wacht: " + mr.wacht : ""));
    verplaatst.push({ its: oud.its, naam: (m.klant || {}).naam || "", datum: plek.R.datum, nr: plek.R.nr, monteur: plek.R.monteur, dagdeel: stop.dagdeel });
  }
  // De volgorde van de routes waar iets bij kwam.
  for (const stops of Object.values(stopsPer)) {
    if (!stops.some(s => s.nieuw)) continue;
    for (let i = 0; i < stops.length; i++) if (stops[i].id) await db.prepare("UPDATE svc_afspraak SET volg = ?1 WHERE id = ?2").bind(i + 1, stops[i].id).run();
  }
  return { ok: true, verplaatst, over };
}

/* ── Het overzicht voor de twee tegels ──────────────────────────────────── */
async function svcOverzicht(env, url) {
  const db = await svcDb(env);
  const vandaag = svcVandaag();
  const van = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("van") || "") ? url.searchParams.get("van") : svcPlus(vandaag, -7);
  const tot = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("tot") || "") ? url.searchParams.get("tot") : svcPlus(vandaag, 42);
  const meldRijen = (await db.prepare("SELECT its, status, json, ts FROM svc_melding WHERE status IN ('open','gepland')").all()).results || [];
  const afs = ((await db.prepare("SELECT * FROM svc_afspraak WHERE datum >= ?1 AND datum <= ?2 AND status IN ('voorstel','akkoord','klaar')").bind(van, tot).all()).results || []).map(svcAfspraakUit);
  /* De meldingen bij afspraken in dit venster die niet meer open of gepland
     zijn (klaar), zodat een oude afspraak nog een naam heeft. */
  const bekend = new Set(meldRijen.map(r => r.its));
  const missend = [...new Set(afs.map(a => a.its).filter(i => !bekend.has(i)))].slice(0, 90);
  let extra = [];
  if (missend.length) extra = (await db.prepare("SELECT its, status, json, ts FROM svc_melding WHERE its IN (" + missend.map((_, i) => "?" + (i + 1)).join(",") + ")").bind(...missend).all()).results || [];
  const routes = ((await db.prepare("SELECT * FROM svc_route WHERE datum >= ?1 AND datum <= ?2 ORDER BY datum, nr").bind(van, tot).all()).results || [])
    .map(r => ({ datum: r.datum, nr: Number(r.nr), monteur: r.monteur || "", start: Number(r.start) || SVC_START, eind: Number(r.eind) || SVC_EIND, ziek: !!r.ziek }));
  const inst = await svcInstellingen(env);
  // Het token is de sleutel van de klant; dat hoort niet in het scherm.
  for (const a of afs) delete a.token;
  return { ok: true, vandaag, van, tot,
    meldingen: [...meldRijen, ...extra].map(r => Object.assign(svcJson(r.json, {}), { its: r.its, status: r.status, ts: r.ts })),
    afspraken: afs, routes, monteurs: SVC_MONTEURS,
    mail: { aan: !!inst.mailAan, proef: inst.proefAdres || "", vandaag: await svcMailTeller(db), max: SVC_MAIL_MAX },
    tijden: { start: SVC_START, eind: SVC_EIND } };
}

/* ── Zoeken in Planning Service (Kevin, 30 okt 2026) ──────────────────────
   Op naam, plaats, adres, ITS-nummer, debiteurnummer, telefoon of mail; met
   per melding de afspraken (datum, route, monteur), zodat de planner er
   meteen heen kan. */
async function svcZoek(env, q) {
  const db = await svcDb(env);
  q = String(q || "").trim().toLowerCase();
  if (q.length < 2) return { ok: true, resultaten: [] };
  const cijfers = q.replace(/\D/g, "");
  const rijen = (await db.prepare("SELECT its, status, json FROM svc_melding ORDER BY ts DESC LIMIT 2000").all()).results || [];
  const hits = [];
  for (const r of rijen) {
    const m = svcJson(r.json, {}), k = m.klant || {};
    const tekst = [r.its, k.naam, k.plaats, k.adres, k.debiteur, k.mail, m.titel].join(" ").toLowerCase();
    const tels = [k.tel, k.tel2].map(x => String(x || "").replace(/\D/g, "")).join(" ");
    if (tekst.includes(q) || (cijfers.length >= 4 && tels.includes(cijfers))) hits.push({ its: r.its, status: r.status, naam: k.naam || "", plaats: k.plaats || "", debiteur: k.debiteur || null });
    if (hits.length >= 40) break;
  }
  if (hits.length) {
    const lijst = hits.map(h => h.its);
    const afs = ((await db.prepare("SELECT a.id, a.its, a.datum, a.nr, a.status, r.monteur FROM svc_afspraak a LEFT JOIN svc_route r ON r.datum = a.datum AND r.nr = a.nr WHERE a.its IN (" + lijst.map((_, i) => "?" + (i + 1)).join(",") + ") AND a.status IN ('voorstel','akkoord','klaar') ORDER BY a.datum DESC").bind(...lijst).all()).results || []);
    for (const h of hits) h.afspraken = afs.filter(a => a.its === h.its).map(a => ({ id: a.id, datum: a.datum, nr: Number(a.nr), status: a.status, monteur: a.monteur || "" }));
  }
  return { ok: true, resultaten: hits };
}

/* ── Routes klaarzetten ─────────────────────────────────────────────────── */
async function svcRoute(env, wie, b) {
  const db = await svcDb(env);
  const datum = String(b.datum || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return { ok: false, error: "Kies een datum." };
  const monteur = String(b.monteur || "").trim().slice(0, 40);
  const tijd = (x, std) => { const m = String(x || "").match(/^(\d{1,2}):(\d{2})$/); return m ? Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2])) : (Number.isFinite(Number(x)) && x !== "" && x != null ? Number(x) : std); };
  let nr = Number(b.nr) || 0;
  if (b.weg) {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM svc_afspraak WHERE datum = ?1 AND nr = ?2 AND status IN ('voorstel','akkoord')").bind(datum, nr).first();
    if (n && n.n) return { ok: false, error: "Er staan nog afspraken in deze route. Verplaats die eerst." };
    await db.prepare("DELETE FROM svc_route WHERE datum = ?1 AND nr = ?2").bind(datum, nr).run();
    return { ok: true };
  }
  if (!nr) {
    const x = await db.prepare("SELECT MAX(nr) AS m FROM svc_route WHERE datum = ?1").bind(datum).first();
    nr = (x && x.m ? Number(x.m) : 0) + 1;
  }
  const oud = await db.prepare("SELECT * FROM svc_route WHERE datum = ?1 AND nr = ?2").bind(datum, nr).first();
  const start = tijd(b.start, oud ? oud.start : SVC_START), eind = tijd(b.eind, oud ? oud.eind : SVC_EIND);
  if (eind <= start) return { ok: false, error: "De eindtijd moet na de begintijd liggen." };
  const ziek = b.ziek === false ? 0 : (oud ? oud.ziek : 0);
  await db.prepare("INSERT OR REPLACE INTO svc_route (datum, nr, monteur, start, eind, ziek, ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(datum, nr, monteur, start, eind, ziek, Date.now()).run();
  return { ok: true, route: { datum, nr, monteur, start, eind, ziek: !!ziek } };
}

/* ── Een afspraak met de hand bijsturen ─────────────────────────────────── */
async function svcAfspraakActie(env, H, wie, b) {
  const db = await svcDb(env);
  const rij = await db.prepare("SELECT * FROM svc_afspraak WHERE id = ?1").bind(String(b.id || "")).first();
  if (!rij) return { ok: false, error: "Deze afspraak is intussen weg." };
  const a = svcAfspraakUit(rij);
  const actie = String(b.actie || "");
  const route = async () => ((await db.prepare("SELECT * FROM svc_afspraak WHERE datum = ?1 AND nr = ?2 AND status IN ('voorstel','akkoord') ORDER BY volg").bind(a.datum, a.nr).all()).results || []).map(svcAfspraakUit);
  const nummer = async (lijst) => { for (let i = 0; i < lijst.length; i++) await db.prepare("UPDATE svc_afspraak SET volg = ?1 WHERE id = ?2").bind(i + 1, lijst[i].id).run(); };
  if (actie === "omhoog" || actie === "omlaag") {
    const lijst = await route();
    const i = lijst.findIndex(x => x.id === a.id), j = actie === "omhoog" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= lijst.length) return { ok: true };
    [lijst[i], lijst[j]] = [lijst[j], lijst[i]];
    await nummer(lijst);
    await svcHerreken(env, H, db, a.datum, a.nr);
    return { ok: true };
  }
  if (actie === "naarRoute") {
    const nr = Number(b.nr), datum = /^\d{4}-\d{2}-\d{2}$/.test(String(b.datum || "")) ? String(b.datum) : a.datum;
    const doel = await db.prepare("SELECT * FROM svc_route WHERE datum = ?1 AND nr = ?2").bind(datum, nr).first();
    if (!doel) return { ok: false, error: "Die route bestaat nog niet." };
    const oudeDatum = a.datum, oudeNr = a.nr;
    const x = await db.prepare("SELECT MAX(volg) AS m FROM svc_afspraak WHERE datum = ?1 AND nr = ?2 AND status IN ('voorstel','akkoord')").bind(datum, nr).first();
    /* Met b.volg (slepen in Planning Service, Kevin 28 okt 2026) komt hij vóór
       die plek; zonder b.volg achteraan. svcHerreken nummert daarna opnieuw. */
    const naarAchter = (x && x.m ? Number(x.m) : 0) + 1;
    a.datum = datum; a.nr = nr; a.volg = Number(b.volg) > 0 ? Number(b.volg) - 0.5 : naarAchter;
    const mRij = await db.prepare("SELECT json FROM svc_melding WHERE its = ?1").bind(a.its).first();
    const zonderMail = !!svcJson(mRij && mRij.json, {}).geenMail;
    const andereDag = datum !== oudeDatum && !zonderMail;
    if (andereDag) {
      /* Een andere dag is een nieuw voorstel: de klant moet opnieuw akkoord
         geven. Eerst het dagdeel op de nieuwe plek bepalen, dan pas mailen. */
      a.status = "voorstel"; a.token = svcToken();
      a.json.mails = []; delete a.json.dagdeelNu; delete a.json.akkoordDoor; delete a.json.akkoordTs;
    }
    await svcAfspraakSchrijf(db, a);
    await svcHerreken(env, H, db, oudeDatum, oudeNr);
    await svcHerreken(env, H, db, datum, nr);
    let mr = null;
    if (andereDag) {
      const vers = svcAfspraakUit(await db.prepare("SELECT * FROM svc_afspraak WHERE id = ?1").bind(a.id).first());
      const m = await db.prepare("SELECT json FROM svc_melding WHERE its = ?1").bind(a.its).first();
      mr = await svcMailStuur(env, db, vers, svcJson(m && m.json, {}), "voorstel");
      await svcAfspraakSchrijf(db, vers);
    }
    await svcLog(db, a.its, wie, "verplaatst naar " + datum + " route " + nr + (mr ? (mr.ok && !mr.wacht ? ", klant gemaild" : ", mail wacht") : ""));
    return { ok: true };
  }
  /* Verwijderen (Kevin, 28 okt 2026): de afspraak gaat uit de planning en de
     melding uit de lijst. Niets gaat echt weg: status vervallen, met wie en
     wanneer, en terug te halen door de melding opnieuw toe te voegen. */
  if (actie === "weg") {
    a.status = "vervallen"; a.json.reden = "verwijderd door " + wie; a.json.verwijderd = { door: wie, ts: Date.now() };
    await svcAfspraakSchrijf(db, a);
    const nogEen = await db.prepare("SELECT COUNT(*) AS n FROM svc_afspraak WHERE its = ?1 AND status IN ('voorstel','akkoord')").bind(a.its).first();
    if (!(nogEen && nogEen.n)) await db.prepare("UPDATE svc_melding SET status = 'vervallen', ts = ?2 WHERE its = ?1").bind(a.its, Date.now()).run();
    await nummer(await route());
    await svcHerreken(env, H, db, a.datum, a.nr);
    await svcLog(db, a.its, wie, "afspraak van " + a.datum + " verwijderd");
    return { ok: true };
  }
  if (actie === "terug") {
    a.status = "vervallen"; a.json.reden = "terug naar de lijst door " + wie;
    await svcAfspraakSchrijf(db, a);
    await db.prepare("UPDATE svc_melding SET status = 'open', ts = ?2 WHERE its = ?1").bind(a.its, Date.now()).run();
    await nummer(await route());
    await svcHerreken(env, H, db, a.datum, a.nr);
    await svcLog(db, a.its, wie, "afspraak van " + a.datum + " terug naar de lijst");
    return { ok: true };
  }
  if (actie === "akkoord") {
    a.status = b.uit ? "voorstel" : "akkoord"; a.json.akkoordDoor = b.uit ? null : wie; a.json.akkoordTs = b.uit ? null : Date.now();
    await svcAfspraakSchrijf(db, a);
    await svcLog(db, a.its, wie, b.uit ? "akkoord weggehaald" : "akkoord gezet door de planning");
    return { ok: true };
  }
  if (actie === "mail") {
    const m = await db.prepare("SELECT json FROM svc_melding WHERE its = ?1").bind(a.its).first();
    const mr = await svcMailStuur(env, db, a, svcJson(m && m.json, {}), a.json.ziek ? "ziek" : "voorstel");
    await svcAfspraakSchrijf(db, a);
    await svcLog(db, a.its, wie, mr.ok && !mr.wacht ? "klant opnieuw gemaild" : "mail wacht: " + (mr.wacht || mr.error));
    return mr.ok ? { ok: true, wacht: mr.wacht || null } : mr;
  }
  return { ok: false, error: "onbekende actie" };
}

/* ── Met de hand in een route zetten (Kevin, 28 okt 2026) ──────────────────
   Niet via In te plannen meldingen: de planner kiest zelf de route (en de
   plek). De melding is net opgeslagen met het formulier. Daarna hetzelfde als
   Plannen: een voorstel en een mail aan de klant, of zonder mail meteen
   akkoord. */
async function svcHandInplannen(env, H, wie, b) {
  const db = await svcDb(env);
  const its = String(b.its || "").replace(/\D/g, ""), datum = String(b.datum || ""), nr = Number(b.nr);
  const mRij = await db.prepare("SELECT status, json FROM svc_melding WHERE its = ?1").bind(its).first();
  if (!mRij) return { ok: false, error: "Sla de melding eerst op." };
  const route = await db.prepare("SELECT * FROM svc_route WHERE datum = ?1 AND nr = ?2").bind(datum, nr).first();
  if (!route) return { ok: false, error: "Die route bestaat nog niet." };
  if (!route.monteur) return { ok: false, error: "Zet eerst een monteur bij deze route." };
  const m = svcJson(mRij.json, {});
  const x = await db.prepare("SELECT MAX(volg) AS m FROM svc_afspraak WHERE datum = ?1 AND nr = ?2 AND status IN ('voorstel','akkoord')").bind(datum, nr).first();
  const nu = new Date().toISOString();
  const a = { id: "sa" + its + "-" + Date.now().toString(36), its, datum, nr, volg: Number(b.volg) > 0 ? Number(b.volg) - 0.5 : (x && x.m ? Number(x.m) : 0) + 1,
              dagdeel: 1, status: "voorstel", token: svcToken(), json: { door: wie, gemaakt: nu, metDeHand: true } };
  await svcAfspraakSchrijf(db, a);
  await svcHerreken(env, H, db, datum, nr);
  const vers = svcAfspraakUit(await db.prepare("SELECT * FROM svc_afspraak WHERE id = ?1").bind(a.id).first());
  const mr = await svcMailStuur(env, db, vers, m, "voorstel");
  if (mr.geenMail) { vers.status = "akkoord"; vers.json.akkoordDoor = wie; vers.json.akkoordTs = Date.now(); vers.json.akkoordZonderMail = true; }
  await svcAfspraakSchrijf(db, vers);
  await db.prepare("UPDATE svc_melding SET status = 'gepland', ts = ?2 WHERE its = ?1").bind(its, Date.now()).run();
  await svcLog(db, its, wie, "met de hand ingepland op " + datum + " route " + nr + " (" + route.monteur + ")" +
    (mr.geenMail ? ", zonder mail, meteen akkoord" : mr.ok && !mr.wacht ? ", klant gemaild" : mr.wacht ? ", mail wacht: " + mr.wacht : ", " + (mr.error || "mail lukte nog niet")));
  return { ok: true, id: vers.id, gemaild: !!(mr.ok && !mr.wacht && !mr.geenMail), geenMail: !!mr.geenMail, mailFout: mr.ok ? null : mr.error };
}

/* ── De herinneringen en de mails die wachten (cron op :15) ─────────────── */
async function svcRonde(env, H) {
  _svcH = H;
  const db = await svcDb(env);
  const inst = await svcInstellingen(env);
  if (!inst.mailAan) return { ok: true, uit: true };
  const vandaag = svcVandaag();
  const lijst = ((await db.prepare("SELECT * FROM svc_afspraak WHERE datum > ?1 AND status = 'voorstel'").bind(vandaag).all()).results || []).map(svcAfspraakUit);
  let verstuurd = 0;
  const nu = Date.now(), uur = new Date(nu + 2 * 3600000).getUTCHours();
  for (const a of lijst) {
    if (verstuurd >= 10) break;
    if ((await svcMailTeller(db)) >= SVC_MAIL_MAX) break;
    const laatste = (a.json.mails || []).slice(-1)[0];
    let soort = null;
    // Wat wacht (mailen stond uit, dagteller vol, of het lukte de vorige keer niet).
    // Zonder mailadres stopt svcMailStuur meteen, zonder de teller te raken.
    if (a.json.mailWacht) soort = a.json.mailWacht;
    // Herinneringen alleen overdag (8-18 uur), elke twee dagen na de laatste mail.
    else if (laatste && nu - laatste.ts >= 48 * 3600000 && uur >= 8 && uur < 18) soort = "herinnering";
    if (!soort) continue;
    const m = await db.prepare("SELECT json FROM svc_melding WHERE its = ?1").bind(a.its).first();
    const mr = await svcMailStuur(env, db, a, svcJson(m && m.json, {}), soort);
    await svcAfspraakSchrijf(db, a);
    if (mr.ok && !mr.wacht) { verstuurd++; await svcLog(db, a.its, "systeem", soort === "herinnering" ? "herinnering gemaild" : "klant gemaild (" + soort + ")"); }
  }
  return { ok: true, verstuurd };
}

/* ── De pagina's voor de klant ──────────────────────────────────────────── */
function svcPagina(titel, inhoud, taal) {
  return new Response("<!doctype html><html lang='" + (taal === "de" ? "de" : "nl") + "'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>" +
    "<title>" + svcEsc(titel) + " - Fonteyn</title><meta name='robots' content='noindex'>" +
    "<style>body{margin:0;background:#f5f4ef;font-family:Arial,Helvetica,sans-serif;color:#1f2937}" +
    ".kop{background:#144734;padding:16px 20px}.kop img{height:48px;display:block}" +
    ".blok{max-width:560px;margin:22px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:22px 22px 26px}" +
    "h1{color:#144734;font-size:21px;margin:0 0 10px}p{font-size:15px;line-height:1.55;margin:0 0 12px}" +
    ".knop{display:block;width:100%;box-sizing:border-box;border:0;border-radius:10px;padding:15px 18px;font-size:16px;font-weight:bold;cursor:pointer;color:#fff;margin-top:10px;text-align:center;text-decoration:none}" +
    ".groen{background:#15803d}.rood{background:#b91c1c}.grijs{background:#fff;color:#144734;border:1px solid #d1d5db}" +
    "fieldset{border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin:14px 0}legend{font-weight:bold;color:#144734;padding:0 6px}" +
    "label{display:inline-flex;align-items:center;gap:6px;margin:4px 14px 4px 0;font-size:15px}input[type=date],textarea{font:inherit;font-size:15px;padding:8px;border:1px solid #d1d5db;border-radius:8px}" +
    "textarea{width:100%;box-sizing:border-box;min-height:70px}.klein{font-size:13px;color:#6b7280}</style></head><body>" +
    "<div class='kop'><img src='" + SVC_LOGO + "' alt='Fonteyn'></div><div class='blok'>" + inhoud + "</div></body></html>",
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
/* De teksten van de klantpagina, Nederlands en Duits (30 okt 2026). De taal
   staat bij de afspraak (a.json.taal), gezet toen de mail de deur uit ging. */
const SVC_PAG = {
  nl: { termin: "Serviceafspraak", verlopenH: "Deze link is verlopen", verlopenP: "Er is intussen een nieuwe afspraak voor u gemaakt, of deze afspraak is al afgerond. Heeft u een vraag? Mail ons dan op ",
    bevestigdT: "Afspraak bevestigd", bevestigdH: "Bedankt, de afspraak staat vast", komt: "De monteur komt op ", belt: " Hij belt u op de dag zelf zodra hij een tijdsindicatie heeft.",
    ontvangenH: "Bedankt voor uw reactie", ontvangenP: "Wij hebben uw wensen ontvangen en nemen ze mee bij het inplannen. U krijgt van ons een nieuwe datum per mail.",
    andersT: "Andere datum kiezen", andersP1: "Wij hadden u ingepland op ", andersP2: ". Geef hieronder aan wat voor u past; wij plannen u daarna opnieuw in en sturen u een nieuwe datum.",
    dagenL: "Op welke dagen past het u?", dagen: ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag"], vanafL: "Vanaf welke datum kunnen wij komen?",
    wegL: "Bent u een tijd weg? Dan plannen wij buiten die periode", van: "van", tot: "tot en met", toelL: "Toelichting (mag leeg)", stuur: "Verstuur mijn wensen",
    inOrdeL: "Is uw spa weer in orde?", inOrdeP: "Dan mag de afspraak vervallen.", vervallen: "De afspraak mag vervallen",
    bevestigenT: "Afspraak bevestigen", uwH: "Uw serviceafspraak", ja: "Ja, de afspraak past",
    foutH: "Dat lukte nog niet", foutP: "Probeer het nog eens via de link in de mail.",
    weerH: "Bedankt voor uw bericht", weerP: "Fijn dat uw spa weer in orde is. De afspraak vervalt. Heeft u later toch nog een vraag, mail ons dan op ",
    wensH: "Bedankt, we hebben uw wensen ontvangen", wensP: "Wij plannen u opnieuw in en sturen u een nieuwe datum per mail.", bedankt: "Bedankt" },
  de: { termin: "Servicetermin", verlopenH: "Dieser Link ist abgelaufen", verlopenP: "Inzwischen wurde ein neuer Termin für Sie erstellt, oder dieser Termin ist bereits abgeschlossen. Haben Sie eine Frage? Schreiben Sie uns an ",
    bevestigdT: "Termin bestätigt", bevestigdH: "Vielen Dank, der Termin steht fest", komt: "Der Techniker kommt am ", belt: " Er ruft Sie am Tag selbst an, sobald er eine genauere Uhrzeit nennen kann.",
    ontvangenH: "Vielen Dank für Ihre Rückmeldung", ontvangenP: "Wir haben Ihre Wünsche erhalten und berücksichtigen sie bei der Planung. Sie erhalten von uns einen neuen Termin per E-Mail.",
    andersT: "Anderen Termin wählen", andersP1: "Wir hatten Sie eingeplant für ", andersP2: ". Geben Sie unten an, was für Sie passt; wir planen Sie dann neu ein und schicken Ihnen einen neuen Termin.",
    dagenL: "An welchen Tagen passt es Ihnen?", dagen: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"], vanafL: "Ab welchem Datum können wir kommen?",
    wegL: "Sind Sie eine Zeit lang nicht da? Dann planen wir außerhalb dieses Zeitraums", van: "von", tot: "bis einschließlich", toelL: "Anmerkung (optional)", stuur: "Meine Wünsche senden",
    inOrdeL: "Funktioniert Ihr Spa wieder?", inOrdeP: "Dann kann der Termin entfallen.", vervallen: "Der Termin kann entfallen",
    bevestigenT: "Termin bestätigen", uwH: "Ihr Servicetermin", ja: "Ja, der Termin passt",
    foutH: "Das hat leider nicht geklappt", foutP: "Bitte versuchen Sie es noch einmal über den Link in der E-Mail.",
    weerH: "Vielen Dank für Ihre Nachricht", weerP: "Schön, dass Ihr Spa wieder funktioniert. Der Termin entfällt. Haben Sie später doch noch eine Frage, schreiben Sie uns an ",
    wensH: "Vielen Dank, wir haben Ihre Wünsche erhalten", wensP: "Wir planen Sie neu ein und schicken Ihnen einen neuen Termin per E-Mail.", bedankt: "Vielen Dank" },
};
async function svcAntwoordGet(env, url) {
  const db = await svcDb(env);
  const t = String(url.searchParams.get("t") || "").slice(0, 60), k = url.searchParams.get("k") || "";
  const rij = t ? await db.prepare("SELECT * FROM svc_afspraak WHERE token = ?1").bind(t).first() : null;
  const mailLink = "<a href='mailto:" + SVC_ANTWOORD + "'>" + SVC_ANTWOORD + "</a>";
  if (!rij) return svcPagina(SVC_PAG.nl.termin, "<h1>" + SVC_PAG.nl.verlopenH + "</h1><p>" + SVC_PAG.nl.verlopenP + mailLink + ".</p>");
  const a = svcAfspraakUit(rij);
  const taal = a.json.taal === "de" ? "de" : "nl", T = SVC_PAG[taal];
  const wanneer = "<b>" + svcEsc(svcDatumTekst(a.datum, taal)) + "</b>, " + svcEsc((taal === "de" ? SVC_DAGDEEL_DE : SVC_DAGDEEL)[a.dagdeel] || "");
  if (a.status === "akkoord") return svcPagina(T.bevestigdT, "<h1>" + T.bevestigdH + "</h1><p>" + T.komt + wanneer + "." + T.belt + "</p>", taal);
  if (a.status !== "voorstel") return svcPagina(T.termin, "<h1>" + T.ontvangenH + "</h1><p>" + T.ontvangenP + "</p>", taal);
  const verborgen = "<input type='hidden' name='t' value='" + svcEsc(t) + "'>";
  if (k === "anders") {
    const dag = (n) => "<label><input type='checkbox' name='dag' value='" + n + "'> " + T.dagen[n - 1] + "</label>";
    return svcPagina(T.andersT, "<h1>" + T.andersT + "</h1>" +
      "<p>" + T.andersP1 + wanneer + T.andersP2 + "</p>" +
      "<form method='post' action='/service/antwoord'>" + verborgen + "<input type='hidden' name='k' value='anders'>" +
      "<fieldset><legend>" + T.dagenL + "</legend>" + [1, 2, 3, 4, 5].map(dag).join("") + "</fieldset>" +
      "<fieldset><legend>" + T.vanafL + "</legend><input type='date' name='vanaf'></fieldset>" +
      "<fieldset><legend>" + T.wegL + "</legend><label>" + T.van + " <input type='date' name='nietVan'></label><label>" + T.tot + " <input type='date' name='nietTot'></label></fieldset>" +
      "<fieldset><legend>" + T.toelL + "</legend><textarea name='opmerking' maxlength='500'></textarea></fieldset>" +
      "<button class='knop rood' type='submit'>" + T.stuur + "</button>" +
      "<fieldset style='margin-top:22px'><legend>" + T.inOrdeL + "</legend><p class='klein'>" + T.inOrdeP + "</p>" +
      "<button class='knop grijs' type='submit' name='nodig' value='nee'>" + T.vervallen + "</button></fieldset>" +
      "</form>", taal);
  }
  return svcPagina(T.bevestigenT, "<h1>" + T.uwH + "</h1><p>" + T.komt + wanneer + ".</p>" +
    "<form method='post' action='/service/antwoord'>" + verborgen + "<input type='hidden' name='k' value='akkoord'>" +
    "<button class='knop groen' type='submit'>" + T.ja + "</button></form>" +
    "<a class='knop rood' href='/service/antwoord?t=" + encodeURIComponent(t) + "&k=anders'>" + T.andersT + "</a>", taal);
}
async function svcAntwoordPost(env, request, H) {
  const db = await svcDb(env);
  const f = await request.formData().catch(() => null);
  if (!f) return svcPagina(SVC_PAG.nl.termin, "<h1>" + SVC_PAG.nl.foutH + "</h1><p>" + SVC_PAG.nl.foutP + "</p>");
  const t = String(f.get("t") || "").slice(0, 60), k = String(f.get("k") || "");
  const rij = t ? await db.prepare("SELECT * FROM svc_afspraak WHERE token = ?1").bind(t).first() : null;
  if (!rij) return svcAntwoordGet(env, new URL("https://x/?t="));
  const a = svcAfspraakUit(rij);
  const taal = a.json.taal === "de" ? "de" : "nl", T = SVC_PAG[taal];
  if (a.status !== "voorstel") return svcAntwoordGet(env, new URL("https://x/?t=" + encodeURIComponent(t)));
  const nu = Date.now();
  if (k === "akkoord") {
    a.status = "akkoord"; a.json.akkoordDoor = "klant"; a.json.akkoordTs = nu;
    await svcAfspraakSchrijf(db, a);
    await svcLog(db, a.its, "klant", "klant gaf akkoord voor " + a.datum);
    return svcAntwoordGet(env, new URL("https://x/?t=" + encodeURIComponent(t)));
  }
  // Andere datum, of de afspraak mag vervallen.
  const melRij = await db.prepare("SELECT json FROM svc_melding WHERE its = ?1").bind(a.its).first();
  const m = svcJson(melRij && melRij.json, {});
  const nietNodig = String(f.get("nodig") || "") === "nee";
  const datum = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || "")) ? String(x) : null;
  const wens = { ts: nu, dagen: f.getAll("dag").map(Number).filter(x => x >= 1 && x <= 5), vanaf: datum(f.get("vanaf")), nietVan: datum(f.get("nietVan")), nietTot: datum(f.get("nietTot")),
                 opmerking: String(f.get("opmerking") || "").trim().slice(0, 500), nietNodig, datumWas: a.datum };
  a.status = "anders"; a.json.klantWens = wens;
  await svcAfspraakSchrijf(db, a);
  // De stops erna komen eerder; laat de planning zien of een dagdeel verschuift.
  await svcHerreken(env, H, db, a.datum, a.nr).catch(() => {});
  m.klantWens = wens;
  if (wens.dagen.length) m.voorkeur = wens.dagen;
  if (wens.vanaf) m.vanaf = wens.vanaf;
  if (wens.nietVan && wens.nietTot) { m.nietVan = wens.nietVan < wens.nietTot ? wens.nietVan : wens.nietTot; m.nietTot = wens.nietVan < wens.nietTot ? wens.nietTot : wens.nietVan; }
  /* Zonder nieuwe wens zou hij weer op dezelfde dag uitkomen; die dag
     slaan we dan over. */
  if (!nietNodig && !wens.dagen.length && !wens.vanaf && !(wens.nietVan && wens.nietTot)) m.vanaf = svcPlus(a.datum, 1);
  await db.prepare("UPDATE svc_melding SET status = ?2, json = ?3, ts = ?4 WHERE its = ?1").bind(a.its, nietNodig ? "vervallen" : "open", JSON.stringify(m), nu).run();
  await svcLog(db, a.its, "klant", nietNodig ? "klant: afspraak mag vervallen" : "klant koos een andere datum");
  return svcPagina(T.bedankt, nietNodig
    ? "<h1>" + T.weerH + "</h1><p>" + T.weerP + "<a href='mailto:" + SVC_ANTWOORD + "'>" + SVC_ANTWOORD + "</a>.</p>"
    : "<h1>" + T.wensH + "</h1><p>" + T.wensP + "</p>", taal);
}

/* ═══ MIJN ROUTES SERVICE EN DE WERKBON ════════════════════════════════════
   Kevin (document "Service planning", 23 okt 2026):
   - Mijn routes Service: "De jongens zien alleen hun eigen route. Thieme ziet
     dus alleen Thieme, Patrick alleen Patrick en Hans alleen Hans."
   - Materialen uit Logic4, met een zoekveld.
   - Op de werkbon geen prijzen; bij voorrijkosten en arbeid alleen de uren.
     Voorrijkosten rekent het Dashboard zelf: een enkele rit van Fonteyn naar
     de klant, in kilometers (artikel 8860). Arbeid: de uren (artikel 8861).
   - Opleverbonnen Service: "na te kijken" en "akkoord nog mailen" in één
     lijst, en een knop Factuur aanmaken: een order in Logic4 met als
     medewerker de monteur, transporteur Fonteyn Servicemonteur (verzend-
     methode 11), betaalmethode Rekening 14 dagen (6), ind. lev. dtm. de dag
     van het bezoek, alle materialen, en dan meteen de factuur erbij.
   - De werkbon naar de klant: geen kosten, alleen materialen en arbeidsuren;
     ook bij garantie.

   De monteurs loggen in met een eigen Dashboard-inlog (groep extern, zoals
   de bakwagenchauffeurs) en staan in de groep service-monteurs. Hun Logic4-
   gebruikers (Thieme.Wennink, Patrick.Kroes, Hans.van.Putten) zijn de
   medewerker op de factuur. Opgezocht op 23 okt 2026. */
const SVC_MONTEUR = [
  { naam: "Thieme", rx: /thieme/i, l4: 2019103 },
  { naam: "Patrick", rx: /kroes/i, l4: 2019104 },
  { naam: "Hans", rx: /putten|^hans\b/i, l4: 2019105 },
  // Kevin, 27 okt 2026: ook Bart, Bertjan en Kevin rijden service.
  { naam: "Bart", rx: /^bart\b|^bart\.vdb/i, l4: 2016630 },
  { naam: "Bertjan", rx: /^bertjan/i, l4: 2013394 },
  { naam: "Kevin", rx: /^kevin\b/i, l4: 2003103 },
];
const SVC_VERZEND_SERVICEMONTEUR = 11;   // "Fonteyn Servicemonteur"
const SVC_BETAAL_REKENING14 = 6;         // "Rekening 14 dagen"
const SVC_BETAAL_GARANTIE = 30;          // "Garantie"
const SVC_ART_KM = "8860", SVC_ART_UUR = "8861";
const SVC_FACTUUR_STATUS = 1;            // Verkooporder (Kevin, 29 okt 2026); verwerken doet de planning in Logic4
const SVC_BON_ANTWOORD = "servicespa@fonteyn.nl";   // zoals bij de opleverbonnen
function svcMonteurVanInlog(wie) {
  const w = String(wie || "").split("@")[0];
  const m = SVC_MONTEUR.find(x => x.rx.test(w));
  return m ? m.naam : "";
}
function svcMonteurGelijk(a, b) { return String(a || "").trim().split(/\s+/)[0].toLowerCase() === String(b || "").trim().split(/\s+/)[0].toLowerCase() && !!String(a || "").trim(); }

let _svcBonTabel = false;
async function svcBonDb(env) {
  const db = await svcDb(env);
  if (!_svcBonTabel) {
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS svc_bon (id TEXT PRIMARY KEY, its TEXT, datum TEXT, monteur TEXT, status TEXT, json TEXT, ts INTEGER)"),
      db.prepare("CREATE INDEX IF NOT EXISTS svc_bon_status ON svc_bon (status)"),
      db.prepare("CREATE INDEX IF NOT EXISTS svc_bon_datum ON svc_bon (datum)"),
    ]);
    _svcBonTabel = true;
  }
  return db;
}
async function svcBonLees(db, id) {
  const r = await db.prepare("SELECT json, status FROM svc_bon WHERE id = ?1").bind(String(id)).first();
  return r ? Object.assign(svcJson(r.json, {}), { status: r.status }) : null;
}
async function svcBonSchrijf(db, bon) {
  bon.gewijzigd = new Date().toISOString();
  await db.prepare("INSERT OR REPLACE INTO svc_bon (id, its, datum, monteur, status, json, ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(bon.id, String(bon.its), bon.datum, bon.monteur || "", bon.status, JSON.stringify(bon), Date.now()).run();
}
/* Een nieuwe werkbon, gevuld uit de afspraak en de melding. */
function svcBonNieuw(a, m, route) {
  const k = m.klant || {};
  return { id: a.id, its: String(a.its), datum: a.datum, monteur: (route && route.monteur) || "", status: "concept",
    klant: { naam: k.naam || "", adres: k.adres || "", tel: k.tel || "", mail: k.mail || "", debiteur: k.debiteur || null },
    garantie: m.garantie || null, melding: String(m.tekst || m.omschrijving || m.titel || "").slice(0, 3000),
    gedaan: "", materialen: [], uren: 0, opmerking: "", klantNaam: k.naam || "", handtekeningKlant: "", gemaakt: new Date().toISOString() };
}
function svcBonSchoon(b, oud) {
  const tekst = (x, n) => String(x == null ? "" : x).slice(0, n);
  const bon = Object.assign({}, oud);
  if (b.gedaan !== undefined) bon.gedaan = tekst(b.gedaan, 3000);
  if (b.melding !== undefined) bon.melding = tekst(b.melding, 3000);
  if (b.opmerking !== undefined) bon.opmerking = tekst(b.opmerking, 1000);
  if (b.klantNaam !== undefined) bon.klantNaam = tekst(b.klantNaam, 80);
  if (b.uren !== undefined) bon.uren = Math.max(0, Math.min(24, Math.round((Number(String(b.uren).replace(",", ".")) || 0) * 4) / 4));
  if (b.materialen !== undefined) bon.materialen = (Array.isArray(b.materialen) ? b.materialen : []).slice(0, 60).map(r => ({
    code: tekst(r.code, 40).trim(), oms: tekst(r.oms, 160), aantal: Math.max(0, Math.min(999, Number(String(r.aantal).replace(",", ".")) || 0)) }))
    .filter(r => r.code || r.oms);
  if (b.handtekeningKlant !== undefined) bon.handtekeningKlant = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(String(b.handtekeningKlant)) && String(b.handtekeningKlant).length < 400000 ? String(b.handtekeningKlant) : "";
  if (b.klant && b.klant.mail !== undefined) bon.klant = Object.assign({}, bon.klant, { mail: [...new Set(String(b.klant.mail || "").toLowerCase().split(/[;,\s]+/).filter(Boolean))].join(", ").slice(0, 200) });
  return bon;
}

/* GET /service/mijn?datum=&als= : de route(s) van één monteur op één dag,
   plus de komende dagen waarop hij een route heeft (voor de dagkeuze). */
/* De telefoonnummers uit de klantenkaart in Logic4, bij de melding bewaard. */
async function svcKlantVers(env, db, its, m) {
  const token = await _svcH.l4Token(env);
  const r = await fetch("https://api.logic4server.nl/v3/Relations/GetCustomers", { method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ Id: Number(m.klant.debiteur), TakeRecords: 2 }) });
  const j = r.ok ? await r.json().catch(() => null) : null;
  const k = ((Array.isArray(j) ? j : (j && j.Records)) || []).find(x => Number(x.Id) === Number(m.klant.debiteur));
  if (!k) { m.klant.tel2 = ""; m.klant.land = null; }
  else {
    const mob = String(k.MobileNumber || "").trim(), vast = String(k.TelephoneNumber || "").trim();
    const een = mob || vast, twee = mob && vast && vast.replace(/\D/g, "") !== mob.replace(/\D/g, "") ? vast : "";
    if (een) m.klant.tel = een;
    m.klant.tel2 = twee;
    m.klant.land = String(k.CountryCode || "").toUpperCase() || null;
  }
  await db.prepare("UPDATE svc_melding SET json = ?2 WHERE its = ?1").bind(String(its), JSON.stringify(m)).run();
  return m;
}
/* De melding vers uit Logic4 (Kevin, 29 okt 2026): staat de melding al in
   de route en zet kantoor er in Logic4 nog iets bij, dan ziet de monteur
   bij het openen de nieuwste tekst. Een monteur alleen voor zijn eigen
   afspraken. */
async function svcMeldingVers(env, H, wie, planner, its) {
  const db = await svcDb(env);
  its = String(its || "").replace(/\D/g, "");
  const rij = await db.prepare("SELECT json FROM svc_melding WHERE its = ?1").bind(its).first();
  if (!rij) return { ok: false, error: "Deze melding is onbekend." };
  if (!planner) {
    const ik = svcMonteurVanInlog(wie);
    const x = await db.prepare("SELECT r.monteur FROM svc_afspraak a JOIN svc_route r ON r.datum = a.datum AND r.nr = a.nr WHERE a.its = ?1 AND a.status IN ('voorstel','akkoord','klaar')").bind(its).all();
    if (!((x.results || []).some(r => svcMonteurGelijk(r.monteur, ik)))) return { ok: false, error: "Deze melding staat in een route van een collega." };
  }
  const m = svcJson(rij.json, {});
  const token = await H.l4Token(env);
  const r = await fetch("https://api.logic4server.nl/v3/ITS/GetIssues", { method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ Id: Number(its), SkipRecords: 0, TakeRecords: 1 }) });
  const j = r.ok ? await r.json().catch(() => null) : null;
  const x = ((j && (j.Records || j)) || []).find(y => Number(y.id || y.Id) === Number(its));
  if (x) {
    const tekst = H.itsTekst(x.Description).slice(0, 4000);
    if (tekst) { m.tekst = tekst; m.omschrijving = tekst.replace(/\s+/g, " ").slice(0, 300); }
    if (x.Name) m.titel = String(x.Name).slice(0, 200);
    m.versVanLogic4 = new Date().toISOString();
  }
  if (m.klant && m.klant.debiteur) await svcKlantVers(env, db, its, m).catch(() => {});
  else await db.prepare("UPDATE svc_melding SET json = ?2 WHERE its = ?1").bind(its, JSON.stringify(m)).run();
  const k = m.klant || {};
  return { ok: true, its, titel: m.titel || "", tekst: m.tekst || m.omschrijving || "", tel: k.tel || "", tel2: k.tel2 || "", vers: !!x };
}
async function svcMijn(env, wie, planner, url) {
  const db = await svcBonDb(env);
  const ik = svcMonteurVanInlog(wie);
  const als = planner ? String(url.searchParams.get("als") || ik || "") : ik;
  if (!als) return { ok: false, error: "Deze inlog hoort bij geen monteur." };
  const vandaag = svcVandaag();
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("datum") || "") ? url.searchParams.get("datum") : vandaag;
  const routesAll = ((await db.prepare("SELECT datum, nr, monteur, ziek FROM svc_route WHERE datum >= ?1 AND datum <= ?2").bind(svcPlus(vandaag, -14), svcPlus(vandaag, 28)).all()).results || []);
  const mijnRoutes = routesAll.filter(r => svcMonteurGelijk(r.monteur, als) && !r.ziek);
  const dagen = [...new Set(mijnRoutes.map(r => r.datum))].sort();
  const vandaagRoutes = mijnRoutes.filter(r => r.datum === datum).map(r => Number(r.nr));
  let stops = [];
  if (vandaagRoutes.length) {
    const afs = ((await db.prepare("SELECT * FROM svc_afspraak WHERE datum = ?1 AND status IN ('voorstel','akkoord','klaar') ORDER BY nr, volg").bind(datum).all()).results || []).map(svcAfspraakUit)
      .filter(a => vandaagRoutes.includes(Number(a.nr)));
    const its = [...new Set(afs.map(a => a.its))];
    const meld = {};
    if (its.length) for (const r of ((await db.prepare("SELECT its, json FROM svc_melding WHERE its IN (" + its.map((_, i) => "?" + (i + 1)).join(",") + ")").bind(...its).all()).results || [])) meld[r.its] = svcJson(r.json, {});
    const ids = afs.map(a => a.id);
    const bonnen = {};
    if (ids.length) for (const r of ((await db.prepare("SELECT id, status FROM svc_bon WHERE id IN (" + ids.map((_, i) => "?" + (i + 1)).join(",") + ")").bind(...ids).all()).results || [])) bonnen[r.id] = r.status;
    // Beide telefoonnummers: wie ze nog niet heeft, eenmalig uit de klantenkaart in Logic4.
    for (const i of its) { const m = meld[i]; if (m && m.klant && m.klant.debiteur && m.klant.tel2 === undefined) await svcKlantVers(env, db, i, m).catch(() => {}); }
    stops = afs.map(a => {
      const m = meld[a.its] || {}, k = m.klant || {};
      return { id: a.id, its: a.its, nr: a.nr, volg: a.volg, dagdeel: a.dagdeel, status: a.status,
        klant: { naam: k.naam || "", adres: k.adres || "", tel: k.tel || "", tel2: k.tel2 || "", debiteur: k.debiteur || null }, titel: m.titel || "", tekst: m.tekst || m.omschrijving || "",
        garantie: m.garantie || null, duur: m.duur || null, opmerking: m.opmerking || "", bon: bonnen[a.id] || "" };
    });
  }
  // De planning (Gerwin, Kevin, Tim) kan bij de route van elke monteur, ook als die nog niet in de vaste lijst staat.
  const namen = planner ? [...new Set(SVC_MONTEUR.map(x => x.naam).concat(routesAll.map(r => String(r.monteur || "").trim()).filter(Boolean)))] : [];
  return { ok: true, monteur: als, ik, datum, dagen, stops, monteurs: namen };
}
/* Mag deze inlog bij deze afspraak? De planning altijd; een monteur alleen
   bij een afspraak in zijn eigen route. */
async function svcMagBijAfspraak(db, wie, planner, id) {
  const a = await db.prepare("SELECT * FROM svc_afspraak WHERE id = ?1").bind(String(id || "")).first();
  if (!a) return { a: null };
  if (planner) return { a: svcAfspraakUit(a) };
  const r = await db.prepare("SELECT monteur FROM svc_route WHERE datum = ?1 AND nr = ?2").bind(a.datum, a.nr).first();
  return svcMonteurGelijk(r && r.monteur, svcMonteurVanInlog(wie)) ? { a: svcAfspraakUit(a) } : { a: null, nee: true };
}
async function svcBonGet(env, wie, planner, id) {
  const db = await svcBonDb(env);
  const bon = await svcBonLees(db, id);
  const { a, nee } = await svcMagBijAfspraak(db, wie, planner, id);
  if (nee) return { ok: false, error: "Deze afspraak staat in de route van een collega." };
  if (bon) return { ok: true, bon };
  if (!a) return { ok: false, error: "Deze afspraak is intussen weg." };
  const m = await db.prepare("SELECT json FROM svc_melding WHERE its = ?1").bind(a.its).first();
  const route = await db.prepare("SELECT monteur FROM svc_route WHERE datum = ?1 AND nr = ?2").bind(a.datum, a.nr).first();
  return { ok: true, bon: svcBonNieuw(a, svcJson(m && m.json, {}), route), nieuw: true };
}
/* De monteur bewaart (concept) of rondt af (klaar). */
async function svcBonPost(env, wie, planner, b) {
  const db = await svcBonDb(env);
  const id = String((b.bon && b.bon.id) || "");
  const { a, nee } = await svcMagBijAfspraak(db, wie, planner, id);
  if (nee) return { ok: false, error: "Deze afspraak staat in de route van een collega." };
  let oud = await svcBonLees(db, id);
  if (!oud) {
    if (!a) return { ok: false, error: "Deze afspraak is intussen weg." };
    const m = await db.prepare("SELECT json FROM svc_melding WHERE its = ?1").bind(a.its).first();
    const route = await db.prepare("SELECT monteur FROM svc_route WHERE datum = ?1 AND nr = ?2").bind(a.datum, a.nr).first();
    oud = svcBonNieuw(a, svcJson(m && m.json, {}), route);
  }
  if (["akkoord", "gemaild"].includes(oud.status) && !planner) return { ok: false, error: "Deze werkbon is op kantoor al goedgekeurd; aanpassen gaat nu via kantoor." };
  const bon = svcBonSchoon(b.bon, oud);
  const wil = String(b.bon.status || "concept");
  if (wil === "klaar") {
    if (!String(bon.gedaan || "").trim()) return { ok: false, error: "Vul in wat je bij de klant hebt gedaan." };
    if (!(bon.uren > 0)) return { ok: false, error: "Vul de gewerkte uren in." };
    if (bon.materialen.some(r => !r.code)) return { ok: false, error: "Elk materiaal komt uit Logic4: zoek het artikel op, of haal de regel weg." };
    if (bon.materialen.some(r => !(r.aantal > 0))) return { ok: false, error: "Vul bij elk materiaal een aantal in." };
    if (!bon.handtekeningKlant) return { ok: false, error: "Laat de klant nog even tekenen." };
    bon.status = "klaar"; bon.klaarTs = new Date().toISOString(); bon.klaarDoor = wie;
  } else if (oud.status === "concept" || oud.status === "klaar") bon.status = "concept";
  await svcBonSchrijf(db, bon);
  if (bon.status === "klaar" && a) {
    a.status = "klaar"; a.json.klaarTs = Date.now(); await svcAfspraakSchrijf(db, a);
    await db.prepare("UPDATE svc_melding SET status = 'klaar', ts = ?2 WHERE its = ?1").bind(String(a.its), Date.now()).run();
    await svcLog(db, a.its, wie, "werkbon afgerond (" + bon.uren + " uur, " + bon.materialen.length + " materiaal)");
  }
  return { ok: true, status: bon.status };
}
/* Artikelen zoeken in Logic4: code en naam, zonder prijzen. */
async function svcArtikel(env, H, q) {
  q = String(q || "").trim();
  if (q.length < 2) return { ok: true, artikelen: [] };
  const token = await H.l4Token(env);
  const r = await fetch("https://api.logic4server.nl/v3/Products/GetProducts", { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ FastSearchText: q, TakeRecords: 30 }) });
  const j = await r.json().catch(() => null);
  const l = Array.isArray(j) ? j : ((j && (j.Records || j.Products)) || []);
  return { ok: true, artikelen: l.filter(x => Number(x.StatusId) !== 10).map(x => ({ code: String(x.ProductCode || ""), oms: String(x.ProductName1 || x.Description || "") }))
    .filter(x => x.code && x.code !== SVC_ART_KM && x.code !== SVC_ART_UUR).slice(0, 20) };
}

/* ── Kantoor: de lijst, aanvullen, akkoord, mailen en de factuur ───────── */
async function svcBonWeg(env, wie, b) {
  const db = await svcBonDb(env);
  const bon = await svcBonLees(db, b.id);
  if (!bon) return { ok: false, error: "Deze opleverbon is intussen weg." };
  if (b.terug) {
    bon.status = (bon.weg && bon.weg.status) || "klaar"; bon.terugGezet = { door: wie, ts: new Date().toISOString() }; delete bon.weg;
  } else {
    if (bon.status === "weg") return { ok: true };
    bon.weg = { door: wie, ts: new Date().toISOString(), status: bon.status }; bon.status = "weg";
  }
  await svcBonSchrijf(db, bon);
  await svcLog(db, bon.its, wie, b.terug ? "opleverbon teruggezet" : "opleverbon weggehaald");
  return { ok: true };
}
async function svcBonnen(env, alleenWeg) {
  const db = await svcBonDb(env);
  const r = (alleenWeg
    ? await db.prepare("SELECT json, status FROM svc_bon WHERE status = 'weg' ORDER BY datum DESC LIMIT 200").all()
    : await db.prepare("SELECT json, status FROM svc_bon WHERE status IN ('concept','klaar','akkoord') OR (status = 'gemaild' AND ts > ?1) ORDER BY datum DESC LIMIT 400").bind(Date.now() - 45 * 864e5).all()).results || [];
  return { ok: true, bonnen: r.map(x => { const b = Object.assign(svcJson(x.json, {}), { status: x.status }); delete b.handtekeningKlant; b.getekend = !!svcJson(x.json, {}).handtekeningKlant; return b; }) };
}
async function svcBonKantoor(env, wie, b) {
  const db = await svcBonDb(env);
  const oud = await svcBonLees(db, b.id);
  if (!oud) return { ok: false, error: "Deze werkbon is intussen weg." };
  const velden = {}; for (const k of ["gedaan", "melding", "opmerking", "uren", "materialen", "klant"]) if (b.bon && k in b.bon) velden[k] = b.bon[k];
  const bon = svcBonSchoon(velden, oud);
  bon.kantoor = { door: wie, ts: new Date().toISOString() };
  if (b.akkoord) { if (bon.status === "concept") bon.namensMonteur = wie; if (bon.status !== "gemaild") bon.status = "akkoord"; bon.akkoordDoor = wie; bon.akkoordTs = bon.kantoor.ts; }
  if (b.terug) { bon.status = "concept"; bon.akkoordDoor = null; }
  await svcBonSchrijf(db, bon);
  return { ok: true, bon: Object.assign({}, bon, { handtekeningKlant: undefined, getekend: !!bon.handtekeningKlant }) };
}
/* De werkbon voor de klant: geen kosten, alleen materialen en uren. */
function svcBonHtml(bon, metHandtekening, taal) {
  const e = svcEsc;
  const de = taal === "de";
  const T = de ? { titel: "Arbeitsbericht Service", melding: "Meldung", garantie: "Garantie", aanhef: "Guten Tag", intro: "hier sehen Sie, was unser Techniker bei Ihnen erledigt hat.",
      gedaan: "Was erledigt wurde", mats: "Verwendete Materialien", arbeid: "Arbeitszeit", uur: "Stunden", getekend: "Zur Bestätigung unterschrieben", door: " von ",
      vraag: "Haben Sie eine Frage? Antworten Sie einfach auf diese E-Mail.", groet: "Mit freundlichen Grüßen<br>Fonteyn Spa-Service", klant: "Kunde" }
    : { titel: "Werkbon service", melding: "melding", garantie: "garantie", aanhef: "Beste", intro: "Hieronder ziet u wat onze monteur bij u heeft gedaan.",
      gedaan: "Wat er is gedaan", mats: "Gebruikte materialen", arbeid: "Arbeid", uur: "uur", getekend: "Voor akkoord getekend", door: " door ",
      vraag: "Heeft u een vraag? Beantwoord dan gewoon deze mail.", groet: "Met vriendelijke groet,<br>Fonteyn Spa service", klant: "klant" };
  const td = "style='padding:6px 8px;border-bottom:1px solid #eee;font-size:14px;vertical-align:top'";
  const k = bon.klant || {};
  const mats = (bon.materialen || []).filter(r => r.aantal > 0);
  return "<div style='font-family:Arial,sans-serif;color:#1f2937;max-width:640px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden'>" +
    "<div style='background:#144734;padding:18px 22px'><img src='" + SVC_LOGO + "' alt='Fonteyn' height='56' style='display:block;height:56px'></div>" +
    "<div style='padding:20px 22px'>" +
    "<h2 style='color:#144734;margin:0 0 4px;font-size:19px'>" + T.titel + "</h2>" +
    "<p style='margin:0 0 16px;color:#6b7280;font-size:13px'>" + e(svcDatumTekst(bon.datum, taal)) + " &middot; " + T.melding + " " + e(bon.its) + (/^ja/i.test(bon.garantie || "") ? " &middot; " + T.garantie : "") + "</p>" +
    "<p style='font-size:14px;line-height:1.5'>" + T.aanhef + " " + e(k.naam || T.klant) + ",<br><br>" + T.intro + "</p>" +
    /* "Uw melding" staat er niet meer op (Kevin, 29 okt 2026): daar staat vaak
       informatie in die voor intern is. */
    "<h3 style='color:#144734;margin:18px 0 6px;font-size:15px'>" + T.gedaan + "</h3><p style='font-size:14px;line-height:1.5;white-space:pre-line'>" + e(bon.gedaan) + "</p>" +
    (mats.length ? "<h3 style='color:#144734;margin:18px 0 6px;font-size:15px'>" + T.mats + "</h3><table style='border-collapse:collapse;width:100%'>" +
      mats.map(r => "<tr><td " + td + " width='56'><b>" + e(String(r.aantal).replace(".", ",")) + "x</b></td><td " + td + ">" + e(r.oms) + "</td></tr>").join("") + "</table>" : "") +
    "<h3 style='color:#144734;margin:18px 0 6px;font-size:15px'>" + T.arbeid + "</h3><p style='font-size:14px'>" + e(String(bon.uren).replace(".", ",")) + " " + T.uur + "</p>" +
    (metHandtekening && bon.handtekeningKlant ? "<h3 style='color:#144734;margin:18px 0 6px;font-size:15px'>" + T.getekend + (bon.klantNaam ? T.door + e(bon.klantNaam) : "") + "</h3><img src='cid:hand-klant' alt='handtekening' width='240' style='display:block;border:1px solid #e5e7eb;border-radius:6px;max-width:240px'>" : "") +
    "<p style='font-size:14px;line-height:1.5;margin-top:20px'>" + T.vraag + "</p>" +
    "<p style='font-size:14px'>" + T.groet + "</p></div></div>";
}
async function svcBonMail(env, wie, b) {
  const db = await svcBonDb(env);
  const bon = await svcBonLees(db, b.id);
  if (!bon) return { ok: false, error: "Deze werkbon is intussen weg." };
  if (!["klaar", "akkoord", "gemaild"].includes(bon.status)) return { ok: false, error: "De monteur moet de werkbon eerst afronden." };
  // De taal van de klant (Duits voor DE en AT), als Duits aan staat.
  const inst = await svcInstellingen(env);
  const mRij = await db.prepare("SELECT json FROM svc_melding WHERE its = ?1").bind(String(bon.its)).first().catch(() => null);
  const taal = inst.duits ? svcTaalVan(svcJson(mRij && mRij.json, { klant: bon.klant })) : "nl";
  if (b.voorbeeld) return { ok: true, html: svcBonHtml(bon, false, taal), naar: (bon.klant || {}).mail || "", taal };
  const adressen = [...new Set(String(b.naar || (bon.klant || {}).mail || "").toLowerCase().split(/[;,\s]+/).filter(Boolean))];
  const fout = adressen.filter(x => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  if (!adressen.length || fout.length) return { ok: false, error: fout.length ? "Dit mailadres klopt nog niet: " + fout.join(", ") : "Vul het mailadres van de klant in." };
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return { ok: false, error: "het mailen is in de worker nog in te richten" };
  const bron = env.MAIL_FROM_FONTEYN || env.MAIL_FROM;
  const adres = (String(bron).match(/<([^>]+)>/) || [])[1] || String(bron);
  const bijlagen = bon.handtekeningKlant ? [{ filename: "handtekening-klant.png", content: bon.handtekeningKlant.split(",")[1], content_id: "hand-klant", content_type: "image/png" }] : [];
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Fonteyn Spa service <" + adres + ">", to: adressen, reply_to: [SVC_BON_ANTWOORD],
      subject: (taal === "de" ? "Arbeitsbericht Service Fonteyn - Meldung " : "Werkbon service Fonteyn - melding ") + bon.its + " - " + String(bon.datum).split("-").reverse().join("-"),
      html: svcBonHtml(bon, true, taal), attachments: bijlagen }) });
  const tekst = await r.text();
  if (!r.ok) return { ok: false, error: "Versturen lukte nog niet (" + r.status + ") " + tekst.slice(0, 120) };
  bon.status = "gemaild"; bon.gemaild = { naar: adressen.join(", "), ts: new Date().toISOString(), door: wie };
  if (!bon.akkoordDoor) { bon.akkoordDoor = wie; bon.akkoordTs = bon.gemaild.ts; }
  await svcBonSchrijf(db, bon);
  await svcLog(db, bon.its, wie, "werkbon gemaild naar " + adressen.join(", "));
  return { ok: true, naar: adressen.join(", ") };
}
/* Kilometers van Fonteyn naar de klant, enkele reis. OSRM (gratis), met de
   rijtijd_cache van Planning; lukt dat niet, dan hemelsbreed x 1,3. */
async function svcKmEnkel(env, H, geo) {
  if (!geo) return null;
  const thuis = await svcThuis(env, H);
  const sleutel = thuis[1].toFixed(4) + "," + thuis[0].toFixed(4) + ";" + geo[1].toFixed(4) + "," + geo[0].toFixed(4);
  const db = env.ACTIVITEIT;
  let res = await db.prepare("SELECT km FROM rijtijd_cache WHERE sleutel = ?1").bind(sleutel).first().catch(() => null);
  if (!res) {
    const o = await fetch("https://router.project-osrm.org/route/v1/driving/" + sleutel + "?overview=false", { headers: { "User-Agent": "Fonteyn-Dashboard/1.0" } })
      .then(x => x.ok ? x.json() : null).catch(() => null);
    const route = o && o.routes && o.routes[0];
    if (route) {
      res = { km: Math.round(route.distance / 1000), min: Math.round(route.duration / 60) };
      await db.prepare("INSERT OR REPLACE INTO rijtijd_cache (sleutel, min, km, ts) VALUES (?1, ?2, ?3, ?4)").bind(sleutel, res.min, res.km, Date.now()).run().catch(() => {});
    }
  }
  return res ? Number(res.km) : Math.round(svcKm(thuis, geo) * 1.3);
}
/* Wat er op de factuur komt; ook als voorbeeld voor de knop.
   Kevin (27 okt 2026): alleen een factuur in Logic4, geen order, en nooit
   prijzen van € 0. De prijzen komen uit Logic4 (prijs voor deze debiteur,
   staffel op aantal); op de werkbon voor de klant blijven ze weg.
   Het adres en de kilometers zijn in het venster aan te passen: x.adres
   zet het adres van de melding goed, x.km zet de kilometers met de hand. */
async function svcPrijs(env, H, token, code, debiteur, aantal) {
  const r = await fetch("https://api.logic4server.nl/v3/Products/GetPriceInformationForProduct", { method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ ProductCode: String(code), DebtorId: Number(debiteur) || null }) });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const st = (j && Array.isArray(j.ShiftPrices) ? j.ShiftPrices : []).filter(x => Number(x.Qty || 1) <= Math.max(1, Number(aantal) || 1)).sort((a, b) => Number(b.Qty || 1) - Number(a.Qty || 1));
  const p = st[0] || (j && j.ShiftPrices && j.ShiftPrices[0]);
  const excl = p ? Number(p.SellPriceExcl || p.SellPriceGrossExcl || 0) : 0;
  return excl > 0 ? Math.round(excl * 10000) / 10000 : null;
}
async function svcFactuurPlan(env, H, bon, betaal, x) {
  x = x || {};
  const db = await svcBonDb(env);
  const rij = await db.prepare("SELECT json FROM svc_melding WHERE its = ?1").bind(String(bon.its)).first();
  const m = svcJson((rij || {}).json, {});
  // Nieuw adres uit het venster: bij de melding bewaren en opnieuw opzoeken.
  if (x.adres && rij && m.klant && String(x.adres).trim() && String(x.adres).trim() !== m.klant.adres) {
    m.klant.adres = String(x.adres).trim().slice(0, 200);
    m.geo = await svcGeo(env, H, m.klant.adres).catch(() => null);
    await db.prepare("UPDATE svc_melding SET json = ?2 WHERE its = ?1").bind(String(bon.its), JSON.stringify(m)).run();
    if (bon.klant) { bon.klant.adres = m.klant.adres; await svcBonSchrijf(db, bon); }
  }
  if (!m.geo && m.klant && m.klant.adres) m.geo = await svcGeo(env, H, m.klant.adres).catch(() => null);
  const mont = SVC_MONTEUR.find(y => svcMonteurGelijk(y.naam, bon.monteur));
  const handKm = x.km !== undefined && x.km !== null && x.km !== "" && isFinite(Number(x.km)) && Number(x.km) >= 0;
  const km = handKm ? Math.round(Number(x.km)) : (m.geo ? await svcKmEnkel(env, H, m.geo) : null);
  const debiteur = (bon.klant && bon.klant.debiteur) || (m.klant && m.klant.debiteur) || null;
  const regels = (bon.materialen || []).filter(r => r.code && r.aantal > 0).map(r => ({ code: r.code, oms: r.oms, aantal: r.aantal }));
  if (km > 0) regels.push({ code: SVC_ART_KM, oms: "Voorrijkosten per km (enkele reis)", aantal: km });
  if (bon.uren > 0) regels.push({ code: SVC_ART_UUR, oms: "Arbeidskosten (uren)", aantal: bon.uren });
  const garantie = /^ja/i.test(bon.garantie || m.garantie || "");
  const problemen = [];
  if (!debiteur) problemen.push("Bij de melding hoort nog een debiteur uit Logic4.");
  if (!mont) problemen.push("Voor monteur \"" + (bon.monteur || "?") + "\" ontbreekt de koppeling met zijn Logic4-gebruiker.");
  if (km === null) problemen.push("Het adres van de klant is nog onbekend. Vul hierboven het adres of de kilometers in.");
  // Prijzen uit Logic4; een regel zonder prijs gaat er niet in (nooit € 0).
  if (debiteur && regels.length) {
    const token = await H.l4Token(env);
    for (const r of regels) {
      r.prijs = await svcPrijs(env, H, token, r.code, debiteur, r.aantal).catch(() => null);
      if (!r.prijs) problemen.push("Voor artikel " + r.code + " (" + r.oms + ") staat nog geen verkoopprijs in Logic4.");
    }
  }
  return { debiteur, klant: (bon.klant || {}).naam || "", adres: (m.klant && m.klant.adres) || (bon.klant || {}).adres || "", monteur: mont ? mont.naam : bon.monteur, userId: mont ? mont.l4 : null,
    verzend: { id: SVC_VERZEND_SERVICEMONTEUR, naam: "Fonteyn Servicemonteur" },
    betaal: Number(betaal) === SVC_BETAAL_GARANTIE ? { id: SVC_BETAAL_GARANTIE, naam: "Garantie" } : { id: SVC_BETAAL_REKENING14, naam: "Rekening 14 dagen" },
    datum: bon.datum, km, kmHand: handKm, regels, garantie, problemen,
    totaalExcl: Math.round(regels.reduce((n, r) => n + (r.prijs || 0) * r.aantal, 0) * 100) / 100 };
}
async function svcFactuur(env, H, wie, b) {
  const db = await svcBonDb(env);
  const bon = await svcBonLees(db, b.id);
  if (!bon) return { ok: false, error: "Deze werkbon is intussen weg." };
  if (bon.factuur && bon.factuur.factuurId) return { ok: false, error: "Hiervoor is al factuur " + bon.factuur.factuurId + " gemaakt in Logic4." };
  if (bon.factuur && bon.factuur.bezig && Date.now() - Date.parse(bon.factuur.ts) < 120000) return { ok: false, error: "De factuur wordt al gemaakt. Wacht even en kijk dan opnieuw." };
  if (bon.status === "concept") return { ok: false, error: "De monteur moet de werkbon eerst afronden, of geef hem eerst akkoord." };
  const plan = await svcFactuurPlan(env, H, bon, b.betaal, { adres: b.adres, km: b.km });
  if (b.voorbeeld) return { ok: true, plan };
  if (plan.problemen.length) return { ok: false, error: plan.problemen.join(" ") };
  const token = await H.l4Token(env);
  const post = async (pad, body) => {
    const r = await fetch("https://api.logic4server.nl" + pad, { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    if (!r.ok) throw new Error(pad.split("/").pop() + " HTTP " + r.status + ": " + ((j && (j.detail || j.title)) || t.slice(0, 200)));
    return j === null ? t : j;
  };
  const nummer = v => (typeof v === "number" && v) || (v && typeof v === "object" && (v.Id || (v.Value && v.Value.Id) || v.Value)) || Number(v) || null;
  /* Eerst vastleggen dat we bezig zijn, zodat een tweede klik geen tweede
     factuur maakt. Een oude order van vóór 27 okt (alleen order, prijzen 0)
     onthouden we, zodat kantoor die in Logic4 kan weghalen. */
  const oudeOrder = bon.factuur && bon.factuur.orderId ? bon.factuur.orderId : null;
  bon.factuur = { bezig: true, door: wie, ts: new Date().toISOString(), oudeOrder };
  await svcBonSchrijf(db, bon);
  const kop = {
    DebtorId: Number(plan.debiteur),
    CreationDate: new Date().toISOString().slice(0, 19),
    UserId: plan.userId,
    ShippingMethod: { Id: plan.verzend.id },
    PaymentMethod: { Id: plan.betaal.id },
    DeliveryDate: plan.datum + "T00:00:00",
    Reference: "ITS " + bon.its,
    Notes: ("Servicebezoek " + plan.datum.split("-").reverse().join("-") + " door " + plan.monteur + ".\n" + String(bon.gedaan || "")).slice(0, 2000),
    OrderRows: plan.regels.map(r => ({ ProductCode: r.code, Description: r.oms, Qty: r.aantal, NettPrice: r.prijs, GrossPrice: r.prijs })),
  };
  let factuurId = null;
  try {
    /* Kevin (29 okt 2026): de factuur komt op status Verkooporder en wordt
       NIET verwerkt. Verwerken doet de planning zelf in Logic4, zodat de
       factuur tot dan nog aan te passen is. */
    factuurId = nummer(await post("/v3/Orders/AddUpdateInvoice", Object.assign({ OrderStatus: { Id: SVC_FACTUUR_STATUS } }, kop)));
    if (!factuurId) throw new Error("Logic4 gaf geen factuurnummer terug");
    bon.factuur = { factuurId, door: wie, ts: new Date().toISOString(), oudeOrder, totaalExcl: plan.totaalExcl, km: plan.km, verwerkt: false };
    await svcBonSchrijf(db, bon);
    await svcLog(db, bon.its, wie, "factuur " + factuurId + " klaargezet in Logic4 (€ " + plan.totaalExcl.toFixed(2) + " excl. btw), nog te verwerken in Logic4");
    return { ok: true, factuurId, totaalExcl: plan.totaalExcl, oudeOrder };
  } catch (e) {
    const fout = String(e.message || e).slice(0, 300);
    bon.factuur = factuurId ? Object.assign({}, bon.factuur, { fout }) : (oudeOrder ? { orderId: oudeOrder, fout } : null);
    await svcBonSchrijf(db, bon);
    return { ok: false, error: factuurId ? "Factuur " + factuurId + " staat in Logic4; het opslaan in het Dashboard lukte nog niet: " + fout : fout };
  }
}

/* ── De ingang vanuit worker.js ─────────────────────────────────────────── */
export async function svcHandle(request, env, url, H) {
  _svcH = H;
  const p = url.pathname;
  // De klantpagina's: zonder sleutel, het token in de link is de sleutel.
  if (p === "/service/antwoord") {
    if (request.method === "GET") return svcAntwoordGet(env, url);
    if (request.method === "POST") return svcAntwoordPost(env, request, H);
    return H.reply(405, { ok: false });
  }
  if (!env.SHARED_SECRET || (request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET) return H.reply(401, { ok: false });
  const wie = String(request.headers.get("X-Fonteyn-User") || "").toLowerCase().slice(0, 80);
  const planner = await H.toegangMag(env, "service-planning", wie);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  /* De monteurs: alleen hun eigen route, hun werkbonnen en artikelen zoeken. */
  if (["/service/mijn", "/service/bon", "/service/artikel", "/service/melding/vers"].includes(p)) {
    if (!planner && !(await H.toegangMag(env, "service-monteurs", wie))) return H.reply(403, { ok: false, error: "Deze tegel is voor de servicemonteurs." });
    try {
      if (p === "/service/mijn" && request.method === "GET") return H.reply(200, await svcMijn(env, wie, planner, url));
      if (p === "/service/melding/vers" && request.method === "GET") return H.reply(200, await svcMeldingVers(env, H, wie, planner, url.searchParams.get("its")));
      if (p === "/service/bon" && request.method === "GET") return H.reply(200, await svcBonGet(env, wie, planner, url.searchParams.get("id")));
      if (p === "/service/bon" && request.method === "POST") return H.reply(200, await svcBonPost(env, wie, planner, body));
      if (p === "/service/artikel" && request.method === "GET") return H.reply(200, await svcArtikel(env, H, url.searchParams.get("q")));
    } catch (e) { return H.reply(500, { ok: false, error: String(e && e.message || e) }); }
    return H.reply(404, { ok: false });
  }
  if (!planner) return H.reply(403, { ok: false, error: "Deze tegel is voor de planning van Service." });
  try {
    if (p === "/service/bonnen" && request.method === "GET") return H.reply(200, Object.assign(await svcBonnen(env, url.searchParams.get("weg") === "1"), { magWeg: await H.toegangMag(env, "service-bon-weg", wie) }));
    /* Een opleverbon weghalen: alleen Gerwin en Kevin (Kevin, 27 okt 2026).
       Niets gaat echt weg: hij krijgt status "weg" en kan terug. */
    if (p === "/service/bon/weg" && request.method === "POST") {
      if (!(await H.toegangMag(env, "service-bon-weg", wie))) return H.reply(403, { ok: false, error: "Alleen Gerwin en Kevin kunnen een opleverbon weghalen." });
      return H.reply(200, await svcBonWeg(env, wie, body));
    }
    if (p === "/service/bon/kantoor" && request.method === "POST") return H.reply(200, await svcBonKantoor(env, wie, body));
    if (p === "/service/bon/mail" && request.method === "POST") return H.reply(200, await svcBonMail(env, wie, body));
    if (p === "/service/bon/handtekening" && request.method === "GET") {
      const bon = await svcBonLees(await svcBonDb(env), url.searchParams.get("id"));
      return H.reply(200, { ok: true, hand: bon ? bon.handtekeningKlant || "" : "" });
    }
    if (p === "/service/bon/factuur" && request.method === "POST") return H.reply(200, await svcFactuur(env, H, wie, body));
    if (p === "/service/overzicht" && request.method === "GET") return H.reply(200, await svcOverzicht(env, url));
    if (p === "/service/melding/zoek" && request.method === "POST") return H.reply(200, await svcItsZoek(env, H, body.its));
    if (p === "/service/melding" && request.method === "POST") return H.reply(200, await svcMeldingBewaar(env, H, wie, body));
    if (p === "/service/melding/weg" && request.method === "POST") {
      const db = await svcDb(env);
      const its = String(body.its || "").replace(/\D/g, "");
      const n = await db.prepare("SELECT COUNT(*) AS n FROM svc_afspraak WHERE its = ?1 AND status IN ('voorstel','akkoord')").bind(its).first();
      if (n && n.n) return H.reply(200, { ok: false, error: "Deze melding staat ingepland. Haal hem eerst uit de route." });
      await db.prepare("UPDATE svc_melding SET status = 'vervallen', ts = ?2 WHERE its = ?1").bind(its, Date.now()).run();
      await svcLog(db, its, wie, "uit de lijst gehaald" + (body.reden ? ": " + String(body.reden).slice(0, 200) : ""));
      return H.reply(200, { ok: true });
    }
    if (p === "/service/melding/log" && request.method === "GET") {
      const db = await svcDb(env);
      const r = await db.prepare("SELECT ts, wie, wat FROM svc_log WHERE its = ?1 ORDER BY id DESC LIMIT 60").bind(String(url.searchParams.get("its") || "")).all();
      return H.reply(200, { ok: true, log: r.results || [] });
    }
    if (p === "/service/route" && request.method === "POST") return H.reply(200, await svcRoute(env, wie, body));
    if (p === "/service/plannen" && request.method === "POST")
      return H.reply(200, await svcPlannen(env, H, wie, { voorbeeld: !!body.voorbeeld, its: Array.isArray(body.its) ? body.its.map(x => String(x).replace(/\D/g, "")) : null }));
    if (p === "/service/ziek" && request.method === "POST") return H.reply(200, await svcZiek(env, H, wie, body));
    if (p === "/service/afspraak" && request.method === "POST") return H.reply(200, await svcAfspraakActie(env, H, wie, body));
    if (p === "/service/afspraak/nieuw" && request.method === "POST") return H.reply(200, await svcHandInplannen(env, H, wie, body));
    if (p === "/service/zoek" && request.method === "GET") return H.reply(200, await svcZoek(env, url.searchParams.get("q")));
    if (p === "/service/mail/voorbeeld" && request.method === "GET") {
      const soort = ["voorstel", "herinnering", "ziek"].includes(url.searchParams.get("soort")) ? url.searchParams.get("soort") : "voorstel";
      const werkdag = (iso) => { while ([0, 6].includes(new Date(iso + "T12:00:00Z").getUTCDay())) iso = svcPlus(iso, 1); return iso; };
      const de = url.searchParams.get("taal") === "de";
      const d = { naam: de ? "Familie Schmidt" : "familie Jansen", datum: werkdag(svcPlus(svcVandaag(), 9)), dagdeel: 2, its: "48211", oudeDatum: werkdag(svcPlus(svcVandaag(), 3)), taal: de ? "de" : "nl" };
      return H.reply(200, { ok: true, onderwerp: svcOnderwerp(soort, d), html: svcMailHtml(soort, d, "#voorbeeld?t=x", true) });
    }
    if (p === "/service/instellingen" && request.method === "POST") {
      // Mailen aan of uit is aan de beheerlaag.
      if (!(await H.toegangMag(env, "administratie-proef", wie))) return H.reply(403, { ok: false, error: "Alleen de beheerlaag zet het mailen aan of uit." });
      const inst = await svcInstellingen(env);
      if (body.mailAan !== undefined) inst.mailAan = !!body.mailAan;
      if (body.duits !== undefined) inst.duits = !!body.duits;
      if (body.proefAdres !== undefined) inst.proefAdres = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.proefAdres || "").trim()) ? String(body.proefAdres).trim().toLowerCase() : "";
      await env.FONTEYN_DATA.put(SVC_INSTEL, JSON.stringify(inst));
      return H.reply(200, { ok: true, instellingen: inst });
    }
  } catch (e) {
    return H.reply(500, { ok: false, error: String(e && e.message || e) });
  }
  return H.reply(404, { ok: false, error: "onbekend" });
}
export { svcRonde };
