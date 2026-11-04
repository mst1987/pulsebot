# Server plans (#1080)

One place that says whether a Discord server may use a function. **Today the answer is always yes:** the only
plan is `free` and it unlocks everything; no route, menu entry or command carries a `feature` yet
(`test/config/plans.test.js` says so — drop that assertion with the first real feature).

## The parts

- `src/config/plans.js` — the features (`FEATURES`) and the plans (`PLANS`), pure data.
- `src/stores/settings/serverPlanStore.js` — `data/settings/server-plans.json`, `{ [guildId]: { plan, until, note } }`.
  A file of its own, not `config.json`: a settings PATCH must never run against it.
- `src/services/plans/serverPlan.js` — `serverPlan(guildId)`, `hasFeature(guildId, feature)`,
  `serverFeatures(guildId)`, `setServerPlan`, `planRows`.

No entry, an unknown plan or a passed `until` means `free`. That is fail-open on purpose, but only as long as
`free` holds everything: today no store mishap can take a function away from a server; once `free` lists its
features, the same fallback starts to refuse. `until` (`YYYY-MM-DD`) holds through its whole day, server time.

## Who sees it

Full admins only: `GET`/`PUT /api/settings/server-plans`, table under “Alle Server › Einstellungen › Tarife”. A
server admin sees nothing of it there. Each row's `state` is `known`, `gone` (bot online and the server not in its
cache: it certainly left) or `unknown` (bot offline or the server unavailable: no statement possible).

`planFeatures` in `GET /api/session` goes to every menu user, for their active server. It is empty today; once it
has content, those users can read from it what the plan of that server unlocks.

## Putting a function behind a plan

1. Add the feature to `FEATURES`, and to each plan that includes it. Once one plan shouldn't have it, `free` lists
   its features instead of `ALL_FEATURES`.
2. Set `feature` where the function is reached — one line each:

| Where | How | Refusal |
|---|---|---|
| API route | `feature: "x"` on the entry in `routes`; asked for the active server (`activeGuildFor`) after the rights | 403 `plan_required` |
| Menu | `"feature": "x"` on the entry in `src/config/menu.json`; `mayOpen` compares with `planFeatures` from `GET /api/session` | entry not shown |
| Bot command | `feature: "x"` on the command; `guardInteraction` (`botAccess.js`) asks before the rights, a button with `accessOf` counts as its command | ephemeral card |
| Job | `if (!hasFeature(guildId, "x")) continue;` per server in the job's loop | server skipped |

A plan binds full admins too: it describes the server, not the person. That is the one exception to “full admins
pass everything” in `apiAccess.js`.

`test/config/plans.test.js` fails on a `feature` that is not in `FEATURES`: the client only learns the list per
server, so such a feature would hide its menu entry on every plan.

A feature that hides a page also needs its section or tab hidden where the page is not a menu entry.
