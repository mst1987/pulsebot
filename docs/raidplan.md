# Raidplan

The raid plan of an own event: **one plan per event, one board per boss** — the room map as the background, player tokens placed freely on it, target rows with the players assigned to them, and a note. It sits next to the Google raidsheet (`fillSetup`, `eventSheetStore`), which stays unchanged and independent. The design canvas it follows is the "Raidplan" artifact (Boards, Editor, Sheet view).

## Where it lives

| Piece | File |
|---|---|
| Plan store, validation, room maps | `src/web/raidplanStore.js` |
| Tactic profiles (collection store) | `src/web/raidplanProfileStore.js` |
| What the editor and the public page are shown | `src/web/raidplan.js` |
| API | `src/web/apiRoutes/raidplan.js` (routes in `apiRouter.js`, areas in `apiAccess.js`) |
| Room-map delivery | `/rp-map/<instance>[/<boss>]` in `server.js` |
| Editor (tab of the raid detail) | `src/web-client/src/pages/raid-detail/RaidplanTab.tsx` and `raidplan/` |
| Board, token, player icon (editor and read view) | `src/web-client/src/components/raidplan/PlanBoard.tsx` |
| Read view | `src/web-client/src/pages/PlanPublicPage.tsx`, route `/p/<token>` |
| Pure board logic | `src/web-client/src/lib/raidplan.ts` |
| Styles (prefix `rp-`) / texts | `styles/raidplan.css` / `i18n/locales/{de,en}/raidBoard.json` |

Only an **own event** has a raid plan (the tab is hidden for a Raid-Helper event, the API answers 409): the players come from the event's setup, which only own events have.

## Data model

`data/settings/raidplans.json`: `{ plans: [{ eventId, version, status: "draft" | "published", publicToken, bosses, updatedAt, updatedBy }] }`, `bosses[bossKey] = { tokens: [{ userId, x, y }], targets: [{ id, title, userIds }], notes, profileId }`.

- **Players are only a `userId`.** Name, class, spec, role and icon are looked up in the event's setup on every read (`raidplan.js`'s `rosterFrom`), never copied into the plan — so a changed spec follows on its own. `x`/`y` are relative to the board (0..1).
- **Boss key** = `<instanceId>/<slug of the boss name>` (`bt/gurtogg-bloodboil`), from the instances of the event (`event.instanceIds` → `config/gameVersions`, `bosses`). Stable across renames of the display label; an event without an instance has no bosses (the tab says so).
- **Strict validation on every save** (`raidplanStore.cleanBosses`): coordinates clamped, at most 60 tokens / 30 rows / 25 players per row per boss, titles 80 and notes 1000 characters, a `userId` that is not in the event's current lineup is **dropped** (counted in the answer's `dropped`, the editor says so) instead of blocking every later save, a boss the event no longer has is dropped, a row id that is unusable is replaced, an untouched boss is not stored, a `profileId` that no longer exists is forgotten.
- **Version check:** `PUT` carries the `version` it read; a stale one answers `409 conflict`, the editor keeps the unsaved draft and offers "Neu laden". Nothing is written before "Speichern".
- **Who is offered:** the editor (raids) sees the current lineup — the draft when there is one, else the approved one. The **read view names only players of the *approved* setup** (a raider never sees a setup draft, see docs/setup.md); a token of somebody who is only in the draft is left out there, and the share dialog says so.

## Room maps

There are **no maps in the repo** and nothing is fetched from anywhere; the orga uploads them.

- Per boss and per instance (the fallback of every boss without its own): `POST /api/raidplan/map?key=<bossKey|instanceId>` with the **file as the request body** (`readRawBody`, cut off at 3 MB), `POST /api/raidplan/map/delete { key }`. Area `raids` write. The key must be a known instance id or boss key, so no path can be built from it.
- The server recognises PNG, JPG and WebP **by the first bytes** (`sniffImage`), never by the claimed type; SVG and everything else is refused. Stored in `data/raidplan-maps/<key with / as __>.<ext>`, one file per key (a new upload replaces the old one, whatever its type).
- Delivered at `/rp-map/<key>` without a login (the public page shows them too), `Cache-Control: public, max-age=86400`, `X-Content-Type-Options: nosniff`. The url the API hands out carries `?v=<mtime>`, so a new upload is never hidden by the cache.
- Without a map the board shows a neutral grid with the boss icon.

