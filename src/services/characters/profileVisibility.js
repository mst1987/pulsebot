// Which raider profiles the orga of one server may see (#1077). The profile stays global with the
// raider; what is limited is the view: a server sees its members and the raiders signed up to one of
// its own raids. Nothing is stored for this, so there is nothing to migrate.
//
// Without a readable member list only the signups count, never everybody: `serverMemberIds` gives
// null for that, with its waiting bounded (a page request must not hang on a full member fetch).
const { serverMemberIds } = require("../discord/members/serverMembers");
const { eventIdsOfGuild } = require("../../stores/events/eventStore");
const { userIdsOfEvents } = require("../../stores/events/signupStore");

/** The accounts signed up to any own raid of `guildId`. Raid-Helper raids keep their signups there and do not count. */
function signedUpIds(guildId) {
    return userIdsOfEvents(eventIdsOfGuild(guildId));
}

/**
 * The accounts whose profiles the orga of `guildId` may see: members plus signups, always a set.
 * @param {string} guildId
 * @param {{ waitMs?: number }} [opts]  how long to wait for the member list
 * @returns {Promise<Set<string>>}
 */
async function visibleRaiderIds(guildId, opts = {}) {
    const visible = signedUpIds(guildId);
    const members = await serverMemberIds(guildId, opts);
    for (const id of members || []) visible.add(id);
    return visible;
}

/** The profiles out of `list` a limit lets through; `visible` null (a full admin) means no limit. */
function withinVisible(list, visible) {
    return visible ? list.filter((p) => visible.has(String(p.userId))) : list;
}

module.exports = { signedUpIds, visibleRaiderIds, withinVisible };
