/* ═════════════════════════════════════════════════════════════════
   VOORSTEL MAKEN - eerst de klant laten bevestigen, dan pas verkopen
   ═════════════════════════════════════════════════════════════════
   Gerrit (30 okt 2026): "Het is voor het bedrijf en de privacy van gegevens
   belangrijk dat de adviseur GEEN regels kan toevoegen, want we willen eerst
   zeker zijn dat de gegevens kloppen." Logic4 kent geen slot op regels
   toevoegen, dus maakt niemand nog een offerte in Logic4 (Marcel sluit dat
   af) en loopt alles via de tegel 'Voorstel maken'.

   Zo loopt het:
   1. De adviseur vult de klantgegevens in (of zoekt een bestaande debiteur
      en vult aan).
   2. Knop "Bevestig je gegevens": de klant krijgt een mail met een link naar
      een pagina van Fonteyn. Daar ziet hij zijn gegevens.
   3. "Klopt": bevestigd. "Klopt niet": hij past ze zelf aan, en de adviseur
      krijgt een bericht in zijn Dashboard met wat er anders is.
   4. Pas na de bevestiging maakt het Dashboard de debiteur (of werkt hem bij)
      en de offerte (status 4) in Logic4 aan. Vanaf dat moment kan de
      adviseur in de tegel regels toevoegen en alles invullen wat het
      offertescherm van Logic4 ook heeft.

   Wat Logic4 via de koppeling NIET kan, en hoe het hier gaat:
   - Een regel weghalen: daar is geen eindpunt voor. Een weggehaalde regel
     krijgt aantal 0 en de tekst "(vervallen)"; dan telt hij niet mee.
   - Namen van de vrije keuzevelden (Type 1-4): geen lijst in de API. De
     nummers staan in VS_TYPES; namen die we kennen staan erbij.
   - Vervaldatum van de offerte: geen veld in de API. Die bewaart het
     Dashboard zelf.

   Opslag in D1 (tabel voorstel), niet in KV: elke klik is een schrijfbeurt.
   Mail: eerst via de eigen Exchange vanuit de mailbox van de adviseur, en
   lukt dat niet, via Resend met de adviseur als antwoordadres.
   ═════════════════════════════════════════════════════════════════ */

const VS_LOGO = "https://mijn.fonteyn.nl/beeld/fonteyn-logo.png";
const VS_FOTO = "https://mijn.fonteyn.nl/beeld/fonteyn-showroom.jpg";
/* Na het bevestigen (Gerrit, 4 nov 2026): het gaat om privacy, niet om wat
   de adviseur nu doet. Kort, met een foto van Fonteyn. */
function vsBedankt(taal) {
  const T = vsT(taal);
  return "<h1>" + vsEsc(T.bedankt) + "</h1><p>" + vsEsc(T.bedankt_p) + "</p>" +
    "<img src='" + VS_FOTO + "' alt='Fonteyn Outdoor Living Mall' style='width:100%;height:auto;display:block;border-radius:10px;margin:14px 0 6px'><p class='klein'>" + vsEsc(T.tot_ziens) + "</p>";
}
const VS_OFFERTE = 4;            // Logic4-status 'Offerte'
const VS_GESLOTEN = 19;          // Logic4-status 'Offerte gesloten'
/* Na een betaling is het voorstel een order (besluit 26 okt 2026, zie
   orderstatusRonde in worker.js): iets betaald -> 30% aanbetaald, alles
   betaald -> Volledig betaald. Alleen omhoog. */
const VS_AANBETAALD = 25;
const VS_BETAALD = 30;
const VS_AANBETAAL_DEEL = 0.30;  // standaard aanbetaling: 30% van het totaal incl. btw
// Logic4 geeft de naam van de status niet altijd mee.
const VS_STATUSNAAM = { 4: "Offerte", 19: "Offerte gesloten", 25: "30% aanbetaald", 30: "Volledig betaald" };
const VS_DAGBOEK_MOLLIE = 42;    // zoals de aanbetalingen van Passion Partners
const VS_VOORUIT = 78;           // Vooruit ontvangen bedragen (1350), verplicht bij AddPayment
/* Het voorstel echt naar de klant mailen gaat pas aan na het akkoord van
   Gerrit op de opmaak (zie memory mails-eerst-laten-zien). Tot die tijd
   werken het voorbeeld en printen wel. */
const VS_STUUR_AAN = true;   // Gerrit akkoord op de opmaak, 31 okt 2026
const VS_PARTICULIER = 1;        // RelationTypeId
const VS_ZAKELIJK = 3;
const VS_ACTIEF = 2;             // StatusId debiteur
/* Vrije keuzevelden op de order. Alleen deze namen zijn bekend (zie de
   uitleg bij DP_ORDERBRON_DEALER in worker.js). */
const VS_TYPES = {
  1: { naam: "Orderbron", bekend: { 16: "Bestaande Dealer" } },
  2: { naam: "Type 2", bekend: {} },
  3: { naam: "Type 3", bekend: {} },
  4: { naam: "Magazijntype", bekend: { 1: "Magazijn", 2: "Spa Service Magazijn" } },
};

/* ── Dolf (video 6 nov 2026): het scherm moet eenvoudiger ─────────────────
   - Filiaal, referentie, orderbron en type 1-3 vult de adviseur niet meer in.
     Filiaal is altijd Uddel (Hoofdfiliaal), het magazijn volgt uit de regels.
   - Een korte lijst vervoerders (Dolf en Don kiezen welke); kies je er een,
     dan staan de verzendkosten er meteen bij (BasicAmount uit Logic4).
   - Drie manieren van betalen: 30% aanbetaling, alles betalen, of
     aangepast. Aangepast kan alleen met een persoonlijke code.
   - De btw-code volgt uit het land en het btw-nummer, dat het Dashboard
     zelf nakijkt bij de EU (VIES).
   - Op een beurs weet de tegel dat zelf; die voorstellen tellen mee voor de
     beursomzet.
   - Een klant uit het buitenland krijgt mails en pagina's in zijn eigen taal. */
const VS_FILIAAL = 1;                 // Hoofdfiliaal (Uddel)
const VS_MAGAZIJN = 1, VS_MAGAZIJN_SERVICE = 2;
// Alleen spa-onderdelen en waterverzorging (artikelnummers 15…, 16…, 88…) = Spa Service Magazijn.
// Zo staan ze op 85% van de orders van sep-nov 2026.
const VS_SERVICE_CODES = /^(15|16|88)\d/;
const VS_TRANSPORT_STANDAARD = [1, 42, 44, 23, 5, 8, 22];   // de meest gebruikte van sep-nov 2026
const VS_BEURS_STANDAARD = [{ naam: "Piscine Global Lyon 2026", van: "2026-11-17", tot: "2026-11-20" }];
// Betaalmethode in Logic4 per taal: 30% aanbetaling (ook bij aangepast), en alles vooraf.
const VS_BETAAL_30 = { nl: 25, en: 40, de: 40, fr: 62, es: 60, it: 59 };
const VS_BETAAL_ALLES = 45;           // Betaling volledig vooraf aan bestelling
const VS_BTW_ICL = 28;                // 0% leveringen binnen EU (ICL)
const VS_BTW_EXPORT = 29;             // 0% leveringen buiten EU (export)
// Particulier (of zakelijk zonder geldig btw-nummer) in de EU: het tarief van dat land.
const VS_BTW_LAND = { BE: 116, DE: 129, FR: 133, AT: 125, ES: 128, IT: 137, LU: 126, MT: 127, CY: 113, RO: 122, BG: 117,
  EE: 131, SK: 120, LV: 138, LT: 139, CZ: 119, SI: 121, IE: 136, PL: 124, PT: 123, FI: 132, GR: 134, EL: 134, DK: 130, HR: 115, SE: 118, HU: 135 };
const VS_EU = new Set(["NL", ...Object.keys(VS_BTW_LAND)]);
const VS_TALEN = { nl: "Nederlands", en: "English", de: "Deutsch", fr: "Français", es: "Español", it: "Italiano" };
function vsTaalLand(land) {
  const l = String(land || "NL").toUpperCase();
  if (["NL", "BE", "SR"].includes(l)) return "nl";
  if (["DE", "AT", "CH", "LI"].includes(l)) return "de";
  if (["FR", "LU", "MC"].includes(l)) return "fr";
  if (l === "ES") return "es";
  if (["IT", "SM"].includes(l)) return "it";
  return "en";
}
function vsTaal(v) { return VS_TALEN[v && v.taal] ? v.taal : vsTaalLand(v && v.klant && v.klant.land); }

/* Alle teksten die de klant ziet. Nederlands met je (Gerrit, 31 okt 2026);
   Duits en Frans met Sie en vous, zoals daar gewoon is. */
