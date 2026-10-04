# Raidplan: read views and sharing

Part of the raid plan docs, see [the entry page](../raidplan.md) for the other parts. Endnutzer-Sicht: siehe
[guide-web-admin.md#raidplan](../guide-web-admin.md#raidplan).

## The read view of the assignments

Readable width (`.rp-read-assign`, at most 1180 px; the board may stay wide), the assignments as **cards side
by side per type** (320-400 px, stacked on a phone), real WoW icons on everything (a row shows its spell's
icon or the icon a word in its task names — `TEXT_ICONS` / `iconForText` as the fallback —, a slot its role
icon, a group, a mark, a mob its own; the raider his spec icon). Above them the visitor's own block "Meine
Einteilungen" (`isMine` in `lib/raidplan/assign.ts`: assignee, target or a name mention in a note or free text). There
is no list of all tasks by player any more (removed: it repeated what the tables say); the derivation helpers
for it (`tasksByAssignee`, `myTasks`, `taskText`) are gone.

**Who is "you":** the visitor's own account, and every player of the approved setup whose character is on the
visitor's raider profile (mains and alts, case and realm ignored — `identify` in `raidplan.js`, `meIds` in the
payload), also when the setup lists the character under another account. Everything of these players is
highlighted: the token / slot / group on the map, the rows and chips. Without a login the page says so and
links to `/auth/login?next=/p/<token>`: after the Discord login the visitor lands on the same plan page
(`server.js` only takes such a `/p/<token>` path as `next`).

## Read view (`/p/<token>`)

