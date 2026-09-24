// Central access gate for /api/* — which admin-menu area each endpoint belongs
// to, checked before the route handler runs (see apiRouter.js's handle()).
//
// The required level follows the HTTP method: GET reads, everything else writes.
// Full admins pass everything; other users need the area granted to one of their
// Discord roles (see config/permissions.js and the "Berechtigungen" settings tab).
//
// Fail-closed by design: an endpoint missing from this table is admin-only, so
// adding a route without listing it here can never leak it to a limited role.
//
// A path may name *several* areas — then any one of them at the required level
// lets the call through. That is how the loot views ("loot") share endpoints with
// the full history ("history") without handing out the rest of that tab; the
// handlers of the shared endpoints trim their payload accordingly.
const { AREAS, userCanAny, userHasMenuAccess } = require("../config/permissions");

const AREA_BY_PATH = {
    "/api/dashboard": "dashboard",
    // The start page's "Raid-Details" modal, loaded when it opens.
    "/api/dashboard/next-raid": "dashboard",
    // Which commit the server runs and how far behind main it is (#314). The
    // commit itself is public (/health hands it to anyone); the comparison is an
    // operational detail, so it goes to whoever would act on it — and a member's
    // page load then never triggers a GitHub call.
    "/api/version": "settings",

    "/api/channels": "channels",
    "/api/channels/duplicate": "channels",
    // Issue #259: edit (PATCH /api/channels), archive, delete from the archive,
    // the rename preview, quick-create by schema, a category's naming schema
    // (/api/channels/schema) and the archive settings — all
    // writes, so all need "channels" at write. Deleting additionally refuses
    // anything outside the archive category (discordChannels.deleteChannel).
    "/api/channels/archive": "channels",
    "/api/channels/delete": "channels",
    "/api/channels/rename-preview": "channels",
    "/api/channels/batch": "channels",
    "/api/channels/schema": "channels",
    "/api/channels/config": "channels",

    "/api/settings": "settings",
    // Wowhead search behind the top-item picker in the Loot tab.
    "/api/settings/item-search": "settings",
    "/api/settings/raidsheets": "settings",
    "/api/settings/raidsheets/delete": "settings",
    // Loot-sync tokens. Listed here so a settings-reader gets the same 403 as
    // everywhere else, but the handlers additionally demand a *full* admin —
    // these are credentials that skip the Discord login (apiRoutes/settings.js).
    "/api/settings/ingest-tokens": "settings",
    "/api/settings/ingest-tokens/delete": "settings",
    // Einstellungen → Berechtigungen → Bot-Befehle. The handler additionally
    // demands a full admin, like every other access setting.
    "/api/bot-commands": "settings",
    // Event and talk server status (#251). Full-admin only in the handler as
    // well: which server is the event server decides where the role check runs.
    "/api/settings/discord-servers": "settings",
    // The raid overview on the talk server (#257): status, dry run, "neu posten".
    // Full-admin only in the handler, like the section it sits in.
    "/api/settings/talk-overview": "settings",
    // Role sync (full-admin only in the handler, it hands out roles) and the
    // automatic reminders per category (#264).
    "/api/settings/role-sync": "settings",
    "/api/settings/reminders": "settings",
    // Umstieg von Raid-Helper (#291): checklist, switch, spec-history import.
    // Full-admin only in the handlers.
    "/api/settings/raidhelper-retirement": "settings",
    "/api/settings/raidhelper-history-import": "settings",
    // The raider→character assignment lives in the settings page's own tab.
    "/api/raider-characters": "settings",

    "/api/roster": "roster",
    "/api/roster/hide": "roster",
    // The character page's attendance, role and item facts. The page is routed
    // under the roster and under the history, so either area opens it.
    "/api/roster/char": ["roster", "history"],
    // Characters more than one raider profile claims — the orga resolves them.
    "/api/roster/character-claims": "roster",

    // "Mein Profil" (#255). The handlers work on the session's own account only,
    // so granting "signup" to everyone (base access) hands out exactly that: one's
    // own profile. Another raider's profile, wishes included, is the orga's and
    // needs the roster.
    "/api/profile": "signup",
    "/api/profile/log-characters": "signup",
    "/api/profile/characters": "signup",
    "/api/profile/raiders": "signup",
    // Kalender-Abo (#312): the raider mints and revokes their own subscription
    // link. The store checks the owner, so this can only ever touch the
    // session's own tokens; the feed itself is no /api path at all
    // (/r/cal/user/<token>.ics) and authenticates with the token.
    "/api/profile/calendar": "signup",
    "/api/profile/user": "roster",
    // Anmeldungen (#256): the member's upcoming raids and their *own* signup —
    // the PUT handler only ever writes the session's account. All signups of an
    // event, with comments and "kann auch", are the orga's.
    "/api/signups": "signup",
    // Several raids at once (#293) — again only the session's own account.
    "/api/signups/bulk": "signup",
    "/api/signups/event": "raids",

    // The caster loot council. Starting a simulation is a POST, so the method
    // rule already makes it write-level — a read-only council member sees the
    // page and its stat-weight estimates, but does not spend CPU on it.
    "/api/lootcouncil": "lootcouncil",
    "/api/lootcouncil/sim": "lootcouncil",
    "/api/lootcouncil/item-search": "lootcouncil",
    "/api/lootcouncil/bislists": "lootcouncil",
    "/api/lootcouncil/armory": "lootcouncil",
    "/api/lootcouncil/loggear": "lootcouncil",
    "/api/lootcouncil/exclude": "lootcouncil",
    "/api/lootcouncil/role": "lootcouncil",
    "/api/lootcouncil/export": "lootcouncil",

    // GET lists, POST creates, PATCH edits an own event (#261) — the method sets the level.
    "/api/raids": "raids",
    "/api/raids/past": "raids",
    "/api/raids/new": "raids",
    "/api/raids/channel-name": "raids",
    "/api/raids/detail": "raids",
    "/api/raids/notify": "raids",
    "/api/raids/ping-missing": "raids",
    "/api/raids/invite-call": "raids",
    "/api/raids/fill": "raids",
    "/api/raids/post-sheet": "raids",
    "/api/raids/post-softres": "raids",
    "/api/raids/softres": "raids",
    "/api/raids/softres/link": "raids",
    "/api/raids/softres/item-search": "raids",
    "/api/raids/loot-system": "raids",
    // Setup editor of an own event (#263). GET reads (the handler hands a
    // reader only the approved lineup, never the draft); propose, save,
    // approve and the explanation are writes.
    "/api/raids/setup": "raids",
    "/api/raids/setup/propose": "raids",
    "/api/raids/setup/approve": "raids",
    // Post the approved setup into the channel again / retry its DMs (#290).
    "/api/raids/setup/post": "raids",
    // What "Ping everyone" (and the first post's own ping) sends (#354's follow-up).
    "/api/raids/setup/ping-text": "raids",
    "/api/raids/setup/explain": "raids",
    // Event verwalten (#288): the POSTs are writes by method; the two GETs only
    // prepare an action and check write access in the handler as well.
    "/api/raids/manage": "raids",
    "/api/raids/manage/move": "raids",
    "/api/raids/manage/signups": "raids",
    "/api/raids/manage/raider": "raids",
    "/api/raids/manage/raider/remove": "raids",
    "/api/raids/manage/cancel": "raids",
    "/api/raids/manage/reopen": "raids",
    "/api/raids/manage/delete": "raids",
    // Recurring events (#289): the list and the preview read, save/delete/run write.
    "/api/raids/series": "raids",
    "/api/raids/series/preview": "raids",
    "/api/raids/series/run": "raids",
    // The game version rule sets (classes, instances, buffs) feed the raid planning.
    "/api/game-versions": "raids",
    // Raidplan: board editor of an own event, its tactic profiles and the room-map
    // upload (GET reads, everything else writes, by method). The public read view
    // (/api/raidplan/public) is UNGATED below and authenticated by its token.
    "/api/raidplan": "raids",
    "/api/raidplan/publish": "raids",
    "/api/raidplan/suggest": "raids",
    "/api/raidplan/catalog": "raids",
    "/api/raidplan/catalog/mobs": "raids",
    "/api/raidplan/catalog/spells": "raids",
    "/api/raidplan/catalog/reset": "raids",
    "/api/raidplan/map": "raids",
    "/api/raidplan/map/delete": "raids",
    "/api/raidplan/profiles": "raids",
    "/api/raidplan/templates": "raids",
    "/api/raidplan/templates/duplicate": "raids",
    "/api/raidplan/apply": "raids",
    // Anmelde-Aufruf and raid templates are edited from the raid pages. The raid
    // templates are one path for GET/POST/PATCH/DELETE — the method sets the level.
    "/api/notify-templates": "raids",
    "/api/notify-templates/delete": "raids",
    "/api/raid-templates": "raids",
    "/api/raid-templates/import": "raids",

    "/api/recruitment": "recruitment",
    "/api/recruitment/delete": "recruitment",
    "/api/recruitment/post": "recruitment",
    "/api/recruitment/post-update": "recruitment",
    "/api/recruitment/post-delete": "recruitment",
    "/api/recruitment/scan": "recruitment",

    // Readable with "loot" too — the loot views need them. Their handlers cut
    // the payload down to the loot part for a caller who only holds "loot"
    // (apiRoutes/history.js), and writing still takes "history".
    "/api/history": ["history", "loot"],
    "/api/history/loot-stats": ["history", "loot"],
    "/api/history/loot-awards": ["history", "loot"],
    "/api/history/event": ["history", "loot"],
    "/api/history/char": ["history", "loot"],
    "/api/history/log-delete": "history",
    "/api/history/import": "history",
    "/api/history/import-preview": "history",
    "/api/history/inbox": "history",
    "/api/history/inbox-accept": "history",
    "/api/history/inbox-dismiss": "history",
    "/api/history/loot-category": "history",
    "/api/history/loot-delete": "history",
    "/api/history/loot-picker": "history",
    "/api/history/loot-add": "history",
    "/api/history/clear": "history",
    "/api/history/characters-resolve": "history",

    "/api/cla": "cla",
    "/api/cla/report-status": "cla",
    "/api/cla/report-delete": "cla",
    "/api/cla/report-unlink": "cla",
    "/api/cla/eval": "cla",
    "/api/cla/eval-status": "cla",
    "/api/cla/eval-reset": "cla",
    "/api/cla/scan": "cla",
    "/api/cla/log-delete": "cla",
    "/api/cla/log-link": "cla",
    "/api/cla/log-link-url": "cla",
    "/api/cla/log-unlink": "cla",
    "/api/cla/log-automatch": "cla",
    "/api/cla/recommendations": "cla",
    "/api/cla/recommendations/send": "cla",
    "/api/cla/recommendations/phrase": "cla",
};