const VS_T = {
  nl: {
    beste: n => "Beste " + (n || "klant"), groet: "Met vriendelijke groet,",
    ond_bevestig: "Bevestig je gegevens", mail_bevestig: "Fijn dat je bij ons langs bent geweest. Voordat we je voorstel maken, vragen we je even je gegevens na te kijken. Zo weten we zeker dat alles klopt.",
    knop_bevestig: "Bevestig je gegevens", link_kopie: "Lukt het klikken op de knop niet? Kopieer dan deze link naar je browser:",
    kloppen: "Kloppen je gegevens?", kloppen_p: "Kijk ze even na. Zo weten we zeker dat je gegevens kloppen en veilig bij jouw voorstel horen.",
    klopt: "Klopt", klopt_niet: "Klopt niet, ik pas het aan", aanpassen: "Pas je gegevens aan", aanpassen_p: "Verander wat er anders moet en klik daarna op opslaan.",
    opslaan: "Opslaan, zo klopt het", bijna: "Bijna klaar", vul_in: "Vul nog in:",
    verlopen: "Deze link is verlopen", verlopen_p: "Vraag je adviseur gerust om een nieuwe link.", vs_verlopen: "Dit voorstel is verlopen",
    lukte_niet: "Dat lukte nog niet", lukte_niet_p: "Probeer het nog eens via de link in de mail.",
    bedankt: "Bedankt, je gegevens zijn bevestigd", bedankt_p: "Je gegevens zijn veilig bij ons en horen bij jouw voorstel. Zo klopt alles, van je voorstel tot de levering.",
    tot_ziens: "Tot ziens bij Fonteyn Outdoor Living Mall in Uddel.",
    aanhef: "Aanhef", heer: "De heer", mevrouw: "Mevrouw", naam: "Naam", voornaam: "Voornaam", tussenvoegsel: "Tussenvoegsel", achternaam: "Achternaam",
    bedrijf: "Bedrijfsnaam", btw: "Btw-nummer", adres: "Adres", straat: "Straat", huisnummer: "Huisnummer", toevoeging: "Toevoeging", postcode: "Postcode",
    plaats: "Plaats", pc_plaats: "Postcode en plaats", land: "Land", email: "E-mailadres", telefoon: "Telefoon", mobiel: "Mobiel",
    afleveren_op: "Afleveren op", ander_adres: "Afleveren op een ander adres", tel_of_mobiel: "telefoon of mobiel", afleveradres: "Afleveradres",
    voorstel: "Voorstel", voor: "Voor", gegevens: "Gegevens", datum: "Datum", geldig: "Geldig tot", referentie: "Je referentie", betaling: "Betaling",
    levering: "Levering", leverdatum: "Gewenste leverdatum", adviseur: "Je adviseur", mail: "E-mail", omschrijving: "Omschrijving", aantal: "Aantal",
    stukprijs: "Prijs per stuk", incl: "incl. btw", excl: "excl. btw", totaal: "Totaal", verzend: "Verzendkosten excl. btw", tot_ex: "Totaal excl. btw",
    btw_kort: "Btw", tot_incl: "Totaal incl. btw", artikel: "Artikel", korting: "korting", tav: "t.a.v.",
    vragen: n => "Vragen over dit voorstel? Mail of bel je adviseur" + (n ? ", " + n : "") + ". We helpen je graag verder.", printen: "Printen of opslaan als pdf",
    b30: "30% aanbetaling, de rest 14 dagen voor de levering", balles: "Alles vooraf betalen", beigen: b => "Aanbetaling " + b + ", de rest 14 dagen voor de levering",
    mail_vs: "Hierbij ontvang je ons voorstel. Je bekijkt het via de knop hieronder; daar kun je het ook printen of opslaan als pdf.",
    knop_vs: "Bekijk je voorstel", ond_vs: n => "Je voorstel " + n + " van Fonteyn",
    res_kop: "Met je aanbetaling worden je producten nu gereserveerd", res_kop_alles: "Met je betaling worden je producten nu gereserveerd",
    res_p: (b, d) => "Je aanbetaling is <b>" + b + "</b>" + (d ? " (30% van het totaal)" : "") + ". Je betaalt veilig online, ook met je telefoon.",
    res_p_alles: b => "Het totaalbedrag is <b>" + b + "</b>. Je betaalt veilig online, ook met je telefoon.",
    knop_aanbetalen: "Aanbetalen", knop_betalen: "Betalen",
    binnen: "Je aanbetaling is binnen", binnen_p: b => "Bedankt! We hebben " + b + " ontvangen. Je bestelling staat vast; je adviseur neemt contact met je op over de levering.",
    geduld: "Even geduld", verwerkt: "Je betaling wordt verwerkt", verwerkt_p: "Dit duurt meestal een paar seconden. Deze pagina ververst vanzelf.",
    terug: "Terug naar je voorstel", afgebroken: "De betaling is afgebroken", afgebroken_p: "Er is niets afgeschreven. Wil je het opnieuw proberen?", opnieuw: "Opnieuw aanbetalen",
    storing_p: "Online betalen gaat zo weer. Je adviseur helpt je graag verder.", mollie: n => "Aanbetaling voorstel " + n + " - Fonteyn",
  },
  en: {
    beste: n => n ? "Dear " + n : "Dear customer", groet: "Kind regards,",
    ond_bevestig: "Please confirm your details", mail_bevestig: "Thank you for visiting us. Before we prepare your proposal, please take a moment to check your details. That way we know everything is correct.",
    knop_bevestig: "Confirm your details", link_kopie: "Button not working? Copy this link into your browser:",
    kloppen: "Are your details correct?", kloppen_p: "Please take a quick look. That way we know your details are correct and safely linked to your proposal.",
    klopt: "Correct", klopt_niet: "Not correct, I'll change it", aanpassen: "Change your details", aanpassen_p: "Change what needs changing and then click save.",
    opslaan: "Save, this is correct", bijna: "Almost done", vul_in: "Please fill in:",
    verlopen: "This link has expired", verlopen_p: "Feel free to ask your adviser for a new link.", vs_verlopen: "This proposal has expired",
    lukte_niet: "That did not work yet", lukte_niet_p: "Please try again with the link in the email.",
    bedankt: "Thank you, your details are confirmed", bedankt_p: "Your details are safe with us and linked to your proposal. That way everything is right, from your proposal to delivery.",
    tot_ziens: "See you at Fonteyn Outdoor Living Mall in Uddel.",
    aanhef: "Title", heer: "Mr", mevrouw: "Mrs", naam: "Name", voornaam: "First name", tussenvoegsel: "Prefix", achternaam: "Last name",
    bedrijf: "Company", btw: "VAT number", adres: "Address", straat: "Street", huisnummer: "House number", toevoeging: "Addition", postcode: "Postcode",
    plaats: "City", pc_plaats: "Postcode and city", land: "Country", email: "Email address", telefoon: "Phone", mobiel: "Mobile",
    afleveren_op: "Deliver to", ander_adres: "Deliver to a different address", tel_of_mobiel: "phone or mobile", afleveradres: "Delivery address",
    voorstel: "Proposal", voor: "For", gegevens: "Details", datum: "Date", geldig: "Valid until", referentie: "Your reference", betaling: "Payment",
    levering: "Delivery", leverdatum: "Requested delivery date", adviseur: "Your adviser", mail: "Email", omschrijving: "Description", aantal: "Qty",
    stukprijs: "Price each", incl: "incl. VAT", excl: "excl. VAT", totaal: "Total", verzend: "Shipping excl. VAT", tot_ex: "Total excl. VAT",
    btw_kort: "VAT", tot_incl: "Total incl. VAT", artikel: "Item", korting: "discount", tav: "attn.",
    vragen: n => "Questions about this proposal? Email or call your adviser" + (n ? ", " + n : "") + ". We are happy to help.", printen: "Print or save as PDF",
    b30: "30% deposit, the rest 14 days before delivery", balles: "Full payment in advance", beigen: b => "Deposit of " + b + ", the rest 14 days before delivery",
    mail_vs: "Here is our proposal. You can view it with the button below; there you can also print it or save it as a PDF.",
    knop_vs: "View your proposal", ond_vs: n => "Your proposal " + n + " from Fonteyn",
    res_kop: "With your deposit, your products are reserved right away", res_kop_alles: "With your payment, your products are reserved right away",
    res_p: (b, d) => "Your deposit is <b>" + b + "</b>" + (d ? " (30% of the total)" : "") + ". You pay securely online, also with your phone.",
    res_p_alles: b => "The total amount is <b>" + b + "</b>. You pay securely online, also with your phone.",
    knop_aanbetalen: "Pay deposit", knop_betalen: "Pay",
    binnen: "Your deposit has been received", binnen_p: b => "Thank you! We have received " + b + ". Your order is confirmed; your adviser will contact you about delivery.",
    geduld: "One moment", verwerkt: "Your payment is being processed", verwerkt_p: "This usually takes a few seconds. This page refreshes by itself.",
    terug: "Back to your proposal", afgebroken: "The payment was cancelled", afgebroken_p: "Nothing has been charged. Would you like to try again?", opnieuw: "Try again",
    storing_p: "Online payment will be back shortly. Your adviser is happy to help.", mollie: n => "Deposit proposal " + n + " - Fonteyn",
  },
  de: {
    beste: n => "Guten Tag" + (n ? " " + n : ""), groet: "Mit freundlichen Grüßen",
    ond_bevestig: "Bitte bestätigen Sie Ihre Daten", mail_bevestig: "Schön, dass Sie bei uns waren. Bevor wir Ihr Angebot erstellen, bitten wir Sie, kurz Ihre Daten zu prüfen. So wissen wir sicher, dass alles stimmt.",
    knop_bevestig: "Daten bestätigen", link_kopie: "Funktioniert die Schaltfläche nicht? Kopieren Sie diesen Link in Ihren Browser:",
    kloppen: "Stimmen Ihre Daten?", kloppen_p: "Bitte prüfen Sie sie kurz. So wissen wir sicher, dass Ihre Daten stimmen und sicher zu Ihrem Angebot gehören.",
    klopt: "Stimmt", klopt_niet: "Stimmt nicht, ich ändere es", aanpassen: "Daten ändern", aanpassen_p: "Ändern Sie, was anders sein muss, und klicken Sie dann auf Speichern.",
    opslaan: "Speichern, so stimmt es", bijna: "Fast fertig", vul_in: "Bitte noch ausfüllen:",
    verlopen: "Dieser Link ist abgelaufen", verlopen_p: "Bitten Sie Ihren Berater gern um einen neuen Link.", vs_verlopen: "Dieses Angebot ist abgelaufen",
    lukte_niet: "Das hat noch nicht geklappt", lukte_niet_p: "Bitte versuchen Sie es noch einmal über den Link in der E-Mail.",
    bedankt: "Vielen Dank, Ihre Daten sind bestätigt", bedankt_p: "Ihre Daten sind bei uns sicher und gehören zu Ihrem Angebot. So stimmt alles, vom Angebot bis zur Lieferung.",
    tot_ziens: "Bis bald bei Fonteyn Outdoor Living Mall in Uddel.",
    aanhef: "Anrede", heer: "Herr", mevrouw: "Frau", naam: "Name", voornaam: "Vorname", tussenvoegsel: "Namenszusatz", achternaam: "Nachname",
    bedrijf: "Firma", btw: "USt-IdNr.", adres: "Adresse", straat: "Straße", huisnummer: "Hausnummer", toevoeging: "Zusatz", postcode: "Postleitzahl",
    plaats: "Ort", pc_plaats: "PLZ und Ort", land: "Land", email: "E-Mail-Adresse", telefoon: "Telefon", mobiel: "Mobil",
    afleveren_op: "Lieferung an", ander_adres: "An eine andere Adresse liefern", tel_of_mobiel: "Telefon oder Mobil", afleveradres: "Lieferadresse",
    voorstel: "Angebot", voor: "Für", gegevens: "Angaben", datum: "Datum", geldig: "Gültig bis", referentie: "Ihre Referenz", betaling: "Zahlung",
    levering: "Lieferung", leverdatum: "Gewünschter Liefertermin", adviseur: "Ihr Berater", mail: "E-Mail", omschrijving: "Beschreibung", aantal: "Menge",
    stukprijs: "Preis pro Stück", incl: "inkl. MwSt.", excl: "exkl. MwSt.", totaal: "Gesamt", verzend: "Versandkosten exkl. MwSt.", tot_ex: "Gesamt exkl. MwSt.",
    btw_kort: "MwSt.", tot_incl: "Gesamt inkl. MwSt.", artikel: "Artikel", korting: "Rabatt", tav: "z. Hd.",
    vragen: n => "Fragen zu diesem Angebot? Schreiben Sie Ihrem Berater oder rufen Sie an" + (n ? " (" + n + ")" : "") + ". Wir helfen Ihnen gern.", printen: "Drucken oder als PDF speichern",
    b30: "30 % Anzahlung, der Rest 14 Tage vor der Lieferung", balles: "Vollständige Zahlung im Voraus", beigen: b => "Anzahlung " + b + ", der Rest 14 Tage vor der Lieferung",
    mail_vs: "Anbei erhalten Sie unser Angebot. Sie sehen es über die Schaltfläche unten; dort können Sie es auch drucken oder als PDF speichern.",
    knop_vs: "Angebot ansehen", ond_vs: n => "Ihr Angebot " + n + " von Fonteyn",
    res_kop: "Mit Ihrer Anzahlung werden Ihre Produkte jetzt reserviert", res_kop_alles: "Mit Ihrer Zahlung werden Ihre Produkte jetzt reserviert",
    res_p: (b, d) => "Ihre Anzahlung beträgt <b>" + b + "</b>" + (d ? " (30 % des Gesamtbetrags)" : "") + ". Sie zahlen sicher online, auch mit dem Handy.",
    res_p_alles: b => "Der Gesamtbetrag ist <b>" + b + "</b>. Sie zahlen sicher online, auch mit dem Handy.",
    knop_aanbetalen: "Anzahlung leisten", knop_betalen: "Bezahlen",
    binnen: "Ihre Anzahlung ist eingegangen", binnen_p: b => "Vielen Dank! Wir haben " + b + " erhalten. Ihre Bestellung steht fest; Ihr Berater meldet sich wegen der Lieferung bei Ihnen.",
    geduld: "Einen Moment", verwerkt: "Ihre Zahlung wird verarbeitet", verwerkt_p: "Das dauert meist nur ein paar Sekunden. Diese Seite aktualisiert sich von selbst.",
    terug: "Zurück zum Angebot", afgebroken: "Die Zahlung wurde abgebrochen", afgebroken_p: "Es wurde nichts abgebucht. Möchten Sie es erneut versuchen?", opnieuw: "Erneut versuchen",
    storing_p: "Die Online-Zahlung ist gleich wieder möglich. Ihr Berater hilft Ihnen gern weiter.", mollie: n => "Anzahlung Angebot " + n + " - Fonteyn",
  },
  fr: {
    beste: n => "Bonjour" + (n ? " " + n : ""), groet: "Cordialement,",
    ond_bevestig: "Merci de confirmer vos coordonnées", mail_bevestig: "Merci pour votre visite. Avant de préparer votre proposition, nous vous demandons de vérifier vos coordonnées. Ainsi, nous sommes sûrs que tout est correct.",
    knop_bevestig: "Confirmer mes coordonnées", link_kopie: "Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :",
    kloppen: "Vos coordonnées sont-elles correctes ?", kloppen_p: "Merci de les vérifier. Ainsi, nous sommes sûrs que vos coordonnées sont exactes et bien liées à votre proposition.",
    klopt: "C'est correct", klopt_niet: "Ce n'est pas correct, je modifie", aanpassen: "Modifier mes coordonnées", aanpassen_p: "Modifiez ce qui doit l'être, puis cliquez sur enregistrer.",
    opslaan: "Enregistrer, c'est correct", bijna: "Presque terminé", vul_in: "Merci de compléter :",
    verlopen: "Ce lien a expiré", verlopen_p: "N'hésitez pas à demander un nouveau lien à votre conseiller.", vs_verlopen: "Cette proposition a expiré",
    lukte_niet: "Cela n'a pas encore fonctionné", lukte_niet_p: "Réessayez avec le lien dans l'e-mail.",
    bedankt: "Merci, vos coordonnées sont confirmées", bedankt_p: "Vos coordonnées sont en sécurité chez nous et liées à votre proposition. Ainsi, tout est juste, de la proposition à la livraison.",
    tot_ziens: "À bientôt chez Fonteyn Outdoor Living Mall à Uddel.",
    aanhef: "Civilité", heer: "Monsieur", mevrouw: "Madame", naam: "Nom", voornaam: "Prénom", tussenvoegsel: "Particule", achternaam: "Nom de famille",
    bedrijf: "Société", btw: "N° de TVA", adres: "Adresse", straat: "Rue", huisnummer: "Numéro", toevoeging: "Complément", postcode: "Code postal",
    plaats: "Ville", pc_plaats: "Code postal et ville", land: "Pays", email: "Adresse e-mail", telefoon: "Téléphone", mobiel: "Mobile",
    afleveren_op: "Livrer à", ander_adres: "Livrer à une autre adresse", tel_of_mobiel: "téléphone ou mobile", afleveradres: "Adresse de livraison",
    voorstel: "Proposition", voor: "Pour", gegevens: "Informations", datum: "Date", geldig: "Valable jusqu'au", referentie: "Votre référence", betaling: "Paiement",
    levering: "Livraison", leverdatum: "Date de livraison souhaitée", adviseur: "Votre conseiller", mail: "E-mail", omschrijving: "Description", aantal: "Qté",
    stukprijs: "Prix unitaire", incl: "TTC", excl: "HT", totaal: "Total", verzend: "Frais de livraison HT", tot_ex: "Total HT",
    btw_kort: "TVA", tot_incl: "Total TTC", artikel: "Article", korting: "remise", tav: "à l'att. de",
    vragen: n => "Une question sur cette proposition ? Écrivez ou appelez votre conseiller" + (n ? ", " + n : "") + ". Nous sommes là pour vous aider.", printen: "Imprimer ou enregistrer en PDF",
    b30: "Acompte de 30 %, le solde 14 jours avant la livraison", balles: "Paiement intégral à la commande", beigen: b => "Acompte de " + b + ", le solde 14 jours avant la livraison",
    mail_vs: "Voici notre proposition. Vous pouvez la consulter avec le bouton ci-dessous ; vous pouvez aussi l'imprimer ou l'enregistrer en PDF.",
    knop_vs: "Voir ma proposition", ond_vs: n => "Votre proposition " + n + " de Fonteyn",
    res_kop: "Avec votre acompte, vos produits sont réservés dès maintenant", res_kop_alles: "Avec votre paiement, vos produits sont réservés dès maintenant",
    res_p: (b, d) => "Votre acompte est de <b>" + b + "</b>" + (d ? " (30 % du total)" : "") + ". Vous payez en ligne en toute sécurité, aussi avec votre téléphone.",
    res_p_alles: b => "Le montant total est de <b>" + b + "</b>. Vous payez en ligne en toute sécurité, aussi avec votre téléphone.",
    knop_aanbetalen: "Payer l'acompte", knop_betalen: "Payer",
    binnen: "Votre acompte a bien été reçu", binnen_p: b => "Merci ! Nous avons reçu " + b + ". Votre commande est confirmée ; votre conseiller vous contactera pour la livraison.",
    geduld: "Un instant", verwerkt: "Votre paiement est en cours de traitement", verwerkt_p: "Cela prend généralement quelques secondes. Cette page se met à jour automatiquement.",
    terug: "Retour à ma proposition", afgebroken: "Le paiement a été interrompu", afgebroken_p: "Rien n'a été débité. Voulez-vous réessayer ?", opnieuw: "Réessayer",
    storing_p: "Le paiement en ligne sera bientôt de nouveau disponible. Votre conseiller vous aide volontiers.", mollie: n => "Acompte proposition " + n + " - Fonteyn",
  },
  es: {
    beste: n => "Hola" + (n ? " " + n : ""), groet: "Un cordial saludo,",
    ond_bevestig: "Confirma tus datos", mail_bevestig: "Gracias por visitarnos. Antes de preparar tu propuesta, te pedimos que revises tus datos. Así sabemos con seguridad que todo es correcto.",
    knop_bevestig: "Confirmar mis datos", link_kopie: "¿No funciona el botón? Copia este enlace en tu navegador:",
    kloppen: "¿Son correctos tus datos?", kloppen_p: "Revísalos un momento. Así sabemos con seguridad que tus datos son correctos y están vinculados a tu propuesta.",
    klopt: "Correcto", klopt_niet: "No es correcto, lo cambio", aanpassen: "Cambiar mis datos", aanpassen_p: "Cambia lo que haga falta y luego haz clic en guardar.",
    opslaan: "Guardar, así es correcto", bijna: "Casi listo", vul_in: "Rellena todavía:",
    verlopen: "Este enlace ha caducado", verlopen_p: "Pide sin problema un nuevo enlace a tu asesor.", vs_verlopen: "Esta propuesta ha caducado",
    lukte_niet: "Todavía no ha funcionado", lukte_niet_p: "Inténtalo de nuevo con el enlace del correo.",
    bedankt: "Gracias, tus datos están confirmados", bedankt_p: "Tus datos están seguros con nosotros y vinculados a tu propuesta. Así todo es correcto, desde la propuesta hasta la entrega.",
    tot_ziens: "Hasta pronto en Fonteyn Outdoor Living Mall, en Uddel.",
    aanhef: "Tratamiento", heer: "Sr.", mevrouw: "Sra.", naam: "Nombre", voornaam: "Nombre", tussenvoegsel: "Partícula", achternaam: "Apellido",
    bedrijf: "Empresa", btw: "NIF-IVA", adres: "Dirección", straat: "Calle", huisnummer: "Número", toevoeging: "Complemento", postcode: "Código postal",
    plaats: "Ciudad", pc_plaats: "Código postal y ciudad", land: "País", email: "Correo electrónico", telefoon: "Teléfono", mobiel: "Móvil",
    afleveren_op: "Entregar en", ander_adres: "Entregar en otra dirección", tel_of_mobiel: "teléfono o móvil", afleveradres: "Dirección de entrega",
    voorstel: "Propuesta", voor: "Para", gegevens: "Datos", datum: "Fecha", geldig: "Válida hasta", referentie: "Tu referencia", betaling: "Pago",
    levering: "Entrega", leverdatum: "Fecha de entrega deseada", adviseur: "Tu asesor", mail: "Correo", omschrijving: "Descripción", aantal: "Cant.",
    stukprijs: "Precio por unidad", incl: "IVA incl.", excl: "sin IVA", totaal: "Total", verzend: "Gastos de envío sin IVA", tot_ex: "Total sin IVA",
    btw_kort: "IVA", tot_incl: "Total IVA incl.", artikel: "Artículo", korting: "descuento", tav: "a la atención de",
    vragen: n => "¿Preguntas sobre esta propuesta? Escribe o llama a tu asesor" + (n ? ", " + n : "") + ". Te ayudamos con gusto.", printen: "Imprimir o guardar como PDF",
    b30: "Depósito del 30 %, el resto 14 días antes de la entrega", balles: "Pago completo por adelantado", beigen: b => "Depósito de " + b + ", el resto 14 días antes de la entrega",
    mail_vs: "Aquí tienes nuestra propuesta. Puedes verla con el botón de abajo; allí también puedes imprimirla o guardarla como PDF.",
    knop_vs: "Ver mi propuesta", ond_vs: n => "Tu propuesta " + n + " de Fonteyn",
    res_kop: "Con tu depósito, tus productos quedan reservados ahora mismo", res_kop_alles: "Con tu pago, tus productos quedan reservados ahora mismo",
    res_p: (b, d) => "Tu depósito es de <b>" + b + "</b>" + (d ? " (30 % del total)" : "") + ". Pagas de forma segura en línea, también con tu móvil.",
    res_p_alles: b => "El importe total es de <b>" + b + "</b>. Pagas de forma segura en línea, también con tu móvil.",
    knop_aanbetalen: "Pagar el depósito", knop_betalen: "Pagar",
    binnen: "Hemos recibido tu depósito", binnen_p: b => "¡Gracias! Hemos recibido " + b + ". Tu pedido está confirmado; tu asesor se pondrá en contacto contigo para la entrega.",
    geduld: "Un momento", verwerkt: "Tu pago se está procesando", verwerkt_p: "Suele tardar unos segundos. Esta página se actualiza sola.",
    terug: "Volver a mi propuesta", afgebroken: "El pago se ha cancelado", afgebroken_p: "No se ha cobrado nada. ¿Quieres intentarlo de nuevo?", opnieuw: "Intentar de nuevo",
    storing_p: "El pago en línea volverá enseguida. Tu asesor te ayuda con gusto.", mollie: n => "Depósito propuesta " + n + " - Fonteyn",
  },
  it: {
    beste: n => n ? "Gentile " + n : "Gentile cliente", groet: "Cordiali saluti,",
    ond_bevestig: "Conferma i tuoi dati", mail_bevestig: "Grazie per essere passato da noi. Prima di preparare la tua proposta, ti chiediamo di controllare i tuoi dati. Così siamo sicuri che sia tutto corretto.",
    knop_bevestig: "Conferma i tuoi dati", link_kopie: "Il pulsante non funziona? Copia questo link nel browser:",
    kloppen: "I tuoi dati sono corretti?", kloppen_p: "Controllali un attimo. Così siamo sicuri che i tuoi dati sono corretti e collegati alla tua proposta.",
    klopt: "Sono corretti", klopt_niet: "Non sono corretti, li modifico", aanpassen: "Modifica i tuoi dati", aanpassen_p: "Modifica ciò che serve e poi clicca su salva.",
    opslaan: "Salva, così è corretto", bijna: "Quasi fatto", vul_in: "Compila ancora:",
    verlopen: "Questo link è scaduto", verlopen_p: "Chiedi pure un nuovo link al tuo consulente.", vs_verlopen: "Questa proposta è scaduta",
    lukte_niet: "Non è ancora riuscito", lukte_niet_p: "Riprova con il link nell'e-mail.",
    bedankt: "Grazie, i tuoi dati sono confermati", bedankt_p: "I tuoi dati sono al sicuro da noi e collegati alla tua proposta. Così tutto è corretto, dalla proposta alla consegna.",
    tot_ziens: "A presto da Fonteyn Outdoor Living Mall a Uddel.",
    aanhef: "Titolo", heer: "Sig.", mevrouw: "Sig.ra", naam: "Nome", voornaam: "Nome", tussenvoegsel: "Prefisso", achternaam: "Cognome",
    bedrijf: "Azienda", btw: "Partita IVA", adres: "Indirizzo", straat: "Via", huisnummer: "Numero civico", toevoeging: "Interno", postcode: "CAP",
    plaats: "Città", pc_plaats: "CAP e città", land: "Paese", email: "Indirizzo e-mail", telefoon: "Telefono", mobiel: "Cellulare",
    afleveren_op: "Consegna a", ander_adres: "Consegna a un altro indirizzo", tel_of_mobiel: "telefono o cellulare", afleveradres: "Indirizzo di consegna",
    voorstel: "Proposta", voor: "Per", gegevens: "Dati", datum: "Data", geldig: "Valida fino al", referentie: "Il tuo riferimento", betaling: "Pagamento",
    levering: "Consegna", leverdatum: "Data di consegna desiderata", adviseur: "Il tuo consulente", mail: "E-mail", omschrijving: "Descrizione", aantal: "Q.tà",
    stukprijs: "Prezzo unitario", incl: "IVA incl.", excl: "IVA escl.", totaal: "Totale", verzend: "Spese di spedizione IVA escl.", tot_ex: "Totale IVA escl.",
    btw_kort: "IVA", tot_incl: "Totale IVA incl.", artikel: "Articolo", korting: "sconto", tav: "c.a.",
    vragen: n => "Domande su questa proposta? Scrivi o chiama il tuo consulente" + (n ? ", " + n : "") + ". Siamo felici di aiutarti.", printen: "Stampa o salva come PDF",
    b30: "Acconto del 30%, il saldo 14 giorni prima della consegna", balles: "Pagamento completo anticipato", beigen: b => "Acconto di " + b + ", il saldo 14 giorni prima della consegna",
    mail_vs: "Ecco la nostra proposta. Puoi vederla con il pulsante qui sotto; lì puoi anche stamparla o salvarla in PDF.",
    knop_vs: "Vedi la proposta", ond_vs: n => "La tua proposta " + n + " di Fonteyn",
    res_kop: "Con il tuo acconto i tuoi prodotti vengono riservati subito", res_kop_alles: "Con il tuo pagamento i tuoi prodotti vengono riservati subito",
    res_p: (b, d) => "Il tuo acconto è di <b>" + b + "</b>" + (d ? " (30% del totale)" : "") + ". Paghi online in modo sicuro, anche con il telefono.",
    res_p_alles: b => "L'importo totale è di <b>" + b + "</b>. Paghi online in modo sicuro, anche con il telefono.",
    knop_aanbetalen: "Paga l'acconto", knop_betalen: "Paga",
    binnen: "Il tuo acconto è arrivato", binnen_p: b => "Grazie! Abbiamo ricevuto " + b + ". Il tuo ordine è confermato; il tuo consulente ti contatterà per la consegna.",
    geduld: "Un momento", verwerkt: "Il tuo pagamento è in elaborazione", verwerkt_p: "Di solito ci vogliono pochi secondi. Questa pagina si aggiorna da sola.",
    terug: "Torna alla proposta", afgebroken: "Il pagamento è stato interrotto", afgebroken_p: "Non è stato addebitato nulla. Vuoi riprovare?", opnieuw: "Riprova",
    storing_p: "Il pagamento online tornerà a breve. Il tuo consulente ti aiuta volentieri.", mollie: n => "Acconto proposta " + n + " - Fonteyn",
  },
};
function vsT(taal) { return VS_T[taal] || VS_T.nl; }
const VS_LOCALE = { nl: "nl-NL", en: "en-GB", de: "de-DE", fr: "fr-FR", es: "es-ES", it: "it-IT" };

