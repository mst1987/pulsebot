// Attendance for every raider of the setup editor's tooltip: per Discord
// account, not per character, so a raider who plays a twink on some nights is
// still counted for those. The characters of an account come from
//   * the orga's assignment for the event's category and the raider's own
//     profile — "manual", shown with a check mark;
//   * the characters of the signup — "auto", nobody confirmed the link.
// Whatever rests on a guess (signup characters only, or a class match in a log,
// see rosterAttendance.attendanceForAccounts) is badged "auto".
const signupStore = require("../stores/signupStore");
const profileStore = require("../stores/raiderProfileStore");
const characterStore = require("../stores/characterStore");
const { getCategoryAssignments } = require("../stores/raiderCharactersStore");
const { buildAttendanceContext, attendanceForAccounts } = require("./rosterAttendance");
const { raidContentIds, raidSize } = require("./raidListing");
const { benchHistory } = require("./setupInput");

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

/** A 10-man night and a 25-man night are different raids, even in one category. */
const sizeClass = (n) => (n <= 10 ? 10 : 25);

/**
 * Which past nights count for this event: those of the same kind of raid. A
 * category such as "PUG Raids" runs Karazhan (10) and SSC/TK/Gruul (25) side by
 * side, and somebody who only comes to one of them must not be marked absent for
 * the other. The kind is the raid size — the event's own, against the night's
 * read from its title and log zones; a night whose size cannot be told counts.
 * Null (= every night of the category) when the event has no size.
 */
function comparableTo(event) {
    const own = Number(event && event.size);
    if (!(own > 0)) return null;
    return (raid) => {
        const contents = raidContentIds({ title: raid.title, zones: (raid.logs || []).map((l) => l.zone) }).contentIds;
        const night = raidSize(contents);
        return !night.known || sizeClass(night.size) === sizeClass(own);
    };
}

/**
 * Attendance of everyone who signed up for these events (absences excluded).
 *
 * @param {object[]} events  stored own events (`categoryId`, `guildId`)
 * @returns {Object<string, {pct: number|null, attended: number, total: number,
 *            link: "manual"|"auto", inferred: number, missed: object[],
 *            lastBench: number, benchNights: number}>} by user id — `lastBench` = start (unix seconds) of the
 *            last earlier night the raider stood on the bench (0 = none in the `benchNights` nights looked at)
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
        const comparable = comparableTo(list.find((e) => e.categoryId === categoryId));
        for (const [userId, result] of attendanceForAccounts(ctx, categoryId, accounts, comparable ? { comparable } : {})) {
            if (!out[userId]) out[userId] = result;
        }
    }
    // Last time somebody signed up but stood on the bench instead of in the setup — the fairness history
    // (approved setups, else the stored signups), newest night first.
    let history = [];
    try {
        history = benchHistory(list, { guildId: list[0].guildId, now }).history || [];
    } catch {
        history = [];
    }
    for (const [userId, result] of Object.entries(out)) {
        const hit = history.find((h) => (h.bench || []).includes(userId));
        result.lastBench = hit ? Number(hit.startTime) || 0 : 0;
        result.benchNights = history.length;
    }
    return out;
}

module.exports = { setupAttendance, accountCharacters, comparableTo };
