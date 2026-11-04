/* De pagina's voor klanten van Fonteyn op een eigen adres
 * ═══════════════════════════════════════════════════════════════════════
 * Gerrit (4 nov 2026): de link in "Bevestig je gegevens" had
 * fonteyn-data-store.g-mulder.workers.dev als adres: "er staat g.mulder in
 * en dat wil ik absoluut niet. Het moet iets van Fonteyn zelf worden."
 *
 * Zelfde opzet als partner-proxy (zie daar waarom een Pages-project): dit
 * project geeft alleen door, de pagina's zelf draaien in data-worker. Het
 * fonteyn.nl-subdomein komt erbij met één CNAME naar fonteyn.pages.dev.
 *
 * Anders dan bij het partnerportaal gaat hier alleen door wat een klant
 * hoort te zien. De rest van de worker (de tegels, de sleutels) is via dit
 * adres onbereikbaar; de voordeur stuurt door naar fonteyn.nl.
 */
const WORKER = "https://fonteyn-data-store.g-mulder.workers.dev";
const KLANT = /^\/(bevestig|voorstel\/(bekijk|betaal|betaald|mollie)|service\/antwoord)$/;

export async function onRequest({ request }) {
  const bron = new URL(request.url);
  if (!KLANT.test(bron.pathname)) return Response.redirect("https://www.fonteyn.nl/", 302);
  const doel = new URL(bron.pathname + bron.search, WORKER);
  const antwoord = await fetch(new Request(doel, request));
  return new Response(antwoord.body, { status: antwoord.status, statusText: antwoord.statusText, headers: antwoord.headers });
}
