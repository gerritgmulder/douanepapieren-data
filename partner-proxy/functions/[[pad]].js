/* Passion Partners op partner.passionspas.com
 * ═══════════════════════════════════════════════════════════════════════
 * Gerrit (7 sep 2026): "Ik wil dat je de url beter maakt. Er staat nu nog
 * gmulder/dev weet ik veel wat als url en het moet gewoon iets zijn als
 * partner.passionspas.com."
 *
 * Waarom dit een Pages-project is en geen gewoon Worker-domein
 * -----------------------------------------------------------
 * Een Worker onder een eigen naam laten draaien kan alleen als het domein
 * zelf bij Cloudflare staat. passionspas.com staat bij Savvii en dat blijft
 * zo. Het subdomein apart bij Cloudflare zetten (NS-delegatie) kan wel, maar
 * dat heet "subdomain setup" en is alleen op het Enterprise-plan. Dat gaan we
 * niet betalen.
 *
 * Cloudflare Pages kan het wél gratis: je voegt het subdomein toe aan het
 * project, Marcel maakt één CNAME naar <project>.pages.dev, en Cloudflare
 * regelt het certificaat. Aan passionspas.com verandert verder niets.
 *
 * Wat dit bestand doet
 * --------------------
 * Niets meer dan doorgeven. Het portaal zelf blijft in data-worker draaien,
 * met zijn KV, zijn sleutels en zijn Logic4-koppeling; hier zou een tweede
 * kopie van die logica alleen maar uit de pas gaan lopen. Elk verzoek gaat
 * ongewijzigd door naar de worker en het antwoord komt ongewijzigd terug.
 *
 * De worker maakt zijn eigen links (de inloglink in de mail, de terugkeer van
 * Mollie) op uit de origin van het verzoek. Die is hier de worker zelf, dus
 * zou hij weer naar workers.dev wijzen. Daarom staat het publieke adres als
 * vaste instelling in de worker (DP_PUBLIC_ORIGIN) en niet in een header:
 * een header kan iedereen meesturen, en dan zet je zelf de deur open om een
 * inloglink naar een ander domein te laten wijzen.
 */
const WORKER = "https://fonteyn-data-store.g-mulder.workers.dev";

export async function onRequest({ request }) {
  const bron = new URL(request.url);
  const doel = new URL(bron.pathname + bron.search, WORKER);

  /* Het lege pad hoort bij het portaal. Anders komt een dealer die
     partner.passionspas.com intikt op een 404 van de worker uit. */
  if (bron.pathname === "/") doel.pathname = "/dealers";

  const door = new Request(doel, request);
  door.headers.set("X-Partner-Proxy", "1");        // alleen om in de logs te zien waar het vandaan komt
  const antwoord = await fetch(door);

  // Response is onveranderlijk; een kopie maken zodat de headers mee kunnen.
  return new Response(antwoord.body, {
    status: antwoord.status,
    statusText: antwoord.statusText,
    headers: antwoord.headers,
  });
}
