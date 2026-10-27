// "Fehlende pingen": ping the raiders who are expected in the event's category
// (the roster's core + trial members, else the holders of its raider roles —
// services/roster/expectedRaiders.js, #658) but have not reacted to the signup yet. One function for the raid detail
// (POST /api/raids/ping-missing), "Event verwalten" in Discord (#288) and the
// button "Fehlende pingen" under the signup message (missingPingBot.js), so
// all of them ping exactly the same people.
//
// The missing raiders are always re-derived here; no caller hands in the list.
// `findMissingRaiders` is the derivation alone — the signup button's preview
// shows it before anything is posted.
const { loadEventGroups, eventLookbackSince } = require("./raidEventGroups");
const { getConfig } = require("../../stores/settingsStore");
const { computeAttendance, hasStarted } = require("../../utils/attendance");
const { deliverUserPing, dmSummary } = require("../discord/pingDelivery");
const { fail } = require("../../web/http/apiResult");
const { hasExpected, listExpectedMembers } = require("../roster/expectedRaiders");
const { versionOfEvent, isVersionVisible } = require("./mainVersion");

/**
 * Who of the expected raiders has not reacted to the event yet: the core and
 * trial members of the category's roster (#658), else the holders of its roles.
 * @param {{ guildId: string, eventId: string }} p
 * @returns {Promise<{ event: object, missing: Array<{ id: string, displayName: string }>, roleIds: string[], timings: object }
 *   | { error: { status: number, code: string, message: string } }>}
 */
async function findMissingRaiders({ guildId, eventId }) {
    const t0 = Date.now();
    const { groups, error: groupsError } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
    const tEvents = Date.now();
    if (groupsError) return fail(400, "events_unavailable", groupsError);
    const found = groups.flatMap((g) => g.events.map((e) => ({ e, g }))).find((x) => x.e.id === eventId);
    if (!found) return fail(404, "not_found", "Event nicht gefunden.");
    if (found.e.status === "cancelled") return fail(400, "cancelled", "Das Event ist abgesagt — da wird niemand mehr gepingt.");
    const config = getConfig();
    // A raid of a version the orga hid is not pinged for (#743), like it is not listed or reminded.
    const versionId = versionOfEvent({ ...found.e, categoryId: found.e.categoryId || found.g.categoryId }, { config });
    if (!isVersionVisible(versionId, config)) {
        return fail(400, "version_hidden", "Die Spielversion dieses Raids ist ausgeblendet — da wird niemand gepingt.");
    }
    // the roster of the raid's version (#739)
    if (!hasExpected(found.g.categoryId, config, { versionId })) {
        return fail(400, "no_roles", "Dieser Kategorie sind keine Rollen zugeordnet (Einstellungen → Kategorien).");
    }
    // A raid that already started expects no further signups — and once
    // Raid-Helper drops its roster, everyone would count as "missing" and get
    // pinged. Refuse instead of firing a pointless mass ping.
    if (hasStarted(found.e)) {
        return fail(400, "event_past", "Der Raid hat bereits begonnen — fehlende Raider zu pingen ergibt hier keinen Sinn mehr.");
    }
    // a category with a roster expects its core + trial members (#658), else the role holders
    const { members, error: membersError, roleIds } = await listExpectedMembers(guildId, found.g.categoryId, config, { versionId });
    const tMembers = Date.now();
    if (membersError) return fail(400, "members_unavailable", membersError);
    const { missing } = computeAttendance(members, found.e.signUps || []);
    return { event: found.e, missing, roleIds, timings: { events: tEvents - t0, members: tMembers - tEvents, at: tMembers } };
}

/**
 * Ping them on the raid's server (#894): mentioned in the raid channel, a DM
 * for whoever is not on that server (pingDelivery.deliverUserPing).
 * @param {{ guildId: string, eventId: string, text?: string }} p
 * @returns {Promise<{ message: string, count: number, delivery?: object } | { error: { status: number, code: string, message: string } }>}
 */
async function pingMissingRaiders({ guildId, eventId, text }) {
    // Timings are logged because a slow step here is invisible from the outside:
    // when the whole handler outlives the reverse proxy's 60s ceiling, the admin
    // only ever sees a 504 gateway page and cannot tell which of the three
    // external round trips (Raid-Helper, member fetch, Discord post) was to blame.
    const derived = await findMissingRaiders({ guildId, eventId });
    if (derived.error) return derived;
    const { event, missing, timings } = derived;
    if (!missing.length) return { message: "Niemand fehlt — es haben schon alle reagiert.", count: 0 };
    try {
        // the orga's own words as they are, else the default in the event's language
        const delivery = await deliverUserPing({ event, userIds: missing.map((m) => m.id), text, guildId });
        console.log(
            `ping-missing: ${missing.length} Raider — events ${timings.events}ms, members ${timings.members}ms, post ${Date.now() - timings.at}ms`,
        );
        return { message: `${missing.length} fehlende Raider gepingt${dmSummary(delivery.dm)}.`, count: missing.length, delivery };
    } catch (e) {
        console.error("ping-missing failed:", e.message);
        return fail(500, "post_failed", e.message || "Posten fehlgeschlagen.");
    }
}

module.exports = { findMissingRaiders, pingMissingRaiders };
