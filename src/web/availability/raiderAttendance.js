// One raider's attendance, per raid category and per raid — what a raider sees
// of themselves on the Abwesenheiten page ("Meine Anwesenheit"), and what the
// orga sees of one raider. The same rules as the setup editor's tooltip
// (setupAttendance / rosterAttendance.attendanceForAccounts): per Discord
// account, a night counts when any character of the account stands in its log,
// without a log the signup decides. Per category the last RAID_WINDOW nights
// with their verdict, and the coming raids with the raider's own status.
//
// Which categories: the active ones (config.categoryIds, when any are set) the
// raider signed up for at least once, or was assigned a character in.
const signupStore = require("../../stores/signupStore");
const eventStore = require("../../stores/eventStore");
const profileStore = require("../../stores/raiderProfileStore");
const settingsStore = require("../../stores/settingsStore");
const { getCategoryAssignments } = require("../../stores/raiderCharactersStore");
const { buildAttendanceContext, attendanceForAccounts, RAID_WINDOW } = require("../../services/characters/rosterAttendance");
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
function raiderAttendance(userId, { now = Date.now(), config, categoryNames = {}, eventUrl = () => "" } = {}) {
    const uid = str(userId);
    const cfg = config || settingsStore.getConfig();
    const active = Array.isArray(cfg.categoryIds) ? cfg.categoryIds.map(String) : [];
    const ctx = buildAttendanceContext("", { now });
    const profile = profileStore.getProfile(uid);
    const all = ctx.allRaidsByCategory || ctx.raidsByCategory;

    // the raider's coming own raids, by category
    const upcomingByCategory = new Map();
    for (const e of eventStore.listEvents("", { sinceSeconds: Math.floor(now / 1000) })) {
        if (!e || !e.categoryId || e.status === "cancelled" || Number(e.startTime) * 1000 < now) continue;
        if (active.length && !active.includes(str(e.categoryId))) continue;
        const signup = signupStore.getSignup(e.id, uid);
        const list = upcomingByCategory.get(str(e.categoryId)) || [];
        list.push({ eventId: e.id, title: e.title || "", startTime: Number(e.startTime) || 0, status: signup ? signup.status : "", url: eventUrl(e) || "" });
        upcomingByCategory.set(str(e.categoryId), list);
    }

    const categories = [];
    const ids = new Set([...all.keys(), ...upcomingByCategory.keys(), ...active].map(String));
    for (const categoryId of ids) {
        if (active.length && !active.includes(categoryId)) continue;
        const nights = all.get(categoryId) || [];
        const assignments = getCategoryAssignments(categoryId) || {};
        const signup = newestSignup(nights, uid);
        const upcoming = (upcomingByCategory.get(categoryId) || []).sort((a, b) => a.startTime - b.startTime);
        const raider = signup || assignments[uid] || upcoming.some((r) => r.status);
        if (!raider) continue;
        const chars = accountCharacters(uid, categoryId, signup, profile, assignments);
        const result = chars.length ? attendanceForAccounts(ctx, categoryId, [{ userId: uid, chars }], { nights: true }).get(uid) : null;
        categories.push({
            id: categoryId,
            name: categoryNames[categoryId] || "",
            pct: result ? result.pct : null,
            attended: result ? result.attended : 0,
            total: result ? result.total : 0,
            link: result ? result.link : "auto",
            window: RAID_WINDOW,
            raids: result && result.raids ? result.raids : [],
            upcoming: upcoming.slice(0, 6),
        });
    }
    categories.sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));
    return { userId: uid, categories };
}

module.exports = { raiderAttendance };
