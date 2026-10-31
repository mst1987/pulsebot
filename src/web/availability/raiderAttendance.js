// One raider's attendance, per raid category and per raid — what a raider sees
// of themselves on the Abwesenheiten page ("Meine Anwesenheit"), and what the
// orga sees of one raider. The same rules as the setup editor's tooltip
// (setupAttendance / rosterAttendance.attendanceForAccounts): per Discord
// account, a night counts when any character of the account stands in its log,
// without a log the signup decides. Per category its last nights with their
// verdict — as many as its window (config.categoryAttendance, default
// RAID_WINDOW) — and the coming raids with the raider's own status; a category
// switched off there ("Anwesenheit anzeigen") is left out.
//
// Which categories: the active ones (config.categoryIds, when any are set) the
// raider signed up for at least once, or was assigned a character in.
//
// Always within one game version (#740, the content switch's `?version=`): only
// raids of that version count and are listed, the coming ones included. A
// category shows up when it has raids of that version or plays it today - a
// category just switched to Forever shows "noch keine gezählten Raids" there
// until its first Forever raid, its TBC nights stay under TBC.
const signupStore = require("../../stores/events/signupStore");
const eventStore = require("../../stores/events/eventStore");
const profileStore = require("../../stores/roster/raiderProfileStore");
const settingsStore = require("../../stores/settings/settingsStore");
const { categoryAttendanceFor } = require("../../stores/settings/configSchema");
const { getCategoryAssignments } = require("../../stores/roster/raiderCharactersStore");
const { buildAttendanceContext, attendanceForAccounts, categoryInfo, neutralNight, RAID_WINDOW } = require("../../services/characters/rosterAttendance");
const { accountCharacters } = require("../setup/setupAttendance");
const { versionOfEvent, mainVersionFor, knownVersion } = require("../../services/versions/mainVersion");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** The raider's newest signup among the nights of a category (the characters it names). */
function newestSignup(nights, userId) {
    for (const night of nights) {
        const hit = [...(night.signUps || [])].reverse().find((s) => s && str(s.userId) === userId);
        if (hit) return hit;
    }
    return null;
}

/**
 * @param {string} userId
 * @param {{ now?: number, config?: object, categoryNames?: Object<string,string>, eventUrl?: (event) => string }} opts
 * @returns {{ userId, categories: { id, name, pct, attended, total, link, window,
 *            raids: { eventId, title, startTime, attended, reason }[],
 *            upcoming: { eventId, title, startTime, status, url }[] }[] }}
 */
/** The raider's coming own raids (not cancelled, of the active categories, of this version), by category. */
function upcomingRaids(uid, { now, active, eventUrl, versionId, config }) {
    const out = new Map();
    for (const e of eventStore.listEvents("", { sinceSeconds: Math.floor(now / 1000) })) {
        if (!e || !e.categoryId || e.status === "cancelled" || Number(e.startTime) * 1000 < now) continue;
        if (active.length && !active.includes(str(e.categoryId))) continue;
        if (versionOfEvent(e, { config }) !== versionId) continue;
        const signup = signupStore.getSignup(e.id, uid);
        const list = out.get(str(e.categoryId)) || [];
        list.push({ eventId: e.id, title: e.title || "", startTime: Number(e.startTime) || 0, status: signup ? signup.status : "", url: eventUrl(e) || "" });
        out.set(str(e.categoryId), list);
    }
    return out;
}

/**
 * One category's card, or null when the raider has nothing to do with it in this version.
 * `playsVersion`: the category plays the asked version today - then an assignment or a signup of
 * another version is enough for a card (its quota empty until the first raid of this version).
 */
