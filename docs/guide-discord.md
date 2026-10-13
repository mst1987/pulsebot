# Discord-Guide für Raider

Diese Seite ist für alle, die den Bot **im Discord als Raider** benutzen — nicht für Entwickler. Sie beschreibt, was jeder Befehl und jede Nachricht des Bots tut. Für die Web-Oberfläche siehe [docs/guide-web-admin.md](guide-web-admin.md).

## Sprache

Der Bot schreibt **standardmäßig Deutsch**. Mit `/language` (im deutschen Discord-Client heißt der Befehl „sprache“) wählst du deine eigene Sprache: Deutsch, Englisch oder „Automatisch“. Ohne eigene Wahl (oder mit „Automatisch“) schreibt der Bot in der Sprache deines Discord-Clients: Deutsch, wenn dein Discord auf Deutsch steht, sonst Englisch. Das gilt für alles, was nur du siehst – Dialoge, Antworten und DMs. Nachrichten im Kanal (Anmelde-Nachricht, Setup, Übersicht, Panels) bleiben in der Sprache, die die Orga für den Server eingestellt hat. Der DE/EN-Schalter oben im Web-Menü ist dieselbe Einstellung.

## Anmeldung

Technik: [signups.md](signups.md), [bot-commands.md](bot-commands.md)

