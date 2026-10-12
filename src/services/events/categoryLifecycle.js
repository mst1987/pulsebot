// What happens to a raid category over its life (#744): active, deactivated,
// deleted in Discord and closed. Everything keys on the category id; a name is
// display only (a rename changes nothing here, see categoryEras.categoryNameAt).
//
//   active        in `config.categoryIds` (Einstellungen → Kategorien).
//                 activeCategoryIds() / isCategoryActive() are the one reading
//                 of that list. An EMPTY list still reads as "every category"
//                 (what an install that never picked one always did) — so the
//                 settings refuse to save an empty list while raids exist
//                 (emptyListBlocked), and the pitfall cannot be reached from
//                 the menu any more.
//   deactivated   taken out of `categoryIds`. Nothing is deleted: its series
//                 rests (eventSeries.runSeries), its reminders stop
//                 (reminders.runReminders), the Kaderplaner, the roster dialog
//                 and /anwesenheit no longer offer it. Switching it on again
//                 resumes all of it. deactivationPreview() is the save dialog's
//                 list of what pauses.
//   deleted       configured, but Discord no longer has it (only judged when
//                 the bot sees every event server: discordCategoryIds()).
//                 Einstellungen → Kategorien marks it "in Discord gelöscht"
//                 and offers "Kategorie abschließen".
//   closed        closeCategory(): its series is deleted, its settings and
//                 reminders are removed, its Loot-Council profile entry and
//                 its place in every Kader's attendance categories go, its
//                 rosters are closed (#739, rosterStore.closeRoster, reason
//                 "category_closed": readable, no role sync, nobody loses a role). Raids,
//                 loot, logs, the category's version (`categoryVersion`,
//                 `categoryEras`) and its remembered name (category-names.json)
//                 stay, so the history keeps reading under its version and name.
const discord = require("../discord/discord");
const guildRoles = require("../discord/guildRoles");
const seriesStore = require("../../stores/eventSeriesStore");
const eventStore = require("../../stores/eventStore");
const { listRaidEvents } = require("../../stores/raidEventStore");
const rosterStore = require("../../stores/rosterStore");
const councilProfiles = require("../../stores/councilProfilesStore");
const { kadersCountingCategory, dropAttendanceCategory } = require("../kader/kaderCategories");

// The category maps a closed category leaves: everything that steers new
// raids, messages, reminders, the Loot-Council's targets (categoryLootSystem)
// and the lists that offer it (categoryAttendance) — each one would keep the
// closed category alive somewhere. Kept on purpose: categoryVersion and
// categoryEras, the version and name its raids read under.
const SETTINGS_KEYS = [
    "categoryRoles", "categoryLootTool", "categoryLootSystem", "categorySignupSource", "categorySetupDms", "categoryLanguage",
    "categoryAttendance", "categoryDiscordEvent", "categoryVoiceChannel", "categoryMessageLook", "categoryAnnounce", "categorySignupNotes",
    "categorySignupNoteChannel", "categorySignupCharacters", "categorySheets", "categoryPlanning", "categoryRaidTemplate", "categoryReminders",
];

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** The settings store's config, lazily (it pulls in much of the app). */
function configOf(config) {
    if (config && typeof config === "object") return config;
    return require("../../stores/settingsStore").getConfig() || {};
}

/** The active raid categories as stored (ids, each once). */
function activeCategoryIds(config) {
    const ids = configOf(config).categoryIds;
    return [...new Set((Array.isArray(ids) ? ids : []).map(str).filter(Boolean))];
}

/**
 * Whether a category is active. An empty list reads as "every category" — the
 * meaning it always had; the settings refuse to save one while raids exist.
 */
function isCategoryActive(categoryId, config) {
    const ids = activeCategoryIds(config);
    return !ids.length || ids.includes(str(categoryId));
}

/** Whether any raid is stored (own events of any status, or Raid-Helper snapshots). */
function hasRaidData() {
    try {
        return eventStore.listEvents("").length > 0 || listRaidEvents("").length > 0;
    } catch {
        return true; // unreadable stores: refuse rather than risk "show everything"
    }
}

