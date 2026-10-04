# Raidplan: board and map

Part of the raid plan docs, see [the entry page](../raidplan.md) for the other parts. Endnutzer-Sicht: siehe
[guide-web-admin.md#raidplan](../guide-web-admin.md#raidplan).

## Room maps

There are **no maps in the repo** and nothing is fetched from anywhere; the orga uploads them.

- **Which map a board shows**, most specific first (`raidplanStore.mapForBoss`): this plan's own map
  (`e/<eventId>/<boss>`) > the template's map (`t/<templateId>/<boss>`) > the boss's default map
  (`<instance>/<boss>`) > the instance's default map (`<instance>`) > the grid placeholder. The map dialog
  lists each level that applies; removing an override reads "Auf Standard zurücksetzen". The template's map is
  looked up live (deleting the template deletes its maps).
- Per boss and per instance (the defaults; the fallback of every boss without its own): `POST
  /api/raidplan/map?key=<key>` with the **file as the request body** (`readRawBody`, cut off at 3 MB), `POST
  /api/raidplan/map/delete { key }`. Area `raidplan` write. The key must be a known instance id or boss key,
  optionally scoped with `t/<templateId>/` or `e/<eventId>/`; a scoped key is only written for a template that
  exists or an own event, so no path can be built from it.
- The server recognises PNG, JPG and WebP **by the first bytes** (`sniffImage`), never by the claimed type;
  SVG and everything else is refused. Stored in `data/raidplan-maps/<key with / as __>.<ext>`, one file per
  key (a new upload replaces the old one, whatever its type).
- Delivered at `/rp-map/<key>` without a login (the public page shows them too), `Cache-Control: public,
  max-age=86400`, `X-Content-Type-Options: nosniff`. The url the API hands out carries `?v=<mtime>`, so a new
  upload is never hidden by the cache.
- Without a map the board shows a neutral grid with the boss icon.
- **Big pictures are shrunk in the browser before the upload** (`MapPanel` -> `mapUpload.ts`, numbers in
  `lib/raidplan/mapImage.ts`): a file over 2.8 MB or longer than 2560 px is drawn on a canvas at most 2560 px on the
  long edge and written as WebP (transparency stays; JPEG with the board's dark background when the browser
  cannot write WebP) with a falling quality (0.92 to 0.6), then a smaller picture (85 / 70 / 55 / 40 %) as the
  last resort, until it is under 2.8 MB. A small file is sent untouched. The toast shows before and after
  ("Verkleinert: 6,3 MB -> 2,6 MB, 2560x1600"); if nothing fits there is a readable error. Only PNG, JPG and
  WebP are taken (GIF, SVG, other files are refused). The server's 3 MB limit and its magic-byte check stay as
  the safety net.

## Map upload size (proxy limit)

A map is sent as it is when it is at most 900 KB; a bigger one is shrunk in the browser (WebP, JPEG without
WebP; longest edge 2560, then 2048, 1600 ... with falling quality) until it is under 900 KB - under the 1 MB
default `client_max_body_size` of an nginx reverse proxy, which would otherwise answer with an HTML 413. The
toast says "Verkleinert: 6,3 MB -> 0,8 MB". The server limit (3 MB) stays as a safety net. A raised proxy
limit (`client_max_body_size 4m;` for `/api/raidplan/`) is possible, see `docs/deployment.md`; the shrinking
stays below it. A 413 / 502 / 503 / 504 without JSON is shown as a sentence (`common.errors.*`), never as the
proxy's HTML.

## Map on / off per section and "Allgemein" first

- **`showMap`** (board field, `raidplanBoard.cleanBoard`): `true` unless it is exactly `false`, so every board
  from before the switch keeps its map; a hidden map alone counts as content. The view "Karte" of a boss / trash
  section has it in "Ansicht ▾" ("Karte für diesen Abschnitt zeigen", since Oct 2026; before: an image icon in the tool bar);
  "Allgemein" and "Standard" have no map anyway. Off:
  `BoardWorkspace` renders no board, palette, layers, zoom, minimap, map size or inspector, but a dashed note
  "Dieser Abschnitt wird ohne Karte geplant … bleiben gespeichert" with "Karte anzeigen"; Besetzung,
  assignments and tactic take the full width. The objects (tokens, marks, icons, zones, lines, texts) stay in
  the draft and are back when the map is shown again; slots, facing and the connection lines keep being
  computed. Template apply and duplicate copy the board as a whole, so the flag travels along.
- **Sheet / public API** (`raidplan.publicView`): a section with `showMap: false` sends `showMap: false`,
  `mapUrl: ""` and empty tokens / marks / icons / zones / lines / texts (slots stay, `placed: false`).
  `PlanPublicPage` then shows no stage: "Deine Aufgaben" and the tables stand in the page's flow
  (`.rp-sheet-flat`, at most 1100px wide), like Allgemein.
- **Order**: `raidplanStore.bossesForInstances` puts "Allgemein" first, then the bosses in raid order, then
  the trash; the template view and the event editor put "Standard" first, before "Allgemein" (`raidplan.withStandard`,
  #524; the read view never lists it). The boss chip numbering is
  unchanged (bosses only).
- **Start section** (`lib/raidplan.startSection(sections, wanted, remembered, hidden)`): a deep link
  `?section=<key>` wins, then the section last open in this plan (editor and template editor only,
  `localStorage` `eh.raidplan.section.<eventId>` / `t:<templateId>`, `rememberSection` / `rememberedSection`,
  a blocked storage answers ""), then "Allgemein", then the first shown section. The sheet starts at Allgemein
  (or the deep link).
- The right-click on a section in the strip's list opens a small menu: "Aus dem Sheet ausklammern / Ins Sheet aufnehmen" and
  (boss / trash) "Karte ausblenden / anzeigen" (`SectionStrip` `onMap`; the chips of `BossNav` before Oct 2026). A test that `showMap` travels with
  "Vorlage anwenden" and "Vorlage duplizieren": `test/services/raidplan/raidplanAutoPlace.test.js`.
- Tests: `src/web-client/src/lib/raidplan/raidplanSection.test.ts`, `test/services/raidplan/raidplanBoard.test.js` (flag),
  `test/web/apiRoutes/raidplan.test.js` ("a section without its map", order), `test/stores/raidplanStore.test.js`,
  `test/services/raidplan/raidplanInherit.test.js`.

## Auto placement from the tank rows (feature/raidplan-9)

A tank row puts its mobs and its tanks on the map by itself: nobody has to drag a boss icon, a Flame or a tank
onto the board. Decision: the objects are **derived** from the rows every time (`lib/raidplan/autoPlace.ts`
`deriveAuto`, pure, the same code in the editor, the template editor and the sheet), never stored; only what
the orga changes about them is stored on the board. That keeps them in step with the rows (a row deleted = its
objects gone, a tank swapped = the token shows the new player) and makes a template resolve by itself: the
event keeps references (class / slot / user refs), resolved at render time. The earlier idea of a per-row "Auf
Map setzen" token was dropped for tank rows (one mechanism, no double logic); every other task row got it in #498 on the same
mechanism (see "Auto tokens of every task row").

- **Board fields**: `autoPlace` (default on; off = only what was placed by hand, in the view menu "Automatisch
  aus Tankeinteilung platzieren" and in the inspector of an auto object) and `autoPos { [key]: { x, y } }`
  (where an auto object was moved to, at most 80). Keys: `t:<row>:<n>` = the n-th tank of a row (the row's id;
  a copy of a Standard row keeps the default's id, `rowKeyOf`) and `m:<mob ref>#<n>` = the n-th mob of a kind.
  Validated in `raidplanBoard.cleanBoard` (`cleanAutoPos`, `AUTO_KEY`).
- **Which rows**: types `tank`, `trashtank`, `special` (Tanken, Trash-Tank, Spezial-Tank), own and inherited
  from the Standard, class references resolved like everywhere (`expandClassRefs`: spec role strictly, "Alle
  Specs" only on an explicit class choice, round robin, no fallback).
- **Mobs**: per mob target of a row one icon per instance. The boss (`b:…`) is always one. A catalog mob named
  by several rows without a number gets one instance per row ("Tank 2 → Flame", "Tank 3 → Flame" = two
  Flames); a numbered target (`targets[].n`, 1..20) is that instance. In the row dialog (Ziele → Mobs, block
  "Mehrere dieser Art") the "Anzahl" of a mob (one row, several Flames, one tank each: the n-th tank of the
  row takes the n-th instance) and for a single one its "Nr." ("eigene" = numbered by the rows in order; two
  rows on ONE mob set both to Nr. 1). The chips say "Flame of Azzinoth 2". The number goes along with
  inherited rows (`raidplanInherit.resolveRow`).
- **One place per player (Dublettenregel)**: a tank who already stands on the map (a free token, a role slot
  on the map, the ring of his split group) is used as he is, no second token; the same player in a later row
  uses his first auto token; an open slot named by several rows (a template's "Tank 1") is one place. A
  hand-placed icon of a mob (its `mobId`; an older boss portrait without one plays the boss) plays the lowest
  instances instead of an auto icon (in board order). So an older plan with hand-placed icons and slots looks
  exactly as before (no data changed, nothing doubled).
- **Look**: auto icons like hand-placed ones (portrait, facing wedge, no label). Auto tanks: in an event the
  raider (spec icon, class colour, role ring, name, "DU" highlight); in a template the placeholder (class or
  role icon, dashed ring, no label, the rule in the tooltip: "Magier-Tank → Zerevor · aus Einteilung"); a
  class nobody in the raid has ("Tank (Paladin)" without a paladin tank, also when he plays DPS on this boss)
  a dimmed dashed "Paladin fehlt" with a warning badge at the same place, never another class (it already
  counts as "offene Einteilung"). A raider on an auto token leaves "Nicht platziert" and his group ring
  (`board.autoUsers`, not stored).
- **Layout** (`layoutAuto`, deterministic, on a nominal 1000 x 625 board so every screen agrees): boss in the
  middle (without a boss the mobs start at the top middle), the other mobs of a boss left / right of it in
  rows, trash mobs in rows of six; each tank ~2 icon sizes in front of its mob (away from the boss; below the
  boss and trash), several tanks of one mob side by side, tanks without a mob (a mark, no target) in a row
  below. A taken place moves out on a small spiral (no overlap), everything stays on the board. Moved objects
  (`autoPos`) stay where they are; new objects find free places around them. The order of the rows decides the
  auto places, so a row that changes its target early in the list can move the others; what must not move is
  dragged once.
- **Editing**: auto objects are selectable and draggable (the drag writes `autoPos`, arrow keys too), not
  deletable on their own (Delete says so; they go with the row or with "Automatisch platzieren" off).
  Inspector (`AutoInfo`): "aus Einteilung", what it tanks / who tanks it, "Zeile bearbeiten …" / "Tank wählen
  …", "Position zurücksetzen" when moved, the section switch. The layer list lists them under "aus Einteilung"
  (reset per row). Right-click: an auto tank "Zeile bearbeiten …", "Tankt → <mob>", "Tankt nicht mehr",
  "Position zurücksetzen"; an auto mob or a hand-placed mob icon "Tank wählen …" (its tank row in the dialog,
  or a new one with the mob as target); a player token, a role slot and a group member "Tankt → <mob>" /
  "Tankt nicht mehr" (`tankTo` / `untank`: a row he has alone is retargeted, a shared one gives him a row of
  his own). A row inherited from the Standard becomes the section's own first (a copy that keeps its key, so
  moved tanks stay).
- **Facing**: `autoFacing` - the wedge of a mob (auto or hand-placed) points at the first tank of its instance
  that stands on the map (auto token, slot, free token or the drawn place in a group ring); the n-th Flame at
  the n-th tank. A missing class ("Paladin fehlt") turns nothing: the icon keeps its own facing. An icon the
  rows do not know keeps the older rule (`lib/raidplan/assign.ts facingOf`). In the template the wedge already follows
  the placeholder, so it is identical in the event.
- **Template → event**: "Vorlage anwenden" copies `autoPlace` and `autoPos`; `raidplanBoard.reidBoard` moves
  the keys of the own rows to their new ids; a Standard row keeps its template id in the event's Standard (#524),
  so the keys of its moved tanks (`t:<default id>:n`) stay as they are. "Vorlage duplizieren" does the same. The tanks resolve in the event from
  the setup; a later setup change or "Neu zuweisen" moves the token with them (references, not copies); a hand
  pick of the row (`picks`) stays.
- **Sheet / public API**: `publicView` sends `autoPlace` and `autoPos` (nothing of it without the map, like
  every map object); `PlanPublicPage` derives the same objects from the resolved rows. Heal lines reach an
  auto tank (`autoPlaces` into `board.places`).
- Tests: `src/web-client/src/lib/raidplan/autoPlace.test.ts` (derivation, instances, layout without overlap, overrides, one
  place per player, template placeholder vs. event player vs. missing, facing, the menu helpers, wiring),
  `test/services/raidplan/raidplanAutoPlace.test.js` (validation, mob numbers, reidBoard / apply / duplicate keep positions
  and `showMap`), `test/web/apiRoutes/raidplan.test.js` (public API with and without the map).
- **Look of the auto objects** (`board.autoStyle { [key]: { size, opacity, ring, showName, label, showLabel,
  rotation, autoFace, hidden, lock, z } }`, only what differs from the default, validated by
  `raidplanBoard.cleanAutoStyle`: size in the range of a token (tank) / an icon (mob), opacity 0.1..1, label
  40 chars, facing 0..359, order -999..999; an empty entry is dropped). They work like every object through
  the same lib functions (`lookOf`, `patchLook`, `sizeOf`, `setObjectSize`, `objectPercent` /
  `setObjectPercent`, `scaleObject`, `reorderObject` with kind `"auto"`; `patchAutoStyle`, `resetAutoAll`):
  size 25-400 % (slider + number in the inspector, the scale grip, + / -, the right-click steps 50-200 %),
  opacity, ring, name (tanks), label ("Beschriftung", a mob shows it with "Beschriftung anzeigen", a tank
  above its name), facing of a mob (by itself to its tank, or by hand: rotation grip, Q / E, degrees,
  compass), lock, hide and order (layer list: eye, lock, up / down), "Position zurücksetzen", "Alles
  zurücksetzen" (place + look). `autoScale` (0.4..2, per section) sizes all of them together ("Größe
  Tanks/Mobs" in the view menu and in the inspector); `objectScale` ("Symbolgröße") comes on top,
  multiplicatively. The layout's spacing (tank in front of its mob, the adds beside the boss, trash rows)
  grows with the board's symbol size x `autoScale` and never lets two of them touch with their real sizes.
  Keys move with their rows like `autoPos` (`reidBoard`: apply, duplicate), the sheet gets `autoStyle` /
  `autoScale` (nothing of it without the map) and draws the same.
- **Multi selection**: the editor hands the places of the auto objects to the selection code as the transient
  `board.autoAt` (never saved): Ctrl+A and the rubber band take them, moving / scaling / aligning / opacity /
  lock of a selection include them, "delete" leaves them (they go with their row).
- Tests (look): `src/web-client/src/lib/raidplan/autoStyle.test.ts` (style through the lib functions, ranges, lock, order,
  reset, the plan uses it, spacing grows without overlap, multi selection),
  `test/services/raidplan/raidplanAutoPlace.test.js` (validation of `autoStyle` / `autoScale`, keys move with the rows on
  apply and duplicate), `test/web/apiRoutes/raidplan.test.js` (public API).

## Auto tokens of every task row (#498)

"Ich muss denjenigen, der kickt oder eine besondere Aufgabe hat, auch auf das Feld positionieren können": any row
that is not a tank row (kick, special task, decurse, other ...) can put its named raiders on the map. The same
mechanism as the tanks of a tank row, not a second one: the tokens are **derived** (`deriveAuto`), never stored.

- **The switch** is the row's `onMap` (`true` or missing). Where: the pin in the row's actions ("Auf Map setzen" /
  "Von der Map nehmen", `AssignLine` `onMap`, accent colour when on), the checkbox "Auf Map setzen" in the row
  dialog's foot (`AssignModal`), and on a token itself the right-click "Von der Map nehmen" and the same button in
  its inspector (`AutoInfo`). A row that names only whole role groups (`role:melee`) has no pin (`canPutOnMap`: not a
  tank type and at least one assignee that is not `role:`); a tank row never needs it (`onMapRow` ignores the flag
  there). Lib: `canPutOnMap`, `onMapRow`, `setRowOnMap` in `lib/raidplan/autoPlace.ts`.
- **Tokens**: one per assignee of the row (`user:`, `slot:`, `class:`; `role:` skipped), keyed `t:<row>:<n>` exactly
  like a tank's (`rowKeyOf`: a copy of a Standard row keeps the default's key), so `autoPos` / `autoStyle` /
  `reidBoard` / apply / duplicate / the sheet work unchanged and the server's `AUTO_KEY` needed nothing new. An
  `AutoTank` carries `task: true`, no `mobKey`. In a template a class reference is the placeholder, in an event the
  raider the rule takes or the dimmed "missing" place, like the tanks.
- **One place per player**: the task rows come **after** all tank rows (whatever their order in the list), so a
  raider who tanks and kicks stands at his tank place once; a free token, a role slot on the map, the ring of his
  split group or an earlier task row is used as it is (`existing`), no second token.
- **Out of a group chip**: a raider on such a token has a place of his own (`board.autoUsers`), so a group that is
  not split leaves him out of its name list and a split group closes its ring - the group itself stays. Every auto
  token of a raider (tank or task) carries his group's badge when a marker of his group stands on the map, split
  or not (`players.ts autoBadgeGroup`), the way a member taken out of a split group does.
- **References**: the row's assignee is the reference, so "Neu zuweisen", a setup change or a new pick in the row
  moves the token to the new raider; deleting the row (or taking the pin off) removes its tokens; a position moved
  by hand stays in `autoPos` under its key (a row that comes back under the same key finds it) - as for tank rows.
- **What stays tank-specific**: no mob is derived from a task row, there is no "Tankt →" menu entry on its
  tokens, no facing of a mob follows them, and the tooltip names the task ("Arkanix · Unterbrecher · aus Einteilung")
  instead of "→ mob". A task row's line goes from its token to each of its targets on the map (see "Connection lines
  of the rows" below). The inspector says "Aufgabe: <type>" and "Zeile bearbeiten …".
- **Sheet and "Meine Aufgaben"**: `raidplanAssign.cleanAssignments` stores `onMap: true` only when it is exactly true
  and never on a tank row (older rows and the golden-master fixtures are unchanged); `publicView` passes the row as
  it is, and `PlanPublicPage` derives the same tokens, the viewer's own with the "DU" highlight.
- Tests: "task rows put on the map" in `src/web-client/src/lib/raidplan/autoPlace.test.ts` (tokens, keys, role groups
  skipped, one place per player with a tank row, token, split ring and a second task row, template / event, moved
  positions, the switch), "a task row on the map" in
  `src/web-client/src/pages/raid-detail/raidplan/BoardWorkspace.test.tsx` (pin -> tokens, drag, delete the row,
  pin off, tank + kick = one token, group badge, the menu), "task rows put on the map" in
  `test/services/raidplan/raidplanAutoPlace.test.js` (validation, reidBoard, inherited rows) and the public API in
  `test/web/apiRoutes/raidplan.test.js`.

## Connection lines of the rows (#507)

The thin dashed lines on the board ("Verbindungen zeigen" in the assignment panel, "Verbindungslinien" in the view
menu) connect the assignee of a row with its target: healer → tank / group, tank → the mob he tanks, kicker → mob,
hunter → tank (MD), warlock → soulstone target ... `assignmentLinks(board, me, plan)` in `lib/raidplan/assign.ts`,
drawn by `PlanBoard` into `svg.rp-links`, the same in the editor (`BoardWorkspace`) and in the read view
(`PlanPublicPage`).

- **Every row type** draws, not only heal rows. A line needs **both ends on the map**: an assignee starts where the
  auto placement stands him (`plan` = `deriveAuto`: the tanks of a tank row, the raiders of a task row with "Auf Map
  setzen", `tankPoint` also for one who already stands on a slot / token / in a ring), else at his placed slot, his
  free token or his place in a ring (`board.places`). A slot that only stands in the Besetzung (`placed: false`)
  falls back to its raider's place. Targets: a slot / group / mark / raider as before, a **mob** at the placed icon
  it names (`oid`), its auto icon (`plan.mobs`, by `n`) or the first / n-th placed icon of that mob. A tank goes to
  **his** mob only (the one `deriveAuto` stands him at, `mobKey`), not to every mob of the row. Text targets, a mob
  nobody put on the map and zero-length lines draw nothing.
- **Colour by type**: the line carries `rp-link--<type>` (`linkClass`, `LINE_TYPES`; unknown types are `other`;
  `.rp-line` is taken by the drawn lines and the assignment rows), the class sets `--lc`, and `.rp-links line` strokes
  with it - no inline colour. The variables live in `styles/tokens.css`; the board is a dark picture in both themes
  (like `--rp-role-*`), so one bright set serves light and dark:

  | Type | Variable | Colour |
  |---|---|---|
  | heal | `--rp-line-heal` | green `#22c55e` |
  | tank, trashtank | `--rp-line-tank` | red `#ef4444` |
  | kick | `--rp-line-kick` | orange `#f97316` |
  | md | `--rp-line-md` | yellow `#facc15` |
  | ss | `--rp-line-ss` | purple `#c084fc` |
  | fearward | `--rp-line-fearward` | pale gold `#fde68a` |
  | special | `--rp-line-special` | blue `#60a5fa` |
  | dispel | `--rp-line-dispel` | teal `#2dd4bf` |
  | cc | `--rp-line-cc` | pink `#ec4899` |
  | buff | `--rp-line-buff` | lime `#a3e635` |
  | curse | `--rp-line-curse` | indigo `#818cf8` |
  | thunderclap, demoshout | `--rp-line-aoe` | sky `#38bdf8` |
  | other / unknown | `--rp-line-other` | slate `#cbd5e1` |

  Look: 2 px, dashed 5 / 4, opacity .9 and a 1 px dark halo (`--rp-text-halo`) so they stay visible on a bright map;
  the visitor's own line (`is-yours`) is solid, 4 px and glows in the colour of its type (before: the accent colour).
  The lines have no tooltip and no pointer events (`aria-hidden`), no arrow heads.
- Tests: "lines on the map" in `src/web-client/src/lib/raidplan/assign.test.ts` (types, auto places, tank to his mob,
  mob icons, slot fallback), "the lines of the rows" in `pages/raid-detail/raidplan/BoardWorkspace.test.tsx`
  (rendered heal / tank / kick lines with their class and no stroke of their own) and the CSS guard in
  `test/web-client/conventions/assign.test.js` (every type's class points at a variable of `tokens.css`, nothing
  hides `.rp-links`).

## Facing arrow per icon and role group placeholders (feature/raidplan-10)

- **Arrow size per icon**: every icon that faces (boss, mob, enemy, also an auto mob of the tank rows) has its
  own wedge: `arrowScale` (0.25..3, missing = 1), `arrowHidden` (the facing stays stored), `arrowColor`
  (default amber `#ffb020`), `arrowOpacity`. Stored only when they differ (`raidplanBoard.cleanArrow`, on
  icons and in `autoStyle`), so older boards are unchanged. Drawn in reference units: `.rp-canvas .rp-wedge`
  multiplies its width, height and the air to the icon's edge by `--rp-ar` (PlanBoard `arrowVars`), so editor,
  template and sheet match at any width (measured live: wedge / icon = 0.25 / 0.50 / 1.50 at 50 / 100 / 300
  %). Edited with the inspector's "Pfeilgröße" (slider + number, 25-300 %), "Pfeil ausblenden", colour and
  opacity (`ArrowFields`, also in the auto objects' panel), the right-click "Pfeil größer / kleiner" (x 1.25 /
  0.8), Alt + "+" / "-" (x 1.15), and on several at once (`multiSelect.scaleArrowSelection`, menu "Pfeile
  größer / kleiner"). Lib: `arrowOf`, `patchArrow`, `scaleArrow` in `lib/raidplan/autoStyle.ts`. Apply / duplicate copy
  it (icons and `autoStyle` travel as they are).
- **Defaults of a dropped object (#496)**: a new icon that faces (palette, drop, board menu; not a plain `wow:`
  icon) starts with `arrowScale` 0.6 (`NEW_ARROW_SCALE` in `lib/raidplan/model.ts`: 40 % shorter and thinner
  than the old default 1, stored on the icon, so "Pfeilgröße" and the steps work from there). A new role group
  starts at 0.126 x 0.112 of the board (`NEW_ROLE_GROUP`, 30 % smaller than the old 0.18 x 0.16); its symbol
  follows the area, "Symbolgröße" stays relative. Only new objects change: a saved icon without `arrowScale`
  keeps 1, a saved role group keeps its size, the auto mobs of the tank rows keep their wedge. Tests:
  `src/web-client/src/lib/raidplan/dropDefaults.test.ts`.
- **Role group placeholder** ("Melees", "Ranged", also Heiler / Tanks / DPS): a zone of type `role` with
  `role`, `count` (0..40, a badge; 0 = none), `showNames` (default off) and the shapes ellipse ("Fläche"),
  rect and `cluster` ("Symbole": several role icons, no area). Decision: a zone, so moving, sizing (width and
  height separately, the corner grips, "Zone skalieren"), opacity, colour, lock, layers and the multi
  selection work as for every area. Drawn in its role colour (melee orange, ranged violet …) with a double
  ring and the role's icon; the label only when one was written (no auto label). It names no player, so the
  sheet shows it whether or not the setup knows melees / ranged; in the event it stays a static placeholder
  (no resolution, no "fehlt"). With "Namen anzeigen" the event lists the setup's players of that role (spec
  role) under it. Inserted from the palette ("Rollen-Gruppen", Melees and Ranged first), the tool bar (Melees
  / Ranged buttons) and the board's right-click menu. It does not count as a place of anybody ("Nicht
  platziert", Besetzung and setup are untouched).
- **Role references**: a row (who and at whom) and a tactic step (participants and targets) can name a whole
  role group: `role:melee` / `{ kind: "role", ref: "ranged" }` (`raidplanAssign.ROLE_ASSIGNEE`, `ROLE_REFS`).
  Never split into players, no count, no fallback, never "open"; `expandClassRefs` / `resolveSteps` leave them
  as they are. In the row dialog the category "Rollen" (who and at whom), in the step dialog under "Gruppen"
  and in the targets. Shown as a role chip with its icon (editor rows, sheet tables, preview, steps).
- Tests: `src/web-client/src/lib/raidplan/arrowRoleGroup.test.ts` (arrow functions and clamps, auto mobs, several at once, the
  CSS rule in reference units, inserting / moving / sizing a role group, role references in the dialog and in
  steps), `test/services/raidplan/raidplanRoleArrow.test.js` (validation of the arrow fields and of role groups, role
  references in rows and steps, copies keep them).

## Round 11 (feature/raidplan-11): width, role groups for "Meine Aufgaben", a turned role group

- **Width**: a width audit (puppeteer: `scrollWidth <= clientWidth` and the board inside its column, 1 px
  tolerance) over every section of the test event, in the sheet and in the editor, at 1920 / 1440 / 1280 /
  1024 / 390 px found no horizontal page scroll in the sheet; in the editor up to 1000 px the map shrank to
  ~50 px: the later layout-v2 rule `.rp-stage2 { grid-template-columns: minmax(0, 1fr) 300px }` overrode the
  older phone media query. A media query right after it puts the dock under the map again (regression test in
  `src/web-client/src/lib/raidplan/roleMine.test.ts`). The user's report ("das AH darf auch nicht breiter sein als der Rest
  des spies") was read as "the picture must not be wider than the rest of the sheet"; that reading is not
  certain.
- **Role groups under "Meine Aufgaben" / "Wirkt auf dich"**: a row whose assignee is `role:<role>` is a task
  of every raider of that role, a target `{ kind: "role" }` acts on every raider of that role - his spec role
  from the setup (`resolveRole`), a flex role on this boss (`board.roles`) wins; "dps" = neither tank nor
  healer. No names are split out (the chips stay the role group). Client `lib/raidplan/assign.ts` `inRoleGroup` /
  `meInRole` (used by `isMine` and `mineView.rowMode`), server twin `raidplanAssign.inRoleGroup` (the same
  table in the tests). The public view names the raiders of a referenced role in its roster (so the page knows
  the visitor's role) and sends the boss's flex roles (`roles`, lineup players only).
- **Turned role group**: a role group (`zone.type === "role"`) has `rotation` (0..359, `normAngle`); the grip
  above its top edge (Shift = 15 degree steps), Q / E and "Drehung (°)" in the inspector; drawn with
  `transform: rotate()` about its middle, the same in the sheet.

## Names on the map (feature/raidplan-14)

"Die Namen sind verschoben beim Zoom": the name under a token is a share of its icon (`lib/raidplan/labelScale.ts`
NAME_FACTOR 0.3, ICON_NAME_FACTOR 0.24) and hangs under it, centred (`.rp-canvas .rp-token .rp-token-name`:
top 0.58 icons). Until round 14 `labelMetrics` **enlarged** a name whose font would be under 7 px on screen -
so on a small board (the sheet on a phone, zoomed out) the names grew to up to 0.5 icons, wider than the room
between two raiders of a group ring, and lay on the next raider; zooming in shrank them back. Now the share
never changes: a name smaller than `HIDE_SCREEN_FONT` (5.5 px) on screen is hidden, never blown up - the same
picture at every zoom, in the editor and the sheet (one reference space, one scale: the canvas transform).
Besides:

- **Group rings** keep neighbours at least `RING_CHORD` (2.2) tokens apart (`ringRadius`), and a ring member's
  name is never wider than the room to its neighbour (`ringNameWidth` -> `--rp-nw`, a long name ends in "…").
- **The group badge** (3/4/5 on a member or a token) sits at the icon's upper right; the name hangs below, so
  they never meet (before it sat at the lower right, on the name's first line).
- **The badge grows with its icon (#511).** "Das Gruppen-Badge ist beim Zoom kaum lesbar": it did scale with the
  canvas, but at 0.42 of the icon with a digit smaller than the name, and the slot, token and auto-token badges
  were placed from the zero-size anchor (their `right`/`top` meant for the icon's box) - they sat on the icon's
  middle instead of its corner; only the split-group members, whose badge lived inside the button, sat right.
  Now there is ONE badge: a child of the token's anchor for every kind (split members, placeholders, slots,
  tokens, auto and task tokens; editor and `/p/<token>` alike), centred near the icon's upper right corner
  (`.rp-canvas .rp-token > .rp-token-gbadge`). Its diameter, digit and rim come from `labelScale.ts`
  `badgeMetrics` as `--rp-badge` / `--rp-bf` / `--rp-bb` (set with the other icon variables in `PlanBoard`
  `effectVars`): BADGE_FACTOR 0.5 of the icon, at least BADGE_MIN 10 and at most BADGE_MAX 30 reference units,
  never more than 0.8 of the icon; the digit is 0.6 of the badge (at the default token as big as the name).
  Rim `--rp-icon-outline`, halo `--rp-text-halo` (the board is dark in both themes). No px size inline.
- **Hide or scale a group's badge (#528).** "Ich würde bei Gruppen gerne die Gruppen-Badge ausblenden können oder kleiner
  skalieren": every group marker has `showBadge` (missing = shown) and `badgeScale` (0.5 .. 1.5, missing = 1), like its
  ring (`showRing`). The scale is a factor on top of `badgeMetrics(size, scale)`: floor and ceiling scale with it, so a
  50 % badge on a tiny icon is half the floor (`badgeScaleOf` clamps, anything not a number is 1). Where it applies:
  the members and placeholders of a split group (`effectVars(px, s.badgeScale)` on the member), and a raider of that
  group outside the ring - a slot, a free token, an auto tank and a task token - through `labels.ts groupBadgeLook(slots,
  n)` (the split marker of that number first, else any placed one; its switch and size; the badge span then carries
  its own `--rp-badge` / `--rp-bf` / `--rp-bb` when the size is not 100 %). The board's "Nummern-Badges zeigen"
  (`board.showBadges`, view menu) still hides all of them (`badgeShown(board, slot)`). Editor and read view draw the
  same (`PlanBoard`). Server: `raidplanBoard.cleanSlot` keeps `showBadge: false` and a `badgeScale` other than 1 for
  groups only (`cleanBadgeScale`, two decimals, 0.5 .. 1.5); a default badge stores nothing, so older boards and the
  golden master are unchanged; `reidBoard` copies them with the slot. Edited in the inspector's tab "Ring & Badge"
  ("Badge anzeigen", "Badge-Größe" 50 - 150 %, "Standardgröße"), the right-click "Badge ausblenden / einblenden" on a
  group, and for several groups at once (`multiSelect.setBadgeSelection`: the multi inspector's "Badge anzeigen" and
  "Badge-Größe", the multi menu's "Gruppen-Badges ausblenden / einblenden").

Tests: `src/web-client/src/lib/raidplan/labelScale.test.ts` (also "group badge metrics" and "a group's own badge size"),
`src/web-client/src/lib/raidplan/badgeOptions.test.ts` (switch, look per group, menu, multi-selection), "a group's badge" in
`test/services/raidplan/raidplanBoard.test.js`, "names on a group ring" in `src/web-client/src/lib/raidplan/raidplan.roleGroups.test.ts`, "the group badge" in `src/web-client/src/pages/raid-detail/raidplan/BoardWorkspace.test.tsx`.

**A group's own "Token size" (feature/raidplan-15).** Two more causes, both only with a token size away from
the default:

- The token's button had a text line of its own (inline icon on the baseline, a line height that did not
  scale): a small icon (30 %) sat lower than its anchor, and the name, measured from the anchor, lay on the
  icon. Now the button is exactly its icon (`.rp-canvas .rp-token > .rp-token-btn`: block, `--rp-s` wide and
  high, no line height) - name and badge sit where they belong at every size.
- The ring was laid out with the group's *spacing* only (group size x ring spacing): tokens bigger than that
  ("Token size" 70 % with a ring spacing of 30 %) covered their neighbours and their names. `ringUnit(spacePx,
  memberPx)` = the bigger of the two - the ring grows with the tokens it carries (also for the places the
  facing finds). Raiders moved by hand keep their stored offsets.

Tests: "a group's own token size" in `src/web-client/src/lib/raidplan/raidplan.roleGroups.test.ts`.

### Role groups and group chips scale with themselves (feature/raidplan-15, part 2)

- **Role groups** ("Melees", "Ranged", "Healer", "Tanks": zones of type `role`) draw ONE solid outline and a
  light fill in their colour; the icon is there once, a circle in the middle, never distorted (a narrow strip
  gets a smaller circle, not an ellipse). The double border of the zone and the double ring round the icon are
  gone. Every measure is a share of the zone (`lib/raidplan/roleGroups.ts roleZoneMetrics(w, h, cluster, count)` in
  reference px): the icon 0.45 of the smaller side (at most 96), the outline 1 .. 4 px, the label and the
  count badge, and the names listed under it. The names go by the zone's area (a narrow strip still carries
  them), at most a token name's size (11.4); too small on screen they are hidden, never enlarged (like a
  token's name). The names are listed in lines of the zone's width, a name is never split. The shapes: circle
  (`ellipse`), rectangle (`rect`) - the same outline and icon, no concentric rings - and the cluster
  ("Symbole", several icons). The other zones (danger / healthy / neutral / own) keep their one line (solid,
  dotted, dashed); the double ring of a RANGED token is its role mark and not a zone.
- **Grips of a zone:** the four corners (both sides; Shift keeps the proportions) and, new, the middle of each
  edge (`ZoneGrip` "n" / "e" / "s" / "w": only that side - a melee strip gets taller or wider on its own).
- **Group chip with its names** (a group marker that is not split): as wide as its longest name needs, up to
  220 reference px; a name is never split (`white-space: nowrap`), a name longer than the chip ends in "…".
  Its width can be set in the inspector ("Breite des Gruppen-Chips", `slot.chipWidth` 60 .. 400 reference px,
  0 = automatic; kept by `raidplanBoard.cleanBoard` for groups only). Before, the chip was laid out in a
  zero-wide anchor, so every name broke at its spaces ("Darkdisi /" + "Lakunoc").

Tests: "role groups and group chips scale with themselves" in `src/web-client/src/lib/raidplan/raidplan.roleGroups.test.ts`, "a group
chip's width" in `test/services/raidplan/raidplanBoard.test.js`.

## Role groups: turned, names inside, symbol size, label outside (feature/raidplan-16)

- **Turning.** A role group turns at its round grip above it (Shift = 15 degree steps), in the inspector
  ("Drehung", slider + number, "Drehung zurücksetzen"), with Q / E, and several at once in the
  multi-selection. Only the outline and fill turn (`transform: rotate` on the zone); the content stands
  upright over it in its own layer (`.rp-rg-up`, rendered after all zones, no pointer events): the symbol, the
  names, the count and the label are never upside down. The grip used to MOVE the zone instead of turning it:
  the drag took the middle only from objects with a size of their own (`sizeOf`), and a zone has none.
- **Grips of a turned zone** work along its own axes, the opposite side stays where it is (`lib/raidplan/roleGroups.ts
  resizeTurned`); a selected zone lies above tokens and icons (z-index 6 in the editor) so its grips can be
  reached. The rubber band and the selection frame use the upright box of the turned zone (`turnedBox`, the
  smaller box for an ellipse).
- **The content area** (`uprightInner`): the zone itself when it lies straight, width and height swapped on
  its side (90 degrees), a square of its smaller side when turned diagonally, and inside an ellipse the
  rectangle inscribed in it (0.7 of each side).
- **Names inside** (replaces the long column below the zone - chosen from three variants, see below): small
  class-coloured chips in lines of the content area, under the symbol, a name never split
  (`roleNamesLayout(innerW, innerH, names, iconScale)` packs them in order). The font is a share of the area
  (at most 11.4 like a token name); too small on screen = not shown, never enlarged. What does not fit is ONE
  "+N" chip whose tooltip lists the rest; when none fits (a thin strip turned diagonally) the chip carries the
  number of all of them.
- **Symbol size** (`zone.iconScale`, 0.25 .. 3, 1 = automatic): "Symbolgröße" in the inspector (slider +
  number, "Automatisch"), on top of the automatic size, independent of the zone's size.
- **Label place** (`zone.labelPos`: `in` | `top` | `bottom` | `left` | `right`): buttons in the inspector
  ("Beschriftung": Innen / Oben / Unten / Links / Rechts). Outside it stands next to the upright box of the
  turned zone, upright; its font is a share of the zone (6 .. 12). Names inside with the label outside is the
  recommended combination.
- **Server:** `raidplanBoard.cleanBoard` keeps `rotation`, `iconScale` and `labelPos` of role groups (anything
  else of a zone has none of them); a template applied keeps them (`reidBoard` copies the zone).
- **Variants looked at** (screenshots in the PR): V1 names as chips inside (chosen: they belong visibly to
  their zone, stay inside its outline, cover nothing below it, and "+N" is a clear hint); V2 names as plain
  lines on a dark plate inside (less contrast against the fill, harder to tell from each other); V3 the old
  column outside below the zone, only more compact (still covers tokens below and grows with every name).

Tests: "role groups turned, their names inside" in `src/web-client/src/lib/raidplan/raidplan.roleGroups.test.ts`, "role groups in a
multi-selection" in `src/web-client/src/lib/raidplan/multiOptions.test.ts`, "a role group's symbol size and label place" in
`test/services/raidplan/raidplanBoard.test.js`.

## Role group areas: calm or arc (#559, section 2)

A role group AREA (a zone of type `role` with the shape `ellipse` or `rect`; the cluster "Symbole" has no area and keeps its look
above) is drawn in one of two styles, chosen per area in the inspector (tab "Form", segmented control "Flächen-Stil": Ruhig / Bogen)
and for several at once in the multi-selection. Chosen in the design canvas "Flächen auf der Karte" (variants B and C, not A).

- **Data model** (optional fields on the zone, `raidplanBoard.cleanAreaStyle` on the server, twins `areaStyleOf` / `arcSpanOf` /
  `arcWidthOf` in `lib/raidplan/roleGroups.ts`):
  - `areaStyle`: `"calm"` | `"arc"`. Missing or unknown = `"calm"`, so every area stored before is calm - nothing to migrate.
  - `arcSpan`: the arc in whole degrees, 30 .. 360 (360 = a closed ring). Missing = a ring for melee and tanks, 180 for the others.
  - `arcWidth`: the band's width as a share of the smaller half axis, 0.1 .. 0.8 (default 0.35).
  - The arc's middle points DOWN before the zone is turned; the existing `rotation` aims it ("open side" = the opposite direction), `w` /
    `h` are its outer radii (the zone's ellipse; a rectangle draws its inscribed ellipse as a band). Span and width are cleaned for every
    role group, also a calm one, so switching back and forth loses nothing. Other zones never carry them; a template applied keeps them
    (`reidBoard` copies the zone).
- **Calm ("Ruhig", the default):** a very light fill (the zone's opacity x `--rp-area-calm-fill`), a thin line (`--rp-zb` x
  `--rp-area-line`), solid for every role except ranged (dashed). The **badge** - role icon, label (the role's name when none was written)
  and count - sits centred on the edge that lies on top, half outside (`calmBadgeAt`: the zone's own top edge, the side that is up once it
  turns past 45 degrees). The names are small chips inside (`roleNamesLayout(..., withIcon = false)`: no symbol above them; they start
  below the badge when it reaches into their area).
- **Arc ("Bogen"):** the zone draws no box; an SVG path in the zone's own reference px (`arcPath`) is a ring (two ellipses, even-odd)
  or an annulus sector, filled with the zone's opacity, the thin line solid / dashed like calm. Only the band takes the pointer (the
  empty middle and the rest of the box let clicks through to the board; the grips stay reachable). The badge sits on the outer edge -
  at the top of a ring, in the middle of an arc; the names are chips along the middle of the band, spread evenly and clear of the badge
  (`arcLayout`), upright and turned with the zone. They shrink down to 60 % of their font before one "+N" chip (all others in its
  tooltip) takes the rest; too small on screen they are hidden like every name.
- **Label place and symbol size:** an area carries its label in the badge, so "Beschriftung" (`labelPos`) is only offered for the cluster
  (the field stays stored). "Symbolgröße" (`iconScale`) scales the badge.
- **Default per plan / template: not done.** Boards are stored per section and a plan has no settings of its own that the editor saves
  (the Standard board carries only rows); a new area starts calm, the multi-selection switches many at once.
- **Styles:** `styles/raidplan/objects.css` (`.rp-zone-role.is-calm` / `.is-arc` / `.is-dashed`, `.rp-arc-band`, `.rp-rg-badge`,
  `.rp-rg-at`); colours only from the zone (`--zc`) and the tokens `--rp-area-badge-bg`, `--rp-area-badge-ink`,
  `--rp-area-badge-shadow`, `--rp-area-calm-fill`, `--rp-area-line` (tokens.css, dark and both light blocks); geometry only through custom
  properties (`--rp-dx` / `--rp-dy`, `--rp-bf`, `--rp-bi`, `--rp-bh`). The editor, the template preview and the read view `/p/<token>` use
  the same `PlanBoard`, so they draw both styles identically.

Tests: `src/web-client/src/lib/raidplan/areaStyle.test.ts` (defaults, band, path, badge and name places), `src/web-client/src/components/raidplan/PlanBoard.areas.test.tsx`
(both styles rendered, the read view against the editor), "a role group area switches between calm and arc" in
`src/web-client/src/pages/raid-detail/raidplan/Inspector.tabs.test.tsx`, "the area style for all of them at once" in
`src/web-client/src/lib/raidplan/multiOptions.test.ts`, "a role group area's style: calm or arc (#559)" in `test/services/raidplan/raidplanBoard.test.js`.

## Section bar and boss icons (feature/raidplan-16, part 3)

- **Every section carries its name** in the section bar - the editor's (`BossNav` then, the list of `SectionStrip` since Oct 2026; also the template editor)
  and the sheet's (`PlanPublicPage`) alike: icon + name as one pill, no number (the order is the raid's), the
  chosen one filled. The label comes from `lib/raidplan/profiles.ts sectionLabel`: a boss by its name, "Allgemein",
  "Standard", and a trash section by its instance when the plan covers several (`severalInstances`: "Trash ·
  Der Schwarze Tempel"). The bar wraps to more lines instead of scrolling or cutting a name; on a phone (<=
  560 px) the pills are a little smaller.
- **Reliquary of Souls:** the rule set calls the boss "Reliquary of the Lost" (the name of its room), Warcraft
  Logs calls the encounter 606 "Reliquary of Souls". The picture is looked up by name
  (`raidplanStore.bossIconByName`), so it found none and showed the instance's icon (Illidan).
  `ICON_NAME_ALIASES` maps the rule set's name to WCL's; the picture is WCL's own encounter icon
  `public/bosses/606.jpg`, fetched like all others by `scripts/fetch-boss-icons.js` (already in the repo). The
  boss key `bt/reliquary-of-the-lost` stays, so stored plans keep their boards.
- **Other bosses without their own picture** (they show the instance icon): "Opera Event" (WCL: 655 "Opera
  Hall" - its picture is a stage, not a boss), "Chess Event" (WCL has no encounter) and "Zul'jin" (WCL: 1194
  "Daakara", the later name of the encounter). Not changed - reported for a decision.
