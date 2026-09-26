# Raidplan: the editor

Part of the raid plan docs, see [the entry page](../raidplan.md) for the other parts. Endnutzer-Sicht: siehe
[guide-web-admin.md#raidplan](../guide-web-admin.md#raidplan).

## Layout, flyout pickers, cards, chips (Sept 2026)

- **Group markers are always recognisable** (`groupTag` / `ringCover` in `lib/raidplan/index.ts`, `PlanBoard.tsx`).
  Cause of the bug: a split group draws its raiders as free tokens and the marker's tag was only drawn with a
  typed label, a name list or in the editor — so in the read view (and whenever the label was empty) a split
  group had neither tag nor any sign which tokens belong together. Now the tag (group icon + number chip; the
  typed label next to it) is drawn in **every view**, split or not — the number is identity, not a label, so
  the "only what was typed" rule does not apply to it. A split group additionally gets a dashed **ring** round
  its tokens and a **number badge** on every token (bottom right); in a template (no roster) the ring holds
  five placeholder tokens with role icons; an event group nobody is in has a dimmed number and no ring. **Who
  counts as "on the map"** (`splitMembers`, `placedIds`): only a free token or a slot with `placed !== false`.
  A slot that only stands in the Besetzung bar is no representation, so a split group draws all its raiders
  even with a full setup (the earlier rule hid them all, which made splitting unusable) and the "Nicht
  platziert" list still lists such players; once a member's slot is dragged onto the map, the ring token of
  that person disappears (no duplicate). Own-character highlight is unchanged. Tests:
  `src/web-client/src/lib/raidplan/groupTag.test.ts`.

- **Layout** (`BoardWorkspace.tsx`, `styles/raidplan.css`, one component for the template and the event
  editor): tool bar and boss chips (sticky), then the **bands** above the board (palette as one horizontal
  strip, the Besetzung as compact chips, the players not placed yet), then the board at the left and a
  **dock** (about 340 px) at the right with the tabs *Einteilungen · Eigenschaften · Ebenen · Hintergrund*.
  The board is limited in width so its height fits the viewport (`100vh - 420px` times the map's aspect
  ratio); opening the editor scrolls the page so the tool bar sits under the header (>= 1000 px). Measured
  (event with 25 raiders, BT): at 1920x1080 and 1440x900 tool bar, palette, Besetzung, board and the first
  cards of the dock are in view at once; **the dock's cards (12 in the demo) are taller than a screen, so the
  page scrolls for the lower ones — the board is `position: sticky` and stays in view while they do**.
  Narrower than 1000 px everything stacks. The Besetzung band, the palette and the dock can be folded away
  with the toggles in the tool bar; the read view (`/p/<token>`) is not touched.
- **No scroll containers, no long single-column lists** in the Raidplan UI. Every picker is the shared
  **flyout** (`components/raidplan/Flyout.tsx`, pure logic in `lib/raidplan/flyout.ts`: `sectionsOf`, `filterItems`,
  `paginate`, `rangeKeys`, `toggleAllKeys`, `placeFlyout`): it opens **beside** the card or chip that opened
  it (right, else left, else a bottom sheet on a phone), shows the entries as chips in sections side by side,
  **never scrolls** (when the room ends there are pages, `cap` shrinks until nothing overflows; from 24
  entries a search field and section tabs), ticks several at once (stays open until "Fertig", a click beside
  it or Esc; Shift-click ticks a range, "Alle" a section) or one (`multi={false}`, closes on pick). Keys:
  arrows move in the grid, Space ticks, Esc closes, Tab stays inside. Used by the assignees / targets / spell
  pickers of a row, the chips of the Besetzung, the inspector's player, the catalog's icon picker.
- **The Besetzung only changes through +/-.** Dragging or clicking a role entry in the palette or the context
  menu never creates a slot: it places the next free (unplaced) slot of that role (`insertObject` /
  `applyMenuAction` return `blocked` when all are placed and the workspace says so in a toast). The palette
  entry shows a tally `placed/total` and is greyed out when all are placed (`slotTally`). Existing boards are
  repaired when opened (`repairSlots`, part of `ensureBesetzung`): duplicate slots of a role above the count
  are merged into the free ones or removed, references stay valid. Regression tests in
  `src/web-client/src/lib/raidplan/raidplan.slots.test.ts`.
- **Chips of the Besetzung are draggable** (`dropChip`, pure): an unplaced chip dragged onto the map places
  the slot exactly there (ghost at the pointer, Esc cancels, a drop outside the map does nothing); a placed
  chip dragged onto the bar leaves the map, dragged onto the map moves; a plain click on a chip opens its
  picker (a placed chip also selects the slot and lets it blink, `is-flash`). Pointer Events, so it works with
  a finger. It never adds a slot or changes a count.
- **Cards can be removed:** a card added with "Karte hinzufügen" is removed with its trash button (empty: at
  once; with rows: after a confirmation, Ctrl+Z brings it back). A default card is **hidden** (eye button;
  kept in the plan as `board.hiddenCards`, so template, event and everybody see the same) and comes back
  through "Karte hinzufügen" (`hideCard` / `showCard` / `removeCard` / `isDefaultCard` in `lib/raidplan/assign.ts`).
  Audit of the other add/remove paths: chip x, row delete, mob bar (hand-added mobs; the catalog's automatic
  ones cannot be removed), map objects, Besetzung -, profiles and catalog entries (hide / reset) all had a way
  back already.

## Editor

Raid-Detail › tab **Raidplan** (own event, order Roster, Setup, Raidplan, Loot, Logs) and the template editor
on `/raids/plan-templates?edit=<id>`. **Both stay inside the menu's normal page frame** (Shell, raid-detail
hero and tabs / the ordinary page head, the 1080 px content width); only the public read view is its own,
full-width page. What one edits is **always in view** — no edit hides behind a fold-away section or a dialog;
dialogs are for the rare things (sharing, the template picker, managing tactic profiles).