- Unter jeder Event-Nachricht im Kanal öffnet ein Button den **Anmelde-Dialog**: Charakter + Spec wählen, "kann auch"-Rollen angeben, Status setzen (Dabei / Vielleicht / Spät / Bank / Abmelden), optional ein Kommentar.
- Direkt an der Event-Nachricht gibt es außerdem Status-Buttons **Spät · Vielleicht · Bank · Absagen** — ohne den vollen Dialog. Daneben steht bei manchen Raids **Fehlende pingen** — der ist nur für die Orga.
- Bei "Vielleicht" oder "Absagen" öffnet sich (je nach Kategorie Pflicht oder optional) ein kurzes Textfeld für eine Nachricht an die Raidleitung.
- Unter „Meine Charaktere …“ wählst du mehrere Charaktere auf einmal — der oberste in der Liste ist deine 1. Wahl, die weiteren „kann auch mit“. Wie viele es sein dürfen, stellt die Orga je Kategorie ein (Standard 8; die Auswahl zeigt „bis zu N auf einmal“). Bist du schon mit mehr angemeldet, als die Kategorie inzwischen erlaubt, bleiben deine Charaktere stehen; einen neuen dazu nimmt der Bot dann nicht („At most N characters per signup in this category.“).
- Auf der automatischen Übersichtsnachricht im Talk-Server gibt es zusätzlich **"Für alle Raids anmelden"** bzw. **"Mehrere Raids wählen …"**, um mehrere Termine auf einmal zu erledigen.
- Der Kopf der Event-Nachricht zeigt, **wie viele Discord-Accounts** angemeldet sind („28 signed up“) — wer mit mehreren Charakteren angemeldet ist, zählt einmal; Vielleicht, Bank und Absagen zählen nicht. Eine Obergrenze wie „25/25“ steht dort nicht mehr: wer mitspielt, entscheidet die Orga im Setup. Genauso zählt die Talk-Server-Übersicht und die öffentliche Event-Seite.
- In der Linkzeile unter der Nachricht führt **„Comp“** zur Aufstellung: die Orga (mit Schreibrecht für Raids) landet direkt im Setup-Editor, alle anderen auf der öffentlichen Event-Seite. **„Sheet“** ist das Raidsheet der Orga (hieß früher „Comp“).
- Wer noch keinen Charakter im Bot hat: Der Dialog fragt beim ersten Mal nach Klasse/Spec/Name und legt den Charakter automatisch an.
- Angeboten werden nur Charaktere der **Spielversion des Raids** (z. B. nur WoW-Forever-Charaktere für einen Forever-Raid). Hast du nur Charaktere einer anderen Version, sagt der Bot: „No WoW Forever character in your profile yet – create a WoW Forever character in your profile …" mit Link zur Profilseite — oder du wählst Klasse und Spec direkt im Dialog, dann legt der Bot den Charakter in der richtigen Version an.
- Jede Rückmeldung des Bots zur Anmeldung (gespeichert, abgemeldet, Warteliste, Fehler wie „Event gibt es nicht mehr“) kommt als kleine Karte in der Farbe des Raids, nur für dich sichtbar: oben „Saved for <Raid>“, darunter deine Charaktere mit Spec-Icon und Status, der Raidbeginn in deiner Ortszeit und ggf. der Warteliste-Hinweis.
- Hat die Orga eine Spielversion ausgeblendet (z. B. TBC nach dem Umstieg auf Forever), antworten die Buttons alter Nachrichten dieser Version nur noch mit der Karte „This raid is archived“ – Anmelden und Ändern gehen dort nicht mehr, gelöscht wird nichts.
- `/profil` zeigt eine kurze Zusammenfassung des eigenen Profils, mit Buttons um "kann Offtank/Heilen" für deinen ersten Charakter zu setzen, plus Link zur eigenen Profilseite im Web.
- **Raid-Zentrale:** Im Kanal deiner Raid-Kategorie steht eine Nachricht mit allem für deine Raids:
  - **Nächster Raid** mit Datum, „in 3 Tagen“ und wie viele angemeldet sind. **Mein Raid** zeigt nur dir, ob und mit welchem Charakter du angemeldet bist, mit Links zur Anmeldung und zum Raidplan.
  - **Auswertung** zeigt nur dir die neueste Log-Auswertung mit einem deiner Charaktere und führt zu deiner Seite darin und zu deinem Profil.
  - **Gildenbank** (wenn die Orga sie eingerichtet hat): **Anfrage stellen** zeigt — nur dir — „Was brauchst du?“ mit dem Stand der Bank und je Kategorie (Edelsteine, Fläschchen, Tränke …) eine Auswahl: jeder Gegenstand mit Icon und „Verfügbar: N“ (und „max. N pro Anfrage“, wenn die Orga eine Grenze gesetzt hat). Du siehst alles, was die Orga freigegeben hat — auch, was gerade leer ist. Wählst du einen Gegenstand, fragt ein Formular „Wie viel?“ und optional „Wofür?“; hast du für die Spielversion der Bank mehrere Charaktere im Profil, auch „An welchen Charakter?“ — vorausgewählt ist dein erster. Mehr als die Grenze geht nicht. **Warteliste:** Fragst du mehr an, als frei ist, geht der freie Teil als Anfrage raus und der Rest kommt auf die Warteliste des Gegenstands; ist nichts frei oder warten schon andere, kommt alles auf die Warteliste (die Auswahl zeigt dann „Warteliste: N vor dir“). Die Antwort nennt deinen Platz („du bist Nr. 4“). Wird etwas frei, rückst du der Reihe nach automatisch nach — **reihum in Portionen** („Ausgabe reihum: je 2 pro Runde“ steht im Formular und in der Antwort): Du bekommst höchstens eine Portion, willst du mehr, stellt sich dein Rest wieder hinten an, und der Nächste ist dran. Du bekommst die DM „Du bist dran“ (mit „13 weitere stehen für dich wieder hinten auf der Warteliste – du bist Nr. 8.“, wenn noch etwas wartet) und die Orga bestätigt wie bei jeder Anfrage. Höchstens 10 Einträge auf der Warteliste gleichzeitig. Hat der Server (noch) keine Gildenbank mit Bestand, öffnet sich stattdessen ein freies Formular: was du brauchst, wie viel (1 bis 9999), optional wofür. Danach siehst du „Anfrage gesendet – die Orga meldet sich per DM.“ Hast du für die Spielversion der Bank keinen Charakter im Profil, steht darunter „Leg in deinem Profil einen Charakter an, sonst kann die Orga nicht ausgeben.“ — die Post im Spiel braucht einen Charakter. Kennt kein Log, kein Loot und kein Arsenal deinen Charakter (z. B. weil du bei der Anmeldung nur einen Namen eingetippt hast), steht dort „Dein Charakter ist noch nicht bestätigt – füg ihn in deinem Profil über die Logs oder das Arsenal hinzu, sonst kann die Orga nicht ausgeben.“ — dein Profil zeigt solche Charaktere als „nicht bestätigt“. Du bekommst eine DM in deiner Sprache, wenn die Orga die Anfrage **bestätigt** (für dich vorgemerkt) und wenn sie **ausgegeben** ist — oder wenn sie abgelehnt wird (mit Grund, wenn die Orga einen angibt). Du kannst höchstens 5 offene Anfragen gleichzeitig haben.
  - **Links** der Orga, z. B. die Warcraft-Logs-Einladung oder ein Info-Sheet.
