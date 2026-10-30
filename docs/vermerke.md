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

`src/stores/userNotesStore.js`, file `data/settings/user-notes.json` (sensitive, docs/data-storage.md):

```
{ guilds: { [guildId]: { [userId]: { name, entries: [note…] } } },
  hidden: { [guildId]: { [entryId]: { by, at } } } }
```

Only three modules read it: the routes (`src/web/apiRoutes/vermerke.js`), the short form
(`src/services/vermerke/vermerkeShort.js`) and the hints (`src/services/vermerke/userSignals.js`, see below). Nothing of a note is ever logged. Both are held by
`test/stores/userNotesStore.test.js`.

## Rights

Area `vermerke` (docs/permissions.md): **in no base access**, like `kader` — full admins and named people (an
account grant under "Einzelne Konten" or a role grant). `read` = the list and the notes, `write` = add, change,
archive, hide. Everything works on the **active server**; an entry of another server answers 404 `not_found`
unless it is shared (then read only). Without an active server: 400 `no_server`.

## API

| Route | Right | What |
|---|---|---|
| `GET /api/vermerke` | read | `{ people: [{ userId, name, level, reasons: {reason: n}, activeCount, totalCount, lastAt }] }`, newest first, no text |
| `GET /api/vermerke/person?userId=` | read | `{ userId, name, level, entries: [note + own, originGuildId, originName?, hidden, active] }` |
| `POST /api/vermerke` | write | `{ userId, name, level, reason, text?, eventIds?, expiresAt?, shared? }` → 201 `{ entry }` |
| `POST /api/vermerke/update` | write | `{ userId, id, …fields }` → `{ entry }`; archived: 409 `archived` |
| `POST /api/vermerke/archive` | write | `{ userId, id, archived = true }` → `{ entry }` |
| `POST /api/vermerke/hide` | write | `{ id, hidden = true }` → `{ id, hidden }` (shared notes of other servers only) |
| `POST /api/vermerke/delete` | full admin | `{ userId, id }` → `{ removed: true }` |
| `GET /api/vermerke/short?userIds=a,b` | see below | `{ short: { [userId]: { level, reasons } } }`, at most 200 ids |

Store refusals keep their code: `bad_user`, `bad_level`, `bad_reason`, `text_too_long`, `bad_expiry`, `too_many`
(400), `not_found` (404), `archived` (409).

## Short form

For every orga that plans a raid (#981): the highest active level and the reasons with their counts — **no text, no
author, no raids**. `shortOf(server, user)` / `shortFor(server, userIds)` in `vermerkeShort.js`; the endpoint is
open at the gate (`auth: "menu"`) and lets in: `vermerke` read, the global raid orga (orga rank with `raids` write,
`isGlobalRaidOrga` in `web/events/raidOrgaAccess.js` — the rule of the setup editor), or a manager of a roster of the
**active server** (`categoryOrga.isAnyCategoryManager(user, { guildId })`). Everyone else: 403 `orga_only`.
`shortFor` reads the store **once** for all ids (`activeEntriesMany`), so a raid with 40 signups is one read.

## Hints from the data (#982)

The bot **never makes a note itself** — it only proposes. The word is always "Hinweis", never "auffällig".

| Kind | Source | Default threshold |
|---|---|---|
| `signoff_after_setup` | sign-off while placed in the **approved** setup (`event.setup.approved`, for a raid group any raid of the group, noted at the first) — every way: web, bot, several raids at once, the orga for somebody | 2 in 60 days |
| `late_signoff` | sign-off of an existing signup less than `lateHours` (12) before the start, not placed | 2 in 60 days |
| `no_show` | **computed**, not stored: `noShow` in the attendance overrides (`attendanceOverridesStore`) of the server's own raids inside the window; a raid group (#811) is **one night** — an override at a further raid counts for the group's first raid, a person once per night; `at` is the start of the night | 2 in 60 days |
| `left_server` | leaving the Discord server (`memberActivity.onMemberRemove`) for somebody **tied to that server**: in an open roster of it (`roster.guildId`) or signed up at one of its own raids. Characters alone, a roster or a signup of another server, a Raid-Helper raid do not count | 1 |

`left_early` is **not** detected: there is no attendance per fight, wipes, raid groups, several logs and character
switches blur it, and Warcraft Logs has no events outside fights — own issue #990. A first
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

**Store** `src/stores/userSignalsStore.js`, file `data/settings/user-signals.json` (sensitive, kept **180 days**,
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
`lateHours` 12 (1–72), `leftServer` 1 (1–5). The page comes with #980. Empty, `null` or left out = the default
again; a value that is no whole number in its range answers 400 `bad_threshold` with `fields` (the keys) and saves
nothing; unknown keys are dropped.

| Route | Right | What |
|---|---|---|
| `GET /api/vermerke/signals` | read | `{ signals: [{ userId, name, kind, count, windowDays, events: [{ eventId, title, startTime }], lastAt }], thresholds }` |
| `POST /api/vermerke/signals/ignore` | write | `{ userId, kind }` → `{ ignored }`; 400 `bad_user` / `bad_kind` |
| `GET /api/vermerke/signals/settings` | read | `{ guildId, thresholds, own, defaults, limits }` |
| `POST /api/vermerke/signals/settings` | write | `{ thresholds, serverSettingsGuildId }` → same + saved; 409 `server_switched` for a stale tab |

## Never to the person

A note is never shown to the person it is about, nor to a raider at all: not in the profile, `/api/signups`, the
dashboard "Für dich", `/e/<id>`, `/p/<token>`, nor in "Ansicht als Raider" (an admin in that view is no admin and
has no `vermerke` right). `test/services/vermerke/vermerkeNeverToPerson.test.js` holds it twice: none of these pages
loads the store or the short form (whole require closure), and a raider / the raider view gets 403 on every route
without the marker text.

"Never to the person" means: never to a raider **without orga or Vermerke rights**. Whoever holds the rights (the
area `vermerke`, or the short form as raid orga / roster manager) also sees the notes on the own account — a
deliberate exception the user decided, nothing is filtered (`test/web/apiRoutes/vermerke.test.js` holds it).
