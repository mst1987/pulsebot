# Vermerke (notes on Discord accounts)

Epic #984. Part 1 (#979): store, rights area and API. The page in the menu follows in #980, the short form at the
signups and in the setup in #981.

The orga keeps **notes on a Discord account** — someone left a raid early, did not show, signed off late. A note
(Vermerk) belongs to **one Discord server** and **one Discord account** (not to a character: a person keeps his
notes when he switches characters).

## A note

| Field | Values |
|---|---|
| `level` | `hint` (Hinweis), `warning` (Warnung), `shadowban` — in this order of weight |
| `reason` | `left_early`, `no_show`, `late_signoff`, `left_server`, `behavior`, `loot`, `other` (an unknown reason reads as `other`; `left_server` since #982, the matching reason for the hint "left the server") |
| `text` | the note, at most 1000 characters (longer is refused on write, cut on read) |
| `eventIds` | the raids it is about (unique, may be empty) |
| `expiresAt` | ms timestamp, or `null` = **never** expires |
| `shared` | `true`: every server reads it (named with the server of origin), only that server changes it |
| `by`, `byName`, `at` | who wrote it, when |
| `archived` | `true` when archived, with `archivedAt`, `archivedBy`; archived notes stay but no longer count |
| `history` | every change: `{ by, byName, at, action: create/update/archive/restore, changes: [field…] }` |

At most **50 notes per person and server** (`400 too_many`). A note **counts** (is active) while it is not
archived, not expired and — for a shared one of another server — not hidden there. Expired and archived notes stay
in the archive of the person. `activeLevelFor(server, user)` is the highest active level, or `null`.
Archived notes count towards the limit of 50 too — a full archive refuses a new note with `too_many` until a full
admin removes one for good. The `history` of a note keeps its last 100 changes, older ones are cut.

**Archive instead of delete.** The orga archives (and restores) a note; removing one for good is for full admins
only and also removes the hide marks other servers set on it.

**Shared notes.** A shared note of server A is read on server B with the name of A (its label in the server
settings, else its Discord name) and cannot be changed there (404). B can **hide** it for itself
(`POST /api/vermerke/hide`) — it then no longer counts on B, A is not touched. B sees **everything** of a shared
note — text, author, history, `eventIds` — just as A does (a decision of the user: sharing means sharing all).
When A takes `shared` back, B's hide mark stays in the store; should A share the note again, it stays hidden on B.

## Store

`src/stores/roster/userNotesStore.js`, file `data/settings/user-notes.json` (sensitive, docs/data-storage.md):

```
{ guilds: { [guildId]: { [userId]: { name, entries: [note…] } } },
  hidden: { [guildId]: { [entryId]: { by, at } } } }
```

Only three modules read it: the routes (`src/web/apiRoutes/roster/vermerke.js`), the short form
(`src/services/vermerke/vermerkeShort.js`) and the hints (`src/services/vermerke/userSignals.js`, see below). Nothing of a note is ever logged. Both are held by
`test/stores/roster/userNotesStore.test.js`.

## Rights

Area `vermerke` (docs/permissions.md): **in no base access**, like `kader` — full admins and named people (an
account grant under "Einzelne Konten" or a role grant). `read` = the list and the notes, `write` = add, change,
archive, hide. Everything works on the **active server**; an entry of another server answers 404 `not_found`
unless it is shared (then read only). Without an active server: 400 `no_server`.

## API

| Route | Right | What |
|---|---|---|
| `GET /api/vermerke` | read | `{ people: [{ userId, name, level, reasons: {reason: n}, activeCount, totalCount, lastAt, lastByName, sharedCount, left }] }`, newest first, no text; `left` = no longer on the server (`null` without a member list) |
| `GET /api/vermerke/person?userId=` | read | `{ userId, name, level, entries: [note + own, originGuildId, originName?, hidden, active] }` |
| `GET /api/vermerke/people?q=` | read | person search of the dialog: `{ results: [{ userId, name, gone }] }` — members first, then who left (found through earlier signups), at most 25 |
| `GET /api/vermerke/raids?userId=` | read | `{ raids: [{ eventId, title, startTime, signed }] }` — the raids of the last four weeks on the server, newest first |
| `POST /api/vermerke` | write | `{ userId, name, level, reason, text?, eventIds?, expiresAt?, shared? }` → 201 `{ entry }` |
| `POST /api/vermerke/update` | write | `{ userId, id, …fields }` → `{ entry }`; archived: 409 `archived` |
| `POST /api/vermerke/archive` | write | `{ userId, id, archived = true }` → `{ entry }` |
| `POST /api/vermerke/hide` | write | `{ id, hidden = true }` → `{ id, hidden }` (shared notes of other servers only) |
| `POST /api/vermerke/delete` | full admin | `{ userId, id }` → `{ removed: true }` |
| `GET /api/vermerke/short?userIds=a,b` | see below | `{ short: { [userId]: { level, reasons } } }`, at most 200 ids |

Store refusals keep their code: `bad_user`, `bad_level`, `bad_reason`, `text_too_long`, `bad_expiry`, `too_many`
(400), `not_found` (404), `archived` (409).

## The page (#980)

`/vermerke` in the menu group "Gilde" beside Roster and Kaderplaner, version-neutral (`src/config/menu.json`),
client `src/web-client/src/pages/vermerke/`. One compact, sortable list (a person per row: level as symbol and word,
reasons with their count, "Zuletzt"), a level filter and an archive tab; the drawer opens by link (`?user=<id>`) with
the entries, a shared entry of another server read only (it may only be hidden here). The dialog adds a note: person
search, level, reason as chips (all seven, `left_server` = "Server verlassen" with a door icon), recent raids, expiry,
shared. Below the list the section "Hinweise aus den Daten": five hints, then "Alle zeigen"; "Vermerk anlegen"
prefills the reason (`reasonOfSignal`: both sign-off kinds → `late_signoff`, the others their own), "Ignorieren"
hides one. Without the hints route (404) the section is gone; with no hints it keeps its head, so the sliders
button stays reachable: it opens the **thresholds dialog** — one line per key with −/+ and the number with its word
("60 Tage", "unter 12 Stunden", "ab 2-mal"), "Standard" beside an own value (sends `null`). Everyone with `vermerke`
read sees the values, only write saves; `bad_threshold` marks the lines of `fields`, `server_switched` asks to
reload.

## Short form

For every orga that plans a raid (#981): the highest active level and the reasons with their counts — **no text, no
author, no raids**. `shortOf(server, user)` / `shortFor(server, userIds)` in `vermerkeShort.js`; the endpoint is
open at the gate (`auth: "menu"`) and lets in whom `maySeeShort` in `services/vermerke/vermerkeAccess.js` lets in:
`vermerke` read, the global raid orga (orga rank with `raids` write — the rule of the setup editor), or a manager of a
roster of the **active server** (`categoryOrga.isAnyCategoryManager(user, { guildId })`). Everyone else: 403 `orga_only`.
`shortFor` reads the store **once** for all ids (`activeEntriesMany`), so a raid with 40 signups is one read.

### In the answers of the orga (#981)

The short form rides along in the answers the orga plans with, only for the people of that answer, one `shortFor`
read each.

**One rule for every answer:** a field with the short form (or anything built from it) is added only when
`maySeeShort(user, guildId, { req })` (`services/vermerke/vermerkeAccess.js`) says yes — the same rule as
`GET /api/vermerke/short`. The answer's own orga flag (`viewer.orga`, `isOrga`, a manager branch) or an area right
(`kader`, `raids`) is **never enough**: an Einzelkonto with `kader` read may stand in the pool itself, an orga rank
without `raids` write sees the orga view of a raid but no notes. Every such field has a test "Nicht-Berechtigter
bekommt kein Feld" next to the one showing that it arrives.

| Answer | Field | People |
|---|---|---|
| `GET /api/raids/setup` and every setup write answer (`canWrite` and `maySeeShort`) | `vermerke`, `shadowbanInPool` | signups + everyone in groups, bench, pool (all raids of a group) |
| `GET /api/raids/detail` (`rights.canSeeShort`, set by the route) | `vermerke` | signups (Raid-Helper and own) + everyone placed in the setup without a signup (slots, bench) |
| `GET /api/rosters/roster` (manager / orga branch of `buildRosterDetail`, and `maySeeShort`) | `vermerke` | the roster's rows |
| `GET /api/kader` (`maySeeShort`) | `vermerke` | the Kader's players |

`vermerke` is `{ [userId]: { level, reasons: { [reason]: count } } }` (nobody without an active note is listed).
`shadowbanInPool` is `[{ userId, name }]`: **everyone** with a shadowban who stands in the pool of the **stored**
setup (whether the proposal held them back or a hand move put them there) — the client shows "N Person(en) mit
Shadowban im Pool · Dranok" with the name linking to `/vermerke?user=<id>`. `name` is the same on every answer: the
Discord name from the member cache (`resolveUserNames(…, { waitMs: 0 })`, the page load filled it), else the
character, else the id.
It is computed live per answer and **never stored** in the setup (`saveSetupDraft` keeps the rest of the view).
The proposal itself skips shadowbans (docs/setup.md "Shadowban"); placing by hand stays allowed. A roster manager
gets the short form for every person of the server, a shared note shows everything on every server.

## Hints from the data (#982)

The bot **never makes a note itself** — it only proposes. The word is always "Hinweis", never "auffällig".

| Kind | Source | Default threshold |
|---|---|---|
| `signoff_after_setup` | sign-off while placed in the **approved** setup (`event.setup.approved`, for a raid group any raid of the group, noted at the first) — every way: web, bot, several raids at once, the orga for somebody | 2 in 60 days |
| `late_signoff` | sign-off of an existing signup less than `lateHours` (12) before the start, not placed | 2 in 60 days |
| `no_show` | **computed**, not stored: `noShow` in the attendance overrides (`attendanceOverridesStore`) of the server's own raids inside the window; a raid group (#811) is **one night** — an override at a further raid counts for the group's first raid, a person once per night; `at` is the start of the night | 2 in 60 days |
| `left_server` | leaving the Discord server (`memberActivity.onMemberRemove`) for somebody **tied to that server**: in an open roster of it (`roster.guildId`) or signed up at one of its own raids. Characters alone, a roster or a signup of another server, a Raid-Helper raid do not count | 1 |
| `left_early` | **computed**, not stored (#990): a confirmed override `leftEarly` in the attendance (`attendanceOverridesStore`) of the server's own raids inside the window — like `no_show` a raid group is one night, a person once per night. The log only **suggests** it, the orga confirms it (below) | 2 in 60 days |

**"Früh gegangen" (#990): the log suggests, the orga confirms.** Nothing is decided automatically. The evaluation
keeps who stood in which boss kill (`report.kills`, docs/logcheck.md); the orga's roster attendance
(`rosterView` → `attendanceForAccounts(…, { suggestLeftEarly: n })`) marks a night the log counts as present
(`detail: "inLog"`) with `suggestion: { kind: "leftEarly", missedKills, bosses }` when the person (any character of
theirs — a twink counts as present) is missing from the night's **last n kills** (`leftEarlyBosses`, default 2, 1–5;
counted over the raids of a raid group they stood in a kill of, all logs merged, kills of the same boss within 2
minutes are one) — someone in no kill at all did not leave early. Wipes and trash never count. A night evaluated before
#990 has no `kills` and so no suggestion; no Warcraft Logs request is made per page view. In the cell's menu
**Bestätigen** sets the override `leftEarly` ("Früh gegangen", counts as present for the quota, makes the hint) and
**Verwerfen** stores `present` with the fixed reason `LEFT_EARLY_DISMISSED` (`POST /api/attendance/override
{ status: "present", dismiss: "leftEarly" }`) — any override ends the suggestion. Dismissing freezes the night as
"Dabei": the override stays even if the log changes later; **Automatisch** in the menu deletes it and brings the
suggestion back. The raider never sees either: their own views (`neutralNight`/`neutralAttendance`: „Meine
Anwesenheit", „Für dich", the availability answers, the own character page `GET /api/roster/char`) show such a
night as plain "anwesend", without override or suggestion; the quota is the same. A guard test lists every module
that builds night-by-night attendance with the reason it is safe. Thresholds `leftEarly` (default 2, 1–20) and
`leftEarlyBosses` live in `serverSettings[g].vermerkeSignals`. Test: `test/services/characters/rosterAttendance.leftEarly.test.js`.

A first
answer "abwesend" (no signup before) is no sign-off; removing a raider by the orga (`removeRaider`) is no hint
either. An absence entered via `availability.js` (the panel, `/abwesenheit`, the web) goes through `submitSignup` and
counts like any sign-off: a hint only when it is one — after the setup, or late (`lateHours`); an early absence is none.

**Limits (known, wanted for now).** The **automatic** "Nicht erschienen" (computed from the logs, no override of the
orga) makes no `no_show` hint — only an override the orga set counts. Sign-offs at **Raid-Helper** raids make no hint
either (they never pass `submitSignup`).

**Recording** (`src/services/vermerke/signalRecorder.js`, called at the end of `submitSignup`): only when the new
status is `absence`, the old one was not, before the start and on a known server; a failure is caught — the raider's
sign-off and answer never change (`test/services/signups/signupService.signals.test.js`). Stored: the raid, when, the
hours before the start (`hoursBefore`) and `byOrga` — only when somebody else than the raider entered it: the callers
hand `actorId` (the web user, the orga in Discord or the setup, `createdBy` of an absence); an orga signing
themselves off is a raider (`byOrga` stays away). A sign-off already noted for that raid is turned away before
anything is written (signing off, back on and off again is one sign-off).

**Store** `src/stores/roster/userSignalsStore.js`, file `data/settings/user-signals.json` (sensitive, kept **180 days**,
at most 60 events per person and server; what is older is dropped on every write and, on reading, at most once a
day — and then only written when there is something to drop, `pruneDaily`):

```
{ guilds:  { [guildId]: { [userId]: { name, events: [{ kind, eventId, title, startTime, at, hoursBefore?, byOrga? }] } } },
  ignored: { [guildId]: { [userId]: { [kind]: at } } } }
```

**Reading** (`src/services/vermerke/userSignals.js`, loaded by the Vermerke routes only): per kind the events inside
the window; shown only from the threshold on, newest first. "Ausblenden" (`ignored`) and an **active Vermerk with
the matching reason** (`late_signoff` for both sign-off kinds, `no_show`, `left_server`) hold a hint back until a newer
event of that kind (`at` after the Ausblenden / the note). Then it comes back and counts **every** event inside the
window, the older ones too — the threshold is about the person, not about what came since. A no-show of an old raid
entered only after the Ausblenden does not bring it back (its `at` is the start of the raid). A **shared Vermerk of
another server** with the matching reason holds the hint back as well (it counts on this server — wanted). No-shows cost one
`listEvents(server, { siblings, sinceSeconds })` and one read of the overrides per request — no scan over all signups.

**Thresholds per server** in `serverSettings[guildId].vermerkeSignals` (`DEFAULT_THRESHOLDS` / `THRESHOLD_LIMITS`
in `signalRecorder.js`): `windowDays` 60 (7–180), `signoffAfterSetup` 2, `lateSignoff` 2, `noShow` 2 (1–20 each),
`lateHours` 12 (1–72), `leftServer` 1 (1–5). The page sets them in a dialog (#980, see "The page"). Empty, `null` or left out = the default
again; a value that is no whole number in its range answers 400 `bad_threshold` with `fields` (the keys) and saves
nothing; unknown keys are dropped.

| Route | Right | What |
|---|---|---|
| `GET /api/vermerke/signals` | read | `{ signals: [{ userId, name, kind, count, windowDays, events: [{ eventId, title, startTime }], lastAt }], thresholds }` |
| `POST /api/vermerke/signals/ignore` | write | `{ userId, kind }` → `{ ignored }`; 400 `bad_user` / `bad_kind` |
| `GET /api/vermerke/signals/settings` | read | `{ guildId, thresholds, own, defaults, limits, orgaNotice, orgaNoticeLevels }` |
| `POST /api/vermerke/signals/settings` | write | `{ thresholds, orgaNotice?, serverSettingsGuildId }` → same + saved; 409 `server_switched` for a stale tab; 400 `bad_threshold` / `bad_orga_notice` (with `fields`) saves nothing |

## Hint to the orga at signup (#983)

When somebody with a **warning or a shadowban** signs up for a raid, the orga of that server gets one line in
Discord. **Off by default**, switched per server in the dialog "Einstellungen" of "Hinweise aus den Daten"
(`serverSettings[guildId].vermerkeOrgaNotice = { enabled, level }`, `level` `"warning"` = warning or shadowban,
`"shadowban"` = only shadowbans). The POST without `orgaNotice` keeps the switch as it is (an older client).

**When.** Only the **first signup per person and raid** (a status other than `absence`, through `submitSignup`:
web, bot, several raids at once, a raid group — one line per night, i.e. per raid of the group the person signs up
for). A later change of status or role, a sign-off and a new signup bring no second line: the mark in
`data/settings/orga-signup-notices.json` (`orgaSignupNoticeStore`, `{ events: { [eventId]: { [userId]: at } } }`,
90 days) is set at **every** first signup — also with the switch off and when the orga entered the person, so
switching on later or signing off and up again never makes a line. An entry by the orga for somebody else (`byOrga`
without an `actorId` or with one other than the person) sets the mark but brings no line — the orga knows already. **Raid-Helper** signups never pass
`submitSignup` and bring none (no extra API calls).

**Gathering.** `src/services/vermerke/orgaSignupQueue.js` (on the raider's path, reads no Vermerk) queues per server
for **2 minutes** (`BUFFER_MS`), then hands the batch to `orgaSignupNotice.postBatch`, which the bot process registers
in `src/web/http/jobs.js` (`setFlushHandler`). The queue lives in memory; a restart inside the two minutes loses
the batch (best-effort, the signup is saved anyway).

**What counts.** The Vermerke **of the raid's server** at flush time (`vermerkeShort.shortFor`: own and shared ones,
not hidden, not archived, not expired). Below the chosen level: no line. Nobody left: no message.

**The message** (`card()`, kind `warn`, kicker "Vermerke", German like every orga text):

```
Anmeldung mit Vermerk            (or "3 Anmeldungen mit Vermerk")
<@id> (Char) · **Raid** <t:…:f> · Warnung · Nicht erschienen ×3 · Verhalten · [Vermerke](<base>/vermerke?user=<id>)
Nur für die Orga – die Person sieht das nicht.
```

The name is always the mention plus the character of the signup; without a character the display name (web and bot
alike). Level as a word, reasons with their count (`×n` from 2 on), **no free text, no author**. Names and titles are
escaped (no Markdown, no ping besides the mention). **Where:** the category's Orga-Zentrale (`orgaHubStore`) when
it lives on the raid's server and the bot sees it, otherwise the orga channel (`signupNotes.noteChannelFor`), posted
with `{ guildId }` of that server. A category's own channel on another server is skipped for the server's default.
**No channel:** only a log line, nothing else. Everybody who can read that orga channel sees the line — the circle
can be wider than the one of `maySeeShort`, and that is intended (the orga picks the channel). Never a public channel, a raid
post, a thread or a DM; a failed post is logged and dropped. The raider's answer is the same with the switch on or
off (`test/services/signups/signupService.orgaNotice.test.js`).

## Never to the person

A note is never shown to the person it is about, nor to a raider at all: not in the profile, `/api/signups`, the
dashboard "Für dich", `/e/<id>`, `/p/<token>`, nor in "Ansicht als Raider" (an admin in that view is no admin and
has no `vermerke` right). `test/services/vermerke/vermerkeNeverToPerson.test.js` holds it twice: none of these pages
loads the store or the short form (whole require closure), and a raider / the raider view gets 403 on every route
without the marker text. The orga answers of #981 are held dynamically as well: the setup editor's GET in
`vermerkeNeverToPerson.routes.test.js` (raider, the noted raider, "Ansicht als Raider": no `vermerke`, no
`shadowbanInPool`, no marker), the raid detail in `test/web/events/raidDetailView.test.js`.

"Never to the person" means: never to a raider **without orga or Vermerke rights**. Whoever holds the rights (the
area `vermerke`, or the short form as raid orga / roster manager) also sees the notes on the own account — a
deliberate exception the user decided, nothing is filtered (`test/web/apiRoutes/roster/vermerke.test.js` holds it).
