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
| `src/stores/kaderStore.js` | `data/settings/kader.json`, one planner per Discord server |
| `src/web-client/src/pages/kader/` | the page (`KaderPage.tsx`): header, status bar, the six views and the dialogs |
| `src/web-client/src/lib/kader/` | client logic: `model.ts` (names, icons, states, counts, the attendance sum over the Kader's raid categories), `interview.ts` (progress, draft/patch), `filters.ts`, `sort.ts` (the sort keys of the planner's tables), `colors.ts` (the colours of the answers), `setup.ts` (slots, buff hints, Discord text), `names.ts` |
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
`src/stores/settingsMigration.js` and `src/web/apiRoutes/kader.js` (`test/stores/kaderStore.test.js` keeps that list),
and the route test serialises the other areas' answers and asserts none of it appears. In the other direction a
profile leaves `kaderSource.js` as a whitelist (characters, specs, gear, main, tank/heal, raid days, the saved
name) — never `avoid`, wishes, the note, preferred raids or calendar tokens (`test/web/kader/kaderSource.test.js`).

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
| `state`, `since`, `by` | `pool` · `selected` · `provisional` · `roster` · `bench` · `tentative`, with when and who — every page shows "seit 30.09. (Kurt)" |
| `addedAt`, `addedBy` | when and by whom the player came into this Kader |
| `history` | the last 50 events: `added`, `state {from,to}`, `decision {className,spec}`, `interview_completed`, `interview_reopened`, `vote {vote|none}`, `migrated {to}` — with `at` and `by` |
| `wishes` | `[{ className, spec }]` in order (≤ 6, no spec twice); prefilled with the account's character when taken in |
| `interview` | `{ lead, answers: { [questionId]: optionId \| [optionId] \| text }, note (≤ 2000), startedAt, updatedAt, updatedBy, completedAt, completedBy }` |
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

## View model (`GET /api/kader?kader=<id>`)

`{ versionId, mainVersion: { id, label }, guildId, roles, classes, buffs: { raid, party }, raidCategories, players,
members, discordRoles, names, kaders, kader, warnings }`

- **buffs**: each with `label` (German) and `labelEn` (the rule set's English name — the totem's or the spell's,
  "Windfury Totem"); the setup hints take the one of the menu language (`lib/kader/setup.ts` `buffLabel`).
- **raidCategories**: `{ id, name, versionId, versionLabel, nights }` (see "Attendance per raid category"); a
  category's name carries its version only while the categories play different ones ("Mo Raid · TBC").
- **players**: everybody the planner knows on this server (profiles of the version, accounts, everybody in a Kader):
  `{ userId, displayName, avatarUrl, onServer, roleIds, hasProfile, manual, hasOverride, characters,
  activeCharacterId, differs, profile, prefill, availability, attendance }` — `attendance` per raid category.
- **prefill**: the character a player is prefilled with — `{ name, className, spec, source: planner|profile|logs,
  versionId }`, or `null` ("fehlt"). The planner's own data wins, then the profile of the version, then a profile
  character of another version (flagged by `versionId`), then the character the logs link to the account.
- **members**: the human members of the server `{ userId, displayName, roleIds, prefill }`; **discordRoles**: the
  roles at least one member holds, `{ id, name, color, count }` (the import dialog).
- **names**: a display name for every user id the page may show (leads, voters, who moved somebody).
- **kaders**: summaries `{ id, name, leads, createdAt, createdBy, counts: { [state]: n }, questions }`; **kader**: the
  chosen one in full, `null` when the address names none.

A change inside a Kader answers `{ kader, kaders, …extra }` (`moved`, `skipped`, `questionId`, `variantId`,
`commentId`, `copied`); a change on the server's side (taking players in, accounts, character data) answers the whole
view model again. The page swaps either in.

## Write routes

Parameters in the body; `kaderId` names the Kader.

| Route | Body |
|---|---|
| `POST /api/kader/kaders` · `PUT` · `POST …/delete` | `{ name }` · `{ kaderId, name?, leads?, attendanceCategories? }` · `{ kaderId }` |
| `POST /api/kader/players/add` | `{ kaderId, players: [{ userId, displayName? }] }` → `added`, `already` (whole view) |
| `POST /api/kader/players/remove` | `{ kaderId, userIds }` |
| `POST /api/kader/players/state` | `{ kaderId, userIds, to, decision? }` |
| `PUT /api/kader/interview` | `{ kaderId, userId, wishes?, answers? (only those given; "" clears one), note?, lead? }` |
| `POST /api/kader/interview/complete` · `…/reopen` | `{ kaderId, userId }` |
| `POST /api/kader/votes` | `{ kaderId, userId, vote: yes\|unsure\|no\|"" }` — leads only |
| `POST /api/kader/comments` · `…/delete` | `{ kaderId, userId, text }` · `{ kaderId, userId, commentId }` — own only |
| `POST /api/kader/questions` · `PUT` · `POST …/delete` | `{ kaderId, text, type, options: [{ id?, label, color? }], required }` · `{ kaderId, questionId, … }` · `{ kaderId, questionId }` |
| `POST /api/kader/questions/order` · `…/copy` | `{ kaderId, order }` · `{ kaderId, fromKaderId }` |
| `POST /api/kader/variants` · `PUT` · `POST …/delete` · `…/auto` | `{ kaderId, name?, copyFrom? }` · `{ kaderId, variantId, name?, size?, groups? }` · `{ kaderId, variantId }` · `{ kaderId, variantId, sources }` |
| `POST /api/kader/accounts` | `{ userId, displayName, kaderId?, character? }` — with `kaderId` also into that Kader's pool (whole view) |
| `POST /api/kader/accounts/remove` | `{ userId }` — only an account added by hand |
| `PUT /api/kader/assignments` · `POST …/reset` | `{ userId, characters, activeCharacterId }` · `{ userId }` |

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
  check, unsicher = question mark, dagegen = x. Line icons come from `components/icons.tsx`, always with text or a
  label. Empty lists show a quiet icon above their text.
- **Every table sorts** (Pool, Übersicht, the import's member list): each column head is the shared `SortLabel`
  (`components/SortTh.tsx`) inside a `SortHead` (`pages/kader/parts.tsx`) — a button, so the keyboard sorts too,
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
- **`vorauswahl` (Gespräche)**: the players in the Vorauswahl (○ Offen / ✓ Geführt / Alle) with lead and status,
  the interview of the chosen one (`?spieler=<id>`): wishes (drag or arrows; a new one by class and then one of its
  spec icons), the note, the questions (pills, day buttons for the seven weekdays, free text), who leads it,
  progress. It **saves itself** 800 ms after a change — only what changed (`patchOf`) — and when another player is
  chosen or the page is left. "Speichern & nächster", "Gespräch abschließen", "Wieder öffnen", "Zurück in den Pool".
- **`uebersicht`**: everybody in the Vorauswahl side by side — 1st and 2nd wish, one column per question (weekdays as
  squares), interview, days waiting; filter menus Gespräch, 1. Wunsch and per question; grouped by role, class,
  interview or none; a name shows the whole interview on hover. Marked rows go into the provisional roster (a
  confirmation when interviews are still open) or back into the pool.
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
  spec is picked), Bench | Tentative (the current one pressed and off), the step back — and the history.
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
