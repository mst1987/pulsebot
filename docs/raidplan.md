# Raidplan

The raid plan of an own event: **one plan per event, one board per boss** — the room map as the background, player tokens placed freely on it, target rows with the players assigned to them, and a note. It sits next to the Google raidsheet (`fillSetup`, `eventSheetStore`), which stays unchanged and independent. The design canvas it follows is the "Raidplan" artifact (Boards, Editor, Sheet view).

## Where it lives

| Piece | File |
|---|---|
| Plan store, validation, room maps | `src/web/raidplanStore.js` |
| The board of one boss (validation, slot auto-fill), shared by plans and templates | `src/web/raidplanBoard.js` |
| Tactic profiles (collection store) | `src/web/raidplanProfileStore.js` |
| Raid plan templates (collection store) | `src/web/raidplanTemplateStore.js` |
| What the editor and the public page are shown | `src/web/raidplan.js` |
| API | `src/web/apiRoutes/raidplan.js` (routes in `apiRouter.js`, areas in `apiAccess.js`) |
| Room-map delivery | `/rp-map/<instance>[/<boss>]` in `server.js` |
| Editor (tab of the raid detail) | `src/web-client/src/pages/raid-detail/RaidplanTab.tsx` and `raidplan/` |
| The working area of a boss, shared by the event editor and the template editor | `raidplan/BoardWorkspace.tsx` (+ `Palette.tsx`, `Inspector.tsx`, `LayerList.tsx`, `MapPanel.tsx`, `ContextMenu.tsx`, `useDraftHistory.ts`) |
| Template admin page (`/raids/plan-templates`) | `src/web-client/src/pages/RaidplanTemplatesPage.tsx` |
| Board, token, slot, zone, player icon (both editors and the read view) | `src/web-client/src/components/raidplan/PlanBoard.tsx`, `MarkIcon.tsx` |
| Read view | `src/web-client/src/pages/PlanPublicPage.tsx`, route `/p/<token>` |
| Pure board logic | `src/web-client/src/lib/raidplan.ts` |
| Styles (prefix `rp-`) / texts | `styles/raidplan.css` / `i18n/locales/{de,en}/raidBoard.json` |

Only an **own event** has a raid plan (the tab is hidden for a Raid-Helper event, the API answers 409): the players come from the event's setup, which only own events have.

## Data model

`data/settings/raidplans.json`: `{ plans: [{ eventId, version, status: "draft" | "published", publicToken, templateId, bosses, updatedAt, updatedBy }] }`, `bosses[bossKey]` = a **board** (`raidplanBoard.js`, one shape for plans and templates):