let _vsTabel = false;
async function vsDb(env) {
  const db = env.ACTIVITEIT;
  if (!_vsTabel) {
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS voorstel (id TEXT PRIMARY KEY, token TEXT, status TEXT, adviseur TEXT, debiteur INTEGER, orderid INTEGER, json TEXT, aangemaakt INTEGER, gewijzigd INTEGER)"),
      db.prepare("CREATE INDEX IF NOT EXISTS voorstel_token ON voorstel (token)"),
      db.prepare("CREATE INDEX IF NOT EXISTS voorstel_adviseur ON voorstel (adviseur, gewijzigd)"),
      db.prepare("CREATE INDEX IF NOT EXISTS voorstel_gewijzigd ON voorstel (gewijzigd)"),
      db.prepare("CREATE TABLE IF NOT EXISTS voorstel_cache (k TEXT PRIMARY KEY, v TEXT, ts INTEGER)"),
      /* Per debiteur de gegevens zoals de klant ze het laatst bevestigde.
         Gerrit (30 okt 2026): eenmaal bevestigd is genoeg, zolang er niets
         aan veranderd is. */
      // Links naar het voorstel: t = verstuurd aan de klant, p = printen. Eigen tabel, zodat zoeken één rij leest.
      db.prepare("CREATE TABLE IF NOT EXISTS voorstel_link (token TEXT PRIMARY KEY, id TEXT, soort TEXT, ts INTEGER)"),
      db.prepare("CREATE TABLE IF NOT EXISTS voorstel_bevestigd (debiteur INTEGER PRIMARY KEY, klant TEXT, ts INTEGER, voorstel TEXT)"),
    ]);
    _vsTabel = true;
  }
  return db;
}

function vsEsc(x) { return String(x == null ? "" : x).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function vsJson(t, d) { try { return JSON.parse(t); } catch (e) { return d; } }
function vsCode(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join(""); }
function vsS(x, max) { return String(x == null ? "" : x).trim().slice(0, max || 120); }

/* ── Klantgegevens: altijd dezelfde vorm, van de adviseur én van de klant ── */
const VS_KLANT_VELDEN = ["aanhef", "voornaam", "tussenvoegsel", "achternaam", "bedrijf", "btw",
  "straat", "huisnummer", "toevoeging", "postcode", "plaats", "land", "email", "telefoon", "mobiel"];
const VS_AFL_VELDEN = ["naam", "straat", "huisnummer", "toevoeging", "postcode", "plaats", "land"];
function vsKlantSchoon(k) {
  k = k || {};
  const u = {};
  for (const v of VS_KLANT_VELDEN) u[v] = vsS(k[v], v === "email" ? 120 : 80);
  u.aanhef = ["1", "2"].includes(String(k.aanhef)) ? String(k.aanhef) : "";
  u.land = (u.land || "NL").toUpperCase().slice(0, 2);
  u.email = u.email.toLowerCase();
  u.postcode = u.postcode.toUpperCase();
  const a = k.aflevering || {};
  u.afwijkend = k.afwijkend === true;
  u.aflevering = {};
  for (const v of VS_AFL_VELDEN) u.aflevering[v] = vsS(a[v], 80);
  u.aflevering.land = (u.aflevering.land || u.land).toUpperCase().slice(0, 2);
  return u;
}
function vsKlantMist(k, taal) {
  const T = vsT(taal), l = x => String(T[x]).toLowerCase();
  const mist = [];
  if (!k.achternaam && !k.bedrijf) mist.push(l("achternaam"));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k.email)) mist.push(l("email"));
  if (!k.straat) mist.push(l("straat"));
  if (!k.huisnummer) mist.push(l("huisnummer"));
  if (!k.postcode) mist.push(l("postcode"));
  if (!k.plaats) mist.push(l("plaats"));
  if (!k.telefoon && !k.mobiel) mist.push(T.tel_of_mobiel);
  if (k.afwijkend && (!(k.aflevering || {}).straat || !(k.aflevering || {}).huisnummer || !(k.aflevering || {}).plaats)) mist.push(l("afleveradres"));
  /* Dolf (6 nov 2026): een bedrijf in het buitenland moet een btw-nummer
     hebben; daarmee valt de btw weg (0%, levering binnen de EU). */
  if (k.bedrijf && k.land !== "NL" && VS_EU.has(k.land) && !k.btw) mist.push(taal && taal !== "nl" ? T.btw : "btw-nummer (bedrijf in het buitenland)");
  return mist;
}
function vsNaam(k) {
  return [k.voornaam, k.tussenvoegsel, k.achternaam].filter(Boolean).join(" ") || k.bedrijf || "";
}
/* Wat is er anders tussen twee versies, in gewone woorden. */
const VS_LABEL = { aanhef: "Aanhef", voornaam: "Voornaam", tussenvoegsel: "Tussenvoegsel", achternaam: "Achternaam",
  bedrijf: "Bedrijfsnaam", btw: "Btw-nummer", straat: "Straat", huisnummer: "Huisnummer", toevoeging: "Toevoeging",
  postcode: "Postcode", plaats: "Plaats", land: "Land", email: "E-mailadres", telefoon: "Telefoon", mobiel: "Mobiel" };
function vsVerschil(oud, nieuw) {
  const uit = [];
  for (const v of VS_KLANT_VELDEN) if (String(oud[v] || "") !== String(nieuw[v] || "")) uit.push({ veld: VS_LABEL[v], was: oud[v] || "", wordt: nieuw[v] || "" });
  if (!!oud.afwijkend !== !!nieuw.afwijkend) uit.push({ veld: "Ander afleveradres", was: oud.afwijkend ? "ja" : "nee", wordt: nieuw.afwijkend ? "ja" : "nee" });
  if (nieuw.afwijkend) for (const v of VS_AFL_VELDEN) {
    const a = (oud.aflevering || {})[v] || "", b = (nieuw.aflevering || {})[v] || "";
    if (a !== b) uit.push({ veld: "Aflevering: " + v, was: a, wordt: b });
  }
  return uit;
}

