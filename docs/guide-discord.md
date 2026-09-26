# Discord-Guide für Raider

Diese Seite ist für alle, die den Bot **im Discord als Raider** benutzen — nicht für Entwickler. Sie beschreibt, was jeder Befehl und jede Nachricht des Bots tut. Für die Web-Oberfläche siehe [docs/guide-web-admin.md](guide-web-admin.md).

## Anmeldung

Technik: [signups.md](signups.md), [bot-commands.md](bot-commands.md)

- Unter jeder Event-Nachricht im Kanal öffnet ein Button den **Anmelde-Dialog**: Charakter + Spec wählen, "kann auch"-Rollen angeben, Status setzen (Dabei / Vielleicht / Spät / Bank / Abmelden), optional ein Kommentar.
- Direkt an der Event-Nachricht gibt es außerdem Status-Buttons **Spät · Vielleicht · Bank · Absagen** — ohne den vollen Dialog.
- Bei "Vielleicht" oder "Absagen" öffnet sich (je nach Kategorie Pflicht oder optional) ein kurzes Textfeld für eine Nachricht an die Raidleitung.
- Auf der automatischen Übersichtsnachricht im Talk-Server gibt es zusätzlich **"Für alle Raids anmelden"** bzw. **"Mehrere Raids wählen …"**, um mehrere Termine auf einmal zu erledigen.
- Wer noch keinen Charakter im Bot hat: Der Dialog fragt beim ersten Mal nach Klasse/Spec/Name und legt den Charakter automatisch an.
- `/profil` zeigt eine kurze Zusammenfassung des eigenen Profils, mit Buttons um "kann Offtank/Heilen" je Hauptcharakter zu setzen, plus Link zur eigenen Profilseite im Web.

Für eine **neue** Anmeldung braucht man ggf. eine Raider-Rolle der jeweiligen Kategorie — eine bereits bestehende Anmeldung lässt sich aber immer noch ändern.

## Setup (Gruppeneinteilung)

Technik: [setup.md](setup.md)

- Ein Setup ist erst sichtbar, sobald die Orga es **freigegeben** hat — vorher sieht kein Raider etwas davon.
- Nach der Freigabe erscheint es als eigene Nachricht im Event-Kanal (Gruppen, Bank) und optional als **DM** ("Du bist in Gruppe 2 als Heiler", "Diesmal Bank – nächstes Mal Vorrang").
- Der Button **"Invite callen"** an der Setup-Nachricht ist nur für die Orga und pingt die eigene Gruppe zum Einladen.
- `/show-mysetups` — die eigenen freigegebenen Setups über mehrere Raids hinweg.
- `/show-allsetups` — alle aktuell freigegebenen Setups.

## Übersicht & Nachschlagen

Technik: [bot-commands.md](bot-commands.md)

Diese Befehle antworten privat (nur für dich sichtbar) und verlinken meist auf die passende Seite im Web:

- `/raids` — Liste der kommenden Raids. `/raid <Event>` — Details zu einem einzelnen Raid.
- `/anwesenheit` — eigene Anwesenheit. `/anwesenheit-raider <Name>` — Anwesenheit eines anderen Raiders (Orga).
- `/report` — Liste der vorhandenen Log-Auswertungen.
- `/loot ich · item · raider` — eigene Loot-Historie, Historie zu einem Item, oder zu einem Spieler.
- `/council <Item>` — Loot-Council-Infos zu einem Item (Orga).
- `/kanal umbenennen · archivieren · anlegen` — Kanalverwaltung direkt aus Discord (Orga).

## Event-Verwaltung (nur Orga)

Technik: [events.md](events.md)

- `/event anlegen` — neues Event per geführtem Dialog (Kategorie, Vorlage, Kanal, Termin).
- `/event verwalten [Event]` bzw. Rechtsklick **"Event verwalten"** auf die Event-Nachricht — bearbeiten, verschieben, Anmeldung öffnen/schließen, Raider ein-/austragen, Fehlende pingen, Setup öffnen, absagen/zurücknehmen, löschen.
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