## Tactic profiles

A named, categorised set of target rows the orga picks for a boss instead of typing the rows again. `data/settings/raidplan-profiles.json`: `{ id, name, category, bossKey, targets: [{ title }], notes, updatedAt }`.

- `category` is free text (the editor offers the ones in use and lets a new one be typed); `bossKey` is `""` (every boss), an instance id, or one boss.
- **Nothing is shipped** and no boss mechanics are invented; a profile holds only what the orga wrote. Titles only: **who stands on a row is decided per plan**. A token layout is not part of a profile (follow-up).
- API (area `raids`, GET reads, the rest writes, CSRF): `GET/POST/PATCH/DELETE /api/raidplan/profiles`. The editor payload carries the list too.
- In the board: "Taktik wählen" opens the picker (the profiles that fit the boss, grouped by category, with a search). Picking one **replaces the rows and the note** (asked first when the board already holds something; players stay on rows whose title stays) and remembers the `profileId` in the plan. "Als Taktik speichern" (from the rows on the board) and "Taktiken verwalten" sit in the picker's foot. Managing follows the collection pattern of docs/web-admin.md: **list first, one editor at a time**; a profile's rows are edited as one title per line. Renaming or changing a profile does not touch rows that were applied earlier — the plan stores copies plus the profile id; the read view shows the profile's current name.

## Editor

Raid-Detail › tab **Raidplan** (own event, order Roster, Setup, Raidplan, Loot, Logs). Left the bosses, in the middle the board of the chosen boss, on the right the target rows (with the tactic button and the note) and the players **not placed yet**.

- **Pointer Events on `window`, no HTML5 drag and drop**, so a finger works like a mouse: a player from the list onto the board, a token around the board (it follows the pointer live, grip kept), a token onto the list to take it off. `touch-action: none` on the draggable things. A focused token moves with the arrow keys (Shift = bigger steps), Delete removes it.
- Tokens show the **real spec icon** (`iconUrl` from the rule set) on a tile tinted in the class colour, ringed in the **role colour** (tank blue, healer cyan, everything else orange) — no hand-drawn circles with letters; the name below in the class colour.
- Rows: free title, players from the roster (a picker dialog), delete. "Zeile hinzufügen" starts empty.
- **Freigeben & teilen** (dialog): publish / withdraw, the link, a new link (the old one stops working). Publishing changes only the state, not the unsaved draft; what is *saved* is what is published.
- Without `raids` write everything is read-only.

## Read view (`/p/<token>`)

The "Sheet-Ansicht": per boss the board with its map and the table of rows, the note and the tactic name. **No login, no menu**: `App.tsx` answers `/p/<token>` before it asks for a session; the data comes from `GET /api/raidplan/public?token=…`, which is in `UNGATED` (`apiAccess.js`, see docs/permissions.md) and answers **one and the same 404** for an unknown token, a withdrawn plan and a plan whose event is gone. The token is minted on the first publish (18 random bytes, url-safe), kept while the plan is withdrawn, and rotated on request. The page carries nothing personal beyond the character names of the approved setup.

**Own token highlighted:** the endpoint reads the visitor's session if there is one (`auth.getUser`) and answers `me` = their Discord id when they stand in the plan; the page then rings their token, marks their rows and says so. A visitor without a login gets a "log in" link (the login returns to the menu start, not to the plan — a follow-up). It grants nothing: the highlight is the only thing a session changes.

## Permissions

All `/api/raidplan…` paths are area **`raids`** (read = GET, write = everything else), listed in `apiAccess.js` (fail-closed) except `/api/raidplan/public`. Mutating calls use `requireAdmin` + `requireCsrf`. Deleting an event deletes its plan (`eventManage.deleteEvent`).

## Tests

`test/web/raidplanStore.test.js`, `raidplanProfileStore.test.js`, `raidplanRoute.test.js` (gate, editor payload, save/conflict, publish, upload, profiles, public view), the routing in `test/web/server.test.js`, `readRawBody` in `apiBody.test.js`, and `test/web-client/raidplan.test.js` (board logic run for real, structure of the pages, texts in both languages).
