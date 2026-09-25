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
- **Alles auf einem Bildschirm:** Werkzeugleiste, Palette (eine Zeile), Besetzung und das Board stehen untereinander, rechts daneben das **Dock** mit Einteilungen, Eigenschaften, Ebenen und Hintergrund. Beim Blättern durch die Karten bleibt das Board im Blick. Auswahllisten (Zuständige, Ziele, Spells, Spieler, Icons) öffnen sich **als Fenster neben der Karte**, ohne Scrollen: mehrere Einträge anhaken (Shift-Klick für einen Bereich, "Alle" für einen Abschnitt), bei vielen Einträgen gibt es Suche und Seiten.
- **Besetzung:** Slots entstehen nur über **+ / −** in der Besetzung. Ziehen oder Klicken aus der Palette setzt den nächsten freien Slot auf die Map (Zähler "3/5"); sind alle platziert, ist der Eintrag ausgegraut. Die Chips der Besetzung lassen sich **direkt aufs Board ziehen** (Esc bricht ab); ein platzierter Chip zurück auf die Leiste nimmt den Slot von der Map.
- **Karten entfernen:** Selbst hinzugefügte Einteilungs-Karten löschst du mit dem Papierkorb (mit Zeilen: nach Rückfrage, Strg+Z holt sie zurück). Standardkarten blendest du mit dem Auge aus und holst sie über "Karte hinzufügen" zurück; das Ausblenden gilt für den ganzen Plan.
- **Rechtsklick** (Touch: lange drücken) öffnet ein eigenes Menü: auf einem Objekt Eigenschaften, Duplizieren, Vorder-/Hintergrund, Sperren, Spieler zuweisen/lösen, Löschen; auf der leeren Karte Slots, Marker, Zonen, Pfeile, Linien oder Text an der Klickstelle einfügen. Es lässt sich mit Pfeiltasten, Enter und Esc bedienen.
- Zonen skalierst du an den Ecken, Linien an den Enden; gesperrte Objekte bewegen sich nicht.
- **DPS als Gesamtzahl:** Pflicht sind Größe, Tanks und Heiler; der Rest ist DPS ("DPS 1..n", jeder Schadensverursacher passt). Melee/Ranged trennst du nur, wenn du willst (Schalter "DPS in Melee / Ranged aufteilen"). **Pro Boss** lassen sich die Zahlen mit +/- ändern ("nur dieser Boss", der Pfeil setzt zurück), und im Event kann ein Spieler pro Boss die Rolle wechseln (Chip anklicken: Heiler spielt hier DPS). Hat das Setup mehr Tanks/Heiler/DPS als die Vorlage, kommen Slots dazu; hat es weniger, bleiben sie offen.
- **Mobs und Katalog:** Jeder Boss hat den Boss selbst als Tankziel, dazu seine Adds aus dem Katalog; weitere Mobs fügst du in der Leiste "Mobs" hinzu ("+"), das Fadenkreuz setzt einen Mob als rundes Icon auf die Map. Unter *Raid-Events → Raidplan-Katalog* pflegst du Mobs und Spells (Standardwerte überschreiben, ausblenden, zurücksetzen, eigene anlegen). Einteilungszeilen wählen ihren Spell aus dem Katalog (mit Icon).
- **Mob-Bilder:** Fast alle Standard-Mobs (43 von 46) zeigen ein echtes **Portrait** (Modell-Ansicht des NPCs, auf Kopf und Schultern zugeschnitten); nur Doomfire Spirit, Towering Infernal und Giant Infernal haben noch ein ähnliches Spell-Icon und sind als "Platzhalter-Icon" markiert. Eigene Icons setzt du im Katalog weiterhin selbst.
- **Lese-Ansicht:** lesbare Breite, Einteilungen als Karten nebeneinander mit echten WoW-Icons, oben "Meine Einteilungen" (es gibt keine Gesamtliste "Aufgaben nach Spieler" mehr). Wer eingeloggt ist, wird auch über die Charaktere seines Raider-Profils erkannt und überall hervorgehoben; der Login führt zurück zur Plan-Seite.
- **Besetzung** (Leiste unter dem Board): alle Rollen-Slots des Raids (Tank 1..n, Heiler, Melee, Ranged, Gruppen) sind sofort da, ohne dass du sie aufs Board ziehen musst. +/- ändert die Anzahl, der Pin setzt einen Slot auf die Map (klicken oder ziehen). Im Event zeigen die Chips die Spieler; ein Klick darauf gibt den Platz an jemand anderen. Bei einer neuen Vorlage legst du Raidtyp und Größe fest, die Besetzung ist daraus vorbelegt.
- **Einteilungen** (direkt unter dem Board, eine Liste für alles inkl. der früheren Aufgabenzeilen): pro Zeile Typ-Icon (Heilen, Unterbrecher, Misdirect, Seelenstein, Furchtschutz, Tanken, Dispel, CC, Buff, Sonstiges), Aufgabe als Freitext, Zuständige und Ziele als Chips. wer heilt wen, Unterbrecher-Reihenfolge, Misdirects, Seelensteine, Furchtschutz, Spezial-Tank, Sonstiges. Pro Zeile wählst du Zuständige und Ziele als Chips (Slots, Gruppen, Marker, Spieler, Freitext; mehrere gleichzeitig). "Vorschlag …" legt Zeilen aus dem Setup an (Heiler verteilen, Kicker, Misdirects, Seelensteine, Furchtschutz, Flüche, Donnerknall, Demoralisierender Ruf, Trash-Tanks auf Marker); sie sind als "Vorschlag" markiert und ändern sich mit deiner ersten Bearbeitung. Passt niemand, kommt kein Vorschlag. In einer Vorlage sind es Platzhalter ("Heiler 2 → Tank 1"), die sich beim Anwenden mit dem Setup füllen. Heilungen zeichnet das Board als dünne Linien ("Verbindungen zeigen").
- **Trash** und **Allgemein**: Zusätzliche Einträge in der Bossliste. "Trash" ist ein eigenes Board je Instanz (Tanks auf Marker, Heilung, Kicks), "Allgemein" gilt für den ganzen Raid (Flüche, Donnerknall, Demoralisierender Ruf). Beide sind Teil der Vorlagen.
- **Größe**: jedes Objekt hat im Inspektor einen Größen-Regler, am markierten Objekt einen Griff (Umschalt behält bei Zonen das Verhältnis), die Tasten `+` / `-` und Alt + Mausrad; unter "Hintergrund" skaliert "Objektgröße" alles auf einmal.
- **Encounter-Icons** sind rund und ohne Beschriftung (Beschriftung optional im Inspektor). Ein kleiner Keil am Rand zeigt die **Blickrichtung**: am Griff über dem markierten Icon drehen (Umschalt = 15°-Schritte), im Inspektor Winkel (0–359°) oder eine der acht Himmelsrichtungen, per Rechtsklick "Blick nach …" oder mit Q / E. Das Bild bleibt dabei aufrecht. Im Board steht nur Text, den du selbst eingegeben hast (kein automatisches "Tank 1" oder Zonen-Typ). In der Palette findest du die Boss-Icons der Instanz, Gegner und Boss-Position; ein WoW-Icon lässt sich über seinen Namen einfügen (eine echte Suche folgt später).
- **Slots nach Rolle**: Tank, Heiler, Melee, Ranged und "DPS (egal)". Beim Anwenden einer Vorlage füllen sich Melee/Ranged nur, wenn die Spezialisierung eindeutig ist; sonst bleibt der Slot offen oder nimmt "DPS (egal)".
- **Gruppen-Marker**: "Raider anzeigen" blendet die Namensliste ein oder aus, "Aufsplitten" legt die Raider der Gruppe als eigene Token um den Marker (per Rechtsklick oder im Inspektor); sie wandern mit dem Marker mit und lassen sich einzeln verschieben.
- **Vorlage wählen**: kopiert eine Raidplan-Vorlage (siehe unten) als Momentaufnahme in den Plan und füllt Tank-, Heiler- und DPS-Slots aus dem freigegebenen Setup; was sich nicht füllen lässt, bleibt als "offen" sichtbar. Danach lässt sich alles einzeln anpassen; spätere Änderungen an der Vorlage wirken hier nicht.
- **Karten** lädst du selbst hoch (PNG/JPG/WebP; zu große Bilder werden vor dem Hochladen automatisch verkleinert, du siehst "Verkleinert: 6,3 MB → 2,6 MB, 2560×1600"): für diesen Plan, je Boss oder für die ganze Instanz. Es gilt die genaueste: Plan > Vorlage > Boss > Instanz > Raster. "Auf Standard zurücksetzen" entfernt die Karte des Plans.
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

