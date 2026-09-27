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

The "Sheet-Ansicht": per boss the board — map at the full page width, with its **zones, raid marks, slots
(resolved players, open ones dimmed) and group markers** — and under it the table of rows, the note and the
tactic name. A slot whose player is not in the approved setup shows as open. Objects switched off in the layer
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

**Highlighting a group (#512):** above the map the bar "Gruppen" holds one chip per group marker of the section
(tooltip "Gruppe hervorheben (die anderen werden abgedunkelt)"); the group cells of the group heal table do the
same. A click highlights that group, a click on the active chip ends it, another chip moves it; the state lives
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

**Sections marked where the visitor is assigned (#503):** in the chip bar (`SheetBossNav`) every section where
the visitor is **personally** assigned carries a small dot in `--accent` at its upper right (ringed with
`--panel`, so it also stands out on the filled chosen chip), and its tooltip / label say "Du hast hier
Einteilungen" (`raidBoard.read.hasMine`). Personal = `lib/raidplan/bossMine.ts` `bossesWithMine`: a row whose
assignee is one of his players by name or by slot (tank, kick, heal, special task …), a row whose target is him
or his slot ("Wirkt auf dich"), or a tactic step with `user:<him>` among its participants. Stricter than "Only
for me" (`isMine` / `mineView`): a `role:<role>` row, a target role group, his raid group ("Gruppe 2") or his
name in a note or free text do not mark the chip. The line "You are in the plan for this boss" stays as it
was. The editor's chips do not get the mark: their corner dot already says "this section holds something",
and the editor derives the effective rows (inherited, class references resolved) only for the open section —
the organiser's own view of it is the "Meine Aufgaben" preview (`MyTasksPreview`). The page has no menu shell, so
it mounts the `TipLayer` itself: the `data-tip` boxes of the chips ("Only for me", the mark) and the zoom
buttons show here too.

## Einteilungen in den Event-Kanal posten (#502)

The read link as one message in the event's channel, like "Sheet posten" for the raidsheet:

- **Route:** `POST /api/raids/post-raidplan { event, message? }` (`apiRoutes/raidDetail.js`, area `raids`, write,
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
  entry as an icon (`Send`) beside "Freigeben & teilen" (raids write only), which reads the page's data again
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
