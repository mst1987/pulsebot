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
const signupStore = require("../../stores/signupStore");
const eventStore = require("../../stores/eventStore");
const profileStore = require("../../stores/raiderProfileStore");
const settingsStore = require("../../stores/settingsStore");
const { categoryAttendanceFor } = require("../../stores/configSchema");
const { getCategoryAssignments } = require("../../stores/raiderCharactersStore");
const { buildAttendanceContext, attendanceForAccounts, categoryInfo, RAID_WINDOW } = require("../../services/characters/rosterAttendance");
const { accountCharacters } = require("../setup/setupAttendance");

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
/** The raider's coming own raids (not cancelled, of the active categories), by category. */
function upcomingRaids(uid, { now, active, eventUrl }) {
    const out = new Map();
    for (const e of eventStore.listEvents("", { sinceSeconds: Math.floor(now / 1000) })) {
        if (!e || !e.categoryId || e.status === "cancelled" || Number(e.startTime) * 1000 < now) continue;
        if (active.length && !active.includes(str(e.categoryId))) continue;
        const signup = signupStore.getSignup(e.id, uid);
        const list = out.get(str(e.categoryId)) || [];
        list.push({ eventId: e.id, title: e.title || "", startTime: Number(e.startTime) || 0, status: signup ? signup.status : "", url: eventUrl(e) || "" });
        out.set(str(e.categoryId), list);
    }
    return out;
}

/** One category's card, or null when the raider has nothing to do with it. */
function categoryView(uid, categoryId, { ctx, nights, upcoming, profile, name, window = RAID_WINDOW }) {
    const assignments = getCategoryAssignments(categoryId) || {};
    const signup = newestSignup(nights, uid);
    if (!signup && !assignments[uid] && !upcoming.some((r) => r.status)) return null;
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
        raids: (result && result.raids) || [],
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

function raiderAttendance(userId, { now = Date.now(), config, categoryNames = {}, eventUrl = () => "" } = {}) {
    const uid = str(userId);
    const cfg = config || settingsStore.getConfig();
    const active = Array.isArray(cfg.categoryIds) ? cfg.categoryIds.map(String) : [];
    const ctx = buildAttendanceContext("", { now });
    const profile = profileStore.getProfile(uid);
    const all = ctx.allRaidsByCategory || ctx.raidsByCategory;
    const upcomingByCategory = upcomingRaids(uid, { now, active, eventUrl });
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
        }))
        .filter(Boolean)
        .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));
    // the character of the newest signup: what the page calls a raider without a Discord or profile name
    const newest = categories.map((c) => newestSignup(all.get(c.id) || [], uid)).find(Boolean);
    return { userId: uid, character: str(newest && newest.character), categories };
}

module.exports = { raiderAttendance };
