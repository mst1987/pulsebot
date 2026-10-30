// Einstellungen → <Server> → Top-Items (#952): which items a server counts as a
// "big" drop, per game version. The page shows the raids and bosses of the
// version's loot table on the left and the full loot of one boss on the right,
// each item with a switch that saves at once; a Wowhead search adds items no
// boss drops (reputation, professions, quests) - listed as "Ohne Zuordnung".
//
//   GET /api/settings/top-items?version=   the page: raids, bosses, picked items
//   PUT /api/settings/top-items            one item on or off
//
// Stored in config.serverSettings[guildId].topItems (services/loot/topItems.js).
// Right: settings of the active server; a save only ever goes to the active
// server, a tab that loaded another one gets 409 `server_switched` (like the
// settings PATCH).
const { ok, error } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { activeGuildFor } = require("../../http/activeGuild");
const { getConfig, saveConfig } = require("../../../stores/settings/settingsStore");
const { TOP_ITEM_NAME_MAX } = require("../../../stores/settings/configSchema");
const { VERSIONS } = require("../../../config/gameVersions");
const { knownVersion, mainVersionFor } = require("../../../services/versions/mainVersion");
const { MAX_TOP_ITEMS, topItemListsOf, topItemsOf, withTopItem } = require("../../../services/loot/topItems");
const { lootCatalog } = require("../../loot/lootCatalog");
const { settingsForVersion } = require("../../../services/versions/versionSettings");

/**
 * The loot table of a version, raid by raid and boss by boss in the order the
 * raid meets them. Only TBC has one yet (config/data/tbcContent.js); Classic Era and
 * Forever answer [] until theirs exist (#760/#765) - the page then offers the
 * search alone.
 */
let tbcRaids = null;
function raidsOf(versionId) {
    if (versionId !== "tbc") return [];
    if (!tbcRaids) tbcRaids = groupByBoss(lootCatalog());
    return tbcRaids;
}

/** The catalog's raids with their items grouped per boss (static data, built once). */
function groupByBoss(catalog) {
    return catalog.map((raid) => {
        const bosses = [];
        const byName = new Map();
        for (const it of raid.items) {
            if (!byName.has(it.boss)) {
                const boss = { name: it.boss, items: [] };
                byName.set(it.boss, boss);
                bosses.push(boss);
            }
            byName.get(it.boss).items.push({ id: it.id, name: it.name, iconUrl: it.iconUrl, quality: it.quality });
        }
        return { id: raid.id, label: raid.label, short: raid.short, tierLabel: raid.tierLabel, bosses };
    }).filter((raid) => raid.bosses.length);
}

/** The catalog entry of an item id in a version's loot table, or null. */
function catalogItem(versionId, id) {
    for (const raid of raidsOf(versionId)) {
        for (const boss of raid.bosses) {
            const hit = boss.items.find((it) => it.id === id);
            if (hit) return hit;
        }
    }
    return null;
}

/** The version a request names, else the main version. */
function versionOf(raw, config) {
    return knownVersion(raw) || mainVersionFor({ config });
}

/** GET /api/settings/top-items?version= — the page of the active server. */
const getTopItems = withUser({}, async ({ req, res, url }) => {
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_active_server", "Kein aktiver Server gewählt.");
    const config = getConfig();
    const versionId = versionOf(url.searchParams.get("version"), config);
    const lists = topItemListsOf(guildId, { config });
    ok(res, {
        guildId,
        versionId,
        mainVersion: mainVersionFor({ config }),
        versions: VERSIONS.map((v) => ({ id: v.id, label: v.label, short: v.short, count: (lists[v.id] || []).length })),
        raids: raidsOf(versionId),
        items: lists[versionId] || [],
        max: MAX_TOP_ITEMS,
        // the version's Wowhead section for the item links and tooltips ("" = none)
        wowheadPath: settingsForVersion(versionId, { config, guildId }).wowheadPath || "",
    });
});

/**
 * PUT /api/settings/top-items — body: { versionId, item: { id, name, iconUrl,
 * quality }, on, serverSettingsGuildId }. An item of the loot table is stored
 * with the table's name, icon and quality, whatever the body says; a searched
 * one with its own (normalised: an icon only over http(s)).
 */
const putTopItem = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_active_server", "Kein aktiver Server gewählt.");
    if (String(body.serverSettingsGuildId || "") !== guildId) {
        return error(res, 409, "server_switched", "Der aktive Server wurde inzwischen gewechselt. Bitte die Seite neu laden.");
    }
    const versionId = knownVersion(body.versionId);
    if (!versionId) return error(res, 400, "bad_version", "Unbekannte Spielversion.");
    const raw = body.item && typeof body.item === "object" ? body.item : {};
    const id = Number(raw.id);
    if (!Number.isInteger(id) || id <= 0) return error(res, 400, "bad_item", "Unbekanntes Item.");
    const on = body.on === true;
    const config = getConfig();
    const current = topItemListsOf(guildId, { config });
    const list = current[versionId] || [];
    if (on && !list.some((it) => it.id === id) && list.length >= MAX_TOP_ITEMS) {
        return error(res, 400, "too_many", `Höchstens ${MAX_TOP_ITEMS} Top-Items je Spielversion.`);
    }
    const item = catalogItem(versionId, id) || {
        id,
        name: typeof raw.name === "string" ? raw.name.trim().slice(0, TOP_ITEM_NAME_MAX) : "",
        iconUrl: typeof raw.iconUrl === "string" ? raw.iconUrl : "",
        quality: Number.isInteger(raw.quality) ? raw.quality : null,
    };
    const next = withTopItem(current, versionId, item, on);
    saveConfig({ serverSettings: { [guildId]: { topItems: next } } });
    ok(res, { guildId, versionId, items: topItemsOf(guildId, versionId, { config: getConfig() }) });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/settings/top-items", handler: getTopItems, area: "settings" },
    { method: "PUT", path: "/api/settings/top-items", handler: putTopItem, area: "settings" },
];

module.exports = { getTopItems, putTopItem, raidsOf, routes };