```
[ sticky tool bar: undo redo | arrow line text rect ellipse | palette panel | status … template share save ]
[ boss chips ]
[ players not placed yet (event plan) ]
[ palette | the board | Eigenschaften · Hintergrund + Ebenen ]
[ target rows + note + tactic ]
```

- **Sticky tool bar** (icons with a tooltip and an `aria-label`, lucide): undo / redo (Ctrl+Z, Ctrl+Y /
  Ctrl+Shift+Z; one history over all bosses, a drag or a run of keystrokes is one step — `useDraftHistory`,
  pure logic `historyRecord/Undo/Redo` in `lib/raidplan/index.ts`), quick inserts, fold-away toggles for the palette
  and the panel (for a bigger board), the state ("Gespeichert" / "Ungespeichert", published, open slots,
  template) and the page's actions as icons (template, share, save).
- **Palette (left):** the eight raid marks, the slots (tank, healer, melee, ranged, dps, group, label),
  **Encounter** (the boss icons of the event's instance, enemy, boss position), an **icon by name** field
  (type a WoW icon name, a preview shows it, then insert — a real search over names is a follow-up), zones
  (four types, rectangle or ellipse) and shapes (arrow, line, text). **Drag an entry onto the board or click
  it** (Pointer Events; an entry that never moved is a click and lands near the middle). Not built yet:
  class/spec icons.
- **Scaling:** every object has a size in the inspector (slider + number), a corner grip on the selected
  object (a zone keeps its ratio with Shift), `+` / `-` keys, Alt + mouse wheel over the object, and the tab
  **Hintergrund** has "Objektgröße" for the whole board.
- **Board:** the room map, the zones, lines and arrows (an SVG drawn in pixels so an arrow head never
  stretches), marks, slots, texts and player tokens. **The board takes the aspect ratio of its map** (a
  near-square room gives a near-square board, without a map 16:10), so any map fits as a whole.
- **Right panel:** tab **Eigenschaften** = the inspector of the selection (name; a zone's label, type, shape,
  colour with the type's preset one click away, width/height in %; a line's kind, colour, thickness; a text's
  words, colour, size; a slot's number, own title and — in an event plan — the player; **opacity for every
  kind** as slider and number, 10–100 %; lock, duplicate, front, back, take the player out, delete as icons).
  Tab **Hintergrund** = the map's opacity ("abdunkeln") and the map rows (upload, replace, remove; an
  override's "Auf Standard zurücksetzen"). Under it the **layer list**: every object front to back, click to
  select, per row show/hide, lock, one step forward/back, delete.
- **Objects are moved with Pointer Events on window, no HTML5 drag and drop**, so a finger works like a mouse:
  palette entries and players from the list onto the board or **onto a slot**, objects around the board (they
  follow the pointer live, grip kept), a zone's four corner handles and a line's two end handles to scale/aim
  them, a token or a slot's player onto the list to take it off (the slot goes back where it was).
  `touch-action: none` on everything draggable. **Locked objects are selected but do not move.** A selected or
  focused object moves with the arrow keys (Shift = bigger steps), Delete removes it, Enter jumps to its
  properties.
- **Right-click menu** (`ContextMenu.tsx`, only on the board, the browser's own menu is suppressed there;
  **long press on touch**, 550 ms): on an object *Eigenschaften, Duplizieren, In den Vordergrund /
  Hintergrund, Sperren / Entsperren, Spieler zuweisen … / lösen* (slots of an event plan, tokens), *Löschen*;
  on the empty map *Hier einfügen: slot / mark / zone / arrow / line / text* (at the click position) and
  *Alles abwählen*. `role="menu"` / `menuitem` / `separator`; Up / Down / Home / End move, Enter or Space
  picks, Esc closes and gives the focus back; it is moved back into the viewport when it would not fit. What
  each entry is and does is pure and tested (`contextMenuItems`, `applyMenuAction`, `clampMenuPosition`).
- Tokens show the **real spec icon** in a role ring (tank blue, healer cyan, everything else orange) on a
  class-coloured tile. **A zone's type is a pattern and a label as well as a colour** (danger: diagonal
  stripes and ⚠, healthy: dots and ✚, neutral: dashed border, own: solid). Open slots show the role's WoW icon
  on a dashed ring.
- Rows: free title, players from the roster (a picker dialog), delete; "Taktik wählen" as before. "Freigeben &
  teilen" publishes/withdraws the *saved* plan.
- Without `raids` write everything is read-only.

**Raid marks:** the eight icons are the game's own `UI-RaidTargetingIcon_1..8` textures (64 px PNG), stored in
`src/web-client/public/raidmarks/<skull|cross|square|moon|triangle|diamond|circle|star>.png` next to the boss
icons. They come from the community texture mirror https://github.com/Gethe/wow-ui-textures
(`TARGETINGFRAME/`), because the Wowhead icon CDN has no such files and Wowpedia / warcraft.wiki.gg block
direct downloads (403). They are Blizzard's artwork (the mirror carries no licence of its own): they are used
the way the boss and spell icons from the Wowhead CDN already are. No guide screenshots are used.