- `tokens` `[{ userId, x, y }]` — free player tokens (plans only);
- `slots` `[{ id, kind, n, label, x, y, userId, size, hideMembers, split, offsets }]` — placeholders: `tank`/`healer` 1..n, `melee`, `ranged`, `dps` ("DPS (egal)": any damage dealer), `group` (a marker for setup group `n`, it names that group's players) and `label` (free text). `userId` is who stands in it (`""` = open); a template's slots never have one. `hideMembers`, `split` and `offsets` only matter for `group` (see "Group markers");
- `icons` `[{ id, iconKey, label, showLabel, x, y, size, rotation }]` (at most 60) — placeable pictures. `rotation` is the way a boss / enemy / position icon **faces**, whole degrees 0..359 (0 = up / north, clockwise; anything else is normalised, `normAngle`); `showLabel` (default off) decides whether `label` is drawn next to the icon. `iconKey` is `boss:<npcId>` (a boss icon of the raid's instance), `enemy`, `bosspos` (a generic marker) or `wow:<icon name>` (a WoW icon by its file name, e.g. `spell_fire_fireball`, shown from the Wowhead icon CDN like every other spell icon);
- `marks` `[{ id, mark, x, y }]` — the eight raid target marks (`skull cross square moon triangle diamond circle star`);
- `zones` `[{ id, shape: rect|ellipse, type: danger|healthy|neutral|custom, label, color, x, y, w, h }]` — x/y is the top-left corner; a new zone gets its type's preset colour (`ZONE_COLORS`), any `#rrggbb` is accepted;
- `lines` `[{ id, kind: arrow|line, x1, y1, x2, y2, color, width }]` (width 1..12 px) and `texts` `[{ id, text, x, y, color, size }]` (size 10..48 px, text up to 60 characters, an empty text is dropped);
- **every object** (token, slot, mark, zone, line, text) also has `opacity` (0.1..1, clamped; zones start at 0.3, the rest at 1), `lock` (cannot be moved or scaled) and `hidden` (not drawn; the layer list switches it back on). **Colour and opacity are separate fields**; the board has its own `mapOpacity` (0.1..1) that dims the map. Order = array order within a kind; the kinds are layered zones < lines < marks < slots < texts < tokens;
- **Sizes:** tokens, slots, marks and icons carry `size` in px (per kind a range, `SIZE_RANGES`), a text its `size` (font), a zone its width/height, a line its thickness. The board has `objectScale` (0.5..2) that scales all of them at once (CSS variable `--rp-s`); it never changes the stored sizes.
- `targets` `[{ id, title, userIds }]`, `notes`, `profileId`.

**Icons on the board:** boss, enemy and position icons are drawn **round** (circular crop, thin border) and upright; a small wedge on the rim shows the facing (only the wedge turns, never the picture). A spell icon by name stays square and has no facing. Turning: the round handle above the selected icon (drag around the centre, Shift = 15° steps), the "Blickrichtung" field (0–359) and eight compass buttons in the inspector, the eight "Blick nach …" entries of the right-click menu, and Q / E (15°, with Shift 45°). Pure maths (`normAngle`, `angleTo`, `snapAngle`, `compassName`, `turnIcon`) is in `lib/raidplan.ts`.

**No automatic labels on the board:** only what was typed is drawn (`slotBoardLabel`, `zoneBoardLabel`, `iconBoardLabel`, `textShown`). No "Tank 1", no zone type, no icon name: an open role slot shows just its role icon, a filled slot the player's name and spec icon, a zone its pattern and symbol (the type stays readable without text), a group marker its label — a new one starts with an editable "Gruppe n", cleared it shows a small group icon. An empty text object is not drawn (only while selected). The layer list, tooltips and screen readers still use the type name (`slotTitle`, `objectName`), and the inspector shows it as a placeholder. Editor, templates and the read view use the same `PlanBoard`.

**Role slots (melee / ranged / dps):** a raider's role comes from the spec roles that already exist in `classes.js` (`resolveRole(placedRole, spec)` in `raidplan.js`): a spec is classified melee or ranged only when the data says so, otherwise it counts as plain damage dealer and is never put into a melee or ranged slot by guess. `fillSlots` fills in the order tank, healer, melee, ranged, dps; a `dps` slot ("DPS (egal)") takes whatever damage dealers remain. Colours: tank blue, healer cyan, melee orange, ranged violet (drawn with a double ring), dps yellow.

**Group markers:** a group slot shows the tag and, below it, the list of that setup group's raiders. Two independent switches: `hideMembers` shows the tag only (wins over `split`); `split` draws the raiders as their own tokens on a ring around the tag, leaving out those who already stand in another slot, and they are not listed in the "not placed" tray. Each token has an offset relative to the tag in `offsets[userId] = { dx, dy, size }`, so moving the tag moves them all and a token moved by hand keeps its place relative to the tag. The read view draws the same.

- **Players are only a `userId`.** Name, class, spec, role and icon are looked up in the event's setup on every read (`raidplan.js`'s `rosterFrom`), never copied into the plan — so a changed spec follows on its own. `x`/`y` are relative to the board (0..1).
- **Boss key** = `<instanceId>/<slug of the boss name>` (`bt/gurtogg-bloodboil`), from the instances of the event (`event.instanceIds` → `config/gameVersions`, `bosses`). Stable across renames of the display label; an event without an instance has no bosses (the tab says so).
- **Strict validation on every save** (`raidplanStore.cleanBosses`): coordinates clamped, at most 60 tokens, 60 slots, 40 marks, 30 zones, 40 lines, 40 texts, 30 rows and 25 players per row per boss, titles 80, labels 40 and notes 1000 characters, an unknown slot kind or mark is dropped, a zone keeps a minimum size and stays on the board, a player takes one slot per board (a second one is left open), a `userId` that is not in the event's current lineup is **dropped** (counted in the answer's `dropped`, the editor says so) instead of blocking every later save, a boss the event no longer has is dropped, a row id that is unusable is replaced, an untouched boss is not stored, a `profileId` that no longer exists is forgotten.
- **Version check:** `PUT` carries the `version` it read; a stale one answers `409 conflict`, the editor keeps the unsaved draft and offers "Neu laden". Nothing is written before "Speichern".
- **Who is offered:** the editor (raids) sees the current lineup — the draft when there is one, else the approved one. The **read view names only players of the *approved* setup** (a raider never sees a setup draft, see docs/setup.md); a token of somebody who is only in the draft is left out there, and the share dialog says so.

## Room maps

There are **no maps in the repo** and nothing is fetched from anywhere; the orga uploads them.

