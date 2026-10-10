# Raidplan: animations

Part of the raid plan docs, see [the entry page](../raidplan.md) for the other parts. Endnutzer-Sicht: siehe
[guide-web-admin.md#raidplan](../guide-web-admin.md#raidplan). Epic #709.

An animation ("Szene") explains a task in motion on the board of a section: Bloodboil hits the group at the back, it runs
to the front, the next group falls back; a tank kites the Flames of Azzinoth round the room. The raiders play it in the
sheet (`/p/<token>`).

## Decisions

- **Frames ("Takte") as the surface, a timeline as the model.** A scene is a row of frames (key moments); a frame holds
  only what changes, the player blends between them. Every frame carries its **start time** `at` in seconds and every
  change its own `delay` and `dur` in seconds, so a scene already *is* a timeline: a later "expert timeline" view would
  edit the same data, without a migration. Nothing in the model may depend on frame indexes as time.
- **Fine timing per object** (delay, duration, easing) so a swap does not look robotic: group 4 starts half a second
  after group 3.
- **Paths and loops** for movements that are not a straight line or not tied to frames (kiting, #712).
- **The actors are board objects** (slots, group markers, role groups, icons, marks, zones, lines, texts, auto tanks /
  mobs, tokens). A scene in a template names slots and groups, never players, so it works in every raid.
- **One renderer:** the pure function `boardAt(board, scene, t)` returns the board as it looks at `t`; editor, template
  and sheet hand it to the same `PlanBoard`.
- **Discord export** (GIF/MP4 for the assignments post) is planned as #714 and **deferred**.

## Data model

`board.scenes` (`src/services/raidplan/raidplanScenes.js`, part of `cleanBoard`, so plans and templates alike):

```
scene  { id, title, loop, length, stepId, frames: [frame], loops: [loop] }
frame  { id, at, caption, changes: [change] }
change { obj, x?, y?, path?, rotation?, opacity?, scale?, hidden?, badge?, pulse?, delay, dur, ease }
loop   { id, obj, path: [[x, y]], closed, period, from, to, trail }
```

- `obj` = `"<kind>:<id>"`: `token:<userId>`, `slot:<id>`, `icon:<id>`, `mark:<id>`, `zone:<id>`, `line:<id>`,
  `text:<id>`, `auto:<key>` (an object the tank rows put on the map, the keys of `autoPos`) or
  `member:<slotId>~<userId>` (**one raider of a group marker**, #722: only for a group marker of the board and a player
  of the lineup, so a template has none; a copy renames the slot part with its marker). A reference to an object the
  board no longer has is dropped on every save (a player outside the lineup has no token, so nothing of his stays); an
  `auto:` key is only checked for its form (the rows derive those objects).
- `x`/`y` 0..1 like every board point (a zone's is its top-left corner, a line's its middle); `rotation` 0..359;
  `opacity` 0.1..1; `scale` 0.25..4 of the object's own size (a zone grows round its middle, a group marker also scales
  its ring); `hidden` true fades out / false fades in; `badge` a WoW icon name shown on the object (`""` takes it off);
  `pulse` a pulsing ring. `path` = points a movement passes (a Catmull-Rom curve through them, by its length).
- `delay`/`dur` 0..60 s in tenths (defaults 0 / 1), `ease` `inout` (default) | `linear` | `in` | `out`.
- Frames are kept in time order; the first starts at 0, each later one at least 0.1 s after the one before. `length`
  is at least 0.1 s after the last frame (default: 2 s after it), at most 600 s.
- One change per object per frame (the first wins) - the editor merges the fields of an object into one change.
- `stepId` = a tactic step of the board the scene stands at (kept only while the step exists, #713).
- A loop needs at least two points; `period` 1..600 s is one round, `from`/`to` when it runs (`to` 0 = until the end),
  a closed path goes round, an open one there and back; `trail` draws where the object was a moment ago.
- Limits: 8 scenes per board, 24 frames per scene, 60 changes per frame, 16 path points, 12 loops with 24 points,
  title 60 and caption 120 characters.
- **Copies** (`reidBoard`, a template applied to an event, a template duplicated): scenes, frames and loops get new
  ids, every `obj` follows its object to its new id, a moved auto tank follows its row, `stepId` follows its step, a
  token reference is not copied (templates hold no players).
- **Sheet:** `publicView` sends `scenes` of a section with its map (none with "Karte aus"); a reference to an object the
  sheet does not show (hidden, a raider outside the approved setup) simply moves nothing.

## Playing (`src/web-client/src/lib/raidplan/scene.ts`)

- `boardAt(board, scene, t, autoAt)` - every change of a frame starts at `at + delay` and ends `dur` later; values are
  blended per property; **a change that starts while the one before it still runs takes over from where the object is
  at that moment** (timeline semantics, also when frames overlap). A badge and a pulse switch when their change starts.
  A loop wins over the frames while it runs. Objects the scene does not name are returned as they are; the input board
  is never changed. `autoAt` = where the tank rows put their objects without the scene (`autoAtOf(deriveAuto(...))`),
  so an auto tank can be moved from there; the result's `autoPos` / `autoStyle` then carry it (a turned one loses its
  automatic facing).
- **A single raider** (`member:`, #722) stands in his group's ring and goes where the group goes until a change of his
  starts; then he walks from where he is to an **absolute** place and stays there even when his group moves on. The
  board keeps a raider's place as an offset to the marker, so the result is written into the slot's `offsets` relative
  to where the marker stands at that moment, marked `away` (never stored): his group's ring then keeps its size instead
  of stretching to him. Where the ring puts a raider without an offset depends on the drawn board, so the caller hands
  it in: `boardAt(…, autoAt, memberAt)` with `memberAt = memberOffsets(board, roster, aspect)`
  (`lib/raidplan/members.ts`, the same layout `PlanBoard` draws; `aspect` from `PlanBoard`'s `onAspect`). Members can
  move, carry a badge, pulse and run a loop; they do not fade, turn or scale.
- `boardAfter(board, scene, k)` - frame k with everything of frames 0..k arrived and no loops: what the editor edits.
- `frameAt`, `frameRest`, `frameLength`, `playable` (at least two frames or a loop), `clock`.
- `useScenePlayer` (hooks) runs the time with `requestAnimationFrame`: play / pause, seek, to frame k, speed 0.5x / 1x /
  2x, loop (default: the scene's own). With `prefers-reduced-motion` the sheet shows frame by frame (`boardAfter`) and
  the badge / pulse animations are off.
- `PlanBoard` draws the effects (`fx`, `trails` props): the badge at the upper left of an object, the pulse as a ring;
  on a **split group** both sit on each of its raiders (a group gets Bloodboil: every member shows it).

## In the sheet (`/p/<token>`)

A section with a playable scene shows **"Animation ansehen"** (several: "Animationen (n)") at the top of the map, in the
middle (the bottom belongs to "Deine Aufgaben" and the zoom). It opens the player
(`components/raidplan/ScenePlayerBar.tsx`): the scenes as tabs, back / play-pause / forward by frame, the time line with
a dot per frame (a click jumps there), the time, the speed, **"Meine Gruppe hervorheben"** (only for a visitor who stands
in the plan: his group stays bright, the others dim - the same `focusGroup` as the bar's group chips), the loop and
"Schließen" back to the plan. The caption ("Takt 2 von 6" + the frame's sentence) takes the button's place at the top.
While it plays, the assignment lines are hidden, "Deine Aufgaben" makes room for the bar and the zoom stands above it;
switching the section closes the animation. Phone: the bar takes the width at the bottom.

**At tactic steps (#713):** a scene with a `stepId` puts **"Animation"** into its step's line in "Alle Aufgaben"
(`ReadSteps` - in "Was tue ich?" and in "Alle Schritte"); a click plays that scene, and a panel that lies over the map
closes for it ("Karte daneben" keeps it open beside the map). In the editor the scene's step is chosen in the panel
("Gehört zum Taktik-Schritt", the board's steps by number and sentence), and the step's line in the task view carries a
small clapperboard with the scene's title as its tip. Copies keep the link (`reidBoard` renames the step and the scene's
`stepId` together); a scene whose step was deleted loses the link on the next save.

**Reuse:** a raid plan template carries its scenes (applied to an event or duplicated, every reference follows its
object). The tactic library (profiles) does not: a profile holds steps without a board, and a scene names board
objects - mapping them onto another board (by slot kind and number) is a follow-up of its own (#719).

## In the editor (view "Animation", #711)

The third view of a section next to "Aufgaben | Karte" (`#view=anim` in the address, remembered like the others; Standard
and Allgemein have none, "Karte aus" shows the note). `components/raidplan/editor/AnimWorkspace.tsx` +
`AnimPanel.tsx`, the pure editing in `lib/raidplan/sceneEdit.ts`; template editor and event plan alike.

- **No scene yet:** an explanation (what an animation is, the three steps) and "Neue Animation".
- **Head:** the scenes as chips with their length, "+ Neue Animation" (at most 8), "Vorschau" (plays the scene with the
  sheet's player and caption; editing is off meanwhile).
Since #722 the view follows **design B "Aktionen als Sätze"** of the canvas "Animation zuweisen": who an action is given
to is always visible, a frame reads as sentences, and a new action is built Wer → Was → Wohin. The pure parts are in
`lib/raidplan/sceneActions.ts` (actors, sentences, applying to several) and `lib/raidplan/members.ts` (the ring).

- **Board:** the board **after the chosen frame** (`boardAfter`). **Picking:** a click on an object picks it; a click
  on a raider of a split group picks **his whole group**, **Alt + click only him** (`member:`), **Shift + click** adds
  or removes. The picked light up (`PlanBoard`'s `lit`: a glowing ring, everything else dimmed to 30 %; a picked group
  lights all its raiders) and a label over them names them ("Gruppe 3 · 5 Spieler" + the names, "Heilbert · aus Gruppe
  4", "2 Gruppen · 10 Spieler"; `selectionSummary`). **A drag moves everyone picked in this frame** by the same distance
  (one change each, live, one undo step); a grip (size, turn, corner) only picks. The dotted way (`moveHints`) shows
  where each moved object comes from. The board itself never changes - only the scene.
- **"Wer?"** under the map (`ActorPicker.tsx`, `sceneActors`): everything that can act, in sections - groups (a picked
  group opens its raiders as chips "Einzeln:", each pickable alone; a group that lists its names below the marker has
  none and says how to split it), players and places (free tokens, role slots on the map, the rows' tanks), enemies
  (icons with their mob's name, the rows' mobs), marks and areas. A dot marks who already acts in this frame.
- **Frame strip:** a card per frame (number, start time, length, caption, **who acts** as coloured chips), "+ Takt".
- **Panel:** the frame ("Takt n von m", caption, length with −/+ - later frames move with it -, earlier / later = swap
  with the neighbour, "+ Takt danach", delete - asks when something changes there); **"Was passiert in diesem Takt"**
  (`ActionList.tsx`, `frameParts`): every part of every change as a sentence - "Gruppe 3 läuft nach links" (the way in
  a word, `direction`; a thing "bewegt sich"), "… bekommt Bloodboil", "… pulsiert", "… verschwindet", "… dreht sich auf
  90°" - with when ("sofort", "nach 0,4 s"), how long, the motion and the way's points, plus the loops that start in the
  frame ("… läuft einen Rundweg"). A click on a sentence picks its actor; the pencil opens what can be set right there
  ("Startet nach", "Dauert", "Verlauf" - shared by everything that actor does in the frame -, "Weg zeichnen" / "Gerade",
  the debuff icon, facing, opacity, size, a loop's settings); the bin takes that part off (`removePart`). At the bottom,
  folded, the animation's settings (name, "Im Sheet wiederholen", its tactic step, delete after asking).
- **"+ Aktion"** (`ActionWizard.tsx`, state in `wizardState.ts`): **Wer** (with nothing picked it waits, "Wer?" is
  framed; the head always names who) → **Was** (Laufen, Debuff bekommen - six presets or any WoW icon, "auch pulsieren"
  -, Ausblenden - verschwinden / erscheinen / halb durchsichtig -, Drehen, Rundweg, Pulsieren; a single raider cannot
  fade or turn, only icons, areas and the rows' objects turn) → **Wohin** for walking (a click on the map: everyone
  picked walks so that their middle ends there, each keeping his place, `moveAllTo`) and for a loop (clicked points, a
  loop for each picked along that way shifted by his place, from the frame's start, `loopAll`). Other kinds are added
  for everyone picked at once (`patchAll`). Esc closes it.
- **Timeline rules of the editing** (`sceneEdit.ts`): a new frame starts where the scene stands after the chosen one and
  pushes the later ones back by its length; removing a frame pulls them forward (the first one left starts at 0); a
  longer or shorter frame moves the ones after it; swapping frames swaps their content, the times stay. A change in the
  first frame takes no time (the starting position); a new change of a later frame takes one second (at most the frame).
- **`boardOf` keeps `scenes`** (`lib/raidplan/model.ts`) - without it a save from the editor would drop them.

### Ways and loops (#712)

Since #722 a loop is made with the assistant's "Rundweg" and edited with the pencil of its sentence; a movement's way is
drawn with "Weg zeichnen" in its sentence. The mechanics below are unchanged.

- **The way of a movement:** an object that moves in the chosen frame (not the first) gets "Weg zeichnen" in the panel.
  While drawing, the board has a crosshair and an accent frame; a click on the map (capture phase of the board's wrapper,
  so nothing is picked or moved meanwhile) adds a point **between the neighbours it lies closest to**
  (`insertIndex`: the movement's start and end count as the ends of the polyline), so a point clicked in the middle of the
  curve stays there. Every point is a grip (`PlanBoard`'s `overlay` prop, `.rp-path-pt`): drag moves it (live, one undo
  step), a double click removes it; "Gerade" clears the way; Enter / Esc / "Fertig" end the drawing (a new frame, object
  or scene too). At most 16 points.
- **Loops ("Dauerbewegung"):** "+ Dauerbewegung" on the picked object creates a loop that starts **where the object
  stands after this frame** (first point, drawn hollow) at the frame's start time, and opens its drawing at once
  (`newLoopId` is picked before the edit). A click adds a point: with one point it is appended, then it goes into the
  closest segment, the closing one too (`loopInsertIndex`; an open path clicked beyond its end grows there). The loop's
  card: its points, "Weg zeichnen / Fertig", remove, "Rundweg" (off = there and back), "Eine Runde" (s), "Läuft ab" and
  "Endet bei" (0 = at the end of the scene), "Spur zeigen". The picked object's loops are drawn as dotted curves
  (`loopHint`) with their grips. At most 12 loops per scene, 24 points each; a loop with fewer than two points is
  dropped by the server on save.

## Dev demo

`node scripts/seed-test-raid.js` gives the template "BT Demo" two scenes:

- **Gurtogg Bloodboil:** five split group markers and "Bloodboil-Rotation" (6 frames: the group at the back gets
  Bloodboil, runs to the front on a curve, the next one falls back half a second later, twice).
- **Illidan:** "Flammen kiten" (4 frames and 4 loops): Illidan flies up (faded, smaller), two Flames of Azzinoth appear
  with a fire badge and a pulse, they move to tank 2 / tank 3, then each tank kites a round on its half of the room and
  its flame follows a second behind on the same path, leaving its Blaze as a trail.

## Tests

`test/services/raidplan/raidplanScenes.test.js` (validation, limits, the board's cleaning, `reidBoard`),
`test/web/apiRoutes/raidplan.templates.test.js` (the sheet sends the scenes, none without the map),
`src/web-client/src/lib/raidplan/scene.test.ts` (easing, blending, take-over, paths, loops, auto objects, frames),
`src/web-client/src/pages/raidplan/PlanPublicPage.anim.test.tsx` (the player in the sheet, a step's "Animation", the group highlight),
`src/web-client/src/lib/raidplan/sceneEdit.test.ts` (editing on the timeline),
`src/web-client/src/lib/raidplan/sceneActions.test.ts` (actors, the ring of a group, sentences, directions, one action
for several), `test/web-client/conventions/controls.test.js` (a disabled text field carries no dropdown arrow),
`src/web-client/src/components/raidplan/editor/BoardWorkspace.anim.test.tsx` (the editor's view: create, drag and read
it as a sentence, the assistant for a debuff, walking and a loop, a group vs. a single raider by click, Alt + click and
"Wer?", changing and removing an action, preview, the step a scene stands at, delete).