- **Gildenbank-Anfragen für die Orga:** Im Orga-Kanal steht jede Anfrage als Karte (wer, was, wie viel, wofür, an welchen Charakter). Bei einer Anfrage aus dem Bestand stehen das Item-Icon und die Zahlen dabei: **Bestand**, **Vorgemerkt**, **Verfügbar** und was danach übrig wäre. **Bestätigen** merkt die Menge vor (der Bot prüft dabei noch einmal, ob genug verfügbar ist) — aber nur, wenn der Charakter der Anfrage im Profil des Raiders steht und bestätigt ist (aus einem Log, dem Loot, dem Arsenal oder von der Orga im Spiel geprüft): sonst zeigt die Karte „⚠ Kein verknüpfter Charakter“ bzw. „⚠ Charakter nicht bestätigt“ und statt *Bestätigen* den Knopf **Geprüft & bestätigen**: Hast du den Namen im Spiel gefunden (z. B. per /who), bestätigst du damit — das geht auch für Raider ohne Discord-Konto, die kein Profil haben. Alternativ verknüpfst du im Web unter *Gildenbank* einen Profil-Charakter. Nur eine Anfrage ganz ohne Charakter („⚠ Kein Charakter“) hat ein ausgegrautes *Bestätigen*, bis du einen einträgst. Ist der Name falsch (z. B. „Gentle“ statt „Gentletwowl“), trägst du mit **Charakter ändern …** direkt auf der Karte den richtigen ein (nur Namen, die du im Spiel gefunden hast; Realm leer = der der Gildenbank) — die Karte zeigt sofort den neuen Empfänger, der Raider bleibt. Steht „⚠ Nicht genug verfügbar – noch N, angefragt M“ auf der Karte, liegt es am Bestand, nicht am Charakter: *Bestätigen* geht wieder nach dem nächsten Scan oder wenn Bestand frei wird — oder du lehnst ab. Nach dem Bestätigen wird die Karte blau und zeigt „Vorgemerkt von X · wartet auf Ausgabe im Spiel“ mit **Ausgegeben** (wenn du es im Spiel übergeben hast) und **Vormerkung lösen** (zurück auf offen; die Prüfung des Namens bleibt, *Bestätigen* geht danach sofort wieder). Nach der Ausgabe wird die Karte grün, ohne Knöpfe. **Ablehnen …** fragt nach einem optionalen Grund, den der Raider sieht. Eine freie Anfrage (ohne Bestand) hat **Erledigt** statt Bestätigen. Rückt jemand von der Warteliste nach, kommt eine normale Karte mit „aus der Warteliste“ in der Fußzeile; ein Eintrag, den die Orga nur mit Charakternamen importiert hat, steht als „**Name** · ohne Discord-Konto, keine DM“ da. Ablehnen oder eine Vormerkung lösen lässt die Warteliste nachrücken. Drücken darf nur, wer im Web Schreibrecht auf *Raids* hat.
- **Ab- und Anwesenheit:** Mit `/availability` oder den Knöpfen in der Raid-Zentrale trägst du einen Zeitraum ein:
  - **Abwesend eintragen** (Von, Bis, optional ein Grund): Du wirst von den Raids in dieser Zeit abgemeldet, auch wenn du schon angemeldet warst.
  - **Dabei eintragen** (Von, Bis, dann Charakter und Spec): Du wirst für die Raids in dieser Zeit als „Dabei" angemeldet. Eine bestehende An- oder Abmeldung wird dabei nie überschrieben.
  - Das Datum darfst du schreiben, wie du magst: `24.10.`, `24.10`, `24.10.2026`, `24/10`, `24. Okt`, `Oct 24`, `heute`, `morgen` – oder gleich den ganzen Zeitraum ins Von-Feld, z. B. `24.10.-31.10.` oder `28.12. bis 3.1.` Versteht der Bot es nicht, sagt er dir, was er nicht lesen konnte, und mit „Nochmal eingeben“ bist du sofort wieder im Fenster.
  - Abwesend eintragen geht auch ohne Raider-Rolle und ohne Charaktere im Profil. Mit `/availability` (alle Kategorien) bleiben Raids von Kategorien außen vor, in denen du kein Raider bist.
  - Vor dem Speichern siehst du die Raids des Zeitraums und kannst einzelne abwählen. Die Auswahl bleibt zwei Stunden offen, auch wenn der Bot zwischendurch neu startet.
  - Raids, die später in diesem Zeitraum angelegt werden, folgen automatisch.
  - Für jeden Raid, für den der Bot dich an- oder abmeldet, bekommst du eine DM.
  - **Meine Einträge** zeigt deine Einträge. Dort löschst du einen; die An- und Abmeldungen, die er schon gemacht hat, bleiben.