function categoryView(uid, categoryId, { ctx, nights, upcoming, profile, name, window = RAID_WINDOW, playsVersion = true, neutral = false }) {
    const signup = newestSignup(nights, uid);
    if (!nights.length && !upcoming.length && !playsVersion) return null;
    // the roster of the version counted (#739)
    const assignments = getCategoryAssignments(categoryId, { versionId: ctx.versionId || "" }) || {};
    const signedBefore = playsVersion && !!(ctx.signedAnyVersion && ctx.signedAnyVersion.get(categoryId) && ctx.signedAnyVersion.get(categoryId).has(uid));
    if (!signup && !assignments[uid] && !upcoming.some((r) => r.status) && !signedBefore) return null;
    const chars = accountCharacters(uid, categoryId, signup, profile, assignments);
    const result = (chars.length && attendanceForAccounts(ctx, categoryId, [{ userId: uid, chars }], { nights: true, window }).get(uid)) || null;
    return {
        id: categoryId,
        name: name || "",
        // the final-boss icon of the raid the category mostly runs; "" = none known (the client shows a neutral one)
        icon: categoryInfo(ctx, categoryId).icon,
        pct: result ? result.pct : null,
        attended: result ? result.attended : 0,
        total: result ? result.total : 0,
        link: result ? result.link : "auto",
        window,
        raids: ((result && result.raids) || []).map((r) => (neutral ? neutralNight(r) : r)),
        upcoming: upcoming.slice(0, 6),
    };
}

/**
 * The name a category's own events were created with, by category id — for a
 * category the Discord lookup does not name (the bot offline, the category gone).
 */
function eventCategoryNames(now) {
    const out = new Map();
    for (const e of eventStore.listEvents("", { sinceSeconds: Math.floor(now / 1000) - 120 * 86400 })) {
        const id = str(e && e.categoryId);
        if (id && !out.has(id) && str(e.categoryName)) out.set(id, str(e.categoryName));
    }
    return out;
}

/**
 * @param {string} userId
 * @param {{ versionId?: string, now?: number, config?: object, categoryNames?: Object<string,string>, eventUrl?: (event) => string }} opts
 *   `versionId`: the game version counted (#740) - the main version when none (or an unknown one) is named
 *   `neutral`: the raider's own view (#990) - a night set to "left early" (or its dismissed log suggestion)
 *   reads as plainly present (rosterAttendance.neutralNight); the orga's view of a raider leaves it off
 */
function raiderAttendance(userId, { versionId = "", now = Date.now(), config, categoryNames = {}, eventUrl = () => "", neutral = false } = {}) {
    const uid = str(userId);
    const cfg = config || settingsStore.getConfig();
    const version = knownVersion(versionId) || mainVersionFor({ config: cfg });
    const active = Array.isArray(cfg.categoryIds) ? cfg.categoryIds.map(String) : [];
    const ctx = buildAttendanceContext("", { now, versionId: version });
    const profile = profileStore.getProfile(uid);
    const all = ctx.allRaidsByCategory || ctx.raidsByCategory;
    const upcomingByCategory = upcomingRaids(uid, { now, active, eventUrl, versionId: version, config: cfg });
    const ids = [...new Set([...all.keys(), ...upcomingByCategory.keys(), ...active].map(String))]
        .filter((id) => !active.length || active.includes(id))
        // Einstellungen › Kategorien: "Anwesenheit anzeigen" off hides the category here
        .filter((id) => categoryAttendanceFor(cfg, id).show);
    const fallbackNames = eventCategoryNames(now);
    const categories = ids
        .map((id) => categoryView(uid, id, {
            ctx, profile, name: categoryNames[id] || fallbackNames.get(id),
            window: categoryAttendanceFor(cfg, id).window,
            nights: all.get(id) || [],
            upcoming: (upcomingByCategory.get(id) || []).sort((a, b) => a.startTime - b.startTime),
            playsVersion: mainVersionFor({ categoryId: id, config: cfg }) === version,
            neutral,
        }))
        .filter(Boolean)
        .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));
    // the character of the newest signup: what the page calls a raider without a Discord or profile name
    const newest = categories.map((c) => newestSignup(all.get(c.id) || [], uid)).find(Boolean);
    return { userId: uid, versionId: version, character: str(newest && newest.character), categories };
}

module.exports = { raiderAttendance, eventCategoryNames };