**Icons of the interface** are [lucide](https://lucide.dev) (`lucide-react`, ISC licence, tree-shaken: only
the icons that are imported end up in the bundle, about 10 KB), as inline SVG components — no runtime CDN.

## Round 3 (Sept 2026): modal pickers, layout v2, multi-select, Standard, classes, roster dialog

- **Modals instead of flyouts.** A row's dialog (`AssignModal.tsx`) shows task, assignees, targets and
  preferred classes on one page; `Flyout.tsx` is a centered picker. Tooltips stay for short hints only.
  Preferred class: `preferredClasses` + `allowOthers` per assignment row; suggestions and pickers prefer the
  class, a player of another class gets a hint.
- **Layout v2.** Assignments sit under the map in columns; map height S/M/L plus splitter
  (`eh.raidplan.mapSize`); the narrow dock holds only properties/layers/background. An icon of a mob/boss
  faces its tank automatically (`autoFace`, manual rotation overrides). Lines are drawn only when both ends
  are on the map.
- **Read view v3 / shared sheet.** Two columns from 1100 px: assignments left (clamp 560-640 px), sticky map
  right (>= 58 %); "Meine Einteilungen" first (assignee, target or name mention), tables Tank|Ziel|Heiler,
  group healing, "Nur Bild" toggle. "Du" highlight (`lib/raidplan/mention.ts`, `Mentions.tsx`) in tables, map and
  texts. Sentences use the player name for filled slots, the slot label only when open.
- **Multi-selection** (`lib/raidplan/multiSelect.ts`): rubber band, Ctrl/Cmd/Shift click, Ctrl+A, shared frame with
  scale grips; move/delete/duplicate/copy/align/lock/hide/order as one undo step each.
- **Inputs**: `NumberField`/`SliderField` (`lib/raidplan/numberField.ts`) everywhere.
- **Menu**: "Raidplan-Vorlagen" and "Raidplan-Katalog" are sub entries of Raid-Events (area `raids`).
- **Standard (template).** Tank/heal defaults live once under `defaults` (`lib/raidplan/inherit.ts`,
  `raidplanInherit.js`), inherited by every boss and trash (target "Boss (dieser Abschnitt)"); rows can be
  deviated, hidden, restored; "Standard auf alle Bosse anwenden" copies; applying to an event writes inherited
  rows (`origin: "default"`).
- **Group ring** can be hidden: per group `showRing` (+ colour/opacity), per board `showRings`, context menu,
  multi-selection, respected in the read view.
- **Slot classes.** A role slot has `preferredClasses`; applying a template fills bound slots first (classes
  in priority, setup order, a player once); missing class = slot stays open (never a stranger). The binding
  lives on the SLOT (not the row); `bindClassesToSlots` can copy a row's classes to its slot assignees.
- **"Besetzung zuweisen"** (`AssignRosterModal.tsx`, `lib/raidplan/rosterAssign.ts`): columns per role, right the
  players (fitting role first, search, class filter); click assigns, a player standing elsewhere SWAPS, drag
  onto a slot (pointer events), Delete clears, "Offene Slots fuellen", "Alle leeren"; each action one undo
  step; in a template only the class binding. Opened from the Besetzung bar and the toolbar.

## Round 4 (Sept 2026): reference space, classes, groups, zoom, views

- **One coordinate space (`lib/raidplan/boardScale.ts`).** Everything on a board is laid out on a canvas `REF_W` = 700
  units wide and the whole canvas is scaled by ONE factor (board width / 700, times the zoom) with a CSS
  transform. Positions are fractions 0..1; sizes (`size`, font, ring radius, line width, badges, name label
  ...) are reference units, so the editor, the template editor and preview and the read view show the same
  picture at any width (measured: positions and sizes agree within 0.2 % of the board width at 480, 640, 997
  and 999 px). Stored sizes are read as units (nothing converted: the old px values were made on boards of
  about this width). `boardRef` in the workspace is the canvas: its transformed rectangle is what drags, bands
  and drops measure, exact at any zoom.
- **Zoom and pan (`lib/raidplan/boardView.ts`, `hooks/useBoardView.ts`).** View only, never stored: Ctrl/Cmd + wheel (and
  a trackpad pinch) zooms towards the pointer, a plain wheel scrolls the page; pan with Space + drag, the
  middle mouse button, the hand tool or two fingers; buttons in the toolbar (editor) and over the map (read
  view); 50-400 %, click on the percentage = fit (what the read view shows). Grips keep their screen size
  (`--rp-k`). Touch pinch is implemented but not tested on a device.
- **Sizes in percent.** Every element has "Grosse %" (25-400 % of its default, `SIZE_RANGES`), also in the
  context menu (50-200 %) and for a selection (relative factor, `resizeSelection`, one undo step). A group has
  `groupScale` (whole group: ring, spacing, member tokens, tag, badges, names), `ringSpread` and `tokenScale`;
  members are stored in units of the group's spacing. The board's symbol size is `objectScale` (40-200 %);
  effective size = global x object x group. The name label, badges, ring width and facing wedge are shares of
  the icon's size (`lib/raidplan/labelScale.ts`: font = 30 % of the icon, legibility floor 7 px on screen, hidden when
  it would then be wider than 2.2 icons; per object `showName`).
- **Rings and views.** `ring: false` per token/slot/icon (zone: border); board switches `showNames`,
  `showBadges`, `showRoleRings`, `showRings`; per viewer (localStorage, `lib/raidplan/viewRules.ts`): highlight of my
  character, selection frame, connection lines, and in the read view names/rings (a viewer can only hide more
  than the plan shows).
