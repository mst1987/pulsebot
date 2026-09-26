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
  /api/raidplan/map/delete { key }`. Area `raids` write. The key must be a known instance id or boss key,
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
  from before the switch keeps its map; a hidden map alone counts as content. The tool bar of a boss / trash
  section has "Karte ausblenden / anzeigen" (image icon); "Allgemein" and "Standard" have no map anyway. Off:
  `BoardWorkspace` renders no board, palette, layers, zoom, minimap, map size or inspector, but a dashed note
  "Dieser Abschnitt wird ohne Karte geplant … bleiben gespeichert" with "Karte anzeigen"; Besetzung,
  assignments and tactic take the full width. The objects (tokens, marks, icons, zones, lines, texts) stay in
  the draft and are back when the map is shown again; slots, facing and the connection lines keep being
  computed. Template apply and duplicate copy the board as a whole, so the flag travels along.
- **Sheet / public API** (`raidplan.publicView`): a section with `showMap: false` sends `showMap: false`,
  `mapUrl: ""` and empty tokens / marks / icons / zones / lines / texts (slots stay, `placed: false`).
  `PlanPublicPage` then drops the right column (`no-board no-map`) and the assignments use the full width
  (Allgemein keeps its 640px column).
- **Order**: `raidplanStore.bossesForInstances` puts "Allgemein" first, then the bosses in raid order, then
  the trash; the template view inserts "Standard" right after "Allgemein". The boss chip numbering is
  unchanged (bosses only).
- **Start section** (`lib/raidplan.startSection(sections, wanted, remembered, hidden)`): a deep link
  `?section=<key>` wins, then the section last open in this plan (editor and template editor only,
  `localStorage` `eh.raidplan.section.<eventId>` / `t:<templateId>`, `rememberSection` / `rememberedSection`,
  a blocked storage answers ""), then "Allgemein", then the first shown section. The sheet starts at Allgemein
  (or the deep link).
- The right-click on a boss chip opens a small menu: "Aus dem Sheet ausklammern / Ins Sheet aufnehmen" and
  (boss / trash) "Karte ausblenden / anzeigen" (`BossNav` `onMap`). A test that `showMap` travels with
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
Map setzen" token was dropped for tank rows (one mechanism, no double logic).

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
  the keys of the rows to their new ids (a Standard row carries its template id as `_key` through
  `raidplanInherit.effectiveRows`). "Vorlage duplizieren" does the same. The tanks resolve in the event from
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
  größer / kleiner"). Lib: `arrowOf`, `patchArrow`, `scaleArrow` in `lib/raidplan/index.ts`. Apply / duplicate copy
  it (icons and `autoStyle` travel as they are).
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

Tests: `src/web-client/src/lib/raidplan/labelScale.test.ts`, "names on a group ring" in `src/web-client/src/lib/raidplan/raidplan.roleGroups.test.ts`.

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
  gone. Every measure is a share of the zone (`lib/raidplan/index.ts roleZoneMetrics(w, h, cluster, count)` in
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
- **Grips of a turned zone** work along its own axes, the opposite side stays where it is (`lib/raidplan/index.ts
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

## Section bar and boss icons (feature/raidplan-16, part 3)

- **Every section carries its name** in the section bar - the editor's (`BossNav`, also the template editor)
  and the sheet's (`PlanPublicPage`) alike: icon + name as one pill, no number (the order is the raid's), the
  chosen one filled. The label comes from `lib/raidplan/index.ts sectionLabel`: a boss by its name, "Allgemein",
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
