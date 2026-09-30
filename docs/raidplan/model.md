# Raidplan: data model and basics

Part of the raid plan docs, see [the entry page](../raidplan.md) for the other parts. Endnutzer-Sicht: siehe
[guide-web-admin.md#raidplan](../guide-web-admin.md#raidplan).

## Where it lives

| Piece | File |
|---|---|
| Plan store, validation, room maps | `src/stores/raidplanStore.js` |
| The board of one boss (validation, slot auto-fill), shared by plans and templates | `src/services/raidplan/raidplanBoard.js` |
| Tactic profiles (collection store) | `src/stores/raidplanProfileStore.js` |
| Raid plan templates (collection store) | `src/stores/raidplanTemplateStore.js` |
| What the editor and the public page are shown | `src/web/raidplan/raidplan.js` |
| API | `src/web/apiRoutes/raidplan.js` (its `routes` table carries paths and areas, see docs/web-admin.md) |
| Room-map delivery | `/rp-map/<instance>[/<boss>]` in `server.js` |
| Editor (tab of the raid detail) | `src/web-client/src/pages/raid-detail/RaidplanTab.tsx` and `raidplan/` |
| The working area of a boss, shared by the event editor and the template editor | `raidplan/BoardWorkspace.tsx` (+ `Palette.tsx`, `Inspector.tsx`, `LayerList.tsx`, `MapPanel.tsx`, `ContextMenu.tsx`, `useDraftHistory.ts`) |
| Template admin page (`/raids/plan-templates`) | `src/web-client/src/pages/RaidplanTemplatesPage.tsx` |
| Board, token, slot, zone, player icon (both editors and the read view) | `src/web-client/src/components/raidplan/PlanBoard.tsx`, `MarkIcon.tsx` |
| Read view | `src/web-client/src/pages/PlanPublicPage.tsx`, route `/p/<token>` |
| Pure board logic | `src/web-client/src/lib/raidplan/` (one import, `index.ts`, over the topic files `model`, `players`, `objects`, `geometry`, `labels`, `besetzung` …; the other raid plan libs such as `assign.ts`, `autoPlace.ts`, `steps.ts` sit beside them) |
| Styles (prefix `rp-`) / texts | `styles/raidplan/` (`index.css` imports the parts: `frame`, `editor`, `assign`, `layout`, `canvas`, `tactic`, `objects`) / `i18n/locales/{de,en}/raidBoard.json` |

An **own event** always has a raid plan; its players come from the event's setup. A **Raid-Helper event** has
one once the orga switched it on in its "Verwalten" menu; its players then come from Raid-Helper, read only
("Raid-Helper-Events" below). Until then its tab is hidden and the API answers 409. Both are supported on
equal terms — neither is a stopgap for the other.

## Data model

`data/settings/raidplans.json`: `{ plans: [{ eventId, version, status: "draft" | "published", publicToken,
templateId, bosses, updatedAt, updatedBy, link, known, defaultsMigrated }] }` (`link` and `known` only on a
Raid-Helper event's plan, see "Raid-Helper-Events"; `defaultsMigrated` see "The Standard of an event"),
`bosses[bossKey]` = a **board** (`raidplanBoard.js`, one shape for plans and templates; `bosses.defaults` is the
Standard, a board with only rows):

- `tokens` `[{ userId, x, y }]` — free player tokens (plans only);
- `slots` `[{ id, kind, n, label, x, y, userId, size, hideMembers, split, offsets }]` — placeholders:
  `tank`/`healer` 1..n, `melee`, `ranged`, `dps` ("DPS (egal)": any damage dealer), `group` (a marker for
  setup group `n`, it names that group's players) and `label` (free text). `userId` is who stands in it (`""` =
  open); a template's slots never have one. `hideMembers`, `split` and `offsets` only matter for `group` (see
  "Group markers");
- `icons` `[{ id, iconKey, label, showLabel, x, y, size, rotation }]` (at most 60) — placeable pictures.
  `rotation` is the way a boss / enemy / position icon **faces**, whole degrees 0..359 (0 = up / north,
  clockwise; anything else is normalised, `normAngle`); `showLabel` (default off) decides whether `label` is
  drawn next to the icon. `iconKey` is `boss:<npcId>` (a boss icon of the raid's instance), `enemy`, `bosspos`
  (a generic marker) or `wow:<icon name>` (a WoW icon by its file name, e.g. `spell_fire_fireball`, shown from
  the Wowhead icon CDN like every other spell icon);
- `marks` `[{ id, mark, x, y }]` — the eight raid target marks (`skull cross square moon triangle diamond
  circle star`);
- `zones` `[{ id, shape: rect|ellipse, type: danger|healthy|neutral|custom, label, color, x, y, w, h }]` — x/y
  is the top-left corner; a new zone gets its type's preset colour (`ZONE_COLORS`), any `#rrggbb` is accepted; a role group area also carries `areaStyle` (`calm` | `arc`), `arcSpan` and `arcWidth` (see board.md, "Role group areas: calm or arc");
- `lines` `[{ id, kind: arrow|line, x1, y1, x2, y2, color, width }]` (width 1..12 px) and `texts` `[{ id,
  text, x, y, color, size }]` (size 10..48 px, text up to 60 characters, an empty text is dropped);
- **every object** (token, slot, mark, zone, line, text) also has `opacity` (0.1..1, clamped; zones start at
  0.3, the rest at 1), `lock` (cannot be moved or scaled) and `hidden` (not drawn; the layer list switches it
  back on). **Colour and opacity are separate fields**; the board has its own `mapOpacity` (0.1..1) that dims
  the map. Order = array order within a kind; the kinds are layered zones < lines < marks < slots < texts <
  tokens;
- `assignments` `[{ id, type, assignees, targets, note, suggested }]` — the "Einteilungen", see the section
  below;
- **Sizes:** tokens, slots, marks and icons carry `size` in px (per kind a range, `SIZE_RANGES`), a text its
  `size` (font), a zone its width/height, a line its thickness. The board has `objectScale` (0.5..2) that
  scales all of them at once (CSS variable `--rp-s`); it never changes the stored sizes.
- `targets` — the **old task rows** `[{ id, title, userIds }]`: no longer written (always `[]`); a board that
  still holds some is read as assignments (see "Assignments"), `notes`, `profileId`;
- `counts` `{ tank, healer, melee, ranged } | null` — how many role slots the board's Besetzung has (`null` =
  the raid type's); a slot may carry `placed: false` (in the Besetzung, not on the map; a missing `placed`
  means on the map, so old boards stay as they are).

**Icons on the board:** boss, enemy and position icons are drawn **round** (circular crop, thin border) and
upright; a small wedge on the rim shows the facing (only the wedge turns, never the picture). A spell icon by
name stays square and has no facing. Turning: the round handle above the selected icon (drag around the
centre, Shift = 15° steps), the "Blickrichtung" field (0–359) and eight compass buttons in the inspector, the
eight "Blick nach …" entries of the right-click menu, and Q / E (15°, with Shift 45°). Pure maths
(`normAngle`, `angleTo`, `snapAngle`, `compassName`, `turnIcon`) is in `lib/raidplan/facing.ts`.

**No automatic labels on the board:** only what was typed is drawn (`slotBoardLabel`, `zoneBoardLabel`,
`iconBoardLabel`, `textShown`). No "Tank 1", no zone type, no icon name: an open role slot shows just its role
icon, a filled slot the player's name and spec icon, a zone its pattern and symbol (the type stays readable
without text), a group marker its label — a new one starts with an editable "Gruppe n", cleared it shows a
small group icon. An empty text object is not drawn (only while selected). The layer list, tooltips and screen
readers still use the type name (`slotTitle`, `objectName`), and the inspector shows it as a placeholder.
Editor, templates and the read view use the same `PlanBoard`.

