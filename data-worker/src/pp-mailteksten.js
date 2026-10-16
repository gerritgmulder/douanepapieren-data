/* ═══════════════════════════════════════════════════════════════════════════
   PASSION PARTNERS - DE MAILS IN DE TAAL VAN DE PARTNER
   ═══════════════════════════════════════════════════════════════════════════
   Gerrit (16 okt 2026): "Graag de mails ook in de gekozen taal doen, ja!"

   De mails staan in worker.js in het Engels. Deze lijst vervangt per taal de
   vaste Engelse stukken door de vertaling, zoals taal.js dat in het Dashboard
   doet: alleen tekst die hier letterlijk staat wordt vervangen. Namen,
   modellen, bedragen en ordernummers staan er niet in en blijven dus zoals
   ze zijn.

   dpSendEmail roept ppMailVertaal aan als de ontvanger een account in
   Passion Partners heeft met een taal (nl, de, fr, it). Engels, of geen
   taal gekozen: dan blijft de mail zoals hij is.

   Regels voor wie hier iets bijzet:
   - het Engelse stuk exact zoals het in de uiteindelijke mail staat, dus
     met de spaties aan het begin of eind als daar een naam of bedrag tegenaan
     komt;
   - altijd positief geformuleerd, in elke taal (zie het geheugen: positieve
     taal, overal);
   - nooit het woord offerte (Dolf);
   - Nederlands met je, Duits met Sie, Frans met vous, Italiaans met Lei.
   ═══════════════════════════════════════════════════════════════════════════ */

