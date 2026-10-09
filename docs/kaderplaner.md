# Kaderplaner (raid rosters for WoW Forever)

Endnutzer-Sicht: siehe [guide-web-admin.md#kaderplaner](guide-web-admin.md#kaderplaner).

The raid leads build **Kader** in the web admin — several per Discord server (e.g. "Forever-Kader 2027", a
Thursday twink squad). Every player of a Kader has **one state that stays until somebody changes it**, and the
Kader leads them through a fixed flow:

```
Discord-Rolle (Aktion) → Pool → Vorauswahl · Gespräche → (Übersicht) → Vorläufig → Roster · Bench · Tentative
```

What the bot already knows (rule set, server members and their Discord roles, raider profiles, log characters,
attendance) is read live; what the planner decides lives in its own file and is **never written back** to a raider
profile.

| Where | What |
|---|---|
| `src/web/apiRoutes/kader.js` | the routes (`GET /api/kader` + the writes below), area `kader` |
| `src/web/kader/kaderSource.js` | what the planner reads from the bot: classes/specs/buffs of the version (German and English names), the server's human members with their role ids, the Discord roles somebody holds, whitelisted profiles, log characters, the server's raid categories (`listRaidCategories`) and every account's attendance per raid category |
| `src/web/kader/kaderView.js` | the pure merge: source + planner → view model (`buildKaderView`), the light answer of a change inside a Kader (`kaderPayload`), the helpers the mutators get (`mutationContext`, `lightContext`, `prefillOf`) |
| `src/services/kader/kaderModel.js` | the planner's shape, its limits and normalisation; accounts, character data (assignments), Kader (create, rename, leads, delete) |
| `src/services/kader/kaderPlayers.js` | players of a Kader: take in, remove, states (`MOVES`), interview, votes, comments |
| `src/services/kader/kaderQuestions.js` | the questions of a Kader: add, change, delete, order, copy from another Kader |
| `src/services/kader/kaderSetups.js` | example setups: variants, size 10/20, groups, "Automatisch verteilen" |
| `src/services/kader/kaderAutoAssign.js` | the group heuristic of "Automatisch verteilen" |
| `src/services/kader/kaderMigration.js` | the one-time upgrade of the #566 file (see "Umstellung") |
| `src/services/kader/kaderActivity.js` | Live: what a write changed — revisions and the Kader's activity log (`recordChanges`), the lines after a revision (`changesSince`) |
| `src/web/kader/kaderPresence.js` | Live: who is in which Kader right now, in memory only |
| `src/stores/kaderStore.js` | `data/settings/kader.json`, one planner per Discord server; `liveState` for the poll |
| `src/web-client/src/pages/kader/` | the page (`KaderPage.tsx`): header, status bar, the six views and the dialogs; live: `useKaderLive.ts` (the poll), `useInterviewDraft.ts` (the interview's draft and its conflicts), `Presence.tsx` (who is here, the conflict banner), `ActivityLog.tsx` (Verlauf, Aktivität) |
| `src/web-client/src/lib/kader/` | client logic: `model.ts` (names, icons, states, counts, the attendance sum over the Kader's raid categories), `interview.ts` (progress, draft/patch), `filters.ts`, `sort.ts` (the sort keys of the planner's tables), `colors.ts` (the colours of the answers), `setup.ts` (slots, buff hints, Discord text), `names.ts`, `live.ts` (activity lines as sentences, the toast, presence in words) |
| `src/web-client/src/styles/kader.css` | the module stylesheet, prefix `kp-` (modifiers too) |

## Access

Area **`kader`** ("Kaderplaner", `src/config/permissions.js`). It is in **no** base access by default — full admins
have it, everyone else only through Einstellungen → *Berechtigungen*: a role grant or a single-account grant under
"Einzelne Konten" (see [permissions.md](permissions.md)). `read` shows every page with everything in it but no
controls (no switches, no drag, no saving, no votes); `write` changes. Every route carries `area: "kader"`; writes use
`withUser({ write: "kader", csrf: true, body: true })`. **Votes** are a second gate inside `write`: only the leads of
that Kader vote (403 otherwise). `test/web/apiRoutes/kader.test.js` holds 401/403, read vs. write for a
single-account grant, the CSRF refusal and the lead rule.

## Privacy

Wishes, interview answers, notes, votes and comments **never leave the Kaderplaner**: not into the raider profile,
the roster pages, other APIs or the logs. `src/stores/kaderStore.js` is required only by
`src/stores/settingsMigration.js`, `src/web/apiRoutes/kader.js` and `src/services/kader/kaderRoster.js` (the roster
door below; `test/stores/kaderStore.test.js` keeps that list), and the route test serialises the other areas' answers and asserts none of it appears. In the other direction a
profile leaves `kaderSource.js` as a whitelist (characters, specs, gear, main, tank/heal, raid days, the saved
name) — never `avoid`, wishes, the note, preferred raids or calendar tokens (`test/web/kader/kaderSource.test.js`).

### Roster aus einem Kader (#657)

A raid roster (docs/roster-profile.md "Roster anlegen und einstellen") can be created from a Kader: `POST
/api/rosters/create` with `source: "kader"`, or `services/roster/rosterCreate.js createRosterFromKader(kaderId, opts)`
(the entry the Kaderplaner's button of #658 builds on). The one door is `src/services/kader/kaderRoster.js`:
`rosterPlayers(guildId, kaderId)` answers per player **only** `{ userId, state, decision, characterName }` (states
roster, bench, tentative; `characterName` = the planner's active character), built field by field — never a wish, an
answer, a note, a vote, a comment, the Verlauf or the activity log; `kaderSummaries(guildId)` gives the create dialog
and the roster link id, name, two counts and the Kader's `attendanceCategories` (category ids, no person in them). `rosterCreate.js` is the only module outside the Kaderplaner that requires it, and it requires
nothing else of the planner (`test/stores/kaderStore.test.js`); `test/services/kader/kaderRoster.test.js` and the
roster suites fill every private field with a marker and assert it never reaches the answer or `rosters.json`. The
roster maps roster → core, bench → bench, tentative → trial; the character is the planner's active one as the profile
key of the roster's version when the profile has it, else the name as typed, else a profile character of the decided
class, else the profile's first. Afterwards the roster is independent: nothing flows back into the Kader.

**The link (October 2026):** a Kader belongs to exactly one roster through the roster's own field `kaderId` (1:1,
`rosterStore`; a roster created from the Kader starts linked, a roster stored before the field gets its
`source.kaderId`). `rosterCreate.rosterOfKader` reads that link, so "Ins Roster übernehmen" goes into the linked
roster and nowhere else — a migrated roster ("Mo-Raider") that the Kader is meant for is linked instead of a second
roster being created. Linking copies nothing of the Kader; the privacy rule stays: only status and the decided
character cross, and only through "Ins Roster übernehmen".

**In the planner (#658):** the bar of the decision page (`/kader/<id>/roster`, `pages/kader/RosterLink.tsx`, beside
"Beispiel-Setups") shows the roster action:

- **"Mit bestehendem Roster verknüpfen"** — while the Kader has no roster, for full admins with `kader` write. A
  dialog with the server's rosters (the one whose category the Kader counts attendance in first, "Vorschlag"; one
  another Kader holds greyed out), then `POST /api/kader/roster/link`. When the picked roster's category is not among
  the Kader's attendance categories, a switch (on) adds it through the ordinary `PUT /api/kader/kaders` — the
  Kader's own route and rights.
- **"Roster anlegen"** — while the Kader has no roster, for full admins only. A dialog with the
  name (default the Kader's) and an optional raid category (only categories without roster, from `GET
  /api/rosters/options`), then `POST /api/rosters/create` with `source: "kader"`; the toast says how many came along.
  Without a category the roster plays the planner's version (Forever when that rule set exists — the characters are
  looked up there), with one the category's version.
- **"Ins Roster übernehmen (n)"** — once the roster exists, for whoever has `kader` write and manages that roster
  (`canManageRosterLive`: full admin, a manager account or role). `n` = players in roster / bench / tentative who are
  not in the roster yet; after a confirmation `POST /api/kader/roster/sync` (`rosterCreate.syncRosterFromKader`) takes
  them in the same way (status, character, main role); **members already in the roster are never touched**, and nobody
  is taken out because the Kader moved them back. Role failures are counted in the toast.
- **"Zum Roster"** — the link to `/roster/r/<id>`: name, members, status and roles are edited there.
- **"Verknüpfung"** — full admins: the same dialog to link another roster or "Verknüpfung lösen" (the roster stays
  with all its members). The roster page links back: its Komposition's "Zum Kaderplaner" opens `/kader/<kaderId>/roster`
  of the linked Kader, and the roster settings ("Kader im Kaderplaner") set or clear the same link from that side.

`GET /api/kader/roster?kader=<id>` (area `kader` read, `rosterCreate.kaderRosterState`) answers counts only: `{ roster:
{ id, name, members } | null, candidates, pending, canCreate, canSync, canLink, rosters }` — `rosters` (only with
`canLink` = full admin with `kader` write) are `[{ id, name, categoryId, members, linkedKaderId, suggested }]`
(`rosterCreate.kaderLinkChoices`); the button refetches it when the counts of the decided states change. `POST
/api/kader/roster/link` `{ kaderId, rosterId }` (area `kader` write + CSRF, full admins, else 403 `admin_only`;
`rosterId` `""` unlinks; 404 `kader_not_found` / `not_found`, 409 `kader_taken`) moves the link
(`rosterCreate.linkRosterToKader`: the old roster is unlinked first, a history line on both) and answers the state. The kader route requires `services/roster/rosterCreate.js` and `rosterStore` — never the
other way round —, so `kaderRoster.js` stays the only door (`test/stores/kaderStore.test.js`); the route test fills an
interview note and a comment with a marker and asserts neither reaches the roster.

## The version and the server

- Version: `forever` when that rule set exists, else the main version (`kaderSource.plannerVersion()`); the content
  switch does not apply.
- Server: the **active guild** of the session (`activeGuildFor(req)`): its members and roles, its events for
  attendance, and the planner is stored under its id.

## Attendance per raid category

Every Kader picks the **raid categories** its attendance counts in (`attendanceCategories`) — a PUG category nobody
of the Kader joins must not pull everybody down, a Thursday Kader only cares for the Thursday raid.

- **The server's raid categories** (`kaderSource.listRaidCategories`): every Discord category marked for events
  (`config.categoryIds`) and every category a raid of this server ran in, named live or from the remembered names
  (`categoryNames.js`), with the game version it plays (`mainVersionFor`) and how many nights it counts. An id
  without a known name is left out. The view model sends them as `raidCategories` in Discord's order.
- **Per account and category** (`sourceAttendance`): the category's last 11 nights with evidence
  (`rosterAttendance.attendanceForAccounts`, `RAID_WINDOW`), whatever version they were played in; the account's
  characters are the profile's of every version plus the characters assigned per category. `player.attendance` is
  `{ [categoryId]: { attended, counted, nights } }`, only the categories that counted a night; `null` without any.
- **The sum is the page's** (`lib/kader/model.ts` `attendanceOf`): attended and counted nights added up over the
  picked categories, each category's share for the tooltip ("Mo Raid 9/11 · Do Raid 7/10"), the nights newest
  first with their category — so a new pick needs no second request. "Automatisch verteilen" sums the same way on
  the server (`kaderView.rateOver` via `ctx.rateOf(userId, categoryIds)`).
- **No pick, no number**: a Kader without a category shows "—" everywhere, a hint above the Pool table and a
  warning-coloured "Kategorien wählen" in the column head — there is no silent fallback to all categories. Existing
  Kader start with `[]` (normalised on read). A picked id the server no longer knows counts for nothing.
- **Where it is picked**: in the Kader's settings (a checklist, saved with the dialog) and in the head of the
  Pool's attendance column (a menu, every tick saved at once for the whole Kader). `PUT /api/kader/kaders` keeps only
  ids of the server's raid categories (`ctx.raidCategoryIds`); an empty list is a valid pick.
- **Where it shows**: Pool (value, tooltip with the shares, sortable), the Vorläufig drawer (the value with the
  shares written out), the account dialog (one square per night with date and category, "letzte n Raidabende · x da,
  y gefehlt"). The Übersicht and the import dialog show no attendance.
- Discord unavailable (bot offline, GuildMembers intent missing) is never an error: `members: []`,
  `discordRoles: []` plus a `warnings` entry; the import dialog says so and "Per Discord-ID" still works.

## The planner's data (`data/settings/kader.json`)

`{ guilds: { [guildId]: { v: 2, accounts, assignments, kaders } } }`, normalised on every read and write
(`kaderModel.normalizePlanner`, which never invents ids).

- `accounts`: `[{ userId, displayName, addedAt }]` — added by hand (a raw Discord id with 17–20 digits and a name).
  Removing one takes it out of every Kader.
- `assignments[userId]`: the planner's character data **per server, not per Kader** — `{ characters: [{ id, name,
  nameStyle, className, specs: [{ spec, main, gear }], canTank, canHeal, onlineKey? }], activeCharacterId }`, at most
  8 characters, one main spec each. `nameStyle` `forever` = "Vorname Nachname" (2–12 letters each), `nick` = a free
  nickname (2–24); both through the profanity filter. The account dialog (a click on any name) edits it; the
  profile is never changed, a difference is marked ("weicht vom Profil ab").
- `kaders`: up to 30, each

```
{ id, name (≤ 40), leads: [userId] (≥ 1 on every change, default the creator), createdAt, createdBy,
  attendanceCategories: [categoryId] (≤ 20, the raid categories attendance counts in; [] = none picked yet),
  questions: [{ id, text (≤ 200), type: single|multi|text, options: [{ id, label (≤ 60), color? }] (≤ 20), required }] (≤ 30),
  players: { [userId]: entry } (≤ 500),
  setups: [{ id, name, size: 10|20, groups: [[{ userId, spec } | null] × 5] × 4 }] (1–6) }
```

A player's **entry**:

| Field | What |
|---|---|
| `name` | the Discord name at the time they were taken in (shown when the account is gone) |
| `state`, `since`, `by` | `pool` · `selected` · `provisional` · `roster` · `bench` · `tentative`, with when and who (the Verlauf says it; the working surfaces do not) |
| `addedAt`, `addedBy` | when and by whom the player came into this Kader |
| `history` | the last 50 events: `added`, `state {from,to}`, `decision {className,spec}`, `interview_saved`, `lead {to}`, `interview_completed`, `interview_reopened`, `vote {vote|none}`, `migrated {to}` — with `at` and `by`. `interview_saved` and `lead` are coalesced: the same person within ten minutes replaces their line, also with other people's lines in between, and it moves to the end (`kaderPlayers.noteHistory`) |
| `wishes` | `[{ className, spec }]` in order (≤ 6, no spec twice); prefilled with the account's character when taken in |
| `interview` | `{ lead, answers: { [questionId]: optionId \| [optionId] \| text }, note (≤ 2000), startedAt, updatedAt, updatedBy, completedAt, completedBy, rev? }` |
| `votes` | `{ [leadUserId]: yes \| unsure \| no }` |
| `comments` | `[{ id, by, at, text (≤ 1000) }]` (≤ 200), only the author deletes one |
| `decision` | `{ className, spec }` — set when the player goes into the roster |

### States and moves

`MOVES` (`kaderPlayers.js`, mirrored in `lib/kader/model.ts`): pool → selected; selected → pool | provisional;
provisional → selected | roster | bench | tentative; roster → provisional | bench | tentative; bench → provisional |
roster | tentative; tentative → provisional | roster | bench. Every step can go back. Into the roster the decision is
the one given, else the one it had, else the first wish; roster → roster with a new decision only changes it. A batch
move skips who does not fit and answers `moved`/`skipped`; only when nothing moved it is a 409.

### Interview

Wishes and the note belong to every interview; the Kader's questions come on top. **Progress** = a wish (1) plus
every required question. An interview is *offen* until something with content is saved (naming the lead only plans
it), *angefangen* while it runs (`x/n`), *geführt* once completed — "Gespräch abschließen" needs a wish and every
required answer (409 "Noch offen: …"). A completed interview can be opened again. A new question shows as open for
everybody; deleting one takes its answers; renaming an option keeps its id and its answers; switching a question to or
from free text drops its answers, single ↔ multiple refits them.

### Answer colours

An answer is recognised at a glance before it is read (`lib/kader/colors.ts`):

- **Weekdays**: the options of a weekday question (`interview.ts` `isWeekdays`: seven options Monday to Sunday) carry
  the app's weekday colours — the tokens `--day-<mo…so>` the raider profile uses, mapped once by `[data-day]` in
  `styles/shared.css` (no copy of the values).
- **Choices**: every other option of a single or multiple choice has a palette colour, `OPTION_COLORS` = blue, amber,
  rose, teal, violet, lime, orange, slate (tokens `--opt-<name>` in `tokens.css`, dark and light, distinct in hue
  and lightness; mapped by `[data-opt]` in `kader.css`). An option stores its own as `color`; without one it gets the
  first palette colour no option of the question holds, by position (`optionColors`). The question editor shows a
  colour dot before every option that opens the eight swatches (radio buttons, each named), and it saves every
  option with its colour, so renaming and reordering keep it. The server takes only palette names (`cleanColor`, else
  400 "Unbekannte Farbe"); an option sent without `color` keeps the one it had, `""` resets it to automatic; a stored
  name the palette no longer knows is dropped on read. Weekday questions show the day colours instead of swatches.
- **Free text** stays plain.
- **Where**: the Übersicht (day squares, choices as chips; a dot per option in the filter menus), the Gespräche form
  (a picked day tinted in its colour, unpicked days neutral; every choice's marker in its colour, the picked pill
  tinted), the row tooltip and the drawer's answers (`AnswerChips` in `pages/kader/parts.tsx`) and the editor's
  preview. Only tints, dots, borders and markers carry the colour; the label is always written and stays `--text`
  (contrast holds in both themes, the colour is never the only signal, aria unchanged).
  `test/web-client/conventions/kaderColors.test.js` keeps client palette, server palette, tokens and mappings in step.

### Example setups

A variant is always four groups of five; `size` 10 shows groups 1–2 and keeps 3–4 untouched (switching the size is
non-destructive). A slot is `{ userId, spec }` — the spec is one of the player's wishes (or the decision). Only
players in `roster`, `provisional`, `bench` or `tentative` may stand in a setup, each once; a setup **never changes a
state**. "Automatisch verteilen" (sources: roster + provisional by default, bench/tentative switchable) fills the
visible groups — roster before provisional, then by attendance over the Kader's raid categories — with the heuristic of `kaderAutoAssign.js` (tanks
one per group, healers and shamans spread, melee to a shaman or warrior, casters to a healer or shaman).

## Live: changes, presence, conflicts

Several people work in the same Kader at the same time; the page shows what the others do without a reload and
never silently overwrites anything.

**Revisions** (`services/kader/kaderActivity.js`). Every write in `apiRoutes/kader.js` (`kaderWrite`, `fullWrite`)
compares the planner as stored with the one about to be stored (`recordChanges`) — so no write type can forget it.
When anything changed, the planner's counter `rev` goes up by one and everything that changed is stamped with it:
the Kader (`kader.rev`), an interview (`interview.rev`: wishes, answers, note, interviewer or completion), a question
(`question.rev`), an account's character data (`assignment.rev`, `by`, `at`), and `planner.sharedRev` for the
server's side (accounts, character data, a Kader created, renamed or deleted). Stamps of one counter only grow, so a
different revision always means a change in between, also after delete-and-recreate. A write that changes nothing
raises nothing. Data stored before (no revisions) reads as 0 and is written back unchanged (`kaderModel.normalize*`
keep a revision only when it is a positive number; `test/stores/kaderStore.test.js`).

**Activity log** (`kader.activity`, the newest 50, oldest first): one line per kind of change of a write,
`{ rev, at, by, type, playerId?, count?, from?, to?, questionId? }` — types `created`, `added`, `removed`, `state`,
`decision`, `interview`, `lead`, `interview_completed`, `interview_reopened`, `vote`, `comment`, `comment_deleted`,
`questions`, `setups`, `settings`, `character`. Several players of one write are one line with `count`; a question
edit that refits answers is one `questions` line, not one per interview; a move that drops setup slots is the move,
not a setup change. Repeated edits (`interview`, `lead`, `questions`, `setups`, `settings`, `character`) of the same
person on the same thing within ten minutes replace that person's earlier line, also with other people's lines in
between, and move to the end (newer `rev` and `at`) — an interview typed and autosaved every second stays one line, two
leads taking turns on one interview stay two. Never an answer, a note or a comment's text (tested).

**The poll** — `GET /api/kader/live?kader=<id>&rev=<n>&tab=<id>&sub=<page>&player=<id>&what=<interview|drawer|account>&edit=1`
(area `kader`, read): answers `{ rev, sharedRev, changes, more, presence }` — the Kader's revision, its activity lines
after `rev` (at most 20; `more` when there may have been more) and who else is in this Kader; `gone: true` for a Kader
that is not there. It never builds the view model: `kaderStore.liveState` keeps the revisions and logs per server in
memory and reads the file again only when it changed (a stat per poll). `leave=1` takes the tab out at once.
The page (`pages/kader/useKaderLive.ts`) asks every 5 s **only while the tab is visible** (`hooks/useVisiblePoll.ts`),
at once when the tab comes back, the page opens a Kader or opens something else; nothing for an account without
`kader` read, nothing after leaving the Kader pages (then `leave=1`). When `rev` or `sharedRev` moved, it fetches
again — only the Kader (`GET /api/kader/kader?kader=<id>`, `{ kader, kaders, sharedRev }`) when the change stayed
inside it, the whole view when the server's side changed, players came in or characters changed — and toasts what the
others did (`lib/kader/live.ts`): one change as its sentence ("Kurt hat Seraphine ins vorläufige Roster geschoben"),
several as "Lena hat 3 Änderungen gemacht" / "Lena und Kurt haben 4 Änderungen gemacht"; own changes never, a
repeated edit (somebody typing) once per two minutes. An answer older than an own save that landed meanwhile is
dropped.

**Presence** (`web/kader/kaderPresence.js`): the poll is the heartbeat. In memory only (one PM2 process), never on
disk, never logged; an entry is user id, display name, Kader, page, player, kind (`interview`, `drawer`, `account`),
whether it is edited (only with `kader` write) and when — gone 25 s after the last poll. Only callers in the same
Kader of the same server get it, never their own. The page shows it: the header's "Leitung" — a lead who is here gets
a ring and a green dot, others with access who are here stand beside them as small avatars (tooltip "Kurt · gerade
in Gespräche"); the Gespräche list rows, the Übersicht rows and the Vorläufig cards carry the coloured initial of who
has that player open ("Lena bearbeitet gerade dieses Gespräch" / "… sieht sich … gerade an"); an open interview,
drawer or account dialog says it in a calm line ("Lena bearbeitet gerade auch dieses Gespräch"). Parts report what
they have open with `useReportFocus` (the account dialog wins over the view under it).

**No silent overwrites.** The parts keep what is typed in their own state, keyed by the item only (the Gespräche
form by player, the drawer by player, the question editor by question, the dialogs by their open), so a refetch never
throws input away. A save names the revision it started from (`baseRev`): `PUT /api/kader/interview`,
`PUT /api/kader/assignments`, `PUT /api/kader/questions`. A newer stored revision answers **409 `stale`** with
`{ code, message, rev, by, at }` (`kaderModel.assertFresh`, sent by `guarded()` in the route module); `force: true`
overwrites ("Trotzdem speichern"); a save without `baseRev` is not checked. The interview (`useInterviewDraft.ts`):
another person's change with nothing unsaved here is taken over at once; with unsaved input — seen live or answered
409 — the input stays, **autosave pauses** and a banner offers "Neu laden" (their version) or "Trotzdem speichern"
(what is shown, `force`); nothing saves by itself until one is chosen, so there is no loop. Leaving the player with an
undecided conflict says in a toast that the input was not saved. The account dialog and the question editor work the
same way (an untouched draft follows, a touched one asks); the settings dialog shows a quiet "Kurt hat das
inzwischen geändert" (`changedSince`).

## Verlauf und Aktivität

Who changed what and when is in two logs, not on the working surfaces (no "seit … (wer)", no "Zuletzt gespeichert"):

- **Verlauf** of a player (`ActivityLog.tsx` `HistoryButton`, a clock button in the interview's head, the drawer's
  head and the account dialog): the player's `history`, newest first, each line with date and time, what and who.
- **Aktivität** of the Kader (header, next to the settings): the activity log, newest first, filterable by person
  (remembered in `kader-activity-person`).

The interview keeps only a small save-state icon (saved, saving, unsaved, paused, nothing yet — the words in the
tooltip) and "n Pflichtfragen offen" (the list in the tooltip) next to it, so the action buttons stay where they are.

## View model (`GET /api/kader?kader=<id>`)

`{ versionId, mainVersion: { id, label }, guildId, roles, classes, buffs: { raid, party }, raidCategories, players,
members, discordRoles, names, kaders, kader, warnings, sharedRev }`

- **buffs**: each with `label` (German) and `labelEn` (the rule set's English name — the totem's or the spell's,
  "Windfury Totem"); the setup hints take the one of the menu language (`lib/kader/setup.ts` `buffLabel`).
- **raidCategories**: `{ id, name, versionId, versionLabel, nights }` (see "Attendance per raid category"); a
  category's name carries its version only while the categories play different ones ("Mo Raid · TBC").
- **players**: everybody the planner knows on this server (profiles of the version, accounts, everybody in a Kader):
  `{ userId, displayName, avatarUrl, onServer, roleIds, hasProfile, manual, hasOverride, characters,
  activeCharacterId, differs, profile, prefill, pickable, availability, attendance, rev, changedBy }` — `attendance` per raid
  category, `rev`/`changedBy` the revision of the planner's character data and who saved it (0/"" without any).
- **pickable**: what the account dialog offers to assign, "Aus dem Profil zuweisen": every profile character of any game
  version `{ key, name, className, versionId, canTank, canHeal, specs, source: "profile" }` (the raider's order, no main) plus the log-linked one
  (`source: "logs"`). Same whitelisted fields as the rest of the profile (source: `allCharacters`); a pick fills a new
  planner character (Forever: first + last name, other versions: nickname) the lead can still edit.
- **prefill**: the character a player is prefilled with — `{ name, className, spec, source: planner|profile|logs,
  versionId }`, or `null` ("fehlt"). The planner's own data wins, then the profile of the version, then a profile
  character of another version (flagged by `versionId`), then the character the logs link to the account.
- **members**: the human members of the server `{ userId, displayName, roleIds, prefill }`; **discordRoles**: the
  roles at least one member holds, `{ id, name, color, count }` (the import dialog).
- **names**: a display name for every user id the page may show (leads, voters, who moved somebody).
- **kaders**: summaries `{ id, name, leads, createdAt, createdBy, counts: { [state]: n }, questions }`; **kader**: the
  chosen one in full, `null` when the address names none.

A change inside a Kader answers `{ kader, kaders, sharedRev, …extra }` (`moved`, `skipped`, `questionId`, `variantId`,
`commentId`, `copied`); a change on the server's side (taking players in, accounts, character data) answers the whole
view model again — the client sends the open `kaderId` with those writes too (`accounts/remove`, `assignments`,
`assignments/reset`); without it the answer has `kader: null`. The page swaps either in and refetches when a whole view
comes back without the open Kader.

## Write routes

Parameters in the body; `kaderId` names the Kader.

| Route | Body |
|---|---|
| `POST /api/kader/kaders` · `PUT` · `POST …/delete` | `{ name }` · `{ kaderId, name?, leads?, attendanceCategories? }` · `{ kaderId }` |
| `POST /api/kader/players/add` | `{ kaderId, players: [{ userId, displayName? }] }` → `added`, `already` (whole view) |
| `POST /api/kader/players/remove` | `{ kaderId, userIds }` |
| `POST /api/kader/players/state` | `{ kaderId, userIds, to, decision? }` |
| `PUT /api/kader/interview` | `{ kaderId, userId, wishes?, answers? (only those given; "" clears one), note?, lead?, baseRev?, force? }` |
| `POST /api/kader/interview/complete` · `…/reopen` | `{ kaderId, userId }` |
| `POST /api/kader/votes` | `{ kaderId, userId, vote: yes\|unsure\|no\|"" }` — leads only |
| `POST /api/kader/comments` · `…/delete` | `{ kaderId, userId, text }` · `{ kaderId, userId, commentId }` — own only |
| `POST /api/kader/questions` · `PUT` · `POST …/delete` | `{ kaderId, text, type, options: [{ id?, label, color? }], required }` · `{ kaderId, questionId, …, baseRev?, force? }` · `{ kaderId, questionId }` |
| `POST /api/kader/questions/order` · `…/copy` | `{ kaderId, order }` · `{ kaderId, fromKaderId }` |
| `POST /api/kader/variants` · `PUT` · `POST …/delete` · `…/auto` | `{ kaderId, name?, copyFrom? }` · `{ kaderId, variantId, name?, size?, groups? }` · `{ kaderId, variantId }` · `{ kaderId, variantId, sources }` |
| `POST /api/kader/accounts` | `{ userId, displayName, kaderId?, character? }` — with `kaderId` also into that Kader's pool (whole view) |
| `POST /api/kader/accounts/remove` | `{ kaderId, userId }` — only an account added by hand |
| `PUT /api/kader/assignments` · `POST …/reset` | `{ kaderId, userId, characters, activeCharacterId, baseRev?, force? }` · `{ kaderId, userId }` |
| `POST /api/kader/roster/sync` | `{ kaderId }` — "Ins Roster übernehmen" (#658): `kader` write **and** manager of the roster the Kader created → `{ rosterId, added, skipped, kept, roleFailures }` |

`baseRev`/`force`: see "Live" — a save from an older revision answers 409 `stale`. The reads: `GET /api/kader`
(the view), `GET /api/kader/kader?kader=<id>` (only the Kader), `GET /api/kader/live` (the poll),
`GET /api/kader/roster?kader=<id>` (the roster button, "Roster aus einem Kader").

## The page

`/kader/:kaderId/:sub` — `/kader` opens the Kader used last (`kader-last`), else the first; without any Kader the
start page shows the flow and "Ersten Kader anlegen".

- **Header**: the Kader picker (every Kader with "n im Roster · m gesamt", "Neuer Kader"), the leads as avatars,
  the settings (name, leads as rows with a remove button, add a member, the raid categories attendance counts in as a
  checklist with their nights, delete behind a confirmation). Below the
  **status bar** "Spieler je Status": one rectangular segment per state — icon, label, the count as a badge, the
  words ("3 Spieler im Pool") as tooltip and accessible name; Pool → Vorauswahl → Vorläufig, then Roster · Bench ·
  Tentative as one group. The states of the open page are marked (filled, accent underline); no step numbers.
- **Numbers say what they count**: a figure always stands next to its word ("18 von 18 Spielern", "Im Pool 3",
  "7 von 20 Plätzen", "2 von 5 Plätzen") or carries it as tooltip and screen-reader text (`Count` in
  `pages/kader/parts.tsx`: section heads, filter options, role counts, list heads).
- **Specs are icons**: a spec shows as its spec icon plus the class name in the class colour ("[Resto-Icon]
  Schamane"); "Schamane · Wiederherstellung" is the tooltip and the icon's label (`SpecTag`, `PickLabel`). Wishes
  in a small space are numbered icons ("1 [icon] 2 [icon]", `WishIcons`). Player names stay text.
- **Status icons** (`pages/kader/parts.tsx`): interview open = empty circle, running = a ring filled to x/n, held =
  check (also beside the name); answered question = check, required and open = "!"; state icons Pool = people,
  Vorauswahl = checklist, Vorläufig = hourglass, Roster = shield, Bench, Tentative = question mark; votes dafür =
  check, unsicher = question mark, dagegen = x. Line icons come from `components/ui/icons.tsx`, always with text or a
  label. Empty lists show a quiet icon above their text.
- **Every table sorts** (Pool, Übersicht, the import's member list): each column head is the shared `SortLabel`
  (`components/ui/SortTh.tsx`) inside a `SortHead` (`pages/kader/parts.tsx`) — a button, so the keyboard sorts too,
  `aria-sort` on the `role="columnheader"`, the chevron on the active column, a long label cut with "…" and the
  rule in the tooltip. `useTableSort` remembers the column per table (`kader-pool-sort`, `kader-overview-sort`,
  `kader-import-sort`); `lib/kader/sort.ts` turns a column into parts compared one after the other — numbers as
  numbers, text in the menu language's alphabet, "no value" (no attendance "—", no character, an unanswered
  question) last in both directions, ties by name. The keys: name, prefilled character (class, then spec), Discord
  roles (how many, then which), attendance, state; 1st/2nd wish (role order tank, healer, melee, ranged, then class
  and spec), one per question (a single answer by option order, several by how many, text alphabetically), interview
  (open, started, held, then progress), days waiting; in the import name, prefilled character and source. A grouped
  Übersicht sorts inside every group. On a phone the head of Pool and import becomes a wrapping bar of sort buttons.
- **A step back is a button** (`BackButton`, `pages/kader/parts.tsx`): "Zurück in den Pool" (Gespräche footer,
  marked rows of Pool and Übersicht), "Zurück in die Vorauswahl" / "Zurück ins vorläufige Roster" (drawer, full
  width), "Stimme zurückziehen", and the "Zur Vorauswahl" / "Zum vorläufigen Roster" head of a sub page — always the
  same outlined, tinted button with an arrow in its own sky blue (`--back-ink`, `--back-bg`, `--back-line` in
  `tokens.css`, at least 4.5:1 on its tint in both themes), never a faint text link.
- **`pool`**: everybody in the Kader with the prefilled character and its source (Profil / Logs / manuell / fehlt),
  Discord roles and attendance over the Kader's raid categories (the column head names them and opens the pick);
  search, scope "Alle im Kader / Im Pool / In der Vorauswahl", filter menus
  Discord-Rolle and Klasse. The switch "Zur Auswahl" moves pool ↔ Vorauswahl; somebody further along shows their
  state. Marked rows: zur Auswahl, nicht zur Auswahl, aus dem Kader entfernen. **"Aus Discord-Rolle hinzufügen"**:
  search and pick roles, everybody holding one of them with their prefilled character, tabs Neu / Schon im Pool /
  Ohne Chardaten, the checked ones go into the pool. **"Per Discord-ID"** adds one account by id (optionally with a
  first character).
- **`vorauswahl` (Gespräche)**: the players in the Vorauswahl (○ Offen / ✓ Geführt / Alle) with the interviewer
  as a badge and the status, a "Gespräch führt" menu (Alle · Ich · each lead · Niemand, each with its count over the
  list the segment shows; remembered per Kader in `eh-kader-interview-lead`) combinable with the segment,
  the interview of the chosen one (`?spieler=<id>`): wishes (drag or arrows; a new one by class and then one of its
  spec icons), the note, the questions (pills, day buttons for the seven weekdays, free text), who leads it (the
  same coloured menu), progress. It **saves itself** 800 ms after a change — only what changed (`patchOf`), with the
  revision it started from — and when another player is chosen or the page is left (see "Live" for a conflict).
  "Speichern & nächster", "Gespräch abschließen", "Wieder öffnen", "Zurück in den Pool"; the save state as a small
  icon and "n Pflichtfragen offen" in the footer, the Verlauf behind the clock button in the head.
- **`uebersicht`**: everybody in the Vorauswahl side by side — 1st and 2nd wish, one column per question (weekdays as
  squares), interview with the interviewer's badge below, days waiting; filter menus Gespräch, Interviewer (the leads
  plus "Niemand zugeteilt", an initial dot and a count each), 1. Wunsch and per question; grouped by role, class,
  interview, interviewer or none; a name shows the whole interview on hover. Marked rows go into the provisional roster (a
  confirmation when interviews are still open) or back into the pool.
- **Interviewer badges** (`LeadBadge`/`LeadMenu` in `pages/kader/Leads.tsx`, colours in `lib/kader/leads.ts`): one
  identity per lead everywhere — the Kader header's "Leitung" row, the Gespräche list and its header, the Übersicht
  (cell, group head, filter), the drawer's interview line and the vote authors. The colour comes from the user id
  (`leadHue`: one of four hues, so a lead keeps it when the list is reordered; only two leads that would share one are
  told apart, the lower id keeps it), never the only signal: the badge always shows the initial and the name
  (tooltip and `aria-label` "Gespräch führt: Kurt"; the signed-in account's own badge in menus adds "(du)"). The
  initial is drawn in the text colour on a tint of the lead's colour with a ring in it, so the contrast holds in
  both themes. Nobody assigned is a distinct warning badge ("Niemand", dashed person-question icon). The filter in
  the Übersicht is the ordinary `lead` menu of `FilterMenus` (`FilterOption.lead` draws the dot); `GroupBy` knows
  `lead` (one group per lead, then "Niemand zugeteilt").
- **`roster`**: one grid of four equal columns — Roster (two columns wide, its cards in two columns, the role mix in
  its head), Bench and Tentative on top, Vorläufig (all four columns) below — so every card is one column wide and
  64 px high. All sections share one panel; only a coloured line on top (roster teal, bench violet, tentative grey,
  vorläufig orange) and the state icon say which. One card everywhere: spec icon and name in the class colour, ✓
  votes for, × votes against, comments on the right; below it the decision (roster) or the wishes as numbered spec
  icons. An empty section is a dashed drop zone of card size. The layout follows the room the sections have (a
  container query): four columns down to 880 px, then two (Roster wide, Bench and Tentative, Vorläufig wide), one
  below 520 px. The drawer of a card (`?spieler=<id>`) stays on the right (a sheet over the page below 1100 px):
  wishes, the attendance with each category's share, the interview, the leads' votes (own vote if lead, take it
  back), comments (delete own), the **decision** —
  the spec picker on its own line, one full-width button "Ins Roster" (or "Entscheidung ändern", off until another
  spec is picked), Bench | Tentative (the current one pressed and off), the step back; the Verlauf behind the clock
  button in its head. The drawer is keyed by the player alone: a live change keeps a half-typed comment and a picked
  spec (the pick follows the stored decision until somebody picks).
- **The spec picker** (`pages/kader/WishPicker.tsx`): the same menu in the drawer's decision and in every setup
  slot — the player's wishes in wish order across classes (a decision outside them first, labelled
  "Entscheidung"), each row rank, spec icon, class in its colour and a check on the current one; the trigger shows
  the chosen spec's icon (and the class when there is room). Keyboard: Enter/ArrowDown opens, arrows move, Escape
  closes. `lib/kader/model.ts` `wishOptions` lists the choices.
- **`fragen`**: the fixed block (wishes, note), the Kader's questions in order (drag or arrows), the editor (text,
  kind, options each with its colour swatch, "Wochentage einsetzen", required, preview in the colours), delete with
  the number of answers it takes, "Fragen aus anderem Kader übernehmen" (the colours come along).
- **`setups`**: variant tabs (new, copy, rename, delete), 10er/20er, the sources as chips with their counts, "Noch
  ohne Gruppe" (with the wishes as icons), the groups with the spec picker per slot (class colour, role counts and buff
  hints follow the chosen spec), buff hints ("kein Totem der Manaquelle"), drag or pick-and-place, "Automatisch
  verteilen", "Als Text kopieren" (for Discord; a dialog with the text when the clipboard is refused).
- **Dialogs** share one rhythm (`kp-dialog`, `kp-stack`): 24 px body padding and between field groups, 8 px between
  a label and its control and between list rows, the hint set apart; buttons carry an icon where it helps (Speichern,
  Übernehmen, Löschen, In den Pool) and never get a width that cuts their label.
- **WoW icons** everywhere a class, spec or role is named (rule set icons, `ROLE_ICON` from
  `lib/raidplan/assign.ts`), each with its name as label and tooltip (`pages/kader/parts.tsx`).
- Remembered per browser: the last Kader, the pool scope and filters, the interview list, the overview grouping and
  filters, the sort column of every table, the setup sources and the variant per Kader. The attendance pick is not a
  browser setting: it is stored on the Kader.

## Umstellung vom alten Kaderplaner (#566)

`settingsMigration.migrateKaderPlanner()` runs at every bot start and upgrades a planner that still has `rosters`
(idempotent: a v2 planner is left alone; `normalizePlanner` falls back to the same code for a file the start did not
see). It logs one line per server: `kader.json: Server <id>: N Kader aus dem alten Format übernommen (x im Roster, y
auf der Bench, z Beispiel-Setup(s))`.

| Before (#566) | After |
|---|---|
| roster (name, size, targets) | a Kader with the same id and name, no leads yet (the first change of leads needs ≥ 1) |
| roster member (role slot) | state `roster`; decision = the spec of the account's character that fits the old role, else its main spec |
| bench | state `bench` |
| every player | wishes = the decision and the main spec; history `migrated` |
| setup variants | example setups, size 20 when the roster had ≥ 15 places, else 10; the first four groups are kept |
| accounts, assignments | unchanged |

The character data comes from the planner's own assignments, else the raider profile (`profileCharOf`). The golden
test `test/stores/settingsMigration.kader.test.js` runs the fixture `test/fixtures/kaderMigration/legacy.json` and
compares with `golden.json` (`UPDATE_GOLDEN=1` rewrites it).