### Neu: Besetzung zuweisen, Standard, Mehrfachauswahl

- **Besetzung zuweisen** (Knopf in der Besetzungs-Leiste und in der Werkzeugleiste): ein Fenster mit allen Slots je Rolle (Tank | Heiler | Melee | Ranged | DPS). Slot waehlen, Spieler anklicken oder auf einen Slot ziehen; wer schon woanders steht, tauscht den Platz. "Offene Slots fuellen" belegt nach Rolle und Klasse, "Alle leeren" leert. Jeder Slot kann eine bevorzugte Klasse haben: beim Anwenden der Vorlage bekommt er einen Spieler dieser Klasse, fehlt sie, bleibt er offen.
- **Standard** (Vorlage): Tank-/Heiler-Einteilungen einmal eintragen, alle Bosse erben sie; pro Boss abweichen, ausblenden oder zuruecksetzen; "Standard auf alle Bosse anwenden" kopiert.
- **Mehrfachauswahl** auf dem Board: mit dem Gummiband, Strg/Shift-Klick oder Strg+A; der Rahmen verschiebt und skaliert alles gemeinsam.
- **Gruppenring** ausblendbar (je Gruppe, Auswahl oder ganzes Board).
- **Lese-Ansicht**: zwei Spalten, "Meine Einteilungen" zuerst, "Du" wird ueberall hervorgehoben.