const T = [
  // [Engels, Nederlands, Duits, Frans, Italiaans]

  // De jas van elke mail
  ["Questions? Just reply to this email.",
   "Vragen? Beantwoord gewoon deze e-mail.",
   "Fragen? Antworten Sie einfach auf diese E-Mail.",
   "Des questions ? Répondez simplement à cet e-mail.",
   "Domande? Risponda semplicemente a questa e-mail."],
  ["<p>Hi,</p>", "<p>Hallo,</p>", "<p>Guten Tag,</p>", "<p>Bonjour,</p>", "<p>Buongiorno,</p>"],
  ["<p>Hi ", "<p>Hallo ", "<p>Hallo ", "<p>Bonjour ", "<p>Buongiorno "],
  [">Hello ", ">Hallo ", ">Hallo ", ">Bonjour ", ">Buongiorno "],

  // Inloglink
  ["Your Passion Partners login link",
   "Je inloglink voor Passion Partners",
   "Ihr Anmeldelink für Passion Partners",
   "Votre lien de connexion Passion Partners",
   "Il Suo link di accesso a Passion Partners"],
  ["Click the button below to log in. This link is valid for 15 minutes.",
   "Klik op de knop hieronder om in te loggen. Deze link is 15 minuten geldig.",
   "Klicken Sie auf die Schaltfläche unten, um sich anzumelden. Dieser Link ist 15 Minuten gültig.",
   "Cliquez sur le bouton ci-dessous pour vous connecter. Ce lien est valable 15 minutes.",
   "Clicchi sul pulsante qui sotto per accedere. Questo link è valido per 15 minuti."],
  ["Log in to the portal", "Inloggen op het portaal", "Zum Portal anmelden", "Se connecter au portail", "Accedi al portale"],
  ["Requested by someone else? Then you can safely ignore this email.",
   "Heeft iemand anders dit aangevraagd? Dan kun je deze e-mail gerust laten liggen.",
   "Hat jemand anderes dies angefordert? Dann können Sie diese E-Mail einfach liegen lassen.",
   "Quelqu'un d'autre a fait cette demande ? Vous pouvez alors simplement laisser cet e-mail de côté.",
   "La richiesta è partita da qualcun altro? Può semplicemente lasciare da parte questa e-mail."],

  // Welkomstmail
  ["Welcome to Passion Partners", "Welkom bij Passion Partners", "Willkommen bei Passion Partners", "Bienvenue chez Passion Partners", "Benvenuto in Passion Partners"],
  ["Your Passion Partners account is ready. In your own portal you will find live stock for the full Passion Spas range, your price list, your reservations with expected delivery, and all product documentation.",
   "Je account bij Passion Partners staat klaar. In je eigen portaal vind je de actuele voorraad van het hele Passion Spas-assortiment, je prijslijst, je reserveringen met de verwachte levering en alle productdocumentatie.",
   "Ihr Passion-Partners-Konto ist bereit. In Ihrem eigenen Portal finden Sie den aktuellen Lagerbestand des gesamten Passion-Spas-Sortiments, Ihre Preisliste, Ihre Reservierungen mit dem erwarteten Liefertermin und die gesamte Produktdokumentation.",
   "Votre compte Passion Partners est prêt. Dans votre portail, vous trouverez le stock en direct de toute la gamme Passion Spas, votre liste de prix, vos réservations avec la livraison prévue et toute la documentation produit.",
   "Il Suo account Passion Partners è pronto. Nel Suo portale trova le disponibilità aggiornate dell'intera gamma Passion Spas, il Suo listino prezzi, le Sue prenotazioni con la consegna prevista e tutta la documentazione dei prodotti."],
  ["Activate your account", "Activeer je account", "Konto aktivieren", "Activer votre compte", "Attivi il Suo account"],
  ["The link is valid for 7 days and lets you choose your own password. After that, log in any time at ",
   "De link is 7 dagen geldig en daarmee kies je zelf een wachtwoord. Daarna log je altijd in op ",
   "Der Link ist 7 Tage gültig; damit wählen Sie Ihr eigenes Passwort. Danach melden Sie sich jederzeit an unter ",
   "Le lien est valable 7 jours et vous permet de choisir votre mot de passe. Ensuite, connectez-vous à tout moment sur ",
   "Il link è valido 7 giorni e Le permette di scegliere la Sua password. Dopodiché può accedere in qualsiasi momento su "],

  // Bestelbevestiging
  ["Your order is ready - Passion Partners", "Je bestelling staat klaar - Passion Partners", "Ihre Bestellung ist bereit - Passion Partners", "Votre commande est prête - Passion Partners", "Il Suo ordine è pronto - Passion Partners"],
  ["We received your order - Passion Partners", "We hebben je bestelling ontvangen - Passion Partners", "Wir haben Ihre Bestellung erhalten - Passion Partners", "Nous avons bien reçu votre commande - Passion Partners", "Abbiamo ricevuto il Suo ordine - Passion Partners"],
  ["As discussed, we have placed this order for you in Passion Partners:",
   "Zoals besproken hebben we deze bestelling voor je in Passion Partners gezet:",
   "Wie besprochen haben wir diese Bestellung für Sie in Passion Partners angelegt:",
   "Comme convenu, nous avons passé cette commande pour vous dans Passion Partners :",
   "Come concordato, abbiamo inserito questo ordine per Lei in Passion Partners:"],
  ["Thank you for your order. This is what we received:",
   "Bedankt voor je bestelling. Dit hebben we ontvangen:",
   "Vielen Dank für Ihre Bestellung. Folgendes haben wir erhalten:",
   "Merci pour votre commande. Voici ce que nous avons reçu :",
   "Grazie per il Suo ordine. Ecco cosa abbiamo ricevuto:"],
  ["<b>Full container</b>, straight from the factory. We quote the sea freight separately.",
   "<b>Volle container</b>, rechtstreeks uit de fabriek. De zeevracht geven we je apart door.",
   "<b>Voller Container</b>, direkt ab Werk. Die Seefracht nennen wir Ihnen separat.",
   "<b>Conteneur complet</b>, directement de l'usine. Nous vous communiquons le fret maritime séparément.",
   "<b>Container completo</b>, direttamente dalla fabbrica. Il trasporto marittimo Le viene comunicato a parte."],
  ["You collect it yourself in Uddel.", "Je haalt hem zelf op in Uddel.", "Sie holen ihn selbst in Uddel ab.", "Vous venez le chercher vous-même à Uddel.", "Lo ritira Lei stesso a Uddel."],
  ["Already paid? Then you can ignore this button; you will receive a confirmation as soon as the payment is in.",
   "Al betaald? Dan heeft deze knop zijn werk gedaan; je krijgt een bevestiging zodra de betaling binnen is.",
   "Bereits bezahlt? Dann hat diese Schaltfläche ihren Dienst getan; Sie erhalten eine Bestätigung, sobald die Zahlung eingegangen ist.",
   "Déjà payé ? Alors ce bouton a fait son travail ; vous recevrez une confirmation dès réception du paiement.",
   "Già pagato? Allora questo pulsante ha fatto il suo lavoro; riceverà una conferma appena arriva il pagamento."],
  ["We will get back to you about the payment.", "We nemen contact met je op over de betaling.", "Wir melden uns bei Ihnen wegen der Zahlung.", "Nous reviendrons vers vous pour le paiement.", "La ricontatteremo per il pagamento."],
  ["You can follow your order any time under <b>My spas</b>.",
   "Je bestelling volg je altijd onder <b>Mijn spa's</b>.",
   "Ihre Bestellung verfolgen Sie jederzeit unter <b>Meine Spas</b>.",
   "Vous suivez votre commande à tout moment sous <b>Mes spas</b>.",
   "Può seguire il Suo ordine in qualsiasi momento in <b>I miei spa</b>."],

  // Bestelling van de beurs overgezet
  ["Your order is now in your Passion Partners account",
   "Je bestelling staat nu in je account bij Passion Partners",
   "Ihre Bestellung ist jetzt in Ihrem Passion-Partners-Konto",
   "Votre commande est maintenant dans votre compte Passion Partners",
   "Il Suo ordine è ora nel Suo account Passion Partners"],
  ["Your order from the fair has been moved to your own Passion Partners account:",
   "Je bestelling van de beurs staat nu in je eigen account bij Passion Partners:",
   "Ihre Messebestellung befindet sich jetzt in Ihrem eigenen Passion-Partners-Konto:",
   "Votre commande du salon se trouve maintenant dans votre propre compte Passion Partners :",
   "Il Suo ordine della fiera è ora nel Suo account Passion Partners:"],
  ["You can follow it under <b>My spas</b> after logging in at ",
   "Je volgt hem onder <b>Mijn spa's</b> nadat je bent ingelogd op ",
   "Sie verfolgen sie unter <b>Meine Spas</b>, nachdem Sie sich angemeldet haben unter ",
   "Vous la suivez sous <b>Mes spas</b> après vous être connecté sur ",
   "Può seguirlo in <b>I miei spa</b> dopo l'accesso su "],

  // Aanbetalingsverzoek vanuit Beheer
  ["Your deposit request - ", "Je aanbetalingsverzoek - ", "Ihre Anzahlungsanfrage - ", "Votre demande d'acompte - ", "La Sua richiesta di acconto - "],
  ["Your reservation is ready for its 30% deposit: ",
   "Je reservering staat klaar voor de aanbetaling van 30%: ",
   "Ihre Reservierung ist bereit für die Anzahlung von 30%: ",
   "Votre réservation est prête pour l'acompte de 30 % : ",
   "La Sua prenotazione è pronta per l'acconto del 30%: "],
  ["As soon as the deposit is in, we confirm your reservation.",
   "Zodra de aanbetaling binnen is, bevestigen we je reservering.",
   "Sobald die Anzahlung eingegangen ist, bestätigen wir Ihre Reservierung.",
   "Dès réception de l'acompte, nous confirmons votre réservation.",
   "Appena arriva l'acconto, confermiamo la Sua prenotazione."],

  // Herinnering containerbestelling
  ["Reminder: deposit for your container order - Passion Partners",
   "Herinnering: aanbetaling voor je containerbestelling - Passion Partners",
   "Erinnerung: Anzahlung für Ihre Containerbestellung - Passion Partners",
   "Rappel : acompte pour votre commande de conteneur - Passion Partners",
   "Promemoria: acconto per il Suo ordine container - Passion Partners"],
  ["A friendly reminder about your container order in Passion Partners (",
   "Een vriendelijke herinnering aan je containerbestelling in Passion Partners (",
   "Eine freundliche Erinnerung an Ihre Containerbestellung in Passion Partners (",
   "Un petit rappel concernant votre commande de conteneur dans Passion Partners (",
   "Un gentile promemoria sul Suo ordine container in Passion Partners ("],
  ["To start production, we kindly ask you to pay the deposit of ",
   "Om de productie te starten, vragen we je vriendelijk om deze aanbetaling: ",
   "Um die Produktion zu starten, bitten wir Sie freundlich um diese Anzahlung: ",
   "Pour lancer la production, nous vous remercions de régler cet acompte : ",
   "Per avviare la produzione, La preghiamo gentilmente di versare questo acconto: "],
  ["Has the payment just been made? Then thank you very much, and our messages have crossed.",
   "Is de betaling net gedaan? Dan hartelijk dank, dan zijn onze berichten elkaar gekruist.",
   "Wurde die Zahlung gerade erledigt? Dann vielen Dank, und unsere Nachrichten haben sich gekreuzt.",
   "Le paiement vient d'être effectué ? Alors merci beaucoup, nos messages se sont croisés.",
   "Il pagamento è appena stato effettuato? Allora grazie mille, i nostri messaggi si sono incrociati."],

  // Knoppen
  ["Pay the deposit", "Aanbetaling voldoen", "Anzahlung bezahlen", "Payer l'acompte", "Paga l'acconto"],
  ["Pay now", "Nu betalen", "Jetzt bezahlen", "Payer maintenant", "Paga ora"],
  ["Complete payment", "Betaling afronden", "Zahlung abschließen", "Finaliser le paiement", "Completa il pagamento"],
  ["Reserve again", "Opnieuw reserveren", "Erneut reservieren", "Réserver à nouveau", "Prenota di nuovo"],
  ["Yes, move my reservation", "Ja, verplaats mijn reservering", "Ja, Reservierung verschieben", "Oui, déplacer ma réservation", "Sì, sposta la mia prenotazione"],
  ["Keep this one, I will pay", "Deze houden, ik betaal", "Diesen behalten, ich bezahle", "Je garde celui-ci, je paie", "Tengo questo, pago io"],

  // De restbetaling: steeds terugkerend
  ["<br>Order ", "<br>Order ", "<br>Auftrag ", "<br>Commande ", "<br>Ordine "],
  ["Still to pay: ", "Nog te betalen: ", "Noch zu zahlen: ", "Reste à payer : ", "Da saldare: "],
  ["Ready for you until: ", "Voor je klaar tot: ", "Für Sie bereit bis: ", "Prêt pour vous jusqu'au : ", "Pronto per Lei fino a: "],

  // Aangekomen
  ["Your spa has arrived - ready for you", "Je spa is binnen - hij staat voor je klaar", "Ihr Spa ist angekommen - er steht für Sie bereit", "Votre spa est arrivé - il vous attend", "Il Suo spa è arrivato - è pronto per Lei"],
  ["Your spa is here. It arrived in Uddel today and it is standing ready with your name on it.",
   "Je spa is er. Hij is vandaag in Uddel aangekomen en staat klaar met jouw naam erop.",
   "Ihr Spa ist da. Er ist heute in Uddel angekommen und steht mit Ihrem Namen bereit.",
   "Votre spa est là. Il est arrivé à Uddel aujourd'hui et vous attend, à votre nom.",
   "Il Suo spa è qui. È arrivato oggi a Uddel ed è pronto, con il Suo nome sopra."],
  ["Complete the payment within 48 hours and we will get it to you straight away - collection or delivery, whichever you chose.",
   "Rond de betaling binnen 48 uur af, dan regelen we het meteen - ophalen of bezorgen, wat je ook koos.",
   "Schließen Sie die Zahlung innerhalb von 48 Stunden ab, dann geht es sofort weiter - Abholung oder Lieferung, wie Sie es gewählt haben.",
   "Finalisez le paiement dans les 48 heures et nous nous en occupons aussitôt - enlèvement ou livraison, selon votre choix.",
   "Completi il pagamento entro 48 ore e ce ne occupiamo subito - ritiro o consegna, come ha scelto."],
  ["As soon as your payment reaches us the spa is yours. After ",
   "Zodra je betaling binnen is, is de spa van jou. Na ",
   "Sobald Ihre Zahlung eingeht, gehört der Spa Ihnen. Nach ",
   "Dès réception de votre paiement, le spa est à vous. Après ",
   "Appena riceviamo il pagamento, lo spa è Suo. Dopo "],
  [" we will make the next customer happy with this one, and your reservation moves to the next spa that comes in - so you keep your place.",
   " maken we de volgende klant blij met deze spa, en gaat je reservering naar de volgende spa die binnenkomt - zo houd je je plek.",
   " machen wir mit diesem Spa den nächsten Kunden glücklich, und Ihre Reservierung geht auf den nächsten eintreffenden Spa über - so behalten Sie Ihren Platz.",
   " nous ferons le bonheur du client suivant avec ce spa, et votre réservation passe au prochain spa qui arrive - vous gardez ainsi votre place.",
   " faremo felice il prossimo cliente con questo spa e la Sua prenotazione passa al prossimo spa in arrivo - così mantiene il Suo posto."],

  // Herinnering 24 uur
  ["24 hours left on your spa", "Nog 24 uur voor je spa", "Noch 24 Stunden für Ihren Spa", "Encore 24 heures pour votre spa", "Ancora 24 ore per il Suo spa"],
  ["Just a reminder: your spa is still standing ready in Uddel.",
   "Even ter herinnering: je spa staat nog steeds voor je klaar in Uddel.",
   "Nur zur Erinnerung: Ihr Spa steht weiterhin in Uddel für Sie bereit.",
   "Petit rappel : votre spa vous attend toujours à Uddel.",
   "Un promemoria: il Suo spa è ancora pronto a Uddel."],
  ["After that we will pass this one on to the next customer and your reservation moves to the next spa that arrives. Your place in the queue stays yours - it just takes a little longer.",
   "Daarna gaat deze naar de volgende klant en gaat je reservering naar de volgende spa die binnenkomt. Je plek in de rij blijft van jou - het duurt dan alleen iets langer.",
   "Danach geht dieser an den nächsten Kunden, und Ihre Reservierung geht auf den nächsten eintreffenden Spa über. Ihr Platz in der Reihe bleibt Ihrer - es dauert nur etwas länger.",
   "Ensuite, celui-ci passe au client suivant et votre réservation passe au prochain spa qui arrive. Votre place dans la file reste la vôtre - cela prend simplement un peu plus de temps.",
   "Dopo passerà al prossimo cliente e la Sua prenotazione passa al prossimo spa in arrivo. Il Suo posto in coda resta Suo - ci vuole solo un po' più di tempo."],

  // Doorgeschoven
  ["Your spa moves to the next arrival", "Je spa gaat naar de volgende levering", "Ihr Spa geht auf die nächste Lieferung über", "Votre spa passe à la prochaine arrivée", "Il Suo spa passa al prossimo arrivo"],
  ["The 48 hours have passed, so this spa is going to another customer who is ready for it today.",
   "De 48 uur zijn voorbij, dus deze spa gaat naar een andere klant die hem vandaag kan afnemen.",
   "Die 48 Stunden sind vorbei, daher geht dieser Spa an einen anderen Kunden, der heute bereit ist.",
   "Les 48 heures sont écoulées, ce spa part donc chez un autre client prêt à le recevoir aujourd'hui.",
   "Le 48 ore sono trascorse, quindi questo spa va a un altro cliente pronto a riceverlo oggi."],
  ["Your reservation stays exactly where it was: the next one that arrives in Uddel is yours.",
   "Je reservering blijft precies staan: de volgende die in Uddel binnenkomt is van jou.",
   "Ihre Reservierung bleibt genau bestehen: Der nächste, der in Uddel eintrifft, gehört Ihnen.",
   "Votre réservation reste exactement à sa place : le prochain qui arrive à Uddel est le vôtre.",
   "La Sua prenotazione resta esattamente com'era: il prossimo che arriva a Uddel è Suo."],
  ["Your deposit stays with your reservation, so everything is already arranged.",
   "Je aanbetaling blijft bij je reservering, dus alles is al geregeld.",
   "Ihre Anzahlung bleibt bei Ihrer Reservierung, es ist also alles schon geregelt.",
   "Votre acompte reste lié à votre réservation, tout est donc déjà réglé.",
   "Il Suo acconto resta legato alla prenotazione, quindi è già tutto sistemato."],
  ["Would you rather have it sooner, or a different colour? Reply to this e-mail and we will look at what is on the water.",
   "Wil je hem liever eerder, of in een andere kleur? Beantwoord deze e-mail, dan kijken we wat er onderweg is.",
   "Möchten Sie ihn lieber früher oder in einer anderen Farbe? Antworten Sie auf diese E-Mail, und wir schauen, was unterwegs ist.",
   "Vous le préférez plus tôt, ou dans une autre couleur ? Répondez à cet e-mail et nous regarderons ce qui est en route.",
   "Lo preferisce prima, o in un altro colore? Risponda a questa e-mail e vedremo cosa è in arrivo."],

  // Volledig betaald
  ["Paid in full - your spa is on its way", "Volledig betaald - je spa komt eraan", "Vollständig bezahlt - Ihr Spa ist unterwegs", "Entièrement payé - votre spa arrive", "Pagato per intero - il Suo spa è in arrivo"],
  ["Thank you, the payment is complete.", "Dank je, de betaling is rond.", "Vielen Dank, die Zahlung ist abgeschlossen.", "Merci, le paiement est complet.", "Grazie, il pagamento è completo."],
  ["You can collect it from Uddel. Let us know which day suits you and we will have it ready at the dock.",
   "Je kunt hem ophalen in Uddel. Laat ons weten welke dag je uitkomt, dan staat hij klaar bij het laadperron.",
   "Sie können ihn in Uddel abholen. Sagen Sie uns, welcher Tag Ihnen passt, dann steht er an der Rampe bereit.",
   "Vous pouvez venir le chercher à Uddel. Dites-nous quel jour vous convient et il vous attendra au quai.",
   "Può ritirarlo a Uddel. Ci dica quale giorno Le va bene e sarà pronto alla banchina di carico."],
  ["We are scheduling the transport now and you will hear the delivery date from us shortly.",
   "We plannen nu het transport en je hoort binnenkort de leverdatum van ons.",
   "Wir planen jetzt den Transport, und Sie erfahren in Kürze den Liefertermin.",
   "Nous planifions maintenant le transport et vous communiquerons très bientôt la date de livraison.",
   "Stiamo pianificando il trasporto e Le comunicheremo a breve la data di consegna."],

  // De keuze na 48 uur
  ["Your spa is waiting - which way would you like it?", "Je spa wacht op je - wat heeft je voorkeur?", "Ihr Spa wartet - was ist Ihnen lieber?", "Votre spa vous attend - que préférez-vous ?", "Il Suo spa La aspetta - cosa preferisce?"],
  ["Your spa is still standing ready in Uddel and the balance of 70% is on its way to us.",
   "Je spa staat nog klaar in Uddel en de restbetaling van 70% is onderweg naar ons.",
   "Ihr Spa steht weiterhin in Uddel bereit, und die Restzahlung von 70% ist auf dem Weg zu uns.",
   "Votre spa vous attend toujours à Uddel et le solde de 70 % est en route vers nous.",
   "Il Suo spa è ancora pronto a Uddel e il saldo del 70% è in arrivo da noi."],
  ["Shall we move your reservation to the next spa of this model that arrives? Your deposit moves with it and you keep your place in the queue.",
   "Zullen we je reservering verplaatsen naar de volgende spa van dit model die binnenkomt? Je aanbetaling gaat mee en je houdt je plek in de rij.",
   "Sollen wir Ihre Reservierung auf den nächsten eintreffenden Spa dieses Modells verschieben? Ihre Anzahlung geht mit, und Sie behalten Ihren Platz in der Reihe.",
   "Voulez-vous que nous déplacions votre réservation vers le prochain spa de ce modèle qui arrive ? Votre acompte suit et vous gardez votre place dans la file.",
   "Vuole che spostiamo la Sua prenotazione al prossimo spa di questo modello in arrivo? Il Suo acconto si sposta con essa e mantiene il Suo posto in coda."],
  ["Choose \"Keep this one\" and you have another 24 hours to complete the payment. ",
   "Kies je \"Deze houden\", dan heb je nog 24 uur om de betaling af te ronden. ",
   "Wählen Sie „Diesen behalten“, dann haben Sie weitere 24 Stunden, um die Zahlung abzuschließen. ",
   "Choisissez « Je garde celui-ci » et vous disposez de 24 heures supplémentaires pour finaliser le paiement. ",
   "Scelga \"Tengo questo\" e avrà altre 24 ore per completare il pagamento. "],
  ["Let us hear from you within 24 hours; after that we move your reservation to the next arrival for you.",
   "Laat binnen 24 uur iets van je horen; daarna verplaatsen we je reservering voor je naar de volgende levering.",
   "Melden Sie sich bitte innerhalb von 24 Stunden; danach verschieben wir Ihre Reservierung für Sie auf die nächste Lieferung.",
   "Donnez-nous des nouvelles dans les 24 heures ; ensuite, nous déplaçons pour vous votre réservation vers la prochaine arrivée.",
   "Ci faccia sapere entro 24 ore; dopodiché spostiamo per Lei la prenotazione al prossimo arrivo."],

  // Verlengd met 24 uur
  ["Your spa is yours for another 24 hours", "Je spa blijft nog 24 uur voor je staan", "Ihr Spa bleibt weitere 24 Stunden für Sie reserviert", "Votre spa vous est réservé 24 heures de plus", "Il Suo spa resta Suo per altre 24 ore"],
  ["Good - we keep this one for you.", "Goed - we houden deze voor je vast.", "Gut - wir halten ihn für Sie bereit.", "Parfait - nous le gardons pour vous.", "Bene - lo teniamo per Lei."],
  ["Complete the payment before then and we will get it to you straight away.",
   "Rond de betaling vóór die tijd af, dan regelen we het meteen.",
   "Schließen Sie die Zahlung bis dahin ab, dann geht es sofort weiter.",
   "Finalisez le paiement d'ici là et nous nous en occupons aussitôt.",
   "Completi il pagamento entro quel momento e ce ne occupiamo subito."],
  ["After that we will move your reservation to the next spa of this model that arrives, so you keep your place either way.",
   "Daarna verplaatsen we je reservering naar de volgende spa van dit model die binnenkomt, zo houd je hoe dan ook je plek.",
   "Danach verschieben wir Ihre Reservierung auf den nächsten eintreffenden Spa dieses Modells - so behalten Sie in jedem Fall Ihren Platz.",
   "Ensuite, nous déplaçons votre réservation vers le prochain spa de ce modèle qui arrive : vous gardez votre place dans tous les cas.",
   "Dopo spostiamo la Sua prenotazione al prossimo spa di questo modello in arrivo, così mantiene comunque il Suo posto."],

  // Opnieuw reserveren
  ["Shall we set this one up again for you?", "Zullen we deze opnieuw voor je klaarzetten?", "Sollen wir das noch einmal für Sie vorbereiten?", "Voulez-vous que nous le préparions à nouveau pour vous ?", "Vuole che lo prepariamo di nuovo per Lei?"],
  ["Your reservation is waiting for a deposit, so your spa is back in stock for now.",
   "Je reservering wacht op een aanbetaling, dus je spa staat voorlopig weer op voorraad.",
   "Ihre Reservierung wartet auf eine Anzahlung, daher ist Ihr Spa vorerst wieder auf Lager.",
   "Votre réservation attend un acompte, votre spa est donc de nouveau en stock pour le moment.",
   "La Sua prenotazione attende un acconto, quindi per ora lo spa è di nuovo disponibile."],
  ["Want it after all? One click puts everything back in your basket with the same prices, and you can pay straight away.",
   "Toch graag? Eén klik zet alles terug in je mand met dezelfde prijzen, en je kunt meteen betalen.",
   "Doch gewünscht? Ein Klick legt alles mit denselben Preisen zurück in Ihren Warenkorb, und Sie können sofort bezahlen.",
   "Vous le souhaitez finalement ? Un clic remet tout dans votre panier aux mêmes prix, et vous pouvez payer tout de suite.",
   "Lo desidera comunque? Un clic rimette tutto nel carrello con gli stessi prezzi e può pagare subito."],
  ["Prefer a different model or colour? Reply to this e-mail and your advisor will look at it with you.",
   "Liever een ander model of een andere kleur? Beantwoord deze e-mail, dan kijkt je adviseur met je mee.",
   "Lieber ein anderes Modell oder eine andere Farbe? Antworten Sie auf diese E-Mail, und Ihr Berater schaut es sich mit Ihnen an.",
   "Vous préférez un autre modèle ou une autre couleur ? Répondez à cet e-mail et votre conseiller regardera cela avec vous.",
   "Preferisce un altro modello o un altro colore? Risponda a questa e-mail e il Suo consulente lo valuterà con Lei."],

  // Gereserveerd
  ["Your spa is reserved - Passion Partners", "Je spa is gereserveerd - Passion Partners", "Ihr Spa ist reserviert - Passion Partners", "Votre spa est réservé - Passion Partners", "Il Suo spa è prenotato - Passion Partners"],
  ["Great news: your deposit has arrived and your spa is reserved in your name.",
   "Goed nieuws: je aanbetaling is binnen en je spa staat op jouw naam.",
   "Gute Nachricht: Ihre Anzahlung ist eingegangen und Ihr Spa ist auf Ihren Namen reserviert.",
   "Bonne nouvelle : votre acompte est arrivé et votre spa est réservé à votre nom.",
   "Ottime notizie: il Suo acconto è arrivato e lo spa è prenotato a Suo nome."],
  ["We will let you know the moment it arrives in Uddel. From that point you have 48 hours to complete the payment, and then it is ready for you to collect or for us to deliver.",
   "We laten het je weten zodra hij in Uddel aankomt. Vanaf dat moment heb je 48 uur om de betaling af te ronden, en daarna staat hij klaar om op te halen of bezorgen wij hem.",
   "Wir melden uns, sobald er in Uddel ankommt. Ab dann haben Sie 48 Stunden, um die Zahlung abzuschließen; danach steht er zur Abholung bereit oder wir liefern ihn.",
   "Nous vous prévenons dès qu'il arrive à Uddel. Vous disposez alors de 48 heures pour finaliser le paiement, puis il est prêt à être enlevé ou nous le livrons.",
   "La avvisiamo appena arriva a Uddel. Da quel momento ha 48 ore per completare il pagamento, poi è pronto per il ritiro oppure lo consegniamo noi."],
];

const KOLOM = { nl: 1, de: 2, fr: 3, it: 4 };
// Langste stukken eerst, zodat "Pay the deposit - " vóór "Pay the deposit" gaat
// en een zin nooit half vertaald wordt doordat een kort stuk erin eerder paste.
const OP_LENGTE = T.slice().sort((a, b) => b[0].length - a[0].length);

// De dag in "Ready for you until: Monday 14:00" (dpWanneer).
const DAGEN = {
  nl: ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"],
  de: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"],
  fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
  it: ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"],
};
const DAGEN_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const PP_MAIL_TALEN = Object.keys(KOLOM);

export function ppMailVertaal(taal, tekst) {
  const k = KOLOM[taal];
  if (!k || !tekst) return tekst;
  let uit = String(tekst);
  for (const r of OP_LENGTE) if (r[k] && uit.includes(r[0])) uit = uit.split(r[0]).join(r[k]);
  uit = uit.replace(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) (\d{2}:\d{2})\b/g,
    (m, d, t) => DAGEN[taal][DAGEN_EN.indexOf(d)] + " " + t);
  return uit;
}

// Voor de controle in tools/: welke Engelse stukken er zijn.
export const PP_MAIL_STUKKEN = T.map(r => r[0]);
