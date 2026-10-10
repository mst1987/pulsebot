// Which raids a member may see (Oct 2026, owner's decision). The orga (permissions.userIsOrga: a full
// admin or an orga role) sees every raid. Everybody else sees:
//
//   - the raids of the categories they may sign up for - the rule of the "Anmeldungen" page
//     (signupService.categoryVisible: the event categories, the category's raider roles),
//   - the raids of a category whose roster opened them to everybody (`roster.publicRaids`, set in the
//     roster's form) - seeing such a raid lets nobody sign up, that stays categoryVisible's rule,
//   - every raid they signed up for themselves.
//
// A right on the area `raids` does not widen this: raider roles hold `raids` read (or more) and are no
// orga. The raid list, the raid detail and the event-scoped reads (setup, raid plan) all ask here,
// so the rule lives in one place. Loot is never filtered by it: raiders may look up any raid's loot.
const { userIsOrga } = require("../../config/permissions");
const { categoryVisible } = require("./signupService");
const rosterStore = require("../../stores/rosterStore");
const settingsStore = require("../../stores/settingsStore");
const signupStore = require("../../stores/signupStore");
const { getEvent, isOwnEventId } = require("../../stores/eventStore");
const { getRaidEvent } = require("../../stores/raidEventStore");
const discord = require("../discord/discord");

/**
 * Who is looking: `{ orga, userId, roleIds, config }`. The member's Discord roles are read only for a
 * non-orga, best-effort - a failed or unknown lookup counts as no roles (a category with raider roles
 * then stays hidden; the own signups and the open categories still show).
 * @param {{ id: string, isAdmin?: boolean, isOrga?: boolean }} user  the session user
 * @param {string} guildId
 * @param {{ config?: object }} [opts]
 */
async function raidViewer(user, guildId, { config } = {}) {
    const cfg = config || settingsStore.getConfig() || {};
    const orga = userIsOrga(user);
    const userId = String((user && user.id) || "");
    let roleIds = [];
    if (!orga) {
        try {
            roleIds = (await discord.memberRoleIds(guildId, userId)) || [];
        } catch {
            roleIds = [];
        }
    }
    return { orga, userId, roleIds: roleIds.map(String), config: cfg };
}

/** Whether the category's roster opened its raids to every member (`publicRaids`, default false). */
function rosterOpensRaids(categoryId) {
    const cat = String(categoryId || "").trim();
    if (!cat) return false;
    try {
        const roster = rosterStore.rosterForCategory(cat);
        return !!(roster && roster.publicRaids === true);
    } catch {
        return false;
    }
}

/** Whether the viewer sees a category's raids (without looking at their own signups). */
function categoryShown(categoryId, viewer) {
    if (!viewer || viewer.orga) return true;
    if (categoryVisible(categoryId, { config: viewer.config, roleIds: viewer.roleIds })) return true;
    return rosterOpensRaids(categoryId);
}

/**
 * Whether the member signed up for the event: the event's `signUps` when the caller has them (the
 * event groups), else the own signup store (an own event) or Raid-Helper's snapshot (a past raid).
 */
function hasSignup(event, userId) {
    const uid = String(userId || "");
    if (!uid || !event) return false;
    const listed = Array.isArray(event.signUps) ? event.signUps : null;
    if (listed && listed.some((s) => s && String(s.userId) === uid)) return true;
    const id = String(event.id || "");
    if (!id) return false;
    if (isOwnEventId(id)) return !!signupStore.getSignup(id, uid);
    if (listed) return false;
    const snap = getRaidEvent(id);
    return !!(snap && Array.isArray(snap.signUps) && snap.signUps.some((s) => s && String(s.userId) === uid));
}

/**
 * Whether the viewer sees one raid.
 * @param {{ id: string, categoryId?: string, signUps?: object[] }} event
 * @param {{ orga: boolean, userId: string, roleIds: string[], config: object }} viewer  from raidViewer
 */
function eventShown(event, viewer) {
    if (!viewer || viewer.orga) return true;
    if (!event) return false;
    return categoryShown(event.categoryId, viewer) || hasSignup(event, viewer.userId);
}

/** The rows of a raid list the viewer sees; `signUpsOf(row)` hands in a row's signups when the caller has them. */
function visibleEvents(rows, viewer, signUpsOf = () => undefined) {
    if (!viewer || viewer.orga) return rows || [];
    return (rows || []).filter((row) => eventShown({ id: row.id, categoryId: row.categoryId, signUps: signUpsOf(row) }, viewer));
}

/**
 * The category of an event known only by its id - an own event's, else Raid-Helper's snapshot's,
 * else the one of the upcoming events (`loadGroups`, the cached event groups). Null when unknown.
 */
async function eventCategoryOf(eventId, { loadGroups } = {}) {
    const id = String(eventId || "").trim();
    if (!id) return null;
    if (isOwnEventId(id)) {
        const ev = getEvent(id);
        return ev ? { categoryId: ev.categoryId || "", guildId: ev.guildId || "" } : null;
    }
    const snap = getRaidEvent(id);
    if (snap) return { categoryId: snap.categoryId || "", guildId: snap.guildId || "", signUps: snap.signUps };
    if (typeof loadGroups !== "function") return null;
    try {
        const { groups } = await loadGroups();
        for (const g of groups || []) {
            const ev = (g.events || []).find((e) => e.id === id);
            if (ev) return { categoryId: g.categoryId || "", guildId: ev.guildId || "", signUps: ev.signUps };
        }
    } catch {
        // the event list is unreachable: unknown
    }
    return null;
}

/**
 * Whether the session user may open the raid `eventId` - the check of an event-scoped read. The orga
 * always may; an event whose category cannot be told is hidden from a non-orga unless they signed up.
 * @returns {Promise<boolean>}
 */
async function userSeesEvent(user, { guildId = "", eventId, categoryId, signUps, loadGroups } = {}) {
    if (userIsOrga(user)) return true;
    const known = categoryId !== undefined ? { categoryId, signUps } : await eventCategoryOf(eventId, { loadGroups });
    const viewer = await raidViewer(user, guildId || (known && known.guildId) || "");
    return eventShown({ id: eventId, categoryId: known ? known.categoryId : "", signUps: known ? known.signUps : undefined }, viewer)
        && (!!known || hasSignup({ id: eventId }, viewer.userId));
}

module.exports = { raidViewer, rosterOpensRaids, categoryShown, hasSignup, eventShown, visibleEvents, eventCategoryOf, userSeesEvent };
