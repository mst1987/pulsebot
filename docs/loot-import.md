# Loot-Import und Loot-Daten

Endnutzer-Sicht: siehe [guide-web-admin.md#historie--loot](guide-web-admin.md#historie--loot).

## Loot import (Gargul/RCLootcouncil)

`src/utils/loot/lootImport.js` normalizes all export formats to one loot-item shape (`parseLoot`/`parseGargul`/`parseRclc`/`parseEventHelper`). `enrichItemNames(items)` fills in `itemName`/`itemIconUrl` that an export didn't carry (Gargul gives neither, RCLootcouncil gives a name but no icon) via `src/utils/loot/wowhead.js`'s `lookupItem(itemId)` (Wowhead's tooltip endpoint, in-memory cached, best-effort — mock it in tests). The parse links items with the main version's Wowhead path; once the target event is known the import relinks them with **the event's version** (`services/loot/lootVersion.js`, #542) — a Forever raid's loot never links TBC Wowhead. Call it once, right after `parseLoot()` — the import handlers are `apiRoutes/history.js`'s `importLoot` (JSON, called from the React client's Historie-&-Loot and Raid-Detail Loot-tab imports) and `apiRoutes/ingest.js`'s `ingestLoot` (below).

## Addon loot sync (`/api/ingest/loot` → Addon-Inbox)

A companion WoW addon (own repo: **eventhelper-addon**) reads the in-game history of *both* loot addons and uploads it, so nobody has to click through two export dialogs. WoW's Lua sandbox has no network access at all, so the chain is: addon → its own SavedVariables → a Node sync tool on the raidleader's PC → `POST /api/ingest/loot`.

- **Wire format** `eventhelper-loot` v1 (`EH_FORMAT`/`EH_VERSION` in `lootImport.js`): an envelope of raid *sessions*, each with items carrying a real unix `awardedAt`. That timestamp is the point — Gargul's own CSV has a date but no time of day, which makes matching a raid night guesswork. A payload from a newer addon than the server knows is refused, never half-read.
- **Item `source` stays `"rclc"`/`"gargul"`**, so an addon upload and a hand-pasted export of the same award share the dedup key (`source` + `rawId` = RCLootcouncil's `id` resp. Gargul's `checksum`) and collapse into one item.
- **Auth is a bearer token**, not a Discord session — the uploader runs unattended. `src/stores/ingestTokenStore.js` stores tokens sha256-hashed, shows the secret exactly once, and revokes immediately. Minted in Einstellungen → *Loot-Sync* (full admins only). `apiAccess.js`'s `TOKEN_AUTH` set exempts *only* the `/api/ingest/*` paths (loot, raids, guildbank, guildbank/handouts) from the session gate; each handler checks the token itself before doing any work.
- **Which raid a session was** is resolved in `src/web/loot/lootSessionContent.js`, not taken at face value. The addon's reported instance wins — it saw the instance at award time — but it is blank for a Gargul-only night (Gargul stores no instance) and is a mere continent when RCLootcouncil recorded the award outside the instance ("Eastern Kingdoms" for a Karazhan night). In both cases the raid is derived from the item ids via `config/tbcContent.js`. Deliberately allowed to name more than one raid: TBC nights combine them (SSC + TK, Gruul + Magtheridon), so a single answer would be a false one. The inbox marks a derived name as such.
- **Nothing lands in the history unconfirmed.** An upload becomes a *pending session* in `src/stores/lootInboxStore.js`, shown on the *Addon-Inbox* page (`/history/inbox`) with the Raid-Helper event it was matched to (a suggestion; an ambiguous day shows every candidate and preselects nothing). Accepted sessions stay listed below the cards ("Verknüpft", `lootInboxStore.listLinked()`), with the items later uploads appended by themselves (`noteAppended()`). Accepting files it and is **remembered**: later uploads of that session append straight to the same event, which is how the rest of a raid night arrives without a second click. Dismissing is remembered too, so a discarded session cannot reappear. Re-uploads of a pending session merge into the one card instead of stacking up — the sync tool re-sends the whole raid on every SavedVariables flush, so that is the normal case.
- **`POST /api/ingest/raids`** (same bearer-token auth, also in `apiRoutes/ingest.js`) is what the sync tool's raid list uses to show, per recent raid, whether it still needs an upload: the tool sends its local sessions' aggregate fields (`sessionId`, `startedAt`, item counts — no item detail), and gets back each recent event's status (`"done"` already has loot or an accepted session, `"pending"` an unconfirmed Addon-Inbox card suggests it — from any uploader, with `inboxItems` — `"ready"` a local session falls on its day and can fill it, `"empty"` none of these). `"pending"` used to be folded into `"done"`, which made the tool show "Importiert" for a raid whose loot page was still empty. The day-match reuses `lootEventMatch.js`'s `bestDayMatch()` — the same function `suggestMatch()` above uses for the real upload — via the pure, separately unit-tested `computeRaidStatus()`, so the tool's preview can never disagree with what an actual upload would do.
- **`GET /api/ingest/council`** (same bearer token, also in `apiRoutes/ingest.js`) hands the sync tool a slim version of the loot-council roster, which it writes into `CouncilData.lua` for the in-game addon: per raider the need weighting (`need` and its three `parts` drought/share/need, plus the `weights`; since #668 `need` also holds the item weighting and belonging, and `weights` are the council's real shares of those three parts - the fourth, tenure, arrives as its own field with version 3, #670) and what they already received (`items`, newest first, at most 25; `bis.missing` lists the item ids still lacking). Query `category` (raid category id) and `role` (`caster`|`healer`), both optional. It builds the roster like the council page (`councilRoster()`, options from `web/loot/councilQuery.js`, which the page uses too) from stored data only - no armory call - and the pure `web/loot/councilSync.js` `councilSyncPayload()` cuts it down. All times are Unix **seconds**, percentages integers 0..100, `daysSinceLoot` is `-1` for "never". The format `eventhelper-council` **version 1** is shared with the eventhelper-addon repo: when a field changes, the version grows on **both** sides.

### Council-Daten für das Addon, Version 2 (#641)

`GET /api/ingest/council?v=2` (oder `?categories=council`) **ohne** `category` liefert **jede Raid-Kategorie, deren Lootsystem Loot-Council ist** (`categoryLootSystem()` in `services/loot/lootSystem.js`: gesetzt in Einstellungen → Kategorien, sonst RCLootcouncil als Loot-Addon), in einem Abruf — jede genau so, wie die Loot-Council-Seite sie für diese Kategorie zeigt:

- **Die Filter sind die der Seite.** Wählt man auf der Seite ein Roster (oder eine Kategorie ohne Roster), kommen Rolle, Content (Tiers + Raids), BiS-Liste und Spielversion aus dessen **Loot-Council-Profil** (#676, `GET /api/lootcouncil/views` mit `targets`) und jede Änderung wird in dieses Profil gespeichert (`POST /api/lootcouncil/view`, Schreibrecht `lootcouncil` wie Ausplanen/Rolle; Client `pages/lootcouncil/categoryViews.ts`, kurz entprellt). Gespeichert wird je Profil in `settings/council-profiles.json` (docs/loot-council.md „Profile je Roster“); bis #676 war es je Kategorie `council-views.json`. Ohne gespeicherte Ansicht gelten die Vorgaben der Seite: Rolle `caster`, alle Tiers/Raids, BiS-Liste abgeleitet, Hauptversion. „Alle Raid-Kategorien“ bleibt wie bisher im Browser (localStorage), ebenso Tab, BiS-Listen-Tier usw. Die Spielversion ist die des Menü-Umschalters: zeigt jemand mit Schreibrecht eine Kategorie in einer anderen Version, wird sie mitgespeichert. Die Seite sagt an der Filterzeile „Gilt auch fürs Spiel“, wenn die gewählte Kategorie als Loot-Council läuft; „Drop prüfen“ liest dieselben Filter.
- **Ein Weg für beide.** `web/loot/councilView.js` `buildCouncilView(opts)` ist Roster plus Armory-Schritt (Teile mit Boss-Drop im Set; Cache/TTL von `armoryGear.js`) und wird von `GET /api/lootcouncil` und vom Sync-Endpunkt benutzt; `categoryCouncil(id)` baut aus der gespeicherten Ansicht dieselbe Query wie der Client (`viewQuery`) und schickt sie durch dasselbe `councilOptsFromQuery()`. Ausgeplante Raider („Nicht eingeplant“) fehlen also in beiden, Rollen-Festlegungen und Gewichte gelten in beiden. `test/web/loot/councilView.parity.test.js` vergleicht Seite und Spiel mit dem echten `councilRoster()`.
- **Version 1 bleibt.** Eine Anfrage mit `category` (auch zusammen mit `v=2`) oder ohne `v=2`/`categories=council` bekommt Version 1 wie bisher — die Sync-Tools bis 1.9.0 schicken `category`/`role` und prüfen `version === 1`.

Form (innerhalb von `{ "data": … }`):

```json
{
  "format": "eventhelper-council",
  "version": 2,
  "generatedAt": 1791234567,
  "weights": { "drought": 50, "share": 40, "need": 10 },
  "categories": [
    {
      "id": "1234567890",
      "name": "SSC/TK Mittwoch",
      "lootSystem": "lootcouncil",
      "filter": { "role": "caster", "tiers": ["t5"], "contents": [], "bisTier": "t5", "bisTierDerived": false, "version": "tbc" },
      "instances": [{ "id": "ssc", "name": "Höhle des Schlangenschreins", "short": "SSC", "zoneNames": [] }],
      "avgLootCount": 3.4,
      "raiders": [
        {
          "key": "gemli", "character": "Gemli", "classFile": "PRIEST", "specLabel": "Shadow", "role": "caster",
          "need": 82, "parts": { "drought": 100, "share": 60, "need": 40 },
          "lootCount": 2, "lootTotal": 5, "otherCount": 1, "lastAwardAt": 1791000000, "daysSinceLoot": 12,
          "bis": { "tier": "t5", "source": "wowsims", "owned": 2, "total": 3, "missing": [30000] },
          "items": [{ "itemId": 30001, "itemName": "…", "awardedAt": 1791000000, "boss": "Lady Vashj", "reason": "Main Spec", "event": "SSC/TK Mittwoch" }]
        }
      ]
    }
  ]
}
```

- `filter.role` `""` = alle Rollen (dann stehen auch Heiler in der Liste); bei `caster` fehlen Heiler, wie auf der Seite. ⚠️ **Version 1 und 2 kennen nur `caster` und `healer`.** Seit #669 hat der Council auch `tank`, `melee` und `ranged`; ein Addon mit fester Rollenliste darf keine Rolle bekommen, die es nicht einordnen kann. Deshalb lassen beide Formate solche Raider weg (`LEGACY_ROLES` in `councilSync.js`), und eine Kategorie-Ansicht auf einer neuen Rolle meldet `filter.role: ""` mit leerer Liste. Der Bedarf der verbleibenden Raider ist trotzdem gegen das ganze Feld der Ansicht gerechnet, wie auf der Seite. Version 3 (#670) trägt die neuen Rollen. `filter.version` ist der Charakter-Versionsfilter, `""` = alle Versionen.
- `raiders[]` hat die Felder von Version 1 plus `key` (Charakter-Schlüssel, stabil über Umbenennung der Schreibweise/Realm-Suffix).
- `instances` sind die Instanzen der Standard-Raidvorlage der Kategorie (`config.categoryRaidTemplate`), `[]` ohne Vorlage — ein Hinweis, damit das Addon die Kategorie über `GetInstanceInfo()` vorwählen kann. Die Namen sind die des Regelsatzes (TBC deutsch, Forever englisch mit „(Forever)“), `zoneNames` die kleingeschriebenen Zonennamen, wo der Regelsatz welche kennt; ein sicherer Schlüssel ist das nicht, nur ein Vorschlag.
- Keine Loot-Council-Kategorie → `categories: []`.
- **Kategorie mit Roster (#667):** `raiders[]` sind die Kandidaten aus dem Roster — Stamm und Probe; Ersatz nie (der Filter „Ersatz zeigen“ gehört nur der Seite und wird nicht gespeichert), Pause nie. Aushilfen („Nicht im Roster“) stehen nur auf der Seite (`outsiders` von `councilRoster()`), nie im Paket. Version 2 trägt keinen Roster-Status; den bringt Version 3 (`status`).

### Council-Daten v3 (#670)

**Seit #676 (Profile je Roster)** kommen die Kategorien aus den Rostern mit Loot-Council: ein Roster mit Kategorie läuft mit deren Lootsystem, also ist „jedes Loot-Council-Roster mit Kategorie“ plus „jede Loot-Council-Kategorie ohne Roster“ genau die Liste der Loot-Council-Kategorien (`councilEntries()` in `apiRoutes/ingest.js`). `id` bleibt die Kategorie-ID, Gewichte, Item-Gewichte und Filter kommen aus dem **Profil des Rosters** (sonst dem der Kategorie, sonst „Standard“). ⚠️ **Ein Roster ohne Kategorie wird nicht ausgeliefert:** das Addon wählt einen Council über die Instanzen der Raidvorlage, und ein Roster hat keine eigene Raidvorlage. Version 3 trägt je Kategorie zusätzlich `roster` (`{ id, name }` oder `null`) und `profile` (`{ id, name }`) — nur zur Information, das Format bleibt v3. Version 1 und 2 rechnen ebenfalls mit dem Profil des Rosters der Kategorie.

`GET /api/ingest/council?v=3` (oder höher) **ohne** `category` liefert **Version 3** — die Sync-Tools ab 1.14.0 fragen sie an und fallen auf `v=2`, dann auf Version 1 zurück. Dieselben Kategorien und Ansichten wie Version 2 (`councilEntries()` in `apiRoutes/ingest.js`, `buildCouncilView()`), gebaut von `councilSyncPayloadV3()` in `web/loot/councilSync.js`. Mit `category` bleibt es Version 1; `?v=2` und Version 1 sind unverändert (weiter ohne die neuen Rollen, `LEGACY_ROLES`).

Neu gegenüber Version 2:

- **Alle fünf Rollen.** Kein `LEGACY_ROLES`-Filter: `raiders[]` sind genau die `rows` von `councilRoster()`, `role` ist `caster`|`healer`|`tank`|`melee`|`ranged`, `filter.role` eine davon oder `""`.
- **Je Raider:** `status` (`core`/`trial`/`bench` in einer Kategorie mit Roster, sonst `""`), `lootPoints` (#668), `parts.tenure` (0..100, wie die anderen Teile), `droughtDays` (die effektive Wartezeit mit Teil-Rückstellung, eine Nachkommastelle — genau die Zahl, mit der der Server gerechnet hat), `droughtBase` (der Zähler von `droughtDays()` direkt nach der neuesten zählenden Vergabe, ungerundet bis 6 Stellen, `30` ohne Vergabe — `droughtCounter()` in `lootCouncil.js`), `joinedAt` („dabei seit“, Unix-Sekunden, `0` = unbekannt), `tenureDays`, `bisWeapons` (die Waffen auf der BiS-Liste des Raiders: für ihn ist so ein Drop `bisWeapon`), und je Item `weight`/`weightClass`.
- **Je Kategorie ihre eigene Gewichtung** (seit #676 die des Profils ihres Rosters, sonst die der Kategorie, sonst „Standard“ — `built.weights`; `scope` ist `profile` oder für „Standard“ `global`): `weights` = die vier Teile in % (gerundet, für Balken und Legende), `shares` = dieselben als exakte Anteile von 1 (damit rechnet `needScore()`; gerundete Prozente würden das Spiel von der Seite wegdriften lassen, z. B. bei 35/30/15/25), `droughtDays` (Deckel der Wartezeit, 30), `tenureDays` (Sättigung der Zugehörigkeit), `scope`. `itemWeights` = `{ classes: { trinket, bisWeapon, weapon, set, normal, frequent }, overrides: { "<itemId>": weight } }`. `itemClasses` = `{ "<itemId>": class }` für jeden Drop der Instanzen der Raidvorlage der Kategorie (`tbcRaidLoot.json`; ohne Vorlage oder ohne bekannte Instanz jeder Raid der Tabelle), Klasse aus `itemWeights.js` `itemClass()` **ohne** Ausnahmen und ohne den raider-abhängigen Teil — eine Waffe steht als `weapon` da. `normal` fehlt (ein unbekanntes Item ist im Addon ohnehin `normal`). Dazu `avgLootPoints`.
- **Top-level `weights`** = die `weights` der ersten Kategorie (sonst die des Servers), nur der Bequemlichkeit halber.

**Wie das Addon eine Vergabe nach dem Sync gewichtet** (spiegelt `itemWeights.js` und `droughtDays()`): Klasse = `overrides[id]` > `bisWeapon`, wenn `itemClasses[id] == "weapon"` und die Id in `bisWeapons` des Empfängers steht (die Reihenfolge von `itemClass()` — `frequent` und `trinket` vor `weapon` — macht das exakt) > `itemClasses[id]` > `normal`. Wartezeit: `D = lastAwardAt > 0 ? min(30, droughtBase + (t − lastAwardAt) / 1 Tag) : 30`, dann `D × max(0, 1 − w)`; nach der neuesten Vergabe `min(30, D + ganze Tage seit ihr)`, auf eine Stelle gerundet. Punkte `+ w`, Anteil gegen den Schnitt der Punkte aller Raider der Kategorie, Zugehörigkeit `min(1, ganze Tage seit joinedAt / tenureDays)`, Bedarf `Σ shares × Teil`. Die Neuberechnung im Addon gegen den Server prüft ein Fixture aus dem echten `councilRoster()` (eventhelper-addon, `addon-test/fixtures/council-v3-server.json`, Generator daneben).

Form (innerhalb von `{ "data": … }`, gekürzt — ein Raider, drei Item-Klassen):

```json
{
  "format": "eventhelper-council",
  "version": 3,
  "generatedAt": 1791397800,
  "weights": { "drought": 33, "share": 29, "need": 14, "tenure": 24,
               "shares": { "drought": 0.3333333333333333, "share": 0.2857142857142857, "need": 0.14285714285714285, "tenure": 0.23809523809523808 },
               "droughtDays": 30, "tenureDays": 60, "scope": "category" },
  "categories": [
    {
      "id": "c1", "name": "SSC/TK Mittwoch", "lootSystem": "lootcouncil",
      "filter": { "role": "", "tiers": [], "contents": [], "bisTier": "t5", "bisTierDerived": true, "version": "tbc" },
      "instances": [{ "id": "ssc", "name": "Höhle des Schlangenschreins", "short": "SSC", "zoneNames": [] }],
      "avgLootCount": 1.5, "avgLootPoints": 2.3,
      "weights": { "drought": 33, "share": 29, "need": 14, "tenure": 24, "shares": { "drought": 0.3333333333333333, "share": 0.2857142857142857, "need": 0.14285714285714285, "tenure": 0.23809523809523808 }, "droughtDays": 30, "tenureDays": 60, "scope": "category" },
      "itemWeights": { "classes": { "trinket": 3, "bisWeapon": 2, "weapon": 1.5, "set": 1, "normal": 1, "frequent": 0.5 }, "overrides": { "30099": 2.5 } },
      "itemClasses": { "30626": "trinket", "30082": "weapon", "30245": "set", "30021": "frequent" },
      "raiders": [
        {
          "key": "messer", "character": "Messer", "classFile": "ROGUE", "specLabel": "Kampf-Schurke", "role": "melee",
          "need": 44, "parts": { "drought": 34, "share": 36, "need": 100, "tenure": 33 },
          "lootCount": 2, "lootTotal": 2, "otherCount": 0, "lastAwardAt": 1791239400, "daysSinceLoot": 1,
          "bis": { "tier": "t5", "source": "wowsims", "owned": 0, "total": 17, "missing": [30101, 30082, 29949] },
          "items": [{ "itemId": 30022, "itemName": "Pendant of the Perilous", "awardedAt": 1791239400, "boss": "Trash", "reason": "Mainspec", "event": "SSC/TK Mittwoch", "weight": 0.5, "weightClass": "frequent" }],
          "status": "trial", "lootPoints": 1.5, "droughtDays": 10.1, "droughtBase": 9.083333,
          "joinedAt": 1789669800, "tenureDays": 20, "bisWeapons": [30082, 32027, 29949]
        }
      ]
    }
  ]
}
```

## Gildenbank-Scans (`/api/ingest/guildbank`)

The same addon scans the guild bank when someone opens it (eventhelper-addon#16), and the sync tool uploads each new scan once (#631, epic #635). Stored in `src/stores/guildBankStockStore.js` (`data/settings/guild-bank-stock.json`, see docs/data-storage.md); the stock page (#632), requests against the stock (#633) and the handout list (#634) build on it.

- **Wire format** `eventhelper-guildbank` v1 (`GB_FORMAT`/`GB_VERSION` in `src/utils/guildbank/guildBankScan.js`, `parseGuildBankScan()`): `{ format, version, generatedAt, client: { project: "tbc"|"forever"|"classic", build }, guild: { name, realm, faction }, scannedBy, scannedAt, money, tabs: [{ index, name, items: [{ itemId, count, slot }] }] }` — times in unix seconds, money in copper, one item row per stack. The parser sums the stacks per item id (total + count per tab), drops junk rows, ignores unknown fields and refuses a higher `version`. `client.project` maps onto the game-version ids (`versionOfClient()`: our ids, WoW's project names/numbers, else the build); a client that names none falls back to the main version.
- **Same bearer-token auth** as the loot upload (`ingestGuildBank` in `apiRoutes/ingest.js`); 401 `no_token`/`bad_token`, 400 `parse_failed` with the German reason, else 201 `{ status: "created"|"updated"|"stale", bankKey, gameVersion, guild, realm, pending, scannedAt, tabs, items, newItems }`. `"stale"` = a scan older than the stored one (a second PC uploading late) — answered with success so the tool does not retry, nothing changed.
- **Key of a bank:** game version + realm + guild, normalised (`bankKeyOf()`: `"tbc:spineshatter:die gilde"`). The same guild on Forever is a bank of its own.
- **Which Discord server:** a bank seen for the first time goes to the one event server when exactly one is configured (`onlyEventServer()`, #632); with several it is stored with `guildId: ""` — *wartet auf Zuordnung* — and is assigned in the settings (card „Gildenbanken“ under Einstellungen → Verbindungen, `pages/settings/SettingsGuildBanks.tsx`; `GET /api/settings/guild-banks`, `POST /api/settings/guild-banks/assign { key, guildId }` with `""` to take it back, `POST /api/settings/guild-banks/delete { key }`; area `settings`, module `apiRoutes/guildBank.js`, service `services/guildbank/guildBankStock.js`). A known bank keeps its assignment, also one taken back on purpose. Only a configured event server can own a bank. Ingest tokens carry no server today; a token with a `guildId` would assign a new bank at once (`serverOfToken()`).
- **The orga's decisions outlive scans.** A scan replaces only `lastScan`; per item the store keeps `status` (`new` for an id seen for the first time, then `hide`/`show`/`give`), `reserve`, `maxPerRequest` (0 = no limit), `category`, and per tab a hidden flag. An item that left the bank keeps its settings and reads with count 0. Store API for the follow-ups: `getBank(key)`, `listBanks()`, `listForServer(guildId)`, `setItemSettings(key, itemId, patch)`, `setTabHidden(key, index, hidden)`, `assignBank`, `removeBank`.
- **Item names, icons, quality, class** (`services/guildbank/itemMeta.js`): item names are **English** everywhere (page, Discord cards and selects, DMs, the addon's hand-out list); only the group labels stay German. First the local tables (TBC only: WoWSims items, raid loot names — English, final names), applied while storing; the Wowhead answer brings class/subclass (and replaces the name with its English one; a field the answer lacks, icon or quality, keeps the local value — `mergeMeta()` in the store). Every item still without a current Wowhead answer is queued **after** the response for one lookup each (and again whenever the stock page is opened, within the retry pause) (`wowhead.lookupItemDetails()`: the English item XML `www.wowhead.com/<path>/item=<id>&xml` with class/subclass ids, falling back to the tooltip endpoint), one at a time with a pause, on the version's Wowhead path (Forever: Classic's until it has its own). The answer is written into every bank of the version that has the item, so the store is the persistent cache; a failed lookup waits 6 h and is retried by the next scan.
- **German names from before (#636/#637) are migrated by themselves:** the store's meta carries `metaVersion` (`META_VERSION` 2 = English; #636 stored none = German). Older meta is *stale*: `itemsWithoutWowheadMeta()` lists it again, `knownMeta()` never hands it on as the cache, and the local tables may overwrite its name at once. The job `guildBankItemMeta` (`web/http/jobs.js`, `itemMeta.startMetaRefresh()`) sweeps every bank 30 s after the start (`refreshStaleMeta()`: local English names at once, the rest into the throttled lookup queue); a scan and the stock page do the same for their bank. Whenever an item's name changes, the **pending** requests of it (open/confirmed) take the new name (`guildBankStore.renamePendingItem()`), handled ones keep theirs; a posted orga card shows it with its next redraw.
- **Group labels stay German:** `stockView.itemGroup()` maps class/subclass **ids** to German labels (`src/config/itemClassLabels.js`: „Verbrauchbar“/„Fläschchen“/„Elixiere“/„Tränke“, „Edelsteine“ (+ „Rote Edelsteine“ …), „Handwerkswaren“/„Stoff“/„Leder“/„Metall & Stein“/„Kräuter“/„Elementar“, „Rezepte“, „Quest“, „Verschiedenes“ …); Wowhead's English text only for an id the table does not know. Tests mock `lookupItemDetails`.

## Die Seite „Gildenbank“ (#632)

The orga's view of the stock: menu entry *Gildenbank* (group Gilde, area colour `--area-bank`), page `src/web-client/src/pages/guildbank/` (`GuildBankPage.tsx`, the pure rules in `bankView.ts`), styles `styles/guildbank.css` (plus the Loot-Council's filter line and the loot views' item cell). Reading takes area `raids`, every change `raids` write.

- **Routes** (`apiRoutes/guildBank.js`): `GET /api/guildbank[?key=&version=]` → `{ banks: [{ key, gameVersion, versionShort, realm, guild, scannedAt }], bank }` — the active server's banks and the one shown (`key`, else the content switch's version, else the first; `bank: null` = none, the page explains the addon and links the assignment). `POST /api/guildbank/item { key, itemId, status?, reserve?, maxPerRequest?, category? }` → `{ item }`, `POST /api/guildbank/tab { key, index, hidden }` → `{ tabs }`, `GET /api/guildbank/requests?key=` → `{ requests: [{ id, itemId, item, iconUrl, amount, userId, userName, characterName, realm, purpose, status, createdAt, handledByName, handledAt }] }` — the bank's open and confirmed requests from the stock for the header button *Anfragen* (`RequestsDialog.tsx`, read-only; #633). A bank of another server answers 404 like an unknown one. A changed `status` (and a deleted bank) queues the item emojis' sync (`services/guildbank/itemEmojis.js`, background), so does a scan upload of a bank with items on „give“.
- **The item view** (`services/guildbank/stockView.js`, shared with #633): the store's item plus `reserved` (confirmed requests), `handedOut` (handed out after the last scan, `reservations.handedOutSince`), `available = max(0, count - reserved - handedOut - reserve)`, `emojiId` (the item's application emoji, "" = none), `group` (the orga's `category`, else Wowhead's subclass for consumables/trade goods, its class otherwise — German labels by id, `config/itemClassLabels.js`; `autoGroup` = Wowhead's alone) and the hidden tabs taken out: `count`/`tabs` are the visible tabs, `totalCount`/`allTabs` everything, `tabHidden` = the whole stock lies in hidden tabs (not listed, not requestable).
- **Reservations** (`services/guildbank/reservations.js`): `reservedByItem(bankKey)` → `{ [itemId]: amount }` sums the requests in `guildBankStore.js` with that `bankKey`, an `itemId` and `status: "confirmed"`; `reservedRequestCount(bankKey)` counts them (the head's „N Anfragen vorgemerkt“). The store knows the fields and the statuses `confirmed`/`handedOut` since #632; #633 writes them (the request form, confirm/release/hand-out on the orga card — docs/signups.md, „Gildenbank“), #634 moves a request on to `handedOut` from the addon (`services/signups/guildBank.handOutRequest(id, { via })`, see the next section).

## Ausgabeliste für das Addon (`/api/ingest/guildbank/handouts`, #634)

The confirmed requests go into the game; what is ticked off there (eventhelper-addon#17) or mailed (eventhelper-addon#18) comes back. Service `src/services/guildbank/handouts.js`, handlers `ingestHandoutList`/`ingestHandoutReport` in `apiRoutes/ingest.js`, same bearer token as the scan upload (401 `no_token`/`bad_token`). Format **`eventhelper-guildbank-handouts` version 1**, shared with the eventhelper-addon repo: when a field changes, the version grows on **both** sides (like `eventhelper-council`). All times are unix **seconds**, strings plain UTF-8 (the addon makes them fit the game font). Like every `/api` route the answer is wrapped as `{ "data": … }`; the shapes below are what is inside.

- **`GET /api/ingest/guildbank/handouts[?bank=<key>]`** → 200:
  ```json
  { "format": "eventhelper-guildbank-handouts", "version": 1, "generatedAt": 1791100000,
    "banks": [{ "key": "tbc:spineshatter:die gilde", "gameVersion": "tbc", "realm": "Spineshatter", "guild": "Die Gilde",
                "faction": "Alliance", "scannedAt": 1791000000,
                "handouts": [{ "id": "mg5k2q9a1b", "itemId": 32193, "name": "Bold Living Ruby",
                               "icon": "inv_jewelcrafting_livingruby_03", "quality": 3, "amount": 2, "purpose": "Gruul",
                               "character": { "name": "Zibbo", "realm": "Spineshatter", "faction": "Alliance", "classFile": "PRIEST" },
                               "requestedBy": "Anna", "requestedAt": 1791049999, "confirmedBy": "Arthas", "confirmedAt": 1791050000,
                               "inBank": 14,
                               "tabs": [{ "index": 1, "name": "Edelsteine", "count": 10 }, { "index": 2, "name": "Verbrauch", "count": 4 }] }] }] }
  ```
  - **Which banks:** every bank assigned to a Discord server (one waiting for its assignment is left out). Ingest tokens carry no server today, so one token sees all of them; a token with a `guildId` would see only its server's (`guildBankStock.serverOfToken`). `?bank=` narrows to one bank key. A bank without confirmed requests is listed with `handouts: []` — the addon clears its list from it.
  - **Which requests:** status `confirmed`, from the stock (`itemId > 0`), of that bank; the oldest confirmation first. Open, handed-out, declined and free-text requests never appear.
  - `name`/`icon`/`quality` come from the bank's item (Wowhead's English name; the icon *name*, no path), else from the request (`item`, `icon`); `quality` is `-1` when unknown, `icon` may be `""`.
  - `character` is the recipient (the one picked in the request form, else the raider's first character of the bank's version): `realm` falls back to the bank's, `faction` is the bank's (the profile knows no faction), `classFile` the game's class token (`PRIEST`, `DEATHKNIGHT`; `""` when the profile does not know the character). **`null`** when the raider has no character of that version — the addon shows `requestedBy` (the raider's Discord display name) and cannot prepare a mail.
  - `inBank` = the item in the bank's **visible** tabs by the last scan (`scannedAt`), minus what was handed out since; `tabs` = the visible tabs holding it (`index`, the scan's tab `name`, `count`). Both are the scan's state, not live — at the bank the addon counts live itself.
- **`POST /api/ingest/guildbank/handouts`** with `{ "done": ["<id>", { "id": "<id>", "via": "mail", "by": "Jaina", "at": 1791070000 }] }` — plain ids and objects may be mixed. `via`: `"manual"` (ticked off, the default) | `"mail"` (sent from the mailbox); `by`: the officer's character name (optional, cut at 60 chars); `at`: when it happened (optional, unix s). → 200:
  ```json
  { "format": "eventhelper-guildbank-handouts", "version": 1,
    "ok": ["mg5k2q9a1b"], "duplicate": [], "notConfirmed": [], "unknown": ["nope"], "invalid": 0 }
  ```
  Every distinct id lands in exactly one list: `ok` = handed out now; `duplicate` = handed out before (a second report, or the orga's button in Discord), nothing changes; `notConfirmed` = no longer confirmed (the orga released the reservation between GET and POST, or it was declined), nothing changes; `unknown` = no such request, a free-text one, or another server's (server-bound token). `invalid` counts entries that were no id at all. The addon can forget every id that came back in any list; only a failed call (network, 5xx) is worth sending again — repeating is harmless.
  - 400 `parse_failed` when `done` is missing or no list, or has more than **200** entries (`MAX_DONE`). An id repeated within one report counts once (the first entry wins).
  - **What `ok` does** (`services/signups/guildBank.handOutRequest`): status `handedOut`, `handoutVia` = `via`, `handedOutByName` = `by` (else the token's name), `handedOutBy` = the token's creator (else `"addon"`); the orga card is redrawn („per Post ausgegeben von Jaina“ resp. „ausgegeben von X · im Spiel abgehakt“), the item's other cards too, and the raider gets the DM. The stored stock is not changed: `reservations.handedOutSince` takes the amount off „Verfügbar“ until the next scan. Hence `at`: `handedOutAt` is `at` when it is plausible (not in the future, not before the confirmation), else the time of the report — a hand-out before the next scan is in that scan already and must not be taken off twice.

## Award reason and raid content (the "Loot-Gründe"/"Items" overviews)

Two things a loot export does not state usably are derived on **every read** in `lootStore.js`'s `decorate()`, never stored — so old imports profit from a grown table without a re-import:

- **Why** someone got an item — `src/utils/loot/lootReasons.js` maps the addon's free-text `response` ("BiS", "Off-Spec", "Zweitspec", "Entzaubern", …) onto one of the `REASONS` buckets and adds `reason`/`reasonLabel`/`reasonTone` to the row. The raw `response` is kept untouched next to it. `tone` is the badge colour (`.rbadge-*` in `styles/shared.css`); an unrecognised response becomes `other`, never a guessed mainspec.
- **Where from** — `src/config/tbcContent.js` maps every TBC raid drop to its content (`ssc`, `tk`, `gruul`, …), tier (`t4`/`t5`/`t6`/`t65`) and boss **by item id**, which is the only key a Gargul row has. The `RAID_LOOT` table is generated into `src/config/generated/tbcRaidLoot.json` — run `node scripts/fetch-tbc-loot.js` to refresh it from Wowhead's zone drop tables; don't hand-edit it. The export's own instance string is only the fallback, and an unknown item keeps `contentId: ""` instead of being filed into a wrong raid.

`src/services/loot/lootStats.js` aggregates both into what `GET /api/history/loot-stats` serves (`reasonsByCharacter()` + `itemCatalog()`), rendered by `LootReasonsTab.tsx`/`LootItemsTab.tsx`. A reason badge is labelled with the guild's **own** response wording whenever every item in that bucket carries the same one ("Zweitspec" rather than the internal "Offspec"); the bucket only decides the colour and the filter.

Which loot addon a category uses (`config.categoryLootTool`) is a **setting**: it is edited in Einstellungen → *Kategorien*, on that category's card, and saved with the rest of the config through `PATCH /api/settings`. There is no separate endpoint for it (the old `/api/history/category-tool` is gone).

**Class colours in the client:** hand them to the DOM via `classColorProps()` (`ClassSpec.tsx`), not as `style={{ color }}` — it sets the `--cc` custom property so `.class-colored` can darken WoW's game palette for the light theme (Priest white and Rogue yellow are invisible on white otherwise).
