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
