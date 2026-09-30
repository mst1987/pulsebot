# Kaderbau-Export (roster builder export)

A raid lead runs a **local Kaderbau app** (roster builder for WoW Forever) on their own PC. It pulls a read-only
snapshot of the online EventHelper through one endpoint, authenticated by a bearer token of its own. Nothing is
stored for the export; everything is derived on read.

- Route module: `src/web/apiRoutes/kader.js` (export + token management)
- Builder: `src/web/kader/kaderExport.js` (`buildKaderExport`, `exportVersion`)
- Tokens: `src/stores/kaderTokenStore.js` on the shared `src/stores/bearerTokenStore.js`
- Admin UI: Einstellungen → Verbindungen → card *Kaderbau* (`pages/settings/SettingsKaderbau.tsx`, the token dialog
  `pages/settings/SettingsTokensModal.tsx` is shared with the loot-sync tokens)
- Tests: `test/web/apiRoutes/kader.test.js`, `test/web/kader/kaderExport.test.js`, `test/stores/kaderTokenStore.test.js`

## Endpoint

`GET /api/kader/export?version=<versionId>` with the header `Authorization: Bearer ehk_<secret>`.

- `version` is optional. Without it: `forever` when that rule set exists, else the main version
  (`services/events/mainVersion.js`). An unknown version answers **400** `unknown_version`. The content switch's
  "hide other versions" does not apply — the caller names the version explicitly.
- **401** `no_token` without a bearer value, **401** `bad_token` for an unknown, revoked or foreign token
  (a loot-sync `ehl_` token is foreign). No session is needed or looked at: the path is in `apiAccess.js`'s
  `TOKEN_AUTH` (`auth: "token"`), the handler checks the token before any work.
- The local app calls **server-to-server** (its own Node process), so there is deliberately **no CORS**.
- Discord unavailable (bot offline, GuildMembers intent missing, no event server configured) is never a 500:
  `members: []` plus a `warnings` entry. Attendance that cannot be read is also a warning, not an error.

### Response envelope

Like every `/api/*` route (`src/web/http/apiResponse.js`): success is `{ "data": <export> }` with status 200, an
error is `{ "error": { "code": "…", "message": "…" } }` with its status. The export inside `data`:

```json
{
  "format": "eventhelper-kader", "v": 1,
  "generatedAt": "2026-12-20T12:00:00.000Z", "guildId": "…", "versionId": "forever",
  "classes": [ { "key": "Warrior", "name": "Krieger", "nameEn": "Warrior", "color": "#C79C6E", "icon": "classicon_warrior",
                 "specs": [ { "key": "Warrior-Protection", "name": "Schutz", "nameEn": "Protection", "role": "tank",
                              "canTank": true, "canHeal": false, "icon": "…" } ] } ],
  "instances": [ { "id": "forever-hyjal", "name": "Hyjal Summit (Forever)", "short": "Hyjal F", "sizes": [20],
                   "defaultSize": 20, "status": "incomplete" } ],
  "members": [ { "userId": "…", "displayName": "…", "avatarUrl": "https://cdn.discordapp.com/…|null" } ],
  "profiles": [ { "userId": "…", "availability": ["mi", "do"],
                  "characters": [ { "key": "forever~aldric sturmwind", "name": "Aldric Sturmwind", "className": "Warrior",
                                    "realm": "", "specs": [ { "spec": "Warrior-Protection", "gear": "usable" } ],
                                    "main": true, "canTank": true, "canHeal": false, "logSpecs": ["Warrior-Protection"] } ] } ],
  "attendance": [ { "userId": "…", "attended": 11, "counted": 12, "rate": 0.92,
                    "nights": [ { "date": "2026-12-17", "eventId": "…", "title": "…", "attended": false, "reason": "abgemeldet" } ] } ],
  "warnings": [ "Mitgliederliste nicht verfügbar (GuildMembers-Intent aktiv? Bot verbunden?): …" ]
}
```

`format`/`v` version the contract: fields may be **added**, never renamed or removed, without bumping `v`.

## Vocabularies