- **Which map a board shows**, most specific first (`raidplanStore.mapForBoss`): this plan's own map (`e/<eventId>/<boss>`) > the template's map (`t/<templateId>/<boss>`) > the boss's default map (`<instance>/<boss>`) > the instance's default map (`<instance>`) > the grid placeholder. The map dialog lists each level that applies; removing an override reads "Auf Standard zurücksetzen". The template's map is looked up live (deleting the template deletes its maps).
- Per boss and per instance (the defaults; the fallback of every boss without its own): `POST /api/raidplan/map?key=<key>` with the **file as the request body** (`readRawBody`, cut off at 3 MB), `POST /api/raidplan/map/delete { key }`. Area `raids` write. The key must be a known instance id or boss key, optionally scoped with `t/<templateId>/` or `e/<eventId>/`; a scoped key is only written for a template that exists or an own event, so no path can be built from it.
- The server recognises PNG, JPG and WebP **by the first bytes** (`sniffImage`), never by the claimed type; SVG and everything else is refused. Stored in `data/raidplan-maps/<key with / as __>.<ext>`, one file per key (a new upload replaces the old one, whatever its type).
- Delivered at `/rp-map/<key>` without a login (the public page shows them too), `Cache-Control: public, max-age=86400`, `X-Content-Type-Options: nosniff`. The url the API hands out carries `?v=<mtime>`, so a new upload is never hidden by the cache.
- Without a map the board shows a neutral grid with the boss icon.

## Raid plan templates

Admin page **Raid-Events → Raidplan-Vorlagen** (`/raids/plan-templates`, area `raids`; list first, `?edit=<id>` is the editor, `?edit=new` the create dialog). A template is a named layout — "Montags-Raid" — that lays out the coarse plan **without players**: per boss placeholder slots, raid marks, zones, target rows and a note. `data/settings/raidplan-templates.json`: `{ id, name, category, description, guildId, instanceIds, bosses, version, updatedAt }`.