// Answers for anyone, logged in or not — the client bootstraps from it.
// "/api/session/view-as" checks the caller's *own* rights in its handler
// (auth.getRealUser): while an admin looks at the menu as a role, this gate only
// sees the role's rights — and the way back out must never be refused by them.
// "/api/raidplan/public" is the token-guarded read view of a published raid plan
// (/p/<token>): no session needed, and its handler answers only for the token of
// a published plan.
const UNGATED = new Set(["/api/session", "/api/session/view-as", "/api/raidplan/public"]);
// Needs a menu user, but belongs to no single area (the guild switcher, the
// account's own menu language).
const ANY_AREA = new Set(["/api/session/guild", "/api/session/lang"]);
// Authenticated by an API token instead of a Discord session (the loot-sync
// uploader — see apiRoutes/ingest.js). These bypass *this* gate because there is
// no session user to check, never the auth itself: the handler rejects anything
// without a valid bearer token before it does any work. Deliberately a tiny,
// explicit set — an endpoint listed here is reachable by whoever holds a token.
const TOKEN_AUTH = new Set(["/api/ingest/loot", "/api/ingest/raids"]);

const LABELS = Object.fromEntries(AREAS.map((a) => [a.id, a.label]));

/** The areas listed for a path, always as an array (empty = not listed). */
function areasFor(pathname) {
    const entry = AREA_BY_PATH[pathname];
    if (!entry) return [];
    return Array.isArray(entry) ? entry : [entry];
}

