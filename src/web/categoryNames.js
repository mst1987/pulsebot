// The raid categories a page needs to *label* an id with — as opposed to the
// ones it may *write into*.
//
// Everything the loot import and the raider assignments store is a bare Discord
// category id (see lootStore.js), so every overview that groups by category has
// to resolve those ids to names. Doing that against the live Discord channel
// cache alone (discord.listCategories()) silently fails in three real cases:
//   * the gateway is offline or the guild isn't cached yet (a local test
//     instance without a valid token — an explicitly supported setup). Then
//     there is no guild list either, so the active guild is "" as well and the
//     lookup isn't even attempted: EVERY id stays a raw snowflake.
//   * the category was deleted or recreated after the loot was imported
//   * the loot was imported under a guild that isn't the selected one
// So the live list is backed by names seen earlier: a snapshot written here on
// every successful live read, plus the per-event category names raidEventScan.js
// already persists in raidEventStore.js. Same persisted-snapshot idea the past
// raids list and matchableEvents.js use, for the same reason.
//
// For display only. Anything that validates a category the admin may pick (new
// channel, loot import target) must keep using discord.listCategories(), which
// answers "does this exist in Discord right now".
const fs = require("fs");
const path = require("path");
const discord = require("./discord");
const { listRaidEvents } = require("./raidEventStore");

const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const CATEGORY_NAMES_FILE = path.join(SETTINGS_DIR, "category-names.json");

/** @returns {Object<string, Object<string, string>>} guildId -> { categoryId: name } */
function readSnapshot() {
    try {
        const data = JSON.parse(fs.readFileSync(CATEGORY_NAMES_FILE, "utf8"));
        return (data && typeof data.guilds === "object" && data.guilds) || {};
    } catch {
        return {};
    }
}

function writeSnapshot(guilds) {
    try {
        fs.mkdirSync(SETTINGS_DIR, { recursive: true });
        fs.writeFileSync(CATEGORY_NAMES_FILE, JSON.stringify({ guilds }, null, 2));
    } catch {
        // A cache, not data: failing to persist it must never break a page.
    }
}

/**
 * Remember the live category names of a guild. Merged, never replaced — a guild
 * that is momentarily uncached must not drop the names of the others, and a
 * category deleted in Discord keeps the last name it had (that is the whole
 * point: the loot filed under it is still there).
 */
function rememberCategories(guildId, categories) {
    const gid = String(guildId || "").trim();
    if (!gid || !categories || !categories.length) return;
    const guilds = readSnapshot();
    const known = { ...(guilds[gid] || {}) };
    let changed = false;
    for (const c of categories) {
        const id = String((c && c.id) || "").trim();
        const name = String((c && c.name) || "").trim();
        if (!id || !name || known[id] === name) continue;
        known[id] = name;
        changed = true;
    }
    if (!changed) return;
    guilds[gid] = known;
    writeSnapshot(guilds);
}

/**
 * Categories for labelling: the live Discord ones first (in their Discord
 * order), then every category a name was ever seen for that Discord no longer
 * offers. Ids without a known name are not invented — a caller that finds no
 * entry keeps falling back to showing the id.
 *
 * With no active guild (`""`, which is what an offline gateway leaves behind)
 * the remembered names of all guilds are served: they are the only thing left
 * that can label a row, and a name is not worth gating on a guild selection
 * that cannot be made while Discord is down.
 *
 * @param {string} guildId  active guild, or "" when none is selected
 * @returns {{id: string, name: string}[]}
 */
function listKnownCategories(guildId) {
    const gid = String(guildId || "").trim();
    const out = [];
    const seen = new Set();
    const add = (id, name) => {
        const cid = String(id || "").trim();
        if (!cid || seen.has(cid)) return;
        seen.add(cid);
        out.push({ id: cid, name: String(name || "") });
    };

    if (gid) {
        const live = discord.listCategories(gid) || [];
        // Refresh the snapshot from the only authoritative source we get.
        rememberCategories(gid, live);
        for (const c of live) add(c && c.id, c && c.name);
    }

    const guilds = readSnapshot();
    for (const [snapshotGuild, names] of Object.entries(guilds)) {
        if (gid && snapshotGuild !== gid) continue;
        for (const [id, name] of Object.entries(names || {})) add(id, name);
    }

    // Last resort: the category name a scanned raid event carries. Newest event
    // first (listRaidEvents sorts by start time), so a renamed category shows
    // the most recently seen name.
    for (const e of listRaidEvents("")) {
        if (gid && e.guildId && e.guildId !== gid) continue;
        if (e.categoryId && e.categoryName) add(e.categoryId, e.categoryName);
    }

    return out;
}

module.exports = { listKnownCategories, rememberCategories, CATEGORY_NAMES_FILE };
