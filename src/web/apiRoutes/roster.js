const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const { buildRoster, rosterCharacter } = require("../characters/roster");
const { rosterStats } = require("../characters/rosterStats");
const rosterHidden = require("../../stores/rosterHiddenStore");
const { repairItemNames: repairLootItemNames } = require("../../stores/lootStore");
const { sourceForItem, content, tier } = require("../../config/tbcContent");
const { bisSpecsView } = require("../loot/lootCouncil");

// How many item ids one character request may ask about — a paperdoll has 19.
const MAX_ITEM_IDS = 30;

/** GET /api/roster — every character grouped by raid category (see roster.js). */
const getRoster = withUser({}, async ({ req, res }) => {
    // Same one-time backfill the loot pages run, so the hover panel never shows
    // "Item <id>" for rows imported before icon enrichment existed.
    await repairLootItemNames();
    const guildId = activeGuildFor(req);
    const { chars, categories, categoryInfo } = buildRoster(guildId);
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

/**
 * GET /api/roster/char?name=<name>&items=<id,id,…> — the character page's roster
 * facts: role, categories with attendance night by night, and per worn item its
 * drop source and BiS specs. The page asks for it beside /api/history/char and
 * shows these parts only when the answer comes back.
 */
const getRosterChar = withUser({}, async ({ req, res, url }) => {
    const name = String(url.searchParams.get("name") || "").trim();
    const guildId = activeGuildFor(req);
    const facts = name ? rosterCharacter(guildId, name) : null;
    const ids = String(url.searchParams.get("items") || "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, MAX_ITEM_IDS);
    const items = {};
    for (const id of new Set(ids)) items[id] = itemFacts(id);
    ok(res, {
        character: name,
        role: (facts && facts.role) || "",
        categories: (facts && facts.categories) || [],
        attendance: (facts && facts.attendance) || {},
        items,
    });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/roster", handler: getRoster, area: "roster" },
    { method: "POST", path: "/api/roster/hide", handler: postRosterHide, area: "roster" },
    { method: "GET", path: "/api/roster/char", handler: getRosterChar, area: ["roster", "history"] },
];

module.exports = { getRoster, postRosterHide, getRosterChar, itemFacts, MAX_ITEM_IDS, routes };