### Neu (Runde 4)

- **Editor = Sheet.** Das Board wird in einem festen Referenzraum gezeichnet und als Ganzes skaliert: was du im Editor anordnest, sieht das Sheet bei jeder Breite gleich (nur groesser oder kleiner).
- **Zoom:** Strg + Mausrad zoomt zum Zeiger, normales Rad scrollt die Seite; verschieben mit Leertaste + Ziehen, mittlerer Maustaste oder Hand-Werkzeug; Klick auf die Prozentzahl = Einpassen. Auch im Sheet (Knoepfe auf der Karte).
- **Groessen in Prozent** fuer jedes Element (Inspektor oben, Rechtsklick, Mehrfachauswahl relativ). Gruppen haben "Gruppengroesse", "Kranz-Abstand" und "Token-Groesse"; der Name skaliert mit dem Icon. "Ansicht" (Regler-Symbol): Symbolgroesse, Namen, Nummern-Badges, Rollenringe, Gruppenkraenze, "Mich hervorheben", Auswahlrahmen, Verbindungslinien; im Sheet ein kleines Ansicht-Menue nur fuer dich.
- **Gruppen:** eigene Farben (Standard: acht gut unterscheidbare) und Raid-Marker, "Gruppe hervorheben". Gruppenheilung: eine Zeile je Gruppe mit Mitgliedern und Heilern.
- **Klassen als Zustaendige:** in der Zeile unter "Klasse" waehlen (z. B. Jaeger fuer Misdirect); beim Anwenden auf ein Event wird der erste freie Spieler der Klasse eingesetzt, fehlt die Klasse, bleibt es offen ("Jaeger fehlt"). Misdirect ist in TBC nur Jaeger.
- **Anzahl und Reihum:** eine gewaehlte Klasse steht als ein Chip mit Anzahl im Zeilen-Dialog ("Jaeger 1  - x1 +"); mit + machen zwei Jaeger dieselbe Aufgabe. Legst du mit "+" an der Karte eine weitere Zeile an, uebernimmt sie die Klasse mit der naechsten Nummer ("Jaeger 2" = der naechste freie Jaeger, dann "Jaeger 3" ...). Niemand macht dieselbe Aufgabe doppelt (ausser "Mehrfach erlauben" an der Zeile). Gibt es weniger Jaeger als Plaetze, bleiben die uebrigen leer ("Jaeger 3 (fehlt)") - es wird nie ein Spieler einer anderen Klasse eingesetzt. Die Vorschlaege (Zauberstab) und das Anwenden einer Vorlage verteilen genauso und lassen deine von Hand gemachten Zeilen stehen.
- **Allgemeiner Tank:** in Tank-Zeilen (Main-Tank / Tanken, Trash, Spezial-Tank) oben rechts im Dialog "Beliebiger Tank", "Tank (Krieger)", "Tank (Paladin)" oder "Tank (Druide)" waehlen. Eingesetzt wird ein freier Spieler mit der Spec-Rolle Tank aus dem Setup (Schutz-Krieger/-Paladin, Baer) - nie ein Vergelter oder Katzen-Druide. Mehrere Tank-Zeilen nehmen reihum verschiedene Tanks; eine Zeile mit fester Klasse bekommt ihren Tank zuerst, "Beliebiger Tank" nimmt den naechsten. Fehlt ein Tank, bleibt die Zeile offen.
- **Sheet:** "Meine Aufgaben" und "Wirkt auf dich" als Karten je Einteilung, darunter "Alle Einteilungen".

