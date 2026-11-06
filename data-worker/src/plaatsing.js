/* ═════════════════════════════════════════════════════════════════
   PLAATSING - foto's bij een klus en de verklaring huis en tuin
   ═════════════════════════════════════════════════════════════════
   Kevin, document "aanpassingen dashboard 03-11-2026":

   1. Foto's bij een klus. De planning zet in Planning Plaatsing foto's bij
      een afspraak (bijvoorbeeld de plek in de tuin of de toegang); de
      monteurs zien ze in Mijn route Plaatsing. Net als bij de bakwagen
      verkleint de tegel ze eerst tot een JPEG van hooguit 1600 pixels. Ze
      staan in het Archief als plaatsing/foto/<id>, de lijst in D1.

   2. De verklaring huis en tuin. Een knop boven alle routes in Mijn route
      Plaatsing: ordernummer invullen, de klantgegevens komen uit Logic4, de
      klant tekent dat hij zelf verantwoordelijk is voor eventuele schade aan
      huis of tuin bij de plaatsing. Bij Afronden krijgt de klant een mail,
      met spaplanning@fonteyn.nl in de cc. De verklaring blijft bewaard in D1
      en is terug te vinden op ordernummer (Mijn route en Planning).

   Het mailen naar klanten staat UIT tot Gerrit het voorbeeld heeft
   goedgekeurd (KV plaatsing-instellingen.mailAan, alleen de beheerlaag zet
   hem aan). Zolang hij uit staat wordt de verklaring wel bewaard en staat de
   mail klaar; de planning kan hem later alsnog sturen.
   ═════════════════════════════════════════════════════════════════ */

const PL_INSTEL = "plaatsing-instellingen";
const PL_CC = "spaplanning@fonteyn.nl";
const PL_LOGO = "https://mijn.fonteyn.nl/beeld/fonteyn-logo.png";
/* De tekst die de klant tekent. Positief en met "je" (zie memory
   klanten-je-fonteyn-logo); Kevin: "dat de klant verantwoordelijk is voor
   de schades aan het huis of in de tuin". */
const PL_VERKLARING = [
  "Bij de plaatsing werken we zo zorgvuldig mogelijk. Soms vraagt de weg naar de plek extra ruimte, bijvoorbeeld over de oprit, het gazon, de bestrating of langs de gevel.",
  "Met je handtekening geef je aan dat je dit weet en dat je zelf verantwoordelijk bent voor eventuele schade aan je huis of in je tuin die bij de plaatsing ontstaat.",
];

let _plTabel = false, _H = null;
async function plDb(env) {
  const db = env.ACTIVITEIT;
  if (!_plTabel) {
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS plaatsing_foto (id TEXT PRIMARY KEY, afspraak TEXT, door TEXT, ts INTEGER, grootte INTEGER, weg INTEGER DEFAULT 0)"),
      db.prepare("CREATE INDEX IF NOT EXISTS plaatsing_foto_afspraak ON plaatsing_foto (afspraak)"),
      db.prepare("CREATE TABLE IF NOT EXISTS plaatsing_schade (id TEXT PRIMARY KEY, ordernr TEXT, json TEXT, hand TEXT, door TEXT, ts INTEGER, gemaild TEXT)"),
      db.prepare("CREATE INDEX IF NOT EXISTS plaatsing_schade_order ON plaatsing_schade (ordernr)"),
      db.prepare("CREATE INDEX IF NOT EXISTS plaatsing_schade_ts ON plaatsing_schade (ts)"),
    ]);
    _plTabel = true;
  }
  return db;
}
async function plInstellingen(env) {
  return (await env.FONTEYN_DATA.get(PL_INSTEL, { type: "json" })) || { mailAan: false, proefAdres: "" };
}
const plId = () => Date.now().toString(36) + crypto.randomUUID().replace(/-/g, "").slice(0, 10);
const plE = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plMail = (x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(x || "").trim());