| Field | Values | Source |
|---|---|---|
| `classes[].key`, `characters[].className` | `Warrior`, `Paladin`, `Hunter`, `Rogue`, `Priest`, `Shaman`, `Mage`, `Warlock`, `Druid` | class ids of `src/config/gameVersions/classes.js` (Forever reuses Classic's) |
| `specs[].key`, `characters[].specs[].spec`, `logSpecs[]` | `"<Class>-<Spec>"` in Warcraft Logs spelling, e.g. `Warrior-Protection`, `Druid-Guardian` (bear), `Druid-Feral` (cat), `Hunter-BeastMastery` | `buildClasses()` in the same file |
| `specs[].role` | `tank`, `healer`, `melee`, `ranged` | the rule set's `role` per spec (hunters are `ranged`) |
| `characters[].specs[].gear` | `none`, `usable`, `ready` | `GEAR_LEVELS` of `src/stores/raiderProfileStore.js` |
| `profiles[].availability` | `mo`, `di`, `mi`, `do`, `fr`, `sa`, `so` (German weekday abbreviations, Monday first) | `WEEKDAYS` of the profile store |
| `instances[].status` | `incomplete` (announced, bosses unknown — all Forever raids today) or `complete` | rule set |
| `nights[].reason` | `null` when attended; else `abgemeldet`, `Ersatzbank`, `vorläufig`, `nicht im Log`, `keine Anmeldung` | `services/characters/rosterAttendance.js` |

## How it is filled

- **classes / instances**: the requested version's rule set (`src/config/gameVersions/`).
- **members**: every human (non-bot) member of the **first configured event server** (`guildRoles.eventGuildId()`,
  see [discord-servers.md](discord-servers.md)) through `discord.listHumanMembers()` — the same 60-s cached full
  member fetch as `listMembersWithRoles()`, so it needs the privileged GuildMembers intent.
- **profiles**: `raiderProfileStore.listProfiles()`, only the characters of the requested version
  (`charactersOfVersion`); a raider without such a character is left out. `canTank`/`canHeal` are the effective
  per-character values of `characterRoles()` (own switch → old profile-wide switch → what the specs allow, never for
  a class that cannot). `main`: the account's stored main when it plays this version, else its first character of
  the version. `logSpecs`: the spec the logs resolved for that name (`web/characters/profileLogs.js` `logIndex()`,
  matched on the name part of the key and the class) — a hint, empty when nothing is known.
- **attendance**: one entry per exported profile. `buildAttendanceContext(guildId, { versionId })` counts only the
  version's past raid nights; `attendanceForAccounts(…, { nights: true })` runs per raid category (a night counts
  when any of the account's characters of the version stands in the log, else the signup decides) and the
  categories are summed up. Each category contributes its last `RAID_WINDOW` (11) nights with evidence, so the list
  stays bounded. `rate` is `attended / counted` rounded to two places, `null` while nothing is counted — the normal
  state for Forever until its raids open (Dec 2026). `date` is the night's day in server time (Europe/Berlin).

## Token

- **Own capability**: prefix `ehk_`, file `data/settings/kader-tokens.json` (see [data-storage.md](data-storage.md)).
  The store is a sibling of the loot-sync store, both built by `createBearerTokenStore()`: separate file and
  prefix mean a Kaderbau token cannot upload loot and a loot token cannot read the export — neither store even
  knows the other's tokens (`test/stores/kaderTokenStore.test.js`).
- Security model as the loot-sync tokens: sha256-hashed at rest, the secret shown exactly once, constant-time
  comparison (`crypto.timingSafeEqual`), revoke is immediate, `lastUsedAt`/`uses` counted per successful export.
- **Management**: `GET /api/kader/tokens`, `POST /api/kader/tokens` (`{ name }` → `{ token, record }`, 201),
  `POST /api/kader/tokens/delete` (`{ id }`) — area `settings`, **full admins only** plus CSRF, like the
  loot-sync tokens.

## Privacy

A profile leaves the builder as a whitelist: `userId`, `availability` and per character `key`, `name`,
`className`, `realm`, `specs` (spec + gear), `main`, `canTank`, `canHeal`, `logSpecs`. **Never** exported:
`avoid`/`avoidEnabled` ("nicht mit X raiden"), `wishes`, `note`, `preferredRaids`, the profile `name`, calendar
tokens, or who else claims a character. Both test suites serialise the whole payload and assert none of these
appear. A new field is added to the whitelist deliberately, never by spreading a stored record.