- `guildId` is optional (the Discord event server it is for; "" = every server). A template made for another server is not offered for an event on this one and cannot be applied to it. `instanceIds` (at least one) decide which bosses can have a board; changing them drops the boards of bosses no longer covered.
- **No players in a template:** `cleanBoard` runs with an empty set of allowed players and no free tokens, so a slot's `userId`, tokens and row assignments are always emptied. Its own room map per boss is uploaded in the editor (`t/<id>/<boss>`).
- Saving the boards needs the `version` that was read (409 `conflict` otherwise); renaming and the other fields do not.
- **Applying** (`POST /api/raidplan/apply { event, templateId, version }`, or "Vorlage wählen" in the event's Raidplan tab; the default is "Leer" = no template): `raidplanStore.applyTemplate` copies the template into the plan **as a snapshot** — every boss the template and the event both have gets the template's board (new ids, no tokens), other bosses are left alone, `templateId` is remembered for the display, the plan's version bumps. **There is no live link:** changing or deleting the template afterwards never reaches a plan that already exists (only the template's map is looked up live). The editor asks first when the plan already holds something or has unsaved edits.
- **Slots are filled from the setup** (`raidplanBoard.fillSlots`, from the editor's roster in setup order): `tank n` gets the tanks in order, `healer n` the healers, `melee` and `ranged` the damage dealers of that role, `dps` the remaining ones; a slot nobody fits stays **open** and is marked on the board (dashed role icon, "N Slots offen" in the tool bar). A `group n` marker needs no filling: it names the players of setup group `n`. A label slot is filled by hand.
- **The overview** (`TemplateList` in `RaidplanTemplatesPage.tsx`) shows one card per template, newest change first: a thumbnail (the first filled boss, drawn by the board itself, read-only), name, chips (category, server, instances), a segment per boss (filled or not), "N Bosse befüllt" (real de/en plurals) and the date of the last change. The whole card opens the editor. Icon actions: properties (name, category, server, instances), duplicate, delete (a confirmation names what is lost). Search over name, category and description, filters by instance and category, an empty state with a call to action. Duplicate = `POST /api/raidplan/templates/duplicate { id }` (copy "<name> (Kopie)", new ids, the template's maps are copied); delete = `DELETE /api/raidplan/templates { id }` (its maps go with it, applied plans keep their copy).
- After applying, everything is adjusted one by one in the event plan: reassign a slot (dialog, or drop a player from the list onto it), move or delete slots, marks and zones, add new ones, edit the rows.

**Templates and tactic profiles complement each other, and are kept simple:** a template is the *layout of the board* (where things stand), a tactic profile is a *snippet of target rows* (titles + note, by category) that can be picked on any board — in a template as well as in an event plan. Applying a template copies its rows (and its `profileId`); picking a profile afterwards replaces the rows as before.

## Tactic profiles

A named, categorised set of target rows the orga picks for a boss instead of typing the rows again. `data/settings/raidplan-profiles.json`: `{ id, name, category, bossKey, targets: [{ title }], notes, updatedAt }`.

- `category` is free text (the editor offers the ones in use and lets a new one be typed); `bossKey` is `""` (every boss), an instance id, or one boss.
- **Nothing is shipped** and no boss mechanics are invented; a profile holds only what the orga wrote. Titles only: **who stands on a row is decided per plan**. A token layout is not part of a profile (follow-up).
- API (area `raids`, GET reads, the rest writes, CSRF): `GET/POST/PATCH/DELETE /api/raidplan/profiles`. The editor payload carries the list too.
- In the board: "Taktik wählen" opens the picker (the profiles that fit the boss, grouped by category, with a search). Picking one **replaces the rows and the note** (asked first when the board already holds something; players stay on rows whose title stays) and remembers the `profileId` in the plan. "Als Taktik speichern" (from the rows on the board) and "Taktiken verwalten" sit in the picker's foot. Managing follows the collection pattern of docs/web-admin.md: **list first, one editor at a time**; a profile's rows are edited as one title per line. Renaming or changing a profile does not touch rows that were applied earlier — the plan stores copies plus the profile id; the read view shows the profile's current name.

## Editor

Raid-Detail › tab **Raidplan** (own event, order Roster, Setup, Raidplan, Loot, Logs) and the template editor on `/raids/plan-templates?edit=<id>`. **Both stay inside the menu's normal page frame** (Shell, raid-detail hero and tabs / the ordinary page head, the 1080 px content width); only the public read view is its own, full-width page. What one edits is **always in view** — no edit hides behind a fold-away section or a dialog; dialogs are for the rare things (sharing, the template picker, managing tactic profiles).

```
[ sticky tool bar: undo redo | arrow line text rect ellipse | palette panel | status … template share save ]
[ boss chips ]
[ players not placed yet (event plan) ]
[ palette | the board | Eigenschaften · Hintergrund + Ebenen ]
[ target rows + note + tactic ]
```

- **Sticky tool bar** (icons with a tooltip and an `aria-label`, lucide): undo / redo (Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z; one history over all bosses, a drag or a run of keystrokes is one step — `useDraftHistory`, pure logic `historyRecord/Undo/Redo` in `lib/raidplan.ts`), quick inserts, fold-away toggles for the palette and the panel (for a bigger board), the state ("Gespeichert" / "Ungespeichert", published, open slots, template) and the page's actions as icons (template, share, save).
- **Palette (left):** the eight raid marks, the slots (tank, healer, melee, ranged, dps, group, label), **Encounter** (the boss icons of the event's instance, enemy, boss position), an **icon by name** field (type a WoW icon name, a preview shows it, then insert — a real search over names is a follow-up), zones (four types, rectangle or ellipse) and shapes (arrow, line, text). **Drag an entry onto the board or click it** (Pointer Events; an entry that never moved is a click and lands near the middle). Not built yet: class/spec icons.
- **Scaling:** every object has a size in the inspector (slider + number), a corner grip on the selected object (a zone keeps its ratio with Shift), `+` / `-` keys, Alt + mouse wheel over the object, and the tab **Hintergrund** has "Objektgröße" for the whole board.
- **Board:** the room map, the zones, lines and arrows (an SVG drawn in pixels so an arrow head never stretches), marks, slots, texts and player tokens. **The board takes the aspect ratio of its map** (a near-square room gives a near-square board, without a map 16:10), so any map fits as a whole.
- **Right panel:** tab **Eigenschaften** = the inspector of the selection (name; a zone's label, type, shape, colour with the type's preset one click away, width/height in %; a line's kind, colour, thickness; a text's words, colour, size; a slot's number, own title and — in an event plan — the player; **opacity for every kind** as slider and number, 10–100 %; lock, duplicate, front, back, take the player out, delete as icons). Tab **Hintergrund** = the map's opacity ("abdunkeln") and the map rows (upload, replace, remove; an override's "Auf Standard zurücksetzen"). Under it the **layer list**: every object front to back, click to select, per row show/hide, lock, one step forward/back, delete.
- **Objects are moved with Pointer Events on window, no HTML5 drag and drop**, so a finger works like a mouse: palette entries and players from the list onto the board or **onto a slot**, objects around the board (they follow the pointer live, grip kept), a zone's four corner handles and a line's two end handles to scale/aim them, a token or a slot's player onto the list to take it off (the slot goes back where it was). `touch-action: none` on everything draggable. **Locked objects are selected but do not move.** A selected or focused object moves with the arrow keys (Shift = bigger steps), Delete removes it, Enter jumps to its properties.
- **Right-click menu** (`ContextMenu.tsx`, only on the board, the browser's own menu is suppressed there; **long press on touch**, 550 ms): on an object *Eigenschaften, Duplizieren, In den Vordergrund / Hintergrund, Sperren / Entsperren, Spieler zuweisen … / lösen* (slots of an event plan, tokens), *Löschen*; on the empty map *Hier einfügen: slot / mark / zone / arrow / line / text* (at the click position) and *Alles abwählen*. `role="menu"` / `menuitem` / `separator`; Up / Down / Home / End move, Enter or Space picks, Esc closes and gives the focus back; it is moved back into the viewport when it would not fit. What each entry is and does is pure and tested (`contextMenuItems`, `applyMenuAction`, `clampMenuPosition`).
- Tokens show the **real spec icon** in a role ring (tank blue, healer cyan, everything else orange) on a class-coloured tile. **A zone's type is a pattern and a label as well as a colour** (danger: diagonal stripes and ⚠, healthy: dots and ✚, neutral: dashed border, own: solid). Open slots show the role's WoW icon on a dashed ring.
- Rows: free title, players from the roster (a picker dialog), delete; "Taktik wählen" as before. "Freigeben & teilen" publishes/withdraws the *saved* plan.
- Without `raids` write everything is read-only.

**Raid marks:** the eight icons are the game's own `UI-RaidTargetingIcon_1..8` textures (64 px PNG), stored in `src/web-client/public/raidmarks/<skull|cross|square|moon|triangle|diamond|circle|star>.png` next to the boss icons. They come from the community texture mirror https://github.com/Gethe/wow-ui-textures (`TARGETINGFRAME/`), because the Wowhead icon CDN has no such files and Wowpedia / warcraft.wiki.gg block direct downloads (403). They are Blizzard's artwork (the mirror carries no licence of its own): they are used the way the boss and spell icons from the Wowhead CDN already are. No guide screenshots are used.

**Icons of the interface** are [lucide](https://lucide.dev) (`lucide-react`, ISC licence, tree-shaken: only the icons that are imported end up in the bundle, about 10 KB), as inline SVG components — no runtime CDN.

## Read view (`/p/<token>`)

The "Sheet-Ansicht": per boss the board — map at the full page width, with its **zones, raid marks, slots (resolved players, open ones dimmed) and group markers** — and under it the table of rows, the note and the tactic name. A slot whose player is not in the approved setup shows as open. Objects switched off in the layer list (`hidden`) are left out on the server, opacity and the map's dimming are applied as in the editor. **No login, no menu**: `App.tsx` answers `/p/<token>` before it asks for a session; the data comes from `GET /api/raidplan/public?token=…`, which is in `UNGATED` (`apiAccess.js`, see docs/permissions.md) and answers **one and the same 404** for an unknown token, a withdrawn plan and a plan whose event is gone. The token is minted on the first publish (18 random bytes, url-safe), kept while the plan is withdrawn, and rotated on request. The page carries nothing personal beyond the character names of the approved setup.

**Own token highlighted:** the endpoint reads the visitor's session if there is one (`auth.getUser`) and answers `me` = their Discord id when they stand in the plan; the page then rings their token, marks their rows and says so. A visitor without a login gets a "log in" link (the login returns to the menu start, not to the plan — a follow-up). It grants nothing: the highlight is the only thing a session changes.

## Permissions

All `/api/raidplan…` paths are area **`raids`** (read = GET, write = everything else), listed in `apiAccess.js` (fail-closed) except `/api/raidplan/public`. Mutating calls use `requireAdmin` + `requireCsrf`. Deleting an event deletes its plan (`eventManage.deleteEvent`).

## Tests

`test/web/raidplanBoard.test.js` (slots, marks, zones, auto-fill), `raidplanTemplateStore.test.js` (templates, apply, map order), `raidplanTemplateRoute.test.js`, `raidplanStore.test.js`, `raidplanProfileStore.test.js`, `raidplanRoute.test.js` (gate, editor payload, save/conflict, publish, upload, profiles, public view), the routing in `test/web/server.test.js`, `readRawBody` in `apiBody.test.js`, and `test/web-client/raidplan.test.js` (board logic run for real, structure of the pages, texts in both languages).