**Role slots (melee / ranged / dps):** a raider's role comes from the spec roles that already exist in
`classes.js` (`resolveRole(placedRole, spec)` in `raidplan.js`): a spec is classified melee or ranged only
when the data says so, otherwise it counts as plain damage dealer and is never put into a melee or ranged slot
by guess. `fillSlots` fills in the order tank, healer, melee, ranged, dps; a `dps` slot ("DPS (egal)") takes
whatever damage dealers remain. Colours: tank blue, healer cyan, melee orange, ranged violet (drawn with a
double ring), dps yellow.

**Group markers:** a group slot shows the tag and, below it, the list of that setup group's raiders. Two
independent switches: `hideMembers` shows the tag only (wins over `split`); `split` draws the raiders as their
own tokens on a ring around the tag, leaving out those who already stand in another slot, and they are not
listed in the "not placed" tray. Each token has an offset relative to the tag in `offsets[userId] = { dx, dy,
size }`, so moving the tag moves them all and a token moved by hand keeps its place relative to the tag. The
read view draws the same.

- **Players are only a `userId`.** Name, class, spec, role and icon are looked up in the event's setup on
  every read (`raidplan.js`'s `rosterFrom`), never copied into the plan — so a changed spec follows on its
  own. `x`/`y` are relative to the board (0..1).
- **Boss key** = `<instanceId>/<slug of the boss name>` (`bt/gurtogg-bloodboil`), from the instances of the
  event (`event.instanceIds` → `config/gameVersions`, `bosses`). Stable across renames of the display label;
  an event without an instance has no bosses (the tab says so).
- **Strict validation on every save** (`raidplanStore.cleanBosses`): coordinates clamped, at most 60 tokens,
  60 slots, 40 marks, 30 zones, 40 lines, 40 texts, 30 rows and 25 players per row per boss, titles 80, labels
  40 and notes 1000 characters, an unknown slot kind or mark is dropped, a zone keeps a minimum size and stays
  on the board, a player takes one slot per board (a second one is left open), a `userId` that is not in the
  event's current lineup is **dropped** (counted in the answer's `dropped`, the editor says so) instead of
  blocking every later save, a boss the event no longer has is dropped, a row id that is unusable is replaced,
  an untouched boss is not stored, a `profileId` that no longer exists is forgotten.
