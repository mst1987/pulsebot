# Rollen-Nachrichten (Reaktionsrollen)

Endnutzer-Sicht: [guide-discord.md](guide-discord.md#rollen-nachrichten).

Eine Rollen-Nachricht ist eine Karte des Bots mit Titel, Text, großem Bild und je Rolle einem Knopf und einer
Reaktion. Vorbild: Titel „WoW Forever Role“, ein Bild, Knopf „✅ WoW Forever Role“ — wer klickt oder mit ✅
reagiert, holt sich die Rolle selbst. Die Orga legt die Nachricht im Web an: *System › Rollen-Nachrichten*
(`/channels/roles`, Bereich `channels`, Abschnitt [Web-Seite](#web-seite)).

## Verhalten

- **Knopf** (`rolemsg:<entryId>:<roleId>`): schaltet die Rolle um (hat man sie, wird sie genommen, sonst
  gegeben). Antwort nur für den Klickenden (ephemer), in seiner Sprache (`tr()`, Katalog
  `src/config/botText/de/roleMessages.js`), ohne Ping (`allowedMentions` leer). Ein Knopf einer gelöschten oder
  neu geposteten Nachricht antwortet „Dieser Knopf wird nicht mehr verwendet“.
- **Reaktion:** hinzugefügt → Rolle geben, entfernt → Rolle nehmen. Keine Antwort; Reaktionen von Bots (auch
  die eigenen) zählen nicht. Die Zuordnung läuft über die `messageId` im Store, Partials (Nachricht, Reaktion,
  Nutzer) werden nachgeladen — so wirken auch Nachrichten von vor einem Neustart.
- Der Bot setzt die Reaktionen beim Posten und Bearbeiten selbst (Reihenfolge wie die Rollen), nimmt eigene
  Reaktionen nicht mehr gewollter Emojis zurück und lässt die der Mitglieder stehen.
- **Emoji-Tausch beim Bearbeiten:** bekommt ein Emoji eine andere Rolle oder fällt es weg, leert der Bot
  **alle** Reaktionen dieses Emojis (auch die der Mitglieder — sonst stünde eine alte ✅ für die falsche Rolle)
  und setzt seine eigene neu. Das braucht im Kanal **Nachrichten verwalten**; fehlt es, kommt eine Warnung mit
  diesem Hinweis, die Mitglieder-Reaktionen bleiben stehen. Rollen werden dabei nicht genommen.
- **Alle Reaktionen entfernt** (`MessageReactionRemoveAll`) oder alle eines Emojis (`MessageReactionRemoveEmoji`,
  z. B. ein Mod räumt auf): der Bot setzt seine eigenen wieder; niemandes Rolle ändert sich (Discord schickt dafür
  keine Einzel-Entfernungen).
- Knopf und Reaktion sind unabhängig: Wer per Knopf umschaltet, behält oder verliert seine Reaktion nicht.
- **Recht:** Knopf und Reaktion folgen derselben Bot-Befehle-Regel, dem Befehl `rolemsg` unter „Kanäle“
  (Standard: alle dürfen; gezählt werden die Rollen auf dem ersten Server der Liste). Wer nicht darf, bekommt beim Knopf
  die übliche Absage, bei der Reaktion nichts (nur `log.info`).
- **Abklingzeit:** je Mitglied und Rolle eine Änderung pro 2 Sekunden, Knopf und Reaktion zusammen (im
  Speicher). Ein zweiter Klick antwortet „Einen Moment bitte …“, eine zweite Reaktion wird nur geloggt. Folge:
  Wer eine Reaktion innerhalb von 2 Sekunden wieder abnimmt, behält die Rolle (und umgekehrt) — Reaktion
  neu setzen bzw. den Knopf nehmen.

## Grenzen

25 Rollen (Knöpfe, 5 je Zeile), davon höchstens 20 mit Emoji (Reaktionen); Titel 200, Text 3000, Beschriftung
80 Zeichen. Emoji: ein Unicode-Emoji oder ein Server-Emoji `<:name:id>` / `<a:name:id>` des gewählten Servers;
ohne Emoji gibt es nur den Knopf. Server: einer aus der Serverliste (`discordServers.servers`), beim Anlegen gewählt (`guildId`); ein gespeichertes altes `side` (`event`/`talk`) wird beim Lesen zur Guild-ID (`guildRoles.roleMessageGuild`).

## Sicherheit

Eine per Klick holbare Rolle darf keine Rechte tragen. Geprüft wird über `privilegedReason` in
`src/services/discord/selfRole.js` (dieselbe Prüfung wie bei der Addon-Zentrale): Admin-, Orga-, Bereichs- und
Befehlsrollen, Raider-Rollen der Kategorien, Roster-Rollen, Rollen des Rollen-Abgleichs, Rollen mit Rechten über
@everyone hinaus oder mit einer Kanal-Freigabe.

- **Speichern:** eine solche Rolle wird abgelehnt (`privileged_role` mit `roleId` und `reason`), ebenso eine, die
  der Bot nicht vergeben kann (`role_unusable`: kein „Rollen verwalten“, Integrationsrolle, Rolle über der des
  Bots).
- **Klick und Reaktion:** wird eine Rolle später heikel (Rechte nachträglich vergeben), fasst der Bot sie in
  keine Richtung an und schreibt `log.warn`. Ebenso bei fehlendem Recht, gelöschter Rolle oder fehlendem
  Mitglied; der Klickende bekommt nur „Das hat gerade nicht geklappt“.

## Rechte des Bots

- Im Kanal: **Nachrichten senden**, **Reaktionen hinzufügen**, **Nachrichtenverlauf lesen** (sonst kommen beim
  Speichern Warnungen, gespeichert wird trotzdem); für den Emoji-Tausch zusätzlich **Nachrichten verwalten**.
- Lässt sich eine frisch gepostete Nachricht nicht speichern, löscht der Bot sie gleich wieder (keine Nachricht,
  die niemand mehr bearbeiten kann). Schlägt das Neu-Posten beim Bearbeiten fehl, bleibt der alte Eintrag.
- Auf dem Server: **Rollen verwalten**, und eine Bot-Rolle, die **über** allen vergebenen Rollen steht.
- Intent `GuildMessageReactions` und die Partials Message/Reaction/User (`src/bot.js`); kein privilegierter
  Intent nötig.

## Bausteine

| Wo | Was |
|---|---|
| `src/stores/roleMessageStore.js` | `data/settings/role-messages.json`: die Nachrichten mit Server (Guild-ID), Kanal, Nachricht, Inhalt, Rollen. Alte Einträge mit `guildSide` (`event`/`talk`) schreibt der Start einmal auf `guildId` um (`migrateGuildSides`, aufgerufen aus `settingsMigration.migrateRoleMessageGuilds`, solange die Datei noch ein `talkGuildId` trägt — die Migration läuft vor `migrateDiscordFederation`, #897) — danach verschiebt weder #897 noch eine neue Reihenfolge der Serverliste eine Nachricht |
| `src/services/discord/roleMessages.js` | Prüfen, Posten, Bearbeiten (bei Kanal- oder Serverwechsel neu posten, alte löschen), Löschen, Auswahl-Listen, Knopf und Reaktionen |
| `src/services/discord/selfRole.js` | `privilegedReason`, `roleProblem`, `changeSelfRole` — der eine Weg, eine Rolle selbst zu holen |
| `src/commands/channels/roleMessageButton.js` | Einstieg der Knöpfe (Komponente ohne Slash-Befehl) |
| `src/web/apiRoutes/roleMessages.js` | Die API, Antwortform im Kopfkommentar |
| `src/web-client/src/pages/channels/RoleMessagesPage.tsx` | Die Web-Seite: Liste + Editor-Dialog (`?edit=<id\|new>`) |
| `src/web-client/src/pages/channels/RoleMessagePreview.tsx` | Vorschau der Discord-Karte (Knöpfe zu je 5, Reaktionszeile) |
| `src/web-client/src/lib/discord/roleMessages.ts` | Client-Logik ohne React: gesperrte Rollen, Formular-Probleme, Fehlercodes und Gründe in Worten |

## Web-Seite

*System › Discord*, Reiter *Rollen-Nachrichten* (`/channels/roles`, im Menü versionsneutral wie der Reiter *Kanäle*; mit `channels: read`
nur die Liste, ohne Knöpfe).

- **Liste:** Titel, Server, Kanal, Rollen als Zahl mit Wort (Tooltip mit den Namen), Link nach Discord;
  Bearbeiten und Löschen (Löschen über den Bestätigungsdialog, nimmt auch die Discord-Nachricht weg).
- **Editor** als Dialog über der Liste, links die Felder, rechts die Vorschau. Server (Event/Talk), Kanal nach
  Kategorie gruppiert (Hinweis, wenn der Bot dort nicht reagieren darf — `canReact`), Titel, Text, Bild-URL,
  eigene Farbe als Schalter. Rollen über „Rolle hinzufügen“: Suche, „Wählbar“ und „Nicht wählbar“; gesperrte
  Rollen sind ausgegraut und nennen den Grund (die englischen Gründe aus `selfRole.js` übersetzt die Client-Lib).
  Je Rolle Emoji (Unicode oder Server-Emoji), Knopf-Text (vorbelegt mit dem Rollennamen), Reihenfolge, Entfernen.
- **Prüfen vor dem Klick:** dieselben Grenzen wie der Server; was fehlt, steht als Liste über dem Speichern-Knopf,
  der bis dahin gesperrt bleibt. Ist der Bot offline oder fehlt „Rollen verwalten“, steht ein Hinweis oben.
- **Antworten:** `warnings` des Servers erscheinen als Toast „Hinweis: …“; jeder Fehlercode hat einen Text in
  de und en (`roleMessages.error.*`), bei `privileged_role`/`role_unusable` mit Rollenname und Grund.
  `lib/discord/roleMessages.test.ts` prüft, dass jeder Code der Route und jeder Grund aus `selfRole.js`
  übersetzt ist.

## API (Bereich `channels`: GET lesen, sonst schreiben)

| Route | Antwort |
|---|---|
| `GET /api/role-messages` | `{ messages: [Entry], limits }`; Entry mit `guildId` und `url` (Link zur Nachricht, `""` wenn nicht gepostet oder nicht prüfbar) |
| `GET /api/role-messages/options?guildId=<id>` | Rollen (mit `privileged` = Grund oder `""`, `editable`), Textkanäle (mit `canReact`), Server-Emojis (`code` für `roles[].emoji`), `manageRoles`, `online` |
| `POST /api/role-messages` | Body `{ guildId, channelId, title, body?, imageUrl?, color?, roles: [{ roleId, emoji?, label? }] }` → 201 `{ entry, url, warnings }` |
| `PUT /api/role-messages` | Body `{ id, ...wie POST }` (ganze Nachricht) → `{ entry, url, warnings, reposted }` |
| `DELETE /api/role-messages` | Body `{ id }` oder `?id=` → `{ id, messageDeleted }` |

Fehler: `{ error: { code, message, roleId?, reason? } }` mit dem Status der Prüfung; `message` ist deutsch und
zum Anzeigen gedacht. Die Codes stehen im Kopfkommentar der Route.

**Bild:** nur ein https-Link (`imageUrl`); einen Upload-Weg gibt es im Projekt noch nicht. Ein Bild lässt sich
z. B. in einen Discord-Kanal hochladen und dessen Link nehmen — solche Links laufen aber nach einiger Zeit ab,
ein dauerhaft gehostetes Bild ist besser.