/* ── foto's bij een klus ── */
async function plFotoZet(env, db, wie, b) {
  const afspraak = String(b.afspraak || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  if (!afspraak) return { ok: false, error: "Bewaar eerst de afspraak." };
  const m = String(b.data || "").match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { ok: false, error: "Alleen een foto (JPEG)." };
  if (m[1].length > 3500000) return { ok: false, error: "De foto is te groot." };
  const bytes = Uint8Array.from(atob(m[1]), c => c.charCodeAt(0));
  const id = plId();
  await _H.bestandZet(env, "plaatsing/foto/" + id, bytes.buffer);
  await db.prepare("INSERT INTO plaatsing_foto (id, afspraak, door, ts, grootte, weg) VALUES (?1, ?2, ?3, ?4, ?5, 0)")
    .bind(id, afspraak, wie, Date.now(), bytes.length).run();
  return { ok: true, id, ts: Date.now() };
}
async function plFotoLijst(db, ids) {
  ids = [...new Set(String(ids || "").split(",").map(x => x.replace(/[^A-Za-z0-9_-]/g, "")).filter(Boolean))].slice(0, 200);
  const uit = {};
  for (let i = 0; i < ids.length; i += 90) {
    const deel = ids.slice(i, i + 90);
    const rs = await db.prepare("SELECT id, afspraak, door, ts FROM plaatsing_foto WHERE afspraak IN (" + deel.map((_, k) => "?" + (k + 1)).join(",") + ") AND weg = 0 ORDER BY ts").bind(...deel).all();
    for (const f of rs.results || []) (uit[f.afspraak] = uit[f.afspraak] || []).push({ id: f.id, door: f.door, ts: f.ts });
  }
  return uit;
}

/* ── de verklaring huis en tuin ── */
async function plKlantVanOrder(env, nr) {
  const l4 = await _H.bwLogic4(env);
  const o = (await l4("/v3/Orders/GetOrders", { Id: Number(nr), TakeRecords: 1 }))[0];
  if (!o) return null;
  const k = _H.bwOrderKort(o, null);
  return { naam: k.klant, bedrijf: k.bedrijf, adres: k.adres, postcode: k.postcode, plaats: k.plaats, mail: k.mail, telefoon: k.telefoon, debiteur: k.debiteur };
}
function plVoornaam(x) {
  const w = String(x || "").trim().split(/\s+/)[0] || "";
  return w.length > 1 ? w : "";
}
/* De mail aan de klant, ook gebruikt voor het voorbeeld en om terug te
   kijken. hand = "cid:hand" in de mail, de PNG zelf bij bekijken. */
function plVerklaringHtml(v, hand) {
  const k = v.klant || {};
  const datum = new Date(Number(v.ts) || Date.now());
  const dag = datum.toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const tijd = datum.toLocaleTimeString("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" });
  const aanhef = plVoornaam(v.tekenaar) || plVoornaam(k.naam);
  const adres = [k.adres, [k.postcode, k.plaats].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return "<div style='font-family:Arial,sans-serif;color:#1f2937;max-width:640px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden'>" +
    "<div style='background:#144734;padding:18px 22px'><img src='" + PL_LOGO + "' alt='Fonteyn' height='56' style='display:block;height:56px'></div>" +
    "<div style='padding:20px 22px'>" +
    "<p style='font-size:14px;line-height:1.5;margin:0 0 14px'>Beste " + plE(aanhef || "klant") + ",</p>" +
    "<p style='font-size:14px;line-height:1.5'>Bedankt voor je handtekening. Hieronder vind je de verklaring die je bij de plaatsing hebt getekend. Bewaar deze mail goed bij je aankoopgegevens.</p>" +
    "<h2 style='color:#144734;margin:20px 0 4px;font-size:18px'>Verklaring huis en tuin</h2>" +
    "<p style='margin:0 0 14px;color:#6b7280;font-size:13px'>" + plE(dag) + " om " + plE(tijd) + (v.ordernr ? " &middot; order " + plE(v.ordernr) : "") + "</p>" +
    "<table style='border-collapse:collapse;font-size:13px;margin:0 0 12px'>" +
      [["Naam", k.naam], ["Adres", adres], ["Order", v.ordernr]].filter(r => r[1]).map(r =>
        "<tr><td style='padding:3px 14px 3px 0;color:#6b7280'>" + r[0] + "</td><td style='padding:3px 0'>" + plE(r[1]) + "</td></tr>").join("") + "</table>" +
    PL_VERKLARING.map(t => "<p style='font-size:14px;line-height:1.5'>" + plE(t) + "</p>").join("") +
    "<div style='margin:16px 0 4px;color:#6b7280;font-size:12px'>Getekend door " + plE(v.tekenaar || k.naam || "") + "</div>" +
    (hand ? "<img src='" + plE(hand) + "' alt='handtekening' width='300' style='display:block;border:1px solid #e5e7eb;border-radius:6px;max-width:300px;height:auto'>" : "") +
    "<p style='font-size:14px;line-height:1.5;margin-top:20px'>Heb je een vraag? Beantwoord dan gewoon deze mail.</p>" +
    "<p style='font-size:14px'>Met vriendelijke groet,<br>Fonteyn Spa planning</p></div></div>";
}
async function plSchadeMail(env, db, v) {
  const inst = await plInstellingen(env);
  if (!inst.mailAan) return { ok: true, wacht: true };
  const naar = inst.proefAdres ? [inst.proefAdres] : [String((v.klant || {}).mail || "").trim().toLowerCase()].filter(plMail);
  if (!naar.length) return { ok: false, error: "Er staat nog geen mailadres bij de klant." };
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return { ok: false, error: "het mailen is in de worker nog in te richten" };
  const bron = env.MAIL_FROM_FONTEYN || env.MAIL_FROM;
  const adres = (String(bron).match(/<([^>]+)>/) || [])[1] || String(bron);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Fonteyn Spa planning <" + adres + ">", to: naar, cc: inst.proefAdres ? [] : [PL_CC], reply_to: [PL_CC],
      subject: "Je verklaring bij de plaatsing" + (v.ordernr ? " - order " + v.ordernr : ""),
      html: plVerklaringHtml(v, "cid:hand"),
      attachments: v.hand ? [{ filename: "handtekening.png", content: String(v.hand).split(",")[1], content_id: "hand", content_type: "image/png" }] : [] }),
  });
  const tekst = await r.text();
  if (!r.ok) return { ok: false, error: "Versturen vraagt nog een poging (" + r.status + ") " + tekst.slice(0, 120) };
  const gm = { naar: naar.join(", "), cc: inst.proefAdres ? "" : PL_CC, ts: Date.now(), proef: !!inst.proefAdres };
  await db.prepare("UPDATE plaatsing_schade SET gemaild = ?1 WHERE id = ?2").bind(JSON.stringify(gm), v.id).run();
  return { ok: true, gemaild: gm };
}
function plRij(x, metHand) {
  let j = {}; try { j = JSON.parse(x.json || "{}"); } catch (e) {}
  let gm = null; try { gm = x.gemaild ? JSON.parse(x.gemaild) : null; } catch (e) {}
  const v = { id: x.id, ordernr: x.ordernr, klant: j.klant || {}, tekenaar: j.tekenaar || "", door: x.door, ts: x.ts, gemaild: gm };
  if (metHand) v.hand = x.hand || "";
  return v;
}

