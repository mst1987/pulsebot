# Rollen-Nachrichten (Reaktionsrollen)

Endnutzer-Sicht: [guide-discord.md](guide-discord.md#rollen-nachrichten).

Eine Rollen-Nachricht ist eine Karte des Bots mit Titel, Text, großem Bild und je Rolle einem Knopf und einer
Reaktion. Vorbild: Titel „WoW Forever Role“, ein Bild, Knopf „✅ WoW Forever Role“ — wer klickt oder mit ✅
reagiert, holt sich die Rolle selbst. Die Orga legt die Nachricht im Web an (Bereich `channels`); die Web-Seite
dafür kommt in einem zweiten Schritt, die API steht.

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
- Knopf und Reaktion sind unabhängig: Wer per Knopf umschaltet, behält oder verliert seine Reaktion nicht.
- Reaktionen laufen nicht durch das Bot-Befehle-Recht; der Knopf erscheint dort als Befehl `rolemsg` unter
  „Kanäle“ (Standard: alle dürfen).

## Grenzen

25 Rollen (Knöpfe, 5 je Zeile), davon höchstens 20 mit Emoji (Reaktionen); Titel 200, Text 3000, Beschriftung
80 Zeichen. Emoji: ein Unicode-Emoji oder ein Server-Emoji `<:name:id>` / `<a:name:id>` des gewählten Servers;
ohne Emoji gibt es nur den Knopf. Server: Event- oder Talk-Server, beim Anlegen gewählt (`guildSide`).

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
  Speichern Warnungen, gespeichert wird trotzdem).
- Auf dem Server: **Rollen verwalten**, und eine Bot-Rolle, die **über** allen vergebenen Rollen steht.
- Intent `GuildMessageReactions` und die Partials Message/Reaction/User (`src/bot.js`); kein privilegierter
  Intent nötig.

## Bausteine

| Wo | Was |
|---|---|
| `src/stores/roleMessageStore.js` | `data/settings/role-messages.json`: die Nachrichten mit Server-Seite, Kanal, Nachricht, Inhalt, Rollen |
| `src/services/discord/roleMessages.js` | Prüfen, Posten, Bearbeiten (bei Kanal- oder Serverwechsel neu posten, alte löschen), Löschen, Auswahl-Listen, Knopf und Reaktionen |
| `src/services/discord/selfRole.js` | `privilegedReason`, `roleProblem`, `changeSelfRole` — der eine Weg, eine Rolle selbst zu holen |
| `src/commands/channels/roleMessageButton.js` | Einstieg der Knöpfe (Komponente ohne Slash-Befehl) |
| `src/web/apiRoutes/roleMessages.js` | Die API, Antwortform im Kopfkommentar |

## API (Bereich `channels`: GET lesen, sonst schreiben)

| Route | Antwort |
|---|---|
| `GET /api/role-messages` | `{ messages: [Entry], limits }`; Entry mit `guildId` und `url` (Link zur Nachricht, `""` wenn nicht gepostet oder nicht prüfbar) |
| `GET /api/role-messages/options?side=event\|talk` | Rollen (mit `privileged` = Grund oder `""`, `editable`), Textkanäle (mit `canReact`), Server-Emojis (`code` für `roles[].emoji`), `manageRoles`, `online` |
| `POST /api/role-messages` | Body `{ guildSide, channelId, title, body?, imageUrl?, color?, roles: [{ roleId, emoji?, label? }] }` → 201 `{ entry, url, warnings }` |
| `PUT /api/role-messages` | Body `{ id, ...wie POST }` (ganze Nachricht) → `{ entry, url, warnings, reposted }` |
| `DELETE /api/role-messages` | Body `{ id }` oder `?id=` → `{ id, messageDeleted }` |

Fehler: `{ error: { code, message, roleId?, reason? } }` mit dem Status der Prüfung; `message` ist deutsch und
zum Anzeigen gedacht. Die Codes stehen im Kopfkommentar der Route.

**Bild:** nur ein https-Link (`imageUrl`); einen Upload-Weg gibt es im Projekt noch nicht. Ein Bild lässt sich
z. B. in einen Discord-Kanal hochladen und dessen Link nehmen — solche Links laufen aber nach einiger Zeit ab,
ein dauerhaft gehostetes Bild ist besser.
