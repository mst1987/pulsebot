# Discord-Guide für Raider

Diese Seite ist für alle, die den Bot **im Discord als Raider** benutzen — nicht für Entwickler. Sie beschreibt, was jeder Befehl und jede Nachricht des Bots tut. Für die Web-Oberfläche siehe [docs/guide-web-admin.md](guide-web-admin.md).

## Sprache

Der Bot schreibt **standardmäßig Deutsch**. Mit `/language` (im deutschen Discord-Client heißt der Befehl „sprache“) wählst du deine eigene Sprache: Deutsch, Englisch oder „Automatisch“. Ohne eigene Wahl (oder mit „Automatisch“) schreibt der Bot in der Sprache deines Discord-Clients: Deutsch, wenn dein Discord auf Deutsch steht, sonst Englisch. Das gilt für alles, was nur du siehst – Dialoge, Antworten und DMs. Nachrichten im Kanal (Anmelde-Nachricht, Setup, Übersicht, Panels) bleiben in der Sprache, die die Orga für den Server eingestellt hat. Der DE/EN-Schalter oben im Web-Menü ist dieselbe Einstellung.

## Anmeldung

Technik: [signups.md](signups.md), [bot-commands.md](bot-commands.md)

- Unter jeder Event-Nachricht im Kanal öffnet ein Button den **Anmelde-Dialog**: Charakter + Spec wählen, "kann auch"-Rollen angeben, Status setzen (Dabei / Vielleicht / Spät / Bank / Abmelden), optional ein Kommentar.
- Direkt an der Event-Nachricht gibt es außerdem Status-Buttons **Spät · Vielleicht · Bank · Absagen** — ohne den vollen Dialog. Daneben steht bei manchen Raids **Fehlende pingen** — der ist nur für die Orga.
- Bei "Vielleicht" oder "Absagen" öffnet sich (je nach Kategorie Pflicht oder optional) ein kurzes Textfeld für eine Nachricht an die Raidleitung.
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
  - **Gildenbank** (wenn die Orga sie eingerichtet hat): **Anfrage stellen** zeigt — nur dir — „Was brauchst du?“ mit dem Stand der Bank und je Kategorie (Edelsteine, Fläschchen, Tränke …) eine Auswahl: jeder Gegenstand mit Icon und „Verfügbar: N“ (und „max. N pro Anfrage“, wenn die Orga eine Grenze gesetzt hat). Du siehst nur, was die Orga freigegeben hat und was noch da ist. Wählst du einen Gegenstand, fragt ein Formular „Wie viel?“ und optional „Wofür?“; hast du für die Spielversion der Bank mehrere Charaktere im Profil, auch „An welchen Charakter?“ — vorausgewählt ist dein erster. Mehr als verfügbar oder als die Grenze geht nicht. Hat der Server (noch) keine Gildenbank mit Bestand, öffnet sich stattdessen ein freies Formular: was du brauchst, wie viel (1 bis 9999), optional wofür. Danach siehst du „Anfrage gesendet – die Orga meldet sich per DM.“ Du bekommst eine DM in deiner Sprache, wenn die Orga die Anfrage **bestätigt** (für dich vorgemerkt) und wenn sie **ausgegeben** ist — oder wenn sie abgelehnt wird (mit Grund, wenn die Orga einen angibt). Du kannst höchstens 5 offene Anfragen gleichzeitig haben.
  - **Links** der Orga, z. B. die Warcraft-Logs-Einladung oder ein Info-Sheet.
- **Gildenbank-Anfragen für die Orga:** Im Orga-Kanal steht jede Anfrage als Karte (wer, was, wie viel, wofür, an welchen Charakter). Bei einer Anfrage aus dem Bestand stehen das Item-Icon und die Zahlen dabei: **Bestand**, **Vorgemerkt**, **Verfügbar** und was danach übrig wäre. **Bestätigen** merkt die Menge vor (der Bot prüft dabei noch einmal, ob genug verfügbar ist); die Karte wird blau und zeigt „Vorgemerkt von X · wartet auf Ausgabe im Spiel“ mit **Ausgegeben** (wenn du es im Spiel übergeben hast) und **Vormerkung lösen** (zurück auf offen). Nach der Ausgabe wird die Karte grün, ohne Knöpfe. **Ablehnen …** fragt nach einem optionalen Grund, den der Raider sieht. Eine freie Anfrage (ohne Bestand) hat **Erledigt** statt Bestätigen. Drücken darf nur, wer im Web Schreibrecht auf *Raids* hat.
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
- Nach der Freigabe erscheint es als eigene Nachricht im Event-Kanal (die Gruppen, die Bank nur wenn die Orga sie mitpostet) und optional als **DM** ("Du bist in Gruppe 2 als Heiler"; "Diesmal Bank – nächstes Mal Vorrang" nur, wenn die Bank mitgepostet wird).
- Wer angemeldet ist, aber nicht im Setup steht, bekommt keine Nachricht und keine DM — die Orga wählt im Setup aus allen Anmeldungen.
- Der Button **"Invite callen"** an der Setup-Nachricht ist nur für die Orga und pingt die eigene Gruppe zum Einladen.
- `/show-mysetups` — die eigenen freigegebenen Setups über mehrere Raids hinweg.
- `/show-allsetups` — alle aktuell freigegebenen Setups.