- **Gruppenfarben und Marker** gelten jetzt fuer den ganzen Plan (nicht nur einen Boss). **Sheet-Vorschau** (Auge in der Werkzeugleiste) zeigt das Board wie die Lese-Ansicht. Im Sheet: "Nur fuer mich" und "Nach Heiler" bei der Gruppenheilung.

- **Einzeln aufgestellte Raider verschwinden aus der Gruppe.** Wer ein eigenes Token oder einen Rollen-Slot auf der Karte hat, wird in seiner Gruppe (Kranz und Namensliste) nicht doppelt gezeigt; der Kranz schliesst sich. Entfernst du ihn wieder von der Karte, ist er zurueck in der Gruppe. Per Rechtsklick auf ein Kranz-Mitglied: "Aus Gruppe herausnehmen"; am freien Token: "Zurueck in die Gruppe". Das Token traegt die Gruppennummer als Abzeichen.
- **Bosse oder Trash aus dem Sheet ausklammern.** Am Boss-Chip (Auge, oder Rechtsklick auf den Chip) und im Dialog "Freigeben" (Haken je Abschnitt, "Alle", "Keine", "Nur Bosse", "Ohne Trash"). Ausgeklammerte Abschnitte sind im Editor grau, aber voll bearbeitbar; im geteilten Sheet kommen sie gar nicht an (auch nicht ihre Daten). Speichern nicht vergessen; auch in Vorlagen moeglich und beim Anwenden uebernommen.

- **Blickrichtung zum Tank:** Boss- und Mob-Icons (auch beide Flames of Azzinoth) zeigen automatisch zu ihrem Tank, auch wenn der Tank im Kranz einer aufgesplitteten Gruppe steht. **Leuchtring "Das bist du"** und Schatten skalieren jetzt mit der Icon-Groesse (kleine Icons bekommen keinen riesigen Glow mehr).