Für eine **neue** Anmeldung braucht man ggf. eine Raider-Rolle der jeweiligen Kategorie — eine bereits bestehende Anmeldung lässt sich aber immer noch ändern.

Manche Raids nehmen **nur Anmeldungen aus dem Roster** an (Schalter „Anmeldung nur für das Roster“ am Roster der Kategorie). Dann dürfen sich nur Mitglieder mit Status **Stamm, Probe oder Ersatz** anmelden; wer nicht im Roster ist oder auf **Pause** steht, bekommt statt des Dialogs: „Für diesen Raid melden sich nur Mitglieder des Rosters an (Stamm, Probe oder Ersatz). Frag die Raidleitung.“ (auf Englisch: „Only members of the roster (core, trial or bench) sign up for this raid. Ask the raid lead.“). Eine schon bestehende Anmeldung lässt sich auch hier ändern oder zurückziehen, und die Raidleitung kann dich jederzeit eintragen.

## Setup (Gruppeneinteilung)

Technik: [setup.md](setup.md)

- Ein Setup ist erst sichtbar, sobald die Orga es **freigegeben** hat — vorher sieht kein Raider etwas davon.
- Nach der Freigabe erscheint es als eigene Nachricht im Event-Kanal (die Gruppen mit Spec-Icon; rechts in deiner Zeile ein grüner Haken, sobald du bestätigst – deine Zeile wird dann leicht grün –, ein rotes Kreuz bei Absage, ein leerer Kreis, solange du nicht geantwortet hast; die Bank gestrichelt abgesetzt und nur, wenn die Orga sie mitpostet). Nach „Bestätigen“ antwortet der Bot mit der Startzeit des Raids. Wer in einer Gruppe steht, wird dabei gepingt; die Namen stehen danach in der Nachricht über „View the comp“. Pingt die Orga später noch einmal („Ping everyone“), wird das Setup neu gepostet. Optional kommt es auch als **DM** ("Du bist in Gruppe 2 als Heiler"; "Diesmal Bank – nächstes Mal Vorrang" nur, wenn die Bank mitgepostet wird).
- Wer angemeldet ist, aber nicht im Setup steht, bekommt keine Nachricht und keine DM — die Orga wählt im Setup aus allen Anmeldungen.
- Der Button **"Invite callen"** an der Setup-Nachricht ist nur für die Orga und pingt die eigene Gruppe zum Einladen.
- **Mehrere Raids an einem Abend:** Ist ein Raid überbucht, macht die Orga einen zweiten daraus. Du meldest dich trotzdem nur **einmal** an, an der bekannten Anmelde-Nachricht (sie zeigt dann „2 Raids · 20 Plätze“). Jeder Raid bekommt seine eigene Setup-Nachricht mit „Raid 1 von 2“ bzw. „Raid 2 von 2“ — schau, in welcher du stehst; die DM nennt es auch.
- `/show-mysetups` — die eigenen freigegebenen Setups über mehrere Raids hinweg.
- `/show-allsetups` — alle aktuell freigegebenen Setups.

## Übersicht & Nachschlagen

Technik: [bot-commands.md](bot-commands.md)

Diese Befehle antworten privat (nur für dich sichtbar) und verlinken meist auf die passende Seite im Web:

