# Web-Admin-Guide

Diese Seite ist für Orga-Mitglieder, die das **Web-Admin-Panel** benutzen — nicht für Entwickler. Sie beschreibt, was man in jedem Bereich der Oberfläche tun kann. Für den Discord-Bot selbst siehe [docs/guide-discord.md](guide-discord.md). Welcher Bereich für wen sichtbar ist, steuern die [Berechtigungen](#einstellungen), siehe auch [docs/permissions.md](permissions.md).

## Übersicht / Dashboard

Für alle mit Zugriff auf mindestens einen Bereich. Zeigt offene Aufgaben auf einen Blick (fehlender Softres-Link, Kanäle zum Archivieren, fehlgeschlagene Serien-Events, Rollen-Drift, veralteter Server-Stand) sowie die nächsten anstehenden Raids.

## Raid-Events

*Bereich "Raids" (lesen/schreiben)*

- Neues Event per geführtem Dialog anlegen (Vorlage, Termin, Größe/Rollen, Kanal, Anmeldung) oder ein bestehendes bearbeiten.
- **Raid-Cockpit** auf der Detailseite: führt in fünf Schritten durch den Ablauf (Angelegt → Anmeldung → Setup → Freigabe → Nachbereitung) und schlägt jeweils die nächste sinnvolle Handlung vor.
- Über das **"Verwalten"-Menü**: Termin verschieben, Anmeldung öffnen/schließen, Raider ein-/austragen, Fehlende pingen, absagen/zurücknehmen, löschen (inklusive Kanal archivieren und Discord benachrichtigen).
- Kalender-Link (.ics) und öffentliche Event-Seite ohne Login; optional ein natives Discord-Event anlegen.

## Setup-Editor

*Teil der Raid-Detailseite, Bereich "Raids" schreiben*

- Setup automatisch vorschlagen lassen (Rollenverteilung, Buffs, Fairness, Wünsche der Raider) und per Drag & Drop von Hand anpassen; einzelne Plätze lassen sich fixieren.
- Vor der Freigabe für Raider unsichtbar. **"Freigeben"** postet die Setup-Nachricht im Kanal und verschickt optional DMs an die Raider.
- Eine KI-Begründung erklärt die vorgeschlagene Aufstellung; **"Invite callen"** lässt sich direkt aus dem Editor auslösen.

## Raidplan

*Tab der Raid-Detailseite eines eigenen Events, Bereich "Raids" (lesen/schreiben)*

- Je Boss der gewählten Instanz ein **Board**: Bossraum-Karte als Hintergrund, Spieler aus dem Setup frei darauf verschieben (mit Maus oder Finger; Pfeiltasten und Entf gehen auch), rechts die **Aufgabenzeilen** mit zugewiesenen Spielern und eine Notiz. Wer noch nicht platziert ist, steht in der Liste "Nicht platziert".
- Über dem Board: **Nicht platziert** (Spieler von dort aufs Board oder auf einen Slot ziehen), **Objekt hinzufügen** (Slots für Tank/Heiler/DPS/Gruppe/Label, die acht Raid-Marker, Zonen als Rechteck oder Ellipse in Gefahren-/Sicher-/Neutral-/Eigener-Zone-Farbe mit frei wählbarer Farbe und Deckkraft). Zonen skalierst du an den Ecken, Doppelklick öffnet die Details, Entf löscht.
- **Vorlage wählen**: kopiert eine Raidplan-Vorlage (siehe unten) als Momentaufnahme in den Plan und füllt Tank-, Heiler- und DPS-Slots aus dem freigegebenen Setup; was sich nicht füllen lässt, bleibt als "offen" sichtbar. Danach lässt sich alles einzeln anpassen; spätere Änderungen an der Vorlage wirken hier nicht.
- **Karten** lädst du selbst hoch (PNG/JPG/WebP, bis 3 MB): für diesen Plan, je Boss oder für die ganze Instanz. Es gilt die genaueste: Plan > Vorlage > Boss > Instanz > Raster. "Auf Standard zurücksetzen" entfernt die Karte des Plans.
- **Taktik wählen**: Aufgabenzeilen als benannte, nach Kategorie sortierte Profile speichern und auf einem Boss wieder übernehmen; die Spieler-Zuweisung bleibt pro Plan.
- **Speichern** schreibt den Plan; hat jemand anderes inzwischen gespeichert, meldet der Editor einen Konflikt und lädt erst nach deiner Bestätigung neu.
- **Freigeben & teilen** erzeugt einen Link (`/p/<token>`), den jeder ohne Anmeldung lesen kann (Karte + Aufgabentabelle je Boss). Angemeldete Raider sehen ihren eigenen Token hervorgehoben. Spieler nennt die Lese-Ansicht erst, wenn das Setup freigegeben ist. Die Freigabe lässt sich zurücknehmen oder der Link erneuern.

## Raidplan-Vorlagen

*Raid-Events → "Raidplan-Vorlagen", Bereich "Raids"*

- Benannte Vorlagen (z. B. "Montags-Raid") mit Name, Kategorie, Beschreibung, optional einem Server und den Instanzen. Je Boss ein Board **ohne Spieler**: Slots, Raid-Marker, Zonen, Aufgabenzeilen, Notiz; je Boss lässt sich eine eigene Karte hinterlegen.
- Die **Taktik-Profile** bleiben als Zeilen-Bibliothek nutzbar ("Taktik wählen"), auch in einer Vorlage: die Vorlage legt fest, wo etwas steht, ein Profil liefert nur Aufgabenzeilen.
- Anwenden geschieht im Raidplan des Events ("Vorlage wählen").

## Serien (wiederkehrende Events)

*Bereich "Raids"*

- Feste Wochentage/Uhrzeit je Kategorie festlegen und eine Vorlage wählen — die Events werden automatisch rechtzeitig angelegt.
- Vorschau der nächsten Termine, einzelne Termine überspringen, fehlgeschlagene Läufe erneut anstoßen.

## Raid-Vorlagen

*Bereich "Raids"*

Wiederverwendbare Vorlagen (Instanzen, Größe, Rollen, Pflicht-Buffs, Anmeldeschluss, Aussehen der Nachricht) für ein schnelles Event-Anlegen. Details: [docs/raid-templates.md](raid-templates.md).

## Anmeldungen

*Bereich "signup", Mitglieder-Sicht*

Eigene kommende Raids und den eigenen Anmeldestatus je Charakter verwalten, auch für mehrere Raids gleichzeitig — das Web-Pendant zum Discord-Anmelde-Dialog.

## Mein Profil

*Bereich "signup" — nicht standardmäßig für alle offen, muss zugewiesen werden*

- Eigene Charaktere pflegen (Klasse/Spec/Gearstand), Verfügbarkeit nach Wochentag, bevorzugte Raids.
- Wunschpartner und "nicht zusammen raiden mit" hinterlegen.
- Persönlichen Kalender-Abo-Link erzeugen, der alle eigenen Anmeldungen enthält.

## Roster

*Bereich "roster"*

Alle bekannten Charaktere je Raid-Kategorie mit Anwesenheit. Charaktere lassen sich ausblenden (ohne Daten zu löschen), z. B. bei Guild-Austritt.

## Loot Council

*Bereich "lootcouncil" — für die Raidleitung beim Verteilen von Beute*

- Rangliste je Raider nach Bedarf (Drought, bisheriger Loot-Anteil, BiS-Abstand).
- Gear-Ansicht und Drop-Check für ein konkretes Item.
- DPS-Simulation einzelner Ausrüstungswechsel, BiS-Listen je Spec. Details: [docs/loot-council.md](loot-council.md).

## Historie & Loot

*Bereich "history" — lesend teils auch über den Basiszugang für alle Mitglieder*

- Vergaben, Items, Gründe und Loot nach Raid einsehen.
- Loot-Export aus Gargul/RCLootcouncil importieren.
- Addon-Inbox: automatisch hochgeladene Loot-Sessions bestätigen und zuordnen. Details: [docs/loot-import.md](loot-import.md).

## Log-Auswertung (CLA/RPB)

*Bereich "history" bzw. eigener Report-Zugang*

- Auswertung eines Warcraft-Logs: Kampfverlauf, Buffs/Debuffs, Cooldown-Nutzung, Heiler-Performance, vermeidbare Tode.
- Empfehlungen je Raider prüfen, per KI umformulieren lassen, freigeben und per DM verschicken.
- Ein Schutz verhindert versehentlich die Auswertung eines noch laufenden Raids (lässt sich mit Bestätigung übergehen). Details: [docs/logcheck.md](logcheck.md).

## Kanäle

*Bereich "channels"*

Alle Server-Kanäle als Liste; umbenennen, archivieren, löschen (einzeln oder per Mehrfachauswahl). Schnellanlage mehrerer Event-Kanäle nach Namensschema, optional gleich mit Event. Details: [docs/channels.md](channels.md).

## Einstellungen

Die meisten Unterbereiche brauchen Vollzugriff/Admin-Rechte:

- **Zugang** — wer ist Bot-Admin.
- **Berechtigungen** — Rechte je Discord-Rolle oder Einzelkonto pro Bereich (lesen/schreiben), Basiszugang für alle, Bot-Befehl-Rechte, "Ansicht als Rolle" zum Testen. Details: [docs/permissions.md](permissions.md).
- **Verbindungen** — Discord-Server (Event-/Talk-Server), Raid-Helper-Umstieg, Loot-Sync-Token, Warcraft-Logs- und KI-Zugang.
- **Kategorien** — pro Raid-Kategorie Quelle (Bot/Raid-Helper), Rollen, Vorlage, Lootsystem, Erinnerungen, Setup-DMs, Sprachkanal, Discord-Event.
