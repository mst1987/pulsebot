# Kaderplaner (raid roster planner for WoW Forever)

Endnutzer-Sicht: siehe [guide-web-admin.md#kaderplaner](guide-web-admin.md#kaderplaner).

The raid lead plans **raid rosters** in the web admin: a pool of Discord accounts, rosters with a name and a size
(target numbers per role, bench), and per roster group setups in variants. What the bot already knows (rule set,
server members, raider profiles, attendance) is read live; what the planner decides is stored in its own file and
**never written back** to a raider profile.

| Where | What |
|---|---|
| `src/web/apiRoutes/kader.js` | the routes (`GET /api/kader` + the write routes below), area `kader` |
| `src/web/kader/kaderSource.js` | what the planner reads from the bot: classes/specs (with their WoW icons)/buffs of the version, the server's human members, whitelisted profiles, attendance |
| `src/web/kader/kaderView.js` | the pure merge: source + planner → players (`buildKaderView`), the helpers the mutators need (`mutationContext`) |
| `src/services/kader/kaderModel.js` | the planner's shape and every rule for changing it — pure mutators that throw `AppError` (400/404/409) |
| `src/services/kader/kaderAutoAssign.js` | "Automatisch verteilen": the group heuristic |
| `src/stores/kaderStore.js` | `data/settings/kader.json`, one planner per Discord server |
| `src/web-client/src/pages/kader/` | the page (`KaderPage.tsx`) with its three views and dialogs |
| `src/web-client/src/lib/kader/` | client logic: board counts, filters/grouping (`players.ts`), setup moves and hints, the Discord text |
| `src/web-client/src/styles/kader.css` | the module stylesheet, prefix `kp-` |

## Access

Area **`kader`** ("Kaderplaner", `src/config/permissions.js`). It is in **no** base access by default — full admins
have it, everyone else only through Einstellungen → *Berechtigungen*: a role grant or, meant for this area, a
single-account grant under "Einzelne Konten" (`config.userPermissions`, see [permissions.md](permissions.md)).
`read` opens the pages (everything visible, nothing movable: no drag, no "+", no dialogs' save), `write` edits. Every
route carries `area: "kader"`; writes use `withUser({ write: "kader", csrf: true, body: true })`.
`test/web/apiRoutes/kader.test.js` holds 401/403 for an outsider, read-vs-write for a single-account grant and the
CSRF refusal; `test/config/permissions.test.js` that the default base access does not open it.

## The version and the server

- Version: `forever` when that rule set exists, else the main version (`kaderSource.plannerVersion()`). The content
  switch does not apply — the planner is built for Forever.
- Server: the **active guild** of the session (`activeGuildFor(req)`): its members are the pool candidates, its
  events count for attendance, and the planner is stored under its id.
- Discord unavailable (bot offline, GuildMembers intent missing) is never an error: `members: []` plus a `warnings`
  entry (shown as a banner). Attendance that cannot be read is a warning as well.

## View model (`GET /api/kader`)

`{ versionId, guildId, roles, classes, buffs: { raid, party }, players, members, rosters, setups, warnings }`

- **classes**: `{ key: "Warrior", name, nameEn, color, icon, canTank, canHeal, specs: [{ key: "Warrior-Protection", name, nameEn, role, canTank, canHeal, icon }] }`.
- **buffs**: `raid` = five raid buffs for the board's side panel (`fortitude`, `intellect`, `motw`, `kings`, `might`),
  `party` = the rule set's party buffs with `providers`/`beneficiaries` (spec keys) and `important` (`windfury`,
  `battleShout`, `manaSpring` are flagged as missing in a setup group when ≥ 2 members would want them).
- **players**: everyone with a profile character of the version plus the accounts added by hand, each
  `{ userId, displayName, hasProfile, manual, hasOverride, characters, activeCharacterId, differs, profile, availability, attendance }`.
  A character carries `origin: "profile" | "planner"`, its `mainSpec`, `role`, `gear` and `differs`.
- **members**: the server's human members, `{ userId, displayName, inPool, hasProfile, profile: { className, mainSpec } | null, pct }`
  (the "add account" search).
- **attendance**: `null` while nothing is counted (Forever before its raids open) — the page shows "—", never 0 %.

Vocabulary: classes `Warrior…Druid`, specs `Class-Spec` (Warcraft Logs spelling), roles `tank|healer|melee|ranged`,
gear `none|usable|ready`, weekdays `mo…so` (the profile store's), `differs` codes `class`, `mainSpec`, `gear`,
`tank`, `heal`, `notInProfile` (the client translates them).

**Privacy:** a profile leaves `kaderSource.js` as a whitelist — characters (key, name, class, specs with gear, main,
tank/heal, log specs), the raid days and the Discord name it was saved under (`displayName`, shown only when the
account is not on the server). Never `avoid`/`avoidEnabled`, `wishes`, `note`, `preferredRaids`, calendar
tokens or who else claims a character. `test/web/kader/kaderSource.test.js` and the route test serialise the payload
and assert none of it appears.

## The planner's data (`data/settings/kader.json`)

`{ guilds: { [guildId]: { accounts, assignments, rosters, setups } } }` — normalised on every read and write
(`kaderModel.normalizePlanner`):

- `accounts`: `[{ userId, displayName, addedAt }]` added by hand (a server member, or a raw Discord id 17–20 digits
  with a display name). An account with a profile of the version is in the pool anyway.
- `assignments[userId]`: `{ characters: [{ id, name, nameStyle, className, specs: [{ spec, main, gear }], canTank, canHeal, onlineKey? }], activeCharacterId }`
  — at most 8 characters, exactly one main spec each, tank/heal only where the class can. The name follows its
  `nameStyle` (a switch "Forever-Name | Nickname" per character in the account dialog and in "Account hinzufügen"):
  `forever` = "Vorname Nachname" with 2–12 letters per part (`utils/signup/characterNames.js`), `nick` = one free
  nickname of 2–24 letters (umlauts too), digits, spaces, hyphens, apostrophes; both through the profanity filter
  (`config/profanity.js` via `isProfane`). A character stored without a style gets one from its name (two parts =
  `forever`, else `nick`). The name is shown as entered everywhere (board, lists, setup, Discord text) and searched. **The assignment wins inside the planner**;
  the view compares it with the profile character it stems from (`onlineKey`, else the name) and marks the
  difference ("weicht vom Profil ab"). Resetting drops it and the profile shows again.
- `rosters`: `[{ id, name, size, targets: { tank, healer, melee, ranged }, members: [{ userId, role }], bench: [userId] }]`
  — up to 30; a roster has **no instance** (#566): a required name and a size from 5 to 40 (a roster stored with an
  `instanceId` still loads, the field is dropped on the next write); the setup has ceil(size / 5) groups; targets default per size (10: 2/3/2/3, 20: 2/5/7/6,
  25: 3/6/8/8, 40: 4/10/14/12, any other size in proportion); a member is placed with the role of its active character's main spec unless a role is
  given; a smaller size puts the overflow on the bench.
- `setups[rosterId]`: `{ variants: [{ id, name, groups: [[userId|null × 5] × size/5] }] }` — up to 6 variants, the
  last one stays; groups only ever hold roster members, each once (re-sanitised whenever the roster changes).

## Write routes

All answer with the fresh view model (a create adds `rosterId`/`variantId`); parameters in the body.

| Route | Body |
|---|---|
| `POST /api/kader/accounts` | `{ userId, displayName, character?: { firstName, lastName, className } }` |
| `POST /api/kader/accounts/remove` | `{ userId }` — only an account added by hand |
| `PUT /api/kader/assignments` | `{ userId, characters, activeCharacterId }` |
| `POST /api/kader/assignments/reset` | `{ userId }` |
| `POST /api/kader/rosters` · `PUT` · `POST …/delete` | `{ name, size }` · `{ rosterId, name?, size?, targets? }` · `{ rosterId }` |
| `POST /api/kader/rosters/place` | `{ rosterId, userId, to: "role"|"bench"|"free", role? }` |
| `POST /api/kader/variants` · `PUT` · `POST …/delete` · `POST …/auto` | `{ rosterId, name?, copyFrom? }` · `{ rosterId, variantId, name?, groups? }` · `{ rosterId, variantId }` · `{ rosterId, variantId }` |

## The page

- **`/kader` — Kader-Board.** Head: roster picker (+ "Neuer Kader"), edit, the big "14 / 20", *Setup bauen*. Left the
  pool (everyone not in the roster, grouped by role, best attendance first, search), middle the roster by role cards
  with target counts and the bench, right class mix, raid buffs, average attendance. Drag and drop moves players; the
  keyboard/click twins are the "+" in the pool, the empty slot (opens a picker for that role) and the status switch
  in the account dialog (Frei / Im Kader / Ersatzbank).
- **`/kader/spieler` — Spieler finden** (the approved Spieler design): filter menus Status, Rolle, Klasse,
  Anwesenheit, Tage, Gear — every option with the count it would leave (the other filters applied), active filters as
  removable chips, grouping Rolle/Klasse/Anwesenheit/Status/Keine with folding group heads (count, class mix bar,
  "n im Kader", Ø attendance), sort by attendance or name. Filters, grouping, sort and folded groups are remembered
  (`usePersistedState`: `kader-filters`, `kader-group`, `kader-sort`, `kader-collapsed`).
- **`/kader/setup/:rosterId` — Gruppen einteilen.** Variant tabs (+ new, copy, rename, delete), "Noch ohne Gruppe"
  on the left, groups of five on the right with their focus and buff hints. Drag onto a slot, or click a player then
  a slot (the occupant swaps). *Automatisch verteilen* runs the heuristic; *Als Text kopieren* writes the groups,
  who is left and the bench for Discord (falls back to a dialog with the text when the clipboard is refused).
- **Dialogs:** the account (characters of the planner left, "Aus EventHelper · nur lesen" right: attendance nights,
  profile line, log specs, raid days, the difference note), add account (server member or raw id, optional first
  character), roster (name and size — quick picks 10/20/25/40 or any number 5–40; targets when editing; delete behind a confirmation), slot picker.
- **WoW icons** instead of plain text where they help recognition, all from the rule set (`classes[].icon`, `specs[].icon`) and the role icons the raid detail and the raid plan use (`ROLE_ICON` in `lib/raidplan/assign.ts`): the main spec's icon next to every player (pool, slots, list, setup groups), role icons on the role cards, pool groups, the Rolle menu, group heads and the Offtank/Heilen switches, class icons in the Klasse menu, class group heads and the account dialog's class tiles, spec icons on its spec buttons (`KIcon`/`SpecIcon`/`ClassIcon`/`RoleIcon`/`PlayerIcon` in `pages/kader/parts.tsx`, each with its name as label and tooltip).
- The roster picker and the setup head show name and size ("Mittwochs-Kader · 20er").
- The chosen roster is remembered per browser (`kader-roster`). A failed write is a toast; the server's German
  messages are shown as they come.

## Auto distribution (`kaderAutoAssign.js`)

Deterministic, not an optimiser: tanks one per group first, healers spread, shamans (totems) spread, melee prefer
groups with a shaman or warrior, casters groups with a healer or shaman; inside a role the best attendance goes
first. What does not fit stays without a group.