/** Whether saving `nextIds` would leave no active category although raids exist. */
function emptyListBlocked(nextIds) {
    return !(Array.isArray(nextIds) ? nextIds : []).map(str).filter(Boolean).length && hasRaidData();
}

const EMPTY_LIST_MESSAGE = "Mindestens eine Raid-Kategorie muss aktiv bleiben, solange es Raids gibt. Eine Kategorie ohne Raids mehr bitte einzeln abwählen und eine andere aktiv lassen.";

/** The category's own events from now on that are not cancelled. */
function upcomingOwn(categoryId, now = Date.now()) {
    try {
        return eventStore.listEvents("", { sinceSeconds: Math.floor(now / 1000) })
            .filter((e) => str(e.categoryId) === categoryId && e.status !== "cancelled");
    } catch {
        return [];
    }
}

/** `{ weekdays, time, enabled }` of a category's series, or null. */
function seriesInfo(categoryId) {
    const s = seriesStore.getSeries(categoryId);
    return s ? { enabled: s.enabled !== false, weekdays: s.weekdays || [], time: s.time || "" } : null;
}

/** The rosters of a category, one per game version (#739): `[{ id, name, versionId, closed }]`. */
function rostersOf(categoryId) {
    try {
        return rosterStore.listRosters("").filter((r) => str(r.categoryId) === categoryId)
            .map((r) => ({ id: r.id, name: r.name || "", versionId: r.versionId || "", closed: !!r.closedAt }));
    } catch {
        return [];
    }
}

/**
 * What deactivating categories pauses — the save dialog's content. One entry
 * per category that is active now and missing from `nextIds`.
 * @returns {{ categories: { categoryId: string, series: object|null, reminders: boolean, upcoming: number }[], emptyBlocked: boolean }}
 */
function deactivationPreview({ config, nextIds = [], now = Date.now() } = {}) {
    const cfg = configOf(config);
    const next = new Set((Array.isArray(nextIds) ? nextIds : []).map(str).filter(Boolean));
    const reminders = cfg.categoryReminders || {};
    const categories = activeCategoryIds(cfg)
        .filter((id) => !next.has(id))
        .map((categoryId) => ({
            categoryId,
            series: seriesInfo(categoryId),
            reminders: !!reminders[categoryId],
            upcoming: upcomingOwn(categoryId, now).length,
        }));
    return { categories, emptyBlocked: emptyListBlocked([...next]) };
}

/**
 * The category ids Discord has on every event server, or null when that is not
 * known (bot offline, a server not cached) — "deleted" is never guessed.
 * @returns {Set<string> | null}
 */
function discordCategoryIds(config) {
    const cfg = configOf(config);
    if (typeof discord.isOnline === "function" && !discord.isOnline()) return null;
    const guildIds = guildRoles.eventGuildIds(cfg);
    if (!guildIds.length) return null;
    const live = new Set();
    for (const guildId of guildIds) {
        if (!discord.getGuild(guildId)) return null;
        for (const c of discord.listCategories(guildId) || []) live.add(str(c.id));
    }
    return live;
}

/** Every category the config, a series or a Loot-Council profile still holds something for. */
function configuredCategoryIds(config) {
    const cfg = configOf(config);
    const ids = new Set(activeCategoryIds(cfg));
    for (const key of SETTINGS_KEYS) {
        const map = cfg[key];
        if (map && typeof map === "object" && !Array.isArray(map)) Object.keys(map).forEach((id) => ids.add(str(id)));
    }
    try {
        Object.keys(seriesStore.listSeries() || {}).forEach((id) => ids.add(str(id)));
    } catch {
        // an unreadable series file adds nothing
    }
    try {
        Object.keys(councilProfiles.categoryProfiles() || {}).forEach((id) => ids.add(str(id)));
    } catch {
        // nor does the profiles file
    }
    ids.delete("");
    return ids;
}

/** Whether a category without roster keeps its own Loot-Council profile entry (council-profiles.json). */
function hasCouncilProfile(categoryId) {
    try {
        return !!councilProfiles.categoryProfileId(categoryId);
    } catch {
        return false;
    }
}

