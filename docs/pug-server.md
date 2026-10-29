# PuG-Server

Ein eigener Discord-Server, auf dem die Gilde offene Raids (PuGs) anbietet. EventHelper ist dort der Hauptbot. Die
PuG-Raids erscheinen als Liste auf den Partnerservern, angemeldet wird direkt aus dieser Liste. Epic #903 (Teile
#904–#909), gebaut auf dem Server-Verbund #893.

Technik der Bausteine: [discord-servers.md](discord-servers.md) (Verbund, Raid-Liste je Verknüpfung, Rollen &
Onboarding, Einladungen), [signups.md](signups.md) (Anmeldung aus der Partner-Liste, Web nur für Mitglieder),
[events.md](events.md) (öffentliche Event-Seite `/e/<id>`).

## Entscheidungen (Okt 2026)

- **Richtung PuG → Partner.** Der PuG-Server zeigt seine Raids auf Partnerservern, nicht umgekehrt. Er spiegelt keine
  Partner-Raids, es gibt keine gemeinsame Liste aller Quellen und keine „externen Einträge“ für Partner ohne
  EventHelper. Eine Liste ist eine **Verknüpfung** `PuG-Server → Partner` mit Kanal, Sprache und Versionsfilter; ein
  Admin legt sie von Hand im Web an.
- **Die Kategorie entscheidet.** Jede Raidart ist erlaubt. Version, Sprache der Posts und Zugang kommen aus den
  Kategorie-Einstellungen. PuG heißt: Kategorie ohne Raider-Rolle und ohne „Anmeldung nur für das Roster“
  (`signupAccess` = *open*), nie aus dem Namen geraten. PuG-Kategorien posten in der Regel auf Englisch.
- **PuGs anlegen** darf, wer die passenden Rollen hat: Orga oder Roster-Manager der Kategorie
  ([permissions.md](permissions.md)).