- **Version check:** `PUT` carries the `version` it read; a stale one answers `409 conflict`, the editor keeps
  the unsaved draft and offers "Neu laden". Nothing is written before "Speichern".
- **Who is offered:** the editor (raids) sees the current lineup — the draft when there is one, else the
  approved one. The **read view names only players of the *approved* setup** (a raider never sees a setup
  draft, see docs/setup.md); a token of somebody who is only in the draft is left out there, and the share
  dialog says so.
- **Groups in the plan (#529):** the lineup is the setup's groups plus its explicit bench (`rosterFrom` marks a bench raider
  `bench: true`; a draft's bench goes through `setupCore.benchAndPool`, so the pool "Angemeldet" never comes in). The plan PICKS only
  from the groups it includes: `plan.includedGroups` (group numbers 1..8 and optionally `"bench"`; missing = the groups up to the
  raid's size, `ceil(size / 5)` of the plan's Besetzung - a 25er takes 1..5 -, no bench). One reader on each side:
  `src/services/raidplan/raidplanGroups.js` (`includedGroups`, `planRoster`, `outOfPlanRoster`, `refillSlots`,
  `cleanIncludedGroups`) and its client twin `lib/raidplan/planGroups.ts`. Everything that picks a raider reads through it: the
  Besetzung and its counts, `expandClassRefs` (class references, priorities), the suggestions (roster and the heal row's groups),
  the auto tokens, "Nicht platziert", the group markers, the read view and a template's slot fill. What a save may NAME stays the
  whole lineup (`allowedUserIds`), so a bench raider already in a row is kept and marked "nicht im Plan". Set with `POST
  /api/raidplan/groups { event, includedGroups }` (raids write; cleaned, `null` = back to the default; no version step). Details:
  [editor.md, "Groups in the plan"](editor.md#groups-in-the-plan-no-bench-in-the-assignments-529).

## The Besetzung and the raid type

**What must be known is the size, the tanks and the healers; the DPS is what is left** (size - tanks -
healers, shown as "DPS (gesamt)") and its slots are "DPS 1..n", any damage dealer. **Melee / ranged are
optional**: only with the switch "DPS in Melee / Ranged aufteilen" (create dialog, or the split button of the
bar) do `melee` / `ranged` slots exist (`counts: { tank, healer, dps, melee, ranged }`, melee + ranged at most
the DPS, the rest stays "DPS n"). An older `counts` without `dps` reads as melee + ranged = DPS, so every
existing slot ref (`slot:melee:3` ...) stays valid; the seed template "BT Demo" keeps its 8 melee / 7 ranged
that way. Auto-fill (`fillSlots` on the server when a template is applied, `ensureBesetzung` in the editor):
DPS n from the damage dealers of the setup in setup order, melee / ranged slots only by the spec role, exact
roles first.

**The numbers vary per boss:** (1) +/- change the numbers **for this boss only** (`board.counts`; the bar says
"nur dieser Boss", the arrow goes back to the raid type's numbers); slots above the boss's number are removed,
missing ones added, refs stay stable. (2) **Flex role**: in an event a player's chip has "Rolle für diesen
Boss" (Tank / Heiler / DPS): `board.roles[userId]` (only for this board); the player leaves his slot (it
stays, open) and takes the first open place of the new role; his assignments follow the slot, so they fall
away. Without an intervention the setup role counts (`roleOn`). (3) **The template's numbers are minimums for
an event**: while a boss has no numbers of its own, a lineup with more tanks / healers / DPS than the type
gets the extra slots (`effectiveCounts`), one with fewer leaves slots open (visible as open, no error);
nothing false is filled. (4) The suggestions (`POST /api/raidplan/suggest` takes the board's `roles`) work on
the active Besetzung: in an event only tank and healer slots somebody stands in count, and flex roles are
applied to the roster.

A template is a **raid type** (`src/services/raidplan/raidplanBesetzung.js`): its instances, its size (10, 25 ... or free, 0 =
the instances' default) and the Besetzung derived from them with the rules the events use (`compositionFor`:
Black Temple 25 = 3 tanks, 7 healers; the damage dealers split evenly, the odd one to melee: 8 melee, 7
ranged; groups = size / 5). The create dialog pre-fills the four counts and lets you change them (`size`,
`counts` on the template; `counts: null` = derived; the effective values come back as `besetzung: { size,
counts, groups }`, also on an event's plan view: the template's when the plan came from one, else the event's
own size and composition).

- **The Besetzung is a bar under the board** (`Besetzung.tsx`): per role its icon, the count with +/- and one
  chip per slot (Tank 1..n, Heiler 1..n, Melee, Ranged and the groups). They exist from the start
  (`ensureBesetzung`: missing slots are added, `placed: false`; nothing existing is changed or removed), so an
  assignment never needs the slot dragged onto the map first. +/- changes the board's `counts` (more are
  added, fewer removed from the end). The pin puts a slot on the map (click, or drag onto the board), "Von der
  Map nehmen" and the Delete key take it off again — the slot stays in the Besetzung. The palette's role slots
  place the next free Besetzung slot instead of making a new one.
- **In an event plan** the chips show who stands in them (name and spec icon; open = the role icon dashed);
  new slots are filled from the setup by role, and a click on a chip gives the slot to somebody else or frees
  it. Slot references `slot:<kind>:<n>` stay valid: they point at the same Besetzung slot in the template and
  in the plan.
- **Old templates** ("BT Demo", "Sunwell Montag") without size / counts get them derived from their instances
  when opened, nothing is lost; the slots they already have (on the map) stay, the missing ones of the
  Besetzung are added unplaced.

## Assignments ("Einteilungen")

One model — **and one list per board** — for everything the orga hands out (`src/services/raidplan/raidplanAssign.js`,
client rules in `lib/raidplan/assign.ts`): `{ id, type, title, assignees, targets, note, suggested }`. `title` is the
task in free words ("Fear unterbrechen"), the type gives it its icon. The old task rows are part of this list:
**a row = who** (assignees, from the Besetzung; in an event also players; several at once) **does what** (type +
free text) **to what** (optional target). An old row `{ title, userIds }` is read as type "other", the title
as the task, the players as assignees (`boardOf`, `targetsToAssignments`, and in the read view), nobody is
invented. "Taktik wählen" applies a saved set of task titles: it replaces the board's "other" rows (players
stay on rows whose title stays), typed rows are kept.

- **Types:** `heal`, `dispel`, `cc` (crowd control), `buff`, (healer to tanks / groups / players / marks,
  several healers on one target and one healer on several targets are both fine), `kick` (interrupts; the
  order of the assignees is the rotation 1, 2, 3), `md` (misdirect), `ss` (soulstone), `fearward`, `special`
  (special tank, free), `curse`, `thunderclap`, `demoshout`, `trashtank` (tank to a raid mark) and `other`
  ("Sonstiges"). Each has an icon; a type can name the classes that fit (a filter and suggestion in the
  picker, never a rule).
- **References only, never names:** an assignee is `slot:<kind>:<n>` (a placeholder slot of the board:
  `slot:healer:2`) or `user:<userId>`; a target is `{ kind: "slot", ref: "tank:1" }`, `{ kind: "group", ref:
  "3" }`, `{ kind: "player", ref: <userId> }`, `{ kind: "mark", ref: "skull" }` or `{ kind: "text", ref:
  "Fear" }`. Names, spec icons and class colours come live from the setup. In a **template** a slot reference
  is a placeholder ("Heiler 2" -> "Tank 1"), and `user:` / `player` references are dropped there; in an
  **event plan** a slot reference points at whoever stands in that slot, so applying a template needs no
  rewriting (the ids of the rows are renewed, the references stay). A slot nobody fills shows as an open
  place.
- **Validation** (`cleanAssignments`, on every save): an unknown type becomes `other`; unknown or duplicate
  references are dropped and counted; at most 60 rows per board, 12 assignees and 12 targets per row, notes
  200 and free text 60 characters; a user who is not in the event's lineup is dropped. `preferredRole` (the row
  dialog's "Rolle") is stored only as `melee`, `ranged`, `healer` or `tank`; anything else (and "egal") stores
  nothing, so older rows stay as they are. `classPriority` (#525: the classes in the order they are asked, known classes
  once each) and `count` (1..40, anything else becomes 1) are stored only together, when the list is not empty; a row
  without them stays exactly as it is.
- **Count and class priority** (#525): a row `{ count: 1, classPriority: ["Paladin", "Shaman"] }` wants one raider - the
  first free paladin healer, else a shaman; fixed assignees (`user:`, slots) count towards `count`. `expandClassRefs`
  (server and client twin) appends the resolved places after the row's own assignees; rows of the same kind of task share
  nobody while another candidate is free (then twice rather than open); a place nobody can fill stays an open class place.
  Details: [editor.md, "Count and class priority"](editor.md#count-and-class-priority-per-row-no-healer-twice-525).
- **Where:** every board. Two extra entries join the boss list of an event or template: **Trash** (key
  `<instance>/trash`, after the bosses of each instance: a full board, so trash pulls get slots, marks and
  rows, and it shows the instance's map) and **Allgemein** (key `general`, once at the end: no map board, only
  assignments and a note — curses, Thunder Clap, Demoralizing Shout ... for the whole raid). Trash and
  Allgemein are part of templates and are copied when one is applied. Types offered: boss: heal, kick, md, ss,
  fearward, special, other; trash: trashtank (tank to the n-th raid mark with the real mark icons), heal,
  kick, other; general: curse, thunderclap, demoshout, other.
- **Suggestions** (`POST /api/raidplan/suggest { event?, type, slots }`, area raids write, nothing saved; pure
  `raidplanAssign.suggest`): **heal** = healer 1 to tank 1, healer 2 to tank 2 ..., the remaining healers take
  the raid groups, every group at least one healer and evenly (the healer with the fewest targets first);
  **kick** = rogue, shaman, warrior, mage (at most three); **md** = hunters to the tanks (Misdirection is a
  hunter's in TBC; Tricks of the Trade is WotLK and comes only with the catalog's `versions`); **ss** =
  warlocks to healers; **fearward** = priests to tanks; **curse** = warlocks with Elements / Recklessness /
  Doom; **thunderclap** = warrior tanks first; **demoshout** = the warriors; **trashtank** = tank n to mark n.
  **Nobody fits, nothing is suggested** (an empty answer, "Kein Vorschlag möglich"). Suggested rows are marked
  "Vorschlag" until they are edited by hand; a new suggestion replaces the earlier unedited ones of that type
  and keeps rows made by hand. **Who of a class** (#501): the body may carry `preferredRole` (the row's role)
  and `context` (the board's rows of the other types); the class-based suggestions and every class reference
  go through ONE ranking (`rankCandidates`: role of the row +100 by the spec's role, a spell of the catalog +50,
  a tank on a task not his −40, a healer on damage dealers' utility −20, −3 per row already held; a tie keeps
  the setup order) and leave a tank / healer out only while somebody else is left. Details and the twins:
  [editor.md, "Smarter suggestions"](editor.md#smarter-suggestions-the-rows-role-no-tanks-for-utility-load-501).
- **UI:** under the board there is the Besetzung bar and the "Einteilungen" as cards per type; every row is
  ONE container (see "Round 7" below) that opens the row dialog; kick chips show their order (moved in the
  dialog). Heal assignments are drawn on the map as thin dashed lines in the healer colour (switch
  "Verbindungen zeigen"). The **read view** shows a table per boss ("Wer macht was"), the viewer's own rows
  highlighted (as assignee, as target, or through their group).
- **Dev data:** `scripts/seed-test-raid.js` builds the demo template "BT Demo" and applies it (heal
  assignments for Naj'entus, Supremus, Gurtogg, Illidan and the trash, plus kicks, misdirects, soulstones,
  fear ward, curses ...), see "Test raid".

## The Standard of an event (#524)

"Ich muss bei den Raids auch die generellen Einteilungen für alle Bosse an einer Stelle anpassen können": an event
plan has the same **Standard** as a template (the section `defaults`, editor.md "Round 3", "Standard"). Its rows
(tank -> boss of this section, the heal card with class references on tanks and groups ...) are stored ONCE in
`bosses.defaults.assignments`; every boss and trash inherits them, "Allgemein" does not. A boss deviates with a
copy (`origin` = the Standard row's id, the row in its `inheritOff`) or switches a row off (`inheritOff` only).

- **Effective rows**: `raidplanInherit.effectiveRows(bosses, key, section)` (server) and
  `lib/raidplan/inherit.ts effectiveRows` (client twin, the same cases in `inherit.test.ts`): the Standard's rows in
  its order, resolved for the section (`b:this` -> the section's boss, a mob it lacks dropped), a deviation in the
  place of its default, a hidden row left out; then the section's own rows. An inherited row keeps the Standard's
  id and carries `origin` = that id, so `rowKey` (auto tokens) is the same in every boss. What reads rows goes
  through it: the read view (`publicView`: a boss without a board of its own is listed when it inherits rows),
  "Meine Aufgaben", the boss mark (#503), the auto tokens (#498), the lines (#507), the suggestions' `context`
  (#501) and the Einteilungs-Link (#502, the same read view). Class references stay references and resolve against
  the setup on every read, per section with its Besetzung (as before).
- **Saving**: the route's `bossKeys` are `raidplan.planKeys(event)` (the sections plus `defaults`); the editor view
  lists the Standard first (`raidplan.withStandard`).
- **"Vorlage anwenden"** (`raidplanStore.applyTemplate`): the template's Standard becomes the event's Standard
  (cleaned, under the template's row ids, so `inheritOff`, deviations and moved tanks keep pointing at them); the
  bosses get the template's boards with their `inheritOff` (no copies any more). With a Standard every boss of the
  template's instances is replaced (by the template's board, or by none: it then only inherits); a template without
  a Standard removes the event's.
- **Migration** (one-off, `settingsMigration` -> `raidplanStore.migrateEventDefaults` ->
  `services/raidplan/raidplanDefaultsMigration.js migratePlan`): before #524 the apply wrote the Standard's rows as
  copies (`origin: "default"`) into every boss. Every plan without `defaultsMigrated: true` is switched once:
  copies that read the same in more than half of the sections holding copies (and at least two) - same type,
  task, assignees, targets RELATIVE to the section (`b:<key>` read as `b:this`), note, classes, picks - become one
  Standard row (order: where the copies stood); a section whose copy differs keeps it as its deviation (a copy of
  the same type at the same place), a section without it switches the row off; rows without `origin: "default"`
  stay; the moved tanks (`autoPos` / `autoStyle` keys) move to the Standard row's id. **Every section is checked**:
  its effective rows after must equal its rows before (content and order, ids aside); where not, it keeps its board
  and switches every Standard row off. The sections come from the event's instances (own event, else the plan's
  `link`, plus the instances of the stored keys), so a boss without a board switches the rows off too. Before the
  write the file is copied to `raidplans.json.bak-<yyyymmdd>` (a second one the same day gets a time suffix); the
  log line reads `[settings] Migration: raidplans.json: Standard-Abschnitt (#524) - n Plan/Pläne geprüft, m
  umgestellt, r Standard-Zeile(n) aus c Kopie(n), d Abweichung(en), k Abschnitt(e) unverändert behalten, Sicherung
  …`. Idempotent: every plan carries the mark afterwards (a new plan is born with it, `emptyPlan`), the second start
  writes nothing.
- Tests: `test/services/raidplan/raidplanDefaultsMigration.test.js` (golden master: a plan built the way the old
  apply built it, edited by hand - a changed copy, a deleted copy, an own row in front, a moved tank; effective
  rows of every section identical before / after; idempotent; backup), `raidplanInherit.test.js` (apply, merge,
  twins), `test/stores/settingsMigration.test.js` (log line), `test/web/apiRoutes/raidplan.test.js` (save, read
  view), `src/web-client/src/lib/raidplan/inherit.test.ts` (client twin against the server) and
  `pages/raid-detail/raidplan/EventStandard.test.tsx` (the Standard tab, inherited rows in a boss, swap, deviate,
  hide / restore, auto tokens and lines of inherited rows).

## Permissions

All `/api/raidplan…` paths are area **`raids`** (read = GET, write = everything else), in
the module's `routes` table (fail-closed, see docs/permissions.md) except `/api/raidplan/public`. Mutating calls
are wrapped in `withUser({ write: "raids", csrf: true, body: true })`. Deleting an event deletes its plan
(`eventManage.deleteEvent`).

## Test raid (dev)

The dev auto-login user (the first admin id of `.env.dev`, or `--me <userId>`) is the player "Heilbert" of the
test raid, so the highlighting can be tried on `/p/<token>`. The seed also fills the council board with tank
rows on the four council mobs.

The script runs only when started as a script (`require.main === module`); a `require` (a test, a syntax
check) runs and writes nothing (`test/scripts/seedTestRaid.test.js`). `--auto-demo` (announce before running
it: it rebuilds the template "BT Demo" like every run) seeds the auto placement example: Illidan without any
hand-placed icon or slot (the tank rows put Illidan, both Flames of Azzinoth and the three tanks on the map),
the Council with "Tank 1 → Gathios", "Magier-Tank → Zerevor" and "Tank (Paladin) → Malande", and the paladin
tank playing DPS at the Council, so Malande shows "Paladin fehlt".

`node scripts/seed-test-raid.js` builds a complete test raid through the production code: an own event "BT
Vollraid Test" (Black Temple, 25 places) with **25 real signups** (`signupStore.saveSignup`, user ids 201-225:
3 tanks, 7 healers, 8 melee, 7 ranged, many classes), a proposed and **approved** setup
(`setupEditor.proposeEventSetup` / `approveEventSetup`, five groups), so the Setup tab, the Raidplan tab and a
template with tank/healer/melee/ranged/group slots can be tried at once. `--event <id>` rebuilds an existing
own event instead, `--guild <id>` sets the Discord server of a new one. Idempotent (old signups and setup of
that event are replaced), refuses to run with `NODE_ENV=production`, writes only the local JSON stores, calls
no Discord. Run it in the worktree whose test instance you look at.

**A setup missing parts never crashes the editor:** `setupEditor.withSetupDefaults` (server, in `editorView`)
and `lib/setupEditor.ts`'s `withSetupDefaults` (client, on every answer) give a stored setup without `checks`,
`options`, `warnings` and so on neutral defaults ("not ok"). A hand-written setup without `checks.buffs` once
turned the Setup tab white (`Cannot read properties of undefined (reading 'buffs')`).

## Tests

`test/services/raidplan/raidplanBoard.test.js` (slots, marks, zones, auto-fill), `raidplanTemplateStore.test.js` (templates,
apply, map order), `apiRoutes/raidplan.templates.test.js`, `raidplanStore.test.js`, `raidplanProfileStore.test.js`,
`apiRoutes/raidplan.test.js` (gate, editor payload, save/conflict, publish, upload, profiles, public view), the
routing in `test/web/http/server.test.js`, `readRawBody` in `apiBody.test.js`, and
`test/web-client/raidplan.<thema>.test.js` (board logic run for real in `boards`, `editing`, `slots`, `tokens`,
`roleGroups`; structure of the pages and texts in both languages in `pages`).

## Raid-Helper-Events (feature/raidplan-12)

A Raid-Helper event gets the same raid plan as an own event — boards, templates, auto-fill, the sheet — once
the orga switches it on. It is a **permanent, equal mode**, not a bridge until the move away from Raid-Helper:
nothing here depends on `raidhelperRetirement`, and `categorySignupSource` / `signupSourceDefault` stay
untouched.

**The switch sits at the event, in its "Verwalten" menu.** A Raid-Helper event's menu (raids write) holds only
this entry: "Raidplan aktivieren" opens a dialog, "Raidplan aktiv ✓ – deaktivieren" asks once. Switched off,
the plan **stays saved** (a later switch-on finds it again) but goes back to draft: the public link stops
answering. With Raid-Helper switched off in the settings the entry stays, its line reads "Raid-Helper ist
abgeschaltet – Aufstellung nur aus gespeichertem Stand", and the plan keeps working from what it saved last.

**What the event does not say.** A Raid-Helper event has no instance, size or game version, so the plan record
carries them in `link`: `{ source: "raidhelper", enabled, instanceIds, versionId, size, composition, title,
guildId, startTime, changedAt, changedBy }` (`raidplanStore.setLink` / `normalizeLink`). The activation dialog
pre-fills them from the event title — `src/web/raidplan/raidplanTitle.js` `instancesFromTitle(title, versionId)`: the
softres.it title keywords (`config/softresInstances.js`) **minus the unsafe ones** ("gl", "mag", "aman",
"plateau", "serpent", "tempest", "mh"), matched as whole words; the size from "10er" / "25 man" / "(25)", else
the largest default of the instances; TBC only so far (another version is chosen by hand). The orga corrects
the chips and the size before activating. `raidplanRosterSource.planEventFor()` builds from `link` the event
object `raidplan.js` reads (id, title, startTime, instanceIds, versionId, size, composition, guildId).

**Where the players come from — read only.** `src/web/raidplan/raidplanRosterSource.js` asks Raid-Helper (`getEvent`
for the signups, `getSetup` for the Aufstellung with its `groupNumber`s) at most **once a minute per event**
(`CACHE_MS`; the client gives up after 20 s; "Neu laden" in the plan's head sends `?fresh=1`). **Nothing ever
writes to Raid-Helper.** `src/web/raidplan/raidhelperRoster.js` `raidhelperLineup()` turns the answer into the setup
shape `raidplan.rosterFrom()` already reads:
- from the Aufstellung when there is one — the group is `groupNumber`, else 5 per group by position
  (`hasGroups: false`: the dialog and the head warn "Gruppen sind 5er-Blöcke in Reihenfolge –
  Gruppen-Einteilungen unzuverlässig");
- else from the signups — signed-up raiders in order, blocks of five; **bench** goes to the bench, **absence /
  tentative / late are not placed**; a raider who reacted twice counts with his **first** reaction;
- class and spec **always from Raid-Helper**; a class of a later game version (death knight, …) is **never
  guessed** into a TBC spec ("Frost" of a death knight is no mage): the spec stays empty, the head lists it as
  "unbekannt".

**Names.** A Raid-Helper name is not necessarily a character name (often a Discord nickname).
`characterFor(rh, profile)` looks the raider up by his Discord id in the raider profiles
(`raiderProfileStore`): a) a character of **Raid-Helper's class** — the main when it is one, else the first;
b) else a character named like the Raid-Helper name (case and realm ignored); c) else the Raid-Helper name
itself, marked `nameFromRh` (set in italics, "Name aus Raid-Helper"). The name is display only. Chips, tables
and the sheet show the resolved name; the tooltip adds "Raid-Helper: <name>" (`lib/raidplan/players.ts rhNote`), the
search of the assign dialogs finds both names, and the head counts "n Namen aus Raid-Helper nicht zuordenbar".
"Meine Aufgaben" and the highlight go by the **Discord id**.

**Never at the plan's cost.** When Raid-Helper does not answer, the line-up falls back, most recent first: the
last answer of this process (`origin: "last"`), the snapshot `raidEventScan.js` keeps of a **past** raid
(`"snapshot"`), the line-up the plan remembered at its last save (`known`, `"saved"` — also what a
switched-off Raid-Helper shows), else "Setup gerade nicht verfügbar". Only a fresh, non-empty answer is
`authoritative`; **every other state saves with `raidplanBoard.ANY_PLAYER`** — every well-formed player id is
kept, so an outage, an empty answer or a switched-off Raid-Helper never drops a player. A raider Raid-Helper
**no longer lists** keeps his places and shows dimmed as "nicht mehr im Setup" (`gone: true`, under the name
`known` remembered) until the **next save with a loaded line-up** drops him; the public page does not name
him. `known` = `{ [userId]: { character, spec, rhName, group } }`: the whole loaded line-up at each
authoritative save / template / switch-on, plus the gone raiders the plan still names
(`raidplanStore.knownAfter`, `playersOf`).

**Routes.** `GET /api/raidplan/link?event=<id>` (the switch, the title's suggestion, the instances with their
sizes, and a probe of the line-up: players, `hasGroups`) and `POST /api/raidplan/link` `{ event, enabled,
instanceIds?, size?, versionId?, composition? }` — area `raids` (write for POST); the event must be a
Raid-Helper event of the active server (`loadEventGroups` with the lookback), own events answer 400. `GET
/api/raidplan`, save, apply, publish, suggest and the event's own maps (`e/<id>/…`) accept a Raid-Helper event
with the switch on; `getPlan` / `getPublic` are async now (awaited in `apiRouter.js`). `GET /api/raids/detail`
sends `event.raidplanEnabled` (the tab) and, for a Raid-Helper event, `event.raidhelperDisabled` (the menu
note). The editor view carries `rosterSource` `{ kind, origin, fetchedAt, available, authoritative, stale,
lineupSource, hasGroups, unknown, unmatchedNames, goneCount, disabled, error }` for the head (`RhSource.tsx`,
`rhSourceText`).

**Client.** `RaidDetailPage`: the "Raidplan" tab shows for `ownEvent || raidplanEnabled`; the setup tab stays
an own event's. `ManageMenu` takes `entries` (`raidhelperMenu`) for a Raid-Helper event;
`manage/RaidplanLinkModal.tsx` is the activation dialog ("Aufstellung kommt aus Raid-Helper,
schreibgeschützt"). `RaidplanTab` shows `RhSource` above the editor: "Aufstellung aus Raid-Helper · Stand
19:42", the notes, a reload button, and the stale / unavailable / no-groups warnings.

**Follow-up (not built):** a per-category setting "Raidplan bei Raid-Helper-Events automatisch aktivieren"
(default off). Today every event is switched on by hand.

### Dev-Fixture (local test instances only)

`src/utils/raidhelper/fixture.js`: with `EVENTHELPER_RH_FIXTURE` set and `NODE_ENV` **not** `production`,
`createRaidhelperClient()` hands out a stand-in that knows ONE made-up Raid-Helper event ("BT 25er Fixture",
id `1400000000000000001`, in two days, 25 raiders under nicknames, one death knight; the first raider is the
dev login `ADMIN_USER_ID`, so "Meine Aufgaben" has something). It never opens a connection and refuses every
write. The event is placed in the channel of the first own event of the store (the event list places a
Raid-Helper event by its channel's category). Values: `1` (Aufstellung with group numbers), `nogroups`,
`signups` (no Aufstellung), `gone` (one tank left Raid-Helper — "nicht mehr im Setup"), `down` (every read
fails — the fallbacks). A file `data/rh-fixture-mode.txt` holding one of these values switches the **running**
instance (e.g. to `down` and back — the in-memory fallbacks are what a real outage hits); delete it to go back
to the variable. `EVENTHELPER_RH_FIXTURE_CHANNEL` names the channel when the automatic choice does not fit. In
production the variable does nothing (`fixtureMode()` checks `NODE_ENV` itself; tested in
`test/utils/raidhelper/fixture.test.js`). Example: `EVENTHELPER_RH_FIXTURE=1` in the worktree's `.env.dev`,
restart.

Tests: `test/web/raidplan/raidhelperRoster.test.js`, `test/web/raidplan/raidplanTitle.test.js`,
`test/web/apiRoutes/raidplan.raidhelper.test.js` (switch, cache, fallbacks, gone raiders, names, template, switched-off
Raid-Helper), `test/utils/raidhelper/fixture.test.js`, `src/web-client/src/lib/raidplan/raidplanRaidhelper.test.ts`, plus the
store / board additions.
