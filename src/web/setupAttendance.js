// Attendance for every raider of the setup editor's tooltip: per Discord
// account, not per character, so a raider who plays a twink on some nights is
// still counted for those. The characters of an account come from
//   * the orga's assignment for the event's category and the raider's own
//     profile — "manual", shown with a check mark;
//   * the characters of the signup — "auto", nobody confirmed the link.
// Whatever rests on a guess (signup characters only, or a class match in a log,
// see rosterAttendance.attendanceForAccounts) is badged "auto".
const signupStore = require("./signupStore");
const profileStore = require("./raiderProfileStore");
const characterStore = require("./characterStore");
const { getCategoryAssignments } = require("./raiderCharactersStore");
const { buildAttendanceContext, attendanceForAccounts } = require("./rosterAttendance");

/** "Druid-Feral" -> "Druid". */
const classOfSpec = (spec) => String(spec || "").split("-")[0];

function classOfCharacter(name, fallback) {
    let rec = null;
    try {
        rec = characterStore.getCharacter(name);
    } catch {
        rec = null;
    }
    return (rec && rec.className) || fallback || "";
}

/** The characters of one account in one category, manual links first, one entry per name. */
function accountCharacters(userId, categoryId, signup, profile, assignments) {
    const byKey = new Map();
    const add = (name, className, manual) => {
        const clean = String(name || "").trim();
        if (!clean) return;
        const key = clean.toLowerCase();
        const prev = byKey.get(key);
        if (prev) {
            prev.manual = prev.manual || manual;
            prev.className = prev.className || className;
            return;
        }
        byKey.set(key, { name: clean, className: className || "", manual });
    };
    if (assignments[userId]) add(assignments[userId], classOfCharacter(assignments[userId]), true);
    for (const c of (profile && profile.characters) || []) add(c.name, c.className, true);
    const named = signup && Array.isArray(signup.characters) && signup.characters.length
        ? signup.characters
        : [{ character: signup && signup.character, spec: signup && signup.spec }];
    for (const c of named) add(c.character, classOfCharacter(c.character, classOfSpec(c.spec)), false);
    return [...byKey.values()];
}

/**
 * Attendance of everyone who signed up for these events (absences excluded).
 *
 * @param {object[]} events  stored own events (`categoryId`, `guildId`)
 * @returns {Object<string, {pct: number|null, attended: number, total: number,
 *            link: "manual"|"auto", inferred: number, missed: object[]}>} by user id
 */
function setupAttendance(events, { now = Date.now() } = {}) {
    const out = {};
    const list = (events || []).filter((e) => e && e.categoryId);
    if (!list.length) return out;
    const ctx = buildAttendanceContext(list[0].guildId, { now });
    const profiles = new Map(profileStore.listProfiles().map((p) => [String(p.userId), p]));
    const byCategory = new Map();
    for (const event of list) {
        for (const s of signupStore.listSignups(event.id)) {
            if (!s || !s.userId || s.status === "absence") continue;
            const perCategory = byCategory.get(event.categoryId) || new Map();
            if (!perCategory.has(String(s.userId))) perCategory.set(String(s.userId), s);
            byCategory.set(event.categoryId, perCategory);
        }
    }
    for (const [categoryId, signups] of byCategory) {
        const assignments = getCategoryAssignments(categoryId);
        const accounts = [...signups].map(([userId, signup]) => ({
            userId,
            chars: accountCharacters(userId, categoryId, signup, profiles.get(userId), assignments),
        }));
        for (const [userId, result] of attendanceForAccounts(ctx, categoryId, accounts)) {
            if (!out[userId]) out[userId] = result;
        }
    }
    return out;
}

module.exports = { setupAttendance, accountCharacters };
