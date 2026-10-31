// "Nur meine Raids" on the Log-Auswertung page: which rows of the list one
// account played in. A row is "mine" on either of two ways (the raid event is
// asked first: it is one store lookup, the report needs the name walk):
//
// 1. The account was part of the raid event the log is linked to (row.eventId),
//    matched by the account id - a signup belongs to the account, not to a name:
//    - an own event with an approved setup: placed in one of its groups (the
//      bench and the pool were not in the raid);
//    - an own event without an approved setup: signed up as "signed" or "late";
//    - a Raid-Helper event: its stored snapshot's signup as "signed" or "late"
//      (Raid-Helper's own raid plan is not an approved setup of ours).
//    "tentative" ("vielleicht"), "bench" (sat out) and "absence" (signed off) do
//    not count: none of them says the account was in the raid. A tentative the
//    orga placed in the approved setup counts through the placement.
//    The status of a signup is the one of its first character (signupStore keeps
//    one status per account; further characters follow it).
//    Raid groups (#811): every raid of a group has its own setup and approval,
//    the signup sits at the group's first raid. A raid without an approved setup
//    of its own counts through that signup only when the account is NOT placed
//    in the approved setup of another raid of the same group - who stands in
//    "Zul'Aman 1" was not in "Zul'Aman 2".
//
// 2. Its evaluation lists one of the account's characters: the name keys of the
//    report's roster (and, for reports from before the roster existed, its
//    players), which reportStore keeps in each report's metadata - the listing
//    the route already holds, so no report file is opened here. The account's
//    characters are the ones "Mein Profil" lists for the row's game version
//    (raiderProfileStore.charactersOfVersion - no main character, all of them)
//    plus the ones the categories assign to the account
//    (raiderCharactersStore.charactersForUser) - only through a category that
//    plays the row's version (strict version separation) and, with an active
//    server, belongs to that server; a category whose server is unknown does
//    not count. Names are compared by their name part, realm and version prefix
//    dropped (profiles.nameKey), the one key every store uses.
//
// A log with neither an evaluation nor a raid event is never "mine".

const profiles = require("../../stores/roster/raiderProfileStore");
const { charactersForUser } = require("../../stores/roster/raiderCharactersStore");
const eventStore = require("../../stores/events/eventStore");
const { getSignup } = require("../../stores/events/signupStore");
const { getRaidEvent } = require("../../stores/events/raidEventStore");
const { approvedSetupOf } = require("../setup/setupCore");
const { groupEvents } = require("../events/raidGroup");
const { guildOfCategory } = require("../events/eventServer");
const { mainVersionFor } = require("../versions/mainVersion");
const { signupStatus } = require("../../utils/attendance");
const { signupEventIdOf, inRaidGroup } = require("../../utils/raidGroup");

/** The signup statuses that say the account was in the raid. */
const ATTENDING = new Set(["signed", "late"]);

/** The account ids placed in a group of an approved setup. */
function placedIds(approved) {
    const ids = new Set();
    for (const g of Array.isArray(approved && approved.groups) ? approved.groups : []) {
        for (const slot of Array.isArray(g && g.slots) ? g.slots : []) if (slot && slot.userId) ids.add(String(slot.userId));
    }
    return ids;
}

/** Whether the account is placed in the approved setup of another raid of the event's group. */
function placedInOtherRaid(event, uid) {
    if (!inRaidGroup(event)) return false;
    return groupEvents(event).some((other) => {
        if (!other || other.id === event.id) return false;
        const approved = approvedSetupOf(other);
        return !!approved && placedIds(approved).has(uid);
    });
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
        if (placedInOtherRaid(event, uid)) return false;
        const signup = getSignup(signupEventIdOf(event), uid);
        return !!signup && ATTENDING.has(String(signup.status || "signed"));
    }
    const snapshot = getRaidEvent(id);
    const signUps = (snapshot && Array.isArray(snapshot.signUps)) ? snapshot.signUps : [];
    return signUps.some((s) => s && String(s.userId) === uid && ATTENDING.has(signupStatus(s)));
}

/**
 * A predicate `(row) => boolean` over the rows of reportList.prepareClaList:
 * true when the account was part of the row's raid event or one of its
 * characters is in the row's report. Without an account, nothing is "mine".
 * @param {string} userId the Discord account
 * @param {object} [opts]
 * @param {Map<string, {nameKeys?: string[]}>} [opts.reportById] the report metadata by id (reportStore.listReports)
 * @param {string} [opts.guildId] the active server; undefined = categories of every server count
 * @param {object} [opts.config] the bot config (category versions); read by mainVersionFor when absent
 */
function mineFilter(userId, { reportById = new Map(), guildId, config } = {}) {
    const uid = String(userId || "").trim();
    if (!uid) return () => false;
    const profile = profiles.getProfile(uid);
    const assigned = charactersForUser(uid)
        .map((c) => ({ key: profiles.nameKey(c && c.character), categoryIds: (c && Array.isArray(c.categoryIds)) ? c.categoryIds.map(String) : [] }))
        .filter((c) => c.key);
    const categoryCache = new Map();
    const category = (categoryId) => {
        if (!categoryCache.has(categoryId)) {
            categoryCache.set(categoryId, {
                versionId: mainVersionFor({ categoryId, config }),
                guildId: guildId === undefined ? "" : String(guildOfCategory(categoryId) || ""),
            });
        }
        return categoryCache.get(categoryId);
    };
    const countsFor = (categoryId, versionId) => {
        const cat = category(categoryId);
        if (cat.versionId !== versionId) return false;
        return guildId === undefined || (!!cat.guildId && cat.guildId === String(guildId));
    };
    const byVersion = new Map();
    const namesFor = (versionId) => {
        const id = String(versionId || "");
        if (!byVersion.has(id)) {
            const own = profiles.charactersOfVersion(profile, id).map((c) => profiles.nameKey(c && (c.name || c.key)));
            const viaCategory = assigned.filter((c) => c.categoryIds.some((cat) => countsFor(cat, id))).map((c) => c.key);
            byVersion.set(id, new Set([...own, ...viaCategory].filter(Boolean)));
        }
        return byVersion.get(id);
    };
    const inReport = (row) => {
        const reportId = row.report && row.report.id;
        if (!reportId) return false;
        const meta = reportById.get(String(reportId));
        const keys = (meta && Array.isArray(meta.nameKeys)) ? meta.nameKeys : [];
        if (!keys.length) return false;
        const names = namesFor(row.versionId);
        return names.size > 0 && keys.some((key) => names.has(key));
    };
    const eventCache = new Map();
    const inEvent = (row) => {
        const eventId = String(row.eventId || "");
        if (!eventId) return false;
        if (!eventCache.has(eventId)) eventCache.set(eventId, attendedEvent(eventId, uid));
        return eventCache.get(eventId);
    };
    return (row) => !!row && (inEvent(row) || inReport(row));
}

module.exports = { mineFilter, attendedEvent };