/**
 * Check a request against the caller's permissions.
 * Returns null when it may proceed, else `{ status, code, message }` to send.
 */
function checkAccess(pathname, method, user) {
    if (UNGATED.has(pathname)) return null;
    if (TOKEN_AUTH.has(pathname)) return null;
    if (!user) return { status: 401, code: "unauthorized", message: "Nicht angemeldet." };
    if (!userHasMenuAccess(user)) {
        return { status: 403, code: "forbidden", message: "Kein Zugang zum Admin-Menü." };
    }
    if (ANY_AREA.has(pathname)) return null;
    const areas = areasFor(pathname);
    // Unknown endpoint (or one nobody listed): admins only.
    if (!areas.length) {
        return user.isAdmin ? null : { status: 403, code: "forbidden", message: "Kein Zugang zu diesem Bereich." };
    }
    const level = method === "GET" ? "read" : "write";
    if (userCanAny(user, areas, level)) return null;
    // The first area is the endpoint's home; the others only widen access, so it
    // is the one to name in the refusal.
    const label = LABELS[areas[0]] || areas[0];
    return {
        status: 403,
        code: "forbidden",
        message: level === "write"
            ? `Keine Schreibrechte für „${label}".`
            : `Kein Zugriff auf „${label}".`,
    };
}

module.exports = { checkAccess, areasFor, AREA_BY_PATH, UNGATED, ANY_AREA, TOKEN_AUTH };