- **Groups.** Default colours from an eight-colour colour-blind-safe palette (`lib/raidplan/groupStyle.ts`, group n ->
  colour n), `groupColors` / `groupMarks` on the board, one raid mark per group (swap on conflict), "highlight
  group" (the others dim; view only). The read view's group healing table has one row per group: colour bar +
  "Gruppe n", members, healers ("nobody" when none).
- **Classes as assignees.** `class:<Class>:<n>[:<role>]` (and target kind `class`): resolved from the setup by
  `expandClassRefs` (n-th free player of the class for that kind of task, hand picks in `picks`,
  `allowMulti`); an unfilled one stays open with the class icon ("Jaeger fehlt"). The server twin
  (`raidplanAssign.expandClassRefs`) resolves it for the public page. The catalog's spells give the suggested
  classes; slot class binding (`preferredClasses`) still exists but is secondary.
- **Read view.** "Meine Aufgaben" and "Wirkt auf dich" (`lib/raidplan/mineView.ts`) are blocks per kind of task with
  one card per assignment (icon | who | arrow | at whom | extras); "Alle Einteilungen" is its own zone with
  the tables. "Tasks by player" is gone.
- **TBC correctness.** Catalog entries may carry `versions` (default: all); the catalog, the pickers and the
  suggestions filter by the event's game version. Misdirection is a hunter's; Tricks of the Trade (Patch
  3.0.2) is limited to `wotlk` (`SINCE` + `test/services/raidplan/raidplanCatalogAudit.test.js`). Fear Ward is a spell of
  all priests since Patch 2.3.0 (Warcraft Wiki). Only the nine TBC classes exist.
- **Crash guard.** `RaidplanBoundary` wraps the editors: a render error shows "Etwas ist schiefgelaufen" with
  reload / retry / details instead of a white page. The crash "assignments is not iterable" came from the
  icon-facing code getting a board without `assignments`; those reads are defensive now
  (`boardHardening.test.js`).

## Count and round robin of class references (feature/raidplan-6b)