- `/raids` — Liste der kommenden Raids. `/raid <Event>` — Details zu einem einzelnen Raid.
- `/anwesenheit` — eigene Anwesenheit. `/anwesenheit-raider <Name>` — Anwesenheit eines anderen Raiders (Orga). Gezählt wird immer nur eine Spielversion: die der Kategorie des Kanals (sonst die Hauptversion); mit der Option `version` wählst du eine andere. Ausführlicher im Web unter **Abwesenheiten → Meine Anwesenheit**: deine Quote je Raid-Kategorie, jeder der letzten Raids mit Grund, deine nächsten Raids mit Status und deine eingetragenen Abwesenheiten.
- `/report` — Liste der vorhandenen Log-Auswertungen.
- `/loot ich · item · raider` — eigene Loot-Historie, Historie zu einem Item, oder zu einem Spieler.
- `/council <Item>` — Loot-Council-Infos zu einem Item (Orga).
- `/bestzeiten [dungeon]` — Dungeon-Bestzeiten der Gilde aus dem Addon LevelHelper: mit Dungeon die fünf schnellsten Gruppenläufe, ohne die Gesamtwertung nach Medaillen.
- `/addons [version]` — die Addons der Gilde (LevelHelper, ProfessionKit, EventHelper Sync) mit neuester Version und einem Knopf zur Download-Seite im Web. Die Dateien selbst gibt es nur im Web nach dem Login, nie als Link in Discord.
- `/kanal umbenennen · archivieren · anlegen` — Kanalverwaltung direkt aus Discord (Orga).

## Event-Verwaltung (nur Orga)

Technik: [events.md](events.md)