/* ── Opslaan en lezen ───────────────────────────────────────────────────── */
async function vsLees(db, id) {
  const r = await db.prepare("SELECT * FROM voorstel WHERE id = ?1").bind(String(id)).first();
  return r ? vsUit(r) : null;
}
function vsUit(r) {
  const j = vsJson(r.json, {});
  return Object.assign(j, { id: r.id, token: r.token, status: r.status, adviseur: r.adviseur,
    debiteur: r.debiteur || null, orderid: r.orderid || null, aangemaakt: r.aangemaakt, gewijzigd: r.gewijzigd });
}
async function vsSchrijf(db, v) {
  v.gewijzigd = Date.now();
  const { id, token, status, adviseur, debiteur, orderid, aangemaakt, gewijzigd, ...rest } = v;
  await db.prepare("INSERT OR REPLACE INTO voorstel (id, token, status, adviseur, debiteur, orderid, json, aangemaakt, gewijzigd) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
    .bind(id, token, status, adviseur, debiteur || null, orderid || null, JSON.stringify(rest), aangemaakt || gewijzigd, gewijzigd).run();
}
function vsLog(v, wie, wat) {
  v.log = (v.log || []).concat([{ ts: Date.now(), wie: wie || "het Dashboard", wat: String(wat).slice(0, 300) }]).slice(-80);
}
/* Wat de tegel te zien krijgt: nooit het token (dat is de sleutel van de klant). */
function vsVoorTegel(v) {
  const { token, ...rest } = v;
  rest.mist = vsKlantMist(rest.klant || {});
  rest.taalGekozen = VS_TALEN[v.taal] ? v.taal : "";
  rest.taal = vsTaal(v);
  rest.btwAuto = vsBtwAuto(v);
  rest.betaal = { aanbetaling: vsAanbetaling(v), betaald: vsBetaald(v), eigenBedrag: v.betaalwijze === "aangepast", wijze: v.betaalwijze || "30",
    link: v.bekijkToken ? vsBasis(null) + "/voorstel/betaal?t=" + encodeURIComponent(v.bekijkToken) : "" };
  return rest;
}

/* ── Aanbetalen (Gerrit, 4 nov 2026) ──────────────────────────────────────
   "Een aanbetaling doen op dit voorstel waardoor het direct in Logic4 wordt
   omgezet in een order." Twee wegen:
   - Online: in het voorstel dat de klant krijgt staat een knop Aanbetalen
     (Mollie). Meldt Mollie dat het betaald is, dan boekt het Dashboard het
     bedrag op de offerte in Logic4 (dagboek Mollie, zoals Passion Partners)
     en zet het de status meteen op 30% aanbetaald of Volledig betaald.
   - In de winkel: de kassa boekt de betaling op het voorstelnummer. Opent de
     adviseur het voorstel in de tegel, dan ziet het Dashboard de betaling en
     zet het de status meteen om. Elk uur doet orderstatusRonde dat ook. */
function vsBasis(env) { return (env && env.SVC_LINK_BASIS) || "https://fonteyn-data-store.g-mulder.workers.dev"; }
function vsAanbetaling(v, incl) {
  const tot = incl != null ? Number(incl) : Number((v.verstuurdeVersie && v.verstuurdeVersie.totaal && v.verstuurdeVersie.totaal.incl) || 0);
  if (v.betaalwijze === "alles") return Math.round(tot * 100) / 100;
  // Voorstellen van voor 7 nov 2026 hebben alleen een eigen bedrag, zonder betaalwijze.
  if ((v.betaalwijze === "aangepast" || !v.betaalwijze) && Number(v.aanbetaling) > 0) return Math.round(Number(v.aanbetaling) * 100) / 100;
  return Math.round(tot * VS_AANBETAAL_DEEL * 100) / 100;
}
function vsBetaald(v) {
  return Math.round((v.betalingen || []).filter(b => b.geboekt).reduce((s, b) => s + (Number(b.bedrag) || 0), 0) * 100) / 100;
}
/* Staat er geld op de offerte, dan wordt hij order. Nooit terug. */
async function vsNaarOrder(env, H, v, wie, minstens) {
  const o = await vsOrderLees(env, H, v.orderid);
  // Net geboekt? Dan telt dat bedrag mee, ook als Logic4 het totaal nog niet bijwerkte.
  if (o && minstens > o.betaald) o.betaald = minstens;
  if (!o || !(o.betaald > 0)) return o;
  const doel = o.betaald >= (o.totaal.incl || 0) - 0.01 ? VS_BETAALD : VS_AANBETAALD;
  const nu = Number(o.statusId);
  if (nu !== VS_OFFERTE && !(nu === VS_AANBETAALD && doel === VS_BETAALD)) return o;
  await vsL4(env, H, "/v3/Orders/UpdateOrderStatus", { OrderId: Number(v.orderid), StatusId: doel });
  v.orderSinds = v.orderSinds || Date.now();
  vsLog(v, wie, vsGeld(o.betaald) + " betaald: in Logic4 nu " + (doel === VS_BETAALD ? "Volledig betaald" : "30% aanbetaald"));
  return await vsOrderLees(env, H, v.orderid);
}
async function vsMollieLees(env, pid) {
  const r = await fetch("https://api.mollie.com/v2/payments/" + encodeURIComponent(pid), { headers: { "Authorization": "Bearer " + env.MOLLIE_API_KEY } });
  const p = await r.json().catch(() => null);
  return r.ok && p ? p : null;
}
/* Uit de webhook van Mollie. Eerst vastleggen dat het geboekt is, dan pas
   de status: een tweede melding van Mollie boekt zo nooit dubbel. */
async function vsMollieVerwerk(env, H, db, pid) {
  const p = await vsMollieLees(env, pid);
  if (!p || !p.metadata || !p.metadata.voorstel) return { ok: false };
  const v = await vsLees(db, String(p.metadata.voorstel));
  if (!v || !v.orderid) return { ok: false };
  const b = (v.betalingen || []).find(x => x.mollie === pid);
  if (!b) return { ok: false };
  b.status = p.status;
  if (p.status !== "paid" || b.geboekt) { await vsSchrijf(db, v); return { ok: true, status: p.status }; }
  const bedrag = Number(p.amount && p.amount.value) || 0;
  await vsL4(env, H, "/v3/Orders/AddPayment", { OrderId: Number(v.orderid), AmountIncl: bedrag,
    Description: "Aanbetaling voorstel " + v.orderid + " via Mollie " + pid, BookingId: VS_DAGBOEK_MOLLIE, MatchingLedgerId: VS_VOORUIT,
    DateTime: new Date().toISOString().slice(0, 19) });
  b.geboekt = Date.now(); b.bedrag = bedrag;
  vsLog(v, "de klant", "Aanbetaling van " + vsGeld(bedrag) + " betaald via Mollie");
  await vsSchrijf(db, v);
  try { await vsNaarOrder(env, H, v, "het Dashboard", vsBetaald(v)); }
  catch (e) { vsLog(v, "het Dashboard", "Status in Logic4 omzetten lukte nog niet: " + String(e.message || e).slice(0, 200)); }
  await vsSchrijf(db, v);
  await vsBetaalBericht(env, H, v, bedrag).catch(() => {});
  return { ok: true, status: "paid" };
}
async function vsBetaalBericht(env, H, v, bedrag) {
  if (!H.berichtenLees || !H.berichtErbij) return;
  const d = await H.berichtenLees(env);
  const naam = vsNaam(v.klant || {});
  H.berichtErbij(d, { id: "vs-betaald-" + v.id + "-" + Date.now(), aan: [v.adviseur], soort: "voorstel",
    titel: "Aanbetaling binnen: " + naam,
    tekst: naam + " heeft " + vsGeld(bedrag) + " aanbetaald op voorstel " + v.orderid + ". In Logic4 is het nu een order.",
    ref: { voorstel: v.id, link: "voorstel-maken.html?id=" + encodeURIComponent(v.id) } });
  await env.FONTEYN_DATA.put("berichten", JSON.stringify(d));
}
/* Het blok onder het voorstel dat de klant ziet. */
function vsBetaalBlok(v, t) {
  const bedrag = vsAanbetaling(v), al = vsBetaald(v), taal = vsTaal(v), T = vsT(taal), alles = v.betaalwijze === "alles";
  const geld = x => vsGeld(x, taal);
  if (!(bedrag > 0)) return "";
  const binnen = al > 0 && al >= bedrag - 0.01;
  return "<style>.betaal{max-width:800px;margin:16px auto 30px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 26px}" +
    ".betaal h2{color:#144734;font-size:18px;margin:0 0 8px}.betaal p{font-size:15px;line-height:1.55;margin:0 0 12px}" +
    ".betaal a{display:inline-block;background:#15803d;color:#fff;text-decoration:none;border-radius:10px;padding:14px 22px;font-size:16px;font-weight:bold}" +
    "@media(max-width:600px){.betaal{margin:12px;padding:18px 16px}.betaal a{display:block;text-align:center}}@media print{.betaal{display:none}}</style>" +
    "<div class='betaal'>" + (binnen
      ? "<h2>" + T.binnen + "</h2><p>" + T.binnen_p(geld(al)) + "</p>"
      /* Dolf (video 6 nov 2026): niet "Akkoord? Doe je aanbetaling", maar
         dat de producten met de aanbetaling gereserveerd worden. */
      : "<h2>" + (alles ? T.res_kop_alles : T.res_kop) + "</h2><p>" + (alles ? T.res_p_alles(geld(bedrag - al)) : T.res_p(geld(bedrag - al), !al && v.betaalwijze !== "aangepast" && !(Number(v.aanbetaling) > 0 && !v.betaalwijze))) +
        "</p><a href='/voorstel/betaal?t=" + encodeURIComponent(t) + "'>" + (alles ? T.knop_betalen : T.knop_aanbetalen) + "</a>") +
    "</div>";
}
async function vsLinkVoorstel(db, t) {
  const l = t ? await db.prepare("SELECT id FROM voorstel_link WHERE token = ?1 AND soort = 't'").bind(t).first() : null;
  const v = l ? await vsLees(db, l.id) : null;
  return v && v.verstuurdeVersie && v.status !== "gesloten" && v.orderid ? v : null;
}

/* ── Logic4 ─────────────────────────────────────────────────────────────── */
async function vsL4(env, H, pad, body, methode) {
  const token = await H.l4Token(env);
  const r = await fetch("https://api.logic4server.nl" + pad, {
    method: methode || (body === undefined ? "GET" : "POST"),
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await r.text();
  let j = null; try { j = JSON.parse(tekst); } catch (e) {}
  if (!r.ok) throw new Error(pad.split("/").pop() + " gaf " + r.status + ": " + ((j && (j.detail || j.title || j.Message)) || tekst).toString().slice(0, 200));
  return j && j.Records !== undefined ? j.Records : j;
}

/* De debiteur in Logic4 zetten met de bevestigde gegevens. Bestaat hij al
   (de adviseur koos een debiteur), dan alleen bijwerken. Twee stappen bij
   een nieuwe: AddCustomer geeft een leeg nummer, UpdateCustomer (PATCH) vult
   het. Zie relAanmaken in worker.js. */
async function vsDebiteur(env, H, v) {
  const k = v.klant;
  const velden = {
    CompanyName: k.bedrijf || "", FirstName: k.voornaam, Preposition: k.tussenvoegsel, LastName: k.achternaam,
    EmailAddress: k.email, TelephoneNumber: k.telefoon, MobileNumber: k.mobiel,
    Street: k.straat, HouseNumber: k.huisnummer, HouseNumberAddition: k.toevoeging,
    Zipcode: k.postcode, City: k.plaats, CountryCode: k.land, IsoCode: k.land,
    ...(k.btw ? { VatNumber: k.btw } : {}),
    ...(k.aanhef ? { GenderId: Number(k.aanhef) } : {}),
  };
  let id = Number(v.debiteur) || 0;
  if (!id) {
    velden.RelationTypeId = k.bedrijf ? VS_ZAKELIJK : VS_PARTICULIER;
    velden.StatusId = VS_ACTIEF;
    const nieuw = await vsL4(env, H, "/v3/Relations/AddCustomer", {});
    id = Number(typeof nieuw === "number" ? nieuw : (nieuw && (nieuw.Id || nieuw.CustomerId)));
    if (!id) throw new Error("Logic4 gaf een leeg debiteurnummer terug");
  }
  await vsL4(env, H, "/v3/Relations/UpdateCustomer", { Id: id, ...velden }, "PATCH");
  return id;
}

function vsAdres(k, afl) {
  const a = afl && k.afwijkend ? k.aflevering : k;
  return {
    CompanyName: k.bedrijf || "", ContactName: afl && k.afwijkend ? (k.aflevering.naam || vsNaam(k)) : vsNaam(k),
    Street: a.straat, HouseNumber: a.huisnummer, HouseNumberAddition: a.toevoeging,
    PostalCode: a.postcode, City: a.plaats, CountryCode: a.land || k.land || "NL",
    Email: k.email, TelephoneNumber: k.mobiel || k.telefoon,
  };
}

/* De kop van de offerte: alles uit het bovenste deel van het offertescherm. */
function vsKopNaarL4(kop) {
  kop = kop || {};
  const u = {};
  if (kop.referentie !== undefined) u.Reference = vsS(kop.referentie, 100);
  if (kop.omschrijving !== undefined) u.Description = vsS(kop.omschrijving, 200);
  if (kop.memo !== undefined) u.Notes = String(kop.memo || "").slice(0, 4000);
  if (Number(kop.filiaal)) u.BranchId = Number(kop.filiaal);
  if (Number(kop.medewerker)) u.UserId = Number(kop.medewerker);
  if (Number(kop.transporteur)) u.ShippingMethod = { Id: Number(kop.transporteur) };
  if (Number(kop.betaalmethode)) u.PaymentMethod = { Id: Number(kop.betaalmethode) };
  if (kop.leverdatum) u.DeliveryDate = String(kop.leverdatum).slice(0, 10) + "T00:00:00";
  if (kop.verzendkosten !== undefined && kop.verzendkosten !== "") u.Totals = { ShippingCost: Math.round(Number(String(kop.verzendkosten).replace(",", ".")) * 100) / 100 || 0 };
  for (const n of [1, 2, 3, 4]) if (Number(kop["type" + n])) u["OrderType" + n + "Id"] = Number(kop["type" + n]);
  return u;
}

function vsKopStandaard(kop, keuzes, adviseur, v) {
  kop = Object.assign({}, kop || {});
  if (!Number(kop.medewerker)) kop.medewerker = vsMedewerkerVan(keuzes || {}, adviseur) || "";
  if (!Number(kop.type4)) kop.type4 = VS_MAGAZIJN;
  if (v) {
    kop.filiaal = VS_FILIAAL;
    kop.betaalmethode = v.betaalwijze === "alles" ? VS_BETAAL_ALLES : (VS_BETAAL_30[vsTaal(v)] || VS_BETAAL_30.nl);
    kop.btwcode = vsBtwAuto(v).id || "";
    // Op de beurs: de naam van de beurs als referentie, zodat het ook in Logic4 te zien is.
    if (v.beurs) kop.referentie = v.beurs;
    else if (kop.referentie && kop.referentie === v.beursWas) kop.referentie = "";
  }
  return kop;
}
/* De btw-code volgt uit het land en het btw-nummer (Dolf, 6 nov 2026).
   Leeg = zoals bij het artikel (Nederland, 21% of 9%). */
function vsBtwAuto(v) {
  const k = (v && v.klant) || {}, land = String(k.land || "NL").toUpperCase(), c = (v && v.btwCheck) || null;
  if (land === "NL") return { id: "", tekst: "Zoals bij het artikel (Nederland)" };
  if (!VS_EU.has(land)) return { id: VS_BTW_EXPORT, tekst: "0% buiten de EU (export)" };
  const nummerGoed = c && c.geldig && c.nummer === vsBtwSchoon(k.btw);
  if (k.bedrijf && nummerGoed) return { id: VS_BTW_ICL, tekst: "0% binnen de EU: btw-nummer klopt" };
  return { id: VS_BTW_LAND[land] || "", tekst: "Btw van " + land + (k.bedrijf ? " (btw-nummer nog niet goed bevonden)" : " (particulier)") };
}
function vsBtwSchoon(x) { return String(x || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase(); }
/* Kijk het btw-nummer na bij de EU en onthoud de uitkomst bij het voorstel. */
async function vsBtwNakijken(H, v) {
  const nr = vsBtwSchoon(v.klant && v.klant.btw);
  if (!nr) { delete v.btwCheck; return null; }
  if (v.btwCheck && v.btwCheck.nummer === nr && !v.btwCheck.storing) return v.btwCheck;
  if (!H.btwControle) return null;
  const r = await H.btwControle(nr).catch(e => ({ ok: false, storing: true, error: String(e.message || e) }));
  v.btwCheck = { nummer: nr, ts: Date.now(), geldig: !!(r && r.ok && r.geldig), naam: (r && r.naam) || "", storing: !!(r && r.storing), uitleg: (r && (r.error || r.uitleg)) || "" };
  return v.btwCheck;
}

/* ── Instellingen (beheer): vervoerders, codes voor aangepast, beurzen ──── */
async function vsInstellingen(db) {
  const r = await db.prepare("SELECT v FROM voorstel_cache WHERE k = 'instellingen'").first();
  const i = r ? vsJson(r.v, {}) : {};
  return { transporteurs: Array.isArray(i.transporteurs) && i.transporteurs.length ? i.transporteurs : VS_TRANSPORT_STANDAARD,
    codes: Array.isArray(i.codes) ? i.codes : [], beurzen: Array.isArray(i.beurzen) ? i.beurzen : VS_BEURS_STANDAARD };
}
function vsVandaag() { return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" }); }
function vsBeursNu(inst) { const d = vsVandaag(); return (inst.beurzen || []).find(b => b.van && b.tot && b.van <= d && d <= b.tot) || null; }

/* De kop naar Logic4. De status die Logic4 nu heeft gaat ongewijzigd mee:
   stond hier vast 4, dan zette elke kopwijziging een gesloten voorstel of een
   order die intussen betaald is terug op Offerte (proef 31 okt). */
async function vsKopPush(env, H, db, v) {
  if (!v.orderid) return;
  const nu = await vsOrderLees(env, H, v.orderid);
  if (nu && Number(nu.statusId) !== VS_OFFERTE) throw Object.assign(new Error("Dit voorstel is in Logic4 al verder (status " + nu.status + "); de kop blijft zoals hij is."), { code: 409 });
  v.kop = vsKopStandaard(v.kop, await vsKeuzes(env, H, db), v.adviseur, v);
  await vsL4(env, H, "/v3/Orders/AddUpdateOrder", Object.assign({ Id: Number(v.orderid), DebtorId: Number(v.debiteur),
    OrderStatus: { Id: VS_OFFERTE }, CreationDate: new Date(v.aangemaakt || Date.now()).toISOString().slice(0, 19) }, vsKopNaarL4(v.kop)));
}

/* Heeft deze klant precies deze gegevens al eens bevestigd? */
async function vsEerder(db, v) {
  if (!Number(v.debiteur) || !v.klant) return null;
  const r = await db.prepare("SELECT klant, ts FROM voorstel_bevestigd WHERE debiteur = ?1").bind(Number(v.debiteur)).first();
  if (!r) return null;
  const gelijk = JSON.stringify(vsKlantSchoon(vsJson(r.klant, {}))) === JSON.stringify(vsKlantSchoon(v.klant));
  return gelijk ? { ts: r.ts } : { ts: r.ts, anders: true };
}

/* De offerte aanmaken in Logic4. Alleen na de bevestiging van de klant. */
async function vsNaarLogic4(env, H, db, v, wie) {
  if (!["bevestigd", "in-logic4"].includes(v.status)) return { ok: false, error: "Eerst bevestigt de klant zijn gegevens." };
  if (!v.debiteur) {
    v.debiteur = await vsDebiteur(env, H, v);
    vsLog(v, wie, "Debiteur " + v.debiteur + " in Logic4 gezet");
    await vsSchrijf(db, v);
  } else if (!v.debiteurBijgewerkt) {
    await vsDebiteur(env, H, v);
    v.debiteurBijgewerkt = Date.now();
    vsLog(v, wie, "Debiteur " + v.debiteur + " bijgewerkt met de bevestigde gegevens");
    await vsSchrijf(db, v);
  }
  if (v.bevestigd && !v.bevestigd.eerder) {
    await db.prepare("INSERT OR REPLACE INTO voorstel_bevestigd (debiteur, klant, ts, voorstel) VALUES (?1, ?2, ?3, ?4)")
      .bind(Number(v.debiteur), JSON.stringify(v.klant), v.bevestigd.ts || Date.now(), v.id).run();
  }
  if (v.orderid) return { ok: true, orderid: v.orderid };
  /* Marcel (MGS, 30 okt 2026): "bij het aanmaken van een offerte moet je
     altijd een Medewerker kiezen en je moet bij Type 4 'Magazijn'
     selecteren." Leeg = de adviseur zelf en Magazijn. */
  if (v.klant && v.klant.btw) await vsBtwNakijken(H, v).catch(() => null);
  const kop = vsKopStandaard(v.kop, await vsKeuzes(env, H, db), v.adviseur, v);
  if (!Number(kop.medewerker)) return { ok: false, error: "Kies eerst een medewerker bij de gegevens van het voorstel." };
  v.kop = kop;
  const payload = Object.assign({
    OrderStatus: { Id: VS_OFFERTE },
    DebtorId: Number(v.debiteur),
    CreationDate: new Date().toISOString().slice(0, 19),     // verplicht, anders 500
    InvoiceAddress: vsAdres(v.klant, false),
    DeliveryAddress: vsAdres(v.klant, true),
    OrderRows: [],
  }, vsKopNaarL4(kop));
  const j = await vsL4(env, H, "/v3/Orders/AddUpdateOrder", payload);
  const orderid = (typeof j === "number" && j) || (j && (j.Id || (j.Value && j.Value.Id))) || null;
  if (!orderid) throw new Error("Logic4 gaf een leeg nummer terug voor het voorstel");
  v.orderid = Number(orderid);
  v.status = "in-logic4";
  vsLog(v, wie, "Voorstel " + v.orderid + " staat in Logic4");
  await vsSchrijf(db, v);
  return { ok: true, orderid: v.orderid };
}

/* De offerte zoals Logic4 hem nu heeft: kop, regels en totalen. De tegel
   laat altijd dít zien, zodat er nooit iets anders op het scherm staat dan
   in Logic4. */
async function vsOrderLees(env, H, orderid) {
  const r = await vsL4(env, H, "/v3/Orders/GetOrders", { Id: Number(orderid), TakeRecords: 1 });
  const o = (Array.isArray(r) ? r : [])[0];
  if (!o) return null;
  let regels = Array.isArray(o.OrderRows) ? o.OrderRows : [];
  if (!regels.length) {
    const rr = await vsL4(env, H, "/v3/Orders/GetOfferRows", { OrderId: Number(orderid) }).catch(() => null);
    if (Array.isArray(rr)) regels = rr;
  }
  const t = o.Totals || {};
  return {
    id: o.Id, status: (o.OrderStatus && (o.OrderStatus.Description || VS_STATUSNAAM[o.OrderStatus.Id] || o.OrderStatus.Id)) || "",
    statusId: o.OrderStatus && o.OrderStatus.Id,
    kop: {
      referentie: o.Reference || "", omschrijving: o.Description || "", memo: o.Notes || "",
      filiaal: o.BranchId || "", medewerker: o.UserId || "",
      transporteur: (o.ShippingMethod && o.ShippingMethod.Id) || "", betaalmethode: (o.PaymentMethod && o.PaymentMethod.Id) || "",
      leverdatum: o.DeliveryDate ? String(o.DeliveryDate).slice(0, 10) : "",
      type1: o.OrderType1Id || "", type2: o.OrderType2Id || "", type3: o.OrderType3Id || "", type4: o.OrderType4Id || "",
      verzendkosten: t.ShippingCost != null ? t.ShippingCost : "",
    },
    regels: regels.map(x => ({
      id: x.Id, code: x.ProductCode || "", oms: x.Description || "", oms2: x.Description2 || "",
      aantal: Number(x.Qty) || 0, bruto: Number(x.GrossPrice) || 0, netto: Number(x.NettPrice) || 0,
      korting: Number(x.DiscountPercent) || 0, btw: Number(x.VATPercentage) || 0, incl: Number(x.InclPrice) || 0,
      magazijn: x.WarehouseId || "", notitie: x.Notes || "", vervallen: (Number(x.Qty) || 0) === 0,
    })),
    totaal: {
      /* AmountEx is zonder verzendkosten, AmountIncl mét (proef 30 okt). */
      ex: Math.round(((Number(t.AmountEx) || 0) + (Number(t.ShippingCost) || 0)) * 100) / 100, incl: Number(t.AmountIncl) || 0,
      btw: Math.round(((Number(t.AmountIncl) || 0) - (Number(t.AmountEx) || 0) - (Number(t.ShippingCost) || 0)) * 100) / 100,
      verzend: Number(t.ShippingCost) || 0,
    },
    // Staat in Totals (zie worker.js); bovenin de order staat het niet (proef 4 nov 2026).
    betaald: Math.round((Number(t.Calc_TotalPayed || o.Calc_TotalPayed || 0) || 0) * 100) / 100,
  };
}

/* Eén regel toevoegen of aanpassen. AddUpdateOrderRow VERVANGT een regel:
   bij aanpassen gaat dus altijd de hele regel mee (zie qbHandlePrijzenBijwerken). */
async function vsRegel(env, H, v, r, oud) {
  const code = vsS(r.code || (oud && oud.code), 40);
  if (!code) throw new Error("Kies eerst een artikel.");
  const aantal = Number(r.aantal);
  const regel = {
    OrderId: Number(v.orderid), DebtorId: Number(v.debiteur), ProductCode: code,
    Qty: isFinite(aantal) ? aantal : 1,
  };
  if (oud && oud.id) regel.Id = Number(oud.id);
  const oms = r.oms !== undefined ? r.oms : (oud && oud.oms);
  if (oms) regel.Description = vsS(oms, 250);
  const oms2 = r.oms2 !== undefined ? r.oms2 : (oud && oud.oms2);
  if (oms2) regel.Description2 = vsS(oms2, 250);
  const notitie = r.notitie !== undefined ? r.notitie : (oud && oud.notitie);
  if (notitie) regel.Notes = String(notitie).slice(0, 1000);
  const btw = Number((v.kop || {}).btwcode);
  if (btw) regel.VatCodeIdOverrule = btw;
  const mag = Number(r.magazijn || (oud && oud.magazijn));
  if (mag) regel.WarehouseId = mag;
  /* Prijs: met de hand gezet, of een korting op de brutoprijs. Niets
     ingevuld = Logic4 zet zelf de prijs uit de prijslijst van de klant. */
  const bruto = Number(r.bruto != null && r.bruto !== "" ? r.bruto : (oud && oud.bruto)) || 0;
  if (r.netto != null && r.netto !== "") {
    regel.NettPrice = Math.round(Number(r.netto) * 10000) / 10000;
    regel.GrossPrice = bruto || regel.NettPrice;
  } else if (r.korting != null && r.korting !== "" && bruto) {
    regel.GrossPrice = bruto;
    regel.NettPrice = Math.round(bruto * (1 - Number(r.korting) / 100) * 10000) / 10000;
  } else if (oud && oud.id && (oud.bruto || oud.netto)) {
    // Aanpassen zonder nieuwe prijs: de bestaande prijs blijft staan.
    regel.GrossPrice = oud.bruto; regel.NettPrice = oud.netto;
  } else {
    /* Logic4 zet via de koppeling zelf géén prijs op een regel (proef 30 okt:
       prijs 0). Dus de verkoopprijs voor deze klant ophalen, net als de
       werkbon van de servicemonteur doet. Met korting erop als die er is. */
    const p = await vsPrijs(env, H, code, v.debiteur, regel.Qty);
    if (p) {
      regel.GrossPrice = p;
      regel.NettPrice = r.korting != null && r.korting !== "" ? Math.round(p * (1 - Number(r.korting) / 100) * 10000) / 10000 : p;
    }
  }
  return vsL4(env, H, "/v3/Orders/AddUpdateOrderRow", regel);
}

async function vsPrijs(env, H, code, debiteur, aantal) {
  const j = await vsL4(env, H, "/v3/Products/GetPriceInformationForProduct", { ProductCode: String(code), DebtorId: Number(debiteur) || null }).catch(() => null);
  const st = (j && Array.isArray(j.ShiftPrices) ? j.ShiftPrices : []).filter(x => Number(x.Qty || 1) <= Math.max(1, Number(aantal) || 1)).sort((a, b) => Number(b.Qty || 1) - Number(a.Qty || 1));
  const p = st[0] || (j && j.ShiftPrices && j.ShiftPrices[0]);
  const excl = p ? Number(p.SellPriceExcl || p.SellPriceGrossExcl || 0) : 0;
  return excl > 0 ? Math.round(excl * 10000) / 10000 : null;
}

/* ── Keuzelijsten voor de kop (een keer per dag vers) ────────────────────── */
async function vsKeuzes(env, H, db) {
  const c = await db.prepare("SELECT v, ts FROM voorstel_cache WHERE k = 'keuzes2'").first();
  if (c && Date.now() - c.ts < 86400000) return vsJson(c.v, {});
  const naam = (x) => x.Description || x.Name || x.Naam || x.FullName || [x.FirstName, x.LastName].filter(Boolean).join(" ") || String(x.Id);
  const lijst = async (pad, body) => { try { const r = await vsL4(env, H, pad, body); return (Array.isArray(r) ? r : []).map(x => ({ id: x.Id, naam: naam(x) })).filter(x => x.id); } catch (e) { return []; } };
  /* Logic4 houdt oude keuzes in de lijst met "ZZ", "NIET GEBRUIKEN" of een
     lege naam ervoor. Die laten we weg; de rest op naam. */
  const oud = (n) => !String(n).trim() || /^z+[\s-]*(oud|niet)|niet (meer )?gebruiken|^test$|^hfhhf$/i.test(String(n).trim());
  const netjes = (l) => l.map(x => ({ id: x.id, naam: String(x.naam).split(/\r?\n/)[0].trim() })).filter(x => !oud(x.naam)).sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
  let medewerkers = [];
  try {
    const r = await vsL4(env, H, "/v3/User/GetAllUsers");
    const arr = Array.isArray(r) ? r : ((r && (r.Users || r.Records || r.Items)) || []);
    medewerkers = arr.map(u => ({ id: u.UserId != null ? u.UserId : u.Id, naam: String(u.FullName || u.Username || "").trim(), login: String(u.Username || "").toLowerCase() }))
      .filter(u => u.id != null && u.naam && !/^zz[\s-]*oud\b/i.test(u.naam)).sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
  } catch (e) {}
  const k = {
    filialen: netjes(await lijst("/v3/Company/GetBranches")),
    medewerkers,
    /* Met het standaardbedrag (ex btw) uit Logic4, zodat de verzendkosten er
       meteen bij staan als de adviseur een vervoerder kiest (Dolf, 6 nov 2026). */
    transporteurs: await (async () => {
      try {
        const r = await vsL4(env, H, "/v3/Shippers/GetShippingMethods");
        return (Array.isArray(r) ? r : []).map(x => ({ id: x.Id, naam: String(String(x.Description || "").trim() || x.Name || "").split(/\r?\n/)[0].trim(), intern: String(x.Name || "").trim(),
          bedrag: Math.round((Number(x.BasicAmount) || 0) * 100) / 100 })).filter(x => x.id && !oud(x.naam) && !/^zz/i.test(x.intern)).sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
      } catch (e) { return []; }
    })(),
    betaalmethoden: netjes(await lijst("/v3/Financial/GetPaymentMethods")),
    btwcodes: netjes(await lijst("/v3/Financial/GetVatCodes")).filter(x => !/inkopen/i.test(x.naam)),
    types: {},
  };
  /* De vrije keuzevelden: welke nummers komen voor op de orders van de
     laatste maanden. Namen zover bekend. */
  try {
    const van = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 19);
    const tel = { 1: {}, 2: {}, 3: {}, 4: {} };
    for (let skip = 0; skip < 1500; skip += 500) {
      const r = await vsL4(env, H, "/v3/Orders/GetOrders", { CreationDateFrom: van, TakeRecords: 500, SkipRecords: skip });
      if (!Array.isArray(r) || !r.length) break;
      for (const o of r) for (const n of [1, 2, 3, 4]) { const x = o["OrderType" + n + "Id"]; if (x) tel[n][x] = (tel[n][x] || 0) + 1; }
      if (r.length < 500) break;
    }
    for (const n of [1, 2, 3, 4]) {
      k.types[n] = { naam: VS_TYPES[n].naam, keuzes: Object.entries(tel[n]).sort((a, b) => b[1] - a[1])
        .map(([id, aantal]) => ({ id: Number(id), naam: VS_TYPES[n].bekend[id] || ("Keuze " + id), aantal })) };
    }
  } catch (e) {}
  await db.prepare("INSERT OR REPLACE INTO voorstel_cache (k, v, ts) VALUES ('keuzes2', ?1, ?2)").bind(JSON.stringify(k), Date.now()).run();
  return k;
}

/* De Logic4-gebruiker van de adviseur, voor het veld Medewerker. */
function vsMedewerkerVan(keuzes, wie) {
  const kort = String(wie || "").toLowerCase().replace(/@.*$/, "").replace(/^fonteyn\./, "").replace(/[._-]+/g, " ").trim();
  if (!kort) return null;
  const mail = String(wie || "").toLowerCase();
  const m = (keuzes.medewerkers || []).find(x => x.login && (x.login === mail || x.login === kort || x.login.replace(/@.*$/, "") === kort))
    || (keuzes.medewerkers || []).find(x => String(x.naam).toLowerCase() === kort)
    || (keuzes.medewerkers || []).find(x => String(x.naam).toLowerCase().split(/\s+/)[0] === kort.split(" ")[0]);
  return m ? m.id : null;
}

/* ── Klant zoeken in Logic4 ─────────────────────────────────────────────── */
function vsKlantUitL4(c) {
  return {
    debiteur: c.Id,
    klant: vsKlantSchoon({
      aanhef: c.GenderId || (c.Gender && c.Gender.Id) || "", voornaam: c.FirstName, tussenvoegsel: c.Preposition, achternaam: c.LastName,
      bedrijf: c.CompanyName, btw: c.VatNumber, straat: c.Street, huisnummer: c.HouseNumber, toevoeging: c.HouseNumberAddition,
      postcode: c.Zipcode, plaats: c.City, land: c.IsoCode || c.CountryCode || "NL", email: c.EmailAddress,
      telefoon: c.TelephoneNumber, mobiel: c.MobileNumber,
    }),
    soort: (c.Type && c.Type.Description) || "",
  };
}
async function vsKlantZoek(env, H, q) {
  q = String(q || "").trim();
  if (q.length < 3) return { ok: true, treffers: [] };
  let r = [];
  if (/^\d{1,12}$/.test(q)) r = await vsL4(env, H, "/v3/Relations/GetCustomers", { Id: Number(q), TakeRecords: 1 });
  else if (q.includes("@")) r = await vsL4(env, H, "/v3/Relations/GetCustomers", { EmailAddress: q, TakeRecords: 10 });
  else return { ok: true, treffers: [], uitleg: "Zoek op e-mailadres of debiteurnummer." };
  return { ok: true, treffers: (Array.isArray(r) ? r : []).filter(c => !/^\d+$/.test(q) || c.Id === Number(q)).map(vsKlantUitL4) };
}

/* ── Artikelen zoeken ──────────────────────────────────────────────────────
   Gerrit (4 nov 2026): "je moet alle producten kunnen toevoegen die bekend
   zijn in Logic4, net zoals je dat in Logic4 ook zou doen." Logic4 zoekt zelf
   op code, naam en barcode, ook op meer woorden tegelijk. De tegel liet er
   maar 15 zien, zonder prijs en zonder vervallen artikelen. Nu: alles wat
   Logic4 vindt, de code die precies klopt bovenaan, vervallen onderaan. */
const VS_ZOEK_MAX = 300;
async function vsArtikel(env, H, q) {
  q = String(q || "").trim();
  if (q.length < 2) return { ok: true, artikelen: [] };
  const r = await vsL4(env, H, "/v3/Products/GetProducts", { FastSearchText: q, TakeRecords: VS_ZOEK_MAX });
  const l = (Array.isArray(r) ? r : []).filter(x => x.ProductCode);
  const ql = q.toLowerCase();
  const plek = x => { const c = String(x.ProductCode).toLowerCase(); return (c === ql ? 0 : c.startsWith(ql) ? 1 : 2) * 10 + (Number(x.StatusId) === 10 ? 5 : 0); };
  const rij = l.map((x, i) => ({ x, i, p: plek(x) })).sort((a, b) => a.p - b.p || a.i - b.i);
  return { ok: true, meer: l.length >= VS_ZOEK_MAX, artikelen: rij.slice(0, 120).map(({ x }) => ({
    code: String(x.ProductCode), oms: String(x.ProductName1 || x.Description || ""),
    status: String(x.Statusname || ""), vervallen: Number(x.StatusId) === 10,
    voorraad: x.FreeStock != null ? Number(x.FreeStock) : null,
    prijs: Math.round((Number(x.SellPriceGross) || 0) * 100) / 100 || null, btw: Number(x.VatPercent) || 0,
  })) };
}

/* ── Demo (Gerrit, 4 nov 2026) ─────────────────────────────────────────────
   "Maak een demo waarmee ik mensen kan laten zien hoe dit werkt." De tegel
   speelt het hele voorstel na met een voorbeeldklant; er gaat niets naar
   Logic4, Mollie of een klant. Hier alleen de pagina's die de klant op zijn
   telefoon ziet, precies zoals het echte voorstel ze maakt. */
async function vsDemo(env, H, db, b, wie) {
  const v = { klant: vsKlantSchoon(b.klant), aanbetaling: Number(b.aanbetaling) || 0, betaalwijze: ["30", "alles", "aangepast"].includes(b.betaalwijze) ? b.betaalwijze : "30", taal: VS_TALEN[b.taal] ? b.taal : "" };
  const taal = vsTaal(v), T = vsT(taal);
  const pagina = async (titel, inhoud) => (await vsPagina(titel, inhoud, taal).text());
  const regels = (Array.isArray(b.regels) ? b.regels : []).filter(r => !r.vervallen && Number(r.aantal)).slice(0, 60).map(r => {
    const netto = Number(r.netto) || 0, btw = Number(r.btw) || 0, bruto = Number(r.bruto) || 0;
    return { code: vsS(r.code, 40), oms: vsS(r.oms, 250), aantal: Number(r.aantal), stukEx: netto, stukIncl: Math.round(netto * (1 + btw / 100) * 100) / 100, btw,
      bruto, korting: bruto && netto < bruto ? Math.round((1 - netto / bruto) * 1000) / 10 : 0 };
  });
  const t = b.totaal || {};
  const kop = b.kop || {};
  const d = { nummer: "DEMO", datum: Date.now(), geldigTot: kop.vervaldatum || "", taal, klant: v.klant, zakelijk: !!(v.klant.bedrijf || v.klant.btw),
    referentie: "", omschrijving: vsS(kop.omschrijving, 200), betaalmethode: v.betaalwijze === "alles" ? T.balles : v.betaalwijze === "aangepast" ? T.beigen(vsGeld(v.aanbetaling, taal)) : T.b30, transporteur: "", leverdatum: "",
    adviseur: { naam: vsS(b.adviseur) || wie.replace(/@.*/, ""), mail: vsAdviseurMail(wie) },
    regels, totaal: { ex: Number(t.ex) || 0, incl: Number(t.incl) || 0, btw: Number(t.btw) || 0, verzend: Number(t.verzend) || 0 } };
  v.verstuurdeVersie = d;
  if (b.betaald) v.betalingen = [{ geboekt: 1, bedrag: Number(b.betaald) }];
  switch (b.stap) {
    case "mail": return vsMailHtml(v, vsBasis(env) + "/bevestig?t=voorbeeld");
    case "bevestig": return pagina(T.ond_bevestig, vsBevestigInhoud(v.klant, taal, "#", "", "<a class='knop grijs' href='#aanpassen'>" + vsEsc(T.klopt_niet) + "</a>"));
    case "aanpassen": return pagina(T.aanpassen, "<h1>" + vsEsc(T.aanpassen) + "</h1><p>" + vsEsc(T.aanpassen_p) + "</p>" + vsFormulier("demo", v.klant, taal));
    case "bedankt": return pagina(T.bedankt, vsBedankt(taal));
    case "voorstelmail": return vsVoorstelMailHtml(v, d, vsBasis(env) + "/voorstel/bekijk?t=voorbeeld", b.tekst);
    case "voorstel": return vsDocHtml(d, { voet: vsBetaalBlok(v, "demo") });
    case "betaald": return pagina(T.binnen, "<h1>" + vsEsc(T.binnen) + "</h1><p>" + vsEsc(T.binnen_p(vsGeld(b.betaald, taal))) + "</p>");
  }
  return pagina("Demo", "<h1>Demo</h1>");
}

/* ── Mail "Bevestig je gegevens" ────────────────────────────────────────── */
function vsLink(env, token) { return (env.SVC_LINK_BASIS || "https://fonteyn-data-store.g-mulder.workers.dev") + "/bevestig?t=" + encodeURIComponent(token); }
function vsAdviseurMail(wie) {
  wie = String(wie || "").toLowerCase();
  if (wie.includes("@")) return wie;
  const kort = wie.replace(/^fonteyn\./, "");
  return kort ? kort + "@fonteyn.nl" : "";
}
/* DE TEKST IS EEN VOORLOPIGE. Gerrit (30 okt 2026): de tekst van de mail
   komt van Marcel; tot die er is staat hier een korte versie. */
function vsMailHtml(v, link) {
  const k = v.klant || {}, T = vsT(vsTaal(v));
  /* Klanten spreken we altijd aan met je (Gerrit, 31 okt 2026). */
  const aanhef = T.beste(k.voornaam || vsNaam(k));
  return "<div style='font-family:Arial,Helvetica,sans-serif;background:#f5f4ef;padding:20px'><div style='max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden'>" +
    "<div style='background:#144734;padding:16px 20px'><img src='" + VS_LOGO + "' alt='Fonteyn' style='height:44px;display:block'></div>" +
    "<div style='padding:22px'><p style='font-size:15px;line-height:1.55'>" + vsEsc(aanhef) + ",</p>" +
    "<p style='font-size:15px;line-height:1.55'>" + vsEsc(T.mail_bevestig) + "</p>" +
    "<p style='margin:22px 0'><a href='" + vsEsc(link) + "' style='background:#15803d;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:bold;font-size:16px;display:inline-block'>" + vsEsc(T.knop_bevestig) + "</a></p>" +
    "<p style='font-size:13px;color:#6b7280;line-height:1.5'>" + vsEsc(T.link_kopie) + "<br>" + vsEsc(link) + "</p>" +
    "<p style='font-size:15px;line-height:1.55'>" + vsEsc(T.groet) + "<br>Fonteyn</p></div></div></div>";
}
async function vsMailStuur(env, H, v, wie, onderwerp, html) {
  const naar = v.klant && v.klant.email;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(naar || "")) return { ok: false, error: "Vul eerst een geldig e-mailadres van de klant in." };
  onderwerp = onderwerp || vsT(vsTaal(v)).ond_bevestig;
  html = html || vsMailHtml(v, vsLink(env, v.token));
  const adviseur = vsAdviseurMail(v.adviseur || wie);
  // Proef: alles naar één adres zolang de tegel in aanbouw is.
  const aan = env.VS_PROEF_AAN ? [env.VS_PROEF_AAN] : [naar];
  if (H.ewsVerstuur && env.EWS_GEBRUIKER && env.EWS_WACHTWOORD && adviseur) {
    const e = await H.ewsVerstuur(env, adviseur, aan, onderwerp, html).catch(x => ({ ok: false, error: String(x && x.message || x) }));
    if (e && e.ok) return { ok: true, via: adviseur, naar: aan.join(", ") };
  }
  if (!env.RESEND_API_KEY || !(env.MAIL_FROM_FONTEYN || env.MAIL_FROM)) return { ok: false, error: "Het mailen is in de worker nog in te richten." };
  const bron = env.MAIL_FROM_FONTEYN || env.MAIL_FROM;
  const adres = (String(bron).match(/<([^>]+)>/) || [])[1] || String(bron);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Fonteyn <" + adres + ">", to: aan, ...(adviseur ? { reply_to: [adviseur] } : {}), subject: onderwerp, html }),
  });
  if (!r.ok) return { ok: false, error: "Versturen lukte nog niet (" + r.status + ")." };
  return { ok: true, via: "Fonteyn", naar: aan.join(", ") };
}

/* ── Het voorstel zelf: om te printen en om naar de klant te sturen ──────── */
/* Gerrit (31 okt 2026): "Ga door met voorstel naar de klant sturen en
   printen." Logic4 maakt zijn offerte-pdf alleen in het programma zelf, niet
   via de koppeling. Dus tekent het Dashboard het voorstel als pagina: de
   adviseur print die (of slaat hem op als pdf), en de klant krijgt een mail
   met een link ernaartoe. Wat de klant ziet is de stand op het moment van
   versturen; latere wijzigingen gaan pas mee bij opnieuw versturen. */
function vsDocLink(env, v) { return (env.SVC_LINK_BASIS || "https://fonteyn-data-store.g-mulder.workers.dev") + "/voorstel/bekijk?t=" + encodeURIComponent(v.bekijkToken); }
function vsGeld(x, taal) { return "\u20ac " + (Math.round((Number(x) || 0) * 100) / 100).toLocaleString(VS_LOCALE[taal] || "nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function vsDatum(t, taal) { const d = t ? new Date(t) : null; return d && !isNaN(d) ? d.toLocaleDateString(VS_LOCALE[taal] || "nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }) : ""; }
/* Alles wat op het papier komt, in één keer bij elkaar. */
async function vsDocGegevens(env, H, db, v) {
  const o = await vsOrderLees(env, H, v.orderid);
  if (!o) throw new Error("Logic4 gaf dit voorstel even terug zonder inhoud. Probeer het zo nog eens.");
  const k = await vsKeuzes(env, H, db);
  const naamVan = (lijst, id) => ((k[lijst] || []).find(x => String(x.id) === String(id)) || {}).naam || "";
  const mw = (k.medewerkers || []).find(x => String(x.id) === String(o.kop.medewerker)) || {};
  const adviseurMail = /@/.test(mw.login || "") ? mw.login : vsAdviseurMail(v.adviseur);
  const taal = vsTaal(v), T = vsT(taal);
  const wijze = v.betaalwijze === "alles" ? T.balles : (v.betaalwijze === "aangepast" || (!v.betaalwijze && Number(v.aanbetaling) > 0)) ? T.beigen(vsGeld(v.aanbetaling, taal)) : T.b30;
  return {
    nummer: o.id, datum: Date.now(), geldigTot: v.vervaldatum || "", taal,
    klant: v.klant, zakelijk: !!(v.klant && (v.klant.bedrijf || v.klant.btw)),
    referentie: "", omschrijving: o.kop.omschrijving,
    betaalmethode: wijze, transporteur: naamVan("transporteurs", o.kop.transporteur),
    leverdatum: o.kop.leverdatum && o.kop.leverdatum < "2099" ? o.kop.leverdatum : "",
    adviseur: { naam: mw.naam || String(v.adviseur || "").replace(/@.*/, ""), mail: adviseurMail },
    regels: o.regels.filter(r => !r.vervallen && r.aantal).map(r => ({ code: r.code, oms: r.oms, oms2: r.oms2, aantal: r.aantal,
      stukEx: r.netto, stukIncl: Math.round(r.netto * (1 + r.btw / 100) * 100) / 100, btw: r.btw,
      bruto: r.bruto, korting: r.bruto && r.netto < r.bruto ? Math.round((1 - r.netto / r.bruto) * 1000) / 10 : 0 })),
    totaal: o.totaal,
  };
}
function vsDocHtml(d, opties) {
  opties = opties || {};
  const k = d.klant || {}, a = k.aflevering || {}, taal = d.taal || "nl", T = vsT(taal);
  const geld = x => vsGeld(x, taal), datum = x => vsDatum(x, taal);
  const regel = (l, w) => w ? "<tr><td>" + vsEsc(l) + "</td><td>" + vsEsc(w) + "</td></tr>" : "";
  const adres = [[k.straat, [k.huisnummer, k.toevoeging].filter(Boolean).join(" ")].filter(Boolean).join(" "), [k.postcode, k.plaats].filter(Boolean).join(" "), k.land && k.land !== "NL" ? k.land : ""].filter(Boolean);
  const incl = !d.zakelijk;   // particulier: prijzen met btw; zakelijk: zonder
  const rij = r => "<tr><td>" + vsEsc(r.oms) + (r.oms2 && r.oms2.trim() !== String(r.oms).trim() ? "<div class='klein'>" + vsEsc(r.oms2) + "</div>" : "") + "<div class='klein'>" + T.artikel + " " + vsEsc(r.code) + (r.korting ? " &middot; " + vsEsc(String(r.korting).replace(".", ",")) + "% " + T.korting : "") + "</div></td>" +
    "<td class='g'>" + vsEsc(String(r.aantal).replace(".", ",")) + "</td><td class='g stuk'>" + geld(incl ? r.stukIncl : r.stukEx) + "</td><td class='g'>" + geld((incl ? r.stukIncl : r.stukEx) * r.aantal) + "</td></tr>";
  const t = d.totaal || {};
  return "<!doctype html><html lang='" + taal + "'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>" +
    "<title>" + T.voorstel + " " + vsEsc(d.nummer) + " - Fonteyn</title><meta name='robots' content='noindex'><style>" +
    "body{margin:0;background:#f5f4ef;font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:14px}" +
    ".vel{max-width:800px;margin:20px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}" +
    ".kop{background:#144734;padding:18px 26px;display:flex;align-items:center;gap:16px}.kop img{height:52px;display:block}.kop .t{margin-left:auto;color:#fff;text-align:right}.kop .t b{display:block;font-size:20px}" +
    ".in{padding:24px 26px 28px}.twee{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:18px}@media(max-width:600px){.twee{grid-template-columns:1fr}.in{padding:18px 14px}.stuk{display:none}table.r th{letter-spacing:0}}" +
    "h3{margin:0 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#144734}p{margin:0;line-height:1.5}" +
    "table.geg{border-collapse:collapse}table.geg td{padding:2px 12px 2px 0;vertical-align:top}table.geg td:first-child{color:#6b7280}" +
    "table.r{width:100%;border-collapse:collapse;margin-top:6px}table.r th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;border-bottom:2px solid #144734;padding:7px 6px}" +
    "table.r td{padding:9px 6px;border-bottom:1px solid #eee;vertical-align:top}.g{text-align:right;white-space:nowrap}table.r th.g{text-align:right}.klein{font-size:12px;color:#6b7280;margin-top:2px}" +
    ".tot{margin:14px 0 0 auto;border-collapse:collapse}.tot td{padding:4px 6px}.tot td:last-child{text-align:right;min-width:110px}.tot .groot td{font-weight:bold;font-size:16px;border-top:2px solid #144734;padding-top:8px}" +
    ".knop{display:inline-block;background:#144734;color:#fff;border:0;border-radius:10px;padding:12px 18px;font-size:15px;font-weight:bold;cursor:pointer;font-family:inherit}" +
    ".balk{max-width:800px;margin:16px auto 0;text-align:right}" +
    "@media print{body{background:#fff}.balk{display:none}.vel{border:0;margin:0;max-width:none;border-radius:0}.kop{-webkit-print-color-adjust:exact;print-color-adjust:exact}}" +
    "</style></head><body>" +
    "<div class='balk'><button class='knop' onclick='window.print()' title='" + vsEsc(T.printen) + "'>" + vsEsc(T.printen) + "</button></div>" +
    "<div class='vel'><div class='kop'><img src='" + VS_LOGO + "' alt='Fonteyn'><div class='t'><b>" + T.voorstel + " " + vsEsc(d.nummer) + "</b>" + vsEsc(datum(d.datum)) + "</div></div><div class='in'>" +
    "<div class='twee'><div><h3>" + T.voor + "</h3><p><b>" + vsEsc(k.bedrijf || vsNaam(k)) + "</b>" + (k.bedrijf ? "<br>" + T.tav + " " + vsEsc(vsNaam(k)) : "") + "<br>" + adres.map(vsEsc).join("<br>") + "</p>" +
      (k.afwijkend ? "<h3 style='margin-top:12px'>" + T.afleveradres + "</h3><p>" + [a.naam, [a.straat, [a.huisnummer, a.toevoeging].filter(Boolean).join(" ")].join(" "), [a.postcode, a.plaats].filter(Boolean).join(" ")].filter(x => String(x).trim()).map(vsEsc).join("<br>") + "</p>" : "") + "</div>" +
    "<div><h3>" + T.gegevens + "</h3><table class='geg'>" + regel(T.voorstel, d.nummer) + regel(T.datum, datum(d.datum)) + regel(T.geldig, d.geldigTot ? datum(d.geldigTot) : "") +
      regel(T.referentie, d.referentie) + regel(T.betaling, d.betaalmethode) + regel(T.levering, d.transporteur) + regel(T.leverdatum, d.leverdatum ? datum(d.leverdatum) : "") +
      regel(T.adviseur, d.adviseur.naam) + regel(T.mail, d.adviseur.mail) + "</table></div></div>" +
    (d.omschrijving ? "<p style='margin-bottom:12px'><b>" + vsEsc(d.omschrijving) + "</b></p>" : "") +
    "<table class='r'><thead><tr><th>" + T.omschrijving + "</th><th class='g'>" + T.aantal + "</th><th class='g stuk'>" + T.stukprijs + " " + (incl ? T.incl : T.excl) + "</th><th class='g'>" + T.totaal + "</th></tr></thead><tbody>" + d.regels.map(rij).join("") + "</tbody></table>" +
    "<table class='tot'>" + (t.verzend ? "<tr><td>" + T.verzend + "</td><td>" + geld(t.verzend) + "</td></tr>" : "") +
      "<tr><td>" + T.tot_ex + "</td><td>" + geld(t.ex) + "</td></tr><tr><td>" + T.btw_kort + "</td><td>" + geld(t.btw) + "</td></tr><tr class='groot'><td>" + T.tot_incl + "</td><td>" + geld(t.incl) + "</td></tr></table>" +
    "<p class='klein' style='margin-top:24px'>" + vsEsc(T.vragen(d.adviseur.naam)) + "</p>" +
    "</div></div>" + (opties.voet || "") + "</body></html>";
}
function vsVoorstelMailHtml(v, d, link, tekst) {
  const k = v.klant || {}, taal = d.taal || vsTaal(v), T = vsT(taal);
  /* Klanten spreken we altijd aan met je (Gerrit, 31 okt 2026). */
  const aanhef = T.beste(k.voornaam || vsNaam(k));
  const alinea = String(tekst || T.mail_vs)
    .split(/\n{2,}/).map(x => "<p style='font-size:15px;line-height:1.55'>" + vsEsc(x).replace(/\n/g, "<br>") + "</p>").join("");
  return "<div style='font-family:Arial,Helvetica,sans-serif;background:#f5f4ef;padding:20px'><div style='max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden'>" +
    "<div style='background:#144734;padding:16px 20px'><img src='" + VS_LOGO + "' alt='Fonteyn' style='height:44px;display:block'></div>" +
    "<div style='padding:22px'><p style='font-size:15px;line-height:1.55'>" + vsEsc(aanhef) + ",</p>" + alinea +
    "<table style='border-collapse:collapse;margin:16px 0;font-size:14px'><tr><td style='color:#6b7280;padding:3px 14px 3px 0'>" + T.voorstel + "</td><td><b>" + vsEsc(d.nummer) + "</b></td></tr>" +
    "<tr><td style='color:#6b7280;padding:3px 14px 3px 0'>" + T.tot_incl + "</td><td><b>" + vsGeld(d.totaal.incl, taal) + "</b></td></tr>" +
    (d.geldigTot ? "<tr><td style='color:#6b7280;padding:3px 14px 3px 0'>" + T.geldig + "</td><td>" + vsEsc(vsDatum(d.geldigTot, taal)) + "</td></tr>" : "") + "</table>" +
    "<p style='margin:22px 0'><a href='" + vsEsc(link) + "' style='background:#15803d;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:bold;font-size:16px;display:inline-block'>" + vsEsc(T.knop_vs) + "</a></p>" +
    "<p style='font-size:15px;line-height:1.55'>" + vsEsc(T.groet) + "<br>" + vsEsc(d.adviseur.naam || "Fonteyn") + "<br><span style='color:#6b7280'>Fonteyn" + (d.adviseur.mail ? " &middot; " + vsEsc(d.adviseur.mail) : "") + "</span></p></div></div></div>";
}