- **One resolution, two twins.** `expandClassRefs` in `src/services/raidplan/raidplanAssign.js` (sheet `/p/<token>`,
  suggestions) and in `src/web-client/src/lib/raidplan/classRefs.ts` (editor, template editor, facing, "Meine
  Aufgaben") are the same algorithm; `src/web-client/src/lib/raidplan/classCount.test.ts` runs both on the same boards and
  compares. Per board and **kind of task**: raiders named by hand (`user:`, a filled slot, `picks`) are taken
  first; then the references of a **named class** in row order; then the **"Any"** references. A reference
  starts at its own number in its pool and takes the first raider nobody of that task has yet; nobody free =
  it stays open ("Jäger 3 (fehlt)") - **no fallback** to another class or role; `allowMulti` on the row
  repeats a raider instead. The output keeps length and order (chips match by index), so the effective rows
  other code reads (tank facing, `tanksOfMob`) are unchanged in shape: a resolved reference is a plain
  `user:<id>`.
- **Count ("x n").** The count of a class in a row is the number of its references in that row
  (`class:Hunter:1`, `class:Hunter:2`): every place keeps its own number, pick and chip, and nothing
  downstream had to learn a new field. The dialog groups them into one chip per class and role (`classGroups`,
  `ClassCountChip` in `ClassPicker.tsx`: "Jäger 1-2  - x2 +", the cross removes all); `setClassCount` adds the
  **next free running number of the task over all its rows** (`nextClassN` = lowest free number per class and
  role) and takes the highest numbers of the row away (with their picks). Running numbers go up to 99.
- **Running number on a new row.** The card's "+" (`carryClasses`) gives a new row the classes of the row
  before it with the next numbers: MD row 1 "Jäger 1", row 2 "Jäger 2" (the next free hunter), row 3 "Jäger 3" -
  with two hunters in the raid the third stays open. Labels always show the number (`classRefLabel`: "Jäger
  1", "Priester (Heiler) 1", "Tank (Krieger) 1", "Tank 2").
- **General tank.** `class:Any:<n>:<role>` = any raider of that SPEC role (it always names the role;
  `class:Any:1` without one is dropped on save and would mean nobody). Tanking rows (`tank`, `trashtank`,
  `special`: `TANK_TYPES`) offer "Beliebiger Tank", "Tank (Krieger)" (`class:Warrior:n:tank`), "Tank
  (Paladin)", "Tank (Druide)" in their own block of the row dialog (right column) with the same count chips.
  The pool is the setup's tanks (flex role on the boss counts): a retribution paladin or feral druid is never
  a "Tank (Paladin/Druide)". Several tank rows go round the tanks; a named class is served before "Any", so
  "any tank" never takes the one warrior tank a "Tank (Krieger)" row needs.
- **Migration.** `renumberClassRefs` runs at the start of `cleanAssignments` (every save, template save and
  template apply): a reference whose number an earlier one of the same task, class and role already has gets
  the next free one; unique numbers stay; a hand pick moves with its renumbered reference. So old data with
  "Hunter 1" in three rows (or twice in a row, which used to be dropped as a duplicate) keeps every place with
  count 1 and resolves exactly as before.
- **Suggestions** (misdirect, fear ward, soulstone, kicks, curses, thunder clap, demoralizing shout) are built
  as numbered class rows (`suggestClassRows`, one per tank / healer, the first class until its raiders run
  out) and, in an event, resolved by `expandClassRefs` together with the rows the orga keeps (`keep` in `POST
  /api/raidplan/suggest`: the non-suggested rows of that type; the row dialog's "Zuständige vorschlagen" sends
  the other rows). Unfilled references and empty rows are dropped - nothing is suggested rather than a
  stranger. In a template the numbers continue after the kept rows. Applying a template keeps the class
  references, so the auto fill is the same live resolution.
- **Seed.** `scripts/seed-test-raid.js` adds on the trash "Beliebiger Tank" and "Tank (Paladin)" rows (the
  paladin row is served first, "any tank" takes the next free tank) and a third misdirect row at the council
  that stays open (two hunters, both already misdirect there).
- Tests: `test/services/raidplan/raidplanRoundRobin.test.js` (2 hunters / 3 rows, count, general tank without a ret paladin,
  no fallback, allow several, migration, suggestions with `keep`), `src/web-client/src/lib/raidplan/classCount.test.ts`
  (count, carry, candidates, twin check, dialog structure), updated `raidplanClassRefs.test.js` /
  `classRefs.test.js`.

## Round 7 (feature/raidplan-7): the row dialog "Variante B" and the row container

Both follow the Raidplan canvas (boards `Modal-B`, `Modal-Klassen`, `Zeilen-Container`,
`Zeilen-Container-Varianten`, option 1).

- **Row dialog** (`AssignModal.tsx`, pure logic `lib/raidplan/assignModal.ts`): a centered dialog (`Modal` with
  `className="rp-amb dlg-flush dlg-sheet"`, up to 1320 px wide), everything on ONE page, **nothing scrolls, no
  paging**. Head: the task's icon (spell or type) and title. Under it the **assignment bar** with three slots
  — *Zuständige* (active by default), *Ziele*, *Aufgabe / Spell* (the task text lives there) — the active one
  is framed and a click in the grid fills it; a slot is switched by a click or the arrow keys
  (`role="tablist"`). The wand of *Zuständige* asks the server for assignees (event plans). Chips in the bar
  carry their remove; kick assignees keep their rotation arrows there. At the left the **categories** with
  counters (`categoriesFor`, `chosenCounts`: who = *Spieler & Slots*, *Klassen*; at whom = *Mobs* first for
  tanking / kick / CC rows, *Spieler & Slots*, *Gruppen*, *Klassen*, *Marker*, *Freitext*; task = *Spells*
  (only when the type has spells) and *Freitext* with the row's note) as a vertical tablist; at the right ONE
  grid of the active category:
  - *Spieler & Slots*: role slots and players in ONE list, grouped tank / healer / DPS (`peopleEntries`,
    `peopleGroups`), search and filter tabs (`filterPeople`), a switch *Slots* (a slot follows its player) /
    *Spieler fest* (event plans). A filled slot shows the player's name and spec icon with the slot number, an
    open slot its kind and "offen".
  - *Klassen*: 3x3 class tiles with the number of raiders of the class for the task's role (`classCount`;
    dimmed at 0, still choosable), the catalog's classes dashed; below one **card per chosen class** with the
    count stepper (the `x n` of `setClassCount`), the role filter where the class has several roles
    (`CLASS_ROLE_CHOICES`, `setClassRole`) and the resolution ("Jäger 1 -> Pfeilchen", the candidates as a
    radio group for a hand pick, "offen · nur 1 Jäger im Raid" / "alle schon für diese Aufgabe eingeteilt").
    Tanking rows get the **general tanks** here (Beliebiger Tank, Tank (Krieger / Paladin / Druide), with the
    tanks in the raid); a plain tank row shows only them. Below: "Mehrfach erlauben", "Für Vorschläge
    bevorzugen" (the preferred classes), "Vorgeschlagene Klassen übernehmen", "Klasse an die Slots binden".
  - *Gruppen* ("Gruppe n" with the group colour and the number of members), *Marker* (icon and name), *Mobs*
    (portraits), *Spells* (the catalog's spells of the type, fitting classes first, TBC filter), *Freitext* (a
    text target with the quick picks of the type, the note).
  - **Preview** "So sieht es im Sheet aus": the task and one chip per assignee -> targets (`previewLines`), an
    open place is the one yellow dashed mark. Foot: *Zeile entfernen*, *Abbrechen*, *Fertig*; Esc cancels,
    Enter (Ctrl+Enter on a button) is done, the native dialog traps the focus.
  - Measured with puppeteer on the 25-raider test raid: no scroll bar and nothing cut at 1440x900, 1920x1080
    and 390x844 for every slot and category (the dialog keeps one height, `min-height` of the main part).
    **Phone (< 900 px)**: a full-screen sheet (`dlg-sheet` in index.css), the slots as tabs with their count,
    the categories as a chip row, the people grid 3 columns, the preview hidden.
- **Row container** (`AssignLine.tsx`, pure logic `lib/raidplan/assignLine.ts`): every row of the editor's cards is ONE
  container with the grid `26px | 1fr | 18px | 1fr | 76px` — spell / task icon, who, arrow, at whom, actions.
  The chips only show (no "+", no "x"): a player with spec icon and class colour, "Gruppe n" with its colour
  edge, mob portrait, mark, text; a class with more than one reference is a dashed bracket "Jäger x2" around
  what it resolves to. The pencil is the row's button and its click area fills the container (stretched
  `::after`), note and trash sit above it; Tab reaches a row, Enter opens the dialog, Delete / Backspace
  removes after asking (the trash removes at once, Ctrl+Z brings it back); the note icon opens the dialog on
  *Aufgabe / Freitext*. A small line under the row only when there is a spell, a task text or a note. States
  (`lineState`): **leer** (dashed, "Zuständige wählen -> Ziel wählen"), **offen** (a missing place = a yellow
  dashed chip with class icon and warning, never a stand-in), **aufgelöst** (quiet); an open slot in a
  template is a grey placeholder. **Inherited** rows (the template's Standard) are dimmed with "Standard" in
  the small line and a lock instead of the trash; the pencil makes the row the section's own and opens it; the
  eye hides it. The card head shows the type badge, "4 Zeilen · 1 offen" (`cardSummary`) and "+ Zeile". Cards
  are fluid (at least 400 px, the columns of the page), on a phone (< 600 px) a row stacks who / arrow / at
  whom.
- **Sheet**: the tank table and the group healing table stay; every other type is a card of read-only row
  containers (no actions, an empty row is not shown); the viewer's own chip carries "DU" and frames the row
  (the one mark). "Meine Aufgaben" names the kind of task in a block that mixes kinds.
- **A class of any spec, on purpose (a mage tank).** A class reference may carry the role `any`
  (`class:Mage:1:any`, also as a target `Mage:1:any`; server and client): every spec of the class, the role
  the task implies is NOT applied. Without a role the task's role still applies (healing -> healers, tanking
  -> tanks), so the spec-role rule stays for the role choices ("Beliebiger Tank", "Tank (Krieger)", a healer
  filter). The dialog makes it explicit: on a tanking row the tiles under "Andere Klasse als Tank (beliebige
  Spec)" are the six non-tank classes and add `any` ("Magier-Tank"; `defaultClassRole`); every class card has
  the role chips *Alle Specs* / Tank / Heiler / DPS (what the class can play, plus the task's own role) with
  the effective role selected (`effectiveRole`, `storedRole`). Names follow the row: `classPlaceNameFor` /
  `classRefLabelFor` ("Magier-Tank 1" on a tanking row, "Magier (alle Specs)" elsewhere); a resolved player
  outside his spec role on a tanking row carries "als Tank" (`offRole`) in the editor, the template and the
  sheet. No mage in the raid: the place stays open, never another class.
- **Missing classes are shown** (every kind of task): the class tile is dimmed with a warning and "0" ("Kein
  Magier im Raid" as its label), the card's resolution says "Kein Magier im Raid" / "nur 2 Hexenmeister im
  Raid" / "alle schon für diese Aufgabe eingeteilt"; the row shows the yellow dashed chip "Hexenmeister 3
  fehlt" and the card head "1 offen"; **plan-wide** the tool bar of an event plan has the badge "n offene
  Einteilungen" (`openAssignments` over every section with its Besetzung, `missingNames`), a click lists them
  per section (a click on a section opens it); applying a template ends with a toast "2 Einteilungen offen:
  Magier, Jäger fehlen". The sheet shows only the chip. A template has no setup and no such warning.
- Tests: `src/web-client/src/lib/raidplan/assignModal.test.ts` (categories, people list and filter, counters, class counts,
  preview, row states, card counter, any-spec roles and names, open rows plan-wide, twin check, structure,
  texts), `classCount.test.js` (count / role of a class in the dialog), `test/services/raidplan/raidplanRoundRobin.test.js`
  (mage tank with `any`, no fallback, healing keeps its role, `any` saved).
- **Seed**: the council gets "Magier-Tank -> High Nethermancer Zerevor" and a soulstone row for three warlocks
  (the raid has two: one place open).

## Follow-up (feature/raidplan-2)

- Group colours and marks are **plan-wide**: changing one edits every board of the plan/template in one undo
  step (`useDraftHistory.editAll`, `editAll` prop of the workspace).
- **Read-view preview** (eye button in the editor toolbar): the same picture as the sheet, without grips,
  chips or selection (the board is rendered without handlers).
- **Touch**: a long press on empty ground arms the rubber band; released without moving it opens the context
  menu.
- **Suggestions in a template** ("wand") name classes (`class:Hunter:1` ...) because a template has no players
  (`suggestClassRows`).
- **Read view**: "Nur f\u00fcr mich" chip in the section nav (only sections that concern the visitor, only his
  blocks), group healing "Nach Gruppe / Nach Heiler" (`healerGroups`).
- **Catalog**: `versions` of an entry can be set in the catalog form (Klassik / TBC / WotLK); Bloodlust
  (Horde) and Heroism (Alliance) are separate entries.
- **Pan and saved view.** Zoomed in, a drag on empty ground pans (Shift + drag = rubber band), also Space +
  drag, middle button, hand tool, plain wheel / two-finger scroll (at the edge the page scrolls again), arrow
  keys with nothing selected, one finger on empty ground. An overview map (`MiniMap`, view menu, default on
  when zoomed) shows the cut-out; "100 %" = one screen pixel per unit. "Ausschnitt als Standard speichern"
  stores `view: {zoom, cx, cy}` on the board (`cleanView`, zoom 1-4, centre 0..1; copied with the template);
  the read view opens with it ("Ganzes Bild" / "Ausschnitt" button). Pure maths: `centerOn`, `visibleRect`,
  `savedView`, `viewFromSaved` in `lib/raidplan/boardView.ts`.
- **Roles are the spec's role, never a class guess.** A class reference in a healing row implies role
  `healer`, in a tank row `tank` (`impliedRole`; an explicit `:role` wins): only players of that setup role
  fill it (flex role on the boss counts), nobody fitting = the place stays open ("fehlt"). The "allow other
  classes" switch is gone from the row dialog; suggestions take only the chosen classes.
- **Facing towards the tank** (`facingOf`, `tanksOfMob` in `lib/raidplan/assign.ts`): computed from the section's
  EFFECTIVE rows (own + rows inherited from the Standard, class references resolved) in the editor, the
  template editor and (from the server-applied rows) the read view; a boss icon without a mob follows the
  resolved "boss of this section"; several icons of one mob take that mob's tanks in icon order; a tank who is
  not placed leaves the angle as it is; "Manuell" / "Wieder automatisch" in the inspector. "Allgemein" has no
  map and no tank cards: Tank -> Boss belongs in the Standard.

## Follow-up 4

- **"Gruppe 1-3"**: three or more consecutive groups among the targets of a card in "Meine Aufgaben" / "Wirkt
  auf dich" become one chip (`mergeGroupRuns`); pairs and singles stay single.
- **Editor preview "Meine Aufgaben"**: a foldable block under the Einteilungen (event plans, when the
  organiser is in the setup) shows his tasks and what acts on him, from the effective rows.
- **Inspector**: a note when the board hides an icon's name by itself (too small on screen,
  `lib/raidplan/labelScale.ts`); the Heilen card's group chips carry the group colour as their border.
- **Catalog**: Shield Bash, Cure Poison (druid and shaman), Remove Curse (mage and druid) checked against
  Wowhead TBC / Warcraft Wiki: all exist in 2.4.3, nothing changed (sources in the defaults file).
- **Seed**: the second demo boss has tanks on the map and the boss icon but no own tank row; the template's
  Standard row (Tank 1 -> boss of this section) makes the icon face the tank after "apply".

## Follow-up 5

- **Own place leaves the group view.** A raider of a group marker who has a place of his own on the board (a
  free token, or a role slot that stands ON the map; a slot only in the Besetzung bar does not count) is not
  shown a second time in his group: `ownPlaceIds` / `splitMembers` (ring) / `groupListMembers` (name list of a
  non-split group) in `lib/raidplan/index.ts`. The ring lays out only the remaining members (no gap), the name list
  drops him. Removing the token (Entf, "Spieler loesen") or moving the slot back to the bar returns him. A
  member moved inside the ring (offset override) stays in the ring on purpose.
- **Manual take-out.** Context menu of a ring member: "Aus Gruppe herausnehmen" (`takeOutOfGroup`: a free
  token at his current spot; his setup group stays, so assignments by group still hold). The token menu has
  "Zurueck in die Gruppe" (removes the token) for a raider of a split group. Single players of a split group
  carry the group number as a coloured badge (`ownBadgeGroup`). The group tag keeps showing the group number,
  not "n/m".
- **Sections out of the sheet.** `inSheet: false` on a board (default in, so old plans are unchanged) leaves a
  section (boss, trash, Allgemein) out of the shared sheet. The editor keeps it fully editable and only greys
  the chip (eye button / right click on the chip / checkboxes in "Freigeben"). `publicView` filters those
  sections FIRST (before the used-roster set is built), so nothing of them (chips, notes, objects, rows,
  players) reaches `/api/raidplan/public`; only `hiddenCount` (a number) says that some are held back. A deep
  link to a left-out section falls back to the first visible one; with none left the page says "Noch nichts
  freigegeben." Templates carry the flag; applying copies it and the event can override it. In the sheet the
  visible chips are numbered again (1..n of what is shared). Quick actions in the share dialog: Alle / Keine /
  Nur Bosse / Ohne Trash (`sheetKeysFor`).

## Follow-up 6

- **Facing towards the tank (measured).** The wedge of a boss / mob icon was measured live in the editor, the
  template and the read view (desktop and phone width), map size S/M/L, zoom 100 % to about 250 %, icon size
  50 % / 200 %, the tank in all four quadrants and the diagonals: deviation at most 0.3 degrees (wedge angle
  vs. the angle between the two icon centres on screen). `facingOf` applies the board aspect to dx only
  (`angleBetween`), tests cover 16:9, 3:2, 1:1 and 9:16 in eight directions each. Two real gaps were closed:
  (1) the board handed `facingOf` no icons, so two icons of one mob (both Flames of Azzinoth) both took the
  FIRST tank - now each takes the n-th tank of the mob's rows; (2) a tank who stands in the ring of a split
  group marker had no position - the board now hands over the places it drew (`places`, client only, never
  saved). Extra mobs follow their tank by the same rules as the boss (row "Tank -> mob", also inherited rows;
  auto / manual; a tank who is not placed leaves the angle as it is). The seed now gives Illidan the boss
  icon, two Flames and three tanks (Tank 1 Illidan, Tank 2 / 3 one Flame each).
- **Effects round an icon scale with the icon.** The "me" ring and glow (with its pulse), the selection glow,
  drop shadows and outlines of tokens / slots / icons / marks / ring members were fixed px, so a small icon
  got a huge glow and a big one almost none (measured glow:icon 0.95 at 50 % vs 0.24 at 200 %). They are now
  shares of the icon's own size (`effectMetrics` in `lib/raidplan/labelScale.ts`, set as
  `--rp-ring/--rp-glow/--rp-gsp/--rp-sel/--rp-shd/--rp-out` by `PlanBoard`): glow:icon = 0.47 and ring:icon =
  0.079 at every element size, symbol size (40 to 100 %) and zoom. The name label gap was measured too (0.08
  icon widths below the icon edge, for slots, tokens and ring members, all sizes and zooms): it was already
  proportional and never inside the icon.