- **Jeder richtet sich selbst ein** – über das Discord-Onboarding: Versionsrolle (macht die PuG-Kategorien dieser
  Version sichtbar) und Klassenrolle (Namensfarbe = oberste Klassenrolle, hingenommen). Eine Klassenrolle je Klasse
  für alle Versionen. Fragen auf Englisch. Selbstvergabe schaltet nichts frei (Folge-Issue #930).
- **Anmelden im Partnerkanal** geht auch ohne Mitgliedschaft auf dem PuG-Server. Wer nicht Mitglied ist, bekommt
  danach einen Hinweis mit Einladungsknopf, denn Pings und Infos gibt es nur auf dem PuG-Server (#904). „Für alle Raids
  anmelden“ gibt es nicht mehr, „Mehrere Raids wählen …“ bleibt.
- **Web-Anmeldung zu PuGs nur für Mitglieder** des PuG-Servers (kein Basiszugang für Fremde); Nicht-Mitglieder sehen
  die allgemeine Einladung. Ohne Charakter fragt das Web Klasse → Spec → Name wie der Bot (#907).
- **Einladungen erzeugt der Bot** – je Verknüpfung eine dauerhafte, dazu eine allgemeine je Server, beides **nur auf
  Knopfdruck**. Die Herkunft neuer Mitglieder wird je Verknüpfung gezählt (#905).
- **Rollen und Onboarding schreibt der Bot nur auf Knopfdruck** im Web, nach einer Vorschau „Das ändert sich in
  Discord“ (#906).

## Aufbau (Variante A)

Gewählt nach einem Test auf dem Dev-Testserver: Variante A (Kanäle wie auf den bisherigen Raid-Servern) liest sich
deutlich angenehmer als ein Forum (B) oder eine einzige Tafel (C).

| Kategorie | Kanäle | Sichtbar für |
|---|---|---|
| `╭ ・Welcome & Information` | eingangshalle, regeln, rollen, ankündigungen, raidoverview | alle |
| `╭ ・ PUG Raids TBC` (je Version eine) | raidzentrale, die Raid-Kanäle (`🔸》raid-26-oct`), logs, discussion | Versionsrolle, Orga, Bot |
| `╭ ・ Orga` | orga-zentrale, orga-talk, bot-log | nur Orga |
| Voice, `📦 Archiv` | – | wie gewohnt |

Jede PuG-Kategorie ist im Web eine Raid-Kategorie mit fester Version, Raid-Vorlage und Sprache *English*. Die
Sichtbarkeit setzt der Bot beim Übernehmen von „Rollen & Onboarding“: @everyone verweigert, Versionsrolle, Orga-Rollen
und Bot erlaubt. MoP und andere neue Versionen erst nach dem Runbook „Neue Version starten“
([game-versions.md](game-versions.md)).

## Was der Bot braucht

| Was | Wofür | Geprüft von |
|---|---|---|
| Community-Server | Discord-Onboarding | „Rollen & Onboarding“ (409 `no_community`) |
| Kanäle verwalten, Nachrichten senden, Links einbetten | Raid-Kanäle, Nachrichten, Karten | Server-Karte |
| Rollen verwalten | Versions- und Klassenrollen, Rechte der Kategorien | Server-Karte, „Rollen & Onboarding“ |
| Server verwalten | Onboarding schreiben, Einladungen lesen (Herkunft) | „Rollen & Onboarding“, Bot-Check „Einladungen“ |
| Einladung erstellen | Einladungen je Verknüpfung und allgemein | Bot-Check „Einladungen“ |
| Bot-Rolle **über** allen Klassen- und Versionsrollen | Rollen vergeben und umfärben | 409 `role_above_bot` |
| GuildMembers-Intent (privilegiert, ist aktiv) | Mitgliederliste, Herkunft, Web-Mitgliedschaft | Server-Karte „Mitglieder lesen“ |

Das Discord-Onboarding schaltet die Orga selbst ein (Server-Einstellungen › Onboarding): Discord verlangt mindestens
**7 Standard-Kanäle**, alle für @everyone sichtbar. Ein Standard-Kanal in einer PuG-Kategorie bricht das Übernehmen
mit 409 `default_channel_hidden` ab. Der Bot schickt Einschalten, Modus und Standard-Kanäle unverändert zurück und
ersetzt nur die Fragen – fremde Fragen gehen dabei verloren, die Vorschau nennt sie.

## Checkliste: einen PuG-Server einrichten

| # | Schritt | Wo | Wer |
|---|---|---|---|
| 1 | Server anlegen, Kategorien und Kanäle nach Variante A | Discord | Discord-Admin des PuG-Servers |
| 2 | Community einschalten (Regel- und Update-Kanal) | Discord › Server-Einstellungen › Community | Discord-Admin |
| 3 | Bot einladen mit den Rechten oben; Bot-Rolle ganz nach oben über alle späteren Klassen-/Versionsrollen ziehen | Discord (Einladungslink des Bots) | Discord-Admin |
| 4 | Server in die Serverliste eintragen (Name, Label „PuG“); die Server-Karte muss „verbunden“ und alle Rechte zeigen | Web › Einstellungen › Discord-Server | Voll-Admin |
| 5 | Schalter „PuG-Server“ setzen (Stift am Server); ohne ihn gibt es für diesen Server kein „Rollen & Onboarding“ | Web › Einstellungen › Discord-Server › Server bearbeiten | Voll-Admin |
| 6 | Slash-Befehle auf dem neuen Server registrieren: der nächste Deploy tut es von selbst (neue Ziel-Server ändern den Hash), sofort mit `gh workflow run ci.yml --ref main -f force=register --repo mst1987/pulsebot` | GitHub Actions | Voll-Admin |
| 7 | Je PuG-Kategorie: aktivieren, Version, Standard-Vorlage, Sprache *English*, **keine** Raider-Rolle, kein Roster-Zwang | Web › Einstellungen › Kategorien | Voll-Admin |
| 8 | Orga-Rollen bzw. Roster-Manager der Kategorien festlegen (wer PuGs anlegt) | Web › Einstellungen › Berechtigungen, Roster | Voll-Admin |
| 9 | Rollen & Onboarding: Vorschau prüfen, „In Discord übernehmen“; danach Onboarding in Discord einschalten (7 sichtbare Standard-Kanäle) | Web › Einstellungen › Discord-Server › Rollen & Onboarding, dann Discord › Onboarding | Voll-Admin, dann Discord-Admin |
| 10 | Raid-Zentrale und Orga-Zentrale je Kategorie posten | Web › Einstellungen › Kategorien › Discord-Zentralen | Orga |
| 11 | Je Partner: Partnerserver hat EventHelper; Verknüpfung `PuG → Partner` anlegen (Kanal, Sprache, Versionen), Einladung erzeugen und die allgemeine Einladung des PuG-Servers erzeugen; Test mit einem Partner: aus der Liste anmelden (als Mitglied und als Nicht-Mitglied), Herkunft „beigetreten“ prüfen | Web › Einstellungen › Discord-Server, dann Discord des Partners | Voll-Admin, ein Raider zum Testen |

Schritt 11 setzt voraus, dass der Bot auch auf dem Partnerserver ist (ein Partner ohne EventHelper ist nicht
vorgesehen). Der Partner muss nicht in der Serverliste stehen: ein reines Ziel bekommt keine Raid-Server-Rechte.

## Wege zur Anmeldung

1. **Im Partnerkanal:** „Einzelnen Raid wählen …“ oder „Mehrere Raids wählen …“ unter der Raid-Liste öffnet den
   Anmeldedialog direkt dort. Nicht-Mitglieder des PuG-Servers bekommen nach „Gespeichert“ den Hinweis „Tritt dem
   Server … bei“ und den Knopf mit der Einladung der Verknüpfung.
2. **Im Web** über den Titel in der Liste (`/e/<id>`, öffentliche Event-Seite mit Kategorie in der Brotkrume): nur
   für Mitglieder des PuG-Servers; Nicht-Mitglieder sehen „Nur für Mitglieder des PuG-Servers“ und „PuG-Server
   beitreten“ mit der allgemeinen Einladung (`pugMembership.pugInviteUrl` → `generalInviteUrl`; ohne erzeugte
   Einladung kein Knopf).
3. **Auf dem PuG-Server** an der Anmelde-Nachricht im Raid-Kanal, wie auf jedem Raid-Server.

## Recruitment der Partnergilden als Forum

Partnergilden können sich im PuG-Server in einem **Forum** vorstellen: je Gilde ein Beitrag mit Titel, darunter
ein grauer **Link-Knopf** („Server beitreten“ oder eigener Text) statt des Bewerben-Knopfs. Angelegt wird das unter
Recruitment › „Nachricht posten“: Ziel = das Forum (markiert mit „Forum“), Titel des Beitrags, Knopf *Link*. Den
Link erzeugt entweder der Bot als dauerhafte Einladung (Server und Channel wählen; nur auf Servern mit dem Bot, die
man im Web bedienen darf, und nur mit dem Recht „Einladung erstellen“) oder man fügt die Einladung der Partnergilde
ein (nur `discord.gg/…`, `discord.com/invite/…`, `discord.com/channels/…`). Titel und Link lassen sich später unter
„Gepostete Nachrichten“ ändern; „Server durchsuchen“ findet solche Beiträge nicht, sie müssen über das Web gepostet
sein. Bot-Rechte im Forum: *Nachrichten senden* und *Nachrichten in Threads senden*. Technik: docs/web-admin.md.

## Offen

- #930: PuG-Onboarding-Rollen dürfen nicht in rollenbasierte Felder (Raider-Rollen, Orga-Rollen, Rechte), sonst
  schaltet die Selbstvergabe frei, was die Rolle nicht soll.