/* GET/POST /planning/foto... en /planning/schade... (teamsleutel is al
   gecontroleerd in worker.js). */
export async function plHandle(request, env, url, H) {
  _H = H;
  const reply = H.reply;
  const wie = String(request.headers.get("X-Fonteyn-User") || "").toLowerCase().slice(0, 80);
  const p = url.pathname, m = request.method;
  const db = await plDb(env);
  let body = {};
  if (m === "POST") { try { body = await request.json(); } catch (e) { body = {}; } }
  const planner = async () => await H.toegangMag(env, "planning-bewerk", wie);
  const monteur = async () => (await H.toegangMag(env, "planning", wie)) || (await planner());

  if (p === "/planning/foto/lijst" && m === "GET") return reply(200, { ok: true, fotos: await plFotoLijst(db, url.searchParams.get("afspraken")) });
  if (p === "/planning/foto" && m === "GET") {
    const id = String(url.searchParams.get("id") || "").replace(/[^a-z0-9]/g, "");
    const x = await db.prepare("SELECT id FROM plaatsing_foto WHERE id = ?1 AND weg = 0").bind(id).first();
    if (!x) return reply(404, { ok: false });
    const buf = await H.bestandLees(env, "plaatsing/foto/" + id);
    if (!buf) return reply(404, { ok: false });
    return new Response(buf, { headers: { ...H.corsHeaders, "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  }
  if (p === "/planning/foto" && m === "POST") {
    if (!(await planner())) return reply(403, { ok: false, error: "Foto's zet de planning erbij." });
    return reply(200, await plFotoZet(env, db, wie, body));
  }
  if (p === "/planning/foto/weg" && m === "POST") {
    if (!(await planner())) return reply(403, { ok: false, error: "Foto's haalt de planning weg." });
    const id = String(body.id || "").replace(/[^a-z0-9]/g, "");
    // Blijft bewaard (weg = 1), net als bij de bakwagen.
    await db.prepare("UPDATE plaatsing_foto SET weg = 1 WHERE id = ?1").bind(id).run();
    return reply(200, { ok: true });
  }

  if (p === "/planning/schade/klant" && m === "GET") {
    if (!(await monteur())) return reply(403, { ok: false, error: "Deze knop is voor de monteurs en de planning." });
    const nr = String(url.searchParams.get("order") || "").replace(/\D/g, "").slice(0, 12);
    if (!nr) return reply(400, { ok: false, error: "Vul een ordernummer in." });
    const klant = await plKlantVanOrder(env, nr).catch(e => ({ fout: String(e.message || e) }));
    if (!klant) return reply(200, { ok: false, error: "Order " + nr + " staat nog niet in Logic4. Kijk het nummer even na." });
    if (klant.fout) return reply(502, { ok: false, error: "Logic4 vraagt nog een poging: " + klant.fout });
    const eerder = ((await db.prepare("SELECT id, ordernr, json, door, ts, gemaild FROM plaatsing_schade WHERE ordernr = ?1 ORDER BY ts DESC LIMIT 10").bind(nr).all()).results || []).map(x => plRij(x));
    return reply(200, { ok: true, ordernr: nr, klant, eerder, verklaring: PL_VERKLARING });
  }
  if (p === "/planning/schade/lijst" && m === "GET") {
    if (!(await monteur())) return reply(403, { ok: false });
    const nr = String(url.searchParams.get("order") || "").replace(/\D/g, "").slice(0, 12);
    const rs = nr ? await db.prepare("SELECT id, ordernr, json, door, ts, gemaild FROM plaatsing_schade WHERE ordernr = ?1 ORDER BY ts DESC LIMIT 20").bind(nr).all()
                  : await db.prepare("SELECT id, ordernr, json, door, ts, gemaild FROM plaatsing_schade ORDER BY ts DESC LIMIT 200").all();
    return reply(200, { ok: true, lijst: (rs.results || []).map(x => plRij(x)) });
  }
  if (p === "/planning/schade/bekijk" && m === "GET") {
    if (!(await monteur())) return reply(403, { ok: false });
    const x = await db.prepare("SELECT * FROM plaatsing_schade WHERE id = ?1").bind(String(url.searchParams.get("id") || "").replace(/[^a-z0-9]/g, "")).first();
    if (!x) return reply(404, { ok: false, error: "Deze verklaring is er niet." });
    const v = plRij(x, true);
    return reply(200, { ok: true, verklaring: Object.assign({}, v, { hand: undefined }), html: plVerklaringHtml(v, v.hand) });
  }
  if (p === "/planning/schade/voorbeeld" && m === "GET") {
    const v = { ordernr: "3524000", tekenaar: "Sanne de Vries", ts: Date.now(),
      klant: { naam: "Sanne de Vries", adres: "Meervelderweg 52", postcode: "3888 NK", plaats: "Uddel", mail: "sanne@voorbeeld.nl" } };
    return reply(200, { ok: true, html: plVerklaringHtml(v, ""), mailAan: (await plInstellingen(env)).mailAan });
  }
  if (p === "/planning/schade" && m === "POST") {
    if (!(await monteur())) return reply(403, { ok: false, error: "Deze knop is voor de monteurs en de planning." });
    const nr = String(body.ordernr || "").replace(/\D/g, "").slice(0, 12);
    const s = (x, n) => String(x == null ? "" : x).trim().slice(0, n);
    const k = body.klant || {};
    const klant = { naam: s(k.naam, 120), bedrijf: s(k.bedrijf, 120), adres: s(k.adres, 160), postcode: s(k.postcode, 12), plaats: s(k.plaats, 80), mail: s(k.mail, 160).toLowerCase(), telefoon: s(k.telefoon, 30), debiteur: s(k.debiteur, 20) };
    const hand = String(body.hand || "");
    if (!nr) return reply(400, { ok: false, error: "Vul het ordernummer in." });
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(hand) || hand.length > 400000) return reply(400, { ok: false, error: "Laat de klant eerst tekenen." });
    if (klant.mail && !plMail(klant.mail)) return reply(400, { ok: false, error: "Het mailadres klopt nog niet helemaal." });
    const v = { id: plId(), ordernr: nr, klant, tekenaar: s(body.tekenaar, 80) || klant.naam, hand, door: wie, ts: Date.now() };
    await db.prepare("INSERT INTO plaatsing_schade (id, ordernr, json, hand, door, ts, gemaild) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)")
      .bind(v.id, nr, JSON.stringify({ klant, tekenaar: v.tekenaar, tekst: PL_VERKLARING }), hand, wie, v.ts).run();
    const mail = await plSchadeMail(env, db, v).catch(e => ({ ok: false, error: String(e.message || e) }));
    return reply(200, { ok: true, id: v.id, ts: v.ts, mail });
  }
  if (p === "/planning/schade/mail" && m === "POST") {
    if (!(await planner())) return reply(403, { ok: false, error: "Opnieuw mailen doet de planning." });
    const x = await db.prepare("SELECT * FROM plaatsing_schade WHERE id = ?1").bind(String(body.id || "").replace(/[^a-z0-9]/g, "")).first();
    if (!x) return reply(404, { ok: false, error: "Deze verklaring is er niet." });
    const v = plRij(x, true);
    if (body.mail !== undefined) {
      if (!plMail(body.mail)) return reply(400, { ok: false, error: "Vul een geldig mailadres in." });
      v.klant.mail = String(body.mail).trim().toLowerCase();
      let j = {}; try { j = JSON.parse(x.json || "{}"); } catch (e) {}
      j.klant = v.klant;
      await db.prepare("UPDATE plaatsing_schade SET json = ?1 WHERE id = ?2").bind(JSON.stringify(j), v.id).run();
    }
    return reply(200, await plSchadeMail(env, db, v));
  }
  if (p === "/planning/schade/instellingen") {
    if (m === "GET") return reply(200, { ok: true, instellingen: await plInstellingen(env) });
    if (!(await H.toegangMag(env, "administratie-proef", wie))) return reply(403, { ok: false, error: "Alleen de beheerlaag zet het mailen aan of uit." });
    const inst = await plInstellingen(env);
    if (body.mailAan !== undefined) inst.mailAan = !!body.mailAan;
    if (body.proefAdres !== undefined) inst.proefAdres = plMail(body.proefAdres) ? String(body.proefAdres).trim().toLowerCase() : "";
    await env.FONTEYN_DATA.put(PL_INSTEL, JSON.stringify(inst));
    return reply(200, { ok: true, instellingen: inst });
  }
  return reply(404, { ok: false, error: "onbekende route" });
}
