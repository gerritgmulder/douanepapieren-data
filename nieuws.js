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
      datum: "2026-09-08", bestand: "amerika.html", soort: "beter",
      titel: "Batches uit Amerika sluiten nu eerst aan",
      wat: "Een batch wordt pas geboekt als de som klopt: de factuurbedragen min de ingehouden bankkosten moeten precies zijn wat er op de bank binnenkwam, en elke factuur moet een Logic4-order hebben. Klopt er iets niet, dan blijft die batch staan met erbij wat eraan ontbreekt. De orders gaan er voor hun volledige bedrag af en de bankkosten als aparte regel, zodat er nooit meer twee keer bankkosten worden afgetrokken. Staat een batch er per ongeluk twee keer in, dan zegt het scherm dat ook.",
    },

    {
      datum: "2026-09-08", bestand: "labels.html", soort: "beter",
      titel: "Het label toont nu het model en het Fonteyn-artikelnummer",
      wat: "Op het label stond de kale fabriekscode als titel en bij Art.nr. Fonteyn een streepje. Er staat nu bovenaan de volledige omschrijving, zoals 'Bliss Spa | Sterling White with GREY/oak trim', met het Fonteyn-artikelnummer erbij. Dat wordt opgezocht met de kleur erbij, want dezelfde fabriekscode bestaat in meerdere kleuren en elke kleur is een eigen artikelnummer.",
    },

    {
      datum: "2026-09-08", bestand: "voorraad.html", soort: "beter",
      titel: "Proforma van Huantong wordt nu gelezen",
      wat: "Die proforma leverde geen enkele regel op. Nu komt eruit wat erop staat: 21 Bermuda en 6 Key Largo, met kleur, maat en bedragen. Ook bij andere fabrieken blijft de kleur nu netjes staan in plaats van dat er tekst van de volgende kolom bij kwam.",
    },

    {
      datum: "2026-09-08", bestand: "voorraad.html", soort: "hersteld",
      titel: "Drie zendingen stonden ten onrechte op nul spa's",
      wat: "De containers HLXU5649735, TEXU1543510 en TEXU1577043 stonden allemaal op 0 spa's. Op die facturen staan de codes met spaties eromheen (WS - PC08T) en daar viel de herkenning op af. Er zitten twee Turbine 8 Grand en een Turbine 7 Grand in, en die tellen nu weer mee als voorraad onderweg. Onderdelen als 'roller shutter for ...' worden niet meer als spa geteld.",
    },

    {
      datum: "2026-09-08", bestand: "voorraad.html", soort: "hersteld",
      titel: "Grote proforma's gaan nu in één keer goed",
      wat: "Bij een proforma met veel regels kwam maar een deel in de inkooporder terecht en kreeg je een scherm vol foutmeldingen. Er kunnen namelijk maar een beperkt aantal regels per keer naar Logic4. Het dashboard doet ze nu in blokken van vijftien en vult de order aan, met de voortgang in de knop. Je hoeft niets anders te doen.",
    },

    {
      datum: "2026-09-08", bestand: "voorraad.html", soort: "hersteld",
      titel: "25 spa's stonden onder de verkeerde naam op een schip",
      wat: "Op zending 3332-6&3342-1 stonden 10 Soulmates die Reboots zijn, 5 Ecstatic Wave die Ecstatic Mighty Wave zijn en 10 Mallorca Superior die Blackpool zijn. Die invoice was ingelezen voordat die codes goed werden herkend. Rechtgezet, dus de voorraad onderweg klopt weer per model.",
    },

    {
      datum: "2026-09-08", bestand: "labels.html", soort: "nieuw",
      titel: "De containers van 3332-6&3342-1 staan klaar",
      wat: "Tien containers met samen 131 baden staan bij Inkomende goederen, elk met hun eigen baden en trackingnummers. Klik een container aan en print de labels.",
    },

    {
      datum: "2026-09-08", bestand: "voorraad.html", soort: "hersteld",
      titel: "Meldingen bij Schepen waren onzichtbaar",
      wat: "Ging er iets mis bij het verwijderen of opslaan van een schip, dan verscheen die melding in een vak op een ander tabblad. Je zag dus niets. Meldingen staan nu bovenaan het tabblad Schepen zelf.",
    },

    {
      datum: "2026-09-08", bestand: "voorraad.html", soort: "hersteld",
      titel: "Zendingen zonder referentie stonden dubbel en waren niet te openen",
      wat: "Van fabrieken die geen RZ-nummer gebruiken werd het referentienummer niet van de invoice overgenomen. Zo'n zending kwam naamloos in de lijst, en twee naamloze zien er identiek uit: dubbel dus, en bij Schepen & ontvangst kon je de tweede niet openen. Het nummer wordt nu wel gelezen (New Normal, Kasdaly), je kunt het zelf aanpassen, en tweemaal hetzelfde bestand uploaden maakt geen tweede regel meer.",
    },

    {
      datum: "2026-09-08", bestand: "amerika.html", soort: "beter",
      titel: "Klik een zending open om te zien wat erin zit",
      wat: "Bij Onderweg naar Houston kun je een regel aanklikken. Dan klapt hij open en zie je per model het aantal, de kleur en het artikelnummer. Nog een keer klikken en hij is weer dicht. Ook bij bestellingen van vóór vandaag: die inhoud is alsnog opgehaald.",
    },

    {
      datum: "2026-09-08", bestand: "voorraad.html", soort: "beter",
      titel: "Bij verwachte levering zie je waar de spa vandaan komt",
      wat: "Staat er 'volgende productie', dan zie je nu het bestelnummer bij de fabriek en de verwachte datum erbij. Is er nog niets besteld, dan staat dat er ook gewoon: 'nog niet besteld bij de fabriek'. Eerder bleef die regel leeg en was niet te zien of het nummer ontbrak of dat er niets besteld was. De bestelgegevens worden bovendien weer elke zes uur bijgewerkt; die liepen achter.",
    },

    {
      datum: "2026-09-08", bestand: "voorraad.html", soort: "hersteld",
      titel: "Een gekozen schip blijft nu staan",
      wat: "Koos je bij een reservering zelf een schip, dan sprong dat later weer terug op automatisch, en ook vinkjes en opmerkingen raakten zoek. Dat gebeurde zodra een spa van magazijn wisselde of we de kleurherkenning verbeterden. Je keuze hangt nu vast aan de orderregel zelf en blijft staan. De 491 aantekeningen die er al waren zijn meegenomen.",
    },

    {
      datum: "2026-09-08", bestand: "labels.html", soort: "hersteld",
      titel: "Labels printen per container",
      wat: "Jazzi levert de packing list als een tabblad per container, en zo'n bestand werd helemaal niet ingelezen: de containerlijst bij Inkomende goederen bleef leeg. Nu komt elke container er apart in te staan met zijn eigen baden, zodat je per container in één keer de labels kunt printen. Losse onderdelen tellen niet meer als bad mee.",
    },

    {
      datum: "2026-09-08", bestand: "amerika.html", soort: "nieuw",
      titel: "Zie wat er onderweg is naar Houston",
      wat: "Bovenaan Voorraad Houston staat nu elke bestelling die je bij Containers uit een proforma hebt aangemaakt. Zolang er geen commercial invoice bij zit staat hij onder In productie; upload je die, dan schuift hij door naar Onderweg en kun je zelf invullen wanneer je hem in Houston verwacht.",
    },

    {
      datum: "2026-09-08", bestand: "voorraad.html", soort: "beter",
      titel: "Proforma's als pdf worden nu wel herkend",
      wat: "Bij een proforma in pdf zei het scherm 'onbekende fabriekscode', ook bij codes die het Dashboard allang kent. Die worden nu gewoon herkend: JOYSPA levert Calgary en Kenai op, Arnoswim de Hurricane. Sauna's en losse onderdelen blijven onbekend, daarvoor moeten de codes nog van Gretha komen.",
    },

    {
      datum: "2026-09-08", bestand: "voorraad.html", soort: "hersteld",
      titel: "Vier swimspa's stonden onder hun merknaam",
      wat: "Calgary, Vancouver, Anchorage en Hurricane stonden in het Dashboard onder 'Grizzly Spas' en 'Storm Spas' in plaats van onder hun eigen naam. Daardoor vond een bestelling er geen artikel bij. Ze staan nu op hun eigen naam.",
    },

    {
      datum: "2026-09-08", bestand: "voorraad.html", soort: "beter",
      titel: "Binnenkomende schepen staan nu op ETA",
      wat: "Bij Overzicht stonden de schepen door elkaar. Ze staan nu op aankomstdatum, eerstvolgende bovenaan. Schepen waar de ETA nog bij moet staan onderaan, want die moet je juist nog invullen.",
    },

    {
      datum: "2026-09-08", bestand: "planning.html", soort: "beter",
      titel: "Standaard drie routes per dag",
      wat: "Een nieuwe dag begon met één route, en wat je daarna aanklikte bleef bewaard. Daardoor liep het per dag uit elkaar: zes routes op woensdag, vijf op maandag, drie op donderdag. Standaard zijn het er nu drie, en meer of minder per dag kan gewoon nog.",
    },

    {
      datum: "2026-09-08", bestand: "voorraad.html", soort: "beter",
      titel: "Facturen van meer fabrieken worden ingelezen",
      wat: "De commercial invoice van New Normal gaf geen enkele regel terug. Die wordt nu gewoon gelezen: 36 spa's met model, aantal en kleur. De facturen van Jazzi en Kasdaly gaan onveranderd door.",
    },

    {
      datum: "2026-09-07", bestand: "activiteit.html", soort: "nieuw",
      titel: "Zie je een oude versie, dan staat dat er nu bij",
      wat: "Bij Apparaten staat achter een computer met een oude versie voortaan 'loopt achter'. Handig als iemand een knop mist die er bij de rest wel is: dan hoeft die computer alleen opnieuw opgestart te worden.",
    },

        {
      datum: "2026-09-07", bestand: "voorraad.html", soort: "beter",
      titel: "Proforma inlezen gaat met meer bestanden goed",
      wat: "Een aantal proforma's viel af terwijl er niets mis mee was; die lezen nu wel in. Lukt een bestand toch niet, dan zegt het scherm waarom. En bij een proforma van meubelen of onderdelen staat er nu gewoon dat dit scherm alleen spa's doet.",
    },

    {
      datum: "2026-09-07", bestand: "dealerportaal.html", soort: "beter",
      titel: "Valuta volgt het land van de dealer",
      wat: "Het portaal opende altijd in euro's, ook voor een dealer in Texas: het regioveld stond standaard op EU en niemand kwam eraan. Vul je nu een factuurland in, dan springt de regio mee (US en CA op dollars, de rest op euro's). Kies je zelf iets anders, dan blijft dat staan.",
    },

    {
      datum: "2026-09-07", bestand: "dealerportaal.html", soort: "beter",
      titel: "Bezorgkosten rekenen nu ook voor de modellen die eerst wegvielen",
      wat: "Van een aantal modellen kenden we de kistmaat niet, en die telden dan niet mee in de bezorgprijs: de dealer zag een bedrag waar zijn spa niet in zat. De maten uit de douanetegel vullen dat nu aan, waaronder de Vitality Deep en Wim Hof's Ice Barrel XL. Van 17 modellen ontbreekt de maat nog; die staan er met naam bij als je ze in de wagen legt. Ook weg: de zin dat een zware lading hoger kan uitvallen. Dat kan niet: elke tariefband staat op 1750 kg per laadmeter en het zwaarste dat we vervoeren haalt er 500.",
    },

    {
      datum: "2026-09-07", bestand: "amerika.html", soort: "beter",
      titel: "De bedragen van de Amerika-orders kloppen met QuickBooks",
      wat: "Alle 116 orders die uit QuickBooks zijn omgezet staan in Logic4 op precies het factuurbedrag, samen $ 414.719,18. De sales tax van 8,25% en de verzendkosten werden niet meegenomen, en op negen spa-regels stond Nederlandse btw in plaats van 0% export. Dat is rechtgezet, dus je kunt boeken op 1160.",
    },

    {
      datum: "2026-09-07", bestand: "amerika.html", soort: "beter",
      titel: "Facturen met hetzelfde nummer raken elkaar niet meer kwijt",
      wat: "QuickBooks gebruikt tien factuurnummers twee keer, op verschillende klanten. Van zo'n paar kreeg maar één factuur een Logic4-order en verdween de andere uit beeld, waaronder Hot Tub Outpost ($ 1.141,02) en Swim King ($ 32.648,52). De koppeling loopt nu op het interne nummer van QuickBooks, dat wel uniek is. Een dubbel nummer krijgt in de lijst het label 'nr 2x'; die facturen mag je allebei accorderen.",
    },

    {
      datum: "2026-09-07", bestand: "amerika.html", soort: "beter",
      titel: "Een order verspringt niet meer als je hem aanvinkt",
      wat: "Vinkte Osman een order af, dan schoot die meteen naar de onderkant van het scherm en moest je zoeken waar je gebleven was. De volgorde ligt nu vast zolang het scherm openstaat.",
    },

    {
      datum: "2026-09-07", bestand: "dealerportaal.html", soort: "nieuw",
      titel: "Partners kiezen zelf: afhalen of bezorgen",
      wat: "In de winkelwagen van Passion Partners kan een dealer nu kiezen of hij de spa's zelf ophaalt of laat bezorgen. Bij bezorgen kiest hij zijn land en postcode en staat het bedrag er meteen, inclusief brandstoftoeslag en eventueel een kooiaap. Wat hij kiest komt in de mail naar sales te staan.",
    },

    {
      datum: "2026-09-07", bestand: "amerika.html", soort: "beter",
      titel: "Oudere facturen van een wire staan er nu ook bij",
      wat: "Facturen met een nummer onder de 3300 vielen buiten de lijst en konden daardoor geen Logic4-order krijgen. Staan ze op een wire, dan komen ze er nu wel bij: zes stuks. De rest van de historie blijft buiten beeld, dus de lijst wordt er niet langer van.",
    },

    {
      datum: "2026-09-07", bestand: "amerika.html", soort: "nieuw",
      titel: "Bankkosten gaan mee op 4630",
      wat: "Bij het boeken op 1160 komt de bankkosten van een wire nu als aparte regel op grootboek 4630, zodat er op 1160 precies overblijft wat er op de bank binnenkwam. De kostenplaats Spa Houston USA kan de koppeling niet meegeven; dat staat als herinnering op het scherm en in de bevestiging.",
    },

    {
      datum: "2026-09-07", bestand: "amerika.html", soort: "nieuw",
      titel: "Alle wires in één keer boeken",
      wat: "Naast de knop per wire staat er nu ook 'alles boeken op 1160', die alle wires achter elkaar afwerkt. Ook hier eerst een proef met wat er gaat gebeuren, en wat al geboekt is wordt overgeslagen.",
    },

    {
      datum: "2026-09-07", bestand: "amerika.html", soort: "hersteld",
      titel: "De bedragen staan nu op de Amerika-orders",
      wat: "Elke order die uit QuickBooks was aangemaakt stond in Logic4 op nul dollar; het bedrag van de factuurregel werd niet meegestuurd. Dat is rechtgezet, en met de knop 'bedragen bijwerken' bij Geaccordeerd haal je de bedragen alsnog op voor de orders die er al stonden. Regels die al een bedrag hebben blijven met rust.",
    },

    {
      datum: "2026-09-07", bestand: "amerika.html", soort: "nieuw",
      titel: "Een wire in één keer boeken op 1160",
      wat: "Bij elke wire staat nu een knop 'boeken op 1160'. Die boekt de facturen van die betaling af op hun Logic4-order, in het dagboek Bank Passion Spas South TX. Je krijgt eerst te zien wat er geboekt zou worden en wat er niet kan, en pas na akkoord gaat het echt. Wat al geboekt is kan niet nog een keer.",
    },

    {
      datum: "2026-09-07", iedereen: true, soort: "hersteld",
      titel: "De Mac werkt zichzelf nu bij",
      wat: "Op de Mac kwamen updates nooit binnen; die bleef op een oude versie staan terwijl de Windows-computers netjes meeliepen. Dat is opgelost, en er hoeft niets voor betaald te worden.",
    },

    {
      datum: "2026-09-07", groep: "planning", soort: "beter",
      titel: "De hele week past op één scherm",
      wat: "Zet je drie routes op elke dag, dan moest je horizontaal schuiven om de vrijdag te zien. Nu delen de dagen de breedte van het scherm, net als de weekweergave in Outlook, en past de hele week er altijd op. Bij 'wie rijdt?' kies je nu uit de collega's van de afdeling; zelf een naam typen kan nog steeds.",
    },

    {
      datum: "2026-09-07", iedereen: true, soort: "beter",
      titel: "Het dashboard start een stuk sneller op",
      wat: "Het venster wachtte tot alle tegels bij GitHub waren opgehaald voordat er iets in beeld kwam. Dat kon op een trage lijn tientallen seconden duren. Nu staat het scherm er zodra het klaar is en wordt er op de achtergrond bijgewerkt. Let op: dit zit in de app zelf, dus het geldt pas na de volgende installatie (op Windows gaat dat vanzelf).",
    },

    {
      datum: "2026-09-07", bestand: "voorraad.html", soort: "beter",
      titel: "Geen horizontaal geschuif meer bij Reserveringen",
      wat: "De lijsten bij Particulier, Partner, Gepland, Afroep en Binnengekomen pasten niet op het scherm; je moest naar rechts schuiven om bij de vinkjes te komen. Wat je leest staat nu op de regel en wat je doet - verwachte levering, notitie, afroep, inplannen, gepland - op een dunne strook eronder. Alles past nu in de breedte.",
    },

    {
      datum: "2026-09-07", groep: "planning", soort: "beter",
      titel: "Routes staan als kolommen naast elkaar",
      wat: "Op het routebord staat nu boven elke kolom 'Route 1', 'Route 2' met daaronder wie er rijdt, zodat je per dag in één oogopslag ziet hoeveel routes er staan en welke stops erbij horen. Dat kon al, maar het was niet te zien: een route had alleen een klein nummertje.",
    },

    {
      datum: "2026-09-07", bestand: "voorraad.html", soort: "beter",
      titel: "Deposit-proforma van New Normal wordt herkend",
      wat: "De deposit-proforma van New Normal kun je nu gewoon uploaden bij 'Inkoop naar Logic4'. De leverancier wordt aan het briefhoofd herkend en het factuurnummer wordt goed gelezen, ook als de fabriek het over drie cellen verdeelt. Staat er geen factuurnummer op, dan pakt hij het containernummer uit de bestandsnaam.",
    },

    {
      datum: "2026-09-07", bestand: "dealerportaal.html", soort: "beter",
      titel: "Orders uit het portaal staan meteen goed in Logic4",
      wat: "Een bestelling uit Passion Partners krijgt nu vanzelf de orderbron 'Bestaande Dealer', het juiste magazijntype (Spa Service Magazijn als het alleen onderdelen zijn, anders Magazijn) en 31-12-2099 als indicatieve leverdatum. Dat hoefde sales tot nu toe bij elke order met de hand na te zetten.",
    },

    {
      datum: "2026-09-07", bestand: "dealerportaal.html", soort: "beter",
      titel: "Verplichte velden en een aanhef",
      wat: "Een nieuwe dealer of partner aanmaken kan niet meer met halve gegevens: bedrijfsnaam, contactpersoon, e-mail, telefoon, adres, land, bron klant en (binnen de EU) het btw-nummer moeten ingevuld zijn. Wat ontbreekt wordt rood omrand. Er is ook een aanhef bijgekomen, zodat er niet meer 'hij' staat bij iemand die geen hij is.",
    },

    {
      datum: "2026-09-07", bestand: "voorraad.html", soort: "hersteld",
      titel: "Orders die verderop in het proces zijn staan er weer bij",
      wat: "Een order die al te factureren stond, gepickt werd of op afhaal stond, verdween uit de lijst terwijl de spa nog niet was afgeleverd. Er werd namelijk maar naar vijf orderstatussen gekeken. Nu naar dertien, en dat scheelt 91 orders die buiten beeld stonden. Bij elke regel zie je in welke status hij staat.",
    },

    {
      datum: "2026-09-07", bestand: "voorraad.html", soort: "beter",
      titel: "Geen invulvenster meer bij een dealer",
      wat: "Vink je 'Gepland' aan bij een dealer of zakelijke klant, dan komt er geen venster meer met datum, tijd, adres en telefoon. Dat regel je in Logic4 en het was dubbel werk. Wil je er toch een afspraak in Planning bij, dan staat daar nu een knopje 'agenda' naast. Bij een particulier blijft het venster wel meteen komen, want daar is de afspraak met de klant juist het punt.",
    },

    {
      datum: "2026-09-07", bestand: "voorraad.html", soort: "hersteld",
      titel: "Verwachte levering houdt rekening met de kleur",
      wat: "Een order werd aan het eerstvolgende schip gekoppeld waar dat model op stond, ongeacht de kleur. Op de commercial invoice staat de schaalkleur, dus dat kan beter: een Mystic Mountain-order landt niet meer op een container vol Sterling White. Sterling Silver #30 op de invoice is Sterling White in Logic4; dat is nu gekoppeld.",
    },

    {
      datum: "2026-09-07", bestand: "voorraad.html", soort: "hersteld",
      titel: "Dealercontainers tellen niet meer als voorraad",
      wat: "Laad je een commercial invoice op van een container die rechtstreeks naar een dealer gaat, dan telde die lading mee als voorraad onderweg. Dat klopt niet: die spa's komen nooit in Uddel. Het dashboard leest nu op de invoice waar de container heen gaat ('to Rotterdam' of 'to <naam dealer>'), zegt dat bij het uploaden, en je kunt het per schip zelf omzetten.",
    },

    {
      datum: "2026-09-07", bestand: "voorraad.html", soort: "hersteld",
      titel: "ETA's blijven vanzelf kloppen",
      wat: "De verwachte aankomst wordt nu elk uur bij de vervoerder nagevraagd, ook voor schepen waar al een datum bij stond. Die schoof namelijk: bij container 3332-7&3342-3 stond 28 augustus terwijl het 11 september was. Vier ETA's zijn daarmee rechtgezet. Vul je zelf een datum in, dan blijft die staan; wijkt de vervoerder daarvan af, dan zie je dat erbij.",
    },

    {
      datum: "2026-09-07", bestand: "voorraad.html", soort: "beter",
      titel: "ETA bij Partner containers",
      wat: "In het overzicht van alle partnercontainers bleef de kolom ETA leeg zonder dat je wist waarom. Nu staat de datum er zodra hij bekend is, met het schip erbij, en anders wát eraan ontbreekt: geen containernummer in Logic4, nog geen commercial invoice, of een invoice waarbij de ETA nog niet is ingevuld.",
    },

    {
      datum: "2026-09-07", bestand: "voorraad.html", soort: "hersteld",
      titel: "'Op voorraad' klopt nu ook op kleur",
      wat: "Bij de verwachte levering stond soms 'op voorraad' terwijl die kleur er niet lag. Er werd alleen geteld hoeveel spa's van dat model vrij waren, niet welke kleur. Nu pakt elke reservering uit de voorraad van zijn eigen kleur. En de lijst was zes dagen niet ververst; de uursync liep vast en dat is verholpen.",
    },

    {
      datum: "2026-09-07", bestand: "voorraad.html", soort: "beter",
      titel: "IJsbaden staan niet meer op nul",
      wat: "Een ijsbad dat uit onderdelen wordt samengesteld stond op nul beschikbaar, ook als er honderd vaten en chillers in Uddel lagen. Nu zie je hoeveel er van gemaakt kunnen worden, met erbij dat hij bij het bestellen wordt samengesteld.",
    },

    {
      datum: "2026-09-07", bestand: "dealerportaal.html", soort: "beter",
      titel: "Btw-nummer nakijken en bron klant",
      wat: "Bij een nieuwe dealer of partner kun je het btw-nummer met één knop bij de EU laten nakijken; je ziet meteen of het geldig is en op welk bedrijf het staat, en de bedrijfsnaam wordt overgenomen. Bron klant is nu een verplichte keuze, en een nieuwe debiteur komt meteen als Zakelijk in Logic4 te staan in plaats van als Particulier.",
    },

    {
      datum: "2026-09-07", bestand: "dealerportaal.html", soort: "hersteld",
      titel: "Zoeken op bedrijfsnaam doet het weer",
      wat: "Bij een nieuwe dealer of partner kun je weer op bedrijfsnaam zoeken in Logic4. De zoeklijst waar dat op steunt was nooit opgebouwd; die staat er nu, met 28.620 zakelijke relaties erin.",
    },

    {
      datum: "2026-09-07", bestand: "container-laden.html", soort: "beter",
      titel: "Minder knoppen: één container, geen ruimte-veld",
      wat: "De keuzelijst met vier containersoorten is weg; er wordt altijd met de 40 ft High Cube gerekend, want die gebruiken we. Ook het vakje 'Ruimte ernaast' is weg. Er wordt nog steeds met vijf centimeter naast en achter elke spa gerekend, want die ruimte heb je nodig om hem erin te schuiven, maar je hoeft er niets meer aan te draaien.",
    },

    {
      datum: "2026-09-07", groep: "planning", soort: "beter",
      titel: "Wijzigen in de planning doen Kevin en Gerwin",
      wat: "De planning is voor iedereen op de afdeling te zien, maar er iets in zetten of verzetten doen Kevin en Gerwin. Zie je de knoppen niet meer: dat is de bedoeling, je kunt alles nog wel bekijken. Een afspraak aanklikken laat gewoon alle gegevens zien.",
    },

    {
      datum: "2026-09-07", groep: "planning", soort: "nieuw",
      titel: "Service en Plaatsing kunnen hun route inzien",
      wat: "De monteurs van Service en de jongens van Plaatsing kunnen voortaan op hun telefoon zien welke route ze rijden. Zij zien alleen de tegel Planning en verder niets, en ze kunnen niets verzetten: de agenda blijft van de afdeling zelf. Een stop aanklikken laat wel alle gegevens zien die je onderweg nodig hebt, zoals het adres en het telefoonnummer.",
    },

    {
      datum: "2026-09-07", bestand: "planning.html", soort: "beter",
      titel: "Routebord: volgorde, let op, en vrije dagen",
      wat: "Je sleept een stop nu ook binnen een route naar boven of beneden; die volgorde is de volgorde waarin je rijdt en blijft staan. In het afsprakenvenster kun je Let op aanvinken, dan springt de stop er rood uit voor klussen met twee man of hijsen. Afspraken zonder tijd (vakantie, kantoor, vrij) staan als balkje bovenaan de dag in plaats van tussen de stops. En bij elke route staat hoeveel stops erin zitten, met het dagtotaal in de kop.",
    },

    {
      datum: "2026-09-07", bestand: "planning.html", soort: "nieuw",
      titel: "Dag, werkweek, hele week of maand",
      wat: "Boven in de balk kies je welke periode je ziet: een dag, de werkweek (maandag tot en met vrijdag), de hele week of een hele maand. De pijltjes springen dan ook met die stap mee: een dag vooruit, een week vooruit of een maand vooruit. Je keuze blijft staan.",
    },

    {
      datum: "2026-09-07", bestand: "planning.html", soort: "nieuw",
      titel: "Planning werkt nu met routes",
      wat: "Het weekoverzicht is een routebord geworden, zoals de afdeling het gewend is: per dag de routes naast elkaar, met per route wie er rijdt en de stops eronder. Je voegt een route toe met + route, vult hem met + stop, en sleept een stop naar een andere route of een andere dag. Onderaan elke dag kun je een notitie zetten, bijvoorbeeld MAX 2 ROUTES. Het oude tijdraster staat er nog: rechtsboven wissel je tussen Routes en Tijdraster.",
    },

    {
      datum: "2026-09-07", iedereen: true, soort: "nieuw",
      titel: "Elke tegel opent in een eigen venster",
      wat: "Iedereen werkt met twee schermen, dus een tegel opent voortaan in een eigen venster van het Dashboard in plaats van over je vorige scherm heen. Zo kun je Planning op je ene scherm zetten en Voorraadbeheer op je andere, en staan ze allebei gewoon op je taakbalk. Klik je een tegel aan die al openstaat, dan komt dat venster naar voren; er komt er geen tweede bij. Je ziet dit zodra het Dashboard zichzelf heeft bijgewerkt.",
    },

    {
      datum: "2026-09-07", bestand: "planning.html", soort: "nieuw",
      titel: "Zie meteen of een order betaald is",
      wat: "Voor de naam van de klant staat een stipje: groen als de order volledig betaald is, oranje als er is aanbetaald en rood als er nog niets binnen is. Ga er met de muis overheen en je ziet hoeveel er van het totaal betaald is. Staat er geen ordernummer bij de afspraak, dan is er ook geen stip.",
    },

    {
      datum: "2026-09-07", bestand: "planning.html", soort: "beter",
      titel: "De agenda werkt nu live samen",
      wat: "Zet iemand anders een afspraak neer of haalt hij er een weg, dan zie je dat meteen op je eigen scherm, zonder te verversen. Rechtsboven in de balk staat wie er nog meer in de agenda kijken. Voorheen bleef een afspraak die een collega verwijderd had bij jou gewoon staan.",
    },

    {
      datum: "2026-09-07", bestand: "voorraad.html", soort: "nieuw",
      titel: "Gepland aanvinken plant nu ook echt",
      wat: "Vink je een spa op Gepland, dan komt er meteen een venster waarin je de afspraak zet: datum, tijd, wie erheen gaat. Adres en telefoon van de klant worden erbij gezocht. Wat je invult staat daarna als echte afspraak in Planning. Je hoeft hem dus niet nog een keer met de hand in de agenda te zetten.",
    },

    {
      datum: "2026-09-03", bestand: "dealerportaal.html", soort: "nieuw",
      titel: "Een bestelling terugdraaien",
      wat: "De tegel heet nu Passion Partners Beheer. Bij een aanbetaalde bestelling staat een knop Terugdraaien: die boekt de aanbetaling tegen in het dagboek Mollie, zet de order in Logic4 op Geannuleerd en geeft de vastgehouden voorraad weer vrij. Bedoeld voor testbestellingen. Het geld wordt niet teruggestort bij Mollie; dat doe je zelf als het om een echte bestelling gaat.",
    },

    {
      datum: "2026-09-03", groep: "partnerportaal-kijk", soort: "hersteld",
      titel: "Zes artikelcodes wezen naar het verkeerde artikel",
      wat: "In de partnerprijslijst stonden zes verschreven artikelcodes. Twee daarvan bestonden wél in Logic4, maar bij een heel ander artikel: wie een Click Trim in eiken bestelde kreeg een 45-gradenbocht, en wie een Skimmer Ring bestelde kreeg een skimmermandje. Alle zes zijn rechtgezet, en de import controleert voortaan bij elk artikel of de code en de omschrijving nog bij elkaar horen.",
    },

    {
      datum: "2026-09-03", groep: "partnerportaal-kijk", soort: "nieuw",
      titel: "Onderdelen, covers en een winkelwagen",
      wat: "Passion Partners heeft er een tweede tabblad bij: alle spa-onderdelen en covers uit de partnerprijslijst, ruim zevenhonderd artikelen, met de staffelprijzen en of ze op voorraad liggen. En er is een winkelwagen, zodat een partner twee spa's en tien covers in één bestelling kan doen in plaats van elke spa apart.",
    },

    {
      datum: "2026-09-03", groep: "partnerportaal-kijk", soort: "hersteld",
      titel: "Bestellingen komen goed in Logic4",
      wat: "Een bestelling uit het portaal kwam in Logic4 binnen met een bedrag van nul en zonder de aanbetaling erop. De prijs uit het portaal staat er nu op, de verpakkingskosten staan als eigen regel, en het betaalde bedrag wordt geboekt zoals bij een showroomverkoop. Ook worden samengestelde artikelen nu vanzelf uitgeklapt: bestel je een Iceman's Barrel XL, dan staan de steps, de pluggen en de chiller meteen in de order.",
    },

    {
      datum: "2026-09-03", groep: "partnerportaal-kijk", soort: "beter",
      titel: "Voorraad per kleur, en de handleiding erbij",
      wat: "Op een modeltegel staat geen rekensom meer met voorraad, schip en reserveringen, maar gewoon welke kleuren er nu liggen en hoeveel: 1x Espresso, 1x Mystic Mountain. Wat gereserveerd is telt niet mee, want dat is verkocht. De collecties staan in de volgorde van de gedrukte prijslijst, en bij elke spa en swimspa staat nu de algemene handleiding onder Manuals.",
    },

    {
      datum: "2026-09-03", bestand: "container-laden.html", soort: "hersteld",
      titel: "Covers werden verkeerd om gevouwen",
      wat: "Het dashboard vouwde een cover over de korte kant, waardoor een cover van 590 bij 277 als bijna zes meter lang de container in ging. Hij wordt over de lange kant gevouwen: 295 bij 277. Daardoor past er in de praktijk meer in een container dan de tegel tot nu toe liet zien.",
    },

    {
      datum: "2026-09-03", groep: "partnerportaal-kijk", soort: "beter",
      titel: "Voorraad in het portaal telt nu op, en per kleur",
      wat: "Boven een model stond bijvoorbeeld 29 beschikbaar terwijl eronder 8 op voorraad en 29 op het water stond. Die getallen kwamen uit twee verschillende tellingen en klopten niet met elkaar. Er staat nu: in het magazijn, op het water, min wat al gereserveerd is, en dat komt precies uit op het getal bovenaan. Daaronder staat per kleur hoeveel er nu klaar staat, zodat een partner ziet welke kleur hij kan bestellen zonder de keuzelijst te openen.",
    },

    {
      datum: "2026-09-03", groep: "partnerportaal-kijk", soort: "beter",
      titel: "Passion Partners: kleur staat nu bij elke uitvoering",
      wat: "Bij een model met een warmtepomp of waterstofmachine stond alleen 'Integrated Heat Pump' of 'With Hydrogen Machine' in de keuzelijst, drie keer onder elkaar en zonder kleur. Je kon dus niet zien welke kleur je bestelde. Nu staat de kleur er altijd bij, bijvoorbeeld 'Espresso with OAK/grey trim · IntelliSaver'. En 'Integrated Heat Pump' heet naar de partner toe voortaan IntelliSaver.",
    },

    {
      datum: "2026-09-03", bestand: "dealerportaal.html", soort: "beter",
      titel: "Nieuwe partner: venster valt niet meer weg, mail gaat vanzelf",
      wat: "Bij het invoeren van een nieuwe dealer of partner kon het venster tijdens het typen ineens verdwijnen, met alles wat je had ingevuld. Dat gebeurde als je muis buiten het venster losliet, bijvoorbeeld bij kopiëren en plakken tussen Telefoon en Mobiel. Een klik sluit het venster nu alleen nog als hij ook naast het venster begon, en heb je iets ingevuld dan wordt er eerst gevraagd of het weg mag. Verder gaat de welkomstmail nu automatisch de deur uit zodra je een nieuwe relatie bewaart; daar hoef je niets meer voor te bevestigen. Zonder die mail heeft een partner geen wachtwoord en kan hij niet inloggen. Alle bevestigingsvensters in dit scherm zijn vervangen door een venster in Passion-opmaak.",
    },

    {
      datum: "2026-09-01", bestand: "afbeeldingen.html", soort: "nieuw",
      titel: "Tekst in een afbeelding automatisch vertalen",
      wat: "Onderaan de tegel Afbeeldingen op maat zit een nieuw blok. Kies een afbeelding met tekst, kies de taal, en het scherm leest de tekst, vertaalt hem en zet hem terug op dezelfde plek. Je ziet het origineel en de vertaling naast elkaar, met daaronder per regel wat er gevonden en wat er van gemaakt is. Werkt het best op een rustige achtergrond zoals een banner of een specsheet; staat de tekst over een drukke foto, dan blijft er een vlak zichtbaar waar de oude tekst stond. Kijk het dus altijd na voordat je het gebruikt.",
    },

    {
      datum: "2026-09-01", bestand: "amerika.html", soort: "nieuw",
      titel: "Voorraad Houston komt nu live uit Logic4",
      wat: "Bovenaan het tabblad staat wat er volgens Logic4 op magazijn Warehouse Texas USA ligt. Boekt Osman een order af, dan zie je dat hier terug - handmatig bijhouden hoeft dan niet meer. Er is ook een lijst met onderdelen, covers en trapjes, waar niemand een telling van had. Zolang de getelde beginvoorraad nog niet in Logic4 is geboekt, staat de telling van 20-07 eronder met een verschillijst erbij; die is de werklijst om het recht te zetten en verdwijnt vanzelf zodra alles klopt.",
    },

    {
      datum: "2026-09-01", groep: "taken", soort: "nieuw",
      titel: "Taken die elke dag of elke week terugkomen",
      wat: "Naast de week staat nu een keuze: eenmalig, elke dag of elke week. Kies je elke dag, dan staat die taak elke ochtend vanzelf op je lijst - ook als die van gisteren nooit is afgevinkt. Wekelijks werkt hetzelfde per week. Achter zo'n taak staat een blauw label en een knop 'herhaling stoppen'; die stopt alleen het terugkomen, de taak van vandaag blijft gewoon staan.",
    },
    {
      datum: "2026-09-01", bestand: "voorraad.html", soort: "beter",
      titel: "Verwachte levering toont het fabrieksordernummer en de ETA",
      wat: "Bij de spa's die binnen zijn stond meestal alleen 'volgende productie'. Dat kwam doordat Jazzi niet in de fabriekenlijst van de koppeling stond: van de 941 open inkooporders werden er maar 11 meegenomen. Jazzi, Fenlin en Fukiafu staan er nu bij. In productie ging daardoor van 3 naar 48 modellen, en het inkoopordernummer bij de fabriek is nu bij 126 reserveringen bekend in plaats van 3. Onder de verwachte levering staat dat nummer met de ETA erbij, ook als er verder 'volgende productie' staat.",
    },

    {
      datum: "2026-09-01", bestand: "voorraad.html", soort: "beter",
      titel: "Meerdere spa's in één reservering",
      wat: "Bij 'Reserveren namens partner of particulier' zit nu een knop <b>+ Spa toevoegen</b>. Kies een model, aantal en kleur, klik toevoegen, en doe dat zo vaak als nodig; onderaan zie je wat er in de aanvraag zit en kun je een regel er weer uit halen. Verstuur je hem, dan gaat er één mail met één betaallink voor het hele bedrag, en na betaling komt er één Logic4-order met alle regels erin. Handig op een beurs, waar een nieuwe partner zelden één spa afneemt.",
    },

    {
      datum: "2026-09-01", bestand: "amerika.html", soort: "beter",
      titel: "Accorderen naar Logic4 werkt nu ook bij honderd facturen",
      wat: "Selecteerde je er veel tegelijk, dan werden er maar een stuk of dertien aangemaakt en verscheen er geen Logic4-ordernummer meer achter de regel. Eén opdracht kon niet honderd keer QuickBooks én Logic4 bevragen en viel halverwege om. Het scherm knipt de selectie nu zelf in blokjes en toont de voortgang. Belangrijker: elke aangemaakte order wordt meteen vastgelegd. Daardoor kan een afgebroken poging geen orders meer opleveren die het dashboard niet kent - en die bij een tweede klik dubbel in Logic4 zouden belanden. De dertien orders van vanochtend zijn alsnog gekoppeld.",
    },

    {
      datum: "2026-09-01", groep: "partnerportaal-kijk", soort: "nieuw",
      titel: "Passion Partners: meekijken zonder account",
      wat: "Klik je op de tegel Passion Partners, dan ga je nu meteen het portaal in met je eigen dashboard-account. Je hoeft niet meer als partner of dealer aangemaakt te worden, en er komt dus ook niets extra's in Logic4 te staan. Bovenin staat een balk dat je meekijkt: je ziet alles zoals een partner het ziet, maar reserveren en andere wijzigingen zijn uitgeschakeld.",
    },
    {
      datum: "2026-09-01", bestand: "amerika.html", soort: "beter",
      titel: "Amerika: zoeken, kolomnamen en geen herlaadtijd meer",
      wat: "Verkoop & dealers laadt niet meer opnieuw zodra je tussen tabbladen wisselt; de lijst blijft staan tot je het dashboard opnieuw opent, en met de knop Opnieuw ophalen haal je hem bewust vers op. Er zijn drie zoekvelden bij gekomen: in de QuickBooks-lijst, bij Geaccordeerd en bij de wires, allemaal op factuurnummer of naam. Bij de wires heten de kolommen nu Amount invoice, Bankkosten en Totaal, en de datum van een wire is aan te passen - die stond op de dag van inlezen en dat is niet de dag van de betaling.",
    },
    {
      datum: "2026-09-01", bestand: "voorraad.html", soort: "beter",
      titel: "Reserveringen tonen nu de hele orderregel",
      wat: "Stond er in Logic4 iets bijzonders bij een spa, zoals 'Integrated Heat Pump', dan zag je dat hier niet: er stond alleen het model en de kleur. Nu staat die aantekening als oranje label achter de kleur, en de hele regel zoals Logic4 hem heeft zie je als je erover zweeft. Je kunt er ook op zoeken. Twee orders die alleen hierin verschillen worden bovendien niet meer op één regel samengevoegd.",
    },

    {
      datum: "2026-08-31", groep: "taken", soort: "beter",
      titel: "Takenlijst staat ook weer op je telefoon",
      wat: "Op de telefoon zit hetzelfde uitstulpje rechts in beeld; tik erop en de lijst schuift over je tegels heen, met een knop Sluiten rechtsboven. Het is precies dezelfde lijst als op de pc, dus wat je onderweg afvinkt staat op kantoor ook af. Anders dan op de pc gaat hij op een telefoon niet vanzelf open: je begint bij je tegels.",
    },

    {
      datum: "2026-08-31", iedereen: true, soort: "beter",
      titel: "Elke tegel heeft nu dezelfde balk bovenin",
      wat: "Linksboven staat overal \u2018\u2190 Dashboard\u2019 en rechtsboven staat wie er is ingelogd, de NL/EN-knop en Uitloggen. Dat liep uit elkaar: op de ene tegel ontbrak de uitlogknop, op de andere de taalknop, en Mijn uren en Mijn mail lieten helemaal niet zien wie je was. Nu is het overal hetzelfde, dus je hoeft niet meer te zoeken waar de knop staat.",
    },

    {
      datum: "2026-08-31", groep: "taken", soort: "beter",
      titel: "Takenlijst zit nu als lade aan de zijkant",
      wat: "De takenlijst is geen tegel meer. Rechts op het dashboard zit een uitstulpje 'Takenlijst'; klik erop en de lijst schuift uit, klik weer en hij schuift terug. Je hoeft het dashboard dus niet meer te verlaten om iets af te vinken. Op het uitstulpje staat hoeveel er openstaat, en bij een uitnodiging kleurt dat oranje. Wacht er een uitnodiging op je, dan staat die bovendien bovenaan het dashboard bij je taken, met een knop die de lade op het juiste tabblad opent.",
    },

    {
      datum: "2026-08-31", bestand: "dealerportaal.html", soort: "beter",
      titel: "Bibliotheek: volgorde aanpassen, verplaatsen en weggooien",
      wat: "De bestandenlijst van het partnerportaal was alleen te lezen; nu kun je hem beheren. Sleep een regel naar zijn plek of gebruik de pijltjes - die volgorde is letterlijk wat de partner ziet. Staat er iets in de verkeerde map, kies dan 'verplaats naar' en hij verhuist. Met het prullenbakje gooi je iets echt weg: ook het bestand zelf verdwijnt, zodat het daarna ook niet meer op te vragen is. De mappen staan dichtgeklapt, dus je ziet niet meteen 166 regels.",
    },

    {
      datum: "2026-08-31", groep: "taken", soort: "beter",
      titel: "Takenlijst is nu persoonlijk, en je kunt collega's uitnodigen",
      wat: "Je ziet alleen je eigen taken; wat een ander op zijn lijst zet blijft bij hem. Nieuw is uitnodigen: zet iemand bij een taak en die komt bij hem in de takenlijst te staan onder Uitnodigingen. Neemt hij aan, dan staat de taak bij hem onder Eigen taken en zie jij \"doet mee\". Weigert hij, dan staat hij niet op zijn lijst en zie jij \"geweigerd\" - je hoeft er dus niet achteraan. Uitnodigen kan alleen bij mensen die de tegel zelf ook hebben, anders zou de taak nergens landen. De tegel staat nu onder Elke dag in plaats van bij Marketing.",
    },

    {
      datum: "2026-08-31", groep: "taken", soort: "nieuw",
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
    /* Een 'groep' werd tot 31 aug 2026 alleen afgeleid uit de tegels die
       iemand heeft. Dat brak zodra er iets in het dashboard kwam dat géén
       tegel is: de takenlijst werd een uitschuiflade aan de zijkant, en een
       bericht daarover zou dan bij niemand meer verschijnen - ook niet bij de
       vier mensen die die lade wél hebben. Daarom nu rechtstreeks aan
       toegang.js vragen of iemand in de groep zit; dat is sowieso de eerlijker
       vraag, want dat is waar de rechten écht staan. De tegel-afleiding blijft
       ernaast staan voor het geval fpToegang niet geladen is. */
    var tg = global.fpToegang;
    return NIEUWS.filter(function (n) {
      if (n.iedereen) return true;
      if (n.bestand) return !!bestanden[n.bestand];
      if (n.groep) return (tg && tg.mag) ? tg.mag(n.groep, wie) : !!groepen[n.groep];
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
