const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const { buildRoster, rosterCharacter } = require("../characters/roster");
const { rosterStats } = require("../characters/rosterStats");
const rosterHidden = require("../../stores/rosterHiddenStore");
const { repairItemNames: repairLootItemNames } = require("../../stores/lootStore");
const { sourceForItem, content, tier } = require("../../config/tbcContent");
const { bisSpecsView } = require("../loot/lootCouncil");
const { knownVersion, resolveVersionQuery } = require("../../services/events/mainVersion");
const { getConfig } = require("../../stores/settingsStore");
const { userIsOrga } = require("../../config/permissions");
const profiles = require("../../stores/raiderProfileStore");

/**
 * The game version a list is filtered to (#543): `?version=<id>`, "all" for
 * every version, nothing = the main version from the settings. Shared by every
 * list that mixes versions (#545) — see mainVersion.resolveVersionQuery.
 * @returns {{ versionId: string, mainVersion: string }}  versionId "" = all
 */
function versionFilter(url) {
    return resolveVersionQuery(url && url.searchParams.get("version"), { config: getConfig() });
}

// How many item ids one character request may ask about — a paperdoll has 19.
const MAX_ITEM_IDS = 30;

/**
 * GET /api/roster[?version=<id>|all] — every character grouped by raid category (see roster.js),
 * of one game version (#543; the main version unless the page asks for another or "all").
 * Attendance and who else plays a character are people data: 403 "orga_only" for anybody
 * but the orga (full admin or orga role; epic #723).
 */
const getRoster = withUser({}, async ({ req, res, user, url }) => {
    if (!userIsOrga(user)) return apiError(res, 403, "orga_only", "Nur die Orga sieht das.");
    // Same one-time backfill the loot pages run, so the hover panel never shows
    // "Item <id>" for rows imported before icon enrichment existed.
    await repairLootItemNames();
    const guildId = activeGuildFor(req);
    const { versionId, mainVersion } = versionFilter(url);
    const { chars, categories, categoryInfo, versions } = buildRoster(guildId, { versionId, mainVersion, config: getConfig() });
    // Characters somebody took off the roster (left the guild, one-off alt) go
    // out in their own list instead of being dropped: the page's "Ausgeblendet"
    // tab lists them and puts them back. The stats describe the roster that is
    // left — an attendance average over people who are gone says nothing about
    // the raid that is still running.
    const hidden = rosterHidden.listHidden();
    const isHidden = (c) => !!hidden[rosterHidden.characterKey(c.character)];
    const active = chars.filter((c) => !isHidden(c));
    const hiddenChars = chars.filter(isHidden).map((c) => ({ ...c, hidden: hidden[rosterHidden.characterKey(c.character)] }));
    // Aggregated server-side so the header band and the table can never
    // disagree, and so the numbers are covered by the test suite.
    ok(res, {
        chars: active,
        hiddenChars,
        categories,
        categoryInfo,
        stats: rosterStats(active),
        activeGuildId: guildId,
        // The version filter (#543): what is shown ("" = all), the default, and the choices.
        version: versionId,
        mainVersion,
        versions,
    });
});

/**
 * POST /api/roster/hide — take a character off the roster, or put it back.
 * Body: { character, hide: boolean, reason? }
 *
 * Nothing is deleted: the loot history, the evaluations and the character page
 * stay whole, the roster page simply stops listing them (see rosterHiddenStore).
 */
const postRosterHide = withUser({ write: "roster", csrf: true, body: true }, async ({ user, body, res }) => {
    if (!userIsOrga(user)) return apiError(res, 403, "orga_only", "Nur die Orga sieht das.");
    const character = String(body.character || "").trim();
    if (!character) return apiError(res, 400, "bad_request", "Kein Charakter angegeben.");

    if (body.hide === false) {
        const removed = rosterHidden.unhide(character);
        return ok(res, { character, hidden: false, changed: removed });
    }
    const entry = rosterHidden.hide(character, {
        reason: String(body.reason || "").trim(),
        by: user.name || user.id,
    });
    ok(res, { character, hidden: true, entry });
});

/**
 * What the item-details modal says about a worn piece beyond its tooltip:
 * which raid, boss and tier it drops from, and whose BiS list carries it.
 */
function itemFacts(itemId) {
    const id = Number(itemId) || 0;
    const source = sourceForItem(id);
    const meta = source ? content(source.content) : null;
    const tierMeta = meta ? tier(meta.tier) : null;
    return {
        itemId: id,
        contentId: (source && source.content) || "",
        content: (meta && meta.short) || "",
        boss: (source && source.boss) || "",
        tier: (tierMeta && tierMeta.label) || "",
        bisSpecs: bisSpecsView(id, (meta && meta.tier) || ""),
    };
}

/** Whether `name` is a character on the caller's own raider profile. */
function isOwnCharacter(user, name) {
    const profile = user && user.id ? profiles.getProfile(user.id) : null;
    return !!profile && !!profiles.findCharacter(profile, name);
}

/**
 * GET /api/roster/char?name=<name>&items=<id,id,…> — the character page's roster
 * facts: role, categories with attendance night by night, and per worn item its
 * drop source and BiS specs. The page asks for it beside /api/history/char and
 * shows these parts only when the answer comes back. The attendance and the categories (who raids
 * where) are the orga's - or the character's own player: for anybody else both come back empty and
 * `attendanceVisible` is false (epic #723). Role and the items' drop sources stay.
 */
const getRosterChar = withUser({}, async ({ req, res, user, url }) => {
    const name = String(url.searchParams.get("name") || "").trim();
    const guildId = activeGuildFor(req);
    const version = String(url.searchParams.get("version") || "").trim();
    const facts = name ? rosterCharacter(guildId, name, { versionId: knownVersion(version) }) : null;
    const ids = String(url.searchParams.get("items") || "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, MAX_ITEM_IDS);
    const items = {};
    for (const id of new Set(ids)) items[id] = itemFacts(id);
    const attendanceVisible = userIsOrga(user) || isOwnCharacter(user, name);
    ok(res, {
        character: name,
        role: (facts && facts.role) || "",
        categories: attendanceVisible ? (facts && facts.categories) || [] : [],
        attendance: attendanceVisible ? (facts && facts.attendance) || {} : {},
        attendanceVisible,
        items,
    });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/roster", handler: getRoster, area: "roster" },
    { method: "POST", path: "/api/roster/hide", handler: postRosterHide, area: "roster" },
    { method: "GET", path: "/api/roster/char", handler: getRosterChar, area: ["roster", "history"] },
];

module.exports = { getRoster, postRosterHide, getRosterChar, itemFacts, versionFilter, MAX_ITEM_IDS, routes };