The "Sheet-Ansicht", laid out as a **stage** ("Karte als Bühne", Oct 2026; design canvas "Raidplan-Ansicht
Redesign", sketch 3). The page is exactly the window (`.rp-sheet`, `styles/raidplan/stage.css`):

- **One bar** (`stage/StageBar.tsx`): the open section with its portrait, its place ("Hyjal · Boss 2 von 5",
  `lib/raidplan/stage.ts` `sectionPlace`) and arrows to the sections before and after it; "Alle N Abschnitte"
  opens `stage/SectionMenu.tsx` - every section in runs of one instance, with "Aufgabe für dich" (#503) and
  "besiegt" (#534) spelled out, "Nur für mich" at its foot (closed by `useDismiss`); then the group fields
  (#512), "Automatisch mitgehen", the live note, language and theme. It replaced the row of one chip per section
  (`SheetBossNav`), which needed two lines for a raid of three instances.
- **The map** fills the rest of the window as a whole (`PlanBoard` with `maxHeight` = the stage's measured
  height), on a blurred copy of itself; zoom and the view menu float at its lower right.
- **"Deine Aufgaben"** (`stage/MineCard.tsx`) floats at the lower left: the visitor's character and group, "Du
  machst" (his own rows, `MineBlocks`) or "Bei diesem Boss hast du keine eigene Aufgabe.", "Wirkt auf dich", and
  quick links to the other sections where he has a task of his own. It folds to its head (folded from the start
  on a phone). Without a login it is the login hint, outside the plan a single sentence.
- **"Alle Aufgaben"** is a tab on the right edge; it opens `stage/TasksPanel.tsx` over the map: the organiser's
  note, `ReadTables` without the personal part (`personal={false}`) and the tactic's steps.
- A section **without a map** (Allgemein, "Karte aus") has no stage: card and tables stand in the page's flow
  (`.rp-sheet-flat`).

On the board: **zones, raid marks, slots (resolved players, open ones dimmed) and group markers**, the tactic name
in the tables. A slot whose player is not in the approved setup shows as open. Objects switched off in the layer
list (`hidden`) are left out on the server, opacity and the map's dimming are applied as in the editor. **No
login, no menu**: `App.tsx` answers `/p/<token>` before it asks for a session; the data comes from `GET
/api/raidplan/public?token=…`, which is in `UNGATED` (`apiAccess.js`, see docs/permissions.md) and answers
**one and the same 404** for an unknown token, a withdrawn plan and a plan whose event is gone. The token is
minted on the first publish (18 random bytes, url-safe), kept while the plan is withdrawn, and rotated on
request. The page carries nothing personal beyond the character names of the approved setup.

**Own token highlighted:** the endpoint reads the visitor's session if there is one (`auth.getUser`) and
answers `me` = their Discord id when they stand in the plan; the page then rings their token, marks their rows
and says so. A visitor without a login gets a "log in" link (the login returns to the menu start, not to the
plan — a follow-up). It grants nothing: the highlight is the only thing a session changes.

**Highlighting a group (#512):** the stage bar holds "Gruppen", one square field per group marker of the section
(number in the group's colour and its raid mark; tooltip "Gruppe hervorheben (die anderen werden abgedunkelt)");
the group cells of the group heal table in "Alle Aufgaben" do the same. A click highlights that group, a click on the active chip ends it, another chip moves it; the state lives
only in the page (`focusGroup`, never saved, it survives a change of section and works beside "Only for me").
Every raider of another group (or of none) dims: the group markers with their ring, chip and member tokens,
filled role slots, free tokens and auto-placed raiders on the map (`groupFocusCls` in
`lib/raidplan/groupStyle.ts`, `gf()` in `PlanBoard.tsx`), and the rows of the group heal table. Marks, bosses,
lines and open slots stay as they are. `.rp-gdim` only sets `--rp-gf: var(--rp-group-dim)` (`.22`,
`tokens.css`), which the board rules multiply into their own opacity (`calc(var(--rp-o, 1) * var(--rp-gf, 1))
!important`, `styles/raidplan/objects.css`). An opacity on `.rp-groupwrap` itself does nothing - it is
`display: contents` - which is why the chips had no effect before (since the bar exists, also on 6449f731; not
a regression). The editor shares it through the inspector's group focus (`BoardWorkspace`).
Tests: `src/web-client/src/pages/PlanPublicPage.groupFocus.test.tsx`, `test/web-client/conventions/groupFocus.test.js`.

**Sections marked where the visitor is assigned (#503):** in the section menu every section where the visitor is
**personally** assigned says "Aufgabe für dich" (`raidBoard.stage.tagMine`, in `--accent`), and "Deine Aufgaben"
links those sections ("Eigene Aufgaben hast du bei"). Until Oct 2026 it was a small dot on the section's chip.
Personal = `lib/raidplan/bossMine.ts` `bossesWithMine`: a row whose
assignee is one of his players by name or by slot (tank, kick, heal, special task …), a row whose target is him
or his slot ("Wirkt auf dich"), or a tactic step with `user:<him>` among its participants. Stricter than "Only
for me" (`isMine` / `mineView`): a `role:<role>` row, a target role group, his raid group ("Gruppe 2") or his
name in a note or free text do not mark the section. The editor's chips do not get the mark: their corner dot already says "this section holds something",
and the editor derives the effective rows (inherited, class references resolved) only for the open section —
the organiser's own view of it is the "Meine Aufgaben" preview (`MyTasksPreview`). The page has no menu shell, so
it mounts the `TipLayer` itself: the `data-tip` boxes of the bar (arrows, groups, "Nur für mich") and the zoom
buttons show here too.

## The plan follows the raid (#534)

During the raid the read view and the editor turn to the boss being pulled by themselves, read from the Warcraft Log linked to
the event.

- **Endpoint:** `GET /api/raidplan/progress?token=<token>` (the read view; like `/public` in `UNGATED`, the same 404 for an
  unknown or withdrawn link) or `?event=<id>` (the editor; the handler checks the session and `raidplan` read itself, since the route
  is listed with `auth: "none"` for the token). Answer `{ live, waiting, killed, current, next, updatedAt }` with section keys
  (`bt/supremus`); without a linked log, outside the raid window or when WCL fails `{ live: false, killed: [], current: null,
  next: null }` plus `waiting`: `"no_log"` (inside the window, no Warcraft Log linked to the event), `"wcl_error"` (a log is
  linked but its fights cannot be read — private, WCL down, no key), `null` outside the window. The derivation and the cache are described in docs/logcheck.md ("Progress for the raid plan").
- **Client:** `hooks/useRaidProgress.ts` (pure half `lib/raidplan/progress.ts`). It asks at once and every 60 s, but only while
  `document.visibilityState` is `visible` and the clock is inside the raid window (start − 30 min to start + 6 h, the same as the
  server's); a tab that becomes visible again asks at once. It turns to `current ?? next` when the page shows that section. A
  section picked by hand (a chip, the editor's "open assignments" list) goes through `choose()` and pauses following — only while a
  log is read, so a click before the raid does not switch it off for the night; a deep link `?section=` starts paused.
- **Sheet:** the stage bar takes `killedKeys` and `follow`: a killed boss says "besiegt" in the section menu (portrait greyed),
  `AutoFollowToggle` sits at the bar's end.
- **Editor chips:** the editor's `SectionStrip` (its list; `BossNav` before Oct 2026) takes `killedKeys` and `follow`. A killed boss gets `.is-killed` (opacity
  `--rp-done-dim`, `tokens.css`; the icon greyed, full strength when chosen or hovered) and a small check in `--good` at its
  **lower** right (`.rp-bosschip-done`), so the #503 dot at the upper right and the editor's content dot stay free; tooltip and
  label add "Im Log getötet". `AutoFollowToggle` ("Automatisch mitgehen", `aria-pressed`) ends the bar while `live`; inside the raid window without a readable log it
  stays there as a greyed, inert chip "Wartet auf Log" (`.is-waiting`, `aria-disabled`) whose tooltip says what is missing (no log
  linked / log not readable), so nobody has to wonder where the switch is. The hook hands the bars one `chip` (`FollowChip`:
  `{ on, onToggle, waiting? }`, undefined outside the window or before the first answer).
- **Limits:** the log is only as fresh as the logger's upload (live logging sends every minute or two), plus up to a minute of
  server cache and a minute of polling. A report linked to the wrong event shows that raid's kills — correct the link on the event
  page. Only the newest linked log with a report id is read.
- Tests: `test/utils/logcheck/bossProgress.test.js`, `test/services/raidplan/raidplanProgress.test.js`,
  `test/web/apiRoutes/raidplan.progress.test.js`, `src/web-client/src/hooks/useRaidProgress.test.tsx`,
  `lib/raidplan/progress.test.ts`, `stage/StageBar.test.tsx`, `SectionStrip.test.tsx`; the stage as a whole:
  `pages/PlanPublicPage.stage.test.tsx`, `lib/raidplan/stage.test.ts`.

## Live updates and the section in the address (#555)

The read view takes a changed plan without a reload, and a reload lands on the boss that was open.

- **Server:** `GET /api/raidplan/public` answers through `okWithEtag` (`src/web/http/apiResponse.js`): the `ETag` is a
  short sha1 of exactly the JSON sent (so the setup, the published state and the viewer's `me` count too), and a
  request whose `If-None-Match` names it gets a bare `304`. The payload is still built per request (it is in memory);
  only the transfer and the page's redraw are saved.
- **Client:** `PlanPublicPage` polls every 20 s through `hooks/useVisiblePoll.ts` (only while
  `document.visibilityState` is `visible`, at once when the tab comes back, never on mount) with
  `pollRaidplanPublic(token, etag)` → `getIfChanged` in `api/client.ts` (`cache: "no-store"`, so the 304 reaches the
  code). The first load (`getRaidplanPublic`, same helper) keeps the ETag already; an answer equal to what is shown
  (a proxy that dropped the ETag) draws nothing. A changed answer goes through `useApi`'s `setData` — no remount: section, scroll position, zoom
  (the view is only reset when the section or its saved `view` changes), group focus, "Only for me" and map-only stay.
  A small `.rp-live-note` "Aktualisiert" (`raidBoard.public.updated`, `role="status"`) shows for 4 s beside the
  toggles. A failed poll (withdrawn, offline) keeps what is shown. A section removed meanwhile falls back to where a
  fresh visit starts.
- **The section in the address:** `lib/raidplan/sectionUrl.ts`. The chosen section — by hand, by following the log
  (#534) or on the first load — is written as `#boss=<key>` with `history.replaceState` (no history entry; path, query
  and the router's `history.state` kept) and remembered per plan in this browser (`rememberSection("p:<token>")`; the
  editor keeps `rememberSection(<eventId>)`). A page opens on `#boss=` first, then the deep link `?section=`, then the
  remembered one, then "Allgemein". Only `?section=` pauses following the log; `#boss=` of a reload does not, so a
  reload during the raid still turns to the boss being pulled. The editor (`RaidplanTab`) writes the same hash; its
  router drops it when another tab is chosen.
- Tests: `test/web/http/apiResponse.test.js`, `test/web/apiRoutes/raidplan.test.js` (ETag / 304),
  `lib/raidplan/sectionUrl.test.ts`, `hooks/useVisiblePoll.test.tsx`, `api/client.test.ts`,
  `pages/PlanPublicPage.live.test.tsx`.

## Einteilungen in den Event-Kanal posten (#502)

The read link as one message in the event's channel, like "Sheet posten" for the raidsheet:

- **Route:** `POST /api/raids/post-raidplan { event, message? }` (`apiRoutes/raidDetail.js`, area `raidplan`, write — it publishes the plan on the way,
  CSRF). The event — channel, title, start — is resolved on the server from its own event list, never taken from
  the body. The work is `postRaidplanLink()` in `src/services/raidplan/raidplanPost.js`.
- **What it checks:** the event has a plan (an own event always, a Raid-Helper event once switched on — else 409
  `no_plan`), the plan was saved with at least one board (else 400 `empty_plan`), `PUBLIC_BASE_URL` is an http(s)
  url (else 400 `no_public_url` — a `localhost` fallback would post a link nobody can open) and the event has a
  channel.
- **Publishing on the way:** a draft is published (`raidplanStore.setPublished`, the token minted if there is
  none), so the posted link never leads to the 404; an already published plan keeps its token. The answer says
  when it published ("… Der Raidplan ist dafür freigegeben worden.").
- **One message per event:** `src/stores/raidplanPostStore.js` (`settings/raidplan-posts.json`, `{ posts: [{
  eventId, channelId, messageId, message, postedAt, postedBy }] }`) remembers where it went; a second post edits
  that message (`discord.editLink`), and only when that fails (deleted by hand) posts a new one. Without
  `message` in the body the text of the last post stays, `""` clears it. Deleting the event forgets the record.
- **What the raider reads** (English, CLAUDE.md "Language"): `🗺️ **Raid assignments – <title>**`, the orga's
  line, `Raid start: <t:…:F>` (a Discord timestamp) and a link button "Open assignments" — the same
  `buildLinkMessage` as the sheet and softres posts.
- **Web:** the raid detail's payload carries `raidplanPost` (`raidplanPostState()`: `filled`, `published`,
  `publicPath` only while published, where and when it was posted; `null` without a plan). The own event's
  cockpit has the step *Einteilungen* (docs/events.md, "Das Raid-Cockpit"), a Raid-Helper event with a plan gets
  it in its progress bar after the raidsheet. Both open `RaidplanPostModal.tsx`; the raid plan tab has the same
  entry as an icon (`Send`) beside "Freigeben & teilen" (raidplan write only), which reads the page's data again
  first so the dialog knows the last save. A post that published the plan turns the tab's badge to "Freigegeben"
  without reloading the plan (the draft stays). The link shows the **saved** plan — the tooltip says so while
  there are unsaved changes.

## "All assignments" never cuts a name (feature/raidplan-16, part 2)

- **Cards of one type** (Curse, Kick, Misdirect ... - `AssignLine` read-only in `.rp-read-lines`): the "who"
  column was `fit-content(45%)` of a card that takes its width from its content, i.e. 45 % of the spell line -
  a name was cut to "Cos…" while room was left on the right. Now both columns are `fit-content(320px)`: as
  wide as the longest chip, a longer one ends in "…" with the full name in the chip's tooltip (`playerLabel`).
  A card is at least 240 px (or the whole width); cards wrap to the next line. Below 700 px they stand one
  under the other at full width, a row's "who" and "at whom" in two lines (unchanged).
- **Tank and group heal tables:** a name was broken inside ("Tankwar" + "t": `overflow-wrap: anywhere` on the
  cell). A name now stays whole (`white-space: nowrap` on the name), the lists wrap between names; the "YOU"
  mark is a pill beside the name. Below 560 px both tables become blocks - the tank table "Tank -> target" in
  a line with its healers under it, a group with its members and "Geheilt von" under them (`data-label`) - so
  the sheet never scrolls sideways on a phone.
- Checked in the browser for every section of the test raid at 1800, 1200, 750 and 390 px: no text in "All
  assignments" cut or overflowing, no sideways scroll.