/**
 * What closing a category removes — and what stays. The dialog's content.
 * @returns {{ categoryId, series, reminders, settings: string[], active, councilProfile, kaders, rosters, upcoming }}
 */
function closePreview(categoryId, { config, now = Date.now() } = {}) {
    const cfg = configOf(config);
    const id = str(categoryId);
    const settings = SETTINGS_KEYS.filter((key) => {
        const map = cfg[key];
        return map && typeof map === "object" && !Array.isArray(map) && Object.prototype.hasOwnProperty.call(map, id);
    });
    return {
        categoryId: id,
        active: activeCategoryIds(cfg).includes(id),
        series: seriesInfo(id),
        reminders: !!(cfg.categoryReminders || {})[id],
        settings,
        councilProfile: hasCouncilProfile(id),
        kaders: kadersCountingCategory(id).map((k) => ({ kaderId: k.kaderId, name: k.name })),
        rosters: rostersOf(id),
        upcoming: upcomingOwn(id, now).length,
    };
}

/**
 * The configured categories Discord no longer has, each with what closing it
 * would remove. Empty while Discord's state is unknown.
 * @param {{ config?: object, nameOf?: (id: string) => string }} opts
 */
function missingCategories({ config, nameOf = () => "" } = {}) {
    const cfg = configOf(config);
    const live = discordCategoryIds(cfg);
    if (!live) return [];
    return [...configuredCategoryIds(cfg)]
        .filter((id) => !live.has(id))
        .map((id) => ({ ...closePreview(id, { config: cfg }), name: str(nameOf(id)) }));
}

/**
 * Close a category for good. Refuses one Discord still has (409) and one whose
 * state is unknown (503). Returns what was removed.
 * @returns {{ ok: true, removed: object } | { error: { status: number, code: string, message: string } }}
 */
function closeCategory(categoryId, { config, actor = "" } = {}) {
    const cfg = configOf(config);
    const id = str(categoryId);
    if (!id) return { error: { status: 400, code: "invalid", message: "Keine Kategorie angegeben." } };
    const live = discordCategoryIds(cfg);
    if (!live) return { error: { status: 503, code: "bot_offline", message: "Discord ist gerade nicht erreichbar — ob die Kategorie noch existiert, ist unbekannt." } };
    if (live.has(id)) return { error: { status: 409, code: "category_exists", message: "Die Kategorie gibt es in Discord noch. Abschließen geht nur für eine in Discord gelöschte Kategorie; sonst einfach deaktivieren." } };
    const preview = closePreview(id, { config: cfg });
    const series = seriesStore.deleteSeries(id);
    const { removed: settings } = require("../../stores/configStore").dropCategoryEntries(id, SETTINGS_KEYS);
    let councilProfile = false;
    if (preview.councilProfile) {
        try {
            councilProfiles.setCategoryProfile(id, "");
            councilProfile = true;
        } catch {
            councilProfile = false;
        }
    }
    const kaders = dropAttendanceCategory(id);
    // #739: every roster of the category is closed - readable under its version, no role sync,
    // nobody loses a role; a roster closed before stays as it is
    const rosters = preview.rosters.map((r) => {
        if (r.closed) return r;
        const closed = rosterStore.closeRoster(r.id, { reason: "category_closed", actor: str(actor) });
        return { ...r, closed: !!(closed && closed.closedAt) };
    });
    return {
        ok: true,
        removed: {
            series,
            reminders: settings.includes("categoryReminders"),
            settings: settings.filter((k) => k !== "categoryIds"),
            active: settings.includes("categoryIds"),
            councilProfile,
            kaders,
        },
        rosters,
    };
}

module.exports = {
    SETTINGS_KEYS, EMPTY_LIST_MESSAGE,
    activeCategoryIds, isCategoryActive, hasRaidData, emptyListBlocked, deactivationPreview,
    discordCategoryIds, configuredCategoryIds, closePreview, missingCategories, closeCategory,
};