## Übersicht & Nachschlagen

Technik: [bot-commands.md](bot-commands.md)

Diese Befehle antworten privat (nur für dich sichtbar) und verlinken meist auf die passende Seite im Web:

- `/raids` — Liste der kommenden Raids. `/raid <Event>` — Details zu einem einzelnen Raid.
- `/anwesenheit` — eigene Anwesenheit. `/anwesenheit-raider <Name>` — Anwesenheit eines anderen Raiders (Orga). Ausführlicher im Web unter **Abwesenheiten → Meine Anwesenheit**: deine Quote je Raid-Kategorie, jeder der letzten Raids mit Grund, deine nächsten Raids mit Status und deine eingetragenen Abwesenheiten.
- `/report` — Liste der vorhandenen Log-Auswertungen.
- `/loot ich · item · raider` — eigene Loot-Historie, Historie zu einem Item, oder zu einem Spieler.
- `/council <Item>` — Loot-Council-Infos zu einem Item (Orga).
- `/kanal umbenennen · archivieren · anlegen` — Kanalverwaltung direkt aus Discord (Orga).

## Event-Verwaltung (nur Orga)

Technik: [events.md](events.md)

- `/event anlegen` — neues Event per geführtem Dialog (Kategorie, Vorlage, Kanal, Termin).
- `/event verwalten [Event]` bzw. Rechtsklick **"Event verwalten"** auf die Event-Nachricht — bearbeiten, verschieben, Anmeldung öffnen/schließen, Raider ein-/austragen, Fehlende pingen, Setup öffnen, absagen/zurücknehmen, löschen.
- **"Fehlende pingen"** direkt an der Event-Nachricht (nur bei Raids, deren Kategorie Raider-Rollen hat): zeigt dir erst nur für dich, wer mit Raider-Rolle noch nicht reagiert hat (Anzahl, die ersten 25 Namen), dann **Jetzt pingen** oder **Abbrechen**. Gepingt wird im Event-Kanal; zweimal kurz hintereinander geht nicht. Raider sehen den Knopf auch, dürfen ihn aber nicht benutzen.
- `/fillsetup [Setup-ID]` — Setup ins Setup-Sheet übernehmen (das freigegebene Setup des Kanals oder ein Raid-Helper-Raidplan).
- `/createoverview`, `/update-events` — ältere Befehle, inzwischen durch die automatische Talk-Server-Übersicht ersetzt.

## Was der Bot sonst noch automatisch macht

Technik: [discord-servers.md](discord-servers.md), [raidhelper-retirement.md](raidhelper-retirement.md)

- **Talk-Server-Übersicht:** eine sich selbst aktualisierende Nachricht mit allen kommenden Raids (aus beiden Quellen) plus Anmelde-Buttons.
- **Erinnerungs-Pings:** X Stunden vor Anmeldeschluss (an alle ohne Reaktion) und X Stunden vor Start (an Angemeldete) — Zeitpunkt ist je Kategorie eingestellt.
- **Automatische Ankündigung** neuer Events mit Rollenping (falls für die Kategorie aktiviert).
- **Rollen-Synchronisierung** zwischen Event- und Talk-Server.
- Optional ein **natives Discord-Event** (Kalendereintrag) pro Raid.
- Farbige **App-Emojis** für Klassen, Specs und Status in allen Bot-Nachrichten.

### Umstieg von Raid-Helper

Neue Raid-Kategorien laufen standardmäßig über die eigene Anmeldung des Bots. Ältere Kategorien bleiben auf Raid-Helper, bis die Orga sie umstellt. Für Raider ändert sich dabei nur die Optik — eigene Anmelde-/Setup-Nachricht des Bots statt eines Raid-Helper-Posts. Details für die Orga: [docs/raidhelper-retirement.md](raidhelper-retirement.md).
