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
- Alles Bearbeitbare ist sofort sichtbar: oben eine **feste Werkzeugleiste** (Rückgängig/Wiederholen mit Strg+Z / Strg+Y, Pfeil, Linie, Text, Rechteck, Ellipse, Vorlage wählen, Freigeben, Speichern), darunter die Boss-Auswahl und **Nicht platziert** (Spieler von dort aufs Board oder auf einen Slot ziehen). Links die **Elemente-Palette** (Raid-Marker, Slots für Tank/Heiler/DPS/Gruppe/Label, Zonen, Pfeil/Linie/Text) zum Ziehen oder Anklicken, in der Mitte das Board, rechts **Eigenschaften** (Farbe, Deckkraft, Größe, Beschriftung, Spieler zuweisen, Sperren, Löschen), **Hintergrund** (Karte, Karte abdunkeln) und die **Ebenen**-Liste (jedes Objekt, ein-/ausblenden, sperren, Reihenfolge, löschen). Palette und Seitenleiste lassen sich für ein größeres Board ausblenden.
- **Rechtsklick** (Touch: lange drücken) öffnet ein eigenes Menü: auf einem Objekt Eigenschaften, Duplizieren, Vorder-/Hintergrund, Sperren, Spieler zuweisen/lösen, Löschen; auf der leeren Karte Slots, Marker, Zonen, Pfeile, Linien oder Text an der Klickstelle einfügen. Es lässt sich mit Pfeiltasten, Enter und Esc bedienen.
- Zonen skalierst du an den Ecken, Linien an den Enden; gesperrte Objekte bewegen sich nicht.
- **Größe**: jedes Objekt hat im Inspektor einen Größen-Regler, am markierten Objekt einen Griff (Umschalt behält bei Zonen das Verhältnis), die Tasten `+` / `-` und Alt + Mausrad; unter "Hintergrund" skaliert "Objektgröße" alles auf einmal.
- **Encounter-Icons** sind rund und ohne Beschriftung (Beschriftung optional im Inspektor). Ein kleiner Keil am Rand zeigt die **Blickrichtung**: am Griff über dem markierten Icon drehen (Umschalt = 15°-Schritte), im Inspektor Winkel (0–359°) oder eine der acht Himmelsrichtungen, per Rechtsklick "Blick nach …" oder mit Q / E. Das Bild bleibt dabei aufrecht. Im Board steht nur Text, den du selbst eingegeben hast (kein automatisches "Tank 1" oder Zonen-Typ). In der Palette findest du die Boss-Icons der Instanz, Gegner und Boss-Position; ein WoW-Icon lässt sich über seinen Namen einfügen (eine echte Suche folgt später).
- **Slots nach Rolle**: Tank, Heiler, Melee, Ranged und "DPS (egal)". Beim Anwenden einer Vorlage füllen sich Melee/Ranged nur, wenn die Spezialisierung eindeutig ist; sonst bleibt der Slot offen oder nimmt "DPS (egal)".
- **Gruppen-Marker**: "Raider anzeigen" blendet die Namensliste ein oder aus, "Aufsplitten" legt die Raider der Gruppe als eigene Token um den Marker (per Rechtsklick oder im Inspektor); sie wandern mit dem Marker mit und lassen sich einzeln verschieben.
- **Vorlage wählen**: kopiert eine Raidplan-Vorlage (siehe unten) als Momentaufnahme in den Plan und füllt Tank-, Heiler- und DPS-Slots aus dem freigegebenen Setup; was sich nicht füllen lässt, bleibt als "offen" sichtbar. Danach lässt sich alles einzeln anpassen; spätere Änderungen an der Vorlage wirken hier nicht.
- **Karten** lädst du selbst hoch (PNG/JPG/WebP, bis 3 MB): für diesen Plan, je Boss oder für die ganze Instanz. Es gilt die genaueste: Plan > Vorlage > Boss > Instanz > Raster. "Auf Standard zurücksetzen" entfernt die Karte des Plans.
- **Taktik wählen**: Aufgabenzeilen als benannte, nach Kategorie sortierte Profile speichern und auf einem Boss wieder übernehmen; die Spieler-Zuweisung bleibt pro Plan.
- **Speichern** schreibt den Plan; hat jemand anderes inzwischen gespeichert, meldet der Editor einen Konflikt und lädt erst nach deiner Bestätigung neu.
- **Freigeben & teilen** erzeugt einen Link (`/p/<token>`), den jeder ohne Anmeldung lesen kann (Karte + Aufgabentabelle je Boss). Angemeldete Raider sehen ihren eigenen Token hervorgehoben. Spieler nennt die Lese-Ansicht erst, wenn das Setup freigegeben ist. Die Freigabe lässt sich zurücknehmen oder der Link erneuern.

## Raidplan-Vorlagen

*Raid-Events → "Raidplan-Vorlagen", Bereich "Raids"*

- Benannte Vorlagen (z. B. "Montags-Raid") mit Name, Kategorie, Beschreibung, optional einem Server und den Instanzen. Je Boss ein Board **ohne Spieler**: Slots, Raid-Marker, Zonen, Aufgabenzeilen, Notiz; je Boss lässt sich eine eigene Karte hinterlegen.
- Die **Übersicht** zeigt je Vorlage eine Karte mit Vorschaubild, Chips (Kategorie, Server, Instanzen), Fortschrittsbalken je Boss und Datum der letzten Änderung, neueste zuerst. Suche und Filter nach Instanz und Kategorie. Ein Klick auf die Karte öffnet den Editor; per Icon änderst du Name und Eigenschaften, **duplizierst** oder **löschst** (mit Rückfrage) die Vorlage. Bereits angewendete Pläne bleiben beim Löschen unberührt.
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