## Unsaved changes stand out (plan and template editor)

`pages/raid-detail/raidplan/SaveState.tsx` (both editors): with unsaved changes the sticky tool bar gets an
amber outline with a soft pulsing glow (static with `prefers-reduced-motion`), a strip at its top
"Ungespeicherte Änderungen · in n Abschnitten · Jetzt speichern · Strg+S" (`role="status"`, `aria-live`), the
save button turns amber with a dot and "Speichern", and every boss chip with changes gets an amber ring and
dot (`lib/raidplan.dirtyKeys`, its label says "ungespeichert"). The tab title starts with "● ", Ctrl+S / Cmd+S
saves (the browser's "save page" is suppressed), leaving the page (reload, close, another address) asks via
`beforeunload`. Saved: a calm green "Gespeichert" with a short flash. A conflict (409) is red instead of
amber. In-app navigation inside the menu (the router is a plain BrowserRouter without blockers) is not
intercepted. Tests: `src/web-client/src/lib/raidplan/saveState.test.ts`.

## Round 13 (feature/raidplan-13): one mob of several, the zoom as in the sheet, options of a multi-selection

### One mob of several

Two Flames of Azzinoth placed on the map are two targets, not one kind. A mob target can name ONE placed icon:
`{ kind: "mob", ref, name, icon, n, oid }` — `oid` is the id of the icon on the board (`board.icons[].id`, an
icon placed for that mob: `mobId === ref`), `n` its number there ("Flame 2" = the second visible icon of that
mob in the board's order), stored for the label where the map is not at hand.

- **Where it is written:** as soon as a mob stands on the map twice or more, the assign dialog offers one tile
  per icon ("Flame of Azzinoth 1", "Flame of Azzinoth 2"; `lib/raidplan/autoPlace.ts mobTargetsFor`, tile key
  `mob|<ref>@<oid>`, `lib/raidplan/assignModal.ts targetKey`) and hides the old "Anzahl" / "Nr." block for that mob —
  one mark per tile. The map's menu offers "Tankt → Flame of Azzinoth 2" on a tank, and "Tank wählen …" on an
  icon makes a row for exactly that icon. A hand-placed icon's tooltip carries its number.
- **Auto placement** (`deriveAuto`): a target with an `oid` whose icon stands there is played by exactly that
  icon (key `m:<ref>@<oid>`, never stored in autoPos); targets of the kind take the icons nobody named, in the
  board's order, and are called by that icon's number. `count` = at least the icons on the map.
- **Facing** is the same everywhere (editor, template editor, sheet): `autoFacing` for the icons the rows
  know, `lib/raidplan/assign.ts facingOf` otherwise — an icon a row names turns to that row's tank only; the rows of
  the kind turn the remaining icons (in the board's order, as before). `tanksOfMob(board, mobId, iconId)`,
  `followsTank` follow the same rule.
- **Labels:** `resolveTarget` names an `oid` target by the icon's live number when the section's icons are in
  the context (`AssignCtx.icons`: panel, dialog, "Meine Aufgaben", the sheet), else by its stored `n`.
- **Older plans keep working:** a target of the kind (no `oid`) still means the mob as such — for every icon
  nobody named. **Server** (`raidplanAssign.cleanAssignments`): `oid` is kept (`[\w-]{1,24}`), a row may hold
  the kind and each icon once; `raidplanBoard.cleanBoard` drops an `oid` whose icon is gone or stands for
  another mob (the target means the kind again, its `n` stays); `reidBoard` (a template applied) moves the
  `oid` to the icon's new id.
- Tests: `src/web-client/src/lib/raidplan/mobInstances.test.ts`, the `oid` part of `test/services/raidplan/raidplanBoard.test.js`.

### The zoom as in the sheet

A board's saved cutout (`board.view` = `{ zoom, cx, cy }`, "Ausschnitt als Standard speichern") is what the
sheet opens a section with. The editor now opens a board with it too (`BoardWorkspace`:
`bv.set(viewFromSaved(board.view))` on a section change and whenever the saved cutout changes — saving,
removing, undo), in the same reference space: the view is fractions of the board, so a bigger or smaller board
shows the same cutout. Zooming in the editor is still possible and stays a working view; then ONE button "Wie
im Sheet" appears in the zoom group (`ZoomControls` `sheetView` / `onSheetView`, `lib/raidplan/boardView.ts sameView`)
and goes back. The fit button no longer claims to be "as the sheet shows it" ("Ganze Karte einpassen").

### Options of a multi-selection

The inspector of several selected objects (`MultiInspector`) shows, besides size, opacity, lock, hide, align
and the actions, every option ALL of them have (`lib/raidplan/multiSelect.ts sharedOptions`): ring / border (tokens,
slots, icons, zones, the tank rows' objects), name (tokens, slots, icons, auto objects), colour (zones, lines,
texts), and for boss / mob / enemy icons and the mobs of the tank rows the **facing target** ("Zum eigenen
Tank drehen" or one of the eight directions for all) and the **arrow** (size, hidden, colour, opacity).
`optionSummary` shows a value when all agree, else "gemischt" (in the label, a tri-state checkbox);
`setLookSelection`, `setColorSelection`, `setFacingSelection`, `patchArrowSelection` apply a change to every
selected object that has the option (locked ones keep theirs) — one board change, so one undo step. "Zum
eigenen Tank" follows the rule above: with several Flames each turns to the tank of that very icon. No native
selects; the compass is buttons. Tests: `src/web-client/src/lib/raidplan/multiOptions.test.ts`.