- `/event anlegen` — neues Event per geführtem Dialog (Kategorie, Vorlage, Kanal, Termin). Die Vorlagen passen zur Spielversion der Kategorie, die Uhrzeit ist mit der gemerkten Zeit der Kategorie vorbelegt, und die Spannen der Vorlage (z. B. Nahkampf 4 bis 8) kommen mit. Wird ein Kanal angelegt, wählst du ein **Kanal-Icon** (Wie zuletzt · Passt zum Raid · In dieser Kategorie · Kein Icon); braucht der Raid ein neues Namensmuster, passt der Knopf **Kanalname anpassen …** den Namen schon vor dem Anlegen an: das Feld zeigt das Muster des vorgeschlagenen Namens (Datum und Raid als Platzhalter wie `{dd}`, `{mm}`, `{mon}`, `{tag}`, `{raid}`), du änderst es, und der Kanal heißt beim Anlegen so; leer lassen setzt den vorgeschlagenen Namen zurück. Ein von Hand angepasster Name ist endgültig, das Kanal-Icon gehört dann in den Namen, und der nächste Raid derselben Art übernimmt das neue Muster von allein. Unter der Bestätigung benennt **Kanal umbenennen …** den neuen Kanal um (dafür brauchst du das Recht „Kanäle“ im Web).
- `/event verwalten [Event]` bzw. Rechtsklick **"Event verwalten"** auf die Event-Nachricht — bearbeiten, verschieben, Anmeldung öffnen/schließen, Raider ein-/austragen, Fehlende pingen, Setup öffnen, absagen/zurücknehmen, löschen.
- **"Fehlende pingen"** direkt an der Event-Nachricht (nur bei Raids, deren Kategorie Raider-Rollen hat): zeigt dir erst nur für dich, wer mit Raider-Rolle noch nicht reagiert hat (Anzahl, die ersten 25 Namen), dann **Jetzt pingen** oder **Abbrechen**. Gepingt wird im Event-Kanal; zweimal kurz hintereinander geht nicht. Raider sehen den Knopf auch, dürfen ihn aber nicht benutzen.
- `/fillsetup [Setup-ID]` — Setup ins Setup-Sheet übernehmen (das freigegebene Setup des Kanals oder ein Raid-Helper-Raidplan).
- `/createoverview` — (Orga) postet die **Raid-Übersicht** der Kategorie in den Kanal: die kommenden Raids nach Raid-ID gruppiert (Mittwoch bis Dienstag; „Diese ID“, „Nächste ID“), je Raid Datum, Titel, Uhrzeit, Kanal, Leiter und wie viele angemeldet sind. Sie hat keine Knöpfe und **aktualisiert sich selbst** (bei Änderungen an Raids und Anmeldungen und alle paar Minuten); unten steht, wann sie sich zuletzt geändert hat. Dieselbe Übersicht im selben Kanal wird neu gezeichnet statt doppelt gepostet. Löschst du die Nachricht, bleibt sie weg. Ältere Übersichten mit Knöpfen übernimmt der Bot von selbst.
- **Orga-Zentrale** (Nachricht im Orga-Kanal): zeigt die Raids der nächsten 4 Wochen mit ihrem Stand, **Raid anlegen** und **Alle Raids im Web**. Unter *Raid anlegen* stehen die **Links** der Orga (z. B. WCL-Gilde, Raid-Sheet) als Knöpfe. Mit **Links …** änderst du sie direkt in Discord: Die Karte (nur für dich) listet die Links; **Link hinzufügen** fragt Name und Adresse (https://…), **Link bearbeiten …** füllt das Formular mit dem gewählten Link vor, **Link entfernen …** löscht ihn. Bis zu 5 Links; die Orga-Zentrale zeichnet sich danach sofort neu. Nur die Orga der Kategorie darf das (wie bei *Raid anlegen*), alle anderen sehen „Dafür fehlt dir das Recht.“ Dieselben Links lassen sich im Web ändern (Einstellungen → Kategorien).
- `/update-events` — zeichnet die Übersicht(en) der Kategorie sofort neu (der Knopf „Update Events“ alter Übersichten macht aus der alten Nachricht die neue).

## Was der Bot sonst noch automatisch macht

Technik: [discord-servers.md](discord-servers.md), [raidhelper-retirement.md](raidhelper-retirement.md)

- **Talk-Server-Übersicht:** eine sich selbst aktualisierende Nachricht mit allen kommenden Raids (aus beiden Quellen) plus Anmelde-Buttons.
- **Erinnerungs-Pings:** X Stunden vor Anmeldeschluss (an alle ohne Reaktion) und X Stunden vor Start (an Angemeldete) — Zeitpunkt ist je Kategorie eingestellt.
- **Automatische Ankündigung** neuer Events mit Rollenping (falls für die Kategorie aktiviert).
- **Rollen-Synchronisierung** zwischen Event- und Talk-Server.
- Optional ein **natives Discord-Event** (Kalendereintrag) pro Raid.
- Farbige **App-Emojis** für Klassen, Specs und Status in allen Bot-Nachrichten.

### Neue Spielversion

Technik: [game-versions.md](game-versions.md)

Startet die Gilde eine neue Spielversion (z. B. WoW Forever neben TBC), laufen beide nebeneinander, oft auf demselben Discord:

- **Jeder Raid hat seine Version** und behält sie. Die Anmelde-Nachricht nennt sie unten klein; anmelden kannst du dich nur mit einem Charakter dieser Version (legst du im Profil oder direkt im Dialog an).
- **Eine Kategorie spielt eine Version.** Stellt die Orga eine Kategorie um, gehören die Raids danach zur neuen Version; die alten Raids, dein Loot und deine Anwesenheit bleiben unter der alten.
- **Roster je Version:** Die neue Version bekommt ein eigenes Roster, oft mit eigener Discord-Rolle. Deine Rolle aus dem alten Roster verlierst du dabei nicht.
- **Anwesenheit je Version:** `/anwesenheit` zählt die Version der Kategorie des Kanals; mit der Option `version` fragst du eine andere. In der neuen Version steht anfangs „Noch keine Raids gezählt“. Eingetragene Abwesenheiten gelten für alle Versionen.
- **Talk-Übersicht und Erinnerungen** zeigen die Raids aller Versionen, nach Version gruppiert. Blendet die Orga eine Version aus, verschwinden ihre Raids dort, und alte Anmelde-Buttons antworten mit „This raid is archived“.

### Umstieg von Raid-Helper

Neue Raid-Kategorien laufen standardmäßig über die eigene Anmeldung des Bots. Ältere Kategorien bleiben auf Raid-Helper, bis die Orga sie umstellt. Für Raider ändert sich dabei nur die Optik — eigene Anmelde-/Setup-Nachricht des Bots statt eines Raid-Helper-Posts. Details für die Orga: [docs/raidhelper-retirement.md](raidhelper-retirement.md).
