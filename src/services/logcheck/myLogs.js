// "Nur meine Raids" on the Log-Auswertung page: which rows of the list one
// account played in. A row is "mine" on either of two ways:
//
// 1. Its evaluation lists one of the account's characters: the report's roster
//    (and, for reports from before the roster existed, its players). The
//    account's characters are the ones "Mein Profil" lists for the row's game
//    version (raiderProfileStore.charactersOfVersion - no main character, all of
//    them) plus the ones the categories assign to the account
//    (raiderCharactersStore.charactersForUser). Names are compared by their name
//    part, realm and version prefix dropped (profiles.nameKey), the one key
//    every store uses.
//
// 2. The account was part of the raid event the log is linked to (row.eventId),
//    matched by the account id - a signup belongs to the account, not to a name:
//    - an own event with an approved setup: placed in one of its groups (the
//      bench and the pool were not in the raid);
//    - an own event without an approved setup: signed up as "signed" or "late";
//    - a Raid-Helper event: its stored snapshot's signup as "signed" or "late"
//      (Raid-Helper's own raid plan is not an approved setup of ours).
//    "tentative" ("vielleicht"), "bench" (sat out) and "absence" (signed off) do
//    not count: none of them says the account was in the raid. A tentative the
//    orga placed in the approved setup counts through the placement.
//    A further raid of a raid group (#811) is signed up at its group's first raid.
//
// A log with neither an evaluation nor a raid event is never "mine".

const profiles = require("../../stores/roster/raiderProfileStore");
const { charactersForUser } = require("../../stores/roster/raiderCharactersStore");
const { getReportRoster } = require("../../stores/loot/reportStore");
const eventStore = require("../../stores/events/eventStore");
const { getSignup } = require("../../stores/events/signupStore");
const { getRaidEvent } = require("../../stores/events/raidEventStore");
const { approvedSetupOf } = require("../setup/setupCore");
const { signupStatus } = require("../../utils/attendance");
const { signupEventIdOf } = require("../../utils/raidGroup");

/** The signup statuses that say the account was in the raid. */
const ATTENDING = new Set(["signed", "late"]);

/** The name keys of everyone a report lists (roster, else the legacy players). */
function reportNameKeys(reportId) {
    const report = reportId ? getReportRoster(String(reportId)) : null;
    const keys = new Set();
    if (!report) return keys;
    for (const p of [...(report.roster || []), ...(report.players || [])]) {
        const key = profiles.nameKey(p && p.name);
        if (key) keys.add(key);
    }
    return keys;
}

/** The account ids placed in a group of an approved setup (each raid of a multi-raid setup too). */
function placedIds(approved) {
    const ids = new Set();
    for (const part of [approved, ...(Array.isArray(approved.events) ? approved.events : [])]) {
        for (const g of Array.isArray(part && part.groups) ? part.groups : []) {
            for (const slot of Array.isArray(g && g.slots) ? g.slots : []) if (slot && slot.userId) ids.add(String(slot.userId));
        }
    }
    return ids;
}

/**
 * Whether the account was part of a raid event (see the header for the rules).
 * @param {string} eventId an own event id or a Raid-Helper id
 * @param {string} userId the Discord account
 */
function attendedEvent(eventId, userId) {
    const id = String(eventId || "").trim();
    const uid = String(userId || "").trim();
    if (!id || !uid) return false;
    if (eventStore.isOwnEventId(id)) {
        const event = eventStore.getEvent(id);
        if (!event) return false;
        const approved = approvedSetupOf(event);
        if (approved) return placedIds(approved).has(uid);
        const signup = getSignup(signupEventIdOf(event), uid);
        return !!signup && ATTENDING.has(String(signup.status || "signed"));
    }
    const snapshot = getRaidEvent(id);
    const signUps = (snapshot && Array.isArray(snapshot.signUps)) ? snapshot.signUps : [];
    return signUps.some((s) => s && String(s.userId) === uid && ATTENDING.has(signupStatus(s)));
}

/**
 * A predicate `(row) => boolean` over the rows of reportList.prepareClaList:
 * true when one of the account's characters is in the row's report or the
 * account was part of the row's raid event. Without an account, nothing is "mine".
 * @param {string} userId the Discord account
 */
function mineFilter(userId) {
    const uid = String(userId || "").trim();
    if (!uid) return () => false;
    const profile = profiles.getProfile(uid);
    const assigned = charactersForUser(uid).map((c) => profiles.nameKey(c && c.character)).filter(Boolean);
    const byVersion = new Map();
    const namesFor = (versionId) => {
        const id = String(versionId || "");
        if (!byVersion.has(id)) {
            const own = profiles.charactersOfVersion(profile, id).map((c) => profiles.nameKey(c && (c.name || c.key)));
            byVersion.set(id, new Set([...own, ...assigned].filter(Boolean)));
        }
        return byVersion.get(id);
    };
    const reportCache = new Map();
    const inReport = (row) => {
        const reportId = row.report && row.report.id;
        if (!reportId) return false;
        const names = namesFor(row.versionId);
        if (!names.size) return false;
        if (!reportCache.has(reportId)) reportCache.set(reportId, reportNameKeys(reportId));
        const keys = reportCache.get(reportId);
        for (const name of names) if (keys.has(name)) return true;
        return false;
    };
    const eventCache = new Map();
    const inEvent = (row) => {
        const eventId = String(row.eventId || "");
        if (!eventId) return false;
        if (!eventCache.has(eventId)) eventCache.set(eventId, attendedEvent(eventId, uid));
        return eventCache.get(eventId);
    };
    return (row) => !!row && (inReport(row) || inEvent(row));
}

module.exports = { mineFilter, reportNameKeys, attendedEvent };
