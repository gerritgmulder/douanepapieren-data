/* ═══════════════════════════════════════════════════════════════════════════
   NIEUWS — wat er de laatste tijd aan het dashboard is veranderd
   ═══════════════════════════════════════════════════════════════════════════

   Waarom dit bestand er is
   ------------------------
   Er wordt bijna elke dag iets aan het dashboard veranderd, maar niemand
   merkt dat. Een tegel krijgt er een tabblad bij, een knop doet iets nieuws,
   iemand krijgt een tegel erbij - en dat blijft onopgemerkt tot iemand er per
   ongeluk tegenaan loopt. Gerrit, 21 aug 2026: "ik wil dat bijvoorbeeld
   iedereen kan zien wat bij hun tegels is vernieuwd, of welke tegel er voor
   hen bij is gekomen".

   Dus staat het hier, en verschijnt het bovenaan in het dashboard bij precies
   die mensen die de betreffende tegel ook echt mogen zien. Iemand die
   Bankkoppeling niet heeft, krijgt geen berichten over de bankkoppeling.

   Hoe een regel eruitziet
   -----------------------
       { datum: "2026-08-21", bestand: "vertalen.html",
         soort: "nieuw",
         titel: "Vertalen",
         wat:   "In gewone taal: wat kun je nu wat je gisteren niet kon." }

   datum    - de dag waarop het live ging (jjjj-mm-dd)
   bestand  - de tegel waar het over gaat, exact zoals in tegels.js. Wie die
              tegel niet mag zien, ziet dit bericht niet.
   groep    - mag in plaats van 'bestand' als het over een groep tegels gaat
              (de namen staan in toegang.js)
   iedereen - true als het over het dashboard zelf gaat en niet over één tegel
   soort    - "nieuw" (er is iets bijgekomen), "beter" (bestond al, doet nu
              meer) of "hersteld" (het ging fout en gaat nu goed)
   titel    - kort, drie tot zes woorden
   wat      - één of twee zinnen, in de taal waarin je het aan de balie zou
              uitleggen. Geen bestandsnamen, geen jargon.

   BIJ ELKE WIJZIGING AAN EEN TEGEL HOORT HIER EEN REGEL BIJ. Zonder die regel
   ziet niemand dat er iets veranderd is en is het werk voor de helft gedaan.
   Zet nieuwe regels bovenaan; de lijst loopt van nieuw naar oud.

   OTA: staat in manifest.json. Nooit opnieuw installeren.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  /* Hoever we terugkijken bij iemand die het dashboard voor het eerst opent,
     of die zijn berichten nog nooit heeft weggeklikt. Zonder deze grens zou
     zo iemand in één keer de hele lijst hieronder voor zijn kiezen krijgen. */
  var EERSTE_KEER_DAGEN = 14;

  var NIEUWS = [

    {
      datum: "2026-08-31", bestand: "dealerportaal.html", soort: "beter",
      titel: "Bibliotheek: volgorde aanpassen, verplaatsen en weggooien",
      wat: "De bestandenlijst van het partnerportaal was alleen te lezen; nu kun je hem beheren. Sleep een regel naar zijn plek of gebruik de pijltjes - die volgorde is letterlijk wat de partner ziet. Staat er iets in de verkeerde map, kies dan 'verplaats naar' en hij verhuist. Met het prullenbakje gooi je iets echt weg: ook het bestand zelf verdwijnt, zodat het daarna ook niet meer op te vragen is. De mappen staan dichtgeklapt, dus je ziet niet meteen 166 regels.",
    },

    {
      datum: "2026-08-31", bestand: "takenlijst.html", soort: "beter",
      titel: "Takenlijst is nu persoonlijk, en je kunt collega's uitnodigen",
      wat: "Je ziet alleen je eigen taken; wat een ander op zijn lijst zet blijft bij hem. Nieuw is uitnodigen: zet iemand bij een taak en die komt bij hem in de takenlijst te staan onder Uitnodigingen. Neemt hij aan, dan staat de taak bij hem onder Eigen taken en zie jij \"doet mee\". Weigert hij, dan staat hij niet op zijn lijst en zie jij \"geweigerd\" - je hoeft er dus niet achteraan. Uitnodigen kan alleen bij mensen die de tegel zelf ook hebben, anders zou de taak nergens landen. De tegel staat nu onder Elke dag in plaats van bij Marketing.",
    },

    {
      datum: "2026-08-31", bestand: "takenlijst.html", soort: "nieuw",
      titel: "Takenlijst: eigen weektaken en wat je delegeert",
      wat: "Nieuwe tegel Takenlijst. Onder Eigen taken zet je neer wat jij deze week doet, onder Delegeren leg je een klus bij iemand anders neer met zijn naam erbij. Alles hangt aan een week, zodat je op maandag in \u00e9\u00e9n keer de week vult; wat blijft liggen schuift niet weg maar staat de week erna bovenaan in het oranje. Vink je iets af, dan verdwijnt de regel uit de lijst en staat hij onder Afgerond, met wie hem heeft afgevinkt en wanneer. Terughalen kan altijd.",
    },

    {
      datum: "2026-08-30", bestand: "leverancier-nieuw.html", soort: "nieuw",
      titel: "Prijslijst van een nieuwe leverancier loopt langs Gretha",
      wat: "Lees je een proforma in, dan gaat de prijslijst niet meteen het archief in: hij komt bij Gretha en Fonteynbot bovenaan het dashboard te staan om na te kijken. Na akkoord maakt het dashboard in Prijslijsten een map aan op naam van de leverancier en zet de prijslijst daarin.",
    },

    {
      datum: "2026-08-30", bestand: "leverancier-nieuw.html", soort: "nieuw",
      titel: "Nieuwe leverancier inlezen uit een proforma",
      wat: "Sleep de proforma invoice van een nieuwe leverancier in de tegel Nieuwe leverancier. Het scherm haalt de bedrijfsgegevens, het contact en alle artikelen met hun inkoopprijs eruit, en controleert of het totaal klopt met wat er op het document staat. Daarna staat de leverancier met zijn prijslijst vast en kun je hem als bestand downloaden. De crediteur zelf maak je één keer in Logic4 aan; het adres, de contactpersoon, het e-mailadres en het telefoonnummer zet de knop er daarna automatisch bij.",
    },

    {
      datum: "2026-08-29", bestand: "voorraad.html", soort: "beter",
      titel: "Stock legt Vrij en Fysiek uit in de tabel zelf",
      wat: "Onder elke kolomkop staat nu wat het getal betekent, en er is een kolom Al verkocht bij gekomen: fysiek min vrij. Zo zie je per model in één regel dat er bijvoorbeeld 59 staan, 57 al verkocht zijn en er 2 vrij zijn. Bij het openklappen staat hetzelfde per kleur.",
    },

    {
      datum: "2026-08-29", bestand: "amerika.html", soort: "beter",
      titel: "Wire-overzicht van Audrey: gewoon plakken",
      wat: "Je hoefde de mail eerst op te slaan als .eml-bestand, en in de nieuwe Outlook kan dat helemaal niet. Nu plak je de mail rechtstreeks in het vak op het tabblad Ontvangen Audrey: selecteren, Ctrl+C, Ctrl+V, inlezen. Uploaden van een bestand kan nog steeds, dat staat nu onder 'Liever een bestand uploaden?'.",
    },

    {
      datum: "2026-08-29", bestand: "voorraad.html", soort: "hersteld",
      titel: "Containers verdwenen uit 'Onderweg naar Uddel'",
      wat: "Een zending viel uit dat overzicht zodra zijn aankomstdatum bereikt was, ook als niemand hem binnen had gemeld. Een container die je toevoegde met de datum van vandaag verscheen er dus nooit in. Nu blijft een zending staan tot het vinkje 'binnen' aan gaat, en de regel zegt zelf of hij vandaag komt, morgen, over zoveel dagen, of dat de datum al verstreken is. Er stonden er vijf op die manier onzichtbaar.",
    },
    {
      datum: "2026-08-29", bestand: "voorraad.html", soort: "hersteld",
      titel: "Zoeken op kleur geeft nu alleen kleuren",
      wat: "In de keuzelijst 'kleur' bij Particulier en Partner stonden ook spa-namen (Bermuda, Aruba, Regent) en stond dezelfde kleur meerdere keren met een andere schrijfwijze. De kleur wordt nu goed uit de orderregel gehaald en schrijfwijzen worden samengenomen: de lijst ging van 102 naar 56 regels, zonder modelnamen.",
    },

    {
      datum: "2026-08-28", bestand: "dealerportaal.html", soort: "beter",
      titel: "Eén plek voor documenten in plaats van twee",
      wat: "Het oude blok 'Documenten & specsheets' is weg. Dat nam alleen een link naar een bestand dat ergens anders al openbaar stond, en het portaal liet die lijst nergens zien - vandaar dat hij altijd op nul stond. Alles loopt nu via de Bibliotheek.",
    },
    {
      datum: "2026-08-28", bestand: "dealerportaal.html", soort: "nieuw",
      titel: "Zelf bestanden in het partnerportaal zetten",
      wat: "In het blok Bibliotheek kies je een map, geef je een titel en wijs je een bestand op je computer aan - pdf, word, excel of een afbeelding tot 24 MB. Het staat meteen bij de partners onder Documenten. Tot nu toe kon je alleen een link plakken naar iets dat elders al openbaar stond.",
    },

    {
      datum: "2026-08-27", groep: "partnerportaal-kijk", soort: "beter",
      titel: "Uitleg bij de prijzen: vracht en verpakking",
      wat: "Gretha bevestigde hoe de prijzen zijn opgebouwd. De 50 dollar verpakkingskosten kloppen en worden in Logic4 als losse regel doorberekend. Bij de Turbine-swimspa's staat geen vrachttoeslag omdat de containerkosten al in de verkoopprijs zitten - die worden dus niet dubbel gerekend.",
    },

    {
      datum: "2026-08-27", bestand: "container-laden.html", soort: "beter",
      titel: "Covers van swimspa's gaan in delen, en te brede spa's worden gemeld",
      wat: "Een lange cover werd tot nu toe als één stuk gerekend - bij een Aquatic 2 was dat ruim zes meter, en dan paste hij naast twee spa's net niet meer in de container. Chantal bevestigde dat zo'n cover in twee of drie delen komt; de berekening rekent nu met twee delen, dus er past meer in. Staat een model in geen enkele stand in de container, dan zegt het scherm dat nu ook, in plaats van stilletjes nul te tonen. De Turbine Grand is daar het voorbeeld van: die is drie meter breed en komt in een open container naar Nederland.",
    },

    {
      datum: "2026-08-27", bestand: "voorraad.html", soort: "nieuw",
      titel: "Regels verwijderen, zoeken in elk blok, en 'op voorraad' kiezen",
      wat: "Drie dingen bij Particulier en Partner. Met het kruisje achteraan haal je een reservering uit het dashboard; hij verdwijnt dan uit alle lijsten en met 'verwijderde regels tonen' haal je hem terug (in Logic4 verandert er niets). De blokken Afroep en binnengekomen, Binnen per adviseur en Gepland hebben nu een eigen zoekveld, zodat je daar op ordernummer kunt zoeken. En bij Verwachte levering kun je voortaan naast een schip ook 'op voorraad (Uddel)' aanwijzen.",
    },
    {
      datum: "2026-08-27", bestand: "voorraad.html", soort: "beter",
      titel: "Verwachte levering staat nu ook in de onderste blokken",
      wat: "In Afroep en binnengekomen en in Binnen per adviseur stond niet wanneer de spa binnenkomt, terwijl de planning daar juist op stuurt. Die kolom staat er nu bij, bij Particulier en bij Partner.",
    },
    {
      datum: "2026-08-27", bestand: "voorraad.html", soort: "hersteld",
      titel: "Lijsten worden niet meer leeg na een verversing",
      wat: "Het scherm ververst zichzelf elke tien minuten. Ging dat ophalen een keer mis, dan kon een lijst leeg raken terwijl er in werkelijkheid gewoon regels stonden - bij Gepland was dat goed schrikken. Een mislukte verversing laat nu alles staan zoals het was.",
    },

    {
      datum: "2026-08-26", bestand: "specsheets.html", soort: "beter",
      titel: "Duidelijk welk veld de NL- en welk de USA-sheet aanpast",
      wat: "In de Amerikaanse stand staat nu een groen NL-vlaggetje voor de gewone waarde en een geel USA-vlaggetje voor de Amerikaanse. Wat je in het NL-veld typt verandert de Nederlandse sheet, het USA-veld raakt alleen de Amerikaanse versie - handig bij elektra, waar Amerika echt andere getallen heeft.",
    },
    {
      datum: "2026-08-26", groep: "partnerportaal-kijk", soort: "beter",
      titel: "Prijslijst sorteert nu met een klik",
      wat: "In Passion Partners kun je in de prijslijst op elke kolomkop klikken om te sorteren: op categorie, op beschikbaarheid, op wat er op het water is of op prijs. Nog een keer klikken draait de volgorde om.",
    },
    {
      datum: "2026-08-26", bestand: "container-laden.html", soort: "beter",
      titel: "Turbines heten nu Luxury of Grand",
      wat: "De swimspa's van Storm Spas komen in twee uitvoeringen en die zijn nu uit elkaar gehouden: de Turbine 5, 6 en 7 heten voortaan Luxury, en daarnaast staan de Turbine 6, 7 en 8 Grand. De drie Grand-modellen zijn ook aan de modellenlijst toegevoegd, zodat hun afmeting ingevuld kan worden - zonder maat tellen ze bij het laden van een container voor niets mee.",
    },
    {
      datum: "2026-08-26", bestand: "voorraad.html", soort: "beter",
      titel: "Stock: fysiek nu ook per kleur te zien",
      wat: "Klap in het tabblad Stock een model open en je ziet per kleur twee getallen: fysiek (wat er werkelijk staat) en vrij (wat er nog te verkopen is). Zo zie je meteen waar het fysieke totaal uit bestaat. De uitleg bovenaan het tabblad vertelt precies hoe beide getallen worden berekend.",
    },
    {
      datum: "2026-08-26", bestand: "voorraad.html", soort: "beter",
      titel: "Afgehandelde orders verdwijnen ook op een openstaand scherm",
      wat: "Een order die in Logic4 op Afgehandeld staat verdwijnt overal uit het voorraadbeheer, ook uit Gepland. Dat werd elk uur al bijgewerkt, maar een scherm dat open bleef staan liet de oude lijst zien. Het scherm ververst de reserveringen nu zelf elke tien minuten.",
    },
    {
      datum: "2026-08-26", bestand: "container-laden.html", soort: "beter",
      titel: "Swimspa-codes bevestigd, Turbine Grand herkend",
      wat: "De fabriekscodes van de swimspa's zijn bevestigd. Drie codes bleken de Grand-uitvoering te zijn: die tellen nu als Turbine 6 Grand, Turbine 7 Grand en Turbine 8 Grand in plaats van de gewone Turbine.",
    },

    {
      datum: "2026-08-26", groep: "partnerportaal-kijk", soort: "beter",
      titel: "Passion Partners toont nu wat er echt beschikbaar is",
      wat: "Partners zien per model voortaan één getal Available: de voorraad plus wat er op het water is, min alles wat al gereserveerd is. Eerst stond er alleen de vrije halvoorraad, en die zei bij drukke modellen niets: er kon 2 staan terwijl er met de schepen erbij 40 echt te bestellen zijn, of andersom voorraad lijken terwijl alles al vergeven was.",
    },
    {
      datum: "2026-08-26", bestand: "dealerportaal.html", soort: "beter",
      titel: "Wisselkoers gaat vanzelf, debiteurnummer verplicht, adres invullen gaat sneller",
      wat: "Drie dingen bij het beheren van partners. De wisselkoers wordt nu elke dag automatisch opgehaald (officiële ECB-dagkoers min 0,03) - je hoeft hem niet meer zelf bij te houden. Een nieuwe dealer of partner kan niet meer bewaard worden zonder debiteurnummer, zodat er altijd een koppeling met Logic4 is. En bij Facturatie zit een zoekveld: typ het adres en straat, postcode, plaats en land vullen zichzelf in, ook bij buitenlandse adressen.",
    },
    {
      datum: "2026-08-26", iedereen: true, soort: "hersteld",
      titel: "Updates komen nu op elke computer aan",
      wat: "Op sommige kantoorcomputers kwamen vernieuwingen van het dashboard niet of pas veel later binnen. Het dashboard haalt zijn vernieuwingen nu langs een tweede weg op als de eerste dicht zit. Je hoeft er niets voor te doen.",
    },
    {
      datum: "2026-08-26", bestand: "voorraad.html", soort: "hersteld",
      titel: "Lijsten springen niet meer naar boven",
      wat: "Als je in een lijst gescrold had (zoals Afroep en binnengekomen bij Particulier) en je ging even naar een ander programma of scherm, stond de lijst bij terugkomst weer bovenaan. De lijsten onthouden nu gewoon waar je was.",
    },
    {
      datum: "2026-08-24", bestand: "voorraad.html", soort: "hersteld",
      titel: "Devine-invoice vindt de artikelen nu wel",
      wat: "Bij het inlezen van een Devine-invoice zei het scherm dat Believe, Wonder en Vision niet in Logic4 bestonden, terwijl ze er gewoon staan. De koppeling begrijpt nu dat 'Spa Believe' en 'Believe' hetzelfde model zijn, dat 'sliver white' Sterling White is, en dat een Wonder of Vision in Pearl Shadow in Logic4 Blackburn of Moondance heet.",
    },
    {
      datum: "2026-08-24", bestand: "voorraad.html", soort: "hersteld",
      titel: "Stock doet het weer, en de lijst past op een laptop",
      wat: "Het tabblad Stock bleef eeuwig op 'Bezig met laden' staan - twee stukken code bleken dezelfde naam te hebben en de verkeerde werd aangeroepen. Verder past de reserveringenlijst nu op een 15-inch scherm, opent een klik op een notitie een venster waarin je de hele tekst kunt lezen en schrijven, en vertelt het scherm bij het aanvinken van Inplannen of Gepland waar de regel heen is verhuisd.",
    },
    {
      datum: "2026-08-24", bestand: "voorraad.html", soort: "nieuw",
      titel: "Samenwerken zoals in Google Documenten",
      wat: "In de tabbladen Particulier en Partner zie je nu live wie er nog meer in de lijst zit, en de rij waar een collega in staat krijgt diens kleur en naam. Wat iemand aanvinkt of typt, verschijnt bij jou direct in beeld.",
    },
    {
      datum: "2026-08-24", bestand: "voorraad.html", soort: "hersteld",
      titel: "Vinkjes bleven niet staan",
      wat: "Wie in Particulier iets op Ingepland zette, zag dat na een herstart weer teruggedraaid - de opslag werd stilletjes geweigerd. Dat is gerepareerd. Bovendien ververst de lijst nu elke tien seconden, dus wat je collega aanvinkt zie je vrijwel meteen, en jullie schrijven elkaars vinkjes niet meer over. Bij Schepen en ontvangst staat overal het referentienummer voorop in plaats van de bootnaam: in Onderweg naar Uddel, op de zendingkaarten en op de tabbladen. De bootnaam blijft er klein bij staan.",
    },

    {
      datum: "2026-08-25", groep: "partnerportaal-kijk", soort: "nieuw",
      titel: "Chantal werkt mee aan Passion Partners",
      wat: "Chantal ziet nu ook de tegel Passion Partners, zodat ze het portaal kan bekijken zoals een dealer het ziet.",
    },
    {
      datum: "2026-08-25", bestand: "voorraad.html", soort: "beter",
      titel: "Klantnaam bij de spa, en de transporteur erbij",
      wat: "Zet de fabriek onder de SKT-code op de invoice een klantnaam met ordernummer (zoals Veldkamp 3507548), dan staat die nu in paars bij de spa - in Onderweg naar Uddel en in de ladingtabel, en je kunt er ook op zoeken. En bij Binnengekomen spa's staat een nieuwe kolom Transport, automatisch gevuld met wat er in Logic4 op de order bij transporteur staat: FBS, Transport distributie, Afhalen.",
    },

    /* ── 22 augustus 2026 ─────────────────────────────────────────────── */
    {
      datum: "2026-08-24", bestand: "planning.html", soort: "nieuw",
      titel: "Planning: de weekagenda",
      wat: "Een echte agenda voor de afdeling Spa planning: de hele week met de uren onder elkaar, kleuren per soort afspraak, en op elk blok wie hem heeft ingepland. De servicemeldingen uit Logic4 staan er als lijst naast en zijn met een klik in te plannen, met naam, adres en telefoon er automatisch bij. En per dag rekent de autoknop de route uit voor de bezorger of de monteur.",
    },
    {
      datum: "2026-08-22", iedereen: true, soort: "beter",
      titel: "Berichten los weg te klikken",
      wat: "Elk bericht in dit vak heeft nu een eigen kruisje. Gelezen haalt nog steeds alles in \u00e9\u00e9n keer weg; met het kruisje houd je alleen wat je nog wilt bewaren.",
    },
    {
      datum: "2026-08-22", bestand: "dealerportaal.html", soort: "nieuw",
      titel: "Welkomstmail voor nieuwe partners",
      wat: "Bij elke relatie staat nu een knop 'uitnodiging': die stuurt een nette welkomstmail waarmee de partner zelf een wachtwoord kiest en meteen in het portaal komt. De oude inloglinks zeiden vaak 'expired' omdat mailscanners ze al opgebruikten - dat is opgelost, links overleven de scanner nu.",
    },
    {
      datum: "2026-08-22", groep: "partnerportaal-kijk", soort: "nieuw",
      titel: "Tijdlijn: waar zijn je spa's",
      wat: "Partners zien bovenaan Mijn spa's nu een geanimeerde reis van hun reserveringen: van de Passion-fabriek, over zee met een varend schip, naar de haven en hun eigen magazijn - met per etappe welke modellen daar zijn en wanneer het schip aankomt.",
    },
    {
      datum: "2026-08-22", bestand: "voorraad.html", soort: "hersteld",
      titel: "Bestelde containers stonden op nul in Logic4",
      wat: "Maakte je vanuit een proforma een inkooporder aan, dan zette Logic4 die op 'niets te leveren' - de spa's telden nergens mee als besteld, ook al voeren ze nog. Nieuwe inkooporders krijgen nu de besteldatum mee en tellen weer gewoon mee. Orders die er al staan moeten met de hand worden bijgewerkt.",
    },
    {
      datum: "2026-08-22", groep: "partnerportaal-kijk", soort: "hersteld",
      titel: "De foto bij een model kwam niet in beeld",
      wat: "Ga je met de muis over een model, dan kwam het venstertje wel tevoorschijn maar de foto niet. Dat is opgelost. Het venstertje hangt nu ook aan je muis in plaats van naast de tegel, zodat je het niet elke keer hoeft te zoeken.",
    },

    /* ── 21 augustus 2026 ─────────────────────────────────────────────── */
    /* Dit bericht legt zichzelf uit: het is het eerste dat iedereen in het
       nieuwe blok te zien krijgt. Zonder deze regel staat er een vak op je
       dashboard waarvan je niet weet wat het is. */
    {
      datum: "2026-08-21", iedereen: true, soort: "nieuw",
      titel: "Je ziet voortaan wat er nieuw is",
      wat: "Bovenaan je dashboard staat vanaf nu wat er aan jouw tegels veranderd is, en welke tegel je erbij hebt gekregen. Gelezen? Klik op Gelezen, dan is het weg en krijg je het niet nog een keer.",
    },
    {
      datum: "2026-08-21", bestand: "dealerportaal.html", soort: "nieuw",
      titel: "Dealers en partners aanmaken",
      wat: "Een nieuwe dealer of partner invoeren kan nu vanuit het dashboard zelf, met de afspraken, het factuuradres en een afwijkend verzendadres erbij. Zoeken in Logic4 gaat op debiteurnummer, op e-mailadres en op bedrijfsnaam.",
    },
    {
      datum: "2026-08-21", groep: "partnerportaal-kijk", soort: "beter",
      titel: "Passion Partners: prijslijst en foto's",
      wat: "Het portaal heeft een tabblad Prijslijst waar alle modellen met hun prijs onder elkaar staan. Ga je met de muis over een model, dan zie je een bovenaanzicht van de spa. De Reserveren-knop staat overal op dezelfde hoogte en is groen.",
    },
    {
      datum: "2026-08-21", bestand: "afbeeldingen.html", soort: "nieuw",
      titel: "Afbeeldingen op maat",
      wat: "Sleep er zoveel foto's in als je wilt en ze komen er allemaal uit op 1200 bij 900 en 300 dpi, bijgesneden zonder witte randen en met dezelfde bestandsnaam. Past een foto niet zonder dat er tekst afvalt, dan zegt hij dat erbij.",
    },

    /* ── 19 augustus 2026 ─────────────────────────────────────────────── */
    {
      datum: "2026-08-19", bestand: "vertalen.html", soort: "nieuw",
      titel: "Vertalen",
      wat: "Plak of typ een mail en kies de taal: Spaans, Italiaans, Duits, Frans of Engels. Je kunt kiezen tussen u en je, namen die niet vertaald mogen worden opgeven, en de vertaling terug laten vertalen om te zien of hij klopt.",
    },
    {
      datum: "2026-08-19", bestand: "voorraad.html", soort: "beter",
      titel: "Voorraadbeheer op de telefoon",
      wat: "Op de telefoon krijg je nu een eigen, smalle weergave: voorraad, wat er onderweg is, schepen en ontvangst, en een order opzoeken. Alles onder elkaar in plaats van tabbladen die je niet kunt aanwijzen.",
    },
    {
      datum: "2026-08-19", bestand: "voorraad.html", soort: "beter",
      titel: "Gepland, Stock en binnen melden",
      wat: "Er zijn twee tabbladen bijgekomen, Gepland en Stock. Bij Schepen en ontvangst staat nu de naam van de spa erbij en kun je een container binnen melden zonder eerst Logic4 te openen.",
    },
    {
      datum: "2026-08-19", bestand: "bankkoppeling.html", soort: "beter",
      titel: "Ook de uitgaven op het afschrift",
      wat: "Het bankafschrift laat nu naast de ontvangsten ook de uitgaven zien, in dezelfde lijst met de dagbalans erbij. Een uitgave kun je aanvinken en aan een crediteurfactuur koppelen, en die gaat dan mee als boekregel.",
    },
    {
      datum: "2026-08-19", bestand: "retouren.html", soort: "beter",
      titel: "Adviseur en meerdere regels",
      wat: "De adviseur wordt automatisch uit de order in Logic4 gehaald, dus die hoef je niet meer op te zoeken. Een order met meerdere producten kun je nu per regel afhandelen.",
    },
    {
      datum: "2026-08-19", bestand: "labels.html", soort: "beter",
      titel: "Labels uit de commercial invoice",
      wat: "Naast de inkooporder leest hij nu ook een commercial invoice met packing list, en maakt daar de containers en de labels uit.",
    },
    {
      datum: "2026-08-19", bestand: "mail.html", soort: "hersteld",
      titel: "Mijn mail: tweede weg naar de mailbox",
      wat: "De verbinding met de mailserver liep vast. Er is nu een tweede route, en een proefrit waarmee je kunt zien welke van de twee het bij jou doet.",
    },

    /* ── 17 augustus 2026 ─────────────────────────────────────────────── */
    {
      datum: "2026-08-17", bestand: "geldgoederen.html", soort: "beter",
      titel: "Vier voorraadcijfers naast elkaar",
      wat: "In plaats van één verschil zie je nu de vier cijfers waar dat verschil uit ontstaat. De handmatige aansluitboekingen staan apart, en je kunt de voorraad terugrekenen naar een peildatum.",
    },
    {
      datum: "2026-08-17", bestand: "tuinmeubelen.html", soort: "beter",
      titel: "Orderbevestiging van de fabriek lezen",
      wat: "Een orderbevestiging van een meubelfabriek wordt ingelezen en aan de zending gekoppeld waarmee de spullen komen. Een omschrijving die je bij een artikelnummer zet geldt meteen voor alle containers.",
    },
    {
      datum: "2026-08-17", bestand: "bankkoppeling.html", soort: "beter",
      titel: "Stichting Pay en Airbnb herkend",
      wat: "Betalingen via Stichting Pay en via Airbnb worden nu vanzelf herkend op het afschrift.",
    },

    /* ── 16 augustus 2026 ─────────────────────────────────────────────── */
    {
      datum: "2026-08-16", bestand: "uren.html", soort: "nieuw",
      titel: "Mijn uren",
      wat: "Klokken met een knop: start als je begint, stop als je klaar bent. Vergeten? Dan pas je de regel achteraf aan. Je kunt er ook bij zetten waar je was, en voor een collega klokken die zijn eigen code opgeeft.",
    },

    /* ── 15 augustus 2026 ─────────────────────────────────────────────── */
    {
      datum: "2026-08-15", iedereen: true, soort: "nieuw",
      titel: "Het dashboard op je telefoon",
      wat: "Alle tegels die je op de pc hebt staan nu ook op je telefoon, met precies dezelfde rechten. Op Android kun je hem op je startscherm zetten en werkt hij als een gewone app.",
    },
  ];

  /* ═══════════════ hulpjes ═══════════════ */

  function dagenGeleden(n) {
    return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  }
  function datumVan(iso) {
    return String(iso || "").slice(0, 10);
  }

  /* Welke berichten gaan deze persoon aan? Alleen die over tegels die ook
     werkelijk geopend mogen worden - de tegellijst is de enige waarheid, zodat een
     bericht nooit een tegel verraadt die iemand niet heeft. */
  function zichtbaar(wie) {
    var t = global.fpTegels;
    if (!t || !t.voor) return [];
    var mijn = t.voor(wie) || [];
    var bestanden = {}, groepen = {};
    mijn.forEach(function (x) { bestanden[x.bestand] = true; groepen[x.groep] = true; });
    return NIEUWS.filter(function (n) {
      if (n.iedereen) return true;
      if (n.bestand) return !!bestanden[n.bestand];
      if (n.groep) return !!groepen[n.groep];
      return false;
    });
  }

  /* De berichten die deze persoon nog niet heeft gezien.
     sinds = de dag waarop er voor het laatst op "gezien" is geklikt. Is die er
     niet, dan kijken we EERSTE_KEER_DAGEN terug in plaats van tot het begin
     der tijden; anders opent iemand het dashboard en krijgt vijftien
     berichten tegelijk. */
  function voor(wie, sinds) {
    var grens = datumVan(sinds) || dagenGeleden(EERSTE_KEER_DAGEN);
    return zichtbaar(wie)
      .filter(function (n) { return datumVan(n.datum) > grens; })
      .sort(function (a, b) { return a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0; });
  }

  /* Welke tegels heeft iemand erbij gekregen sinds de vorige keer? Dit is
     geen lijst die iemand bijhoudt: we vergelijken wat er nu te zien is met
     wat er de vorige keer te zien was. Krijgt Chantal er Vertalen bij, dan
     ziet zij dat de eerstvolgende keer dat ze inlogt, zonder dat er iemand
     aan gedacht heeft dat op te schrijven.

     eerder = de lijst bestandsnamen van de vorige keer. Is die leeg (eerste
     keer op deze manier), dan melden we niets - anders zou iedereen de hele
     tegelrij als "nieuw" gepresenteerd krijgen. */
  function nieuweTegels(wie, eerder) {
    var t = global.fpTegels;
    if (!t || !t.voor) return [];
    if (!eerder || !eerder.length) return [];
    var had = {};
    eerder.forEach(function (b) { had[b] = true; });
    return (t.voor(wie) || []).filter(function (x) { return !had[x.bestand]; });
  }

  /* De vaste sleutel van een bericht: datum plus titel. Geen apart
     id-veld dat iedereen moet onthouden bij te houden - en verandert een
     titel, dan komt het bericht één keer terug, wat eerder juist dan fout
     is. Wordt gebruikt voor het wegklikken van losse berichten. */
  function sleutelVan(n) {
    return datumVan(n.datum) + "|" + String(n.titel || "");
  }

  /* Alles in één keer, en meteen goed ontdubbeld.

     Wie een tegel er nét bij heeft gekregen, hoeft niet ook nog te horen wat
     er de afgelopen weken aan die tegel verbeterd is - die tegel is nog nooit
     eerder in beeld geweest, dus er is niets veranderd. De tegel zelf is het
     nieuws.

     gezien = het bewaarde recordje uit de bucket 'dashboard-gezien', of null
     als deze persoon er nog geen heeft.  →  { nieuws, tegels } */
  function samenstellen(wie, gezien) {
    var tegels = gezien ? nieuweTegels(wie, gezien.tegels) : [];
    var nieuw = {};
    tegels.forEach(function (t) { nieuw[t.bestand] = true; nieuw["groep:" + t.groep] = true; });
    // Losse berichten die deze persoon met het kruisje heeft weggeklikt.
    var weg = {};
    ((gezien && gezien.weggeklikt) || []).forEach(function (k) { weg[k] = true; });
    var berichten = voor(wie, gezien && gezien.gezien).filter(function (n) {
      if (weg[sleutelVan(n)]) return false;
      if (n.bestand && nieuw[n.bestand]) return false;
      if (n.groep && nieuw["groep:" + n.groep]) return false;
      return true;
    });
    return { nieuws: berichten, tegels: tegels };
  }

  /* De huidige stand, om te bewaren voor de volgende keer. */
  function tegelStand(wie) {
    var t = global.fpTegels;
    if (!t || !t.voor) return [];
    return (t.voor(wie) || []).map(function (x) { return x.bestand; });
  }

  global.fpNieuws = {
    lijst: NIEUWS,
    samenstellen: samenstellen,
    sleutelVan: sleutelVan,
    voor: voor,
    zichtbaar: zichtbaar,
    nieuweTegels: nieuweTegels,
    tegelStand: tegelStand,
    eersteKeerDagen: EERSTE_KEER_DAGEN,
  };

})(typeof window !== "undefined" ? window : globalThis);
