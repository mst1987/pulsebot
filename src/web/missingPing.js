// "Fehlende pingen": ping the raiders who hold a role of the event's category
// but have not reacted to the signup yet. One function for the raid detail
// (POST /api/raids/ping-missing) and "Event verwalten" in Discord (#288), so
// both ping exactly the same people.
//
// The missing raiders are always re-derived here; no caller hands in the list.
const { loadEventGroups, eventLookbackSince } = require("./raidEventGroups");
const { getConfig } = require("../stores/settingsStore");
const { computeAttendance, hasStarted } = require("../utils/attendance");
const discord = require("../services/discord/discord");
const { normalizePingTarget, deliverUserPing, dmSummary, TARGET_LABELS } = require("../services/discord/pingDelivery");
const { fail } = require("./http/apiResult");

/**
 * @param {{ guildId: string, eventId: string, target?: string, text?: string }} p
 * @returns {Promise<{ message: string, count: number, delivery?: object } | { error: { status: number, code: string, message: string } }>}
 */
async function pingMissingRaiders({ guildId, eventId, target: rawTarget, text }) {
    // Timings are logged because a slow step here is invisible from the outside:
    // when the whole handler outlives the reverse proxy's 60s ceiling, the admin
    // only ever sees a 504 gateway page and cannot tell which of the three
    // external round trips (Raid-Helper, member fetch, Discord post) was to blame.
    const t0 = Date.now();
    const { groups, error: groupsError } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
    const tEvents = Date.now();
    if (groupsError) return fail(400, "events_unavailable", groupsError);
    const found = groups.flatMap((g) => g.events.map((e) => ({ e, g }))).find((x) => x.e.id === eventId);
    if (!found) return fail(404, "not_found", "Event nicht gefunden.");
    if (found.e.status === "cancelled") return fail(400, "cancelled", "Das Event ist abgesagt — da wird niemand mehr gepingt.");
    const categoryRoleIds = (getConfig().categoryRoles || {})[found.g.categoryId] || [];
    if (!categoryRoleIds.length) {
        return fail(400, "no_roles", "Dieser Kategorie sind keine Rollen zugeordnet (Einstellungen → Kategorien).");
    }
    // A raid that already started expects no further signups — and once
    // Raid-Helper drops its roster, everyone would count as "missing" and get
    // pinged. Refuse instead of firing a pointless mass ping.
    if (hasStarted(found.e)) {
        return fail(400, "event_past", "Der Raid hat bereits begonnen — fehlende Raider zu pingen ergibt hier keinen Sinn mehr.");
    }
    const { members, error: membersError } = await discord.listMembersWithRoles(guildId, categoryRoleIds);
    const tMembers = Date.now();
    if (membersError) return fail(400, "members_unavailable", membersError);
    const { missing } = computeAttendance(members, found.e.signUps || []);
    if (!missing.length) return { message: "Niemand fehlt — es haben schon alle reagiert.", count: 0 };
    const target = normalizePingTarget(rawTarget);
    try {
        let delivery = null;
        if (target === "event") {
            await discord.postMissingPing(found.e.channelId, missing.map((m) => m.id), text);
        } else {
            delivery = await deliverUserPing({
                target, event: found.e, userIds: missing.map((m) => m.id), text, guildId,
            });
        }
        console.log(
            `ping-missing (${target}): ${missing.length} Raider — events ${tEvents - t0}ms, members ${tMembers - tEvents}ms, post ${Date.now() - tMembers}ms`,
        );
        if (!delivery) return { message: `${missing.length} fehlende Raider gepingt.`, count: missing.length };
        return { message: `${missing.length} fehlende Raider gepingt (${TARGET_LABELS[target]})${dmSummary(delivery.dm)}.`, count: missing.length, delivery };
    } catch (e) {
        console.error("ping-missing failed:", e.message);
        return fail(500, "post_failed", e.message || "Posten fehlgeschlagen.");
    }
}

module.exports = { pingMissingRaiders };