/* ── De pagina voor de klant ────────────────────────────────────────────── */
function vsPagina(titel, inhoud, taal) {
  return new Response("<!doctype html><html lang='" + (VS_TALEN[taal] ? taal : "nl") + "'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>" +
    "<title>" + vsEsc(titel) + " - Fonteyn</title><meta name='robots' content='noindex'>" +
    "<style>body{margin:0;background:#f5f4ef;font-family:Arial,Helvetica,sans-serif;color:#1f2937}" +
    ".kop{background:#144734;padding:16px 20px}.kop img{height:48px;display:block}" +
    ".blok{max-width:560px;margin:22px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:22px 22px 26px}" +
    "@media(max-width:600px){.blok{margin:12px 12px;padding:18px 16px 22px}}" +
    "h1{color:#144734;font-size:21px;margin:0 0 10px}p{font-size:15px;line-height:1.55;margin:0 0 12px}" +
    "table.geg{width:100%;border-collapse:collapse;font-size:15px;margin:6px 0 14px}table.geg td{padding:7px 4px;border-bottom:1px solid #f0f0ea;vertical-align:top}table.geg td:first-child{color:#6b7280;width:40%}" +
    ".knop{display:block;width:100%;box-sizing:border-box;border:0;border-radius:10px;padding:15px 18px;font-size:16px;font-weight:bold;cursor:pointer;color:#fff;margin-top:10px;text-align:center;text-decoration:none;font-family:inherit}" +
    ".groen{background:#15803d}.grijs{background:#fff;color:#144734;border:1px solid #d1d5db}" +
    ".rij{display:grid;grid-template-columns:1fr 1fr;gap:10px}.rij3{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px}@media(max-width:480px){.rij,.rij3{grid-template-columns:1fr}}" +
    "label{display:block;font-size:13px;color:#374151;margin:10px 0 4px}input,select{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:10px;border:1px solid #d1d5db;border-radius:8px;background:#fff}" +
    ".vink{display:flex;align-items:center;gap:8px;margin:14px 0 4px;font-size:15px}.vink input{width:auto}" +
    ".klein{font-size:13px;color:#6b7280}</style></head><body>" +
    "<div class='kop'><img src='" + VS_LOGO + "' alt='Fonteyn'></div><div class='blok'>" + inhoud + "</div></body></html>",
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
function vsGegevensTabel(k, taal) {
  const T = vsT(taal);
  const aanhef = k.aanhef === "1" ? T.heer : k.aanhef === "2" ? T.mevrouw : "";
  const rij = (l, w) => w ? "<tr><td>" + vsEsc(l) + "</td><td>" + vsEsc(w) + "</td></tr>" : "";
  const adres = [k.straat, [k.huisnummer, k.toevoeging].filter(Boolean).join(" ")].filter(Boolean).join(" ");
  const a = k.aflevering || {};
  return "<table class='geg'>" + rij(T.naam, [aanhef, vsNaam(k)].filter(Boolean).join(" ")) + rij(T.bedrijf, k.bedrijf) + rij(T.btw, k.btw) +
    rij(T.adres, adres) + rij(T.pc_plaats, [k.postcode, k.plaats].filter(Boolean).join(" ")) + rij(T.land, k.land) +
    rij(T.email, k.email) + rij(T.telefoon, k.telefoon) + rij(T.mobiel, k.mobiel) +
    (k.afwijkend ? rij(T.afleveren_op, [a.naam, [a.straat, [a.huisnummer, a.toevoeging].filter(Boolean).join(" ")].join(" "), [a.postcode, a.plaats].filter(Boolean).join(" ")].filter(Boolean).join(", ")) : "") +
    "</table>";
}
function vsVeld(naam, label, waarde, extra) {
  return "<div><label for='" + naam + "'>" + vsEsc(label) + "</label><input id='" + naam + "' name='" + naam + "' value='" + vsEsc(waarde) + "'" + (extra || "") + "></div>";
}
function vsFormulier(token, k, taal) {
  const a = k.aflevering || {}, T = vsT(taal);
  return "<form method='post' action='/bevestig'><input type='hidden' name='t' value='" + vsEsc(token) + "'><input type='hidden' name='soort' value='aangepast'>" +
    "<label for='aanhef'>" + T.aanhef + "</label><select id='aanhef' name='aanhef'><option value=''></option><option value='1'" + (k.aanhef === "1" ? " selected" : "") + ">" + T.heer + "</option><option value='2'" + (k.aanhef === "2" ? " selected" : "") + ">" + T.mevrouw + "</option></select>" +
    "<div class='rij3'>" + vsVeld("voornaam", T.voornaam, k.voornaam) + vsVeld("tussenvoegsel", T.tussenvoegsel, k.tussenvoegsel) + vsVeld("achternaam", T.achternaam, k.achternaam, " required") + "</div>" +
    (k.bedrijf || k.btw ? "<div class='rij'>" + vsVeld("bedrijf", T.bedrijf, k.bedrijf) + vsVeld("btw", T.btw, k.btw) + "</div>" : "") +
    "<div class='rij3'>" + vsVeld("straat", T.straat, k.straat, " required") + vsVeld("huisnummer", T.huisnummer, k.huisnummer, " required") + vsVeld("toevoeging", T.toevoeging, k.toevoeging) + "</div>" +
    "<div class='rij3'>" + vsVeld("plaats", T.plaats, k.plaats, " required") + vsVeld("postcode", T.postcode, k.postcode, " required") + vsVeld("land", T.land, k.land, " maxlength='2'") + "</div>" +
    vsVeld("email", T.email, k.email, " type='email' required") +
    "<div class='rij'>" + vsVeld("telefoon", T.telefoon, k.telefoon, " type='tel'") + vsVeld("mobiel", T.mobiel, k.mobiel, " type='tel'") + "</div>" +
    "<label class='vink'><input type='checkbox' name='afwijkend' value='1'" + (k.afwijkend ? " checked" : "") + " onchange=\"document.getElementById('afl').style.display=this.checked?'block':'none'\"> " + T.ander_adres + "</label>" +
    "<div id='afl' style='display:" + (k.afwijkend ? "block" : "none") + "'>" + vsVeld("a_naam", T.naam, a.naam) +
    "<div class='rij3'>" + vsVeld("a_straat", T.straat, a.straat) + vsVeld("a_huisnummer", T.huisnummer, a.huisnummer) + vsVeld("a_toevoeging", T.toevoeging, a.toevoeging) + "</div>" +
    "<div class='rij3'>" + vsVeld("a_plaats", T.plaats, a.plaats) + vsVeld("a_postcode", T.postcode, a.postcode) + vsVeld("a_land", T.land, a.land, " maxlength='2'") + "</div></div>" +
    "<button class='knop groen' type='submit'>" + vsEsc(T.opslaan) + "</button></form>";
}
function vsBevestigInhoud(k, taal, actie, token, onder) {
  const T = vsT(taal);
  return "<h1>" + vsEsc(T.kloppen) + "</h1><p>" + vsEsc(T.kloppen_p) + "</p>" + vsGegevensTabel(k, taal) +
    "<form method='post' action='" + actie + "'><input type='hidden' name='t' value='" + vsEsc(token) + "'><input type='hidden' name='soort' value='klopt'><button class='knop groen' type='submit'>" + vsEsc(T.klopt) + "</button></form>" + onder;
}
function vsVerlopen(taal, voorstel) {
  const T = vsT(taal);
  return vsPagina(T.voorstel, "<h1>" + vsEsc(voorstel ? T.vs_verlopen : T.verlopen) + "</h1><p>" + vsEsc(T.verlopen_p) + "</p>", taal);
}
async function vsBevestigGet(env, url) {
  const db = await vsDb(env);
  const token = String(url.searchParams.get("t") || "");
  const r = token ? await db.prepare("SELECT * FROM voorstel WHERE token = ?1").bind(token).first() : null;
  if (!r) return vsVerlopen(null);
  const v = vsUit(r), taal = vsTaal(v), T = vsT(taal);
  if (v.status !== "wacht") {
    return vsPagina(T.ond_bevestig, vsBedankt(taal), taal);
  }
  if (url.searchParams.get("aanpassen") === "1") {
    return vsPagina(T.aanpassen, "<h1>" + vsEsc(T.aanpassen) + "</h1><p>" + vsEsc(T.aanpassen_p) + "</p>" + vsFormulier(token, v.klant || {}, taal), taal);
  }
  return vsPagina(T.ond_bevestig, vsBevestigInhoud(v.klant || {}, taal, "/bevestig", token,
    "<a class='knop grijs' href='/bevestig?t=" + encodeURIComponent(token) + "&aanpassen=1'>" + vsEsc(T.klopt_niet) + "</a>"), taal);
}
async function vsBevestigPost(env, request, H) {
  const f = await request.formData().catch(() => null);
  if (!f) return vsPagina("Fonteyn", "<h1>" + VS_T.nl.lukte_niet + "</h1><p>" + VS_T.nl.lukte_niet_p + "</p>");
  const db = await vsDb(env);
  const token = String(f.get("t") || "");
  const r = token ? await db.prepare("SELECT * FROM voorstel WHERE token = ?1").bind(token).first() : null;
  if (!r) return vsVerlopen(null);
  const v = vsUit(r), taal = vsTaal(v), T = vsT(taal);
  if (v.status !== "wacht") return vsPagina(T.ond_bevestig, vsBedankt(taal), taal);
  let verschil = [];
  if (String(f.get("soort")) === "aangepast") {
    const g = (n) => f.get(n);
    const nieuw = vsKlantSchoon({
      aanhef: g("aanhef"), voornaam: g("voornaam"), tussenvoegsel: g("tussenvoegsel"), achternaam: g("achternaam"),
      bedrijf: g("bedrijf") != null ? g("bedrijf") : v.klant.bedrijf, btw: g("btw") != null ? g("btw") : v.klant.btw,
      straat: g("straat"), huisnummer: g("huisnummer"), toevoeging: g("toevoeging"), postcode: g("postcode"), plaats: g("plaats"),
      land: g("land"), email: g("email"), telefoon: g("telefoon"), mobiel: g("mobiel"), afwijkend: g("afwijkend") === "1",
      aflevering: { naam: g("a_naam"), straat: g("a_straat"), huisnummer: g("a_huisnummer"), toevoeging: g("a_toevoeging"), postcode: g("a_postcode"), plaats: g("a_plaats"), land: g("a_land") },
    });
    const mist = vsKlantMist(nieuw, taal);
    if (mist.length) return vsPagina(T.aanpassen, "<h1>" + vsEsc(T.bijna) + "</h1><p>" + vsEsc(T.vul_in) + " " + vsEsc(mist.join(", ")) + ".</p>" + vsFormulier(token, nieuw, taal), taal);
    verschil = vsVerschil(v.klant, nieuw);
    v.klantAdviseur = v.klant;
    v.klant = nieuw;
  }
  v.status = "bevestigd";
  v.bevestigd = { ts: Date.now(), aangepast: verschil.length > 0, verschil };
  vsLog(v, "de klant", verschil.length ? "Gegevens aangepast en bevestigd (" + verschil.map(x => x.veld).join(", ") + ")" : "Gegevens bevestigd");
  await vsSchrijf(db, v);
  // Meteen de debiteur en de offerte in Logic4, zodat de adviseur verder kan.
  try { await vsNaarLogic4(env, H, db, v, "het Dashboard"); }
  catch (e) { v.logic4Fout = String(e.message || e).slice(0, 300); vsLog(v, "het Dashboard", "Logic4 lukte nog niet: " + v.logic4Fout); await vsSchrijf(db, v); }
  await vsBericht(env, H, v, verschil).catch(() => {});
  return vsPagina(T.bedankt, vsBedankt(taal), taal);
}
/* Bericht in het Dashboard van de adviseur. Bij "klopt niet" met wat er
   anders is; bij "klopt" kort dat hij verder kan. */
async function vsBericht(env, H, v, verschil) {
  if (!H.berichtenLees || !H.berichtErbij) return;
  const d = await H.berichtenLees(env);
  const naam = vsNaam(v.klant);
  const tekst = verschil.length
    ? naam + " heeft de gegevens aangepast en bevestigd. Anders: " + verschil.map(x => x.veld + " " + (x.was ? "'" + x.was + "'" : "(leeg)") + " wordt '" + x.wordt + "'").join("; ") + "."
    : naam + " heeft de gegevens bevestigd. Je kunt nu regels toevoegen.";
  H.berichtErbij(d, { id: "vs-" + v.id + "-" + (v.bevestigd && v.bevestigd.ts), aan: [v.adviseur], soort: "voorstel",
    titel: verschil.length ? "Klant paste gegevens aan: " + naam : "Klant bevestigde: " + naam, tekst,
    ref: { voorstel: v.id, link: "voorstel-maken.html?id=" + encodeURIComponent(v.id) } });
  await env.FONTEYN_DATA.put("berichten", JSON.stringify(d));
}

/* ── De ingang vanuit worker.js ─────────────────────────────────────────── */
export async function vsHandle(request, env, url, H) {
  const p = url.pathname;
  // De klantpagina: zonder sleutel, het token in de link is de sleutel.
  /* Het voorstel bekijken: ?t= is de link uit de mail aan de klant (de
     versie van het versturen), ?p= de printlink van de adviseur (live). */
  if (p === "/voorstel/bekijk" && request.method === "GET") {
    const db = await vsDb(env);
    const t = String(url.searchParams.get("t") || ""), pr = String(url.searchParams.get("p") || "");
    const l = (t || pr) ? await db.prepare("SELECT id FROM voorstel_link WHERE token = ?1 AND soort = ?2").bind(t || pr, t ? "t" : "p").first() : null;
    const v = l ? await vsLees(db, l.id) : null;
    if (!v || (t && !v.verstuurdeVersie) || v.status === "gesloten") return vsVerlopen(v && vsTaal(v), true);
    try {
      const d = t ? v.verstuurdeVersie : await vsDocGegevens(env, H, db, v);
      return new Response(vsDocHtml(d, t ? { voet: vsBetaalBlok(v, t) } : {}), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
    } catch (e) { return vsPagina("Fonteyn", "<h1>" + vsEsc(vsT(vsTaal(v)).geduld) + "</h1><p>" + vsEsc(e.message) + "</p>", vsTaal(v)); }
  }
  /* Aanbetalen: de klant komt hier via de knop onder zijn voorstel. */
  if (p === "/voorstel/betaal" && request.method === "GET") {
    const db = await vsDb(env);
    const t = String(url.searchParams.get("t") || "");
    const v = await vsLinkVoorstel(db, t);
    if (!v) return vsVerlopen(null);
    const taal = vsTaal(v), T = vsT(taal);
    const rest = Math.round((vsAanbetaling(v) - vsBetaald(v)) * 100) / 100;
    if (rest < 0.01) return vsPagina(T.binnen, "<h1>" + vsEsc(T.binnen) + "</h1><p>" + vsEsc(T.binnen_p(vsGeld(vsBetaald(v), taal))) + "</p>", taal);
    if (!H.dpCreateMolliePayment) return vsPagina(T.geduld, "<h1>" + vsEsc(T.geduld) + "</h1><p>" + vsEsc(T.storing_p) + "</p>", taal);
    const m = await H.dpCreateMolliePayment(env, rest, T.mollie(v.orderid),
      vsBasis(env) + "/voorstel/betaald?t=" + encodeURIComponent(t), vsBasis(env) + "/voorstel/mollie", { voorstel: v.id, orderid: v.orderid });
    if (!m.ok || !m.checkoutUrl) return vsPagina(T.geduld, "<h1>" + vsEsc(T.geduld) + "</h1><p>" + vsEsc(T.storing_p) + "</p>", taal);
    v.betalingen = (v.betalingen || []).concat([{ mollie: m.id, bedrag: rest, ts: Date.now(), status: "open" }]).slice(-20);
    vsLog(v, "de klant", "Begonnen met aanbetalen (" + vsGeld(rest) + ")");
    await vsSchrijf(db, v);
    return Response.redirect(m.checkoutUrl, 303);
  }
  if (p === "/voorstel/betaald" && request.method === "GET") {
    const db = await vsDb(env);
    const t = String(url.searchParams.get("t") || "");
    const v = await vsLinkVoorstel(db, t);
    if (!v) return vsVerlopen(null);
    const taal = vsTaal(v), T = vsT(taal);
    const laatste = (v.betalingen || []).slice(-1)[0];
    const terug = "<a class='knop grijs' href='/voorstel/bekijk?t=" + encodeURIComponent(t) + "'>" + vsEsc(T.terug) + "</a>";
    if (laatste && laatste.geboekt) return vsPagina(T.binnen, "<h1>" + vsEsc(T.binnen) + "</h1><p>" + vsEsc(T.binnen_p(vsGeld(laatste.bedrag, taal))) + "</p>" + terug, taal);
    const mp = laatste ? await vsMollieLees(env, laatste.mollie) : null;
    const st = mp ? mp.status : "";
    if (st === "paid" || st === "open" || st === "pending" || st === "authorized")
      return new Response((await vsPagina(T.geduld, "<h1>" + vsEsc(T.verwerkt) + "</h1><p>" + vsEsc(T.verwerkt_p) + "</p>" + terug, taal).text())
        .replace("<head>", "<head><meta http-equiv='refresh' content='4'>"), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    return vsPagina(T.afgebroken, "<h1>" + vsEsc(T.afgebroken) + "</h1><p>" + vsEsc(T.afgebroken_p) + "</p>" +
      "<a class='knop groen' href='/voorstel/betaal?t=" + encodeURIComponent(t) + "'>" + vsEsc(T.opnieuw) + "</a>" + terug, taal);
  }
  /* De melding van Mollie. Altijd 200: anders blijft Mollie het proberen. */
  if (p === "/voorstel/mollie" && request.method === "POST") {
    try {
      const pid = new URLSearchParams(await request.text()).get("id") || "";
      if (pid && env.MOLLIE_API_KEY) await vsMollieVerwerk(env, H, await vsDb(env), pid);
    } catch (e) { console.log("[voorstel] mollie: " + String(e.message || e)); }
    return new Response("ok");
  }
  if (p === "/bevestig") {
    if (request.method === "GET") return vsBevestigGet(env, url);
    if (request.method === "POST") return vsBevestigPost(env, request, H);
    return H.reply(405, { ok: false });
  }
  // DEV_OPEN bestaat alleen bij een lokale proefdraai (wrangler dev --var), nooit in de uitrol.
  if (!env.DEV_OPEN && (!env.SHARED_SECRET || (request.headers.get("X-Fonteyn-Auth") || "") !== env.SHARED_SECRET)) return H.reply(401, { ok: false, error: "geen teamsleutel: ga één keer terug naar het Dashboard en open de tegel opnieuw" });
  const wie = String(request.headers.get("X-Fonteyn-User") || "").toLowerCase().slice(0, 80);
  if (!(await H.toegangMag(env, "voorstel-maken", wie))) return H.reply(403, { ok: false, error: "Deze tegel is voor de adviseurs." });
  const beheer = await H.toegangMag(env, "voorstel-beheer", wie);
  const db = await vsDb(env);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const eigen = async (id) => {
    const v = await vsLees(db, id);
    if (!v) throw Object.assign(new Error("Dit voorstel is onbekend of al opgeruimd."), { code: 404 });
    if (v.adviseur !== wie && !beheer) throw Object.assign(new Error("Dit voorstel is van een andere adviseur."), { code: 403 });
    return v;
  };
  try {
    if (p === "/voorstel/lijst" && request.method === "GET") {
      const alle = beheer && url.searchParams.get("alle") === "1";
      const rs = alle
        ? await db.prepare("SELECT * FROM voorstel ORDER BY gewijzigd DESC LIMIT 200").all()
        : await db.prepare("SELECT * FROM voorstel WHERE adviseur = ?1 ORDER BY gewijzigd DESC LIMIT 200").bind(wie).all();
      return H.reply(200, { ok: true, beheer, voorstellen: (rs.results || []).map(vsUit).map(v => ({
        id: v.id, status: v.status, klant: vsNaam(v.klant || {}), plaats: (v.klant || {}).plaats || "", email: (v.klant || {}).email || "",
        debiteur: v.debiteur, orderid: v.orderid, adviseur: v.adviseur, gewijzigd: v.gewijzigd, aangepast: !!(v.bevestigd && v.bevestigd.aangepast) })) });
    }
    if (p === "/voorstel/keuzes" && request.method === "GET") {
      const k = await vsKeuzes(env, H, db);
      const inst = await vsInstellingen(db);
      // De adviseur ziet alleen de korte lijst vervoerders (Dolf, 6 nov 2026).
      const kort = inst.transporteurs.map(id => (k.transporteurs || []).find(x => Number(x.id) === Number(id))).filter(Boolean);
      return H.reply(200, { ok: true, keuzes: Object.assign({}, k, { transporteursKort: kort, talen: VS_TALEN }), ikMedewerker: vsMedewerkerVan(k, wie),
        beheer, beursAlles: beheer || await H.toegangMag(env, "voorstel-beursomzet", wie), beurzen: inst.beurzen, beursNu: vsBeursNu(inst) });
    }
    /* Het btw-nummer nakijken bij de EU, terwijl de adviseur typt. */
    if (p === "/voorstel/btw" && request.method === "POST") {
      const nr = vsBtwSchoon(body.nummer);
      if (!nr) return H.reply(200, { ok: true, leeg: true });
      if (!H.btwControle) return H.reply(200, { ok: true, storing: true, uitleg: "Nakijken kan nu even niet." });
      const r = await H.btwControle(nr).catch(e => ({ ok: false, storing: true, error: String(e.message || e) }));
      const kaal = x => String(x || "").toLowerCase().replace(/\b(b\.?v\.?|gmbh|s\.?a\.?r?\.?l?\.?|s\.?l\.?|s\.?r\.?l\.?|ltd|bv|nv|sas|sa|ag|kg|co)\b/g, "").replace(/[^a-z0-9]/g, "");
      const naamKlopt = r && r.naam && body.bedrijf ? (kaal(r.naam).includes(kaal(body.bedrijf)) || kaal(body.bedrijf).includes(kaal(r.naam))) : null;
      return H.reply(200, { ok: true, nummer: nr, geldig: !!(r && r.ok && r.geldig), naam: (r && r.naam) || "", naamKlopt, storing: !!(r && r.storing), uitleg: (r && (r.error || r.uitleg)) || "" });
    }
    /* Instellingen: alleen de beheerlaag (Dolf). Vervoerders voor de korte
       lijst, codes voor een aangepaste aanbetaling, en de beurzen. */
    if (p === "/voorstel/instellingen") {
      if (!beheer) return H.reply(403, { ok: false, error: "Dit is voor de beheerders van de tegel." });
      if (request.method === "GET") return H.reply(200, { ok: true, instellingen: await vsInstellingen(db), transporteurs: (await vsKeuzes(env, H, db)).transporteurs || [] });
      const i = body.instellingen || {};
      const codes = (Array.isArray(i.codes) ? i.codes : []).map(c => ({ naam: vsS(c.naam, 40), code: vsS(c.code, 20) })).filter(c => c.naam && c.code);
      if (codes.some(c => c.code.length < 4)) return H.reply(400, { ok: false, error: "Een code heeft minstens 4 tekens." });
      if (new Set(codes.map(c => c.code)).size !== codes.length) return H.reply(400, { ok: false, error: "Twee mensen hebben dezelfde code. Geef iedereen een eigen code." });
      const beurzen = (Array.isArray(i.beurzen) ? i.beurzen : []).map(b => ({ naam: vsS(b.naam, 80), van: vsS(b.van, 10), tot: vsS(b.tot, 10) }))
        .filter(b => b.naam && /^\d{4}-\d{2}-\d{2}$/.test(b.van) && /^\d{4}-\d{2}-\d{2}$/.test(b.tot));
      const transporteurs = (Array.isArray(i.transporteurs) ? i.transporteurs : []).map(Number).filter(Boolean).slice(0, 20);
      if (!transporteurs.length) return H.reply(400, { ok: false, error: "Kies minstens één vervoerder." });
      const nieuw = { transporteurs, codes, beurzen };
      await db.prepare("INSERT OR REPLACE INTO voorstel_cache (k, v, ts) VALUES ('instellingen', ?1, ?2)").bind(JSON.stringify(nieuw), Date.now()).run();
      return H.reply(200, { ok: true, instellingen: nieuw });
    }
    /* Beursomzet (Dolf, 6 nov 2026): alles wat op de beurs gebeurt, bij
       elkaar. Dan hoeft Chantal het niet meer op te tellen. */
    if (p === "/voorstel/beursomzet" && request.method === "GET") {
      const inst = await vsInstellingen(db);
      const alles = beheer || await H.toegangMag(env, "voorstel-beursomzet", wie);
      const naam = String(url.searchParams.get("naam") || "");
      const beurs = inst.beurzen.find(b => b.naam === naam) || vsBeursNu(inst) || inst.beurzen.slice().sort((a, b) => b.van.localeCompare(a.van))[0];
      if (!beurs) return H.reply(200, { ok: true, beurs: null });
      const rs = await db.prepare("SELECT id, adviseur, orderid, status, json FROM voorstel WHERE gewijzigd >= ?1").bind(Date.parse(beurs.van + "T00:00:00Z") - 86400000).all();
      const lijst = (rs.results || []).map(r => Object.assign(vsJson(r.json, {}), { id: r.id, adviseur: r.adviseur, orderid: r.orderid, status: r.status }))
        .filter(v => v.beurs === beurs.naam && v.status !== "gesloten");
      // Eén vraag aan Logic4 voor de stand van al die voorstellen.
      const stand = {};
      const ids = lijst.map(v => Number(v.orderid)).filter(Boolean);
      if (ids.length) {
        try {
          for (let skip = 0; skip < 2000; skip += 500) {
            const r = await vsL4(env, H, "/v3/Orders/GetOrders", { CreationDateFrom: beurs.van + "T00:00:00", TakeRecords: 500, SkipRecords: skip });
            for (const o of (Array.isArray(r) ? r : [])) if (ids.includes(Number(o.Id))) stand[o.Id] = o;
            if (!Array.isArray(r) || r.length < 500) break;
          }
        } catch (e) {}
      }
      const rij = {};
      const tel = { voorstellen: 0, voorstelTotaal: 0, orders: 0, orderTotaal: 0, betaald: 0 };
      for (const v of lijst) {
        const o = stand[v.orderid], t = (o && o.Totals) || {};
        const incl = o ? Number(t.AmountIncl) || 0 : Number(v.totaalIncl) || 0;
        const betaald = o ? Number(t.Calc_TotalPayed) || 0 : vsBetaald(v);
        const isOrder = o ? (o.OrderStatus && [VS_AANBETAALD, VS_BETAALD].includes(Number(o.OrderStatus.Id))) || betaald > 0 : betaald > 0;
        const w = rij[v.adviseur] = rij[v.adviseur] || { wie: v.adviseur, voorstellen: 0, voorstelTotaal: 0, orders: 0, orderTotaal: 0, betaald: 0 };
        for (const x of [w, tel]) { x.voorstellen++; x.voorstelTotaal += incl; if (isOrder) { x.orders++; x.orderTotaal += incl; x.betaald += betaald; } }
      }
      let per = Object.values(rij).sort((a, b) => b.orderTotaal - a.orderTotaal || b.voorstelTotaal - a.voorstelTotaal);
      if (!alles) per = per.filter(x => x.wie === wie);
      const rond = x => Math.round(x * 100) / 100;
      for (const x of [tel, ...per]) for (const k of ["voorstelTotaal", "orderTotaal", "betaald"]) x[k] = rond(x[k]);
      return H.reply(200, { ok: true, beurs, totaal: alles ? tel : (per[0] || null), per, alles, beurzen: inst.beurzen });
    }
    if (p === "/voorstel/klant-zoek" && request.method === "GET") return H.reply(200, await vsKlantZoek(env, H, url.searchParams.get("q")));
    if (p === "/voorstel/artikel" && request.method === "GET") return H.reply(200, await vsArtikel(env, H, url.searchParams.get("q")));
    if (p === "/voorstel/demo" && request.method === "POST") return H.reply(200, { ok: true, html: await vsDemo(env, H, db, body, wie) });
    /* Live meekijken (Gerrit, 4 nov 2026): de tegel vraagt elke paar seconden
       alleen dit op, zolang hij op de klant wacht. Eén regel uit D1, geen Logic4. */
    if (p === "/voorstel/stand" && request.method === "GET") {
      const v = await eigen(url.searchParams.get("id"));
      return H.reply(200, { ok: true, status: v.status, betaald: vsBetaald(v), gewijzigd: v.gewijzigd });
    }
    if (p === "/voorstel" && request.method === "GET") {
      const v = await eigen(url.searchParams.get("id"));
      let order = null;
      if (v.orderid) order = await vsOrderLees(env, H, v.orderid).catch(e => ({ fout: String(e.message || e) }));
      // Betaald aan de kassa? Dan nu meteen een order, niet pas bij de ronde van het hele uur.
      if (order && !order.fout && order.betaald > 0 && (Number(order.statusId) === VS_OFFERTE || Number(order.statusId) === VS_AANBETAALD)) {
        try { const na = await vsNaarOrder(env, H, v, "het Dashboard"); if (na) order = na; await vsSchrijf(db, v); } catch (e) {}
      }
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v), order, eerder: await vsEerder(db, v) });
    }
    /* De adviseur kan het bedrag van de aanbetaling aanpassen; 0 = weer 30%. */
    if (p === "/voorstel/aanbetaling" && request.method === "POST") {
      const v = await eigen(body.id);
      const ruw = String(body.bedrag || 0).trim();
      // "1.234,56" en "394,79" zoals mensen typen, "394.79" zoals de tegel het soms heeft.
      const b = Math.round((Number(/,/.test(ruw) ? ruw.replace(/\./g, "").replace(",", ".") : ruw) || 0) * 100) / 100;
      if (b < 0) return H.reply(400, { ok: false, error: "Vul een bedrag in." });
      if (b && !(await vsInstellingen(db)).codes.some(x => x.code === String(body.code || "").trim()))
        return H.reply(403, { ok: false, error: "Deze code klopt niet. Een aangepaste aanbetaling kan alleen met een code." });
      v.aanbetaling = b || undefined;
      v.betaalwijze = b ? "aangepast" : "30";
      vsLog(v, wie, b ? "Aanbetaling op " + vsGeld(b) + " gezet" : "Aanbetaling terug op 30%");
      await vsSchrijf(db, v);
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v) });
    }
    /* Nieuw, of de klantgegevens bijwerken. Na het versturen van de mail
       kan de adviseur de gegevens alleen nog veranderen door opnieuw te
       versturen: wat de klant bevestigt is dan weer de nieuwe versie. */
    if (p === "/voorstel/klant" && request.method === "POST") {
      const klant = vsKlantSchoon(body.klant);
      let v;
      if (body.id) {
        v = await eigen(body.id);
        if (["bevestigd", "in-logic4"].includes(v.status)) return H.reply(409, { ok: false, error: "De klant heeft deze gegevens al bevestigd. Een wijziging gaat via een nieuw voorstel." });
        if (v.status === "wacht" && JSON.stringify(v.klant) !== JSON.stringify(klant)) { v.status = "concept"; vsLog(v, wie, "Gegevens aangepast na het versturen; de mail moet opnieuw"); }
      } else {
        v = { id: vsCode(10), token: vsCode(32), status: "concept", adviseur: wie, aangemaakt: Date.now(), kop: {} };
        // Op de beurs? Dan weet het voorstel dat meteen (Dolf, 6 nov 2026).
        const bn = vsBeursNu(await vsInstellingen(db));
        if (bn) v.beurs = bn.naam;
        vsLog(v, wie, "Voorstel begonnen" + (bn ? " op " + bn.naam : ""));
      }
      v.klant = klant;
      if (body.taal !== undefined) v.taal = VS_TALEN[body.taal] ? body.taal : "";
      if (klant.btw) await vsBtwNakijken(H, v).catch(() => null); else delete v.btwCheck;
      if (body.debiteur !== undefined) v.debiteur = Number(body.debiteur) || null;
      await vsSchrijf(db, v);
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v), eerder: await vsEerder(db, v) });
    }
    /* Al eerder bevestigd, met precies dezelfde gegevens: zonder mail verder. */
    if (p === "/voorstel/eerder" && request.method === "POST") {
      const v = await eigen(body.id);
      if (!["concept", "wacht"].includes(v.status)) return H.reply(409, { ok: false, error: "Dit voorstel is al verder." });
      const e = await vsEerder(db, v);
      if (!e || e.anders) return H.reply(409, { ok: false, error: "De gegevens zijn anders dan wat de klant bevestigde. Stuur de mail Bevestig je gegevens." });
      v.status = "bevestigd";
      v.bevestigd = { ts: Date.now(), eerder: e.ts, aangepast: false, verschil: [] };
      vsLog(v, wie, "Klant had deze gegevens al bevestigd op " + new Date(e.ts).toISOString().slice(0, 10) + "; verder zonder mail");
      await vsSchrijf(db, v);
      let fout = null;
      try { await vsNaarLogic4(env, H, db, v, wie); } catch (x) { fout = String(x.message || x).slice(0, 300); v.logic4Fout = fout; await vsSchrijf(db, v); }
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v), fout });
    }
    if (p === "/voorstel/verstuur" && request.method === "POST") {
      const v = await eigen(body.id);
      if (["bevestigd", "in-logic4"].includes(v.status)) return H.reply(409, { ok: false, error: "De klant heeft zijn gegevens al bevestigd." });
      const mist = vsKlantMist(v.klant || {});
      if (mist.length) return H.reply(400, { ok: false, error: "Vul nog in: " + mist.join(", ") + "." });
      if (v.status === "wacht" && body.opnieuw !== true) return H.reply(409, { ok: false, error: "De mail is al verstuurd." });
      v.token = vsCode(32);   // een nieuwe link: een oude mail werkt dan niet meer
      const m = await vsMailStuur(env, H, v, wie);
      if (!m.ok) return H.reply(502, m);
      v.status = "wacht";
      v.verstuurd = { ts: Date.now(), naar: m.naar, via: m.via };
      vsLog(v, wie, "Mail 'Bevestig je gegevens' verstuurd naar " + m.naar);
      await vsSchrijf(db, v);
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v) });
    }
    /* Opnieuw proberen als Logic4 bij de bevestiging even niet wilde. */
    if (p === "/voorstel/logic4" && request.method === "POST") {
      const v = await eigen(body.id);
      const r = await vsNaarLogic4(env, H, db, v, wie);
      if (r.ok) { delete v.logic4Fout; await vsSchrijf(db, v); }
      return H.reply(r.ok ? 200 : 409, r);
    }
    if (p === "/voorstel/kop" && request.method === "POST") {
      const v = await eigen(body.id);
      // Gerrit (31 okt 2026): de gegevens van het voorstel pas invullen na de bevestiging.
      if (v.status !== "in-logic4") return H.reply(409, { ok: false, error: "Invullen kan zodra de klant zijn gegevens heeft bevestigd." });
      // Wat het Dashboard zelf invult, laat het niet van het scherm overschrijven.
      const binnen = Object.assign({}, body.kop || {});
      for (const x of ["filiaal", "referentie", "betaalmethode", "btwcode", "type1", "type2", "type3", "type4"]) delete binnen[x];
      const kop = Object.assign({}, v.kop || {}, binnen);
      v.kop = kop;
      if (body.kop && body.kop.vervaldatum !== undefined) v.vervaldatum = vsS(body.kop.vervaldatum, 10);
      if (v.status === "gesloten") return H.reply(409, { ok: false, error: "Dit voorstel is gesloten." });
      /* Betalen (Dolf, 6 nov 2026): 30% aanbetaling, alles, of aangepast.
         Aangepast alleen met een persoonlijke code. */
      const wat = [];
      if (body.betaalwijze !== undefined) {
        const w = ["30", "alles", "aangepast"].includes(body.betaalwijze) ? body.betaalwijze : "30";
        if (w === "aangepast") {
          const ruw = String(body.aanbetaling || "").trim();
          const bedrag = Math.round((Number(/,/.test(ruw) ? ruw.replace(/\./g, "").replace(",", ".") : ruw) || 0) * 100) / 100;
          const nieuwBedrag = v.betaalwijze !== "aangepast" || bedrag !== Number(v.aanbetaling || 0);
          if (nieuwBedrag) {
            if (!(bedrag > 0)) return H.reply(400, { ok: false, error: "Vul het bedrag van de aanbetaling in." });
            const c = (await vsInstellingen(db)).codes.find(x => x.code === String(body.code || "").trim());
            if (!c) return H.reply(403, { ok: false, error: "Deze code klopt niet. Een aangepaste aanbetaling kan alleen met een code." });
            v.aanbetaling = bedrag; v.betaalwijze = "aangepast";
            wat.push("aanbetaling aangepast naar " + vsGeld(bedrag) + " met de code van " + c.naam);
          }
        } else if (w !== (v.betaalwijze || "30")) {
          v.betaalwijze = w; delete v.aanbetaling;
          wat.push(w === "alles" ? "betalen: alles vooraf" : "betalen: 30% aanbetaling");
        }
      }
      if (body.beurs !== undefined) {
        const bn = vsBeursNu(await vsInstellingen(db));
        const nieuw = body.beurs ? (v.beurs || (bn && bn.naam) || "") : "";
        if (nieuw !== (v.beurs || "")) { v.beursWas = v.beurs || v.beursWas; v.beurs = nieuw; wat.push(nieuw ? "telt mee voor " + nieuw : "telt niet mee voor de beurs"); }
      }
      if (v.orderid) await vsKopPush(env, H, db, v);
      vsLog(v, wie, "Kop aangepast: " + Object.keys(binnen).join(", ") + (wat.length ? "; " + wat.join("; ") : ""));
      await vsSchrijf(db, v);
      const order = v.orderid ? await vsOrderLees(env, H, v.orderid).catch(() => null) : null;
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v), order });
    }
    /* Het voorstel als pagina, om te printen (live uit Logic4). Geeft een
       link terug die de tegel in een nieuw venster opent. */
    if (p === "/voorstel/print" && request.method === "POST") {
      const v = await eigen(body.id);
      if (!v.orderid) return H.reply(409, { ok: false, error: "Printen kan zodra het voorstel in Logic4 staat." });
      if (!v.printToken) {
        v.printToken = vsCode(32); await vsSchrijf(db, v);
        await db.prepare("INSERT OR REPLACE INTO voorstel_link (token, id, soort, ts) VALUES (?1, ?2, 'p', ?3)").bind(v.printToken, v.id, Date.now()).run();
      }
      return H.reply(200, { ok: true, url: (env.SVC_LINK_BASIS || "https://fonteyn-data-store.g-mulder.workers.dev") + "/voorstel/bekijk?p=" + encodeURIComponent(v.printToken) });
    }
    /* Versturen aan de klant. Zonder 'stuur:true' komt alleen het voorbeeld
       terug (mail en voorstel), zodat de adviseur eerst ziet wat er gaat. */
    if (p === "/voorstel/stuur" && request.method === "POST") {
      const v = await eigen(body.id);
      if (!v.orderid || v.status !== "in-logic4") return H.reply(409, { ok: false, error: "Versturen kan zodra het voorstel in Logic4 staat." });
      const d = await vsDocGegevens(env, H, db, v);
      if (!d.regels.length) return H.reply(400, { ok: false, error: "Zet eerst minstens één regel op het voorstel." });
      const onderwerp = vsS(body.onderwerp, 150) || vsT(d.taal).ond_vs(d.nummer);
      const tekst = String(body.tekst || "").slice(0, 3000);
      if (body.stuur !== true) {
        return H.reply(200, { ok: true, voorbeeld: true, naar: v.klant.email, onderwerp,
          mail: vsVoorstelMailHtml(v, d, "#", tekst), voorstel: vsDocHtml(d) });
      }
      if (!VS_STUUR_AAN && !env.DEV_OPEN) return H.reply(409, { ok: false, error: "Versturen gaat aan zodra de opmaak van de mail is goedgekeurd. Printen en het voorbeeld werken al." });
      if (!v.bekijkToken) {
        v.bekijkToken = vsCode(32);
        await db.prepare("INSERT OR REPLACE INTO voorstel_link (token, id, soort, ts) VALUES (?1, ?2, 't', ?3)").bind(v.bekijkToken, v.id, Date.now()).run();
      }
      v.verstuurdeVersie = d;
      const m = await vsMailStuur(env, H, v, wie, onderwerp, vsVoorstelMailHtml(v, d, vsDocLink(env, v), tekst));
      if (!m.ok) return H.reply(502, m);
      v.voorstelVerstuurd = (v.voorstelVerstuurd || []).concat([{ ts: Date.now(), naar: m.naar, via: m.via, totaal: d.totaal.incl }]).slice(-20);
      vsLog(v, wie, "Voorstel verstuurd naar " + m.naar + " (" + vsGeld(d.totaal.incl) + ")");
      await vsSchrijf(db, v);
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v) });
    }
    /* Sluiten: in Logic4 naar 'Offerte gesloten' (19). Weggooien kan via de
       koppeling niet; gesloten telt nergens meer mee. */
    if (p === "/voorstel/sluiten" && request.method === "POST") {
      const v = await eigen(body.id);
      if (v.orderid) {
        const o = await vsOrderLees(env, H, v.orderid).catch(() => null);
        if (o && Number(o.statusId) !== VS_OFFERTE && Number(o.statusId) !== VS_GESLOTEN)
          return H.reply(409, { ok: false, error: "Dit voorstel is in Logic4 al een order geworden." });
        await vsL4(env, H, "/v3/Orders/UpdateOrderStatus", { OrderId: Number(v.orderid), StatusId: VS_GESLOTEN });
      }
      v.status = "gesloten";
      vsLog(v, wie, "Voorstel gesloten" + (body.reden ? ": " + vsS(body.reden, 200) : ""));
      await vsSchrijf(db, v);
      return H.reply(200, { ok: true, voorstel: vsVoorTegel(v) });
    }
    if (p === "/voorstel/regel" && request.method === "POST") {
      const v = await eigen(body.id);
      if (!v.orderid || v.status !== "in-logic4") return H.reply(409, { ok: false, error: "Regels toevoegen kan pas als de klant zijn gegevens heeft bevestigd." });
      const order = await vsOrderLees(env, H, v.orderid);
      if (order && Number(order.statusId) !== VS_OFFERTE) return H.reply(409, { ok: false, error: "Dit voorstel is al een order (" + order.status + "); de regels blijven zoals ze zijn." });
      const r = body.regel || {};
      const oud = r.id ? (order.regels || []).find(x => String(x.id) === String(r.id)) : null;
      if (r.id && !oud) return H.reply(404, { ok: false, error: "Deze regel is al van het voorstel af." });
      if (body.weg === true) {
        if (!oud) return H.reply(400, { ok: false, error: "Welke regel?" });
        await vsRegel(env, H, v, { aantal: 0, oms: /\(vervallen\)$/.test(oud.oms) ? oud.oms : (oud.oms + " (vervallen)") }, oud);
        vsLog(v, wie, "Regel " + oud.code + " vervallen");
      } else {
        await vsRegel(env, H, v, r, oud);
        vsLog(v, wie, (oud ? "Regel aangepast: " : "Regel erbij: ") + (r.code || oud.code) + " x " + (r.aantal != null ? r.aantal : oud.aantal));
      }
      let na = await vsOrderLees(env, H, v.orderid);
      /* Het magazijn weet het Dashboard zelf (Dolf, 6 nov 2026): alleen
         spa-onderdelen en waterverzorging = Spa Service Magazijn. */
      const codes = (na.regels || []).filter(x => !x.vervallen && /^\d/.test(x.code)).map(x => x.code);
      const mag = codes.length && codes.every(c => VS_SERVICE_CODES.test(c)) ? VS_MAGAZIJN_SERVICE : VS_MAGAZIJN;
      if (Number(na.kop.type4) !== mag) {
        v.kop = Object.assign({}, v.kop || {}, { type4: mag });
        try { await vsKopPush(env, H, db, v); vsLog(v, "het Dashboard", "Magazijn: " + (mag === VS_MAGAZIJN_SERVICE ? "Spa Service Magazijn" : "Magazijn")); na = await vsOrderLees(env, H, v.orderid); } catch (e) {}
      }
      v.totaalIncl = na.totaal.incl;
      await vsSchrijf(db, v);
      return H.reply(200, { ok: true, order: na });
    }
    return H.reply(404, { ok: false, error: "onbekend" });
  } catch (e) {
    return H.reply(e.code || 502, { ok: false, error: String(e.message || e) });
  }
}
